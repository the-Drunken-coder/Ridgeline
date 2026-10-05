# Public model playground example

Completed 2026-10-05. Root owns integrated verification. This worker owns the playground example, its four licensed assets and public input tests. Measurement tooling has separate owners. No library runtime change was needed for this slice. Hardware #80/#91 remains pending.

## Delivery and checked revisions

- Branch `implement/entity-model-example`, worktree `/tmp/ridgeline-model-example`.
- Clean delivery HEAD `15c928ce6ebb5c80144c2b10f7910b95948811c8`.
- Exact delivery tree `0aeebafc1c026d56dcd207eb953021d54fdd6dd9`.
- Includes root `bcec5e9665b02baf28c0522f1699ab743e092787`, including measurement source/tools and evidence.
- Full production playground suite passed at clean `5b337bfee1f4f77202fca2916028e7cc992961bd`. Five cases passed in 439727 ms, with zero reported test errors. Do not attribute that browser run to the later merge.
- At delivery HEAD, `pnpm check`, `pnpm build:playground` and `git diff --check` passed. Build retains the existing large-chunk warning.
- Root reviewed the example, the operation-ownership fix and final gallery, then approved this exact delivery SHA for merger. Root will execute combined browser checks after merging.

Relative to root bcec5e9, delivery changes only `playground/main.ts`, `playground/model-example.ts` and `tests/playground/model-example.spec.ts`, totaling 291 insertions and 5 deletions. The selected assets had already reached root through the measurement branch. No further source edits or browser jobs are planned by this worker. Port 5176 is free.

## Behavior

The Entity models scenario uses the existing sidebar and public package API. Four shared registrations supply eight instances with independent original/custom appearance. The example owns fetch cancellation, a small consumer palette, shared replacement/unload/load, instance removal/reset and camera buttons demonstrating model/icon switching. Existing selection and hover interactions work on actual model pixels. Native labels, physical ground areas and airborne sensor attachments remain visible. Teardown restores prior entity visibility, unregisters owned assets and aborts owned fetches.

Both the default terrain scene to models transition and direct `/?scenario=models` startup are covered. Registration completes before feature insertion, avoiding expected missing-registration diagnostics during startup. No prototype comparison controls, registry or renderer instrumentation entered the product.

Assets in `playground/public/entity-models` are drone.glb, tank.glb, plane.glb and boat.glb. Their original sources.json and Kenney-License.txt were copied unchanged, with visible credits.html added. Drone by NateGazzard, tank by KolosStudios and jet by jeremy use CC BY 3.0. The speedboat comes from Kenney's CC0 Watercraft Kit; source metadata discloses its earlier texture-embedding repackaging. Consumer calibration uses one meter per authored unit, with tank headingOffset 90 degrees. `example-assets.json` records bytes and SHA-256 hashes, confirming all six selected source/provenance files are byte-identical to the prototype. No prototype code was merged.

## Executed browser checks

| Case | Result | Duration |
| --- | --- | --- |
| Shared registration and independent appearance | Passed | 181508 ms |
| Leave during pending fetch, then return | Passed | 65110 ms |
| Open models from default terrain | Passed | 52340 ms |
| Failed reset cannot overwrite later replacement | Passed | 110693 ms |
| Existing drawing selection workflow | Passed | 23197 ms |

The first case exercises all eight models, a dense rendered body pixel for real hover/click, selection, independent palettes, shared unload/reload/replacement, far icons, near models, removal and scenario teardown. The failed-reset case compares actual boat body pixels before and after replacement and repeatedly checks them for five seconds after releasing the obsolete fetch.

The final command ran directly, with visible progress and no parent deadline added:

```sh
set -o pipefail
node node_modules/playwright/cli.js test \
  --config /tmp/ridgeline-model-context/example-playwright.config.mjs \
  --reporter=list,/tmp/ridgeline-model-context/example-step-reporter.mjs \
  2>&1 | tee /tmp/ridgeline-model-context/example-final-playground.log
```

The external config inherits the repository's production playground configuration, builds the package/playground, and starts Vite preview on 5176. Playwright 1.63.0 used Chromium with ANGLE SwiftShader, `--use-angle=swiftshader --enable-unsafe-swiftshader`, at 1440×900 CSS pixels and DPR 1. Exact browser version was not captured in this run. Only external map resources are routed: a flat base style, actual licensed Noto glyphs and zero-height Terrarium terrain. Real packaged code, actual GLBs, native workers, DOM inputs and canvas pixels are exercised. This is software WebGL evidence, not target-hardware performance evidence.

## Defect found and repaired

At clean `c5f460c`, a reset could fail while a sibling boat fetch stayed pending. A later reset and accepted tank replacement succeeded, then the older boat response silently replaced the tank. The public test failed with 239 blue boat pixels where fewer than five were expected. This was a concrete rendered regression, not a timeout.

Fix `f161563250a15ea493d52ac073ab14c3866ec57b` adds a private operation revision. Registration and reset publication require current ownership and a live example; settling an operation or destroying the example invalidates older work. Lifetime cancellation remains explicit. The same public test passed in the final five-case run, including repeated body-pixel checks after the obsolete response completed.

RED evidence is `example-reset-red.log`, `example-reset-red-trace.zip` and `example-reset-red.png`. GREEN evidence is `example-final-playground.log` at 5b337bf.

## Terrain recovery diagnosis and timing limits

The earlier three-case run at `a2ef7d322337b33b8a2640925788f5ba97b607c3` had real budget failures. Cancellation/return expired at 20 seconds while all entities were withheld. Default terrain entry expired at 30 seconds after progressing from loading to zero models/six icons. The long workflow exceeded its overall 120-second limit after completed reload/replacement, with screenshot calls taking roughly 18 and 21 seconds.

Public-state probes preserved all eight current features and ready registrations during delayed CPU elevation loading. Default entry recovered unaided at 26.2 seconds. Cancellation/return showed unknown ground at 13.9 seconds and recovered unaided at 31.5 seconds, with all eight models ready, ground 0 m and airborne bodies at 35/60 m. No error or lost elevation ownership was established. The CPU sampler's separate lazy TileJSON/DEM requests completed late; native terrain was already loaded. Root approved 60-second readiness budgets for the two cold transition histories and a 240-second overall workflow budget. Behavior assertions remain intact.

Probe artifacts used a temporary public-Viewport exposure added to a diagnostic build, with the source restored before execution. That exposure is absent from committed source and the final clean build. Recorded synchronous computation spans include stalls and descheduling; they are not sampled processor time or hardware benchmarks.

Two earlier redirected commands exited 143 before reporting a Playwright result. Their owned orphan processes were cleaned up. No signal source, browser crash or OOM cause was established. Keep these outcomes classified as interrupted, separately from completed assertion failures and the final passing run. The direct CLI subsequently ran for 7.3 minutes and exited 0.

## Evidence index

All paths below are under `/tmp/ridgeline-model-context`.

- Final browser log: `example-final-playground.log`.
- Final merged type/build logs: `example-post-merge-check.log`, `example-post-merge-build.log`.
- Command configuration/progress reporter: `example-playwright.config.mjs`, `example-step-reporter.mjs`.
- Asset provenance verification: `example-assets.json`.
- Final reviewed image and exact provenance: `example-final-ui.jpeg`, `example-final-gallery.json`. This is an 800×500 scaled screencast frame from the clean 5b337bf run, captured 2026-10-05T00:43:07.485Z with a 1440×900 CSS viewport. It shows readable labels, physical attachments and static selection feedback.
- Earlier full-resolution image: `example-direct-ui.png`, with separate historical source/settings in `example-gallery.json`. Do not attribute this older capture to the final revision.
- Failed-reset RED: `example-reset-red.log`, `example-reset-red-trace.zip`, `example-reset-red.png`.
- Earlier completed budget failures: `example-three-workflows.log`, `example-total-budget-trace.zip`, `example-cancellation-red-trace.zip`, `example-default-red-trace.zip`.
- Recovery probes: `example-state-probe.mjs`, `example-state-default.json`, `example-state-cancel.json`, corresponding `.log` files, and `example-terrain-recovery-investigation.md`.
- Diagnostic build provenance: `example-clean-main.ts`, `example-diagnostic-main.ts`, `example-diagnostic-build.log`.
- Interrupted attempts: `example-interrupted143.log`, `example-registration-budget.log`.
- Earlier standalone diagnostic consumer: `example-probe.mjs`, `example-probe/index.html`, `example-probe-native.log`, `example-probe.json`, `example-probe.cpuprofile`, `example-probe.png`. These support diagnosis and do not replace the completed production playground tests.

Implementation and assigned local checks are complete. Remaining verification belongs to root's combined integration run and the explicitly pending target-hardware gate.
