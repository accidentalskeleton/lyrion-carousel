# Wall Controller / Display

Status: **hardware selected; deployment and on-device validation remain**.

## Purpose

Lyrion Carousel is the dedicated visual browser and controller for the hi-fi system's Lyrion Music Server library. It restores the feel of browsing a physical CD collection while keeping playback on the existing Raspberry Pi CM5 streamer. The wall controller communicates with Lyrion Music Server over the local network and does not enter the audio signal path.

The defining interaction is a continuous circular shelf of CD jewel cases. As an album approaches the centre, its cover travels with it and opens towards the viewer like a rigid page in a book. Drag, swipe, trackpad and wheel input move the shelf continuously rather than stepping through conventional cards.

## Architecture

```text
Corsair XENEON EDGE + dedicated Raspberry Pi 5
                         │
                         │ local network
                         ▼
Raspberry Pi CM5 streamer / Lyrion Music Server
                         │
                         ▼
HiFiBerry Digi2 Pro → DSP/room correction → Δ BogDAC → α24 → β24
```

The controller and streamer are deliberately separate computers. The interface is hosted locally, with CometD providing event-driven player and library state instead of periodic status polling.

## Selected wall hardware

| Component | Selection |
| --- | --- |
| Display | Corsair XENEON EDGE, black |
| Corsair part | CC-9011306-WW |
| Panel | 14.5-inch, 2560 × 720 touchscreen |
| Approximate size | 372 × 120 × 22 mm |
| Controller | Dedicated Raspberry Pi 5 |
| Operating system | Raspberry Pi OS Desktop, 64-bit |
| Browser/session | Chromium kiosk mode under the default labwc desktop session |
| Network | Wired Ethernet preferred; Wi-Fi is a fallback |

The display connection must carry video and touch, while the controller needs a stable power arrangement suitable for unattended startup. Exact cabling, mounting and enclosure details will be finalized after the display has been tested with the Raspberry Pi.

The CM5 streamer's own Raspberry Pi display and LMS interface remain independent of this wall controller.

## Current interaction

- Direct drag, touch swipe, trackpad, mouse-wheel and keyboard navigation.
- Continuous circular browsing with inertial movement and centre alignment.
- A selected album cover that travels with its shelf position and opens square-on at the centre.
- Tap/click selection and playback.
- Previous, play/pause and next transport controls.
- Swipe-up queue with current-track indication and direct queue selection.
- Configurable inactivity sleep and tap-to-wake.

The current sleep implementation is an application-level black overlay. It hides the interface and consumes the first touch to wake safely, but it does **not** claim to switch off the panel or its backlight.

## Startup and kiosk deployment

The Raspberry Pi should boot into the desktop session and launch the repository's Chromium wrapper. The wrapper waits for the local application endpoint, starts Chromium with the kiosk flags documented in the README, and is registered as a labwc autostart command.

Keep the application service and kiosk wrapper separate: systemd supervises the server, while the graphical desktop session owns Chromium. This avoids starting the browser before Wayland is available and makes server/browser failures independently recoverable.

## Display power-management validation

Before replacing the software blackout with physical display sleep, validate all of the following on the production display and cable arrangement:

- Whether the XENEON EDGE advertises DDC/CI and accepts the VESA power-mode VCP command.
- Whether removal of the HDMI/DisplayPort signal enters a true low-power standby state.
- Whether touch remains available as a wake source while the panel is in standby.
- Whether USB power can be switched without also losing the required touch or video data path.
- Reconnection behaviour after display power or video is restored.

Until those checks pass, application-level blackout is the supported sleep mode.

## Remaining deployment work

- Verify the native 2560 × 720 mode, touch mapping and reconnect behaviour on Raspberry Pi OS.
- Confirm the physical display-off method, if any, from manufacturer documentation and hardware tests.
- Measure browser performance and thermals during long-running kiosk use.
- Finalize the wall mount, enclosure, ventilation, cable routing and service access.
- Decide whether ambient-light brightness control is useful after installation.
