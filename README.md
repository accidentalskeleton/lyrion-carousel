![Lyrion Carousel album shelf](assets/lyrion-carousel-banner.jpg)

[Watch the short feature tour](assets/lyrion-carousel-feature-tour.mp4)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support-FFDD00?logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/stuliet)

# Lyrion Carousel

Lyrion Carousel is a standalone album-browsing and playback-control interface for Lyrion Music Server (LMS). Browse the library as a circular shelf of CD spines, with enlarged jewel-case artwork when you select an album. It uses CSS transforms; no WebGL renderer or remote font downloads are required.

Current application version: **0.11.7**. The canonical version is stored in [`VERSION`](VERSION). Do not change the application version as part of ordinary development work; it is changed only when explicitly requested.

## Features

- connected LMS/Squeezebox/Squeezelite player discovery and selection;
- circular CD shelf with artwork-derived spine colours, stable readable font choices, and configurable displayed-album count;
- optional shelf variety with stable title alignment, artist/title hierarchy, print treatments, subtle case wear, catalogue typography and 1.5× multi-disc spines;
- shelf-only display with server-prepared artist/album, album-only, colour, random or **Recently Added** ordering; Recently Added uses LMS's recorded first-added date, newest first, and stops at both shelf ends instead of wrapping; random order is retained across library refreshes within the session;
- startup directly on the currently playing album, or a randomly selected display album when nothing is playing;
- server-prepared catalogue ordering using bounded LMS pages, with only nearby albums rendered; a 15-minute persistent catalogue snapshot avoids rescanning LMS for every sort or genre-filter change;
- paged album-ID → `sort:artflow` position index for direct jumps, plus validated in-memory ID-to-index lookups during animation;
- persistent server-side artwork and spine metadata cache, plus resized covers (128–1024 px); local spine metadata is fetched in 64-ID batches, with at most two concurrent batches and a bounded browser-side metadata LRU;
- browser-side caching of read-only LMS discovery and album RPCs; prepared ordering requires LMS connectivity;
- event-driven library refresh after LMS scans complete, invalidating the server catalogue snapshot before reloading;
- album/artist search and A–Z navigation;
- shamrock short press to play a random album, or hold for 600 ms to choose Long Forgotten, Rarely Played or Rediscover Something; discovery opens an album cover without changing playback or the current shelf ordering (LMS 9.1+, local library only);
- click/tap a spine to preview its realistic closed cover; drag/swipe the cover left or right to scroll spines without opening the next cover; the playing album stays enlarged throughout scrolling and automatic idle return, while clicking a spine can temporarily preview another album; long-press the cover for the album menu (including Album Information), or use its separate play button to start playback;
- long-press a cover to clear the playlist and play it, play it now, play it after the current album, add it to the queue, or open Album Information;
- LMS CometD long-polling for live playback and server/library state;
- current track, track number and locally advancing progress display;
- compact previous, play/pause and next-track controls;
- configurable application screen sleep with touch-to-wake protection against accidental commands;
- swipe-up play queue with current-track highlighting and direct track selection;
- configurable idle return that scrolls back to the playing album without closing or reopening its enlarged cover, bounded by the maximum scroll duration;
- permanently enlarged playing cover that moves with its album during scrolling;
- saved player selection across browser sessions;
- live configurable display count, preview/menu timeouts, idle return and maximum scroll duration;
- Settings panel with explicit LMS, CometD/live-update, player, library, cache and application status;
- daily GitHub stable-release checks while the page is open, enabled by default with a per-browser off switch and manual Check now action in Settings > About; requests contain no LMS/library details and do not download or install updates;
- automatic LMS reconnection;
- Library / Spotify source switching with Spotify saved albums supplied through LMS Spotty;
- automatic Spotty capability detection: Spotify is disabled without the plugin and a saved Spotify source falls back to Library;
- full Spotify album search through Spotty, with searched albums playable and savable to the Spotify library;
- source-aware now-playing navigation and Spotify artwork rendered with the same jewel-case presentation as local albums;
- Album Information for local and Spotify albums, including genre when the upstream metadata provides it;
- installable/fullscreen-friendly web-app metadata and application icon;
- zero-idle-loop long-task performance diagnostics.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [License](#license)

## Quick start

The server requires Python 3.9+ and Pillow for source installations. On Debian/Ubuntu install `python3-pil`.

```bash
python3 server.py --lms http://streamer:9000
```

Open `http://127.0.0.1:8088/` in a browser. Replace the LMS address with your own if needed.

For configuration, deployment and security guidance, see the linked documentation.

## Documentation

- [Getting started and common runtime options](docs/getting-started.md)
- [Windows installation — download, portable use, service and troubleshooting](docs/windows.md)
- [Debian deployment, Raspberry Pi kiosk and versioning](docs/deployment.md)
- [Album discovery, browsing and artwork presentation](docs/usage.md)
- [Architecture, LMS API, catalogue snapshots and server endpoints](docs/architecture.md)
- [Performance and large-library tuning](docs/performance.md)
- [Testing and development](docs/development.md)
- [Spotify/Spotty integration](docs/spotify-spotty.md)
- [Standalone wall controller](docs/wall-controller.md)
- [Changelog and release history](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Public-release checklist](docs/public-release-checklist.md)


## License

Original Lyrion Carousel source code is licensed under the **GNU General Public License, version 3.0 only** (`GPL-3.0-only`). See [LICENSE](LICENSE) for the complete licence text.

Copyright © 2026 Stuart Roberts (for original contributions under the copyright holder's control). Under GPL v3, recipients who distribute modified covered versions must meet the licence's corresponding-source and notice obligations. GPL v3 permits commercial distribution but does not permit distribution of proprietary derivatives contrary to its terms.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency licences, external integrations and the publication asset audit. **Artwork and third-party assets:** The GPL grant applies only to material for which the project has redistribution rights. Included images, artwork, audio/video demonstrations and third-party materials must be reviewed for licensing before public release; items with separate terms must be documented and may need to be replaced or excluded.
