# shellcheck shell=bash
# Common functions of the server-side deployment scripts (E11 spec, F-K4).
#
# Nothing here runs on its own: scripts/ops/deploy.ps1 (started by the owner from wdroz.ps1)
# sends one payload over the SSH connection's standard input:
#   preamble with KZ_* variables (secrets base64-encoded, never in argv)
#   + this file + bootstrap.sh or remote.sh + a final `kz_main` call.
# Secrets therefore exist only in the memory of that one bash process and, for the length of
# one operator command, in /run/krajozbior/ops.env (RAM, mode 600), which kz_ops removes.
#
# Paths can be overridden for tests (tests/scripts/ops-server-lib.test.ts).
# Keep this file ASCII-only: the payload is also read by Windows PowerShell 5.1.

: "${KZ_ROOT:=/srv/krajozbior}"
: "${KZ_RUN:=/run/krajozbior}"
: "${KZ_PROJECT:=krajozbior}"
KZ_SRC="$KZ_ROOT/src"
KZ_ENV="$KZ_ROOT/.env.production"
KZ_OPS_ENV="$KZ_RUN/ops.env"
KZ_STATE="$KZ_ROOT/state"
KZ_GATE_DIR="$KZ_ROOT/caddy-gate"
KZ_BACKUPS="$KZ_ROOT/backups"
KZ_IMPORTS="$KZ_ROOT/imports"
KZ_DB_HOST="db:5432"
KZ_DB_NAME="krajozbior"

# Never on the server (security-notes.md, section 2; D-E11-8).
KZ_DEMO_FLAGS=(ALLOW_DEMO_SEED DEMO_ACCOUNTS_TEST_ONLY EMAIL_OUTBOX_TEST_ONLY)

kz_step() { printf '[krajozbior] %s\n' "$*"; }
kz_fail() {
  printf '[krajozbior] BLAD: %s\n' "$*"
  exit 1
}

# Decodes a base64 value from the preamble (empty stays empty).
kz_b64() {
  if [ -n "${1:-}" ]; then printf '%s' "$1" | base64 -d; fi
}

# Random lowercase hex secret (URL-safe, no quoting problems in env files).
kz_secret() { od -An -N"${1:-24}" -tx1 /dev/urandom | tr -d ' \n'; }

# Value of NAME from an env file (last assignment wins), without evaluating the file.
kz_env_get() {
  local file="$1" name="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}${name}=//p" "$file" | tail -n 1
}

# Prints every demo flag named anywhere in the given files (empty = clean).
kz_find_demo_flags() {
  local flag file
  for flag in "${KZ_DEMO_FLAGS[@]}"; do
    for file in "$@"; do
      if [ -f "$file" ] && grep -q -- "$flag" "$file"; then
        printf '%s\n' "$flag"
        break
      fi
    done
  done
}

# Names of the variables an operator command needs in ops.env (docs/deployment.md,
# "Co ma zawierac plik operatora"; test: tests/lib/config/operator-env.test.ts).
kz_ops_env_vars() {
  case "$1" in
    db:roles) echo "DATABASE_ADMIN_URL KRAJOZBIOR_OWNER_DB_PASSWORD KRAJOZBIOR_APP_DB_PASSWORD KRAJOZBIOR_AUTH_DB_PASSWORD KRAJOZBIOR_OPS_DB_PASSWORD" ;;
    db:migrate) echo "DATABASE_MIGRATION_URL" ;;
    ops:curator) echo "DATABASE_OPS_URL" ;;
    auth:create-admin) echo "DATABASE_OPS_URL DATABASE_AUTH_URL BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_CLIENT_IP_HEADER" ;;
    auth:throttle) echo "DATABASE_AUTH_URL BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_CLIENT_IP_HEADER" ;;
    legal:final) echo "" ;;
    *) return 1 ;;
  esac
}

# Value of one ops.env variable: owner/ops passwords come from the payload (KZ_OWNER_PW,
# KZ_OPS_PW), the superuser URL only during the first deployment (KZ_PG_BOOTSTRAP_PW),
# everything else from .env.production.
kz_ops_env_value() {
  case "$1" in
    KRAJOZBIOR_OWNER_DB_PASSWORD) printf '%s' "${KZ_OWNER_PW:-}" ;;
    KRAJOZBIOR_OPS_DB_PASSWORD) printf '%s' "${KZ_OPS_PW:-}" ;;
    DATABASE_MIGRATION_URL)
      [ -n "${KZ_OWNER_PW:-}" ] && printf 'postgres://krajozbior_owner:%s@%s/%s' "$KZ_OWNER_PW" "$KZ_DB_HOST" "$KZ_DB_NAME" ;;
    DATABASE_OPS_URL)
      [ -n "${KZ_OPS_PW:-}" ] && printf 'postgres://krajozbior_ops:%s@%s/%s' "$KZ_OPS_PW" "$KZ_DB_HOST" "$KZ_DB_NAME" ;;
    DATABASE_ADMIN_URL)
      [ -n "${KZ_PG_BOOTSTRAP_PW:-}" ] && printf 'postgres://postgres:%s@%s/%s' "$KZ_PG_BOOTSTRAP_PW" "$KZ_DB_HOST" "$KZ_DB_NAME" ;;
    *) kz_env_get "$KZ_ENV" "$1" ;;
  esac
  return 0
}

# Writes ops.env with exactly the variables of one command (mode 600, in RAM).
kz_ops_env_write() {
  local command="$1" names name value content=""
  names="$(kz_ops_env_vars "$command")" || kz_fail "nieznane polecenie operatora: $command"
  for name in $names; do
    value="$(kz_ops_env_value "$name")"
    [ -n "$value" ] || kz_fail "brak wartosci $name dla $command"
    content+="$name=$value"$'\n'
  done
  mkdir -p "$KZ_RUN"
  (umask 077 && printf '%s' "$content" >"$KZ_OPS_ENV")
  chmod 600 "$KZ_OPS_ENV"
}

kz_ops_env_clear() { rm -f "$KZ_OPS_ENV"; }

# docker compose of the server project, from the checked-out commit.
kz_compose() {
  docker compose -p "$KZ_PROJECT" -f "$KZ_SRC/deploy/compose.yaml" "$@" </dev/null
}

# One operator command in the `ops` container with its own ops.env, removed right after.
# Extra `-e NAME` options (values taken from this shell) go before `--`.
kz_ops() {
  local command="$1"
  shift
  local -a run_opts=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    run_opts+=("$1")
    shift
  done
  [ "${1:-}" = "--" ] && shift
  kz_ops_env_write "$command"
  local status=0
  KRAJOZBIOR_OPS_ENV_FILE="$KZ_OPS_ENV" kz_compose --profile ops run --rm -T "${run_opts[@]}" \
    ops npm run --silent "$command" -- "$@" || status=$?
  kz_ops_env_clear
  return "$status"
}

# Refuses to continue when a demo flag is named in .env.production or in the merged config.
# The merged configuration (with the values of .env.production) stays in memory, never in /tmp.
kz_assert_no_demo_flags() {
  local found merged flag
  found="$(kz_find_demo_flags "$KZ_ENV")"
  [ -z "$found" ] || kz_fail "zakazana flaga demo w .env.production: $(echo "$found" | tr '\n' ' ')"
  merged="$(kz_compose --profile ops config 2>/dev/null)" || kz_fail "docker compose config nie dziala"
  found=""
  for flag in "${KZ_DEMO_FLAGS[@]}"; do
    case "$merged" in *"$flag"*) found+="$flag " ;; esac
  done
  merged=""
  [ -z "$found" ] || kz_fail "zakazana flaga demo w konfiguracji Compose: $found"
}

# Checks out exactly one commit of the public repository (no credentials needed).
kz_checkout() {
  local commit="$1"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || kz_fail "nieprawidlowy commit"
  if [ ! -d "$KZ_SRC/.git" ]; then
    git clone --quiet "$KZ_REPO_URL" "$KZ_SRC"
  fi
  git -C "$KZ_SRC" fetch --quiet origin main
  git -C "$KZ_SRC" merge-base --is-ancestor "$commit" origin/main ||
    kz_fail "commit nie jest na origin/main"
  git -C "$KZ_SRC" -c advice.detachedHead=false checkout --quiet --force "$commit"
}

kz_tag_of() { printf '%s' "${1:0:12}"; }

kz_state_get() { [ -f "$KZ_STATE/$1" ] && cat "$KZ_STATE/$1" || true; }
kz_state_set() {
  mkdir -p "$KZ_STATE"
  printf '%s\n' "$2" >"$KZ_STATE/$1"
}

# Waits until the application answers through Caddy (TLS on this host). Prints the code.
kz_http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "$KZ_SITE_HOST:443:127.0.0.1" "https://$KZ_SITE_HOST$1" || true
}

kz_wait_http() {
  local path="$1" want="$2" tries="${3:-30}" code=""
  for _ in $(seq 1 "$tries"); do
    code="$(kz_http_code "$path")"
    [ "$code" = "$want" ] && return 0
    sleep 5
  done
  kz_step "adres $path odpowiada kodem ${code:-brak} (oczekiwany $want)"
  return 1
}

# Caddy password gate (spec 5.4a): writes gate.caddy with a bcrypt hash of the password.
kz_gate_write() {
  local password="$1" image hash
  image="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(caddy:[^[:space:]]*\)$/\1/p' "$KZ_SRC/deploy/compose.yaml" | head -n 1)"
  [ -n "$image" ] || kz_fail "brak obrazu Caddy w compose.yaml"
  # The password goes through standard input, never into argv (`ps`, `docker inspect`; review
  # F-K4, S5). Caddy reads one line from a non-terminal stdin and drops the new line (checked
  # with caddy:2: a hash made this way accepts the password in basic_auth).
  hash="$(printf '%s\n' "$password" | docker run --rm -i "$image" caddy hash-password)"
  [[ "$hash" =~ ^\$2[aby]\$ ]] || kz_fail "nie udalo sie przygotowac hasla Caddy"
  mkdir -p "$KZ_GATE_DIR"
  kz_gate_content "$hash" >"$KZ_GATE_DIR/gate.caddy"
}

kz_gate_content() {
  printf '@krajozbior_gate not path /api/health\n'
  printf 'basic_auth @krajozbior_gate {\n'
  printf '\tkrajozbior %s\n' "$1"
  printf '}\n'
}

# Signal to healthchecks.io (E11-Q6 A): kz_ping <URL variable> [fail]. No URL = no signal.
kz_ping() {
  local url
  url="$(kz_env_get "$KZ_ROOT/healthchecks.env" "$1")"
  [ -n "$url" ] || return 0
  [ "${2:-}" = "fail" ] && url="$url/fail"
  curl -fsS -m 10 --retry 3 -o /dev/null "$url" || true
}

# Smallest encrypted dump accepted as a real backup. The schema alone (tables, policies,
# functions) gives a custom-format dump of tens of kilobytes; an age header of a failed dump
# is about 200 bytes.
: "${KZ_MIN_DUMP_BYTES:=2048}"

# Encrypted dump of the database (D-E11-6): pg_dump as the superuser over the local socket in
# the db container, straight into age with a public key. Returns 1 (and leaves no file) when any
# step fails. Every step is checked explicitly: callers use `if kz_backup ...`, and bash switches
# `set -e` off for the whole function in a condition (review F-K4, B4).
kz_dump_encrypted() {
  local recipient_file="$1" target="$2" size
  rm -f "$target.part"
  if ! (set -o pipefail && umask 077 && kz_compose exec -T -u postgres db pg_dump -Fc -d "$KZ_DB_NAME" |
    age -R "$recipient_file" -o "$target.part"); then
    rm -f "$target.part"
    kz_step "zrzut bazy nieudany"
    return 1
  fi
  size="$(wc -c <"$target.part" | tr -dc '0-9')"
  if [ "${size:-0}" -lt "$KZ_MIN_DUMP_BYTES" ]; then
    rm -f "$target.part"
    kz_step "zrzut bazy podejrzanie maly (${size:-0} B); kopii nie zapisano"
    return 1
  fi
  mv "$target.part" "$target" || { rm -f "$target.part"; return 1; }
}

# Real backup: kind = daily | weekly | predeploy. Rotation: 7 daily, 4 weekly, 5 predeploy,
# nothing older than 30 days (privacy policy pt 9). Returns 1 on failure (no exit: backup.sh
# must still send the failure signal); old backups are rotated only after a good one.
kz_backup() {
  local kind="$1" file
  if [ ! -s "$KZ_ROOT/backup.pub" ]; then
    kz_step "brak klucza publicznego kopii"
    return 1
  fi
  mkdir -p "$KZ_BACKUPS" || return 1
  file="$KZ_BACKUPS/krajozbior-$(date -u +%Y%m%d-%H%M%S)-$kind.dump.age"
  kz_dump_encrypted "$KZ_ROOT/backup.pub" "$file" || return 1
  kz_rotate daily 7 || return 1
  kz_rotate weekly 4 || return 1
  kz_rotate predeploy 5 || return 1
  find "$KZ_BACKUPS" -maxdepth 1 -name 'krajozbior-*.dump.age' -mtime +30 -delete || return 1
  kz_step "kopia zapisana: $(basename "$file") ($(du -h "$file" | cut -f1))"
}

# Backups of one kind, newest first. The name carries the UTC time (YYYYMMDD-HHMMSS), so the
# name order is the time order. No files = no output and status 0 (review F-K4, B3: `ls` on a
# missing glob ended the deployment under pipefail).
kz_list_backups() {
  [ -d "$KZ_BACKUPS" ] || return 0
  find "$KZ_BACKUPS" -maxdepth 1 -type f -name "krajozbior-*-${1:-*}.dump.age" 2>/dev/null | sort -r
}

kz_rotate() {
  local kind="$1" keep="$2" old
  kz_list_backups "$kind" | tail -n +"$((keep + 1))" |
    while IFS= read -r old; do rm -f "$old"; done
}

kz_postgres_image() {
  sed -n 's/^[[:space:]]*image:[[:space:]]*\(postgres:[^[:space:]]*\)$/\1/p' "$KZ_SRC/deploy/compose.yaml" | head -n 1
}

# Restores an encrypted dump into a throw-away postgres container without network and prints
# only counts (tables, migrations, rows of the main tables); no personal data.
# Called in `if` conditions (set -e is off there), so every failure returns explicitly.
kz_restore_check() {
  local dump="$1" identity="$2" name="krajozbior-restore-check-$$" image status=0 ready=0
  image="$(kz_postgres_image)"
  if [ -z "$image" ]; then
    kz_step "brak obrazu postgres w compose.yaml"
    return 1
  fi
  if ! docker run -d --rm --name "$name" --network none -e POSTGRES_PASSWORD="$(kz_secret)" \
    "$image" >/dev/null </dev/null; then
    kz_step "nie udalo sie uruchomic kontenera do odtworzenia"
    return 1
  fi
  # Two answers in a row: the image answers once during initdb, right before its own restart.
  for _ in $(seq 1 45); do
    if docker exec "$name" pg_isready -q -U postgres </dev/null 2>/dev/null; then
      ready=$((ready + 1))
      [ "$ready" -ge 2 ] && break
    else
      ready=0
    fi
    sleep 2
  done
  {
    docker exec "$name" psql -q -v ON_ERROR_STOP=1 -U postgres -c \
      "create role krajozbior_owner; create role krajozbior_app; create role krajozbior_auth; create role krajozbior_ops; create database $KZ_DB_NAME owner krajozbior_owner;" &&
      age -d -i "$identity" "$dump" | docker exec -i "$name" pg_restore --exit-on-error -U postgres -d "$KZ_DB_NAME" &&
      docker exec "$name" psql -At -U postgres -d "$KZ_DB_NAME" -c \
        "select 'tabele=' || count(*) from information_schema.tables where table_schema in ('public','auth');
         select 'migracje=' || count(*) from mikro_orm_migrations;
         select 'kolekcje=' || count(*) from collections;
         select 'miejsca=' || count(*) from places;
         select 'konta=' || count(*) from auth.users;"
  } </dev/null || status=$?
  docker rm -f "$name" >/dev/null 2>&1 || true
  return "$status"
}

kz_write_healthchecks_env() {
  local content=""
  [ -n "${KZ_HC_BACKUP:-}" ] && content+="HC_BACKUP_URL=$KZ_HC_BACKUP"$'\n'
  [ -n "${KZ_HC_RESTORE:-}" ] && content+="HC_RESTORE_URL=$KZ_HC_RESTORE"$'\n'
  [ -n "${KZ_HC_HEALTH:-}" ] && content+="HC_HEALTH_URL=$KZ_HC_HEALTH"$'\n'
  [ -n "$content" ] || return 0
  (umask 077 && printf '%s' "$content" >"$KZ_ROOT/healthchecks.env")
}
