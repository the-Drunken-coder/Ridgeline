# Final entity-model Spec review

Date: 2026-10-05 UTC. Reviewer: final_spec_review. Read-only independent Spec axis. Root is the integration owner and owns combined verification and all source edits.

Base: `2733cee9fe9440237a36e90d9efa2fc4239b87c3`.
Reviewed and executed head: `1e4c2c589902ecf9c6509acff725d31912d90de7`.
Production source tree: `b948ba66a835753b8e63c22d161a2e31686a2893`.
Checkout: `/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4`.
Clean status before and after execution. No uncommitted source changes reviewed or exercised.
Diff: `git diff 2733cee9fe9440237a36e90d9efa2fc4239b87c3...1e4c2c589902ecf9c6509acff725d31912d90de7`.
Commit list: `/tmp/ridgeline-model-context/final-review-commits.txt`.

Requirements: `.scratch/entity-models/spec.md`, byte-identical imported approved source21805ecb; originating issue81, implementation issues82-91, accepted context75/77/78/79 in `/tmp/ridgeline-model-context/`. Read AGENTS.md, CODE_CONVENTIONS.md, GLOSSARY.md, docs/agents/domain.md, docs/agents/issue-tracker.md, the three accepted ADRs, README public contracts, package commands, root closeout, measurement and example handoffs, and measurement evidence index/README. Source consumers outside the main model diff include features, feature publication, entity computation/ground/camera coverage, and interaction UI.

## Findings

### P1: callback replacement creates a mixed-revision model frame

Location: `src/entities.ts:414` through the revision capture at420, then state/style read at433 and placement construction at450.

Spec line130: "Consumer callbacks can cancel or replace state; do not emit stale follow-up changes or resurrect removed hover."
Spec line147: "No stale events, mounts, uploads or render scheduling after cancellation."
Spec line136: "Below-terrain or otherwise withheld placement also withholds the Model."

`prepareModelFrame` flushes dirty scene input before capturing its frame revision. `flush` builds states/styles for that input and calls `options.changed` at351. The viewport's changed adapter emits entitychange after feature publication. If that consumer callback upserts a newer version, the frame captures the newer revision as current, but pairs that new feature with states/modelStyles from the earlier build. `current()` cannot detect the mismatch, since the revision was captured after replacement.

Executed history: initial red entity at longitude0, heading0 and sea-level altitude100. During the changed callback, replace the same ID with blue, longitude.002, heading90 and sea-level altitude-10. Actual scene/model-layer preparation submits an instance at the NEW longitude using OLD red and altitude100. The current feature is below terrain and should not be submitted. A second preparation emits zero model instances, proving this is a transient incorrect frame rather than an intended retained registration.

Evidence: `/tmp/ridgeline-model-context/callback-frame-probe.mts` and `.json`. Executed with `node --import tsx /tmp/ridgeline-model-context/callback-frame-probe.mts`. Exit0 with all assertions passing. Real EntityScene, ModelLayer, registry/parser, settings and placement logic ran; upload/draw were stubbed, and map/projection/sampler fixtures were controlled. This establishes the CPU-prepared submission defect, not a browser pixel claim. A real public entitychange/upsert frame-by-frame browser regression remains necessary for the fix. Valid and invalid histories can both have one model, the same Feature ID, a ready asset and a current scene revision; those summaries do not establish coherent data ownership.

Suggested correction: before capturing a frame revision, verify that the flush did not create new dirty input or cancel/retry preparation at the prior generation boundary. Build/render from one accepted revision, including styles and computed placement. Do not merely relabel mixed data as the newer revision.

### P2: accepted CPU off-screen culling is absent

Location: `src/entities.ts:478` through485; supporting projection box code `src/model-frame.ts:9` through24.

Spec line112: "Retain the accepted architecture" and "CPU scaling and oriented-box picking use that same projected frame."
The linked accepted loading/drawing decision75 specifically says: "Off-screen entities are skipped on the CPU."

The scene adds every eligible selected model to an instance group before computing its projected box. No later caller removes out-of-screen instances. `modelScreenBox` clips depth/near planes but does not intersect the viewport. Models wholly outside the screen still undergo instance upload and draw submission. The submitted/clipped counters can therefore include bodies outside the visible workload.

Executed history: controlled1000×1000 flat frame, near model anchors at screen x500 and x1888.89, both within the1900m entrance. Preparation submits2 instances when CPU off-screen culling should submit1. This does not establish the magnitude of hardware performance cost.

Evidence: `/tmp/ridgeline-model-context/offscreen-cull-probe.mts` and `.json`. Command `node --import tsx /tmp/ridgeline-model-context/offscreen-cull-probe.mts`, exit0. Real scene/layer preparation ran; GPU upload/draw stubbed. The first attempt lacked the canvas color-decoding fixture and submitted0; its failure was investigated, the required OffscreenCanvas test fixture was added, and the final probe succeeds. No browser/pixel claim. Frame publication must still report model representation for eligible off-screen entities, as spec50/issue86 require; culling draw work must not reset hysteresis or imply withheld placement.

Suggested correction: use projected frame/box visibility to exclude draw, hit and presentation submissions without changing representation eligibility or choice. Exercise an inside/outside history, partial edge visibility, clipped/behind-planet cases and model-visible workload counters.

## Executed checks

At exact reviewed clean head, this command passed85 tests, zero failures, zero skips, in4559ms:

`node --import tsx --test tests/model-glb.test.ts tests/models.test.ts tests/model-placement.test.ts tests/model-switching.test.ts tests/model-picking.test.ts tests/model-presentation.test.ts tests/entity-projection.test.ts tests/elevation.test.ts tests/model-workloads.test.ts tools/model-measurement/report.test.ts tools/model-measurement/workload.test.ts tools/model-measurement/pixels.test.ts`

Log: `/tmp/ridgeline-model-context/final-spec-focused.log`.
Both focused preparation probes passed at the same exact head. All reviewer artifacts are outside the repository.

Root reports final type/ticket/control checks passing at this head and is running the full182-case packaged browser suite. That suite is root-owned and was incomplete when this report was delivered; this review does not declare it passed. No browser, GPU, PR, hosted checks, push or tracker write was performed by this reviewer.

## Constructed histories and code-inspection conclusions

- Completeness and public contract: types/public exports match registration, optional model references/orientation, model-specific appearance, configuration defaults and state snapshots. FeatureStore validates/copies entire batches before store mutation; effective settings are validated before upsert/configure mutation. Duplicate IDs intentionally retain the last accepted batch member. Missing heading and missing registration remain distinct diagnostics. Statusready during failed/pending replacement differs from initial loading/failed. The executed settings and registry tests cover these states; no additional missing API found.
- Parser/materials: pure registration-time GLB parser rejects malformed containers, external resources, sparse data, skins, morphs, non-triangles and named required extensions. Supported transforms, mirror winding, quantized/core attributes, texture transforms/samplers, imported alpha/colors/emission/unlit/double-sided rules are traced into upload and shaders. Assigned/original modes preserve source alpha and immutable geometry. The85-test execution includes parser fixtures and deterministic serialized vehicle/material workloads. Actual PNG/JPEG decode and rendered appearance are historical packaged evidence and part of root's current suite, not fresh reviewer executions.
- Shared registration and cancellation: registerA, replaceB, then lateA cannot install because pending/attempt/uploader identities and abort state gate completion. Unregister/destroy clear entry ownership before abort callbacks, reject pending promises with MODEL_LOAD_CANCELLED and close/dispose stale completions. FailedB preserves acceptedA. Removing one entity leaves registration intact. Partial native allocation/decode cleanup and readiness/context detachment have explicit owners. Focused registry execution passes; no additional ownership finding there.
- Restoration: context loss removes drawable resources while accepted CPU data/statusready persist, published representation becomes withheld, and pending registration waits. RestoreA and replacementB completion orders have distinct accepted/attempt identity gates. A failed restore remains bounded until explicit retry; source/style changes accepted during loss apply after native restoration. Completed promises are not reissued. Basemap reattachment retains usable context resources and scene choices. These conclusions are traced through viewport, scene, layer, registry and source publication. Browser restoration is root/historical evidence only.
- Hysteresis and temporary eligibility: no prior choice at2000 staysicon;1899 entersmodel;1900/2000/2100 retain choice;2101 returnsicon. Availability within theband does not enter; temporary terrain/renderer loss preserves prior modelchoice; missing heading, changed modelreference and unregister reset. Focused histories pass. Choices can be equal while publication differs because eligibility and visibility are separate. Same-frame opacity/preflight and native symbol layout stamps are traced, but fresh reviewer GPU frame execution is not claimed.
- Terrain, placement and update ownership: exact required probes are included in area equality and pending preparation sharing; equal radius/center with different required positions is not a duplicate. Release/reset/provider changes clear old owners before abort listeners can reintroduce current requests. Physical dimensions and attachment origins stay outside model display enlargement. Controlled planar contact, axis conventions and floor tests pass. The callback frame finding above is the remaining cross-owner violation found in this review.
- Labels/interactions: above-model native collision labels use current layout stamps to reject stale hit buckets. Model/attachment hits deduplicate by original feature/attachment identity; radial picker still uses original Icons/names and stable choice slots. Pointer hover refresh happens after draws and becomes idle without self-scheduling. Callback replacement uses interaction revisions/notified observers to avoid stale followups and repeated mutating callbacks. No independent source-level defect was found in these paths beyond mixed frame preparation. Actual pointer/keyboard, native layout and bounded quiet periods remain browser evidence owned by root.
- Measurement workflow and example: packed consumer installation avoids source aliases; separate seeded100models/1000icons, original/4x/16x/material and flat/genuine-globe/DPR cases retain raw provenance, counts and samples. Accepted update/frame timing attribution is immutable rather than observer-time state; CPU/GPU timings stay separate; zero/one samples remain unavailable/insufficient; queries are unique and bounded; transparent screenshot background is rejected. The prototype's comparison/instrumentation controls did not enter product flows. Approved dedicated private timing is disabled by default and not publicly exported. The public playground owns fetching, palettes, replacement/removal and fetch lifecycle. No additional scope creep found.

No other speculative concerns are reported as findings. Implementation coverage is broad, but review is not clean until the two reproduced defects are resolved and appropriately rechecked. Hardware/browser acceptance, measured guideline/advisory and production readiness remain intentionally pending #80/#91 by user direction. They are not missing implementation defects in this review. Parent#81 must remain untouched. The imported spec's dated initial status does not supersede current README/closeout status. Final combined closeout belongs to root after review fixes and pinned checks.
