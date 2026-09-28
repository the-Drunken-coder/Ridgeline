# Performance measurements and verification

> The baseline measurements later in this document were recorded on 2026-09-23 for an earlier build. They do not describe current bundle sizes, throughput, or test counts. Camera terrain visibility limits are documented in the README.

## Reliability workload snapshot, 2026-09-28

Measured locally on Linux with Node 24.19.0 and the pinned MapLibre GL JS 6.11.0. Ten warm runs used a constant-height custom sampler, a 1.5 km ground circle with 48 boundary points, and a separate 50 km camera terrain patch at latitude 46°. These are local observations, not device budgets.

| Workload | Output geometry | Median | Slowest |
| --- | ---: | ---: | ---: |
| Ground circle | 138 triangle vertices and 384 line vertices | 3.0 ms | 7.0 ms |
| Camera terrain patch | 66,049 height vertices | 10.2 ms | 13.5 ms |

The circle sampled height 19,144 times to verify interior completeness but kept its rendered geometry at 522 vertices. The retained camera height array used 792,588 bytes. In a separate ten-run process measurement with garbage collection before and after, retained V8 heap grew 0.15 MiB and ArrayBuffer storage grew 0.76 MiB. Process RSS also includes allocator and runtime activity, so those values do not establish a long-session memory ceiling.

The packaged Chromium checks additionally observed no new custom-sampler samples during a 700 ms idle interval after incomplete terrain settled, and a 50 km raw-terrain camera reached ready with successful tile responses. Loading time varies with the machine and tile delivery; the checks establish convergence, not a fixed response-time target.

## Baseline snapshot

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
