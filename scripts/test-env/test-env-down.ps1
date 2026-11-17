# Local disposable test environment of the krajozbior (Windows PowerShell 5.1+).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-down.ps1 [--quiet]
# ASCII-only on purpose (Windows PowerShell 5.1).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Containers = @('krajozbior-testenv-e2e-pg', 'krajozbior-testenv-int-pg')
$Quiet = $args -contains '--quiet'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $RepoRoot
$Descriptor = '.data/test-env/test-env.json'

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

# 1. App process: only the PID this repo recorded, and only if it is still `node`.
if ($d -and (Get-Prop $d 'startedByThisRepo') -eq $true) {
  $appPid = Get-Prop (Get-Prop $d 'app') 'pid'
  if ($appPid) {
    $p = Get-Process -Id $appPid -ErrorAction SilentlyContinue
    # cmd.exe: the log-redirecting wrapper test-env-up.ps1 launches; node: older descriptors.
    if ($p -and $p.ProcessName -in @('cmd', 'node')) {
      Write-Step "stopping app (PID $appPid)"
      $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & taskkill.exe /PID $appPid /T /F 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
    }
  }
}

# 2. Scoped containers (started with --rm, so removal also drops their anonymous volumes).
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
  foreach ($c in $Containers) {
    $exists = (& docker ps -aq --filter "name=^${c}$" 2>$null | Out-String).Trim()
    if ($exists) {
      Write-Step "removing container $c"
      & docker rm -f -v $c 2>&1 | Out-Null
    }
  }
} finally { $ErrorActionPreference = $old }

# 3. Mark the descriptor stopped.
if ($d -and (Get-Prop $d 'status') -ne 'stopped') {
  $d.status = 'stopped'
  [System.IO.File]::WriteAllText((Join-Path $RepoRoot $Descriptor), ($d | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}
Write-Step 'test environment stopped'
exit 0
