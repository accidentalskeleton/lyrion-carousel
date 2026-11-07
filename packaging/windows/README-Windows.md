# Lyrion Carousel — optional Windows server package

**Linux/Debian remains the primary supported and tested platform.** This Windows x64
package is a best-effort alternative for local browsing, development and
dedicated Windows machines. It does **not** include Lyrion Music Server (LMS).

The archive includes:
- app/LyrionCarousel.exe with its PyInstaller runtime, Python dependencies,
  artwork assets, JavaScript and CSS (no separate Python install required);
- Start-Carousel.ps1 for portable, non-administrator use;
- LyrionCarouselService.exe (WinSW 2.12.0) and its XML configuration;
- Install-Service.ps1 and Uninstall-Service.ps1 for the optional automatic service;
- VERSION, GPL licence, third-party notices, and WinSW MIT licence.

## Use the portable server (no Administrator rights)

Extract the **whole ZIP** (not just the EXE) and open PowerShell in the
extracted LyrionCarousel-Windows-x64-v<version> folder:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-Carousel.ps1 -LmsUrl http://streamer:9000 -Port 18088

Then visit http://127.0.0.1:18088/ in a modern browser. Replace the LMS
URL with your existing server's LAN address. Stop the server with Ctrl+C.
Artwork is cached at %LOCALAPPDATA%\LyrionCarousel\cache\album-art.
To use port 8088 instead, pass -Port 8088; Windows can reserve that port
and produce [WinError 10013], so 18088 is the recommended first attempt.

## Install the optional automatic Windows service

Open **PowerShell as Administrator** in the extracted archive folder:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Service.ps1 -LmsUrl http://streamer:9000 -Port 18088

The installer copies the server and WinSW wrapper into
C:\Program Files\LyrionCarousel, registers an automatically started
LyrionCarousel service, and starts it. The service runs as **LocalService**,
not LocalSystem. Its HTTP listener binds only to **127.0.0.1**, so it does
not accept LAN connections from other computers by default.

The service uses these separate, persistent directories:
- %ProgramData%\LyrionCarousel\cache\album-art — persistent artwork cache;
- %ProgramData%\LyrionCarousel\logs — WinSW/server logs.

The installer grants LocalService write access to these directories, not
the application binaries in Program Files. Run the installer only from a
trusted downloaded package. Do not install a privileged Windows service
from a user-writable downloads directory.

To stop and unregister the service, open Administrator PowerShell and run:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\LyrionCarousel\Uninstall-Service.ps1"

Uninstalling preserves application binaries and cached data for explicit
manual removal. Before upgrading, **uninstall the existing service** and
run the installer from the new ZIP. Do not run the portable launcher on
the same port while the service is active.

To inspect service state:

    Get-Service LyrionCarousel

## Limitations and security

- Windows packages are x64-only and are currently built automatically
  using GitHub-hosted Windows runners. The binaries are not code signed.
  Windows SmartScreen may warn when launching an unsigned executable.
- This ZIP is a portable distribution with service helper scripts, **not**
  an MSI or interactive installer.
- Certain local-file-derived catalogue numbers depend on access to LMS
  music files and the optional metaflac program, which are not bundled.
- Initial artwork colour calculation can take time on a cold Windows cache.
- A browser refresh may abort an in-flight CometD long poll; this does not
  necessarily imply an LMS failure.
- Keep Carousel and LMS on trusted networks. For LAN-hosted controllers,
  review the server's allowed-host and bind policies; this installer uses
  a loopback-only listener for safety.
- A service runs without an interactive desktop, so use Edge/Chrome
  separately for the album browser. No Raspberry Pi LMS installation is
  removed or altered by this Windows package.

WinSW is MIT licensed. Its licence is included as WinSW-LICENSE.txt.
See THIRD_PARTY_NOTICES.md for other dependencies and attribution.
