# Getting started

[← Project overview](../README.md)

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
| `--allowed-hosts` | none | Additional comma-separated local browser hostnames beyond those auto-accepted on the local network |
| `--cache-dir` | `.cache/album-art` | Disposable artwork image directory; the single SQLite metadata database is created in its parent |
| `--cache-limit-mb` | `512` | Initial soft artwork-cache limit, adjustable from the browser |
| `--cache-hard-limit-mb` | `2000` | Server-only ceiling for browser cache-limit changes |
| `--clear-cache` | off | Clear cached images, derived spine metadata and catalogue snapshots before starting, **preserving historical Recently Added dates** in the SQLite database |
| `--batch-size` | `40` | Albums per browser fallback/index request (server ordering uses 200) |
| `--idle-return-seconds` | `30` | Default inactivity before returning to now playing; `0` disables |
| `--reconnect-max-seconds` | `30` | Maximum reconnect delay |
| `--random-scroll-max-seconds` | `3` | Maximum random/startup/idle-return scroll duration |
| `--search-limit` | `100` | Maximum albums returned by a search |

Settings are grouped into **Display**, **Playback**, **Connection**, **Genres**, **Cache**, **About** and **Coffee** tabs. Display controls the number of visible albums, shelf variety, catalogue codes and artwork resolution. Playback controls idle return, screen sleep, manual cover/menu timeouts and maximum scroll duration. Connection selects the LMS server and player; Genres filters the Library shelf. Cache prepares artwork, sets the soft cache limit (up to the server hard limit) and clears the cache. About shows status and update checking. Most display/playback choices are saved in the current browser; changing the LMS URL also persists that choice on the Carousel server. The playing/paused album's cover **always stays open** while browsing: there is no longer a **Keep playing album open** switch or a display-style selector. See the [current Settings reference](usage.md#settings-reference).

The server URL is shared runtime state on the proxy. Set `LMS_URL` in `/etc/default/lyrion-carousel` as the initial machine-wide default. A server selected in **Settings → Connection** is also saved by Carousel on disk and reused after service restarts. A browser with a different previously saved server URL may apply that choice when it connects, updating the shared server. See [LMS URL across service restarts](architecture.md#lms-url-across-service-restarts).
