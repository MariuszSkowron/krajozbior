# Wdrożenie i pokaz lokalny (część lokalna)

## W skrócie

Aplikacja ma obraz produkcyjny Docker (`Dockerfile`) i dwa zestawy usług: `deploy/compose.yaml` dla serwera oraz nakładkę `deploy/compose.showcase.yaml` dla **pokazu lokalnego**, czyli trwałej kopii aplikacji z kontami demo i kolekcjami pod adresem `http://localhost:3300`. Pokaz działa obok środowiska deweloperskiego i testowego (`scripts/test-env/`): ma własne nazwy kontenerów, sieć i wolumen oraz własny port. Ta strona opisuje część lokalną; przygotowanie serwera, Caddy z domeną i skrypty wdrożenia dojdą w kolejnych krokach.

## Obraz (`Dockerfile`)

- Obraz bazowy to Node 22 (`node:22-bookworm-slim`) przypięty skrótem (digest). Odświeżenie: `docker pull node:22-bookworm-slim`, potem `docker inspect --format '{{index .RepoDigests 0}}' node:22-bookworm-slim` i wpisanie skrótu w `ARG NODE_IMAGE`. Skrót zmienia się przez PR (`Dockerfile` ma właściciela w `.github/CODEOWNERS`).
- Cel `runtime`: `next start`, użytkownik `node` (bez roota), tylko zależności produkcyjne, `HEALTHCHECK` na `/api/health`.
- Cel `ops`: pełne zależności i `scripts/`; uruchamiany jednorazowo (`docker compose run --rm ops npm run db:migrate`). Nie ustawia `NODE_ENV=production`, więc bezpieczniki poleceń operatora (odmowa w produkcji i poza lokalną bazą) działają jak na komputerze dewelopera.
- `.dockerignore` to lista dozwolonych plików: pliki `.env*`, `.git`, `.data/`, katalogi robocze agentów i skrypty Windows nie wchodzą do kontekstu budowy.

## Serwer (`deploy/compose.yaml`)

Usługi `db` (PostgreSQL 17), `app`, `proxy` (Caddy, `deploy/Caddyfile`) i jednorazowe `ops` (profil `ops`). Zasady sprawdza `tests/deploy/compose-config.test.ts`:

- Porty publikuje wyłącznie `proxy` (80/tcp, 443/tcp, 443/udp). Docker omija zaporę `ufw` dla opublikowanych portów, więc baza i aplikacja nie mają sekcji `ports:`.
- Każda usługa ma `restart: unless-stopped` i sterownik logów `journald`.
- Baza startuje z ustawieniami logów bez danych osobowych: `log_statement=none`, `log_min_duration_statement=-1`, `log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, `log_error_verbosity=terse`, `log_connections=off`, `log_disconnections=off`.
- Hasło superużytkownika bazy to jednorazowy plik (`POSTGRES_PASSWORD_FILE`), nie zmienna środowiska.
- Baza jest inicjalizowana z `--auth-local=peer --auth-host=scram-sha-256`: w `pg_hba.conf` nie ma `trust`, połączenie TCP (także z `127.0.0.1` w kontenerze) wymaga hasła, a gniazdo działa tylko dla `peer` (`docker exec -u postgres`). Ustawienie zapisuje się przy pierwszej inicjalizacji wolumenu.
- Kontener `ops` ma `NODE_ENV=production`, więc `catalog:import` i `db:seed:demo` odmawiają niezależnie od adresu bazy; plik nie ma `network_mode`. Tylko nakładka pokazu zmienia `NODE_ENV` na `development` i dzieli sieć z bazą.
- Znane ograniczenie (do F-K4): jednorazowe hasło startowe leży w `/run/krajozbior/pg-bootstrap`, a `/run` znika po restarcie serwera, więc `db` mogłaby nie wstać (Docker nie uruchamia kontenera ze źródłem montowania, którego nie ma). Rozwiązuje to F-K4: osobna nakładka pierwszego uruchomienia z sekretem, a `compose.yaml` bez niego po inicjalizacji.
- Plik nie zna flag demo (`ALLOW_DEMO_SEED`, `DEMO_ACCOUNTS_TEST_ONLY`, `EMAIL_OUTBOX_TEST_ONLY`): leżą wyłącznie w `deploy/showcase.env`.

## Pokaz lokalny

Wymaga uruchomionego Docker Desktop i około 3 GB wolnej pamięci przy pierwszej budowie obrazu. Polecenia (Windows PowerShell, z katalogu repozytorium):

| Co robisz                            | Polecenie                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Uruchomienie (i odświeżenie)         | `powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-up.ps1`                                          |
| Uruchomienie z kolekcjami z plików   | `... showcase-up.ps1 -CatalogDir <katalog z plikami *.ndjson> [-OrgSlug <slug>] [-CuratorEmail <e-mail>] [-Publish]` |
| Sprawdzenie (strona, zdrowie, login) | `powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-check.ps1`                                       |
| Zatrzymanie (dane zostają)           | `powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-down.ps1`                                        |
| Skasowanie danych pokazu             | `powershell -ExecutionPolicy Bypass -File scripts/showcase/showcase-reset.ps1 -ConfirmDataLoss`                      |

Co robi `showcase-up.ps1`: sprawdza Docker i port 3300; przy pierwszym uruchomieniu generuje hasła ról bazy, sekret sesji i hasło kont demo do `.data/showcase/secrets.env` (ignorowane przez git, nigdy nie wypisywane); buduje obraz (przy małej ilości wolnej pamięci pomija budowę, jeśli obrazy już istnieją); uruchamia bazę, potem w kontenerze `ops` `db:roles`, `db:migrate`, `db:seed:demo` i dla każdego pliku z `-CatalogDir` `catalog:import`; na końcu uruchamia aplikację i czeka na `/api/health`. Powtórne uruchomienie niczego nie zmienia (migracje, seed demo i wgrywanie kolekcji są idempotentne).

- **Konta demo:** `user@`, `user2@`, `admin@`, `curator-a@`, `curator-b@` w domenie `demo.krajozbior.local`; wspólne hasło jest w `DEMO_ACCOUNT_PASSWORD` w `.data/showcase/secrets.env`. Kody logowania e-mailem trafiają jako pliki `.eml` do `.data/showcase/outbox/`.
- **Kolekcje:** pliki zostają poza repozytorium kodu (leżą w repozytorium dokumentacji); skrypt montuje katalog tylko do odczytu. Domyślnie wgrywa do organizacji `demo-gmina-a` jako kurator `curator-a@demo.krajozbior.local`; bez `-Publish` kolekcje są szkicami. Pliki `*-public.ndjson` są pomijane. Raporty wgrania trafiają do `.data/showcase/reports/`.
- **Hasła pokazu:** `.data/showcase/secrets.env` leży w worktree, z którego uruchomiono pokaz, i nie podlega regule `.env*` ani zawężonym uprawnieniom; dane są lokalne i jednorazowe. Uruchamiaj pokaz z głównego katalogu repozytorium: usunięcie worktree kasuje hasła, a wolumen zostaje osierocony.
- **Dane:** wolumen `krajozbior-showcase-pgdata` przeżywa `showcase-down` i restart komputera; usuwa go tylko `showcase-reset.ps1 -ConfirmDataLoss`.
- **Wgrywanie kolekcji do bazy w sieci Compose:** kontener `ops` dzieli sieć z kontenerem bazy (`network_mode: service:db`), więc baza jest dla niego pod `localhost:5432`. Bezpieczniki `catalog:import` i `db:seed:demo` (adres bazy musi być lokalny) działają bez zmian i nie zostały osłabione.
- **Flagi demo:** trzy flagi (`ALLOW_DEMO_SEED`, `DEMO_ACCOUNTS_TEST_ONLY`, `EMAIL_OUTBOX_TEST_ONLY`) są dozwolone tylko dlatego, że adres jest lokalny (`BETTER_AUTH_URL=http://localhost:3300`); `AUTH_CLIENT_IP_HEADER` nie jest ustawiany, bo bez pośrednika nagłówek podałaby przeglądarka.
- **Logi:** na Windows sterownik `journald` nie istnieje, więc pokaz używa sterownika `local` z rotacją (3 × 10 MB). Serwer używa `journald`.

### Odseparowanie od innych środowisk

Pokaz nie używa portów 3000, 5432, 55432, 55433 i 3100 ani nazw `krajozbior-testenv-*`. Zasoby: projekt Compose `krajozbior-showcase`, kontenery `krajozbior-showcase-db` i `krajozbior-showcase-app`, sieć `krajozbior-showcase_default`, wolumen `krajozbior-showcase-pgdata`, aplikacja tylko na `127.0.0.1:3300`, baza bez portu na hoście. `test-env-down.ps1` usuwa kontenery po pełnych nazwach `krajozbior-testenv-*`, a `showcase-down.ps1` i `showcase-reset.ps1` działają tylko na projekcie pokazu; test w `tests/deploy/compose-config.test.ts` pilnuje, że żaden zestaw skryptów nie zawiera nazw drugiego.
