# Entity models implementation closeout

Spec: [Approved entity models and representation switching](spec.md), imported unchanged from `21805ecb7543098f8c9820c476725654e20b31ec` on 2026-10-04.

Tracker: [Spec #81](https://github.com/the-Drunken-coder/Ridgeline/issues/81) and [integration #90](https://github.com/the-Drunken-coder/Ridgeline/issues/90).

Integration owner: root Codex coordinator, responsible for combined diff review, checks and revision-specific evidence.

Integration branch: `t3code/implement-spec-81`, based on main at `2733cee9fe9440237a36e90d9efa2fc4239b87c3`. The prototype remains unmerged.

## Ownership and sequence

The native tracker dependencies are authoritative. Start with #82 projection, then #83 registration and solid models. #84 materials, #85 placement and #86 switching follow. #87 picking follows #85/#86, #88 readable feedback follows #84/#86, and #89 recovery follows #86. #90 owns integrated consumer verification. #91 waits for #90 and hardware measurements in #80.

The coordinator assigns concrete file ownership before each delegated implementation. Workers use isolated branches based on the integration branch. No public exports are added solely for tests.

Approved test boundaries are the packaged public viewport workflow and focused parser, geometry and state interfaces named in the spec. Existing consumer checks guard projection extraction. Tests exercise observable behavior and failure paths.

## Verification record

Reviewed: `bb8780448423bf1dea524191b52ff6de62cb843a`...`d5f860c900dda3cb9c7f06c4a739aa7991f47a75`, shared registration, parser, solid renderer, scene integration and consumer checks reviewed by the integration owner on 2026-10-04. The integrated tree equals the reviewed worker tree at `53593a6b0608ae60f281831832527c11277fca3c` (tree `47a804cada3f855ee3cea52d16d148757aeaf8f5`). Earlier projection evidence is below. Materials, placement and switching are now in progress.

Local verification: at `d5f860c900dda3cb9c7f06c4a739aa7991f47a75`, `pnpm check` and `node --import tsx --test tests/model-glb.test.ts tests/models.test.ts tests/features.test.ts tests/entities.test.ts tests/entity-scene.test.ts` passed (52 tests). At `7bcb9b7`, with the same runtime source, full `pnpm test:browser` passed all 159 cases in 10.1 minutes. This includes packaged build/install, consumer type checking and build, projection precision, registration, existing interactions, terrain, attachments and recovery. The [complete log](evidence/checks/registration-projection-browser.log) records the run on 2026-10-04. Evidence-only commit `57c6862` landed while that command ran and changed no files used by it. Historical broader checks and their revision limits are recorded below.

Hosted verification: unavailable, no PR authorized or created.

Remaining limits: implementation is in progress. Target hardware/browser measurements, the triangle/material guideline and production acceptance remain pending in #80 and #91. Software WebGL checks cannot satisfy those gates.

The user confirmed on 2026-10-04 that hardware testing should remain pending. T3 preview status and opening both reported no available desktop automation host. Local packaged Chromium checks use software WebGL; Apple M1 Pro, desktop discrete GPU, Safari/macOS and the target browser matrix have not been exercised.

## #82: shared projection

Status: resolved for the scoped implementation and local checks. Integrated at `180bebbc694433a7501d2b1fe77e4c330c08b7d4`. This does not establish production acceptance.

| Acceptance criterion | Evidence |
| --- | --- |
| One projection path for drawing, picking, transition and world copy | `src/entity-projection.ts` snapshots the frame and owns shader/CPU projection and clipping. `src/entity-layer.ts` delegates to it. No public exports or second feature registry were added. Combined diff reviewed by the integration owner. |
| Meter-scale packaged regressions at zoom 18, 19 and 20, date line and world copies | Packaged browser precision cases cover flat/globe, a 6 m airborne marker and 3 m attachment, three longitude/world-copy cases, both insertion orders, real clicks and retained selection. |
| Up direction, exaggeration, occlusion and near-plane behavior | Focused projection tests and existing packaged terrain, clipping and attachment cases passed. New screen-position checks use an independent double-precision geographic/matrix reference with 1 CSS pixel tolerance. Transition checks cover zoom 11 through 12 and require an intermediate blend. |
| Existing interactions, recovery and idle rendering | Packaged suite covers selection, attachments and lifecycle recovery. Each new flat/globe precision case observes five seconds with no unsolicited render events after readiness. |
| Type, focused and packaged checks with recorded revisions | Root checks above passed at the integration revision. Packaged run details below identify the earlier full run and the later affected checks separately. |

Historical check evidence, all collected on 2026-10-04:

- `50fa3f365775b301d97194bc6393e1cf81aa8cbc`: full `pnpm test:browser` passed, 156 cases in 8.9 minutes. This precedes the final native-depth compatibility change.
- `dc99a16abcf674c9c1bbd515218c9b4013ec0612`: `pnpm check` and 31 focused tests passed. The 22 affected packaged cases produced 21 passes and one failure where the new test clicked the first visible edge pixel of a near-surface marker.
- `0f24d275099b83c999e3afa949f638959e589f16`: only the test click position changed to the visible pixel nearest its independent geographic anchor. The corrected globe precision case passed in 24.2 seconds. Production code equals `dc99a16abcf674c9c1bbd515218c9b4013ec0612`.
- `180bebbc694433a7501d2b1fe77e4c330c08b7d4`: integration tree equals `0f24d275099b83c999e3afa949f638959e589f16`; root type checking and 31 focused tests passed. Diff whitespace check passed.

The precision tests exposed an approximately 8 CSS pixel offset in the existing globe projection under software WebGL. The shared shader now computes spherical offsets from a CPU-precomputed local basis while retaining MapLibre's normalized depth, preserving visibility against its native globe depth mesh. It adds no arbitrary height or depth bias. The extra shader work remains unmeasured on target hardware.

Observed approximation limit: a visible outer edge pixel of a 6 m screen-facing marker near the date line at globe zoom 11 can be rejected by sampled-terrain CPU picking; its nearest visible anchor pixel passes. Exact baseline picking of that edge was not reproduced, so this is not claimed to be pre-existing. The existing approximate terrain-picking contract remains the limit of this verification.

## #83: registration and solid models

Status: resolved for the scoped solid-model path. Integrated at `d5f860c900dda3cb9c7f06c4a739aa7991f47a75`. The parser and core workers had separate file ownership; the coordinator supplied shared browser wiring and reviewed their combined behavior.

| Acceptance criterion | Evidence |
| --- | --- |
| Public contracts, snapshots and atomic validation | `types.ts`, `model-settings.ts`, registry and viewport integration implement registration/removal, entity references/orientation and settings. Focused and packaged tests mutate supplied bytes/settings/state snapshots and reject invalid registrations/effective configurations without changing accepted state. |
| Pure static GLB parser | `model-glb.ts` validates consumed static geometry, transforms, buffers, supported accessor semantics, node ownership and material metadata. Eighteen parser cases cover quantization, tiny scales, mirrored transforms, finite upload arrays, malformed containers, named subset rejection and copied images. All four sample GLBs also parsed at `9a88db97392fdedfc5e5aba92d54915ac275c3ee`. |
| Shared solid rendering and projection | The instanced model layer sits directly below entity attachments and uses shared EntityProjection. Packaged tests observe each of two spatially separate instances, retain the second after removing the first and exercise the explicit zero-floor near path. A single-sided asymmetric upward face proves correct axis handedness and culling. |
| Readiness and atomic installation | Registry tests exercise registration before renderer readiness, readiness failure with each model's context, successful upload before resolution and retained old resources on failed replacement. Viewport readiness does not wait for registrations. |
| Copied model status and missing-heading fallback | Public cases observe loading/ready/failed/unavailable and replacementPending, mutate detached status reads and verify missing-heading diagnostics with icon fallback. Final frame-publication semantics remain assigned to #86. |
| Newest revision, removal and shared lifetime | Focused tests verify only the newest queued revision uploads. Public tests verify failed replacement retains pixels, unregister retains feature/selection, unknown unregister is harmless and removing one entity leaves another drawn. |
| Cancellation, partial cleanup and callbacks | Focused tests remove during upload and cancel on destruction. Packaged tests cancel from entitychange, destroy from an error callback and inject a real WebGL buffer allocation failure, checking buffer/VAO cleanup and the retained working model. Intentional cancellation has no asset-failure diagnostic. |
| Existing diagnostic channels and isolation | Errors include model ID/operation and retained cause; logging keys include the resource. Public failure cases retain the working model and unrelated accepted data. No triangle advisory was added. |
| Public workflow tests and documentation | README documents the delivered solid path and explicitly identifies later slices. Three packaged cases, 52 focused checks and root type/ticket checks pass on the source/integration revisions above. |

Historical checks, collected on 2026-10-04: before the final renderer extraction and axis correction, the uncommitted core checkout passed `pnpm check`, 291 root tests and 5 control tests. Its exact checkout revision is not attributed to the final commit. After extraction and correction, focused and packaged checks passed; a final packaged recheck at committed `53593a6b0608ae60f281831832527c11277fca3c` passed all three cases in 5.1 seconds. The merger and root confirmed the same tree at `d5f860c900dda3cb9c7f06c4a739aa7991f47a75`, clean status and whitespace checks.

The asymmetric rendering test failed with the original reflected axis mapping, despite the cube tests passing. The corrected rotation sends authored +X west, +Y up and +Z north and preserves CCW outward faces. Complete heading-offset/pitch/roll composition and slope contact are assigned to #85.

Parser limits: this is the approved static subset, not a full glTF schema validator. Ignored animation/camera/light internals and unused extension payloads are not validated. Image bytes are copied here; actual PNG/JPEG decoding and material completion belong to #84. Context rebuild, exact frame switching, model picking, readable feedback and final consumer/performance tooling are still pending. The parent spec remains open.

## Next implementation ownership

- #84 materials: `models.ts`, `model-renderer.ts`, parser/material details and material-specific tests. GPU frame preparation finishes uploads before returning a draw plan.
- #85 placement: pure placement geometry, shared projection helpers, elevation preparation and placement tests. Enlarged-size acceptance depends on #86 integration.
- #86 switching: ModelLayer, EntityScene, viewport/frame coordination and switching tests; integrates the placement worker's interface. It does not edit the registry or GPU renderer.
- Root: shared browser harness, README integration, merged diff review, exact-revision verification and this closeout record.
