# Final model review fixes

Date: 2026-10-05 UTC. Implementer: model_research. Integrated verification owner: root. Hardware/browser acceptance under #80/#91 remains pending.

## Revision and scope

- Isolated checkout: `/tmp/ridgeline-model-review-fixes`, branch `implement/entity-model-review-fixes`.
- Original reviewed integration: `1e4c2c589902ecf9c6509acff725d31912d90de7`.
- Fix commit: `4ff2823`.
- Final clean combined pin: `cf09290e615dfc4809b09519fdfb0825c4642ba9`, including root evidence-only `96c3c246f43dabdcb250105cfbd733d84c06c951`. The preceding combined pin was `31221198ab629d6030d8c0ba2aab93aac2811acc`.
- Final production src tree: `04413b0db510cc12b4794ea53f98cf331003ac53`. The first correction at 3122119 used `8e6c0efa6f852371658ab9cb49846ea7f872a703`.
- Final tests tree: `d7fddd93adccfae4cdb4aa07a5b4dbacf31e7981`. The first correction at 3122119 used `29910a74d3a8c15b8833a16378c9aaf40dab5b7b`.
- Changed production files: `src/entities.ts`, `src/entity-projection.ts`, `src/viewport.ts`. Two new behavioral test files plus the existing three packaged-consumer registration files. No public exports, runtime dependencies, tracker changes or hardware claims.

## Confirmed defects and corrections

1. **Computation callback ownership.** Preparation formerly called `flush()` and only afterward captured its revision. The final computation callback could accept a newer feature, leaving the frame tagged with the new revision while using the old cached altitude/style. Preparation now captures scene/configuration ownership before flushing, rejects an invalidated attempt before reading derived state, and uses the existing bounded ModelLayer retry. The CPU probe's first completed upload changes from altitude 100 to 300, while the reported accepted revision remains 2. No polling or extra retry loop was introduced.
2. **CPU off-screen culling.** Submission formerly preceded the projected-box check. Placement/contact and the full-box minimum-size solver still run before visibility testing. The final depth-clipped box is tested against the EntityProjection frame's snapshotted CSS viewport. Only intersecting boxes enter model draw batches, pick records, presentation records and measured instance/batch/triangle counts. Logical model representation and hysteresis remain independent of camera visibility, as the spec requires. A physical anchor 10 px beyond the right edge remains drawable after enlargement; floor measurement itself is never clipped to the viewport.
3. **Destroy during native rendering.** The strengthened callback regression reproduced an uncaught MapLibre `getBucket` error after synchronous `viewport.destroy()` removed native tile managers in the middle of custom-layer prerender. The viewport now tracks the pinned MapLibre `_render` stack. Logical cancellation and old canvas/control DOM cleanup happen immediately; native map and arrowhead teardown finish in the outer render call's `finally`. A follow-up real public regression confirmed that a destroy listener could remount even earlier, before the old DOM cleanup. Final commit cf09290 moves that cleanup before listener delivery for both ordinary and active-render disposal. The completed DOM cleanup is not repeated, so replacements created inside listeners or after destroy returns retain their DOM and container styling. Ordinary destruction stays synchronous. EntityScene also immediately releases its EntityLayer so that remaining native custom-layer calls cannot upload or draw old attachments.

## Ownership trace for disposal

`destroy()` marks the viewport destroyed and retires its own DOM before notifying consumers. Publication, pending initialization, resize observation, terrain/camera work, model registration/upload attempts, custom model/feedback/attachment resources, labels, measurement and viewport listeners are retired through their existing owners. Mutations are rejected immediately. Completed readiness remains completed. Native style/tile teardown and arrowhead source removal are deferred only while `_render` is on the stack. Its `finally` handles both normal return and exceptions, restores the installed methods, and cancels any native frame scheduled while unwinding. This uses the explicitly allowed pinned MapLibre integration; there is no timer, idle listener, microtask polling or public callback in the new guard.

## Reproducible RED provenance

The first complete correction tests are committed at `3122119`. These repeats temporarily restored original runtime files while keeping that exact committed test tree. They are deliberately recorded as dirty checkouts, not as tests of clean HEAD.

| History | Runtime delta from 3122119 | SHA-256 of saved patch | Result/log |
| --- | --- | --- | --- |
| Callback stale placement and off-screen submission | Original 1e4c2c5 `entities.ts` and `viewport.ts` restored; new projection intersection helper retained but unused by old scene | `c82675eb1e3598fd5023fb69c1dd207174898e25cd7c64b5ce30f4859eb6869a` | Both fail; `final-review-browser-pinned-red.log` |
| Destruction in computation callback | Only original 1e4c2c5 `viewport.ts` restored; ownership/culling/attachment cleanup corrections present | `ccc22fc542c16da97b27c31b4f0271171d2fbb9098ad96cf829a2d7dc7d92193` | All in-page assertions complete, native `getBucket` pageerror fails suite; `final-review-native-removal-pinned-red.log` |

Patches are `final-review-original-runtime.patch` and `final-review-native-removal.patch` in this directory. The later listener-remount RED used clean 3122119 production with only `final-review-listener-remount-test.patch`, SHA-256 `c0b966b38b3920688bda30085f1c5f11ace622db7046c4bd069e75988ac61d4f`. Its log, `final-review-listener-remount-red.log`, explicitly records failure for both ordinary and active-render remounts. The final green tests are committed at cf09290. Both were completely restored before clean-pin verification. Earlier discovery logs (`final-review-browser-red.log`, `final-review-browser-green.log`, `final-review-browser-disposal-green.log`) are historical uncommitted-development runs, superseded for provenance by the pinned repeats.

The independent CPU callback probe is `final-review-callback-regression.mts`, with `final-review-callback-{red,green}.log`. It executes real scene/model-layer/registry/render preparation and ModelMeasurement, but uses a WebGL test double. It establishes ownership mechanics only; browser acceptance comes from the actual packaged GPU runs.

## Permanent regressions

- `tests/model-frame-review.browser.ts` runs the installed package. The callback history compares first-frame pixels for a reentrant altitude/location/heading/pitch/roll/style replacement with a directly accepted control. It checks completed measurement revision, actual model submissions, pointer hits, below-terrain withholding, unrelated-instance survival, removal, repeated destruction, rejected later mutation, synchronous DOM removal, immediate same-container remount, completed readiness and no old custom upload/draw after destruction.
- Its culling history checks real instanced draw counts and measurement facts, enlarged partially visible pixels and real clicks, camera exit/re-entry while retaining the dead-zone choice, an unchanged 80 CSS px full floor, an empty view with zero batches/boxes/submissions, and a full 5 second quiet interval after native idle.
- Its third case verifies both ordinary and active-render destruction where a destroy listener synchronously creates a replacement. It checks immediate old DOM retirement, the replacement canvas and shared map class, and harmless repeated old destruction.
- `tests/model-frame.test.ts` executes production placement/projection/floor math for fully visible, wholly off-screen and physically off-screen but enlarged-visible boxes. Existing packaged near-plane crossing, flat/globe precision, terrain contact, labels and lifecycle histories are included in affected verification.

## Verification

At clean 3122119:

- `pnpm check`: PASS. `final-review-check-pinned.log`.
- `pnpm test`: PASS, 329 root tests and 5 control-lab tests. `final-review-tests-pinned.log`.
- Packaged affected suite, 40 cases: PASS in 4.1 minutes. `final-review-browser-affected.log`.
- Focused CPU scene/projection/placement/picking/floor checks: PASS before the final pin; source identical. `final-review-focused-final.log`.
- `git diff --check`: PASS.

At final clean cf09290, after moving DOM retirement before listener notification:

- `pnpm check`: PASS. `final-review-check-remount.log`.
- Packaged affected lifecycle suite, 17 cases: PASS in 42.4 seconds. Includes all three new cases, real context loss/restoration, consumer prerender mutation, registration/removal, initialization destruction, ordinary destruction, drawing cleanup, and listener/return-time remount. `final-review-browser-remount-green.log`.
- `git diff --check`, clean worktree, latest root 96c3c24 ancestry: PASS.
- The preceding 40-case / 329+5 unit results remain correctly pinned to 3122119. Only DOM disposal ordering and its two-history public regression changed afterward. Root will run final integrated checks after merge.

Node 24.21.0, Google Chrome for Testing 153.0.8010.12, MapLibre 6.11.0. The browser run uses the existing SwiftShader packaged-test configuration. It establishes software-rendered correctness, not target-hardware speed or Safari/macOS acceptance. Root owns combined review, final integrated validation and closeout.
