# Deployment and kiosk setup

[← Project overview](../README.md)

## Web-app / kiosk use

`manifest.webmanifest`, the application icon and fullscreen display metadata allow Lyrion Carousel to behave more like a dedicated appliance when installed/launched from a supporting browser. This does not add a service worker or attempt to cache the application shell; LMS reconnection and catalogue fallback remain explicit application behaviours.

### Raspberry Pi touchscreen kiosk

Use the [scripted Raspberry Pi kiosk installer and troubleshooting guide](raspberry-pi-kiosk.md) for Raspberry Pi OS Desktop with labwc, Chromium, automatic restart, remote Carousel server connections, and safe uninstall. The kiosk is a **browser client** and does not need a duplicate Carousel server on the display Pi. An optional same-device server configuration is supported.

## Versioning

`VERSION` is the single canonical application version. **Settings → About** reads it directly. Debian packaging reads the same file by default, so the UI and generated package do not maintain independent version numbers.

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
- disposable artwork images: `/var/cache/lyrion-carousel/artwork`;
- persistent unified metadata database: `/var/cache/lyrion-carousel/carousel-metadata.sqlite3` (outside the artwork directory, so clearing images does not remove saved album-added dates).

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
