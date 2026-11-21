# Deployment of Krajozbior to the server (E11 spec, F-K4; D-E11-4, D-E11-7, D-E11-10).
#
# Started ONLY by wdroz.ps1 in the owner's own PowerShell window, from the owner's copy of the
# repository checked out at a commit that is on origin/main. The agent never runs it: it cannot
# connect to the server and does not know the deployment passphrase.
#
#   -Mode bootstrap   first preparation of the server (as root): deploy account, firewall, Docker,
#                     .env.production, Brevo key, Caddy password gate, timers
#   -Mode initial     first deployment (database, roles, migrations, app behind the gate)
#   -Mode commit      next deployment of -Sha
#   -Mode admin       administrator account and editorial organisation
#   -Mode diagnoza    read-only report for the agent
#   -Mode otworz      removes the Caddy password gate (only after npm run legal:final passes)
#   -Mode odtworz     restores the newest backup with the owner's backup key (exercise, K-8)
#   -Mode import      catalog upload to the server - available with F-K6
#
# -Target showcase (default: server) is the agent's rehearsal on the local showcase: modes
# initial and commit only, without -SecretsDir and -RepoUrl. It hands over to
# deploy-showcase.ps1 before anything below runs, so it never reads the secrets folder and never
# starts the remote-shell client (docs/deployment.md, "Proba generalna na pokazie").
#
# One connection per mode. The passphrase of the key and of magazyn.age is typed by the owner
# (the remote-shell client and age ask for it themselves). Secrets travel in the standard input
# of the connection, never in arguments. The report (no secrets, no IP or e-mail addresses) goes
# to ReportDir from serwer.conf (the code folder's .data/deploy/, which the agent reads).
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [string]$SecretsDir = '',
  [Parameter(Mandatory = $true)]
  [ValidateSet('bootstrap', 'initial', 'commit', 'admin', 'diagnoza', 'otworz', 'odtworz', 'import')]
  [string]$Mode,
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$RepoUrl = '',
  [ValidateSet('server', 'showcase')][string]$Target = 'server',
  [string]$ShowcaseProject = 'krajozbior-showcase',
  [int]$ShowcasePort = 3300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

Assert-DeployTarget $Target $Mode $SecretsDir $RepoUrl
if ($Target -eq 'showcase') {
  & (Join-Path $PSScriptRoot 'deploy-showcase.ps1') -Mode $Mode -Sha $Sha -Project $ShowcaseProject -Port $ShowcasePort
  exit $LASTEXITCODE
}

function Write-Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

function Read-YesNo([string]$question) {
  $answer = Read-Host "$question (tak/nie)"
  return ($answer.Trim().ToLowerInvariant() -eq 'tak')
}

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-Tool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Brak programu $name. Instrukcja: krok 8.0b (winget)." }
  return $cmd.Source
}

if ($Mode -eq 'import') {
  throw 'Wgrywanie kolekcji na serwer bedzie dostepne po F-K6 (catalog:import --target server).'
}
if (-not (Test-CommitSha $Sha)) { throw 'Nieprawidlowy commit (oczekiwane 40 znakow 0-9a-f).' }
if ($RepoUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?(\.git)?$') {
  throw 'Adres repozytorium musi byc publicznym adresem https://github.com/...'
}

$configFile = Join-Path $SecretsDir 'serwer.conf'
$keyFile = Join-Path $SecretsDir 'ssh\id_ed25519'
$knownHosts = Join-Path $SecretsDir 'ssh\known_hosts'
$vaultFile = Join-Path $SecretsDir 'magazyn.age'
foreach ($f in @($configFile, $keyFile)) { if (-not (Test-Path -LiteralPath $f)) { throw "Brak pliku $f" } }
$config = Read-DeployConfig ([IO.File]::ReadAllText($configFile))
$reportDir = if ($config.ContainsKey('ReportDir')) { $config.ReportDir } else { Join-Path $SecretsDir 'raporty' }
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$reportFile = Join-Path $reportDir (Get-ReportFileName (Get-Date) $Mode)
$secrets = New-Object System.Collections.Generic.List[string]

function Write-Report([string]$line) {
  $safe = Protect-ReportLine $line $secrets.ToArray() $config.Address
  [IO.File]::AppendAllText($reportFile, $safe + "`n", (New-Object Text.UTF8Encoding($false)))
  return $safe
}

$remoteShell = Get-Tool 'ssh.exe'

# 1. Server host key: pinned once, compared by the owner with the console screenshot (D-E11-10).
if (-not (Test-Path -LiteralPath $knownHosts)) {
  $scanTool = Get-Tool 'ssh-keyscan.exe'
  Write-Say 'Pierwsze polaczenie: pobieram odcisk klucza serwera.'
  $scan = Invoke-HostKeyScan $scanTool $config.Port $config.Address
  $hostKey = ConvertFrom-HostKeyScan $scan
  $fingerprint = Get-HostKeyFingerprint $hostKey.Key
  Write-Say ''
  Write-Say "  Odcisk klucza serwera:  ED25519 $fingerprint" 'Yellow'
  Write-Say '  Porownaj go ze zrzutem z konsoli netcup (linia ED25519 pod SSH HOST KEY FINGERPRINTS).'
  if (-not (Read-YesNo 'Czy odcisk jest identyczny')) { throw 'Odcisk sie nie zgadza albo brak potwierdzenia. Nic nie zrobiono.' }
  [IO.File]::WriteAllText($knownHosts, (New-KnownHostsLine $config.Address $config.Port $hostKey.Type $hostKey.Key) + "`n")
  Write-Report "klucz serwera przypiety: ED25519 $fingerprint" | Out-Null
}

# 2. Mode inputs, asked locally before connecting.
$plain = @{ KZ_MODE = $Mode; KZ_COMMIT = $Sha; KZ_REPO_URL = $RepoUrl; KZ_SITE_HOST = $config.SiteHost; KZ_SSH_PORT = [string]$config.Port }
$secretVars = @{}

function Add-Secret([string]$name, [string]$value) {
  $secretVars[$name] = $value
  $secrets.Add($value)
}

function Open-Vault {
  if (-not (Test-Path -LiteralPath $vaultFile)) { throw 'Brak magazyn.age (uruchom new-deploy-secrets.ps1).' }
  $ageTool = Get-Tool 'age.exe'
  Write-Say 'Magazyn hasel: wpisz haslo wdrozeniowe.'
  $text = (& $ageTool -d $vaultFile) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie otworzyc magazynu (zle haslo?).' }
  return (ConvertFrom-VaultText $text)
}

switch ($Mode) {
  'bootstrap' {
    if (-not $config.ContainsKey('BackupPublicKey')) { throw 'serwer.conf: brak BackupPublicKey (klucz publiczny kopii age1...).' }
    $plain.KZ_EMAIL_FROM = $config.EmailFrom
    $plain.KZ_BACKUP_PUBKEY = $config.BackupPublicKey
    $brevo = Read-Secret 'Klucz API Brevo (wklej, znakow nie widac)'
    if ($brevo.Length -lt 20) { throw 'Klucz Brevo wyglada na niepelny.' }
    Add-Secret 'KZ_BREVO_KEY' $brevo
    $gate = New-RandomHex 12
    Add-Secret 'KZ_GATE_PW' $gate
    Write-Say ''
    Write-Say '  Haslo do serwisu przed otwarciem (Caddy):' 'Yellow'
    Write-Say "    uzytkownik: krajozbior    haslo: $gate" 'Yellow'
    Write-Say '  Zapisz je teraz w menedzerze hasel ("Krajozbior - haslo strony testowej"). Nie trafia do raportu.'
    if (-not (Read-YesNo 'Zapisane')) { throw 'Przerwano przed polaczeniem. Nic nie zrobiono.' }
  }
  'initial' {
    $vault = Open-Vault
    Add-Secret 'KZ_OWNER_PW' $vault.Owner
    Add-Secret 'KZ_OPS_PW' $vault.Ops
  }
  'commit' {
    $vault = Open-Vault
    Add-Secret 'KZ_OWNER_PW' $vault.Owner
  }
  'admin' {
    $vault = Open-Vault
    Add-Secret 'KZ_OPS_PW' $vault.Ops
    $email = (Read-Host 'Adres e-mail konta administratora (na niego logowales sie kodem)').Trim().ToLowerInvariant()
    if (-not (Test-EmailAddress $email)) { throw 'Nieprawidlowy adres e-mail.' }
    $adminPw = Read-Secret 'Haslo administratora (min. 16 znakow, z menedzera hasel)'
    if ($adminPw.Length -lt 16) { throw 'Haslo administratora musi miec co najmniej 16 znakow.' }
    if ((Read-Secret 'Powtorz haslo administratora') -ne $adminPw) { throw 'Hasla sie roznia.' }
    Add-Secret 'KZ_ADMIN_EMAIL' $email
    Add-Secret 'KZ_ADMIN_PW' $adminPw
    $plain.KZ_REASON = 'Pierwszy administrator serwisu'
    $plain.KZ_ORG_SLUG = 'krajozbior-redakcja'
    # Not a secret: base64 only to carry the Polish letters through the payload.
    $secretVars.KZ_ORG_NAME = 'Krajozbi' + [char]0x00F3 + 'r ' + [char]0x2014 + ' redakcja'
  }
  'otworz' {
    Write-Say 'Otwarcie serwisu dla wszystkich (spec 5.4a). Potwierdz, ze:' 'Yellow'
    Write-Say '  1. strony prawne sa wdrozone, 2. przeczytales rejestr czynnosci i procedure naruszenia,'
    Write-Say '  3. umowy powierzenia z netcup i Brevo sa zawarte, 4. podwykonawcy Brevo sa sprawdzeni (K-15),'
    Write-Say '  5. agent sprawdzil logi po probnych wizytach (K-4).'
    if (-not (Read-YesNo 'Wszystkie piec warunkow spelnione')) { throw 'Serwis zostaje za haslem. Nic nie zrobiono.' }
  }
  'odtworz' {
    $key = (Read-Secret 'Klucz kopii (AGE-SECRET-KEY-1..., z menedzera hasel albo wydruku)').Trim()
    if (-not (Test-AgeSecretKey $key)) { throw 'To nie wyglada na klucz kopii (AGE-SECRET-KEY-1 + 58 znakow).' }
    Add-Secret 'KZ_RESTORE_KEY' $key
  }
}
foreach ($pair in @(@('HealthcheckBackupUrl', 'KZ_HC_BACKUP'), @('HealthcheckRestoreUrl', 'KZ_HC_RESTORE'), @('HealthcheckHealthUrl', 'KZ_HC_HEALTH'))) {
  if ($config.ContainsKey($pair[0])) { $plain[$pair[1]] = $config[$pair[0]] }
}

# 3. Payload: lib.sh + preamble + mode script, read from this checked-out commit.
$serverDir = Join-Path $PSScriptRoot 'server'
$modeScript = if ($Mode -eq 'bootstrap') { 'bootstrap.sh' } else { 'remote.sh' }
$payload = New-RemotePayload ([IO.File]::ReadAllText((Join-Path $serverDir 'lib.sh'))) `
  (New-RemotePreamble $plain $secretVars) ([IO.File]::ReadAllText((Join-Path $serverDir $modeScript)))

# 4. One connection. stdout is read line by line, masked, shown and written to the report;
# stderr stays on the console (prompts of the client).
$user = Get-RemoteUser $Mode
Write-Report ("wdrozenie: tryb {0}, commit {1}, konto {2}, start {3:yyyy-MM-dd HH:mm:ss}" -f $Mode, $Sha, $user, (Get-Date)) | Out-Null
Write-Say "Lacze z serwerem jako $user (tryb $Mode). Gdy klient zapyta o haslo klucza, wpisz haslo wdrozeniowe."

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $remoteShell
$psi.Arguments = Join-NativeArgs (Get-RemoteShellArgs $keyFile $knownHosts $user $config.Address $config.Port)
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
$process = Start-PayloadProcess $psi $payload
$payload = $null
while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
  Write-Say (Write-Report $line)
}
$process.WaitForExit()
$code = $process.ExitCode
$secretVars.Clear()

if ($code -eq 0) {
  Write-Report "wynik: GOTOWE (kod 0)" | Out-Null
  Write-Say ''
  Write-Say 'GOTOWE' 'Green'
  if ($Mode -eq 'bootstrap') {
    Write-Say 'Kolejne polaczenia ida jako deploy; logowanie roota przez SSH jest wylaczone.'
    Write-Say 'Po aktualizacji systemu serwer moze sam zrestartowac sie najblizszej nocy o 4:30 (czas serwera). To normalne.'
  }
} else {
  Write-Report "wynik: BLAD (kod $code)" | Out-Null
  Write-Say ''
  Write-Say "BLAD (kod $code). Napisz agentowi: blad. Raport jest zapisany." 'Red'
}
Write-Say "Raport: $reportFile"
exit $code
