# Local disposable test environment of the krajozbior (Windows PowerShell 5.1+).
#
# Stops the environment of THIS station only (see test-env-station.mjs): the app process
# it recorded and the containers krajozbior-testenv-<station>-e2e-pg / -int-pg. Containers
# of other stations, older unscoped test containers and every other container stay untouched.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-down.ps1 [--quiet]
# Env override: TEST_ENV_STATION (the station whose environment to stop).
# ASCII-only on purpose (Windows PowerShell 5.1).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'test-env-lib.ps1')

$Quiet = $args -contains '--quiet'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $RepoRoot
$StationCfg = Get-TestEnvStation $RepoRoot
$Station = $StationCfg.station
$Descriptor = "$($StationCfg.stateDir)/test-env.json"

function Write-Step([string]$msg) { if (-not $Quiet) { Write-Host "[test-env] $msg" } }

function Get-Prop($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

$d = $null
if (Test-Path -LiteralPath $Descriptor) {
  try { $d = Get-Content -LiteralPath $Descriptor -Raw | ConvertFrom-Json } catch { $d = $null }
}

# 1. App process: only the PID this station recorded for a running environment, only if it
#    is still cmd/node and (when recorded) started at the recorded time - never a reused PID.
if ($d -and (Get-Prop $d 'startedByThisRepo') -eq $true -and (Get-Prop $d 'status') -ne 'stopped') {
  $app = Get-Prop $d 'app'
  $appPid = Get-Prop $app 'pid'
  $recordedStart = Get-Prop $app 'processStartedAt'
  if ($appPid) {
    $p = Get-Process -Id $appPid -ErrorAction SilentlyContinue
    $sameProcess = $true
    if ($p -and $recordedStart) {
      try { $sameProcess = ($p.StartTime.ToUniversalTime().ToString('o') -eq $recordedStart) } catch { $sameProcess = $false }
    }
    # cmd.exe: the log-redirecting wrapper test-env-up.ps1 launches; node: older descriptors.
    if ($p -and $sameProcess -and $p.ProcessName -in @('cmd', 'node')) {
      Write-Step "stopping app of station $Station (PID $appPid)"
      $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & taskkill.exe /PID $appPid /T /F 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
    }
  }
}

# 2. This station's containers, by exact name (started with --rm, so removal also drops
#    their anonymous volumes). The filter lives in test-env-station.mjs (containersToRemove).
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
  $all = @(& docker ps -a --format '{{.Names}}' 2>$null | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
  $dockerCode = $LASTEXITCODE
} finally { $ErrorActionPreference = $old }
if ($dockerCode -ne 0) {
  Write-Step 'docker is not answering: no container removed'
} else {
  foreach ($c in (Select-OwnContainers $RepoRoot $all)) {
    Write-Step "removing container $c"
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & docker rm -f -v $c 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
  }
}

# 3. Mark the descriptor stopped.
if ($d -and (Get-Prop $d 'status') -ne 'stopped') {
  $d.status = 'stopped'
  [System.IO.File]::WriteAllText((Join-Path $RepoRoot $Descriptor), ($d | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}
Write-Step "test environment of station $Station stopped"
exit 0
