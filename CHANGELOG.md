# Changelog

All notable changes to Lyrion Carousel are documented here.

## Unreleased — experimental shelf

- Replace the WebGL experiment with a circular CSS spine shelf, padded readable labels and cached colour/font metadata.
- Add persistent playing-cover behaviour, bounded startup/idle scrolling, cover gestures and stable hover/now-playing details.
- Keep Settings and Search above the cover; isolate their keyboard input from shelf navigation.
- Repair scan-completion refreshes, preserve display order, apply saved timeouts and discard stale server responses.
- Remove duplicate renderer scheduling, redundant Settings CSS and the inactive density control.
- Add server and JavaScript regression checks; retain application version 0.8.1.

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
