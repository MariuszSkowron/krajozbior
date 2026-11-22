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
#   -Mode aktualnosci news file of the editorial team (spec E7-R, 14.4, E7-R2b): -NewsFile <full
#                     path of aktualnosci-<name>.ndjson in ImportDir of serwer.conf>. Same flow as
#                     import (preview = news:import --dry-run, the owner answers tak/nie, then the
#                     load) but all or nothing for the whole file and only the `ops` role password
#                     in the payload. Refuses on a running version without news:import.
#   -Mode import      collection file to the server (spec 5.6, F-K6): -ImportFile <full path in
#                     ImportDir of serwer.conf>, optional -OrgSlug. Two connections: preview
#                     (catalog:import --dry-run), the owner answers tak/nie, then the load of
#                     drafts. The file travels in the payload (base64 + SHA-256), lives on the
#                     server only for one command and is mounted read-only into `ops`.
#
# -Target showcase (default: server) is the agent's rehearsal on the local showcase: modes
# initial, commit and aktualnosci only, without -SecretsDir and -RepoUrl. It hands over to
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
  [ValidateSet('bootstrap', 'initial', 'commit', 'admin', 'diagnoza', 'otworz', 'odtworz', 'import', 'aktualnosci')]
  [string]$Mode,
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$RepoUrl = '',
  [ValidateSet('server', 'showcase')][string]$Target = 'server',
  [string]$ShowcaseProject = 'krajozbior-showcase',
  [int]$ShowcasePort = 3300,
  [string]$NewsFile = '',
  [string]$ImportFile = '',
  [string]$OrgSlug = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

Assert-DeployTarget $Target $Mode $SecretsDir $RepoUrl
if ($Target -eq 'showcase') {
  & (Join-Path $PSScriptRoot 'deploy-showcase.ps1') -Mode $Mode -Sha $Sha -Project $ShowcaseProject -Port $ShowcasePort -NewsFile $NewsFile
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

if ($Mode -eq 'import' -and -not $ImportFile) {
  throw ('Brak pliku do wgrania. Jesli wpisales wdroz.ps1 -Import <plik>, Twoja kopia wdroz.ps1 jest starsza niz ten tryb: ' +
    'odswiez ja (new-deploy-secrets.ps1 -OdswiezWdroz, docs/deployment.md "Wgrywanie kolekcji"). Nic nie zrobiono.')
}
if ($Mode -ne 'import' -and ($ImportFile -or $OrgSlug)) { throw '-ImportFile i -OrgSlug dzialaja tylko w trybie import.' }
if ($Mode -eq 'aktualnosci' -and -not $NewsFile) {
  throw ('Brak pliku z aktualnosciami. Jesli wpisales wdroz.ps1 -Aktualnosci <plik>, Twoja kopia wdroz.ps1 jest starsza niz ten tryb: ' +
    'odswiez ja (new-deploy-secrets.ps1 -OdswiezWdroz, docs/deployment.md "Publikowanie aktualnosci"). Nic nie zrobiono.')
}
if ($Mode -ne 'aktualnosci' -and $NewsFile) { throw '-NewsFile dziala tylko w trybie aktualnosci.' }
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

# Mode import: the file is checked before any question, password or connection.
if ($Mode -eq 'import') {
  $importDir = if ($config.ContainsKey('ImportDir')) { $config.ImportDir } else { '' }
  $problem = Get-ImportFileProblem $ImportFile $importDir $SecretsDir
  if (-not $problem) {
    # From here on only the resolved path is used (checks, Get-Item, ReadAllBytes).
    $ImportFile = Resolve-WinPath $ImportFile
    $problem = Get-ImportFileProblem $ImportFile $importDir $SecretsDir
  }
  if (-not $problem) { $problem = Get-ImportFileDiskProblem $ImportFile $importDir }
  if ($problem) { throw "$problem Nic nie zrobiono." }
  if ($OrgSlug -and -not (Test-OrgSlug $OrgSlug)) { throw 'Nieprawidlowy slug organizacji (male litery, cyfry i -). Nic nie zrobiono.' }
}

# Mode aktualnosci: the same order as import, the file is checked before any question, password
# or connection (name, place, plain file without shortcuts).
if ($Mode -eq 'aktualnosci') {
  $importDir = if ($config.ContainsKey('ImportDir')) { $config.ImportDir } else { '' }
  $problem = Get-NewsFileProblem $NewsFile $importDir $SecretsDir
  if (-not $problem) {
    # From here on only the resolved path is used (checks, Get-Item, ReadAllBytes).
    $NewsFile = Resolve-WinPath $NewsFile
    $problem = Get-NewsFileProblem $NewsFile $importDir $SecretsDir
  }
  if (-not $problem) { $problem = Get-ImportFileDiskProblem $NewsFile $importDir }
  if ($problem) { throw "$problem Nic nie zrobiono." }
}

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
    # Not shown here: a repeated -Bootstrap keeps the gate (and password) of the first attempt on
    # the server, so a new one would be wrong. It is shown below only when the server reports
    # that it wrote this one (review F-K4, A2).
    $gate = New-RandomHex 12
    Add-Secret 'KZ_GATE_PW' $gate
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
  'aktualnosci' {
    # Checked again right before reading: time passed since the first check, enough to swap the
    # file or its folder for a shortcut (same as import, review S2).
    $problem = Get-ImportFileDiskProblem $NewsFile $importDir
    if ($problem) { throw "$problem Nic nie zrobiono." }
    $bytes = [IO.File]::ReadAllBytes($NewsFile)
    $problem = Get-NewsContentProblem $bytes
    if ($problem) { throw "$problem Nic nie zrobiono." }
    $newsName = Get-WinPathLeaf $NewsFile
    # The file travels like a collection file (the server side reuses the import helpers).
    $plain.KZ_IMPORT_NAME = $newsName
    $plain.KZ_IMPORT_SHA256 = Get-Sha256Hex $bytes
    # Public editorial text, not a secret; base64 has no quote or new line, as the preamble
    # requires, and carries the Polish letters of the titles untouched.
    $plain.KZ_IMPORT_B64 = [Convert]::ToBase64String($bytes)
    $plain.KZ_REASON = New-NewsReason $newsName
    $bytes = $null
    # The ops password only (news:import writes as krajozbior_ops): no owner password.
    $vault = Open-Vault
    Add-Secret 'KZ_OPS_PW' $vault.Ops
  }
  'import' {
    $slug = $OrgSlug
    if (-not $slug) {
      $slug = (Read-Host 'Slug organizacji (Enter = krajozbior-redakcja)').Trim()
      if (-not $slug) { $slug = 'krajozbior-redakcja' }
    }
    if (-not (Test-OrgSlug $slug)) { throw 'Nieprawidlowy slug organizacji (male litery, cyfry i -). Nic nie zrobiono.' }
    $curator = (Read-Host 'Adres e-mail kuratora (konto, na ktore logujesz sie do panelu kuratora)').Trim().ToLowerInvariant()
    if (-not (Test-EmailAddress $curator)) { throw 'Nieprawidlowy adres e-mail. Nic nie zrobiono.' }
    # Checked again right before reading: the owner answered two questions since the first check,
    # time enough to swap the file or its folder for a shortcut (review S2).
    $problem = Get-ImportFileDiskProblem $ImportFile $importDir
    if ($problem) { throw "$problem Nic nie zrobiono." }
    $bytes = [IO.File]::ReadAllBytes($ImportFile)
    if ($bytes.Length -lt 1 -or $bytes.Length -gt $ImportMaxBytes) { throw 'Plik jest pusty albo wiekszy niz 8 MiB. Nic nie zrobiono.' }
    $problem = Get-ImportContentProblem $bytes
    if ($problem) { throw "$problem Nic nie zrobiono." }
    $importName = Get-WinPathLeaf $ImportFile
    $plain.KZ_IMPORT_NAME = $importName
    $plain.KZ_IMPORT_SHA256 = Get-Sha256Hex $bytes
    # Not a secret (public profile); base64 has no quote or new line, as the preamble requires.
    $plain.KZ_IMPORT_B64 = [Convert]::ToBase64String($bytes)
    $plain.KZ_ORG_SLUG = $slug
    $plain.KZ_REASON = New-ImportReason $importName
    $bytes = $null
    $vault = Open-Vault
    Add-Secret 'KZ_OPS_PW' $vault.Ops
    # In the payload only (base64), masked in the report; never written to the report.
    Add-Secret 'KZ_CURATOR_EMAIL' $curator
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
$user = Get-RemoteUser $Mode

# 4. One connection per call (mode import: one for the preview, one for the load). stdout is
# read line by line, masked, shown and written to the report; stderr stays on the console
# (prompts of the client). Returns the exit code.
function Invoke-RemoteConnection {
  $payload = New-RemotePayload ([IO.File]::ReadAllText((Join-Path $serverDir 'lib.sh'))) `
    (New-RemotePreamble $plain $secretVars) ([IO.File]::ReadAllText((Join-Path $serverDir $modeScript)))
  $phase = if ($plain.ContainsKey('KZ_IMPORT_PHASE')) { ", faza $($plain.KZ_IMPORT_PHASE), plik $($plain.KZ_IMPORT_NAME)" } else { '' }
  Write-Report ("wdrozenie: tryb {0}{4}, commit {1}, konto {2}, start {3:yyyy-MM-dd HH:mm:ss}" -f $Mode, $Sha, $user, (Get-Date), $phase) | Out-Null
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
    $safe = Write-Report $line
    Write-Say $safe
    if ($Mode -eq 'bootstrap' -and $line -match 'bramka hasla Caddy wlaczona') {
      Write-Say ''
      Write-Say '  Haslo do serwisu przed otwarciem (Caddy):' 'Yellow'
      Write-Say "    uzytkownik: krajozbior    haslo: $gate" 'Yellow'
      Write-Say '  Zapisz je teraz w menedzerze hasel ("Krajozbior - haslo strony testowej"). Nie trafia do raportu.'
      Read-Host 'Gdy zapiszesz, nacisnij Enter (serwer czeka)' | Out-Null
    }
    if ($Mode -eq 'aktualnosci') {
      $summary = Format-NewsSummary $safe
      if ($summary) { Write-Say (Write-Report "podsumowanie: $summary") 'Cyan' }
    }
    if ($Mode -eq 'import') {
      $summary = Format-ImportSummary $safe
      if ($summary) {
        Write-Say (Write-Report "podsumowanie: $summary") 'Cyan'
        if ($summary.StartsWith('Wgrane czesciowo')) { $script:importPartial = $true }
      }
    }
  }
  $process.WaitForExit()
  return $process.ExitCode
}

$importResult = ''
$importPartial = $false
if ($Mode -eq 'import' -or $Mode -eq 'aktualnosci') {
  $flow = Invoke-ImportFlow {
    param($phase)
    $plain.KZ_IMPORT_PHASE = $phase
    Invoke-RemoteConnection
  } {
    Write-Say ''
    if ($Mode -eq 'aktualnosci') {
      Write-Say 'Powyzej podglad: co zrobi wgranie pliku z aktualnosciami (nowa, zmieniona, bez zmian, wycofana). Na serwerze nic sie jeszcze nie zmienilo.' 'Yellow'
      Write-Say 'Odpowiedz tak, zeby wgrac plik (aktualnosci staja sie publiczne od razu), albo nie, zeby zakonczyc bez zmian.'
      Read-YesNo 'Wgrac aktualnosci na serwer'
    } else {
      Write-Say 'Powyzej podglad: co wgranie zrobiloby z kolekcjami i miejscami. Na serwerze nic sie jeszcze nie zmienilo.' 'Yellow'
      Write-Say 'Odpowiedz tak, zeby wgrac szkice (publikujesz pozniej sam w panelu), albo nie, zeby zakonczyc bez zmian.'
      Read-YesNo 'Wgrac szkice na serwer'
    }
  }
  $code = $flow.Code
  $importResult = $flow.Result
  if ($importResult -eq 'declined') {
    Write-Report 'wgranie: odpowiedz nie - nic nie wgrano, pliku nie ma na serwerze' | Out-Null
  }
} else {
  $code = Invoke-RemoteConnection
}
$plain.Remove('KZ_IMPORT_B64')
$secretVars.Clear()

if ($code -eq 0 -and $importResult -eq 'declined') {
  Write-Report "wynik: NIC NIE WGRANO (odpowiedz nie)" | Out-Null
  Write-Say ''
  Write-Say 'Nic nie wgrano. Pliku nie ma na serwerze.' 'Green'
} elseif ($code -eq 0) {
  Write-Report "wynik: GOTOWE (kod 0)" | Out-Null
  Write-Say ''
  Write-Say 'GOTOWE' 'Green'
  if ($Mode -eq 'bootstrap') {
    Write-Say 'Kolejne polaczenia ida jako deploy; logowanie roota przez SSH jest wylaczone.'
    Write-Say 'Po aktualizacji systemu serwer moze sam zrestartowac sie najblizszej nocy o 4:30 (czas serwera). To normalne.'
  }
  if ($Mode -eq 'import') {
    Write-Say 'Szkice sa na serwerze. Obejrzyj je w panelu kuratora; publikujesz je sam, gdy beda gotowe.'
  }
  if ($Mode -eq 'aktualnosci') {
    Write-Say 'Aktualnosci z pliku sa na serwerze (wycofane z pliku znikaja ze strony). Sprawdz je na stronie Aktualnosci.'
  }
} else {
  Write-Say ''
  if ($Mode -eq 'aktualnosci' -and $code -eq 2) {
    Write-Report 'wynik: PLIK ODRZUCONY (kod 2): nic sie nie zmienilo' | Out-Null
    Write-Say 'PLIK ODRZUCONY (kod 2): w pliku sa bledy (numery linii sa wyzej). Na serwerze nic sie nie zmienilo.' 'Yellow'
    Write-Say 'To nie awaria. Napisz agentowi: kod 2 (z raportem); po poprawce pliku powtorz to samo polecenie.' 'Yellow'
  } elseif ($Mode -eq 'aktualnosci' -and $code -eq 3) {
    Write-Report 'wynik: ODMOWA (kod 3): nic sie nie zmienilo' | Out-Null
    Write-Say 'ODMOWA (kod 3): serwer nie przyjal pliku (np. niedozwolona zmiana stanu aktualnosci, zle powiazanie z kolekcja albo miejscem, za duzo aktualnosci). Na serwerze nic sie nie zmienilo.' 'Yellow'
    Write-Say 'To nie awaria: plik jest wgrywany w calosci albo wcale. Napisz agentowi: kod 3 (z raportem); po poprawce pliku powtorz to samo polecenie.' 'Yellow'
  } elseif ($importPartial) {
    Write-Report 'wynik: CZESCIOWO (kod 3): czesc szkicow jest na serwerze' | Out-Null
    Write-Say 'CZESCIOWO WGRANE (kod 3): czesc szkicow jest juz na serwerze, czesc kolekcji zostala odrzucona.' 'Yellow'
    Write-Say 'To nie jest awaria. Napisz agentowi: czesciowo (z raportem); po ustaleniu przyczyny to samo wgranie mozna powtorzyc.' 'Yellow'
  } else {
    Write-Report "wynik: BLAD (kod $code)" | Out-Null
    Write-Say "BLAD (kod $code). Napisz agentowi: blad. Raport jest zapisany." 'Red'
  }
}
Write-Say "Raport: $reportFile"
exit $code
