import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findRemoteAccess } from "../../.claude/hooks/block-remote-access.mjs";

// The Claude Code hook that refuses shell commands reaching a server or SSH keys:
// ssh and related clients, PuTTY tools, PowerShell remoting over SSH, any `.ssh`
// folder, the folder with deployment secrets (`krajozbior-deploy`) and the local
// showcase data (`.data/showcase`). The
// process tests run the real script with a hook event on stdin, as Claude Code
// does: exit 2 blocks, exit 0 lets it through, exit 1 is a malformed event.
const script = fileURLToPath(
  new URL("../../.claude/hooks/block-remote-access.mjs", import.meta.url),
);

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
  // PuTTY tools.
  "plink -V",
  "plink.exe user@example.com",
  "pscp file.txt user@example.com:/tmp",
  "psftp example.com",
  "putty -load session",
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
  // PowerShell remoting over SSH.
  "Enter-PSSession -HostName example.com -UserName jan",
  "New-PSSession -SSHTransport -HostName example.com",
  "Invoke-Command -hostname example.com -ScriptBlock { 1 }",
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
  // The folder with deployment secrets.
  "ls ../krajozbior-deploy",
  "cat C:\\Users\\jan\\krajozbior-deploy\\wdroz.config",
  "Get-ChildItem KRAJOZBIOR-DEPLOY",
  // The local showcase data (sign-in codes in its outbox).
  "cat .data/showcase/outbox/latest.json",
  "Get-Content .data\\showcase\\outbox\\latest.json",
  "ls C:\\Projekty\\krajozbior\\.data\\showcase",
  "Get-ChildItem .DATA/Showcase",
  // Strict by design: the hook reads the whole text of the command.
  "git commit -m 'opis ze slowem ssh'",
];

const allowed = [
  "git status",
  "git diff origin/main...HEAD",
  "git add -A",
  "git commit -F .ai/tmp/k16/msg.txt",
  "npm run lint",
  "npx vitest run tests/scripts",
  "node --version",
  "powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1",
  "gh pr list --state all --limit 5",
  "Get-ChildItem src",
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
  "ls .data/deploy",
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
  });

  it("ignores a command that is not a string", () => {
    expect(findRemoteAccess(undefined)).toEqual([]);
    expect(findRemoteAccess(null)).toEqual([]);
    expect(findRemoteAccess(42)).toEqual([]);
  });
});

describe("block-remote-access hook (real process)", () => {
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

  it("lets an event without a command through", () => {
    expect(runHook({ tool_name: "Bash", tool_input: {} }).status).toBe(0);
    expect(runHook({ tool_name: "Bash" }).status).toBe(0);
    expect(runHook({}).status).toBe(0);
  });

  it("exits 1 for a malformed event (a hook bug, not a block)", () => {
    const result = runHook("not json");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nieczytelne zdarzenie");
  });

  it("exits 1 for an empty input", () => {
    expect(runHook("").status).toBe(1);
  });
});
