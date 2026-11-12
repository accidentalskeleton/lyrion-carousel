# Optional Corsair XENEON EDGE touch calibration (Raspberry Pi)

[← Raspberry Pi kiosk](raspberry-pi-kiosk.md) · [Project overview](../README.md)

This is an **optional hardware troubleshooting workflow**, not a dependency of Lyrion Carousel. Only calibrate after the Corsair XENEON EDGE is physically connected and taps, swipes or long-presses are demonstrated to be offset, reversed or mapped to the wrong monitor.

The upstream [Corsair-Labs Touchscreen Calibrator for Raspberry Pi](https://github.com/Corsair-Labs/Touchscreen-Calibrator-Raspberry-Pi) is **experimental and not an officially supported Corsair product**. Its MIT-licensed code is not vendored into Carousel, and its revision must be reviewed before use. No calibration tool is installed or executed by the kiosk installer.

## Check the hardware (non-destructive)

From an SSH session as administrator `stu` on the display Pi:

```bash
cd ~/lyrion-carousel-kiosk-test  # or your normal lyrion-carousel checkout
sudo bash deploy/raspberry-pi/calibrate-touchscreen.sh --check --user carousel
```

The script shows connected HDMI ports, candidate touch devices and `wlr-randr` outputs from the `carousel` graphical session. **Do not assume** the Corsair's touch event is `/dev/input/event11` or the connector is `HDMI-A-2`: those are upstream defaults and are hardware-dependent. Confirm the Corsair actually advertises the expected 2560 × 720 mode and that its USB touch device is enumerated.

## Prepare the upstream tool (only if needed)

```bash
sudo apt-get install -y git python3-venv python3-pip python3-dev build-essential wlr-randr xinput
sudo bash deploy/raspberry-pi/calibrate-touchscreen.sh --prepare --user carousel
```

This explicitly clones the Corsair Labs repository into `/home/carousel/.local/share/corsair-touch-calibrator` and reports the commit SHA. It asks before installing upstream `requirements.txt` into a **local virtual environment**. Repeated preparation preserves the checkout rather than silently updating it. Review the upstream code, licence, prerequisites and pinned dependencies before accepting. It does not download/execute scripts from a piped shell, configure passwordless sudo, change HDMI modes, change udev rules or automatically launch calibration.

## Backup before calibration

```bash
sudo bash deploy/raspberry-pi/calibrate-touchscreen.sh --backup --user carousel
```

Record the printed `/var/backups/lyrion-carousel-touch/<timestamp>` directory. The backup captures the existing `/etc/udev/rules.d/99-touchscreen-calibration.rules` and `/home/carousel/.config/labwc/rc.xml`, including whether either was absent. It does not change the live files.

## Interactive calibration — administrator-supervised

The upstream utility runs a fullscreen interactive window, samples five touch points and can write persistent **system** udev configuration and **user** labwc mapping. It may request sudo during calibration. Since `carousel` is deliberately password-locked and has **no sudo privileges**, do not run upstream `run-all.sh` expecting that account to escalate. **Do not add `carousel` to sudoers or the sudo group.**

Only if touch mapping actually needs correction, run the reviewed upstream Python application explicitly under administrative supervision in the **existing** `carousel` desktop session. The following command is a privileged GUI operation and should only be used after source review and backup, with the real Corsair display attached:

```bash
sudo env \
  HOME=/home/carousel \
  XDG_RUNTIME_DIR=/run/user/$(id -u carousel) \
  WAYLAND_DISPLAY=wayland-0 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u carousel)/bus \
  TOUCHSCREEN_LABWC_RC=/home/carousel/.config/labwc/rc.xml \
  TOUCHSCREEN_OUTPUT_NAME=HDMI-A-1 \
  /home/carousel/.local/share/corsair-touch-calibrator/.venv/bin/python \
  /home/carousel/.local/share/corsair-touch-calibrator/touchscreen_calibrator_raspberry_pi.py
```

**Replace `HDMI-A-1` with the actual connected output from `wlr-randr`.** The command runs a third-party graphical program with root privileges, so inspect the exact checked-out revision first. Its behaviour and Wayland compatibility can change upstream; this approach is provided for operator-supervised use, **not yet validated with a physical Corsair**. If access to the display socket is rejected, stop and diagnose instead of weakening permissions.

The upstream tool's calibration procedure is: select the correct monitor, touch the centre of five markers, review the resulting matrix and exit. By default its udev rule normally takes effect when the device is re-enumerated or after reboot. Re-test taps, swipes, holds and edges in Carousel afterwards.

## Restore original touch settings

If calibration makes the touchscreen worse, restore from the backup directory you recorded:

```bash
sudo bash deploy/raspberry-pi/calibrate-touchscreen.sh \
  --restore /var/backups/lyrion-carousel-touch/REPLACE_WITH_BACKUP \
  --user carousel
```

The script requires the operator to type `RESTORE`. It restores the original two files (or removes files that were absent before calibration). Restart or reboot to apply the restored udev configuration. **Restoration does not undo changes the upstream tool may make elsewhere**, so review its release before using it.

No changes to Lyrion Carousel's browser app, kiosk autostart, server, LMS or Chromium profile are necessary for calibration. The Corsair can be left completely uncalibrated when touch works correctly.
