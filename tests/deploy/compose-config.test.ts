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

const dockerComposeIt = it.skipIf(!composeAvailable());

function composeConfig(files: string[], extra: string[] = [], envFile?: string): ComposeConfig {
  const args = ["compose", ...files.flatMap((file) => ["-f", file]), ...extra];

  if (envFile !== undefined) {
    args.splice(1, 0, "--env-file", envFile);
  }

  const output = execFileSync("docker", [...args, "config", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, COMPOSE_PROJECT_NAME: "" },
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

  it("gives the database superuser password as a file, not as an environment variable", () => {
    const compose = read("deploy/compose.yaml");

    expect(compose).toContain("POSTGRES_PASSWORD_FILE");
    expect(compose).not.toMatch(/^\s*POSTGRES_PASSWORD:/m);
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

  it("leaves secrets and local data out of the build context", () => {
    const ignore = read(".dockerignore");

    expect(ignore).toMatch(/^\*$/m);
    expect(ignore).toContain("**/.env*");
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(dockerfile).not.toMatch(/COPY \.\s/);
  });
});
