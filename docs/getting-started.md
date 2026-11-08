# Getting started

[← Project overview](../README.md) · [Windows installation](windows.md)

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

For Windows, including the latest ZIP download, portable execution, Windows Service installation and troubleshooting, see the **[Windows installation guide](windows.md)**.

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
