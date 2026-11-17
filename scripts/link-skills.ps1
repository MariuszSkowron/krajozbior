<#
.SYNOPSIS
  Instaluje skille agentow z skills-lock.json i zamienia ich polaczenia w .claude/skills
  na dowiazania wzgledne.

.DESCRIPTION
  1. `npx skills experimental_install --frozen-lockfile` odtwarza skille z skills-lock.json
     do .agents/skills/ (bez zmiany pliku blokady; gdy zrodlo skilla sie zmienilo,
     instalacja odmawia i trzeba zapytac wlasciciela o aktualizacje skilli).
  2. Na Windows narzedzie tworzy w .claude/skills/ polaczenia katalogow (junction) z pelna
     sciezka dysku. Git zapisalby wtedy kopie plikow, a pelna sciezka moglaby trafic do
     publicznego repozytorium. Skrypt zamienia je na dowiazania wzgledne
     (..\..\.agents\skills\<nazwa>); wymaga trybu dewelopera Windows.
  3. Sprawdza wynik: kazdy skill z skills-lock.json jest dowiazaniem wzglednym do istniejacego
     katalogu z SKILL.md, a skills-lock.json sie nie zmienil.

  Agent uruchamia skrypt za zgoda wlasciciela (BOOTSTRAP.md, krok 5). Hook
  protect-agent-config blokuje bezposrednie zmiany w .claude/ z terminala; ten skrypt jest
  przegladana droga (plik ma wlasciciela w CODEOWNERS).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/link-skills.ps1
#>
param(
  # Tylko zamiana polaczen i weryfikacja, bez instalacji (np. po `npx skills update`).
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lockFile = Join-Path $root 'skills-lock.json'
$linkDir = Join-Path $root '.claude\skills'
$skillsVersion = '1.9.0'

function Fail([string]$Text) {
  Write-Host "BLAD: $Text"
  exit 1
}

if (-not (Test-Path $lockFile)) { Fail 'Brak skills-lock.json.' }
$lockBefore = (Get-FileHash $lockFile -Algorithm SHA256).Hash
$names = @((Get-Content $lockFile -Raw | ConvertFrom-Json).skills.PSObject.Properties.Name)
if ($names.Count -eq 0) { Fail 'skills-lock.json nie zawiera skilli.' }

Push-Location $root
try {
  if (-not $SkipInstall) {
    & npx -y "skills@$skillsVersion" experimental_install --frozen-lockfile -a claude-code -y
    if ($LASTEXITCODE -ne 0) { Fail 'Instalacja skilli nie powiodla sie (czy zrodlo skilla sie zmienilo? zapytaj wlasciciela).' }
  }

  if (-not (Test-Path $linkDir)) { New-Item -ItemType Directory -Path $linkDir | Out-Null }
  foreach ($name in $names) {
    if ($name -notmatch '^[A-Za-z0-9_-]+$') { Fail "Niedozwolona nazwa skilla: $name" }
    $target = "..\..\.agents\skills\$name"
    if (-not (Test-Path (Join-Path $root ".agents\skills\$name\SKILL.md"))) { Fail "Brak .agents/skills/$name/SKILL.md" }
    $link = Join-Path $linkDir $name
    $item = Get-Item $link -Force -ErrorAction SilentlyContinue
    if ($null -ne $item -and $item.LinkType -eq 'SymbolicLink' -and $item.Target -eq $target) { continue }
    if ($null -ne $item) {
      if (-not $item.LinkType) { Fail ".claude/skills/$name jest zwyklym katalogiem, nie polaczeniem; nie usuwam go." }
      cmd /c rmdir "$link" | Out-Null
    }
    cmd /c mklink /D "$link" "$target" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Nie udalo sie utworzyc dowiazania $name (czy tryb dewelopera Windows jest wlaczony?)." }
  }

  # Weryfikacja
  foreach ($name in $names) {
    $item = Get-Item (Join-Path $linkDir $name) -Force
    if ($item.LinkType -ne 'SymbolicLink' -or $item.Target -ne "..\..\.agents\skills\$name") { Fail "$name nie jest dowiazaniem wzglednym." }
    if (-not (Test-Path (Join-Path $linkDir "$name\SKILL.md"))) { Fail "$name nie wskazuje katalogu z SKILL.md." }
  }
  if ((Get-FileHash $lockFile -Algorithm SHA256).Hash -ne $lockBefore) { Fail 'skills-lock.json zmienil sie w trakcie instalacji.' }
  Write-Host "OK: $($names.Count) skilli jako dowiazania wzgledne w .claude/skills"
} finally {
  Pop-Location
}
