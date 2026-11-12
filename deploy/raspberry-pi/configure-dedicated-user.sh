#!/usr/bin/env bash
# Create a limited kiosk desktop identity and explicitly opt into its desktop autologin.
set -euo pipefail
USER_NAME="carousel"
AUTOLOGIN=false
SUDO_ADMIN=""
REVOKE_SUDO_ADMIN=""
while (($#)); do
  case "$1" in
    --user) USER_NAME="${2:?missing username}"; shift 2;;
    --desktop-autologin) AUTOLOGIN=true; shift;;
    --passwordless-sudo-user) SUDO_ADMIN="${2:?missing admin username}"; shift 2;;
    --revoke-passwordless-sudo-user) REVOKE_SUDO_ADMIN="${2:?missing admin username}"; shift 2;;
    -h|--help)
      echo "Usage: sudo bash deploy/raspberry-pi/configure-dedicated-user.sh [--user carousel] [--desktop-autologin] [--passwordless-sudo-user stu | --revoke-passwordless-sudo-user stu]"
      exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
[[ "$USER_NAME" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Invalid username" >&2; exit 2; }
[[ -z "$SUDO_ADMIN" || -z "$REVOKE_SUDO_ADMIN" ]] || { echo "Choose grant or revoke, not both" >&2; exit 2; }
for account in "$SUDO_ADMIN" "$REVOKE_SUDO_ADMIN"; do
  [[ -z "$account" || "$account" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Invalid sudo username" >&2; exit 2; }
  if [[ -n "$account" ]]; then
    [[ "$account" != "$USER_NAME" ]] || { echo "Refusing passwordless sudo for kiosk user $USER_NAME" >&2; exit 2; }
    id "$account" >/dev/null || { echo "Unknown admin user: $account" >&2; exit 2; }
  fi
done
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
  # raspi-config derives USER from SUDO_USER (not from the USER environment variable).
  # This also adjusts tty1 autologin as part of Raspberry Pi OS boot behaviour.
  SUDO_USER="$USER_NAME" raspi-config nonint do_boot_behaviour B4
  if ! grep -Eq "^autologin-user=$USER_NAME$" /etc/lightdm/lightdm.conf; then
    echo "ERROR: LightDM autologin was not configured for $USER_NAME; do not reboot." >&2
    exit 1
  fi
  echo "Verified LightDM desktop autologin for $USER_NAME"
  echo "Reboot required; SSH configuration and other user passwords are unchanged."
else
  echo "Desktop autologin unchanged. Opt in with --desktop-autologin after kiosk installation."
fi

# Optional administrative convenience: full passwordless root access for one
# explicitly selected existing administrator, never for the kiosk identity.
# File ownership, mode and visudo validation are mandatory.
if [[ -n "$SUDO_ADMIN" ]]; then
  command -v visudo >/dev/null || { echo "visudo is required (install sudo)" >&2; exit 1; }
  sudoers_file="/etc/sudoers.d/90-lyrion-carousel-admin-$SUDO_ADMIN"
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  printf '%s ALL=(ALL:ALL) NOPASSWD: ALL\n' "$SUDO_ADMIN" > "$tmp"
  chmod 0440 "$tmp"
  visudo -cf "$tmp" >/dev/null || { echo "Invalid sudoers configuration; no changes made" >&2; exit 1; }
  install -o root -g root -m 0440 "$tmp" "$sudoers_file"
  visudo -cf "$sudoers_file" >/dev/null
  echo "Enabled passwordless sudo for $SUDO_ADMIN via $sudoers_file"
  echo "WARNING: This allows all commands to run as root without password confirmation."
fi
if [[ -n "$REVOKE_SUDO_ADMIN" ]]; then
  sudoers_file="/etc/sudoers.d/90-lyrion-carousel-admin-$REVOKE_SUDO_ADMIN"
  if [[ -f "$sudoers_file" ]]; then
    expected="$REVOKE_SUDO_ADMIN ALL=(ALL:ALL) NOPASSWD: ALL"
    [[ "$(cat "$sudoers_file")" == "$expected" ]] || {
      echo "Refusing to delete modified sudoers rule: $sudoers_file" >&2; exit 1;
    }
    rm -- "$sudoers_file"
    echo "Removed installer-managed passwordless sudo rule for $REVOKE_SUDO_ADMIN"
  else
    echo "No installer-managed passwordless sudo rule for $REVOKE_SUDO_ADMIN"
  fi
fi
