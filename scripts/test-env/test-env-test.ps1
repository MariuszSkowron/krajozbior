# Local disposable test environment of the krajozbior (Windows PowerShell 5.1+).
#
# Brings up (or reuses) this station's environment and runs the requested suites against it.
# Integration runs need no lock (each station has its own cluster); E2E holds one
# machine-wide lock, so only one local E2E run happens at a time (docs/testing.md).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1 [integration|e2e|all] [--force] [--force-rebuild]
# Env override: TEST_ENV_STATION. ASCII-only on purpose (Windows PowerShell 5.1).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'test-env-lib.ps1')
$E2eLockName    = 'krajozbior-test-env-e2e'
$E2eLockMinutes = 60

$Suite = 'all'; $UpArgs = @()
foreach ($a in $args) {
  if ($a -in @('integration', 'e2e', 'all')) { $Suite = $a }
  elseif ($a -match '^--?force(-?rebuild)?$') { $UpArgs += $a }
  else { throw "Unknown argument: $a (allowed: integration, e2e, all, --force, --force-rebuild)" }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $RepoRoot
$EnvFile = "$((Get-TestEnvStation $RepoRoot).stateDir)/test-env.env"

& powershell -NoProfile -ExecutionPolicy Bypass -File 'scripts/test-env/test-env-up.ps1' @UpArgs
if ($LASTEXITCODE -ne 0) { Write-Host '[test-env] environment did not come up'; exit 1 }

# Load the disposable values into this process only (never printed).
foreach ($line in Get-Content -LiteralPath $EnvFile) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}
# CI=1 would make Playwright start its own server instead of reusing this one.
Remove-Item -Path env:CI -ErrorAction SilentlyContinue

$failed = @()
function Invoke-Suite([string]$name, [string]$npmScript, [string[]]$extra) {
  Write-Host "[test-env] npm run $npmScript $($extra -join ' ')"
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & npm.cmd run $npmScript @extra; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { $script:failed += $name }
}

if ($Suite -in @('integration', 'all')) { Invoke-Suite 'integration' 'test:integration' @() }
# One worker, like CI: with Playwright's local default (several workers) the first
# page.goto of each worker timed out against `next start` on Windows (2026-11-08).
if ($Suite -in @('e2e', 'all')) {
  $e2eLock = Enter-MachineLock $E2eLockName $E2eLockMinutes 'a local E2E run'
  try { Invoke-Suite 'e2e' 'test:e2e' @('--', '--workers=1') } finally { Exit-MachineLock $e2eLock }
}

if ($failed.Count -gt 0) { Write-Host "[test-env] FAILED: $($failed -join ', ')"; exit 1 }
Write-Host "[test-env] all requested suites passed ($Suite)"
exit 0
