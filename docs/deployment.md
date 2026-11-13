# Deployment and kiosk setup

[← Project overview](../README.md)

## Web-app / kiosk use

`manifest.webmanifest`, the application icon and fullscreen display metadata allow Lyrion Carousel to behave more like a dedicated appliance when installed/launched from a supporting browser. This does not add a service worker or attempt to cache the application shell; LMS reconnection and catalogue fallback remain explicit application behaviours.

### Raspberry Pi touchscreen kiosk

Use the [scripted Raspberry Pi kiosk installer and troubleshooting guide](raspberry-pi-kiosk.md) for Raspberry Pi OS Desktop with labwc, Chromium, automatic restart, remote Carousel server connections, and safe uninstall. The kiosk is a **browser client** and does not need a duplicate Carousel server on the display Pi. An optional same-device server configuration is supported.

## Versioning

`VERSION` remains the canonical **release** version (currently `0.13.1`). Untagged pre-release `.deb` builds automatically append the source commit SHA, e.g. `0.13.1~git267cd42400`. This is derived at build time; the tracked `VERSION` file is **not** modified (otherwise the commit would change). Exact Git release-tag builds such as `v0.13.1` use the clean release number. Builds refuse uncommitted tracked changes so a stamped SHA cannot falsely identify modified code.

The installed package, `/opt/lyrion-carousel/VERSION` and `/opt/lyrion-carousel/BUILD_INFO.json` identify the same build. The packaged HTML references, JavaScript entrypoints and nested module imports use commit-specific cache keys so newly loaded pages do not reuse old code from the browser cache.

**Settings → About** shows **Browser build** (the identifier embedded in the JavaScript that tab actually loaded), **Server build** (read afresh from `/api/build`) and **Build status**. If they differ, reload the tab; a page already open during a package upgrade keeps its old JavaScript until reloaded. On un-packaged development checkouts the browser displays `development` and the match is not asserted.

The normal GitHub release checker continues comparing the stable numeric release version. A final `0.13.1` release supersedes a pre-release of the same number.

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

The package includes a commit-stamped `VERSION`, `BUILD_INFO.json`, the web-app manifest, assets, CSS and JavaScript. The output filename is printed by `build-deb.sh` and includes the Git SHA for pre-releases.

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
