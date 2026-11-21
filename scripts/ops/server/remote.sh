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

kz_cleanup() {
  rm -f "$KZ_OPS_ENV" "$KZ_RUN/pg-bootstrap" "$KZ_RUN/restore.key"
}

kz_compose_init() {
  docker compose -p "$KZ_PROJECT" -f "$KZ_SRC/deploy/compose.yaml" \
    -f "$KZ_SRC/deploy/compose.init.yaml" "$@" </dev/null
}

# Site checks through Caddy: health must be 200, the home page 200 (open) or 401 (gate).
kz_site_ok() {
  kz_wait_http /api/health 200 "${1:-24}" || return 1
  local code
  code="$(kz_http_code /)"
  case "$code" in
    200) kz_step "strona glowna: 200 (serwis otwarty)" ;;
    401) kz_step "strona glowna: 401 (serwis za haslem)" ;;
    *)
      kz_step "strona glowna odpowiada kodem ${code:-brak}"
      return 1
      ;;
  esac
}

# Name of the database volume (deploy/compose.yaml, volumes.pgdata.name).
KZ_PGDATA_VOLUME="krajozbior-pgdata"

# First start of the database with the one-time superuser password, roles, PASSWORD NULL.
# Runs only while the volume holds no data yet (no `db-ready` marker): a volume left by an
# interrupted attempt was initialised with a superuser password that is gone now, so it is
# removed and the database starts from scratch (review F-K4, B5).
kz_initial_database() {
  if docker volume inspect "$KZ_PGDATA_VOLUME" >/dev/null 2>&1 </dev/null; then
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
  kz_compose up -d --wait app proxy
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

kz_mode_commit() {
  kz_require_initialized
  local previous="$IMAGE_TAG"
  kz_checkout "$KZ_COMMIT"
  kz_write_healthchecks_env
  kz_assert_no_demo_flags

  kz_step "kopia przed wdrozeniem"
  kz_backup predeploy || kz_fail "kopia przed wdrozeniem nieudana; nic nie zmieniono (dziala $previous)"

  IMAGE_TAG="$(kz_tag_of "$KZ_COMMIT")"
  export IMAGE_TAG
  kz_step "budowa obrazow $IMAGE_TAG (kilka minut)"
  kz_compose --profile ops build app ops

  kz_step "migracje (rola owner)"
  kz_ops db:migrate

  kz_step "podmiana aplikacji"
  if kz_compose up -d --wait app proxy && kz_site_ok; then
    kz_state_set previous-tag "$previous"
    kz_state_set current-tag "$IMAGE_TAG"
    kz_state_set current-commit "$KZ_COMMIT"
    kz_step "GOTOWE: wdrozono $IMAGE_TAG (poprzednio $previous)"
    return 0
  fi

  kz_step "powrot do poprzedniego obrazu $previous (migracji nie cofam)"
  IMAGE_TAG="$previous" kz_compose up -d --wait app || true
  kz_fail "wdrozenie $IMAGE_TAG nieudane; dziala $previous. Cofniecie migracji = odtworzenie kopii przed wdrozeniem (decyzja czlowieka)"
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
  if [ -f "$KZ_GATE_DIR/gate.caddy" ]; then
    rm -f "$KZ_GATE_DIR/gate.caddy"
    kz_compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile
  fi
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

kz_main() {
  trap kz_cleanup EXIT
  kz_require_deploy
  case "$KZ_MODE" in
    initial) kz_mode_initial ;;
    commit) kz_mode_commit ;;
    admin) kz_mode_admin ;;
    diagnoza) kz_mode_diagnoza ;;
    otworz) kz_mode_otworz ;;
    odtworz) kz_mode_odtworz ;;
    *) kz_fail "nieznany tryb: $KZ_MODE" ;;
  esac
}
