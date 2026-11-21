# Prepares the owner's deployment secrets folder (E11 spec 8.0b pt 9, D-E11-4).
# Run by the OWNER in his own PowerShell window, ONLY from the clean clone in the secrets folder
# (never from the code folder or a worktree: the agent can write there, and git itself runs
# programs named in a repository's .git\config):
#   git clone https://github.com/<owner>/krajozbior.git "$env:USERPROFILE\.config\krajozbior-deploy\repo"
#   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.config\krajozbior-deploy\repo\scripts\ops\new-deploy-secrets.ps1" -ReportDir <folder>
# Anywhere else the script refuses. -ReportDir is the folder where the reports (no secrets) are
# written; without it: raporty\ in the secrets folder.
#
# In %USERPROFILE%\.config\krajozbior-deploy\ (created in step 8.0b, with ssh\id_ed25519):
#   magazyn.age  random passwords of the database roles krajozbior_owner and krajozbior_ops,
#                encrypted by age with the DEPLOYMENT PASSPHRASE (age asks for it twice);
#                the plain text never touches the disk
#   serwer.conf  server address, backup public key (age1...), report folder; asked here
#   wdroz.ps1    copy of scripts\ops\wdroz.template.ps1 from the clean clone (only when missing)
#   repo\        the clean clone itself, used by wdroz.ps1
# Existing files are kept. Optional -HealthcheckBackupUrl / -HealthcheckRestoreUrl /
# -HealthcheckHealthUrl / -ImportDir append missing keys to an existing serwer.conf (nothing is
# replaced). -OdswiezWdroz replaces wdroz.ps1 with the template of this clean clone (which must
# be on merged main, checked below); the old copy stays as wdroz.ps1.poprzedni.
# Every git call has the safe options of Get-SafeGitArgs. Nothing is printed except file names
# and next steps.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [switch]$Rotate,
  [string]$ReportDir = '',
  [string]$HealthcheckBackupUrl = '',
  [string]$HealthcheckRestoreUrl = '',
  [string]$HealthcheckHealthUrl = '',
  [string]$ImportDir = '',
  [switch]$OdswiezWdroz
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

if ($Rotate) {
  throw 'Rotacja hasel rol (procedura 8.10 pkt 5) nie jest jeszcze gotowa; zostaje na F-P8.'
}

if (-not $env:USERPROFILE) {
  throw 'Brak zmiennej USERPROFILE: ten skrypt dziala tylko z czystej kopii w folderze sekretow na Windows. Nic nie zrobiono.'
}
$secretsDir = Join-WinPath $env:USERPROFILE '.config\krajozbior-deploy'
$vaultFile = Join-Path $secretsDir 'magazyn.age'
$configFile = Join-Path $secretsDir 'serwer.conf'
$starterFile = Join-Path $secretsDir 'wdroz.ps1'
$repo = Join-Path $secretsDir 'repo'

# 0. Only from the clean clone in the secrets folder; nothing is read from the code folder.
if (-not (Test-RunsFromSecretsRepo $PSScriptRoot $secretsDir)) {
  throw ("Ten skrypt dziala tylko z czystej kopii w $repo, nie z folderu kodu ani z worktree (tam moze pisac agent). " +
    "Nic nie zrobiono. Instrukcja: git clone https://github.com/<wlasciciel>/krajozbior.git `"$repo`", potem uruchom skrypt z tej kopii.")
}

function Invoke-GitQuiet([string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & git @(Get-SafeGitArgs $argv) 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return @{ Code = $code; Out = $out.Trim() }
}

# The clone must be on merged code: HEAD an ancestor of origin/main, scripts/ops unmodified.
Invoke-GitQuiet @('-C', $repo, 'fetch', '--quiet', 'origin', 'main') | Out-Null
if ((Invoke-GitQuiet @('-C', $repo, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main')).Code -ne 0) {
  throw 'Kopia repo\ nie jest na scalonym main. Nic nie zrobiono; napisz agentowi.'
}
if ((Invoke-GitQuiet @('-C', $repo, 'status', '--porcelain', '--', 'scripts/ops')).Out -ne '') {
  throw 'Pliki scripts/ops w repo\ maja niezapisane zmiany. Nic nie zrobiono; napisz agentowi.'
}
$headSha = (Invoke-GitQuiet @('-C', $repo, 'rev-parse', 'HEAD')).Out
if (-not (Test-CommitSha $headSha)) { throw 'Nie udalo sie odczytac commita z repo\.' }

if (-not (Test-Path -LiteralPath (Join-Path $secretsDir 'ssh\id_ed25519'))) {
  throw "Brak klucza $secretsDir\ssh\id_ed25519. Najpierw krok 8.0b pkt 3-4."
}
$ageTool = (Get-Command 'age.exe' -ErrorAction SilentlyContinue)
if (-not $ageTool) { throw 'Brak programu age. Krok 8.0b pkt 2: winget install --id FiloSottile.age -e' }

# 1. Vault.
if (Test-Path -LiteralPath $vaultFile) {
  Write-Host 'magazyn.age juz istnieje - bez zmian.'
} else {
  Write-Host 'Tworze magazyn hasel. age dwa razy zapyta o haslo: wpisz HASLO WDROZENIOWE' -ForegroundColor Yellow
  Write-Host '(nie zostawiaj pustego - wtedy age wymysli wlasne haslo).' -ForegroundColor Yellow
  New-VaultText | & $ageTool.Source -p -o $vaultFile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $vaultFile)) { throw 'age nie utworzyl magazynu.' }
  Write-Host 'Magazyn utworzony' -ForegroundColor Green
}

# 2. Server configuration (the address never goes to the public repository).
if ($ImportDir -ne '' -and -not (Test-WinPathRooted $ImportDir)) { throw 'ImportDir musi byc pelna sciezka (C:\...). Nic nie zmieniono w serwer.conf.' }
$healthcheckUrls = @{
  HealthcheckBackupUrl = $HealthcheckBackupUrl
  HealthcheckRestoreUrl = $HealthcheckRestoreUrl
  HealthcheckHealthUrl = $HealthcheckHealthUrl
  ImportDir = $ImportDir
}
if (Test-Path -LiteralPath $configFile) {
  $existing = [IO.File]::ReadAllText($configFile)
  Read-DeployConfig $existing | Out-Null
  $missing = @(Get-MissingConfigLines $existing $healthcheckUrls)
  if ($missing.Count -gt 0) {
    $updated = $existing.TrimEnd() + "`n" + ($missing -join "`n") + "`n"
    Read-DeployConfig $updated | Out-Null
    [IO.File]::WriteAllText($configFile, $updated, (New-Object Text.UTF8Encoding($false)))
    Write-Host "serwer.conf: dopisano $($missing.Count) wpis(y)."
  } else {
    Write-Host 'serwer.conf juz istnieje - bez zmian.'
  }
} else {
  $address = (Read-Host 'Adres IPv4 serwera (z panelu netcup)').Trim()
  $backupKey = (Read-Host 'Klucz publiczny kopii (age1..., z kroku 8.0b pkt 6)').Trim()
  $reportPath = Resolve-ReportDir $ReportDir $secretsDir
  $text = "# Krajozbior: konfiguracja wdrozenia (bez sekretow)`nAddress=$address`nPort=22`nBackupPublicKey=$backupKey`nReportDir=$reportPath`n"
  $text += (@(Get-MissingConfigLines $text $healthcheckUrls) -join "`n")
  $text = $text.TrimEnd() + "`n"
  Read-DeployConfig $text | Out-Null
  [IO.File]::WriteAllText($configFile, $text, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'serwer.conf zapisany.'
}

# 3. Starter script, copied from the clean clone (this script's own folder).
if ((Test-Path -LiteralPath $starterFile) -and $OdswiezWdroz) {
  $newTemplate = Join-Path $PSScriptRoot 'wdroz.template.ps1'
  if ((Get-FileHash -LiteralPath $newTemplate).Hash -eq (Get-FileHash -LiteralPath $starterFile).Hash) {
    Write-Host 'wdroz.ps1 jest juz w aktualnej wersji - bez zmian.'
  } else {
    # Never overwrite an earlier backup: a dated copy next to it.
    $backup = "$starterFile.poprzedni"
    if (Test-Path -LiteralPath $backup) { $backup = "$starterFile.poprzedni-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
    Copy-Item -LiteralPath $starterFile -Destination $backup -Force
    Copy-Item -LiteralPath $newTemplate -Destination $starterFile -Force
    Write-Host "wdroz.ps1 odswiezony z commita $headSha (poprzednia wersja: $(Split-Path -Leaf $backup))." -ForegroundColor Green
  }
} elseif (Test-Path -LiteralPath $starterFile) {
  Write-Host 'wdroz.ps1 juz istnieje - bez zmian (nowsza wersja: -OdswiezWdroz).'
} else {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'wdroz.template.ps1') -Destination $starterFile
  Write-Host 'wdroz.ps1 skopiowany.'
}

# 4. The clean clone is the folder this script runs from.
Write-Host 'repo\ juz istnieje - bez zmian (z tej kopii dziala ten skrypt).'

Write-Host ''
if ($OdswiezWdroz) {
  Write-Host 'Gotowe. Wgranie kolekcji (plik z folderu ImportDir):' -ForegroundColor Green
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"`$env:USERPROFILE\.config\krajozbior-deploy\wdroz.ps1`" -Import <pelna sciezka pliku>"
  exit 0
}
Write-Host 'Gotowe. Nastepny krok (sesja wdrozeniowa 1):' -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File `"`$env:USERPROFILE\.config\krajozbior-deploy\wdroz.ps1`" -Bootstrap -Commit $headSha"
