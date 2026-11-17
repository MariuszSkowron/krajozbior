<#
.SYNOPSIS
  Ustawia oba repozytoria projektu w GitHub: publiczne (kod) i prywatne (dokumentacja).

.DESCRIPTION
  Repozytorium publiczne (-CodeRepo):
    1. Ustawienia: wylaczone issues, wiki i projekty; tylko squash merge; auto-merge
       (z -NoBot wylaczony calkowicie); usuwanie galezi po scaleniu.
    2. Skanowanie sekretow z blokada pushu, alerty Dependabot.
    3. Zgoda wlasciciela na workflow z PR-ow z forkow (wszyscy zewnetrzni autorzy).
    4. Uprawnienia GitHub Actions: token workflow tylko do odczytu
       (default_workflow_permissions: read) i bez prawa zatwierdzania PR
       (can_approve_pull_request_reviews: false).
    5. Ograniczenie interakcji do wspolpracownikow (collaborators_only) na 6 miesiecy;
       skrypt wypisuje date, do ktorej trzeba je odnowic.
    6. Ruleset "Ochrona main" z .github/rulesets/main.json (z -NoBot bez wymogu
       zatwierdzenia wlasciciela kodu, bo autor PR nie moze zatwierdzic wlasnego PR).
    7. Etykiety z .ai/agentic.config.json; kontrola pliku CODEOWNERS i .github/bot.json
       (identyfikatory aplikacji GitHub, ktora pracuja agenci).
  Repozytorium prywatne (-DocsRepo):
    8. Sprawdzenie, ze jest prywatne; etykiety; ruleset zakazujacy force-push i
       usuwania main (bezposrednie commity do main sa dozwolone).
  Na koncu weryfikacja przez API i podsumowanie OK / BLAD / RECZNIE.

  Wymaga: zalogowanego `gh` (gh auth status) na koncie WLASCICIELA (administrator obu
  repozytoriow), nie jako aplikacja (bot). Uruchamiaj po wypchnieciu main do obu
  repozytoriow i po wpisaniu loginu wlasciciela w .github/CODEOWNERS. Po zakonczeniu
  konto wlasciciela wylogowuje sie z `gh` i usuwa jego poswiadczenie z Menedzera
  poswiadczen Windows (BOOTSTRAP.md, krok 9): na co dzien agenci pracuja wylacznie
  jako aplikacja GitHub projektu (<app-slug>[bot], scripts/bot-token.ps1).
  Skrypt nie zaprasza zadnych wspolpracownikow: aplikacja dostaje dostep przez
  instalacje na dwoch repozytoriach, nie przez zaproszenie.

  Nie uruchamiaj na repozytoriach, ktorych nie zakladasz: skrypt zmienia ustawienia.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup-github.ps1 -CodeRepo jan/moj-projekt -DocsRepo jan/moj-projekt-docs
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
  [string]$CodeRepo,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
  [string]$DocsRepo,

  # Agenci pracuja na koncie wlasciciela (bez aplikacji GitHub jako bota): slabsza
  # ochrona, docs/agent-workflow.md, sekcja 3. Auto-merge jest wtedy wylaczony calkowicie:
  # bez zatwierdzenia wlasciciela kodu nic nie zatrzymalby scalenia zmian wrazliwych,
  # wiec kazdy PR scala wlasciciel recznie w przegladarce.
  [switch]$NoBot
)

# 'Continue': w Windows PowerShell 5.1 przekierowanie stderr programu (gh) przy 'Stop'
# konczy skrypt wyjatkiem. Bledy sprawdzamy jawnie ($LASTEXITCODE, throw).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$rulesetFile = Join-Path $root '.github/rulesets/main.json'
$configFile = Join-Path $root '.ai/agentic.config.json'
$codeownersFile = Join-Path $root '.github/CODEOWNERS'
$botFile = Join-Path $root '.github/bot.json'
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("setup-github-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tempDir | Out-Null

$results = New-Object System.Collections.ArrayList
function Add-Result([string]$Status, [string]$Text) {
  [void]$results.Add([pscustomobject]@{ Status = $Status; Text = $Text })
  Write-Host "  [$Status] $Text"
}

# gh api z cialem JSON z pliku; zwraca obiekt albo $null przy bledzie.
function Invoke-GhJson([string]$Method, [string]$Path, $Body) {
  $ghArgs = @('api', '--method', $Method, $Path)
  if ($null -ne $Body) {
    $file = Join-Path $tempDir ([guid]::NewGuid().ToString() + '.json')
    $json = $Body | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))
    $ghArgs += @('--input', $file)
  }
  $out = & gh @ghArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    gh api $Method $Path -> $out"
    return $null
  }
  if ([string]::IsNullOrWhiteSpace(($out | Out-String))) { return $true }
  return ($out | Out-String | ConvertFrom-Json)
}

# Kod HTTP bez tresci (np. 204/404 dla vulnerability-alerts).
function Test-GhStatus([string]$Path) {
  & gh api $Path --silent 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Set-Labels([string]$Repo) {
  $config = Get-Content $configFile -Raw | ConvertFrom-Json
  $colors = @{ pipeline = '1d76db'; category = '0e8a16'; meta = 'bfd4f2'; priority = 'fbca04'; risk = 'd93f0b' }
  $failed = 0
  foreach ($group in $config.labels.PSObject.Properties) {
    if ($group.Name -eq 'enabled') { continue }
    foreach ($label in $group.Value) {
      gh label create $label --repo $Repo --color $colors[$group.Name] --force | Out-Null
      if ($LASTEXITCODE -ne 0) { $failed++ }
    }
  }
  if ($failed -eq 0) { Add-Result 'OK' "Etykiety SDLC w $Repo" }
  else { Add-Result 'BLAD' "Nie utworzono $failed etykiet w $Repo" }
}

function Set-Ruleset([string]$Repo, $Ruleset) {
  $existing = Invoke-GhJson 'GET' "repos/$Repo/rulesets" $null
  $match = @($existing | Where-Object { $_.name -eq $Ruleset.name })
  if ($match.Count -gt 0) {
    $res = Invoke-GhJson 'PUT' "repos/$Repo/rulesets/$($match[0].id)" $Ruleset
    $verb = 'zaktualizowano'
  } else {
    $res = Invoke-GhJson 'POST' "repos/$Repo/rulesets" $Ruleset
    $verb = 'zalozono'
  }
  if ($null -eq $res) { Add-Result 'BLAD' "Ruleset '$($Ruleset.name)' w $Repo nie zostal zapisany (plan Free bez ochrony galezi zwraca 403)" }
  else { Add-Result 'OK' "Ruleset '$($Ruleset.name)' w ${Repo}: $verb" }
}

try {
  foreach ($file in @($rulesetFile, $configFile, $codeownersFile)) {
    if (-not (Test-Path $file)) { throw "Brak pliku: $file" }
  }
  gh auth status 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'gh nie jest zalogowany (gh auth status).' }

  if ((Get-Content $codeownersFile -Raw) -match '\{\{GITHUB_OWNER\}\}') {
    throw '.github/CODEOWNERS ma jeszcze {{GITHUB_OWNER}}. Wpisz login wlasciciela (BOOTSTRAP.md) i wypchnij main.'
  }

  # ---------------------------------------------------------------- publiczne
  Write-Host ''
  Write-Host "Repozytorium publiczne: $CodeRepo"
  $code = Invoke-GhJson 'GET' "repos/$CodeRepo" $null
  if ($null -eq $code) { throw "Nie moge odczytac $CodeRepo." }
  if ($code.visibility -ne 'public') { Add-Result 'BLAD' "$CodeRepo nie jest publiczne (widocznosc: $($code.visibility)). Bezplatne Actions i CodeQL wymagaja publicznego." }

  $settings = [ordered]@{
    has_issues             = $false
    has_wiki               = $false
    has_projects           = $false
    allow_squash_merge     = $true
    allow_merge_commit     = $false
    allow_rebase_merge     = $false
    allow_auto_merge       = (-not $NoBot)
    delete_branch_on_merge = $true
  }
  if ($null -eq (Invoke-GhJson 'PATCH' "repos/$CodeRepo" $settings)) { Add-Result 'BLAD' 'Ustawienia repozytorium nie zostaly zapisane' }
  if ($NoBot) {
    Add-Result 'UWAGA' 'Tryb -NoBot: auto-merge WYLACZONY. Kazdy PR scala wlasciciel recznie w przegladarce (agent nie moze wlaczyc auto-merge).'
  }

  # Token GITHUB_TOKEN w workflow tylko do odczytu i bez prawa zatwierdzania PR:
  # workflow z PR-a nie zatwierdzi go ani nie zapisze niczego w repozytorium.
  $workflowPath = "repos/$CodeRepo/actions/permissions/workflow"
  $workflowPermissions = [ordered]@{ default_workflow_permissions = 'read'; can_approve_pull_request_reviews = $false }
  if ($null -eq (Invoke-GhJson 'PUT' $workflowPath $workflowPermissions)) { Add-Result 'BLAD' 'Uprawnienia tokenu GitHub Actions nie zostaly zapisane' }

  # Komentarze, zgloszenia i PR-y tylko od wspolpracownikow (wlasciciel; aplikacje
  # zainstalowane na repozytorium dzialaja przez instalacje - sprawdza proba generalna).
  # GitHub pozwala na najwyzej 6 miesiecy; potem limit trzeba odnowic.
  $limitsPath = "repos/$CodeRepo/interaction-limits"
  $limits = Invoke-GhJson 'PUT' $limitsPath ([ordered]@{ limit = 'collaborators_only'; expiry = 'six_months' })
  if ($null -eq $limits) { Add-Result 'BLAD' 'Ograniczenie interakcji nie zostalo ustawione' }

  $security = @{ security_and_analysis = @{
      secret_scanning                 = @{ status = 'enabled' }
      secret_scanning_push_protection = @{ status = 'enabled' }
    } }
  if ($null -eq (Invoke-GhJson 'PATCH' "repos/$CodeRepo" $security)) { Add-Result 'BLAD' 'Skanowanie sekretow nie zostalo wlaczone' }

  gh api --method PUT "repos/$CodeRepo/vulnerability-alerts" --silent 2>$null
  if ($LASTEXITCODE -ne 0) { Add-Result 'BLAD' 'Alerty Dependabot nie zostaly wlaczone' }

  # Zgoda na workflow z forkow. Endpoint jest nowszy niz reszta API; gdy go brak,
  # skrypt wypisuje kroki do klikniecia.
  $forkPath = "repos/$CodeRepo/actions/permissions/fork-pr-contributor-approval"
  [void](Invoke-GhJson 'PUT' $forkPath @{ approval_policy = 'all_external_contributors' })

  $ruleset = Get-Content $rulesetFile -Raw | ConvertFrom-Json
  if ($NoBot) {
    foreach ($rule in $ruleset.rules) {
      if ($rule.type -eq 'pull_request') { $rule.parameters.require_code_owner_review = $false }
    }
    Add-Result 'UWAGA' 'Tryb -NoBot: bez wymogu zatwierdzenia wlasciciela kodu. Wyjatki pilnuje tylko agent.'
  }
  # Statusy agent-review i security-review przyjmowane tylko od aplikacji projektu
  # (integration_id = App ID z .github/bot.json), zeby nikt inny ich nie ustawil.
  # Bez App ID ruleset przyjmuje je od kazdego konta z prawem zapisu (weryfikacja nizej).
  $botAppId = [int64]0
  if (-not $NoBot -and (Test-Path $botFile)) {
    $botAppId = [int64](Get-Content $botFile -Raw | ConvertFrom-Json).appId
  }
  if ($botAppId -gt 0) {
    foreach ($rule in $ruleset.rules) {
      if ($rule.type -ne 'required_status_checks') { continue }
      foreach ($check in $rule.parameters.required_status_checks) {
        if (@('agent-review', 'security-review') -contains $check.context) {
          $check | Add-Member -NotePropertyName 'integration_id' -NotePropertyValue $botAppId -Force
        }
      }
    }
  }
  Set-Ruleset $CodeRepo $ruleset
  Set-Labels $CodeRepo

  # ---------------------------------------------------------------- prywatne
  Write-Host ''
  Write-Host "Repozytorium prywatne: $DocsRepo"
  $docs = Invoke-GhJson 'GET' "repos/$DocsRepo" $null
  if ($null -eq $docs) { throw "Nie moge odczytac $DocsRepo." }
  if ($docs.visibility -ne 'private') {
    throw "$DocsRepo NIE jest prywatne (widocznosc: $($docs.visibility)). Zmien widocznosc na Private, zanim cokolwiek tam trafi."
  }
  $docsSettings = [ordered]@{ has_issues = $true; has_wiki = $false; has_projects = $false }
  if ($null -eq (Invoke-GhJson 'PATCH' "repos/$DocsRepo" $docsSettings)) { Add-Result 'BLAD' 'Ustawienia repozytorium dokumentacji nie zostaly zapisane' }

  $docsRuleset = [ordered]@{
    name          = 'Ochrona main (dokumentacja)'
    target        = 'branch'
    enforcement   = 'active'
    conditions    = @{ ref_name = @{ include = @('~DEFAULT_BRANCH'); exclude = @() } }
    rules         = @(@{ type = 'deletion' }, @{ type = 'non_fast_forward' })
    bypass_actors = @()
  }
  Set-Ruleset $DocsRepo $docsRuleset
  Set-Labels $DocsRepo

  # ---------------------------------------------------------------- weryfikacja
  Write-Host ''
  Write-Host 'Weryfikacja przez API:'
  $code = Invoke-GhJson 'GET' "repos/$CodeRepo" $null
  if (-not $code.has_issues -and -not $code.has_wiki -and -not $code.has_projects) { Add-Result 'OK' 'Issues, wiki i projekty wylaczone' }
  else { Add-Result 'BLAD' "Issues/wiki/projekty: $($code.has_issues)/$($code.has_wiki)/$($code.has_projects)" }
  $autoMergeExpected = -not $NoBot
  if ($code.allow_auto_merge -eq $autoMergeExpected -and $code.delete_branch_on_merge -and $code.allow_squash_merge -and -not $code.allow_merge_commit -and -not $code.allow_rebase_merge) {
    $autoText = if ($NoBot) { 'Auto-merge WYLACZONY (-NoBot)' } else { 'Auto-merge wlaczony' }
    Add-Result 'OK' "$autoText, tylko squash, usuwanie galezi po scaleniu"
  } else { Add-Result 'BLAD' 'Ustawienia scalania niezgodne z oczekiwanymi' }

  $workflowNow = Invoke-GhJson 'GET' $workflowPath $null
  if ($null -ne $workflowNow -and $workflowNow.default_workflow_permissions -eq 'read' -and -not $workflowNow.can_approve_pull_request_reviews) {
    Add-Result 'OK' 'Token GitHub Actions tylko do odczytu, bez zatwierdzania PR'
  } else {
    Add-Result 'RECZNIE' "Uprawnienia Actions: https://github.com/$CodeRepo/settings/actions -> 'Workflow permissions' -> 'Read repository contents and packages permissions', odznacz 'Allow GitHub Actions to create and approve pull requests' -> Save"
  }

  $limitsNow = Invoke-GhJson 'GET' $limitsPath $null
  if ($null -ne $limitsNow -and $limitsNow.limit -eq 'collaborators_only') {
    $renewBy = ([datetime]$limitsNow.expires_at).ToUniversalTime().ToString('yyyy-MM-dd')
    Add-Result 'OK' "Interakcje tylko dla wspolpracownikow, wygasa $renewBy"
    Add-Result 'RECZNIE' "Zapisz w kalendarzu: odnow ograniczenie interakcji przed $renewBy (https://github.com/$CodeRepo/settings/interaction_limits -> 'Limit to repository collaborators' -> 'Enable' na 6 miesiecy; bootstrap-checklist.md)"
  } else {
    Add-Result 'BLAD' 'Ograniczenie interakcji nie jest aktywne (collaborators_only)'
  }
  $sa = $code.security_and_analysis
  if ($sa.secret_scanning.status -eq 'enabled' -and $sa.secret_scanning_push_protection.status -eq 'enabled') {
    Add-Result 'OK' 'Skanowanie sekretow i blokada pushu z sekretem'
  } else { Add-Result 'BLAD' 'Skanowanie sekretow lub blokada pushu wylaczone' }
  if (Test-GhStatus "repos/$CodeRepo/vulnerability-alerts") { Add-Result 'OK' 'Alerty Dependabot wlaczone' }
  else { Add-Result 'BLAD' 'Alerty Dependabot wylaczone' }

  $forkNow = Invoke-GhJson 'GET' $forkPath $null
  if ($null -ne $forkNow -and $forkNow.approval_policy -eq 'all_external_contributors') {
    Add-Result 'OK' 'Workflow z forkow czekaja na zgode (wszyscy zewnetrzni autorzy)'
  } else {
    Add-Result 'RECZNIE' "Zgoda na workflow z forkow: https://github.com/$CodeRepo/settings/actions -> 'Approval for running fork pull request workflows from contributors' -> 'Require approval for all external contributors' -> Save"
  }

  $rules = Invoke-GhJson 'GET' "repos/$CodeRepo/rules/branches/main" $null
  $types = @($rules | ForEach-Object { $_.type })
  $checks = @($rules | Where-Object { $_.type -eq 'required_status_checks' } |
    ForEach-Object { $_.parameters.required_status_checks | ForEach-Object { $_.context } })
  $pr = @($rules | Where-Object { $_.type -eq 'pull_request' } | Select-Object -First 1)
  $missingTypes = @(@('deletion', 'non_fast_forward', 'pull_request', 'required_status_checks') | Where-Object { $types -notcontains $_ })
  $missingChecks = @(@('gitleaks', 'check', 'integration', 'e2e', 'guard', 'agent-review', 'security-review') | Where-Object { $checks -notcontains $_ })
  if ($missingTypes.Count -eq 0 -and $missingChecks.Count -eq 0) {
    Add-Result 'OK' "main chroniony: $($types -join ', '); wymagane: $($checks -join ', ')"
  } else {
    Add-Result 'BLAD' "Brakuje regul: $($missingTypes -join ', ') / checkow: $($missingChecks -join ', ')"
  }
  if ($botAppId -gt 0) {
    $reviewChecks = @($rules | Where-Object { $_.type -eq 'required_status_checks' } |
      ForEach-Object { $_.parameters.required_status_checks } |
      Where-Object { @('agent-review', 'security-review') -contains $_.context })
    $unpinned = @($reviewChecks | Where-Object { [int64]$_.integration_id -ne $botAppId })
    if ($reviewChecks.Count -eq 2 -and $unpinned.Count -eq 0) {
      Add-Result 'OK' "Statusy agent-review i security-review przyjmowane tylko od aplikacji (App ID $botAppId)"
    } else {
      Add-Result 'BLAD' 'Statusy agent-review/security-review nie sa przypiete do aplikacji projektu'
    }
  }
  if ($pr.Count -gt 0) {
    $p = $pr[0].parameters
    if ($p.required_review_thread_resolution) { Add-Result 'OK' 'Wymagane rozwiazanie watkow review' }
    else { Add-Result 'BLAD' 'Brak wymogu rozwiazania watkow' }
    if ($NoBot) { Add-Result 'UWAGA' "Zatwierdzenie wlasciciela kodu: $($p.require_code_owner_review) (tryb -NoBot)" }
    elseif ($p.require_code_owner_review) { Add-Result 'OK' 'Wymagane zatwierdzenie wlasciciela kodu (CODEOWNERS)' }
    else { Add-Result 'BLAD' 'Brak wymogu zatwierdzenia wlasciciela kodu' }
  }

  # Aplikacja GitHub (bot): jawne identyfikatory w .github/bot.json. Bez nich agenci
  # nie maja tozsamosci innej niz wlasciciel, a wtedy jedyna bezpieczna droga to -NoBot.
  if (-not $NoBot) {
    $bot = $null
    if (Test-Path $botFile) { $bot = Get-Content $botFile -Raw | ConvertFrom-Json }
    $codeName = ($CodeRepo -split '/')[1]
    $docsName = ($DocsRepo -split '/')[1]
    if ($null -ne $bot -and [int64]$bot.appId -gt 0 -and [int64]$bot.installationId -gt 0 -and $bot.owner -notmatch '\{\{') {
      if ((@($bot.repositories) -join ',') -eq "$codeName,$docsName") {
        Add-Result 'OK' "Aplikacja $($bot.appSlug): identyfikatory w .github/bot.json; uprawnienia i instalacje sprawdza scripts/bot-token.ps1"
      } else {
        Add-Result 'BLAD' ".github/bot.json: repositories ($(@($bot.repositories) -join ', ')) nie odpowiadaja $codeName i $docsName"
      }
    } else {
      Add-Result 'RECZNIE' 'Aplikacja GitHub (bot) jeszcze nie zalozona: wykonaj BOOTSTRAP.md, krok 9, wpisz identyfikatory w .github/bot.json i uruchom ten skrypt ponownie. Do tego czasu nie uruchamiaj agentow.'
    }
  }

  $coErrors = Invoke-GhJson 'GET' "repos/$CodeRepo/codeowners/errors" $null
  if ($null -ne $coErrors -and @($coErrors.errors).Count -eq 0) { Add-Result 'OK' 'CODEOWNERS bez bledow' }
  elseif ($null -eq $coErrors) { Add-Result 'BLAD' 'Nie udalo sie sprawdzic CODEOWNERS (czy plik jest na main?)' }
  else { Add-Result 'BLAD' "CODEOWNERS ma bledy: $((@($coErrors.errors) | ForEach-Object { $_.message }) -join '; ')" }

  $docsRules = Invoke-GhJson 'GET' "repos/$DocsRepo/rules/branches/main" $null
  $docsTypes = @($docsRules | ForEach-Object { $_.type })
  if ($docsTypes -contains 'deletion' -and $docsTypes -contains 'non_fast_forward') {
    Add-Result 'OK' "Dokumentacja: main bez force-push i usuwania ($($docsTypes -join ', '))"
  } else { Add-Result 'BLAD' "Dokumentacja: brak ochrony main ($($docsTypes -join ', '))" }
}
finally {
  Get-ChildItem -Path $tempDir -File -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
  Remove-Item -LiteralPath $tempDir -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Podsumowanie:'
$bad = @($results | Where-Object { $_.Status -eq 'BLAD' })
$manual = @($results | Where-Object { $_.Status -eq 'RECZNIE' })
Write-Host "  OK: $(@($results | Where-Object { $_.Status -eq 'OK' }).Count), BLAD: $($bad.Count), RECZNIE: $($manual.Count)"
if ($manual.Count -gt 0) {
  Write-Host '  Kroki do wykonania recznie w przegladarce:'
  $manual | ForEach-Object { Write-Host "   - $($_.Text)" }
}
if ($bad.Count -gt 0) { exit 1 }
