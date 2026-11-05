# Changelog

All notable changes to Lyrion Carousel are documented here.

## Unreleased

- Add **Recently Added** as a local LMS album-order option using the server's native date-added ranking (`sort:new`), with current genre exclusions and cached prepared catalogue ordering.
- Make the Recently Added shelf finite: wheel, touch/mouse drag, keyboard arrows and programmatic navigation stop at the first and last album; other ordering modes retain circular wraparound.

## [0.11.2] - 2026-11-05

### Album rediscovery

- Hold the cloverleaf for approximately 600 ms to open a compact discovery menu with **Long Forgotten**, **Rarely Played** and **Rediscover Something**. A short press still plays a random album.
- Choose overlooked local-library albums using LMS 9.1's recently-played and play-count rankings, respecting the current shelf and genre exclusions. Discovery scrolls to the selected CD and opens its jewel case **without starting playback**.
- Support touchscreen holds, mouse context menus and keyboard access to discovery; keep Spotify browsing unchanged.

### Browsing and reliability

- Display **Album — Artist** details for a selected/open jewel case even when playback is stopped, without incorrectly showing track progress.
- Stop stale mouse-hover selection from overriding rediscovered album details; restore hover only after a deliberate pointer movement over the shelf.
- Prevent mouse movement during the discovery scroll from cancelling the animation and leaving the first selected CD unopened.
- Add JavaScript regression coverage for long-press playback suppression, discovery rankings, idle album details, stationary hover and first-selection animation behaviour.

## [0.11.1] - 2026-11-04

### Spotify playback and synchronisation

- Show the play button in Spotify Album Information and route playback through LMS/Spotty.
- Automatically switch Library and Spotify catalogues in separate browser sessions to follow the playing source and album.
- Offer a verified Spotify album permalink where available, falling back to a clearly labelled Spotify album search when Spotty does not expose a valid album URL.
- Refresh browser script versions so deployed updates replace cached JavaScript.

### Release automation

- Add a GitHub Actions workflow that tests and builds the Debian package on release publication, attaching the package and its SHA-256 checksum to the release.

### Shelf-only experience

- Standardise on the CD shelf display and remove the obsolete alternate-view selector.
- Ignore deprecated browser display-mode preferences without requiring users to clear storage.
- Remove unused display-mode renderer, geometry, stylesheet and overlay assets.
- Keep the playing cover, scrolling behaviour and all album actions unchanged; update JavaScript regressions and documentation.

### Large-library navigation and cache bounds

- Pre-index first album positions for A–Z to make alphabet navigation constant-time with a loaded catalogue, while preserving a partial-catalogue fallback.
- Bound the combined serialized catalogue order cache to 32 MiB as well as four entries, evicting least-recently-used orders and avoiding retention of oversized responses.
- Add alphabet navigation regression coverage for 20,000 albums and Python cache eviction/oversized-response tests.

### Phase 4 rendering performance

- Recycle a bounded DOM pool of shelf spines as the viewport advances; reuse the static jewel-case shell and label nodes instead of recreating every visible spine.
- Keep asynchronous spine-colour metadata bound to the correct album when a pooled node is reassigned.
- Write spine width and font geometry only when pitch or album binding changes rather than every animation frame.
- Cache open jewel-case width with invalidation on open/close, display change, viewport resize and element resize.
- Extend JavaScript regressions with node-identity reuse, style-write checks, and 120 long jumps through a 20,000-album catalogue.
- Add an opt-in browser performance profiler for sampled frame timing, approximate dropped frames, long tasks, DOM churn, network requests and optional JS heap metrics, with report comparison and no extra idle animation loop.
- Infer effective monitor refresh rate from foreground animation samples, show active-scrolling metrics separately from idle frames, and exclude/report long rAF suspensions instead of counting them as hundreds of missed frames.
- Document the performance monitor API, metric interpretation, fair comparison procedure, and a real 142.9 Hz browser capture (143.79 active FPS; zero active estimated missed frames; stable DOM count).

## [0.11.0] - 2026-11-04

### Carousel and playback

- Keep the playing jewel case continuously open during scrolling and automatic return; make browsing spines an explicit selection action.
- Remove the redundant Playing heading suffix and improve compilation track-artist and multidisc track presentation.
- Improve album search, shelf appearance, artwork composition and browsing controls.

### Large-library performance

- Batch spine metadata and index album lookup while bounding client-side caches and hover work.
- Persist catalogue snapshots, prepared sort orders and incremental SQLite colour indexes.
- Observe LMS library scans independently and reconcile catalogue changes without gratuitous browser refreshes.

### Additional refinements

- Calculate each spine's text colour dynamically from its background hue and lightness, adjusting to maintain a minimum 4.5:1 contrast ratio. Upgrade cached metadata without re-downloading artwork.

- Preserve playing and non-playing open jewel cases during wheel, arrow and drag scrolling; close manual previews only via timeout or explicit replacement and prevent idle return from preempting them.

- Allow direct spine-to-spine preview selection while music is playing by making the open-case wrapper click-through outside the actual jewel case.

- Render CD spines with a solid colour extracted from each album cover beneath a shared transparent jewel-case shell image and a single live CSS Artist — Album label; restore cover-derived contrasting text colours and deterministic varied font families without per-album generated graphics.
- Log failed colour-index artwork IDs for easier troubleshooting.

- Show current artwork cache usage and its limit in Settings, with total metadata usage in the detail tooltip.

- Rename Artist / Album ordering and match spine label order to the selected sorting mode.

- Add server-side background artwork preparation with progress, cancellation, foreground-request backoff and cache-capacity handling.

- Preload nearby covers with bounded background requests to reduce delays when navigating album previews.

- Move an open album preview to the neighbouring album with Left/Right keys, including repeated keys and catalogue wraparound.

- Group Settings into accessible Display, Playback, Connection and About tabs.

- Close the playing album preview when playback pauses or stops.

- Refine shelf spines with narrow moulded plastic rails, recessed paper labels and tighter contact shadows, preserving label typography and padding.

- Composite album artwork beneath a photographic-style transparent jewel-case shell on the server, caching resolution-specific PNGs.
- Use the composition in enlarged shelf cover previews with lightweight reflections.

## [0.10.0] - 2026-09-21

### Spotify / Spotty integration

- Add Spotify as a second catalogue source alongside the local LMS library, while keeping LMS as the playback authority.
- Add Spotify saved-album browsing, full-catalogue album search, temporary search-result insertion into the carousel and Spotty-based album saving.
- Add Spotify playback, now-playing matching, source-aware carousel navigation and source indicators, including the Spotify logo when browsing the opposite library.
- Add Spotify artwork proxying, caching and realistic jewel-case composition so Spotify albums match the local-library presentation.
- Add Spotify album information support through Spotty and keep album playback inside the existing LMS/Squeezelite path.
- Refactor catalogue access behind LMS and Spotify provider modules and add Spotty diagnostics/documentation.

### Album information

- Add album genre to the Album Information view for LMS albums, collecting genre metadata from the album's tracks when LMS does not expose it at album level.
- Populate Album Information for Spotify albums using Spotty metadata and track listings.

### Interface and polish

- Add Library / Spotify source controls and follow the currently playing album when switching sources where possible.
- Hide previous, next, queue and source controls during startup so they appear consistently with the other controls once the app is ready.
- Improve Spotify search selection so choosing a result scrolls to, centres and opens that album in the carousel.
- Preserve the current-track text while showing a compact source icon in the now-playing area.
- Add a Coffee tab in Settings and a Buy Me a Coffee link for project support.

### Maintenance

- Merge the Spotify/Spotty development branch into main.
- Bump the application version to 0.10.0.

## [0.9.0] - 2026-09-18

### Displays and playback

- Add a circular CSS spine shelf with artwork-derived colours, varied readable fonts, ellipsis and padded labels inset from the case end caps.
- Add the bounded CD shelf layout and saved browsing settings.
- Open the playing album on startup and idle return; use a random browsing position without playback when nothing is playing.
- Keep the playing cover open by default, move it with scrolling, and follow album changes. Add click-to-close and long-press album actions.
- Centre and open the playing album immediately after changing sort order.
- Stabilise hover/now-playing headings and keep Settings, Search and their keyboard input above and separate from cover interactions.

### Server preparation and cache

- Prepare artist/album, album, colour and random catalogue ordering on the server using bounded LMS pages.
- Cache spine colours, contrast, font and rainbow colour indexes; upgrade existing metadata automatically.
- Calculate metadata on the server with six shared workers and support batched metadata requests.
- Add cached aspect-preserving cover resizing and a saved 128–1024 px resolution setting, defaulting to 512 px.
- Rename the cache control to Clear album cache and replace native confirmation with an inline Settings confirmation.

### Reliability and maintenance

- Fix missing shelf albums during scrolling, preview opening, scan refreshes and stale responses after server changes.
- Preserve ordering across refreshes and apply saved/runtime timeouts consistently.
- Revalidate static files, version client asset URLs and retain renderer compatibility for older cached clients.
- Remove redundant rendering and styling; add Python and JavaScript regression coverage.
- Require Pillow for metadata and cover processing; include it in Debian package dependencies.

### Upgrade

- Restart the server and refresh the browser to load the new endpoints and client assets. Existing metadata upgrades without requiring a cache clear.

## [0.8.1] - 2026-09-16

### User experience

- Add a circular display-order control beside the random-play control with Artists / Album, Album, and Random modes.
- Add a configurable front-cover preview when clicking a shelf album.

## [0.8.0] - 2026-09-16

### Security and resilience

- Limit proxied LMS and CometD responses to 8 MB.
- Limit individual artwork responses to 10 MB before caching or returning them.
- Bound the persistent artwork cache at 512 MB and prune the oldest cached images when the limit is exceeded.
- Return an upstream error instead of buffering an oversized response in memory.

### Performance and scalability

- Build the album ID-to-position index with sequential page-sized LMS requests instead of one request for the entire library.
- Preserve absolute album positions across index pages so playback and search navigation continue to locate albums correctly.

### User experience

- Expand the desktop carousel to use available viewport height.
- Center and scale desktop jewel cases within the larger carousel stage while preserving the existing mobile layout.
- Add long-press album actions for playing now, playing after the current album, and adding to the queue.
- Add a configurable album-menu timeout, defaulting to 10 seconds.
- Add track-list viewing and clear-playlist-and-play actions to the album menu.

## [0.7.0] - 2026-09-16

- Initial tagged release.
