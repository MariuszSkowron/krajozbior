import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findKeyReferences, globReachesKey } from "../../.claude/hooks/block-key-read.mjs";

// The Claude Code hook that refuses any shell command naming the private key of
// the project's GitHub App (`*.pem`) or its folder (`~/.config/<app-slug>/`).
// The process tests run the real script with a hook event on stdin, as Claude
// Code does: exit 2 blocks, exit 0 lets it through.
const script = fileURLToPath(new URL("../../.claude/hooks/block-key-read.mjs", import.meta.url));

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
  // Readers of a .pem file, Bash and PowerShell.
  "cat key.pem",
  "cat ~/.config/demo-bot/demo-bot.2026-11-17.private-key.pem",
  "type C:\\Users\\jan\\.config\\demo-bot\\app.pem",
  "Get-Content $env:USERPROFILE\\.config\\demo-bot\\app.PEM",
  "gc app.pem",
  "copy app.pem C:\\temp\\x.txt",
  "Copy-Item app.pem out.txt",
  "cp app.pem /tmp/x",
  "Select-String KEY app.pem",
  "certutil -encode app.pem out.b64",
  `node -e "console.log(require('fs').readFileSync('app.pem','utf8'))"`,
  "openssl rsa -in app.pem -text",
  // The key folder, without naming the file.
  "ls ~/.config/demo-bot",
  "Get-ChildItem $env:USERPROFILE\\.config\\demo-bot",
  "dir %USERPROFILE%\\.config\\demo-bot\\",
  "cat ~/.config/demo-bot/*",
  "Get-ChildItem ~/.config -Recurse | Get-Content",
  "icacls C:\\Users\\jan\\.config\\demo-bot",
  // Globs that reach a key or the folder.
  "cat *.pem",
  "cat ~/x/*.p?m",
  "cat *.[p]em",
  "cat *.{pem,txt}",
  "cat ~/.c*/demo-bot/x",
  "Get-ChildItem $HOME/*/demo-bot",
  "cat C:\\Users\\jan\\.co?fig\\x",
  // Spellings a shell turns into the same name.
  'cat "app.pem"',
  "cat app.p`em",
  'cat app.p""em',
  "cat app.p\\em",
];

const allowed = [
  "powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1",
  "pwsh -File scripts/bot-token.ps1 -DryRun",
  "npx vitest run tests/scripts",
  "cat vitest.config.mts",
  "cat eslint.config.mjs",
  "cat tsconfig.json",
  "cat next.config.ts",
  "cat .github/bot.json",
  "ls src/*",
  "ls src/*/domain",
  "git diff -- '*.ts'",
  "rg pemberton src",
  "cat docs/pem-notes.md.txt",
  "git status",
];

describe("findKeyReferences", () => {
  it.each(blocked)("blocks: %s", (command) => {
    expect(findKeyReferences(command).length).toBeGreaterThan(0);
  });

  it.each(allowed)("allows: %s", (command) => {
    expect(findKeyReferences(command)).toEqual([]);
  });

  it("ignores a command that is not a string", () => {
    expect(findKeyReferences(undefined)).toEqual([]);
    expect(findKeyReferences(42)).toEqual([]);
  });
});

describe("globReachesKey", () => {
  it("treats a plain wildcard in a project folder as not aimed at keys", () => {
    expect(globReachesKey("src/*")).toBe(false);
    expect(globReachesKey("*.*")).toBe(false);
  });

  it("catches a home glob that can match .config", () => {
    expect(globReachesKey("~/*/x")).toBe(true);
    expect(globReachesKey("~/src/*.ts")).toBe(false);
  });
});

describe("block-key-read hook (real process)", () => {
  it("blocks a PowerShell read of the key folder with exit 2 and a reason", () => {
    const result = runHook(
      shellEvent("PowerShell", "Get-Content $env:USERPROFILE\\.config\\demo-bot\\a.pem"),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("scripts/bot-token.ps1");
    expect(result.stderr).toContain("security-notes.md");
  });

  it("lets the token script through", () => {
    expect(
      runHook(
        shellEvent("PowerShell", "powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1"),
      ).status,
    ).toBe(0);
  });

  it("lets an event without a command through", () => {
    expect(runHook({ tool_name: "Bash", tool_input: {} }).status).toBe(0);
  });

  it("exits 1 for a malformed event (a hook bug, not a block)", () => {
    expect(runHook("not json").status).toBe(1);
  });
});
