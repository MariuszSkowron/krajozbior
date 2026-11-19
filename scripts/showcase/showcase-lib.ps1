# Wspolne funkcje pokazu lokalnego "krajozbior-showcase" (dot-source z showcase-*.ps1).
# Pokaz to osobny projekt Docker Compose: kontenery krajozbior-showcase-*, siec
# krajozbior-showcase_default, wolumen krajozbior-showcase-pgdata, aplikacja tylko na
# 127.0.0.1:3300, baza bez portu na hoscie. Nie dzieli nazw ani portow
# z lokalnym srodowiskiem testowym i srodowiskiem dewelopera (D-E11-8).
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ShowcaseProject = 'krajozbior-showcase'
$ShowcaseVolume  = 'krajozbior-showcase-pgdata'
$ShowcaseAppName = 'krajozbior-showcase-app'
$ShowcasePort    = 3300
$ShowcaseUrl     = "http://127.0.0.1:$ShowcasePort"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $RepoRoot

$DataDir     = '.data/showcase'
$SecretsFile = "$DataDir/secrets.env"
$PgFile      = "$DataDir/pg-bootstrap"

function Write-Step([string]$msg) { Write-Host "[showcase] $msg" }

# Runs a native command; output streams to the console; throws on non-zero exit.
function Invoke-Native([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $exe @argv; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "Command failed (exit $code): $exe $($argv[0..([Math]::Min(3, $argv.Count - 1))] -join ' ')" }
}

# Runs a native command quietly; returns @{ Code; Out }.
function Invoke-Quiet([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argv 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return @{ Code = $code; Out = $out }
}

function Write-Utf8([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText((Join-Path $RepoRoot $path), $text, (New-Object System.Text.UTF8Encoding($false)))
}

function New-Secret([int]$bytesCount = 24) {
  $bytes = New-Object byte[] $bytesCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes); $rng.Dispose()
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-PortFree([int]$port) {
  $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
  try { $l.Start(); return $true } catch { return $false } finally { try { $l.Stop() } catch { } }
}

function Assert-Docker {
  $r = Invoke-Quiet 'docker' @('info', '--format', '{{.ServerVersion}}')
  if ($r.Code -ne 0) { throw 'Docker is not running. Start Docker Desktop and run this script again.' }
}

function Test-ShowcaseAppRunning {
  $r = Invoke-Quiet 'docker' @('inspect', '-f', '{{.State.Running}}', $ShowcaseAppName)
  return ($r.Code -eq 0 -and $r.Out.Trim() -eq 'true')
}

# One-time disposable secrets (git-ignored .data/showcase/). Never printed.
function Initialize-Secrets {
  New-Item -ItemType Directory -Force -Path $DataDir, "$DataDir/outbox", "$DataDir/reports" | Out-Null
  if ((Test-Path -LiteralPath $SecretsFile) -and (Test-Path -LiteralPath $PgFile)) { return $false }
  $pg = New-Secret
  $lines = @(
    "SHOWCASE_PG_PASSWORD=$pg",
    "KRAJOZBIOR_OWNER_DB_PASSWORD=$(New-Secret)",
    "KRAJOZBIOR_APP_DB_PASSWORD=$(New-Secret)",
    "KRAJOZBIOR_AUTH_DB_PASSWORD=$(New-Secret)",
    "KRAJOZBIOR_OPS_DB_PASSWORD=$(New-Secret)",
    "BETTER_AUTH_SECRET=$((New-Secret) + (New-Secret))",
    "DEMO_ACCOUNT_PASSWORD=$(New-Secret)"
  )
  Write-Utf8 $SecretsFile (($lines -join "`n") + "`n")
  Write-Utf8 $PgFile $pg
  return $true
}

# docker compose of the showcase project: server file + overlay + secrets for interpolation.
function Get-ComposeArgs {
  return @('compose', '-p', $ShowcaseProject,
    '-f', 'deploy/compose.yaml', '-f', 'deploy/compose.showcase.yaml',
    '--env-file', $SecretsFile)
}

function Invoke-Compose([string[]]$argv) {
  Invoke-Native 'docker' ((Get-ComposeArgs) + $argv)
}
