# Entity-model verification evidence

This directory keeps the dated initial implementation evidence and the PR #92 corrections below. Initial runtime checks exercised clean `708988d1253863412f73915a650b610518ddb9fc`, source tree `04413b0db510cc12b4794ea53f98cf331003ac53`. Initial independent reviews exercised `cf09290e615dfc4809b09519fdfb0825c4642ba9`, which has the identical full tree. Root owns integrated verification. [Closeout](../closeout.md) maps ticket scope, checks and remaining gates.

## PR #92 hosted-review follow-up, 2026-10-05

[Follow-up verification](pr92-hosted-fixes.json) pins the combined runtime diff, integrated checks and safe parser reproduction. Its [archive](pr92-hosted-fixes-evidence.tar.gz) preserves the exact patch and seven producer logs with verified member hashes. It covers the additional parser allocation guard, ratio-2 recovery probes and Vite shutdown. Current hosted results are recorded on [PR #92](https://github.com/the-Drunken-coder/Ridgeline/pull/92) for the exact pushed commit.

## Earlier PR #92 corrections, 2026-10-05

[Verification record](pr92-fixes.json) identifies the uncommitted runtime/source fingerprints, both review results, command outcomes and the test-only fixture correction after the complete packaged run. [Evidence archive](pr92-fixes-evidence.tar.gz) retains the runtime patch, RED/final logs and 10 raw software reports with settings, indexes, overhead reports and screenshots. Its member hashes are in the verification record and were checked after compression. Extract into a separate directory with `tar -xzf pr92-fixes-evidence.tar.gz -C <directory>`.

The corrected workload uses 40 CSS px and covers flat/globe at map pixel ratios 1/2 plus the icon baseline, each with instrumentation off/on. All reports have no diagnostics or validation failures and zero renders during five settled seconds. The initial archived smoke below used 20 px; it does not verify the approved size. Hardware performance, target-browser support and the measured guideline remain pending.

## Initial implementation evidence

- [Verification record](verification.json) identifies commands, exact pins and results. Its no-PR statement describes the runtime-check date, before the later PR request.
- [Packaged browser](packaged-browser.log), [playground](playground-browser.log), [control lab](control-browser.log) and [measurement](measurement.log) retain the final producer logs. Unit/type results are in the verification record; their individual passing-case logs were redundant.
- [Standards](standards-review.md) and [Spec](spec-review.md) retain the independent final reports. Their temporary checkout/probe paths are historical provenance. Permanent regressions live in `tests/model-frame-review.browser.ts` and focused module tests.
- [Bundle](bundle-size.json) and [isolated entries](module-size.json) retain the default Node gzip method. Repeat the entry measurement with `node .scratch/entity-models/evidence/module-size.mjs`; isolated entries are not additive package costs.
- [Software summary](smoke-summary.json), [archive manifest](smoke-manifest.json) and [raw archive](software-smoke.tar.gz) retain all eight final off/on JSON reports, four run indexes and four overhead reports. The archive contains the original JSON bytes, with member hashes checked after creation. Extract into a separate directory with `tar -xzf software-smoke.tar.gz -C <directory>`.
- [Nearby models](models-nearby.png), [icons at distance](icons-at-distance.png), [switching recording](model-switching.webm) and [capture settings](media.json) show both representations, shared registrations, appearances, selection and physical attachments. This fresh production-playground capture uses real clicks, with the same source tree as 708988d and no page errors. It compares distance states, not old/new source versions. [Genuine globe/DPR2](globe-dpr2.png) retains the final alpha-qualified screenshot matching its archived report.

Four software cases cover the icon baseline, mixed original models on flat projection, assigned genuine globe/DPR2 and original material fixtures. All eight reports have no validation failures/diagnostics and zero map renders over five settled seconds. Baseline has 1100 native IDs and zero model states; model scenes have 1000 native IDs, 100 model states, 100 submitted/clipped frame facts and 100 foreground regions. Baseline regions are icons. CSS canvas is 1280×720; genuine globe uses 2560×1440 physical canvas, map pixel ratio 2 and actual browser DPR 1.

Warm GPU distributions are unavailable with zero samples; raw completed query IDs are unique. Superseded updates, missed cadence and slow software frame/latency observations remain in the raw reports. These short runs do not establish hardware performance or browser support. The initial combined smoke command exited with status 143 after baseline-off; all four pairs subsequently completed through individual runs. Interrupted and superseded intermediate artifacts are historical, not current successes.

Exploratory scripts, temporary RED patches, earlier runs, duplicate galleries and worker handoffs were removed from the working tree when preparing the PR. The complete dated development record remains in Git at `c7ee9cb5497a8e6a71fac07ac079b97db211cdff`, before curation. For example, `git show c7ee9cb:.scratch/entity-models/closeout.md` retrieves the full original closeout. This cleanup changes no runtime, tests, fixtures, public contract or approved spec.

Apple M1 Pro, desktop discrete-GPU and target-browser measurements, the measured guideline/advisory and production acceptance remain pending in #80/#91. The portable [measurement workflow](../../../tools/model-measurement/README.md) owns reproduction rather than scratch probe scripts.
