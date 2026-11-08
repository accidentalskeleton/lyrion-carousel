# Performance and large-library browsing

[← Project overview](../README.md)

## Performance

### Rendering optimisations

The carousel uses compositor-friendly CSS transforms and renders only a bounded window of albums. Phase 4 **recycles existing spine, label and shell DOM nodes** as the visible window advances, rather than rebuilding every visible spine. Metadata callbacks check album identity before updating reused nodes; width and font geometry only change when needed, and the open jewel-case width is cached with invalidation on resize and preview transitions. It retains the playing-case pinning and manual preview timeout behaviours.

### Large-library alphabet navigation and cache budgets

Letter navigation uses an in-memory map from **A–Z** to the first album index in the current ordered catalogue. The map is rebuilt on catalogue replacement, sort or filter changes, and updated as individual LMS batches arrive. A fully loaded catalogue therefore jumps to a letter without requesting additional album pages or searching every album. A partially loaded LMS catalogue can still fetch missing batches when the requested letter is not yet indexed. The index follows the catalogue's `textkey` values and retains the first occurrence of each letter.

The server caches a maximum of four serialized catalogue orderings **and** a combined 32 MiB of serialized payload bytes. When an order would exceed the budget, the oldest cached orderings are evicted; an individual order larger than 32 MiB is served normally but not retained. The cache remains a small, in-memory optimisation and does not affect catalogue snapshot persistence or correctness.

### Browser performance monitor

The opt-in monitor lives in `js/performance.js` and is exposed as `window.lyrionPerf`. It works in Edge/Chrome DevTools on the controller page (for example `http://streamer:8088`). Normal browsing adds **no extra continuous animation-frame loop, input listeners or DOM MutationObserver**; the monitor starts collecting only when explicitly requested. The existing console warning for main-thread tasks of at least 100 ms remains available when supported.

Open DevTools (**F12 → Console**) and run:

```javascript
lyrionPerf.start({ label: 'Phase 4' });
// Scroll the CD spines for 15–30 seconds, including longer movements.
const phase4 = lyrionPerf.stop();
copy(JSON.stringify(phase4, null, 2));  // Chromium/Edge DevTools copy helper
```

An alternative fixed-duration measurement is:

```javascript
const phase4 = await lyrionPerf.measure({ seconds: 15, label: 'Phase 4' });
copy(JSON.stringify(phase4, null, 2));
```

Start browsing promptly after starting a measurement. Keep the tab in the foreground and use the same viewport, number of visible spines, sort mode and browsing pattern when comparing versions. You may pass `targetFps: 60` to `start()` or `measure()` to impose a fixed budget, but **omitting it is recommended**: the profiler detects the effective refresh rate from foreground `requestAnimationFrame` intervals, including high-refresh displays.

The returned JSON includes:

| Field | Meaning |
| --- | --- |
| `detectedFps`, `effectiveFps`, `frameBudgetMs` | Detected refresh estimate, applied rate and per-frame time budget |
| `sampledFrames`, `estimatedFps`, `frameMs` | Foreground rAF sample count, rate and mean/P95/P99/maximum frame interval |
| `framesOverBudget`, `estimatedDroppedFrames` | Estimated interval overruns relative to the frame budget; **not** actual presented/GPU frame losses |
| `activeScrolling` | Separate sample count, estimated FPS, frame distribution and overruns during carousel wheel/drag/touch/arrow activity plus a 350 ms activity window |
| `suspensions` | Number, total time and longest rAF gaps exceeding 250 ms; excluded from missed-frame and frame-time calculations |
| `longTasks` | Count and total duration of observed main-thread tasks (browser support permitting) |
| `dom` | Initial/final visible spine counts and additions/removals during capture |
| `requests` | Artwork and metadata request counts and reported transferred bytes |
| `heapMB` | Optional Chromium JavaScript heap sizes at start/end |

A `null` value means the browser couldn't establish that metric. Transfer size zero may indicate caching or unavailable transfer timing, **not** proof of zero network traffic. `activeScrolling` is a heuristic for recent user input, not a measurement of exactly which frames displayed a moving shelf. Tab/OS pauses are reported separately, rather than inflating missed-frame estimates.

Compare two captures produced by this version of the profiler using:

```javascript
lyrionPerf.compare(baseline, phase4);
```

The `baseline` and `phase4` variables must contain complete capture objects from equivalent sessions. Earlier reports without `activeScrolling` are not directly comparable on that metric.

### Phase 4 reference measurement (4 November 2026)

A real 36.36-second Edge/Chromium capture while browsing the library reported:

| Metric | Result |
| --- | ---: |
| Detected refresh rate | 142.9 Hz |
| Active scrolling estimated FPS | 143.79 |
| Active scrolling P95 / P99 | 7.0 / 7.1 ms |
| Active scrolling max interval | 7.8 ms |
| Estimated missed frames while active | 0 |
| Overall estimated missed frames | 5 |
| Long tasks / suspensions | 0 / 0 |
| Visible DOM spines (start → finish) | 34 → 34 |
| Spine additions / removals | 12 / 12 |
| JavaScript heap (start → finish) | 2.82 → 2.60 MB |

These are **one browser/session's observations**, not guaranteed results on other hardware, library sizes or display settings. In particular, the capture shows good performance and stable DOM counts, but does not by itself quantify the improvement over an equivalent pre-Phase-4 baseline.

### Simulated library scaling benchmark (8 November 2026)

Lyrion Carousel **0.11.7** (commit `5ad14e08e15bad08fa85dccf25e646a0c1bdbf9d`)
was tested on `streamer`, a **Raspberry Pi 5 Model B**, with simulated collections
of **1,000, 5,000 and 10,000 CDs**. The actual Carousel Python server, catalogue
cache, artwork processing and browser code were exercised against an isolated
simulated LMS. The live music service and its library were not used.

#### Method

- Headless Chromium **156.0.8078.4**, **1920 × 720**, device scale 1,
  **30 displayed albums**, and an open playing cover.
- **SwiftShader software rendering** through ANGLE/Vulkan. These frame rates
  describe this headless setup; they do not predict a hardware-accelerated
  browser's presented frame rate or compare directly with the Edge reference above.
- **Three fresh browser-context runs per collection size and Shelf variety
  setting**: 18 measured runs, each with an eight-second scrolling capture.
  On/off order alternated across repeats.
- Synthetic wheel input followed a time-based trajectory of **20 album
  positions per second**, forwards for four seconds and then back. Travel
  distance stayed consistent when frame rates differed. The generated catalogue
  prefix was shared across sizes; circular wraparound tails had different IDs
  generated by the same rules.
- Libraries included varied artist/title lengths, **25% multi-disc albums**,
  and **20% missing catalogue tags**. Unique artwork IDs used 16 generated
  **512-pixel PNG** designs. Simulated LMS requests included a **5 ms delay**.
- A cold start was recorded once per size. A scrolling warm-up then primed
  server catalogue and artwork caches before the repeated runs. Each measured
  browser context started fresh, so its own metadata and image caches were not
  carried over from the previous run.
- CometD updates were disabled in the served benchmark copy to isolate browsing.
  Draw callbacks were timed and the existing opt-in performance monitor sampled
  frame intervals; application source files were unchanged.

#### Scrolling and warm-server startup

Each value is the median of three runs unless labelled as a range. Frame P95
is the median of the per-run 95th-percentile frame interval, not the percentile
of all runs pooled together. UI-ready is the application's ready signal;
initial cover movement and artwork preparation can finish later.

| CDs | Shelf variety | UI ready, warm server (ms) | Active FPS | FPS range | Frame P95 (ms) | Draw callback P95 (ms) |
| ---: | :--- | ---: | ---: | :--- | ---: | ---: |
| 1,000 | On | 319 | 23.78 | 19.96–24.15 | 66.70 | 6.80 |
| 1,000 | Off | 452 | 23.28 | 22.78–24.65 | 66.70 | 7.20 |
| 5,000 | On | 381 | 23.78 | 21.46–24.08 | 83.30 | 7.50 |
| 5,000 | Off | 402 | 24.10 | 23.83–25.15 | 66.64 | 6.40 |
| 10,000 | On | 333 | 24.90 | 21.58–24.92 | 66.60 | 7.50 |
| 10,000 | Off | 397 | 25.52 | 23.48–26.07 | 66.70 | 7.00 |

#### Memory, DOM reuse and idle behaviour

JavaScript heap was measured through Chromium CDP **after forced garbage
collection**, outside the scrolling capture. It excludes decoded artwork,
GPU buffers and other browser-native memory. Server RSS is a separate Python
process measurement. On/off results were effectively identical at the precision
shown below; these are the variety-on medians.

| CDs | JavaScript heap (MiB) | Server RSS (MiB) | Spine elements, including buffers |
| ---: | ---: | ---: | ---: |
| 1,000 | 2.93 | 54.1 | 42 |
| 5,000 | 4.71 | 58.1 | 42 |
| 10,000 | 6.94 | 62.5 | 42 |

All 18 runs retained **42 spine elements**, with **zero spine additions or
removals during scrolling**. After the final wheel snap settled, every idle
observation recorded **zero draw and shelf-sync calls over 1.5 seconds**.
No browser JavaScript errors or unexpected simulated LMS commands occurred.

A separate 1,000-call position-lookup and geometry-inversion check took median
**1.5 ms, 2.5 ms and 3.1 ms** respectively with Shelf variety on.

#### First cold start

These are **single observations**, with Shelf variety on, rather than repeated-run
medians. Initially settled also waits for initial movement, metadata and cover
preparation.

| CDs | UI ready (ms) | Initially settled (ms) |
| ---: | ---: | ---: |
| 1,000 | 405 | 1,584 |
| 5,000 | 631 | 2,058 |
| 10,000 | 808 | 1,973 |

#### Interpretation and limits

Catalogue size increased JavaScript heap and server memory modestly, while the
rendered shelf stayed bounded. The runs showed no monotonic scrolling-FPS
decline as collection size increased. Shelf variety's on/off median FPS
differences were small and the ranges overlapped; tail frame times sometimes
increased with variety, so these short samples do not establish a statistically
significant cost.

The software-rendered setup remained below 60 FPS even for 1,000 CDs. Treat
these results as a collection-scaling comparison, not a hardware-accelerated
kiosk performance guarantee. CPU temperature was **53.5 °C** at the start and
**54.0 °C** at the end.

This benchmark covers a fixed scrolling neighbourhood. It does **not** measure
real LMS database or FLAC-tag I/O, LAN outages, loading every artwork item,
colour-sort preparation, long-running memory retention, or a physical display's
presented frames. Cold-start times also depend on the simulated request delay.
