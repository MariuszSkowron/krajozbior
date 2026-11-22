# Functions of the deployment scripts that need no server and no network (E11 spec, F-K4).
# Dot-sourced by deploy.ps1, deploy-showcase.ps1 and new-deploy-secrets.ps1, and by the unit tests
# (tests/scripts/ops-deploy-lib.test.ts). Nothing here connects anywhere, reads the secrets folder
# or prints a secret.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).

Set-StrictMode -Version Latest

$DeployConfigKeys = @('Address', 'Port', 'SiteHost', 'EmailFrom', 'BackupPublicKey', 'ReportDir',
  'HealthcheckBackupUrl', 'HealthcheckRestoreUrl', 'HealthcheckHealthUrl', 'ImportDir')

# serwer.conf in the owner's secrets folder: KEY=VALUE lines, '#' comments. The server address
# lives only there (never in the public repository).
function Read-DeployConfig([string]$text) {
  $config = @{ Port = 22; SiteHost = 'krajozbior.pl'; EmailFrom = 'noreply@krajozbior.pl' }
  $lineNo = 0
  foreach ($raw in ($text -split "`r?`n")) {
    $lineNo++
    $line = $raw.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { throw "serwer.conf, line ${lineNo}: expected KEY=VALUE" }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if ($DeployConfigKeys -notcontains $key) { throw "serwer.conf, line ${lineNo}: unknown key $key" }
    $config[$key] = $value
  }
  if (-not $config.ContainsKey('Address') -or -not (Test-ServerAddress $config.Address)) {
    throw 'serwer.conf: Address must be an IPv4 address or a host name'
  }
  $port = 0
  if (-not [int]::TryParse([string]$config.Port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw 'serwer.conf: Port must be a number 1-65535'
  }
  $config.Port = $port
  if (-not (Test-HostName $config.SiteHost)) { throw 'serwer.conf: SiteHost must be a host name' }
  if (-not (Test-EmailAddress $config.EmailFrom)) { throw 'serwer.conf: EmailFrom must be an e-mail address' }
  if ($config.ContainsKey('BackupPublicKey') -and -not (Test-AgePublicKey $config.BackupPublicKey)) {
    throw 'serwer.conf: BackupPublicKey must be an age public key (age1...)'
  }
  foreach ($key in @('HealthcheckBackupUrl', 'HealthcheckRestoreUrl', 'HealthcheckHealthUrl')) {
    if ($config.ContainsKey($key) -and $config[$key] -notmatch '^https://[A-Za-z0-9./_-]+$') {
      throw "serwer.conf: $key must be an https:// address"
    }
  }
  # Folder of the collection files that -Import may send (F-K6); a full Windows path.
  if ($config.ContainsKey('ImportDir') -and
    (-not (Test-WinPathRooted $config.ImportDir) -or $config.ImportDir -match "['`"]")) {
    throw 'serwer.conf: ImportDir must be a full path (C:\...)'
  }
  return $config
}

function Test-HostName([string]$value) {
  return $value -match '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
}

function Test-ServerAddress([string]$value) {
  if ($value -match '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') {
    foreach ($i in 1..4) { if ([int]$Matches[$i] -gt 255) { return $false } }
    return $true
  }
  return (Test-HostName $value)
}

function Test-EmailAddress([string]$value) {
  return $value -match '^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$'
}

function Test-AgePublicKey([string]$value) { return $value -cmatch '^age1[02-9ac-hj-np-z]{58}$' }
function Test-AgeSecretKey([string]$value) { return $value -cmatch '^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$' }

# Full lowercase commit hash (40 hex). Short hashes are refused: they are ambiguous.
function Test-CommitSha([string]$value) { return $value -cmatch '^[0-9a-f]{40}$' }

# Reason stored for ever in the operations audit: no e-mail addresses (DB-8), 3-200 characters.
function Test-AuditReason([string]$value) {
  return ($value.Trim().Length -ge 3 -and $value.Length -le 200 -and $value -notmatch '@' -and $value -notmatch "[`r`n']")
}

function New-RandomHex([int]$bytesCount = 24) {
  $bytes = New-Object byte[] $bytesCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Plain text of magazyn.age (before age encrypts it with the deployment passphrase).
function New-VaultText {
  return "KRAJOZBIOR_OWNER_DB_PASSWORD=$(New-RandomHex)`nKRAJOZBIOR_OPS_DB_PASSWORD=$(New-RandomHex)`n"
}

function ConvertFrom-VaultText([string]$text) {
  $vault = @{}
  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^(KRAJOZBIOR_OWNER_DB_PASSWORD|KRAJOZBIOR_OPS_DB_PASSWORD)=([A-Za-z0-9]{16,128})$') {
      $vault[$Matches[1]] = $Matches[2]
    }
  }
  foreach ($name in @('KRAJOZBIOR_OWNER_DB_PASSWORD', 'KRAJOZBIOR_OPS_DB_PASSWORD')) {
    if (-not $vault.ContainsKey($name)) { throw "magazyn: missing or invalid $name" }
  }
  return @{ Owner = $vault.KRAJOZBIOR_OWNER_DB_PASSWORD; Ops = $vault.KRAJOZBIOR_OPS_DB_PASSWORD }
}

function ConvertTo-Base64Utf8([string]$value) {
  return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($value))
}

# Bash preamble of the payload. Plain values are single-quoted (and may not contain a quote);
# secrets travel base64-encoded and are decoded by kz_b64 (lib.sh) inside the server process.
function New-RemotePreamble([System.Collections.IDictionary]$plain, [System.Collections.IDictionary]$secrets) {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($name in ($plain.Keys | Sort-Object)) {
    if ($name -notmatch '^KZ_[A-Z0-9_]+$') { throw "invalid variable name $name" }
    $value = [string]$plain[$name]
    if ($value -match "['`r`n]") { throw "value of $name may not contain a quote or a new line" }
    $lines.Add("$name='$value'")
  }
  foreach ($name in ($secrets.Keys | Sort-Object)) {
    if ($name -notmatch '^KZ_[A-Z0-9_]+$') { throw "invalid variable name $name" }
    $lines.Add("$name=`"`$(kz_b64 '$(ConvertTo-Base64Utf8 ([string]$secrets[$name]))')`"")
  }
  return ($lines -join "`n")
}

# The whole payload is one `{ ... }` block: bash reads it completely before running anything, so
# no command can swallow the rest of the script from standard input. LF line endings only.
function New-RemotePayload([string]$libText, [string]$preamble, [string]$modeText) {
  $body = @(
    '{',
    'set -euo pipefail',
    'exec 2>&1 </dev/null',
    $libText,
    $preamble,
    $modeText,
    'kz_main',
    '}'
  ) -join "`n"
  return (($body -replace "`r", '') + "`n")
}

# Masks what must not reach the report the agent reads: e-mail and IP addresses, the server
# address from serwer.conf and every secret passed in $secrets.
function Protect-ReportLine([string]$line, [string[]]$secrets = @(), [string]$address = '') {
  $out = $line
  foreach ($secret in $secrets) {
    if ($secret -and $secret.Length -ge 6) { $out = $out.Replace($secret, '<sekret>') }
  }
  if ($address) { $out = $out.Replace($address, '<serwer>') }
  $out = $out -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<e-mail>'
  $out = $out -replace '\b(\d{1,3}\.){3}\d{1,3}\b', '<ip>'
  $out = $out -replace '([0-9a-fA-F]{1,4}:)+:[0-9a-fA-F:]*', '<ip>'
  $out = $out -replace '([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}', '<ip>'
  return $out
}

# Runs the host-key scan and returns its standard output as one string. The scan tool always
# writes a "# host:22 SSH-2.0-..." comment to stderr; in Windows PowerShell 5.1 a redirected
# stderr line of a native program becomes an error record, which stops the script under
# $ErrorActionPreference = 'Stop'. So the call runs with 'Continue' (same pattern as Invoke-Git
# in wdroz.template.ps1) and the missing key is detected by ConvertFrom-HostKeyScan instead.
function Invoke-HostKeyScan([string]$tool, [int]$port, [string]$address) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $lines = & $tool -t ed25519 -p $port $address 2>$null }
  finally { $ErrorActionPreference = $old }
  return (@($lines | Where-Object { $_ -is [string] }) -join "`n")
}

# First ED25519 host key from host-key scan output ("host ssh-ed25519 AAAA...").
function ConvertFrom-HostKeyScan([string]$text) {
  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^\S+\s+(ssh-ed25519)\s+([A-Za-z0-9+/]+={0,2})\s*$') {
      return @{ Type = $Matches[1]; Key = $Matches[2] }
    }
  }
  throw 'no ED25519 host key in the scan output'
}

# OpenSSH fingerprint format: SHA256:<base64 of the SHA-256 of the key blob, no padding>.
function Get-HostKeyFingerprint([string]$base64Key) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([Convert]::FromBase64String($base64Key)) } finally { $sha.Dispose() }
  return 'SHA256:' + ([Convert]::ToBase64String($hash).TrimEnd('='))
}

function New-KnownHostsLine([string]$address, [int]$port, [string]$type, [string]$key) {
  $hostPart = if ($port -eq 22) { $address } else { "[$address]:$port" }
  return "$hostPart $type $key"
}

# Arguments of the remote-shell client for one connection. Fixed options: our key only, no agent,
# never a password prompt (a typed root password would let the bootstrap copy a wrong key file
# to `deploy`; review F-K4, S6), the pinned host key only (StrictHostKeyChecking=yes),
# keep-alive during long builds.
function Get-RemoteShellArgs([string]$keyFile, [string]$knownHosts, [string]$user, [string]$address, [int]$port) {
  return @(
    '-i', $keyFile,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', "UserKnownHostsFile=$knownHosts",
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ConnectTimeout=20',
    '-p', [string]$port,
    "$user@$address",
    'bash -s'
  )
}

# Windows PowerShell 5.1 has no ProcessStartInfo.ArgumentList: one command line, quoted like the
# C runtime expects (a space or quote forces quotes; inner quotes are escaped).
function Join-NativeArgs([string[]]$arguments) {
  $quoted = foreach ($a in $arguments) {
    if ($a -ne '' -and $a -notmatch '[\s"]') { $a }
    else { '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
  }
  return ($quoted -join ' ')
}

# Starts the process and writes the payload to its standard input as UTF-8 WITHOUT a byte order
# mark. Windows PowerShell 5.1 (.NET Framework) builds the standard-input writer from
# [Console]::InputEncoding; with code page 65001 (UTF-8 console) that encoding writes a BOM
# first, and bash then reads "<BOM>{" as an unknown command and stops before anything runs
# (found in the showcase rehearsal, 21.11). The console encoding is switched for the start only.
function Start-PayloadProcess([System.Diagnostics.ProcessStartInfo]$psi, [string]$payload) {
  $utf8 = New-Object Text.UTF8Encoding($false)
  $previous = $null
  try { $previous = [Console]::InputEncoding; [Console]::InputEncoding = $utf8 } catch { $previous = $null }
  try { $process = [System.Diagnostics.Process]::Start($psi) }
  finally { if ($null -ne $previous) { try { [Console]::InputEncoding = $previous } catch { } } }
  $bytes = $utf8.GetBytes($payload)
  $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $process.StandardInput.BaseStream.Flush()
  $process.StandardInput.Close()
  return $process
}

# Mode -> account on the server: only the bootstrap connects as root (the key netcup installed);
# it creates `deploy` and switches root login off.
function Get-RemoteUser([string]$mode) {
  if ($mode -eq 'bootstrap') { return 'root' }
  return 'deploy'
}

function Get-ReportFileName([datetime]$when, [string]$mode) {
  return ('{0}-{1}.log' -f $when.ToString('yyyy-MM-dd-HHmmss'), $mode)
}

# Second layer for every git call the owner's scripts make (review F-K4, A1): the first layer is
# that they only touch the clean clone in the secrets folder. A repository's own .git\config can
# make `git status`/`fetch`/`checkout` run a program (core.fsmonitor, hooks); these options switch
# that off. NUL is Windows' empty device, so no hooks folder exists.
$SafeGitOptions = @('-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=NUL', '-c', 'core.pager=cat',
  '-c', 'protocol.ext.allow=never')

function Get-SafeGitArgs([string[]]$argv) { return @($SafeGitOptions + $argv) }

# new-deploy-secrets.ps1 runs only from the clean clone <secrets>\repo (never from the code folder
# or a worktree the agent can write to): a script from there could have been changed by the agent.
function Test-RunsFromSecretsRepo([string]$scriptRoot, [string]$secretsDir) {
  if (-not $secretsDir -or -not $scriptRoot) { return $false }
  $expected = (Resolve-WinPath ((Join-WinPath $secretsDir 'repo\scripts\ops'))).TrimEnd('\', '/')
  $actual = (Resolve-WinPath $scriptRoot).TrimEnd('\', '/')
  return [string]::Equals($expected, $actual, [StringComparison]::OrdinalIgnoreCase)
}

# Windows paths as plain text, so the checks refuse (not throw) and behave the same on any system
# (Join-Path/GetFullPath need a real `C:` drive; the CI runs these checks on Linux).
# The text branch (non-Windows) exists for the tests in CI, not for production use.
function Join-WinPath([string]$base, [string]$child) {
  return ($base.TrimEnd('\', '/') + '\' + $child)
}

function Test-WinPathRooted([string]$path) {
  if ([IO.Path]::DirectorySeparatorChar -eq '\') { return [IO.Path]::IsPathRooted($path) }
  return ($path -match '^([A-Za-z]:[\\/]|\\\\)')
}

function Resolve-WinPath([string]$path) {
  if ([IO.Path]::DirectorySeparatorChar -eq '\') { return [IO.Path]::GetFullPath($path) }
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($segment in ($path -replace '/', '\').Split('\')) {
    if ($segment -eq '..') { if ($parts.Count -gt 1) { $parts.RemoveAt($parts.Count - 1) } }
    elseif ($segment -ne '.' -and ($segment -ne '' -or $parts.Count -eq 0)) { $parts.Add($segment) }
  }
  return ($parts -join '\')
}

# Folder of the report (no secrets): -ReportDir, else raporty\ in the secrets folder.
function Resolve-ReportDir([string]$reportDir, [string]$secretsDir) {
  if ($reportDir -eq '') {
    if (-not $secretsDir) { throw 'Brak folderu sekretow; podaj -ReportDir (pelna sciezka).' }
    return (Join-WinPath $secretsDir 'raporty')
  }
  if (-not (Test-WinPathRooted $reportDir)) { throw 'ReportDir musi byc pelna sciezka (np. C:\...\.data\deploy).' }
  return (Resolve-WinPath $reportDir)
}

# Healthcheck addresses missing from serwer.conf, as lines to append (existing keys stay).
function Get-MissingConfigLines([string]$configText, [hashtable]$wanted) {
  $present = @{}
  foreach ($raw in ($configText -split "`r?`n")) {
    $eq = $raw.IndexOf('=')
    if ($eq -gt 0 -and -not $raw.TrimStart().StartsWith('#')) { $present[$raw.Substring(0, $eq).Trim()] = $true }
  }
  $lines = @()
  foreach ($key in ($wanted.Keys | Sort-Object)) {
    if ($wanted[$key] -ne '' -and -not $present.ContainsKey($key)) { $lines += "$key=$($wanted[$key])" }
  }
  return $lines
}

# --- Target "showcase": rehearsal on the local showcase (spec 5.4, D-E11-8) -------------------

# Modes the rehearsal can run locally; the other modes need the server (Caddy, systemd, root).
$ShowcaseModes = @('initial', 'commit', 'aktualnosci')

# Checks the arguments of deploy.ps1 for the chosen target. The server needs the secrets folder
# and the public repository address; the showcase refuses both, so it can never read the folder
# or reach the server.
function Assert-DeployTarget([string]$target, [string]$mode, [string]$secretsDir, [string]$repoUrl) {
  switch ($target) {
    'server' {
      if (-not $secretsDir) { throw 'Cel server: brak -SecretsDir.' }
      if (-not $repoUrl) { throw 'Cel server: brak -RepoUrl.' }
    }
    'showcase' {
      if ($secretsDir -or $repoUrl) {
        throw 'Cel showcase nie uzywa folderu sekretow ani adresu repozytorium (bez -SecretsDir i -RepoUrl).'
      }
      if ($ShowcaseModes -notcontains $mode) {
        throw "Cel showcase: tylko tryby $($ShowcaseModes -join ', ') (tryb $mode wymaga serwera)."
      }
    }
    default { throw "Nieznany cel: $target" }
  }
}

# Compose project of the rehearsal: krajozbior-<name>, never the server project `krajozbior`.
function Test-ShowcaseProject([string]$name) {
  return ($name -cmatch '^krajozbior-[a-z0-9]+(-[a-z0-9]+)*$')
}

# Port of the rehearsal app: unprivileged and none of the ports of the owner's environment
# (3000, 5432) or of scripts/test-env (3100, 55432, 55433).
function Test-ShowcasePort([int]$port) {
  return ($port -ge 1024 -and $port -le 65535 -and @(3000, 3100, 5432, 55432, 55433) -notcontains $port)
}

# Data folder name under .data/: krajozbior-showcase -> showcase (the showcase's own folder).
function Get-ShowcaseDataName([string]$project) {
  return $project.Substring('krajozbior-'.Length)
}

# Git Bash, never the WSL `bash.exe` of System32 (it would run in another system).
function Find-GitBash([string[]]$candidates = @(
    (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
    (Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe'))) {
  foreach ($c in $candidates) {
    if ($c -and $c -notmatch '(?i)\\system32\\' -and (Test-Path -LiteralPath $c)) { return $c }
  }
  throw 'Brak Git Bash (C:\Program Files\Git\bin\bash.exe).'
}

# Environment of the local bash process: configuration only, no secrets (the showcase passwords
# stay in secrets.env, which Compose reads itself). Paths use forward slashes.
function Get-ShowcaseEnvironment([string]$project, [int]$port, [string]$dataDir, [string]$overlay) {
  $data = $dataDir -replace '\\', '/'
  return [ordered]@{
    KZ_TARGET           = 'showcase'
    KZ_PROJECT          = $project
    KZ_ROOT             = "$data/deploy"
    KZ_RUN              = "$data/deploy/run"
    KZ_SHOWCASE_DATA    = $data
    KZ_SHOWCASE_PORT    = [string]$port
    KZ_SHOWCASE_OVERLAY = $overlay -replace '\\', '/'
    KZ_PGDATA_VOLUME    = "$project-pgdata"
    KZ_IMAGE_REPOS      = "$project-app $project-ops"
    KZ_DUMP_SUFFIX      = 'dump'
  }
}

# --- Mode aktualnosci: a news file to the server (spec E7-R, 14.4, E7-R2b) ----------------------
# Reuses the helpers of mode import below (Test-WinDrivePath, Test-WinPathInside, Get-WinPathLeaf,
# Get-ImportFileDiskProblem, Get-Sha256Hex, Invoke-ImportFlow); they are looked up when called.

# A news file is small text (at most 200 posts per organisation): 2 MiB is far above any real file.
$NewsMaxBytes = 2 * 1024 * 1024

# Only files named like the files of the editorial team in the documentation repository.
function Test-NewsFileName([string]$name) {
  return ($name -cmatch '^aktualnosci-[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.ndjson$')
}

# Checks of the path alone (text only, so the same on Linux CI): a full path with a drive letter
# and the fixed name pattern. Used by the server mode (together with ImportDir) and by the
# showcase (no ImportDir there). Returns a Polish message, or ''.
function Get-NewsFileNameProblem([string]$path) {
  if (-not $path) { return 'Brak pliku: podaj -Aktualnosci <pelna sciezka pliku>.' }
  if (-not (Test-WinDrivePath $path)) {
    return 'Podaj pelna sciezke pliku z litera dysku (np. C:\...\aktualnosci-nazwa.ndjson).'
  }
  if (-not (Test-NewsFileName (Get-WinPathLeaf $path))) {
    return 'Zla nazwa pliku: oczekiwane aktualnosci-<nazwa>.ndjson (litery, cyfry, kropka, _ i -).'
  }
  return ''
}

# Server mode: the name checks plus the place. The file lies in ImportDir from serwer.conf (the
# same folder as the collection files) and never in the secrets folder, so a command line handed
# to the owner cannot send a key or the vault. Returns a Polish message, or ''.
function Get-NewsFileProblem([string]$path, [string]$importDir, [string]$secretsDir) {
  $problem = Get-NewsFileNameProblem $path
  if ($problem) { return $problem }
  if (-not $importDir) {
    return 'serwer.conf nie ma ImportDir (folder z plikami). Dopisze go new-deploy-secrets.ps1 -OdswiezWdroz -ImportDir <folder>.'
  }
  if ($secretsDir -and (Test-WinPathInside $path $secretsDir)) {
    return 'Plik lezy w folderze sekretow; takiego pliku skrypt nie wysyla.'
  }
  if (-not (Test-WinPathInside $path $importDir)) {
    return "Plik musi lezec w folderze ImportDir z serwer.conf ($importDir)."
  }
  return ''
}

# Content check on the bytes about to be sent: a news file is NDJSON in UTF-8, so the first byte is
# `{` (a key, the vault or a BOM start otherwise), the size is 1 B - 2 MiB, and the bytes are valid
# UTF-8 (a file saved by an editor in the Windows-1250 code page would turn the Polish letters of
# the titles into rubbish on the public page). Returns a Polish message, or ''.
function Get-NewsContentProblem([byte[]]$bytes) {
  if ($null -eq $bytes -or $bytes.Length -lt 1) { return 'Plik jest pusty.' }
  if ($bytes.Length -gt $NewsMaxBytes) { return 'Plik jest wiekszy niz 2 MiB.' }
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return 'Plik ma znacznik BOM na poczatku. Zapisz go jako UTF-8 bez BOM. Nic nie wyslano.'
  }
  if ($bytes[0] -ne 0x7B) { return 'Plik nie wyglada na aktualnosci (pierwszy znak to nie {). Nic nie wyslano.' }
  try { $null = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes) }
  catch { return 'Plik nie jest zapisany w UTF-8 (polskie litery by sie zepsuly). Zapisz go jako UTF-8 bez BOM. Nic nie wyslano.' }
  return ''
}

# Reason stored for ever in the operations audit: the file name only (no e-mail, no quote).
function New-NewsReason([string]$fileName) {
  $reason = "Publikacja aktualnosci z pliku $fileName"
  if (-not (Test-AuditReason $reason)) { throw 'Nazwa pliku nie nadaje sie do powodu w dzienniku.' }
  return $reason
}

# Counts of states as Polish words; unknown keys stay as they are.
function Format-NewsCounts($object) {
  if ($null -eq $object) { return 'brak' }
  $labels = @{ created = 'nowe'; new = 'nowe'; updated = 'zmienione'; changed = 'zmienione';
    unchanged = 'bez zmian'; noop = 'bez zmian'; withdrawn = 'wycofane' }
  $pairs = @($object.PSObject.Properties | ForEach-Object {
      $label = if ($labels.ContainsKey($_.Name)) { $labels[$_.Name] } else { $_.Name }
      "$label=$($_.Value)"
    })
  if ($pairs.Count -eq 0) { return 'brak' }
  return ($pairs -join ', ')
}

# The `outcome` word of the summary line of news:import ('' for any other line, also for a line
# that only mentions it). Same recognition as Format-NewsSummary: the line starts with {"outcome".
function Get-NewsOutcome([string]$line) {
  $text = $line.Trim()
  if (-not $text.StartsWith('{"outcome"')) { return '' }
  try { $o = $text | ConvertFrom-Json } catch { return '' }
  return [string](Get-JsonField $o 'outcome')
}

# Exit code 2 or 3 of news:import is shown as the yellow "nothing changed" only when the command
# itself said so with a matching summary line: 2 with outcome invalid (file errors), 3 with
# rejected or refused. Code 2 or 3 without such a line (a wrong flag, a server setting, a broken
# payload) is a failure and stays red (review E7-R2b, S1).
function Test-NewsRefusalResult([int]$code, [string]$outcome) {
  if ($code -eq 2) { return ($outcome -ceq 'invalid') }
  if ($code -eq 3) { return ($outcome -ceq 'rejected' -or $outcome -ceq 'refused') }
  return $false
}

# One Polish line for the summary line of news:import (JSON on standard output), or $null for any
# other line (the preview lines with the titles pass through unchanged). Counts and codes only.
# The JSON shape is the proposal of E7-R2b; E7-R2a may rename fields (the fallback prints the
# outcome word alone).
function Format-NewsSummary([string]$line) {
  $text = $line.Trim()
  if (-not $text.StartsWith('{"outcome"')) { return $null }
  try { $o = $text | ConvertFrom-Json } catch { return $null }
  $inFile = "w pliku $(Get-JsonField $o 'lines') aktualnosci"
  switch ([string](Get-JsonField $o 'outcome')) {
    'preview' { return "Podglad ($inFile): $(Format-NewsCounts (Get-JsonField $o 'states')). Nic jeszcze nie zapisano." }
    'applied' { return "Wgrane ($inFile): $(Format-NewsCounts (Get-JsonField $o 'results'))." }
    'invalid' { return "Plik nie przeszedl kontroli: $(Get-JsonField $o 'errorCount') bledow (numery linii wyzej). Nic sie nie zmienilo." }
    'refused' { return "Odmowa: $(Get-JsonField $o 'code'). Nic sie nie zmienilo." }
    'rejected' { return "Odmowa: $(Get-JsonField $o 'code'). Nic sie nie zmienilo (plik jest wgrywany w calosci albo wcale)." }
  }
  return $null
}

# --- Mode import: a collection file to the server (spec 5.6, F-K6) ------------------------------

# Same limit as catalog:import (MAX_IMPORT_FILE_BYTES).
$ImportMaxBytes = 8 * 1024 * 1024

# Only files of the public profile, named like the files in the documentation repository.
function Test-ImportFileName([string]$name) {
  return ($name -cmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,100}-public\.ndjson$')
}

# Organisation slug as catalog:import and ops:curator accept it.
function Test-OrgSlug([string]$value) {
  return ($value.Length -le 64 -and $value -cmatch '^[a-z0-9]+(-[a-z0-9]+)*$')
}

# Only `C:\...` (drive, backslash). IsPathRooted also accepts `\folder\x` and `C:x`, which are
# relative to the current drive or folder, so two checks could read them differently (review S3).
function Test-WinDrivePath([string]$path) {
  return ($path -cmatch '^[A-Za-z]:\\')
}

function Get-WinPathLeaf([string]$path) {
  return (($path -replace '/', '\').TrimEnd('\').Split('\')[-1])
}

function Test-WinPathInside([string]$path, [string]$folder) {
  $prefix = (Resolve-WinPath $folder).TrimEnd('\', '/') + '\'
  return (Resolve-WinPath $path).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

# Checks of the path alone, before anything is read (text only, so the same on Linux CI). A
# command line handed to the owner must not be able to send another file (a key, the vault):
# the file has a fixed name pattern, lies in ImportDir from serwer.conf and never in the secrets
# folder. Returns a Polish message, or '' when the path is acceptable.
function Get-ImportFileProblem([string]$path, [string]$importDir, [string]$secretsDir) {
  if (-not $path) { return 'Brak pliku: podaj -Import <pelna sciezka pliku>.' }
  if (-not $importDir) {
    return 'serwer.conf nie ma ImportDir (folder z plikami kolekcji). Dopisze go new-deploy-secrets.ps1 -OdswiezWdroz -ImportDir <folder>.'
  }
  if (-not (Test-WinDrivePath $path)) { return 'Podaj pelna sciezke pliku z litera dysku (np. C:\...\nazwa-public.ndjson).' }
  if (-not (Test-ImportFileName (Get-WinPathLeaf $path))) {
    return 'Zla nazwa pliku: oczekiwane <nazwa>-public.ndjson (litery, cyfry, kropka, _ i -).'
  }
  if ($secretsDir -and (Test-WinPathInside $path $secretsDir)) {
    return 'Plik lezy w folderze sekretow; takiego pliku skrypt nie wysyla.'
  }
  if (-not (Test-WinPathInside $path $importDir)) {
    return "Plik musi lezec w folderze ImportDir z serwer.conf ($importDir)."
  }
  return ''
}

# Checks on disk (deploy.ps1, after Get-ImportFileProblem): a plain file, 1 B - 8 MiB, and no
# shortcut (reparse point) on the way from ImportDir to the file, so a junction cannot lead
# out of the folder. ImportDir itself and the folders above it are the owner's configuration and
# are not checked. Returns a Polish message, or ''. The caller passes the path already resolved
# by Resolve-WinPath (on Windows it is resolved again here, a no-op for a full path).
function Get-ImportFileDiskProblem([string]$path, [string]$importDir) {
  if ([IO.Path]::DirectorySeparatorChar -eq '\') { $path = Resolve-WinPath $path }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return "Nie ma takiego pliku: $path" }
  $item = Get-Item -LiteralPath $path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return 'Plik jest skrotem (dowiazaniem); podaj zwykly plik.' }
  $top = (Resolve-WinPath $importDir).TrimEnd('\', '/')
  $dir = $item.Directory
  while ($null -ne $dir -and $dir.FullName.TrimEnd('\', '/').Length -gt $top.Length) {
    if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { return 'Folder pliku jest skrotem (dowiazaniem); podaj zwykly folder.' }
    $dir = $dir.Parent
  }
  if ($item.Length -lt 1) { return 'Plik jest pusty.' }
  if ($item.Length -gt $ImportMaxBytes) { return 'Plik jest wiekszy niz 8 MiB.' }
  return ''
}

# Content check on the bytes about to be sent (review S1): a collection file is NDJSON, so its
# first byte is `{`. A private key (`-----BEGIN`, `AGE-SECRET-KEY-`) or the vault (`age-encryption`)
# starts otherwise, so a hard link to one of them is refused. A BOM is refused too: the payload
# and catalog:import expect plain UTF-8. Returns a Polish message, or ''.
function Get-ImportContentProblem([byte[]]$bytes) {
  if ($null -eq $bytes -or $bytes.Length -lt 1) { return 'Plik jest pusty.' }
  if ($bytes[0] -ne 0x7B) { return 'Plik nie wyglada na kolekcje (pierwszy znak to nie {). Nic nie wyslano.' }
  return ''
}

function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Reason stored for ever in the operations audit: the file name only (no e-mail, no quote).
function New-ImportReason([string]$fileName) {
  $reason = "Wgranie kolekcji z pliku $fileName"
  if (-not (Test-AuditReason $reason)) { throw 'Nazwa pliku nie nadaje sie do powodu w dzienniku.' }
  return $reason
}

# Preview -> question -> load. $runPhase gets 'preview' or 'apply' and returns the exit code of
# that connection; $ask returns $true only for the answer "tak". Without "tak" there is no second
# connection, so nothing is loaded and the file is not sent again.
function Invoke-ImportFlow([scriptblock]$runPhase, [scriptblock]$ask) {
  $code = [int](& $runPhase 'preview')
  if ($code -ne 0) { return @{ Code = $code; Result = 'preview-failed' } }
  if (-not (& $ask)) { return @{ Code = 0; Result = 'declined' } }
  $code = [int](& $runPhase 'apply')
  $result = if ($code -eq 0) { 'applied' } else { 'apply-failed' }
  return @{ Code = $code; Result = $result }
}

function Get-JsonField($object, [string]$name) {
  $property = $object.PSObject.Properties[$name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Format-JsonCounts($object) {
  if ($null -eq $object) { return 'brak' }
  $pairs = @($object.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" })
  if ($pairs.Count -eq 0) { return 'brak' }
  return ($pairs -join ', ')
}

# One Polish line for the summary line of catalog:import (JSON on standard output), or $null for
# any other line. Counts and codes only; the JSON never holds an e-mail address.
function Format-ImportSummary([string]$line) {
  $text = $line.Trim()
  if (-not $text.StartsWith('{"outcome"')) { return $null }
  try { $o = $text | ConvertFrom-Json } catch { return $null }
  $inFile = "w pliku $(Get-JsonField $o 'collections') kolekcji i $(Get-JsonField $o 'places') miejsc"
  switch ([string](Get-JsonField $o 'outcome')) {
    'preview' {
      return "Podglad ($inFile). Kolekcje: $(Format-JsonCounts (Get-JsonField $o 'collectionStates')). Miejsca: $(Format-JsonCounts (Get-JsonField $o 'placeStates'))."
    }
    'applied' {
      return "Wgrane szkice ($inFile). Kolekcje: $(Format-JsonCounts (Get-JsonField $o 'collectionResults')). Miejsca: $(Format-JsonCounts (Get-JsonField $o 'placeResults'))."
    }
    'partial' {
      return "Wgrane czesciowo ($inFile): czesc kolekcji odrzucona. Kolekcje: $(Format-JsonCounts (Get-JsonField $o 'collectionResults'))."
    }
    'invalid' { return "Plik nie przeszedl kontroli: $(Get-JsonField $o 'errorCount') bledow (numery linii wyzej)." }
    'refused' { return "Odmowa: $(Get-JsonField $o 'code')." }
    'rejected' { return "Odmowa: $(Get-JsonField $o 'code')." }
  }
  return $null
}
