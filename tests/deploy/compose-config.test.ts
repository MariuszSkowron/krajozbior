import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// F-K1 (E11, D-E11-1, D-E11-5, D-E11-8): the configuration of the server and of the local
// showcase is checked as files (always) and as the result of `docker compose config` (when
// Docker Compose is installed). Nothing here starts a container.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const DEMO_FLAGS = ["ALLOW_DEMO_SEED", "DEMO_ACCOUNTS_TEST_ONLY", "EMAIL_OUTBOX_TEST_ONLY"];

// What only the operator container may get: never the process exposed to the internet (D-21).
const OPERATOR_VARIABLES = [
  "DATABASE_MIGRATION_URL",
  "DATABASE_OPS_URL",
  "DATABASE_ADMIN_URL",
  "KRAJOZBIOR_OWNER_DB_PASSWORD",
  "KRAJOZBIOR_OPS_DB_PASSWORD",
];

// Ports and names that belong to the owner's environment and to scripts/test-env/.
const FORBIDDEN_HOST_PORTS = ["3000", "3100", "5432", "55432", "55433"];

type ComposeService = {
  restart?: string;
  logging?: { driver?: string; options?: Record<string, string> };
  ports?: { published?: string; host_ip?: string; target?: number }[];
  container_name?: string;
  command?: string[];
  environment?: Record<string, string>;
  network_mode?: string;
  mem_limit?: string;
};
type ComposeConfig = {
  name: string;
  services: Record<string, ComposeService>;
  networks?: Record<string, { name?: string }>;
  volumes?: Record<string, { name?: string }>;
};

function composeAvailable(): boolean {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
}

// Without Docker Compose the tests that need it are skipped locally (with a message), but in CI
// (`CI=true`) they run and fail when Compose is missing, so they never disappear silently.
const composeInstalled = composeAvailable();
const requireCompose = process.env.CI === "true";

if (!composeInstalled && !requireCompose) {
  console.warn(
    "tests/deploy: Docker Compose is not installed, so the tests of the merged configuration are skipped.",
  );
}

const dockerComposeIt = it.skipIf(!composeInstalled && !requireCompose);

function composeConfig(
  files: string[],
  extra: string[] = [],
  envFile?: string,
  variables: Record<string, string> = {},
): ComposeConfig {
  const args = ["compose", ...files.flatMap((file) => ["-f", file]), ...extra];

  if (envFile !== undefined) {
    args.splice(1, 0, "--env-file", envFile);
  }

  const output = execFileSync("docker", [...args, "config", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, COMPOSE_PROJECT_NAME: "", ...variables },
  });

  return JSON.parse(output) as ComposeConfig;
}

function dummySecretsFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "krajozbior-showcase-test-"));
  const file = join(directory, "secrets");
  const lines = [
    "SHOWCASE_PG_PASSWORD",
    "KRAJOZBIOR_OWNER_DB_PASSWORD",
    "KRAJOZBIOR_APP_DB_PASSWORD",
    "KRAJOZBIOR_AUTH_DB_PASSWORD",
    "KRAJOZBIOR_OPS_DB_PASSWORD",
    "BETTER_AUTH_SECRET",
    "DEMO_ACCOUNT_PASSWORD",
  ].map((name) => `${name}=dummy-value-for-config-test`);

  writeFileSync(file, `${lines.join("\n")}\n`);

  return file;
}

const SERVER = ["deploy/compose.yaml"];
const SHOWCASE = ["deploy/compose.yaml", "deploy/compose.showcase.yaml"];

describe("server configuration (deploy/compose.yaml)", () => {
  dockerComposeIt("publishes ports only for the proxy", () => {
    const config = composeConfig(SERVER, ["--profile", "ops"]);

    for (const [name, service] of Object.entries(config.services)) {
      if (name === "proxy") {
        expect((service.ports ?? []).map((port) => port.published).sort()).toEqual([
          "443",
          "443",
          "80",
        ]);
      } else {
        expect(service.ports ?? [], `service ${name}`).toEqual([]);
      }
    }
  });

  dockerComposeIt("restarts every service and logs it to journald", () => {
    const config = composeConfig(SERVER, ["--profile", "ops"]);

    expect(Object.keys(config.services).sort()).toEqual(["app", "db", "ops", "proxy"]);

    for (const [name, service] of Object.entries(config.services)) {
      expect(service.restart, `service ${name}`).toBe("unless-stopped");
      expect(service.logging?.driver, `service ${name}`).toBe("journald");
    }
  });

  dockerComposeIt("starts the database with the log settings without personal data", () => {
    const command = composeConfig(SERVER).services.db!.command ?? [];

    for (const setting of [
      // MikroORM inlines values into the query text, so a failing query must not be logged (DB-5).
      "log_min_error_statement=panic",
      "log_statement=none",
      "log_min_duration_statement=-1",
      "log_parameter_max_length=0",
      "log_parameter_max_length_on_error=0",
      "log_error_verbosity=terse",
      "log_connections=off",
      "log_disconnections=off",
    ]) {
      expect(command, setting).toContain(setting);
    }
  });

  dockerComposeIt("knows none of the demo flags", () => {
    const output = execFileSync(
      "docker",
      ["compose", "-f", "deploy/compose.yaml", "--profile", "ops", "config"],
      { cwd: root, encoding: "utf8" },
    );

    for (const flag of DEMO_FLAGS) {
      expect(output, flag).not.toContain(flag);
    }
  });

  it("keeps the demo flags out of the shared files", () => {
    for (const file of ["deploy/compose.yaml", "Dockerfile", "deploy/Caddyfile"]) {
      for (const flag of DEMO_FLAGS) {
        expect(read(file), `${file} ${flag}`).not.toContain(flag);
      }
    }
  });

  it("limits the size of a request body in Caddy (SEC-2)", () => {
    expect(read("deploy/Caddyfile")).toMatch(/request_body \{\s*max_size 1MB\s*\}/);
  });

  it("gives the database superuser password as a file, not as an environment variable", () => {
    const compose = read("deploy/compose.yaml");

    expect(compose).toContain("POSTGRES_PASSWORD_FILE");
    expect(compose).not.toMatch(/^\s*POSTGRES_PASSWORD:/m);
  });

  it("pins the database image by digest", () => {
    expect(read("deploy/compose.yaml")).toMatch(/image: postgres:17@sha256:[0-9a-f]{64}/);
  });

  it("initialises the database without trust authentication (M2)", () => {
    expect(read("deploy/compose.yaml")).toMatch(
      /POSTGRES_INITDB_ARGS: "--auth-local=peer --auth-host=scram-sha-256"/,
    );
  });

  it("never shares the network of the database with another service (M1)", () => {
    expect(read("deploy/compose.yaml")).not.toContain("network_mode");
  });

  dockerComposeIt("keeps network_mode out of the merged server configuration (M1)", () => {
    const config = composeConfig(SERVER, ["--profile", "ops"]);

    for (const [name, service] of Object.entries(config.services)) {
      expect(service.network_mode, `service ${name}`).toBeUndefined();
    }
  });

  dockerComposeIt("starts the operator container in production mode (M1)", () => {
    const config = composeConfig(SERVER, ["--profile", "ops"]);

    expect(config.services.ops?.environment?.NODE_ENV).toBe("production");
  });

  dockerComposeIt("starts the database with scram authentication (M2)", () => {
    const environment = composeConfig(SERVER).services.db?.environment ?? {};

    expect(environment.POSTGRES_INITDB_ARGS).toBe("--auth-local=peer --auth-host=scram-sha-256");
  });

  dockerComposeIt("caps the memory of the application container", () => {
    const config = composeConfig(SERVER);

    expect(config.services.app?.mem_limit).toBe("1073741824");
  });

  it("gives the application and the operator separate variable files", () => {
    const compose = read("deploy/compose.yaml");

    expect(compose).toContain("path: ${KRAJOZBIOR_ENV_FILE:-/srv/krajozbior/.env.production}");
    expect(compose).toContain("path: ${KRAJOZBIOR_OPS_ENV_FILE:-/run/krajozbior/ops.env}");
    // Only the application reads the server file of the application.
    expect(compose.match(/\.env\.production\}/g)).toHaveLength(1);
  });

  dockerComposeIt("keeps the owner and ops role variables out of the application", () => {
    const directory = mkdtempSync(join(tmpdir(), "krajozbior-compose-vars-"));
    const appFile = join(directory, "app-vars");
    const opsFile = join(directory, "ops-vars");

    writeFileSync(appFile, "BETTER_AUTH_SECRET=app-secret\nDATABASE_URL=postgres://app\n");
    // The operator commands `auth:create-admin` and `auth:throttle` need the session secret
    // (the same value as the application's in production), so the operator file carries it.
    writeFileSync(
      opsFile,
      [
        ...OPERATOR_VARIABLES.map((name) => `${name}=ops-only`),
        "BETTER_AUTH_SECRET=ops-file-secret",
        "",
      ].join("\n"),
    );

    const config = composeConfig(SERVER, ["--profile", "ops"], undefined, {
      KRAJOZBIOR_ENV_FILE: appFile,
      KRAJOZBIOR_OPS_ENV_FILE: opsFile,
    });
    const app = config.services.app?.environment ?? {};
    const ops = config.services.ops?.environment ?? {};

    // Each service reads only its own file.
    expect(app.BETTER_AUTH_SECRET).toBe("app-secret");
    expect(ops.BETTER_AUTH_SECRET).toBe("ops-file-secret");
    expect(ops.DATABASE_URL).toBeUndefined();

    for (const name of OPERATOR_VARIABLES) {
      expect(app[name], name).toBeUndefined();
      expect(ops[name], name).toBe("ops-only");
    }
  });

  dockerComposeIt("does not start the operator container with `up` (profile)", () => {
    const config = composeConfig(SERVER);

    expect(Object.keys(config.services).sort()).toEqual(["app", "db", "proxy"]);
  });
});

describe("local showcase (deploy/compose.showcase.yaml)", () => {
  it("keeps the demo flags in the showcase file only, attached by the overlay", () => {
    const showcaseEnv = read("deploy/showcase.env");

    for (const flag of DEMO_FLAGS) {
      expect(showcaseEnv, flag).toMatch(new RegExp(`^${flag}=1$`, "m"));
    }

    expect(showcaseEnv).not.toMatch(/AUTH_CLIENT_IP_HEADER\s*=/);
    expect(read("deploy/compose.showcase.yaml")).toContain("showcase.env");
  });

  dockerComposeIt("is its own project with its own network, volume and names", () => {
    const config = composeConfig(SHOWCASE, [], dummySecretsFile());

    expect(config.name).toBe("krajozbior-showcase");
    expect(config.networks?.default?.name).toBe("krajozbior-showcase_default");
    expect(config.volumes?.pgdata?.name).toBe("krajozbior-showcase-pgdata");
    expect(config.services.db?.container_name).toBe("krajozbior-showcase-db");
    expect(config.services.app?.container_name).toBe("krajozbior-showcase-app");
    // Caddy is switched off (profile), so only the database and the application run.
    expect(Object.keys(config.services).sort()).toEqual(["app", "db"]);
  });

  dockerComposeIt("publishes only the application, only on 127.0.0.1:3300", () => {
    const config = composeConfig(SHOWCASE, ["--profile", "ops"], dummySecretsFile());

    expect(config.services.app?.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "3300", target: 3000 }),
    ]);
    expect(config.services.db?.ports ?? []).toEqual([]);
    expect(config.services.ops?.ports ?? []).toEqual([]);
    expect(config.services.proxy).toBeUndefined();
  });

  dockerComposeIt("gives the operator container the database as localhost", () => {
    const config = composeConfig(SHOWCASE, ["--profile", "ops"], dummySecretsFile());
    const environment = config.services.ops?.environment ?? {};

    // The guards of catalog:import and the demo seed (a local database only) stay untouched.
    expect(config.services.ops?.network_mode).toBe("service:db");
    // The showcase is the only place that relaxes NODE_ENV, and the only service sharing a network.
    expect(environment.NODE_ENV).toBe("development");

    const sharing = Object.entries(config.services)
      .filter(([, service]) => service.network_mode !== undefined)
      .map(([name]) => name);

    expect(sharing).toEqual(["ops"]);

    for (const name of ["DATABASE_URL", "DATABASE_OPS_URL", "DATABASE_AUTH_URL"]) {
      expect(environment[name], name).toContain("@localhost:5432/");
    }
  });

  dockerComposeIt("uses a log driver available on Windows, with rotation", () => {
    const config = composeConfig(SHOWCASE, ["--profile", "ops"], dummySecretsFile());

    for (const service of Object.values(config.services)) {
      expect(service.logging?.driver).toBe("local");
      expect(service.logging?.options?.["max-size"]).toBeDefined();
    }
  });

  dockerComposeIt("restarts the services it runs", () => {
    const config = composeConfig(SHOWCASE, [], dummySecretsFile());

    for (const service of Object.values(config.services)) {
      expect(service.restart).toBe("unless-stopped");
    }
  });
});

describe("no collision with scripts/test-env and the owner's environment", () => {
  const testEnvDirectory = "scripts/test-env";
  const testEnvFiles = readdirSync(join(root, testEnvDirectory)).map(
    (name) => `${testEnvDirectory}/${name}`,
  );
  const showcaseFiles = [
    "deploy/compose.showcase.yaml",
    "deploy/showcase.env",
    ...readdirSync(join(root, "scripts/showcase")).map((name) => `scripts/showcase/${name}`),
  ];

  it("keeps the test-env scripts free of any showcase name", () => {
    expect(testEnvFiles.length).toBeGreaterThan(0);

    for (const file of testEnvFiles) {
      expect(read(file).toLowerCase(), file).not.toContain("showcase");
    }
  });

  it("keeps the showcase files free of any test-env name", () => {
    for (const file of showcaseFiles) {
      expect(read(file).toLowerCase(), file).not.toMatch(/testenv|test-env/);
    }
  });

  it("publishes no port of the owner's environment on the host", () => {
    for (const file of ["deploy/compose.showcase.yaml", ...showcaseFiles.slice(2)]) {
      const text = read(file);

      for (const port of FORBIDDEN_HOST_PORTS) {
        // A host binding looks like "127.0.0.1:3000:..." or "3000:..."; container-side 3000 is fine.
        expect(text, `${file} ${port}`).not.toMatch(
          new RegExp(`["' ]((127\\.0\\.0\\.1|0\\.0\\.0\\.0):)?${port}:\\d`),
        );
        expect(text, `${file} ${port}`).not.toMatch(new RegExp(`-Port\\s+${port}\\b`));
      }
    }
  });

  it("removes only the showcase volume, by its full name", () => {
    const reset = read("scripts/showcase/showcase-reset.ps1");

    expect(reset).toContain("volume', 'rm', $ShowcaseVolume");
    expect(read("scripts/showcase/showcase-lib.ps1")).toContain(
      "$ShowcaseVolume  = 'krajozbior-showcase-pgdata'",
    );
    expect(reset).not.toMatch(/volume prune|system prune|rm -f \$\(/);
    expect(read("scripts/showcase/showcase-down.ps1")).not.toMatch(/\s-v\b|--volumes/);
  });
});

describe("production image (Dockerfile)", () => {
  const dockerfile = read("Dockerfile");

  it("pins the base image by digest", () => {
    expect(dockerfile).toMatch(/node:22-[a-z0-9-]+@sha256:[0-9a-f]{64}/);
  });

  it("runs the application as a user without root rights", () => {
    const runtime = dockerfile.slice(
      dockerfile.indexOf("AS runtime"),
      dockerfile.indexOf("AS ops"),
    );

    expect(runtime).toMatch(/^USER node$/m);
  });

  it("installs only production dependencies in the runtime image", () => {
    expect(dockerfile).toMatch(/AS prod-deps[\s\S]*npm ci --omit=dev/);
    expect(dockerfile).toMatch(/COPY --from=prod-deps[^\n]*node_modules/);
  });

  it("drops the build cache from the image", () => {
    expect(dockerfile).toContain("rm -rf .next/cache");
  });

  it("leaves secrets and local data out of the build context", () => {
    const ignore = read(".dockerignore");

    expect(ignore).toMatch(/^\*$/m);
    expect(ignore).toContain("**/.env*");
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(dockerfile).not.toMatch(/COPY \.\s/);
  });
});
