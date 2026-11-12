#!/usr/bin/env bash
# Optional preparation and reversible configuration backup for Corsair's
# experimental Raspberry Pi calibrator. Never runs upstream code as root.
set -euo pipefail
ACTION="check"
KIOSK_USER="carousel"
UPSTREAM="https://github.com/Corsair-Labs/Touchscreen-Calibrator-Raspberry-Pi.git"
usage() {
  cat <<'HELP'
Usage: sudo bash deploy/raspberry-pi/calibrate-touchscreen.sh [--check|--prepare|--backup|--restore DIR] [--user carousel]
  --check        Show display/input diagnostics (default; read-only)
  --prepare      Download upstream tool and install its Python dependencies in a user venv
  --backup       Save udev rule and labwc config to a dated root-only directory
  --restore DIR  Restore only files in the specified backup directory (explicit confirmation)
Calibration itself is interactive and is NOT automatically started by this script.
HELP
}
BACKUP=""
while (($#)); do
  case "$1" in
    --check) ACTION=check; shift;;
    --prepare) ACTION=prepare; shift;;
    --backup) ACTION=backup; shift;;
    --restore) ACTION=restore; BACKUP="${2:?missing backup directory}"; shift 2;;
    --user) KIOSK_USER="${2:?missing user}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) usage >&2; exit 2;;
  esac
done
[[ "$KIOSK_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Invalid username" >&2; exit 2; }
id "$KIOSK_USER" >/dev/null
HOME_DIR="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
[[ -d "$HOME_DIR" && "$HOME_DIR" != / ]] || exit 2
UID_NUM="$(id -u "$KIOSK_USER")"
RULE="/etc/udev/rules.d/99-touchscreen-calibration.rules"
LABWC="$HOME_DIR/.config/labwc/rc.xml"
UPSTREAM_DIR="$HOME_DIR/.local/share/corsair-touch-calibrator"
BACKUP_ROOT="/var/backups/lyrion-carousel-touch"

case "$ACTION" in
  check)
    echo "=== Connected HDMI ports ==="
    for status in /sys/class/drm/card*-HDMI-A-*/status; do
      [[ -f "$status" ]] && printf '%s: %s\n' "$status" "$(cat "$status")"
    done
    echo "=== Touchscreen input devices ==="
    grep -iE 'Name=|Handlers=' /proc/bus/input/devices | grep -i -A1 -B1 -E 'touch|wch.cn|Corsair' || true
    echo "=== Wayland outputs (when desktop running) ==="
    if command -v wlr-randr >/dev/null && [[ -S "/run/user/$UID_NUM/wayland-0" ]] && [[ $EUID -eq 0 ]]; then
      runuser -u "$KIOSK_USER" -- env XDG_RUNTIME_DIR="/run/user/$UID_NUM" WAYLAND_DISPLAY=wayland-0 wlr-randr || true
    else
      echo "Run with sudo after the graphical session has started to inspect wlr-randr"
    fi
    echo "No calibration or system configuration was changed."
    ;;
  prepare)
    [[ $EUID -eq 0 ]] || { echo "Use sudo for --prepare" >&2; exit 1; }
    if ! grep -q '^connected$' /sys/class/drm/card*-HDMI-A-*/status 2>/dev/null; then
      echo "No connected HDMI display. Calibration can be prepared headlessly."
    fi
    for cmd in git python3; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
    python3 -m venv --help >/dev/null || { echo "Install python3-venv" >&2; exit 1; }
    install -d -o "$KIOSK_USER" -g "$(id -gn "$KIOSK_USER")" "$HOME_DIR/.local" "$HOME_DIR/.local/share"
    if [[ -e "$UPSTREAM_DIR" ]]; then
      echo "Existing source at $UPSTREAM_DIR — will not overwrite or update it."
    else
      runuser -u "$KIOSK_USER" -- git clone "$UPSTREAM" "$UPSTREAM_DIR"
    fi
    [[ -f "$UPSTREAM_DIR/requirements.txt" && -f "$UPSTREAM_DIR/touchscreen_calibrator_raspberry_pi.py" ]] || { echo "Unexpected upstream contents" >&2; exit 1; }
    echo "Review upstream code, pinned dependencies and licence before continuing."
    echo "Upstream checkout commit: $(git -C "$UPSTREAM_DIR" rev-parse HEAD)"
    read -r -p 'Install upstream Python dependencies in an isolated virtual environment? [y/N] ' confirm
    [[ "$confirm" == y || "$confirm" == Y ]] || exit 0
    runuser -u "$KIOSK_USER" -- python3 -m venv "$UPSTREAM_DIR/.venv"
    runuser -u "$KIOSK_USER" -- "$UPSTREAM_DIR/.venv/bin/python" -m pip install -r "$UPSTREAM_DIR/requirements.txt"
    echo "Prepared $UPSTREAM_DIR. No calibration has run and no udev/labwc files changed."
    ;;
  backup)
    [[ $EUID -eq 0 ]] || { echo "Use sudo for --backup" >&2; exit 1; }
    umask 077
    stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    dest="$BACKUP_ROOT/$stamp"
    mkdir -p "$dest"
    for entry in "$RULE" "$LABWC"; do
      label="$(basename "$entry")"
      if [[ -e "$entry" ]]; then
        cp -a -- "$entry" "$dest/$label"
        printf '%s=present\n' "$label" >> "$dest/manifest"
      else
        printf '%s=absent\n' "$label" >> "$dest/manifest"
      fi
    done
    echo "Backed up calibration settings to $dest"
    ;;
  restore)
    [[ $EUID -eq 0 ]] || { echo "Use sudo for --restore" >&2; exit 1; }
    [[ -d "$BACKUP" && -f "$BACKUP/manifest" ]] || { echo "Invalid backup" >&2; exit 2; }
    real="$(realpath -e -- "$BACKUP")"
    [[ "$real" == "$BACKUP_ROOT/"* ]] || { echo "Backup must be in $BACKUP_ROOT" >&2; exit 2; }
    grep -Eq '^99-touchscreen-calibration.rules=(present|absent)$' "$real/manifest"
    grep -Eq '^rc.xml=(present|absent)$' "$real/manifest"
    echo "Restore udev rule $RULE and labwc config $LABWC from $real?"
    read -r -p 'Type RESTORE to proceed: ' confirm
    [[ "$confirm" == RESTORE ]] || { echo "Cancelled"; exit 0; }
    for entry in "$RULE" "$LABWC"; do
      label="$(basename "$entry")"
      status="$(sed -n "s/^$label=//p" "$real/manifest")"
      if [[ "$status" == present ]]; then
        [[ -f "$real/$label" ]] || { echo "Missing backed-up $label" >&2; exit 1; }
        install -d "$(dirname "$entry")"
        cp -a -- "$real/$label" "$entry"
      else
        rm -f -- "$entry"
      fi
    done
    echo "Restored files. Reboot or reconnect touch device to apply restored udev configuration."
    ;;
esac
