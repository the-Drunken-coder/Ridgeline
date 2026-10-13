# Performance measurements and verification

> The baseline measurements later in this document were recorded on 2026-09-23 for an earlier build. They do not describe current bundle sizes, throughput, or test counts. Camera terrain visibility limits are documented in the README.

## Current viewport tools follow-up, 2026-10-11

The final uncommitted runtime/test/config digest is `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`. After the review corrections, the library and playground production builds passed. The current checkout and the clean baseline below use the same installed dependencies, Node 24.21.0, Vite 8.3.0 and Node default gzip settings. The baseline was built in an isolated Git archive. Production library measurements exclude MapLibre and source maps.

| Artifact | Baseline raw bytes | Current raw bytes | Baseline gzip bytes | Current gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Ridgeline ESM | 282,921 | 326,567 | 79,717 | 91,834 |
| Ridgeline CSS | 6,089 | 7,011 | 1,788 | 1,975 |
| Net increase | | 44,568 | | 12,304 |

No library dependency was added. Source data, history, clocks, interpolation, replay and retention stay in consumer applications. The checkout-only `.scratch/viewport-upgrades/closeout.md` retains file hashes and check pins. These payload measurements do not establish hardware performance or device budgets. The playground retains Vite's large-chunk warning.

## Historical viewport tools snapshot after scope correction, 2026-10-11

This snapshot predates the review follow-up changes. Its uncommitted input digest is `50853a463fee75ff3edc4a75d7332ba42388a588c263b0893256a7253977d46e`. It includes selection, drawing, controls and adoption upgrades; the new motion/replay controller has been removed. Compared with clean baseline `cbef055b14fe218aa24611031c4ba1a9aa0ed540`, using the same isolated baseline build, installed dependencies, Node 24.21.0, Vite 8.3.0 and Node default gzip settings:

| Artifact | Baseline raw bytes | Snapshot raw bytes | Baseline gzip bytes | Snapshot gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Ridgeline ESM | 282,921 | 322,650 | 79,717 | 90,748 |
| Ridgeline CSS | 6,089 | 7,011 | 1,788 | 1,975 |
| Net increase | | 40,651 | | 11,218 |

Removing motion/replay reduced the earlier upgrade build by 23,939 raw bytes and 6,499 gzip bytes. No library dependency was added. The checkout-only record at `.scratch/viewport-upgrades/closeout.md` retains bundle hashes and check pins. It is not shipped in the package. These are payload measurements; target hardware performance remains unverified.

## Historical viewport tools snapshot before scope correction, 2026-10-11

This historical build includes the motion/replay scope that the user subsequently withdrew. Compared the clean baseline `cbef055b14fe218aa24611031c4ba1a9aa0ed540` with that earlier uncommitted implementation. Runtime/test/config inputs have SHA-256 `8ccbe6759d8f309c98902d8c115fceed111215cb16150d00004a2a2621c39b66`. The baseline used an isolated Git archive and the same installed dependencies; both use Node 24.21.0, Vite 8.3.0 and Node's default gzip settings. Production files exclude MapLibre and source maps.

| Artifact | Baseline raw bytes | Earlier raw bytes | Baseline gzip bytes | Earlier gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Ridgeline ESM | 282,921 | 345,319 | 79,717 | 97,027 |
| Ridgeline CSS | 6,089 | 8,281 | 1,788 | 2,195 |
| Net increase | | 64,590 | | 17,717 |

That library entry and CSS added 17,717 gzip bytes with no new library dependency. The checkout-only record at `.scratch/viewport-upgrades/closeout.md` retains file hashes, the baseline method, production bundle data and commands. It is not shipped in the package. These payload measurements do not establish frame-rate, update-latency or device budgets. The existing large playground chunk warning remains. Physical GPU and installed-browser performance acceptance is still pending.

## Entity model bundle snapshot, 2026-10-05

Measured at clean `708988d1253863412f73915a650b610518ddb9fc`, source tree `04413b0db510cc12b4794ea53f98cf331003ac53`, with Node 24.21.0, Vite 8.3.0 and Node's default gzip settings. The production library excludes MapLibre and source maps. The comparison baseline is runtime `2733cee9fe9440237a36e90d9efa2fc4239b87c3`, built at documentation revision `47750f2` with the same Node gzip command.

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Baseline Ridgeline ESM | 205,453 | 58,404 |
| Entity-model Ridgeline ESM | 281,990 | 79,426 |
| Net ESM increase | 76,537 | 21,022 |
| GLB parser isolated entry | 16,355 | 5,256 |
| Model renderer isolated entry | 25,656 | 8,653 |

The isolated entries use Vite's default ES-library build. The renderer includes its projection and color helpers; reachable helpers can appear in both entry builds. Their gzip sizes are not additive parts of the package delta. Library CSS remains 6,089 raw and 1,788 gzip bytes. [Bundle data](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/.scratch/entity-models/evidence/bundle-size.json) and [entry data](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/.scratch/entity-models/evidence/module-size.json) retain the method and revision.

The [packaged measurement workflow](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/tools/model-measurement/README.md) prepares the approved moving-model workload and retains separate frame, CPU, update and optional GPU observations. [Software smoke evidence](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/.scratch/entity-models/evidence/README.md) verifies tooling and visible workloads. Apple M1 Pro, desktop discrete-GPU and target-browser measurements remain pending in #80/#91; these bundle and software observations supply no hardware performance guideline.

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

## Consumer workflow validation, 2026-09-28

The local migration run used Node 24.19.0, pnpm 11.0.9, desktop Chromium, and software WebGL on Linux. The former single-page browser runner timed out at its 60-second overall limit while its 46th check was running; the first 45 reported passes. That result is a runner baseline, not a pass for the old suite.

The Playwright runner builds and packs Ridgeline, installs it in a separate consumer, checks declarations and styles, and runs each browser case in a fresh page. The final `pnpm validate` run passed 80 library tests, 5 control-lab state tests, 51 packaged browser cases in 2.4 minutes, 4 control-lab browser cases in 7.6 seconds, and both consumer builds. Focused module tests remain for geometry, validation, data snapshots, and asynchronous races. The browser cases use real pointer and keyboard input for picker, drawing, camera picking, and control-lab interactions. A temporary intentional failure verified a nonzero exit, a named screenshot and trace, cleanup, and execution of a later case; the failure was removed.

These checks establish desktop Chromium behavior with software WebGL. They do not establish touch behavior, complete accessibility, hardware GPU behavior, or a broader browser matrix.
