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
├── indexed_order.py
├── packaging/debian/
├── spotty-diagnostic.html
├── tests/
├── server.py
└── README.md
```

There is no Node/npm runtime dependency and no build step. Python 3.9+ and Pillow are required; the Debian package installs `python3-pil`. `server.py` serves the client files and provides the required LMS/CometD/artwork API proxies and artwork cache.

## Catalogue loading, persistence and outages

`/api/catalogue?order=artistAlbum|album|colour|random|indexed|recent` serves the chosen album order from LMS data. The public labels **Recently Added** and **New Music (LMS)** map to internal `indexed` and `recent`, respectively; the identifiers are intentionally unchanged for saved preferences. The first cold catalogue load requests LMS albums in pages of up to 200 records; a persisted snapshot (described below) and a small in-memory prepared-order cache avoid refetching the whole catalogue on every sort change. Colour order can prepare missing spine metadata with six shared workers, and the browser renders only nearby albums.

Browser fallback/index requests remain bounded by `--batch-size`. `js/resilience.js` caches successful read-only `players` and `albums` RPC responses in local storage; mutating and player-control calls are never replayed. This cache does not cover `/api/catalogue`, so a fresh load or sort change still requires LMS connectivity. An already loaded catalogue can remain visible during an outage while reconnection is attempted.

CometD subscribes to player status and LMS `serverstatus`. When a library scan completes, Lyrion Carousel refreshes the catalogue, album count and position index once. Status/About reports LMS connectivity and CometD/live-update state separately.

### Reconnect acceptance check

Before deployment to a dedicated controller, exercise this sequence against the real LMS installation: start Lyrion Carousel and browse enough of the library to populate browser/artwork caches; stop LMS; confirm previously cached catalogue/artwork remains browsable and playback controls fail safely; restart LMS; confirm the connection and live-update indicators recover and playback commands work again without reloading the page. This is an integration test and cannot be considered passed until run against the actual LMS service.

## Large-library catalogue snapshots

The first cold catalogue request still reads LMS in bounded 200-album pages. Subsequent sort changes reuse the same catalogue, including after restarting Carousel while the snapshot is still fresh. The snapshot lasts up to 15 minutes as a fallback when library events are unavailable. When Carousel observes an LMS scan finishing through the standard CometD server-status stream, **Carousel independently reconciles** its own snapshot against LMS. If album rows have not changed, it preserves the existing unfiltered sort cache and skips rebuilding the browser catalogue. The ripper and LMS do not invoke any Carousel-specific API or hook. Genre-exclusion album IDs are indexed only on first use and saved alongside the snapshot. Non-random prepared orders are retained in a four-entry in-memory response cache; random order is shuffled afresh each time.

The snapshot is stored separately from image files under the existing Carousel cache directory. Clearing the artwork cache also removes catalogue snapshots, but **does not reset the selected LMS server**. **Colour ordering now maintains a separate incremental SQLite index** (at `/var/cache/lyrion-carousel/artwork/colour-index-v1-*.sqlite3` for the packaged service). Every batched spine-metadata response can add newly discovered colours. Switching to colour order processes only artwork whose colour is not yet indexed, then saves the additional rows in a single SQLite transaction. Entries survive service restarts and do **not** require rewriting the entire catalogue JSON snapshot on each scroll. The `/api/catalogue/status` response reports `colour_indexes` for the current LMS.

**Automatic indexing of newly added albums:** after detecting an actual catalogue change, Carousel queues newly introduced artwork IDs for a single low-priority background worker. The worker yields to recent browser artwork/metadata activity and shares the existing cache-clear coordination lock; it saves successful colours in the same persistent SQLite index. When the browser switches to Spotify, the catalogue can still be reconciled without forcing the Spotify UI to reload. An offline Carousel may instead discover changes after its normal snapshot expiry. **Cold-start limitation:** if covers have never been viewed or analysed and no prior snapshot was available, a first colour sort can still take time. Failed background artwork requests are retried through normal metadata access or a later colour sort, and an in-progress background queue does not survive a Carousel process restart.

### Album date ordering implementation

Carousel offers two independent Library-only date orders. Both are newest-first, honour genre exclusions and use the non-wrapping shelf. The menu names differ from the internal API values for backward compatibility:

| Public menu label | `/api/catalogue?order=` | Data source |
| --- | --- | --- |
| **Recently Added** | `indexed` | Carousel's index of the current LMS library's track-added timestamps |
| **New Music (LMS)** | `recent` | LMS native `albums ... sort:new` ranking |

**Why native LMS New Music may appear wrong for a new compilation.** In LMS's [album query code](https://github.com/LMS-Community/slimserver/blob/e656a5028b9b46fd715a0150ea189333095bcfc6/Slim/Control/Queries.pm), `sort:new` orders by `MIN(tracks_persistent.added) DESC`. The value comes from persistent recording records rather than exclusively from tracks newly indexed on that release. LMS can associate the same recording with different release tracks, particularly when they share a MusicBrainz Recording ID. A new compilation or greatest-hits album containing an already-known recording can therefore inherit an older persistent timestamp. The use of **MIN** means just one previously known recording may affect the whole album's rank.

For example, Elastica's *2:1* on *Elastica* and *Trainspotting: Music From the Motion Picture* can share the same MusicBrainz Recording ID but have distinct MusicBrainz Release Track IDs. This is legitimate metadata. Identical IDs do **not** guarantee bit-identical audio files or identical masterings. Neither editing these IDs nor using FLAC modification times is a reliable solution to the album-order problem.

**Carousel's alternative.** `indexed_order.py` requests standard LMS JSON-RPC `titles` pages with `tags:eD`: tag `e` requests the album ID and tag `D` the current track's `addedTime`. The [LMS track-tag mapping](https://github.com/LMS-Community/slimserver/blob/e656a5028b9b46fd715a0150ea189333095bcfc6/Slim/Control/Queries.pm) and [track `addedTime` implementation](https://github.com/LMS-Community/slimserver/blob/e656a5028b9b46fd715a0150ea189333095bcfc6/Slim/Schema/Track.pm) distinguish `tracks.added_time` from `tracks_persistent.added`. Carousel groups the current track timestamps by album ID and takes the **minimum valid timestamp for each album**, then sorts albums by that value descending. It never queries the LMS SQLite database directly and has no dependency on the Pi ripper or any particular tagging pipeline.

**Persistence and performance.** The index is a separate per-LMS-URL SQLite file, `indexed-order-v1-<server-hash>.sqlite3`, under Carousel's configured artwork cache directory (normally `/var/cache/lyrion-carousel/artwork/` for the Debian package). Each record stores the LMS album ID, a small album-identity signature (artist, title, year and disc), and the timestamp. On a cold selection with at least 25 unknown albums, Carousel streams all LMS titles in bounded **1,000-track pages**, retaining only the required minimum timestamp per album in memory. For fewer than 25 unknown albums it requests `titles` pages filtered to individual album IDs. It commits new dates only after the necessary requests succeed, so a failed partial scan is not stored as a complete result. The existing four-entry in-memory prepared-order cache avoids additional work on repeated selections.

**What remains stable, and what cannot be recovered.** Ordinary rescans, retagging, track repairs, catalogue-snapshot expiry and Carousel restarts do not promote an album already recorded under the same ID and identity. On a newly discovered album or changed identity the current LMS dates are queried again. If LMS's database is entirely rebuilt, its historical track-added timestamps may change or be lost. Carousel can retain dates already observed under matching IDs and identities, but cannot reconstruct dates it has never seen or reliably recognise every album if IDs were recycled. Missing or unusable timestamps are placed last with deterministic artist/title/ID tie-breaking. These are **library-index dates**, not independently verified original rip dates.

See [Understanding album date ordering](usage.md#understanding-album-date-ordering) for the user-facing explanation and example. No LMS changes are required.

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
