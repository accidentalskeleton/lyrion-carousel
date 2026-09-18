# Wall Controller / Display

Status: **future hardware/deployment work**. The interaction below describes the original carousel concept; the current experimental branch uses a spine shelf with a cover that travels with its album. See the repository README for current software behaviour.

## Purpose

Lyrion Carousel is intended to become the dedicated visual browser/controller for the hi-fi system's Lyrion Music Server library. It restores the feel of browsing a physical CD collection while keeping playback on the π5 streamer; the controller does not enter the audio signal path.

The defining interaction is a continuous circular carousel of CD jewel cases. As an album approaches the centre it opens towards the viewer like a rigid page in a book, while neighbouring cases remain angled in depth. The motion follows drag/swipe/trackpad input continuously rather than behaving as a conventional sliding card carousel.

## Architecture

```text
Lyrion Carousel display/controller
               │
               │ local network
               ▼
π5 CM5 streamer / Lyrion Music Server
               │
               ▼
HiFiBerry Digi2 Pro → DSP/room correction → Δ BogDAC → α24 → β24
```

The interface is locally hosted and does not depend on a proprietary cloud service. CometD is used for event-driven player and library state rather than periodic status polling.

## Target wall hardware

The intended final form factor remains approximately 760 mm wide by 180 mm high and 35–45 mm deep, with a black aluminium enclosure, anti-glare front and hidden wall bracket. A stretched-bar display around 1920 × 360 remains the target class; exact panel, touch overlay and compute hardware should be selected after software performance has been measured on representative Raspberry Pi hardware.

## Interaction requirements

- Direct drag/swipe/trackpad/wheel response.
- Continuous circular browsing.
- Gentle inertial movement followed by alignment on one centred album.
- One fully open, square-on selected album.
- Neighbouring jewel cases fan away like book pages rather than simply sliding sideways.
- Tap/click an album to select/play it.
- Keyboard navigation for development/accessibility.
- Restrained now-playing indication and uncluttered normal screen.

## Remaining hardware/deployment decisions

- Exact stretched display and controller.
- Touch technology and supplier.
- Dedicated wall-controller compute platform.
- Final enclosure construction, ventilation and power arrangement.
- Ambient-light brightness control and reliable screen sleep/wake behaviour.
