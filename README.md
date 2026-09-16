# Lyrion Carousel

Lyrion Carousel is the album-browsing and playback-control interface for Lyrion Music Server (LMS) in this hi-fi project. It presents the library as a circular, book-like carousel of CD jewel cases while keeping the normal listening screen deliberately uncluttered.

The default LMS URL is `http://mrlazy:9000`.

## Features

- connected LMS/Squeezebox/Squeezelite player discovery and selection;
- circular book/page-style album carousel with realistic jewel-case presentation;
- incremental 40-album catalogue batches with neighbouring-batch prefetch;
- lightweight album-ID → `sort:artflow` position index for direct jumps;
- persistent local artwork cache;
- event-driven library refresh after LMS scans complete;
- album/artist search and A–Z navigation;
- shamrock random-album selection with configurable animation duration;
- click/tap a cover to load and play that album;
- LMS CometD long-polling for live playback and server/library state;
- current track, track number and locally advancing progress display;
- current-track details dim while browsing away from the playing album;
- configurable automatic return to the playing album after an idle period;
- saved player and album position across browser sessions;
- configurable carousel density;
- Settings panel containing Player, Idle return, Random scroll duration, Carousel density and Status/About;
- automatic LMS reconnection.

## Source layout

The application is deliberately framework-free and uses native ES modules:

```text
lyrion-carousel/
├── index.html
├── assets/
│   └── jewel-case-overlay.svg
├── css/
│   ├── album-browser.css
│   ├── jewel-overlay.css
│   └── settings.css
├── js/
│   ├── app.js
│   ├── browser.js
│   ├── catalogue.js
│   ├── lms.js
│   ├── settings-runtime.js
│   └── settings.js
├── packaging/
│   └── debian/
├── server.py
└── README.md
```

There is no Node/npm dependency and no build step. `server.py` serves the client files normally and provides the required LMS/CometD/artwork API proxies and artwork cache.

## Run directly

```bash
cd software/lyrion-carousel
python3 server.py
```

Open `http://127.0.0.1:8088/`. To make it available on the LAN:

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

Player, idle return, random-scroll duration and carousel density can also be selected in the in-app Settings panel. Browser settings are stored locally.

Periodic playback polling and the old periodic library-count check are not used. CometD provides live player status and server scan state; one-shot status requests are used for initial state and command confirmation.

## Artwork and carousel rendering

Artwork is fetched through `/api/art/<artwork-id>` and cached on disk. The carousel uses the real LMS artwork as the booklet image and a reusable transparent jewel-case overlay for the physical case appearance. The visual case is deliberately separated from the carousel movement so the page-like browsing geometry can be tuned independently of the jewel-case artwork.

Browsing prefetches the current and neighbouring catalogue batches so artwork is warmed naturally.

Clear the server-side artwork cache at startup with:

```bash
python3 server.py --bind 0.0.0.0 --clear-cache
```

This does not alter LMS, the music library or browser local storage.

## Catalogue loading and library changes

LMS is queried in fixed batches using `albums <start> <batch-size> sort:artflow tags:ajlys`. The current and neighbouring batches are fetched automatically, including across the final/first album boundary.

A lightweight catalogue request using `tags:s` builds an album-ID-to-position map. Idle return, saved-position restoration, search-result navigation and playback changes can therefore fetch the required batch directly instead of walking the entire catalogue.

The CometD session subscribes to LMS `serverstatus` with change-only updates. When a library scan completes, Lyrion Carousel refreshes the catalogue, album count and position index once.

## Playback and CometD

`js/lms.js` owns the CometD session. A single client subscribes to both the selected player's status and LMS server status. Player changes cleanly replace the previous subscription/session.

The progress display advances locally between LMS updates. When the carousel is centred on an album other than the playing album, current-track information is dimmed while the browsed album title and artist remain prominent.

## Server endpoints

`server.py` is intentionally small and is not a general-purpose proxy:

- `/api/lms` → LMS JSON-RPC;
- `/api/cometd` → LMS CometD;
- `/api/art/<artwork-id>` → LMS artwork with persistent disk caching;
- `/api/config` → runtime defaults.

## Debian packaging

Build the package from `software/lyrion-carousel` with:

```bash
packaging/debian/build-deb.sh
```

The package/service names are consistently `lyrion-carousel`:

- package: `lyrion-carousel`;
- service: `lyrion-carousel.service`;
- configuration: `/etc/default/lyrion-carousel`;
- application: `/opt/lyrion-carousel`;
- artwork cache: `/var/cache/lyrion-carousel/artwork`.

## Current limitations

- LMS password authentication is not yet implemented.
- Search is capped by `--search-limit` (100 by default).
- Artwork cache eviction and automatic cover-change invalidation are not yet implemented.
- Library refresh is driven by LMS scan completion; changes not incorporated into LMS's database are intentionally invisible to the application.
