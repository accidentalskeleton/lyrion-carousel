# Lyrion Carousel

Lyrion Carousel is the album-browsing and playback-control interface for Lyrion Music Server (LMS) in this hi-fi project. It presents the library as a circular, book-like carousel of CD jewel cases while keeping the normal listening screen deliberately uncluttered.

Current application version: **1.0.0**. The canonical version is stored in [`VERSION`](VERSION).

## Features

- connected LMS/Squeezebox/Squeezelite player discovery and selection;
- circular book/page-style album carousel with realistic jewel-case presentation;
- incremental 40-album catalogue batches with neighbouring-batch prefetch;
- lightweight album-ID → `sort:artflow` position index for direct jumps;
- persistent server-side artwork cache;
- browser-side cached LMS discovery/catalogue fallback for temporary LMS outages;
- event-driven library refresh after LMS scans complete;
- album/artist search and A–Z navigation;
- shamrock random-album selection with configurable animation duration;
- click/tap a cover to load and play that album;
- LMS CometD long-polling for live playback and server/library state;
- current track, track number and locally advancing progress display;
- configurable automatic return to the playing album after an idle period;
- saved player and album position across browser sessions;
- configurable carousel density;
- Settings panel containing Player, Idle return, Random scroll duration, Carousel density and Status/About;
- automatic LMS reconnection;
- installable/fullscreen-friendly web-app metadata and application icon;
- zero-idle-loop long-task performance diagnostics.

## Source layout

```text
lyrion-carousel/
├── VERSION
├── index.html
├── manifest.webmanifest
├── assets/
│   ├── jewel-case-overlay.svg
│   └── lyrion-carousel-icon.svg
├── css/
│   ├── album-browser.css
│   ├── jewel-overlay.css
│   └── settings.css
├── js/
│   ├── app.js
│   ├── browser.js
│   ├── catalogue.js
│   ├── lms.js
│   ├── resilience.js
│   ├── performance.js
│   ├── settings-runtime.js
│   └── settings.js
├── packaging/debian/
├── server.py
└── README.md
```

There is no Node/npm dependency and no build step. `server.py` serves the client files and provides the required LMS/CometD/artwork API proxies and artwork cache.

## Run directly

```bash
cd software/lyrion-carousel
python3 server.py
```

Open `http://127.0.0.1:8088/`. For trusted-LAN access:

```bash
python3 server.py --bind 0.0.0.0
```

`0.0.0.0` is a listening address, not a browser destination. Do not expose this server directly to the internet.

## Runtime options

| Option | Default | Purpose |
| --- | ---: | --- |
| `--lms` | `http://mrlazy:9000` | Lyrion Music Server base URL |
| `--bind` | `127.0.0.1` | Controller listening address |
| `--port` | `8088` | Controller HTTP port |
| `--cache-dir` | `.cache/album-art` | Persistent artwork location |
| `--clear-cache` | off | Delete the persistent artwork cache before starting |
| `--batch-size` | `40` | Albums fetched per LMS catalogue request |
| `--idle-return-seconds` | `30` | Default inactivity before returning to now playing; `0` disables |
| `--reconnect-max-seconds` | `30` | Maximum reconnect delay |
| `--random-scroll-max-seconds` | `3` | Default maximum shamrock animation duration |
| `--search-limit` | `100` | Maximum albums returned by a search |

Player, idle return, random-scroll duration and carousel density can also be selected in Settings. Browser settings are stored locally.

## Jewel-case rendering

Artwork is fetched through `/api/art/<artwork-id>` and cached on disk. The carousel uses real LMS artwork as the booklet image. `assets/jewel-case-overlay.svg` is now authoritative for the complete physical case: outer clear shell, black ribbed hinge, clear separator, opening border, latches and reflections. Legacy CSS/DOM case pieces are suppressed rather than visually duplicated.

The overlay URL is versioned in CSS so an updated case cannot be hidden by a stale browser cache. Carousel transforms remain independent of case construction.

## Catalogue loading, persistence and outages

LMS is queried in fixed batches using `albums <start> <batch-size> sort:artflow tags:ajlys`. Current and neighbouring batches are prefetched automatically, including across the final/first album boundary. A lightweight `tags:s` request builds the album-ID-to-position map.

`js/resilience.js` retains successful read-only `players` and `albums` RPC responses in browser local storage. If LMS is temporarily unreachable, those responses can be replayed so the previously seen library remains available for browsing while normal reconnect attempts continue. Mutating/player-control RPC calls are deliberately never cached or replayed.

CometD subscribes to player status and LMS `serverstatus`. When a library scan completes, Lyrion Carousel refreshes the catalogue, album count and position index once.

## Performance

The signature interaction is intentionally based on compositor-friendly `translate3d`/rotation transforms. Jewel cases are layout/style-contained and marked for transform/filter/opacity compositing. Catalogue batching limits the number of album elements/artworks normally present at once rather than constructing the entire library up front.

`js/performance.js` uses `PerformanceObserver` where supported to report main-thread tasks of 100 ms or longer to the developer console. It does **not** run a permanent `requestAnimationFrame` loop or add polling while the carousel is idle. Final acceptance should include measured frame-rate/memory testing on the intended Raspberry Pi/display hardware with the full library.

## Web-app / kiosk use

`manifest.webmanifest`, the application icon and fullscreen display metadata allow Lyrion Carousel to behave more like a dedicated appliance when installed/launched from a supporting browser. This does not add a service worker or attempt to cache the application shell; LMS reconnection and catalogue fallback remain explicit application behaviours.

## Versioning

`VERSION` is the single canonical application version. Settings → Status/About reads it directly. Debian packaging reads the same file by default, so the UI and generated package do not maintain independent version numbers.

A package version can still be explicitly supplied to the build script for packaging experiments, but normal release builds should use the canonical value.

## Debian packaging

Build from `software/lyrion-carousel`:

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

## Server endpoints

`server.py` is intentionally small and is not a general-purpose proxy:

- `/api/lms` → LMS JSON-RPC;
- `/api/cometd` → LMS CometD;
- `/api/art/<artwork-id>` → LMS artwork with persistent disk caching;
- `/api/config` → runtime defaults.

## Current limitations

- LMS password authentication is not yet implemented.
- Search is capped by `--search-limit` (100 by default).
- Artwork cache eviction and automatic cover-change invalidation are not yet implemented.
- Browser catalogue fallback only contains read-only LMS responses previously seen by that browser; it is not an independent mirror of the complete LMS database.
- Final 60 fps/memory acceptance testing still needs to be performed on the intended wall-controller hardware.
