# Consolidate Ridgeline without changing its direction

Keep Ridgeline reusable for consuming applications and make its existing capabilities easier to maintain and verify.
Complete the local work in small units, then finish the existing hardware acceptance work when the required machines are available.
This is an execution plan, not a replacement feature spec or a second issue tracker.

## Use this plan

The user requested this plan and granted technical discretion on 2026-10-18 in [the coordinating conversation](t3-thread://v1/c9184cd0-5a0d-48dd-a925-38b0c1373370).
The planning deliverable changes no runtime code and starts no scheduled program.
Follow the installed PStack `figure-it-out` workflow, then its Bug fix or Refactoring playbook for each implementation unit.
Use the architect workflow before settling a new internal interface and the interrogate workflow for independent review of behavioral changes.
Apply repository instructions when generic workflow defaults conflict with them.

One checked box requires evidence at an identified revision.
Use VERIFIED, NOT VERIFIED, or INCONCLUSIVE for each result.
Missing hardware evidence is INCONCLUSIVE, never a pass.
Keep GitHub Issues authoritative for status and dependencies.
Open pull requests and merge only when the user explicitly requests those actions.

## Preserve the existing contracts

- Keep the library framework-neutral and the playground on its public API.
- Keep source data, time, interpolation, replay, persistence, and business workflows in consuming applications.
- Preserve feature identity, consumer-controlled selection, snapshot isolation, and drawing metadata through storage and reload.
- Preserve MapLibre integration, current public defaults, and existing callers during internal cleanup.
- Preserve synchronous viewport DOM retirement, reentrant remounts, independent cleanup attempts, and documented error precedence.
- Preserve completed-frame picking, coherent model and attachment publication, context recovery, and quiet settled scenes.
- Preserve canonical specs and historical approval evidence. Append dated corrections instead of rewriting earlier decisions.

Read the [project instructions](../../AGENTS.md), [public contracts](../../README.md), [conventions](../../CODE_CONVENTIONS.md), and [glossary](../../GLOSSARY.md) before each unit.
Read the lifecycle, rendering, interaction, and testing topics selected by the conventions applicability table.
Honor [consumer ownership](../../docs/adr/0001-consumer-owned-workflows.md), [explicit MapLibre integration](../../docs/adr/0002-maplibre-extension-access.md), and [drawing portability](../../docs/adr/0003-preserve-drawing-shape-definitions.md).

## Capture a reproducible baseline

- [x] Record current main, the working revision, dependency versions, browser versions, package archive hash, and working-tree state before changing code.
- [x] Run `pnpm validate` once on that baseline. Retain failures and setup limitations before making a change intended to fix them.
- [x] Read the existing teardown, model-frame, context-loss, selection, and stored-drawing journeys before choosing new tests.
- [x] Confirm access to the exact machines and browsers required by [#80](https://github.com/the-Drunken-coder/Ridgeline/issues/80). Record unavailable targets while continuing local work.
- [x] Record baseline evidence in the existing feature closeouts and ignored generated artifact directories. Promote selected durable evidence using the [existing promotion workflow](../../docs/evidence-promotion.md).

The previous investigation exercised `482d16433a91f6cdf7dc67d57a3763d84d59abce`.
Type checks, 498 Node tests, five control-lab tests, the production library and playground build, and three packed Chromium journeys passed.
Those journeys covered string IDs and clicks, live updates with a stable camera, and drawing metadata through storage and viewport recreation.
That run did not execute the full browser or support suites and does not establish hardware acceptance.
Repeat the baseline when execution starts from a different revision.

## Reconcile the sensor requirements

Depends on the recorded baseline. Keep this unit documentation-only.

- [x] Compare the [original airborne requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7698e957a38bfd2330f648358455082d692c1295/.scratch/airborne-entities/spec.md), [PR #8](https://github.com/the-Drunken-coder/Ridgeline/pull/8), and the [current canonical spec](../airborne-entities/spec.md).
- [x] Trace what the current API can independently hide through visibility and appearance settings. Distinguish the grouped visibility switch from actual rendering capability.
- [x] Append a dated reconciliation to that existing spec. Identify the original promises, implemented modes, documented compatibility changes, and any approval evidence that remains absent.
- [x] Link the same contract from the README. Explain the difference between a projected visual overlay and terrain-aware coverage without presenting either as survey-grade analysis.
- [x] Preserve current defaults and callers in this unit. Do not label an unexplained requirements change approved merely because it merged.
- [ ] If a behavior correction remains necessary, define it as a separate bounded change with existing-caller compatibility and public consumer acceptance criteria. Record a present-day decision before implementing it.

Edit only the existing airborne spec and relevant README paragraphs unless a broken link requires a narrow correction elsewhere.
Finish when every identified discrepancy has an explicit disposition or a clearly identified unresolved decision.
An unresolved approval gap stays visible. A documentation amendment alone does not close it.
Verify the document diff, local links, and consistency with the actual public types and sensor implementation.

## Give MapLibre teardown one internal owner

Depends on the baseline. This unit can proceed independently of sensor reconciliation.

- [x] Inspect `createViewport` in [viewport.ts](../../src/viewport.ts), especially private hook installation and `destroy()`.
- [x] Define the smallest internal interface for container retirement and native disposal before writing the helper.
- [x] Move hook capture, render depth, pending native removal, and hook restoration into one internal owner, provisionally `src/maplibre-lifecycle.ts`.
- [x] Keep logical destruction, destroy-event ordering, independent-owner cleanup, and error reporting in `createViewport`.
- [x] Preserve both private hooks unless a real behavioral experiment proves an alternative preserves every teardown guarantee.
- [x] Keep model choice, native-marker readiness, scene revisions, model publication, and attachment picking in their existing owners.
- [x] Retain the pinned MapLibre version. Treat a renderer upgrade as a separate change.

Do not add a public export, universal renderer adapter, registry, or new dependency.
Abandon the extraction if the viewport still owns the hook state, the helper needs scene or model registries, or the helper only forwards calls.
A documented no-op is an acceptable outcome when the extraction does not reduce shared state.

Verify the existing public histories before and after the change.

```sh
pnpm check
node --import tsx --test tests/entity-scene.test.ts tests/entity-layer.test.ts
pnpm test:browser -- --grep 'Viewport destruction|Model frame callbacks|Model style failures|models rebuild current presentation|model frames recover|Attachment picking follows|Models cull'
```

- [x] Confirm the selected case inventory includes reentrant destruction, same-container replacement, cleanup failure, callback invalidation, and context restoration.
- [x] Verify any omitted teardown history through its existing case before accepting this unit. A grep that selects zero cases is not evidence.
- [x] Preserve real clicks and visible completed output. Add a behavioral regression only for a demonstrated missing history.
- [x] Obtain an independent correctness review and rerun affected checks after accepted fixes.

Finish when one owner holds native teardown state and all protected behaviors remain intact, or record why the extraction was rejected.
This unit claims maintainability improvement only. Do not claim a performance improvement from moving code.

## Verify the final local consumer workflows

Depends on the completed local changes and their reviewed revision.

- [x] Run `pnpm validate` on the combined result. Its current stages include module checks, packaged rendering, support engines, both applications, and measurement verification.
- [x] Run shared-artifact browser and measurement commands sequentially. Use the existing lock and resource checks.
- [x] Confirm the starter installs and builds using its own configuration and that the final archive passes its file and documentation checks.
- [x] Exercise the existing mouse, keyboard, drawing rejection, storage reload, native camera ownership, and cleanup journeys through the packed consumer.
- [x] Repeat the existing stationary-input recovery and bounded idle observations. Do not replace those observations with a short successful frame.
- [x] Drive any changed interaction through the documented browser workflow and inspect screenshots or recordings. Preserve the approved visual direction.
- [x] Update [support evidence](../../docs/support.md) to identify the actual exercised revision and remove stale draft-stack status claims after checking their history.
- [x] Correct the README sentence that presents closed issue #50 as outstanding after checking its merged closeout. Preserve the documented Node minimum and manual macOS support policy.
- [x] Keep historical results dated. Fix newly demonstrated defects in focused units before repeating the affected checks.

Use [testing standards](../../docs/conventions/testing.md), [CI validation](../../docs/ci-validation.md), and the existing packaged Playwright suites as the control workflow.
Use T3 preview tools for additional manual browser inspection.
Do not add a new verification framework or duplicate existing cases.
Finish when required local checks pass on the final combined revision and their results identify the tested package and environment.

## Complete the existing hardware measurements

Run this work under [#80](https://github.com/the-Drunken-coder/Ridgeline/issues/80), after local runtime changes are settled.
Agents can prepare commands and operate accessible machines. Physical access remains an external dependency.

- [ ] Use the [approved acceptance matrix](../entity-models/spec.md#acceptance-matrix) and [existing measurement consumer](../../tools/model-measurement/README.md).
- [ ] Verify the Apple M1 Pro and recorded desktop discrete-GPU fixtures, installed browsers, drivers, graphics backends, and display metadata.
- [ ] Measure Chrome and Firefox on both fixtures, Safari on the Mac, and Edge on the desktop fixture.
- [ ] Record the required canvas and pixel ratios, flat and globe views, camera motion, appearances, actual visible instances, and original, 4x, and 16x geometry workloads.
- [ ] Warm up for at least ten seconds, then collect three runs of at least thirty seconds per required performance case.
- [ ] Apply the existing original-workload targets. Frame interval p50 must be at most 17.5 ms, p95 at most 20 ms, p99 at most 33.4 ms, and visible update latency p95 at most 100 ms.
- [ ] Keep the icon baseline, failed stress cases, missing observations, raw samples, screenshots, recordings, and exercised revision together.
- [ ] Run the approved target-browser correctness histories for placement, precision, world copies, picking, switching, lifecycle, recovery, and idle work.
- [ ] Treat missing GPU timers as unavailable. Software WebGL and Playwright WebKit do not satisfy physical-GPU or installed-Safari acceptance.

Use `pnpm measure:models --hardware --browser chrome --metadata machine.json --matrix`, with the corresponding browser argument for Firefox or Edge.
On the Mac, use `pnpm measure:models --serve` and the documented installed-Safari workflow.
Read the benchmark-checklist skill before collecting, comparing, or reporting measurements.
Finish #80 only when its actual completion criteria are met. Leave it open when required access or results remain unavailable.

## Publish measured limits and complete model acceptance

Run this work under [#91](https://github.com/the-Drunken-coder/Ridgeline/issues/91), after #80 evidence satisfies its criteria.
Also verify the existing prerequisite [#90](https://github.com/the-Drunken-coder/Ridgeline/issues/90), which was closed when this plan was prepared.

- [ ] Derive the model-cost guideline from actual hardware results, including geometry, material, texture, and appearance costs.
- [ ] Implement the measured advisory through existing model diagnostics. Do not invent a limit before collecting the evidence.
- [ ] Keep valid models rendering and retain original geometry and registration acceptance when an advisory fires.
- [ ] Verify bounded logging, model identity, callback replacement, destruction, and current-operation ownership through the public registration path.
- [ ] Revisit main-thread parsing only if the agreed measured 50 ms trigger is exceeded. Evaluate the evidence before adding a worker.
- [ ] Rerun affected correctness checks and measurements after any evidence-driven runtime changes. Do not carry acceptance claims across an unverified code change.
- [ ] Update the existing model spec, closeout, performance guide, and support record with pinned findings and explicit unavailable checks.

Physical touch and manual VoiceOver or NVDA checks remain separate support obligations described in [the support guide](../../docs/support.md#accessibility-review).
Collect them on suitable devices before claiming those capabilities verified.
Do not add mobile model support or reopen the closed macOS validation issue [#50](https://github.com/the-Drunken-coder/Ridgeline/issues/50).
Finish #91 only when its evidence, advisory, and production-acceptance criteria are satisfied.

## Close the consolidation with an honest result

- [x] Record each local unit's changed files, reviewed revision, executed checks, and any rejected extraction.
- [x] Report local consolidation separately from model production acceptance and broader support checks.
- [x] Keep unavailable hardware and manual accessibility checks visible with a concrete owner or access requirement.
- [x] Preserve the original specs and use existing tickets for status. This plan's boxes do not replace them.
- [x] End with an exact completion statement. Do not call the entire effort complete while a required acceptance obligation remains open.

## Appendix A. Scope and verification decisions

Use one implementation owner at a time for shared runtime files.
Read-only investigations and hardware-access preparation may run independently.
The expected local scope is one factual documentation amendment, one conditional lifecycle extraction, and one current validation record.
Hardware collection and the measured advisory remain the existing two acceptance work packages.
Effort depends on baseline failures and machine access. No calendar estimate is justified yet.

No prototype was built during planning and no runtime design was declared proven.
The lifecycle interface remains subject to the architect workflow and the rejection criteria above.
The sensor behavior question remains separate from factual reconciliation.
This avoids silently treating historical requirements as superseded.

The fixed multi-PR program template is not used.
Its automatic scheduler, full PR fleet, and ten live lanes per change exceed this planning task.
The repository requires proportional checks and explicit authorization for PR creation, merging, and new schedules.
Use the tailored figure-it-out workflow with focused behavioral evidence instead.

The local decision trail is `.audit/project-consolidation.tsv`.
Keep it append-only and uncommitted unless execution grows enough to require a versioned audit trail.

## Execution record, 2026-10-18

Local implementation and all original validation stages are verified at `89a68852e890a1f859302dc8ff69ec3935afe890`.
The post-change aggregate command received SIGTERM during the playground suite.
Completed prefix checks were retained, and the entire playground suite plus later stages passed sequentially at unchanged source.
This is complete stage coverage, not a completed post-change aggregate run.
The [closeout](closeout.md) records revisions, results, review, and remaining limits.
The [Mac handoff](mac-acceptance.md) prepares deferred device collection.
The user has only a Mac available, with its chip still unverified, and no desktop discrete-GPU fixture.
Hardware acceptance, the measured advisory, manual accessibility checks, and the historical sensor approval gap remain open.
