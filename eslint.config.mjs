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
  // Ręczne escapowanie przed budową wyrażenia regularnego: CodeQL zgłasza
  // "incomplete string escaping" (e2e/home.spec.ts, e2e/nearby.spec.ts).
  {
    files: ["src/**", "e2e/**", "tests/**", "scripts/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.name='RegExp'] > CallExpression.arguments:first-child[callee.property.name=/^replace(All)?$/]",
          message:
            "Nie buduj RegExp z wyniku .replace(): ręczne escapowanie łatwo pominąć znak (CodeQL: incomplete string escaping). Użyj dopasowania tekstowego (Playwright: ciąg znaków zamiast wyrażenia, string.includes) albo helpera, który escapuje wszystkie znaki specjalne.",
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
