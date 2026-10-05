# Entity models implementation closeout

Spec: [Approved requirements](spec.md), imported unchanged from `21805ecb7543098f8c9820c476725654e20b31ec`. Parent [#81](https://github.com/the-Drunken-coder/Ridgeline/issues/81) remains open and unchanged. Root is the integration and verification owner.

Status, 2026-10-05: #82 through #90 are implemented and locally verified. [Shared tracker record](https://github.com/the-Drunken-coder/Ridgeline/issues/90#issuecomment-5985961888) and [#90 resolution](https://github.com/the-Drunken-coder/Ridgeline/issues/90#issuecomment-5986983947) map scoped completion. Hardware, measured limits/advisory and production acceptance remain pending in #80/#91 at the user's direction. A PR is now authorized; hosted results must be checked on its latest revision before claiming merge readiness.

## Reviewed and exercised revisions

| Record | Revision |
| --- | --- |
| Production base | `2733cee9fe9440237a36e90d9efa2fc4239b87c3` |
| Final independent review | `cf09290e615dfc4809b09519fdfb0825c4642ba9` |
| Clean integrated runtime exercised by root | `708988d1253863412f73915a650b610518ddb9fc` |
| Full tree shared by review and runtime | `70a7b68e0c0ac2899ba39213265050b64baac637` |
| Production source tree | `04413b0db510cc12b4794ea53f98cf331003ac53` |
| Tests tree | `d7fddd93adccfae4cdb4aa07a5b4dbacf31e7981` |
| Historical complete development evidence, before PR curation | `c7ee9cb5497a8e6a71fac07ac079b97db211cdff` |

Both independent axes report zero remaining confirmed findings. [Standards](evidence/standards-review.md) ran 95 focused CPU checks; [Spec](evidence/spec-review.md) ran 86. They independently exercised callback replacement, invalid placement, removal, disposal, off-screen/enlarged-box histories and same-container remount ownership. Their native-constructor/render/remove doubles retain the actual DOM-cleanup failure mode; they do not establish browser pixels or GPU performance. Root's packaged checks below establish the corresponding browser behavior.

Root reviewed the combined fixes: capture frame revision/configuration before callbacks; reject invalidated preparation; cull final enlarged boxes while retaining logical representation/hysteresis; retire old DOM before destroy listeners remount; release native resources when the outer render returns. Permanent actual-package regressions remain in [model-frame-review.browser.ts](../../tests/model-frame-review.browser.ts), alongside focused module tests. Historical RED deltas and earlier failed runs remain in Git at c7ee9cb. The optional shader consolidation suggestion stayed nonblocking because model bodies and feedback have separate resource lifecycles.

## Local verification

All runtime checks exercised clean 708988d with no uncommitted inputs. [Verification record](evidence/verification.json) keeps full pins and results. Later lifecycle documentation, evidence archival and PR curation changed no runtime, test or fixture input. Runtime results are attributed to 708988d, not inferred as executions on a later documentation commit.

| Command | Result |
| --- | --- |
| `pnpm check` | Ticket and library/control type checks pass |
| `pnpm test` | 329 root and 5 control tests pass |
| `pnpm test:browser` | 185 pass in 11.5 minutes, including package build/pack and separate consumer install/typecheck/build. [Log](evidence/packaged-browser.log) |
| `pnpm test:playground:browser` | 5 actual-input workflows pass in 6.6 minutes, with package/playground production builds. [Log](evidence/playground-browser.log) |
| `pnpm test:measurement` | 6 tooling checks and 1 actual packed ownership probe pass. [Log](evidence/measurement.log) |
| Four `node scripts/measure-models.mjs --smoke --case <case-id>` runs | 8 final paired reports complete; no visibility/diagnostic failures and five-second zero-render idle. [Summary and raw archive](evidence/README.md) |
| `pnpm test:controls:browser` | 5 workflows and control production build pass in 7.5 seconds. [Log](evidence/control-browser.log) |
| `pnpm measure` and isolated-entry builds | Production ESM 281,990 raw/79,426 gzip bytes; net 76,537/21,022. Parser 16,355/5,256; renderer 25,656/8,653. [Method/data](../../docs/performance.md) |

Software Chromium 153.0.8010.12 used ANGLE SwiftShader on Linux. Model scenes separately retain 100 model states, 100 submitted/clipped instances, 100 foreground regions and 1000 visible native IDs; baseline has 1100 native IDs and zero model states. Genuine globe records 1280×720 CSS canvas, 2560×1440 physical canvas, map pixel ratio 2 and actual browser DPR 1. Warm GPU distributions have zero samples and remain unavailable. Raw unique queries, superseded updates, missed cadence and slow intervals remain explicit. No 60 Hz acceptance, browser certification or guideline follows from these observations.

The initial combined smoke command exited with status 143 after baseline-off. Root reran all four cases separately and retained only the eight completed reports as current evidence. Earlier interruptions and failed experiments are dated history, not successful runs.

## Scoped acceptance evidence

| Ticket | Observable delivery and permanent verification |
| --- | --- |
| #82 projection | Shared projection for rendering, clipping and picking; meter-scale flat/globe/world-copy precision. [Focused tests](../../tests/entity-projection.test.ts) and packaged precision workflows |
| #83 registration/solid models | Validated static GLB subset, snapshots, atomic installation/replacement, status/readiness/cancellation and shared lifetime. [Parser](../../tests/model-glb.test.ts), [registry](../../tests/models.test.ts), [public workflows](../../tests/model-registration.browser.ts) |
| #84 materials | Actual PNG/JPEG decode, alpha/cutout/blend, samplers, lighting, original/custom appearance and failure cleanup. [Public workflows](../../tests/model-materials.browser.ts) |
| #85 placement | Ground/airborne orientation and exaggerated elevation, uneven support, floor sizing, clipping and delayed terrain ownership. [Geometry](../../tests/model-placement.test.ts), [public workflows](../../tests/model-placement.browser.ts) |
| #86 switching | Independent hysteresis, atomic validation, current-frame model/icon/dot publication, unavailable fallback, cancellation and quiet idle. [State](../../tests/model-switching.test.ts), [public workflows](../../tests/model-switching.browser.ts) |
| #87 picking | Last-drawn enlarged boxes, native hit priority, attachments, keyboard/radial input and stationary-pointer refresh. [Public workflows](../../tests/model-picking.browser.ts) |
| #88 presentation | Collision-placed labels, distinct static hover/preview/selection, original material restoration and physical attachments. [Public workflows](../../tests/model-presentation.browser.ts) |
| #89 recovery | Basemap reuse, actual WebGL loss/restoration, current registrations/configuration, partial allocation/decode failure and complete disposal. [Public workflows](../../tests/model-recovery.browser.ts) and final remount regressions |

## #90 acceptance mapping

| Criterion | Result and retained evidence |
| --- | --- |
| Integration owner and approved import | Root reviewed combined behavior and assigned concrete file owners before isolated workers edited. Approved spec/glossary and selected implementation only, based on main 2733cee9. Prototype stays unmerged; comparison controls/temporary registry are omitted. |
| Public consumer example | Eight samples share four licensed registrations. Consumer owns fetch/cancellation and palettes. Actual input covers custom/original appearance, selection/hover, switching, replacement/unregister/remove/reset, labels and physical attachments. [Example tests](../../tests/playground/model-example.spec.ts) |
| Public contracts | [README](../../README.md) covers supported GLB/repackaging, units/defaults, atomic validation/snapshots/status, cancellation/recovery/disposal, enlarged-box picking, uneven-terrain limits and pending hardware claims. |
| Reproducible workload | [Measurement guide](../../tools/model-measurement/README.md) prepares 100 models, 25 of each type, 1000 moving icons updated every 100 ms and 1100-icon baseline, original/normalized/4x/16x geometry, appearances/materials, flat/genuine globe and pixel ratios 1/2. Settings/counts/hashes stay explicit. |
| Honest measurements | Actual packaged ownership probe and report/workload/pixel checks cover CPU phases, accepted revisions, disabled/cleared instrumentation, native worker generations and alpha-aware pixels. Full RAF/upsert/native/cold/warm/GPU observations stay separate; missing/one sample stays unavailable/insufficient. |
| Approved observable transitions | 185 public packaged workflows cover decode/input, invalid batches, delayed terrain, callbacks, switching, labels/attachments, context recovery, precision/planar tolerances and quiet idle. Playground/control workflows pass separately. |
| Shared revision-specific review/evidence | This record links exact review/check pins, final independent reports, logs, settings and raw measurements. Historical failures are preserved at c7ee9cb. Current permanent regressions distinguish stale callback frames, off-screen submission and listener remount ownership. |
| Required commands/builds/size | Type/ticket/unit/browser/consumer checks and package/playground/control builds pass above. Current production net increase is 20.53 KiB gzip; isolated entries are not additive costs. |
| Hardware handoff/readiness | [Reviewed production and portable workflow handed to #80](https://github.com/the-Drunken-coder/Ridgeline/issues/80#issuecomment-5986983674). #80/#91 remain open. Implementation and local verification are complete; hosted and production acceptance are separate. Parent #81 remains unchanged. |

Integrated changes have one verification owner. Scene, registry, interaction and resource owners invalidate obsolete callback work; the consumer/native-worker flow correlates accepted updates with visible frames. Permanent workflows exercise these ownership transitions rather than inferring currentness from cached summaries.

## Pending production gate and PR curation

Run the 72-case paired off/on matrix on Apple M1 Pro and desktop discrete-GPU machines with `pnpm measure:models --hardware --browser chrome --metadata machine.json --matrix`. Installed Safari uses `pnpm measure:models --serve` and manual capture from the same consumer. Preserve machine/OS/GPU/driver/browser/displayHz, raw JSON/PNG/index, source/tarball/asset hashes, actual canvas/projection/counts, at least 10 seconds warmup and three 30-second stationary/moving runs. Required original/baseline 60 Hz targets still apply; 4x/16x workloads may fail while establishing bounds. Run correctness workflows on each required browser too.

The measured triangle/material guideline and too-heavy advisory remain unset until #80 establishes their policy. #91 owns that implementation and production acceptance. Software Chromium or Playwright WebKit does not establish target-browser support.

PR preparation removed exploratory scripts, earlier logs/measurement runs, duplicate galleries and worker handoffs from the working tree. Final measurements remain byte-exact in one compressed archive, with readable summaries and hashes. The complete dated development evidence remains in Git at c7ee9cb, before curation. [Evidence inventory and reproduction](evidence/README.md) explain what stayed. Documentation link/diff/archive checks cover this cleanup; the source/test trees and approved spec remain unchanged.
