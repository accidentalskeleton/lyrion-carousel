# Deployment and kiosk setup

[← Project overview](../README.md) · [Windows installation](windows.md)

## Web-app / kiosk use

`manifest.webmanifest`, the application icon and fullscreen display metadata allow Lyrion Carousel to behave more like a dedicated appliance when installed/launched from a supporting browser. This does not add a service worker or attempt to cache the application shell; LMS reconnection and catalogue fallback remain explicit application behaviours.

### Raspberry Pi kiosk startup

The Debian package already runs the Lyrion Carousel server under `lyrion-carousel.service`, including automatic restart after a server failure. A separate desktop-session wrapper should therefore manage only Chromium.

For a dedicated controller, set the packaged server to listen locally in `/etc/default/lyrion-carousel`:

```bash
BIND_ADDRESS=127.0.0.1
PORT=8088
```

Apply the change:

```bash
sudo systemctl restart lyrion-carousel.service
```

Create the kiosk wrapper as `~/.local/bin/start-carousel.sh`:

```bash
#!/usr/bin/env bash

URL="http://127.0.0.1:8088/"
PROFILE="$HOME/.config/lyrion-carousel-kiosk"

while true; do
    # Wait until the local Carousel server is ready.
    until python3 -c "
import urllib.request
urllib.request.urlopen('$URL', timeout=2).read(1)
" >/dev/null 2>&1; do
        sleep 2
    done

    # Run Chromium until it closes or crashes.
    chromium \
        --kiosk \
        --noerrdialogs \
        --no-first-run \
        --disable-session-crashed-bubble \
        --disable-features=TranslateUI \
        --overscroll-history-navigation=0 \
        --user-data-dir="$PROFILE" \
        "$URL"

    sleep 2
done
```

Make it executable:

```bash
chmod +x ~/.local/bin/start-carousel.sh
```

On current Raspberry Pi OS Desktop releases using labwc, enable Desktop Autologin with `sudo raspi-config`, then create the user autostart file without overwriting an existing one:

```bash
mkdir -p ~/.config/labwc
cp -n /etc/xdg/labwc/autostart ~/.config/labwc/autostart
```

Append this line to `~/.config/labwc/autostart`:

```bash
"$HOME/.local/bin/start-carousel.sh" &
```

After reboot, the desktop logs in automatically, waits for Lyrion Carousel on port 8088 and opens it full-screen. If Chromium exits or crashes, the wrapper starts it again after two seconds. Pressing Alt+F4 therefore closes the kiosk only briefly; stop the wrapper over SSH while developing:

```bash
pkill -f start-carousel.sh
pkill -f chromium
```

Keep `BIND_ADDRESS=0.0.0.0` only when the controller must be accessible from other trusted-LAN devices. The server has playback and configuration endpoints without user authentication and must not be exposed directly to the internet.

The planned wall-controller/display hardware is documented separately in [`wall-controller.md`](wall-controller.md).

## Versioning

`VERSION` is the single canonical application version. Settings → Status/About reads it directly. Debian packaging reads the same file by default, so the UI and generated package do not maintain independent version numbers.

The version is deliberately **not** auto-incremented by feature work or packaging. It remains at the value in `VERSION` until an explicit version-change request is made.

## Debian packaging

Build from the repository root:

```bash
packaging/debian/build-deb.sh
```

The package/service names are consistently `lyrion-carousel`:

- package: `lyrion-carousel`;
- service: `lyrion-carousel.service`;
- configuration: `/etc/default/lyrion-carousel`;
- application: `/opt/lyrion-carousel`;
- artwork cache: `/var/cache/lyrion-carousel/artwork`.

The package includes `VERSION`, the web-app manifest, assets, CSS and JavaScript.

### Manage the Debian service

After installation, start the service and enable it to start automatically at boot:

```bash
sudo systemctl enable --now lyrion-carousel.service
```

Use these commands to control the running service:

```bash
sudo systemctl stop lyrion-carousel.service
sudo systemctl start lyrion-carousel.service
sudo systemctl restart lyrion-carousel.service
sudo systemctl status lyrion-carousel.service
```

View recent service output or follow the log while troubleshooting:

```bash
sudo journalctl -u lyrion-carousel.service -n 100 --no-pager
sudo journalctl -u lyrion-carousel.service -f
```

Runtime defaults are stored in `/etc/default/lyrion-carousel`. After changing that file, restart the service to apply the new values:

```bash
sudo systemctl restart lyrion-carousel.service
```

To prevent the service from starting at boot and stop it immediately:

```bash
sudo systemctl disable --now lyrion-carousel.service
```
