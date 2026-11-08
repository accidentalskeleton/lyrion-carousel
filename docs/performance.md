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
