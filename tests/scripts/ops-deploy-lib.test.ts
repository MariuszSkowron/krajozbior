import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Starting PowerShell processes is slow on Windows under load (review F-K4, N3).
vi.setConfig({ testTimeout: 30_000 });

// F-K4 (E11): the PowerShell side of the deployment (scripts/ops/deploy-lib.ps1) is tested without a
// server: configuration, commit check, vault text, payload, report masking, host key pinning.
// The owner runs Windows PowerShell 5.1; CI runs the same file in PowerShell 7 (`pwsh`).
// Nothing here opens a connection, reads the secrets folder or runs deploy.ps1.

const root = process.cwd();
const OPS_DIR = join(root, "scripts/ops");
const LIB = join(OPS_DIR, "deploy-lib.ps1");
const PS_SCRIPTS = [
  "deploy-lib.ps1",
  "deploy.ps1",
  "deploy-showcase.ps1",
  "wdroz.template.ps1",
  "new-deploy-secrets.ps1",
];
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

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
      // The catch prints the plain message: PowerShell's own error view wraps long messages at
      // the console width (80 columns on Linux CI), which would split the phrases checked below.
      `$ErrorActionPreference = 'Stop'; try { . '${LIB.replaceAll("'", "''")}'; ${script} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
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

const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

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

  bothIt("carries an import file byte for byte (base64 + SHA-256 checked in bash)", () => {
    const directory = mkdtempSync(join(tmpdir(), "krajozbior-payload-"));
    const payloadFile = join(directory, "payload.sh");
    const libFile = join(root, "scripts/ops/server/lib.sh");
    const modeText =
      "kz_main() { printf '%s' \"$KZ_IMPORT_B64\" | base64 -d | sha256sum | cut -d' ' -f1; echo \"$KZ_IMPORT_SHA256\"; }";
    const build = ps(
      `$b = [Text.Encoding]::UTF8.GetBytes('{"title":"Zamki ' + [char]0x0142 + 'ysiny"}' + [char]10); $p = New-RemotePayload ([IO.File]::ReadAllText(${psString(libFile)})) (New-RemotePreamble @{ KZ_IMPORT_B64 = [Convert]::ToBase64String($b); KZ_IMPORT_SHA256 = (Get-Sha256Hex $b) } @{}) ${psString(modeText)}; [IO.File]::WriteAllText(${psString(payloadFile)}, $p, (New-Object Text.UTF8Encoding($false)))`,
    );

    expect(build.status, build.stderr).toBe(0);

    const [decoded, expected] = execFileSync(bash, ["-s"], {
      input: readFileSync(payloadFile),
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    const original = createHash("sha256").update('{"title":"Zamki łysiny"}\n').digest("hex");

    expect(decoded).toBe(original);
    expect(expected).toBe(original);
  });
});

describe("mode import: checks on the owner's computer (F-K6)", () => {
  const IMPORT_DIR = "C:\\Projekty\\kolekcje";
  const SECRETS = "C:\\Users\\a\\.config\\krajozbior-deploy";
  const problem = (path: string, importDir = IMPORT_DIR, secrets = SECRETS) =>
    psJson<string>(
      `Get-ImportFileProblem ${psString(path)} ${psString(importDir)} ${psString(secrets)}`,
    );

  psIt("serwer.conf: ImportDir must be a full path", () => {
    expect(
      psJson<Record<string, unknown>>(
        `Read-DeployConfig "Address=192.0.2.10\`nImportDir=C:\\x\\kolekcje"`,
      ),
    ).toMatchObject({ ImportDir: "C:\\x\\kolekcje" });

    const relative = ps(`Read-DeployConfig "Address=192.0.2.10\`nImportDir=kolekcje"`);

    expect(relative.status).not.toBe(0);
    expect(relative.stderr).toContain("ImportDir must be a full path");
  });

  psIt("accepts a *-public.ndjson file inside ImportDir (any letter case of the folder)", () => {
    expect(problem(`${IMPORT_DIR}\\fala-1-public.ndjson`)).toBe("");
    expect(problem("c:\\projekty\\KOLEKCJE\\sub\\fala_2.v1-public.ndjson")).toBe("");
  });

  for (const [path, message] of [
    ["", "Brak pliku"],
    ["fala-1-public.ndjson", "pelna sciezke"],
    [`${IMPORT_DIR}\\fala-1.ndjson`, "Zla nazwa pliku"],
    [`${IMPORT_DIR}\\fala-1-public.ndjson.pem`, "Zla nazwa pliku"],
    [`${IMPORT_DIR}\\-public.ndjson`, "Zla nazwa pliku"],
    [`${SECRETS}\\ssh\\id_ed25519`, "Zla nazwa pliku"],
    ["C:\\Projekty\\inne\\fala-1-public.ndjson", "folderze ImportDir"],
    [`${IMPORT_DIR}\\..\\inne\\fala-1-public.ndjson`, "folderze ImportDir"],
    ["C:\\Projekty\\kolekcje-obok\\fala-1-public.ndjson", "folderze ImportDir"],
    [`${SECRETS}\\fala-1-public.ndjson`, "folderze sekretow"],
  ] as const) {
    psIt(`refuses ${path || "(empty)"}: ${message}`, () => {
      expect(problem(path)).toContain(message);
    });
  }

  psIt("refuses a file in the secrets folder even when ImportDir contains it", () => {
    expect(problem(`${SECRETS}\\repo\\fala-1-public.ndjson`, "C:\\Users\\a")).toContain(
      "folderze sekretow",
    );
  });

  psIt("refuses without ImportDir in serwer.conf", () => {
    expect(problem(`${IMPORT_DIR}\\fala-1-public.ndjson`, "")).toContain("nie ma ImportDir");
  });

  psIt("on disk: missing, empty and too large files are refused; a normal file passes", () => {
    const directory = mkdtempSync(join(tmpdir(), "krajozbior-import-"));
    const ok = join(directory, "fala-public.ndjson");
    const empty = join(directory, "pusty-public.ndjson");
    const big = join(directory, "duzy-public.ndjson");

    writeFileSync(ok, '{"type":"batch"}\n');
    writeFileSync(empty, "");
    writeFileSync(big, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));

    const disk = (path: string) =>
      psJson<string>(`Get-ImportFileDiskProblem ${psString(path)} ${psString(directory)}`);

    expect(disk(ok)).toBe("");
    expect(disk(join(directory, "brak-public.ndjson"))).toContain("Nie ma takiego pliku");
    expect(disk(empty)).toContain("pusty");
    expect(disk(big)).toContain("8 MiB");
    expect(disk(directory)).toContain("Nie ma takiego pliku");
  });

  psIt("organisation slug and the audit reason", () => {
    expect(
      psJson<boolean[]>(
        "@((Test-OrgSlug 'krajozbior-redakcja'), (Test-OrgSlug 'Zla Org'), (Test-OrgSlug 'a--b'), (Test-OrgSlug ''))",
      ),
    ).toEqual([true, false, false, false]);
    expect(psJson<string>("New-ImportReason 'fala-1-public.ndjson'")).toBe(
      "Wgranie kolekcji z pliku fala-1-public.ndjson",
    );
  });

  const flow = (answer: string, codes: string) =>
    psJson<{ calls: string[]; code: number; result: string }>(
      `$calls = New-Object System.Collections.Generic.List[string]; $codes = @{ ${codes} }; $r = Invoke-ImportFlow { param($p) $calls.Add($p); $codes[$p] } { ${answer} }; @{ calls = @($calls); code = $r.Code; result = $r.Result }`,
    );

  psIt('answer "nie": only the preview runs, nothing is loaded, exit code 0', () => {
    expect(flow("$false", "preview = 0; apply = 0")).toEqual({
      calls: ["preview"],
      code: 0,
      result: "declined",
    });
  });

  psIt('answer "tak": preview, then the load', () => {
    expect(flow("$true", "preview = 0; apply = 0")).toEqual({
      calls: ["preview", "apply"],
      code: 0,
      result: "applied",
    });
    expect(flow("$true", "preview = 0; apply = 1")).toMatchObject({
      code: 1,
      result: "apply-failed",
    });
  });

  psIt("a failed preview asks nothing and loads nothing", () => {
    expect(flow("throw 'the question must not be asked'", "preview = 1; apply = 0")).toEqual({
      calls: ["preview"],
      code: 1,
      result: "preview-failed",
    });
  });

  psIt("summarises the JSON line of catalog:import in Polish, ignores other lines", () => {
    const preview = JSON.stringify({
      outcome: "preview",
      dryRun: true,
      collections: 2,
      places: 5,
      collectionStates: { create: 2 },
      placeStates: { create: 4, noop: 1 },
    });

    expect(psJson<string>(`Format-ImportSummary ${psString(preview)}`)).toBe(
      "Podglad (w pliku 2 kolekcji i 5 miejsc). Kolekcje: create=2. Miejsca: create=4, noop=1.",
    );
    expect(
      psJson<string>(
        `Format-ImportSummary ${psString(JSON.stringify({ outcome: "refused", code: "host_mismatch" }))}`,
      ),
    ).toBe("Odmowa: host_mismatch.");
    expect(ps("$null -eq (Format-ImportSummary '[krajozbior] GOTOWE')").stdout).toBe("True");
  });

  it("deploy.ps1 checks the file before the vault and any connection; wdroz.ps1 passes it on", () => {
    const deploy = withoutComments(readFileSync(join(OPS_DIR, "deploy.ps1"), "utf8"));
    const starter = withoutComments(readFileSync(join(OPS_DIR, "wdroz.template.ps1"), "utf8"));
    const secrets = withoutComments(readFileSync(join(OPS_DIR, "new-deploy-secrets.ps1"), "utf8"));
    const check = deploy.indexOf("Get-ImportFileProblem $ImportFile");

    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(deploy.indexOf("Open-Vault"));
    expect(check).toBeLessThan(deploy.indexOf("Get-Tool 'ssh.exe'"));
    expect(deploy).not.toContain("bedzie dostepne po F-K6");
    expect(deploy).toContain("Add-Secret 'KZ_CURATOR_EMAIL' $curator");
    expect(deploy).not.toMatch(/KZ_CURATOR_EMAIL\s*=|\$plain\.KZ_CURATOR_EMAIL/);
    expect(starter).toContain("'-ImportFile', $Import");
    expect(secrets).toContain(
      "Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'wdroz.template.ps1') -Destination $starterFile -Force",
    );
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

  // B1 (review F-K4): the scan tool always writes a "# host:22 SSH-2.0-..." comment to stderr.
  // In Windows PowerShell 5.1 `2>$null` turns that line into an error record, which stops the
  // script under $ErrorActionPreference = 'Stop'. A real program writing to stderr is the only
  // honest test: a PowerShell stub would not go through the native-command path.
  psIt(
    "runs the scan with a program that writes to stderr, under ErrorActionPreference Stop",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "krajozbior-keyscan-"));
      const isWindows = process.platform === "win32";
      const tool = join(directory, isWindows ? "fake-keyscan.cmd" : "fake-keyscan");

      writeFileSync(
        tool,
        isWindows
          ? `@echo off\r\necho # 192.0.2.10:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu 1>&2\r\necho 192.0.2.10 ssh-ed25519 ${blob}\r\n`
          : `#!/bin/sh\necho '# 192.0.2.10:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu' >&2\necho '192.0.2.10 ssh-ed25519 ${blob}'\n`,
        { mode: 0o755 },
      );

      const result = ps(
        `$k = ConvertFrom-HostKeyScan (Invoke-HostKeyScan ${psString(tool)} 22 '192.0.2.10'); $k.Key`,
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(blob);
    },
  );

  it("deploy.ps1 scans the host key only through Invoke-HostKeyScan", () => {
    const text = readFileSync(join(OPS_DIR, "deploy.ps1"), "utf8");

    expect(text).toContain("Invoke-HostKeyScan $scanTool");
    expect(text).not.toMatch(/&\s*\$scanTool/);
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
        // S6 (review F-K4): never a password prompt, also not for root during the bootstrap.
        "PreferredAuthentications=publickey",
        "PasswordAuthentication=no",
        "KbdInteractiveAuthentication=no",
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

  // Regression (showcase rehearsal, 21.11): with a UTF-8 console the standard-input writer of
  // Windows PowerShell 5.1 put a byte order mark before the payload, and bash stopped at "<BOM>{".
  it.skipIf(
    process.platform !== "win32" || powershell !== "powershell.exe" || !existsSync(GIT_BASH),
  )("sends the payload without a byte order mark, also from a UTF-8 console", () => {
    const result = ps(
      [
        "[Console]::InputEncoding = [Text.Encoding]::UTF8",
        "$psi = New-Object System.Diagnostics.ProcessStartInfo",
        `$psi.FileName = ${psString(GIT_BASH)}`,
        `$psi.Arguments = '-c "head -c 3 | od -An -tx1"'`,
        "$psi.UseShellExecute = $false",
        "$psi.RedirectStandardInput = $true",
        "$psi.RedirectStandardOutput = $true",
        "$p = Start-PayloadProcess $psi '{ x'",
        "$p.StandardOutput.ReadToEnd().Trim()",
      ].join("; "),
    );

    expect(result.stdout, result.stderr).toBe("7b 20 78");
  });

  it("deploy.ps1 writes the payload only through Start-PayloadProcess", () => {
    for (const script of ["deploy.ps1", "deploy-showcase.ps1"]) {
      const text = readFileSync(join(OPS_DIR, script), "utf8");

      expect(text, script).toContain("Start-PayloadProcess $psi $payload");
      expect(text, script).not.toContain("[System.Diagnostics.Process]::Start(");
    }
  });
});

describe("target showcase (rehearsal on the local showcase)", () => {
  psIt("requires the secrets folder and repository only for the server", () => {
    expect(
      ps(`Assert-DeployTarget 'server' 'commit' 'C:\\s' 'https://github.com/o/r'`).status,
    ).toBe(0);
    expect(
      ps(`Assert-DeployTarget 'server' 'commit' '' 'https://github.com/o/r'`).stderr,
    ).toContain("brak -SecretsDir");
    expect(ps(`Assert-DeployTarget 'showcase' 'commit' '' ''`).status).toBe(0);
    expect(ps(`Assert-DeployTarget 'showcase' 'initial' '' ''`).status).toBe(0);
  });

  psIt("refuses the secrets folder, the repository address and server-only modes", () => {
    for (const call of [
      `Assert-DeployTarget 'showcase' 'commit' 'C:\\s' ''`,
      `Assert-DeployTarget 'showcase' 'commit' '' 'https://github.com/o/r'`,
    ]) {
      const result = ps(call);

      expect(result.status, call).not.toBe(0);
      expect(result.stderr, call).toContain("nie uzywa folderu sekretow");
    }

    for (const mode of ["bootstrap", "admin", "diagnoza", "otworz", "odtworz", "import"]) {
      const result = ps(`Assert-DeployTarget 'showcase' '${mode}' '' ''`);

      expect(result.status, mode).not.toBe(0);
      expect(result.stderr, mode).toContain("wymaga serwera");
    }
  });

  psIt("deploy.ps1 -Target showcase stops before the secrets folder or the connection", () => {
    // A folder that does not exist: the server path would fail with "Brak pliku ...serwer.conf".
    const result = spawnSync(
      powershell ?? "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        join(OPS_DIR, "deploy.ps1"),
        "-Target",
        "showcase",
        "-SecretsDir",
        "C:\\nie-istnieje\\sekrety",
        "-Mode",
        "commit",
        "-Sha",
        "0".repeat(40),
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("nie uzywa folderu sekretow");
    expect(`${result.stdout}${result.stderr}`).not.toContain("serwer.conf");
  });

  it("hands over to deploy-showcase.ps1 before any server step", () => {
    const text = withoutComments(readFileSync(join(OPS_DIR, "deploy.ps1"), "utf8"));
    const handOver = text.indexOf("deploy-showcase.ps1') -Mode");

    expect(handOver).toBeGreaterThan(0);
    for (const serverStep of ["serwer.conf", "Get-Tool 'ssh.exe'", "Open-Vault", "magazyn.age"]) {
      expect(text.indexOf(serverStep), serverStep).toBeGreaterThan(handOver);
    }
  });

  it("deploy-showcase.ps1 knows no server, secrets folder or remote-shell client", () => {
    const code = withoutComments(readFileSync(join(OPS_DIR, "deploy-showcase.ps1"), "utf8"));

    for (const word of ["ssh", "SecretsDir", "serwer.conf", "magazyn", "age.exe", "Read-Host"]) {
      expect(code, word).not.toContain(word);
    }
    expect(code).toContain("showcase.sh");
  });

  psIt("accepts only krajozbior-<name> projects and ports outside the other environments", () => {
    expect(
      psJson<boolean[]>(
        `@('krajozbior-showcase','krajozbior-rehearsal','krajozbior','Krajozbior-x','slady-app','krajozbior-') | ForEach-Object { Test-ShowcaseProject $_ }`,
      ),
    ).toEqual([true, true, false, false, false, false]);
    expect(
      psJson<boolean[]>(
        `@(3300, 3310, 3000, 3100, 5432, 55432, 55433, 80, 70000) | ForEach-Object { Test-ShowcasePort $_ }`,
      ),
    ).toEqual([true, true, false, false, false, false, false, false, false]);
    expect(psJson<string>(`Get-ShowcaseDataName 'krajozbior-showcase'`)).toBe("showcase");
  });

  psIt("gives the local bash only configuration, named after the project", () => {
    const environment = psJson<Record<string, string>>(
      `Get-ShowcaseEnvironment 'krajozbior-rehearsal' 3310 'C:\\r\\.data\\rehearsal' 'C:\\r\\deploy\\o.yaml'`,
    );

    expect(environment).toEqual({
      KZ_TARGET: "showcase",
      KZ_PROJECT: "krajozbior-rehearsal",
      KZ_ROOT: "C:/r/.data/rehearsal/deploy",
      KZ_RUN: "C:/r/.data/rehearsal/deploy/run",
      KZ_SHOWCASE_DATA: "C:/r/.data/rehearsal",
      KZ_SHOWCASE_PORT: "3310",
      KZ_SHOWCASE_OVERLAY: "C:/r/deploy/o.yaml",
      KZ_PGDATA_VOLUME: "krajozbior-rehearsal-pgdata",
      KZ_IMAGE_REPOS: "krajozbior-rehearsal-app krajozbior-rehearsal-ops",
      KZ_DUMP_SUFFIX: "dump",
    });
  });

  psIt("never runs the WSL bash of System32", () => {
    const result = ps(`Find-GitBash @('C:\\Windows\\System32\\bash.exe')`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Brak Git Bash");
  });
});

describe("secrets folder scripts: clean clone only, safe git (review F-K4, A1)", () => {
  psIt("Test-RunsFromSecretsRepo accepts only <secrets>\\repo\\scripts\\ops", () => {
    const secrets = "C:\\Users\\a\\.config\\deploy-secrets";

    expect(
      psJson<boolean>(`Test-RunsFromSecretsRepo '${secrets}\\repo\\scripts\\ops' '${secrets}'`),
    ).toBe(true);
    expect(
      psJson<boolean>(`Test-RunsFromSecretsRepo '${secrets}\\REPO\\scripts\\ops\\' '${secrets}'`),
    ).toBe(true);

    for (const folder of [
      "C:\\Projekty\\Krajozbior\\krajozbior\\scripts\\ops",
      "C:\\Projekty\\Krajozbior\\krajozbior\\.worktrees\\ws-3\\scripts\\ops",
      `${secrets}\\repo\\scripts`,
      `${secrets}\\other\\scripts\\ops`,
    ]) {
      expect(psJson<boolean>(`Test-RunsFromSecretsRepo '${folder}' '${secrets}'`), folder).toBe(
        false,
      );
    }
  });

  const runNewDeploySecrets = (userProfile: string) =>
    spawnSync(
      powershell ?? "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `try { & '${join(OPS_DIR, "new-deploy-secrets.ps1").replaceAll("'", "''")}' -ReportDir 'C:\\x\\.data\\deploy' } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
      ],
      { encoding: "utf8", env: { ...process.env, USERPROFILE: userProfile } },
    );

  psIt(
    "new-deploy-secrets.ps1 refuses to run from another folder, before touching anything",
    () => {
      // USERPROFILE is set, so the refusal comes from the folder check (not from the missing variable).
      const userProfile = mkdtempSync(join(tmpdir(), "krajozbior-userprofile-"));
      const result = runNewDeploySecrets(userProfile);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("nie z folderu kodu");
      expect(result.stderr).not.toContain("USERPROFILE");
      expect(result.stderr).toContain("Nic nie zrobiono");
    },
  );

  psIt("new-deploy-secrets.ps1 refuses with an empty USERPROFILE, before touching anything", () => {
    const result = runNewDeploySecrets("");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Brak zmiennej USERPROFILE");
    expect(result.stderr).toContain("Nic nie zrobiono");
  });

  psIt("Resolve-ReportDir: default in the secrets folder, explicit full path, no relative", () => {
    expect(psJson<string>("Resolve-ReportDir '' 'C:\\s'")).toBe("C:\\s\\raporty");
    expect(psJson<string>("Resolve-ReportDir 'C:\\k\\.data\\deploy' 'C:\\s'")).toBe(
      "C:\\k\\.data\\deploy",
    );

    const relative = ps("Resolve-ReportDir '.data\\deploy' 'C:\\s'");

    expect(relative.status).not.toBe(0);
    expect(relative.stderr).toContain("pelna sciezka");
  });

  psIt("Get-SafeGitArgs puts the safe options before the git command", () => {
    const args = psJson<string[]>("Get-SafeGitArgs @('-C', 'x', 'status')");

    expect(args).toEqual(expect.arrayContaining(["core.fsmonitor=false", "core.hooksPath=NUL"]));
    expect(args.slice(-3)).toEqual(["-C", "x", "status"]);
  });

  it("every git call of the owner's scripts has the safe options; no code folder is used", () => {
    const newSecrets = withoutComments(
      readFileSync(join(OPS_DIR, "new-deploy-secrets.ps1"), "utf8"),
    );
    const starter = withoutComments(readFileSync(join(OPS_DIR, "wdroz.template.ps1"), "utf8"));

    expect(newSecrets).toContain("Get-SafeGitArgs $argv");
    expect(newSecrets).not.toMatch(/&\s*git\s+(?!@\(Get-SafeGitArgs)/);
    expect(newSecrets).not.toMatch(/codeRoot|Krajozbior\\krajozbior/);
    expect(newSecrets).toContain("Resolve-ReportDir $ReportDir");
    expect(newSecrets).toContain("-Commit $headSha");
    expect(starter).toContain("core.fsmonitor=false");
    expect(starter).toContain("core.hooksPath=NUL");
    expect(starter).not.toMatch(/&\s*git\s+(?!@safeGit)/);
  });

  psIt("Get-MissingConfigLines appends only the healthcheck keys that are missing", () => {
    const lines = psJson<string[]>(
      ",@(Get-MissingConfigLines \"Address=1.2.3.4`nHealthcheckHealthUrl=https://hc.example/old\" @{ HealthcheckBackupUrl = 'https://hc.example/b'; HealthcheckHealthUrl = 'https://hc.example/new'; HealthcheckRestoreUrl = '' })",
    );

    expect(lines).toEqual(["HealthcheckBackupUrl=https://hc.example/b"]);
  });
});

describe("-Bootstrap shows the Caddy password only when the server wrote it (review F-K4, A2)", () => {
  it("deploy.ps1 does not print the password before connecting", () => {
    const text = withoutComments(readFileSync(join(OPS_DIR, "deploy.ps1"), "utf8"));
    const before = text.slice(0, text.indexOf("$process = Start-PayloadProcess"));

    expect(before).not.toMatch(/haslo: \$gate/);
    expect(text).toMatch(/-match 'bramka hasla Caddy wlaczona'/);
    expect(text).toMatch(/haslo: \$gate/);
  });
});
