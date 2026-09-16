# Lyrion Carousel

Lyrion Carousel is a standalone album-browsing and playback-control interface for Lyrion Music Server (LMS). It presents the music library as a continuous, book-like carousel of CD jewel cases while keeping the normal listening screen deliberately uncluttered.

Current application version: **0.7.0**. The canonical version is stored in [`VERSION`](VERSION). Do not change the application version as part of ordinary development work; it is changed only when explicitly requested.

## Features

- connected LMS/Squeezebox/Squeezelite player discovery and selection;
- circular book/page-style album carousel with realistic jewel-case presentation;
- startup directly on the currently playing album, or a randomly selected display album when nothing is playing;
- incremental 40-album catalogue batches with neighbouring-batch prefetch;
- paged album-ID → `sort:artflow` position index for direct jumps;
- persistent server-side artwork cache;
- browser-side cached LMS discovery/catalogue fallback for temporary LMS outages;
- event-driven library refresh after LMS scans complete;
- album/artist search and A–Z navigation;
- shamrock random-album selection with configurable animation duration;
- click/tap a cover to load and play that album;
- LMS CometD long-polling for live playback and server/library state;
- current track, track number and locally advancing progress display;
- configurable automatic return to the playing album after an idle period;
- saved player selection across browser sessions;
- live configurable carousel density, idle return and random-scroll duration;
- Settings panel with explicit LMS, CometD/live-update, player, library, cache and application status;
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
├── css/
├── docs/
│   └── wall-controller.md
├── js/
├── packaging/debian/
├── server.py
└── README.md
```

There is no Node/npm dependency and no build step. `server.py` serves the client files and provides the required LMS/CometD/artwork API proxies and artwork cache.

## Run directly

```bash
cd lyrion-carousel
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

Player, idle return, random-scroll duration and carousel density can also be selected in Settings. Browser settings are stored locally. Idle return, random duration and density are applied immediately without a reload.

## Startup and browsing behaviour

The live carousel is not rendered until LMS catalogue and player status are resolved. If the selected player is playing, its current `album_id` is located and that album is the first visible selection. If the player is not playing, a random library position is selected and displayed without starting playback. The completed carousel then fades in briefly.

While the user browses, CometD status changes do not forcibly steal the carousel position. Once the configured idle period expires, the carousel resolves the then-current playing `album_id` and returns smoothly to it. This also covers playback being changed from another LMS controller while Lyrion Carousel is being browsed.

## Jewel-case rendering

Artwork is fetched through `/api/art/<artwork-id>` and cached on disk. The carousel uses real LMS artwork as the booklet image. `assets/jewel-case-overlay.svg` is authoritative for the complete physical case: outer clear shell, black ribbed hinge, clear separator, opening border, latches and reflections. Legacy CSS/DOM case pieces are suppressed rather than visually duplicated.

The overlay URL is versioned so an updated case cannot be hidden by a stale browser cache. Carousel transforms remain independent of case construction.

## Catalogue loading, persistence and outages

LMS is queried in fixed batches using `albums <start> <batch-size> sort:artflow tags:ajlys`. Current and neighbouring batches are prefetched automatically, including across the final/first album boundary. The album-ID-to-position map is built with bounded, paged `tags:s` requests.

`js/resilience.js` retains successful read-only `players` and `albums` RPC responses in browser local storage. If LMS is temporarily unreachable, those responses can be replayed so previously seen catalogue data remains available while normal reconnect attempts continue. Stale replayed catalogue responses are explicitly marked so Status/About can distinguish cached from live data. Mutating/player-control RPC calls are deliberately never cached or replayed.

CometD subscribes to player status and LMS `serverstatus`. When a library scan completes, Lyrion Carousel refreshes the catalogue, album count and position index once. Status/About reports LMS connectivity and CometD/live-update state separately.

### Reconnect acceptance check

Before deployment to a dedicated controller, exercise this sequence against the real LMS installation: start Lyrion Carousel and browse enough of the library to populate browser/artwork caches; stop LMS; confirm previously cached catalogue/artwork remains browsable and playback controls fail safely; restart LMS; confirm the connection and live-update indicators recover and playback commands work again without reloading the page. This is an integration test and cannot be considered passed until run against the actual LMS service.

## Carousel density

Density changes the geometry of the complete carousel rather than scaling only the front face of each jewel case. Compact tightens case size/spread/step, Normal uses the reference geometry, and Spacious increases them. The physical case remains a single coherent object in every mode.

## Performance

The signature interaction is intentionally based on compositor-friendly `translate3d`/rotation transforms. Jewel cases are marked for transform/filter/opacity compositing. Catalogue batching limits the number of album elements/artworks normally present at once rather than constructing the entire library up front.

`js/performance.js` uses `PerformanceObserver` where supported to report main-thread tasks of 100 ms or longer to the developer console. It does **not** run a permanent `requestAnimationFrame` loop or add polling while the carousel is idle. Final acceptance should include measured frame-rate/memory testing on the intended controller/display hardware with the full library.

## Web-app / kiosk use

`manifest.webmanifest`, the application icon and fullscreen display metadata allow Lyrion Carousel to behave more like a dedicated appliance when installed/launched from a supporting browser. This does not add a service worker or attempt to cache the application shell; LMS reconnection and catalogue fallback remain explicit application behaviours.

The planned wall-controller/display hardware is documented separately in [`docs/wall-controller.md`](docs/wall-controller.md).

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
- Final reconnect acceptance still needs to be exercised against the actual LMS installation.
- Final 60 fps/memory acceptance testing still needs to be performed on the intended controller hardware.
