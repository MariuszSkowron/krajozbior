# Sprawdza dzialajacy pokaz lokalny: strona glowna, /api/health i logowanie kontem demo
# (haslo z .data/showcase/secrets.env, nigdy nie wypisywane). Wypisuje tylko kody odpowiedzi.
#
# Uzycie: powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-check.ps1
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
. (Join-Path $PSScriptRoot 'showcase-lib.ps1')

function Get-Status([string]$url) {
  try { return [int](Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0).StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

$failed = $false
foreach ($path in @('/', '/api/health')) {
  $code = Get-Status "$ShowcaseUrl$path"
  Write-Output "GET $path -> $code"
  if ($code -ne 200) { $failed = $true }
}

$password = $null
foreach ($line in (Get-Content -LiteralPath $SecretsFile)) {
  if ($line -like 'DEMO_ACCOUNT_PASSWORD=*') { $password = $line.Substring('DEMO_ACCOUNT_PASSWORD='.Length) }
}
if (-not $password) { throw "No DEMO_ACCOUNT_PASSWORD in $SecretsFile" }

$body = @{ email = 'user@demo.krajozbior.local'; password = $password } | ConvertTo-Json -Compress
try {
  $r = Invoke-WebRequest -Uri "$ShowcaseUrl/api/auth/login" -Method Post -UseBasicParsing -TimeoutSec 15 `
    -ContentType 'application/json' -Headers @{ Origin = $ShowcaseUrl } -Body $body
  $code = [int]$r.StatusCode
  $cookie = [bool]($r.Headers['Set-Cookie'])
} catch {
  $code = 0; $cookie = $false
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
}
Write-Output "POST /api/auth/login (demo user) -> $code, session cookie set: $cookie"
if ($code -ne 200 -or -not $cookie) { $failed = $true }

if ($failed) { Write-Output 'SHOWCASE_CHECK=failed'; exit 1 }
Write-Output 'SHOWCASE_CHECK=passed'
