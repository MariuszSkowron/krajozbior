import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

// Testy uruchamiają proces `node` (przy obciążonym komputerze ponad 5 s); limit tylko dla tego pliku.
vi.setConfig({ testTimeout: 30_000 });

import { findPrGateViolations, isAllowedMergeArgs } from "../../.claude/hooks/guard-pr-merge.mjs";

// The Claude Code hook that lets an agent only switch on GitHub auto-merge
// (docs/agent-workflow.md, stage "Scalenie"). The process tests run the real
// script with a hook event on stdin, as Claude Code does: exit 2 blocks, exit 0
// lets it through.
const script = fileURLToPath(new URL("../../.claude/hooks/guard-pr-merge.mjs", import.meta.url));

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

const allowed = [
  "gh pr merge 12 --auto --squash",
  "gh pr merge 12 --squash --auto",
  "gh pr merge 12 --auto --squash --delete-branch",
  "gh pr merge 7 --disable-auto",
  "gh pr ready 12 && gh pr merge 12 --auto --squash",
  // Flags in any order, short and combined short flags, -R anywhere.
  "gh pr merge 12 -s --auto",
  "gh pr merge -sd --auto 12",
  "gh pr merge 12 --auto --squash -R acme/app",
  "gh -R acme/app pr merge 12 --auto --squash --delete-branch",
  "gh pr merge --repo=acme/app 12 --squash --auto",
  "& gh pr merge 12 --auto --squash",
  "C:\\tools\\gh.exe pr merge 12 --auto --squash",
  "gh pr merge 12 \\\n  --auto --squash",
  "gh pr view 12 --json mergeStateStatus",
  "gh pr list --search merge",
  "gh pr review 12 --comment --body-file review.md",
  "gh pr review 12 --request-changes --body-file review.md",
  "git merge origin/main",
  "git merge --no-ff origin/main",
  "gh pr checkout 5 && git merge origin/main",
  "gh api -X POST repos/acme/app/statuses/abc123 -f state=success -f context=agent-review",
  "gh api repos/acme/app/pulls/12/reviews",
  "gh api repos/acme/app",
  "gh repo view acme/app",
  "gh run watch 123 --exit-status",
  'git config credential.https://github.com.helper ""',
  "grep GITHUB_TOKEN .github/workflows/ci.yml",
  'git commit -m "fix: uwagi po PR review"',
  "npm run check",
  // The second helper line of BOOTSTRAP.md, step 9.5.
  'git config --add credential.https://github.com.helper "!gh auth git-credential"',
  // Read-only calls that only look like protection changes.
  "gh api repos/acme/app/collaborators/some-bot/permission",
  "gh api repos/acme/app/collaborators/some-bot/permission --jq .permission",
  "gh api repos/acme/app/hooks",
  "gh api repos/acme/app/keys",
  "gh api repos/acme/app/environments",
  "gh api -X GET repos/acme/app/hooks",
  "gh secret list",
  "gh secret list -R acme/app",
  "gh api graphql -f query='query { viewer { login } }'",
  // Environment: a plain, non-secret variable and commands that merely start with `env`/`set`.
  "[Environment]::GetEnvironmentVariable('PATH')",
  "env FOO=1 npm test",
  "set -e",
  // printenv only as a program, not as an argument or a search term.
  "grep printenv notes.md",
  "grep -c printenv notes.md",
  "rg printenv .claude/hooks",
  "echo printenv",
  "git log --grep printenv",
  // export/declare that set or describe a variable without listing values.
  "export FOO=1",
  "export NODE_ENV=test && npm test",
  "declare -i count=1",
  "declare -p PATH",
  "cat /proc/cpuinfo",
  // Dry run 2026-11-17: "PR" and "merge" only as a message in a plain one-line command.
  'git commit -m "fix: po review PR poprawiono merge konfliktów"',
  "git commit -m 'docs: opis gh pr merge 5 --auto --squash'",
  'gh pr create --title "PR: merge kolejki" --body "Po merge PR #5"',
  "gh issue comment 5 --body 'PR merge done'",
];

const blocked = [
  "gh pr merge 12",
  "gh pr merge 12 --squash",
  "gh pr merge 12 --auto",
  "gh pr merge 12 --merge --auto",
  "gh pr merge 12 --rebase --auto",
  "gh pr merge 12 --auto --squash --admin",
  "gh pr merge 12 --admin --squash",
  "gh pr merge --auto --squash",
  "gh pr merge feature-branch --auto --squash",
  "gh pr merge 12 13 --auto --squash",
  "gh pr merge 12 --auto -m",
  "gh pr merge 12 --auto -sm",
  "gh pr merge 12 --auto --squash --auto",
  "gh pr merge 12 --auto --squash $EXTRA",
  'gh pr merge 12 --auto --squash --body "x"',
  "gh  pr   merge 12",
  "gh -R acme/app pr merge 12",
  'bash -c "gh pr merge 12 --admin"',
  "gh pr merge 12 --auto --squash; gh pr merge 13",
  "gh pr merge 12 --auto --squash && gh pr merge 13 --admin --squash",
  "gh pr merge 12 --auto `\n--admin",
  // Hidden spellings: quotes, escapes, substitutions, globs, wrappers.
  "gh pr mer`ge 12 --admin",
  'gh pr m"erg"e 12',
  "gh pr m\\erge 12 --admin",
  "gh pr $(echo merge) 12",
  "$(echo gh) pr merge 12",
  "gh pr merge 1[2] --auto --squash",
  "gh pr merge 12 --auto --squash *",
  "gh pr merge 12 --auto --squash -R 'acme/app'",
  "gh pr merge 12 --auto --squash -R $REPO",
  "env GH_REPO=acme/app gh pr merge 12 --auto --squash",
  "xargs gh pr merge --admin",
  "C:\\tools\\gh.exe pr merge 12 --admin",
  "& gh pr merge 12 --admin",
  "gh pr review 12 --approve",
  "gh pr review 12 -a --body ok",
  "gh pr review 12 -ca",
  "gh pr review 12 --approve=true",
  'gh pr review 12 --comment --body "ok"',
  "$(echo gh) pr review 12 -a",
  "gh pr rev''iew 12 --app''rove",
  // Protection of the repository.
  "gh api repos/acme/app/rulesets",
  "gh api -X PUT repos/acme/app/branches/main/protection",
  "gh api -X PUT repos/acme/app/interaction-limits -f limit=existing_users",
  "gh api -X PUT repos/acme/app/collaborators/someone",
  "gh api -X PUT repos/acme/app/actions/permissions/workflow -f default_workflow_permissions=write",
  "gh api -X PATCH repos/acme/app -F allow_auto_merge=false",
  "gh api --method=DELETE repos/acme/app",
  "gh api -XPATCH /repos/acme/app/",
  "gh api graphql -f query='mutation { updateRepositoryRuleset(input: {}) { clientMutationId } }'",
  "gh repo edit --enable-auto-merge",
  "gh repo delete acme/app --yes",
  "gh secret set TOKEN",
  "gh variable set X",
  "gh ruleset list",
  "gh extension install someone/gh-merge",
  // The token.
  "gh auth token",
  "gh auth status",
  "gh auth status --show-token",
  "gh auth git-credential get",
  "git credential fill",
  "git -C ../app credential fill",
  "git credential-manager github list",
  "GH_TOKEN=abc gh api user",
  "GITHUB_TOKEN=abc npm run x",
  "echo $GH_TOKEN",
  "echo ${GITHUB_TOKEN}",
  "Write-Output $env:GH_TOKEN",
  "$env:GITHUB_TOKEN = 'x'; gh pr list",
  "gh api -X PUT repos/acme/app/pulls/12/merge -f merge_method=squash",
  "gh api -X POST repos/acme/app/merges -f base=main -f head=feature",
  "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
  "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
  "gh api -X POST repos/acme/app/pulls/12/reviews -f event=APPROVE",
  "gh alias set pm 'pr merge --admin'",
  // N1: the token through a credential helper, git tracing or the environment.
  "git -c credential.helper='!f() { cat > /tmp/t; }; f' fetch",
  "git -c credential.https://github.com.helper=!echo fetch",
  "git -C ../app -c credential.helper=/tmp/steal.sh fetch",
  "git -ccredential.helper=x fetch",
  "git config credential.helper '!cat > /tmp/t'",
  "git config --global credential.helper '!cat > /tmp/t'",
  "git config --system credential.helper store",
  "git config --local --add credential.https://github.com.helper '!cat > /tmp/t'",
  'git config credential.https://github.com.helper "!cat > /tmp/t"',
  'git config credential.https://github.com.helper "" x',
  'git config credential.https://github.com.helper "!gh auth git-credential" --global',
  "git-credential-manager get",
  "C:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe get",
  "/usr/lib/git-core/git-credential-store get",
  "GIT_TRACE_REDACT=0 GIT_TRACE_CURL=1 git fetch",
  "GIT_CURL_VERBOSE=1 git fetch",
  "$env:GIT_TRACE_CURL = 1; git fetch",
  "[Environment]::GetEnvironmentVariable('GH_TOKEN')",
  "[Environment]::GetEnvironmentVariable('GITHUB_TOKEN', 'User')",
  "[Environment]::GetEnvironmentVariable('GH_' + 'TOKEN')",
  "[System.Environment]::GetEnvironmentVariable($name)",
  "[Environment]::GetEnvironmentVariables()",
  "$env:('GH_' + 'TOKEN')",
  "Get-ChildItem env:",
  "Get-ChildItem -Path Env:\\",
  "gci env:",
  "ls env:",
  "dir env:",
  "(gci env:).Value",
  "printenv",
  "printenv | grep -i token",
  "command printenv",
  "env",
  "env | grep GH",
  "env > /tmp/out.txt",
  "/usr/bin/env -0",
  "set",
  "set | grep TOKEN",
  // printenv as a program in any command position.
  "sudo printenv",
  "xargs printenv",
  "env -i printenv",
  "bash -c printenv",
  "bash -c 'printenv | grep TOKEN'",
  "echo $(printenv)",
  "echo `printenv`",
  "/usr/bin/printenv GH_TOKEN",
  // export/declare/typeset that list variables with values.
  "export",
  "export -p",
  "export -p | grep TOKEN",
  "declare",
  "declare -p",
  "declare -px",
  "typeset -p",
  "declare -p GH_TOKEN",
  "declare -p DB_PASSWORD",
  // The environment of a process as a file.
  "cat /proc/self/environ",
  "xxd < /proc/self/environ",
  "cat /proc/1234/environ",
  "strings /proc/$$/environ",
  // N2: gh api gaps.
  "gh api -X PATCH https://api.github.com/repos/acme/app -F allow_auto_merge=false",
  "gh api --method=DELETE https://api.github.com/repos/acme/app/",
  "gh api -X PUT https://api.github.com/repos/acme/app/collaborators/someone",
  "gh api graphql -F query=@mutation.graphql",
  "gh api graphql -f query=@mutation.graphql",
  "gh api graphql --input query.json",
  "gh api graphql -f query=$QUERY",
  "gh api -X POST repos/acme/app/pulls/12/reviews -f event=approve",
  "gh api -X POST repos/acme/app/pulls/12/reviews -f event=Approve",
  "gh api -X POST repos/acme/app/pulls/12/reviews --input review.json",
  "gh pr review 12 -a=true",
  "gh pr review 12 --approve=TRUE",
  "gh pr review 12 -ca=1",
  "gh api -X PUT repos/acme/app/pulls/12/reviews/99/dismissals -f message=x",
  // Read-only exceptions stay closed for writes.
  "gh api -X PUT repos/acme/app/hooks/1",
  "gh api -X POST repos/acme/app/keys -f key=ssh-rsa",
  "gh api repos/acme/app/environments/prod -X PUT",
  "gh api repos/acme/app/hooks -f name=web",
  "gh api repos/acme/app/collaborators",
  "gh api repos/acme/app/collaborators/some-bot/permission -X PUT -f permission=admin",
  "gh secret set TOKEN",
  "gh secret delete TOKEN",
  // Messages stay data only when they cannot run or expand anything.
  'git commit -m "x"; gh pr merge 5 --admin',
  'git commit -m "$GH_TOKEN merge PR"',
  'gh pr comment 5 --body "$GH_TOKEN"',
  'git commit -m "x `gh pr merge 5 --admin`"',
  'git commit -m "$(gh pr merge 5 --admin)"',
  "git commit -m \"$(cat <<'EOF'\nok\nEOF\n)\" && gh pr merge 5",
  "git commit -m 'a' -m 'b'; gh pr review 5 -a",
  "git commit -m “PR merge”; gh pr merge 5",
  // A heredoc that is run, or a saved one with a real call or a token.
  "cat <<'EOF' | bash\ngh pr merge 5 --admin\nEOF",
  "bash <<'EOF'\ngh pr merge 5 --admin\nEOF",
  "cat > run.sh <<'EOF'\ngh pr merge 5 --admin\nEOF",
  "cat > run.sh <<'EOF'\ngh pr review 5 --approve\nEOF",
  "cat > run.sh <<'EOF'\ngh api -X PUT repos/o/r/pulls/5/merge\nEOF",
  "cat > notes.md <<EOF\n$GH_TOKEN\nEOF",
  "cat > notes.md <<'EOF'\necho $GH_TOKEN\nEOF",
  // Since the review of 2026-11-17: a heredoc body is checked like a command,
  // and a message is data only in a plain one-line command.
  "git commit -m \"$(cat <<'EOF'\nfix: merge PR zgodnie z gh pr merge --admin\n\nCo-Authored-By: x\nEOF\n)\"",
  "gh pr create --title t --body \"$(cat <<'EOF'\nPo merge tego PR uruchom gh pr review.\nEOF\n)\"",
  "cat > .ai/runs/x.md <<'EOF'\nPR #5: merge po zielonym CI.\nEOF",
  "git commit -m 'gh pr merge 5 --admin' | bash",
  "git commit -m 'x' # gh pr merge 5 --admin",
  "gh pr comment 5 --body 'gh pr merge 5 --admin' > run.sh",
  "git commit -m $'gh pr merge 5 --admin'",
];

describe("isAllowedMergeArgs", () => {
  it("accepts exactly the auto-merge forms", () => {
    expect(isAllowedMergeArgs(["5", "--auto", "--squash"])).toBe(true);
    expect(isAllowedMergeArgs(["5", "--squash", "--auto", "--delete-branch"])).toBe(true);
    expect(isAllowedMergeArgs(["5", "--disable-auto"])).toBe(true);
    expect(isAllowedMergeArgs(["-sd", "--auto", "5"])).toBe(true);
  });

  it("rejects an unknown letter inside combined short flags", () => {
    expect(isAllowedMergeArgs(["5", "--auto", "-sm"])).toBe(false);
    expect(isAllowedMergeArgs(["5", "--auto", "-sr"])).toBe(false);
  });

  it("rejects a missing number, extra flags and duplicates", () => {
    expect(isAllowedMergeArgs(["--auto", "--squash"])).toBe(false);
    expect(isAllowedMergeArgs(["5", "--auto", "--squash", "--admin"])).toBe(false);
    expect(isAllowedMergeArgs(["5", "--disable-auto", "--squash"])).toBe(false);
    expect(isAllowedMergeArgs(["5", "--auto", "--auto", "--squash"])).toBe(false);
  });
});

describe("findPrGateViolations", () => {
  it.each(allowed)("allows: %s", (command) => {
    expect(findPrGateViolations(command)).toEqual([]);
  });

  it.each(blocked)("blocks: %s", (command) => {
    expect(findPrGateViolations(command).length).toBeGreaterThan(0);
  });

  it("names the offending merge form", () => {
    expect(findPrGateViolations("gh pr merge 12 --admin")).toEqual([
      'niedozwolona forma scalania: "gh pr merge 12 --admin"',
    ]);
  });

  it("ignores a command that is not a string", () => {
    expect(findPrGateViolations(undefined)).toEqual([]);
    expect(findPrGateViolations(42)).toEqual([]);
  });
});

describe("guard-pr-merge hook (real process)", () => {
  it("blocks a plain merge with exit 2 and points to the allowed form", () => {
    const result = runHook(shellEvent("Bash", "gh pr merge 12 --squash"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--auto --squash");
    expect(result.stderr).toContain("docs/agent-workflow.md");
  });

  it("blocks an admin merge from PowerShell", () => {
    expect(runHook(shellEvent("PowerShell", "gh pr merge 12 --auto --squash --admin")).status).toBe(
      2,
    );
  });

  it("lets the auto-merge form through", () => {
    expect(
      runHook(shellEvent("Bash", "gh pr merge 12 --auto --squash --delete-branch")).status,
    ).toBe(0);
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
