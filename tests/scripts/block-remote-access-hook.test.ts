import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

// The Claude Code hook that refuses shell commands reaching a server or SSH keys
// when the command text says so: SSH clients and relatives, rsync, PuTTY tools,
// `user@host:` addresses, PowerShell remoting and encoded commands, any `.ssh`
// folder, the folder with deployment secrets (`krajozbior-deploy`) and the local
// showcase data (`.data/showcase`). Git that may reach a server passes only in
// the forms of an allow list (`git fetch origin`, `git push -u origin <branch>`,
// …); text in quotes (a commit message, a PR title) is not a command. It reads
// text only: the "known limitations" list documents what it deliberately does
// not catch, so nobody takes it for a security boundary (that is the deployment
// passphrase).
// The process tests run the real script with a hook event on stdin, as Claude
// Code does: exit 2 blocks (also a malformed event), exit 0 lets it through.
//
// BLOCK_REMOTE_ACCESS_HOOK (a path relative to the repository root) tests
// another copy of the hook, e.g. a new version prepared outside `.claude/`
// before the owner installs it; by default the installed hook is tested.
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const script = resolve(
  repositoryRoot,
  process.env.BLOCK_REMOTE_ACCESS_HOOK ?? ".claude/hooks/block-remote-access.mjs",
);
const settingsPath = resolve(repositoryRoot, ".claude/settings.json");
const { findRemoteAccess } = (await import(pathToFileURL(script).href)) as {
  findRemoteAccess: (command: unknown) => string[];
};

function runHook(event: unknown) {
  const result = spawnSync(process.execPath, [script], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
    // Claude Code stops a hook after its 10 s limit and lets the command run.
    timeout: 10_000,
  });
  return { status: result.status, stderr: result.stderr };
}

const shellEvent = (tool_name: "Bash" | "PowerShell", command: string) => ({
  tool_name,
  tool_input: { command },
});

const blocked = [
  // The SSH client and its relatives.
  "ssh -V",
  "ssh user@example.com",
  "SSH -V",
  "ssh.exe -V",
  "ssh. -V",
  "C:\\Windows\\System32\\OpenSSH\\ssh.exe -V",
  "& 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' -V",
  "/usr/bin/ssh -V",
  "scp file.txt user@example.com:/tmp",
  "scp.exe a b",
  "sftp user@example.com",
  "ssh-keygen -t ed25519",
  "ssh-keyscan example.com",
  "ssh-add -l",
  "ssh-agent",
  "ssh-copy-id user@example.com",
  "ssh-copy-id.exe -i key.pub user@example.com",
  "sshpass -p x scp a b",
  "autossh -M 0 example.com",
  "mosh example.com",
  "curl sftp://example.com/file",
  "curl scp://example.com/file",
  // PuTTY tools.
  "plink -V",
  "plink.exe user@example.com",
  "pscp file.txt user@example.com:/tmp",
  "psftp example.com",
  "putty -load session",
  // rsync and rclone (they start SSH themselves).
  "rsync -a deploy@example.com:/srv/app/ ./copy/",
  "rsync -av ./dist/ /mnt/backup/",
  "rclone ls remote:",
  // Git as an SSH transport: no client name in the text.
  "git ls-remote deploy@example.com:repo.git",
  "git ls-remote --upload-pack='touch /tmp/x' deploy@example.com:x",
  "git ls-remote --upload-pack=cmd ./local",
  "git push --receive-pack=cmd origin main",
  "git -c core.sshCommand=C:/tools/x.exe fetch origin",
  "GIT_SSH_COMMAND='x -i key' git fetch origin",
  "$env:GIT_SSH='C:\\tools\\x.exe'; git fetch origin",
  "GIT_SSH_VARIANT=simple git fetch origin",
  "git -c ssh.variant=simple fetch origin",
  "git -c remote.origin.uploadpack=cmd fetch origin",
  "git config remote.origin.receivepack cmd",
  "git ls-remote -u cmd origin",
  "git clone -u cmd origin copy",
  "git push --exec=cmd origin main",
  "git archive --remote=origin --exec=cmd HEAD",
  "git clone 'ext::sh -c touch% /tmp/x' copy",
  "git clone ssh://deploy@example.com/srv/repo.git",
  "git clone git+ssh://example.com/repo.git",
  'git fetch "deploy@example.com:repo.git"',
  "git fetch example.com:repo.git",
  "git remote add prod deploy@example.com:/srv/app.git",
  "git remote set-url origin 10.0.0.5:/srv/app.git",
  // Git: a server path that starts with digits is not a port.
  "git ls-remote deploy@example.com:22/repo.git",
  "git clone deploy@example.com:1/../../srv/app.git copy",
  "git fetch example.com:22/repo.git",
  "git fetch 10.0.0.5:22/x",
  "git fetch deploy@[::1]:repo",
  // Git: any beginning of a long option that runs a command on the server.
  "git ls-remote --upload-pa='touch /tmp/x' deploy@example.com:1/x",
  "git ls-remote --upl=cmd origin",
  "git ls-remote --u=cmd origin",
  "git fetch --upload-pack cmd origin",
  "git push --receive-pa=cmd origin main",
  "git push --r=cmd origin main",
  "git push --exe=cmd origin main",
  "git pull --e=cmd origin main",
  "git clone -qu cmd https://github.com/example/repo.git",
  "git archive -u cmd --remote=origin HEAD",
  "git fetch-pack --exec=cmd origin",
  "git send-pack --exec=cmd origin",
  "git fetch-pack prod:x",
  "git send-pack prod:x",
  // Git: any remote other than origin or GitHub over HTTPS.
  "git fetch prod",
  "git fetch prod:app.git",
  "git pull prod main",
  "git push prod main",
  "git push --repo=prod",
  "git fetch --multiple origin prod",
  "git clone https://example.com/repo.git",
  "git clone http://github.com/example/repo.git",
  "git clone https://github.com.example.com/repo.git",
  "git clone git://example.com/repo.git",
  "git clone ../other copy",
  "git ls-remote file:///srv/repo.git",
  "git archive --remote=prod HEAD",
  "git remote add prod https://example.com/repo.git",
  "git remote show prod",
  "git submodule update --init",
  "git submodule add https://github.com/example/repo.git lib",
  "git config remote.origin.url deploy@example.com:x",
  "git config remote.prod.url example.com:x",
  "git -c remote.origin.url=example.com:x fetch origin",
  "git -c remote.origin.pushurl=example.com:x push origin main",
  "git -c url.example.com:.insteadOf=https://github.com/ fetch https://github.com/a/b",
  "git -c core.gitProxy=cmd fetch git://example.com/x",
  "GIT_PROXY_COMMAND=cmd git fetch origin",
  "git -c alias.f=fetch f prod",
  "C:\\Program Files\\Git\\cmd\\git.exe fetch prod",
  'git -c "user.name=A B" fetch prod',
  'git -c "x=a;b" fetch prod',
  "git -C 'C:\\My Repo' push prod main",
  // Behind another command or separator.
  "echo ok && ssh -V",
  "cd src; ssh -V",
  "git status | ssh host",
  "wsl ssh -V",
  'powershell -Command "ssh -V"',
  // Spellings a shell turns into the same name.
  'ss"h" -V',
  "s'sh' -V",
  "s\\sh -V",
  "ss`h -V",
  "ss\\\nh -V",
  "ss`\nh -V",
  "cmd /c s^sh -V",
  "cmd /c r^sync a b",
  // PowerShell remoting: the session cmdlets as a whole, any abbreviation.
  "Enter-PSSession -HostName example.com -UserName jan",
  "Enter-PSSession -HostN example.com",
  "Enter-PSSession -Ho example.com -User jan",
  "New-PSSession -SSHTransport -HostName example.com",
  "New-PSSession -ComputerName srv",
  "Invoke-Command -hostname example.com -ScriptBlock { 1 }",
  "Invoke-Command -ComputerName srv -ScriptBlock { 1 }",
  "etsn -Ho example.com",
  "icm -Ho example.com { 1 }",
  "$p=@{HostName='example.com'}; Enter-PSSession @p",
  "$p = @{ UserName = 'jan'; HostName = 'example.com' }; & $c @p",
  "$p.HostName = 'example.com'",
  "$p['HostName']='example.com'",
  "Some-Cmdlet -HostNa example.com",
  "Some-Cmdlet -SSHT",
  // PowerShell encoded commands (the agent never needs them).
  "powershell -EncodedCommand ZQBjAGgAbwA=",
  "pwsh -enc ZQBjAGgAbwA=",
  "powershell -ec ZQBjAGgAbwA=",
  "powershell.exe -NoProfile -e ZQBjAGgAbwA=",
  "pwsh /enc ZQBjAGgAbwA=",
  "Start-Process powershell -ArgumentList '-enc ZQBjAGgAbwA='",
  "powershell -ExecutionPolicy Bypass -en ZQBjAGgAbwA=",
  "powershell -encodedc ZQBjAGgAbwA=",
  // Other programs that open SSH themselves.
  "code --remote ssh-remote+example.com /srv",
  "slogin example.com",
  "dbclient example.com",
  "sshuttle -r example.com 0/0",
  "winscp.com /command",
  "rsync -a ./x/ deploy@example.com:22/srv/",
  // The .ssh folder and keys in it.
  "cat ~/.ssh/config",
  "cat ~/.ssh/id_ed25519",
  "Get-Content $env:USERPROFILE\\.ssh\\config",
  "Get-ChildItem C:\\Users\\jan\\.ssh",
  "dir %USERPROFILE%\\.ssh\\",
  "ls .ssh",
  "ls -a ~/.ssh;",
  "Get-Content $HOME\\.SSH\\id_rsa",
  "type '.ssh'",
  "ls ~/.ssh*",
  "ls ~/.ssh:",
  "ls ~/.ssh,",
  "echo ~/.ssh=x",
  "cat ~/.ssh_backup/id_rsa",
  "ls ~/.ssh-old",
  "cat ~/.s*/id_ed25519",
  "ls ~/.ss?",
  "ls $HOME\\.s[s]h",
  // The folder with deployment secrets, also as a wildcard.
  "ls ../krajozbior-deploy",
  "cat C:\\Users\\jan\\.config\\krajozbior-deploy\\wdroz.config",
  "Get-ChildItem KRAJOZBIOR-DEPLOY",
  "ls ../krajozbior-dep*",
  "cat ../krajozbior-d*/wdroz.config",
  "ls ..\\krajozbior*",
  "ls ~/.config/krajozbior-*",
  "ls ~/.config/krajozbior-de?loy",
  // The local showcase data (sign-in codes in its outbox).
  "cat .data/showcase/outbox/latest.json",
  "Get-Content .data\\showcase\\outbox\\latest.json",
  "ls C:\\Projekty\\krajozbior\\.data\\showcase",
  "Get-ChildItem .DATA/Showcase",
  "cd .data; cat showcase/outbox/latest.json",
  "cat .data//showcase/outbox/latest.json",
  "cat .data/./showcase/outbox/latest.json",
  "cat .data/*/outbox/latest.json",
  "Get-Content .data\\*\\outbox\\latest.json",
  "ls .data*",
  "grep -r code .data",
  "grep -rn code .data/",
  "Get-ChildItem .data -Recurse -File | Get-Content",
  "rg code .data",
  "cat .data/s*/outbox/latest.json",
  "cat .data/show*/out*/latest.json",
  "cat .data/showcas?/outbox/latest.json",
  "cat .data/deploy/../showcase/secrets.env",
  "Get-ChildItem .data -s",
  "gci .data\\ -s",
  "cmd /c dir /s .data",
  "Get-ChildItem .data/deploy/.. -Recurse",
  "ls -R .data",
  "Get-ChildItem .data\\showcase\\outbox | Get-Content",
  "Get-Content .data/showcase/secrets.env",
  "New-Item -ItemType File .data\\showcase\\outbox\\latest.json -Value x",
  "Copy-Item .data\\showcase\\secrets.env x.txt",
  "docker run -v ./.data/showcase:/data app",
  // Strict by design: the hook reads the whole text of the command.
  "git commit -m 'opis ze slowem ssh'",
  // Git allow list: only the listed forms reach a server.
  "git push origin HEAD:refs/heads/feature",
  "git push origin HEAD:main",
  "git push origin :feat/x",
  "git push origin +feat/x",
  "git push -f origin feat/x",
  "git push --force origin feat/x",
  "git push origin --delete feat/x",
  "git push origin",
  "git push",
  "git push --tags origin",
  "git push origin feat/x feat/y",
  "git push origin $branch",
  'git push -u origin "$(git branch --show-current)"',
  "git push origin -- feat/x",
  "git fetch upstream",
  "git fetch origin --upload-pack=x",
  "git fetch -j 4 origin",
  "git pull origin main feat/x",
  "git --no-pager fetch origin",
  "git --git-dir=../other/.git fetch origin",
  "git -c http.proxy=http://example.com:8080 fetch origin",
  "git -c include.path=.ai/tmp/x.cfg fetch origin",
  "GIT_TRACE=1 git fetch origin",
  "$env:GIT_DIR='../other/.git'; git fetch origin",
  "git fetch origin>out.txt",
  "git ls-remote https://github.com/example/repo.git",
  "git ls-remote origin --upload-pack=x",
  "git remote add upstream https://github.com/example/repo.git",
  "git remote set-url origin https://github.com/other/repo.git",
  "git remote remove origin",
  "git clone --recurse-submodules https://github.com/example/repo.git",
  "git clone https://user@github.com/example/repo.git",
  "git clone https://github.com:443/example/repo.git",
  "git lfs pull",
  "git submodule foreach 'git fetch prod'",
  "git config --global alias.st status",
  "git config set alias.f fetch",
  "git config --add url.example.com:.pushInsteadOf origin",
  "git config core.sshCommand x",
  "git -c alias.st=status st",
  "git credential fill",
  "git for-each-repo --config=maintenance.repo fetch",
  "git backfill",
  "git upload-pack .",
  "git-fetch prod",
  "C:\\Program Files\\Git\\mingw64\\libexec\\git-core\\git-push.exe prod main",
  "git-remote-ext 'sh -c x' x",
  "git --exec-path=.ai/tmp status",
  "git --super-prefix=x status",
  // Git inside another command or interpreter.
  "timeout 5 git fetch prod",
  "env GIT_TRACE=1 git fetch prod",
  "echo prod | xargs git fetch",
  "find . -name x -exec git push origin {} ;",
  'echo "$(git fetch prod)"',
  "echo `git fetch prod`",
  "x=`git fetch prod`",
  "{git,fetch,prod}",
  'bash -c "git fetch evil"',
  "bash -c 'git push prod main'",
  'sh -c "cd x && git fetch evil"',
  'powershell -c "git fetch evil"',
  "pwsh -Command 'git fetch evil'",
  'cmd /c "git fetch evil"',
  "cmd /c echo 'x & git fetch evil'",
  'Invoke-Expression "git fetch evil"',
  "Start-Process git -ArgumentList 'fetch','prod'",
  "git bisect run git fetch prod",
  "git rebase --exec 'git fetch prod' main",
  "git rebase -x 'git fetch prod' main",
  // Settings for git in the environment, also for a later command.
  "export GIT_CONFIG_COUNT=1",
  "$env:GIT_CONFIG_GLOBAL='.ai/tmp/x.cfg'",
  "set GIT_CONFIG_PARAMETERS='alias.f=fetch'",
  "$env:GIT_EXEC_PATH='.ai/tmp'",
  "$env:GIT_ASKPASS='.ai/tmp/x.cmd'",
  "git -C x --config-env=core.pager=P log",
  // The showcase data: a cheap recursive read (review v3, S4).
  "grep -rnIi code .data",
  "ls -alhR .data",
  "git grep --no-index -n code .data",
  "git diff --no-index .data x",
  'mkdir "`cat .data/showcase/secrets.env`"',
  "mkdir x > .data/showcase/outbox/latest.json",
  "mkdir $(cat .data/showcase/secrets.env)",
  // A wildcard extension that reads like the key folder: blocked deliberately.
  "ls src/*.s*",
];

// Bypasses found by the third review (`review-k16-59-weryfikacja-v3.md`, B1–B4
// and S2–S3): each passed version 3 and each must be blocked. `example.com:x`
// is an SSH address without a user.
const bypassesFromReview = [
  // B1: a redirection glued to a word.
  "git ls-remote>out.txt --upload-pa='touch /tmp/x' example.com:x",
  "git 2>err.txt fetch prod",
  "git>out.txt fetch prod",
  "git fetch<in.txt prod",
  "git 2>$null fetch prod",
  // B2: global options with a value that the hook did not know.
  "git --attr-source HEAD ls-remote --upload-pa='touch /tmp/x' example.com:x",
  "git --attr-source HEAD fetch prod",
  "git --attr-source HEAD clone example.com:/srv/app.git copy",
  "git --shallow-file x fetch prod",
  // B3: the word `git` as the value of an option.
  "git ls-remote -o git --upload-pa='touch /tmp/x' example.com:x",
  "git clone -o git example.com:/srv/app.git copy",
  "git fetch -o git prod",
  "git push -o git prod main",
  // B4: settings in environment variables and `--config-env`.
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.f GIT_CONFIG_VALUE_0=fetch git f prod",
  "A=fetch git --config-env=alias.f=A f prod",
  "$env:GIT_CONFIG_COUNT=1; $env:GIT_CONFIG_KEY_0='alias.f'; $env:GIT_CONFIG_VALUE_0='fetch'; git f prod",
  "H=example.com:/srv/app.git git --config-env=remote.origin.pushurl=H push origin main",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.pushurl GIT_CONFIG_VALUE_0=example.com:/srv/app.git git push origin main",
  // S2: other keys that choose the server.
  "git config branch.main.remote example.com:/srv/app.git",
  "git -c branch.main.remote=example.com:/srv/app.git fetch",
  "git -c remote.pushDefault=example.com:/srv/app.git push",
  "git config remote.pushDefault prod",
  "git config branch.main.pushRemote prod",
  // S3: subcommands and programs outside the list.
  "git request-pull HEAD~1 example.com:/srv/app.git",
  "git fetch --m origin prod",
  "git remote rename prod origin",
  "git remote update prod",
  "git lfs clone example.com:/srv/app.git",
  "git lfs fetch prod",
  "git subtree pull --prefix=x example.com:/srv/app.git main",
  "scalar clone example.com:/srv/app.git",
];

// Everyday commands of the orchestrator and the agents (from the logs of
// 2026-11-21). A false block here stops ordinary work, so each must pass.
const everyday = [
  'gh pr list --author "krajozbior-bot[bot]"',
  "gh pr list --author krajozbior-bot[bot] --state open",
  "git log --author='krajozbior-bot[bot]' --oneline -5",
  "gh api repos/example/repo/pulls/59/comments --jq '.[] | select(.user.login==\"krajozbior-bot[bot]\") | .body'",
  "git -c user.name='krajozbior-bot[bot]' -c user.email=1+bot@users.noreply.github.com commit -F msg.txt",
  'git -c user.name="Mariusz Skowron" -c user.email=218756461+MariuszSkowron@users.noreply.github.com commit -F .ai/tmp/k16-v3/msg.txt',
  "Get-ChildItem C:\\Projekty\\Krajozbior\\krajozbior\\docs",
  "Get-ChildItem C:\\Projekty\\Krajozbior\\krajozbior\\*.json",
  "Get-ChildItem C:\\Projekty\\Krajozbior\\krajozbior-docs\\.ai\\runs\\*.md",
  "Get-ChildItem C:\\Projekty\\Krajozbior\\krajozbior\\.worktrees\\*",
  "Get-ChildItem C:\\x\\Krajozbior\\*",
  "Get-Content -Encoding UTF8 plik.md",
  'powershell -NoProfile -Command "Get-Content x.txt -Encoding UTF8"',
  "npm run test:e2e -- -Environment e2e",
  "powershell -ExecutionPolicy Bypass -File scripts/test-env/up.ps1 -Environment e2e",
  "powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1",
  "New-Item -ItemType Directory .data\\showcase\\outbox",
  "New-Item -ItemType Directory -Force -Path .data/showcase, .data/showcase/outbox | Out-Null",
  "mkdir -p .data/showcase/outbox",
  "Test-Path .data\\showcase\\secrets.env",
  "New-Item -ItemType Directory -Force .data",
  "Get-ChildItem .data",
  "Get-ChildItem .data | Select-Object -First 5",
  "Test-Path .data",
  "ls -la .data",
  "docker run -v ./.data:/data app",
  "Get-ChildItem .data/deploy/*.txt",
  "git push -u origin feat/x",
  "git push -q origin chore/k16-blokada-zdalnego-dostepu",
  "git push --force-with-lease origin feat/x",
  "git push --recurse-submodules=check origin feat/x",
  "git fetch origin",
  "git fetch --prune origin",
  "git fetch --depth 1 origin main",
  "git fetch",
  "git fetch --all",
  "git pull --no-rebase origin main",
  "git pull --rebase origin main",
  "git ls-remote origin chore/x",
  "git ls-remote --heads origin",
  "git merge --no-edit origin/main",
  "git show origin/main:src/app/page.tsx",
  "git remote get-url origin",
  "git config --get remote.origin.url",
  "git config remote.origin.url https://github.com/example/repo.git",
  "git branch -r",
  "git worktree list",
  "git clone --depth 1 https://github.com/example/repo.git copy",
  "git clone -b main https://github.com/example/repo.git",
  "git submodule status",
  "git -C c:\\Projekty\\Krajozbior\\krajozbior\\.worktrees\\ws-3 diff ef0a575..HEAD",
  "git -C C:\\Projekty\\Krajozbior\\krajozbior\\.worktrees\\ws-6 diff origin/main...HEAD",
  "git -C c:\\Projekty\\Krajozbior\\krajozbior-docs commit .ai/runs/2026-11-21-x.md -F msg.txt",
  'git commit -m "docs: README.md: poprawka"',
  "gh pr view 61 --json reviewDecision",
  "gh pr checks 59",
  "gh pr merge 61 --auto --squash",
  "gh pr edit 59 --body-file .ai/tmp/k16-v3/pr-body.md",
  "gh run view 123 --log-failed",
  "docker compose -p krajozbior-showcase up -d",
  "docker compose -f deploy/compose.yaml config",
  "docker ps -a",
  "docker volume rm krajozbior-showcase-pgdata",
  "npx vitest run tests/scripts tests/deploy",
  "npx prettier --check scripts tests/scripts",
  "npx eslint tests/scripts scripts",
  "npx vitest run --coverage",
  "npm run legal:final",
  "npm run db:roles",
  "Resolve-DnsName krajozbior.pl",
  "curl -sI https://krajozbior.pl",
  "Get-CimInstance Win32_OperatingSystem",
  "node -e \"console.log(require('os').hostname())\"",
  "node -e \"if (u.hostname === 'x') process.exit(1)\"",
  "cat scripts/showcase/showcase-lib.ps1",
  "Get-Content docs/testing.md -Raw",
  "ls ~/.config",
  // From the third review and the orchestrator's logs.
  "gh pr merge 63 --auto --squash",
  "git merge origin/main --no-edit",
  "git switch -c x origin/main",
  "git -C c:\\Projekty\\Krajozbior\\krajozbior\\.worktrees\\ws-6 log --oneline -5",
  "docker compose -p krajozbior-rehearsal down -v",
  "npx vitest run tests/scripts",
  "git diff alias.test.ts",
  "ls src/a.ts",
  "git fetch -q origin",
  "git fetch origin --prune",
  "git fetch origin 2>&1 | tail -5",
  "git fetch origin 2> err.txt",
  "git ls-remote origin chore/x",
  "git -C c:\\Projekty\\Krajozbior\\krajozbior-docs fetch -q origin",
  "git -C c:\\Projekty\\Krajozbior\\krajozbior-docs rev-parse --short origin/main",
  "git -C c:\\Projekty\\Krajozbior\\krajozbior-docs pull --ff-only origin main",
  "git push origin fix/git",
  "git push -u origin chore/git-hooks",
  "git pull --ff-only origin main",
  "git pull",
  "git status --short",
  "git log --oneline origin/main..HEAD",
  "git rev-parse HEAD",
  "git stash list",
  "git branch --show-current",
  "git worktree add .worktrees/ws-7 -b feat/y origin/main",
  "git add tests/scripts/block-remote-access-hook.test.ts",
  "git restore --staged x.ts",
  "git cherry-pick abc1234",
  "git grep -n findRemoteAccess -- tests",
  "git remote get-url --push origin",
  "git config user.name",
  "git config --get-regexp remote",
  "gh pr view 59 --json headRefOid,mergeStateStatus",
  "gh pr ready 59",
  "gh issue list --repo example/repo-docs --state open",
  // Text in quotes is not a command (review v3, S1).
  'git commit -m "fix: git push bez potwierdzenia"',
  'gh pr create --title "chore: git pull przed scaleniem" --body-file .ai/tmp/k16-v4/pr-body.md',
  'gh pr comment 59 --body "uruchom git fetch upstream"',
  'rg "git push" docs/',
  'grep -rn "git clone" docs',
  'echo "git fetch prod"',
  "bash -c \"git commit -m 'fix: git push prod'\"",
  'powershell -NoProfile -Command "git status"',
];

const allowed = [
  "git status",
  "git diff origin/main...HEAD",
  "git add -A",
  "git commit -F .ai/tmp/k16/msg.txt",
  'git -c user.name="Jan Kowalski" -c user.email=123456+JanKowalski@users.noreply.github.com commit -F msg.txt',
  "git push -u origin chore/k16-blokada-zdalnego-dostepu",
  "git fetch origin",
  "git fetch origin main:main",
  "git fetch origin release-1.2:release-1.2",
  "git push origin HEAD",
  "git show HEAD:.env.example",
  "git show origin/main:package.json",
  "git log --oneline origin/main..HEAD",
  "git merge origin/main",
  "git rebase --exec 'npm test' main",
  "git tag v1.2.3",
  "git clone https://github.com/example/repo.git",
  "git remote -v",
  "git worktree add .worktrees/ws-9 -b feature origin/main",
  "git -C ../krajozbior-docs log --oneline -5",
  "git -C ../krajozbior-docs commit -F msg.txt",
  "gh pr list --state all --limit 5",
  "gh pr view 59 --json url,state",
  "gh pr create --draft --title x --body-file .ai/tmp/k16-v2/pr-body.md",
  "gh pr merge 59 --auto --squash",
  "gh api repos/example/repo/pulls/59",
  "npm run lint",
  "npm run test:unit",
  "npm run db:migrate",
  "npm i -D @types/node@22",
  "npx vitest run tests/scripts",
  "npx prettier --write src/app/page.tsx",
  "node --version",
  "docker run -d --name pg -p 55442:5432 postgres:17",
  "docker run --hostname web nginx",
  "docker pull node@sha256:0123abcd",
  "curl http://localhost:3100/api/health",
  "DATABASE_URL=postgres://user:pass@localhost:55442/app npm run test:integration",
  "HOSTNAME=0.0.0.0 node server.js",
  "powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1",
  "powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-up.ps1",
  'pwsh -NoProfile -Command "Get-ChildItem src"',
  "Get-ChildItem src",
  "Get-ChildItem src -Recurse -Filter *.ts",
  "Write-Host done",
  "grep -ho pattern src/app/page.tsx",
  "rg pattern src",
  "cat docs/architecture.md",
  "hostname",
  "echo hostname",
  // Words that merely contain the letters of a protected name.
  "cat docs/sshd-notes.md",
  "ls openssh-notes",
  "cat ssh_config.md",
  "cat ssh-copy-id.md",
  "rg classhandler src",
  "cat notes.ssh.md",
  "cat my.ssh",
  "ls .sshfoo",
  "ls .github",
  "scp-notes.txt",
  "cat deploy/wdroz.ps1",
  "docker compose -f deploy/compose.showcase.yaml config",
  "ls .data",
  "ls .data/deploy",
  "cat .data/deploy/report.txt",
];

// Deliberately not caught: the hook reads text, it does not run a shell. These
// pass today; if the hook ever catches one, move it to `blocked`.
const knownLimitations = [
  // A name assembled at run time.
  "& ('s'+'sh') -V",
  "$c='ss'+'h'; & $c -V",
  "s${x}sh -V",
  "iex ('s{0}h -V' -f 's')",
  "cmd /c s%x%sh -V",
  // Wildcards that the shell expands to the client.
  "/usr/bin/ss? -V",
  "s[s]h -V",
  // Encoding outside PowerShell's own switch.
  'bash -c "$(echo c3NoIC1W | base64 -d)"',
  // A script written to a file first, or another interpreter.
  "powershell -ExecutionPolicy Bypass -File .ai/tmp/connect.ps1",
  "node .ai/tmp/connect.mjs",
  'python -c "import paramiko"',
  // Git settings prepared outside the command with a file tool: `origin` of
  // another repository, programs git runs locally.
  "git -C ../prepared-repo fetch origin",
  "git -c core.fsmonitor=.ai/tmp/x.cmd status",
  // Arguments assembled at run time.
  "Invoke-Expression ('git fetch ' + 'prod')",
  // Other wildcard paths to keys and secrets.
  "cat ~/.*/id_*",
  "cat ~/*/id_ed25519",
  "cat ~/.config/*/wdroz.config",
  // Reaching the protected folders step by step or from the parent folder.
  "cd .data; cd showcase; cat outbox/latest.json",
  "rg -uu secret ..",
];

// Long one-line commands without separators: every pattern must stay linear,
// or the hook runs past its time limit (which does not block).
const longCommands: Array<[string, string]> = [
  ["spaces", " ".repeat(20_000)],
  ["dashes", "-".repeat(20_000)],
  ["repeated --u", "--u".repeat(6_667)],
  ["repeated --u with spaces", "git ls-remote " + "--u ".repeat(5_000)],
  ["repeated git clone", "git clone ".repeat(2_000)],
  ["repeated git push", "git push ".repeat(2_223)],
  ["repeated .data/", ".data/".repeat(3_334)],
  ["repeated a@", "a@".repeat(10_000)],
  ["repeated @[", "a@[".repeat(6_667)],
  ["repeated krajozbior", "krajozbior".repeat(2_000)],
  ["repeated @{", "@{".repeat(10_000)],
  ["repeated quotes", "'".repeat(20_000) + "x"],
  ["repeated remote.", "git config remote." + ".url=".repeat(4_000)],
  ["repeated powershell", "powershell ".repeat(1_819)],
  ["repeated ../", "cat " + "../".repeat(6_666)],
  ["repeated git -c git", "git -c git ".repeat(2_000)],
  ["repeated git fetch origin", "git fetch origin ".repeat(1_177)],
  ["repeated git config", "git config a ".repeat(1_539)],
  ["repeated $(", "$(".repeat(10_000)],
  ["repeated backticks", "`".repeat(20_000)],
  ["repeated bash -c", 'bash -c "'.repeat(2_000)],
  ["repeated 2>", "git 2>".repeat(3_334)],
];
// The same shapes at 100 000 characters.
const veryLongCommands: Array<[string, string]> = [
  ["spaces", " ".repeat(100_000)],
  ["repeated git push", "git push ".repeat(11_112)],
  ["repeated git fetch origin", "git fetch origin ".repeat(5_883)],
  ["repeated git -c git", "git -c git ".repeat(10_000)],
  ["repeated git config", "git config a ".repeat(7_693)],
  ["repeated .data/", ".data/".repeat(16_667)],
  ["repeated $(", "$(".repeat(50_000)],
  ["repeated quotes", "'".repeat(100_000) + "x"],
  ["repeated bash -c", 'bash -c "'.repeat(10_000)],
];

describe("findRemoteAccess", () => {
  it.each(blocked)("blocks: %s", (command) => {
    expect(findRemoteAccess(command).length).toBeGreaterThan(0);
  });

  it.each(allowed)("allows: %s", (command) => {
    expect(findRemoteAccess(command)).toEqual([]);
  });

  it.each(bypassesFromReview)("blocks a bypass from the third review: %s", (command) => {
    expect(findRemoteAccess(command).length).toBeGreaterThan(0);
  });

  it.each(everyday)("allows an everyday command: %s", (command) => {
    expect(findRemoteAccess(command)).toEqual([]);
  });

  it("checks at least 100 everyday commands", () => {
    expect(everyday.length).toBeGreaterThanOrEqual(100);
  });

  it("names what it found, without duplicates", () => {
    expect(findRemoteAccess("ssh -V")).toEqual(["ssh"]);
    expect(findRemoteAccess("ssh a; ssh b")).toEqual(["ssh"]);
    expect(findRemoteAccess("ssh-keygen -f ~/.ssh/id")).toEqual(
      expect.arrayContaining(["ssh-keygen", ".ssh"]),
    );
    expect(findRemoteAccess("grep -r code .data")).toEqual([".data (rekurencyjnie)"]);
  });

  it.each([
    "git",
    "git -c",
    "git -C",
    "git fetch --depth",
    "git push --repo",
    "git remote",
    "git remote add",
    "git submodule",
    "powershell",
    "pwsh -",
    'git "',
    "'",
    '"',
    "\\",
    "`",
    "^",
    "",
  ])("does not throw on an unfinished command: %s", (command) => {
    expect(() => findRemoteAccess(command)).not.toThrow();
  });

  it("ignores a command that is not a string", () => {
    expect(findRemoteAccess(undefined)).toEqual([]);
    expect(findRemoteAccess(null)).toEqual([]);
    expect(findRemoteAccess(42)).toEqual([]);
  });
});

describe("known limitations (not caught, by design)", () => {
  it.each(knownLimitations)("not caught: %s", (command) => {
    expect(findRemoteAccess(command)).toEqual([]);
  });
});

describe("speed on a 20 000-character line", () => {
  it.each(longCommands)("checks %s in under 100 ms", (_, command) => {
    findRemoteAccess(command);
    const start = performance.now();
    findRemoteAccess(command);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it.each(veryLongCommands)("checks %s (100 000 characters) in under 100 ms", (_, command) => {
    findRemoteAccess(command);
    const start = performance.now();
    findRemoteAccess(command);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("blocks a forbidden command followed by a long tail", () => {
    const result = runHook(shellEvent("Bash", `ssh -V # ${"git clone ".repeat(2_000)}`));
    expect(result.status).toBe(2);
  });
});

describe("block-remote-access hook (real process)", () => {
  it("is registered for both shell tools", () => {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const shellEntry = settings.hooks.PreToolUse.find(
      (entry: { matcher: string }) => entry.matcher === "Bash|PowerShell",
    );
    const commands = shellEntry.hooks.map((hook: { command: string }) => hook.command);
    expect(commands).toContain('node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-remote-access.mjs"');
  });

  it("blocks `ssh -V` in Bash with exit 2 and a reason", () => {
    const result = runHook(shellEvent("Bash", "ssh -V"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("D-E11-4");
    expect(result.stderr).toContain("security-notes.md");
    expect(result.stderr).toContain("git commit -F");
  });

  it("blocks a PowerShell command that uses ssh.exe", () => {
    const result = runHook(
      shellEvent("PowerShell", "& 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' -V"),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ssh.exe");
  });

  it("blocks git reaching a server over SSH", () => {
    expect(runHook(shellEvent("Bash", "git ls-remote deploy@example.com:repo.git")).status).toBe(2);
  });

  it("blocks a read of the .ssh folder", () => {
    expect(runHook(shellEvent("Bash", "cat ~/.ssh/config")).status).toBe(2);
  });

  it("blocks the deployment secrets folder", () => {
    expect(runHook(shellEvent("PowerShell", "ls ..\\krajozbior-deploy")).status).toBe(2);
  });

  it("blocks ssh-copy-id and a read of the showcase data", () => {
    expect(runHook(shellEvent("Bash", "ssh-copy-id user@example.com")).status).toBe(2);
    expect(
      runHook(shellEvent("PowerShell", "Get-Content .data\\showcase\\outbox\\latest.json")).status,
    ).toBe(2);
  });

  it("lets an ordinary command through", () => {
    const result = runHook(shellEvent("Bash", "git status"));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("lets a commit with the message in a file through", () => {
    expect(runHook(shellEvent("Bash", "git commit -F .ai/tmp/k16/msg.txt")).status).toBe(0);
  });

  it("blocks an event without a command text (fail closed)", () => {
    expect(runHook({ tool_name: "Bash", tool_input: {} }).status).toBe(2);
    expect(runHook({ tool_name: "Bash", tool_input: { command: 42 } }).status).toBe(2);
    expect(runHook({ tool_name: "Bash" }).status).toBe(2);
    expect(runHook({}).status).toBe(2);
  });

  it("blocks a malformed event (fail closed)", () => {
    const result = runHook("not json");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nieczytelne zdarzenie");
  });

  it("blocks an empty input", () => {
    expect(runHook("").status).toBe(2);
  });

  it("tells how to reach the server within the allow list", () => {
    const push = runHook(shellEvent("Bash", "git push prod main"));
    expect(push.status).toBe(2);
    expect(push.stderr).toContain("git push -u origin <gałąź>");
    const fetch = runHook(shellEvent("PowerShell", "git --attr-source HEAD fetch prod"));
    expect(fetch.status).toBe(2);
    expect(fetch.stderr).toContain("git fetch origin");
  });

  it("blocks every command when the shared module is missing (exit 2, not 1)", () => {
    const folder = mkdtempSync(join(tmpdir(), "block-remote-access-"));
    try {
      const copy = join(folder, "block-remote-access.mjs");
      writeFileSync(copy, readFileSync(script, "utf8"));
      const result = spawnSync(process.execPath, [copy], {
        input: JSON.stringify(shellEvent("Bash", "git status")),
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("shell-text");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
