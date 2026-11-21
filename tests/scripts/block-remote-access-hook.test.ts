import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findRemoteAccess } from "../../.claude/hooks/block-remote-access.mjs";

// The Claude Code hook that refuses shell commands reaching a server or SSH keys
// when the command text says so: SSH clients and relatives, rsync, PuTTY tools,
// git used as an SSH transport, PowerShell remoting and encoded commands, any
// `.ssh` folder, the folder with deployment secrets (`krajozbior-deploy`) and the
// local showcase data (`.data/showcase`). It reads text only: the "known
// limitations" list documents what it deliberately does not catch, so nobody
// takes it for a security boundary (that is the deployment passphrase).
// The process tests run the real script with a hook event on stdin, as Claude
// Code does: exit 2 blocks (also a malformed event), exit 0 lets it through.
const script = fileURLToPath(
  new URL("../../.claude/hooks/block-remote-access.mjs", import.meta.url),
);
const settingsPath = fileURLToPath(new URL("../../.claude/settings.json", import.meta.url));

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
  "Some-Cmdlet -HostNa example.com",
  "Some-Cmdlet -SSHT",
  // PowerShell encoded commands (the agent never needs them).
  "powershell -EncodedCommand ZQBjAGgAbwA=",
  "pwsh -enc ZQBjAGgAbwA=",
  "powershell -ec ZQBjAGgAbwA=",
  "powershell.exe -NoProfile -e ZQBjAGgAbwA=",
  "pwsh /enc ZQBjAGgAbwA=",
  "Start-Process powershell -ArgumentList '-enc ZQBjAGgAbwA='",
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
  // The folder with deployment secrets, also as a wildcard.
  "ls ../krajozbior-deploy",
  "cat C:\\Users\\jan\\krajozbior-deploy\\wdroz.config",
  "Get-ChildItem KRAJOZBIOR-DEPLOY",
  "ls ../krajozbior-dep*",
  "cat ../krajozbior-d*/wdroz.config",
  "ls ..\\krajozbior*",
  "Get-ChildItem C:\\x\\Krajozbior\\*",
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
  // Strict by design: the hook reads the whole text of the command.
  "git commit -m 'opis ze slowem ssh'",
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
  "git push origin HEAD:refs/heads/feature",
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
  // A remote configured earlier (the URL is not in the text) or an SSH alias.
  "git fetch prod",
  "git fetch prod:app.git",
  // Reaching the protected folders step by step or from the parent folder.
  "cd .data; cd showcase; cat outbox/latest.json",
  "rg -uu secret ..",
];

describe("findRemoteAccess", () => {
  it.each(blocked)("blocks: %s", (command) => {
    expect(findRemoteAccess(command).length).toBeGreaterThan(0);
  });

  it.each(allowed)("allows: %s", (command) => {
    expect(findRemoteAccess(command)).toEqual([]);
  });

  it("names what it found, without duplicates", () => {
    expect(findRemoteAccess("ssh -V")).toEqual(["ssh"]);
    expect(findRemoteAccess("ssh a; ssh b")).toEqual(["ssh"]);
    expect(findRemoteAccess("ssh-keygen -f ~/.ssh/id")).toEqual(
      expect.arrayContaining(["ssh-keygen", ".ssh"]),
    );
    expect(findRemoteAccess("grep -r code .data")).toEqual([".data (rekurencyjnie)"]);
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
});
