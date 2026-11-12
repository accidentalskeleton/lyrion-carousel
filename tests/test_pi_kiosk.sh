#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
for file in "$root"/deploy/raspberry-pi/*.sh "$root"/deploy/raspberry-pi/carousel-kiosk; do
  bash -n "$file"
done
grep -q 'BEGIN LYRION CAROUSEL KIOSK' "$root/deploy/raspberry-pi/install-kiosk.sh"
grep -q 'BEGIN LYRION CAROUSEL KIOSK' "$root/deploy/raspberry-pi/uninstall-kiosk.sh"
grep -q 'HEALTH_FAILURES' "$root/deploy/raspberry-pi/carousel-kiosk"
grep -q 'browser_pid' "$root/deploy/raspberry-pi/carousel-kiosk"
echo 'Raspberry Pi kiosk script checks passed'
