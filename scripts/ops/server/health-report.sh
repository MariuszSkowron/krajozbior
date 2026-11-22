#!/usr/bin/env bash
# Hourly resource check (E11 spec 5.7, D-E11-9): systemd timer krajozbior-health (as deploy).
# Alarm (healthchecks.io "fail" on HC_HEALTH_URL, i.e. an e-mail to the owner) when: free disk
# below 20%, available memory below 10%, a service is not running, the TLS certificate expires
# in less than 14 days, or Brevo refused at least one e-mail in the last hour
# (`email.brevo_rejected`), the daily pool of sign-in codes reached 80% or 100%
# (`auth.otp_global_limit_*`), or the newest backup is older than 26 hours. Prints only counts and
# names. Keep this file ASCII-only.
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

# No media archive from the last 26 hours, but only a day after the first deployment or backup
# that saw the photo volume (marker state/media-volume-since, written by kz_media_mark).
if [ -n "$(find "$KZ_STATE/media-volume-since" -mmin +1440 2>/dev/null)" ] &&
  [ -z "$(find "$KZ_BACKUPS" -maxdepth 1 -name 'krajozbior-media-*.tar.age' -mmin -1560 2>/dev/null)" ]; then
  problems+=("brak archiwum zdjec z ostatnich 26 godzin")
fi

# Docker volumes live in the Docker directory; a second df covers a separate file system.
: "${KZ_DOCKER_DIR:=/var/lib/docker}"
if [ -d "$KZ_DOCKER_DIR" ] && [ "$(stat -c %d "$KZ_DOCKER_DIR" 2>/dev/null)" != "$(stat -c %d "$KZ_ROOT" 2>/dev/null)" ]; then
  used_docker="$(df --output=pcent "$KZ_DOCKER_DIR" | tail -n 1 | tr -dc '0-9')"
  [ "${used_docker:-100}" -le 80 ] || problems+=("dysk katalogu Dockera zajety w ${used_docker}%")
fi

rejected="$(journalctl CONTAINER_NAME="$KZ_PROJECT-app-1" --since '-1h' -o cat --no-pager 2>/dev/null |
  grep -c 'email.brevo_rejected' || true)"
[ "${rejected:-0}" -eq 0 ] || problems+=("Brevo odmowilo $rejected razy w ostatniej godzinie")

# The daily pool of sign-in codes reached 80% or 100% (`auth.otp_global_limit_80` and `_100`, logged
# once each per day by the application). At 100% nobody new can sign in until midnight UTC, so the
# owner learns about it from the e-mail; the check runs hourly, so an alarm logged earlier in the
# same day shows up for one hour only. The window is 65 minutes, so a timer that fires a little
# late cannot leave a gap in which the one-off alarm would be missed (a double e-mail is harmless).
otp_alarms="$(journalctl CONTAINER_NAME="$KZ_PROJECT-app-1" --since '-65min' -o cat --no-pager 2>/dev/null |
  grep -c 'auth\.otp_global_limit_' || true)"
[ "${otp_alarms:-0}" -eq 0 ] || problems+=("pula dziennych kodow logowania wyczerpana w co najmniej 80% (alarm $otp_alarms razy w ostatniej godzinie)")

if [ "${#problems[@]}" -eq 0 ]; then
  kz_step "zasoby w porzadku (dysk ${used}%, pamiec wolna ${mem}%)"
  kz_ping HC_HEALTH_URL
else
  kz_step "ALARM: ${problems[*]}"
  kz_ping HC_HEALTH_URL fail
  exit 1
fi
