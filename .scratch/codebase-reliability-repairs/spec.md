# Repair callback ownership, geographic consistency, and recovery

Status: ready-for-agent
Published spec: [GitHub #54](https://github.com/the-Drunken-coder/Ridgeline/issues/54)
Review baseline: `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`

## Problem Statement

Consumers need the accepted feature data, displayed geometry, editing session, and interaction feedback to agree. Two codebase reviews of the same revision identified 17 distinct failures in those guarantees. An operation can continue after a consumer callback cancels or replaces its owner, causing an old edit to modify or save another drawing. Destruction can leave feature interactions reserved or start persistence after cancellation. Feature publication and context-menu content can also outlive their active operations.

Geographic behavior becomes inconsistent near the date line and at high latitudes. A visible placement can produce an invalid stored longitude, snapped feedback can appear on another world copy, and airborne geometry can be picked where it is not drawn. Insertion handles can bend an otherwise unchanged edge, while keyboard edits bypass vertex snapping.

Failures and explicit retries also disagree with displayed state. A failed elevation computation can leave old camera coverage marked ready; repaired elevation data, deferred feature-source resets, and GPU buffer allocation do not always recover. Consumer interfaces add two smaller inconsistencies: the playground misses applied selection changes, and the control lab misses wheel input over units. Ground-area validation admits overlapping polygon edges.

Existing tests pass at the reviewed revision, so those tests do not establish these missing behaviors. The repair must preserve the established workflows while adding regressions for the failing transitions.

## Solution

Repair the 17 findings through the existing owners of drawing sessions, feature publication, interaction content, geographic geometry, entity rendering, and elevation recovery. Every continuation must still belong to the active operation after consumer callbacks return. Stored geographic coordinates must remain valid while render-only coordinates identify the visible world copy. Confirmed failures must report the affected capability accurately, and explicit retry must recover using current accepted data.

Keep the public library APIs, saved drawing format, consumer-owned selection and persistence, and approved interface design. Add behavioral regression tests at existing consumer and module boundaries. This is a reliability repair, with no new user workflow or general renderer abstraction.

## User Stories

1. As a drawing user, I want an edit to affect only the draft on which it began, so that changing the active drawing cannot redirect an old action.
2. As a consumer developer, I want permission callbacks to be able to cancel or replace editing safely, so that application policy changes cannot save the wrong feature.
3. As a drawing user, I want finishing one draft to submit only that draft, so that a replacement drawing is never accepted by an obsolete Finish action.
4. As a consumer developer, I want destruction during interaction acquisition to release ownership, so that the viewport remains usable after an interrupted tool mount.
5. As a map user, I want normal feature interactions to resume after a destroyed editor, so that cancellation does not leave the map locked.
6. As a consumer developer, I want destroying a pending session before saving starts to prevent the save callback, so that teardown cannot initiate persistence.
7. As a consumer developer, I want already-started persistence to retain its cancellation signal and late-result protection, so that obsolete results cannot update the viewport.
8. As a consumer developer, I want basemap replacement during styling to stop the old restoration, so that obsolete sources cannot break initialization or overwrite the current scene.
9. As a map user, I want the replacement basemap to restore current features and selection, so that changing the map context does not lose accepted data.
10. As a consumer developer, I want icon registration to preserve feature changes made by styling callbacks, so that newer geometry and removals remain authoritative.
11. As a map user, I want removed features to stay absent after an icon refresh, so that the displayed map does not contain ghost features.
12. As a consumer developer, I want an explicit retry requested during another update to run after that update settles, so that source recovery cannot be silently dropped.
13. As a consumer developer, I want retry to use the latest accepted feature data, so that recovery cannot restore obsolete geometry or removed identities.
14. As a consumer developer, I want a context-menu factory's synchronous close to keep that menu closed, so that application decisions are honored before mounting.
15. As a consumer developer, I want superseded custom content disposed exactly once, so that framework resources do not leak after replacement or destruction.
16. As a keyboard user, I want obsolete menu work to leave current focus intact, so that closing one operation cannot focus detached or replacement controls.
17. As a drawing user, I want to place and finish drawings across the date line, so that a visible ground target always produces valid stored geometry.
18. As a drawing user, I want snap feedback to use the visible nearby world copy, so that the marker, guide, and chosen coordinate agree.
19. As a consumer developer, I want saved drawing geometry and shape definitions to remain bounded and consistent, so that storing and reloading a date-line drawing preserves its editing behavior.
20. As a keyboard user, I want handle movement to use the same eligible vertex snapping as pointer edits, so that precision editing does not depend on the input method.
21. As a drawing user, I want Alt to bypass snapping during keyboard movement, so that I can choose free placement near a vertex.
22. As a drawing user, I want insertion handles to lie on the displayed edge, so that adding a vertex does not unexpectedly bend that edge.
23. As a map user, I want confirmed elevation calculation failures to remove affected camera coverage and report unavailability, so that frozen coverage is not presented as current.
24. As a map user, I want unrelated entities and attachments to remain usable after a camera failure, so that one failure does not erase other content.
25. As a map user, I want slow camera computation to retain its last completed output, so that the existing distinction between waiting and failure remains intact.
26. As a consumer developer, I want retry to fetch repaired raster tiles containing missing data, so that correcting the provider can restore coverage without recreating the viewport.
27. As a map user, I want airborne entities near the date line to be drawn where they can be selected, so that rendering and picking agree regardless of feature order.
28. As a consumer developer, I want entity buffer allocation failures reported through diagnostics, so that invisible geometry has an actionable cause.
29. As a map user, I want explicit retry to restore entity rendering after allocation becomes available, so that a transient resource failure does not require remounting.
30. As a playground user, I want the sidebar to reflect the viewport's applied selection, so that Locate and Clear operate on the drawing actually selected.
31. As a control-lab user, I want wheel zoom to work over unit buttons, so that pointer-centered navigation behaves consistently across the map.
32. As a control-lab user, I want scrolling over application controls to keep its normal behavior, so that extending map input handling does not capture unrelated UI.
33. As a consumer developer, I want invalid overlapping ground-area boundaries rejected before acceptance, so that degenerate attachment geometry is not rendered.
34. As a maintainer, I want every review finding mapped to a regression and closeout evidence, so that passing unrelated tests cannot substitute for proving a repair.

## Implementation Decisions

- Preserve the existing framework-neutral viewport and its deliberate public exports. Keep application persistence, selection policy, playground scenarios, SIDC workflows, and control-lab dependencies with their consumers. Follow the accepted consumer-ownership, explicit MapLibre-access, and saved-shape decisions.
- Keep drawing-session ownership checks local to the session. Capture the draft and relevant operation before permission callbacks. Continue only if the session is active and that operation still owns the draft, with current pending, conflict, and permission state. An obsolete operation may safely stop under existing return or error conventions; it must not mutate or submit a replacement draft.
- Treat interaction acquisition as reentrant. Hold a newly acquired release function locally until the session can accept ownership. If the callback sequence destroys or supersedes the session, release the new lease immediately and leave no resurrected draft, hidden accepted feature, or retained input ownership. Repeated teardown remains harmless.
- Recheck submission identity, draft identity, disposal, conflict, permission invalidation, and abort state after pending-state observers and before calling the consumer's submit function. If invalidated before persistence begins, skip that callback and settle without applying the change. Preserve late-result guards for persistence that has already started. Consumers still own atomic storage checks; cancellation cannot reverse an already completed remote write.
- Give feature restoration a current operation or source-generation check that survives callbacks. Retirement or a newer basemap must stop the old restoration before it creates sources, publishes results, or affects readiness. Let the current basemap establish readiness and restore current accepted data under the existing genuine-failure behavior.
- During icon registration, styling callbacks may update, remove, destroy, or replace the scene. Queue icon refreshes only for still-current accepted features. An outer refresh must not overwrite newer queued updates or removals, and notifications must not claim a removed feature was restored.
- Retain an explicit full-source reset requested while another publication is active. Once that publication settles, schedule required pending updates or resets. Recovery uses current accepted snapshots and respects source replacement and destruction. Preserve one active submission and explicit, bounded retries.
- Apply operation identity to context-menu creation, closure, returned content, and disposal. Synchronous close or destruction prevents subsequent mounting and focusing. Dispose returned superseded content exactly once. Obsolete close functions and reentrant disposers cannot close or replace newer content. Preserve the already-covered tooltip and radial-picker content lifecycles.
- Normalize longitude at the ground-target boundary before coordinates enter a drawing draft. Preserve the documented geographic bounds, ordinary latitude validation, and unknown-terrain distinction. Use the visible nearby world copy only for projection of feedback, guides, handles, and rendered geometry. A snap copies the eligible vertex's stored coordinate exactly; drawing geometry and shape definition remain consistent after save and reload.
- Route keyboard screen-derived handle movement through the same valid-ground-target and vertex-snapping policy as pointer movement. Preserve the 12 CSS pixel tolerance, exclusions for the active handle or carried shape, visibility checks, consumer filters, disabled snapping, and Alt bypass. Unavailable ground preserves the last valid geometry. Keep current keyboard steps, focus, and undo behavior.
- Place ordinary line, arrow, and polygon insertion handles on the rendered edge using the pinned renderer's projection behavior. Inserting the displayed handle coordinate must preserve the existing path within an appropriate numeric or pixel tolerance. Retain existing spherical distance and area measurement semantics.
- When required entity elevation sampling or preparation computation throws, invalidate the affected camera's completed output through its existing coverage owner and expose unavailable state with the existing diagnostic and original cause. Preserve the accepted entity and valid placement behavior, unrelated attachments and entities, and late-completion protection. Do not substitute zero for unknown elevation. A confirmed calculation failure is distinct from an ordinary delay and from the documented retention of the last complete display after a styling callback failure.
- On explicit raster retry, invalidate cached tiles implicated in missing-data failures so sampling can fetch repaired data. Preserve healthy cache entries where possible, cancel obsolete requests through existing ownership, and recover current requests without automatic polling or an unbounded retry loop.
- Choose render-only longitude placement independently for each entity or coherent geometry group. Geometry must use the same visible world-copy rule as picking, without depending on the first entity, insertion order, or unrelated distant entities. Preserve flat and globe presentation, physical altitude, and display exaggeration semantics.
- Treat a null entity GPU buffer allocation as a rendering failure. Report it through existing diagnostics, release partial resources safely, and allow explicit retry to allocate the missing resources and restore current accepted geometry. Keep rendering idle after recovery; avoid continuous automatic allocation retries.
- Refresh the playground's selection presentation from applied viewport selection changes. The library still reports interactions and the application still chooses selection. Entering the drawing scenario, accepted drawing changes, and programmatic selection must update the sidebar and action availability without requiring another click.
- Own control-lab wheel input at the shared map stage so units and the surface use the same pointer-centered zoom. Exclude application controls, preserve drag and armed-order behavior, and retain existing interruption and cleanup paths.
- Validate ground-area attachment polygons as simple, nondegenerate boundaries. Reject collinear overlapping edges, adjacent edges that double back over each other, and nonadjacent edge contacts that make the boundary nonsimple. Permit ordinary adjacent shared endpoints. Reject an invalid mixed batch before mutating accepted feature state; retain valid polygon behavior without introducing geometry repair.
- Implement with the current owners and small private helpers where useful. Any public behavior clarification belongs in the public contract. No new public test hook, schema, renderer abstraction, UI direction, or general callback framework is required.

## Testing Decisions

- Use the existing installed-package consumer as the primary integration boundary. Test viewport updates, drawing sessions and attachments, diagnostics, configuration, rendering, picking, recovery, and cleanup through supported public operations. Retain focused module tests for deterministic state, geographic geometry, validation, and delayed or failed dependency completion.
- Use the real production playground for its selection journey and the existing production control-lab browser suite for wheel navigation over units. These applications remain ordinary consumers; their tests must exercise the application behavior rather than a copied application module with its failure modes mocked away.
- Use real mouse, keyboard, and wheel input when the guarantee concerns gesture routing, focus, snapping, handle placement, or DOM propagation. Use controlled consumer callbacks to trigger cancellation, replacement, and destruction from those workflows. Synthetic map events alone do not establish the input behavior.
- Prefer existing module input/output boundaries for holding source updates, failing samplers, returning repaired DEM tiles, and injecting GPU allocation failures. Pair controlled renderer failures with real packaged rendering checks; captured calls alone cannot establish pixels, world-copy placement, or actual picking.
- Start each regression from the concrete failing sequence, observe failure on the relevant implementation baseline, then prove the repaired behavior. Review-supplied findings and the keyboard inspection finding require confirmation at that boundary before their proposed mechanism is treated as established. If a finding cannot be reproduced, record the attempted sequence and resolve the evidence explicitly instead of silently deleting its requirement or broadening the patch.
- Extend existing prior art for drawing callback replacement, submission cancellation, interaction ownership, custom-content disposal, source publication failures, explicit retry, date-line ground targeting, keyboard handles, entity placement, camera readiness, raster no-data, GPU allocation recovery, and control-lab pointer-centered zoom. Preserve existing retained-display and unrelated-update assertions.
- Test replacement draft B surviving an operation begun on A, permission callbacks that end the session, destruction during acquisition, and destruction or external conflict during pending notification before saving starts. Observe accepted features, submission identity and count, draft state, released interactions, and usable remounting.
- Exercise basemap replacement from styling during both initialization and later restoration. Verify that readiness follows the current scene, obsolete restoration cannot create its source, and accepted features and selection survive a successful replacement.
- Cover icon registration callbacks that update and remove the same feature, plus a callback that destroys or replaces the viewport scene. Assert current store data and actual rendered presence or geometry together.
- Hold a publication after initial source failure, request explicit retry while it is active, then release it. Verify the reset actually runs with current data and settles without a further user mutation. Also cover destruction and replacement while that recovery is pending.
- Open context menus with real input, then synchronously close, destroy, or replace their operation from the content factory or disposer. Assert no obsolete mounted or focused content and exactly-once disposal. Keep current tooltip and picker refresh and focus guarantees.
- Complete and accept a drawing that crosses the date line, then save and reload its bounded geometry and shape definition. Verify snap feedback, chosen position, rendering, and editing in flat and globe projections, with terrain enabled and deliberately disabled where the renderer supports the workflow. Existing single-point date-line checks are insufficient.
- Drive keyboard handles into the tolerance of an eligible vertex, toggle Alt, disable snapping, and use a consumer exclusion. Verify exact copied coordinates when eligible, free placement when bypassed, no invalid-terrain edit, retained focus, and undo. Check keyboard and pointer results against the same policy without asserting helper call order.
- At high latitude and near the date line, verify insertion handles lie on visible ordinary edges and insertion does not introduce a bend. Use a focused geometry invariant together with a real handle interaction where projection and input are relevant.
- Begin with completed plain and terrain-visibility camera output, fail required sampling during a current update, then repair and retry. Verify affected output and readiness change together, stale completions cannot restore it, and unrelated content remains. Retain a separate delayed-data case where previous completed coverage stays visible, then observe a bounded quiet period after settlement.
- Serve a deterministic raster tile with transparent no-data cells, repair its response, and invoke the public retry workflow. Verify a replacement request and restored current coverage, rather than merely clearing a readiness flag before resampling. Healthy terrain should remain reusable.
- Render entities around 0 and -179 degrees while viewing near 179 degrees, reverse feature order, and pan across the date line. Verify visible geometry and real picking agree. Cover points and representative attached geometry under flat and globe presentation rather than checking projected coordinates alone.
- Inject one null entity buffer allocation, verify the contextual diagnostic, restore allocation, and invoke explicit retry. Assert real current geometry becomes visible and selectable, with safe destruction and no repeated idle allocation work.
- Enter the playground drawing scenario and verify the selected drawing's name, Locate availability, and Clear availability. Continue through an applied selection change, clearing, and leaving the scenario to verify subscription lifecycle.
- Wheel over an ordinary map position and a unit in the control lab, checking the same pointer anchor behavior. Verify overlay application controls do not zoom the map and armed move, drag, and teardown behavior remain intact.
- Test invalid overlapping and touching attachment polygons through feature acceptance, including an invalid member in an otherwise valid batch. Assert atomic rejection and preserved accepted data. Keep valid adjacent corners and representative valid shapes as controls.
- Run current repository type checks, focused and complete module tests, packaged-consumer browser cases, production control-lab tests, and affected package and consumer builds for implementation closeout. Add the production playground journey to required validation using the existing browser tooling. Select actual commands from the current package configuration rather than treating this spec as a command cache.
- Assign one integration owner when implementation tickets are created. Map every repair ID below to its regression, reviewed revision, exercised revision, result, and any remaining gap. Changes after review require relevant revalidation. Hosted checks and merge readiness are separate from local checks and historical review evidence.

## Out of Scope

- New drawing tools, airborne drawing, touch or pen support, new snapping modes, survey-grade measurements, or changes to the saved shape format.
- A new UI direction, new controls, loading animations, or changes to the consumer's persistence and selection policies.
- Broad architectural cleanup, a renderer replacement abstraction, a public adapter framework, or public APIs added only for testing.
- Redesigning the camera visibility algorithm, terrain resolution, caching strategy as a whole, or the distinction between delayed coverage and confirmed failure.
- Automatic or unbounded retries, treating missing elevation as zero, or claiming that an abort reverses a remote write.
- Expanding this spec to unrelated callback exception presentation or target policy tracked in existing issues #47 and #48, or macOS validation changes tracked in #50. Coordinate shared ownership if work overlaps, but preserve those issues' separate decisions.
- Creating implementation tickets, opening a pull request, or merging as part of spec publication. Those are later workflow steps.
- Claiming new Safari, Firefox, physical-GPU, complete accessibility, throughput, or long-session memory guarantees from these repairs.

## Further Notes

The user requested a full review, supplied a second review of the same baseline, asked to combine them, and invoked Matt To Spec to synthesize the resulting 17 findings. This document records the intended behavior; it does not assert that the repairs are implemented. No accepted architectural decision needs reopening.

On 2026-10-02, the user confirmed the existing packaged-consumer browser boundary, production playground and control-lab workflows, and focused module tests for geometry and controlled failures.

Review evidence was recorded on 2026-10-02 at `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`. The coordinating review executed nine focused reproductions. The supplied review contributed seven additional findings and expanded the date-line feedback evidence. Keyboard snapping was an inspection finding. Basemap restoration continuation was reproduced in the supplied review, while its initialization-readiness consequence remained a conclusion from inspected callers. Supplied evidence has not been independently reverified by the coordinating reviewer. Temporary reproduction scripts are investigative evidence, not retained regression tests or a required agent dependency.

Historical baseline validation at that revision passed type checking, 204 Node tests, five control-lab state tests, 115 packaged-consumer browser cases, four production control-lab browser cases, package and consumer builds, and a dependency audit with zero reported advisories. These results do not prove any repair. Packaged browser evidence used desktop Chromium and software WebGL. The coordinating interactive preview could not navigate to the consumer; focused reproductions used existing module or public interfaces with controlled dependencies, or installed MapLibre math. The supplied review additionally reported browser DOM and GPU-call evidence. Preserve these distinctions in implementation closeout.

### Repair inventory

The IDs below are stable planning references, not separate tracker tickets. One P1, fifteen P2, and one P3 finding remain after merging five duplicates between the reviews.

| ID | Priority | Required repair | Review evidence |
| --- | --- | --- | --- |
| R01 | P1 | An old operation cannot edit or save a replacement drawing | Coordinating session reproduction changed draft B and submitted B from an operation begun on A; supplied review reproduced vertex replacement |
| R02 | P2 | Interrupted acquisition releases interaction ownership and creates no resurrected draft | Coordinating and supplied session reproductions left a destroyed editor in editing state with ownership retained |
| R03 | P2 | Invalidated pending notification cannot initiate saving | Coordinating and supplied session reproductions invoked submit once with an already-aborted signal |
| R04 | P2 | Basemap replacement retires the old restoration | Supplied review reproduced continued restoration; readiness consequence inspected |
| R05 | P2 | Icon refresh preserves newer accepted updates and removals | Coordinating original-viewport reproduction showed accepted revision 2 rendering revision 1, and a removed feature remaining in the source |
| R06 | P2 | Deferred explicit source resets actually execute | Coordinating publication reproduction requested a reset during an update and observed zero resets and no scheduled frame |
| R07 | P2 | Closed or destroyed context operations never reopen or leak content | Both reviews reproduced ignored synchronous close and a missing returned disposal call |
| R08 | P2 | Date-line drawing storage and feedback agree with the visible target | Coordinating installed-transform reproduction returned longitude 181.6367 and rejected Finish; supplied review added snapped world-copy evidence |
| R09 | P2 | Keyboard handles apply the established snapping policy | Coordinating code inspection; real-input reproduction required |
| R10 | P2 | Insertion adds a vertex on the displayed edge without bending it | Supplied review measured a handle over 41 pixels above an edge at latitude 60 degrees |
| R11 | P2 | Confirmed elevation failure removes affected camera output and ready state | Coordinating entity-scene reproduction retained two ground camera features and unchanged ready state after sampling threw |
| R12 | P2 | Retry fetches repaired no-data raster tiles | Coordinating raster reproduction remained unavailable with one total request after repair and retry |
| R13 | P2 | Airborne rendering and picking use the same nearby world copy | Supplied captured rendering inputs placed geometry near -24,361 pixels while picking placed it at 639 pixels |
| R14 | P2 | Null entity GPU allocation reports failure and recovers on retry | Supplied fault injection observed zero diagnostics and zero draws after allocation became available |
| R15 | P2 | Playground presentation follows applied selection | Supplied original-application reproduction selected Survey area while the sidebar said No feature selected and disabled actions |
| R16 | P2 | Control-lab wheel zoom also works over units | Supplied actual-hook browser DOM reproduction showed sibling unit wheel events missing the surface listener |
| R17 | P3 | Invalid overlapping ground-area boundaries are rejected atomically | Supplied feature-validation reproduction accepted an overlapping boundary and generated a degenerate triangle |

### Existing tracker coordination

- [Custom interaction content, #52](https://github.com/the-Drunken-coder/Ridgeline/issues/52) already records R07. Reference and reconcile that issue when creating implementation work; do not create a duplicate context-menu ticket or close the issue on spec publication alone.
- [canSnap exception handling, #47](https://github.com/the-Drunken-coder/Ridgeline/issues/47) and [canEdit exception handling, #48](https://github.com/the-Drunken-coder/Ridgeline/issues/48) touch the same callback owners but require separate presentation and diagnostic policy decisions. This spec repairs operation ownership and existing snapping behavior without choosing those outstanding policies.
- [macOS local validation, #50](https://github.com/the-Drunken-coder/Ridgeline/issues/50) is separate work.

On 2026-10-03, [PR #69](https://github.com/the-Drunken-coder/Ridgeline/pull/69) delivered the approved #47/#48 callback policies and [PR #70](https://github.com/the-Drunken-coder/Ridgeline/pull/70) completed #50's documentation integration. Reliability repairs in [PR #68](https://github.com/the-Drunken-coder/Ridgeline/pull/68) incorporate those deliveries from main `8ea95019ce1e25a91d75b42f2a563f12bc17f74e`. The original scope and separate policy decisions remain unchanged.

### Authoritative context

- [Public consumer contract](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/README.md).
- [Code conventions](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/CODE_CONVENTIONS.md) and [domain language](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/CONTEXT.md).
- [Consumer-owned workflows](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/docs/adr/0001-consumer-owned-workflows.md), [MapLibre extension access](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/docs/adr/0002-maplibre-extension-access.md), and [saved drawing shape definitions](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/docs/adr/0003-preserve-drawing-shape-definitions.md).
- [Drawing requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/.scratch/map-drawing/spec.md), [terrain-target requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/.scratch/terrain-pointer/spec.md), and [camera coverage requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/.scratch/sensor-camera-coverage/spec.md).
- [Feature publication requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/.scratch/feature-publication/spec.md) and [consumer-testing requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/.scratch/consumer-testing/spec.md).
- [Tracker requirements and closeout format](https://github.com/the-Drunken-coder/Ridgeline/blob/7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5/docs/agents/issue-tracker.md).

Completion requires all 17 repair IDs accounted for through their relevant regressions or an explicit evidence resolution, one reviewed integrated revision with appropriate local checks, and separately recorded hosted evidence before any merge-readiness claim. Publishing this spec alone changes documentation and tracking, not runtime behavior.
