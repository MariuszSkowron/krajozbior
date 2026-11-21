# Shared helpers of the local test environment (dot-sourced by test-env-*.ps1).
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
#
# Station: names, preferred ports and the state folder of this checkout come from
# test-env-station.mjs (one tested source of truth; see its header).
# Machine-wide locks: named mutexes in the Global namespace, shared by every checkout
# on this computer. The operating system releases a mutex when its process ends,
# also after an error or a crash, so a lock never outlives its holder.

$TestEnvStationScript = Join-Path $PSScriptRoot 'test-env-station.mjs'

function Get-NodeExe {
  return (Get-Command node -CommandType Application | Select-Object -First 1).Source
}

# Runs test-env-station.mjs; returns its stdout lines; throws on a non-zero exit.
function Invoke-StationTool([string]$root, [string[]]$argv) {
  $node = Get-NodeExe
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & $node $TestEnvStationScript @argv '--root' $root 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "test-env-station.mjs failed: $(($out | Out-String).Trim())" }
  return @($out | ForEach-Object { "$_" })
}

# Station config: station, slot, ports.{app,integration,e2e}, containers.{e2e,integration}, stateDir, label.
function Get-TestEnvStation([string]$root) {
  return ((Invoke-StationTool $root @('config')) -join "`n" | ConvertFrom-Json)
}

# Those of the given container names that belong to this station (exact names only).
function Select-OwnContainers([string]$root, [string[]]$names) {
  if (-not $names -or $names.Count -eq 0) { return @() }
  return @(Invoke-StationTool $root (@('own') + $names) | Where-Object { $_ -ne '' })
}

function Test-AbandonedMutex($err) {
  $e = $err.Exception
  while ($e) {
    if ($e -is [System.Threading.AbandonedMutexException]) { return $true }
    $e = $e.InnerException
  }
  return $false
}

# Takes the machine-wide lock $name, waiting up to $timeoutMinutes; returns the mutex to pass to Exit-MachineLock.
function Enter-MachineLock([string]$name, [int]$timeoutMinutes, [string]$purpose) {
  $mutex = New-Object System.Threading.Mutex($false, "Global\$name")
  $deadline = (Get-Date).AddMinutes($timeoutMinutes)
  $announced = $false
  while ($true) {
    $acquired = $false
    try { $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(5)) }
    catch {
      # The previous holder ended without releasing it (error or crash): the lock is now ours.
      if (Test-AbandonedMutex $_) { $acquired = $true } else { $mutex.Dispose(); throw }
    }
    if ($acquired) {
      if ($announced) { Write-Host "[test-env] machine-wide lock $name acquired" }
      return $mutex
    }
    if (-not $announced) {
      Write-Host "[test-env] waiting for machine-wide lock $name ($purpose runs in another checkout or window; up to $timeoutMinutes min)"
      $announced = $true
    }
    if ((Get-Date) -gt $deadline) {
      $mutex.Dispose()
      throw "Machine-wide lock $name still held after $timeoutMinutes min ($purpose in another checkout or window)"
    }
  }
}

function Exit-MachineLock($mutex) {
  if ($null -eq $mutex) { return }
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}
