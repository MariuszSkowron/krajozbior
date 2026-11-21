import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAuthEnv, parseOpsEnv } from "@/lib/config/env";

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

// Dummy values, only for this test.
const DUMMY_VALUES: Record<string, string> = {
  DATABASE_OPS_URL: "postgres://ops:dummy@db:5432/krajozbior",
  DATABASE_AUTH_URL: "postgres://auth:dummy@db:5432/krajozbior",
  BETTER_AUTH_SECRET: "dummy-secret-for-the-test-0123456789abcdef",
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

  it("matches the lists in docs/deployment.md", () => {
    const doc = readFileSync(resolve(process.cwd(), "docs/deployment.md"), "utf8");

    for (const [command, names] of Object.entries(OPERATOR_VARIABLES)) {
      const line = doc.split("\n").find((row) => row.trimStart().startsWith(`- \`${command}\`:`));

      expect(line, command).toBeDefined();

      const documented = [...(line ?? "").matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(
        (match) => match[1],
      );

      expect(documented.sort(), command).toEqual([...names].sort());
    }
  });
});
