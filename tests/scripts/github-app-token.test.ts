import { generateKeyPairSync, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BotTokenError,
  DEFAULT_API,
  PIPELINE_PERMISSIONS,
  botGitIdentity,
  buildJwtClaims,
  buildTokenRequest,
  checkPermissions,
  chooseKeyFile,
  loginGh,
  mintInstallationToken,
  parseArgs,
  parseBotConfig,
  run,
  signAppJwt,
  verifyInstallation,
} from "../../scripts/lib/github-app-token.mjs";

// Helper of scripts/bot-token.ps1: signs the GitHub App JWT and mints an
// installation token. Every test uses a throwaway RSA key generated here and a
// fake API; nothing talks to GitHub.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TOKEN = "ghs_test-token-that-must-never-be-printed";

const config = {
  owner: "jan",
  appSlug: "demo-bot",
  appId: 123456,
  installationId: 987654,
  botUserId: 111222,
  repositories: ["demo", "demo-docs"],
};

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

type FakeCall = { url: string; method: string; body: unknown; auth: string };

function fakeApi(overrides: { installation?: object; token?: object; status?: number } = {}) {
  const calls: FakeCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
      auth: String((init.headers as Record<string, string>).Authorization),
    });
    if (overrides.status) {
      return new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: overrides.status,
      });
    }
    if (url.endsWith("/access_tokens")) {
      return new Response(
        JSON.stringify({
          token: TOKEN,
          expires_at: "2026-11-17T18:00:00Z",
          permissions: { ...PIPELINE_PERMISSIONS },
          repositories: [{ name: "demo" }, { name: "demo-docs" }],
          ...overrides.token,
        }),
        { status: 201 },
      );
    }
    return new Response(
      JSON.stringify({
        account: { login: "jan" },
        repository_selection: "selected",
        permissions: { ...PIPELINE_PERMISSIONS },
        ...overrides.installation,
      }),
      { status: 200 },
    );
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("buildJwtClaims", () => {
  it("backdates iat by 60 s, expires after 9 minutes and names the app", () => {
    expect(buildJwtClaims({ appId: 42, nowSeconds: 1_000_000 })).toEqual({
      iat: 999_940,
      exp: 1_000_540,
      iss: 42,
    });
  });

  it("rejects an app id that is not a positive integer", () => {
    expect(() => buildJwtClaims({ appId: 0, nowSeconds: 1 })).toThrow(BotTokenError);
    expect(() => buildJwtClaims({ appId: "42", nowSeconds: 1 })).toThrow(BotTokenError);
  });
});

describe("signAppJwt", () => {
  it("produces an RS256 JWT that the public key verifies", () => {
    const jwt = signAppJwt({ appId: 42, privateKey: keyPem, nowSeconds: 1_000_000 });
    const [header, claims, signature] = jwt.split(".");

    expect(decode(header!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims!)).toEqual({ iat: 999_940, exp: 1_000_540, iss: 42 });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("refuses text that is not a key and a key that is not RSA", () => {
    expect(() => signAppJwt({ appId: 42, privateKey: "not a key" })).toThrow(BotTokenError);
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect(() => signAppJwt({ appId: 42, privateKey: ec })).toThrow(/RSA/);
  });
});

describe("parseBotConfig", () => {
  it("accepts a filled config and keeps only known fields", () => {
    expect(parseBotConfig(JSON.stringify({ ...config, extra: 1 }))).toEqual(config);
  });

  it("refuses the unfilled template until BOOTSTRAP fills it", () => {
    const template = JSON.stringify({
      owner: "{{GITHUB_OWNER}}",
      appSlug: "demo-bot",
      appId: 0,
      installationId: 0,
      botUserId: 0,
      repositories: ["demo", "demo-docs"],
    });
    expect(() => parseBotConfig(template)).toThrow(/owner, appId, installationId/);
  });

  it("accepts the filled .github/bot.json of this repository", () => {
    const file = readFileSync(new URL("../../.github/bot.json", import.meta.url), "utf8");
    expect(parseBotConfig(file).appId).toBeGreaterThan(0);
  });

  it("refuses broken JSON, one repository or a repeated one", () => {
    expect(() => parseBotConfig("{")).toThrow(BotTokenError);
    expect(() => parseBotConfig(JSON.stringify({ ...config, repositories: ["demo"] }))).toThrow(
      /repositories/,
    );
    expect(() =>
      parseBotConfig(JSON.stringify({ ...config, repositories: ["demo", "demo"] })),
    ).toThrow(/repositories/);
  });

  it("treats a missing bot user id as unknown", () => {
    expect(parseBotConfig(JSON.stringify({ ...config, botUserId: 0 })).botUserId).toBeNull();
  });
});

describe("botGitIdentity", () => {
  it("uses the [bot] login and its noreply address", () => {
    expect(botGitIdentity(config)).toEqual({
      name: "demo-bot[bot]",
      email: "111222+demo-bot[bot]@users.noreply.github.com",
    });
    expect(botGitIdentity({ ...config, botUserId: null }).email).toBeNull();
  });
});

describe("token request and permission checks", () => {
  it("asks for the two repositories and the pipeline permissions only", () => {
    expect(buildTokenRequest(config)).toEqual({
      repositories: ["demo", "demo-docs"],
      permissions: {
        contents: "write",
        pull_requests: "write",
        statuses: "write",
        issues: "write",
        checks: "read",
        actions: "read",
        metadata: "read",
      },
    });
  });

  it("flags administration, account permissions and higher levels", () => {
    expect(checkPermissions({ ...PIPELINE_PERMISSIONS })).toEqual([]);
    expect(checkPermissions({ administration: "write" })).toEqual(["administration: write"]);
    expect(checkPermissions({ members: "read" })).toEqual(["members: read"]);
    expect(checkPermissions({ checks: "write" })).toEqual(["checks: write (potrzebne read)"]);
    expect(checkPermissions({ contents: "admin" })).toEqual(["contents: admin (potrzebne write)"]);
  });

  it("tolerates workflows only when asked to", () => {
    expect(checkPermissions({ workflows: "write" })).toEqual(["workflows: write"]);
    expect(checkPermissions({ workflows: "write" }, { tolerateWorkflows: true })).toEqual([]);
  });
});

describe("chooseKeyFile", () => {
  function homeWithKeys(names: string[]) {
    const home = mkdtempSync(join(tmpdir(), "bot-token-home-"));
    const dir = join(home, ".config", "demo-bot");
    mkdirSync(dir, { recursive: true });
    for (const name of names) writeFileSync(join(dir, name), keyPem);
    return { home, dir };
  }

  it("takes the only .pem of ~/.config/<app-slug>/ for api.github.com", () => {
    const { home, dir } = homeWithKeys(["demo-bot.2026-11-17.private-key.pem", "notes.txt"]);
    expect(chooseKeyFile({ apiBaseUrl: DEFAULT_API, appSlug: "demo-bot", home })).toBe(
      join(dir, "demo-bot.2026-11-17.private-key.pem"),
    );
  });

  it("stops when the folder has no key or two keys (rotation not finished)", () => {
    expect(() =>
      chooseKeyFile({ apiBaseUrl: DEFAULT_API, appSlug: "demo-bot", home: homeWithKeys([]).home }),
    ).toThrow(/nie ma pliku .pem/);
    expect(() =>
      chooseKeyFile({
        apiBaseUrl: DEFAULT_API,
        appSlug: "demo-bot",
        home: homeWithKeys(["a.pem", "b.pem"]).home,
      }),
    ).toThrow(/2 plikow/);
    expect(() =>
      chooseKeyFile({ apiBaseUrl: DEFAULT_API, appSlug: "demo-bot", home: tmpdir() + "/none" }),
    ).toThrow(/Brak folderu/);
  });

  it("never lets the real key sign requests to another server", () => {
    const { home, dir } = homeWithKeys(["a.pem"]);
    const fake = "http://127.0.0.1:9";
    expect(() => chooseKeyFile({ apiBaseUrl: fake, appSlug: "demo-bot", home })).toThrow(
      /--key-file/,
    );
    expect(() =>
      chooseKeyFile({ apiBaseUrl: fake, keyFile: join(dir, "a.pem"), appSlug: "demo-bot", home }),
    ).toThrow(/Prawdziwy klucz/);
    expect(() =>
      chooseKeyFile({ apiBaseUrl: DEFAULT_API, keyFile: "x.pem", appSlug: "demo-bot", home }),
    ).toThrow(/tylko do testow/);
    expect(
      chooseKeyFile({ apiBaseUrl: fake, keyFile: "test.key", appSlug: "demo-bot", home }),
    ).toBe("test.key");
  });
});

describe("parseArgs", () => {
  it("accepts https and a local test server only", () => {
    expect(parseArgs([]).api).toBe(DEFAULT_API);
    expect(parseArgs(["--api", "http://127.0.0.1:55480/"]).api).toBe("http://127.0.0.1:55480");
    expect(() => parseArgs(["--api", "http://example.com"])).toThrow(BotTokenError);
    expect(() => parseArgs(["--token", "x"])).toThrow(/Nieznany/);
  });
});

describe("installation and token (fake API)", () => {
  const jwt = "header.claims.signature";

  it("checks the installation with the JWT and mints a narrowed token", async () => {
    const api = fakeApi();
    await expect(
      verifyInstallation({ apiBaseUrl: "http://x", jwt, config, fetchImpl: api.fetchImpl }),
    ).resolves.toEqual({ hasWorkflows: false });
    await expect(
      mintInstallationToken({ apiBaseUrl: "http://x", jwt, config, fetchImpl: api.fetchImpl }),
    ).resolves.toEqual({ token: TOKEN, expiresAt: "2026-11-17T18:00:00Z" });

    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET http://x/app/installations/987654",
      "POST http://x/app/installations/987654/access_tokens",
    ]);
    expect(api.calls.every((call) => call.auth === `Bearer ${jwt}`)).toBe(true);
    expect(api.calls[1]!.body).toEqual(buildTokenRequest(config));
  });

  it.each([
    [{ account: { login: "someone-else" } }, /someone-else/],
    [{ repository_selection: "all" }, /wszystkich repozytoriow/],
    [{ permissions: { ...PIPELINE_PERMISSIONS, administration: "write" } }, /administration/],
  ])("refuses an installation %j", async (installation, message) => {
    const api = fakeApi({ installation });
    await expect(
      verifyInstallation({ apiBaseUrl: "http://x", jwt, config, fetchImpl: api.fetchImpl }),
    ).rejects.toThrow(message);
  });

  it("reports a tolerated workflows permission", async () => {
    const api = fakeApi({
      installation: { permissions: { ...PIPELINE_PERMISSIONS, workflows: "write" } },
    });
    await expect(
      verifyInstallation({ apiBaseUrl: "http://x", jwt, config, fetchImpl: api.fetchImpl }),
    ).resolves.toEqual({ hasWorkflows: true });
  });

  it("refuses a token broader than requested, without printing it", async () => {
    const api = fakeApi({ token: { repositories: [{ name: "demo" }, { name: "other" }] } });
    const error = await mintInstallationToken({
      apiBaseUrl: "http://x",
      jwt,
      config,
      fetchImpl: api.fetchImpl,
    }).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(BotTokenError);
    expect((error as Error).message).toContain("other");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("turns an HTTP error into a short message", async () => {
    const api = fakeApi({ status: 401 });
    await expect(
      mintInstallationToken({ apiBaseUrl: "http://x", jwt, config, fetchImpl: api.fetchImpl }),
    ).rejects.toThrow("HTTP 401 (Bad credentials)");
  });
});

describe("loginGh", () => {
  it("passes the token on stdin, never as an argument, and masks gh output", () => {
    const seen: { args: string[]; input: string }[] = [];
    const spawn = ((_: string, args: string[], options: { input: string }) => {
      seen.push({ args, input: options.input });
      return { status: 1, stdout: "", stderr: `error validating token ${TOKEN}` };
    }) as never;

    const error = (() => {
      try {
        loginGh(TOKEN, { spawn });
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();

    expect(seen[0]!.args).toEqual([
      "auth",
      "login",
      "--hostname",
      "github.com",
      "--git-protocol",
      "https",
      "--with-token",
    ]);
    expect(seen[0]!.input).toBe(`${TOKEN}\n`);
    expect(error?.message).toContain("***");
    expect(error?.message).not.toContain(TOKEN);
  });
});

describe("run (whole flow, fake API)", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "bot-token-run-"));
    const configFile = join(dir, "bot.json");
    const keyFile = join(dir, "test.key");
    writeFileSync(configFile, JSON.stringify(config));
    writeFileSync(keyFile, keyPem);
    return { configFile, keyFile };
  }

  it("dry run mints a token, skips gh and never logs the token", async () => {
    const { configFile, keyFile } = setup();
    const api = fakeApi();
    const lines: string[] = [];
    const result = await run(
      ["--config", configFile, "--api", "http://127.0.0.1:9", "--key-file", keyFile, "--dry-run"],
      { fetchImpl: api.fetchImpl, log: (line: string) => lines.push(line) },
    );

    expect(result).toEqual({ loggedIn: false, expiresAt: "2026-11-17T18:00:00Z" });
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("PRIVATE KEY");
    expect(lines.at(-1)).toContain("--dry-run");
    // The JWT sent to the fake API is signed by the throwaway key.
    const [header, claims, signature] = api.calls[0]!.auth.replace("Bearer ", "").split(".");
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("logs gh in with the token on stdin when not a dry run", async () => {
    const { configFile, keyFile } = setup();
    const inputs: string[] = [];
    const spawn = ((_: string, __: string[], options: { input: string }) => {
      inputs.push(options.input);
      return { status: 0, stdout: "", stderr: "" };
    }) as never;
    const lines: string[] = [];

    await run(["--config", configFile, "--api", "http://127.0.0.1:9", "--key-file", keyFile], {
      fetchImpl: fakeApi().fetchImpl,
      log: (line: string) => lines.push(line),
      spawn,
    });

    expect(inputs).toEqual([`${TOKEN}\n`]);
    expect(lines.at(-1)).toBe("OK: gh zalogowane jako demo-bot[bot].");
    expect(lines.join("\n")).not.toContain(TOKEN);
  });
});
