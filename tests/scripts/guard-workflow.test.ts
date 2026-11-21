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
      "docs/security-notes.md",
      "x/Security-Notes.md",
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
      // Public version in the root only; its content is checked separately.
      "security-notes.md",
    ];

    expect(privatePaths(allowed)).toEqual([]);
  });

  const notesStart = workflow.indexOf("public_notes_ok() {");
  const notesEnd = workflow.indexOf("\n          }\n", notesStart);
  const notesFn = workflow
    .slice(notesStart, notesEnd + "\n          }\n".length)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");

  function notesAccepted(text: string): boolean {
    const result = spawnSync("bash", ["-c", `${notesFn}\npublic_notes_ok`], {
      input: text,
      encoding: "utf8",
    });

    return result.status === 0;
  }

  it.skipIf(!hasBash)("accepts only the marked public security notes", () => {
    const marker = "<!-- security-notes: wersja publiczna -->";

    expect(notesStart).toBeGreaterThan(0);
    expect(notesAccepted(`${marker}\n\n# Notatki bezpieczeństwa\n`)).toBe(true);
    // A copy of the private notes: no marker, or its opening sentence.
    expect(notesAccepted("# Notatki bezpieczeństwa\n")).toBe(false);
    expect(notesAccepted(`${marker}\nTen plik jest prywatny, bo opisuje ograniczenia.\n`)).toBe(
      false,
    );
  });

  it.skipIf(!hasBash)(
    "accepts the marker only as the very first line of the file",
    () => {
      const marker = "<!-- security-notes: wersja publiczna -->";

      // Rejected: marker at the end, quoted in a sentence, in the second line.
      expect(notesAccepted(`# Notatki\n\nTreść.\n\n${marker}\n`)).toBe(false);
      expect(
        notesAccepted(`# Notatki\n\nWersja publiczna ma znacznik ${marker} w pierwszej linii.\n`),
      ).toBe(false);
      expect(notesAccepted(`# Notatki\n${marker}\n\nTreść.\n`)).toBe(false);
      expect(notesAccepted(`Wstęp ${marker}\n`)).toBe(false);
      expect(notesAccepted(`\n${marker}\n`)).toBe(false);
      // Accepted: first line, also with CRLF line ends or a BOM.
      expect(notesAccepted(`${marker}\n# Notatki\n`)).toBe(true);
      expect(notesAccepted(`${marker}\r\n# Notatki\r\n`)).toBe(true);
      expect(notesAccepted(`﻿${marker}\n# Notatki\n`)).toBe(true);
    },
    30_000,
  );

  it("checks the content of the root security notes in the tree and in every commit", () => {
    expect(workflow).toMatch(/check_notes "" "\$file"/);
    expect(workflow).toMatch(/check_notes "\$commit" "\$file"/);
  });

  it("the public security notes in the root pass the content check", () => {
    const notes = readFileSync(
      fileURLToPath(new URL("../../security-notes.md", import.meta.url)),
      "utf8",
    );

    expect(notes.replace(/^﻿/, "").split(/\r?\n/)[0]).toBe(
      "<!-- security-notes: wersja publiczna -->",
    );
    expect(notes.toLowerCase()).not.toContain("ten plik jest prywatny");
  });
});
