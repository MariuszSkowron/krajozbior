#!/usr/bin/env bash
# Nightly backup (E11 spec 5.7, D-E11-6): systemd timer krajozbior-backup (3:15, as deploy).
# pg_dump over the local socket in the db container, encrypted with the owner's public age key
# (the private key never touches the server), rotation 7 daily / 4 weekly, nothing older than
# 30 days, signal to healthchecks.io (HC_BACKUP_URL in /srv/krajozbior/healthchecks.env).
# Keep this file ASCII-only.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

kind=daily
[ "$(date -u +%u)" = "7" ] && kind=weekly

if kz_backup "$kind"; then
  kz_ping HC_BACKUP_URL
else
  kz_ping HC_BACKUP_URL fail
  exit 1
fi
