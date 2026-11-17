import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    ".npm/**",
    "playwright-report/**",
    "storybook-static/**",
    "test-results/**",
    "next-env.d.ts",
    // Lokalne worktree, notatki agentów i zainstalowane skille: kopie lub kod spoza aplikacji.
    ".worktrees/**",
    ".claude/worktrees/**",
    ".ai/**",
    ".agents/**",
  ]),
  // EUI jest wyłącznie referencją projektową (docs/design/ui-foundation.md).
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@elastic/*"], message: "EUI jest tylko referencją, nie zależnością." },
          ],
        },
      ],
    },
  },
  // Zależności design systemu idą tylko w dół (docs/design/architecture.md).
  {
    files: ["src/design-system/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@elastic/*"], message: "EUI jest tylko referencją, nie zależnością." },
            {
              group: ["@/app", "@/app/*", "@/features", "@/features/*", "@/lib", "@/lib/*"],
              message: "src/design-system nie importuje z src/app, src/features ani src/lib.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
