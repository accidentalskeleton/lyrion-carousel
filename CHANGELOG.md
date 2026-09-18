# Changelog

All notable changes to Lyrion Carousel are documented here.

## [0.9.0] - 2026-09-18

### Displays and playback

- Add a circular CSS spine shelf with artwork-derived colours, varied readable fonts, ellipsis and padded labels inset from the case end caps.
- Add a saved Shelf/Fan display setting, retaining the fan layout with bounded rendering; Shelf is the default.
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
