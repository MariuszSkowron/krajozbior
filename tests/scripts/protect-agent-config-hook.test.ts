import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findAgentConfigWrites } from "../../.claude/hooks/protect-agent-config.mjs";

// The Claude Code hook that keeps the agent from changing its own settings,
// hooks and skills in `.claude/` from the shell (the Edit/Write tools are
// covered by `deny` rules in .claude/settings.json). The process tests run the
// real script with a hook event on stdin: exit 2 blocks, exit 0 lets it through.
const script = fileURLToPath(
  new URL("../../.claude/hooks/protect-agent-config.mjs", import.meta.url),
);
const settingsFile = fileURLToPath(new URL("../../.claude/settings.json", import.meta.url));

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
  "echo x > .claude/settings.json",
  "echo x >> .claude\\settings.json",
  "Set-Content .claude/settings.json x",
  "Add-Content -Path .claude/settings.json -Value x",
  "'{}' | Out-File .claude/settings.local.json",
  "cat x | tee .claude/settings.json",
  "cp x .claude/hooks/guard-pr-merge.mjs",
  "mv a .claude/",
  "Copy-Item x .claude/hooks/a.mjs",
  "Move-Item a .claude",
  "rm .claude/settings.local.json",
  "Remove-Item .claude/hooks/block-env-read.mjs",
  "sed -i s/deny/allow/ .claude/settings.json",
  "cd .claude && echo x > settings.json",
  "cd .claude; rm settings.json",
  "Set-Location .claude; Set-Content settings.json x",
  `node -e "require('fs').writeFileSync('.claude/settings.json','{}')"`,
  "git checkout main -- .claude/settings.json",
  "git restore .claude/settings.json",
  'bash -c "echo x > .claude/settings.json"',
  "echo x > .claude/worktrees/ws-1/.claude/settings.json",
  "echo x > .cla''ude/settings.json",
  // N3: the worktree exception never covers a path that climbs out of it.
  "echo x > .claude/worktrees/../settings.json",
  "echo x > .claude/worktrees/x/../../settings.json",
  "cp x .claude/worktrees/x/../../hooks/guard-pr-merge.mjs",
  "Set-Content .claude\\worktrees\\..\\settings.json x",
  "rm .claude/worktrees/./../settings.json",
  "cd .claude/worktrees/x/../.. && echo x > settings.json",
  "cd .claude/worktrees/x && cd ../.. && echo x > settings.json",
  "cd .claude/worktrees/x; cd ..; cd ..; rm settings.json",
  // A cd through a glob or `..` into .claude, then a write.
  "cd .cl*; echo x > settings.json",
  "cd .clau?e && rm settings.json",
  "cd .[c]laude; Set-Content settings.json x",
  "cd .{claude,x}; rm settings.json",
  "Set-Location -Path .cl* ; Set-Content settings.json x",
  "echo x > .cl*/settings.json",
  "rm .claud[e]/settings.json",
  // .mcp.json starts programs: same protection as .claude/.
  "echo x > .mcp.json",
  "Set-Content .mcp.json x",
  "rm .mcp.json",
  // Checkers that write.
  "npx eslint .claude/hooks --fix",
  "npx prettier --write .claude",
  "npx prettier .claude -w",
  "npx prettier --check .claude --write",
  "npx eslint .claude/hooks -o .claude/settings.json",
  "npx tsc .claude/hooks/a.mjs",
  // sed is never a read in `.claude`: -i, a `w` command or a script file write.
  "sed -ni 1p .claude/settings.json",
  "sed --in-place 1d .claude/settings.json",
  "sed -n 'w .claude/x' notes.md",
  "sed -n '1p;w .claude/x' notes.md",
  "sed -n -f script.sed .claude/settings.json",
  "sed -n 1,20p .claude/settings.json > .claude/copy.json",
  "sed -n 1p notes.md > .claude/settings.json",
  // Readers with options that write or run a program.
  "git diff --output=.claude/settings.json",
  "rg --pre ./x.sh deny .claude",
  "tree -o .claude/settings.json",
  // Text piped into an interpreter.
  "echo 'rm .claude/settings.json' | bash",
  "echo .claude/settings.json | xargs rm",
  "Write-Output 'Remove-Item .claude/settings.json' | iex",
  // Heredocs: a write target on the command line, a body that is run or that
  // reads like a write into .claude (the saved file may be run later).
  "cat > .claude/settings.json <<'EOF'\n{}\nEOF",
  "cat <<'EOF' > .claude/settings.json\n{}\nEOF",
  "cat <<'EOF' | bash\necho x > .claude/settings.json\nEOF",
  "bash <<'EOF'\nrm .claude/settings.json\nEOF",
  "cat > run.sh <<'EOF'\nrm .claude/settings.json\nEOF\nbash run.sh",
  "cat > run.sh <<'EOF'\necho x > .claude/settings.json\nEOF",
  "cat > run.sh <<'EOF'\ncd .claude\nEOF",
  "cat > notes.md <<EOF\n$(rm .claude/settings.json)\nEOF",
  "cd .claude && cat > notes.md <<'EOF'\nhi\nEOF",
  // Messages: substitutions, variables and a write next to the message.
  'git commit -m "$(rm .claude/settings.json)"',
  'git commit -m "`rm .claude/settings.json`"',
  "git commit -m 'x'; rm .claude/settings.json",
  "git commit -m 'a' && echo x > .claude/settings.json",
  'gh pr create --title x --body "$X"; cp a .claude/settings.json',
  "git commit -m \"$(cat <<'EOF'\nok\nEOF\n)\" && echo x > .claude/settings.json",
  "git commit -m “x”; rm .claude/settings.json",
  "grep x a \\' ; rm .claude/settings.json ; echo '",
  "grep 'x' notes.md; rm .claude/settings.json",
  // Fail closed: data with ambiguous quoting or a redirect next to a mention.
  "echo 'zob. .claude/settings.json' > notes.txt",
  "cat <<'EOF' | gh pr create --body-file -\nZmiana w .claude/settings.json\nEOF",
  // Since the review of 2026-11-17: a heredoc body is checked like a command,
  // and a message is data only in a plain one-line command.
  "cat > .ai/runs/x.md <<'EOF'\n# Run\nZmieniono .claude/settings.json (reguły deny).\nEOF",
  "cat > .ai/runs/x.md <<EOF\nZmieniono .claude/settings.json\nEOF",
  "git commit -m \"$(cat <<'EOF'\nfix: opis .claude/settings.json\n\nCo-Authored-By: x\nEOF\n)\"",
  "gh pr create --title t --body \"$(cat <<'EOF'\nZmienia .claude/hooks.\nEOF\n)\"",
  `grep -n '"allow"\\|"deny"' .claude/settings.json`,
  "git commit -m 'x; rm .claude/settings.json' | bash",
  "git commit -m 'echo x > .claude/settings.json' > run.sh; bash run.sh",
  `git(){ bash -c "$2"; }; git commit -m 'rm -rf .claude'`,
  "./git commit -m 'rm .claude/settings.json'",
  "git commit -m 'a''rm .claude/settings.json'",
  "git commit -m 'x' # .claude",
  "git commit -m $'rm .claude/settings.json'",
  "git commit -m @'\nrm .claude/settings.json\n'@",
  'gh pr create --title "$X .claude" --body x',
];

const allowed = [
  "cat .claude/settings.json",
  "Get-Content .claude\\settings.json",
  "ls .claude/hooks 2>/dev/null",
  "git diff .claude/settings.json",
  "git add .claude/hooks/guard-pr-merge.mjs",
  "node .claude/hooks/guard-pr-merge.mjs",
  "grep -n deny .claude/settings.json",
  // Agent worktrees live under .claude/worktrees/<name>/: ordinary work there.
  "cd .claude/worktrees/ws-1 && npm test",
  "git -C .claude/worktrees/ws-1 commit -m x",
  "echo x > .claude/worktrees/ws-1/src/a.ts",
  "npx vitest run tests/scripts",
  "cat CLAUDE.md",
  "echo hi > notes.txt",
  // Read-only checkers and the editor.
  "npx eslint .claude/hooks",
  "npx eslint .claude/hooks/lib/shell-text.mjs",
  "npx --no-install eslint .claude",
  "npx prettier --check .claude",
  "npx prettier --list-different .claude/settings.json",
  "npx prettier -c .claude",
  "npx.cmd prettier --check .claude",
  "code .claude/settings.json",
  "cat .mcp.json",
  "cd .claude/worktrees/ws-1 && cd src && npm test",
  "cd src/.. && npm test",
  "cd ../other && ls",
  "ls * ",
  // Dry run 2026-11-17: `.claude` only as a message in a plain one-line command.
  'git commit -m "fix: hook w .claude/hooks"',
  "git commit -am 'docs: .claude/settings.json; opis'",
  'gh pr create --title "Zmiana .claude" --body "zmiana w .claude/settings.json"',
  'gh pr create --title x --body="opis .mcp.json"',
  'gh pr create --title "PR #5: .claude" --body "zob. .claude/settings.json"',
  "git add .claude/hooks/a.mjs && git commit -m 'feat: hook .claude'",
  "cd .claude/worktrees/ws-1 && node scripts/x.js",
];

describe("findAgentConfigWrites", () => {
  it.each(blocked)("blocks: %s", (command) => {
    expect(findAgentConfigWrites(command).length).toBeGreaterThan(0);
  });

  it.each(allowed)("allows: %s", (command) => {
    expect(findAgentConfigWrites(command)).toEqual([]);
  });

  it("ignores a command that is not a string", () => {
    expect(findAgentConfigWrites(undefined)).toEqual([]);
  });
});

describe("settings.json", () => {
  const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as {
    permissions: { deny: string[] };
    hooks: { PreToolUse: { hooks: { command: string }[] }[] };
  };

  it("denies the edit tools in .claude/ without covering agent worktrees", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      expect(settings.permissions.deny).toContain(`${tool}(.claude/*)`);
      expect(settings.permissions.deny).toContain(`${tool}(.claude/hooks/**)`);
      expect(settings.permissions.deny).toContain(`${tool}(.claude/skills/**)`);
    }
    expect(settings.permissions.deny.some((rule) => rule.includes(".claude/**"))).toBe(false);
  });

  it("denies rules/, output-styles/, .mcp.json and root-anchored variants of every .claude rule", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      for (const root of ["", "/"]) {
        for (const folder of ["hooks", "skills", "agents", "commands", "rules", "output-styles"]) {
          expect(settings.permissions.deny).toContain(`${tool}(${root}.claude/${folder}/**)`);
        }
        expect(settings.permissions.deny).toContain(`${tool}(${root}.claude/*)`);
        expect(settings.permissions.deny).toContain(`${tool}(${root}.mcp.json)`);
      }
    }
  });

  it("denies credential helpers, git-credential-* programs, git tracing and environment listings", () => {
    const deny = settings.permissions.deny;

    for (const shell of ["Bash", "PowerShell"]) {
      expect(deny).toContain(`${shell}(git -c credential*)`);
      expect(deny).toContain(`${shell}(git config*credential.helper*)`);
      expect(deny).toContain(`${shell}(*git-credential-*)`);
      expect(deny).toContain(`${shell}(*GIT_TRACE_REDACT*)`);
      expect(deny).toContain(`${shell}(*GIT_CURL_VERBOSE*)`);
      expect(deny).toContain(`${shell}(*GIT_TRACE_CURL*)`);
      expect(deny).toContain(`${shell}(printenv*)`);
    }
    for (const listing of ["Get-ChildItem env:*", "gci env:*", "ls env:*", "dir env:*"]) {
      expect(deny).toContain(`PowerShell(${listing})`);
    }
    expect(deny).toContain("PowerShell(*GetEnvironmentVariable*TOKEN*)");
    expect(deny).toContain("Bash(env)");
    expect(deny).toContain("Bash(set)");
    // The BOOTSTRAP.md helper line (url-scoped key) must not be denied by a rule.
    expect(deny.some((rule) => rule.includes("credential.*.helper"))).toBe(false);
  });

  it("denies the Read tool on every .env file without an exception rule", () => {
    expect(settings.permissions.deny).toContain("Read(**/.env)");
    expect(settings.permissions.deny).toContain("Read(**/.env.*)");
    expect(settings.permissions.deny.some((rule) => rule.includes("!"))).toBe(false);
  });

  it("runs this hook for shell commands", () => {
    const commands = settings.hooks.PreToolUse.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(commands.some((command) => command.includes("protect-agent-config.mjs"))).toBe(true);
  });
});

describe("protect-agent-config hook (real process)", () => {
  it("blocks a shell write into .claude/ with exit 2 and explains who changes it", () => {
    const result = runHook(shellEvent("PowerShell", "Set-Content .claude/settings.json '{}'"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("właściciel");
  });

  it("lets a read through", () => {
    expect(runHook(shellEvent("Bash", "cat .claude/settings.json")).status).toBe(0);
  });

  it("exits 1 for a malformed event (a hook bug, not a block)", () => {
    expect(runHook("not json").status).toBe(1);
  });
});
