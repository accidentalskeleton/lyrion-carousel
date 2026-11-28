# Contributing to Lyrion Carousel

[← Project overview](README.md)

Thank you for helping improve Lyrion Carousel.

## Submitting changes

1. Open an issue to discuss significant features or behaviour changes.
2. Fork the repository or create a feature branch. Never push directly to `main`.
3. Make a focused change and add regression coverage for affected behaviour.
4. Run the checks below and open a pull request against `main`.
5. Resolve reviewer feedback and all CI failures. The maintainer decides whether and when to merge.

```bash
node tests/regressions.mjs
python3 -m py_compile server.py tests/test_server.py
python3 -W always::ResourceWarning -m unittest discover -s tests -p 'test_*.py'
```

Python tests require Pillow (`python3-pil` on Debian or the `Pillow` Python package).
Node.js and Python 3 are required for the checks. Full hardware/LMS integration
and Debian-package deployment should also be exercised where relevant.

## Shelf browser checks

Serve the checkout, then open `/tests/shelf-browser.html`. Its title reports
the result of real DOM/CSS, animation, wheel, keyboard and playback-status
checks. All catalogue/status data is fixture-only; no LMS commands are sent.
The test page intentionally replaces the application startup, not its shelf
implementation or browser layout engine.

For trusted pointer capture, cover/spine dragging, wheel and keyboard input at
1280x800, 2560x720 and 390x844, run the Playwright driver. CI also runs it.
Playwright is a test-only dependency installed outside the checkout:

```bash
cd ~/code/lyrion-carousel
npm install --prefix /tmp/lyrion-browser-tests playwright@1.56.1
/tmp/lyrion-browser-tests/node_modules/.bin/playwright install chromium
python3 -m http.server 8089 --bind 127.0.0.1
```

In another terminal:

```bash
cd ~/code/lyrion-carousel
PLAYWRIGHT_MODULE=/tmp/lyrion-browser-tests/node_modules/playwright/index.mjs node tests/shelf-playwright.mjs http://127.0.0.1:8089/
```

Recently Added keeps a fixed scroll domain based on the closed shelf. An open
case replaces one spine with a wider slot. The extra width is distributed
across that domain, so the first and last slots still reach the viewport edges.
Centring and dragging invert that same mapping; rendering must not apply an
independent edge clamp. Case measurements must exclude preview transforms.
Finite wheel input must retain small deltas: snapping a 120-unit wheel notch
back to the nearest spine erased its entire movement. Circular modes keep
their existing geometry and wheel-release snapping.

## Delayed startup browser check

Unlike the shelf fixture, this check opens the real application. Start a
separate Carousel server on port 18088 with a reachable LMS and a nonempty
library; use a temporary artwork cache to keep production cache data separate.

```bash
python3 server.py --lms http://streamer:9000 --bind 0.0.0.0 --port 18088 \
  --cache-dir "$(mktemp -d /tmp/carousel-startup.XXXXXX)"
```

In another terminal, using the Playwright installation from above (or a
persistent installation outside the checkout):

```bash
PLAYWRIGHT_MODULE=/tmp/lyrion-browser-tests/node_modules/playwright/index.mjs \
  node tests/startup-playwright.mjs http://127.0.0.1:18088/ /tmp/carousel-startup.png
```

The test uses a fresh browser context, intercepts the initial LMS albums
request for at least ten seconds, verifies the visible startup message,
captures a local screenshot, and releases the request to check that the
real LMS shelf appears and the message disappears. It sends no playback
commands. Do not commit screenshots of a real music library. This is a
separate integration test requiring LMS, not part of the static shelf fixture.

## Security and privacy

Do not commit access tokens, passwords, SSH keys, real private network details,
personal data, credentials, library contents or local cache snapshots. Use
sanitised examples. Report vulnerabilities privately using [SECURITY.md](SECURITY.md);
do not open public issues or pull requests containing exploit details.

Pull requests from forks do not need repository write access. CI for pull requests
has read-only repository permissions and must not access secrets.

## Style and scope

Keep the existing lightweight browser architecture and bounded caches.
Avoid adding new runtime dependencies without discussing the trade-offs.
Protect the permanent playing-case preview and manual-preview timeout behaviour.
Do not change `VERSION` for ordinary fixes or development work.
