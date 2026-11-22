import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAuthEnv, parseOpsEnv, parseServerEnv } from "@/lib/config/env";

// The variables of the operator file (ops.env) per command. The `ops` container runs with
// NODE_ENV=production (deploy/compose.yaml), so this set must satisfy the production rules of
// parseAuthEnv. It MUST match the lists in docs/deployment.md ("Co ma zawierać plik operatora"):
// the last test compares them, so a change in only one place fails in CI.
const OPERATOR_VARIABLES = {
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
} as const;

// `catalog:import --target server` (F-K6, run by `wdroz.ps1 -Import`): the load goes through the
// app role (DATABASE_URL), the audit and the curator lookup through the ops role, and the host to
// confirm comes from BETTER_AUTH_URL. It reads no sign-in settings (no parseAuthEnv).
const CATALOG_IMPORT_VARIABLES = ["DATABASE_URL", "DATABASE_OPS_URL", "BETTER_AUTH_URL"] as const;

// `photos:fetch` (E4-2z, run by `wdroz.ps1 -Zdjecia`): ops role (DATABASE_OPS_URL) and the site
// address for the User-Agent (BETTER_AUTH_URL). MEDIA_ROOT comes from `environment:` of the `ops`
// service, not from ops.env.
const PHOTOS_FETCH_VARIABLES = ["DATABASE_OPS_URL", "BETTER_AUTH_URL"] as const;

const DOCUMENTED_VARIABLES: Record<string, readonly string[]> = {
  ...OPERATOR_VARIABLES,
  "catalog:import": CATALOG_IMPORT_VARIABLES,
  "photos:fetch": PHOTOS_FETCH_VARIABLES,
};

// Dummy values, only for this test.
const DUMMY_VALUES: Record<string, string> = {
  DATABASE_URL: "postgres://app:dummy@db:5432/krajozbior",
  DATABASE_OPS_URL: "postgres://ops:dummy@db:5432/krajozbior",
  DATABASE_AUTH_URL: "postgres://auth:dummy@db:5432/krajozbior",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://krajozbior.example.com",
  AUTH_CLIENT_IP_HEADER: "x-real-ip",
};

function productionEnv(names: readonly string[]): Record<string, string> {
  return {
    NODE_ENV: "production",
    ...Object.fromEntries(names.map((name) => [name, DUMMY_VALUES[name]])),
  };
}

describe("operator file variables (NODE_ENV=production)", () => {
  it.each(Object.entries(OPERATOR_VARIABLES))(
    "%s: the documented set is enough for the sign-in settings",
    (_command, names) => {
      expect(() => parseAuthEnv(productionEnv(names))).not.toThrow();
    },
  );

  it.each(Object.entries(OPERATOR_VARIABLES))(
    "%s: dropping any documented sign-in variable makes the command refuse",
    (_command, names) => {
      for (const name of names.filter((variable) => variable !== "DATABASE_OPS_URL")) {
        const without = names.filter((variable) => variable !== name);

        expect(() => parseAuthEnv(productionEnv(without)), name).toThrow(name);
      }
    },
  );

  it("auth:create-admin: the documented set also satisfies the operator role settings", () => {
    expect(() => parseOpsEnv(productionEnv(OPERATOR_VARIABLES["auth:create-admin"]))).not.toThrow();
  });

  it("catalog:import: the documented set satisfies both database settings", () => {
    const env = productionEnv(CATALOG_IMPORT_VARIABLES);

    expect(() => parseServerEnv(env)).not.toThrow();
    expect(() => parseOpsEnv(env)).not.toThrow();
    expect(new URL(env.BETTER_AUTH_URL ?? "").hostname).toBe("krajozbior.example.com");
  });

  it("catalog:import: dropping a database variable makes the command refuse with its name", () => {
    const withoutApp = productionEnv(CATALOG_IMPORT_VARIABLES.filter((n) => n !== "DATABASE_URL"));
    const withoutOps = productionEnv(
      CATALOG_IMPORT_VARIABLES.filter((n) => n !== "DATABASE_OPS_URL"),
    );

    expect(() => parseServerEnv(withoutApp)).toThrow("DATABASE_URL");
    expect(() => parseOpsEnv(withoutOps)).toThrow("DATABASE_OPS_URL");
  });

  it("photos:fetch: the documented set satisfies the operator role settings", () => {
    expect(() => parseOpsEnv(productionEnv(PHOTOS_FETCH_VARIABLES))).not.toThrow();
  });

  it("photos:fetch: without DATABASE_OPS_URL the command refuses with its name", () => {
    expect(() =>
      parseOpsEnv(
        productionEnv(PHOTOS_FETCH_VARIABLES.filter((name) => name !== "DATABASE_OPS_URL")),
      ),
    ).toThrow("DATABASE_OPS_URL");
  });

  it("matches the lists in docs/deployment.md and in lib.sh", () => {
    const doc = readFileSync(resolve(process.cwd(), "docs/deployment.md"), "utf8");
    const lib = readFileSync(resolve(process.cwd(), "scripts/ops/server/lib.sh"), "utf8");

    expect(lib).toContain(`catalog:import) echo "${CATALOG_IMPORT_VARIABLES.join(" ")}" ;;`);

    expect(lib).toContain(`photos:fetch) echo "${PHOTOS_FETCH_VARIABLES.join(" ")}" ;;`);

    for (const [command, names] of Object.entries(DOCUMENTED_VARIABLES)) {
      const line = doc.split("\n").find((row) => row.trimStart().startsWith(`- \`${command}\`:`));

      expect(line, command).toBeDefined();

      const documented = [...(line ?? "").matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(
        (match) => match[1],
      );

      expect(documented.sort(), command).toEqual([...names].sort());
    }
  });
});
