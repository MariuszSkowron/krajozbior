# Zatrzymuje pokaz lokalny: usuwa kontenery i siec projektu `krajozbior-showcase`,
# zostawia wolumen z danymi (krajozbior-showcase-pgdata) i pliki w .data/showcase/.
#
# Uzycie: powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-down.ps1
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
. (Join-Path $PSScriptRoot 'showcase-lib.ps1')

Assert-Docker
if (-not (Test-Path -LiteralPath $SecretsFile)) {
  Write-Step 'nothing to stop (no secrets file: the showcase was never started)'
  exit 0
}

Write-Step 'stopping the showcase (the data volume stays)'
# Without any volume-removing option: the named data volume must survive.
Invoke-Compose @('down', '--remove-orphans')
Write-Output "SHOWCASE_STATUS=stopped"
Write-Output "SHOWCASE_DATA_VOLUME=$ShowcaseVolume (kept)"
