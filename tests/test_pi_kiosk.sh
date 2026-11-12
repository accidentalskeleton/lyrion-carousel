#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
for file in "$root"/deploy/raspberry-pi/*.sh "$root"/deploy/raspberry-pi/carousel-kiosk; do
  bash -n "$file"
done

# CLI help must be usable without root and without modifying the host.
bash "$root/deploy/raspberry-pi/install-kiosk.sh" --help | grep -q -- '--server'
bash "$root/deploy/raspberry-pi/uninstall-kiosk.sh" --help | grep -q -- '--user'
bash "$root/deploy/raspberry-pi/configure-dedicated-user.sh" --help | grep -q -- '--desktop-autologin'

# Guard installer/uninstaller contracts and the recovery loop.
grep -q 'BEGIN LYRION CAROUSEL KIOSK' "$root/deploy/raspberry-pi/install-kiosk.sh"
grep -q 'BEGIN LYRION CAROUSEL KIOSK' "$root/deploy/raspberry-pi/uninstall-kiosk.sh"
grep -q 'Preserving existing configuration' "$root/deploy/raspberry-pi/install-kiosk.sh"
grep -Fq '"$HOME_DIR/.local/state/lyrion-carousel-kiosk"' "$root/deploy/raspberry-pi/install-kiosk.sh"
grep -Fq '"$HOME_DIR/.local"' "$root/deploy/raspberry-pi/install-kiosk.sh"
grep -q 'Existing unmanaged' "$root/deploy/raspberry-pi/install-kiosk.sh"
grep -q 'HEALTH_FAILURES' "$root/deploy/raspberry-pi/carousel-kiosk"
grep -q 'browser_pid' "$root/deploy/raspberry-pi/carousel-kiosk"
grep -q 'until healthy' "$root/deploy/raspberry-pi/carousel-kiosk"
grep -Fq 'flock -n 9' "$root/deploy/raspberry-pi/carousel-kiosk"
grep -Fq 'SUDO_USER="$USER_NAME" raspi-config' "$root/deploy/raspberry-pi/configure-dedicated-user.sh"
grep -Fq 'LightDM autologin was not configured' "$root/deploy/raspberry-pi/configure-dedicated-user.sh"

echo 'Raspberry Pi kiosk script checks passed'
