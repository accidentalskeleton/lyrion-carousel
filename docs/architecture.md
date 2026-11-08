# Architecture, catalogue and server API

[← Project overview](../README.md)

## Project layout and catalogue-number metadata

Spine footers show real catalogue numbers and can be shown or hidden in
Settings → Display → Catalogue codes. The choice is saved per browser and
codes are shown by default. Carousel retrieves catalogue numbers **exclusively
through LMS's read-only raw track-tag API** (`tags track_id:<id>`), obtaining
`CATALOGNUMBER` from the album's first track when present. LMS reads the music
file on its own host; Carousel never opens the FLAC, invokes `metaflac`, or
reads the ripper's release metadata. This works without direct access to music folders or ripping-engine data.
Albums with no actual catalogue number show no code and retain the full title
area. Only displayed albums are looked up in bounded batches. Server lookups,
including missing numbers, are cached for 15 minutes with a 2,048-entry limit;
the browser also keeps at most 2,048 results. Hiding codes stops new lookups.

```text
lyrion-carousel/
├── VERSION
├── index.html
├── manifest.webmanifest
├── assets/
├── css/
├── docs/
│   ├── spotify-spotty.md
│   ├── wall-controller.md
│   ├── getting-started.md
│   ├── deployment.md
│   ├── usage.md
│   ├── architecture.md
│   ├── performance.md
│   └── development.md
├── js/
├── packaging/debian/
├── spotty-diagnostic.html
├── tests/
├── server.py
└── README.md
```

There is no Node/npm runtime dependency and no build step. Python 3.9+ and Pillow are required; the Debian package installs `python3-pil`. `server.py` serves the client files and provides the required LMS/CometD/artwork API proxies and artwork cache.

## Catalogue loading, persistence and outages

`/api/catalogue?order=artistAlbum|album|colour|random` reads LMS in pages of up to 200 albums and returns the full ordered catalogue. Colour order includes prepared spine metadata, calculated using six shared server workers. The browser receives the prepared order and renders nearby albums. Catalogue records are fetched again when ordering or refreshing; the catalogue itself is not persistently cached on the server.

Browser fallback/index requests remain bounded by `--batch-size`. `js/resilience.js` caches successful read-only `players` and `albums` RPC responses in local storage; mutating and player-control calls are never replayed. This cache does not cover `/api/catalogue`, so a fresh load or sort change still requires LMS connectivity. An already loaded catalogue can remain visible during an outage while reconnection is attempted.

CometD subscribes to player status and LMS `serverstatus`. When a library scan completes, Lyrion Carousel refreshes the catalogue, album count and position index once. Status/About reports LMS connectivity and CometD/live-update state separately.

### Reconnect acceptance check

Before deployment to a dedicated controller, exercise this sequence against the real LMS installation: start Lyrion Carousel and browse enough of the library to populate browser/artwork caches; stop LMS; confirm previously cached catalogue/artwork remains browsable and playback controls fail safely; restart LMS; confirm the connection and live-update indicators recover and playback commands work again without reloading the page. This is an integration test and cannot be considered passed until run against the actual LMS service.

## Large-library catalogue snapshots

The first cold catalogue request still reads LMS in bounded 200-album pages. Subsequent sort changes reuse the same catalogue, including after restarting Carousel while the snapshot is still fresh. The snapshot lasts up to 15 minutes as a fallback when library events are unavailable. When Carousel observes an LMS scan finishing through the standard CometD server-status stream, **Carousel independently reconciles** its own snapshot against LMS. If album rows have not changed, it preserves the existing unfiltered sort cache and skips rebuilding the browser catalogue. The ripper and LMS do not invoke any Carousel-specific API or hook. Genre-exclusion album IDs are indexed only on first use and saved alongside the snapshot. Non-random prepared orders are retained in a four-entry in-memory response cache; random order is shuffled afresh each time.

The snapshot is stored separately from image files under the existing Carousel cache directory. Clearing the artwork cache also removes catalogue snapshots, but **does not reset the selected LMS server**. **Colour ordering now maintains a separate incremental SQLite index** (at `/var/cache/lyrion-carousel/artwork/colour-index-v1-*.sqlite3` for the packaged service). Every batched spine-metadata response can add newly discovered colours. Switching to colour order processes only artwork whose colour is not yet indexed, then saves the additional rows in a single SQLite transaction. Entries survive service restarts and do **not** require rewriting the entire catalogue JSON snapshot on each scroll. The `/api/catalogue/status` response reports `colour_indexes` for the current LMS.

**Automatic indexing of newly added albums:** after detecting an actual catalogue change, Carousel queues newly introduced artwork IDs for a single low-priority background worker. The worker yields to recent browser artwork/metadata activity and shares the existing cache-clear coordination lock; it saves successful colours in the same persistent SQLite index. When the browser switches to Spotify, the catalogue can still be reconciled without forcing the Spotify UI to reload. An offline Carousel may instead discover changes after its normal snapshot expiry. **Cold-start limitation:** if covers have never been viewed or analysed and no prior snapshot was available, a first colour sort can still take time. Failed background artwork requests are retried through normal metadata access or a later colour sort, and an in-progress background queue does not survive a Carousel process restart.

### LMS URL across service restarts

The installed systemd service uses `LMS_URL` from `/etc/default/lyrion-carousel` as the **initial fallback** (currently `http://streamer:9000`). Once the Connection settings page selects another LMS, Carousel now writes that choice to `/var/cache/lyrion-carousel/lyrion-carousel-lms.json` (the parent of the configured `CACHE_DIR`). The saved server takes precedence on subsequent restarts, even before any browser reconnects. It is deliberately outside the artwork cache so Settings → Clear Cache does not remove it.

To use the local LMS on the streamer, change its URL in Carousel's Connection settings to `http://streamer:9000` after deploying this version, or POST:

```bash
curl -sS -X POST http://127.0.0.1:8088/api/config/lms \
  -H 'Content-Type: application/json' \
  -d '{"lms_url":"http://streamer:9000"}' | python3 -m json.tool
```

Verify `/api/config` returns `streamer:9000` both before and after restarting `lyrion-carousel.service`. This prevents a restart from silently loading a different LMS's catalogue snapshot.

Inspect the catalogue cache without triggering a new LMS scan:

```bash
curl -s http://127.0.0.1:8088/api/catalogue/status | python3 -m json.tool
```

The `cached` field should be `true` after the catalogue has loaded. To measure the improvement, compare a first cold sort against subsequent sort changes with the browser Network tab and watch the absence of repeated LMS catalogue page requests.

## Server endpoints

`server.py` is intentionally small and is not a general-purpose proxy:

- `/api/lms` → LMS JSON-RPC;
- `/api/cometd` → LMS CometD;
- `/api/catalogue?order=artistAlbum|album|colour|random` → server-prepared ordered catalogue from a disk-backed snapshot (15-minute TTL);
- `/api/catalogue/status` → catalogue state, album and colour counts, plus background-colour indexing progress (GET, never contacts LMS);
- `/api/catalogue/reconcile` → Carousel-owned change check after observing an LMS scan finish (POST). Compares album data, updates snapshot only as necessary, and queues new cover colours in the background;
- `/api/catalogue/invalidate` → explicitly discard the catalogue snapshot (POST), without modifying LMS;
- `/api/art/<artwork-id>?size=512` → cached resized cover; omit size for original artwork;
- `/api/art-meta/<artwork-id>` → cached spine colour, text contrast, font and colour index;
- `/api/art-meta` → prepare metadata for up to 64 artwork IDs (POST);
- `/api/config` → runtime defaults;
- `/api/config/lms` → change the proxy LMS URL (POST);
- `/api/cache/clear` → clear persistent artwork and metadata (POST);
- `/api/cache/warm` → start/cancel background artwork preparation (POST);
- `/api/config/cache` → change the runtime soft artwork-cache limit (POST);
- `/api/spotty-art` → proxy/cache Spotty artwork and optional jewel-case composition;
- `/api/spotty-art-meta` → derive shelf metadata from Spotty artwork;
- `/api/diagnostics/spotty` → inspect the live LMS Spotty menu payload;
- `/api/diagnostics/now-playing` → inspect the raw LMS status used for source-aware now-playing matching.

## Current limitations

- LMS password authentication is not yet implemented.
- Search is capped by `--search-limit` (100 by default).
- Original and resized artwork share a 512 MB image-cache limit; automatic detection of changed covers under the same artwork ID is not implemented.
- Browser catalogue fallback only contains read-only LMS responses previously seen by that browser; it is not an independent mirror of the complete LMS database.
- Final reconnect acceptance still needs to be exercised against the actual LMS installation.
- Final 60 fps/memory acceptance testing still needs to be performed on the intended controller hardware.
