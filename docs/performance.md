# Initial measurements and verification

## Ground footprint rendering correction

The footprint gap regression is covered by a rendered-pixel browser test: coverage over unobstructed terrain must remain painted when the displayed DEM is five metres above the calculation DEM. The original custom mesh failed with four black samples; matching DEM heights passed. Native terrain-draped fill/line layers now pass the mismatched-height case. All 18 packed-consumer checks and the 16 Node tests pass. The physical visibility solver is unchanged.

The workload and bundle measurements below predate this ground-rendering correction and the single-asset scenario. They are historical measurements, not measurements of the updated path.

## Airborne entities follow-up

Measured on 2026-09-23 from `codex/airborne-entities`, based on `b6abf671700f0e17519c60fab6ada5637cbb3005`. Production playground, Codex's Chromium in-app browser on macOS, 1280 × 720, standard basemap, flat projection, terrain and hillshade on, pitch 60°, zoom 13.5. Hardware/GPU and competing system load were not recorded.

The scenario holds 1,000 total points, updates 100 airborne entities on a requested 100 ms interval, and shows ten camera volumes/footprints plus a sphere and a terrain-following circle. All four entity display switches were enabled. The table is one completed warm ten-second observation using monotonic timestamps:

| UI frame callbacks/s | p95 UI frame interval | Map render events/s | p95 update submission | Submitted batches | p95 entity computation/batch | p95 coverage age |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7 | 449.5 ms | 6.7 | 4.60 ms | 42 | 357.1 ms | 321 ms |

This final run **did not sustain the requested 10 Hz workload**. Terrain computation runs on the main thread, and the geometry is costly enough to delay both movement timers and rendering. Earlier observations varied considerably: the pre-final implementation submitted 100 batches, while another final-geometry run submitted 94. Those are not evidence of a reliable capacity ceiling. The final workload needs further optimization before claiming smooth 100-entity/10-camera operation at 10 Hz. Hiding geometry reduces work; no automatic accuracy reduction or interpolation was introduced.

Coverage age samples the oldest computed state among the ten cameras only when all report ready. Computation duration sums entity build time per flush; it excludes buffer upload, asynchronous GeoJSON worker completion, and GPU duration. Update submission includes validation and cloning. Age is time since computation, not end-to-end display latency. An interrupted narrow-viewport run and a wall-clock-based age result were discarded; the implementation now uses monotonic time for the age calculation. These observations are not directly comparable to the ground-only baseline below.

`pnpm build:playground && pnpm measure` after the airborne addition:

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Ridgeline ESM, excluding MapLibre | 68,894 | 21,519 |
| Ridgeline CSS | 2,468 | 919 |
| Playground main JS | 1,085,122 | 295,559 |
| MapLibre worker JS | 509,445 | 144,458 |
| SIDC Kit on-demand JS | 871,547 | 200,513 |
| Playground CSS | 91,885 | 12,784 |

The Node suite now has 16 passing tests, and the packed-consumer browser suite has 17 passing checks. Type checking and both builds pass. New checks cover geometry orientation, ridge obstruction, range, fallbacks, DEM encoding, concave zones, interior ground sampling, owner/attachment selection, globe shaders, basemap restoration, removal, and terrain/exaggeration-independent physical coverage. Numerical resolution and platform limits are documented in the README and `.scratch/airborne-entities/engineering-notes.md`.

## Recovery and hillshade follow-up

Remeasured on 2026-09-23 after adding update recovery, picker refresh, typed hillshade settings, and the automated browser command. `pnpm build:playground && pnpm measure` reports:

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Ridgeline ESM, excluding MapLibre | 38,607 | 12,334 |
| Ridgeline interaction CSS | 2,468 | 919 |
| Playground JS, including MapLibre's main-thread code | 1,054,827 | 285,261 |
| MapLibre worker JS | 509,445 | 144,458 |
| SIDC Kit demo JS, loaded on demand | 871,547 | 200,513 |
| Playground CSS, including MapLibre and Ridgeline | 90,999 | 12,619 |

The combined playground payload is 642,851 gzip bytes if the SIDC Kit demo is loaded, excluding map assets and source maps. Without that on-demand chunk, it is 442,338 gzip bytes. The library includes MapLibre's color parser to validate hillshade settings before storing them. Playwright is a development dependency and is absent from the runtime bundle. Production hillshade controls have not changed; their proposed layouts await selection.

Strict TypeScript checking, seven Node tests, both builds, and all fifteen packed-consumer browser checks passed. `pnpm test:browser` builds and installs a fresh tarball, then runs the fixture through Playwright 1.63.0 in headless Chromium with software WebGL. New checks cover isolated callback failures, explicit retries, retained removals, newer updates during renderer rejection, source error events, retired sources after basemap changes, a broken callback during rebuild and picker use, picker names/icons/availability/focus, custom content disposal, and hillshade persistence and validation.

Restoring the original flush implementation made the new browser check fail with `Timed out: healthy changes survive`. Restoring the original picker data-change handler made the picker check fail with `Stale picker name`. Both commands exited with status 1. The implementations were restored and the complete suite passed afterward.

These checks exercise rendering and configuration with local styles. They do not visually compare real DEM shading methods, certify Safari, or repeat the moving-workload performance measurements below. Hardware and GPU details remain unrecorded.

## Original baseline

Measured locally on 2026-09-23 with Node 25.9.0, pnpm 11.0.9, TypeScript 7.0.2, Vite 8.3.0, and MapLibre GL JS 6.11.0. Browser checks used Codex's Chromium-based in-app browser on macOS at 1280 × 720. Hardware and GPU model were not recorded. Safari remains unverified.

## Bundle size

`pnpm build:playground && pnpm measure` measures actual emitted files using Node's default gzip settings. Units below are bytes, not KiB. Source maps are excluded from transfer sizes.

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Ridgeline ESM, excluding MapLibre | 23,155 | 7,476 |
| Ridgeline interaction CSS | 2,468 | 919 |
| Playground JS, including MapLibre's main-thread code | 1,042,294 | 280,050 |
| MapLibre worker JS | 509,445 | 144,458 |
| Playground CSS, including MapLibre and Ridgeline | 89,347 | 12,257 |

The complete playground is approximately 436,800 gzip bytes for JS, worker, and CSS combined. Map styles, tiles, glyphs, and sprites are separate network requests and are not included. MapLibre dominates the payload. Vite reports its standard large-chunk warning; a small wrapper does not make the renderer itself small. There is no second renderer or UI framework dependency.

## Moving workload

Production build, standard basemap, flat projection, terrain and hillshade enabled, pitch 0°, 1,000 points plus one route and one polygon. Every 100 ms the application replaces 100 points by stable ID. Data generation happens outside the measured submission interval. These are short, warm local observations, not capacity or device-wide guarantees.

| Ten-second run | UI frame callbacks/s | p95 UI frame interval | Map render events/s | p95 update submission | Batches |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stationary camera | 120 | 8.8 ms | 107.5 | 0.50 ms | 100 |
| Brief keyboard pan and zoom during updates | 118 | 9.2 ms | 104.4 | 1.60 ms | 100 |

UI frame intervals are measured with `requestAnimationFrame`; they are distinct from MapLibre render events. Render events are counted separately and are demand-driven. Submission time includes validation, cloning, queueing, and synchronous event listeners; it excludes asynchronous worker completion and GPU duration. These runs do not measure cold start, memory retention over long sessions, worst-case terrain views, background-tab performance, or maximum sustainable feature count. The benchmark cancels when hidden rather than reporting a throttled tab as a comparable result.

Use the playground's **Moving features → Measure 10s** control to repeat a run. Keep map options, viewport dimensions, device, and camera activity consistent when comparing results. Broader performance budgets should follow repeated measurements on the intended consumer devices.

## Correctness checks

- Five focused Node tests passed: complete replacement, atomic invalid batches, snapshot isolation and duplicate IDs, geometry validation, and diagnostic cause/log behavior.
- Strict TypeScript checking and both production builds passed.
- A separate Vite application installed the packed tarball, type-checked its declarations, and built with no source aliases. Its seven real-browser checks passed: early/reentrant/repeated cleanup; queued string IDs and picking; incremental replace/remove with stable camera; style restoration and selection; undefined configuration fields; Escape propagation with and without an open picker; stable picker slots and custom UI disposal; teardown with rejection of later mutations.
- Browser interaction checks exercised groups of 2, 3, 8, 10, and 20; pagination through the final page; icon/name display; hover names; right-click selection; keyboard selection and Escape; empty data; basemap changes; independent terrain/hillshade/projection toggles (including globe with both enabled); and the deliberate elevation failure and retry. The desktop layout was inspected at 1280 × 720 and 1024 × 768.

The initial string-ID picking failure was reproduced in the browser and corrected by explicitly promoting the stable ID into MapLibre's rendered feature identity. The package fixture covers that behavior. The MapLibre 6 worker is explicitly bundled; both development and production startup were checked.

Desktop Safari, touch interaction, a full accessibility audit, cold-cache load timing, and long-session memory profiling are outstanding validation areas. No claim of cross-browser certification or a production-scale load ceiling is made.
