# Reliability repair closeout

## Empty model upload query, 2026-10-26

The narrow renderer repair skips the instance-upload error query when there are no upload groups. The [verification record and recordings](evidence/empty-model-query/README.md) preserve matched controlled failure/pass runs, native upload-error recovery, frame/context checks and independent review. It keeps initialization, current-frame publication and actual-upload error checks in their existing paths.

This is not a complete repair of [#123](https://github.com/the-Drunken-coder/Ridgeline/issues/123). An original globe/terrain case failed on the guarded runtime without the test-owned hold. Four subsequent observed histories passed all 20 cases but captured no failing timing window or additional cause. The failed input snapshot and trace remain retained, and #123 stays open. The controlled hold is not an organic GPU-duration measurement.

## Earlier western-globe readiness follow-up, 2026-10-26

[#123](https://github.com/the-Drunken-coder/Ridgeline/issues/123) remains open and unexplained. The [historical evidence](evidence/issue-123-history/README.md) preserves the original failure and selected hosted controls before the diagnostic artifact expires on November 8. Original producer bytes, metadata and hashes were verified through the existing evidence-promotion workflow.

The [current investigation](evidence/issue-123-investigation/README.md) records seven passing local focused executions, including two against the archived historical runtime. Every run retained real pointer input, ongoing live updates, the eight-second readiness condition and zero retries. These are passing controls, not proof that the historical failure is fixed. A synchronous renderer check during GPU work is a lead from passing traces; no causal production fix was accepted.

The user requested this follow-up while withdrawing the separate model hardware-acceptance matrix. That decision changes neither this failure's outcome nor the terrain, drawing and public API guarantees. Earlier closeout records below retain their original pins.

## Historical reliability-repair closeout, 2026-10-02

Status: resolved.
Spec: `.scratch/codebase-reliability-repairs/spec.md`, [canonical requirements](spec.md), [GitHub #54](https://github.com/the-Drunken-coder/Ridgeline/issues/54).
Integration: [GitHub #55](https://github.com/the-Drunken-coder/Ridgeline/issues/55), branch `t3code/implement-spec-54`.
Integration owner: coordinating Codex agent. Drawing, publication/content, entity/elevation, and consumer file ownership was assigned before parallel implementation. Each repair used a separate ticket worktree. A merger preserved the shared browser cases and their discovery order.
Date: 2026-10-02.

## PR integration, 2026-10-03

PR: [#68](https://github.com/the-Drunken-coder/Ridgeline/pull/68). Integration owner: coordinating Codex agent in the project-status thread. The owner merged current main `8ea95019ce1e25a91d75b42f2a563f12bc17f74e`, preserving its approved drawing callback policies alongside acquisition, bounded-coordinate, world-copy and insertion repairs. A retained packaged case verifies callback failure, stationary snapping recovery, visible world copies and unavailable terrain together.

Full `pnpm validate` passed on clean `91fc3ba1c71e77af76e2d03a184cd90109132eac`: type checks, 263 library/automation tests, five control state tests, 151 packaged cases with zero retries, one production playground journey, five control-lab browser cases and all production builds. This is a checkpoint before the additional R07 correction below.

Independent review then confirmed another R07 continuation defect. A tooltip disposer opened a context menu during a native overlapping-feature click; the obsolete click mounted a picker over it and left the menu orphaned after close. The retained packaged test failed with that exact ownership assertion at `eb49a8b`. Fix `0722921c2c922bc2d2e38912c16c73c1907fdfb9` checks the operation after tooltip disposal. All 15 packaged content, context-menu, tooltip and picker cases passed at that clean revision, including replacement focus, Escape cleanup and exactly-once disposal.

The integration owner reviewed the combined diff against main `8ea95019ce1e25a91d75b42f2a563f12bc17f74e`. Independent Standards and Spec review found no outstanding findings at `0722921c2c922bc2d2e38912c16c73c1907fdfb9`; the original review exercised 22 focused modules at `91fc3ba`, and the correction review exercised its isolated content-ownership probe at `0722921`. After the source correction, `pnpm check` and `pnpm test` passed at clean `0722921`: 263 library/automation tests and five control state tests. The packaged content run also rebuilt, packed, installed, type-checked and built the consumer. Broader browser and production-consumer execution remains the earlier `91fc3ba` checkpoint until hosted results are recorded.

The old PR reporting failure was independent of browser execution. Both unsharded suites uploaded `report.zip`; flattening those artifacts could overwrite one archive or combine incompatible ZIP metadata. Their archives now have distinct filenames. A real Playwright fixture verifies that both suite identities and their passing or failing results survive flattening and merging. Historical branch run `37057693969` passed its individual jobs and packaged completeness audit, but its combined report contained only five of the six expected archives. It does not prove combined report completeness.

PR checkpoint `fc1202fc0aa39b206be70ed7f3d12d81b6b095c0` passed every job in [run 37109037698](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37109037698), exercising merge checkout `ab46f1945028df73502993bec56bbf1ffcc856d2`. An independent artifact audit verified all six distinct archives and exact agreement between their test IDs, statuses and retry counts and the combined HTML: 152 packaged cases, one playground case and five control cases, all 158 passing with zero retries or omissions. Codex reviewed that head without major issues. CodeRabbit identified the additional handle-restoration defect below, so this green checkpoint alone does not establish final readiness.

The retained R08 native regression at `8f703278fc37671d1402ec59578043f97439c4a5` established a real handle drag, then rejected its movement through a reentrant snapping callback. Accepted and draft coordinates stayed unchanged while the handle jumped 512 pixels to another visible world copy. MapLibre's wrapping checks only one longitude turn before stopping at an onscreen copy; bounded restoration can therefore lose the third copy. Initial fix `26d69b2a9abe199542fe021bc910f46bede0ae23` retained each marker's displayed coordinate for both rejected and unavailable-ground restoration. Bounded positions remain authoritative for accepted data and translation.

At clean `26d69b2a9abe199542fe021bc910f46bede0ae23`, `pnpm check`, `pnpm test` and all 16 focused packaged drawing cases passed, with zero retries. That includes the retained native regression, date-line save/reload on flat and globe with terrain on and off, callback ownership, permission revocation, snap replacement and unavailable-ground restoration. The packaged run rebuilt, packed, installed, type-checked and built the consumer. The new wide-map case alone uses a 2000-pixel browser viewport; other cases keep their established viewport.

Independent review then identified that camera movement could wrap the live marker without updating the saved display coordinate. At clean test revision `97ce3963bf8472bab5a0e73461fb7738d3a5f673`, the retained native camera-turn and reversal case established that first rejected movement kept the draft unchanged but shifted its handle 512 pixels. Source correction `4c936f8537f73ce0ac56153580cfc4e2a6204293` removes the duplicated display cache. Both restoration paths choose the bounded draft position on the current live marker's world copy, preserving existing marker identity and draft epoch guards.

The integration owner reviewed the combined source through `4c936f8537f73ce0ac56153580cfc4e2a6204293` against main `8ea95019ce1e25a91d75b42f2a563f12bc17f74e`. Independent Standards and Spec recheck found no outstanding confirmed findings. Type and module checks passed on clean `4c936f8`: 263 library/automation tests and five control state tests. All 17 affected packaged drawing cases passed with zero retries at that source revision, including both retained world-copy histories and the existing permission, replacement, terrain and date-line cases. Browser runs rebuilt, packed, installed, type-checked and built the consumer. Only this closeout document was edited during browser execution; no runtime or test files changed. The documentation commit receives separate diff and local-link checks.

Current hosted verification, final reviewed and exercised revisions, and PR readiness are recorded in [integration issue #55](https://github.com/the-Drunken-coder/Ridgeline/issues/55). The historical records below remain pinned to their original revisions. Documentation after the runtime correction receives separate diff and link checks. Browser coverage remains desktop Chromium with software WebGL; no fresh macOS execution is claimed for this integration.

## Historical reviewed and exercised revisions, 2026-10-02

Review baseline: `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`.
Final reviewed revision: `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5...873f514e480c5e6ffddac1e08a88a9d78114b8ca`; integration owner reviewed the combined diff and independent Standards and Spec reviewers report no outstanding findings.
Final local verification revision: `873f514e480c5e6ffddac1e08a88a9d78114b8ca`, clean before and after execution; complete `pnpm validate` passed.
Hosted verification: branch and tested checkout `873f514e480c5e6ffddac1e08a88a9d78114b8ca`, [Validation run 37057693969](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37057693969), all required jobs passed. Checkout logs establish the tested SHA. No PR checkout or merge revision exists; no pull request was opened and no merge readiness is claimed.

Early integration at `fa4f8272a1a728f819be5d6950372788403b20bf` passed 155 focused module tests and 18 packaged callback, publication, content, entity, and retained lifecycle workflows. The owner reviewed the combined transitions before later deliveries. At `24ce12c32097d5d7cf12bc1b79cc571374ec584a`, the additional entity buffer and boundary-validation changes were reviewed and passed 20 focused tests and three packaged null-buffer, nonsimple-boundary, and date-line cases. These are historical checkpoints, not substitutes for the final checks below.

At `cb50c52508ee457b5193bc7bca0dd69c21791077`, complete local validation passed 230 library/automation tests, five control state tests, 139 packaged cases, one production playground journey, five control-lab browser cases, type checks and all affected builds. [Hosted run 37055183616](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37055183616) passed all jobs at the same checkout, including discovery/report verification of all 139 packaged cases across four shards. Independent Standards review passed, but Spec review demonstrated an additional R13 empty-space picking defect. These green runs are therefore historical checkpoint evidence. One implementation owner handled the resulting review correction.

## Acceptance evidence

Every original finding was independently reproduced on its relevant pre-repair implementation. The retained regressions below run through existing module interfaces or the installed-package consumer. Input guarantees use native mouse, keyboard, or wheel entry and dismissal; nested events are controlled only inside reentrant consumer callbacks.

| Repair | Ticket | Confirmed failure and retained regression |
| --- | --- | --- |
| R01 | [#56](https://github.com/the-Drunken-coder/Ridgeline/issues/56) | Initial permission callbacks replaced draft A with B; old vertex/style/Finish work mutated or submitted B. Session tests preserve B and its submit identity; packaged callback ownership case verifies real placement and Finish. |
| R02 | [#56](https://github.com/the-Drunken-coder/Ridgeline/issues/56) | Cancel/destroy during acquisition resurrected editing and retained the lease. Session and packaged acquisition/remount regressions verify immediate release, no resurrected draft, and usable remounting. |
| R03 | [#56](https://github.com/the-Drunken-coder/Ridgeline/issues/56) | Destruction, external conflict, or permission invalidation from pending observers still initiated submit. Session tests verify zero persistence calls and retain started-save abort/late-result protection. |
| R04 | [#57](https://github.com/the-Drunken-coder/Ridgeline/issues/57) | Styling replaced the basemap and obsolete restoration rejected readiness. Restoration module and packaged initial/later replacement cases verify current readiness, actual newer rendered geometry, and preserved selection. |
| R05 | [#57](https://github.com/the-Drunken-coder/Ridgeline/issues/57) | Icon styling overwrote a same-ID update and reintroduced an earlier ID removed by a later callback. Packaged icon cases verify accepted and rendered current geometry, removals, replacement scenes, and destruction. |
| R06 | [#57](https://github.com/the-Drunken-coder/Ridgeline/issues/57) | Retry during held publication scheduled no source reset. Module and packaged held-update cases verify current-data reset after settlement, removal preservation, replacement/destruction safety, and bounded work. |
| R07 | [#52](https://github.com/the-Drunken-coder/Ridgeline/issues/52) | Synchronous close reopened returned content; reentrant disposal stole focus or disposed replacement content. Six packaged cases verify close/destroy/factory replacement/disposer replacement/picker replacement, exact disposal, focus, and real Escape/pagination. Established tooltip and picker regressions remain. |
| R08 | [#58](https://github.com/the-Drunken-coder/Ridgeline/issues/58) | Cross-date-line placement stored longitude above 180, feedback projected another copy, and normalization changed exact snapped coordinates. Four packaged flat/globe and terrain on/off save/reload/edit workflows plus exact-coordinate module tests verify bounded storage and shape definitions, rendering, stationary feedback, and unavailable DEM behavior. A native low-zoom regression additionally confirmed candidate, ring, and placing-handle copy mismatches. |
| R09 | [#59](https://github.com/the-Drunken-coder/Ridgeline/issues/59) | Native ArrowRight moved freely despite an eligible vertex six pixels away. Two packaged keyboard cases verify exact snapping, Alt/disabled/filter bypass, pointer agreement, active/carried-shape exclusions, unavailable ground, focus, and undo. |
| R10 | [#60](https://github.com/the-Drunken-coder/Ridgeline/issues/60) | At latitude 60 degrees, the insertion invariant measured 0.008638447 Mercator world units off the edge; the native handle case also failed. Shape invariants and the packaged insertion case verify line/arrow/polygon, high-latitude and sloped date-line edges, polygon closure, flat/globe, real activation, original vertices unchanged, and insertion within one CSS pixel. Spherical measurement functions and saved schema remain unchanged; adding a sample may refine segment-based measurements. |
| R11 | [#61](https://github.com/the-Drunken-coder/Ridgeline/issues/61) | Required elevation failure retained ready camera coverage. Scene/coverage-owner tests and packaged sampling case verify unavailable state, removal of plain and terrain output, original cause, retained placement/unrelated attachments, stale completion rejection, current-data retry, and quiet work. Existing delay/style-retention cases pass. |
| R12 | [#62](https://github.com/the-Drunken-coder/Ridgeline/issues/62) | Repaired cached missing-data tiles were never fetched after retry. Raster tests and packaged raster case verify new fetch, current camera pixels and picking, healthy/zero cache retention, obsolete-request cancellation, and quiet recovery. |
| R13 | [#63](https://github.com/the-Drunken-coder/Ridgeline/issues/63) | A distant first entity made a nearby date-line entity invisible; globe CPU picking axes disagreed with the installed shader. Packaged date-line case verifies actual point/sphere pixels and real pointer hits in both insertion orders, camera sides, and projections, preserving coordinates and physical altitude. Independent final review also confirmed an empty center pixel selecting a distant sphere because CPU vertices chose different world copies. The retained seam regression verifies coherent rendering and picking on both sides of the date line. |
| R14 | [#64](https://github.com/the-Drunken-coder/Ridgeline/issues/64) | Null GPU allocation produced no diagnostic or recovery. Layer-owner and packaged allocation cases verify contextual failure, no idle allocation loop, explicit retry using current geometry, removed geometry absent, actual pixels/picking, and exact resource cleanup. Existing shader recovery passes. |
| R15 | [#65](https://github.com/the-Drunken-coder/Ridgeline/issues/65) | The real playground inspector selected Survey area while the sidebar remained empty. Production journey verifies initial applied selection, accepted drawing, real background clearing, action availability, scenario cycles, and teardown. The existing drawing layout is preserved. The new browser suite is part of local validation and the hosted aggregate gate. |
| R16 | [#66](https://github.com/the-Drunken-coder/Ridgeline/issues/66) | Real wheel input over a unit left zoom at 100%. Production control suite verifies pointer anchor and relative distance, control exclusions, armed-order retention, no unwanted trail, Escape, and existing navigation gestures. |
| R17 | [#67](https://github.com/the-Drunken-coder/Ridgeline/issues/67) | Mixed batches accepted overlapping boundaries and degenerate triangles. Feature tests and packaged nonsimple-boundary case reject overlap, double backs, and nonadjacent contacts atomically; accepted snapshots and rendered original geometry remain. Ordinary corners, straight continuations, concavity, and clockwise boundaries pass. |

Every row's regressions passed at the final reviewed and exercised revisions above. Earlier red/green implementation commits are historical evidence only. No new public exports, saved schema, renderer abstraction, or interface design was introduced. Public behavior clarifications are in [README.md](../../README.md).

## Historical final local checks, 2026-10-02

`pnpm validate` passed at exact `873f514`, including:

| Check | Result |
| --- | --- |
| Ticket metadata, root TypeScript and control-lab types | Passed |
| Library and validation-automation modules | 234 passed, zero failed/skipped |
| Control-lab state tests | 5 passed |
| Fresh packed installation, declarations and consumer build | Passed |
| Installed-package browser suite | 140 passed, zero retries |
| Real production playground selection journey | 1 passed |
| Production control-lab browser suite | 5 passed |
| Package, playground and control-lab production builds | Passed |

The hosted run independently passed the same jobs. It verified all 140 packaged cases executed exactly once across four shards and passed the aggregate `validate` gate. The required playground job participated in that gate. The combined report was uploaded, but the later archive-collision investigation above established that one unsharded suite was omitted from it.

The final evidence-only documentation commit follows runtime verification. It adds this closeout and the separate review report; the integration owner checks its local links and diff. Runtime files are unchanged from `873f514`, and this documentation is not attributed to the earlier runtime checkout. The tracker closeout records its commit separately. No broader runtime claim is inferred from documentation checks.

## Historical independent review, 2026-10-02

Standards: zero documented violations and zero actionable smell findings. The original full review exercised 158 modules and 27 packaged cases at `cb50c52`; the correction review exercised six layer tests and three freshly packaged cases at `873f514`.
Spec: one independently demonstrated R13 picking defect at `cb50c52`, resolved in `e884492` and merged as `873f514`. The final independent review exercised 176 modules, four packaged cases, and the original reproduction plus circle-copy control, with zero outstanding findings.

The two reports remain separate in [review.md](review.md). Original callback, cache, recovery, completeness, and ownership histories were traced beyond changed files. The integration owner also reviewed the final correction and its pixel/input regression. All final review execution used exact `873f514`; historical results are labelled separately.

## Historical remaining limits, 2026-10-02

- Browser execution establishes desktop Chromium with software WebGL. Safari, Firefox, physical GPU, full accessibility, throughput, and long-session memory guarantees were outside the spec.
- The pinned renderer can expose a globe world copy whose western DEM sampler is unavailable. Strict ground resolution still rejects it. The terrain-enabled globe round trip pans to current loaded coverage between placements; direct same-view crossing is verified in flat terrain and globe without terrain. No unproject or zero-elevation fallback was introduced for ground validity.
- The T3 collaborative preview returned client navigation failures, so no manual preview observation is claimed. Existing automated consumer suites supplied the browser evidence.
- Cancellation guards cannot undo a remote write that already completed. Consumer atomic persistence remains authoritative.
- Existing issues #47, #48, and #50 retain their separate policy and validation scope.
- Hosted execution was a manual branch validation, including the required playground job and aggregate gate. PR-specific review bots were unavailable because no PR was opened. The final evidence documentation is checked separately from runtime revision `873f514`; no merge-readiness claim is made.
