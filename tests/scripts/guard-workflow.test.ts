import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The `guard` job (.github/workflows/guard.yml) rejects private files in the
// public repository. The file-name rules live in the bash function
// `is_private`; this test lifts that function out of the workflow and runs it
// in bash, so a change of the rules is checked without a pull request.
const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/guard.yml", import.meta.url)),
  "utf8",
);

const start = workflow.indexOf("is_private() {");
const end = workflow.indexOf("\n          }\n", start);
const fn = workflow
  .slice(start, end + "\n          }\n".length)
  .split("\n")
  .map((line) => line.replace(/^ {10}/, ""))
  .join("\n");

function bashRuns(): boolean {
  const probe = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });

  return probe.status === 0 && probe.stdout.trim() === "ok";
}

const hasBash = bashRuns();

/** The paths (out of `paths`) that `is_private` rejects. */
function privatePaths(paths: string[]): string[] {
  const script = `${fn}\nwhile IFS= read -r p; do if is_private "$p"; then echo "$p"; fi; done`;
  const result = spawnSync("bash", ["-c", script], {
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  return result.stdout.split("\n").filter(Boolean);
}

describe("guard.yml", () => {
  it("lifts the is_private function out of the workflow", () => {
    expect(start).toBeGreaterThan(0);
    expect(fn).toContain("security-notes.md");
    expect(fn.trimEnd().endsWith("}")).toBe(true);
  });

  it("inspects merge commits (git diff-tree -m)", () => {
    expect(workflow).toMatch(/git diff-tree [^\n]*\s-r\s+-m\b/);
  });

  it.skipIf(!hasBash)("rejects private files, also under the public .ai/ folders", () => {
    const rejected = [
      ".ai/skills/.env",
      ".ai/skills/x/.env.local",
      ".ai/trackers/security-notes.md",
      ".ai/browsers/Bootstrap.md",
      ".ai/skills/docs/product.md",
      ".ai/skills/x/.claude/settings.local.json",
      ".ai/specs/a.md",
      ".ai/agentic.config.json.bak/x",
      "security-notes.md",
      "docs/product.md",
      "docs/decisions.md",
      "src/.env",
      ".claude/settings.local.json",
      "notes/x.code-workspace",
    ];

    expect(privatePaths(rejected)).toEqual(rejected);
  });

  it.skipIf(!hasBash)("lets public files through", () => {
    const allowed = [
      ".ai/agentic.config.json",
      ".ai/trackers/github.md",
      ".ai/browsers/playwright.json",
      ".ai/skills/om-x/SKILL.md",
      ".env.example",
      "docs/data-isolation.md",
      "src/app/page.tsx",
      ".claude/settings.json",
      "README.md",
    ];

    expect(privatePaths(allowed)).toEqual([]);
  });
});
