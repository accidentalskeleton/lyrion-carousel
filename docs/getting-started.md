# Getting started

[← Project overview](../README.md) · [Windows service guide](../packaging/windows/README-Windows.md)

## Run directly

On Debian/Ubuntu, install the image dependency first with `sudo apt install python3-pil`. On other systems install Pillow into your Python environment.

```bash
cd lyrion-carousel
python3 server.py
```

Open `http://127.0.0.1:8088/`. For trusted-LAN access:

```bash
python3 server.py --bind 0.0.0.0
```

`0.0.0.0` is a listening address, not a browser destination. Do not expose this server directly to the internet.

### Running on Windows (best effort)

**Linux/Debian is the primary development, deployment and testing platform.** Windows is useful for local development and browser testing, and the Python server can run there, but Windows is **not a primary platform focus**. A separately packaged Windows x64 ZIP provides a portable executable and optional service-installation scripts, but Windows remains a best-effort platform and some OS-specific features may differ.

**Windows ZIP download:** Open the [latest GitHub release](https://github.com/accidentalskeleton/lyrion-carousel/releases/latest) and download the `LyrionCarousel-Windows-x64-v*.zip` file from **Assets** (not the source-code ZIP). The bundle includes the standalone executable and optional Windows Service scripts.

Install Python 3.9 or later (including the Python Launcher for Windows, `py`) and Git. From **PowerShell**, run:

```powershell
git clone https://github.com/accidentalskeleton/lyrion-carousel.git
cd lyrion-carousel
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install Pillow
.\.venv\Scripts\python.exe server.py --lms http://streamer:9000 --port 18088
```

Replace `http://streamer:9000` with the address of your reachable LMS server. Open **http://127.0.0.1:18088/** in Edge or another modern browser. Leave the PowerShell window open while using Carousel; press **Ctrl+C** to stop it. The virtual-environment commands above don't require PowerShell script activation. If `py` is unavailable, use `python` to create the virtual environment.

If you prefer a packaged executable without installing Python, see [Windows packaging and optional service installation](../packaging/windows/README-Windows.md). A Windows release ZIP includes WinSW scripts for installing and removing the optional Windows service; the scripts require Administrator privileges.

Port `8088` is the default. The example uses `18088` because Windows may reserve or block `8088`, returning `[WinError 10013]`; choose another available port if necessary. To inspect reserved ports, run `netsh interface ipv4 show excludedportrange protocol=tcp`.

On first use, album spines may initially show neutral grey while the Windows server downloads artwork and computes colour metadata. The local cache at `.cache/album-art` makes repeat visits faster; **Settings → About → Prepare all artwork** can populate it in advance. A browser refresh can interrupt an outstanding CometD long-poll request and produce a `[WinError 10053]` aborted-connection message; that does not by itself mean LMS or artwork loading has failed.

The Debian `.deb` packaging and `systemd` service do not apply on Windows. Catalogue numbers come from LMS's raw track tags: **no music-folder mount, ripper metadata or Windows `metaflac` installation is necessary**. Other OS-specific behaviour may still differ. Keep both the Windows HTTP server and LMS accessible only on a trusted local network; do not expose either to the public internet.

### HTTP Host and cross-site request protection

Carousel validates every incoming HTTP `Host` header **before** serving static content or proxying LMS calls. Loopback IPs, RFC 1918 private IPv4 addresses, IPv6 unique-local/link-local addresses, `localhost`, the machine's hostname and its `.local` form are accepted. Arbitrary public DNS names and unconfigured `.local`, `.lan` and `.home.arpa` names are **not** accepted. Additional local names can be explicitly permitted:

```bash
python3 server.py --bind 0.0.0.0 --allowed-hosts 'controller.lan,controller.home.arpa'
```

When installed as a systemd service, specify `ALLOWED_HOSTS=controller.lan,controller.home.arpa` in `/etc/default/lyrion-carousel`. The built-in `streamer` hostname is accepted when the machine's actual hostname is `streamer`, preserving `http://streamer:8088`. The `--allowed-hosts` option names permitted browser hostnames; it is **not an authentication system**.

All API POST requests require `X-Lyrion-Request: 1`. Browser requests also reject an `Origin` inconsistent with the request Host, and cross-site `Sec-Fetch-Site` values. The custom header prevents basic cross-site forms from triggering configuration and playback endpoints; ordinary CLI clients may send the header without an Origin. These checks reduce DNS-rebinding and CSRF exposure, but do not authenticate LAN clients. **Keep port 8088 and the LMS server reachable only from trusted network clients or via a VPN.**

## Runtime options

| Option | Default | Purpose |
| --- | ---: | --- |
| `--lms` | `http://streamer:9000` | Lyrion Music Server base URL |
| `--bind` | `127.0.0.1` | Controller listening address |
| `--port` | `8088` | Controller HTTP port |
| `--allowed-hosts` | appliance hostname | Extra comma-separated local browser hostnames |
| `--cache-dir` | `.cache/album-art` | Persistent album cache location |
| `--cache-limit-mb` | `512` | Initial soft artwork-cache limit, adjustable from the browser |
| `--cache-hard-limit-mb` | `2000` | Server-only ceiling for browser cache-limit changes |
| `--clear-cache` | off | Delete cached artwork, resized covers and metadata before starting |
| `--batch-size` | `40` | Albums per browser fallback/index request (server ordering uses 200) |
| `--idle-return-seconds` | `30` | Default inactivity before returning to now playing; `0` disables |
| `--reconnect-max-seconds` | `30` | Maximum reconnect delay |
| `--random-scroll-max-seconds` | `3` | Maximum random/startup/idle-return scroll duration |
| `--search-limit` | `100` | Maximum albums returned by a search |

Settings are grouped into Display, Playback, Connection, Genres, Cache, About and Coffee tabs. Changes apply immediately and are saved in this browser. They include LMS URL, player, idle return, menu/preview timeouts, maximum scroll duration, displayed albums, display style, cover resolution and keeping the playing cover open. The Cache tab can adjust the soft artwork-cache limit up to the server-configured hard limit. The obsolete carousel-density control has been removed; use Displayed albums to set spine width and spacing.

The server URL is shared runtime state on the proxy. Set `LMS_URL` in `/etc/default/lyrion-carousel` for a persistent machine-wide default. Saved browser choices override server defaults; the saved LMS URL is applied before initial discovery.
