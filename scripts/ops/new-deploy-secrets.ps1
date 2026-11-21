# Prepares the owner's deployment secrets folder (E11 spec 8.0b pt 9, D-E11-4).
# Run by the OWNER in his own PowerShell window, from the code folder, after the F-K4 PR is merged:
#   powershell -ExecutionPolicy Bypass -File scripts\ops\new-deploy-secrets.ps1
#
# In %USERPROFILE%\.config\krajozbior-deploy\ (created in step 8.0b, with ssh\id_ed25519):
#   magazyn.age  random passwords of the database roles krajozbior_owner and krajozbior_ops,
#                encrypted by age with the DEPLOYMENT PASSPHRASE (age asks for it twice);
#                the plain text never touches the disk
#   serwer.conf  server address, backup public key (age1...), report folder; asked here
#   wdroz.ps1    copy of scripts\ops\wdroz.template.ps1 (only when missing)
#   repo\        own copy of the public repository, used by wdroz.ps1
# Existing files are kept. Nothing is printed except file names and next steps.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [switch]$Rotate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

if ($Rotate) {
  throw 'Rotacja hasel rol (procedura 8.10 pkt 5) nie jest jeszcze gotowa; zostaje na F-P8.'
}

$codeRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$secretsDir = Join-Path $env:USERPROFILE '.config\krajozbior-deploy'
$vaultFile = Join-Path $secretsDir 'magazyn.age'
$configFile = Join-Path $secretsDir 'serwer.conf'
$starterFile = Join-Path $secretsDir 'wdroz.ps1'
$repo = Join-Path $secretsDir 'repo'

function Invoke-GitQuiet([string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & git @argv 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return @{ Code = $code; Out = $out.Trim() }
}

# 0. This script must come from merged, unmodified code (the code folder is shared with the agent).
Invoke-GitQuiet @('-C', $codeRoot, 'fetch', '--quiet', 'origin', 'main') | Out-Null
if ((Invoke-GitQuiet @('-C', $codeRoot, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main')).Code -ne 0) {
  throw 'Folder kodu nie jest na scalonym main. Przelacz go na main (git switch main; git pull) i uruchom ponownie.'
}
if ((Invoke-GitQuiet @('-C', $codeRoot, 'status', '--porcelain', '--', 'scripts/ops')).Out -ne '') {
  throw 'Pliki scripts/ops w folderze kodu maja niezapisane zmiany. Nic nie zrobiono; napisz agentowi.'
}

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
if (Test-Path -LiteralPath $configFile) {
  Write-Host 'serwer.conf juz istnieje - bez zmian.'
  Read-DeployConfig ([IO.File]::ReadAllText($configFile)) | Out-Null
} else {
  $address = (Read-Host 'Adres IPv4 serwera (z panelu netcup)').Trim()
  $backupKey = (Read-Host 'Klucz publiczny kopii (age1..., z kroku 8.0b pkt 6)').Trim()
  $reportDir = Join-Path $codeRoot '.data\deploy'
  $text = "# Krajozbior: konfiguracja wdrozenia (bez sekretow)`nAddress=$address`nPort=22`nBackupPublicKey=$backupKey`nReportDir=$reportDir`n"
  Read-DeployConfig $text | Out-Null
  [IO.File]::WriteAllText($configFile, $text, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'serwer.conf zapisany.'
}

# 3. Starter script.
if (Test-Path -LiteralPath $starterFile) {
  Write-Host 'wdroz.ps1 juz istnieje - bez zmian.'
} else {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'wdroz.template.ps1') -Destination $starterFile
  Write-Host 'wdroz.ps1 skopiowany.'
}

# 4. Own copy of the public repository.
if (Test-Path -LiteralPath (Join-Path $repo '.git')) {
  Write-Host 'repo\ juz istnieje - bez zmian.'
} else {
  $origin = (Invoke-GitQuiet @('-C', $codeRoot, 'remote', 'get-url', 'origin')).Out
  if ($origin -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Adres origin folderu kodu nie jest publicznym adresem https://github.com/...'
  }
  $clone = Invoke-GitQuiet @('clone', '--quiet', $origin, $repo)
  if ($clone.Code -ne 0) { throw "git clone nie powiodl sie: $($clone.Out)" }
  Write-Host 'repo\ pobrane.'
}

Write-Host ''
Write-Host 'Gotowe. Nastepny krok (sesja wdrozeniowa 1):' -ForegroundColor Green
Write-Host '  powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.config\krajozbior-deploy\wdroz.ps1" -Bootstrap'
