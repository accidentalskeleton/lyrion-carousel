# Lyrion album browser

A lightweight browser/controller for Lyrion Music Server (LMS), using a circular book-fan album interface. The default LMS URL is `http://mrlazy:9000`.

## Features

- connected LMS/Squeezebox/Squeezelite player discovery and selection;
- circular album browsing with incremental 40-album batches;
- lightweight album-ID → `sort:artflow` position index for direct jumps;
- persistent local artwork cache;
- event-driven library refresh after LMS scans complete;
- album/artist search and A–Z navigation;
- shamrock random-album selection with a configurable maximum animation time;
- click/tap a cover to load and play that album;
- LMS CometD long-polling for live playback and server/library state;
- current track, track number and locally advancing progress display;
- current-track details are dimmed while browsing an album other than the playing album;
- automatic return to the playing album after an idle period;
- saved player and album position across browser sessions;
- automatic LMS reconnection.

## Source layout

The browser is deliberately framework-free and uses native ES modules:

```text
album-browser-poc/
├── index.html                 # markup only
├── css/
│   └── album-browser.css      # presentation
├── js/
│   ├── app.js                 # application state and orchestration
│   ├── lms.js                 # LMS JSON-RPC and CometD lifecycle
│   ├── catalogue.js           # album-position index helpers
│   └── browser.js             # circular-browser maths
├── server.py                  # static server + LMS/artwork proxies
└── README.md
```

There is no Node/npm dependency and no build step. `server.py` does not rewrite or inject JavaScript into `index.html`; it serves the client files normally and provides only the required API proxies and artwork cache.

## Run directly

```bash
python3 server.py
```

Open `http://127.0.0.1:8088/`. To make it available on the LAN:

```bash
python3 server.py --bind 0.0.0.0
```

`0.0.0.0` is a listening address, not a browser destination. Do not expose this development server directly to the internet.

## Runtime options

| Option | Default | Purpose |
| --- | ---: | --- |
| `--lms` | `http://mrlazy:9000` | Lyrion Music Server base URL |
| `--bind` | `127.0.0.1` | Controller listening address |
| `--port` | `8088` | Controller HTTP port |
| `--cache-dir` | `.cache/album-art` | Persistent artwork location |
| `--clear-cache` | off | Delete the persistent artwork cache before starting |
| `--batch-size` | `40` | Albums fetched per LMS catalogue request |
| `--idle-return-seconds` | `30` | Inactivity before returning to now playing; `0` disables |
| `--reconnect-max-seconds` | `30` | Maximum reconnect delay |
| `--random-scroll-max-seconds` | `3` | Maximum shamrock animation duration |
| `--search-limit` | `100` | Maximum albums returned by a search |

Periodic playback polling and the old periodic library-count check have been removed. CometD provides live player status and server scan state; one-shot status requests are used only for initial state and command confirmation.

## Artwork cache

Artwork is fetched through `/api/art/<artwork-id>` and stored on disk using a key derived from the LMS URL and artwork ID. Direct runs use `.cache/album-art` unless `--cache-dir` is supplied. Browsing still prefetches the current and neighbouring album batches, so their artwork is warmed naturally without tying cache population to library-change detection.

Clear the cache at startup with:

```bash
python3 server.py --bind 0.0.0.0 --clear-cache
```

This clears only the server-side artwork cache. It does not alter LMS, the music library, or browser local storage.

## Catalogue loading and library changes

LMS is queried in fixed batches using `albums <start> <batch-size> sort:artflow tags:ajlys`. The current and neighbouring batches are fetched automatically, including across the final/first album boundary.

A lightweight catalogue request using `tags:s` builds an album-ID-to-position map. Idle return, saved-position restoration, search-result navigation and playback changes can therefore fetch the required batch directly instead of walking the whole catalogue.

The CometD session also subscribes to LMS `serverstatus` with change-only updates (`subscribe:0`). The client tracks the `rescan` state. When LMS reports a transition from scanning to scan complete, the browser reloads once so the catalogue, album count and lightweight position index are rebuilt from the completed library. There is no 30-second album-count polling loop.

## Playback and CometD

`js/lms.js` owns the CometD session. A single CometD client subscribes to both the selected player's status and LMS server status. Starting a session explicitly cancels the previous generation, and page exit/player changes disconnect the previous client before a new handshake/subscription is created. This prevents stale long-poll sessions from continuing to drive the UI.

The progress display advances locally between live LMS updates. When the fan is centred on an album other than the playing album, the current-track line and progress bar are dimmed while the browsed album title and artist remain fully visible.

## Server endpoints

`server.py` is intentionally small and is not a general-purpose proxy:

- `/api/lms` → LMS JSON-RPC;
- `/api/cometd` → LMS CometD;
- `/api/art/<artwork-id>` → LMS artwork with persistent disk caching;
- `/api/config` → runtime browser settings.

All HTML, CSS and JavaScript are served as ordinary static files by `SimpleHTTPRequestHandler`.

## Limitations

- LMS password authentication is not yet implemented.
- Search is capped by `--search-limit` (100 by default).
- Artwork cache eviction and automatic cover-change invalidation are not yet implemented.
- Library refresh is driven by LMS scan completion; changes not incorporated into LMS's database are intentionally invisible to the browser.
- This remains experimental software and is not part of the current hi-fi build order.
