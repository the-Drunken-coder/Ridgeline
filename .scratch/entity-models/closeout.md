# Entity models implementation closeout

Spec: [Approved entity models and representation switching](spec.md), imported unchanged from `21805ecb7543098f8c9820c476725654e20b31ec` on 2026-10-04.

Tracker: [Spec #81](https://github.com/the-Drunken-coder/Ridgeline/issues/81) and [integration #90](https://github.com/the-Drunken-coder/Ridgeline/issues/90).

Integration owner: root Codex coordinator, responsible for combined diff review, checks and revision-specific evidence.

Integration branch: `t3code/implement-spec-81`, based on main at `2733cee9fe9440237a36e90d9efa2fc4239b87c3`. The prototype remains unmerged.

## Ownership and sequence

The native tracker dependencies are authoritative. Start with #82 projection, then #83 registration and solid models. #84 materials, #85 placement and #86 switching follow. #87 picking follows #85/#86, #88 readable feedback follows #84/#86, and #89 recovery follows #86. #90 owns integrated consumer verification. #91 waits for #90 and hardware measurements in #80.

The coordinator assigns concrete file ownership before each delegated implementation. Workers use isolated branches based on the integration branch. No public exports are added solely for tests.

Approved test boundaries are the packaged public viewport workflow and focused parser, geometry and state interfaces named in the spec. Existing consumer checks guard projection extraction. Tests exercise observable behavior and failure paths.

## Current integration closeout, 2026-10-05

Status: implementation complete and locally verified for #82–#90. Production acceptance remains pending in #80/#91 at the user's direction. Parent #81 is unchanged. No PR, push or merge to main was requested or performed.

Reviewed: base `2733cee9fe9440237a36e90d9efa2fc4239b87c3` through final worker `cf09290e615dfc4809b09519fdfb0825c4642ba9`. The designated merger integrated that delivery at `708988d1253863412f73915a650b610518ddb9fc`; both independently verified the exact full tree `70a7b68e0c0ac2899ba39213265050b64baac637`. Source tree is `04413b0db510cc12b4794ea53f98cf331003ac53`; test tree is `d7fddd93adccfae4cdb4aa07a5b4dbacf31e7981`.

Both independent review axes report zero remaining confirmed findings. Standards executed 95 focused checks; Spec executed 86. Root reviewed the combined correction and existing layer/resource owners: frame revision and configuration are captured before callback-producing preparation; only current enlarged boxes intersecting the viewport are submitted; logical model choice and hysteresis survive culling; old DOM retires before destroy listeners remount; native rendering resources retire once the outer render returns. [Final axis reports, actual failures, saved RED deltas and clean worker checks](evidence/review-corrections/README.md) distinguish review evidence from check evidence. The optional earlier shader-consolidation suggestion remains nonblocking: model bodies and feedback keep their separate resource lifecycles.

Local verification: all commands below exercised exact clean `708988d1253863412f73915a650b610518ddb9fc`. Root is the sole integration-verification owner. No uncommitted source, test or documentation changes were included in those runs. [Revision/result record](evidence/integration/review-corrected-verification.json).

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm check` | Ticket/type/control type checks pass | [Log](evidence/integration/review-corrected-integrated-check.log) |
| `pnpm test` | 329 root and 5 control tests pass | [Log](evidence/integration/review-corrected-integrated-unit.log) |
| `pnpm test:browser` | 185 cases pass in 11.5 minutes; library build/pack and separate consumer install/typecheck/build pass | [Log](evidence/integration/review-corrected-integrated-browser.log) |
| `pnpm test:playground:browser` | 5 actual-input workflows pass in 6.6 minutes; package/playground production builds pass | [Log](evidence/integration/review-corrected-integrated-playground.log) |
| `pnpm test:measurement` | 6 tooling tests and 1 actual packaged ownership probe pass | [Log](evidence/integration/review-corrected-integrated-measurement.log), [raw probe](evidence/integration/review-corrected-measurement-verification.json) |
| Four direct `node scripts/measure-models.mjs --smoke --case <case-id>` runs | 8 complete off/on reports pass visibility/diagnostic/selection validation and five-second zero-render idle; incomplete initial command retained | [Raw reports, PNGs, settings and limitations](evidence/integration-smoke/README.md) |
| `pnpm test:controls:browser` | 5 workflows and control production build pass in 7.5 seconds | [Log](evidence/integration/review-corrected-integrated-controls.log) |
| `pnpm measure` and isolated-entry build | Library ESM 281,990 raw/79,426 gzip bytes; net increase 76,537/21,022 bytes. Parser 16,355/5,256; renderer 25,656/8,653 | [Build/bundle output](evidence/integration/review-corrected-integrated-bundle-size.log), [bundle data](evidence/integration/review-corrected-bundle-size.json), [entry data](evidence/integration/review-corrected-module-size.json) |

The measurement scenes separately observe 100 model states, 100 submitted instances/clipped boxes, 100 foreground regions and 1000 rendered native IDs. The icon baseline observes 1100 rendered native IDs and zero model states; its 100 foreground regions are icons. Genuine globe is vertical-perspective, with 1280×720 CSS canvas, 2560×1440 physical canvas, map pixel ratio 2 and actual browser DPR 1. All warm-segment GPU distributions are unavailable with zero samples, despite some unique raw completed queries. Superseded native updates, missed cadence, slow frame intervals and latency gaps remain in raw data. No hardware budget or measured guideline is inferred.

[Current public example image](evidence/integration/integrated-example-ui.png) was captured at the same clean runtime using the production playground and public calls. [Settings/provenance](evidence/integration/integrated-example-gallery.json) identify 1440×900 browser viewport, 1188×817 CSS/physical canvas at DPR 1, fixed flat camera, terrain and selected custom drone. Root inspected the eight labeled entities and physical attachments. This screenshot corroborates appearance; the actual-input suite establishes behavior and idle assertions.

Post-review changes: root reviewed the lifecycle README clarification, current performance table and evidence/closeout changes after the runtime checks. These changes affect documentation and dated evidence only; source and test trees remain identical. Runtime results are attributed to 708988d, not to a later documentation commit. Relative links and the nonraw combined diff pass before committing; one historical Markdown handoff received only an extra-EOF-blank-line cleanup. Raw command logs and saved patches are preserved exactly, including terminal whitespace. The canonical approved spec remains unchanged from 21805ecb; the prototype is not an ancestor of the integration branch.

Hosted verification: unavailable because no PR was authorized or created. This is locally verified implementation, not merge readiness or production acceptance. T3 preview status/open reported no desktop automation host; standalone packaged Chromium 153.0.8010.12 uses ANGLE SwiftShader. No M1 Pro, desktop discrete GPU, installed target Chrome/Firefox/Edge or native Safari measurement is claimed.

All 16 owned implementation/review checkouts were audited clean and removed without force after their agents completed. Branch refs and user/prototype worktrees remain. Two retained branch tips contain only redundant merges of already integrated parents, with empty remerge diffs. [Cleanup audit](evidence/integration/final-owned-worktree-audit.json).

## Historical verification record

Historical independent review before corrections, 2026-10-05: Standards and Spec reviewed clean `2733cee9fe9440237a36e90d9efa2fc4239b87c3`...`1e4c2c589902ecf9c6509acff725d31912d90de7`, source tree `b948ba66a835753b8e63c22d161a2e31686a2893`. Both axes reproduced callback replacement mixing a newer feature with old placement/style for one frame, including false latest-update measurement attribution. Spec also reproduced missing CPU off-screen culling. At that point one implementer was assigned both corrections in an isolated worktree; review was not yet clean. [Independent reports and distinguishing probes](evidence/final-review/README.md).

Historical local checks before those corrections, 2026-10-05: at exact clean `1e4c2c589902ecf9c6509acff725d31912d90de7`, `pnpm check` and the complete `pnpm test:browser` pass, with all 182 cases in 12.1 minutes. The browser command builds and packs the production library, then installs, typechecks and builds the separate consumer. These results cover the integrated example and measurement source, but do not verify the review fixes. [Type/ticket/control checks](evidence/integration/final-integrated-check.log), [complete packaged-browser run](evidence/integration/final-integrated-browser.log).

The separate control lab also passes all five browser workflows and its production build in 8.2 seconds at `1e4c2c5`. Documentation/evidence archival changed during that run; no source or test inputs changed. [Control-lab browser/build log](evidence/integration/final-integrated-controls-browser.log).

At clean `6b8ae2ebdaad8d3fd144d28b5d813424980e1497`, with the same source tree, `pnpm check`, `pnpm test` with 328 root and 5 control tests, six pure measurement-tool tests, and `pnpm build` pass. [Checks](evidence/integration/integrated-measurement-check.log), [unit suite](evidence/integration/integrated-measurement-unit.log), [tooling](evidence/integration/integrated-measurement-tooling.log), [build](evidence/integration/integrated-measurement-build.log). The production size measurement is dated and revision-pinned in [performance documentation](../../docs/performance.md).

The public example delivery `15c928ce6ebb5c80144c2b10f7910b95948811c8` is integrated at `1e4c2c5`; both have tree `0aeebafc1c026d56dcd207eb953021d54fdd6dd9`. [Historical example evidence](evidence/example/README.md) retains its five passing public workflows, the operation-revision fix, image/settings, failed-run diagnosis and explicit diagnostic-only source delta. The [historical packaged measurement workflow and smoke evidence](evidence/measurement/README.md) distinguish software observations from target hardware acceptance. Those historical deliveries predate the final integrated verification recorded above.

Historical corrective review, 2026-10-05: the integration owner reviewed `13bab3f25165b279499dcf74c1a5a97ad18f126f`...`ec93de9baa3efede363b3ced60b2d1ef126c1a11`. Runtime `7bfb02484a6dee6a22f1866fff0cbec088f34e4a` restores synchronous hover refresh when removing the hovered feature and avoids marking unchanged ground geometry dirty when camera coverage publishes. The final test-only change waits for native map idle before measuring the existing five-second quiet period. The combined runtime and affected test changes are reviewed; no uncommitted changes were exercised.

Historical corrective local verification, 2026-10-05: `pnpm check` and `pnpm test` pass at runtime `7bfb024`, with 324 root tests and 5 control tests. At clean `ec93de9`, the packaged consumer builds, installs, typechecks and builds successfully, then all four affected browser cases pass in 28.3 seconds: synchronous removal/cursor reset, unchanged ground publication, consumer-prerender cancellation/removal and stationary hover with five seconds of no renders or hover events. [Type checks](evidence/interaction-recovery/frontier-regression-fix-check.log), [unit checks](evidence/interaction-recovery/frontier-regression-fix-unit.log), [final affected browser checks](evidence/interaction-recovery/frontier-regression-final-browser.log).

An intermediate four-case run passed both original regressions and consumer-prerender recovery, but its hover case saw one settling render after a fixed 500 ms delay. That case passed twice in isolation on the same runtime. Waiting for the actual native idle event removes the arbitrary readiness assumption while preserving all five-second quiet assertions. [Intermediate run](evidence/interaction-recovery/frontier-regression-fix-browser.log), [isolated repeats](evidence/interaction-recovery/frontier-hover-settle-repeat.log). At that stage the complete suite had not been repeated; the final 185-case integrated run above supersedes that gap. The historical 180/182 result is preserved below.

Historical review, 2026-10-04: `8c8278c4107fa650b59ca86d7c1798399b850839`...`13bab3f25165b279499dcf74c1a5a97ad18f126f`, integration owner reviewed the combined picking, presentation, native label caching, callback histories, registry/layer recovery and viewport changes. Tree `53450402676a2d3c290d73adea22526fca825fad` exactly matches final worker `a177ef470dd3426e70b5edad6f4f4cd705fa9e0f`. The final delta from reviewed runtime `2ea02ce` was documentation and stronger unrelated-content assertions, also reviewed. No uncommitted runtime/test changes were included.

Historical local verification, 2026-10-04: `pnpm check` and `pnpm test` pass at `13bab3f`, with 324 root tests and 5 control tests. Full `pnpm test:browser` finished with 180 passes and two failures in 15.4 minutes at that exact runtime/test revision. Both failures reproduced twice against the same installed package: removal no longer cleared the hover cursor synchronously, and camera GPU publication resubmitted unchanged ground geometry. The corrections and final affected checks are recorded above. [Full run](evidence/interaction-recovery/integrated-interaction-browser.log), [repeated failures](evidence/interaction-recovery/frontier-regressions-repeated.log). Worker coverage passes all 26 model workflows on identical source, with the final changed test re-exercised on `a177ef4`. [Type checks](evidence/interaction-recovery/integrated-interaction-check.log), [unit checks](evidence/interaction-recovery/integrated-interaction-unit.log), [25 model-named workflows](evidence/interaction-recovery/frontier-combined-browser.log), [final changed case and PNG/JPEG workflow](evidence/interaction-recovery/frontier-final-affected-browser.log).

Historical review: `525ed1d8283014c98d12c3c9f7b8c0a26bf1bcc4`...`647458e6f7d4ff3b86a72d6fb86f474457dbf4be`, placement, terrain ownership, scene coordination, same-frame switching and public workflows reviewed by the integration owner on 2026-10-04. The integration tree equals reviewed worker `882b15c72e67a9cbcab24b433f4b78e93f1e4f82` (tree `263f92a429ad301684cf03ef4898dadd2b76eb11`). The final callback fix at `f14db3d` and subsequent test-only visible-icon baseline change at `882b15c` were reviewed separately. Earlier review evidence is preserved below.

Local verification: `pnpm check`, full `pnpm test` (311 root tests and 5 control tests), and full `pnpm test:browser` (170 cases, 11.6 minutes) pass at `647458e6f7d4ff3b86a72d6fb86f474457dbf4be` on 2026-10-04. The browser command also built/packed the library and installed, type-checked and built the separate consumer. README and evidence edits made during the run changed no runtime or test inputs. [Type checks](evidence/placement-switching/integrated-placement-switching-check.log), [unit checks](evidence/placement-switching/integrated-placement-switching-unit.log), [full packaged-browser log](evidence/placement-switching/integrated-placement-switching-browser.log).

Later test maintenance: the switching upload-failure fixture now captures the actual model instance buffer at the custom-layer render boundary and injects only its ARRAY_BUFFER upload, independent of renderer stride. Type checks pass at `47a6186d7db20442d815d59c7274b68490c6e899`; the final packaged fault/callback case passes at `71fe49b5eb57de27a0b0df5bb98c7d210a55651f` (2.4 seconds). Production source remains identical to `647458e`. Two intermediate fixture attempts intercepted a native uniform-buffer upload and timed out; restricting the buffer target corrected the test. [Type log](evidence/placement-switching/instance-upload-model-scope-check.log), [final browser log](evidence/placement-switching/instance-upload-target-browser.log).

Historical material verification: at `cf7d4bb89448776a1d0c599413d36588716942c1`, root type/ticket checks and 55 focused tests passed. Seven affected packaged model cases passed on material implementation `05aa922`; the final appearance-precedence addition passed at `c40d78b`. Runtime source was identical across those material revisions.

Historical full regression: at `7bcb9b7`, runtime source `d5f860c900dda3cb9c7f06c4a739aa7991f47a75`, full `pnpm test:browser` passed all 159 cases in 10.1 minutes on 2026-10-04. This included packaged build/install, consumer type checking/build, projection precision, registration, existing interactions, terrain, attachments and recovery. [Complete log](evidence/checks/registration-projection-browser.log). Evidence-only commit `57c6862` landed while that command ran and changed no inputs. This full run predates material completion; current affected checks are recorded above.

Hosted verification: unavailable, no PR authorized or created.

Remaining limits: implementation and local verification of #82–#90 are complete. Apple M1 Pro, desktop discrete-GPU and target-browser measurements, the measured triangle/material guideline, its too-heavy advisory, and production acceptance remain pending in #80/#91. Software WebGL checks cannot satisfy those gates. No PR or hosted verification exists.

The user confirmed on 2026-10-04 that hardware testing should remain pending. T3 preview status and opening both reported no available desktop automation host. Local packaged Chromium checks use software WebGL; Apple M1 Pro, desktop discrete GPU, Safari/macOS and the target browser matrix have not been exercised.

The slice records below retain their original scoped delivery revisions. Final integrated corrections and verification above supersede their historical pending follow-up notes.

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

## #84: materials and independent appearance

Status: resolved for the scoped material implementation and local checks. Integrated at `cf7d4bb89448776a1d0c599413d36588716942c1`; source and merge trees match exactly. The coordinator reviewed the final five-line appearance test addition separately from the runtime diff.

| Acceptance criterion | Evidence |
| --- | --- |
| Approved material subset and named rejection | Existing parser metadata supplies UV0, vertex RGBA, texture transforms, PNG/JPEG, factors, alpha modes/cutoff, double-sided, emissive and unlit materials. Eighteen parser tests preserve the static subset and rejection rules. The parser was unchanged by this slice. |
| Appearance precedence and RGB replacement | Public pixel cases exercise per-entity color/original, registered color inheritance, magenta fallback, original restoration, CSS rgba/named colors and independent updates of shared instances. Imported texture/base/vertex/emissive RGB is replaced; source alpha and lighting remain. |
| Alpha, lighting, shared resources and ordered passes | Actual PNG/JPEG decode, multiplied alpha, two cutoffs, blended pixels, back-face culling/double-sidedness, unlit and emission have pixel assertions. One image uploads once with independent repeat/clamp samplers and UV transforms. Opaque geometry draws before translucent surfaces. |
| Atomic installation and failure cleanup | Real decode of one valid image followed by a malformed image and partial sampler allocation both retain previous pixels and release new resources. Registration resolves after complete upload. |
| Current revision and callback cancellation | Held delivery of native decoded bitmaps exercises superseding registration, unregister, entitychange cancellation and destruction. Cancellation rejects before late delivery, closes abandoned bitmaps and emits no asset-failure diagnostic. Native texture allocation reentrancy releases its newly returned handle. Focused tests cover detaching/replacing the renderer during an asynchronous attempt. |
| Tests and delivered documentation | Root type/ticket/control checks and 55 focused tests pass at the integrated revision. Seven affected packaged workflows and the final appearance-precedence case pass on the source revisions above. README documents the subset, precedence, alpha semantics, cancellation and unsorted translucency. |

Additional reviewed fixes: exported model defaults are readonly and frozen; explicitly undefined optional overrides inherit accepted defaults. Both have focused behavior checks.

Artifacts: [seven-case browser log](evidence/materials/material-browser-all.log), [final precedence check](evidence/materials/material-browser-precedence.log), [shared assigned/original appearance](evidence/materials/material-shared-original-assigned.png), [alpha mask](evidence/materials/material-alpha-mask.png), [alpha blend](evidence/materials/material-alpha-blend.png). Screenshots were captured from the real passing browser canvas at 640 x 360, DPR 1, on the runtime/test content committed as `05aa922`. Root visually checked the shared appearance capture. Browser: Chromium 153.0.8010.12 on Linux with ANGLE SwiftShader, 2026-10-04.

Limits: fixed entity-local directional lighting is intentional. Translucency has no depth writes and is unsorted; overlapping translucent geometry may composite in draw order. Same-frame switching, model picking/highlight and context restoration remain their later slices. Software WebGL establishes no target-browser hardware or performance acceptance.

## #85: rigid placement and terrain preparation

Status: resolved locally. The final physical-attachment and actual partial near-plane gaps are covered by combined #87/#88 workflows at `13bab3f25165b279499dcf74c1a5a97ad18f126f`. Both shared regressions found by the broader suite are corrected and the four affected cases pass at `ec93de9`. The #86 acceptance dependency is implemented and locally verified.

| Acceptance criterion | Evidence or remaining gap |
| --- | --- |
| Heading, pitch, roll, authored offset and scale | Focused geometry checks and the public asymmetric axes case use independent geographic/matrix references. Authored offset applies before body rotation; missing airborne pitch/roll defaults to zero. |
| Rigid slope following, stable dimensions and exaggeration | Real/enlarged planar fixtures at DPR 1/2 and exaggeration 1/2 exercise displayed contact. Focused checks cover explicit pitch/roll with slope following disabled. |
| Unknown or invalid placement and automatic recovery | Public delayed exact-position preparation retains eligible fallback, recovers without pointer/entity updates, rejects below-terrain placement and handles changed providers. |
| Planar contact tolerances and uneven limits | A 768-case numerical sweep found clearance 0.0199999908–0.0200001875 m and maximum slope error 0.000001479 degrees. A public uneven-ridge observation visibly intersects the rigid model between support samples. |
| Physical attachments retain origins, dimensions and depth | Public ground-polygon pixel bounds remain within 0.5 CSS px while the body grows more than 1.5 x. Combined #88 checks now cover eligible ground marker invariance, independent ground-line endpoint, airborne volumes and sensor pixels outside legitimate body occlusion, without changing origins or dimensions. |
| Precision, globe transition, planet hiding and clipping | Independent checks cover 33 views across zoom 18–20, date-line/world copies and globe zoom 11–12, with at most one CSS pixel error and an actual intermediate projection blend. Front/back planetary visibility is exercised. Combined #87 now proves an actual box crosses the native near plane, retains visible model exterior pixels and accepts an actual pointer click there. Fully behind-plane models reject hits. |
| Delayed preparation, cancellation and current ownership | Real public abort callbacks reproduce and verify removal, reference replacement and same-ID reintroduction. Focused Elevation tests also cover partial batches, provider reset and unrelated requesters. Root independently reproduced and rechecked the overwritten-request failure. |

Artifacts: [placement handoff and historical revisions](evidence/placement-switching/placement-closeout.md), [768-case raw results](evidence/placement-switching/placement-geometry-verification.json), [planar view](evidence/placement-switching/placement-uneven-plane.png), [uneven ridge](evidence/placement-switching/placement-uneven-ridge.png), [observation settings](evidence/placement-switching/placement-uneven-observation.json).

The numerical sweep used production geometry at `f5f441c`; later changes affected coordination and cancellation, not that placement calculation. Public precision regressions passed at combined `f895069`. Scripts in this historical evidence directory retain their original temporary checkout paths and are not presented as the final portable measurement workflow. The browser was Chromium 153.0.8010.12 on Linux with ANGLE SwiftShader.

## #86: same-frame representation switching

Status: resolved locally. The later consumer-prerender history reproduced a blank frame and is fixed in the combined #89 layer. Both switching directions, removal/reintroduction, completed state and picks pass at `13bab3f25165b279499dcf74c1a5a97ad18f126f`. Both broader hover/geometry regressions are corrected; all four affected cases pass at `ec93de9`.

| Acceptance criterion | Evidence |
| --- | --- |
| Distance, thresholds, equality and inherited overrides | Focused choice histories and public camera/configuration sequences exercise both directions, exact equality, zero-width bands, loading inside the band and independent overrides. |
| Atomic validation and retained identity | Invalid combined configuration/entity updates preserve accepted settings, data and selection. Explicitly undefined optional overrides inherit defaults. |
| Projected-box floor and physical size | Public projected-box checks exercise 40 CSS px across zoom/pitch/bearing and physical-only zero floor; real dimensions can exceed the floor. Shared vertex/projection helpers also supply the upcoming picking path. |
| Same-frame icon/dot/model visibility | Frame-by-frame pixel XOR tests cover native registered symbols and airborne dots in flat, globe and intermediate views, discrete switches and continuous camera movement. The fixture proves the native icon is visible before starting each view's threshold sequence. |
| Temporary eligibility, availability and reset histories | Unknown terrain and injected renderer preflight/draw failures retain the choice while falling back; recovery restores it inside the band. Reference change, missing heading and unregister reset it. |
| Renderer publication and current snapshots | State publishes from completed model frames rather than anticipated geometry. Off-screen and planet-hidden model state remains distinct from unavailable placement. Representation events do not republish GeoJSON. |
| Callback invalidation and settled idle | Browser cases cancel from sampling, terrain abort, entitychange and error callbacks, including removal/reintroduction and viewport destruction. Source membership and pixels prove current data survives. The floor/recovery cases observe five quiet seconds. |
| Focused, type and packaged checks | Worker `882b15c` passed type checks and all four switching/floor cases. Runtime `f14db3d` passed 98 focused tests and 19 other model/publication cases; root full checks on the identical merged tree are recorded above. |

The real symbol test exposed stale native GL binding caches after model instance upload. The pinned MapLibre adapter now invalidates those bindings before preparing native opacity changes. The 20-instance public fixture also proves one shared solid-material draw rather than one draw per entity.

The abort tests exposed two ownership boundaries: Elevation recreated cancelled areas after a consumer abort callback, and EntityScene restored removed data or discarded a newly reintroduced ID. Elevation now invalidates obsolete operations and preserves current request identities. EntityScene installs the accepted batch before cancellation callbacks; viewport publication refreshes current store entries afterward. [Confirmed failing scene histories](evidence/placement-switching/switching-entity-abort-confirmed-red.log), [corrected public history](evidence/placement-switching/switching-abort-reentry-green.log), [final four-case check](evidence/placement-switching/switching-pinned-browser.log), [handoff](evidence/placement-switching/switching-implementation.md).

A historical 20-case run had 19 passes and one blank icon frame immediately after a large camera jump, before its symbol tiles were ready. The corrected fixture first establishes eligible native pixels, then still measures the very first switched frame. It passed three repeated runs before the final four-case check. [Historical run](evidence/placement-switching/switching-closeout-browser.log). Arbitrary partial native tile-upload failure or a model draw that fails after already submitting some primitives is not claimed to be transactional. Actual context rebuilding is implemented and exercised in #89 below.

## #87: picking and stationary hover

Status: resolved locally. Integrated at `13bab3f25165b279499dcf74c1a5a97ad18f126f`, with all 26 model workflows passing. The broader suite found a synchronous cursor-reset regression on removal. It is corrected and passes with the stationary-hover/callback history at `ec93de9`.

| Acceptance criterion | Evidence |
| --- | --- |
| Last-drawn boxes, tolerance, clipping and ordering | `model-picking.ts` clips box faces and interpolates hit depth. Scene installs only successfully drawn boxes and rejects obsolete feature identities. Actual native labels/icons precede model and airborne geometry, matching draw order. |
| Empty/cutout regions and terrain limits | Public pointer cases hit empty enlarged-box space, reject outside space, and prove a native 100 m terrain fixture hides both model pixels and CPU hits. Unknown/withheld placement creates no hit. |
| Original feature/attachment identity and interaction ownership | Public clicks return consumer IDs and actual attachment IDs. Interaction leases suppress selection; consumer handlers own accepted selection. |
| Radial choices, stable slots and keyboard behavior | Real registered icons/names, pointer clicks, Arrow/Enter/Escape, removal/reintroduction and representation changes are covered. Disposing picker content can destroy the viewport without a stale selection request. |
| Stationary hover and current callbacks | One pointer placement is followed by readiness, camera/entity motion, switching, unknown terrain/retry and unregister. Callback replacement resumes remaining observers with current data, while skipping the initiating mutator to avoid a render loop. |
| Near-plane/world copies and idle | Independent clip signs prove an actual model straddles the near plane; visible exterior pixels are clicked. Fully clipped models reject hits. Date-line/world-copy/globe pixels and actual clicks pass. Settled hover produces no renders/events for five seconds. |
| Focused and packaged checks | Three focused picking cases, the four public workflows and combined checks are revision-pinned in the [handoff](evidence/interaction-recovery/picking-implementation.md). |

Root reviewed the same-ID hover callback, stale feature identity, interaction disposal and last-drawn publication histories. Public reproductions found and fixed obsolete selection after disposal and repeated mutation loops. [Disposal failure](evidence/interaction-recovery/picking-callback-red.log), [disposal correction](evidence/interaction-recovery/picking-callback-green.log), [repeated mutation failure](evidence/interaction-recovery/picking-repeated-replace-red.log), [correction](evidence/interaction-recovery/picking-repeated-replace-green.log), [partial near-plane check](evidence/interaction-recovery/picking-near-crossing.log).

## #88: labels and static feedback

Status: resolved locally. Integrated at `13bab3f25165b279499dcf74c1a5a97ad18f126f`. Placement and actual-hover acceptance dependencies are implemented and locally verified. Both shared regressions found by the full suite are corrected; the affected checks pass at `ec93de9`.

| Acceptance criterion | Evidence |
| --- | --- |
| Readable collision-placed labels | Native glyphs clear the projected body and strongest ring while preserving existing fonts and collision suppression. A source/layout stamp hides old symbol buckets until the matching layout arrives; stale buckets also reject public hits. |
| Distinct rings/brightening at model altitude | Public preview, selection and actual hover verify thin/gentle versus thick/strong effects, selection precedence, airborne altitude and unchanged assigned appearance. |
| Arbitrary colors and imported materials | Custom CSS, magenta fallback, original textures, cutout, translucent and double-sided fixtures retain alpha shape and restore their exact appearance after feedback clears. GLB bytes stay unchanged. |
| Physical attachments and depth | Ground areas, volumes and sensors retain visible physical pixels outside the actual body's occlusion. Ground-line endpoint matches independent map projection; an eligible ground fallback marker is invariant under floor changes. Sensor apex occlusion by the enlarged opaque body is expected depth behavior. |
| Current publication and shared resources | Appearance/selection/preview changes use shared resources. Root reproduced remove/reintroduce with identical offset clearing native state but retaining a cached stamp; destination invalidation restores the label. Unlabeled camera changes no longer republish empty label layouts. |
| Public workflows and screenshots | Three packaged cases cover real/enlarged ground and airborne subjects. [Six-view settings](evidence/interaction-recovery/presentation-gallery.json), [custom ground](evidence/interaction-recovery/presentation-2.png), [magenta airborne](evidence/interaction-recovery/presentation-4.png), [original hover](evidence/interaction-recovery/presentation-5.png), [original selection](evidence/interaction-recovery/presentation-6.png). |
| Static idle and checks | After the finite queued source/publication work settles, five seconds produce zero render events. Worker type/focused/public checks and exact screenshot revision are in the [handoff](evidence/interaction-recovery/presentation-closeout.md). |

The public API has no separate airborne ground marker. This verification observes its real ground-line endpoint and the existing eligible ground fallback marker rather than inventing a new element. Screenshots were captured at clean `5f5b94d` on 2026-10-04, before later coordination fixes. Root inspected custom ground, magenta airborne and original-material airborne selection images. The checked-in Noto Sans glyph fixture has its own source and SIL OFL license. Historical gallery scripts retain temporary checkout paths and are evidence, not the portable #90 workload.

## #89: basemap and context recovery

Status: resolved locally. Integrated at `13bab3f25165b279499dcf74c1a5a97ad18f126f`. Solid/textured acceptance dependencies are implemented and locally verified. Both shared regressions found by the full suite are corrected; the affected checks, including consumer-prerender recovery, pass at `ec93de9`.

| Acceptance criterion | Evidence |
| --- | --- |
| Basemap retains resources and layer order | Real style replacements retain accepted registrations, image decodes and valid GPU handles. Reattached feedback layers reuse same-context resources. Model/attachment/label order and hysteresis remain current. |
| Real context loss and current restoration | `WEBGL_lose_context` withholds drawing, clears model/attachment hits and rebuilds current color/location/selection/attachments, including inside-band model choice. Basemap configuration accepted while lost is applied after the native painter returns. |
| Readiness and completed/pending promises | Accepted CPU data remains distinct from current drawable resources. Pending registration waits, latest replacement wins, completed promises stay completed, and failed native painter recreation rejects readiness rather than waiting forever. |
| Partial failure, fallback and unrelated content | Buffer, shader/program and texture allocation failures clean up owned handles. Public pixels prove eligible fallback, a ground attachment and an unrelated native point remain usable; explicit retry restores models. |
| Late completions and callback cancellation | Focused histories exercise accepted-asset rebuild versus pending replacement in both completion orders. Public decode/unregister/destroy cases close late images without stale installation. Cancellation is named and does not emit an asset-failure diagnostic. |
| Complete disposal and shared ownership | Registry clears accepted ownership before abort callbacks. Loss detaches drawable resources before callbacks; destroy clears entries before cancellation. Removing one entity retains its shared model. |
| Actual packaged recovery | Five workflows use real basemap replacement/context loss with PNG/JPEG and solid assets, pending replacements, input while lost and callbacks that destroy. Worker environment is [recorded](evidence/interaction-recovery/recovery-browser-environment.json). |
| Focused checks and quiet recovery | Seventeen registry ownership cases and combined model checks pass. Restored idle produces zero renders for five seconds. Exact pins/logs are in the [handoff](evidence/interaction-recovery/recovery-implementation.md). |

Root's adversarial review added a consumer custom-layer prerender that changes representation after preflight: it produced a blank frame. The layer now performs a bounded reprepare before drawing; both directions, last-entity removal and reintroduction verify completed pixels/state/picks. Another actual-loss history accepted a new basemap but restored the old one; deferred current-style application fixes it. [Blank-frame failure](evidence/interaction-recovery/recovery-prerender-red.log), [old-basemap failure](evidence/interaction-recovery/recovery-config-loss-confirmed-red.log), [26-workflow worker result](evidence/interaction-recovery/recovery-final-browser.log).

## #90 ownership

All helpers start from integration `13bab3f25165b279499dcf74c1a5a97ad18f126f` in separate worktrees. Root owns combined verification, README, shared browser harness, tracker closeout and evidence.

- Measurement implementer: private opt-in source timing boundaries, dedicated packaged consumer, measurement runner and command entries. No new public exports or product measurement controls.
- Fixture helper: offline real GLB geometry sweeps, fixture metadata and generator tests; consumer-side external-file repackaging proof.
- Playground helper: public-API example, existing playground integration, selected licensed assets and actual-input example tests.

Hardware #80 and measured limits/advisory/production acceptance #91 remain pending by the user's direction. No PR, push or hosted checks are authorized or claimed.

## #90 acceptance evidence

| Acceptance criterion | Result and evidence |
| --- | --- |
| Integration owner, approved import and selected implementation | Root owns combined verification; concrete files were assigned before isolated workers edited them. Approved spec imported unchanged from 21805ecb; production based on 2733cee9; prototype remains unmerged. Comparison controls and temporary prototype registry are omitted. |
| Public consumer example | `playground/model-example.ts` uses only the public API and consumer-owned fetch cancellation/palettes. Eight entities share four licensed registrations. The final five playground workflows cover custom/original appearance, hover/selection, switching, replace/unregister/remove/reset, labels and physical attachments. Current image/settings and dated [example handoff](evidence/example/README.md) retain appearance and sibling-fetch RED/GREEN evidence. |
| Public contracts and repackaging | [README](../../README.md) covers GLB subset, consumer repackaging, defaults/units, atomic validation, snapshots/status, cancellation/recovery, callback-safe disposal, box picking and uneven-terrain limits. Browser tests use real installed tarball declarations/assets. Hardware/browser/guideline claims stay pending. |
| Deterministic packaged workload | [Measurement guide](../../tools/model-measurement/README.md) and real offline GLB generator supply 100 models, 25 of each type, 1000 icons and 1100-icon baseline, 100 ms seeded updates, original/normalized/4x/16x geometry, material/appearance variants, flat/genuine globe and pixel ratio 1/2. Settings, actual visible IDs, hashes and captures are retained. Full 72-case hardware matrix remains #80. |
| Honest phase/sample measurements | Final packaged ownership probe and six tooling checks verify phase boundaries, current accepted-frame attribution, disabled/cleared instrumentation, native worker generations, opacity-hidden markers, nested accepted updates and alpha-aware pixels. Raw RAF/upsert/native/cold/warm/CPU/GPU records retain missing/coalesced outcomes. Unique GPU queries stay separate from overlapping CPU costs; empty/one-sample distributions remain unavailable/insufficient. |
| Approved observable transitions | 185 packaged cases cover actual decode/input, atomic invalid batches, delayed terrain, callbacks, same-frame switching, labels/attachments, precision/planar tolerances, real context loss/recovery and five quiet seconds. The three permanent final regressions prove first completed callback frames, enlarged-box culling/hysteresis and listener remount ownership. Playground/control workflows are checked separately. |
| Shared revision-specific review/evidence | Initial review findings and actual failing histories are retained as historical. One implementer corrected them; both independent axes rechecked final cf09290. Root reviewed the identical integrated 708988d and exercised the complete combined workflow. All raw settings/logs/patches distinguish exact clean pins from explicitly recorded temporary RED deltas. |
| Current checks/builds/production size | Current type/ticket/unit, packaged/browser, playground, measurement and control checks pass above, with library/playground/control production builds. [Performance snapshot](../../docs/performance.md) records net 20.53 KiB gzip and isolated entries with default Node gzip; historical prototype figures are not current. |
| Reviewed hardware handoff and readiness | The reviewed source708988d and portable workflow are handed to existing #80. Hardware #80 and measured guideline/advisory/production acceptance #91 remain open by user direction. Implementation/local verification are complete; hosted checks and production readiness are not claimed. Parent #81 remains unchanged. |

Observable transitions have one current owner: root reviews integrated slice changes; consumer update/native-worker and scene owners correlate accepted updates with visible frames; registry/scene/interaction/resource owners cancel obsolete callback work. Final real callback, cancellation, terrain, switching, recovery, stationary-pointer and destroy/remount workflows exercise these boundaries rather than inferring them from cached summaries.

## Hardware handoff

Keep [#80](https://github.com/the-Drunken-coder/Ridgeline/issues/80) and [#91](https://github.com/the-Drunken-coder/Ridgeline/issues/91) open. Reviewed production pin is 708988d, source tree 04413b0d. Exact full revisions appear above; the final closeout commit changes only documentation/evidence. No branch has been pushed.

Use `pnpm measure:models --hardware --browser chrome --metadata machine.json --matrix` on the agreed target machines. The 72-case matrix runs paired off/on with at least 10 seconds warmup and three 30-second stationary/moving observations per case. For installed Safari use `pnpm measure:models --serve` and the same built consumer's manual capture. Preserve raw JSON/PNGs/index, source/tarball/asset hashes, exact machine/OS/GPU/driver/browser/displayHz and actual canvas/projection/counts. Original/baseline 60 Hz targets remain acceptance criteria; 4x/16x workloads may fail while establishing cost bounds. Run current correctness workflows on required browsers too. Software Chromium and Playwright WebKit do not establish target-browser acceptance.

The measured triangle/material guideline and too-heavy advisory remain unset until #80 provides their policy evidence. #91 owns their implementation and production acceptance afterward. This handoff completes #90 implementation scope without satisfying hardware gates.
