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
| NumPy (`python3-numpy`) | Declared Debian dependency | BSD-3-Clause (plus notices for bundled components in upstream builds) | https://github.com/numpy/numpy/blob/main/LICENSE.txt |
| OpenCV (`python3-opencv`) | Declared Debian dependency | Apache-2.0 in OpenCV 4.5.0 and later; older versions used BSD-3-Clause | https://opencv.org/license/ |

Do not copy these dependencies' license texts into a bundled third-party
directory unless the distribution model changes. **If future binary bundles,
wheels or vendored source are shipped, re-evaluate their actual included
licenses and copyright/notice obligations.**

## External integrations — not bundled

- **Lyrion Music Server (LMS), Squeezebox and Squeezelite:** Lyrion Carousel is
  an independent controller using the LMS interfaces. The servers, players,
  their code and trademarks are not included in this source tree.
  Project: https://lyrion.org/
- **Spotty and Spotify:** Playback and authentication use the separately
  installed LMS Spotty plugin. Lyrion Carousel does not include or redistribute
  Spotify music, credentials or the Spotty plugin's source code.
  The Spotify name, logo, album metadata and cover images belong to their
  respective rights holders. Spotify's developer policy may require clear
  service attribution and links to the relevant Spotify content if its
  platform content is displayed:
  https://developer.spotify.com/policy

## Tracked visual/media assets — publication review

| Asset | Identified provenance | Publication action |
| --- | --- | --- |
| `assets/jewel-case-realistic-v1.png` | `assets/jewel-case-realistic-v1.md` records that the jewel-case PNG was created using an image-generation tool on 18 September 2026 | Verify that the generated output contains no copied third-party branding or artwork; retain provenance note |
| `assets/jewel-case-spine-v1.svg` | Vector jewel-case illustration committed with the project; no external source or trademark found in its SVG markup | Confirm author/rights holder before applying project GPL terms |
| `assets/lyrion-carousel-icon.svg` | Vector UI icon committed with the project; SVG markup contains simple shapes, no third-party links | Confirm author/rights holder |
| `assets/lyrion-carousel-banner.jpg` | Binary README banner; Git history confirms addition but does **not** prove the sources/rights of its contents | **Review the actual image** for third-party album covers, photographs and logos; replace with cleared mock covers or document permissions before publication |
| `assets/lyrion-carousel-feature-tour.mp4` | Binary feature-tour video; Git history confirms addition but does **not** establish imagery, artwork or soundtrack permissions | **Review each scene and audio** for protected music, album covers and other third-party works; re-record with cleared demo data if uncertain |
| `assets/jewel-case-overlay.svg` | Legacy Fan-only vector overlay | Planned removal in the separate shelf-only PR; avoid distributing unused assets |

The source uses local system font families rather than bundling font binaries.
The README support badge is served by Shields.io at view time; its remote
image is **not included in the Git repository or the Debian package**.

### Dynamically loaded album covers

Artwork served from a user's own LMS/Spotty instance is fetched at runtime
and cached on that user's device. It is **not distributed in this repository**.
That distinction does not confer rights to republish those covers in the README,
release screenshots, demonstration videos or sample library datasets.

### Outstanding release decisions

1. Obtain an affirmative provenance/rights check for the banner image and
   feature-tour video. If either includes recognisable commercial album covers,
   music or unauthorised third-party graphics, use cleared examples or obtain
   suitable permission rather than treating GPL as a licence to redistribute.
2. Confirm ownership of the project-authored SVG files and generated jewel-case
   image; list any exceptions to the project's GPL grant explicitly.
3. Check current Spotify attribution/link-back requirements against the actual
   Spotify/Spotty display behaviour; availability through LMS does not
   necessarily establish that every developer-policy requirement is met.
4. Before creating a public release, inspect past commits, tags and branches for
   removed assets, private content and embedded secrets; deleting a current
   file does **not** erase its Git history.
