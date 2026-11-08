# Development, tests and migration notes

[← Project overview](../README.md)

## Regression checks

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/regressions.mjs
```

Node is needed only for the JavaScript regression runner. It uses DOM/event doubles and mocked LMS responses; it does not start playback. It checks catalogue paging, scan events, server-switch isolation, display ordering, startup, pinned covers and details. These checks do not replace real-browser visual/touch checks or the live LMS reconnect acceptance sequence above.

## Upgrading to 0.10.0

Restart the Python server (or the Debian service) and refresh the browser. Version 0.10.0 adds the Spotify/Spotty catalogue source, source-aware now playing, Spotify search and album information, genre controls, and the production realistic jewel-case artwork path. Existing artwork/spine metadata remains reusable; clearing the cache is optional.

Spotify support requires the Spotty plugin to be installed and authenticated in LMS. Carousel does not hold Spotify credentials or stream Spotify directly: playback remains LMS → Spotty → the selected LMS/Squeezelite player.
