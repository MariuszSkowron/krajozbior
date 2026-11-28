#!/usr/bin/env bash
# Daily removal of accounts that never accepted the terms and are older than 7 days
# (privacy policy 1.1, section 9): systemd timer krajozbior-cleanup-abandoned (4:30, as deploy).
# Independent of site traffic. Prints only the number of removed accounts.
# Keep this file ASCII-only.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

kz_ops auth:cleanup-abandoned
