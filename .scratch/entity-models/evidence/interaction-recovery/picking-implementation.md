# Model picking and shared frontier bridges

Status: implementation complete and affected workflows locally verified; root integrated verification/closeout remains separate. Root owns integrated diff review, final full regression, tracker closeout and any production acceptance. No PR/push was requested. Hardware #80/#91 remains pending. All browser evidence here is local Google Chrome for Testing 153.0.8010.12 with SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`), Node v24.21.0 and MapLibre 6.11.0, not target hardware.

## Ownership and current pin

Worktree `/tmp/ridgeline-model-picking`, branch `implement/entity-model-picking`, from integrated `647458e6f7d4ff3b86a72d6fb86f474457dbf4be`.
Final clean delivery `a177ef470dd3426e70b5edad6f4f4cd705fa9e0f`; root `8c8278c`, #88 `bb202f9` and #89 `02a36ee` included. Its production `src` tree exactly matches root-reviewed and exercised `2ea02ce67a55db3d8a915cc02a6e9c3fa8158217`. The final delta is documentation/evidence and stronger recovery browser assertions only.
Canonical spec: `/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/.scratch/entity-models/spec.md`; exact ticket `/tmp/ridgeline-model-context/issue-87.md`.

## Implemented behavior

- `model-picking.ts` tests clipped oriented-box faces and tolerance edges, retaining depth at the tested point and rejecting known terrain behind that point. Internal geometry seam, no public API expansion.
- Scene records actual placement/scale, projection/world copy and original feature ownership while preparing; installs records only when ModelLayer reports successful draw. Removed/replaced feature identities, failed draws and context loss cannot keep stale model boxes. A captured transform/projection is used for terrain-depth comparisons.
- Actual native labels/icons/points precede depth-sorted custom models/airborne attachments, matching their later rendering order. Hidden model markers are excluded; real native label hits remain eligible only when their actual layout stamp matches the desired current stamp. Ground hits preserve their prior place after airborne geometry. Public events contain original consumer IDs and only real attachment IDs.
- Stationary hover refreshes in a microtask after real render events, including during camera motion, without scheduling extra frames. Mutation ownership stops stale observer delivery; later draws resume remaining hover observers with current content without reinvoking the original mutating observer. This also prevents unconditional same-ID replacement callbacks from starting an event/render loop.
- Radial picker validates ownership after custom content disposal before requesting selection. Consumer owns selection and interaction leases remain authoritative.
- Shared #88 bridge: copied appearance plus selected/preview feedback on model draws, one current presentation record per visible projected box, native label offsets/stamps with FeaturePublication as sole writer, feedback layer after physical geometry, `hasLabel` from cached style to avoid empty-label native uploads. Removing feature state invalidates both visibility and label caches.
- Shared #89 bridge: early lost-context entry withholds representations, empties picks, retires publication before registry callbacks. Restoration permits style setup without prematurely publishing ready draws. Native GPUInitializationError settles queued registrations. Accepted basemap changes during loss are applied only after native context restoration. Last-entity removal flushes empty airborne geometry before any render-time reprepare.

## Meaningful executed RED/GREEN histories

1. Empty region inside enlarged model box had no public pointer hit. Face/edge picking plus last-drawn publication fixes it (`picking-public-red.log`, `picking-public-green.log`).
2. Custom hits preceded a native marker actually drawn above them. Native later-layer ordering fixes it (`picking-all-first.log`, `picking-all-green.log`).
3. Enter disposed custom picker content which destroyed the viewport, then attempted stale selection and threw DESTROYED. Post-disposal ownership check fixes it (`picking-callback-red.log`, `picking-callback-green.log`).
4. Hover callback replaced the same feature ID before later listeners: latest tooltip never mounted. Resume current hover delivery fixes it (`picking-hover-replace-red.log`). Unconditional replacement on every initiating callback reproduced a render/event loop; remaining-observer delivery fixes it (`picking-repeated-replace-red.log`, `picking-repeated-replace-green.log`).
5. Root/#88 actual glyph proof: remove+reintroduce same ID before a frame erased native labelStamp but retained cached written stamp, leaving 0 label pixels and 4691 body pixels. Viewport cache invalidation fix `4391a06`; projection worker's public glyph GREEN covers it.
6. #89 actual consumer-prerender removal left 112 stale airborne-dot pixels because geometryDirty was not flushed when dirty IDs became empty. Scene condition fix `8b0627b`; recovery worker actual first-frame pixel/pick GREEN covers it.
7. #89 actual context loss + accepted basemap configuration restored the old white basemap. Deferred style fix `6a1d116`; recovery worker final suite checks current accepted basemap after native restoration.

## Permanent public picking cases

- Original entity and actual attachment hits through an enlarged empty box region; outside-box rejection; consumer-owned selection; interaction lease suppression.
- Actual drawn RGB model pixels and clicks at ±date line and later flat world copies plus globe; independent native clip-plane signs prove a large model actually straddles near plane, visible magenta exterior pixels exist and real pointer at their centroid picks original entity; fully behind-near-plane rejection; known native 100m terrain visually occludes all model pixels and rejects box hits.
- Real registered icon and display names in radial choices, native yellow center pixel proves topmost marker before ordering assertion, two model depths reverse registry order, stable slots across switching, removed/reintroduced IDs, Arrow/Enter/Escape, consumer selection, disposal destroys viewport without stale request.
- One real pointer placement then readiness/unregister/recovery, entity/camera motion (hover exit while camera is moving), unknown terrain/retry, representation switches, 5 seconds of zero renders and zero hover events, removed/replaced callback ownership, no obsolete tooltip remount.

## Local evidence at current pin

- `pnpm check`: pass (`picking-combined-check.log`).
- 75 focused geometry/placement/elevation/registry/settings tests: pass (`picking-combined-focused.log`).
- Four strengthened pointer/pixel cases passed before near-plane addition (`picking-pixel-proof.log`, 32.7s).
- Final additional model-specific near-plane public case passed (`picking-near-crossing.log`, 16.4s case /18.8s total).
- Repeated mutation callback public case passed (`picking-repeated-replace-green.log`, 9.3s case).

## Final combined delivery

- Clean branch HEAD `a177ef470dd3426e70b5edad6f4f4cd705fa9e0f`; `git diff --check` passes; no unstaged files. Root `8c8278c` is an ancestor.
- Root reviewed production source at `2ea02ce67a55db3d8a915cc02a6e9c3fa8158217`; there are no production source changes between that revision and final HEAD.
- `pnpm check` and 75 focused tests passed at `2ea02ce`: `frontier-combined-check.log`, `frontier-combined-focused.log`.
- 25 model-named packaged cases passed at `2ea02ce` in 2.9 minutes: `frontier-combined-browser.log`. The first start-anchored filter matched no Playwright full titles; corrected filter exercised these 25. No runtime failure occurred in that combined run.
- Final HEAD `pnpm check` passes: `frontier-final-check.log`.
- Final HEAD affected packed checks pass 2/2 in 7.4 seconds: updated allocation failure/retry assertions, plus Embedded PNG/JPEG material workflow omitted by the model-name filter. Evidence `frontier-final-affected-browser.log`.
- Together these cover all 26 distinct model workflows on the same production source tree, with the only changed test re-executed on final HEAD.
- #88 closeout and six actual screenshot references: `/tmp/ridgeline-model-context/presentation-closeout.md`.
- #89 closeout and failure/cancellation evidence: `/tmp/ridgeline-model-context/recovery-implementation.md`.

No remaining implementation gap identified for #87 in the approved scope. CPU boxes intentionally include empty/masked regions; terrain rejection remains the accepted sampled approximation. Browser/hardware production acceptance and root's final full regression are not claimed by this handoff. Root owns integrated verification and tracker closeout; parser_audit is available as merger after root approval.
