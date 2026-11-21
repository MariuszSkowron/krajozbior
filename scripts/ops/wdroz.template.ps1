# wdroz.ps1 - starter of Krajozbior deployments (E11 spec, D-E11-4). TEMPLATE in the public
# repository; new-deploy-secrets.ps1 copies it once into the owner's secrets folder
# (%USERPROFILE%\.config\krajozbior-deploy\wdroz.ps1). The copy does not change afterwards.
#
# It never trusts the code folder the agent works in. It updates its OWN copy of the repository
# (repo\ next to this file), checks that the requested commit is on origin/main (so it went
# through a reviewed and owner-approved PR, CODEOWNERS: /scripts/ and /deploy/) and only then
# runs scripts\ops\deploy.ps1 from that commit.
#
# Usage (owner's PowerShell window, Win+X -> Terminal):
#   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.config\krajozbior-deploy\wdroz.ps1" -Commit <sha>
#   ... wdroz.ps1 -Bootstrap [-Commit <sha>]     first preparation of the server
#   ... wdroz.ps1 -Initial [-Commit <sha>]       first deployment
#   ... wdroz.ps1 -Admin | -Diagnoza | -Otworz | -OdtworzKopie
# Without -Commit the newest origin/main is used.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [string]$Commit = '',
  [switch]$Bootstrap,
  [switch]$Initial,
  [switch]$Admin,
  [switch]$Diagnoza,
  [switch]$Otworz,
  [switch]$OdtworzKopie,
  [string]$Import = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modes = @()
if ($Bootstrap) { $modes += 'bootstrap' }
if ($Initial) { $modes += 'initial' }
if ($Admin) { $modes += 'admin' }
if ($Diagnoza) { $modes += 'diagnoza' }
if ($Otworz) { $modes += 'otworz' }
if ($OdtworzKopie) { $modes += 'odtworz' }
if ($Import -ne '') { $modes += 'import' }
if ($modes.Count -gt 1) { throw 'Podaj jeden tryb naraz.' }
if ($modes.Count -eq 0) {
  if ($Commit -eq '') { throw 'Podaj -Commit <sha> albo tryb (-Bootstrap, -Initial, -Admin, -Diagnoza, -Otworz, -OdtworzKopie).' }
  $modes = @('commit')
}
$mode = $modes[0]

$secretsDir = $PSScriptRoot
$repo = Join-Path $secretsDir 'repo'
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { throw "Brak kopii repozytorium w $repo (uruchom new-deploy-secrets.ps1)." }

function Invoke-Git([string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & git -C $repo @argv 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "git $($argv[0]) nie powiodl sie: $out" }
  return $out.Trim()
}

Invoke-Git @('fetch', '--quiet', 'origin', 'main') | Out-Null
if ($Commit -eq '') { $Commit = Invoke-Git @('rev-parse', 'origin/main') }
if ($Commit -notmatch '^[0-9a-f]{7,40}$') { throw 'Nieprawidlowy commit.' }
$sha = Invoke-Git @('rev-parse', '--verify', "$Commit^{commit}")

$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& git -C $repo merge-base --is-ancestor $sha origin/main 2>$null
$onMain = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $old
if (-not $onMain) { throw "Commit $sha nie jest na origin/main. Wdrazamy tylko scalone zmiany." }

Invoke-Git @('-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force', $sha) | Out-Null
$repoUrl = Invoke-Git @('remote', 'get-url', 'origin')

Write-Host "Kod: commit $sha (na origin/main)." -ForegroundColor Gray
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\ops\deploy.ps1') `
  -SecretsDir $secretsDir -Mode $mode -Sha $sha -RepoUrl $repoUrl
exit $LASTEXITCODE
