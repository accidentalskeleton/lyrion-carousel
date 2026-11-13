# Using Lyrion Carousel

[← Project overview](../README.md)

When the selected LMS player is powered off, Carousel dims the CD shelf and any open jewel case while keeping the power control and Settings legible. Turning the player back on restores the display. An unknown power state does not trigger dimming.

## Demonstration mode (Windows, iPad and Raspberry Pi)

Open **Settings → Demo** to run a visual showcase of the current Carousel shelf. Demo Mode animates shelf scrolling and opening jewel cases; it does **not** send LMS playback, pause, power, queue or Spotify play commands. The currently playing music continues uninterrupted.

- **Local demo:** choose Relaxed, Normal or Fast, optionally enable **Repeat showcase** for continuous filming, and select **Start local demo**. The host's Repeat setting also governs a shared demo. Only this browser moves; other Carousels are unaffected.
- **Shared demo:** select **Create shared session** on the host browser. Note the eight-character code while Settings remains open. On each other browser, open Settings → Demo, enter the code and select **Join demo**. After all viewers have joined, select **Begin shared showcase** on the host. Each viewer follows the host's album ID and source when the item exists, with a fallback to a corresponding shelf position if its catalogue differs.
- **Stop:** click or touch anywhere on a running demonstration, press Escape, or hover/focus the discreet top-right Stop control. Stopping the host stops the connected participants. Leaving the page also stops that browser's demo. The session is not persisted across server restarts.

The sequence uses Library browsing and, if the Spotty plugin is available, briefly shows Spotify before returning to Library. Each browser uses native CSS jewel-case and shelf animations. On iPad this does **not** require browser debugging or simulated touch input; no automatic audio playback is required or attempted. The showcase includes eight visual scenes, and the display is unobstructed while running.

**Security:** shared sessions are explicitly joined, use unpredictable controller and viewer tokens, expire after inactivity, and should only be used on a trusted network. The join code is a bearer invitation; don't expose the Carousel server or session code publicly. No browser is taken over just because another viewer starts a demo.

## Navigating large CD collections

The translucent fast-scrub timeline is **hidden by default**, spans about **80% of the CD shelf width**, and appears centred over the spines only after sustained navigation: **three consecutive quick swipes**, **five moderate swipes**, or at least **eight rapid wheel events** in the same direction. Individual fast flicks still accelerate without opening the control. This does not consume extra screen height or cover the player controls. Press **N** to reveal it directly from the keyboard. Drag the slider (or use its keyboard controls) to jump through the collection by CD position; the label shows artist, album and position. Release to settle on the destination and load its artwork. It closes automatically after about four seconds of inactivity, immediately with Close / Escape, **as soon as you resume scrolling directly on a CD**, or when you click a CD spine (which also clears accumulated swipe/wheel triggers). The panel background passes touch and wheel gestures through to the CDs, but its slider and buttons remain interactive. On circular shelves the slider has wrap positions beyond each end: left of album 1 selects the final album, and right of the final album selects album 1, taking the shortest route around the shelf. Bounded shelf endpoints remain finite. A–Z shortcuts follow the shelf's actual sort sections: **Artist → Album** uses LMS `sort:artistalbum` (including surname-based `ARTISTSORT` / `ALBUMARTISTSORT`, so Chris Rea may be under **R**), while **Album → Artist** uses LMS `sort:album` (including `ALBUMSORT`). Both A–Z shortcuts follow the corresponding LMS one-letter sort keys; Carousel caches the album ID order and reuses the same artwork and catalogue metadata. Other sorts use relative library position instead.

**Accelerated swiping and wheel scrolling** activate from 100 CDs upward (including a 169-CD collection). Slow drags and precise trackpad movements retain their original feel. Rapid flicks travel several CDs and repeated same-direction flicks gain more inertia; successive mouse-wheel notches also accelerate. Reversing direction brakes or resets acceleration. Recently Added/New Music stop at their finite shelf ends. These interactions never start playback, change the playlist, or automatically open a CD case.

## Cloverleaf album discovery

A short press of the cloverleaf continues to select and play a random album. Hold it for approximately 600 ms (or right-click / press Shift+F10 while focused) to open the discovery menu:

- **Long Forgotten:** choose an album from the least recently played end of LMS's `recentlyplayed` album ranking.
- **Rarely Played:** choose from the lowest-play-count end of LMS's `playcount` album ranking.
- **Rediscover Something:** choose from either of those two overlooked-album pools.

Rediscovery scrolls to the selected album and opens its jewel case **without starting playback**. The playing or paused cover otherwise remains open during ordinary scrolling; rediscovery uses the same temporary manual-preview and idle-return rules. Eligibility respects the current album shelf (including excluded genres). LMS 9.1 or later is required for the new sort modes. LMS listening history is not a guaranteed record of all historical listens. Spotify browsing does not currently support rediscovery.

## Startup and browsing behaviour

Startup discovers players and loads the catalogue. If an album is playing, the shelf scrolls to it and opens its cover. Otherwise it scrolls to a random position without opening a cover or sending a playback command. Startup, random selection and idle return use the maximum scroll duration from Settings.

The current playing or paused album's jewel case **stays open by design** while you scroll, and moves with its position on the shelf. It can move offscreen and return as you browse. There is **no "Keep playing album open" setting or toggle**: this is the only supported behaviour. Tapping the playing cover does not close it. Clicking another spine temporarily previews that album; closing it or letting its preview time out restores the playing cover. When playback changes to another album, the shelf follows and opens the new cover. **Library versus Spotify normally follows the selected LMS player**: if a viewer starts Spotify playback, other viewers controlling the same player follow Spotify; local Library playback switches them back. **Exception: manual browsing.** When you explicitly select Library or Spotify, that browser can stay on your chosen source while you browse, even if another Carousel is playing music from the other source. Its independent **Settings → Browsing → Manual source browsing** timeout resets after each touch, wheel movement or keyboard interaction; after the selected *inactivity* period, it follows the player's source again. The default is **5 minutes**; choose **Follow immediately** for the old automatic behaviour. This never pauses or changes playback. Spotify playback started elsewhere is resolved through Spotty when the album is missing from a viewer’s shelf, without sending another play command. Internet radio remains a separate temporary jewel case on the currently selected dimmed shelf; it does not count as Spotify or overwrite the saved Library/Spotify ordering.

If **Settings → Browsing → Idle return** is enabled, Carousel scrolls back to the playing album after browsing stops, keeping its existing open cover visible throughout the movement rather than closing and reopening it. Idle return waits while you are using a menu or dialog and **does not interrupt a manually opened, non-playing cover**; that preview has its own timeout. Turning Idle return off stops this automatic return, but does **not** make the playing cover closable.

A short click or tap closes a non-playing album preview. The current cover remains open while paused, including after a reload. The playing or paused cover stays open on taps, clicks and Enter/Space; closing another preview restores the playing cover. Hold a spine or cover for roughly half a second to open album actions. The current album’s cover button mirrors the main Play/Pause control and resumes from the paused position. Other covers offer Play album to load that album. Search, Settings and Album Information appear above the shelf, and their input controls do not navigate the shelf.

Each new search opens with a blank query and cleared results. Selecting an LMS search result scrolls to the album and opens its cover. The preview countdown pauses while a popup or dialog is open and resumes its remaining time after the last popup closes. It uses the usual preview timeout; closing it restores the current playing or paused cover. Selecting the current album keeps its cover pinned. Selecting a Spotify search result also opens a timed preview without changing playback. Use the cover’s Play button to start the album through Spotty. Album playback uses its stable Spotify URI so changing search rankings cannot select a different album.

The detail area shows the album under the pointer; outside the shelf it shows the playing album, or clears when nothing is playing. Track details and progress appear only for the playing album. The heading stays at the same vertical position in both states.

The Now Playing queue stays open when you select a track. Its highlight moves to the selected track without rebuilding the list or resetting your scroll position.

## Album playback menu

Hold or right-click an album to open its actions:

- **Clear queue and play album** starts the album from the beginning and removes the existing queue.
- **Replace current album and play** removes the current album's contiguous tracks, starts the selected album and keeps the rest of the queue.
- **Play after current album** inserts it after the remaining tracks of the current album.
- **Add album to end of queue** appends it without interrupting playback.
- **View album information** opens the track list and album details.

For multi-disc library albums, **Play or queue** defaults to **Full album**. Select **Disc 1**, **Disc 2**, etc. to apply any of the four playback/queue actions to that disc alone. Disc choices and any disc titles come from LMS track tags; tracks play in disc/track order. Disc selection resets to the full album each time the menu opens. If disc information cannot be loaded, full-album actions remain available. Spotify retains its existing album playback and information actions.

## Shelf display and cover resolution

Carousel uses a single **Shelf** display. **Settings → Display → Displayed albums** controls shelf density (20, 30, 40 or 50 spines). There is no separate display-style selector; obsolete browser display-mode preferences are ignored automatically.

**Settings → Display → Shelf variety** enables or disables the optional spine
styling and wider multi-disc cases together: title alignment, artist/title
hierarchy, print styles, subtle plastic wear, multi-disc seams, and catalogue
fonts, ink and placement. It is on by default, applies
immediately and is saved per browser. Existing multi-disc width preferences
are carried over. Artwork-derived background colours and real catalogue
numbers remain available with variety off; catalogue visibility has its own switch.

**Settings → Display → Album cover size** selects 128, 256, 384, 512 (default), 768 or 1024 pixels. This controls image resolution, not the displayed case size. Server-generated JPEG variants preserve aspect ratio and never upscale. Originals remain available for spine-colour calculation.

**Settings → Cache → Clear album cache** uses an inline confirmation and removes cached artwork, resized covers, spine colours/fonts and catalogue snapshots. It **preserves the previously recorded Recently Added dates**, which live in the shared metadata database outside the disposable artwork directory. Cleared artwork and spine metadata rebuild on demand; colour ordering prepares missing metadata for the library. Metadata rebuilds as needed; colour ordering prepares it for the whole library. The Cache tab starts at a 512 MB soft limit by default; the browser may raise or lower it, but never above the server-only 2 GB hard limit. Set `CACHE_LIMIT_MB` and `CACHE_HARD_LIMIT_MB` in `/etc/default/lyrion-carousel` (or pass the corresponding command-line options) before starting the service to change those defaults.

## Settings reference

Settings (the **i** button beside the connection status) has these tabs. Only the controls shown below are available; **Keep playing album open** and the older display-style selector are no longer configurable.

| Tab | Current controls |
| --- | --- |
| **Display** | Displayed albums, Shelf variety, Catalogue codes, Album cover size, Screen sleep |
| **Browsing** | When new albums arrive, Manual source browsing, Idle return, Front preview timeout, Album menu timeout, Maximum scroll duration |
| **Connection** | LMS player selection and Lyrion Music Server URL |
| **Genres** | Select which local-library genres appear on the shelf |
| **Cache** | Prepare all artwork / Cancel, Cache limit, Clear album cache |
| **About** | LMS/player/library/application status, release update checking and project links |
| **Coffee** | Optional support link |

**Settings → Browsing → When new albums arrive** defaults to **Update shelf only**. Choose **Show notification** for a non-modal message or **Scroll to album and open cover** to animate to one newly added visible Library album and open it as a temporary preview, without sending a playback command. The preview uses the existing Front preview timeout. If several albums are imported in one LMS scan, Carousel shows one notification and at most one preview. It skips movement when you are actively browsing, have an album preview or dialog open, or have deliberately chosen another source. Spotify stays on Spotify (a notification may still appear); radio stays on its temporary CD. The feature is per-browser, disabled by default, and does not replay old additions on ordinary refreshes or restarts. A genuine new album ID is required; retags, cover changes and repairs do not count.

**Manual source browsing** controls how long this viewer remains on a deliberately chosen Library or Spotify source after your last interaction (Follow immediately, 1, 5, 10, 15, 30 or 60 minutes). It is separate from **Idle return**, which controls when the shelf scrolls back to the playing album. **Settings → Display → Screen sleep** blanks the Carousel interface after the selected inactivity period; a touch wakes it without triggering an album action. **Front preview timeout** applies to a manually opened, non-playing cover, not the playing/paused cover. Changes to display and playback settings are saved in that browser. Choosing an LMS server from **Connection** also changes the Carousel server's persisted LMS connection for subsequent restarts.

## Understanding album date ordering

Carousel provides two **newest-first** choices for albums in your local LMS library. They are deliberately different, so you can compare them without changing LMS, your audio files or your tags:

| Menu choice | What determines the album's position? | When to use it |
| --- | --- | --- |
| **Recently Added** (calendar icon) | Carousel's earliest **current-library track-added** timestamp for that album, as reported by LMS | To find albums recently imported into your library, including compilations and greatest-hits releases |
| **New Music (LMS)** (history-clock icon) | LMS's native `sort:new` ordering, using the oldest **persistent recording-added** timestamp associated with the album | To see the same New Music order that LMS itself reports |

### Why can a newly added album appear old in LMS?

A recording can legitimately appear on several different releases. For example, Elastica's **2:1** appears on both *Elastica* and *Trainspotting: Music From the Motion Picture*. These two album tracks can have the **same MusicBrainz Recording ID** (`MUSICBRAINZ_TRACKID`), while having **different MusicBrainz Release Track IDs** (`MUSICBRAINZ_RELEASETRACKID`).

LMS can reuse a recording's persistent history when the recording is recognised on another album. Its built-in New Music order uses the **earliest persistent track-added timestamp** in each album. Consequently, adding *Trainspotting* later does not necessarily put it at the front of **New Music (LMS)**: a previously recognised recording can give it an older ranking.

This is **not** a reason to strip or invent MusicBrainz IDs. Matching Recording IDs across releases are generally correct; different Release Track IDs identify their separate appearances. A shared recording ID does not, by itself, prove that two audio files are bit-for-bit identical or that their masterings match.

### What Carousel does differently

**Recently Added** asks LMS for each album's currently indexed tracks and their `addedTime` values, then orders albums by their **earliest current-track timestamp** (newest album first). It does not use file-modification times, ripper-specific metadata or a patched LMS installation. An album with several tracks uses the earliest valid timestamp among those tracks, not the newest one.

On first selection, Carousel populates the **per-LMS album-date rows in its shared SQLite metadata database**; this can take longer with a large library. Subsequent selections reuse the saved values. When a new album appears, Carousel looks up its dates without recalculating every previously known album. Ordinary retagging, track repairs, rescans and Carousel restarts do not promote an existing album while its stored identity stays the same.

**Limitations:** This is an index of when LMS currently knows the album's tracks, not proof of the original CD rip or import date. If LMS's database is completely rebuilt, previously unknown historical dates cannot be reconstructed; Carousel can retain previously observed dates only when the cached album ID and identity still match. Album IDs reused or metadata identities changed after a rebuild may lead to recalculation. Albums for which LMS supplies no usable track-added timestamp sort last. The first sort requires LMS connectivity.

Both date-based choices use a **finite shelf** (no wraparound), respect excluded genres, and are available for the **Library**, not Spotify. Carousel saves Library and Spotify sort preferences independently. The other choices are **Artist → Album**, **Album → Artist**, **Spine Colour** and **Random**.

For the LMS query, SQLite cache, paging and edge cases, see the [album-ordering implementation](architecture.md#album-date-ordering-implementation).


## Automatic library updates

After LMS indexes new albums or changes an existing release, an open Carousel page normally updates without a manual reload. Carousel monitors LMS scan completion, its `lastscan` timestamp, and library totals. A lightweight read-only status check every **60 seconds** also catches quick scans and missed CometD messages, without rescanning the whole music library each minute.

Once a change is detected, Carousel reconciles its server-side catalogue and refreshes the Library shelf only if needed, preserving the selected album where possible. The last genuine new album IDs are retained in that shared catalogue snapshot so other already-open browsers can recognise the same addition even if another browser reconciled first. Spotify browsing can remain selected while the server-side Library snapshot is updated for a later switch back.

**Troubleshooting:** First confirm that LMS has finished scanning and shows the new album. Check **Settings → About** for LMS connection and live-update status. Reloading the browser reconnects and loads the current catalogue; this does not delete your historical Recently Added timestamps.

## Colour ordering

Choose **Spine Colour** in the album-order menu to arrange spines from red through yellow, green, blue and violet. Nearly neutral colours follow, dark to light; albums with unavailable artwork sort last. Equal colours are ordered by artist and title. The choice persists across reloads and catalogue refreshes.

The server derives a numeric `colour_index` from each cached spine colour and upgrades older metadata without refetching artwork. The first colour sort after a fresh start may take longer while metadata is gathered for the whole library, using six shared server workers while the browser shows a preparation message. Subsequent sorts reuse cached metadata. Changing any sort order immediately centres and opens the playing album once the new catalogue is ready; otherwise it preserves the selected album.

## Shelf rendering and metadata

Artwork is fetched through `/api/art/<artwork-id>` and cached as image files on disk. `/api/art-meta/<artwork-id>` supplies `spine_color`, `text_color`, `spine_font` and `colour_index` from the shared SQLite metadata database; metadata for a newly analysed cover is saved there for future sessions. Spotify spines use the same database in a separate source namespace. No individual `.meta` files are written. Fonts are chosen deterministically from local sans-serif and serif stacks. Actual typefaces depend on the fonts installed on the display device.

Labels scale with spine width, truncate with an ellipsis and retain their full text on hover. Colour is inset from the clear end caps, with additional text padding. Open covers and their gaps share the album’s scrolling position. Browser artwork URLs include the LMS identity to avoid reusing another server’s artwork with the same ID.

## Realistic jewel-case rendering

Resized cover requests use `case=realistic-v1`. The server composites artwork beneath `assets/jewel-case-realistic-v1.png` and caches a PNG at the selected resolution. Both local and Spotify open-shelf covers use this presentation. Original artwork still supplies spine colours. The browser adds restrained reflections without a Three.js/WebGL rendering loop.

The [realistic jewel-case texture provenance notes](../assets/jewel-case-realistic-v1.md) document the source asset used by this rendering path.

The browser preloads the focused cover and up to four neighbours on each side, with two low-priority image requests at a time. Queued work follows the latest browsing position, and at most 24 loaded images are retained by the preloader.

### Background artwork preparation

**Settings → Cache → Prepare all artwork** starts a server-wide background job at the selected cover resolution. It fetches missing original artwork, calculates spine metadata and caches photographic case images for every distinct artwork ID. One album is processed at a time, with a short pause between albums and a pause after foreground cover requests. Progress, unavailable items and cancellation are shown in Settings. The job continues when the browser closes; it is not automatically resumed after restarting the server. Starting it again reuses completed cached files. Changing the cover resolution requires starting another run for that resolution.

The worker stops at the configured artwork-cache soft limit (512 MB by default) instead of evicting earlier prepared artwork. It can therefore stop before completing a large library. Foreground cache pruning still applies. Clearing the cache or changing LMS cancels the job; an in-flight request may take up to its normal timeout to finish. This prepares server files, not an offline browser library. `/api/cache/warm` exposes progress (GET) and start/cancel actions (POST). Restart the server after installing this feature.
