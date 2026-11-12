#!/usr/bin/env bash
set -euo pipefail
usage() {
  echo "Usage: sudo bash deploy/raspberry-pi/install-kiosk.sh --user USER [--server http://host:8088] [--install-deps]"
}
USER_NAME=""
SERVER="http://127.0.0.1:8088/"
INSTALL_DEPS=false
while (($#)); do
  case "$1" in
    --user) USER_NAME="${2:?missing username}"; shift 2;;
    --server) SERVER="${2:?missing URL}"; shift 2;;
    --install-deps) INSTALL_DEPS=true; shift;;
    -h|--help) usage; exit 0;;
    *) usage >&2; exit 2;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Run as root with sudo" >&2; exit 1; }
[[ -n "$USER_NAME" ]] || { usage >&2; exit 2; }
case "$SERVER" in http://*|https://*) ;; *) echo "Only HTTP(S) URLs are accepted" >&2; exit 2;; esac
id "$USER_NAME" >/dev/null
USER_UID="$(id -u "$USER_NAME")"
[[ "$USER_UID" -ge 1000 ]] || { echo "Refusing to install for a system user" >&2; exit 1; }
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
[[ -d "$HOME_DIR" && "$HOME_DIR" != / ]] || { echo "Invalid home directory" >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if $INSTALL_DEPS; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y chromium labwc curl wlr-randr
fi
for cmd in chromium labwc curl; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd; rerun with --install-deps" >&2; exit 1; }
done
BIN="$HOME_DIR/.local/bin/carousel-kiosk"
CONF_DIR="$HOME_DIR/.config/lyrion-carousel"
CONF="$CONF_DIR/kiosk.conf"
AUTOSTART="$HOME_DIR/.config/labwc/autostart"
USER_GROUP="$(id -gn "$USER_NAME")"
# Create and own parent directories explicitly. install -d on a nested path
# does not repair ownership of an existing or newly-created ancestor.
install -d -o "$USER_NAME" -g "$USER_GROUP" "$HOME_DIR/.config" "$HOME_DIR/.local"
install -d -o "$USER_NAME" -g "$USER_GROUP" "$HOME_DIR/.local/bin" "$HOME_DIR/.local/state"
install -d -o "$USER_NAME" -g "$USER_GROUP" "$HOME_DIR/.local/state/lyrion-carousel-kiosk"
install -d -o "$USER_NAME" -g "$USER_GROUP" "$CONF_DIR" "$(dirname "$AUTOSTART")"
# Refuse to overwrite user files unless they are already managed by this installer.
if [[ -e "$BIN" ]] && ! grep -q 'Lyrion Carousel managed kiosk launcher' "$BIN"; then
  echo "Existing unmanaged $BIN; move it aside manually before installing" >&2
  exit 1
fi
{
  head -n 1 "$SCRIPT_DIR/carousel-kiosk"
  echo '# Lyrion Carousel managed kiosk launcher'
  tail -n +2 "$SCRIPT_DIR/carousel-kiosk"
} > "$BIN"
chmod 755 "$BIN"
if [[ ! -e "$CONF" ]]; then
  printf 'CAROUSEL_URL=%q\nRECONNECT_INTERVAL=5\nHEALTH_INTERVAL=10\nHEALTH_FAILURES=3\nHIDE_CURSOR=true\nDISABLE_SCREEN_BLANKING=true\n' "$SERVER" > "$CONF"
  chmod 600 "$CONF"
else
  echo "Preserving existing configuration: $CONF"
fi
# The per-user autostart file may override system defaults on some Pi OS versions.
# Keep pre-existing content untouched; use a marked, reversible block.
touch "$AUTOSTART"
if ! grep -Fq '# BEGIN LYRION CAROUSEL KIOSK' "$AUTOSTART"; then
  printf '\n# BEGIN LYRION CAROUSEL KIOSK\n%s &\n# END LYRION CAROUSEL KIOSK\n' "$BIN" >> "$AUTOSTART"
fi
chown "$USER_NAME:$USER_GROUP" "$BIN" "$CONF" "$AUTOSTART"
echo "Installed kiosk for $USER_NAME: $SERVER"
echo "Desktop autologin is not changed automatically. Enable it with sudo raspi-config if required."
echo "Reboot or restart the labwc user session to activate."
