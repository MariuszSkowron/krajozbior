import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${fromRoot("./src")}/` },
      { find: /^server-only$/, replacement: fromRoot("./tests/support/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: configDefaults.exclude,
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
