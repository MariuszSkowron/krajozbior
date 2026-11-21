#!/usr/bin/env bash
# Hourly resource check (E11 spec 5.7, D-E11-9): systemd timer krajozbior-health (as deploy).
# Alarm (healthchecks.io "fail" on HC_HEALTH_URL, i.e. an e-mail to the owner) when: free disk
# below 20%, available memory below 10%, a service is not running, the TLS certificate expires
# in less than 14 days, or Brevo refused at least one e-mail in the last hour
# (`email.brevo_rejected`). Prints only counts and names. Keep this file ASCII-only.
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

rejected="$(journalctl CONTAINER_NAME="$KZ_PROJECT-app-1" --since '-1h' -o cat --no-pager 2>/dev/null |
  grep -c 'email.brevo_rejected' || true)"
[ "${rejected:-0}" -eq 0 ] || problems+=("Brevo odmowilo $rejected razy w ostatniej godzinie")

if [ "${#problems[@]}" -eq 0 ]; then
  kz_step "zasoby w porzadku (dysk ${used}%, pamiec wolna ${mem}%)"
  kz_ping HC_HEALTH_URL
else
  kz_step "ALARM: ${problems[*]}"
  kz_ping HC_HEALTH_URL fail
  exit 1
fi
