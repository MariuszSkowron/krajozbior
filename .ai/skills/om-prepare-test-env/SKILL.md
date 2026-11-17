# om-prepare-test-env — rozszerzenie repozytorium projektu

Fakty tego repozytorium dla skilla `om-prepare-test-env`. Nie łagodzi reguł bezpieczeństwa skilla.

## Entrypoint

- Flavor: PowerShell (`.ps1`, Windows PowerShell 5.1, tylko ASCII). Wersji `.sh` jeszcze nie ma; na macOS/Linux wygeneruj ją z tych samych faktów.
- Start lub reuse: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-up.ps1 [--force] [--force-rebuild]`.
- Testy: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1 [integration|e2e|all]`.
- Stop: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-down.ps1`.

## Działający łańcuch (zweryfikowany 2026-11-08)

1. Dwa kontenery `postgres:17` z `--rm`: `starter-testenv-e2e-pg` (`starter_e2e`, preferowany 55433) i `starter-testenv-int-pg` (`starter_integration_test`, preferowany 55432). Zajęty port → wolny port.
2. Jawne zmienne procesu (nadpisują lokalny `.env`), potem `npm run db:roles` → `db:migrate` → `db:seed:demo`.
3. `npm run build` tylko gdy zmienił się odcisk wejść; `.snapshot-*.json` MikroORM pomijane.
4. `next start` na 127.0.0.1 (preferowany 3100), odłączony przez WMI; zdrowie: `/api/health` (sprawdza bazę).
5. Czasy: zimny start z buildem 58 s; bez buildu 29–37 s; reuse 2 s.

## Pułapki, którym zapobiega skrypt

- Integracja i aplikacja na jednym klastrze: harness zmienia hasła ról `starter_*` i aplikacja traci bazę. Dlatego dwa kontenery.
- `Start-Process` wiesza wywołującego, który przechwytuje wyjście. Dlatego WMI `Win32_Process.Create`.
- Testy integracyjne zapisują `src/lib/db/migrations/.snapshot-*.json`. Bez wykluczenia każde uruchomienie po nich przebudowywało środowisko.
- E2E z wieloma workerami: timeouty `page.goto` lokalnie. Launcher używa `--workers=1` (jak CI).
- Porty 55432/3100 bywają zajęte przez pozostałości innych sesji agentów (np. kontener z poprzedniej sesji, `next start` z `.claude/worktrees/`). Skrypt ich nie zatrzymuje, tylko wybiera inny port.

## Czego środowisko nie zawiera

- Danych produkcyjnych; są tylko konta demo (`db:seed:demo`) i fikstury wstawiane przez `globalSetup` Playwrighta przy `npm run test:e2e`.
