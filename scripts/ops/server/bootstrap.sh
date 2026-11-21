# shellcheck shell=bash
# First preparation of the server (E11 spec 5.4, D-E11-4, D-E11-5, D-E11-10, E11-Q8 A).
# Sent by `wdroz.ps1 -Bootstrap` after lib.sh; runs as root on a fresh Ubuntu 24.04 (netcup
# installs the owner's key for root). Order matters: the `deploy` account gets the same key
# and is checked BEFORE root login is switched off, so a mistake cannot lock the owner out
# (the VNC console with the root password stays as the emergency path).
#
# Input (preamble): KZ_COMMIT, KZ_REPO_URL, KZ_SITE_HOST, KZ_EMAIL_FROM, KZ_BACKUP_PUBKEY,
# KZ_BREVO_KEY, KZ_GATE_PW, optional KZ_HC_*. Values are never printed.
# Keep this file ASCII-only.

kz_bootstrap_packages() {
  kz_step "aktualizacja systemu i pakiety"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade
  apt-get -y -qq install ca-certificates curl git gnupg openssl age ufw fail2ban \
    unattended-upgrades apt-listchanges iproute2

  if ! command -v docker >/dev/null 2>&1; then
    kz_step "Docker z oficjalnego repozytorium"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # shellcheck disable=SC1091
    . /etc/os-release
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get -y -qq install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker >/dev/null
}

kz_bootstrap_deploy_user() {
  kz_step "konto deploy z kluczem wlasciciela"
  id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
  usermod -aG docker,systemd-journal deploy
  [ -s /root/.ssh/authorized_keys ] || kz_fail "root nie ma klucza w authorized_keys"
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  [ -s /home/deploy/.ssh/authorized_keys ] || kz_fail "klucz deploy nie zostal zapisany"
}

kz_bootstrap_sshd() {
  kz_step "SSH: tylko klucz, bez roota, tylko deploy"
  # 00- sorts first: sshd keeps the first value it reads (cloud images add 50-cloud-init.conf).
  cat >/etc/ssh/sshd_config.d/00-krajozbior.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
EOF
  sshd -t || {
    rm -f /etc/ssh/sshd_config.d/00-krajozbior.conf
    kz_fail "konfiguracja SSH odrzucona przez sshd -t (cofnieta)"
  }
  systemctl restart ssh
}

# Port of this connection (serwer.conf `Port`, sent as KZ_SSH_PORT). The firewall must open the
# port sshd really listens on, or the owner is locked out after `ufw enable` (review F-K4, S6).
kz_ssh_port() { printf '%s' "${KZ_SSH_PORT:-22}"; }

kz_bootstrap_check_ssh_port() {
  local port ports
  port="$(kz_ssh_port)"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || kz_fail "nieprawidlowy port SSH"
  ports="$(sshd -T 2>/dev/null </dev/null | awk '$1 == "port" {print $2}' || true)"
  case $'\n'"$ports"$'\n' in
    *$'\n'"$port"$'\n'*) ;;
    *) kz_fail "sshd nie slucha na porcie $port z serwer.conf; nic nie zmieniono" ;;
  esac
}

kz_bootstrap_firewall() {
  kz_step "zapora ufw i fail2ban"
  sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw limit "$(kz_ssh_port)/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  cat >/etc/fail2ban/jail.d/krajozbior.conf <<EOF
[sshd]
enabled = true
port = $(kz_ssh_port)
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl enable --now fail2ban >/dev/null
  systemctl restart fail2ban
}

kz_bootstrap_updates() {
  kz_step "automatyczne poprawki bezpieczenstwa, restart 4:30 (E11-Q8 A)"
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  cat >/etc/apt/apt.conf.d/52krajozbior <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
  # Freeze 26.11 evening - 30.11: patches keep installing, restarts are switched off. It starts
  # before the morning upgrade run of 27.11, and `shutdown -c` cancels a reboot that an earlier
  # upgrade already scheduled for 4:30 (review F-K4, S1). Timer times use the server's time
  # zone (Ubuntu images default to UTC: 20:00 UTC = 21:00 in Poland in November).
  cat >/etc/systemd/system/krajozbior-freeze-on.service <<'EOF'
[Unit]
Description=Krajozbior: no automatic reboot during the contest freeze
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'printf "Unattended-Upgrade::Automatic-Reboot \"false\";\n" > /etc/apt/apt.conf.d/53krajozbior-freeze'
ExecStart=-/sbin/shutdown -c
EOF
  cat >/etc/systemd/system/krajozbior-freeze-on.timer <<'EOF'
[Timer]
OnCalendar=2026-11-26 20:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  cat >/etc/systemd/system/krajozbior-freeze-off.service <<'EOF'
[Unit]
Description=Krajozbior: automatic reboot allowed again after the contest
[Service]
Type=oneshot
ExecStart=/bin/rm -f /etc/apt/apt.conf.d/53krajozbior-freeze
EOF
  cat >/etc/systemd/system/krajozbior-freeze-off.timer <<'EOF'
[Timer]
OnCalendar=2026-12-01 00:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
}

kz_bootstrap_journald() {
  kz_step "journald: 14 dni, najwyzej 1 GB (D-E11-5)"
  mkdir -p /etc/systemd/journald.conf.d
  cat >/etc/systemd/journald.conf.d/krajozbior.conf <<'EOF'
[Journal]
Storage=persistent
MaxRetentionSec=14day
SystemMaxUse=1G
EOF
  systemctl restart systemd-journald
}

kz_bootstrap_dirs() {
  kz_step "katalogi /srv/krajozbior i /run/krajozbior"
  install -d -m 700 -o deploy -g deploy "$KZ_ROOT" "$KZ_STATE" "$KZ_GATE_DIR" "$KZ_BACKUPS" "$KZ_IMPORTS"
  printf 'd %s 0700 deploy deploy -\n' "$KZ_RUN" >/etc/tmpfiles.d/krajozbior.conf
  systemd-tmpfiles --create /etc/tmpfiles.d/krajozbior.conf
}

# .env.production: generated once, never printed, never overwritten (D-E11-4). Owned by deploy,
# because the `docker compose` client that reads env_file runs as deploy (D-43 pt 4).
kz_bootstrap_env() {
  if [ -f "$KZ_ENV" ]; then
    kz_step ".env.production juz istnieje (bez zmian)"
  else
    [ -n "${KZ_BREVO_KEY:-}" ] || kz_fail "brak klucza Brevo"
    kz_step "generuje .env.production (wartosci nie sa wypisywane)"
    local app auth
    app="$(kz_secret)"
    auth="$(kz_secret)"
    (
      umask 077
      {
        printf 'KRAJOZBIOR_APP_DB_PASSWORD=%s\n' "$app"
        printf 'KRAJOZBIOR_AUTH_DB_PASSWORD=%s\n' "$auth"
        printf 'DATABASE_URL=postgres://krajozbior_app:%s@%s/%s\n' "$app" "$KZ_DB_HOST" "$KZ_DB_NAME"
        printf 'DATABASE_AUTH_URL=postgres://krajozbior_auth:%s@%s/%s\n' "$auth" "$KZ_DB_HOST" "$KZ_DB_NAME"
        printf 'BETTER_AUTH_SECRET=%s\n' "$(kz_secret 32)"
        printf 'BETTER_AUTH_URL=https://%s\n' "$KZ_SITE_HOST"
        printf 'AUTH_CLIENT_IP_HEADER=x-real-ip\n'
        printf 'EMAIL_TRANSPORT=brevo\n'
        printf 'EMAIL_FROM=%s\n' "$KZ_EMAIL_FROM"
        printf 'BREVO_API_KEY=%s\n' "$KZ_BREVO_KEY"
      } >"$KZ_ENV.part"
    )
    # Renamed only when complete: an interrupted write must not leave a half file that the
    # next attempt would keep as "already there".
    mv "$KZ_ENV.part" "$KZ_ENV"
    kz_step "Zapisano klucz Brevo"
  fi
  chown deploy:deploy "$KZ_ENV"
  chmod 600 "$KZ_ENV"
}

kz_bootstrap_backup_key() {
  [[ "${KZ_BACKUP_PUBKEY:-}" =~ ^age1[0-9a-z]{58}$ ]] || kz_fail "nieprawidlowy klucz publiczny kopii (age1...)"
  printf '%s\n' "$KZ_BACKUP_PUBKEY" >"$KZ_ROOT/backup.pub"
  if [ ! -f "$KZ_ROOT/restore-test.key" ]; then
    # Test pair: encrypts only the weekly test dumps, never the real backups (D-E11-6).
    (umask 077 && age-keygen -o "$KZ_ROOT/restore-test.key" 2>/dev/null)
  fi
  chown deploy:deploy "$KZ_ROOT/backup.pub" "$KZ_ROOT/restore-test.key"
}

kz_bootstrap_timers() {
  kz_step "timery: kopia 3:15, test odtworzenia w niedziele 4:00, kontrola co godzine"
  local name script when
  for entry in "backup|backup.sh|*-*-* 03:15:00" "restore-test|restore-test.sh|Sun *-*-* 04:00:00" \
    "health|health-report.sh|hourly"; do
    IFS='|' read -r name script when <<<"$entry"
    cat >"/etc/systemd/system/krajozbior-$name.service" <<EOF
[Unit]
Description=Krajozbior $name
[Service]
Type=oneshot
User=deploy
ExecStart=/bin/bash $KZ_SRC/scripts/ops/server/$script
EOF
    cat >"/etc/systemd/system/krajozbior-$name.timer" <<EOF
[Timer]
OnCalendar=$when
Persistent=true
[Install]
WantedBy=timers.target
EOF
  done
  systemctl daemon-reload
  systemctl enable --now krajozbior-backup.timer krajozbior-restore-test.timer krajozbior-health.timer \
    krajozbior-freeze-on.timer krajozbior-freeze-off.timer >/dev/null
}

# Ports of public TCP listeners other than 22, 80 and 443, read from `ss -H -ltn` on stdin.
# Columns: State Recv-Q Send-Q Local-Address:Port Peer-Address:Port, so the listening address
# is column 4 (column 5 is the peer, `0.0.0.0:*`; review F-K4, B2).
# The SSH port from serwer.conf counts as 22.
kz_public_ports() {
  awk '{print $4}' | grep -v -E '^(127\.[0-9.]+|\[::1\]|127\.0\.0\.53%lo|127\.0\.0\.54):' |
    sed -E 's/.*:([0-9]+)$/\1/' | sort -u | grep -v -x -E "22|80|443|$(kz_ssh_port)" || true
}

# Public TCP listeners must be SSH, 80 and 443 only (D-E11-10, K-17).
kz_listeners_ok() {
  local bad
  bad="$(ss -H -ltn | kz_public_ports)"
  if [ -n "$bad" ]; then
    kz_step "nasluch publiczny na innych portach: $(echo "$bad" | tr '\n' ' ')"
    return 1
  fi
  kz_step "nasluch publiczny tylko 22/80/443"
}

kz_main() {
  [ "$(id -u)" = "0" ] || kz_fail "przygotowanie serwera wymaga konta root (pierwsze polaczenie)"
  kz_bootstrap_check_ssh_port
  kz_bootstrap_packages
  kz_bootstrap_deploy_user
  kz_bootstrap_journald
  kz_bootstrap_dirs
  kz_bootstrap_env
  kz_bootstrap_backup_key
  kz_step "kod aplikacji z commita $(kz_tag_of "$KZ_COMMIT")"
  su deploy -s /bin/bash -c "$(declare -f kz_checkout kz_fail kz_step); KZ_SRC='$KZ_SRC' KZ_REPO_URL='$KZ_REPO_URL' kz_checkout '$KZ_COMMIT'"
  kz_bootstrap_updates
  kz_bootstrap_timers
  [ -f "$KZ_GATE_DIR/gate.caddy" ] || {
    [ -n "${KZ_GATE_PW:-}" ] || kz_fail "brak hasla bramki Caddy"
    kz_gate_write "$KZ_GATE_PW"
    chown -R deploy:deploy "$KZ_GATE_DIR"
    kz_step "bramka hasla Caddy wlaczona"
  }
  kz_write_healthchecks_env
  [ -f "$KZ_ROOT/healthchecks.env" ] && chown deploy:deploy "$KZ_ROOT/healthchecks.env"
  # K-17 before root login goes away, as a warning only: ufw blocks other ports anyway, and a
  # failure here must not leave a server that cannot be bootstrapped again (review F-K4, B2).
  kz_listeners_ok || kz_step "UWAGA: nieoczekiwany nasluch publiczny (zapora ufw go blokuje); agent sprawdzi raport"
  kz_bootstrap_firewall
  kz_bootstrap_sshd
  kz_state_set bootstrap "$KZ_COMMIT"
  chown -R deploy:deploy "$KZ_STATE"
  kz_step "GOTOWE: serwer przygotowany. Kolejne polaczenia jako deploy."
}
