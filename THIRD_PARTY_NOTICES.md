# Third-party software and asset notices

Lyrion Carousel's original application source code is licensed under
**GNU GPL version 3.0 only** (`GPL-3.0-only`), as recorded in
[LICENSE](LICENSE). **A GPL notice does not grant rights to any
third-party album art, logos, screenshots or recordings.**

This inventory is based on the tracked files and Debian packaging as reviewed
on 4 November 2026. It is not a substitute for checking the provenance of
the visual assets and any older versions still present in Git history.

## Runtime software dependencies — installed separately

The repository does **not** vendor Python wheels, OpenCV binaries, a JavaScript
framework, icon library or downloaded web fonts. The Debian package declares
system-package dependencies; when Debian installs those packages, their own
notices and licenses remain applicable.

| Dependency | Purpose | Upstream licence | Licence/source |
| --- | --- | --- | --- |
| Python / standard library | HTTP server, networking and caching | Python Software Foundation License | https://docs.python.org/3/license.html |
| Pillow (`python3-pil`) | Artwork processing | Historical Permission Notice and Disclaimer (HPND) | https://github.com/python-pillow/Pillow/blob/main/LICENSE |

**Dependency cleanup:** The package previously declared `python3-opencv` and `python3-numpy`, but no tracked application code or tests import OpenCV or NumPy. Those two unused requirements have been removed from `packaging/debian/control.in` during the publication audit. If future features use them, declare them again and review their respective upstream notices (NumPy BSD-3-Clause; OpenCV 4.5+ Apache-2.0).

Do not copy these dependencies' license texts into a bundled third-party
directory unless the distribution model changes. **If future binary bundles,
wheels or vendored source are shipped, re-evaluate their actual included
licenses and copyright/notice obligations.**

## Optional Windows binary distribution

The Windows x64 ZIP built by GitHub Actions bundles the Python runtime and
Pillow through PyInstaller (PyInstaller is the build tool, not an application
service). It also bundles **Windows Service Wrapper (WinSW) v2.12.0**, licensed
under MIT, with its full `WinSW-LICENSE.txt` inside the downloadable ZIP.
WinSW upstream: https://github.com/winsw/winsw

These notices do not supersede the copyright and licence obligations of the
Python runtime and third-party modules within the PyInstaller distribution.
Release maintainers should check bundled dependency notices when updating
Python, Pillow, PyInstaller or WinSW.

## External integrations — not bundled

- **Lyrion Music Server (LMS), Squeezebox and Squeezelite:** Lyrion Carousel is
  an independent controller using the LMS interfaces. The servers, players,
  their code and trademarks are not included in this source tree.
  Project: https://lyrion.org/
- **Spotty and Spotify:** Playback and authentication use the separately
  installed LMS Spotty plugin. Lyrion Carousel does not include or redistribute
  Spotify music, credentials or the Spotty plugin's source code.
  The Spotify name, logo, album metadata and cover images belong to their
  respective rights holders. The current application includes an inline
  Spotify source icon in Now Playing; that icon is a third-party trademark,
  not an original project asset. Spotify's developer policy calls for clear
  service attribution and links to applicable content for use of Spotify
  cover art and metadata. **The current interface has not been verified to
  meet those presentation requirements**, especially for album link-backs:
  https://developer.spotify.com/policy
  https://developer.spotify.com/documentation/design

## Tracked visual/media assets — publication review

| Asset | Identified provenance | Publication action |
| --- | --- | --- |
| `assets/jewel-case-realistic-v1.png` | `assets/jewel-case-realistic-v1.md` records that the jewel-case PNG was created using an image-generation tool on 18 September 2026 | Verify that the generated output contains no copied third-party branding or artwork; retain provenance note |
| `assets/jewel-case-spine-v1.svg` | Vector jewel-case illustration committed with the project; no external source or trademark found in its SVG markup | Confirm author/rights holder before applying project GPL terms |
| `assets/lyrion-carousel-icon.svg` | Vector UI icon committed with the project; SVG markup contains simple shapes, no third-party links | Confirm author/rights holder |
| `assets/lyrion-carousel-banner.jpg` | Refreshed 10 November 2026 with a screenshot of the running Carousel, with Shelf variety enabled; original banner creator attribution remains Stuart Roberts | Screenshot includes commercial album names and derived artwork colours. Third-party content remains subject to its own rights |
| `assets/lyrion-carousel-feature-tour.mp4` | Refreshed 10 November 2026 using a Playwright recording of the current interface, with captions and chapter markers; original tour creator attribution remains Stuart Roberts | H.264, 1600 × 900, 2 min 33 sec; verified no audio stream. Playback is simulated. Displayed commercial album covers and service trademarks remain subject to their own rights |
| `assets/jewel-case-overlay.svg` | Deprecated vector overlay used by an early prototype | Removed from the forthcoming shelf-only release in PR #28; old Git commits may still contain the asset |

The source uses local system font families rather than bundling font binaries.
The README support badge is served by Shields.io at view time; its remote
image is **not included in the Git repository or the Debian package**.

### Dynamically loaded album covers

Artwork served from a user's own LMS/Spotty instance is fetched at runtime
and cached on that user's device. It is **not distributed in this repository**.
That distinction does not confer rights to republish those covers in the README,
release screenshots, demonstration videos or sample library datasets.

### Outstanding release decisions

1. **Creator of banner and video confirmed: Stuart Roberts.** Before publishing,
   review *underlying content* in those assets. If either includes commercial
   album covers, music or unauthorised third-party graphics, use cleared
   examples or obtain suitable permission. The feature-tour recording has
   **no audio soundtrack** (confirmed by its creator). Creating the composition
   or recording does not itself license embedded third-party visuals.
2. Confirm ownership of the project-authored SVG files and generated jewel-case
   image; list any exceptions to the project's GPL grant explicitly.
3. Check current Spotify attribution/link-back requirements against the actual
   Spotify/Spotty display behaviour; availability through LMS does not
   necessarily establish that every developer-policy requirement is met.
4. Before creating a public release, inspect past commits, tags and branches for
   removed assets, private content and embedded secrets; deleting a current
   file does **not** erase its Git history.
