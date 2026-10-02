# Reliability repair closeout

Status: resolved.
Spec: `.scratch/codebase-reliability-repairs/spec.md`, [canonical requirements](spec.md), [GitHub #54](https://github.com/the-Drunken-coder/Ridgeline/issues/54).
Integration: [GitHub #55](https://github.com/the-Drunken-coder/Ridgeline/issues/55), branch `t3code/implement-spec-54`.
Integration owner: coordinating Codex agent. Drawing, publication/content, entity/elevation, and consumer file ownership was assigned before parallel implementation. Each repair used a separate ticket worktree. A merger preserved the shared browser cases and their discovery order.
Date: 2026-10-02.

## Reviewed and exercised revisions

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

## Final local checks

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

The hosted run independently passed the same checks. It verified all 140 packaged cases executed exactly once across four shards, produced the combined report, and passed the aggregate `validate` gate. The required playground job participated in that gate and report.

The final evidence-only documentation commit follows runtime verification. It adds this closeout and the separate review report; the integration owner checks its local links and diff. Runtime files are unchanged from `873f514`, and this documentation is not attributed to the earlier runtime checkout. The tracker closeout records its commit separately. No broader runtime claim is inferred from documentation checks.

## Independent review

Standards: zero documented violations and zero actionable smell findings. The original full review exercised 158 modules and 27 packaged cases at `cb50c52`; the correction review exercised six layer tests and three freshly packaged cases at `873f514`.
Spec: one independently demonstrated R13 picking defect at `cb50c52`, resolved in `e884492` and merged as `873f514`. The final independent review exercised 176 modules, four packaged cases, and the original reproduction plus circle-copy control, with zero outstanding findings.

The two reports remain separate in [review.md](review.md). Original callback, cache, recovery, completeness, and ownership histories were traced beyond changed files. The integration owner also reviewed the final correction and its pixel/input regression. All final review execution used exact `873f514`; historical results are labelled separately.

## Remaining limits

- Browser execution establishes desktop Chromium with software WebGL. Safari, Firefox, physical GPU, full accessibility, throughput, and long-session memory guarantees were outside the spec.
- The pinned renderer can expose a globe world copy whose western DEM sampler is unavailable. Strict ground resolution still rejects it. The terrain-enabled globe round trip pans to current loaded coverage between placements; direct same-view crossing is verified in flat terrain and globe without terrain. No unproject or zero-elevation fallback was introduced for ground validity.
- The T3 collaborative preview returned client navigation failures, so no manual preview observation is claimed. Existing automated consumer suites supplied the browser evidence.
- Cancellation guards cannot undo a remote write that already completed. Consumer atomic persistence remains authoritative.
- Existing issues #47, #48, and #50 retain their separate policy and validation scope.
- Hosted execution was a manual branch validation, including the required playground job and aggregate gate. PR-specific review bots were unavailable because no PR was opened. The final evidence documentation is checked separately from runtime revision `873f514`; no merge-readiness claim is made.
