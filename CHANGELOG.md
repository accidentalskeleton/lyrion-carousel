# Changelog

All notable changes to Lyrion Carousel are documented here.

## Unreleased

- Add an on-demand, auto-hiding translucent fast-scrub timeline over CD spines (no extra height) with CD position, artist/album preview and ordering-aware alphabet shortcuts. Add accelerated repeated touch/mouse flicking for 100+ CD libraries while retaining precise slow swipes, finite shelf bounds, and visual-only navigation.

- Dim the CD shelf and any open jewel case when the selected LMS player's power state is off; restore full brightness on power-on while leaving navigation and transport controls readable. Unknown power state is not treated as off.


- Add browser-native **Settings → Demo** visual showcase: local or code-joined shared sessions across Windows, iPad and Raspberry Pi. Coordinate shelf/album source IDs and native jewel-case animations without changing LMS playback or queue; offer speed choices, optional repeating scenes for filming, reliable host-error shutdown and touch/Escape stop. Package ephemeral, token-protected server coordination separately from normal player synchronisation.

## [0.13.0] - 2026-11-12

- Document optional Corsair XENEON EDGE touchscreen calibration for Raspberry Pi kiosk clients. Add a separate guarded helper for device/output diagnostics, upstream virtual-environment preparation, configuration backup and explicit restoration; keep third-party calibration out of the default kiosk install and retain the restricted `carousel` account.

- Add a documented and repeatable Raspberry Pi OS Desktop Chromium kiosk installer/uninstaller for local or remote Carousel server use, with preserved labwc autostart, configurable connectivity checks, browser restart, logs and basic CI validation. Keep HDMI modes automatic and defer physical touchscreen/power management settings until the actual display is connected.

- Position new-album notifications at the very top, above covers, menus and other active overlays, and let long album names wrap instead of being clipped. Keep the sleeping screen black. Deliver each new-album notification even when the same viewer's shelf was refreshed before its library event was processed.

- Add per-viewer **Settings → Browsing → When new albums arrive** with Update shelf only (default), Show notification, and Scroll to album and open cover. An LMS reconciliation persists up to 25 new album IDs in the catalogue snapshot so multiple browsers can observe an addition independently; older IDs, retags and cover repairs do not trigger previews. Preview one added Library cover using existing scrolling and temporary-cover animations, with no playback commands; skip animation during active browsing, manually selected Spotify, radio, or open dialogs. Show one notification for multi-album scans and do not replay after browser refresh.
- Audit Settings grouping: rename Playback to **Browsing** for source-follow, idle return, new-arrival and preview/navigation timing; move **Screen sleep** into **Display**, leave LMS/player under Connection and maintenance under Cache. Add accessible group headings within Browsing while retaining the compact tabbed layout.

- Add **Settings → Playback → Manual source browsing** (Follow immediately, 1/5/10/15/30/60 minutes; 5-minute default). Explicit Library or Spotify selection holds that source on the current viewer until the selected period of inactivity, restarting on touch/scroll/keyboard use. Player-driven cross-viewer source synchronisation resumes when it expires, without changing playback or other viewers; manual and automatic source switches are distinguished in code.

- Restore player-driven Library/Spotify source synchronisation across Carousel viewers, including transitions from the temporary radio jewel case. Request LMS track URL and external ID in CometD status, distinguish Spotify from real radio rather than treating `remote:1` as radio, add a 20-second read-only player-status fallback, retry failed follows, and prevent album-return animation from skipping source changes. Keep radio dimming/fake CD and avoid extra playback commands.

- Fix new albums failing to appear automatically after LMS scans when the `rescan` true-to-false event is missed. Detect changed `lastscan` and album/track totals, use a lightweight 60-second `serverstatus` fallback during CometD interruptions, preserve revisions across same-server reconnects and reset them on LMS changes; retain first-observed album-added dates.

- Consolidate persistent album-added dates, Library/Spotify spine metadata and catalogue snapshots into a single per-installation SQLite database outside the disposable artwork directory. Begin with a fresh empty metadata store; do not migrate legacy `.meta`, `colour-index-v1`, `indexed-order-v1` or catalogue JSON files. Keep images as files, preserve album-added dates when clearing artwork, and update packaging, regressions and documentation.

- Align usage, getting-started, Windows, deployment and development documentation with the current Settings UI: remove the obsolete **Keep playing album open** toggle, correct the Cache tab artwork-preparation location, update control names and explain current cache clearing. No application behaviour changes.

- Document the difference between Carousel's current-library **Recently Added** ordering and native LMS **New Music**, including the persistent-recording timestamp cause, an example of legitimate shared MusicBrainz recording IDs, SQLite caching, database-rebuild limitations, and LMS source references. Correct the outdated README and architecture descriptions.

- Prevent native touchscreen blue text-selection highlights, tap flash and long-press callouts on CD spines and open jewel cases. Scope the suppression to album surfaces so search inputs and popups retain their normal behaviour, without changing Carousel's tap, swipe, drag or long-press actions.

- Clarify the order menu with **Artist → Album**, **Album → Artist**, **Recently Added** (Carousel’s indexed dates), **New Music (LMS)** (LMS persistent recording dates), **Spine Colour**, and **Random**. Keep the existing icons for other options, use a distinct history-clock icon for LMS New Music, and group choices with subtle dividers. Internal sort IDs and saved preferences remain unchanged.

- Add **Recently Indexed** (the original development name for today's Carousel **Recently Added**) as a second Library-only album sort alongside the LMS order (now labelled **New Music (LMS)**). Use current-track indexing dates through the standard LMS API rather than recording history, with per-server SQLite caching, bounded pagination, genre exclusions, and regression tests. No LMS patch or Pi ripper dependency.

- Show external playback artwork as a temporary CD on the dimmed shelf, using normal spine spacing, scrolling, preview timeouts and idle return. Prefer song artwork with station-artwork fallback from LMS metadata or matching favourites. Keep the CD visible through missing or delayed artwork, preload replacement artwork, refresh reused artwork URLs when radio metadata changes, and remove the temporary CD when album playback resumes. Omit the artist separator when the album title is missing.

- Keep the selected shelf and dim it during radio or other external playback instead of switching to Spotify. Restore normal brightness for Library or Spotify playback while keeping external now-playing details and controls readable.

- Show the current queue position and total beside playback controls and in the Now Playing header, updating in place for local and Spotify playback and hiding when the queue is empty.

## [0.12.0] - 2026-11-10

- Pause a non-playing cover’s remaining preview countdown while menus, Settings, search, album information or the Now Playing queue are open. Resume the remaining time only after the last popup closes.

- Keep the Now Playing queue popup and its track rows displayed when selecting a track. Update the current-track highlight in place and preserve scroll position and focus.

- Remember album ordering independently for Library and Spotify, restoring each source’s choice on switching and reloads. Migrate the existing ordering preference to Library.

- Resolve Spotify albums missing from a browser’s loaded shelf when LMS reports external playback, so independent Carousel instances open and follow the playing cover without sending playback commands.

- Use stable Spotify album URIs from Spotty menu metadata for cover playback, album information and library saving, preventing reordered search positions from selecting a different album.

- Open Spotify search results as timed album previews without changing playback; start the album only when its Play button is selected.

- Clear the previous query, results and status whenever a new album search opens; invalidate older pending responses.

- Open LMS search results as album previews after scrolling to them; prevent pointer motion and repeated stopped-player status from cancelling that scroll, using the normal closing timeout and restoring the current playing or paused cover afterwards.

- Match the current album cover button to the main Play/Pause control, including paused playback. Toggle pause/resume without restarting the album or replacing its queue; other album previews retain Play album.

- Keep the current album case open and pinned while paused, including reloads and incomplete LMS status notifications. Retain track details, freeze elapsed-time advancement and preserve normal stopped-player behaviour.

- Add a full-album or individual-disc selector to multi-disc library album menus, using LMS disc tags and optional disc titles. Apply the selection to clear-and-play, replace-current, play-after-current and append-to-queue actions; retain full-album defaults and clearer action labels. Allow replace-current playback when the queue is empty.

## [0.11.7] - 2026-11-08

- Consolidate Windows ZIP, portable, service and source-installation instructions into one dedicated guide; update README and deployment links and package the same guide in Windows release ZIPs.
- Use stable sans-serif, serif and monospace catalogue lettering independently of the main spine label when Shelf variety is on; keep the same real codes, wrapping and height limits.
- Give multi-disc cases a subtle additional moulded hinge seam when Shelf variety is enabled, without changing cover interactions or adding image requests.
- Add faint occasional plastic scuffs and softened edge highlights with stable per-album wear patterns. Reuse decorative layers in the bounded spine pool and hide them when Shelf variety is off.
- Mix stable regular, bold and condensed print treatments using local fonts when Shelf variety is enabled; do not download fonts or add scrolling work.
- Use smaller artist lettering and a quieter separator to give album titles more prominence when Shelf variety is on; retain the selected artist/album ordering.
- Alternate top-aligned and centred spine lettering consistently per album when Shelf variety is on, without changing the available title area.
- Replace the multi-disc width option with a saved Shelf variety switch that controls optional widths, typography and imprint treatments together. Preserve existing width preferences and retain artwork colours and real catalogue numbers when off.

## [0.11.6] - 2026-11-08

- Disable the Spotify source when LMS does not expose Spotty; check again on reconnect or server changes and fall back to Library when a saved Spotify source is unavailable.
- Give multi-disc library albums 1.5× spine width using LMS disc counts. Account for mixed widths in shelf spacing, finite endpoints, cover gaps and dragging, and refresh catalogue snapshots to include disc metadata.
- Add Settings > Display > Multi-disc spine width with Wider (1.5×) and Uniform choices. Apply changes immediately, preserve finite shelf endpoints, and remember the choice per browser; wider spines are enabled by default.

## [0.11.5] - 2026-11-07

- Add an optional Windows x64 ZIP release build alongside Debian: package the Python/Pillow server with PyInstaller, bundle WinSW and PowerShell service install/uninstall and portable-run scripts, smoke-test the EXE on Windows CI, and attach the ZIP plus SHA-256 checksum to published GitHub releases. Linux/Debian remains the primary platform.
- Make LMS's read-only raw track-tag API the exclusive source of catalogue numbers across Linux and Windows. Remove direct FLAC reads, `metaflac`, ripper release-sidecar lookups, and the obsolete Debian `flac` dependency; preserve caching, limits and missing-tag behaviour.
- Add the Lyrion forums announcement thread to Settings > About > Project, opening in a new tab alongside the GitHub project link.

## [0.11.4] - 2026-11-06

- Give catalogue numbers their own muted stone/slate ink, distinct from artist/title text, with contrast checked against each spine colour.
- Close non-playing album previews on a short click/tap or Enter/Space, restoring the playing cover when applicable. The playing album always stays open on those interactions. Keep drag-to-scroll, long-press actions and the Play button intact.
- Apply cached spine colours and fonts synchronously when reusing shelf nodes, avoiding a temporary grey reset.
- Display real catalogue numbers on CD spines: read local FLAC `CATALOGNUMBER` tags first, then saved selected-release metadata. Show no code when unavailable; restore the full title area. Batch visible-album lookups and bound browser/server caches; add the `flac` package dependency for tag reading.
- Arrange catalogue numbers horizontally over two or three lines, preferring natural groups and using three lines for long numbers. Vary their vertical position consistently per album only where the artist/title leaves room, with a maximum 24-pixel lift and no continuous layout-measurement loop.
- Add Settings > Display > Catalogue codes with a saved per-browser Show/Hide choice. Hiding codes restores the title area and stops new catalogue-number lookups.
- Add a GitHub project link beside the application version in Settings > About, opening the repository in a new tab.
- Check GitHub for newer stable releases once a day while Carousel is open, with a saved automatic-check toggle and a manual Check now action in Settings > About. Cache check times across reloads, cancel requests when disabled, and show release links without downloading or installing updates.
- Show a discreet release link to the right of the main carousel's information button when a newer stable version is available, reusing cached check results without extra requests.

## [0.11.3] - 2026-11-06

- Animate clicked CD spines into their open covers over 320 ms while neighbouring spines slide apart; timeouts and dismissals reverse the turn and bring the spines back together before hiding the case. Reuse the shelf's existing frame loop and cached measurements, stop rendering when settled, honour reduced motion, and let wheel, keyboard or dragging interrupt immediately. Playback-status updates do not replay the transition, and an interrupted timeout cannot replace a newly selected cover.
- Add frame-by-frame opening and closing regression coverage for finite and circular shelves at desktop, ultrawide and mobile sizes, including spine clearance, timeout completion, reduced motion, input interruption and cancellation by a replacement cover.
- Correct Recently Added scrolling with an open jewel case: reserve its full width and shift neighbouring spines without covering them, leaving gaps or changing the finite scroll limits. Use the same expanded-strip coordinates for centring, rendering and pointer dragging, preserve ordinary mouse-wheel notches instead of snapping them back, and measure case width independently of the opening animation. Add real-browser layout and trusted-input tests at desktop, ultrawide and mobile sizes.
- Add **Recently Added** as a local LMS album-order option using the server's native date-added ranking (`sort:new`), with current genre exclusions and cached prepared catalogue ordering.
- Make the Recently Added shelf finite: mouse wheel, touch/mouse drag, keyboard arrows and programmatic navigation stop when the first and last CD spines reach the outer viewport edges, keeping the shelf filled without half-screen gaps. Other ordering modes retain circular wraparound.

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
