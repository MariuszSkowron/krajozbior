# shellcheck shell=bash
# Target "showcase" of the deployment: the rehearsal of `-Initial`, `-Commit` and `-Aktualnosci`
# (E7-R2b) on the local
# showcase (spec 5.4 "Kto co robi", D-E11-7, D-E11-8). The ONLY place where the rehearsal differs
# from the server. deploy-showcase.ps1 sends lib.sh + preamble + remote.sh + this file to a local
# Git Bash (never to the server), so the steps of remote.sh (backup, build with the commit label,
# migrations, swap of `app`, health and home page check, return to the previous image) run
# unchanged and only the functions below are replaced:
#   - Compose: server file + showcase overlay of the deployed commit + target overlay of the
#     running script (names, port, images with the commit label, data folder), secrets of the
#     showcase from its own secrets.env; no Caddy, no Brevo (D-E11-8);
#   - code: a local clone of this repository; any local commit (also an unpushed one);
#   - checks: plain HTTP on 127.0.0.1:<port>, home page 200 (no password gate without Caddy);
#   - backup: pg_dump without encryption (local demo data; age is not installed locally);
#   - demo flags: must be absent from deploy/compose.yaml alone (they live in the overlay);
#   - an existing showcase database volume is reused, never removed.
# Configuration comes from the environment of the local process (deploy-showcase.ps1):
# KZ_TARGET, KZ_ROOT, KZ_RUN, KZ_PROJECT, KZ_SHOWCASE_DATA, KZ_SHOWCASE_PORT,
# KZ_SHOWCASE_OVERLAY, KZ_PGDATA_VOLUME, KZ_IMAGE_REPOS, KZ_DUMP_SUFFIX.
# Keep this file ASCII-only.

# Refuses anything that looks like the server: wrong target, server project or server folder.
kz_require_showcase() {
  [ "${KZ_TARGET:-}" = "showcase" ] || kz_fail "showcase.sh tylko z celem showcase"
  case "$KZ_PROJECT" in
    krajozbior-*) ;;
    *) kz_fail "projekt Compose pokazu musi zaczynac sie od krajozbior- (nie projekt serwera)" ;;
  esac
  case "$KZ_ROOT" in
    /srv/*) kz_fail "folder serwera w trybie pokazu" ;;
  esac
  [[ "${KZ_SHOWCASE_PORT:-}" =~ ^[0-9]+$ ]] || kz_fail "brak portu pokazu"
}

kz_require_deploy() {
  kz_require_showcase
  [ -f "$KZ_SHOWCASE_DATA/secrets.env" ] && [ -f "$KZ_SHOWCASE_DATA/pg-bootstrap" ] ||
    kz_fail "brak hasel pokazu w $KZ_SHOWCASE_DATA (tworzy je deploy-showcase.ps1)"
  [ -f "$KZ_SHOWCASE_OVERLAY" ] || kz_fail "brak nakladki celu $KZ_SHOWCASE_OVERLAY"
  mkdir -p "$KZ_ROOT" "$KZ_RUN"
  # kz_backup needs a recipient file; the showcase backup is not encrypted (kz_dump_encrypted).
  [ -s "$KZ_ROOT/backup.pub" ] || printf 'pokaz: kopie lokalne bez szyfrowania\n' >"$KZ_ROOT/backup.pub"
}

kz_compose() {
  docker compose -p "$KZ_PROJECT" -f "$KZ_SRC/deploy/compose.yaml" \
    -f "$KZ_SRC/deploy/compose.showcase.yaml" -f "$KZ_SHOWCASE_OVERLAY" \
    --env-file "$KZ_SHOWCASE_DATA/secrets.env" "$@" </dev/null
}

# The overlay of the showcase gives `ops` all its variables (secrets.env); no ops.env file.
kz_ops() {
  local command="$1"
  shift
  local -a run_opts=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    run_opts+=("$1")
    shift
  done
  [ "${1:-}" = "--" ] && shift
  # `-v C:/folder:/imports:ro` (mode aktualnosci) would be rewritten by Git Bash as a list of
  # paths; Docker Desktop wants the text untouched.
  MSYS2_ARG_CONV_EXCL='*' kz_compose --profile ops run --rm -T "${run_opts[@]}" ops npm run --silent "$command" -- "$@"
}

# Mode aktualnosci (E7-R2b): the `ops` container of the showcase runs with NODE_ENV=development on
# the local database (compose.showcase.yaml), so news:import needs neither the server mode nor the
# confirmed host (they exist only for the production container) and the showcase has no
# KZ_SITE_HOST. Prints nothing.
kz_news_target_args() { return 0; }

kz_require_ops_env_file() { return 0; }

kz_require_gate() { kz_step "bez Caddy (D-E11-8): bramka hasla i Caddyfile nie dotycza pokazu"; }

# Security rule of D-E11-8 kept in the rehearsal: the demo flags must not be known to the server
# file alone; they may come only from the showcase overlay.
kz_assert_no_demo_flags() {
  local merged flag found=""
  merged="$(docker compose -p "$KZ_PROJECT" -f "$KZ_SRC/deploy/compose.yaml" --profile ops config 2>/dev/null </dev/null)" ||
    kz_fail "docker compose config nie dziala"
  for flag in "${KZ_DEMO_FLAGS[@]}"; do
    case "$merged" in *"$flag"*) found+="$flag " ;; esac
  done
  merged=""
  [ -z "$found" ] || kz_fail "flaga demo w deploy/compose.yaml (plik serwera): $found"
  kz_step "flagi demo tylko w nakladce pokazu (deploy/compose.yaml ich nie zna)"
}

# Local clone of this repository; any commit present locally (the rehearsal also deploys an
# unpushed commit with a broken health check). Never the network.
kz_checkout() {
  local commit="$1"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || kz_fail "nieprawidlowy commit"
  if [ ! -d "$KZ_SRC/.git" ]; then
    git clone --quiet --no-checkout "$KZ_REPO_URL" "$KZ_SRC"
  fi
  git -C "$KZ_SRC" fetch --quiet origin
  git -C "$KZ_SRC" cat-file -e "$commit^{commit}" 2>/dev/null ||
    kz_fail "commit nie istnieje w lokalnym repozytorium"
  git -C "$KZ_SRC" -c advice.detachedHead=false checkout --quiet --force "$commit"
}

kz_http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$KZ_SHOWCASE_PORT$1" || true
}

# Health 200 and the home page 200: without Caddy there is no password gate.
kz_site_ok() {
  kz_wait_http /api/health 200 "${1:-24}" || return 1
  local code
  code="$(kz_http_code /)"
  [ "$code" = "200" ] && { kz_step "strona glowna: 200 (pokaz bez bramki)"; return 0; }
  kz_step "strona glowna odpowiada kodem ${code:-brak}"
  return 1
}

kz_up_app_proxy() { kz_compose up -d --wait app; }

# The showcase keeps its superuser password (secrets.env, D-E11-8), so an existing volume is
# reused and never removed; a new one starts with the persistent password file.
kz_initial_database() {
  if docker volume inspect "$KZ_PGDATA_VOLUME" >/dev/null 2>&1 </dev/null; then
    kz_step "wolumen $KZ_PGDATA_VOLUME istnieje: zostaje (haslo superuzytkownika w secrets.env)"
  else
    kz_step "nowy wolumen bazy pokazu $KZ_PGDATA_VOLUME"
  fi
  kz_compose up -d --wait db
  kz_step "role bazy (db:roles)"
  kz_ops db:roles
}

kz_check_secrets_absent() {
  kz_step "K-7 nie dotyczy pokazu (superuzytkownik zachowuje haslo z secrets.env, D-E11-8)"
}

# Plain custom-format dump with the same size check as on the server.
kz_dump_encrypted() {
  local target="$2" size
  rm -f "$target.part"
  if ! (set -o pipefail && kz_compose exec -T -u postgres db pg_dump -Fc -d "$KZ_DB_NAME" >"$target.part"); then
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
