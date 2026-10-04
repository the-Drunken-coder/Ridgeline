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

Reviewed: `525ed1d8283014c98d12c3c9f7b8c0a26bf1bcc4`...`647458e6f7d4ff3b86a72d6fb86f474457dbf4be`, placement, terrain ownership, scene coordination, same-frame switching and public workflows reviewed by the integration owner on 2026-10-04. The integration tree equals reviewed worker `882b15c72e67a9cbcab24b433f4b78e93f1e4f82` (tree `263f92a429ad301684cf03ef4898dadd2b76eb11`). The final callback fix at `f14db3d` and subsequent test-only visible-icon baseline change at `882b15c` were reviewed separately. Earlier review evidence is preserved below.

Local verification: `pnpm check`, full `pnpm test` (311 root tests and 5 control tests), and full `pnpm test:browser` (170 cases, 11.6 minutes) pass at `647458e6f7d4ff3b86a72d6fb86f474457dbf4be` on 2026-10-04. The browser command also built/packed the library and installed, type-checked and built the separate consumer. README and evidence edits made during the run changed no runtime or test inputs. [Type checks](evidence/placement-switching/integrated-placement-switching-check.log), [unit checks](evidence/placement-switching/integrated-placement-switching-unit.log), [full packaged-browser log](evidence/placement-switching/integrated-placement-switching-browser.log).

Historical material verification: at `cf7d4bb89448776a1d0c599413d36588716942c1`, root type/ticket checks and 55 focused tests passed. Seven affected packaged model cases passed on material implementation `05aa922`; the final appearance-precedence addition passed at `c40d78b`. Runtime source was identical across those material revisions.

Historical full regression: at `7bcb9b7`, runtime source `d5f860c900dda3cb9c7f06c4a739aa7991f47a75`, full `pnpm test:browser` passed all 159 cases in 10.1 minutes on 2026-10-04. This included packaged build/install, consumer type checking/build, projection precision, registration, existing interactions, terrain, attachments and recovery. [Complete log](evidence/checks/registration-projection-browser.log). Evidence-only commit `57c6862` landed while that command ran and changed no inputs. This full run predates material completion; current affected checks are recorded above.

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

Status: implementation integrated at `647458e6f7d4ff3b86a72d6fb86f474457dbf4be`. Acceptance remains open for the complete attachment and model near-plane checks below. Enlarged-size integration with #86 is implemented and exercised.

| Acceptance criterion | Evidence or remaining gap |
| --- | --- |
| Heading, pitch, roll, authored offset and scale | Focused geometry checks and the public asymmetric axes case use independent geographic/matrix references. Authored offset applies before body rotation; missing airborne pitch/roll defaults to zero. |
| Rigid slope following, stable dimensions and exaggeration | Real/enlarged planar fixtures at DPR 1/2 and exaggeration 1/2 exercise displayed contact. Focused checks cover explicit pitch/roll with slope following disabled. |
| Unknown or invalid placement and automatic recovery | Public delayed exact-position preparation retains eligible fallback, recovers without pointer/entity updates, rejects below-terrain placement and handles changed providers. |
| Planar contact tolerances and uneven limits | A 768-case numerical sweep found clearance 0.0199999908–0.0200001875 m and maximum slope error 0.000001479 degrees. A public uneven-ridge observation visibly intersects the rigid model between support samples. |
| Physical attachments retain origins, dimensions and depth | Public ground-polygon pixel bounds remain within 0.5 CSS px while the body grows more than 1.5x. Ground markers/lines, airborne volumes and sensor origins/depth still require combined #88 evidence. This criterion is not yet complete. |
| Precision, globe transition, planet hiding and clipping | Independent checks cover 33 views across zoom 18–20, date-line/world copies and globe zoom 11–12, with at most one CSS pixel error and an actual intermediate projection blend. Front/back planetary visibility is exercised. Shared near-plane clipping tests pass; a public model-specific near-plane crossing remains assigned to #87. |
| Delayed preparation, cancellation and current ownership | Real public abort callbacks reproduce and verify removal, reference replacement and same-ID reintroduction. Focused Elevation tests also cover partial batches, provider reset and unrelated requesters. Root independently reproduced and rechecked the overwritten-request failure. |

Artifacts: [placement handoff and historical revisions](evidence/placement-switching/placement-closeout.md), [768-case raw results](evidence/placement-switching/placement-geometry-verification.json), [planar view](evidence/placement-switching/placement-uneven-plane.png), [uneven ridge](evidence/placement-switching/placement-uneven-ridge.png), [observation settings](evidence/placement-switching/placement-uneven-observation.json).

The numerical sweep used production geometry at `f5f441c`; later changes affected coordination and cancellation, not that placement calculation. Public precision regressions passed at combined `f895069`. Scripts in this historical evidence directory retain their original temporary checkout paths and are not presented as the final portable measurement workflow. The browser was Chromium 153.0.8010.12 on Linux with ANGLE SwiftShader.

## #86: same-frame representation switching

Status: resolved for the scoped switching implementation and local acceptance. Integrated at `647458e6f7d4ff3b86a72d6fb86f474457dbf4be`; full integrated packaged regression passes. Later picking, presentation and context-recovery changes still require combined review and checks.

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

A historical 20-case run had 19 passes and one blank icon frame immediately after a large camera jump, before its symbol tiles were ready. The corrected fixture first establishes eligible native pixels, then still measures the very first switched frame. It passed three repeated runs before the final four-case check. [Historical run](evidence/placement-switching/switching-closeout-browser.log). Arbitrary partial native tile-upload failure or a model draw that fails after already submitting some primitives is not claimed to be transactional. Actual context rebuilding remains #89.

## Next implementation ownership

- #87 picking: EntityScene/viewport shared bridges, last-drawn box picking, event ordering, callback-safe stationary hover and real pointer/keyboard checks.
- #88 feedback: renderer brightening, static rings, label layout/readiness helpers and presentation/physical-attachment checks. #87 owns its scene/viewport bridge edits.
- #89 recovery: registry and ModelLayer lifecycle, retained resources and actual context-loss checks. #87 owns its scene/viewport bridge edits.
- Root: shared browser harness, README, merged diff review, exact-revision verification and this closeout record. New workers start from `647458e6f7d4ff3b86a72d6fb86f474457dbf4be` in separate worktrees; root browser port 5174 remains reserved.
