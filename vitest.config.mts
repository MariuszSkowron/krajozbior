import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${fromRoot("./src")}/` },
      // `server-only` throws outside the React Server Components runtime.
      { find: /^server-only$/, replacement: fromRoot("./tests/support/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    coverage: {
      provider: "v8",
      include: ["src/features/**/domain/**/*.ts"],
      exclude: ["src/features/**/domain/**/*.d.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
        perFile: true,
      },
    },
  },
});
