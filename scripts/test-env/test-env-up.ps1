# Local disposable test environment of the krajozbior (Windows PowerShell 5.1+).
#
# Brings up two disposable postgres:17 containers (app + E2E on 55433, integration tests on
# 55432 when free), runs db:roles -> db:migrate -> db:seed:demo, builds (cached) and starts
# `next start` on 3100 when free. State and disposable secrets go to .data/test-env/ (git-ignored).
# Never touches the developer database (127.0.0.1:5432) or port 3000.
#
# Usage (Windows PowerShell 5.1+):
#   powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-up.ps1 [--force] [--force-rebuild]
# Env override: TEST_ENV_CACHE_TTL_SECONDS (default 3600).
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- variables
$PgImage          = 'postgres:17'
$E2eContainer     = 'krajozbior-testenv-e2e-pg'
$E2ePreferredPort = 55433
$E2eDatabase      = 'krajozbior_e2e'
$E2eAdminUser     = 'krajozbior_e2e'
$IntContainer     = 'krajozbior-testenv-int-pg'
$IntPreferredPort = 55432
$IntDatabase      = 'krajozbior_integration_test'
$IntAdminUser     = 'krajozbior_test'
$AppPreferredPort = 3100
$HealthPath       = '/api/health'
$DemoAccounts     = @('user', 'user2', 'admin')   # <role>@demo.krajozbior.local
$PrepCommands     = @('db:roles', 'db:migrate', 'db:seed:demo')      # npm scripts, in order
$BuildInputs      = @('src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json')
$BuildEnvVars     = @()                                              # no env var shapes the build output today
$Artifacts        = @('.next/BUILD_ID')
$TtlSeconds       = 3600
if ($env:TEST_ENV_CACHE_TTL_SECONDS -match '^\d+$') { $TtlSeconds = [int]$env:TEST_ENV_CACHE_TTL_SECONDS }

$Force = $false; $ForceRebuild = $false
foreach ($a in $args) {
  switch -regex ($a) {
    '^--?force$'           { $Force = $true }
    '^--?force-?rebuild$'  { $ForceRebuild = $true }
    default                { throw "Unknown argument: $a (allowed: --force, --force-rebuild)" }
  }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $RepoRoot
$QaDir       = '.data/test-env'
$Descriptor  = "$QaDir/test-env.json"
$EnvFile     = "$QaDir/test-env.env"
$BuildCache  = "$QaDir/test-env-build-cache.json"
$LockDir     = "$QaDir/test-env.lock"
$AppLog      = "$QaDir/test-env-app.log"
$AppErrLog   = "$QaDir/test-env-app.err.log"
$DownScript  = 'scripts/test-env/test-env-down.ps1'
New-Item -ItemType Directory -Force -Path $QaDir | Out-Null
$Started = Get-Date

# ---------------------------------------------------------------- helpers
function Write-Step([string]$msg) { Write-Host "[test-env] $msg" }

function Get-UtcStamp { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

function Read-Json([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json) } catch { return $null }
}

function Write-Utf8([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText((Join-Path $RepoRoot $path), $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Prop($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

# Runs a native command; output streams to the console; throws on non-zero exit.
function Invoke-Native([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $exe @argv; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "Command failed (exit $code): $exe $($argv -join ' ')" }
}

# Runs a native command quietly; returns @{ Code; Out }.
function Invoke-Quiet([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argv 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return @{ Code = $code; Out = $out }
}

function Test-PortFree([int]$port) {
  $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
  try { $l.Start(); return $true } catch { return $false } finally { try { $l.Stop() } catch { } }
}

function Get-FreePort {
  $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $l.Start(); $port = $l.LocalEndpoint.Port; $l.Stop(); return $port
}

function Select-Port([int]$preferred) {
  if (Test-PortFree $preferred) { return $preferred }
  return (Get-FreePort)
}

function New-Secret {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes); $rng.Dispose()
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-Http([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 5
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Test-ContainerRunning([string]$name) {
  $r = Invoke-Quiet 'docker' @('inspect', '-f', '{{.State.Running}}', $name)
  return ($r.Code -eq 0 -and $r.Out.Trim() -eq 'true')
}

function Get-RelPath([string]$full) { return ($full.Substring($RepoRoot.Length + 1) -replace '\\', '/') }

function Get-InputFiles([string[]]$paths) {
  foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p -PathType Container) {
      Get-ChildItem -LiteralPath $p -Recurse -File -Force |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.next|coverage|\.git)[\\/]' } |
        # MikroORM writes gitignored schema snapshots into src/ during db:migrate and integration runs.
        Where-Object { $_.Name -notlike '.snapshot-*.json' }
    } elseif (Test-Path -LiteralPath $p -PathType Leaf) {
      Get-Item -LiteralPath $p -Force
    }
  }
}

function Get-Fingerprint {
  $lines = @(Get-InputFiles $BuildInputs | ForEach-Object { "$(Get-RelPath $_.FullName):$($_.Length):$($_.LastWriteTimeUtc.Ticks)" })
  foreach ($v in $BuildEnvVars) { $lines += "env:$v=$([Environment]::GetEnvironmentVariable($v))" }
  $text = (($lines | Sort-Object -CaseSensitive) -join "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text)) } finally { $sha.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-BuildNeeded([string]$fp) {
  if ($ForceRebuild) { return 'forced (--force-rebuild)' }
  $c = Read-Json $BuildCache
  if ($null -eq $c) { return 'no build cache' }
  if ((Get-Prop $c 'sourceFingerprint') -ne $fp) { return 'sources changed' }
  if ((Get-Prop $c 'projectRoot') -ne $RepoRoot) { return 'cache from another checkout' }
  foreach ($a in $Artifacts) { if (-not (Test-Path -LiteralPath $a)) { return "missing artifact $a" } }
  return $null
}

# Why the recorded environment cannot be reused, or $null when it can.
function Get-StaleReason {
  $d = Read-Json $Descriptor
  if ($null -eq $d) { return 'no descriptor' }
  if ((Get-Prop $d 'status') -ne 'running') { return 'descriptor not running' }
  $app = Get-Prop $d 'app'
  $appPid = Get-Prop $app 'pid'
  if (-not $appPid -or -not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { return 'app process gone' }
  foreach ($c in @($E2eContainer, $IntContainer)) { if (-not (Test-ContainerRunning $c)) { return "container $c not running" } }
  # PowerShell 7 ConvertFrom-Json already yields a DateTime; 5.1 yields the string.
  $rawStart = Get-Prop $d 'startedAt'
  if ($rawStart -is [DateTime]) { $startedAt = $rawStart.ToUniversalTime() }
  else { $startedAt = [DateTime]::Parse([string]$rawStart, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime() }
  if (((Get-Date).ToUniversalTime() - $startedAt).TotalSeconds -gt $TtlSeconds) { return "older than TTL ${TtlSeconds}s" }
  $newer = Get-InputFiles $BuildInputs | Where-Object { $_.LastWriteTimeUtc -gt $startedAt } | Select-Object -First 1
  if ($newer) { return "source changed since start: $(Get-RelPath $newer.FullName)" }
  $base = Get-Prop $d 'baseUrl'
  if (-not (Test-Http "$base/")) { return 'app shell probe failed' }
  if (-not (Test-Http "$base$HealthPath")) { return 'health probe (database) failed' }
  return $null
}

function Write-ResultLines([string]$baseUrl, [int]$reused, [int]$browserInstalled) {
  Write-Output "TEST_ENV_STATUS=running"
  Write-Output "TEST_ENV_BASE_URL=$baseUrl"
  Write-Output "TEST_ENV_DESCRIPTOR=$Descriptor"
  Write-Output "TEST_ENV_REUSED=$reused"
  Write-Output "BROWSER_PROVIDER=playwright"
  Write-Output "BROWSER_INSTALLED=$browserInstalled"
}

function Wait-Postgres([string]$container, [string]$user, [string]$db) {
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    # TCP inside the container: the image's init phase listens on the socket only.
    $r = Invoke-Quiet 'docker' @('exec', $container, 'psql', '-h', '127.0.0.1', '-U', $user, '-d', $db, '-tAc', 'select 1')
    if ($r.Code -eq 0 -and $r.Out.Trim() -eq '1') { return }
    Start-Sleep -Seconds 1
  }
  throw "PostgreSQL in $container did not become ready within 90s"
}

function Start-Postgres([string]$container, [int]$port, [string]$user, [string]$password, [string]$db) {
  Write-Step "starting $container on 127.0.0.1:$port"
  $r = Invoke-Quiet 'docker' @('run', '-d', '--rm', '--name', $container,
    '-e', "POSTGRES_USER=$user", '-e', "POSTGRES_PASSWORD=$password", '-e', "POSTGRES_DB=$db",
    '-p', "127.0.0.1:${port}:5432", $PgImage)
  if ($r.Code -ne 0) { throw "docker run $container failed: $($r.Out.Trim())" }
}

# ---------------------------------------------------------------- lock
function Enter-Lock {
  $deadline = (Get-Date).AddMinutes(5)
  while ($true) {
    try {
      New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
      Write-Utf8 "$LockDir/owner.json" (@{ pid = $PID; source = 'test-env-up.ps1'; acquiredAt = (Get-UtcStamp) } | ConvertTo-Json)
      return
    } catch {
      $owner = Read-Json "$LockDir/owner.json"
      $ownerPid = Get-Prop $owner 'pid'
      $young = ((Get-Date) - (Get-Item -LiteralPath $LockDir -ErrorAction SilentlyContinue).CreationTime).TotalSeconds -lt 10
      if (-not $ownerPid -and -not $young) {
        Remove-Item -LiteralPath $LockDir -Recurse -Force -ErrorAction SilentlyContinue; continue
      }
      if ($ownerPid -and -not (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) {
        Write-Step "removing stale lock of dead PID $ownerPid"
        Remove-Item -LiteralPath $LockDir -Recurse -Force -ErrorAction SilentlyContinue; continue
      }
      if ((Get-Date) -gt $deadline) { throw "Another bootstrap (PID $ownerPid) still holds $LockDir after 5 min" }
      Start-Sleep -Seconds 2
    }
  }
}

function Exit-Lock {
  $owner = Read-Json "$LockDir/owner.json"
  if ((Get-Prop $owner 'pid') -eq $PID) { Remove-Item -LiteralPath $LockDir -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- main
Enter-Lock
try {
  # 1. Reuse check
  if (-not $Force) {
    $reason = Get-StaleReason
    if ($null -eq $reason) {
      $d = Read-Json $Descriptor
      Write-Step "reusing running environment (runId $(Get-Prop $d 'runId'))"
      $bi = 0; if ((Get-Prop (Get-Prop $d 'browser') 'installed') -eq $true) { $bi = 1 }
      Write-ResultLines (Get-Prop $d 'baseUrl') 1 $bi
      exit 0
    }
    Write-Step "fresh boot needed: $reason"
  } else {
    Write-Step 'fresh boot forced (--force)'
  }

  # 2. Tear down whatever this repo started before (scoped names / recorded PID only)
  & powershell -NoProfile -ExecutionPolicy Bypass -File $DownScript --quiet
  if ($LASTEXITCODE -ne 0) { throw 'test-env-down.ps1 failed during cleanup' }

  # 3. Prerequisites
  $r = Invoke-Quiet 'docker' @('info', '--format', '{{.ServerVersion}}')
  if ($r.Code -ne 0) { throw 'Docker is not running. Start Docker Desktop and run this script again.' }
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Step 'node_modules missing: npm ci'
    Invoke-Native 'npm.cmd' @('ci')
  }

  # 4. Disposable secrets (test-only; written to the gitignored env file)
  $s = @{
    E2eAdmin = New-Secret; IntAdmin = New-Secret
    Owner = New-Secret; App = New-Secret; Auth = New-Secret; Ops = New-Secret
    Session = (New-Secret) + (New-Secret); Demo = New-Secret
  }

  # 5. Services
  $e2ePort = Select-Port $E2ePreferredPort
  Start-Postgres $E2eContainer $e2ePort $E2eAdminUser $s.E2eAdmin $E2eDatabase
  $intPort = Select-Port $IntPreferredPort
  if ($intPort -eq $e2ePort) { $intPort = Get-FreePort }
  Start-Postgres $IntContainer $intPort $IntAdminUser $s.IntAdmin $IntDatabase
  Wait-Postgres $E2eContainer $E2eAdminUser $E2eDatabase
  Wait-Postgres $IntContainer $IntAdminUser $IntDatabase

  $appPort = Select-Port $AppPreferredPort
  $baseUrl = "http://127.0.0.1:$appPort"
  $pgE2e = "127.0.0.1:$e2ePort/$E2eDatabase"
  # Set explicitly: Next.js and tsx --env-file never override existing variables,
  # so the developer's .env cannot redirect this environment.
  $vars = [ordered]@{
    DATABASE_ADMIN_URL      = "postgres://${E2eAdminUser}:$($s.E2eAdmin)@$pgE2e"
    KRAJOZBIOR_OWNER_DB_PASSWORD = $s.Owner
    KRAJOZBIOR_APP_DB_PASSWORD   = $s.App
    KRAJOZBIOR_AUTH_DB_PASSWORD  = $s.Auth
    KRAJOZBIOR_OPS_DB_PASSWORD   = $s.Ops
    DATABASE_MIGRATION_URL  = "postgres://krajozbior_owner:$($s.Owner)@$pgE2e"
    DATABASE_OPS_URL        = "postgres://krajozbior_ops:$($s.Ops)@$pgE2e"
    DATABASE_URL            = "postgres://krajozbior_app:$($s.App)@$pgE2e"
    DATABASE_AUTH_URL       = "postgres://krajozbior_auth:$($s.Auth)@$pgE2e"
    BETTER_AUTH_SECRET      = $s.Session
    BETTER_AUTH_URL         = $baseUrl
    DEMO_ACCOUNT_PASSWORD   = $s.Demo
    # The demo seed runs only with this flag; the production build lets the demo
    # accounts sign in only with DEMO_ACCOUNTS_TEST_ONLY=1 and a loopback address.
    ALLOW_DEMO_SEED         = '1'
    DEMO_ACCOUNTS_TEST_ONLY = '1'
    # Sign-in codes to a local outbox, like playwright.config.ts.
    EMAIL_TRANSPORT         = 'outbox'
    EMAIL_OUTBOX_DIR        = '.data/e2e-email-outbox'
    EMAIL_OUTBOX_TEST_ONLY  = '1'
    E2E_PORT                = "$appPort"
    TEST_DATABASE_URL       = "postgres://${IntAdminUser}:$($s.IntAdmin)@127.0.0.1:$intPort/$IntDatabase"
  }
  foreach ($role in $DemoAccounts) { $vars["TEST_$($role.ToUpper())_PASSWORD"] = $s.Demo }
  foreach ($k in $vars.Keys) { Set-Item -Path "env:$k" -Value $vars[$k] }

  # 6. Database preparation (fresh per environment)
  foreach ($cmd in $PrepCommands) {
    Write-Step "npm run $cmd"
    Invoke-Native 'npm.cmd' @('run', '--silent', $cmd)
  }

  # 7. Build (cached)
  $fp = Get-Fingerprint
  $buildReason = Test-BuildNeeded $fp
  $rebuilt = $false
  if ($buildReason) {
    Write-Step "npm run build ($buildReason)"
    Invoke-Native 'npm.cmd' @('run', 'build')
    $rebuilt = $true
    $fp = Get-Fingerprint   # next build may touch tsconfig.json
    Write-Utf8 $BuildCache ([ordered]@{
      builtAt = (Get-UtcStamp); sourceFingerprint = $fp; projectRoot = $RepoRoot; artifactPaths = ($Artifacts -join ' ')
    } | ConvertTo-Json)
  } else {
    Write-Step 'build cache valid: skipping npm run build'
  }

  # 8. App start + health wait
  Write-Step "starting next start on $baseUrl"
  $env:NODE_ENV = 'production'; $env:PORT = "$appPort"; $env:HOSTNAME = '127.0.0.1'
  $node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
  # Launched through WMI (Win32_Process.Create), not Start-Process: a child of
  # this script inherits its stdout/stderr (and its job object), so a caller
  # piping or capturing this script's output would wait on `node` forever.
  # The WMI-created process is fully detached; its environment is passed
  # explicitly. The recorded PID is the cmd.exe wrapper that redirects the logs;
  # test-env-down.ps1 kills it with its children.
  $inner = "`"$node`" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $appPort > `"$AppLog`" 2> `"$AppErrLog`""
  $envBlock = [string[]]@(Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" })
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = $envBlock }
  $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /d /s /c `"$inner`""; CurrentDirectory = $RepoRoot; ProcessStartupInformation = $startup
  }
  if ($res.ReturnValue -ne 0) { throw "Win32_Process.Create failed with code $($res.ReturnValue)" }
  $appPid = [int]$res.ProcessId
  $deadline = (Get-Date).AddSeconds(120); $healthy = $false
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { break }
    if (Test-Http "$baseUrl$HealthPath") { $healthy = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) {
    $tail = ''; if (Test-Path -LiteralPath $AppErrLog) { $tail = (Get-Content -LiteralPath $AppErrLog -Tail 20) -join "`n" }
    throw "App did not answer $HealthPath within 120s (see $AppLog, $AppErrLog)`n$tail"
  }

  # 9. Browser provider state (verified at generation time; not reinstalled here)
  $pwVersion = (Invoke-Quiet 'npx.cmd' @('--no-install', 'playwright', '--version')).Out.Trim()
  $chromiumDir = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  $browserInstalled = (Test-Path -LiteralPath $chromiumDir) -and @(Get-ChildItem -LiteralPath $chromiumDir -Directory -Filter 'chromium*' -ErrorAction SilentlyContinue).Count -gt 0
  $bi = 0; if ($browserInstalled) { $bi = 1 }

  # 10. Env file, descriptor, result lines
  $envLines = @('# Generated by scripts/test-env/test-env-up.ps1 - disposable test-only values. Not committed.')
  foreach ($k in $vars.Keys) { $envLines += "$k=$($vars[$k])" }
  Write-Utf8 $EnvFile (($envLines -join "`n") + "`n")

  $elapsed = [int]((Get-Date) - $Started).TotalSeconds
  $buildNote = 'build reused from cache'; if ($rebuilt) { $buildNote = 'build rebuilt' }
  $descriptorObj = [ordered]@{
    version = 1
    runId = ((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss') + '-' + (New-Secret).Substring(0, 6))
    status = 'running'
    mode = 'ephemeral'
    baseUrl = $baseUrl
    startedByThisRepo = $true
    startScript = 'scripts/test-env/test-env-up.ps1'
    stopScript = 'scripts/test-env/test-env-down.ps1'
    app = [ordered]@{ startCommand = "next start --hostname 127.0.0.1 --port $appPort"; port = $appPort; healthPath = $HealthPath; pid = $appPid; log = $AppLog }
    services = @(
      [ordered]@{ type = 'postgres'; purpose = 'app + e2e'; host = '127.0.0.1'; port = $e2ePort; container = $E2eContainer; database = $E2eDatabase; env = @('DATABASE_URL', 'DATABASE_AUTH_URL', 'DATABASE_OPS_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_ADMIN_URL') },
      [ordered]@{ type = 'postgres'; purpose = 'integration tests'; host = '127.0.0.1'; port = $intPort; container = $IntContainer; database = $IntDatabase; env = @('TEST_DATABASE_URL') }
    )
    credentials = @($DemoAccounts | ForEach-Object { [ordered]@{ role = $_; username = "$_@demo.krajozbior.local"; passwordEnv = "TEST_$($_.ToUpper())_PASSWORD" } })
    credentialsFile = $EnvFile
    browser = [ordered]@{ provider = 'playwright'; installed = [bool]$browserInstalled; command = 'npx playwright'; version = $pwVersion; notes = '' }
    playwright = [ordered]@{ runner = 'playwright'; installed = [bool]$browserInstalled; config = 'playwright.config.ts'; browsers = @('chromium') }
    testRunner = [ordered]@{ name = 'playwright'; config = 'playwright.config.ts' }
    platform = 'win32'
    startedAt = (Get-UtcStamp)
    notes = "Boot ${elapsed}s ($buildNote). Run tests: powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1 [integration|e2e|all] (loads $EnvFile; E2E reuses this app via E2E_PORT). Demo accounts are seeded (user, user2, admin). Stop: powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-down.ps1"
  }
  Write-Utf8 $Descriptor ($descriptorObj | ConvertTo-Json -Depth 6)

  Write-Step "ready in ${elapsed}s"
  Write-ResultLines $baseUrl 0 $bi
} finally {
  Exit-Lock
}
