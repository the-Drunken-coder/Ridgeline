# Final entity-model Spec re-review

Date: 2026-10-05 UTC. Reviewer: final_spec_review. Root owns integrated verification and edits.

Final conclusion: no independently verified remaining Spec findings in the reviewed implementation or corrective deltas. The two original Spec defects are corrected; the separately verified destruction-listener remount defect is also corrected. This is a pinned Spec review with focused CPU evidence, not a production-readiness or completed combined-browser-verification claim. Historical3122119 evidence remains below and is explicitly superseded by this final section.

## Exact revisions and scope

Base: `2733cee9fe9440237a36e90d9efa2fc4239b87c3`.
Original head: `1e4c2c589902ecf9c6509acff725d31912d90de7`.
Intermediate correction: `31221198ab629d6030d8c0ba2aab93aac2811acc`.
Final reviewed/executed head: `cf09290e615dfc4809b09519fdfb0825c4642ba9`.
Integrated root revision: `708988d1253863412f73915a650b610518ddb9fc`.
Full tree: `70a7b68e0c0ac2899ba39213265050b64baac637`.
Production source tree: `04413b0db510cc12b4794ea53f98cf331003ac53`.
Tests tree: `d7fddd93adccfae4cdb4aa07a5b4dbacf31e7981`.

Executed `git diff --exit-code cf09290e615dfc4809b09519fdfb0825c4642ba9 708988d1253863412f73915a650b610518ddb9fc`: exit0, no output. Exact full/source/test trees therefore match the integrated delivery. All this reviewer's final executions used the own detached checkout `/tmp/ridgeline-model-spec-review` atcf09290. No source/test/root/tracker changes; only its explicitly recorded untracked dependency symlink is present. Worker checkout was not executed and no browser/GPU was launched.

Canonical approved `.scratch/entity-models/spec.md` and all prior linked/context/source-consumer review remain applicable. The final delta3122119...cf09290 touches only `src/viewport.ts`, the permanent packaged browser test, and its case index. Callback-frame and enlarged-box culling corrections are unchanged. The first complete review and original findings are retained in `/tmp/ridgeline-model-context/final-spec-review.md`.

## Final corrected ownership and runtime histories

Spec100: "Destroy releases bytes, decoded images, arrays, GPU resources, listeners and scheduled work, including partial initialization."
Spec147: "No stale events, mounts, uploads or render scheduling after cancellation."
Spec15 retains "callback-safe disposal contracts"; the existing public viewport supports synchronous disposal and same-container remount.

`src/viewport.ts:598` marks the old owner destroyed; at601-602 it invokes the captured old native DOM cleanup once and replaces the later native cleanup with a no-op before delivering destroy callbacks at603. The callback therefore receives an empty container, and replacement ownership begins after retirement of the old canvas/control containers and shared class. Old library resources, registry work and scheduled tasks still dispose synchronously. At610-611, native removal is deferred only when the old native `_render` is active; the wrapper at130-135 waits for the outermost native stack. `removeMap` at138-141 then removes old arrowheads/native resources and restores the original methods. Old repeated destroy returns early. The cleanup ordering change fixes a concrete public contract defect and does not add product scope.

Independently executed six public viewport histories atcf09290: ordinary destroy-listener remount; native-render destroy-listener remount; nested-native-render destroy-listener remount; native/nested after-return remount controls; and a throwing destroy listener after remount. Every history observes an empty container and exactly one old cleanup before its destroy callback, one destroy event, exactly one old native removal, retained replacement canvas/map class, and exactly one replacement cleanup/removal at its own teardown. Native style remains present until the old render returns; nested render exit does not remove it. A pending real registry registration rejects MODEL_LOAD_CANCELLED and the unfinished ready promise rejects DESTROYED. Old public upsert is rejected. Repeated old destruction causes no additional repaint or replacement removal. Final scheduled RAF count is0.

This probe uses the real public createViewport and registry, constructor/render/remove doubles, and the exact installed MapLibre6.11 `_cleanupContainer` implementation. It executes callback and cleanup ownership rather than source-text assertions, but does not establish native painter/GPU behavior, browser layout or pixels. The prior Standards RED at312 and actual packed public reproductions belong to their respective reviewers/worker, not this execution.

The real EntityScene/ModelLayer preparation/publication probe was rerun unchanged in behavior atcf09290, with current pinned metadata. It passed callback replacement versus the direct current pose/color control, callback below-terrain replacement, callback entity removal, callback scene destruction followed by stale old layer render, off-screen culling plus hysteresis camera re-entry, and enlarged-edge visibility. Counts remain1→0→1 for camera culling while model representation persists; partial visible enlarged boxes submit; invalid/removed placements submit0; current pose/color matches the direct control. Scene buffer disposal occurs once, subsequent old renders add no work, and teardown leaves0 scheduled frames.

This directly rechecks Spec130/136/147 latest-frame/cancellation promises and Spec112/#75 CPU skipping without violating Spec50 visibility-independent representation or Spec120/122 hysteresis. GPU upload/draw and the controlled map/sampler are doubles. The focused tests also execute parser/material validation, registration/revision/resource ownership, placement/projection, frame geometry, picking/presentation, workload generation and measurement-report semantics. No further verified wrong implementation, missing requested implementation or unrequested behavior was found. Hardware requirements remain intentionally pending rather than reclassified as implementation defects.

## Final execution evidence and limits

Focused86-test command atcf09290: pass86, fail0, cancelled0, skipped0;2880.082225ms, process exit0.

`node --import tsx --test tests/model-glb.test.ts tests/models.test.ts tests/model-placement.test.ts tests/model-frame.test.ts tests/model-switching.test.ts tests/model-picking.test.ts tests/model-presentation.test.ts tests/entity-projection.test.ts tests/elevation.test.ts tests/model-workloads.test.ts tools/model-measurement/report.test.ts tools/model-measurement/workload.test.ts tools/model-measurement/pixels.test.ts`

Log: `/tmp/ridgeline-model-context/final-spec-final-focused.log`.

Independent scene probe, exit0: `node --import tsx /tmp/ridgeline-model-context/final-spec-final-probe.mts`. Artifacts: `.mts`, `.json`, `.err` under the same final-spec-final-probe stem.

Independent viewport/remount probe, exit0: `node --import tsx /tmp/ridgeline-model-context/final-spec-viewport-remount-probe.mts`. Artifacts: `.mts`, `.json`, `.err` under that stem. The reused import stub is `/tmp/ridgeline-model-context/standards-viewport-maplibre-stub.mjs` (the earlier historical record's shorter stub filename was inaccurate).

Root's integrated full unit/type/ticket,185-case packaged suite and playground/measurement/control checks were still pending/running at report time. Worker owned final affected native browser cases. No claim is made that those checks passed by this reviewer. #80/#91 target-device/browser measurements, triangle/material guideline, advisory diagnostic and production acceptance remain deliberately pending. Software timing is not hardware performance. No hosted checks, PR/push or parent#81 mutation occurred.

## Historical correction review at3122119

Date: 2026-10-05 UTC. Reviewer: final_spec_review. Root owns integrated verification and all edits.
Status: the original two Spec findings are corrected at this pin. This is an interim review, not a final clean review or production-readiness claim. Root has identified a remaining destruction-listener remount problem through the independent Standards review and is arranging another correction and pin.

Base: `2733cee9fe9440237a36e90d9efa2fc4239b87c3`.
Original reviewed head: `1e4c2c589902ecf9c6509acff725d31912d90de7`.
Corrective reviewed/executed head: `31221198ab629d6030d8c0ba2aab93aac2811acc`.
Corrective production source tree: `8e6c0efa6f852371658ab9cb49846ea7f872a703`.
Corrective diff: `git diff 1e4c2c589902ecf9c6509acff725d31912d90de7...31221198ab629d6030d8c0ba2aab93aac2811acc`.
Review checkout: `/tmp/ridgeline-model-spec-review`, detached at3122119. No source or test changes. Only an explicit untracked dependency symlink `node_modules` points to root's installed dependencies. The root checkout remains untouched; the worker checkout was not used.
Canonical requirements remain `.scratch/entity-models/spec.md`, approved source21805ecb, plus accepted context75/77/78/79 and implementation issues82-91. Prior complete review is `/tmp/ridgeline-model-context/final-spec-review.md`; all its ownership and scope context carries forward.

## Corrected requirements

### Callback frame ownership

Spec130: "Consumer callbacks can cancel or replace state; do not emit stale follow-up changes or resurrect removed hover."
Spec136: "Below-terrain or otherwise withheld placement also withholds the Model."
Spec147: "No stale events, mounts, uploads or render scheduling after cancellation."

`src/entities.ts:415` now captures scene/configuration ownership before flushing dirty work and rejects the preparation at420 if a callback changed it. The model layer's existing bounded next attempt computes the newer entity before reading states/modelStyles or preparing instance buffers. The unchanged renderer/registry/visibility/labels owners still recheck the returned current predicate before upload, commit, drawing and publication.

Executed valid control: directly accept blue at longitude.002, altitude80, heading73, pitch24 and roll-16 and capture its prepared instance. Executed reentrant history: prepare older red at longitude0/altitude100; the changed callback installs that blue entity. The first completed corrected frame's instance is deep-equal to the direct control, including anchor, basis and appearance. Only the initial empty setup and current instance preparation occur; obsolete mixed instance data is not prepared. Computed state altitude is80.

Executed invalid placement: callback replaces the same older red entity with blue at longitude.002/altitude-10. The first completed frame submits zero instances and publishes below-terrain placement with a non-model representation. Executed removal: callback removes the ID; zero instances and no state remain. These valid/invalid histories no longer collapse to the same incorrect one-model/current-revision summary.

Executed destruction: callback destroys the scene after its attachment entity layer has allocated a buffer. The buffer is disposed once; subsequent calls to both old entity/model layer render methods cause no further draw/repaint/scheduled work. The addition at `src/entities.ts:303` makes entity-layer `onRemove` synchronous, and that layer's existing `render` guard exits with no buffer/map. No scheduled animation frames survive fixture teardown.

### Off-screen culling, representation and hysteresis

Spec112 retains the accepted architecture; accepted decision75 requires "Off-screen entities are skipped on the CPU."
Spec50 states representation is independent of whether the entity is in view. Spec120/122 preserve hysteresis and temporary-eligibility behavior.

`src/entities.ts:482` determines the logical model representation before culling. The enlarged physical placement is projected and depth-clipped before the conservative viewport-box intersection at486. Only the visible group receives instance data, pick boxes and presentation records. `publish` derives submitted instance/batch/triangle and clipped-box facts from those same accepted groups. The choice and representation maps retain eligible off-screen models, so culling is not treated as unavailable/withheld placement.

Executed history: one inside and one outside entity yield one submitted instance; the outside entity still publishes model representation. Configure a dead zone with entrance100m/exit9900m, move the camera so both models are outside, and return inside the band. Submission counts are1→0→1; the outside entity stays model throughout and the current blue instance returns without requiring another entity update. Executed enlarged edge: a physical anchor outside the viewport still yields one submitted model when its40px enlarged box partly intersects the screen. The new focused frame test also preserves the complete40px floor while only part of the box is visible and checks both sides of the viewport.

## Native destruction review and pending correction

Traced `src/viewport.ts:125` and596 through the installed MapLibre6.11 `_render`, `_cleanupContainer`, `remove`, render scheduling and container ownership, plus old model/entity resources and deferred arrowhead removal. During a native render, logical library/DOM disposal occurs synchronously and native painter/style teardown waits until the outer `_render` returns. The existing guards cancel publication, model work, callbacks and pending registration; MapLibre's eventual removal cancels its queued native frame. Repeated destruction returns early. A remount initiated after cleanup creates a distinct map, and the old delayed cleanup becomes a no-op.

However, `destroy` still emits its destroy callbacks before this DOM cleanup. Root supplied an independently executed finding that a callback synchronously remounting in the same container loses the replacement's maplibregl-map class during old cleanup, both outside and inside native rendering. This review does not relabel312 as final clean. Root/worker will correct that ordering and provide a new pin. This reviewer has not independently executed native viewport/DOM remount at312; the result belongs to the Standards review's actual constructor/render/remove doubles and root's verified finding. Its files are `/tmp/ridgeline-model-context/standards-viewport-cleanup-probe.mts`, `.json`, and `maplibre-stub.mjs`. Final public browser disposal/remount/quiet evidence remains worker/root-owned.

## Execution evidence

At3122119, the following command passed86 tests with zero failures/skips in7154.83ms:

`node --import tsx --test tests/model-glb.test.ts tests/models.test.ts tests/model-placement.test.ts tests/model-frame.test.ts tests/model-switching.test.ts tests/model-picking.test.ts tests/model-presentation.test.ts tests/entity-projection.test.ts tests/elevation.test.ts tests/model-workloads.test.ts tools/model-measurement/report.test.ts tools/model-measurement/workload.test.ts tools/model-measurement/pixels.test.ts`

Log: `/tmp/ridgeline-model-context/final-spec-rereview-focused.log`.

Independent corrective probe: `node --import tsx /tmp/ridgeline-model-context/final-spec-rereview-probe.mts`, exit0, six asserted histories and zero remaining scheduled frames. Evidence: `/tmp/ridgeline-model-context/final-spec-rereview-probe.mts`, `.json`, `.err`.

The probe runs the real scene/model-layer preparation and completed-frame publication, registration/parser, placement, settings, culling and entity-buffer disposal. GPU upload/draw and a controlled map/sampler are test doubles. It establishes CPU state/submission/publication ownership, not browser pixels, actual native render stack disposal or DOM remount. No source-text assertions were used.

No browser/GPU launch was performed; the worker owns that slot. Root's original182-case suite/evidence and worker initial two-case green results are reported externally and do not substitute for current final-pin integrated checks. Strengthened disposal/remount and affected lifecycle/globe/near-plane checks were still running when this interim record was written.

No additional independently confirmed Spec findings were found in the corrective delta. The confirmed native remount issue remains tracked by root and prevents a final clean review at312. Hardware/browser acceptance, target-machine performance, guideline/advisory and production acceptance remain deliberately pending #80/#91. No tracker/source/root edit, fix, PR, push or hosted verification was performed. Parent#81 remains untouched. A subsequent correction requires another pinned delta review and affected checks before closeout.
