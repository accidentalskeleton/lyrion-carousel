#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/deploy/raspberry-pi/calibrate-touchscreen.sh"
bash -n "$script"
bash "$script" --help | grep -q -- '--prepare'
bash "$script" --help | grep -q -- '--restore'
grep -Fq 'TOUCHSCREEN' "$root/docs/corsair-touch-calibration.md"
grep -Fq 'Touchscreen-Calibrator-Raspberry-Pi.git' "$script"
grep -Fq 'runuser -u "$KIOSK_USER" -- python3 -m venv' "$script"
grep -Fq "Type RESTORE to proceed" "$script"
# Safe by default: the helper must not execute upstream calibrator or modify
# udev configuration without a distinct manual, privileged operation.
if grep -Eq '(^|[[:space:]])(python3|python)[[:space:]]+.*touchscreen_calibrator_raspberry_pi.py' "$script"; then
  echo "Unexpected automatic calibration invocation" >&2
  exit 1
fi
echo "Optional Corsair touch calibration checks passed"
