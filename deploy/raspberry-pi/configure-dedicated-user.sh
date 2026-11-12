#!/usr/bin/env bash
# Create a limited kiosk desktop identity and explicitly opt into its desktop autologin.
set -euo pipefail
USER_NAME="carousel"
AUTOLOGIN=false
while (($#)); do
  case "$1" in
    --user) USER_NAME="${2:?missing username}"; shift 2;;
    --desktop-autologin) AUTOLOGIN=true; shift;;
    -h|--help)
      echo "Usage: sudo bash deploy/raspberry-pi/configure-dedicated-user.sh [--user carousel] [--desktop-autologin]"
      exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
[[ "$USER_NAME" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Invalid username" >&2; exit 2; }
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --user-group "$USER_NAME"
  passwd -l "$USER_NAME" >/dev/null
  echo "Created desktop-only user $USER_NAME with password authentication locked"
else
  echo "Using existing user: $USER_NAME (password and groups unchanged)"
fi
if $AUTOLOGIN; then
  command -v raspi-config >/dev/null || {
    echo "raspi-config unavailable; configure desktop autologin manually" >&2; exit 1;
  }
  # Raspberry Pi OS chooses the autologin identity from USER.
  # Does not touch SSH configuration or change other user passwords.
  USER="$USER_NAME" raspi-config nonint do_boot_behaviour B4
  echo "Configured Raspberry Pi OS desktop autologin for $USER_NAME"
  echo "Reboot required. Check /etc/lightdm/lightdm.conf before rebooting."
else
  echo "Desktop autologin unchanged. Opt in with --desktop-autologin after kiosk installation."
fi
