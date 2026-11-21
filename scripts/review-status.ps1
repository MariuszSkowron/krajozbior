<#
.SYNOPSIS
  Ustawia statusy przegladu (agent-review, security-review) na biezacym commicie PR.

.DESCRIPTION
  Uruchamia wlasciciel, bo Claude Code blokuje agentowi ustawianie statusow
  przegladu na wlasnym PR (docs/agent-workflow.md, etap 5).

  1. Odswieza token aplikacji (scripts/bot-token.ps1), chyba ze -SkipToken.
  2. Dla kazdego PR pobiera SHA biezacego commitu (gh pr view) i ustawia dwa
     statusy przez gh api: success (domyslnie) albo failure (-State failure).
  3. Z -CarryOver opis statusu dostaje dopisek "przeniesione po aktualizacji
     z main": uzywaj po aktualizacji galezi o nowy main (merge bez konfliktow),
     gdy przeglad nadal obowiazuje. Nie laczy sie z -State failure.

  Repozytorium i wlasciciela czyta z .github/bot.json. Skrypt nie zawiera
  sekretow i nie wypisuje tokenu.

  Tryb proby (-DryRun) nie laczy sie z GitHub: wypisuje polecenia, ktore by
  wykonal (SHA zastapione tekstem <SHA>).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/review-status.ps1 -Pr 38,40
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/review-status.ps1 -Pr 41 -CarryOver
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/review-status.ps1 -Pr 41 -Only security-review -State failure
#>
param(
  # Numery PR: "-Pr 41" albo "-Pr 38,40" (z -File lista po przecinku dociera jako jeden tekst).
  [Parameter(Mandatory = $true)]
  [string[]]$Pr,

  [ValidateSet('success', 'failure')]
  [string]$State = 'success',

  [ValidateSet('both', 'agent-review', 'security-review')]
  [string]$Only = 'both',

  [switch]$CarryOver,
  [switch]$SkipToken,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($CarryOver -and $State -ne 'success') {
  Write-Host 'BLAD: -CarryOver ma sens tylko ze stanem success.'
  exit 1
}

$prNumbers = @()
foreach ($item in ($Pr -join ',').Split(',', [System.StringSplitOptions]::RemoveEmptyEntries)) {
  $parsed = 0
  if (-not [int]::TryParse($item.Trim(), [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 999999) {
    Write-Host "BLAD: '$item' nie jest numerem PR (liczba od 1 do 999999)."
    exit 1
  }
  $prNumbers += $parsed
}
if ($prNumbers.Count -eq 0) { Write-Host 'BLAD: podaj numer PR (-Pr N).'; exit 1 }

$configFile = Join-Path $root '.github/bot.json'
if (-not (Test-Path $configFile)) { Write-Host "BLAD: brak pliku $configFile"; exit 1 }
$bot = Get-Content $configFile -Raw | ConvertFrom-Json
$repo = "$($bot.owner)/$($bot.repositories[0])"
if ($bot.owner -notmatch '^[A-Za-z0-9-]+$' -or $bot.repositories[0] -notmatch '^[A-Za-z0-9._-]+$') {
  Write-Host 'BLAD: nieprawidlowe owner lub repositories w .github/bot.json.'
  exit 1
}

# Polskie litery z kodow znakow: Windows PowerShell 5.1 czyta pliki bez BOM jako ANSI.
$a = [char]0x0105  # a z ogonkiem
$n = [char]0x0144  # n z kreska
$descriptions = @{
  'agent-review'    = @{
    success = "Przegl${a}d kodu: bez uwag blokuj${a}cych"
    failure = "Przegl${a}d kodu: do poprawy"
  }
  'security-review' = @{
    success = "Przegl${a}d bezpiecze${n}stwa: bez uwag"
    failure = "Przegl${a}d bezpiecze${n}stwa: do poprawy"
  }
}
$carrySuffix = ", przeniesione po aktualizacji z main"
$contexts = if ($Only -eq 'both') { @('agent-review', 'security-review') } else { @($Only) }

if (-not $SkipToken -and -not $DryRun) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/bot-token.ps1') | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host 'BLAD: nie udalo sie odswiezyc tokenu aplikacji (scripts/bot-token.ps1).'; exit 1 }
}

$failed = 0
foreach ($number in $prNumbers) {
  if ($DryRun) {
    $sha = '<SHA>'
  } else {
    $sha = (& gh pr view $number --repo $repo --json headRefOid --jq .headRefOid)
    if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') {
      Write-Host "BLAD: nie mozna odczytac commitu PR #$number."
      $failed++
      continue
    }
  }
  Write-Host "PR #$number -> $sha"
  foreach ($context in $contexts) {
    $description = $descriptions[$context][$State]
    if ($CarryOver) { $description += $carrySuffix }
    $ghArgs = @('api', '-X', 'POST', "repos/$repo/statuses/$sha", '-f', "state=$State", '-f', "context=$context", '-f', "description=$description", '--jq', '.state')
    if ($DryRun) {
      Write-Host "  proba: gh $($ghArgs -join ' ')"
      continue
    }
    $result = & gh @ghArgs
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK: $context = $result" }
    else { Write-Host "  BLAD: nie ustawiono $context na PR #$number."; $failed++ }
  }
}
if ($failed -gt 0) { exit 1 }
