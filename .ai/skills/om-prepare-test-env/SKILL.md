# om-prepare-test-env — rozszerzenie repozytorium projektu

Fakty tego repozytorium dla skilla `om-prepare-test-env`. Nie łagodzi reguł bezpieczeństwa skilla.

## Entrypoint

- Flavor: PowerShell (`.ps1`, Windows PowerShell 5.1, tylko ASCII). Wersji `.sh` jeszcze nie ma; na macOS/Linux wygeneruj ją z tych samych faktów.
- Start lub reuse: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-up.ps1 [--force] [--force-rebuild]`.
- Testy: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1 [integration|e2e|all]`.
- Stop: `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-down.ps1`.

## Działający łańcuch (zweryfikowany 2026-11-08)

1. Dwa kontenery `postgres:17` z `--rm` i `--memory=1g`, nazwane po stanowisku (kopii repozytorium): `krajozbior-testenv-<stanowisko>-e2e-pg` (`krajozbior_e2e`) i `krajozbior-testenv-<stanowisko>-int-pg` (`krajozbior_integration_test`). Stanowisko, preferowane porty i katalog stanu `.data/test-env/<stanowisko>/` wylicza `scripts/test-env/test-env-station.mjs` (tabela w `docs/testing.md`); zajęty port → wolny port. Start i E2E biorą blokadę na cały komputer; nieudany start usuwa to, co uruchomił.
2. Jawne zmienne procesu (nadpisują lokalny `.env`), potem `npm run db:roles` → `db:migrate` → `db:seed:demo`.
3. `npm run build` tylko gdy zmienił się odcisk wejść; `.snapshot-*.json` MikroORM pomijane.
4. `next start` na 127.0.0.1 (preferowany port stanowiska: 3100 dla głównej kopii, 3100+N dla `ws-N`), odłączony przez WMI; zdrowie: `/api/health` (sprawdza bazę).
5. Czasy: zimny start z buildem 58 s; bez buildu 29–37 s; reuse 2 s.

## Pułapki, którym zapobiega skrypt

- Integracja i aplikacja na jednym klastrze: harness zmienia hasła ról `krajozbior_*` i aplikacja traci bazę. Dlatego dwa kontenery.
- `Start-Process` wiesza wywołującego, który przechwytuje wyjście. Dlatego WMI `Win32_Process.Create`.
- Testy integracyjne zapisują `src/lib/db/migrations/.snapshot-*.json`. Bez wykluczenia każde uruchomienie po nich przebudowywało środowisko.
- E2E z wieloma workerami: timeouty `page.goto` lokalnie. Launcher używa `--workers=1` (jak CI).
- Dwa stanowiska usuwały sobie nawzajem kontenery o stałych nazwach. Dlatego nazwy i porty są per stanowisko, a `test-env-down.ps1` usuwa tylko dokładne nazwy własnego stanowiska.
- Preferowane porty bywają zajęte przez pozostałości innych sesji (np. kontener sprzed podziału na stanowiska). Skrypt ich nie zatrzymuje, tylko wybiera inny port.

## Czego środowisko nie zawiera

- Danych produkcyjnych; są tylko konta demo (`db:seed:demo`) i fikstury wstawiane przez `globalSetup` Playwrighta przy `npm run test:e2e`.
