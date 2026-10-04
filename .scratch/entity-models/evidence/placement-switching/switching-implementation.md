# #86 switching implementation handoff

Date: 2026-10-04. Canonical spec: `/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/.scratch/entity-models/spec.md`; ticket: `issue-86.md` beside this note. Root owns integrated verification and closeout. Worktree `/tmp/ridgeline-model-switching`, branch `implement/entity-model-switching`.

Final source: `882b15c72e67a9cbcab24b433f4b78e93f1e4f82`; runtime is unchanged from root-reviewed `f14db3db4b56c8156423e04bf1d9242e18436c6d` (last commit changes only test eligibility setup). It includes Elevation ownership fix `6d3ba6d`. Earlier complete 14-case check revision: `2a2c0f3ecc5b0bb2d153014df5e835120e7d2e7d`. Own implementation commits `f9202f8`, `eb6d4872bbc6e96d56193f9dd87438169397d515`, `2a2c0f3`, and `f14db3d`; merged placement1170f28 and integration525ed1d. No PR, push, or tracker writes.

## Boundaries

- `model-switching.ts`: pure proposed hysteresis choice. Strict threshold comparisons retain equality. Missing heading, removed/changed reference, and unregister reset. Temporary eligibility preserves choice.
- `entities.ts`: owns current feature revisions, placement requests, effective settings, proposed frame, accepted choice and latest renderer publication. Fresh registry lookup avoids replacement resource gaps. Groups each asset's instances at one shared canonical map-center Mercator origin. Releases model terrain area on icon choice; retains temporary unknown-model work. Installs the whole accepted entity batch before aborting old work, then respects per-feature identity during cleanup so callbacks can remove or reintroduce an ID without losing other accepted entities.
- `model-frame.ts`: clipped projected box from exactly the renderer's vertex coordinates and world copy, plus bounded scale solve. Scene rechecks actual final terrain contact up to four refinements, requesting unknown exact final footprint rather than guessing height. Shared helpers are the intended input to #87 last-drawn box picking; picking itself remains #87.
- `model-layer.ts`: projection capture and GPU preflight in prerender, opacity commit, draw, then publication from map render completion. Retries input preparation at most twice when callbacks replace the revision. Preflight/draw failures select eligible fallback before later native circle/symbol layers; registry availability and diagnostics emit after render.
- `model-visibility.ts`: pinned MapLibre6.11 native circle/symbol opacity adapter. Updates feature state and prepares existing source tiles in the same frame. Invalidates cached native GL bindings first because model preflight uses raw WebGL. No RTT or label paint updates.
- `viewport.ts`: owns native source publication identity/readiness and exact native marker keys, invalidates opacity destination on source retirement/restoration/removal, moves native fallback layers after model rendering. Public representation changes emit entitychange without republishing GeoJSON. Ordinary upsert/remove publication reads current store state after terrain abort callbacks; stale outer snapshots cannot overwrite callback updates.
- `entity-layer.ts`: immediate per-frame airborne point suppression used by render and pick, while keeping point geometry available for immediate fallback.

No production instrumentation, comparison controls, new renderer backend abstraction, or additional dependencies.

## Executed histories

Four stable packaged cases in `tests/model-switching.browser.ts`:
1. Discrete entrance/interior/exit histories, continuous camera motion and every rendered frame, zero-width equality, atomic combined configuration/entity rejection, inherited undefined entity overrides, selection stability, replacement/unregister, 20 shared instances in exactly one solid-material draw. Actual registered blue icon and airborne blue dot alternate against a magenta model in flat, full globe and intermediate globe views; pixel XOR agrees with state.
2. Initial availability within band remains icon, unknown terrain retains prior model choice, stationary recovery restores it, missing heading/reference change reset. Pending exact model footprint aborts after far switch. Enlarging a pending footprint can trigger abort→remove; a subsequent provider reset starts no ghost preparation. Reference-change abort→remove and removal abort→reintroduce preserve current state, native source membership and icon pixels; an unrelated unknown-terrain member retains its own preparation.
3. Actual instance buffer upload and draw failure injection preserve same-frame fallback; retry within band restores choice. Sampling callback changes configuration during preparation. Entitychange removes/recreates same ID. Registration callback destroys viewport; cancellation must leave no later repaint.
4. 40 CSS px projected-box floor across zoom and pitched/bearing views, physical-only zero floor close up, and five-second settled idle window.

Focused tests execute pure choice histories and validation, plus merged model/registry/placement/elevation/entity/projection suites. Integrated placement tests add terrain contact, enlargement/attachment independence, exact terrain preparation, high-zoom/date-line/globe precision, and planet hiding.

## Reproduced GL cache defect

Historical failing run `switching-browser-third.log`: actual symbol at flat zoom14 reported model but drew blue576/magenta0. The renderer's raw instance-buffer bind preceded native manager.prepare while MapLibre still trusted its prior binding cache. `context.setDirty()` immediately before manager.prepare fixed this concrete history (`switching-symbol-dirty.log`, one full history case passed), including full/intermediate globe and airborne dot variants. Adapter owns this invalidation because it crosses from custom raw WebGL into native cached-state upload; MapLibre's usual custom-layer invalidation occurs only after prerender returns, too late for this call.

## Executed callback ownership correction

`switching-abort-reentry-red.log` reproduced a final-footprint replacement whose AbortSignal callback removes its entity, followed by provider reset resurrecting preparation. The Elevation owner fixed internal operation ownership in `6d3ba6d`, without expanding the scene API.

`switching-entity-abort-confirmed-red.log` then reproduced both scene failures on runtime `566e9b1` with the new test only: reference-change abort restored a removed entity; removal abort discarded a reintroduced entity. The fixture explicitly asserts both callbacks ran, settles shared placement work before isolating model-only cancellation, and includes an unaffected batch member. A standard 256px flat DEM avoids the invalid 16px exploratory fixture's native sampling error. The corrected scene and publication workflow passed `switching-abort-reentry-green.log` (7.2s); final checks further require the unaffected member's actual unknown-terrain preparation.

## Verification record

- `switching-2a2c0f3-check.log`: pnpm check passed at 2a2c0f3.
- `switching-2a2c0f3-focused.log`: 71 tests passed at 2a2c0f3.
- `switching-final-all-models-browser.log`: all 14 combined model cases passed at 2a2c0f3 (1.7 minutes).
- `switching-final-browser.log`: earlier 13 combined cases passed at f895069 (2.1 minutes).
- `switching-abort-reentry-red.log`: subsequent new public regression failed on 2a2c0f3 runtime exactly because removed model terrain preparation resurrected after provider reset. This was fixed in the merged Elevation operation boundary; scene-only current checks could not undo an already resurrected area.
- `switching-closeout-check.log`: pnpm check passed at f14db3d.
- `switching-closeout-focused.log`: 98 model/registry/placement/elevation/entity/store/publication tests passed at f14db3d.
- `switching-closeout-browser.log`: 19 of 20 cases passed at f14db3d, including all placement, materials, registration, callback cancellation, publication and atomicity checks. One distance-history symbol fallback captured a blank frame immediately after an unsettled globe camera jump, before native symbol tile eligibility was established. This evidence is preserved. The test now waits for the view to idle and explicitly asserts visible native icon pixels before checking the very first model and fallback frames.
- `switching-symbol-settled-repeat.log`: corrected distance/settings/symbol/dot history passed three repeated packaged runs (29.6s), with source content committed unchanged as 882b15c.
- `switching-pinned-check.log`: pnpm check passed at exact882b15c.
- `switching-pinned-browser.log`: all four switching/floor packaged cases passed at exact882b15c (26.7s). Worktree and diff whitespace checks are clean. Root reviewed the f14db3d runtime ownership change and the final test eligibility boundary; root owns integrated closeout.
- Browser uses installed Playwright Chromium with SwiftShader on port5178. This is software browser verification, not target hardware acceptance.

## Limits and later ownership

- #87 must retain and consume last-drawn box/projection for picking. Current shared box helper does not itself implement model interaction.
- Context restoration/resource rebuilding belongs to #89. Temporary renderer failure/retry and no-stale-callback behavior are covered here.
- Terrain contact remains a rigid-box approximation on uneven surfaces. Final projected floor/contact refinement is bounded.
- Native source.prepare uploads across tiles are not transactional. The tested failures occur in model preflight/draw before fallback submission; do not claim atomic recovery from arbitrary partial native tile-upload failure or an already-partially-drawn model. Browser/runtime failure is reported through existing errors.
- Target browsers, representative performance and hardware production readiness remain #80/#91 pending.
