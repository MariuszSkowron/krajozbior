# Functions of the deployment scripts that need no server and no network (E11 spec, F-K4).
# Dot-sourced by deploy.ps1 and new-deploy-secrets.ps1, and by the unit tests
# (tests/scripts/ops-deploy-lib.test.ts). Nothing here connects anywhere, reads the secrets folder
# or prints a secret.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).

Set-StrictMode -Version Latest

$DeployConfigKeys = @('Address', 'Port', 'SiteHost', 'EmailFrom', 'BackupPublicKey', 'ReportDir',
  'HealthcheckBackupUrl', 'HealthcheckRestoreUrl', 'HealthcheckHealthUrl')

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
# the pinned host key only (StrictHostKeyChecking=yes), keep-alive during long builds.
function Get-RemoteShellArgs([string]$keyFile, [string]$knownHosts, [string]$user, [string]$address, [int]$port) {
  return @(
    '-i', $keyFile,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
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

# Mode -> account on the server: only the bootstrap connects as root (the key netcup installed);
# it creates `deploy` and switches root login off.
function Get-RemoteUser([string]$mode) {
  if ($mode -eq 'bootstrap') { return 'root' }
  return 'deploy'
}

function Get-ReportFileName([datetime]$when, [string]$mode) {
  return ('{0}-{1}.log' -f $when.ToString('yyyy-MM-dd-HHmmss'), $mode)
}
