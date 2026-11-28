#!/usr/bin/env bash
# Hourly resource check (E11 spec 5.7, D-E11-9): systemd timer krajozbior-health (as deploy).
# Alarm (healthchecks.io "fail" on HC_HEALTH_URL, i.e. an e-mail to the owner) when: free disk
# below 20%, available memory below 10%, a service is not running, the TLS certificate expires
# in less than 14 days, or Brevo refused at least one e-mail in the last hour
# (`email.brevo_rejected`), the daily pool of sign-in codes reached 80% or 100%
# (`auth.otp_global_limit_*`, `auth.otp_accounts_limit_*`, `auth.otp_new_account_limit_*`) or codes
# were skipped because a pool was full (`auth.otp_send_skipped`), or the newest backup is older
# than 26 hours. Prints only counts and names. Keep this file ASCII-only.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

problems=()

used="$(df --output=pcent "$KZ_ROOT" | tail -n 1 | tr -dc '0-9')"
[ "${used:-100}" -le 80 ] || problems+=("dysk zajety w ${used}%")

mem="$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {print int(a * 100 / t)}' /proc/meminfo)"
[ "${mem:-0}" -ge 10 ] || problems+=("wolna pamiec ${mem}%")

for service in db app proxy; do
  state="$(docker inspect -f '{{.State.Running}}' "$KZ_PROJECT-$service-1" 2>/dev/null || echo false)"
  [ "$state" = "true" ] || problems+=("usluga $service nie dziala")
done

site_host="$(kz_env_get "$KZ_ENV" BETTER_AUTH_URL | sed -E 's#^https://##; s#/.*$##')"
if [ -n "$site_host" ]; then
  end="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$site_host" 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  if [ -z "$end" ]; then
    problems+=("brak certyfikatu TLS")
  else
    days=$((($(date -d "$end" +%s) - $(date +%s)) / 86400))
    [ "$days" -ge 14 ] || problems+=("certyfikat wygasa za $days dni")
  fi
fi

# No backup from the last 26 hours, once the first night after the first deployment has passed.
if [ -n "$(find "$KZ_STATE/initialized" -mmin +1560 2>/dev/null)" ] &&
  [ -z "$(find "$KZ_BACKUPS" -maxdepth 1 -name 'krajozbior-*.dump.age' -mmin -1560 2>/dev/null)" ]; then
  problems+=("brak kopii z ostatnich 26 godzin")
fi

rejected="$(journalctl CONTAINER_NAME="$KZ_PROJECT-app-1" --since '-1h' -o cat --no-pager 2>/dev/null |
  grep -c 'email.brevo_rejected' || true)"
[ "${rejected:-0}" -eq 0 ] || problems+=("Brevo odmowilo $rejected razy w ostatniej godzinie")

# The daily pool of sign-in codes reached 80% or 100% (`auth.otp_global_limit_80` and `_100`, logged
# once each per day by the application). At 100% nobody new can sign in until midnight UTC, so the
# owner learns about it from the e-mail; the check runs hourly, so an alarm logged earlier in the
# same day shows up for one hour only. The window is 65 minutes, so a timer that fires a little
# late cannot leave a gap in which the one-off alarm would be missed (a double e-mail is harmless).
# The same for the two separate pools (`auth.otp_accounts_limit_*` for existing accounts and
# `auth.otp_new_account_limit_*` for new addresses), each on its own line, and the number of codes
# skipped silently because a pool or the per-IP limit of new addresses was full
# (`auth.otp_send_skipped` with pool accounts, new or new_ip; pool sent, the per-mailbox limit,
# is not counted).
otp_log="$(journalctl CONTAINER_NAME="$KZ_PROJECT-app-1" --since '-65min' -o cat --no-pager 2>/dev/null || true)"
otp_count() { printf '%s\n' "$otp_log" | grep -cE "$1" || true; }
otp_alarms="$(otp_count 'auth\.otp_global_limit_')"
[ "${otp_alarms:-0}" -eq 0 ] || problems+=("pula dziennych kodow logowania wyczerpana w co najmniej 80% (alarm $otp_alarms razy w ostatniej godzinie)")
otp_accounts_alarms="$(otp_count 'auth\.otp_accounts_limit_')"
[ "${otp_accounts_alarms:-0}" -eq 0 ] || problems+=("pula kodow dla kont wyczerpana w co najmniej 80% (alarm $otp_accounts_alarms razy w ostatniej godzinie)")
otp_new_alarms="$(otp_count 'auth\.otp_new_account_limit_')"
[ "${otp_new_alarms:-0}" -eq 0 ] || problems+=("pula kodow dla nowych adresow wyczerpana w co najmniej 80% (alarm $otp_new_alarms razy w ostatniej godzinie)")
otp_skipped="$(otp_count '"event":"auth\.otp_send_skipped","pool":"(accounts|new|new_ip)"')"
[ "${otp_skipped:-0}" -eq 0 ] || problems+=("pominieto wysylke kodu logowania $otp_skipped razy w ostatniej godzinie (pelna pula albo limit nowych adresow z jednego IP)")

if [ "${#problems[@]}" -eq 0 ]; then
  kz_step "zasoby w porzadku (dysk ${used}%, pamiec wolna ${mem}%)"
  kz_ping HC_HEALTH_URL
else
  kz_step "ALARM: ${problems[*]}"
  kz_ping HC_HEALTH_URL fail
  exit 1
fi
