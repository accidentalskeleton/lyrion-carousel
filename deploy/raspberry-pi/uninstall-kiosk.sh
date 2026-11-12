#!/usr/bin/env bash
set -euo pipefail
USER_NAME=""
while (($#)); do
  case "$1" in
    --user) USER_NAME="${2:?missing username}"; shift 2;;
    -h|--help) echo "Usage: sudo bash deploy/raspberry-pi/uninstall-kiosk.sh --user USER"; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
[[ $EUID -eq 0 && -n "$USER_NAME" ]] || { echo "Run with sudo and --user USER" >&2; exit 1; }
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
[[ -d "$HOME_DIR" && "$HOME_DIR" != / ]] || exit 1
AUTOSTART="$HOME_DIR/.config/labwc/autostart"
BIN="$HOME_DIR/.local/bin/carousel-kiosk"
if [[ -f "$AUTOSTART" ]]; then
  # Remove only our marked block; leave other desktop startup commands untouched.
  sed -i '/^# BEGIN LYRION CAROUSEL KIOSK$/,/^# END LYRION CAROUSEL KIOSK$/d' "$AUTOSTART"
fi
if [[ -f "$BIN" ]] && grep -q 'Lyrion Carousel managed kiosk launcher' "$BIN"; then
  rm "$BIN"
fi
echo "Kiosk autostart removed. User settings, browser profile and logs preserved."
echo "Log out or reboot to stop the running kiosk; uninstall does not kill unrelated Chromium."
