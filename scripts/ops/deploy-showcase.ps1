# Target "showcase" of deploy.ps1: rehearsal of the deployment on the local showcase
# (spec 5.4 "Kto co robi", D-E11-7, D-E11-8). Started only by deploy.ps1 -Target showcase.
#
# Runs the same server-side steps as the deployment (scripts/ops/server/lib.sh + remote.sh:
# backup, build with the commit label, migrations, swap of `app`, health and home page check,
# return to the previous image on failure) in a local Git Bash against Docker Desktop.
# The differences from the server live in scripts/ops/server/showcase.sh only.
# This script never reads the owner's secrets folder, never asks for the deployment passphrase
# and never starts the remote-shell client: it has no server address at all.
#
#   powershell -ExecutionPolicy Bypass -File scripts/ops/deploy.ps1 -Target showcase `
#     -Mode initial|commit -Sha <40 hex> [-ShowcaseProject krajozbior-rehearsal -ShowcasePort 3310]
#
# Data of the project live in .data/<name>/ of this checkout (krajozbior-showcase -> .data/showcase,
# the showcase's own folder; krajozbior-rehearsal -> .data/rehearsal): passwords (secrets.env,
# generated on first use, never printed), code clone, state and backups in deploy/.
# The report goes to .data/deploy/<date>-<project>-<mode>.log.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [Parameter(Mandatory = $true)][ValidateSet('initial', 'commit')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$Project = 'krajozbior-showcase',
  [int]$Port = 3300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

if (-not (Test-CommitSha $Sha)) { throw 'Nieprawidlowy commit (oczekiwane 40 znakow 0-9a-f).' }
if (-not (Test-ShowcaseProject $Project)) { throw "Nieprawidlowy projekt pokazu: $Project (krajozbior-<nazwa>)." }
if (-not (Test-ShowcasePort $Port)) { throw "Port $Port jest niedozwolony (1024-65535, bez 3000, 3100, 5432, 55432, 55433)." }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$overlay = Join-Path $repoRoot 'deploy\compose.showcase-target.yaml'
$serverDir = Join-Path $PSScriptRoot 'server'
$dataDir = Join-Path $repoRoot (Join-Path '.data' (Get-ShowcaseDataName $Project))

function Invoke-Quiet([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argv 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return @{ Code = $code; Out = $out.Trim() }
}

# 1. Docker, port, memory.
if ((Invoke-Quiet 'docker' @('info', '--format', '{{.ServerVersion}}')).Code -ne 0) {
  throw 'Docker nie dziala. Uruchom Docker Desktop.'
}
$running = Invoke-Quiet 'docker' @('inspect', '-f', '{{.State.Running}}', "$Project-app")
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$portFree = $true
try { $listener.Start() } catch { $portFree = $false } finally { try { $listener.Stop() } catch { } }
if (-not $portFree -and -not ($running.Code -eq 0 -and $running.Out -eq 'true')) {
  throw "Port $Port zajmuje inny program."
}
$freeGb = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB
if ($freeGb -lt 3) { throw ("Wolna pamiec {0:N1} GB; budowa obrazu potrzebuje 3 GB." -f $freeGb) }

# 2. Passwords of the project (first use only), same set as scripts/showcase/showcase-lib.ps1.
foreach ($d in @($dataDir, (Join-Path $dataDir 'outbox'), (Join-Path $dataDir 'reports'))) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
$secretsFile = Join-Path $dataDir 'secrets.env'
$pgFile = Join-Path $dataDir 'pg-bootstrap'
if (-not ((Test-Path -LiteralPath $secretsFile) -and (Test-Path -LiteralPath $pgFile))) {
  $pg = New-RandomHex
  $lines = @(
    "SHOWCASE_PG_PASSWORD=$pg",
    "KRAJOZBIOR_OWNER_DB_PASSWORD=$(New-RandomHex)",
    "KRAJOZBIOR_APP_DB_PASSWORD=$(New-RandomHex)",
    "KRAJOZBIOR_AUTH_DB_PASSWORD=$(New-RandomHex)",
    "KRAJOZBIOR_OPS_DB_PASSWORD=$(New-RandomHex)",
    "BETTER_AUTH_SECRET=$((New-RandomHex) + (New-RandomHex))",
    "DEMO_ACCOUNT_PASSWORD=$(New-RandomHex)"
  )
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($secretsFile, (($lines -join "`n") + "`n"), $utf8)
  [IO.File]::WriteAllText($pgFile, $pg, $utf8)
  Write-Host "[pokaz] hasla projektu $Project zapisane w $dataDir (nie sa wypisywane)"
}

# 3. Payload: the same lib.sh and remote.sh as on the server, plus showcase.sh.
$git = Invoke-Quiet 'git' @('-C', $repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir')
if ($git.Code -ne 0) { throw 'Nie znaleziono repozytorium git.' }
$plain = @{ KZ_MODE = $Mode; KZ_COMMIT = $Sha; KZ_REPO_URL = ($git.Out -replace '\\', '/') }
$modeText = [IO.File]::ReadAllText((Join-Path $serverDir 'remote.sh')) + "`n" +
  [IO.File]::ReadAllText((Join-Path $serverDir 'showcase.sh'))
$payload = New-RemotePayload ([IO.File]::ReadAllText((Join-Path $serverDir 'lib.sh'))) `
  (New-RemotePreamble $plain @{}) $modeText

# 4. Local Git Bash, configuration in its environment; report like the server deployment.
$reportDir = Join-Path $repoRoot '.data\deploy'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$reportFile = Join-Path $reportDir (Get-ReportFileName (Get-Date) "$Project-$Mode")
function Write-Report([string]$line) {
  $safe = Protect-ReportLine $line
  [IO.File]::AppendAllText($reportFile, $safe + "`n", (New-Object Text.UTF8Encoding($false)))
  return $safe
}
$started = Get-Date
Write-Report ("proba generalna: cel showcase, projekt {0}, port {1}, tryb {2}, commit {3}, start {4:yyyy-MM-dd HH:mm:ss}" -f $Project, $Port, $Mode, $Sha, $started) | Out-Null

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = Find-GitBash
$psi.Arguments = '-s'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
$envVars = Get-ShowcaseEnvironment $Project $Port $dataDir $overlay
foreach ($name in $envVars.Keys) { $psi.EnvironmentVariables[$name] = $envVars[$name] }
$process = Start-PayloadProcess $psi $payload
while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
  Write-Host (Write-Report $line)
}
$process.WaitForExit()
$code = $process.ExitCode
$seconds = [int]((Get-Date) - $started).TotalSeconds
$result = if ($code -eq 0) { 'GOTOWE' } else { 'BLAD' }
Write-Host (Write-Report "wynik: $result (kod $code, $seconds s)")
Write-Host "Raport: $reportFile"
exit $code
