# Pokaz lokalny Krajozbioru: stawia (albo odswieza) projekt Docker Compose
# `krajozbior-showcase` na http://127.0.0.1:3300 z kontami demo i - opcjonalnie - kolekcjami.
# Bezpieczne do powtarzania: drugie uruchomienie niczego nie psuje (migracje, seed demo
# i wgrywanie kolekcji sa idempotentne), dane w wolumenie krajozbior-showcase-pgdata zostaja.
#
# Uzycie (Windows PowerShell 5.1+):
#   powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-up.ps1
#     [-CatalogDir <katalog z plikami *.ndjson>] [-OrgSlug demo-gmina-a]
#     [-CuratorEmail curator-a@demo.krajozbior.local] [-Publish] [-SkipBuild]
# Pliki kolekcji zostaja poza repozytorium kodu: skrypt tylko montuje katalog (tylko do
# odczytu) w kontenerze `ops` i uruchamia `catalog:import`. Pliki `*-public.ndjson` sa pomijane
# (to wariant tego samego pliku w profilu publicznym).
# Hasla ról bazy i konta demo powstaja przy pierwszym uruchomieniu w .data/showcase/secrets.env
# (ignorowane przez git); skrypt ich nie wypisuje.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [string]$CatalogDir = '',
  [string]$OrgSlug = 'demo-gmina-a',
  [string]$CuratorEmail = 'curator-a@demo.krajozbior.local',
  [switch]$Publish,
  [switch]$SkipBuild
)

. (Join-Path $PSScriptRoot 'showcase-lib.ps1')

Assert-Docker

# 1. Port 3300: free, or already ours.
$appRunning = Test-ShowcaseAppRunning
if (-not $appRunning -and -not (Test-PortFree $ShowcasePort)) {
  throw "Port $ShowcasePort is in use by another program. Free it and run this script again."
}

# 2. Secrets (first run only).
if (Initialize-Secrets) { Write-Step "generated one-time secrets in $DataDir (not printed)" }

# 3. Build (needs memory: the Next.js build takes about 2-3 GB).
if (-not $SkipBuild) {
  $freeGb = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB
  $haveImages = ((Invoke-Quiet 'docker' @('image', 'inspect', 'krajozbior-showcase-app:local')).Code -eq 0) -and
    ((Invoke-Quiet 'docker' @('image', 'inspect', 'krajozbior-showcase-ops:local')).Code -eq 0)
  if ($freeGb -ge 3) {
    Write-Step 'building images (cached when the code did not change)'
    Invoke-Compose @('build', 'app', 'ops')
  } elseif ($haveImages) {
    Write-Step ("free memory is {0:N1} GB (< 3 GB): skipping the build, using the existing images" -f $freeGb)
  } else {
    throw ("Free memory is {0:N1} GB; the first image build needs at least 3 GB. Close other programs and run again." -f $freeGb)
  }
}

# 4. Database, roles, migrations, demo accounts.
Write-Step 'starting the database'
Invoke-Compose @('up', '-d', '--wait', 'db')
foreach ($cmd in @('db:roles', 'db:migrate', 'db:seed:demo')) {
  Write-Step "ops: npm run $cmd"
  Invoke-Compose @('run', '--rm', '-T', 'ops', 'npm', 'run', '--silent', $cmd)
}

# 5. Collections from files (kept outside the code repository; mounted read-only).
if ($CatalogDir -ne '') {
  $dir = (Resolve-Path -LiteralPath $CatalogDir).Path -replace '\\', '/'
  $files = @(Get-ChildItem -LiteralPath $CatalogDir -Filter '*.ndjson' -File |
    Where-Object { $_.Name -notlike '*-public.ndjson' } | Sort-Object Name)
  if ($files.Count -eq 0) { Write-Step "no *.ndjson files in $CatalogDir" }
  foreach ($f in $files) {
    Write-Step "ops: catalog:import $($f.Name)"
    $importArgs = @('run', '--rm', '-T', '-v', "${dir}:/catalog:ro", 'ops', 'npm', 'run', '--silent', 'catalog:import', '--',
      '--file', "/catalog/$($f.Name)", '--org-slug', $OrgSlug, '--curator-email', $CuratorEmail)
    if ($Publish) { $importArgs += '--publish' }
    Invoke-Compose $importArgs
  }
}

# 6. Application.
Write-Step 'starting the application'
Invoke-Compose @('up', '-d', '--wait', 'app')

$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  try { $ok = ((Invoke-WebRequest -Uri "$ShowcaseUrl/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw "The application did not answer on $ShowcaseUrl/api/health" }

Write-Output "SHOWCASE_STATUS=running"
Write-Output "SHOWCASE_URL=http://localhost:$ShowcasePort"
Write-Output "SHOWCASE_DEMO_ACCOUNTS=user@demo.krajozbior.local, user2@demo.krajozbior.local, admin@demo.krajozbior.local, curator-a@demo.krajozbior.local, curator-b@demo.krajozbior.local"
Write-Output "SHOWCASE_DEMO_PASSWORD_FILE=$SecretsFile (DEMO_ACCOUNT_PASSWORD; do not print)"
Write-Output "SHOWCASE_OUTBOX=$DataDir/outbox (sign-in codes as .eml)"
