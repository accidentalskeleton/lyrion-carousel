# Lyrion Carousel

Lyrion Carousel is a standalone album-browsing and playback-control interface for Lyrion Music Server (LMS). This experimental branch presents the library as a circular shelf of CD spines with an opening album cover. It replaces the earlier photorealistic/WebGL experiment with a CSS shelf; no remote renderer or font downloads are required.

Current application version: **0.8.1**. The canonical version is stored in [`VERSION`](VERSION). Do not change the application version as part of ordinary development work; it is changed only when explicitly requested.

## Features

- connected LMS/Squeezebox/Squeezelite player discovery and selection;
- circular CD shelf with artwork-derived spine colours, stable readable font choices, and configurable displayed-album count;
- saved artist/album, album-only, or random display mode; random order is retained across library refreshes within the session;
- startup directly on the currently playing album, or a randomly selected display album when nothing is playing;
- bounded catalogue requests (40 albums by default), with a complete catalogue loaded for display ordering and only a window of spines rendered;
- paged album-ID → `sort:artflow` position index for direct jumps;
- persistent server-side artwork cache;
- browser-side cached LMS discovery/catalogue fallback for temporary LMS outages;
- event-driven library refresh after LMS scans complete;
- album/artist search and A–Z navigation;
- shamrock random-album selection with configurable animation duration;
- click/tap a spine to preview its cover; use the cover’s play button or album menu to start playback;
- long-press a cover to clear the playlist and play it, play it now, play it after the current album, add it to the queue, or open Album Information;
- LMS CometD long-polling for live playback and server/library state;
- current track, track number and locally advancing progress display;
- configurable idle return that scrolls to and opens the playing album, bounded by the maximum scroll duration;
- keep-playing-cover-open setting, enabled by default; the cover moves with its album when scrolling;
- saved player selection across browser sessions;
- live configurable display count, preview/menu timeouts, idle return and maximum scroll duration;
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

There is no Node/npm runtime dependency and no build step. Python 3.9+ and Pillow are required; the Debian package installs `python3-pil`. `server.py` serves the client files and provides the required LMS/CometD/artwork API proxies and artwork cache.

## Run directly

On Debian/Ubuntu, install the image dependency first with `sudo apt install python3-pil`. On other systems install Pillow into your Python environment.

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
| `--random-scroll-max-seconds` | `3` | Maximum random/startup/idle-return scroll duration |
| `--search-limit` | `100` | Maximum albums returned by a search |

Settings apply immediately and are saved in this browser. They include LMS URL, player, idle return, menu/preview timeouts, maximum scroll duration, displayed albums and keeping the playing cover open. The obsolete carousel-density control has been removed; use Displayed albums to set spine width and spacing.

The server URL is shared runtime state on the proxy. Set `LMS_URL` in `/etc/default/lyrion-carousel` for a persistent machine-wide default. Saved browser choices override server defaults; the saved LMS URL is applied before initial discovery.

## Startup and browsing behaviour

Startup discovers players and loads the catalogue. If an album is playing, the shelf scrolls to it and opens its cover. Otherwise it scrolls to a random position without opening a cover or sending a playback command. Startup, random selection and idle return use the maximum scroll duration from Settings.

After the idle delay, the shelf returns to the playing album and opens its cover. Its preview does not time out. With **Keep playing album open** enabled (the default), it stays open while scrolling and moves with its position on the shelf; it can move offscreen and return as you browse. Clicking another spine temporarily previews that album; closing it or letting its preview time out restores the playing cover. When playback changes to another album, the shelf follows and opens the new cover. Turn the option off to restore click-to-close and scroll-to-dismiss behaviour; idle return will still open the playing cover.

A short click on an ordinary preview or the surrounding shelf closes it. Hold a spine or cover for roughly half a second to open album actions. The cover’s play button loads that album. Search, Settings and Album Information appear above the shelf, and their input controls do not navigate the shelf.

The detail area shows the album under the pointer; outside the shelf it shows the playing album, or clears when nothing is playing. Track details and progress appear only for the playing album. The heading stays at the same vertical position in both states.

## Colour ordering

Choose **Colour** in the album-order menu to arrange spines from red through yellow, green, blue and violet. Nearly neutral colours follow, dark to light; albums with unavailable artwork sort last. Equal colours are ordered by artist and title. The choice persists across reloads and catalogue refreshes.

The server derives a numeric `colour_index` from each cached spine colour and upgrades older metadata without refetching artwork. The first colour sort may take longer while metadata is gathered for the whole library, using six shared server workers while the browser shows a preparation message. Subsequent sorts reuse the cache. Restart the Python server after installing this change.

## Shelf rendering and metadata

Artwork is fetched through `/api/art/<artwork-id>` and cached on disk. `/api/art-meta/<artwork-id>` supplies `spine_color`, `text_color`, `spine_font` and `colour_index`; existing colour-only caches upgrade automatically. Fonts are chosen deterministically from local sans-serif and serif stacks. Actual typefaces depend on the fonts installed on the display device.

Labels scale with spine width, truncate with an ellipsis and retain their full text on hover. Colour is inset from the clear end caps, with additional text padding. Open covers and their gaps share the album’s scrolling position. Browser artwork URLs include the LMS identity to avoid reusing another server’s artwork with the same ID.

## Catalogue loading, persistence and outages

LMS is queried in fixed batches using `albums <start> <batch-size> sort:artflow tags:ajlys`. Current and neighbouring batches are prefetched automatically, including across the final/first album boundary. Ordering loads all album records through those bounded requests; it does not send an unbounded whole-library RPC. Artwork and metadata are loaded for displayed spines. The fallback album-ID-to-position map uses bounded, paged `tags:s` requests.

`js/resilience.js` retains successful read-only `players` and `albums` RPC responses in browser local storage. If LMS is temporarily unreachable, those responses can be replayed so previously seen catalogue data remains available while normal reconnect attempts continue. Stale replayed catalogue responses are explicitly marked so Status/About can distinguish cached from live data. Mutating/player-control RPC calls are deliberately never cached or replayed.

CometD subscribes to player status and LMS `serverstatus`. When a library scan completes, Lyrion Carousel refreshes the catalogue, album count and position index once. Status/About reports LMS connectivity and CometD/live-update state separately.

### Reconnect acceptance check

Before deployment to a dedicated controller, exercise this sequence against the real LMS installation: start Lyrion Carousel and browse enough of the library to populate browser/artwork caches; stop LMS; confirm previously cached catalogue/artwork remains browsable and playback controls fail safely; restart LMS; confirm the connection and live-update indicators recover and playback commands work again without reloading the page. This is an integration test and cannot be considered passed until run against the actual LMS service.

## Performance

The signature interaction is intentionally based on compositor-friendly `translate3d`/rotation transforms. Only the configured window of spines is constructed. Catalogue records are retained for ordering, while artwork is fetched for visible albums. Geometry helpers are pure and do not create an extra renderer or idle animation loop.

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
- `/api/art-meta/<artwork-id>` → cached spine colour, text contrast and font;
- `/api/config` → runtime defaults;
- `/api/config/lms` → change the proxy LMS URL (POST);
- `/api/cache/clear` → clear persistent artwork and metadata (POST).

## Current limitations

- LMS password authentication is not yet implemented.
- Search is capped by `--search-limit` (100 by default).
- Artwork is evicted above 512 MB; automatic detection of changed covers under the same artwork ID is not implemented.
- Browser catalogue fallback only contains read-only LMS responses previously seen by that browser; it is not an independent mirror of the complete LMS database.
- Final reconnect acceptance still needs to be exercised against the actual LMS installation.
- Final 60 fps/memory acceptance testing still needs to be performed on the intended controller hardware.

## Regression checks

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/regressions.mjs
```

Node is needed only for the JavaScript regression runner. It uses DOM/event doubles and mocked LMS responses; it does not start playback. It checks catalogue paging, scan events, server-switch isolation, display ordering, startup, pinned covers and details. These checks do not replace real-browser visual/touch checks or the live LMS reconnect acceptance sequence above.

Colour metadata requests populate missing artwork directly on the server and return only metadata, avoiding full-cover transfers to the browser during colour ordering. Existing disk metadata is reused. Restart the server after updating this behaviour.


Album ordering is prepared by `/api/catalogue?order=artistAlbum|album|colour|random`: the server reads LMS in bounded pages and returns the ordered catalogue, including spine metadata for colour order. Settings → Album cover size selects 128, 256, 384, 512 (default), 768 or 1024 pixels. This controls downloaded image resolution, not the physical size of the open case. JPEG derivatives preserve aspect ratio, never upscale, and share the existing cache limit and clear action. Restart the server after this update.
