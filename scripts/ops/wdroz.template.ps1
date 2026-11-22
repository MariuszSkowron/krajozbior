# wdroz.ps1 - starter of Krajozbior deployments (E11 spec, D-E11-4). TEMPLATE in the public
# repository; new-deploy-secrets.ps1 copies it once into the owner's secrets folder
# (%USERPROFILE%\.config\krajozbior-deploy\wdroz.ps1). The copy changes only when the owner runs
# new-deploy-secrets.ps1 -OdswiezWdroz from the clean clone; this script says when the template
# in repo\ differs from itself.
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
#   ... wdroz.ps1 -Import <full path of a *-public.ndjson file> [-OrgSlug <slug>]
#   ... wdroz.ps1 -Aktualnosci <full path of an aktualnosci-<name>.ndjson file>   news of the team
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
  [string]$Aktualnosci = '',
  [string]$Import = '',
  [string]$OrgSlug = ''
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
if ($Aktualnosci -ne '') { $modes += 'aktualnosci' }
if ($Import -ne '') { $modes += 'import' }
if ($modes.Count -gt 1) { throw 'Podaj jeden tryb naraz.' }
if ($OrgSlug -ne '' -and $Import -eq '') { throw '-OrgSlug dziala tylko z -Import <plik>.' }
if ($modes.Count -eq 0) {
  if ($Commit -eq '') { throw 'Podaj -Commit <sha> albo tryb (-Bootstrap, -Initial, -Admin, -Diagnoza, -Otworz, -OdtworzKopie, -Aktualnosci <plik>, -Import <plik>).' }
  $modes = @('commit')
}
$mode = $modes[0]

$secretsDir = $PSScriptRoot
$repo = Join-Path $secretsDir 'repo'
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { throw "Brak kopii repozytorium w $repo (uruchom new-deploy-secrets.ps1)." }

# Safe options on every git call (second layer after "own copy only"): a repository's .git\config
# can make git run a program (core.fsmonitor, hooks); same list as $SafeGitOptions in deploy-lib.ps1.
$safeGit = @('-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=NUL', '-c', 'core.pager=cat', '-c', 'protocol.ext.allow=never')

function Invoke-Git([string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & git @safeGit -C $repo @argv 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "git $($argv[0]) nie powiodl sie: $out" }
  return $out.Trim()
}

Invoke-Git @('fetch', '--quiet', 'origin', 'main') | Out-Null
if ($Commit -eq '') { $Commit = Invoke-Git @('rev-parse', 'origin/main') }
if ($Commit -notmatch '^[0-9a-f]{7,40}$') { throw 'Nieprawidlowy commit.' }
$sha = Invoke-Git @('rev-parse', '--verify', "$Commit^{commit}")

$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& git @safeGit -C $repo merge-base --is-ancestor $sha origin/main 2>$null
$onMain = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $old
if (-not $onMain) { throw "Commit $sha nie jest na origin/main. Wdrazamy tylko scalone zmiany." }

Invoke-Git @('-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force', $sha) | Out-Null
$repoUrl = Invoke-Git @('remote', 'get-url', 'origin')

Write-Host "Kod: commit $sha (na origin/main)." -ForegroundColor Gray

# A newer starter in the checked-out commit: say so (the copy is replaced only by the owner).
# Only when the commit is the newest origin/main: after `-Commit <older sha>` a different template
# is the older one, and the hint would invite going back.
$template = Join-Path $repo 'scripts\ops\wdroz.template.ps1'
$newestMain = Invoke-Git @('rev-parse', 'origin/main')
if (($sha -eq $newestMain) -and (Test-Path -LiteralPath $template) -and
  (Get-FileHash -LiteralPath $template).Hash -ne (Get-FileHash -LiteralPath $PSCommandPath).Hash) {
  Write-Host 'Uwaga: w tym commicie jest nowsza wersja wdroz.ps1. Odswiez ja poleceniem:' -ForegroundColor Yellow
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$repo\scripts\ops\new-deploy-secrets.ps1`" -OdswiezWdroz" -ForegroundColor Yellow
}

$deployArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repo 'scripts\ops\deploy.ps1'),
  '-SecretsDir', $secretsDir, '-Mode', $mode, '-Sha', $sha, '-RepoUrl', $repoUrl)
if ($mode -eq 'aktualnosci') {
  $deployArgs += @('-NewsFile', $Aktualnosci)
}
if ($mode -eq 'import') {
  $deployArgs += @('-ImportFile', $Import)
  if ($OrgSlug -ne '') { $deployArgs += @('-OrgSlug', $OrgSlug) }
}
& powershell @deployArgs
exit $LASTEXITCODE
