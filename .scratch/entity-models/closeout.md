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

Reviewed: `47750f2ebc36669c88e5376896782ac51de457e9`...`180bebbc694433a7501d2b1fe77e4c330c08b7d4`, shared projection implementation reviewed by the integration owner on 2026-10-04. The integrated tree equals the reviewed worker tree at `0f24d275099b83c999e3afa949f638959e589f16` (tree `4d7a67c840f503cbc5d78c5f69fc0add3d64343c`). Registration and later slices are still in progress.

Local verification: at `180bebbc694433a7501d2b1fe77e4c330c08b7d4`, `pnpm check` and `node --import tsx --test tests/entity-projection.test.ts tests/entity-layer.test.ts tests/entities.test.ts tests/entity-scene.test.ts` passed (31 focused tests). Historical packaged browser evidence and its revision limits are recorded below.

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

Status: in progress. The parser worker owns `src/model-glb.ts`, `tests/model-glb.test.ts` and `tests/model-fixtures.ts`. The core worker owns model resources/rendering, viewport/scene/API integration, registration browser cases and relevant documentation. The coordinator supplied the browser harness wiring in the core worktree and remains the owner of combined verification. Worker evidence is not yet integrated acceptance.
