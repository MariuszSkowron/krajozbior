# Testy i kontrole

## W skrócie

Są cztery poziomy kontroli: testy jednostkowe z progiem pokrycia logiki domeny, testy integracyjne na prawdziwym PostgreSQL z rolami, testy przeglądarkowe (E2E) oraz kontrole statyczne i build. Lokalnie `npm run check` obejmuje format, lint, typy, jednostkowe i build; integracja i E2E działają osobno (w CI jako joby `integration` i `e2e`). Komputer lokalny jest słabszy niż suma potrzeb kilku agentów, więc pełne przebiegi integracji i E2E idą przede wszystkim w CI, które w repozytorium publicznym jest bezpłatne. CI uruchamia pełny zestaw dla każdego PR-a, także draftu.

## Testy jednostkowe i coverage

`npm run test:unit` uruchamia testy jednostkowe Vitest, a `npm run test:coverage` generuje pokrycie V8. Vitest nie pomija braku testów (`passWithNoTests` nie jest ustawione).

Wymagane jest 100% statements, branches, functions i lines per file dla czystej logiki domenowej pod `src/features/**/domain/**/*.ts`. Pokrycie wyłącza routing i Route Handlers, UI, bazę i ORM, konfigurację środowiska oraz adaptery. To nie jest próg dla całej aplikacji. Testy hooków strażniczych leżą w `tests/scripts/`.

## Integracja z PostgreSQL

`npm run test:integration` łączy się tylko przez `TEST_DATABASE_URL`. Walidator wymaga hosta `localhost` lub `127.0.0.1` i bazy `krajozbior_integration_test`; nie czyta ani nie używa awaryjnie `DATABASE_URL` czy `.env`. Połączenie musi mieć uprawnienia superużytkownika: służy wyłącznie do przygotowania baz i odczytu katalogu. GitHub Actions tworzy świeży PostgreSQL 17 jako service container.

**Harness ról.** `tests/support/database-harness.ts` tworzy dla każdego pliku własną bazę `krajozbior_integration_*` (pliki nie zależą od kolejności), uruchamia logikę `npm run db:roles` z losowymi hasłami na czas przebiegu, migruje jako `krajozbior_owner` i zwraca adresy połączeń LOGIN `krajozbior_app`, `krajozbior_auth`, `krajozbior_ops` i `krajozbior_owner`. Dowody odmowy wykonuj przez te połączenia, nie przez `SET ROLE` z superużytkownika. Role są globalne w klastrze, więc pliki działają sekwencyjnie, a pulę zamyka się przez `closePool()` z harnessu.

**Nie kieruj `TEST_DATABASE_URL` na klaster z bazą deweloperską ani E2E** (np. z `compose.yaml`): przebieg zmienia hasła ról `krajozbior_*` i aplikacja przestaje się łączyć do czasu ponownego `npm run db:roles`.

Testy szkieletu:

- `postgres-migrations` — migracja pustej bazy jako `krajozbior_owner`, wszystkie tabele należą do właściciela, transakcja z rollbackiem.
- `database-roles` — atrybuty ról (bez superużytkownika, `BYPASSRLS`, dziedziczenia), brak dostępu `krajozbior_app` do schematu `auth`, idempotentny `db:roles`.
- `rls-coverage` — po wszystkich migracjach każda tabela (zwykła i partycjonowana) poza schematem `auth` ma włączony i wymuszony RLS oraz co najmniej jedną politykę; wyjątki tylko z jawnej listy w teście (decyzja właściciela).
- `auth-accounts-access` — `krajozbior_auth` wstawia konto wyłącznie bez kolumny `role` (zawsze `user`) i nie zmienia roli; inną rolę ustawia `krajozbior_ops` (funkcja `ops_set_user_role` z wpisem `set_user_role` w dzienniku operacji) ze skryptu operatora.
- `otp-send-limiter` — dzienne limity próśb o kod (adres z aliasami liczonymi jako jeden adres, adres z jednego IP, IP, limit globalny); prośby o kod nie zużywają limitu logowania hasłem.
- `private-data-isolation` — wzorzec PRIV na technicznej tabeli kontrolnej: brak kontekstu = zero wierszy i odrzucony zapis, izolacja A/B, `WITH CHECK` dla cudzego `user_id`, rollback, brak wycieku kontekstu na tym samym połączeniu, odmowa zagnieżdżonego kontekstu; strażnik katalogu `tests/support/rls-guard.ts`.

Każda nowa tabela z danymi prywatnymi dodaje w swojej zmianie test na harnessie: `findRowLevelSecurityGaps` dla tabeli oraz odmowę odczytu i zapisu cudzych wierszy przez połączenie `krajozbior_app`. Każda funkcja używająca danych prywatnych lub roli z zakresem wymaga testu integracyjnego potwierdzającego odmowę dostępu bez uprawnień (`docs/data-isolation.md`, sekcja 5).

Test wgrywania kolekcji z pliku (`tests/integration/catalog-import.test.ts`) tworzy własne bazy na tym samym serwerze; opis polecenia jest w `docs/catalog-import.md`.

Gdy nie masz Dockera, **nie uruchamiaj** `npm run test:integration` lokalnie i zapisz `blocked` (zob. `docs/engineering.md`). `npm run check` nie uruchamia integracji: zmiana kształtu odpowiedzi przypadku użycia bez przebiegu `test:integration` nie jest gotowa.

## E2E

`npm run test:e2e` uruchamia Playwright z headless Chromium przeciwko zbudowanej aplikacji produkcyjnej (`next start`), w jednym workerze, jak w CI. Smoke sprawdza stronę startową i nagłówki bezpieczeństwa; scenariusze logowania wymagają bazy po `db:roles`, `db:migrate` i `db:seed:demo` (seed tylko z flagą `ALLOW_DEMO_SEED=1`), flagi `DEMO_ACCOUNTS_TEST_ONLY=1` dla serwera (ustawia ją `playwright.config.ts`; bez niej build produkcyjny odmawia logowania kontom demo) oraz zmiennych `DATABASE_URL` (`krajozbior_app`), `DATABASE_AUTH_URL` (`krajozbior_auth`), `DATABASE_OPS_URL` (`krajozbior_ops`; seed nadaje role i organizacje tą rolą, bez hasła migracji) i hasła kont demo; bez nich są pomijane. Przy błędzie Playwright zapisuje zrzut, trace i wideo, a CI publikuje `playwright-report/` i `test-results/` jako artefakt.

Zasady: spece dzielące konto demo i fikstury nie mogą zużywać tych samych zasobów; testy niczego nie zapisujące uruchamiaj przed zużywającymi. Nagłówki bezpieczeństwa sprawdzaj w E2E na buildzie produkcyjnym, nie tylko jednostkowo. axe nie działa przy wyłączonym JavaScripcie (zob. `<docs>/.ai/lessons.md`). Agent, który nie może nadpisać wyników innego przebiegu, zapisuje je do osobnego katalogu (`npx playwright test --workers=1 --output=test-results-<krok>`); git i Prettier pomijają wszystkie katalogi `test-results*/`, więc `npm run check` się o nie nie potyka. Sprzątanie w specach usuwa tylko dane utworzone przez dany test (po identyfikatorach), a nie wszystkie dane kont demo.

Lokatory regionów ogłaszanych (`getByRole("status")`, `getByRole("alert")`) zawsze zawężaj: filtrem po treści (`.filter({ hasText: "…" })`) albo do konkretnego kontenera. Next.js dodaje na każdej stronie własny ogłaszacz tras z `role="alert"`, a sekcje strony (np. „W okolicy” na stronie głównej) mają stałe, zwykle puste regiony `role="status"`. Niezawężony lokator działa, dopóki na stronie jest jeden taki region, a pada w trybie ścisłym Playwright, gdy ktoś doda następny w innym miejscu. Przy dodaniu nowego regionu `status` albo `alert` przeszukaj spece pod kątem niezawężonych lokatorów.

## Lokalne środowisko testowe (Windows)

Skrypty w `scripts/test-env/` odtwarzają lokalnie joby `integration` i `e2e` z CI. Nie dotykają bazy deweloperskiej (`127.0.0.1:5432`), portu 3000, pokazu lokalnego (port 3300, `scripts/showcase/`) ani środowisk innych stanowisk.

- `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1` — podnosi środowisko (albo używa działającego) i uruchamia `test:integration` oraz `test:e2e`. Argument `integration` lub `e2e` zawęża przebieg.
- `scripts/test-env/test-env-up.ps1` — samo środowisko: dwa jednorazowe kontenery `postgres:17` z limitem `--memory=1g` (osobny klaster dla integracji, bo harness zmienia hasła ról), role, migracje, konta demo, build (pomijany, gdy kod się nie zmienił) i `next start` na `127.0.0.1`, uruchomiony odłączonym procesem przez WMI. Adres i porty zapisuje w `.data/test-env/<stanowisko>/test-env.json`, jednorazowe hasła w `.data/test-env/<stanowisko>/test-env.env` (oba ignorowane przez git). Gdy start się nie uda, skrypt sam usuwa to, co zdążył uruchomić (aplikację i kontenery swojego stanowiska).
- `scripts/test-env/test-env-down.ps1` — zatrzymuje aplikację i usuwa oba kontenery **własnego** stanowiska; cudzych kontenerów nie rusza.

**Stanowiska.** Każda kopia repozytorium ma własne środowisko, więc dwa stanowiska mogą testować jednocześnie. Nazwę stanowiska, porty i katalog stanu wylicza `scripts/test-env/test-env-station.mjs` (testy: `tests/scripts/test-env-station.test.ts`):

| Kopia                        | Stanowisko     | Kontenery                                         | Aplikacja | Integracja  | E2E   |
| ---------------------------- | -------------- | ------------------------------------------------- | --------- | ----------- | ----- |
| główna (`.git` to katalog)   | `main`         | `krajozbior-testenv-main-e2e-pg`, `…-main-int-pg` | 3100      | 55432       | 55433 |
| `.worktrees/ws-N` (N = 1–49) | `ws-N`         | `krajozbior-testenv-ws-N-e2e-pg`, `…-ws-N-int-pg` | 3100+N    | 55432+10·N  | +1    |
| inna nazwa katalogu worktree | nazwa katalogu | `krajozbior-testenv-<nazwa>-e2e-pg`, `…-int-pg`   | 3150–3199 | 55932–56422 | +1    |

Porty są preferowane: zajęty port skrypt zastępuje wolnym portem wskazanym przez system (z zakresu 49152–65535). Zmienna `TEST_ENV_STATION` nadpisuje nazwę stanowiska (np. drugie środowisko z jednej kopii do diagnozy). Kontenery sprzed podziału na stanowiska (`krajozbior-testenv-e2e-pg`, `krajozbior-testenv-int-pg`) skrypty pomijają; usuń je ręcznie, gdy nikt ich nie używa.

**Blokady na cały komputer.** Start środowiska (`test-env-up.ps1`) i lokalny przebieg E2E (`test-env-test.ps1 e2e`) biorą blokadę wspólną dla wszystkich kopii (nazwany mutex Windows `Global\krajozbior-test-env-up` i `Global\krajozbior-test-env-e2e`). Drugi start czeka na koniec pierwszego (do 30 min), drugi przebieg E2E na koniec pierwszego (do 60 min); system zwalnia blokadę także wtedy, gdy proces padnie. Integracja nie bierze blokady, bo każde stanowisko ma własny klaster.

Wymaga uruchomionego Docker Desktop. **Przed każdym przebiegiem środowisko musi być świeże:** najpierw `test-env-down.ps1`, potem `test-env-test.ps1`; ponowne użycie konta demo daje fałszywe porażki.

## Wydajność lokalna (4 rdzenie, 16 GB RAM)

Komputer lokalny wystarcza dla dwóch agentów, które budują lub testują, i kilku lekkich. Więcej równoległej pracy spowalnia wszystkich i daje fałszywe porażki testów zależnych od czasu.

- **Naraz najwyżej 2 agenty z testami lub buildem** i 1–2 lekkie (przegląd, dokumentacja). Kolejne zadanie startuje, gdy zwolni się miejsce.
- **Jeden lokalny przebieg E2E naraz.** Playwright lokalnie zawsze w jednym workerze (skrypty z `scripts/test-env/` to wymuszają).
- **Pełna integracja i E2E idą w CI.** Lokalnie autor uruchamia `npm run check` i testy ukierunkowane (`npx vitest run <pliki>`, `npm run test:integration -- <pliki>`, jeden spec E2E). Recenzent uruchamia tylko testy związane z diffem. Gdy agent musi uruchomić integrację lokalnie, używa środowiska swojego stanowiska (`test-env-test.ps1 integration`) albo jednorazowego kontenera na wolnym porcie spoza zakresów stanowisk (np. 57442) i usuwa go po przebiegu.
- **Pula stanowisk `ws-1`, `ws-2`.** Stałe worktree (np. `.claude/worktrees/ws-1`) z zainstalowanym `node_modules`. Agent dostaje wolne stanowisko i przełącza w nim gałąź (`git switch -c <gałąź> origin/main`), zamiast tworzyć worktree i uruchamiać `npm ci` od nowa. Po zmianie `package-lock.json` na `main` stanowisko robi `npm ci` raz.
- **Vitest uruchamiaj ze ścieżki zaczynającej się od `C:\`** (wielka litera dysku, np. `Set-Location 'C:\...'` w PowerShell). Przebiegi uruchomione ze ścieżki `c:\` (mała litera, tak otwiera folder m.in. VS Code) kończyły się błędami, których nie było przy `C:\`; przyczyna nie jest zbadana. Liczbę wątków ogranicz, gdy działa drugi agent: `npx vitest run --maxWorkers=2`.
- **Docker z limitem pamięci.** Kontenery `scripts/test-env/` startują z `--memory=1g` (dwa na stanowisko); jednorazowe kontenery uruchamiane ręcznie też dostają `--memory=1g`. Docker Desktop ma ustawiony limit pamięci (np. 6 GB), żeby nie zabrał jej przeglądarce i Node.
- **Poprawki po przeglądzie sprawdza pełny `npm run test:unit`**, nie tylko testy zmienionego pliku: poprawka często psuje coś obok.
- **Logi agentów w osobnych katalogach** (`.ai/tmp/<agent>/`, `test-results-<agent>/` nie są wspólne), żeby równoległe przebiegi nie nadpisywały sobie wyników.

## Kontrole bezpieczeństwa w CI

Osobny wymagany job `gitleaks` skanuje całą historię w poszukiwaniu sekretów, a job `guard` odrzuca pliki i odwołania prywatne (`docs/agent-workflow.md`). Job `check` czerwienieje tylko przy wysokich i krytycznych podatnościach zależności produkcyjnych (`npm audit --omit=dev --omit=optional --audit-level=high`; `--omit=optional`, bo `better-auth` deklaruje `vitest` jako opcjonalną zależność równorzędną i bez tego audyt liczyłby narzędzia testowe). Pełny audyt, także narzędzi deweloperskich, tylko raportuje: przy znaleziskach dodaje ostrzeżenie do podsumowania przebiegu, ale nie blokuje checku (decyzja właściciela z 2026-11-17). Akcje są przypięte do pełnych SHA commitów; Dependabot aktualizuje SHA i komentarz z wersją. Wynik czerwony traktuj jak czerwone testy: nie scalaj, dopóki nie zostanie wyjaśniony (wyciek sekretu wymaga rotacji, nie tylko usunięcia z historii).

## Komendy

- `npm run format:check` — Prettier bez zapisu; `npm run lint` — ESLint; `npm run typecheck` — TypeScript strict.
- `npm run test:unit` — testy jednostkowe; `npm run test:coverage` — z progiem pokrycia domeny.
- `npm run build` — build produkcyjny; `npm run check` — format, lint, typy, coverage i build.
- `npm run test:integration` — PostgreSQL, uruchamiany w CI z osobną bazą.
- `npm run test:e2e` — Playwright, w CI po buildzie i instalacji Chromium.
- `npm run build-storybook` — build Storybooka; w CI krok w jobie `check`.

## CI w repozytorium publicznym

GitHub Actions w repozytorium publicznym jest bezpłatne, ale czas oczekiwania na wynik nadal kosztuje:

- Każdy PR, także draft i zmiana samej dokumentacji, uruchamia pełny zestaw. Żaden job nie ma warunku pomijania (`if:`, filtr ścieżek), bo pominięty wymagany job GitHub liczy jako zaliczony. Przy pracy w wielu krokach wypychaj zmiany w paczkach: każdy push to kilkanaście minut kolejki.
- Auto-merge włącza się dopiero po zakończeniu zielonego przebiegu CI ostatniego pushu (`docs/agent-workflow.md`, etap „Scalenie”). Nigdy nie scalaj przy wszystkich checkach pominiętych.
- Ruleset wymaga gałęzi aktualnej względem `main`, więc po każdym scaleniu pozostałe PR-y trzeba zaktualizować (merge, nie rebase) i przepuścić przez CI. PR ze ścieżkami z `CODEOWNERS` traci przy tym zatwierdzenie właściciela i wymaga ponownego.
- CodeQL (`.github/workflows/codeql.yml`) analizuje kod w każdym PR (także w szkicach), po scaleniu i raz w tygodniu; wyniki są w zakładce **Security** repozytorium.

Nie dodawaj zielonych placeholderów. Nowy job lub check ma uruchamiać realne testy.
