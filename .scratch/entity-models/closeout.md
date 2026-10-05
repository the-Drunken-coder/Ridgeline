# Entity models implementation closeout

Spec: [Approved requirements](spec.md), imported unchanged from `21805ecb7543098f8c9820c476725654e20b31ec`. Parent [#81](https://github.com/the-Drunken-coder/Ridgeline/issues/81) remains open and unchanged. Root is the integration and verification owner.

## PR #92 browser setup and pixel waits, 2026-10-05

[Run 37276142175](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37276142175) exercised PR head `25f60332aef851da794581f55ca3c1430464b28a` at merge checkout `f46eb56ec84311ae541a0af356a1061eb36ba99f`. All 187 packed workflows and four playground workflows pass. The remaining playground test times out while creating its browser context, before any navigation or test-body timeout setting. The model suite now sets its existing 240-second budget before fixtures run. Its two longer workflows retain their 600-second body budgets.

The initial visible-model pixel assertion now polls its unchanged filled-cluster threshold within the existing 120-second rendering budget, retaining the successful coordinates for actual hover and click. Model-state publication follows draw submission and does not establish that screenshot capture has completed. An intermediate local run failed with blank pixels and browser/context errors while disk space was nearly exhausted; it does not establish recovery or a causal link to disk pressure.

After clearing disposable build output and unused package caches, `pnpm check` and all five `pnpm test:playground:browser` workflows pass, including production builds. Root and the independent reviewer inspected HEAD `25f60332aef851da794581f55ca3c1430464b28a` plus this uncommitted test delta, SHA-256 `acc6edd35ab9af33d8f18ac58050ecb2c53d502611a720433848bb875007201e`, using `git diff --binary HEAD -- tests/playground/model-example.spec.ts | sha256sum`. These are the exercised runtime inputs; this documentation edit is outside that fingerprint. Standards and Spec reviews report no findings. Final hosted evidence is recorded on [PR #92](https://github.com/the-Drunken-coder/Ridgeline/pull/92) at the exact pushed revision.

## PR #92 software-rendering test budgets, 2026-10-05

The capture change alone did not resolve hosted timing. [Run 37274134406](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37274134406) exercised PR head `5abf78cf4413998b814727f705e52dceb21c6954` at merge checkout `2a6d1cab90e879b76fb259a25e453da731e372a6`. All 187 packed workflows and non-playground checks pass; three playground workflows time out. The retained traces show successful reentry after 63.1 seconds and a successful boat-pixel assertion after a 91.4-second screenshot. Every rendering/interaction assertion in the main workflow passes, but its 240-second overall deadline expires before removal runs.

Root and the independent diagnosis reviewer inspected these exact histories. Rendering assertions now allow 120 seconds; the two complete workflows allow 600 seconds and the smaller workflows 240 seconds. Every assertion, actual input, pixel check, cancellation sequence and bounded negative observation remains intact. Software correctness checks do not establish the separate target-hardware performance acceptance.

Root reviewed and exercised `5abf78cf4413998b814727f705e52dceb21c6954` plus the uncommitted test-budget change. Its diff SHA-256 is `90c25316c8b2e0821bea692f1b7bffa04062213c3d41436f39bd6a191d3336eb`, using `git diff --binary HEAD -- tests/playground/model-example.spec.ts | sha256sum`. `pnpm check` and all five `pnpm test:playground:browser` workflows pass, including production builds. The latter completes in 7.1 minutes. This is local evidence; current hosted verification is recorded on [PR #92](https://github.com/the-Drunken-coder/Ridgeline/pull/92) at the exact final pushed revision.

## PR #92 playground CI follow-up, 2026-10-05

Hosted [run 37271865676](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37271865676) on PR head `60dd1b545afda985a95acf27600f82556b34b632`, tested merge checkout `a99eb1065ecbb0178099b33e8141160df00687a4`, passed all 187 packed browser workflows, type checks, module tests, control browser and consumer builds. Four playground Model workflows timed out. Their retained traces show the expected Model state or pixels appearing after the deadlines, including a screenshot that took 66.54 seconds. No unexpected console or network failure appeared, and review of scheduling found no stationary render loop.

Root reviewed and exercised that clean head plus an uncommitted playground trace-configuration change. Its diff SHA-256 is `a80b2b5140be1042fec25467dd16380aa008fb5769048351e1a67b5030d71c9e`, using `git diff --binary HEAD -- playwright.playground.config.mjs | sha256sum`. The first complete workflow passes with tracing off; all five workflows then pass with continuous screencast capture disabled and action/DOM traces retained. Explicit pixel assertions, test screenshots and failure screenshots still run. `pnpm test:playground:browser` also rebuilds the library and production playground. This changes diagnostic capture only; it leaves the tested production source at `60dd1b5`.

Hosted checks must exercise the pushed trace configuration before merge readiness is established. The exact final head, tested checkout and results are recorded on [PR #92](https://github.com/the-Drunken-coder/Ridgeline/pull/92).

## PR #92 hosted-review follow-up, 2026-10-05

Root owns integrated verification. The additional hosted findings are addressed: implicit zero-filled accessors are bounded by the supplied GLB byte length before allocation; recovery sampling and picking convert between CSS and drawing-buffer coordinates; both affected recovery cases run at map pixel ratio 2; the measurement runner uses Vite's complete preview-server shutdown. The spec's implementation status and README's default-dot fallback are current. Approved feature requirements and the pending hardware gate are unchanged.

This pre-push record reviewed and exercised `d32e359e7fe4c7305d8793469e77151873eb8c49` plus uncommitted changes. Runtime diff SHA-256 is `f971bcd60f71f97e7a41dad4806eb6a2df21bd51a312b259cabb6574978e4e3e`, using `git diff --binary HEAD -- src tests scripts/measure-models.mjs tools/model-measurement | sha256sum`. Root reviewed the combined diff. Independent Standards and Spec reviews report no actionable findings at this fingerprint.

`pnpm check` passes. `pnpm test` passes all 332 root and 5 control tests. Seven focused packed-consumer browser workflows pass, covering both original regressions, ratio-2 recovery and public registration/replacement/cancellation. `pnpm test:measurement` passes six module checks and the actual packed browser ownership probe. These commands rebuilt and packed the library and built their separate consumers. A real Vite preview lifecycle probe confirms its cleanup hook runs once and repeated shutdown is harmless. All 21 parser tests pass after a safe pre-fix probe showed a 272-byte GLB attempting three billion array entries; a moderate-size behavior regression also failed before the fix.

[Follow-up verification](evidence/pr92-hosted-fixes.json) and its [archive](evidence/pr92-hosted-fixes-evidence.tar.gz) retain the runtime patch and producer logs with verified member hashes. Hosted verification must use the exact pushed commit and tested checkout; it is recorded on [PR #92](https://github.com/the-Drunken-coder/Ridgeline/pull/92). Target-hardware/browser acceptance and the measured guideline remain pending in #80/#91.

## Earlier PR #92 correction checks, 2026-10-05

The review findings are fixed locally: failed styling retains a complete prepared Model pose, appearance and effective settings; diagnostic callbacks requeue still-current interrupted Entity computation; the measurement workload uses the approved 40 CSS px floor. Choice resets occur only after current preparation succeeds. The public regressions also cover a callback restoring Heading inside the dead zone and a valid configuration change while an older override is retained. The playground keeps its exact representation assertions with longer waits for software WebGL publication.

Reviewed and exercised input: HEAD `d32e359e7fe4c7305d8793469e77151873eb8c49` plus uncommitted changes in this checkout. The final runtime diff SHA-256 is `f1625bb9bc7614fc3f40b242f10d64695abb53e33624d28a7ecb56159992992f`, computed with `git diff --binary HEAD -- src tests tools/model-measurement | sha256sum`. Root reviewed the combined diff. Independent Standards review reports no remaining actionable findings at the preceding fingerprint `b940db69a894b0bbde5c4193acefc3c668825a3e1ef895dbfbb273df2c1b5afa`; the only subsequent runtime-input edit changed the new translucent attachment fixture to detectable pure blue. The production-only diff SHA-256 remains `8fab150b15ef1c8e341adbd3e21d18fdfd711f3dbc05a92a0b8b8a132603428e`. This closeout edit is outside both fingerprints.

Independent Spec review confirmed the final full and source-only fingerprints and reports no remaining actionable findings. Retaining previous effective settings after failed styling follows the documented retained-display exception; successful configuration preparation evaluates current defaults and overrides.

The two permanent [packaged regressions](../../tests/model-frame-review.browser.ts) failed before their fixes and passed afterward. Additional RED runs confirmed the premature choice reset and incompatible retained-settings histories before their corrections. Type/ticket checks and all 329 root plus 5 control unit tests pass. The complete packaged run exercised the unchanged production source: 186 passed and the new test failed its added baseline attachment-pixel assertion. After correcting that fixture color, both focused cases pass on the final fingerprint. The other 186 case inputs are unchanged; the full command was not repeated after the fixture correction.

Final consumer checks pass: all 5 playground workflows, all 5 control-lab workflows, and 6 measurement module checks plus the actual packed browser ownership probe. Package, separate packaged consumer, playground and control builds ran through those commands. Five corrected smoke cases produced 10 successful off/on reports: mixed original Models in flat/globe views at map pixel ratios 1 and 2, plus the icon baseline. All use 40 CSS px. Model cases retain 100 Model states, 100 submitted/clipped instances, 100 foreground regions and 1000 visible native IDs; the baseline retains 1100 native IDs and zero Models. Every report has no diagnostics or validation failures and zero render frames during the five-second settled idle check. These short software runs do not establish performance acceptance.

[Earlier verification record](evidence/pr92-fixes.json) pins the reviews, checks, test-only correction and remaining limits. Its [evidence archive](evidence/pr92-fixes-evidence.tar.gz) retains the runtime patch, RED/final producer logs, all raw reports/settings, indexes, overhead reports and screenshots; every member was checked against its source bytes after compression. Implementation and local verification were complete at this stage. Hosted and hardware acceptance remain separate.

At this earlier check, hosted verification was attributed to PR head `d32e359e7fe4c7305d8793469e77151873eb8c49`: [run 37262097754](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37262097754) passed typecheck, module tests, consumer builds, all four packaged shards and control browser; playground-browser and validate failed. The local fixes had not been pushed or exercised by hosted checks, so that run did not establish merge readiness.

Hardware/browser acceptance and the measured triangle guideline remain pending in #80/#91. The archived initial implementation smoke reports below used a 20 px floor; they remain historical observations and do not verify the approved 40 px workload.

## Initial implementation evidence, historical

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
