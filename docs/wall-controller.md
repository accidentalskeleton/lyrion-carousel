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
| Panel | 14.5-inch AHVA, 2560 × 720 at 60 Hz |
| Approximate size | 372 × 120 × 22 mm |
| Video inputs | HDMI or USB Type-C DisplayPort Alt Mode |
| Display power | USB Type-C, 5 V at 2 A |
| Controller | Dedicated Raspberry Pi 5 |
| Operating system | Raspberry Pi OS Desktop, 64-bit |
| Browser/session | Chromium kiosk mode under the default labwc desktop session |
| Network | Wired Ethernet preferred; Wi-Fi is a fallback |

These display specifications come from the [Corsair XENEON EDGE quick-start guide](https://www.corsair.com/us/en/explorer/gamer/monitors/corsair-xeneon-edge/).

The likely Raspberry Pi arrangement is a two-cable connection: HDMI for video plus USB for touch data and display power. Corsair states that a charge-only USB connection disables touch and that the USB-C port is essential for operation. Because the Pi 5 does not provide a USB-C host port and the display requires up to 5 V/2 A, the production design may need a powered USB hub or another power/data arrangement that is proven on the actual hardware; do not assume an unpowered USB-A-to-C cable is sufficient.

The CM5 streamer's own Raspberry Pi display and LMS interface remain independent of this wall controller.

## Current interaction

- Direct drag, touch swipe, trackpad, mouse-wheel and keyboard navigation.
- Continuous circular browsing with inertial movement and centre alignment.
- A selected album cover that travels with its shelf position and opens square-on at the centre.
- Tap/click selection and playback.
- Previous, play/pause and next transport controls.
- Swipe-up queue with current-track indication and direct queue selection.
- Configurable inactivity sleep and tap-to-wake.

The current sleep implementation is an application-level black overlay. It hides the interface and consumes the first touch to wake safely, but it does **not** switch off the panel or its backlight.

## Startup and kiosk deployment

The Raspberry Pi should boot into the desktop session and launch the repository's Chromium wrapper. The wrapper waits for the local application endpoint, starts Chromium with the kiosk flags documented in the README, and is registered as a labwc autostart command.

Keep the application service and kiosk wrapper separate: systemd supervises the server, while the graphical desktop session owns Chromium. This avoids starting the browser before Wayland is available and makes server/browser failures independently recoverable.

## Display power management

Corsair's specification and quick-start guide do **not** document DDC/CI, VESA power-mode commands, DPMS/no-signal standby, wake behaviour or a whole-display software power-off command.

The guide documents a backlight control in iCUE and says that the XENEON EDGE has no button-driven on-screen display. It lists Windows 11 as the supported operating system. That makes iCUE backlight control a documented Windows feature, not a supported Raspberry Pi/Linux interface.

For the Raspberry Pi deployment:

- Keep application-level blackout as the supported sleep mode.
- Treat Wayland output power-off as an experiment only; the guide does not promise how the display behaves when the video signal disappears.
- Do not assume `ddcutil` can control the display until `ddcutil detect` and the available VCP features have been checked on the real unit.
- Removing USB-C power will necessarily turn the display off because that port is essential for operation, but it also removes touch and therefore prevents tap-to-wake. A hardware power switch would need an independent wake trigger and verified USB reconnection behaviour.
- A Linux implementation of Corsair's USB/iCUE backlight control would be reverse-engineered and unsupported by the published specification.

## Hardware acceptance checks

- Verify the native 2560 × 720 mode and stable 60 Hz output on Raspberry Pi OS.
- Verify touch enumeration, coordinate mapping and reconnect behaviour.
- Confirm that the chosen USB topology supplies adequate power while preserving touch data.
- Run `ddcutil detect` and record any exposed VCP features.
- Test compositor output-off/on and record panel, backlight, touch and wake behaviour.
- Test a USB power cycle and confirm that video and touch recover without restarting Chromium.
- Measure browser performance and thermals during long-running kiosk use.
- Finalize the wall mount, enclosure, ventilation, cable routing and service access.
- Decide whether ambient-light brightness control is useful after installation.
