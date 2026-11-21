import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// F-K4 (E11): the PowerShell side of the deployment (scripts/ops/deploy-lib.ps1) is tested without a
// server: configuration, commit check, vault text, payload, report masking, host key pinning.
// The owner runs Windows PowerShell 5.1; CI runs the same file in PowerShell 7 (`pwsh`).
// Nothing here opens a connection, reads the secrets folder or runs deploy.ps1.

const root = process.cwd();
const OPS_DIR = join(root, "scripts/ops");
const LIB = join(OPS_DIR, "deploy-lib.ps1");
const PS_SCRIPTS = ["deploy-lib.ps1", "deploy.ps1", "wdroz.template.ps1", "new-deploy-secrets.ps1"];

function findPowerShell(): string | undefined {
  for (const candidate of process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["pwsh"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });

      return candidate;
    } catch {
      // try the next one
    }
  }

  return undefined;
}

const powershell = findPowerShell();
const requirePowerShell = process.env.CI === "true";

if (powershell === undefined && !requirePowerShell) {
  console.warn(
    "tests/scripts/ops-deploy-lib: PowerShell is not installed, so these tests are skipped.",
  );
}

const psIt = it.skipIf(powershell === undefined && !requirePowerShell);

type Run = { status: number; stdout: string; stderr: string };

function ps(script: string): Run {
  const result = spawnSync(
    powershell ?? "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference = 'Stop'; . '${LIB.replaceAll("'", "''")}'; ${script}`,
    ],
    { encoding: "utf8" },
  );

  return { status: result.status ?? -1, stdout: result.stdout.trim(), stderr: result.stderr };
}

function psJson<T>(expression: string): T {
  // -InputObject keeps a one-element array an array (a pipeline would unwrap it).
  const result = ps(`ConvertTo-Json -Compress -Depth 4 -InputObject $(${expression})`);

  expect(result.status, result.stderr).toBe(0);

  return JSON.parse(result.stdout) as T;
}

const psString = (value: string) => `'${value.replaceAll("'", "''")}'`;

describe("PowerShell scripts", () => {
  for (const script of PS_SCRIPTS) {
    psIt(`${script} parses without errors`, () => {
      const path = join(OPS_DIR, script);
      const result = ps(
        `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile(${psString(path)}, [ref]$null, [ref]$errors); $errors.Count`,
      );

      expect(result.stdout, result.stderr).toBe("0");
    });
  }

  it("are ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI)", () => {
    for (const script of PS_SCRIPTS) {
      expect(readFileSync(join(OPS_DIR, script), "utf8"), script).toMatch(/^[\t\r\n\x20-\x7e]*$/);
    }
  });

  it("never print secrets and never use the agent of the remote shell", () => {
    for (const script of PS_SCRIPTS) {
      const text = readFileSync(join(OPS_DIR, script), "utf8");

      expect(text, script).not.toMatch(
        /Write-(Host|Output)[^\n]*\$(vault|ownerPw|opsPw|brevo|adminPw|restoreKey)\b/i,
      );
      expect(text, script).not.toMatch(/ssh-agent|ssh-add/);
    }
  });
});

describe("serwer.conf (Read-DeployConfig)", () => {
  psIt("reads the address, defaults and optional keys", () => {
    const config = psJson<Record<string, unknown>>(
      `Read-DeployConfig "# komentarz\`nAddress=192.0.2.10\`nBackupPublicKey=age1${"q".repeat(58)}\`nReportDir=C:\\x\\.data\\deploy"`,
    );

    expect(config).toMatchObject({
      Address: "192.0.2.10",
      Port: 22,
      SiteHost: "krajozbior.pl",
      EmailFrom: "noreply@krajozbior.pl",
      BackupPublicKey: `age1${"q".repeat(58)}`,
    });
  });

  for (const [text, message] of [
    ["Port=22", "Address must be"],
    ["Address=300.1.1.1", "Address must be"],
    ["Address=192.0.2.10\nPort=0", "Port must be"],
    ["Address=192.0.2.10\nUser=root", "unknown key User"],
    ["Address=192.0.2.10\nBackupPublicKey=age1abc", "BackupPublicKey must be"],
    ["Address=192.0.2.10\nHealthcheckBackupUrl=http://x", "HealthcheckBackupUrl must be"],
    ["Address=192.0.2.10\nbroken", "expected KEY=VALUE"],
  ] as const) {
    psIt(`refuses: ${message} (${text.split("\n").at(-1)})`, () => {
      const result = ps(`Read-DeployConfig ${psString(text)}`);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
    });
  }
});

describe("validation helpers", () => {
  psIt("accepts only full lowercase commit hashes", () => {
    const sha = "a".repeat(40);

    expect(
      psJson<boolean[]>(
        `@((Test-CommitSha '${sha}'), (Test-CommitSha 'abc1234'), (Test-CommitSha '${sha.toUpperCase()}'), (Test-CommitSha '${sha}; rm'))`,
      ),
    ).toEqual([true, false, false, false]);
  });

  psIt("refuses an audit reason with an e-mail address, a quote or a new line", () => {
    expect(
      psJson<boolean[]>(
        `@((Test-AuditReason 'Pierwszy administrator serwisu'), (Test-AuditReason 'dla jan@example.com'), (Test-AuditReason "a'b c"), (Test-AuditReason 'ab'))`,
      ),
    ).toEqual([true, false, false, false]);
  });

  psIt("recognises age keys by their alphabet", () => {
    expect(
      psJson<boolean[]>(
        `@((Test-AgePublicKey 'age1${"q".repeat(58)}'), (Test-AgePublicKey 'age1${"b".repeat(58)}'), (Test-AgeSecretKey 'AGE-SECRET-KEY-1${"Q".repeat(58)}'), (Test-AgeSecretKey 'age-secret-key-1${"q".repeat(58)}'))`,
      ),
    ).toEqual([true, false, true, false]);
  });
});

describe("vault text (magazyn.age before encryption)", () => {
  psIt("generates two different 48-character hex passwords and reads them back", () => {
    const vault = psJson<{ Owner: string; Ops: string }>("ConvertFrom-VaultText (New-VaultText)");

    expect(vault.Owner).toMatch(/^[0-9a-f]{48}$/);
    expect(vault.Ops).toMatch(/^[0-9a-f]{48}$/);
    expect(vault.Owner).not.toBe(vault.Ops);
  });

  psIt("refuses a vault without the ops password, without printing values", () => {
    const result = ps(`ConvertFrom-VaultText "KRAJOZBIOR_OWNER_DB_PASSWORD=${"a".repeat(48)}"`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing or invalid KRAJOZBIOR_OPS_DB_PASSWORD");
    expect(result.stderr).not.toContain("a".repeat(48));
  });
});

describe("payload for the server", () => {
  psIt("quotes plain values, encodes secrets and wraps everything in one block", () => {
    const result = ps(
      `$p = New-RemotePreamble @{ KZ_MODE = 'commit'; KZ_COMMIT = '${"b".repeat(40)}' } @{ KZ_OWNER_PW = 'tajne-haslo-123' }; New-RemotePayload "lib\`r\`n" $p 'mode'`,
    );
    const encoded = Buffer.from("tajne-haslo-123").toString("base64");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split(/\r?\n/)).toEqual([
      "{",
      "set -euo pipefail",
      "exec 2>&1 </dev/null",
      "lib",
      "",
      `KZ_COMMIT='${"b".repeat(40)}'`,
      "KZ_MODE='commit'",
      `KZ_OWNER_PW="$(kz_b64 '${encoded}')"`,
      "mode",
      "kz_main",
      "}",
    ]);
    expect(result.stdout).not.toContain("tajne-haslo-123");
  });

  psIt("refuses a plain value with a quote (no shell injection through the preamble)", () => {
    const result = ps(`New-RemotePreamble @{ KZ_REASON = "a'; rm -rf /; '" } @{}`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("may not contain a quote");
  });

  psIt("decodes in bash to the original UTF-8 text", () => {
    const result = ps(`New-RemotePreamble @{} @{ KZ_ORG_NAME = 'Krajozbi' + [char]0x00F3 + 'r' }`);
    const encoded = /kz_b64 '([^']+)'/.exec(result.stdout)?.[1] ?? "";

    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("Krajozbiór");
  });
});

describe("payload end to end (PowerShell builds it, bash runs it)", () => {
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
  const bashPresent = (() => {
    try {
      execFileSync(bash, ["-c", "true"], { stdio: "ignore" });

      return true;
    } catch {
      return false;
    }
  })();
  const bothIt = it.skipIf((powershell === undefined || !bashPresent) && !requirePowerShell);

  bothIt("decodes the secrets, keeps UTF-8 and leaves nothing on standard input", () => {
    const directory = mkdtempSync(join(tmpdir(), "krajozbior-payload-"));
    const payloadFile = join(directory, "payload.sh");
    const libFile = join(root, "scripts/ops/server/lib.sh");
    const modeText =
      'kz_main() { printf \'mode=%s pw=%s name=%s\\n\' "$KZ_MODE" "$KZ_OWNER_PW" "$KZ_ORG_NAME"; if read -r _; then echo stdin-not-empty; else echo stdin-empty; fi; }';
    const build = ps(
      `$p = New-RemotePayload ([IO.File]::ReadAllText(${psString(libFile)})) (New-RemotePreamble @{ KZ_MODE = 'diagnoza' } @{ KZ_OWNER_PW = 'a b"c$d'; KZ_ORG_NAME = 'Krajozbi' + [char]0x00F3 + 'r' }) ${psString(modeText)}; [IO.File]::WriteAllText(${psString(payloadFile)}, $p, (New-Object Text.UTF8Encoding($false)))`,
    );

    expect(build.status, build.stderr).toBe(0);

    const output = execFileSync(bash, ["-s"], {
      input: readFileSync(payloadFile),
      encoding: "utf8",
    });

    expect(output).toBe('mode=diagnoza pw=a b"c$d name=Krajozbiór\nstdin-empty\n');
  });
});

describe("report masking (Protect-ReportLine)", () => {
  psIt("masks secrets, the server address, e-mail and IP addresses", () => {
    const result = ps(
      `Protect-ReportLine 'login jan@example.com z 203.0.113.9 haslo sekret-123 serwer v123.example.net o 10:00:00 ip 2001:db8::1' @('sekret-123') 'v123.example.net'`,
    );

    expect(result.stdout).toBe(
      "login <e-mail> z <ip> haslo <sekret> serwer <serwer> o 10:00:00 ip <ip>",
    );
  });
});

describe("host key pinning", () => {
  // A real-shaped ED25519 key blob: string "ssh-ed25519" + 32 bytes.
  const blob = Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from("ssh-ed25519"),
    Buffer.from([0, 0, 0, 32]),
    Buffer.alloc(32, 7),
  ]).toString("base64");

  psIt("takes the ED25519 key from the scan and computes the OpenSSH fingerprint", () => {
    // A PowerShell string with `n: a multi-line argument would break the -Command line.
    const scan = `"# 192.0.2.10:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu\`n192.0.2.10 ssh-rsa AAAAB3Nza\`n192.0.2.10 ssh-ed25519 ${blob}\`n"`;
    const result = psJson<{ Type: string; Key: string; Fingerprint: string }>(
      `$k = ConvertFrom-HostKeyScan ${scan}; @{ Type = $k.Type; Key = $k.Key; Fingerprint = (Get-HostKeyFingerprint $k.Key) }`,
    );
    const expected = `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`;

    expect(result).toEqual({ Type: "ssh-ed25519", Key: blob, Fingerprint: expected });
  });

  psIt("refuses a scan without an ED25519 key", () => {
    const result = ps(`ConvertFrom-HostKeyScan '192.0.2.10 ssh-rsa AAAA'`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no ED25519 host key");
  });

  psIt("writes the known_hosts line, with brackets only for a non-standard port", () => {
    expect(
      psJson<string[]>(
        `@((New-KnownHostsLine '192.0.2.10' 22 'ssh-ed25519' 'AAA'), (New-KnownHostsLine '192.0.2.10' 2222 'ssh-ed25519' 'AAA'))`,
      ),
    ).toEqual(["192.0.2.10 ssh-ed25519 AAA", "[192.0.2.10]:2222 ssh-ed25519 AAA"]);
  });
});

describe("connection arguments", () => {
  psIt("pin the host key, use only our key and never an agent", () => {
    const args = psJson<string[]>(
      `Get-RemoteShellArgs 'C:\\Users\\x\\k' 'C:\\Users\\x\\kh' (Get-RemoteUser 'commit') '192.0.2.10' 22`,
    );

    expect(args).toEqual(
      expect.arrayContaining([
        "IdentitiesOnly=yes",
        "IdentityAgent=none",
        "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=C:\\Users\\x\\kh",
        "deploy@192.0.2.10",
      ]),
    );
    expect(args.at(-1)).toBe("bash -s");
  });

  psIt("connect as root only for the bootstrap", () => {
    expect(
      psJson<string[]>(
        `@('bootstrap','initial','commit','admin') | ForEach-Object { Get-RemoteUser $_ }`,
      ),
    ).toEqual(["root", "deploy", "deploy", "deploy"]);
  });

  psIt("quote a command line for Windows PowerShell 5.1", () => {
    const result = ps(
      `Join-NativeArgs @('-i', 'C:\\Program Files\\k', '-o', 'A=B', 'say "hi"', 'bash -s')`,
    );

    expect(result.stdout).toBe('-i "C:\\Program Files\\k" -o A=B "say \\"hi\\"" "bash -s"');
  });
});
