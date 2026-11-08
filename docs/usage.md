# Using Lyrion Carousel

[← Project overview](../README.md)

## Cloverleaf album discovery

A short press of the cloverleaf continues to select and play a random album. Hold it for approximately 600 ms (or right-click / press Shift+F10 while focused) to open the discovery menu:

- **Long Forgotten:** choose an album from the least recently played end of LMS's `recentlyplayed` album ranking.
- **Rarely Played:** choose from the lowest-play-count end of LMS's `playcount` album ranking.
- **Rediscover Something:** choose from either of those two overlooked-album pools.

Rediscovery scrolls to the selected album and opens its jewel case **without starting playback**. The currently playing album can remain open during scrolling; its existing preview and idle-return rules still apply. Eligibility respects the current album shelf (including excluded genres). LMS 9.1 or later is required for the new sort modes. LMS listening history is not a guaranteed record of all historical listens. Spotify browsing does not currently support rediscovery.

## Startup and browsing behaviour

Startup discovers players and loads the catalogue. If an album is playing, the shelf scrolls to it and opens its cover. Otherwise it scrolls to a random position without opening a cover or sending a playback command. Startup, random selection and idle return use the maximum scroll duration from Settings.

After the idle delay, the shelf returns to the playing album and opens its cover. Its preview does not time out. With **Keep playing album open** enabled (the default), it stays open while scrolling and moves with its position on the shelf; it can move offscreen and return as you browse. Clicking another spine temporarily previews that album; closing it or letting its preview time out restores the playing cover. When playback changes to another album, the shelf follows and opens the new cover. Turn the option off to restore click-to-close and scroll-to-dismiss behaviour; idle return will still open the playing cover.

A short click or tap closes a non-playing album preview. The playing cover stays open on taps, clicks and Enter/Space; closing another preview restores the playing cover. Hold a spine or cover for roughly half a second to open album actions. The cover’s play button loads that album. Search, Settings and Album Information appear above the shelf, and their input controls do not navigate the shelf.

The detail area shows the album under the pointer; outside the shelf it shows the playing album, or clears when nothing is playing. Track details and progress appear only for the playing album. The heading stays at the same vertical position in both states.

## Shelf display and cover resolution

Carousel uses a single **Shelf** display. **Settings → Displayed albums** controls shelf density. Existing obsolete browser display-mode preferences are ignored automatically.

**Settings → Display → Shelf variety** enables or disables the optional spine
styling and wider multi-disc cases together: title alignment, artist/title
hierarchy, print styles, subtle plastic wear, multi-disc seams, and catalogue
fonts, ink and placement. It is on by default, applies
immediately and is saved per browser. Existing multi-disc width preferences
are carried over. Artwork-derived background colours and real catalogue
numbers remain available with variety off; catalogue visibility has its own switch.

**Settings → Album cover size** selects 128, 256, 384, 512 (default), 768 or 1024 pixels. This controls image resolution, not the displayed case size. Server-generated JPEG variants preserve aspect ratio and never upscale. Originals remain available for spine-colour calculation.

**Settings → Cache → Clear album cache** uses an inline confirmation and removes artwork, resized covers and derived colours, fonts and colour indexes. Metadata rebuilds as needed; colour ordering prepares it for the whole library. The Cache tab starts at a 512 MB soft limit by default; the browser may raise or lower it, but never above the server-only 2 GB hard limit. Set `CACHE_LIMIT_MB` and `CACHE_HARD_LIMIT_MB` in `/etc/default/lyrion-carousel` (or pass the corresponding command-line options) before starting the service to change those defaults.

## Colour ordering

Choose **Colour** in the album-order menu to arrange spines from red through yellow, green, blue and violet. Nearly neutral colours follow, dark to light; albums with unavailable artwork sort last. Equal colours are ordered by artist and title. The choice persists across reloads and catalogue refreshes.

The server derives a numeric `colour_index` from each cached spine colour and upgrades older metadata without refetching artwork. The first colour sort may take longer while metadata is gathered for the whole library, using six shared server workers while the browser shows a preparation message. Subsequent sorts reuse cached metadata. Changing any sort order immediately centres and opens the playing album once the new catalogue is ready; otherwise it preserves the selected album.

## Shelf rendering and metadata

Artwork is fetched through `/api/art/<artwork-id>` and cached on disk. `/api/art-meta/<artwork-id>` supplies `spine_color`, `text_color`, `spine_font` and `colour_index`; existing colour-only caches upgrade automatically. Fonts are chosen deterministically from local sans-serif and serif stacks. Actual typefaces depend on the fonts installed on the display device.

Labels scale with spine width, truncate with an ellipsis and retain their full text on hover. Colour is inset from the clear end caps, with additional text padding. Open covers and their gaps share the album’s scrolling position. Browser artwork URLs include the LMS identity to avoid reusing another server’s artwork with the same ID.

## Realistic jewel-case rendering

Resized cover requests use `case=realistic-v1`. The server composites artwork beneath `assets/jewel-case-realistic-v1.png` and caches a PNG at the selected resolution. Both local and Spotify open-shelf covers use this presentation. Original artwork still supplies spine colours. The browser adds restrained reflections without a Three.js/WebGL rendering loop.

The [realistic jewel-case texture provenance notes](../assets/jewel-case-realistic-v1.md) document the source asset used by this rendering path.

The browser preloads the focused cover and up to four neighbours on each side, with two low-priority image requests at a time. Queued work follows the latest browsing position, and at most 24 loaded images are retained by the preloader.

### Background artwork preparation

Settings → About → Prepare all artwork starts a server-wide background job at the selected cover resolution. It fetches missing original artwork, calculates spine metadata and caches photographic case images for every distinct artwork ID. One album is processed at a time, with a short pause between albums and a pause after foreground cover requests. Progress, unavailable items and cancellation are shown in Settings. The job continues when the browser closes; it is not automatically resumed after restarting the server. Starting it again reuses completed cached files. Changing the cover resolution requires starting another run for that resolution.

The worker stops at the existing 512 MB image-cache limit instead of evicting earlier prepared artwork. It can therefore stop before completing a large library. Foreground cache pruning still applies. Clearing the cache or changing LMS cancels the job; an in-flight request may take up to its normal timeout to finish. This prepares server files, not an offline browser library. `/api/cache/warm` exposes progress (GET) and start/cancel actions (POST). Restart the server after installing this feature.
