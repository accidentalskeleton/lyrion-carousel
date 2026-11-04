# Spotify / Spotty integration

Spotify support is part of Lyrion Carousel **0.10.0** on `main`.

## Architecture

Spotify deliberately remains inside the LMS playback architecture:

```text
Lyrion Carousel -> LMS JSON-RPC -> Spotty -> Spotify
                         |
                         +-> Squeezelite -> Digi2 Pro -> DSP -> DAC
```

Carousel does not store Spotify credentials and does not use Spotify Web Playback. Spotty is responsible for Spotify authentication and streaming; LMS remains the authority for player state, queue and playback.

## Catalogue provider

`js/spotify.js` consumes Spotty's registered LMS XMLBrowser/CLI endpoint. It discovers menu nodes from the live response rather than depending on a fixed Albums item ID.

The production source supports:

- saved Spotify albums in the CD shelf display;
- full Spotify album search through Spotty;
- temporary insertion/centering of a search result in the Spotify carousel;
- playback through the selected LMS player;
- saving a searched album using Spotty's **Add Album to Library** action;
- proxied/cached Spotify artwork and realistic jewel-case composition;
- source-aware now-playing matching;
- Album Information when Spotty exposes usable track/year/genre metadata;
- an **Open album in Spotify** link inside Album Information when Spotty supplies a genuine Spotify album permalink or `spotify:album:` URI. When LMS strips the album URI (as demonstrated by `spotty items` on 4 November 2026), show a clearly labelled **Find album on Spotify** search link using album title and artist instead. Never invent a permalink from internal Spotty navigation IDs.

`js/providers/spotify-provider.js` presents these operations through the same provider boundary used by the local LMS library.

## Search and playback

Search accepts free-form artist, album, track or combined text, but Carousel presents album results. Spotty's returned navigation/action parameters are followed rather than calling Spotify endpoints directly.

Selecting a result displays it in the current Spotify carousel. Playing a search-preview album also attempts to save it to the user's Spotify library through Spotty. Playback itself remains LMS/Spotty playback; Carousel does not create a separate Spotify audio path.

## Artwork

Remote Spotty artwork is routed through:

- `/api/spotty-art` for cached/resized artwork and optional `realistic-v1` jewel-case composition;
- `/api/spotty-art-meta` for spine colour/contrast/font metadata.

This avoids hot-linking artwork from the browser and keeps Spotify albums visually consistent with local LMS albums.

## Diagnostics

`spotty-diagnostic.html` and `/api/diagnostics/spotty` inspect the live Spotty menu exposed by LMS. `/api/diagnostics/now-playing` exposes the raw LMS status fields used to diagnose remote Spotify now-playing matching.

Spotty XMLBrowser payloads can vary by LMS/Spotty release and account state. Production code therefore discovers the Albums node dynamically and follows Spotty-provided actions where possible.

## Current limitations

- Spotify support requires a working, authenticated Spotty installation in LMS.
- Spotify Album Information is limited to metadata exposed by Spotty's LMS menu payload; genre/year may be absent.
- Spotify playlists and artist-specific browse screens are not yet separate Carousel views.
