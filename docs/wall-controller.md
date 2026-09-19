# Wall Controller / Display

Status: **primary hardware selected; Linux-supported alternative evaluated; deployment and on-device validation remain**.

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

## Primary wall hardware

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

## Linux-supported alternative: Waveshare 12.3inch HDMI LCD

The [Waveshare 12.3inch HDMI LCD (22841)](https://www.waveshare.com/12.3inch-hdmi-lcd.htm) is the preferred alternative when explicit Raspberry Pi/Linux touch support is more important than the Corsair's greater width and finished enclosure.

| Characteristic | Waveshare 12.3inch HDMI LCD |
| --- | --- |
| Panel | 12.3-inch IPS, 1920 × 720 |
| Approximate size | 301.2 × 123.35 × 12.4 mm |
| Active area | 293.1 × 110.2 mm |
| Video | HDMI |
| Touch | USB capacitive touch |
| Raspberry Pi OS/Raspbian | Driver-free 10-point touch |
| Ubuntu/Kali | Driver-free single-point touch |
| Brightness | Approximately 600 cd/m² |
| Power | Separate 12 V supply |

The same dimensions and compatibility claims are listed by independent suppliers including [Kiwi Electronics](https://www.kiwi-electronics.com/en/12-3inch-capacitive-touch-display-1920x720-20597) and [Malina314](https://malina314.com/proizvod/12-3inch-capacitive-touch-screen-lcd-1920x720-hdmi-ips-toughened-glass-panel/).

The Waveshare retains the full 720-pixel vertical resolution needed by the carousel, transport controls and swipe-up queue, but provides 25% fewer horizontal pixels than the Corsair. Validate both Shelf and Fan modes, the chosen displayed-album count, minimum spine width, queue gestures, long-press menus and Chromium kiosk operation at a 1920 × 720 viewport with 100% display scaling.

This is an embedded-style assembly rather than a finished consumer monitor. Its controller/button board, 12 V supply, cabling and wall mounting must be incorporated into the final enclosure.

The application-level black sleep overlay remains the supported initial sleep method and preserves touch-to-wake. Do not assume that Linux DPMS will switch off the Waveshare backlight. Waveshare documents an optional hardware PWM modification involving removal of an onboard resistor and connection to a PWM pad; verify the exact controller-board revision and electrical requirements before considering GPIO control. Cutting the 12 V supply turns the display off but also removes USB touch, so it cannot provide touch-to-wake.

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
- If the Waveshare alternative is selected, repeat visual, performance and touch checks at its native 1920 × 720 resolution.
- Verify touch enumeration, coordinate mapping and reconnect behaviour.
- Confirm that the chosen USB topology supplies adequate power while preserving touch data.
- Run `ddcutil detect` and record any exposed VCP features.
- Test compositor output-off/on and record panel, backlight, touch and wake behaviour.
- Test a USB power cycle and confirm that video and touch recover without restarting Chromium.
- Measure browser performance and thermals during long-running kiosk use.
- Finalize the wall mount, enclosure, ventilation, cable routing and service access.
- Decide whether ambient-light brightness control is useful after installation.
