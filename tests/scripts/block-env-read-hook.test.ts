import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

// Testy uruchamiają proces `node` (przy obciążonym komputerze ponad 5 s); limit tylko dla tego pliku.
vi.setConfig({ testTimeout: 30_000 });

import { findEnvReferences, referencesEnvFile } from "../../.claude/hooks/block-env-read.mjs";

// The Claude Code hook that refuses any shell command mentioning a `.env` file
// (security-notes.md, section 1). The process tests run the real script with a
// hook event on stdin, as Claude Code does: exit 2 blocks, exit 0 lets it through.
const script = fileURLToPath(new URL("../../.claude/hooks/block-env-read.mjs", import.meta.url));

function runHook(event: unknown) {
  const result = spawnSync(process.execPath, [script], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

const shellEvent = (tool_name: "Bash" | "PowerShell", command: string) => ({
  tool_name,
  tool_input: { command },
});

const blocked = [
  "cat .env",
  "cat .env.local",
  "head -n 5 .env",
  "tail -f .env.production",
  "type .env",
  "more .env.local",
  "less .env",
  "sed -n 1,5p .env",
  "awk '{print}' .env",
  "grep PASSWORD .env",
  "cp .env /tmp/leak",
  "cp .env.local out.txt",
  "Get-Content .env",
  "Get-Content .\\.env.local",
  'gc ".env"',
  "Select-String PASSWORD .env",
  "copy .env somewhere.txt",
  "cat ./config/.env",
  "cat C:\\project\\.env.production",
  "cat ~/.env",
  "source .env && echo $SECRET",
  `node -e "console.log(require('fs').readFileSync('.env','utf8'))"`,
  "cat .ENV",
  "cat .env*",
  "cat .e*",
  "cat .ai/qa/test-env.env",
  "cat .env.example .env",
  "cp .env.example .env",
  // Wildcards that expand to .env (L1).
  "cat *env",
  "cat ?env",
  "cat .[e]nv",
  "cat .e?v",
  "cat .{e,x}nv",
  "cat .env.bak*",
  "cat .*",
  "Get-Content *",
  "Get-Content .\\*",
  "Get-ChildItem -Filter *env | Get-Content",
  // Spellings a shell turns into .env.
  'cat .e""nv',
  "cat .e`nv",
  "cat .e\\nv",
  "cat .e\\\nnv",
];

const allowed = [
  "cat .env.example",
  "Get-Content .env.example",
  "head .env.example",
  "git add .env.example",
  "git show HEAD:.env.example",
  "ls src/*",
  "git diff -- '*.ts'",
  "npx vitest run tests/**/*.test.ts",
  'rg "foo.*bar" src',
  "npm run check",
  'node -e "console.log(process.env.NODE_ENV)"',
  "echo $env:DATABASE_URL",
  "cat environment.md",
  "cat .environment",
  "cat my-app.env.md",
  "git status",
  "ls -la",
];

describe("findEnvReferences", () => {
  it.each(blocked)("blocks: %s", (command) => {
    expect(referencesEnvFile(command)).toBe(true);
  });

  it.each(allowed)("allows: %s", (command) => {
    expect(referencesEnvFile(command)).toBe(false);
  });

  it("names the offending file and ignores the allowed one in the same command", () => {
    expect(findEnvReferences("cp .env.example .env.local")).toEqual([".env.local"]);
  });

  it("ignores a command that is not a string", () => {
    expect(findEnvReferences(undefined)).toEqual([]);
    expect(findEnvReferences(42)).toEqual([]);
  });
});

describe("block-env-read hook (real process)", () => {
  it("blocks a Bash command that reads .env with exit 2 and a reason", () => {
    const result = runHook(shellEvent("Bash", "head -n 3 .env"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("security-notes.md");
    expect(result.stderr).toContain(".env.example");
  });

  it("blocks a PowerShell command that reads .env.local", () => {
    expect(runHook(shellEvent("PowerShell", "Get-Content .env.local")).status).toBe(2);
  });

  it("lets .env.example through", () => {
    expect(runHook(shellEvent("Bash", "cat .env.example")).status).toBe(0);
  });

  it("lets an unrelated command through", () => {
    expect(runHook(shellEvent("PowerShell", "npm run lint")).status).toBe(0);
  });

  it("lets an event without a command through", () => {
    expect(runHook({ tool_name: "Bash", tool_input: {} }).status).toBe(0);
  });

  it("exits 1 for a malformed event (a hook bug, not a block)", () => {
    expect(runHook("not json").status).toBe(1);
  });
});
