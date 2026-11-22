# shellcheck shell=bash
# Deployment modes run as `deploy` on the server (E11 spec 5.4, 5.4a, 5.7, D-E11-7, D-E11-11).
# Sent by scripts/ops/deploy.ps1 after lib.sh; KZ_MODE selects the mode:
#   initial   first deployment: database with the one-time superuser password, roles,
#             PASSWORD NULL, migrations, app + Caddy behind the password gate
#   commit    next deployments: pre-deploy backup, build, migrations, swap app, health check,
#             back to the previous image on failure (migrations are not rolled back)
#   admin     administrator account + membership in the editorial organisation
#   diagnoza  read-only state for the agent (no secrets, IP and e-mail addresses masked)
#   otworz    removes the password gate, only after `npm run legal:final` passes
#   odtworz   restores the newest real backup with the owner's key into a throw-away container
#   aktualnosci  news file of the editorial team (spec E7-R, E7-R2b): KZ_IMPORT_PHASE=preview
#             runs news:import --dry-run, apply writes the whole file (all or nothing); the
#             file comes in the payload like an import file (same helpers, one-time folder)
#   import    collection file (spec 5.6, F-K6): KZ_IMPORT_PHASE=preview runs catalog:import
#             --dry-run, apply loads drafts; the file comes in the payload and lives in a
#             one-time folder under imports/ only for that one command
# Keep this file ASCII-only.

kz_require_deploy() {
  [ "$(id -un)" = "deploy" ] || kz_fail "ten tryb dziala jako deploy (najpierw -Bootstrap)"
  [ -f "$KZ_ENV" ] || kz_fail "brak $KZ_ENV (najpierw -Bootstrap)"
}

kz_require_initialized() {
  [ -f "$KZ_STATE/initialized" ] || kz_fail "pierwsze wdrozenie jeszcze sie nie odbylo (-Initial)"
  IMAGE_TAG="$(kz_state_get current-tag)"
  export IMAGE_TAG
  [ -n "$IMAGE_TAG" ] || kz_fail "brak zapisanej wersji obrazu"
}

KZ_RESTORE_COMMIT=""
KZ_IMPORT_DIR=""

kz_cleanup() {
  rm -f "$KZ_OPS_ENV" "$KZ_RUN/pg-bootstrap" "$KZ_RUN/restore.key"
  kz_import_clear
  if [ -n "$KZ_RESTORE_COMMIT" ]; then
    (kz_checkout "$KZ_RESTORE_COMMIT") >/dev/null 2>&1 &&
      kz_step "kod na serwerze wrocil do dzialajacej wersji" || true
  fi
}

kz_compose_init() {
  docker compose -p "$KZ_PROJECT" -f "$KZ_SRC/deploy/compose.yaml" \
    -f "$KZ_SRC/deploy/compose.init.yaml" "$@" </dev/null
}

# Site checks through Caddy: health must be 200; the home page 401 (password gate) until
# -Otworz has succeeded, 200 afterwards. A 200 before the opening means the gate is missing,
# which breaks the legal condition of spec 5.4a (review F-K4, S3).
kz_site_ok() {
  kz_wait_http /api/health 200 "${1:-24}" || return 1
  local code
  code="$(kz_http_code /)"
  if [ -f "$KZ_STATE/opened" ]; then
    [ "$code" = "200" ] && { kz_step "strona glowna: 200 (serwis otwarty)"; return 0; }
  else
    [ "$code" = "401" ] && { kz_step "strona glowna: 401 (serwis za haslem)"; return 0; }
    [ "$code" = "200" ] && { kz_step "strona glowna: 200 BEZ HASLA przed otwarciem (bramka nie dziala)"; return 1; }
  fi
  kz_step "strona glowna odpowiada kodem ${code:-brak}"
  return 1
}

# The proxy may start only behind the password gate, unless the service was opened (5.4a).
kz_require_gate() {
  [ -f "$KZ_GATE_DIR/gate.caddy" ] || [ -f "$KZ_STATE/opened" ] ||
    kz_fail "brak bramki hasla ($KZ_GATE_DIR/gate.caddy), a serwis nie byl otwierany (-Otworz); nic nie uruchamiam"
}

# The `ops` service must read its own operator file (/run/krajozbior/ops.env), not
# .env.production: otherwise db:roles and db:migrate get no owner/ops passwords and the first
# deployment stops halfway (review F-K4, S7). The file arrives with PR #60.
kz_require_ops_env_file() {
  grep -q 'KRAJOZBIOR_OPS_ENV_FILE' "$KZ_SRC/deploy/compose.yaml" 2>/dev/null ||
    kz_fail "deploy/compose.yaml tego commita nie ma osobnego pliku operatora (KRAJOZBIOR_OPS_ENV_FILE). Najpierw scal PR #60 i wdrazaj commit po scaleniu; nic nie uruchamiam"
}

# Starts the application and Caddy. The proxy is always recreated: the Caddyfile is a
# single-file bind mount, and after `git checkout` the running container still sees the old
# inode, so neither `up -d` (definition unchanged) nor `caddy reload` would apply a new file.
# The cost is a few seconds without the site; the certificate lives in a volume (review F-K4, N1).
kz_up_app_proxy() {
  kz_compose up -d --wait app &&
    kz_compose up -d --wait --force-recreate proxy
}

# Name of the database volume (deploy/compose.yaml, volumes.pgdata.name). The rehearsal of the
# volume guard on the local showcase (docs/deployment.md) points it at the rehearsal volume.
: "${KZ_PGDATA_VOLUME:=krajozbior-pgdata}"

# True when the server has ever held real data: any backup or a recorded running version.
kz_has_real_data() {
  [ -f "$KZ_STATE/current-tag" ] && return 0
  [ -d "$KZ_BACKUPS" ] && [ -n "$(find "$KZ_BACKUPS" -type f 2>/dev/null | head -n 1)" ]
}

# First start of the database with the one-time superuser password, roles, PASSWORD NULL.
# Runs only while the volume holds no data yet (no `db-ready` marker): a volume left by an
# interrupted attempt was initialised with a superuser password that is gone now, so it is
# removed and the database starts from scratch (review F-K4, B5).
kz_initial_database() {
  if docker volume inspect "$KZ_PGDATA_VOLUME" >/dev/null 2>&1 </dev/null; then
    ! kz_has_real_data ||
      kz_fail "wolumen bazy istnieje, a serwer ma kopie zapasowe albo zapisana wersje (state/current-tag): odmawiam usuniecia wolumenu. Sprawdz recznie (-Diagnoza), ewentualnie odtworz z kopii"
    kz_step "baza z przerwanego podejscia (bez danych, bez znacznika db-ready): zaczynam ja od nowa"
    kz_compose down
    docker volume rm "$KZ_PGDATA_VOLUME" >/dev/null </dev/null
  fi

  kz_step "pierwszy start bazy z jednorazowym haslem superuzytkownika (D-E11-11)"
  KZ_PG_BOOTSTRAP_PW="$(kz_secret)"
  # 644 inside the 700 directory: the postgres entrypoint reads the file as uid 999.
  (umask 022 && printf '%s' "$KZ_PG_BOOTSTRAP_PW" >"$KZ_RUN/pg-bootstrap")
  kz_compose_init up -d --wait db

  kz_step "role bazy (db:roles)"
  kz_ops db:roles

  kz_step "superuzytkownik bez hasla, tylko przez gniazdo w kontenerze"
  kz_compose exec -T -u postgres db psql -q -v ON_ERROR_STOP=1 -d "$KZ_DB_NAME" \
    -c "alter role postgres password null"
  rm -f "$KZ_RUN/pg-bootstrap"
  unset KZ_PG_BOOTSTRAP_PW
  kz_compose up -d --wait --force-recreate db
}

kz_mode_initial() {
  [ ! -f "$KZ_STATE/initialized" ] || kz_fail "pierwsze wdrozenie juz bylo; kolejne: -Commit <sha>"
  kz_checkout "$KZ_COMMIT"
  kz_write_healthchecks_env
  IMAGE_TAG="$(kz_tag_of "$KZ_COMMIT")"
  export IMAGE_TAG
  kz_require_ops_env_file
  kz_require_gate
  kz_assert_no_demo_flags

  kz_step "budowa obrazow $IMAGE_TAG (kilka minut)"
  kz_compose --profile ops build app ops

  if [ -f "$KZ_STATE/db-ready" ]; then
    kz_step "baza przygotowana w poprzednim podejsciu (role, PASSWORD NULL); wznawiam"
    kz_compose up -d --wait db
  else
    kz_initial_database
  fi

  # Idempotent: a repeated attempt (maybe from a newer commit) runs only the missing migrations.
  kz_step "migracje (rola owner)"
  kz_ops db:migrate
  kz_state_set db-ready "$(date -u +%FT%TZ)"

  kz_step "aplikacja i Caddy (certyfikat TLS moze potrwac do 2-3 minut)"
  kz_up_app_proxy
  kz_site_ok 36 || kz_fail "serwis nie odpowiada poprawnie po pierwszym wdrozeniu"

  kz_state_set current-tag "$IMAGE_TAG"
  kz_state_set current-commit "$KZ_COMMIT"
  kz_state_set initialized "$(date -u +%FT%TZ)"
  kz_check_secrets_absent
  kz_step "GOTOWE: pierwsze wdrozenie $IMAGE_TAG"
}

# K-7: no superuser password in the containers' environment, PASSWORD NULL in pg_authid.
kz_check_secrets_absent() {
  local leaked
  leaked="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "$KZ_PROJECT-db-1" "$KZ_PROJECT-proxy-1" | grep -c -E '^(POSTGRES_PASSWORD|KRAJOZBIOR_(OWNER|OPS)_DB_PASSWORD)=' || true)"
  [ "$leaked" = "0" ] || kz_fail "w zmiennych kontenera db/proxy jest haslo (K-7)"
  local null
  null="$(kz_compose exec -T -u postgres db psql -At -d "$KZ_DB_NAME" \
    -c "select rolpassword is null from pg_authid where rolname = 'postgres'")"
  [ "$null" = "t" ] || kz_fail "superuzytkownik ma haslo (K-7)"
  kz_step "K-7: brak hasel w zmiennych kontenerow, superuzytkownik bez hasla"
}

# Removes app/ops images other than the two given tags (current and previous) and old build
# cache, so repeated deployments do not fill the disk (review F-K4, S2 d). Never fails.
# The tag `local` is never removed: it is the image of the local showcase (showcase-up.ps1).
kz_prune_images() {
  local repo tag
  for repo in $KZ_IMAGE_REPOS; do
    for tag in $(docker image ls "$repo" --format '{{.Tag}}' </dev/null 2>/dev/null || true); do
      [ "$tag" = "$1" ] || [ "$tag" = "$2" ] || [ "$tag" = "local" ] ||
        docker image rm "$repo:$tag" >/dev/null 2>&1 </dev/null || true
    done
  done
  docker builder prune -f --filter until=168h >/dev/null 2>&1 </dev/null || true
}

kz_mode_commit() {
  kz_require_initialized
  local previous="$IMAGE_TAG" previous_commit failed
  previous_commit="$(kz_state_get current-commit)"

  # Before anything changes, with the code of the running version.
  kz_step "kopia przed wdrozeniem"
  kz_backup predeploy || kz_fail "kopia przed wdrozeniem nieudana; nic nie zmieniono (dziala $previous)"

  kz_checkout "$KZ_COMMIT"
  # Until the swap succeeds, any exit puts the code folder (compose.yaml, Caddyfile, timer
  # scripts) back on the running version (kz_cleanup).
  KZ_RESTORE_COMMIT="$previous_commit"
  kz_write_healthchecks_env
  kz_require_ops_env_file
  kz_require_gate
  kz_assert_no_demo_flags

  IMAGE_TAG="$(kz_tag_of "$KZ_COMMIT")"
  export IMAGE_TAG
  kz_step "budowa obrazow $IMAGE_TAG (kilka minut)"
  kz_compose --profile ops build app ops

  kz_step "migracje (rola owner)"
  kz_ops db:migrate

  kz_step "podmiana aplikacji"
  if kz_up_app_proxy && kz_site_ok; then
    KZ_RESTORE_COMMIT=""
    kz_state_set previous-tag "$previous"
    kz_state_set previous-commit "$previous_commit"
    kz_state_set current-tag "$IMAGE_TAG"
    kz_state_set current-commit "$KZ_COMMIT"
    kz_prune_images "$IMAGE_TAG" "$previous"
    kz_step "GOTOWE: wdrozono $IMAGE_TAG (poprzednio $previous)"
    return 0
  fi

  # Back to the previous version as a whole: code (compose.yaml, Caddyfile), app image and
  # proxy, then the same site check. Migrations are not rolled back (D-E11-7).
  failed="$IMAGE_TAG"
  KZ_RESTORE_COMMIT=""
  IMAGE_TAG="$previous"
  export IMAGE_TAG
  kz_step "powrot do poprzedniej wersji $previous: kod, aplikacja i Caddy (migracji nie cofam)"
  if [ -n "$previous_commit" ] && (kz_checkout "$previous_commit") &&
    kz_up_app_proxy && kz_site_ok; then
    kz_fail "wdrozenie $failed nieudane; przywrocono $previous i strona odpowiada. Baza jest juz po migracjach $failed (poprzedni kod dziala na nowym schemacie). Cofniecie migracji = odtworzenie kopii przed wdrozeniem (decyzja czlowieka)"
  fi
  kz_fail "wdrozenie $failed nieudane i powrot do $previous tez nieudany: serwis moze nie dzialac. Uruchom -Diagnoza i napisz agentowi"
}

kz_mode_admin() {
  kz_require_initialized
  [ -n "${KZ_ADMIN_EMAIL:-}" ] && [ -n "${KZ_ADMIN_PW:-}" ] && [ -n "${KZ_REASON:-}" ] ||
    kz_fail "brak adresu, hasla albo powodu"
  kz_step "konto administratora (auth:create-admin, wpis w dzienniku operacji)"
  ADMIN_PASSWORD="$KZ_ADMIN_PW" kz_ops auth:create-admin -e ADMIN_PASSWORD -- \
    --email "$KZ_ADMIN_EMAIL" --reason "$KZ_REASON" --operator wlasciciel
  kz_step "czlonkostwo w organizacji redakcji (ops:curator)"
  kz_ops ops:curator -- grant --org-slug "$KZ_ORG_SLUG" --email "$KZ_ADMIN_EMAIL" \
    --name "$KZ_ORG_NAME" --kind other --reason "$KZ_REASON" --operator wlasciciel
  kz_step "GOTOWE: administrator i redakcja"
}

# Masks IPv4/IPv6 and e-mail addresses (the PowerShell side masks the report again).
kz_mask() {
  sed -E -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<e-mail>/g' \
    -e 's/([0-9]{1,3}\.){3}[0-9]{1,3}/<ip>/g' \
    -e 's/([0-9a-fA-F]{1,4}:)+:[0-9a-fA-F:]*/<ip>/g' \
    -e 's/([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}/<ip>/g'
}

kz_mode_diagnoza() {
  kz_step "diagnoza (tylko odczyt)"
  printf 'wersja: %s (commit %s)\n' "$(kz_state_get current-tag)" "$(kz_state_get current-commit)"
  printf 'bramka hasla: %s\n' "$([ -f "$KZ_GATE_DIR/gate.caddy" ] && echo wlaczona || echo wylaczona)"
  echo '--- kontenery'
  kz_compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>&1 || true
  echo '--- dysk i pamiec'
  df -h / "$KZ_ROOT" 2>&1 | kz_mask
  free -m
  echo '--- timery'
  systemctl list-timers 'krajozbior-*' --no-pager 2>&1 | cut -c1-120 || true
  echo '--- kopie (najnowsze)'
  # shellcheck disable=SC2012
  ls -1t "$KZ_BACKUPS" 2>/dev/null | head -n 5 || true
  local service
  for service in app proxy db; do
    echo "--- log $service (200 linii)"
    journalctl CONTAINER_NAME="$KZ_PROJECT-$service-1" -n 200 -o cat --no-pager 2>&1 | kz_mask || true
  done
  kz_step "GOTOWE: diagnoza"
}

kz_mode_otworz() {
  kz_require_initialized
  kz_step "bramka tekstow prawnych (npm run legal:final)"
  if ! kz_ops legal:final; then
    kz_fail "teksty prawne maja znaczniki robocze; serwis zostaje za haslem"
  fi
  rm -f "$KZ_GATE_DIR/gate.caddy"
  # Always: when an earlier attempt removed the file but the reload failed, a repeat must
  # still reload (review F-K4, S3).
  kz_compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile
  kz_wait_http / 200 12 || kz_fail "strona glowna nie odpowiada 200 po zdjeciu hasla"
  kz_state_set opened "$(date -u +%FT%TZ)"
  kz_step "GOTOWE: serwis otwarty"
}

kz_mode_odtworz() {
  kz_require_initialized
  [ -n "${KZ_RESTORE_KEY:-}" ] || kz_fail "brak klucza kopii"
  local dump
  dump="$(kz_list_backups | sed -n 1p)"
  [ -n "$dump" ] || kz_fail "brak kopii do odtworzenia"
  (umask 077 && printf '%s\n' "$KZ_RESTORE_KEY" >"$KZ_RUN/restore.key")
  unset KZ_RESTORE_KEY
  kz_step "odtwarzam $(basename "$dump") do jednorazowego kontenera bez sieci"
  if kz_restore_check "$dump" "$KZ_RUN/restore.key"; then
    rm -f "$KZ_RUN/restore.key"
    kz_step "GOTOWE: kopia odtworzona kluczem wlasciciela (K-8, K-19)"
  else
    rm -f "$KZ_RUN/restore.key"
    kz_fail "odtworzenie nieudane (zly klucz albo uszkodzona kopia)"
  fi
}

# --- import (spec 5.6, F-K6) ---------------------------------------------------------------

# Removes the one-time folder of this run (only a folder under imports/run-*).
kz_import_clear() {
  case "$KZ_IMPORT_DIR" in
    "$KZ_IMPORTS"/run-*) rm -rf -- "$KZ_IMPORT_DIR" ;;
  esac
  KZ_IMPORT_DIR=""
}

# The code on the server must know the server mode of catalog:import (F-K6). It is the code of
# the running version (no checkout here), so an older deployment refuses before anything runs.
kz_require_import_support() {
  grep -q -- '--confirm-host' "$KZ_SRC/scripts/catalog-import.ts" 2>/dev/null ||
    kz_fail "dzialajaca wersja nie umie wgrywac na serwer (F-K6). Najpierw wdroz commit z F-K6 (-Commit <sha>); nic nie wgrano"
}

kz_import_check_inputs() {
  local name_re='^[A-Za-z0-9][A-Za-z0-9._-]{0,100}-public\.ndjson$'
  local slug_re='^[a-z0-9]+(-[a-z0-9]+)*$'
  case "${KZ_IMPORT_PHASE:-}" in preview | apply) ;; *) kz_fail "nieznana faza wgrywania" ;; esac
  [[ "${KZ_IMPORT_NAME:-}" =~ $name_re ]] || kz_fail "zla nazwa pliku (oczekiwane <nazwa>-public.ndjson); nic nie wgrano"
  [[ "${KZ_IMPORT_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || kz_fail "brak skrotu SHA-256 pliku; nic nie wgrano"
  [ -n "${KZ_IMPORT_B64:-}" ] || kz_fail "brak tresci pliku; nic nie wgrano"
  [[ "${KZ_ORG_SLUG:-}" =~ $slug_re ]] || kz_fail "nieprawidlowy slug organizacji; nic nie wgrano"
  [ -n "${KZ_CURATOR_EMAIL:-}" ] && [ -n "${KZ_REASON:-}" ] && [ -n "${KZ_SITE_HOST:-}" ] ||
    kz_fail "brak adresu kuratora, powodu albo nazwy hosta; nic nie wgrano"
}

# Writes the file into a one-time folder and checks its SHA-256 against the owner's computer.
# imports/ stays 700 (deploy); the run folder 755 and the file 644, because the `ops` container
# runs as `node` and sees only the mounted run folder (read-only).
kz_import_prepare() {
  local file sum
  mkdir -p "$KZ_IMPORTS"
  chmod 700 "$KZ_IMPORTS"
  # Leftovers of an earlier run killed in the middle (KILL signal, server restart): there is one
  # operator, so no other run can be using them.
  find "$KZ_IMPORTS" -mindepth 1 -maxdepth 1 -type d -name 'run-*' -exec rm -rf -- {} + 2>/dev/null || true
  KZ_IMPORT_DIR="$KZ_IMPORTS/run-$(date -u +%Y%m%d-%H%M%S)-$$"
  mkdir -m 755 "$KZ_IMPORT_DIR"
  file="$KZ_IMPORT_DIR/$KZ_IMPORT_NAME"
  if ! (umask 022 && printf '%s' "$KZ_IMPORT_B64" | base64 -d >"$file"); then
    kz_import_clear
    kz_fail "nie udalo sie zapisac pliku na serwerze; nic nie wgrano"
  fi
  sum="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ "$sum" != "$KZ_IMPORT_SHA256" ]; then
    kz_import_clear
    kz_fail "plik na serwerze rozni sie od pliku z komputera (SHA-256); nic nie wgrano"
  fi
  chmod 644 "$file"
}

kz_import_run() {
  local -a args=(--target server --confirm-host "$KZ_SITE_HOST" --profile public
    --file "/imports/$KZ_IMPORT_NAME" --org-slug "$KZ_ORG_SLUG" --curator-email "$KZ_CURATOR_EMAIL")
  if [ "$KZ_IMPORT_PHASE" = "preview" ]; then
    args+=(--dry-run)
  else
    args+=(--operator wlasciciel --reason "$KZ_REASON")
  fi
  kz_ops catalog:import -v "$KZ_IMPORT_DIR:/imports:ro" -- "${args[@]}"
}

kz_mode_import() {
  kz_require_initialized
  kz_require_import_support
  kz_import_check_inputs
  kz_import_prepare
  if [ "$KZ_IMPORT_PHASE" = "preview" ]; then
    kz_step "podglad wgrania $KZ_IMPORT_NAME do organizacji $KZ_ORG_SLUG (nic nie zapisuje)"
  else
    kz_step "wgranie szkicow z $KZ_IMPORT_NAME do organizacji $KZ_ORG_SLUG (wpisy w dzienniku operacji)"
  fi
  local status=0
  kz_import_run || status=$?
  kz_import_clear
  kz_step "plik usuniety z serwera"
  case "$status" in
    0)
      if [ "$KZ_IMPORT_PHASE" = "preview" ]; then kz_step "GOTOWE: podglad (nic nie zapisano)"; else kz_step "GOTOWE: szkice wgrane"; fi ;;
    2) kz_fail "plik odrzucony (kod 2): bledy w pliku albo miejsca spoza pliku, ktorych nie ma w bazie; nic nie wgrano" ;;
    3) kz_fail "odmowa (kod 3): organizacja, konto kuratora, nazwa hosta albo czesc kolekcji odrzucona; gdy wyzej jest 'Wgrane czesciowo', czesc szkicow juz jest na serwerze (to samo wgranie mozna powtorzyc po usunieciu przyczyny)" ;;
    *) kz_fail "wgrywanie nieudane (kod $status); dane zapisane wczesniej zostaja, to samo wgranie mozna powtorzyc" ;;
  esac
}

# --- aktualnosci (spec E7-R, 14.4, E7-R2b) -----------------------------------------------------
# Same transport as import (kz_import_prepare: base64 + SHA-256 in the payload, one-time folder
# under imports/ mounted read-only into `ops`, removed by kz_import_clear and the EXIT trap).
# Differences: no organisation or curator (the command takes only the editorial organisations),
# only the ops role password, one transaction for the whole file, so exit code 2 and 3 mean
# "nothing changed" and are passed on as they are (wdroz.ps1 shows them in yellow).

# The running version must have the command (it is the code of the running version, no checkout
# here), so an older deployment refuses before anything runs and this mode can be merged before
# the command itself exists.
kz_require_news_support() {
  grep -q '"news:import"' "$KZ_SRC/package.json" 2>/dev/null ||
    kz_fail "dzialajaca wersja nie ma polecenia news:import. Najpierw wdroz commit z poleceniem news:import (-Commit <sha>); nic nie wgrano"
  # The first version of the command may lack the server mode (as -Import checks for catalog-import).
  grep -q -- '--confirm-host' "$KZ_SRC/scripts/news-import.ts" 2>/dev/null ||
    kz_fail "polecenie news:import dzialajacej wersji nie obsluguje trybu serwera (--confirm-host). Najpierw wdroz nowszy commit (-Commit <sha>); nic nie wgrano"
}

# Arguments that name the target of news:import. On the server the command needs the explicit
# server mode with the confirmed host; prints nothing and fails when the host name is not valid.
# showcase.sh replaces this function (the showcase database is local, the container is not
# production, so the command runs without them).
kz_news_target_args() {
  local host_re='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
  [[ "${KZ_SITE_HOST:-}" =~ $host_re ]] || return 1
  printf '%s\n' "--target server --confirm-host $KZ_SITE_HOST"
}

kz_news_check_inputs() {
  local name_re='^aktualnosci-[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.ndjson$'
  case "${KZ_IMPORT_PHASE:-}" in preview | apply) ;; *) kz_fail "nieznana faza wgrywania" ;; esac
  [[ "${KZ_IMPORT_NAME:-}" =~ $name_re ]] || kz_fail "zla nazwa pliku (oczekiwane aktualnosci-<nazwa>.ndjson); nic nie wgrano"
  [[ "${KZ_IMPORT_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || kz_fail "brak skrotu SHA-256 pliku; nic nie wgrano"
  [ -n "${KZ_IMPORT_B64:-}" ] || kz_fail "brak tresci pliku; nic nie wgrano"
  [ -n "${KZ_REASON:-}" ] || kz_fail "brak powodu do dziennika operacji; nic nie wgrano"
  kz_news_target_args >/dev/null || kz_fail "brak nazwy hosta serwisu; nic nie wgrano"
}

kz_news_run() {
  local target
  local -a target_args=() args=()
  target="$(kz_news_target_args)"
  read -r -a target_args <<<"$target"
  args=(--file "/imports/$KZ_IMPORT_NAME" ${target_args[@]+"${target_args[@]}"})
  if [ "$KZ_IMPORT_PHASE" = "preview" ]; then
    args+=(--dry-run)
  else
    args+=(--operator wlasciciel --reason "$KZ_REASON")
  fi
  kz_ops news:import -v "$KZ_IMPORT_DIR:/imports:ro" -- "${args[@]}"
}

kz_mode_aktualnosci() {
  kz_require_initialized
  kz_require_news_support
  kz_news_check_inputs
  kz_import_prepare
  if [ "$KZ_IMPORT_PHASE" = "preview" ]; then
    kz_step "podglad aktualnosci z $KZ_IMPORT_NAME (nic nie zapisuje)"
  else
    kz_step "wgranie aktualnosci z $KZ_IMPORT_NAME (caly plik albo nic; wpisy w dzienniku operacji)"
  fi
  local status=0
  kz_news_run || status=$?
  kz_import_clear
  kz_step "plik usuniety z serwera"
  case "$status" in
    0)
      if [ "$KZ_IMPORT_PHASE" = "preview" ]; then kz_step "GOTOWE: podglad (nic nie zapisano)"; else kz_step "GOTOWE: aktualnosci wgrane"; fi ;;
    # Not failures of the script: their own exit statuses (the EXIT trap still cleans up), so
    # wdroz.ps1 says what happened and that nothing changed.
    2)
      kz_step "plik odrzucony (kod 2): bledy w pliku; nic sie nie zmienilo"
      exit 2 ;;
    3)
      kz_step "odmowa (kod 3): niedozwolona zmiana stanu, zle powiazanie, za duzo aktualnosci albo ustawienia serwera (nazwa hosta); nic sie nie zmienilo"
      exit 3 ;;
    *) kz_fail "wgrywanie aktualnosci nieudane (kod $status); plik jest zapisywany w calosci albo wcale, to samo wgranie mozna powtorzyc" ;;
  esac
}

kz_main() {
  trap kz_cleanup EXIT
  kz_require_deploy
  case "$KZ_MODE" in
    aktualnosci) kz_mode_aktualnosci ;;
    initial) kz_mode_initial ;;
    commit) kz_mode_commit ;;
    admin) kz_mode_admin ;;
    diagnoza) kz_mode_diagnoza ;;
    otworz) kz_mode_otworz ;;
    odtworz) kz_mode_odtworz ;;
    import) kz_mode_import ;;
    *) kz_fail "nieznany tryb: $KZ_MODE" ;;
  esac
}
