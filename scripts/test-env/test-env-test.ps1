# Local disposable test environment of the starter (Windows PowerShell 5.1+).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Suite = 'all'; $UpArgs = @()
foreach ($a in $args) {
  if ($a -in @('integration', 'e2e', 'all')) { $Suite = $a }
  elseif ($a -match '^--?force(-?rebuild)?$') { $UpArgs += $a }
  else { throw "Unknown argument: $a (allowed: integration, e2e, all, --force, --force-rebuild)" }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $RepoRoot
$EnvFile = '.data/test-env/test-env.env'

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
if ($Suite -in @('e2e', 'all')) { Invoke-Suite 'e2e' 'test:e2e' @('--', '--workers=1') }

if ($failed.Count -gt 0) { Write-Host "[test-env] FAILED: $($failed -join ', ')"; exit 1 }
Write-Host "[test-env] all requested suites passed ($Suite)"
exit 0
