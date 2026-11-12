# Raspberry Pi Chromium touchscreen kiosk

[← Project overview](../README.md) · [Deployment](deployment.md)

Use a Raspberry Pi 4 (preferably 4 GB RAM) or Pi 5 as a **display-only Carousel client**, while Lyrion Carousel and LMS run on another machine. The same installer also accepts a localhost URL for an all-in-one setup.

## Prerequisites

Install Raspberry Pi OS **64-bit Desktop** (Debian Trixie or a current supported Raspberry Pi OS Desktop release), configure Wi-Fi/Ethernet and SSH in Raspberry Pi Imager, and use a dedicated unprivileged desktop account for Chromium. Keep your ordinary account for SSH and administration. Desktop autologin is configured explicitly after the dedicated account is installed. The installer does **not** change login policy, network settings, HDMI configuration or power settings. The display can remain disconnected for headless initial setup.

For a remote Carousel server, confirm that `curl -f http://streamer:8088/` succeeds from the Pi. Only expose the Carousel server to trusted local clients: the controller API is not authenticated.

## Install

Clone or update this repository on the **display Pi** as your administrator (for example `stu`), then from its root:

```bash
sudo bash deploy/raspberry-pi/configure-dedicated-user.sh --user carousel
sudo bash deploy/raspberry-pi/install-kiosk.sh \
  --user carousel --server http://streamer:8088 --install-deps
sudo bash deploy/raspberry-pi/configure-dedicated-user.sh \
  --user carousel --desktop-autologin
sudo reboot
```

The `carousel` account has its own home, browser profile, kiosk logs and configuration. Newly created accounts have locked password authentication and no `sudo` grant. SSH administration continues using your existing account. The final autologin command opts into changing the **local graphical login**, not SSH; review `/etc/lightdm/lightdm.conf` before rebooting.

**Migrating from an existing `stu` kiosk:** Back up `/home/stu/.config/labwc/autostart` and `/home/stu/.local/bin/carousel-kiosk`. Run `sudo bash deploy/raspberry-pi/uninstall-kiosk.sh --user carousel` before switching graphical autologin; it removes only installer-managed autostart, and leaves `stu`'s profiles/settings. Then install for `carousel` as above. Do **not** copy Chromium profiles from `stu` or grant the kiosk account sudo. Any browser-only Carousel settings will start fresh and can be configured on the new display later.

Omit `--install-deps` when Chromium, labwc and curl are already installed. No second Carousel server is installed. Autostart launches Chromium using the user's own desktop Wayland session. Installation preserves existing config and existing labwc autostart content; it refuses to overwrite a non-managed launcher. Repeat installation is safe.

To use a local server: `--server http://127.0.0.1:8088/`.

## Configure

Edit `~/.config/lyrion-carousel/kiosk.conf` as the desktop user:

```bash
CAROUSEL_URL=http://streamer:8088
RECONNECT_INTERVAL=5
HEALTH_INTERVAL=10
HEALTH_FAILURES=3
HIDE_CURSOR=true
DISABLE_SCREEN_BLANKING=true
```

These are shell-style assignments **executed as the desktop user**, so only trusted users should edit the file. On upgrades the installer preserves this configuration. A newly supplied `--server` does not overwrite an existing configuration; edit `CAROUSEL_URL` directly instead.

The launcher waits for a healthy server, starts Chromium in kiosk mode, restarts it if it exits, and restarts it after three consecutive failed server health checks. These health checks are intended to recover a browser error page after the server or network becomes unavailable. A momentary network problem does not immediately restart the browser.

Log output: `~/.local/state/lyrion-carousel-kiosk/chromium.log` (rotated at launcher start when over 5 MiB).

## Display and touch

Let HDMI/Wayland detect the panel's modes automatically. On a Corsair XENEON EDGE, test its native **2560 × 720 at 60 Hz** after connecting the HDMI cable; do not force a 2560 × 720 mode before inspecting the actual EDID. HDMI carries video; USB-C provides touch data and requires suitable power. Test using `wlr-randr`, `lsusb`, and actual swipe/tap interactions after the screen arrives.

`HIDE_CURSOR` and `DISABLE_SCREEN_BLANKING` are retained as future configuration switches but are **not yet enforced automatically** by this installer. Configure these through the desktop's supported pointer/power tools after verifying the real display, rather than applying potentially unsafe headless display configuration.

When no HDMI screen is connected, labwc may expose a 1920 × 1080 `NOOP-1` virtual output, which is not proof that the eventual monitor mode or touch works.

## Diagnostics

```bash
pgrep -af '[c]arousel-kiosk'
pgrep -af '[c]hromium.*--kiosk' | head -3
sudo tail -40 /home/carousel/.local/state/lyrion-carousel-kiosk/chromium.log
curl -fI http://streamer:8088/ || curl -f http://streamer:8088/ -o /dev/null
sudo -u carousel env XDG_RUNTIME_DIR=/run/user/$(id -u carousel) WAYLAND_DISPLAY=wayland-0 wlr-randr
```

The desktop must have an active Wayland/labwc session. If only a TTY session exists over SSH, inspect `loginctl list-sessions` and `systemctl status lightdm`; SSH itself normally reports `tty` even when the graphical session is healthy.

## Uninstall

```bash
sudo bash deploy/raspberry-pi/uninstall-kiosk.sh --user stu
sudo reboot
```

The uninstaller does not delete the `carousel` Linux account or change graphical autologin; change the autologin identity separately before removing an account. It removes the managed launcher and only the marked autostart block. It deliberately preserves the browser profile, logs, user configuration and all unrelated desktop settings. The installer does not change desktop autologin or install a separate server/service.

## Testing

```bash
bash -n deploy/raspberry-pi/*.sh deploy/raspberry-pi/carousel-kiosk
bash tests/test_pi_kiosk.sh
```

These tests validate script syntax, options and static safety properties. Live Raspberry Pi, Wayland, Corsair touch and server-recovery acceptance tests are still required.
