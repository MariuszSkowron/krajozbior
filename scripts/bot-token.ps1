<#
.SYNOPSIS
  Loguje gh i git jako aplikacja GitHub projektu (<app-slug>[bot]) na godzine.

.DESCRIPTION
  1. Czyta jawne ustawienia aplikacji z .github/bot.json (owner, appSlug, appId,
     installationId, botUserId, dwa repozytoria).
  2. Pomocnik scripts/lib/github-app-token.mjs czyta klucz prywatny z jedynego
     pliku *.pem w %USERPROFILE%\.config\<appSlug>\ (poza repozytoriami), podpisuje
     krotki JWT, sprawdza instalacje (tylko wybrane repozytoria, bez uprawnien
     administracyjnych), wydaje token instalacji zawezony do dwoch repozytoriow
     i uprawnien przeplywu, a potem loguje gh: `gh auth login --with-token`
     (token na stdin).
  3. W obu repozytoriach ustawia lokalnie autora commitow (<appSlug>[bot] i jego
     adres noreply) oraz pomocnika hasel gh (dwie linie z BOOTSTRAP.md, krok 9).
  4. Sprawdza dostep: gh api repos/<owner>/<repo> dla obu repozytoriow.

  Skrypt nigdy nie wypisuje tokenu ani klucza. Token wygasa po godzinie: gdy gh
  albo git zwraca 401 / "Bad credentials", uruchom skrypt ponownie
  (docs/agent-workflow.md, sekcja 3, "Aplikacja GitHub (bot)").

  Tryb proby (-DryRun) nie loguje gh i nie zmienia konfiguracji git. Z falszywym
  API (-ApiBaseUrl) wymaga klucza testowego (-KeyFile); prawdziwy klucz podpisuje
  tylko zapytania do https://api.github.com.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1 -DryRun -ApiBaseUrl http://127.0.0.1:55480 -KeyFile <klucz-testowy>
#>
param(
  [switch]$DryRun,

  # Tylko testy: adres falszywego API (http://127.0.0.1:<port>).
  [string]$ApiBaseUrl,

  # Tylko testy: jednorazowy klucz testowy spoza folderu prawdziwego klucza.
  [string]$KeyFile
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $root '.github/bot.json'
$helper = Join-Path $root 'scripts/lib/github-app-token.mjs'

if ($ApiBaseUrl -and -not $DryRun) {
  Write-Host 'BLAD: -ApiBaseUrl dziala tylko z -DryRun (testy z falszywym API).'
  exit 1
}

# git z dokladnie podanymi argumentami. Windows PowerShell 5.1 gubi pusty argument
# ("") przy wywolaniu programu, a pomocnik hasel wymaga pustej wartosci, dlatego
# argumenty skladamy recznie w ProcessStartInfo.
function Invoke-GitRaw([string]$Repo, [string]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = "-C `"$Repo`" $Arguments"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  $out = $process.StandardOutput.ReadToEnd()
  $err = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  return [pscustomobject]@{ Code = $process.ExitCode; Out = $out; Err = $err }
}

function Set-BotGitConfig([string]$Repo, $Bot) {
  $name = "$($Bot.appSlug)[bot]"
  $failed = 0
  $steps = @("config --local user.name `"$name`"")
  if ([int64]$Bot.botUserId -gt 0) {
    $steps += "config --local user.email `"$($Bot.botUserId)+$name@users.noreply.github.com`""
  } else {
    Write-Host "  UWAGA: brak botUserId w .github/bot.json, adres autora commitow nie ustawiony (BOOTSTRAP.md, krok 9)."
  }
  # Pomocnik hasel tylko lokalnie: pusta wartosc kasuje pomocnikow z konfiguracji
  # globalnej (np. Menedzer poswiadczen), potem gh podaje token aplikacji.
  $steps += 'config --local --replace-all credential.https://github.com.helper ""'
  $steps += 'config --local --add credential.https://github.com.helper "!gh auth git-credential"'
  foreach ($step in $steps) {
    $result = Invoke-GitRaw $Repo $step
    if ($result.Code -ne 0) { $failed++; Write-Host "  BLAD: git $step -> $($result.Err.Trim())" }
  }
  $helpers = (Invoke-GitRaw $Repo 'config --local --get-all credential.https://github.com.helper').Out -split "`r?`n"
  if ($helpers.Count -lt 2 -or $helpers[0] -ne '' -or $helpers[1] -ne '!gh auth git-credential') {
    $failed++
    Write-Host '  BLAD: pomocnik hasel ma inne wartosci niz dwie linie z BOOTSTRAP.md.'
  }
  if ($failed -eq 0) { Write-Host "OK: git w $Repo pracuje jako $name." }
  return $failed
}

if (-not (Test-Path $configFile)) { Write-Host "BLAD: brak pliku $configFile"; exit 1 }
$bot = Get-Content $configFile -Raw | ConvertFrom-Json

$nodeArgs = @($helper, '--config', $configFile)
if ($ApiBaseUrl) { $nodeArgs += @('--api', $ApiBaseUrl) }
if ($KeyFile) { $nodeArgs += @('--key-file', $KeyFile) }
if ($DryRun) { $nodeArgs += '--dry-run' }

& node @nodeArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host 'BLAD: token aplikacji nie zostal wydany (komunikat wyzej).'
  exit 1
}

$docsRoot = Join-Path (Split-Path -Parent $root) $bot.repositories[1]
if ($DryRun) {
  Write-Host "Proba: pominieto konfiguracje git w $root i $docsRoot oraz sprawdzenie dostepu."
  exit 0
}

$failed = Set-BotGitConfig $root $bot
if (Test-Path (Join-Path $docsRoot '.git')) { $failed += Set-BotGitConfig $docsRoot $bot }
else { Write-Host "UWAGA: brak repozytorium dokumentacji w $docsRoot (oba foldery maja lezec obok siebie)." }

foreach ($repo in $bot.repositories) {
  $name = & gh api "repos/$($bot.owner)/$repo" --jq .full_name 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "OK: dostep do $name." }
  else { $failed++; Write-Host "BLAD: brak dostepu do $($bot.owner)/$repo przez gh." }
}
if ($failed -gt 0) { exit 1 }
