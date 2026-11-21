import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// F-K4 (E11): the server-side deployment scripts are checked without a server. Every script must
// parse (`bash -n`); the pure functions of scripts/ops/server/lib.sh run against temporary files.
// Nothing here starts a container or opens a connection.

const root = process.cwd();
const SERVER_DIR = join(root, "scripts/ops/server");
const SCRIPTS = [
  "lib.sh",
  "bootstrap.sh",
  "remote.sh",
  "backup.sh",
  "restore-test.sh",
  "health-report.sh",
];

// On Windows `bash` on PATH can be WSL; Git Bash is the one the repository uses.
function findBash(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"]
      : ["bash"];

  for (const candidate of candidates) {
    if (process.platform === "win32" && !existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ["-c", "true"], { stdio: "ignore" });

      return candidate;
    } catch {
      // try the next one
    }
  }

  return undefined;
}

const bash = findBash();
const requireBash = process.env.CI === "true";

if (bash === undefined && !requireBash) {
  console.warn("tests/scripts/ops-server-lib: bash is not installed, so these tests are skipped.");
}

const bashIt = it.skipIf(bash === undefined && !requireBash);

type Run = { status: number; stdout: string };

function runLib(script: string, env: Record<string, string> = {}): Run {
  const result = spawnSync(bash ?? "bash", ["-c", `set -euo pipefail; . "$KZ_LIB"; ${script}`], {
    encoding: "utf8",
    env: { ...process.env, KZ_LIB: join(SERVER_DIR, "lib.sh").replaceAll("\\", "/"), ...env },
  });

  return { status: result.status ?? -1, stdout: `${result.stdout}${result.stderr}` };
}

function sandbox(envProduction: string): { root: string; run: string } {
  const directory = mkdtempSync(join(tmpdir(), "krajozbior-ops-test-"));
  const kzRoot = join(directory, "srv");
  const kzRun = join(directory, "run");

  execFileSync(
    bash ?? "bash",
    ["-c", `mkdir -p "$0" "$1"`, kzRoot, kzRun].map((a) => a.replaceAll("\\", "/")),
  );
  writeFileSync(join(kzRoot, ".env.production"), envProduction);

  return { root: kzRoot.replaceAll("\\", "/"), run: kzRun.replaceAll("\\", "/") };
}

const ENV_PRODUCTION = [
  "KRAJOZBIOR_APP_DB_PASSWORD=app-pw-0123456789abcdef",
  "KRAJOZBIOR_AUTH_DB_PASSWORD=auth-pw-0123456789abcdef",
  "DATABASE_URL=postgres://krajozbior_app:app-pw-0123456789abcdef@db:5432/krajozbior",
  "DATABASE_AUTH_URL=postgres://krajozbior_auth:auth-pw-0123456789abcdef@db:5432/krajozbior",
  "BETTER_AUTH_SECRET=old-secret",
  "export BETTER_AUTH_SECRET=session-secret-0123456789abcdef0123456789",
  "BETTER_AUTH_URL=https://krajozbior.example",
  "AUTH_CLIENT_IP_HEADER=x-real-ip",
  "EMAIL_TRANSPORT=brevo",
  "BREVO_API_KEY=brevo-key-never-in-ops",
  "",
].join("\n");

const PAYLOAD_SECRETS = {
  KZ_OWNER_PW: "owner-pw-0123456789abcdef",
  KZ_OPS_PW: "ops-pw-0123456789abcdef",
};

// Kept in step with docs/deployment.md ("Co ma zawierać plik operatora") and
// tests/lib/config/operator-env.test.ts (PR #60).
const OPS_ENV: Record<string, string[]> = {
  "db:roles": [
    "DATABASE_ADMIN_URL",
    "KRAJOZBIOR_OWNER_DB_PASSWORD",
    "KRAJOZBIOR_APP_DB_PASSWORD",
    "KRAJOZBIOR_AUTH_DB_PASSWORD",
    "KRAJOZBIOR_OPS_DB_PASSWORD",
  ],
  "db:migrate": ["DATABASE_MIGRATION_URL"],
  "ops:curator": ["DATABASE_OPS_URL"],
  "auth:create-admin": [
    "DATABASE_OPS_URL",
    "DATABASE_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "AUTH_CLIENT_IP_HEADER",
  ],
  "auth:throttle": [
    "DATABASE_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "AUTH_CLIENT_IP_HEADER",
  ],
  "legal:final": [],
};

describe("server scripts parse", () => {
  for (const script of SCRIPTS) {
    bashIt(`bash -n ${script}`, () => {
      const result = spawnSync(
        bash ?? "bash",
        ["-n", join(SERVER_DIR, script).replaceAll("\\", "/")],
        {
          encoding: "utf8",
        },
      );

      expect(result.status, result.stderr).toBe(0);
    });
  }

  it("are ASCII-only (the payload also passes through Windows PowerShell 5.1)", () => {
    for (const script of SCRIPTS) {
      expect(readFileSync(join(SERVER_DIR, script), "utf8"), script).toMatch(/^[\t\n\x20-\x7e]*$/);
    }
  });

  it("never print the contents of secret files or variables", () => {
    for (const script of SCRIPTS) {
      const text = readFileSync(join(SERVER_DIR, script), "utf8");

      expect(text, script).not.toMatch(/cat\s+"?\$KZ_(ENV|OPS_ENV)/);
      expect(text, script).not.toMatch(
        /echo\s+"?\$KZ_(OWNER_PW|OPS_PW|ADMIN_PW|BREVO_KEY|RESTORE_KEY|GATE_PW)/,
      );
      expect(text, script).not.toContain("set -x");
    }
  });
});

describe("operator file /run/krajozbior/ops.env (kz_ops_env_write)", () => {
  for (const [command, names] of Object.entries(OPS_ENV)) {
    bashIt(`holds exactly the variables of ${command}`, () => {
      const box = sandbox(ENV_PRODUCTION);
      const result = runLib(`kz_ops_env_write ${command}`, {
        KZ_ROOT: box.root,
        KZ_RUN: box.run,
        ...PAYLOAD_SECRETS,
        KZ_PG_BOOTSTRAP_PW: "bootstrap-pw-0123456789",
      });

      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).toBe("");

      const file = join(box.run, "ops.env");
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);

      expect(lines.map((line) => line.split("=")[0])).toEqual(names);
      expect(lines.join("\n")).not.toContain("brevo-key-never-in-ops");

      if (process.platform !== "win32") {
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    });
  }

  bashIt("builds the owner and ops URLs from the payload, the rest from .env.production", () => {
    const box = sandbox(ENV_PRODUCTION);

    runLib("kz_ops_env_write auth:create-admin", {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      ...PAYLOAD_SECRETS,
    });
    const adminEnv = readFileSync(join(box.run, "ops.env"), "utf8");

    expect(adminEnv).toContain(
      "DATABASE_OPS_URL=postgres://krajozbior_ops:ops-pw-0123456789abcdef@db:5432/krajozbior\n",
    );
    // The last assignment wins, an `export` prefix is accepted.
    expect(adminEnv).toContain("BETTER_AUTH_SECRET=session-secret-0123456789abcdef0123456789\n");

    runLib("kz_ops_env_write db:migrate", {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      ...PAYLOAD_SECRETS,
    });

    expect(readFileSync(join(box.run, "ops.env"), "utf8")).toBe(
      "DATABASE_MIGRATION_URL=postgres://krajozbior_owner:owner-pw-0123456789abcdef@db:5432/krajozbior\n",
    );
  });

  bashIt("refuses with the variable name only when a value is missing", () => {
    const box = sandbox(ENV_PRODUCTION);
    const result = runLib("kz_ops_env_write db:roles", {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      ...PAYLOAD_SECRETS,
    });

    // Without the one-time superuser password db:roles is impossible after the first deployment.
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("brak wartosci DATABASE_ADMIN_URL dla db:roles");
    expect(result.stdout).not.toContain("pw-0123456789");
    expect(existsSync(join(box.run, "ops.env"))).toBe(false);
  });

  bashIt("refuses an unknown operator command", () => {
    const box = sandbox(ENV_PRODUCTION);
    const result = runLib("kz_ops_env_write db:seed:demo", { KZ_ROOT: box.root, KZ_RUN: box.run });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("nieznane polecenie operatora: db:seed:demo");
  });

  bashIt("removes the file with kz_ops_env_clear", () => {
    const box = sandbox(ENV_PRODUCTION);

    runLib("kz_ops_env_write db:migrate && kz_ops_env_clear", {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      ...PAYLOAD_SECRETS,
    });

    expect(existsSync(join(box.run, "ops.env"))).toBe(false);
  });
});

describe("demo flags never on the server (kz_find_demo_flags)", () => {
  bashIt("finds each flag named in a file", () => {
    const box = sandbox(`${ENV_PRODUCTION}# ALLOW_DEMO_SEED=1\nEMAIL_OUTBOX_TEST_ONLY=1\n`);
    const result = runLib(`kz_find_demo_flags "$KZ_ROOT/.env.production"`, { KZ_ROOT: box.root });

    expect(result.stdout.trim().split("\n")).toEqual(["ALLOW_DEMO_SEED", "EMAIL_OUTBOX_TEST_ONLY"]);
  });

  bashIt("prints nothing for a clean file", () => {
    const box = sandbox(ENV_PRODUCTION);
    const result = runLib(`kz_find_demo_flags "$KZ_ROOT/.env.production" /missing/file`, {
      KZ_ROOT: box.root,
    });

    expect(result).toEqual({ status: 0, stdout: "" });
  });
});

describe("deployment modes with stubbed docker, git and network (remote.sh)", () => {
  // Every outside effect is replaced by a function that logs its call, so the order of the
  // steps and the decisions (rollback, refusal) are checked without Docker or a server.
  const STUBS = [
    'kz_checkout() { echo "checkout $1"; }',
    'kz_assert_no_demo_flags() { echo "flags-ok"; }',
    "kz_write_healthchecks_env() { :; }",
    'kz_backup() { echo "backup $1"; }',
    'kz_compose() { echo "compose $* tag=${IMAGE_TAG:-}"; }',
    'kz_ops() { echo "ops $1"; [ "$1" != "legal:final" ] || [ "${LEGAL_OK:-1}" = "1" ]; }',
    'kz_site_ok() { echo "site-check"; [ "${SITE_OK:-1}" = "1" ]; }',
    'kz_wait_http() { echo "http $1 $2"; }',
  ].join("\n");
  const SHA = "c".repeat(40);

  function runMode(
    mode: string,
    env: Record<string, string>,
    prepare = "",
  ): Run & { root: string } {
    const box = sandbox(ENV_PRODUCTION);
    const remote = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
    const result = runLib(`. "${remote}"\n${STUBS}\n${prepare}\nkz_mode_${mode}`, {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      KZ_COMMIT: SHA,
      KZ_SITE_HOST: "krajozbior.example",
      ...env,
    });

    return { ...result, root: box.root };
  }

  const initialized = 'kz_state_set initialized x; kz_state_set current-tag "aaaaaaaaaaaa"';

  bashIt("commit: backup before the build, migrations before the swap, new tag recorded", () => {
    const result = runMode("commit", {}, initialized);

    expect(result.status, result.stdout).toBe(0);
    const steps = result.stdout
      .split("\n")
      .filter((line) => !line.startsWith("[krajozbior]"))
      .filter(Boolean);

    expect(steps).toEqual([
      `checkout ${SHA}`,
      "flags-ok",
      "backup predeploy",
      "compose --profile ops build app ops tag=cccccccccccc",
      "ops db:migrate",
      "compose up -d --wait app proxy tag=cccccccccccc",
      "site-check",
    ]);
    expect(readFileSync(join(result.root, "state/current-tag"), "utf8")).toBe("cccccccccccc\n");
    expect(readFileSync(join(result.root, "state/previous-tag"), "utf8")).toBe("aaaaaaaaaaaa\n");
  });

  bashIt("commit: goes back to the previous image when the site check fails", () => {
    const result = runMode("commit", { SITE_OK: "0" }, initialized);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("compose up -d --wait app tag=aaaaaaaaaaaa");
    expect(result.stdout).toContain("BLAD: wdrozenie cccccccccccc nieudane; dziala aaaaaaaaaaaa");
    expect(readFileSync(join(result.root, "state/current-tag"), "utf8")).toBe("aaaaaaaaaaaa\n");
  });

  bashIt("commit: refuses before the first deployment", () => {
    const result = runMode("commit", {});

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pierwsze wdrozenie jeszcze sie nie odbylo");
    expect(result.stdout).not.toContain("checkout");
  });

  bashIt("initial: refuses a second first deployment", () => {
    const result = runMode("initial", {}, initialized);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pierwsze wdrozenie juz bylo");
  });

  bashIt("otworz: keeps the password gate when legal:final fails", () => {
    const result = runMode(
      "otworz",
      { LEGAL_OK: "0" },
      `${initialized}; mkdir -p "$KZ_GATE_DIR"; echo gate > "$KZ_GATE_DIR/gate.caddy"`,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "teksty prawne maja znaczniki robocze; serwis zostaje za haslem",
    );
    expect(result.stdout).not.toContain("caddy reload");
    expect(existsSync(join(result.root, "caddy-gate/gate.caddy"))).toBe(true);
  });

  bashIt("otworz: removes the gate and reloads Caddy after legal:final passes", () => {
    const result = runMode(
      "otworz",
      {},
      `${initialized}; mkdir -p "$KZ_GATE_DIR"; echo gate > "$KZ_GATE_DIR/gate.caddy"`,
    );

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("ops legal:final");
    expect(result.stdout).toContain(
      "compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile tag=aaaaaaaaaaaa",
    );
    expect(result.stdout).toContain("http / 200");
    expect(existsSync(join(result.root, "caddy-gate/gate.caddy"))).toBe(false);
  });

  bashIt("admin: refuses without the address, password or reason", () => {
    const result = runMode("admin", { KZ_ADMIN_EMAIL: "a@example.com" }, initialized);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("brak adresu, hasla albo powodu");
    expect(result.stdout).not.toContain("ops auth:create-admin");
  });
});

describe("small helpers", () => {
  bashIt("writes the Caddy gate with an exception for /api/health", () => {
    const result = runLib("kz_gate_content '$2a$14$abc'");

    expect(result.stdout).toBe(
      "@krajozbior_gate not path /api/health\nbasic_auth @krajozbior_gate {\n\tkrajozbior $2a$14$abc\n}\n",
    );
  });

  bashIt("generates hex secrets of the requested length", () => {
    const result = runLib("kz_secret; echo; kz_secret 32");
    const [short, long] = result.stdout.trim().split("\n");

    expect(short).toMatch(/^[0-9a-f]{48}$/);
    expect(long).toMatch(/^[0-9a-f]{64}$/);
  });

  bashIt("decodes base64 payload values", () => {
    const encoded = Buffer.from("Krajozbiór — redakcja").toString("base64");

    expect(runLib(`kz_b64 '${encoded}'`).stdout).toBe("Krajozbiór — redakcja");
    expect(runLib("kz_b64 ''").stdout).toBe("");
  });

  bashIt("checks out only full commit hashes", () => {
    const result = runLib("kz_checkout main");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("nieprawidlowy commit");
  });

  bashIt("masks e-mail and IP addresses in the diagnostic output, not the times", () => {
    const remote = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
    const result = runLib(
      `. "${remote}"; printf '%s\\n' 'user@example.com from 203.0.113.7 and 2001:db8:0:1::2 at 10:00:00' | kz_mask`,
    );

    expect(result.stdout.trim()).toBe("<e-mail> from <ip> and <ip> at 10:00:00");
  });
});
