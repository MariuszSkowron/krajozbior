#!/usr/bin/env bash
# Weekly restore test (E11 spec 5.7): systemd timer krajozbior-restore-test (Sunday 4:00).
# The owner's private key is not on the server, so the test makes a fresh dump encrypted with
# the separate TEST key pair (/srv/krajozbior/restore-test.key, D-E11-6), restores it at once into
# a throw-away postgres container without network, prints only counts and deletes the dump.
# Signal: HC_RESTORE_URL. Keep this file ASCII-only.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

key="$KZ_ROOT/restore-test.key"
recipient="$KZ_RUN/restore-test.pub"
dump="$KZ_RUN/restore-test.dump.age"
trap 'rm -f "$dump" "$dump.part" "$recipient"' EXIT

if age-keygen -y "$key" >"$recipient" &&
  kz_dump_encrypted "$recipient" "$dump" &&
  kz_restore_check "$dump" "$key"; then
  kz_step "test odtworzenia: udany"
  kz_ping HC_RESTORE_URL
else
  kz_step "test odtworzenia: nieudany"
  kz_ping HC_RESTORE_URL fail
  exit 1
fi
