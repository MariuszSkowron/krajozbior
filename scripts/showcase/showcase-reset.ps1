# Kasuje dane pokazu lokalnego: zatrzymuje projekt `krajozbior-showcase` i usuwa wolumen
# krajozbior-showcase-pgdata (tylko ten, po pelnej nazwie). Wymaga -ConfirmDataLoss.
# Pliki .data/showcase/ (hasla, skrzynka e-mail) zostaja; kolejne showcase-up.ps1 buduje
# baze od nowa.
#
# Uzycie: powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-reset.ps1 -ConfirmDataLoss
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param([switch]$ConfirmDataLoss)

. (Join-Path $PSScriptRoot 'showcase-lib.ps1')

if (-not $ConfirmDataLoss) {
  throw 'This deletes the showcase database. Run again with -ConfirmDataLoss to confirm.'
}

Assert-Docker
if (Test-Path -LiteralPath $SecretsFile) {
  Write-Step 'stopping the showcase'
  Invoke-Compose @('down', '--remove-orphans')
}

$exists = (Invoke-Quiet 'docker' @('volume', 'ls', '-q', '--filter', "name=^${ShowcaseVolume}$")).Out.Trim()
if ($exists -eq $ShowcaseVolume) {
  Write-Step "removing volume $ShowcaseVolume"
  Invoke-Native 'docker' @('volume', 'rm', $ShowcaseVolume)
} else {
  Write-Step "volume $ShowcaseVolume does not exist"
}
Write-Output "SHOWCASE_STATUS=reset"
