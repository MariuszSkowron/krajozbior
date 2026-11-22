import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Starting Git Bash processes is slow on Windows under load (review F-K4, N3).
vi.setConfig({ testTimeout: 30_000 });

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
  "showcase.sh",
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

// Stub programs (docker, age, ss, curl) in a temporary directory placed first on PATH. Unlike
// stubbed shell functions they leave the real code of lib.sh, bootstrap.sh and remote.sh in the
// path under test (review F-K4: B2-B5 hid behind function stubs).
function stubBin(programs: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "krajozbior-ops-bin-"));

  for (const [name, body] of Object.entries(programs)) {
    writeFileSync(join(directory, name), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  }

  return directory.replaceAll("\\", "/");
}

// Prefix for a bash script: puts STUB_BIN first on PATH (cygpath turns C:/x into /c/x in Git Bash).
const WITH_STUBS =
  'PATH="$(cygpath -u "$STUB_BIN" 2>/dev/null || printf %s "$STUB_BIN"):$PATH"; export PATH;';

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
  "news:import": ["DATABASE_OPS_URL", "BETTER_AUTH_URL"],
  "catalog:import": ["DATABASE_URL", "DATABASE_OPS_URL", "BETTER_AUTH_URL"],
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
    // SITE_SEQ: results of consecutive site checks (1 = ok), e.g. "0 1" = swap fails, rollback ok.
    'SITE_N=0; kz_site_ok() { echo "site-check"; SITE_N=$((SITE_N + 1)); [ "$(echo "${SITE_SEQ:-1 1 1}" | cut -d" " -f"$SITE_N")" = "1" ]; }',
    'kz_wait_http() { echo "http $1 $2"; }',
    'kz_prune_images() { echo "prune $1 $2"; }',
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

  const PREVIOUS = "a".repeat(40);
  // A checked-out compose.yaml with the operator file of PR #60 and the Caddy password gate.
  const checkedOut =
    'mkdir -p "$KZ_SRC/deploy" "$KZ_GATE_DIR"; echo "path: \\${KRAJOZBIOR_OPS_ENV_FILE:-/run/krajozbior/ops.env}" >"$KZ_SRC/deploy/compose.yaml"; echo gate >"$KZ_GATE_DIR/gate.caddy"';
  const initialized = `kz_state_set initialized x; kz_state_set current-tag "aaaaaaaaaaaa"; kz_state_set current-commit "${PREVIOUS}"; ${checkedOut}`;
  const steps = (stdout: string) =>
    stdout
      .split("\n")
      .filter((line) => !line.startsWith("[krajozbior]"))
      .filter(Boolean);

  bashIt("commit: backup before the build, migrations before the swap, new tag recorded", () => {
    const result = runMode("commit", {}, initialized);

    expect(result.status, result.stdout).toBe(0);
    expect(steps(result.stdout)).toEqual([
      "backup predeploy",
      `checkout ${SHA}`,
      "flags-ok",
      "compose --profile ops build app ops tag=cccccccccccc",
      "ops db:migrate",
      "compose up -d --wait app tag=cccccccccccc",
      "compose up -d --wait --force-recreate proxy tag=cccccccccccc",
      "site-check",
      "prune cccccccccccc aaaaaaaaaaaa",
    ]);
    expect(readFileSync(join(result.root, "state/current-tag"), "utf8")).toBe("cccccccccccc\n");
    expect(readFileSync(join(result.root, "state/previous-tag"), "utf8")).toBe("aaaaaaaaaaaa\n");
    expect(readFileSync(join(result.root, "state/previous-commit"), "utf8")).toBe(`${PREVIOUS}\n`);
  });

  bashIt("commit: goes back to the previous code, app and proxy, and checks the site (S2)", () => {
    const result = runMode("commit", { SITE_SEQ: "0 1" }, initialized);

    expect(result.status).toBe(1);
    // N1: the Caddyfile is a single-file bind mount; only a recreated proxy sees the new file.
    expect(steps(result.stdout).slice(-5)).toEqual([
      "site-check",
      `checkout ${PREVIOUS}`,
      "compose up -d --wait app tag=aaaaaaaaaaaa",
      "compose up -d --wait --force-recreate proxy tag=aaaaaaaaaaaa",
      "site-check",
    ]);
    expect(result.stdout).toContain(
      "BLAD: wdrozenie cccccccccccc nieudane; przywrocono aaaaaaaaaaaa i strona odpowiada. Baza jest juz po migracjach cccccccccccc",
    );
    expect(readFileSync(join(result.root, "state/current-tag"), "utf8")).toBe("aaaaaaaaaaaa\n");
  });

  bashIt("commit: says so when the rollback fails too (S2)", () => {
    const result = runMode("commit", { SITE_SEQ: "0 0" }, initialized);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "BLAD: wdrozenie cccccccccccc nieudane i powrot do aaaaaaaaaaaa tez nieudany",
    );
    expect(result.stdout).not.toContain("przywrocono");
  });

  bashIt("commit: a failed pre-deployment backup stops before the checkout", () => {
    const result = runMode(
      "commit",
      {},
      `${initialized}; kz_backup() { echo "backup $1"; return 1; }`,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("kopia przed wdrozeniem nieudana; nic nie zmieniono");
    expect(result.stdout).not.toContain("checkout");
  });

  for (const mode of ["initial", "commit"]) {
    bashIt(`${mode}: refuses without the operator file of PR #60, before any build (S7)`, () => {
      const prepare = mode === "initial" ? checkedOut : initialized;
      const result = runMode(
        mode,
        {},
        `${prepare}; echo "path: /srv/krajozbior/.env.production" >"$KZ_SRC/deploy/compose.yaml"`,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Najpierw scal PR #60");
      expect(result.stdout).not.toContain("build");
    });

    bashIt(
      `${mode}: refuses to start the proxy without the password gate before opening (S3)`,
      () => {
        const prepare = mode === "initial" ? checkedOut : initialized;
        const result = runMode(mode, {}, `${prepare}; rm -f "$KZ_GATE_DIR/gate.caddy"`);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain("brak bramki hasla");
        expect(result.stdout).not.toContain("build");
      },
    );
  }

  bashIt("commit: runs without the gate file once the service was opened", () => {
    const result = runMode(
      "commit",
      {},
      `${initialized}; rm -f "$KZ_GATE_DIR/gate.caddy"; kz_state_set opened x`,
    );

    expect(result.status, result.stdout).toBe(0);
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

  bashIt("otworz: reloads Caddy also when an earlier attempt already removed the gate (S3)", () => {
    const result = runMode("otworz", {}, `${initialized}; rm -f "$KZ_GATE_DIR/gate.caddy"`);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("compose exec -T proxy caddy reload");
  });

  bashIt("admin: refuses without the address, password or reason", () => {
    const result = runMode("admin", { KZ_ADMIN_EMAIL: "a@example.com" }, initialized);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("brak adresu, hasla albo powodu");
    expect(result.stdout).not.toContain("ops auth:create-admin");
  });
});

describe("mode import: collection file to the server (remote.sh, F-K6)", () => {
  const CONTENT = '{"type":"batch"}\n{"type":"collection"}\n';
  const NAME = "fala-1-public.ndjson";
  const IMPORT_ENV = {
    KZ_IMPORT_NAME: NAME,
    KZ_IMPORT_SHA256: createHash("sha256").update(CONTENT).digest("hex"),
    KZ_IMPORT_B64: Buffer.from(CONTENT).toString("base64"),
    KZ_ORG_SLUG: "krajozbior-redakcja",
    KZ_CURATOR_EMAIL: "kurator@example.com",
    KZ_REASON: `Wgranie kolekcji z pliku ${NAME}`,
    KZ_SITE_HOST: "krajozbior.example",
    ...PAYLOAD_SECRETS,
  };
  // A running version with the F-K6 code on the server, and the EXIT trap of kz_main.
  const READY = [
    'kz_state_set initialized x; kz_state_set current-tag "aaaaaaaaaaaa"',
    'mkdir -p "$KZ_SRC/scripts"; echo "--confirm-host" >"$KZ_SRC/scripts/catalog-import.ts"',
    "trap kz_cleanup EXIT",
  ].join("\n");
  // Stub of the operator command: its arguments, the files it sees in the mounted folder and the
  // number of lines of the file (so the file really existed during the command).
  const opsStub = (status: number) =>
    `kz_ops() { echo "ops $*"; local dir="\${3%:/imports:ro}"; echo "mounted: $(ls "$dir")"; echo "lines: $(wc -l <"$dir/$KZ_IMPORT_NAME" | tr -d ' ')"; return ${status}; }`;

  function runImport(env: Record<string, string>, prepare: string) {
    const box = sandbox(ENV_PRODUCTION);
    const remote = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
    const result = runLib(`. "${remote}"\n${prepare}\nkz_mode_import`, {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      ...IMPORT_ENV,
      ...env,
    });
    const importsDir = join(box.root, "imports");
    const leftovers = existsSync(importsDir) ? readdirSync(importsDir) : [];

    return { ...result, leftovers };
  }

  bashIt("preview: dry run with the confirmed host, read-only mount, file removed after", () => {
    const result = runImport({ KZ_IMPORT_PHASE: "preview" }, `${READY}\n${opsStub(0)}`);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(
      new RegExp(
        `ops catalog:import -v \\S*/imports/run-[0-9-]+:/imports:ro -- --target server --confirm-host krajozbior\\.example --profile public --file /imports/${NAME} --org-slug krajozbior-redakcja --curator-email kurator@example\\.com --dry-run\\n`,
      ),
    );
    expect(result.stdout).not.toContain("--operator");
    expect(result.stdout).toContain(`mounted: ${NAME}`);
    expect(result.stdout).toContain("lines: 2");
    expect(result.stdout).toContain("GOTOWE: podglad (nic nie zapisano)");
    expect(result.leftovers).toEqual([]);
  });

  bashIt("apply: loads with the operator label and the reason, without --dry-run", () => {
    const result = runImport({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(0)}`);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain(
      `--curator-email kurator@example.com --operator wlasciciel --reason Wgranie kolekcji z pliku ${NAME}\n`,
    );
    expect(result.stdout).not.toContain("--dry-run");
    expect(result.stdout).toContain("GOTOWE: szkice wgrane");
    expect(result.leftovers).toEqual([]);
  });

  for (const [code, message] of [
    [2, "plik odrzucony (kod 2)"],
    [3, "odmowa (kod 3)"],
    [1, "wgrywanie nieudane (kod 1)"],
  ] as const) {
    bashIt(`a failed command (code ${code}) still removes the file`, () => {
      const result = runImport({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(code)}`);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(message);
      expect(result.stdout).toContain("plik usuniety z serwera");
      expect(result.leftovers).toEqual([]);
    });
  }

  bashIt("a new run removes folders left by a killed run, and only run-* folders", () => {
    const result = runImport(
      { KZ_IMPORT_PHASE: "preview" },
      `${READY}\n${opsStub(0)}\nmkdir -p "$KZ_IMPORTS/run-20200101-000000-1" "$KZ_IMPORTS/inny"; echo x >"$KZ_IMPORTS/run-20200101-000000-1/stary-public.ndjson"`,
    );

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).not.toContain("stary-public.ndjson");
    expect(result.leftovers).toEqual(["inny"]);
  });

  bashIt("code 3 tells that part of the drafts may already be on the server", () => {
    const result = runImport({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(3)}`);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("czesc szkicow juz jest na serwerze");
    expect(result.stdout).toContain("mozna powtorzyc");
  });

  bashIt("an exit inside the operator command removes the file through the EXIT trap", () => {
    const result = runImport(
      { KZ_IMPORT_PHASE: "apply" },
      `${READY}\nkz_ops() { kz_fail "brak wartosci DATABASE_OPS_URL dla catalog:import"; }`,
    );

    expect(result.status).toBe(1);
    expect(result.leftovers).toEqual([]);
  });

  bashIt("refuses a file whose SHA-256 differs, before any command, and removes it", () => {
    const result = runImport(
      { KZ_IMPORT_PHASE: "apply", KZ_IMPORT_SHA256: "0".repeat(64) },
      `${READY}\n${opsStub(0)}`,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("rozni sie od pliku z komputera");
    expect(result.stdout).not.toContain("ops catalog:import");
    expect(result.leftovers).toEqual([]);
  });

  for (const name of ["../fala-public.ndjson", "id_ed25519", "fala.ndjson", "-public.ndjson"]) {
    bashIt(`refuses the file name ${name} before writing anything`, () => {
      const result = runImport(
        { KZ_IMPORT_PHASE: "apply", KZ_IMPORT_NAME: name },
        `${READY}\n${opsStub(0)}`,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("zla nazwa pliku");
      expect(result.stdout).not.toContain("ops catalog:import");
      expect(result.leftovers).toEqual([]);
    });
  }

  bashIt("refuses an unknown phase and a bad organisation slug", () => {
    for (const [env, message] of [
      [{ KZ_IMPORT_PHASE: "publish" }, "nieznana faza wgrywania"],
      [{ KZ_IMPORT_PHASE: "apply", KZ_ORG_SLUG: "Zla Org" }, "nieprawidlowy slug organizacji"],
    ] as const) {
      const result = runImport(env, `${READY}\n${opsStub(0)}`);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(message);
      expect(result.stdout).not.toContain("ops catalog:import");
    }
  });

  bashIt("refuses when the running version has no server mode of catalog:import", () => {
    const result = runImport(
      { KZ_IMPORT_PHASE: "preview" },
      `${READY}\nrm -f "$KZ_SRC/scripts/catalog-import.ts"\n${opsStub(0)}`,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Najpierw wdroz commit z F-K6");
    expect(result.stdout).not.toContain("ops catalog:import");
    expect(result.leftovers).toEqual([]);
  });

  bashIt("refuses before the first deployment", () => {
    const result = runImport({ KZ_IMPORT_PHASE: "preview" }, opsStub(0));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pierwsze wdrozenie jeszcze sie nie odbylo");
  });

  bashIt("the real kz_ops puts the read-only mount before the service and writes ops.env", () => {
    const result = runImport(
      { KZ_IMPORT_PHASE: "preview" },
      `${READY}\nkz_compose() { echo "compose $*"; echo "ops.env: $(cut -d= -f1 "$KZ_OPS_ENV" | tr '\\n' ' ')"; }`,
    );

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(
      /compose --profile ops run --rm -T -v \S*\/imports\/run-[0-9-]+:\/imports:ro ops npm run --silent catalog:import -- --target server /,
    );
    expect(result.stdout).toContain("ops.env: DATABASE_URL DATABASE_OPS_URL BETTER_AUTH_URL ");
    expect(result.leftovers).toEqual([]);
  });
});

describe("mode aktualnosci: news file to the server (remote.sh, E7-R2b)", () => {
  // Every Polish letter, small and capital: the preview must bring them back unchanged (S29), and
  // the code of remote.sh itself stays ASCII (S19; the test of all scripts above checks that).
  const TITLE = "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ";
  const CONTENT = `{"id":"1","kind":"guide","title":"${TITLE}","status":"published"}\n{"id":"2","status":"withdrawn"}\n`;
  const NAME = "aktualnosci-pierwsze.ndjson";
  const NEWS_ENV = {
    KZ_IMPORT_NAME: NAME,
    KZ_IMPORT_SHA256: createHash("sha256").update(CONTENT).digest("hex"),
    KZ_IMPORT_B64: Buffer.from(CONTENT).toString("base64"),
    KZ_REASON: `Publikacja aktualnosci z pliku ${NAME}`,
    KZ_SITE_HOST: "krajozbior.example",
    ...PAYLOAD_SECRETS,
  };
  // A running version with the command on the server, and the EXIT trap of kz_main.
  const READY = [
    'kz_state_set initialized x; kz_state_set current-tag "aaaaaaaaaaaa"',
    'mkdir -p "$KZ_SRC/scripts"; echo \'{"scripts":{"news:import":"tsx x"}}\' >"$KZ_SRC/package.json"',
    'echo "// --confirm-host" >"$KZ_SRC/scripts/news-import.ts"',
    "trap kz_cleanup EXIT",
  ].join("\n");
  // Stub of the operator command: its arguments, the files it sees in the mounted folder and the
  // content of the file (so the file really existed, byte for byte, during the command).
  const opsStub = (status: number) =>
    `kz_ops() { echo "ops $*"; local dir="\${3%:/imports:ro}"; echo "mounted: $(ls "$dir")"; cat "$dir/$KZ_IMPORT_NAME"; return ${status}; }`;

  function runNews(env: Record<string, string>, prepare: string, call = "kz_mode_aktualnosci") {
    const box = sandbox(ENV_PRODUCTION);
    const remote = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
    const result = runLib(`. "${remote}"\n${prepare}\n${call}`, {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      ...NEWS_ENV,
      ...env,
    });
    const importsDir = join(box.root, "imports");
    const leftovers = existsSync(importsDir) ? readdirSync(importsDir) : [];

    return { ...result, leftovers };
  }

  bashIt("preview: dry run with the confirmed host, read-only mount, file removed after", () => {
    const result = runNews({ KZ_IMPORT_PHASE: "preview" }, `${READY}\n${opsStub(0)}`);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(
      new RegExp(
        `ops news:import -v \\S*/imports/run-[0-9-]+:/imports:ro -- --file /imports/${NAME} --target server --confirm-host krajozbior\\.example --dry-run\\n`,
      ),
    );
    expect(result.stdout).not.toContain("--operator");
    expect(result.stdout).not.toContain("--org-slug");
    expect(result.stdout).toContain(`mounted: ${NAME}`);
    expect(result.stdout).toContain("GOTOWE: podglad (nic nie zapisano)");
    expect(result.leftovers).toEqual([]);
  });

  bashIt("S29: the preview brings the Polish letters of a title back unchanged", () => {
    const result = runNews({ KZ_IMPORT_PHASE: "preview" }, `${READY}\n${opsStub(0)}`);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain(`"title":"${TITLE}"`);
  });

  bashIt("apply: writes with the operator label and the reason, without --dry-run", () => {
    const result = runNews({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(0)}`);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain(
      `--confirm-host krajozbior.example --operator wlasciciel --reason Publikacja aktualnosci z pliku ${NAME}\n`,
    );
    expect(result.stdout).not.toContain("--dry-run");
    expect(result.stdout).toContain("GOTOWE: aktualnosci wgrane");
    expect(result.leftovers).toEqual([]);
  });

  for (const [code, exitCode, message] of [
    [2, 2, "plik odrzucony (kod 2)"],
    [3, 3, "odmowa (kod 3)"],
    [3, 3, "ustawienia serwera (nazwa hosta)"],
    [1, 1, "wgrywanie aktualnosci nieudane (kod 1)"],
    [7, 1, "wgrywanie aktualnosci nieudane (kod 7)"],
  ] as const) {
    bashIt(
      `the command's code ${code} ends the mode with ${exitCode}, says what happened and still removes the file`,
      () => {
        const result = runNews({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(code)}`);

        expect(result.status).toBe(exitCode);
        expect(result.stdout).toContain(message);
        expect(result.stdout).toContain("plik usuniety z serwera");
        expect(result.leftovers).toEqual([]);
      },
    );
  }

  bashIt(
    "codes 2 and 3 say that nothing changed (all or nothing), code 1 that the file can be repeated",
    () => {
      const two = runNews({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(2)}`);
      const three = runNews({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(3)}`);
      const one = runNews({ KZ_IMPORT_PHASE: "apply" }, `${READY}\n${opsStub(1)}`);

      expect(two.stdout).toContain("nic sie nie zmienilo");
      expect(three.stdout).toContain("nic sie nie zmienilo");
      expect(one.stdout).toContain("w calosci albo wcale");
      expect(one.stdout).toContain("mozna powtorzyc");
      // No "partial" result as in the collection import (spec E7, S23).
      expect(`${two.stdout}${three.stdout}${one.stdout}`).not.toMatch(/czesciow/);
    },
  );

  bashIt("an exit inside the operator command removes the file through the EXIT trap", () => {
    const result = runNews(
      { KZ_IMPORT_PHASE: "apply" },
      `${READY}\nkz_ops() { kz_fail "brak wartosci DATABASE_OPS_URL dla news:import"; }`,
    );

    expect(result.status).toBe(1);
    expect(result.leftovers).toEqual([]);
  });

  bashIt("refuses a file whose SHA-256 differs, before any command, and removes it", () => {
    const result = runNews(
      { KZ_IMPORT_PHASE: "apply", KZ_IMPORT_SHA256: "0".repeat(64) },
      `${READY}\n${opsStub(0)}`,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("rozni sie od pliku z komputera");
    expect(result.stdout).not.toContain("ops news:import");
    expect(result.leftovers).toEqual([]);
  });

  for (const name of [
    "../aktualnosci-a.ndjson",
    "id_ed25519",
    "aktualnosci.ndjson",
    "aktualnosci-a.json",
    "fala-1-public.ndjson",
    "aktualnosci--a.ndjson",
  ]) {
    bashIt(`refuses the file name ${name} before writing anything`, () => {
      const result = runNews(
        { KZ_IMPORT_PHASE: "apply", KZ_IMPORT_NAME: name },
        `${READY}\n${opsStub(0)}`,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("zla nazwa pliku");
      expect(result.stdout).not.toContain("ops news:import");
      expect(result.leftovers).toEqual([]);
    });
  }

  bashIt("refuses an unknown phase, a missing reason and a bad or missing host name", () => {
    for (const [env, message] of [
      [{ KZ_IMPORT_PHASE: "publish" }, "nieznana faza wgrywania"],
      [{ KZ_IMPORT_PHASE: "apply", KZ_REASON: "" }, "brak powodu"],
      [{ KZ_IMPORT_PHASE: "apply", KZ_SITE_HOST: "" }, "brak nazwy hosta"],
      [{ KZ_IMPORT_PHASE: "apply", KZ_SITE_HOST: "host; rm -rf x" }, "brak nazwy hosta"],
      [{ KZ_IMPORT_PHASE: "apply", KZ_IMPORT_B64: "" }, "brak tresci pliku"],
    ] as const) {
      const result = runNews(env, `${READY}\n${opsStub(0)}`);

      expect(result.status, message).toBe(1);
      expect(result.stdout, message).toContain(message);
      expect(result.stdout, message).not.toContain("ops news:import");
      expect(result.leftovers, message).toEqual([]);
    }
  });

  bashIt(
    "refuses when the running version has no news:import, so the mode can be merged first",
    () => {
      const result = runNews(
        { KZ_IMPORT_PHASE: "preview" },
        `${READY}\necho '{"scripts":{"catalog:import":"tsx x"}}' >"$KZ_SRC/package.json"\n${opsStub(0)}`,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("nie ma polecenia news:import");
      expect(result.stdout).not.toContain("ops news:import");
      expect(result.leftovers).toEqual([]);
    },
  );

  bashIt(
    "refuses when news-import.ts has no server mode (--confirm-host), before anything runs",
    () => {
      const result = runNews(
        { KZ_IMPORT_PHASE: "preview" },
        `${READY}\necho "// first version" >"$KZ_SRC/scripts/news-import.ts"\n${opsStub(0)}`,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("nie obsluguje trybu serwera");
      expect(result.stdout).not.toContain("ops news:import");
      expect(result.leftovers).toEqual([]);
    },
  );

  bashIt("refuses before the first deployment", () => {
    const result = runNews({ KZ_IMPORT_PHASE: "preview" }, opsStub(0));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pierwsze wdrozenie jeszcze sie nie odbylo");
  });

  bashIt("kz_main runs the mode for KZ_MODE=aktualnosci and leaves nothing behind", () => {
    const result = runNews(
      { KZ_IMPORT_PHASE: "preview", KZ_MODE: "aktualnosci" },
      `kz_require_deploy() { :; }\nkz_state_set initialized x; kz_state_set current-tag "aaaaaaaaaaaa"\nmkdir -p "$KZ_SRC/scripts"; echo '"news:import"' >"$KZ_SRC/package.json"\necho "--confirm-host" >"$KZ_SRC/scripts/news-import.ts"\n${opsStub(0)}`,
      "kz_main",
    );

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("GOTOWE: podglad");
    expect(result.leftovers).toEqual([]);
  });

  bashIt(
    "the real kz_ops writes ops.env with the ops variables only, never the owner password",
    () => {
      const result = runNews(
        // The payload of this mode carries no owner password; one in the environment must not leak in.
        { KZ_IMPORT_PHASE: "preview", KZ_OWNER_PW: "owner-pw-0123456789abcdef" },
        `${READY}\nkz_compose() { echo "compose $*"; echo "ops.env: $(cut -d= -f1 "$KZ_OPS_ENV" | tr '\\n' ' ')"; echo "owner in ops.env: $(grep -c owner-pw "$KZ_OPS_ENV" || true)"; }`,
      );

      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).toMatch(
        /compose --profile ops run --rm -T -v \S*\/imports\/run-[0-9-]+:\/imports:ro ops npm run --silent news:import -- --file \/imports\/aktualnosci-pierwsze\.ndjson --target server /,
      );
      expect(result.stdout).toContain("ops.env: DATABASE_OPS_URL BETTER_AUTH_URL \n");
      expect(result.stdout).toContain("owner in ops.env: 0");
      expect(result.leftovers).toEqual([]);
    },
  );

  bashIt("the messages of remote.sh and the code of the mode are ASCII (S19)", () => {
    const text = readFileSync(join(SERVER_DIR, "remote.sh"), "utf8");
    const start = text.indexOf("# --- aktualnosci");

    expect(start).toBeGreaterThan(0);
    expect(text.slice(start, text.indexOf("kz_main() {", start))).toMatch(/^[\t\n\x20-\x7e]*$/);
  });
});

describe("public listeners check (bootstrap.sh, K-17) with real ss output", () => {
  // `ss -H -ltn`: State Recv-Q Send-Q Local:Port Peer:Port. The listening address is column 4.
  const CLEAN = [
    "LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*",
    "LISTEN 0      4096      127.0.0.54:53        0.0.0.0:*",
    "LISTEN 0      128          0.0.0.0:22        0.0.0.0:*",
    "LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*",
    "LISTEN 0      4096         0.0.0.0:443       0.0.0.0:*",
    "LISTEN 0      4096       127.0.0.1:41235     0.0.0.0:*",
    "LISTEN 0      128             [::]:22           [::]:*",
    "LISTEN 0      4096            [::]:443          [::]:*",
    "LISTEN 0      4096           [::1]:5432         [::]:*",
  ];

  function listeners(lines: string[]): Run {
    const box = sandbox(ENV_PRODUCTION);
    const sample = join(box.root, "ss.txt");

    writeFileSync(sample, `${lines.join("\n")}\n`);

    return runLib(
      `${WITH_STUBS} . "${join(SERVER_DIR, "bootstrap.sh").replaceAll("\\", "/")}"; kz_listeners_ok`,
      {
        STUB_BIN: stubBin({ ss: 'cat "$SS_SAMPLE"\n' }),
        SS_SAMPLE: sample,
      },
    );
  }

  bashIt("accepts a server listening publicly only on 22, 80 and 443", () => {
    const result = listeners(CLEAN);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("nasluch publiczny tylko 22/80/443");
  });

  bashIt("names a public port other than 22, 80 and 443", () => {
    const result = listeners([...CLEAN, "LISTEN 0      4096         0.0.0.0:5432      0.0.0.0:*"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("nasluch publiczny na innych portach: 5432");
  });
});

describe("Caddy gate on a repeated -Bootstrap (review F-K4, A2)", () => {
  // Real kz_main of bootstrap.sh; every step before and after the gate is stubbed out.
  function bootstrapMain(existingGate: string | undefined): Run & { gate: string | undefined } {
    const box = sandbox(ENV_PRODUCTION);
    const gateFile = `${box.root}/caddy-gate/gate.caddy`;
    const stubs = [
      "kz_bootstrap_check_ssh_port",
      "kz_bootstrap_packages",
      "kz_bootstrap_deploy_user",
      "kz_bootstrap_journald",
      "kz_bootstrap_dirs",
      "kz_bootstrap_env",
      "kz_bootstrap_backup_key",
      "kz_bootstrap_updates",
      "kz_bootstrap_timers",
      "kz_bootstrap_firewall",
      "kz_bootstrap_sshd",
      "kz_write_healthchecks_env",
      "kz_listeners_ok",
      "kz_state_set",
      "su",
      "chown",
    ]
      .map((name) => `${name}() { :; }`)
      .join("; ");
    const result = runLib(
      `. "${join(SERVER_DIR, "bootstrap.sh").replaceAll("\\", "/")}"; ${stubs}; id() { echo 0; }; ` +
        `kz_gate_write() { mkdir -p "$KZ_GATE_DIR"; printf '%s' "$1" >"$KZ_GATE_DIR/gate.caddy"; }; ` +
        (existingGate === undefined
          ? ""
          : `mkdir -p "$KZ_GATE_DIR"; printf '%s' '${existingGate}' >"$KZ_GATE_DIR/gate.caddy"; `) +
        "kz_main",
      {
        KZ_ROOT: box.root,
        KZ_RUN: box.run,
        KZ_COMMIT: "a".repeat(40),
        KZ_REPO_URL: "https://github.com/example/krajozbior",
        KZ_GATE_PW: "new-password-from-second-run",
      },
    );

    return {
      ...result,
      gate: existsSync(gateFile) ? readFileSync(gateFile, "utf8") : undefined,
    };
  }

  bashIt("keeps the first gate and says the password is unchanged", () => {
    const result = bootstrapMain("first-run-gate");

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain(
      "Bramka juz istnieje - haslo bez zmian (z pierwszego uruchomienia)",
    );
    expect(result.stdout).not.toContain("bramka hasla Caddy wlaczona");
    expect(result.gate).toBe("first-run-gate");
  });

  bashIt("writes the gate and reports it on the first run", () => {
    const result = bootstrapMain(undefined);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("bramka hasla Caddy wlaczona");
    expect(result.gate).toBe("new-password-from-second-run");
  });
});

describe("backups with a real lib.sh and stubbed docker/age (B3, B4)", () => {
  // docker prints a dump of the given size (or fails); age copies stdin into the -o file.
  const AGE =
    'out=""\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\ncat >"$out"\nprintf age-tag >>"$out"\n';
  const DOCKER_OK = "printf PGDMP; head -c 6000 /dev/zero | tr '\\0' x\n";
  const DOCKER_DOWN = 'printf PGDMP; echo "service db is not running" >&2; exit 1\n';
  const CURL = 'printf \'%s\\n\' "$*" >>"$CURL_LOG"\n';

  function backupBox(docker: string) {
    const box = sandbox(ENV_PRODUCTION);

    writeFileSync(join(box.root, "backup.pub"), `age1${"q".repeat(58)}\n`);
    writeFileSync(join(box.root, "healthchecks.env"), "HC_BACKUP_URL=https://hc.example/abc\n");

    return {
      ...box,
      env: {
        KZ_ROOT: box.root,
        KZ_RUN: box.run,
        STUB_BIN: stubBin({ docker, age: AGE, curl: CURL }),
        CURL_LOG: `${box.root}/curl.log`,
      },
    };
  }

  const backups = (root: string) =>
    execFileSync(bash ?? "bash", ["-c", 'ls -1 "$0/backups" 2>/dev/null || true', root], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

  bashIt("B3: kz_backup on an empty backup folder returns and the deployment goes on", () => {
    const box = backupBox(DOCKER_OK);
    const result = runLib(`${WITH_STUBS} kz_backup predeploy; echo after-backup`, box.env);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("after-backup");
    expect(backups(box.root)).toEqual([
      expect.stringMatching(/^krajozbior-\d{8}-\d{6}-predeploy\.dump\.age$/),
    ]);
  });

  bashIt("keeps the 7 newest daily backups", () => {
    const box = backupBox(DOCKER_OK);
    const old = Array.from(
      { length: 8 },
      (_, i) => `krajozbior-2026110${i + 1}-031500-daily.dump.age`,
    );

    execFileSync(bash ?? "bash", [
      "-c",
      'mkdir -p "$0/backups"; cd "$0/backups"; shift; touch "$@"',
      box.root,
      "x",
      ...old,
    ]);
    const result = runLib(`${WITH_STUBS} kz_backup daily`, box.env);

    expect(result.status, result.stdout).toBe(0);
    const left = backups(box.root);

    expect(left).toHaveLength(7);
    expect(left).not.toContain(old[0]);
    expect(left).not.toContain(old[1]);
  });

  bashIt("B4: backup.sh with the database down signals a failure and leaves no backup file", () => {
    const box = backupBox(DOCKER_DOWN);
    const backupScript = join(SERVER_DIR, "backup.sh").replaceAll("\\", "/");
    const result = runLib(`${WITH_STUBS} bash "${backupScript}"`, box.env);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("kopia zapisana");
    expect(backups(box.root)).toEqual([]);
    expect(readFileSync(join(box.root, "curl.log"), "utf8")).toContain(
      "https://hc.example/abc/fail",
    );
  });

  bashIt("B4: refuses a dump that is too small to be a real database", () => {
    const box = backupBox("printf PGDMP\n");
    const result = runLib(
      `${WITH_STUBS} if kz_backup daily; then echo SUCCESS; else echo FAILED; fi`,
      box.env,
    );

    expect(result.stdout).toContain("FAILED");
    expect(backups(box.root)).toEqual([]);
  });
});

describe("first deployment can be repeated after a failure (B5)", () => {
  // docker keeps the state of the database volume in files: the volume remembers the superuser
  // password of its first start (like postgres), db:roles needs that password, `password null`
  // removes it. kz_compose, kz_compose_init and kz_ops are the real functions.
  const DOCKER = `S="$DOCKER_STATE"
printf 'docker %s\\n' "$*" >>"$S/log"
if [ "$1" = volume ]; then
  case "$2" in
    inspect) [ -f "$S/vol" ]; exit $? ;;
    rm) rm -f "$S/vol"; exit 0 ;;
  esac
  exit 0
fi
[ "$1" = compose ] || exit 0
a=" $* "
case "$a" in
  *" exec "*)
    [ -f "$S/vol" ] || exit 1
    case "$a" in *"password null"*) echo NULL >"$S/vol" ;; esac
    exit 0 ;;
  *" run "*)
    case "$a" in
      *" db:roles "*)
        if [ -f "$S/roles-fail-once" ]; then rm -f "$S/roles-fail-once"; echo "db:roles failed"; exit 1; fi
        pw="$(sed -n 's#^DATABASE_ADMIN_URL=postgres://postgres:\\([^@]*\\)@.*#\\1#p' "$KRAJOZBIOR_OPS_ENV_FILE")"
        if [ -z "$pw" ] || [ "$pw" != "$(cat "$S/vol")" ]; then echo 'password authentication failed for user "postgres"'; exit 1; fi
        exit 0 ;;
    esac
    exit 0 ;;
  *" up "*)
    case "$a" in
      *" db "*)
        if [ ! -f "$S/vol" ]; then
          [ -s "$KZ_RUN/pg-bootstrap" ] || { echo "Database is uninitialized and superuser password is not specified."; exit 1; }
          cat "$KZ_RUN/pg-bootstrap" >"$S/vol"
        fi ;;
    esac
    exit 0 ;;
esac
exit 0
`;
  const STUBS = [
    'kz_checkout() { echo "checkout $1"; }',
    'kz_check_secrets_absent() { echo "k7-ok"; }',
    'kz_site_ok() { echo site-check; if [ -f "$DOCKER_STATE/site-fail-once" ]; then rm -f "$DOCKER_STATE/site-fail-once"; return 1; fi; }',
  ].join("\n");

  function initialBox(failure: "site-fail-once" | "roles-fail-once") {
    const box = sandbox(ENV_PRODUCTION);
    const state = `${box.root}/docker-state`;

    execFileSync(bash ?? "bash", [
      "-c",
      'mkdir -p "$0" "$1/src/deploy" "$1/caddy-gate"; : >"$0/log"; : >"$0/$2"; echo "path: \\${KRAJOZBIOR_OPS_ENV_FILE:-/run/krajozbior/ops.env}" >"$1/src/deploy/compose.yaml"; echo gate >"$1/caddy-gate/gate.caddy"',
      state,
      box.root,
      failure,
    ]);

    const env = {
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      KZ_COMMIT: "c".repeat(40),
      KZ_SITE_HOST: "krajozbior.example",
      STUB_BIN: stubBin({ docker: DOCKER }),
      DOCKER_STATE: state,
      ...PAYLOAD_SECRETS,
    };
    const remote = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
    const run = () => {
      writeFileSync(join(state, "log"), "");
      const result = runLib(`${WITH_STUBS} . "${remote}"\n${STUBS}\nkz_mode_initial`, env);

      return { ...result, docker: readFileSync(join(state, "log"), "utf8") };
    };

    return { root: box.root, run };
  }

  bashIt(
    "resumes after the site check failed (TLS late), without a new superuser password",
    () => {
      const box = initialBox("site-fail-once");
      const first = box.run();

      expect(first.status).toBe(1);
      expect(first.stdout).toContain("serwis nie odpowiada poprawnie");

      const second = box.run();

      expect(second.status, second.stdout).toBe(0);
      expect(second.stdout).toContain("GOTOWE: pierwsze wdrozenie");
      expect(second.docker).not.toContain("db:roles");
      expect(second.docker).not.toContain("volume rm");
      expect(existsSync(join(box.root, "state/initialized"))).toBe(true);
    },
    30_000,
  );

  bashIt(
    "starts the empty database again when db:roles failed in the first attempt",
    () => {
      const box = initialBox("roles-fail-once");
      const first = box.run();

      expect(first.status).toBe(1);

      const second = box.run();

      expect(second.status, second.stdout).toBe(0);
      expect(second.docker).toContain("volume rm krajozbior-pgdata");
      expect(second.stdout).toContain("GOTOWE: pierwsze wdrozenie");
    },
    30_000,
  );

  // N2: a backup or a current-tag means the server once ran with data; never remove the volume.
  for (const [name, mark] of [
    ["a backup file", "backups/daily-20261121T000000Z.sql.age"],
    ["state/current-tag", "state/current-tag"],
  ] as const) {
    bashIt(
      `refuses to remove the volume when ${name} exists`,
      () => {
        const box = initialBox("roles-fail-once");

        expect(box.run().status).toBe(1);
        execFileSync(bash ?? "bash", [
          "-c",
          'mkdir -p "$(dirname "$0/$1")"; echo x >"$0/$1"',
          box.root,
          mark,
        ]);

        const second = box.run();

        expect(second.status).toBe(1);
        expect(second.stdout).toContain("odmawiam usuniecia wolumenu");
        expect(second.docker).not.toContain("volume rm");
      },
      30_000,
    );
  }
});

// The hourly resource check (health-report.sh) with stubbed df, docker and journalctl: the
// application log of the last hour is a sample file. Memory comes from the real /proc/meminfo
// (Git Bash has no MemAvailable), so only the text of the report is asserted, not the exit code.
describe("hourly resource check: daily pool of sign-in codes (health-report.sh)", () => {
  const DF = "printf 'Use%%\\n 10%%\\n'\n";
  const DOCKER = "printf true\n";
  const JOURNALCTL = 'echo "$@" >> "$JOURNAL_SAMPLE.args"\ncat "$JOURNAL_SAMPLE"\n';
  const ALARM_TEXT = "pula dziennych kodow logowania";

  function runReport(journal: string): string {
    const box = sandbox(ENV_PRODUCTION.replace("https://krajozbior.example", ""));
    const sample = join(box.root, "journal.log");

    writeFileSync(sample, journal);
    const result = spawnSync(bash ?? "bash", ["-c", `${WITH_STUBS} bash "$KZ_REPORT"`], {
      encoding: "utf8",
      env: {
        ...process.env,
        KZ_ROOT: box.root,
        KZ_RUN: box.run,
        KZ_REPORT: join(SERVER_DIR, "health-report.sh").replaceAll("\\", "/"),
        JOURNAL_SAMPLE: sample,
        STUB_BIN: stubBin({ df: DF, docker: DOCKER, journalctl: JOURNALCTL }),
      },
    });

    const argsFile = `${sample}.args`;
    const args = existsSync(argsFile) ? readFileSync(argsFile, "utf8") : "";

    return `${result.stdout}${result.stderr}\nJOURNALCTL ARGS: ${args}`;
  }

  bashIt("raises an alarm when the application logged the 80% mark", () => {
    const output = runReport(
      `{"event":"auth.otp_global_limit_80","globalLimit":300}\n{"event":"other"}\n`,
    );

    expect(output).toContain("ALARM");
    expect(output).toContain(ALARM_TEXT);
    expect(output).toContain("alarm 1 razy");
  });

  bashIt("looks 65 minutes back, so a late timer leaves no gap", () => {
    const output = runReport(`{"event":"auth.otp_global_limit_80","globalLimit":300}\n`);

    // The stub logs the arguments of every journalctl call; the pool check is the last one.
    expect(output).toContain("--since -65min");
  });

  bashIt("raises an alarm when the application logged the 100% mark too", () => {
    const output = runReport(
      `{"event":"auth.otp_global_limit_80","globalLimit":300}\n{"event":"auth.otp_global_limit_100","globalLimit":300}\n`,
    );

    expect(output).toContain("alarm 2 razy");
  });

  bashIt("says nothing about the pool when the log has no such event", () => {
    const output = runReport(`{"event":"account.deleted"}\n`);

    expect(output).not.toContain(ALARM_TEXT);
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

  // S3: before -Otworz the home page must ask for the password; 200 then means a missing gate.
  for (const [opened, code, ok] of [
    [false, "401", true],
    [false, "200", false],
    [true, "200", true],
    [true, "401", false],
  ] as const) {
    bashIt(
      `site check: home page ${code} ${opened ? "after" : "before"} opening is ${ok ? "ok" : "an error"}`,
      () => {
        const box = sandbox(ENV_PRODUCTION);
        const remote = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
        const result = runLib(
          `. "${remote}"; kz_wait_http() { :; }; kz_http_code() { echo ${code}; }; ${opened ? "kz_state_set opened x;" : ""} if kz_site_ok; then echo OK; else echo NOT-OK; fi`,
          { KZ_ROOT: box.root },
        );

        expect(result.stdout).toContain(ok ? "OK" : "NOT-OK");
        if (ok) expect(result.stdout).not.toContain("NOT-OK");
      },
    );
  }

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

describe("target showcase: the same remote.sh with showcase.sh (rehearsal, D-E11-8)", () => {
  const REMOTE = join(SERVER_DIR, "remote.sh").replaceAll("\\", "/");
  const SHOWCASE = join(SERVER_DIR, "showcase.sh").replaceAll("\\", "/");
  // docker logs every call; `compose ... config` prints CONFIG_OUT, `image ls` prints IMAGE_TAGS,
  // `compose ... exec` prints a dump of 6000 bytes.
  const DOCKER = [
    'printf \'%s\\n\' "$*" >>"$DOCKER_LOG"',
    'case "$*" in',
    '  *" config"*) printf \'%s\\n\' "${CONFIG_OUT:-}" ;;',
    "  \"image ls\"*) printf '%s\\n' $IMAGE_TAGS ;;",
    "  *\" exec \"*) printf PGDMP; head -c 6000 /dev/zero | tr '\\0' x ;;",
    "esac",
  ].join("\n");
  const AGE_MUST_NOT_RUN = 'echo "age must not run in the showcase" >&2; exit 9\n';

  function runShowcase(script: string, env: Record<string, string> = {}): Run & { log: string } {
    const box = sandbox("");
    const data = `${box.root}/data`;
    const log = `${box.root}/docker.log`;

    execFileSync(bash ?? "bash", [
      "-c",
      'mkdir -p "$0" && : >"$0/secrets.env" && : >"$0/pg-bootstrap" && : >"$1/overlay.yaml" && : >"$2"',
      data,
      box.root,
      log,
    ]);

    const result = runLib(`. "${REMOTE}"; . "${SHOWCASE}"; ${WITH_STUBS} ${script}`, {
      KZ_TARGET: "showcase",
      KZ_ROOT: box.root,
      KZ_RUN: box.run,
      KZ_PROJECT: "krajozbior-rehearsal",
      KZ_SHOWCASE_DATA: data,
      KZ_SHOWCASE_PORT: "3310",
      KZ_SHOWCASE_OVERLAY: `${box.root}/overlay.yaml`,
      KZ_PGDATA_VOLUME: "krajozbior-rehearsal-pgdata",
      KZ_IMAGE_REPOS: "krajozbior-rehearsal-app krajozbior-rehearsal-ops",
      KZ_DUMP_SUFFIX: "dump",
      DOCKER_LOG: log,
      STUB_BIN: stubBin({ docker: DOCKER, age: AGE_MUST_NOT_RUN }),
      ...env,
    });

    return { ...result, log: readFileSync(log, "utf8") };
  }

  bashIt("refuses to run without the showcase target or with the server project", () => {
    for (const env of [{ KZ_TARGET: "" }, { KZ_PROJECT: "krajozbior" }] as Record<
      string,
      string
    >[]) {
      const result = runShowcase("kz_require_deploy; echo started", env);

      expect(result.status, JSON.stringify(env)).toBe(1);
      expect(result.stdout).not.toContain("started");
    }
  });

  bashIt("refuses a server folder as the deployment root", () => {
    const result = runShowcase("kz_require_showcase; echo started", { KZ_ROOT: "/srv/krajozbior" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("folder serwera");
  });

  bashIt("checks the demo flags in the server file alone, without the showcase overlay", () => {
    const clean = runShowcase("kz_assert_no_demo_flags", { CONFIG_OUT: "services: {}" });

    expect(clean.status, clean.stdout).toBe(0);
    expect(clean.log).toContain("/deploy/compose.yaml --profile ops config");
    expect(clean.log).not.toContain("compose.showcase");

    const leaked = runShowcase("kz_assert_no_demo_flags", {
      CONFIG_OUT: "ALLOW_DEMO_SEED: '1'",
    });

    expect(leaked.status).toBe(1);
    expect(leaked.stdout).toContain(
      "flaga demo w deploy/compose.yaml (plik serwera): ALLOW_DEMO_SEED",
    );
  });

  bashIt(
    "runs Compose with the showcase overlay, the target overlay and the showcase secrets",
    () => {
      const result = runShowcase("kz_compose ps");

      expect(result.status, result.stdout).toBe(0);
      expect(result.log).toMatch(
        /^compose -p krajozbior-rehearsal -f \S+\/deploy\/compose\.yaml -f \S+\/deploy\/compose\.showcase\.yaml -f \S+\/overlay\.yaml --env-file \S+\/data\/secrets\.env ps$/m,
      );
      expect(result.log).not.toContain("compose.init.yaml");
    },
  );

  bashIt("backs up with pg_dump only (no age), under the same rotation", () => {
    const result = runShowcase('kz_require_deploy && kz_backup predeploy && ls "$KZ_BACKUPS"');

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/krajozbior-\d{8}-\d{6}-predeploy\.dump$/m);
    expect(result.stdout).not.toContain("age must not run");
    expect(result.log).toContain("exec -T -u postgres db pg_dump -Fc -d krajozbior");
  });

  bashIt("keeps the current, the previous and the showcase's own `local` image", () => {
    const result = runShowcase("kz_prune_images aaaaaaaaaaaa bbbbbbbbbbbb", {
      IMAGE_TAGS: "aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc local",
    });

    expect(result.status, result.stdout).toBe(0);
    expect(result.log).toContain("image rm krajozbior-rehearsal-app:cccccccccccc");
    expect(result.log).toContain("image rm krajozbior-rehearsal-ops:cccccccccccc");
    expect(result.log).not.toMatch(/image rm \S+:(aaaaaaaaaaaa|bbbbbbbbbbbb|local)$/m);
  });

  // E7-R2b: mode aktualnosci runs unchanged on the showcase; only the target arguments differ and
  // the mount reaches Docker untouched by the path conversion of Git Bash.
  const NEWS_FILE = '{"id":"1","title":"Zamki"}\n';
  const NEWS_NAME = "aktualnosci-proba.ndjson";
  const newsEnv = (phase: string) => ({
    KZ_IMPORT_PHASE: phase,
    KZ_IMPORT_NAME: NEWS_NAME,
    KZ_IMPORT_SHA256: createHash("sha256").update(NEWS_FILE).digest("hex"),
    KZ_IMPORT_B64: Buffer.from(NEWS_FILE).toString("base64"),
    KZ_REASON: `Publikacja aktualnosci z pliku ${NEWS_NAME}`,
  });
  const NEWS_DOCKER = [
    'printf \'conv=%s\\n\' "${MSYS2_ARG_CONV_EXCL:-}" >>"$DOCKER_LOG"',
    'printf \'%s\\n\' "$*" >>"$DOCKER_LOG"',
    'case "$*" in *" run "*) echo "ops-output" ;; esac',
  ].join("\n");
  const NEWS_READY = [
    'kz_state_set initialized x; kz_state_set current-tag "aaaaaaaaaaaa"',
    'mkdir -p "$KZ_SRC/scripts"; echo \'"news:import"\' >"$KZ_SRC/package.json"',
    'echo "--confirm-host" >"$KZ_SRC/scripts/news-import.ts"',
    "trap kz_cleanup EXIT",
  ].join("\n");

  for (const [phase, flags] of [
    ["preview", "--dry-run"],
    ["apply", `--operator wlasciciel --reason Publikacja aktualnosci z pliku ${NEWS_NAME}`],
  ] as const) {
    bashIt(`aktualnosci (${phase}): the command gets the file and no server arguments`, () => {
      const result = runShowcase(`${NEWS_READY}\nkz_mode_aktualnosci`, {
        ...newsEnv(phase),
        STUB_BIN: stubBin({ docker: NEWS_DOCKER, age: AGE_MUST_NOT_RUN }),
      });

      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).toContain("ops-output");
      expect(result.log).toMatch(
        new RegExp(
          `run --rm -T -v \\S*/imports/run-[0-9-]+:/imports:ro ops npm run --silent news:import -- --file /imports/${NEWS_NAME} ${flags}$`,
          "m",
        ),
      );
      expect(result.log).not.toContain("--target");
      expect(result.log).not.toContain("--confirm-host");
      // Git Bash must leave `-v C:/folder:/imports:ro` as it is.
      expect(result.log).toMatch(/^conv=\*$/m);
      expect(result.stdout).toContain("plik usuniety z serwera");
    });
  }

  bashIt(
    "aktualnosci: the target arguments of the showcase are empty, the server's are not",
    () => {
      const showcase = runShowcase('printf "[%s]" "$(kz_news_target_args)"');
      const server = runLib(`. "${REMOTE}"; kz_news_target_args`, {
        KZ_SITE_HOST: "krajozbior.example",
      });

      expect(showcase.stdout).toBe("[]");
      expect(server.stdout.trim()).toBe("--target server --confirm-host krajozbior.example");
    },
  );

  bashIt("reuses an existing showcase volume and never removes it", () => {
    const result = runShowcase("kz_initial_database");

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("wolumen krajozbior-rehearsal-pgdata istnieje: zostaje");
    expect(result.log).not.toContain("volume rm");
  });
});
