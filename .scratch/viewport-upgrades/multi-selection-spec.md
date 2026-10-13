# Optional viewport multi-selection

**Kind:** spec
**Tracker issue:** [#106: Optional viewport multi-selection](https://github.com/the-Drunken-coder/Ridgeline/issues/106)
**Publication:** Spec issue published and verified on 2026-10-12. This authorization supersedes the earlier tracker-publication restriction below for approved spec issues and later approved implementation tickets only. The local source remains canonical and uncommitted; this metadata does not commission new work.
**Triage:** ready-for-agent, local follow-up
**Status:** follow-up approved on 2026-10-12; renderer-loss cancellation and both acceptance histories implemented locally; current three-engine support execution passed
**Canonical requirements:** [Viewport workflow upgrades](spec.md#selection-and-presentation)
**Verification record:** [Shared closeout](closeout.md)

This focused spec records the settled selection contract from the interview, the coordinator's accepted recommendations and the current canonical requirements. The approved follow-up is assigned in [the integration ticket](issues/07-approved-follow-up.md). Tracker publication remains excluded by the user's standing instruction; the triage above is local metadata.

The user approved the 2026-10-12 red-team amendments and recommendations in the coordinating conversation. They do not change the original settled modifiers, consumer selection ownership or query approximations. The existing requirement that requests leave selection unchanged until the consumer applies them remains mandatory. Both new acceptance histories are implemented; root owns their integrated execution and current evidence.

## Problem Statement

Map users need to choose several features without repeatedly replacing their selection. They also need to collect a group from a screen rectangle while features move. These interactions must coexist with camera navigation, overlapping features and active drawing.

Consumers need reusable picking and selection requests while retaining authority over which feature IDs become selected. They must be able to understand the limits of rectangle queries across native features, models and attached geometry.

## Solution

Provide optional Shift-click toggling and mouse rectangle selection. Alt-left-drag proposes replacement selection; Alt+Shift-left-drag proposes addition. Ordinary Shift-drag retains native MapLibre box zoom. Both options default off.

The viewport emits a complete proposed set of feature IDs through `selectionrequest`. The consumer decides whether to accept, filter or ignore it and applies its chosen IDs with `setSelection`. A public `queryFeatures` operation provides the same displayed-representation rectangle query independently of gestures.

Moving data remains selectable at release. Interrupted gestures retire their rectangle and ownership without applying obsolete requests. Selected labels receive placement priority while retaining collision suppression.

## User Stories

1. As a consumer, I want multi-selection options disabled by default, so that existing integrations retain their interaction behavior.
2. As a consumer, I want to enable Shift-click and rectangle selection independently, so that I can choose the interactions appropriate to my application.
3. As a map user, I want Shift-click to add an unselected feature, so that I can build a group without losing earlier choices.
4. As a map user, I want Shift-click to remove a selected feature, so that I can refine that group.
5. As a map user, I want Shift-click on empty map space to preserve selection, so that an imprecise click does not clear my group.
6. As a map user, I want ordinary clicks to retain the existing replacement behavior, so that enabling multi-selection does not change familiar single-feature selection.
7. As a map user, I want the radial picker to resolve overlapping features one choice at a time, so that I can deliberately toggle the intended feature.
8. As a map user, I want an overlapping-feature choice to retain the original click's Shift intent, so that releasing Shift before choosing does not replace my selection.
9. As a map user, I want picker candidates to retain their positions while features move, so that I can finish choosing the intended feature.
10. As a map user, I want Alt-left-drag to request a replacement group, so that I can select intersecting displayed features together.
11. As a map user, I want Alt+Shift-left-drag to add rectangle hits, so that I can extend a group without duplicates.
12. As a map user, I want an empty replacement rectangle to propose an empty selection and an empty additive rectangle to preserve my group, so that the gestures have consistent meanings.
13. As a map user, I want ordinary Shift-drag to retain native box zoom, so that group selection does not remove an established navigation gesture.
14. As a map user, I want rectangle hits resolved from displayed representations at release, so that moving features remain selectable.
15. As a consumer, I want feature updates to preserve selected identities and leave the camera independent, so that live data does not undo my application's selection or navigation policy.
16. As a map user, I want Escape to cancel an unfinished rectangle, so that I can abandon a selection attempt without changing the accepted selection.
17. As a map user, I want blur, pointer cancellation and capture loss to retire an unfinished rectangle, so that interrupted input leaves the next gesture usable.
18. As a map user, I want camera, resize and relevant map-scene changes to cancel a rectangle, so that an obsolete screen region does not request selection.
19. As a drawing user, I want drawing ownership to block feature-selection gestures, so that selection does not steal drawing input or Alt snapping bypass.
20. As a map user, I want completed and canceled rectangles to suppress their trailing click, so that one gesture produces no accidental second selection.
21. As a consumer, I want selection requests to leave accepted selection unchanged until I apply it, so that application policy remains authoritative.
22. As a consumer, I want to accept, filter or ignore a complete proposed ID set, so that I can use the same viewport with different permissions and workflows.
23. As a consumer, I want rectangle queries without acquiring interaction ownership or applying selection, so that my own controls can reuse the picking operation.
24. As a consumer, I want either order of opposite rectangle corners in canvas CSS pixels, so that callers need no directional normalization.
25. As a consumer, I want deterministic, deduplicated results across representations, tiles and world copies, so that repeated hits do not create repeated feature identities.
26. As a consumer, I want attachment hits to include their owning feature and identify the attachment, so that I can select the entity and interpret what was touched.
27. As a consumer, I want detached current accepted feature snapshots in query results, so that reading or modifying a result cannot mutate viewport data.
28. As a consumer, I want displayed geometry to determine hits even when a failed update retains an earlier display, so that selection agrees with the representation used for picking.
29. As a consumer, I want unavailable representations and invalid query inputs handled predictably, so that queries do not partly mutate data, selection or ownership.
30. As a consumer, I want documented custom-3D, model and GPU approximations, so that I can assess selection results without assuming exact visible-pixel accuracy.
31. As a consumer, I want zero-opacity icon and fill representations excluded while other eligible representations remain selectable, so that invisible presentation does not alone create a hit.
32. As a keyboard or touch user, I want the consuming application to provide an accessible feature-list selection route, so that selecting a group does not require mouse modifiers.
33. As a map user, I want selected native and model labels to receive placement priority, so that selected features are easier to identify without forcing labels to overlap.
34. As a consumer, I want selection, deselection and basemap reload to preserve the label-priority rule without replacing features, so that presentation follows selection directly.
35. As a consumer, I want callbacks that change data, camera or ownership to retire obsolete interaction work, so that later observers do not act on a superseded request.
36. As a consumer, I want attachment and viewport destruction to release their own resources safely, so that repeated teardown or remounting leaves a usable viewport.

## Implementation Decisions

- Keep authoritative feature data, permissions, selection policy, networking, persistence, history, clocks, interpolation, retention, replay and camera-follow policy with consumers. The viewport owns accepted display snapshots, rendering resources and transient interaction state.
- Keep the interaction attachment optional. `additiveSelection` governs Shift-click; `boxSelection` governs both replacement and additive rectangles. Both default to false. Existing picker, hover and cursor defaults remain intact.
- Preserve the `selectionrequest` payload as a complete proposed ID set with attachment hit context. Do not introduce operation metadata, request revisions or a second public feature store. `setSelection` remains the consumer's application boundary.
- Toggle the chosen point candidate against the consumer's current viewport selection. Preserve original Shift intent through radial disambiguation and select one candidate per picker choice. Ordinary and additive point picking retain the same candidate ordering and terrain-depth rules.
- Capture rectangle addition intent when the mouse gesture starts. Require at least 3 CSS pixels of displacement before requesting rectangle selection. Short Alt gestures produce no selection request or fallback feature click.
- Reserve feature interaction during the rectangle, consume only its handled input and suppress its trailing click. Preserve ordinary native navigation and active drawing ownership.
- Resolve current displayed hits at release rather than freezing feature positions at pointerdown. Ordinary feature and entity updates keep the rectangle active. Replacement requests contain rectangle hit IDs; additive requests retain current selected IDs followed by new unique hits.
- Cancel transient rectangles on Escape, blur, pointer cancellation, capture loss, camera movement, resize, relevant basemap/projection/terrain/elevation changes and interaction-ownership invalidation. Recheck data, owner and attachment lifetime before emitting a request after query and release callbacks.
- **Approved renderer/context-loss cancellation.** Renderer/context loss during an active rectangle cancels that gesture, removes its transient feedback, releases pointer capture and interaction ownership, and emits no `selectionrequest`. The accepted selection is preserved through cancellation and the abandoned pointer release. The gesture must not treat unavailable query results as a completed empty rectangle. The correction is implemented locally, verified by the current three-engine support run; explicit `queryFeatures` calls retain their documented empty-result contract during renderer unavailability.
- Query displayed native representations, entity geometry, model boxes and GPU coverage in canvas CSS pixels, using the displayed world copy. Intersection is sufficient; a crossing line does not need an endpoint inside the rectangle. Exclude the feature under drawing edit, withheld representations and the zero-opacity representations covered by the presentation contract.
- Return detached current accepted consumer feature snapshots. Hit geometry and returned data can refer to different versions after a failed update retains an older display. This follows the existing accepted-data and display-recovery contract.
- Deduplicate feature IDs in feature-store order. Replacement of an existing ID retains its place; removal and reintroduction create a new insertion position. Deduplicate attachment hits and return them in declaration order within their owning feature.
- Treat the feature as the selection unit. An attachment hit includes its owner even when the owner's body lies outside the rectangle. Attachment context describes the current gesture's hits; it is not a separately retained attachment selection.
- Before readiness or during renderer context loss, return empty query arrays. Invalid bounds use existing contextual errors and diagnostics without changing accepted data, selection or interaction ownership.
- Preserve documented conservative approximations. Custom 3D rectangles may include terrain-occluded geometry; model boxes may include empty space and transparent cutouts; GPU coverage uses published nonzero-alpha texel spans and projected span corners to approximate terrain draping. Rectangle queries do not promise mesh or pixel accuracy.
- Give selected native and model labels placement priority while leaving collision suppression enabled. Selected labels may still hide one another. Selection, deselection and basemap reload update placement without replacing consumer features.
- Keep the built-in rectangle mouse-only. Consumers own feature-list routes for keyboard and touch selection. Preserve the radial picker's existing keyboard operation and focus behavior.
- Keep asynchronous application approval with the consumer. The viewport does not await selection-policy promises or reverse a later consumer call to `setSelection`; applications must prevent obsolete delayed approvals from replacing newer choices.
- Dispose listeners, transient feedback, pointer capture and interaction ownership with the attachment and viewport. Repeated destruction is safe. Idle UI schedules no decorative animation.

## Testing Decisions

- Use one primary seam: a separate consumer of the packed production package, exercising public viewport and interaction APIs with native browser input. This is the already settled validation boundary; no new internal export or test-only API is needed.
- Observe emitted proposed IDs, accepted selection, attachment context, camera state, query snapshots, visible labels/pixels, focus and subsequent usable input. Assert external behavior rather than private call sequences or source text.
- Follow the existing selection workflow cases for Shift toggling, empty input, original picker intent, ordinary replacement, Alt replacement/addition, deduplication, ownership blocking and native Shift box zoom.
- Follow the existing interruption case for an actually acquired rectangle, cancellation without a request, removed transient feedback, released ownership and a subsequent valid gesture. Extend an existing case only when a demonstrated gap requires it; coverage of Escape and camera cancellation does not establish every interruption path.
- Exercise live updates during an active rectangle and verify that release selects current displayed hits. Use public reentrant callbacks to check that data, camera, ownership or destruction changes prevent obsolete requests or later observer work.
- Follow the existing query and presentation cases for crossing lines, retained display after style failure, model/attachment hits, zero-opacity native representations and contextual invalid-input rejection. Test snapshot ownership and deterministic IDs through public reads.
- Follow the existing native/model selected-label cases for collision suppression, selection priority, deselection and basemap reload without consumer feature replacement.
- Preserve the existing browser input bridge and packaged consumer setup. Synthetic handler calls alone do not establish mouse, keyboard, native box zoom or focus behavior.
- Use focused geometry or state tests only where they exercise a meaningful public behavior unavailable through the main workflow. Avoid tests that mirror implementation or mock away renderer publication and lifecycle failures.
- Record the exact reviewed and exercised input set and the conditions each check reached. A passing software-rendered engine run does not establish physical-device, installed-browser, hardware-GPU, screen-reader or long-session acceptance.

### Approved acceptance histories

Both histories are implemented at the existing packaged-consumer boundary. Both histories passed in all three engines in the current support run. The renderer-loss history evaluates the approved behavior clarification. The request-only history proves the already settled consumer-ownership requirement; missing execution does not make that guarantee optional.

#### Renderer/context loss during an acquired rectangle

Status: approved and implemented; verified in the current 2026-10-12 support run.

1. Mount a ready viewport, display distinguishable features and explicitly select an existing feature. Attach a consumer that records and applies selection requests, so an erroneous empty request would change accepted selection. Begin a replacement rectangle with native Alt-left mouse input and establish that rectangle feedback and interaction ownership were actually acquired.
2. Cause real WebGL context loss through the browser's `WEBGL_lose_context` extension and observe the actual context-loss event. A synthetic map event alone is insufficient. After loss, assert that rectangle feedback is gone, interaction ownership is released, no request was emitted and the earlier selection remains unchanged. An explicit rectangle query during unavailability still returns empty arrays without applying selection.
3. Release the physical pointer while the context remains lost. Assert no request or trailing click selection and the same accepted selection. Keep the request observer attached throughout loss, release and restoration.
4. Restore the real context in the same viewport and establish that rendering is usable again. Perform a new native rectangle gesture over a different displayed feature. Assert one valid request and the consumer-applied selection, proving that cancellation did not leave stale ownership or suppress later usable input.
5. Treat unavailable context-loss automation or an unreached acquisition/loss/restoration precondition as an explicit verification gap. Do not silently skip the history or substitute a passing ordinary cancellation case.

#### Request-only consumer followed by filtered application

Status: approved and implemented; verified in the current 2026-10-12 support run. The consumer-ownership behavior itself is already required; no implementation violation has been demonstrated by this review.

1. Mount a ready viewport with an initially selected feature and two other displayed features. Register a request-only consumer that records requests and never calls `setSelection` automatically.
2. Use native Alt-left input to complete a replacement rectangle covering the two other features. Assert exactly one complete proposed ID set, while the initial accepted selection remains unchanged after the gesture and its trailing click opportunity. Merely receiving the expected request IDs is insufficient evidence.
3. Have the consumer explicitly apply a strict filtered subset of the recorded proposal through `setSelection`. Assert that only the chosen subset becomes selected, with no automatic application of the rejected candidate. No new request metadata, selection-policy callback or public store is needed.

## Out of Scope

- Intent metadata, configurable shortcut mappings, per-feature selection-policy callbacks, a new query-filter system or a second public displayed-data store.
- Independently stored attachment selection, library-owned batch commands or application permission decisions.
- Built-in touch, pen or keyboard rectangle creation, a persistent selection mode, a new selection toolbar or a library-owned feature-list UI.
- Exact mesh/pixel picking or a new occlusion algorithm beyond the documented conservative query rules.
- Library-managed motion, timelines, history, replay, retention, networking or camera-follow policy.
- Redesigning the approved drawing rail, fixed inspector or radial picker.
- Treating the configuration-cancellation and off-canvas bounds observations as confirmed defects or commissioning behavior changes from those hypotheses.
- Publishing issues, packages or hosted documentation; committing, pushing, deploying, opening a pull request or merging.

## Further Notes

The original product decisions remain settled. The renderer/context-loss behavior clarification above was approved on 2026-10-12. Optional extensions still need a demonstrated consumer requirement before further API design; the amendment does not commission them.

### Red-team disposition, 2026-10-12

- Inspection-supported risk: the current context-lost callback does not cancel the rectangle through its cancellation subscriptions, while the release path can interpret unavailable empty query results as a completed replacement proposal. An applying consumer could therefore clear selection. This is not a runtime-reproduced defect; the renderer-loss proposal and its acceptance history address this risk.
- Confirmed evidence gap: the focused gesture workflows immediately apply requests, so their successful final-selection assertions do not independently prove that a consumer can ignore a proposal. The request-only history is now implemented, with current three-engine support execution recorded in the shared closeout. Consumer selection ownership remains an existing requirement, and this review does not establish an implementation violation of it.
- Reproduced defects: none in this review. No runtime checks were executed. The separate configuration-cancellation and off-canvas bounds hypotheses retain their earlier unconfirmed status.

The [canonical upgrade spec](spec.md) remains the requirements source for the integrated delivery. The [selection/presentation ticket](issues/01-selection-presentation.md) and [shared closeout](closeout.md) retain implementation ownership and evidence. The [public selection guide](../../docs/viewport-tools.md#selection-and-rectangle-queries), [public API](../../README.md#interaction-and-application-ui), [support record](../../docs/support.md), [glossary](../../GLOSSARY.md) and [consumer-ownership decision](../../docs/adr/0001-consumer-owned-workflows.md) provide the linked context.

Recorded evidence is dated 2026-10-11 above baseline `cbef055b14fe218aa24611031c4ba1a9aa0ed540`. Handoff runtime digest: `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`. The closeout records 426 library/tooling and 5 control-lab tests, 50 broader packaged rendering cases, typechecks and production builds. All 51 support cases passed at the earlier support-follow-up input; after the final two-file arrow adjustment, 9 drawing support cases passed again. The starter's own fresh installation/build and final packaged file/heading links passed. These are retained results for their recorded inputs, not checks rerun to write this spec.

Those historical counts and pins do not establish either acceptance history added on 2026-10-12. The approved follow-up implements the renderer-loss correction and both histories. Current execution evidence belongs in the shared closeout. All 81 support workflows passed across three engines on 2026-10-12. Fresh reviewed and exercised inputs must accompany any later implementation or test evidence.

Physical devices, installed browsers, hardware performance, manual screen readers and long-session memory remain unverified. All implementation remains unpublished and uncommitted. The approved follow-up changes runtime inputs and records its current checks separately. No hosted-check or merge-readiness claim is made.


## Integration transition coverage, 2026-10-13

| Transition | Result owner | Required outcome | Executable coverage |
| --- | --- | --- | --- |
| Shift press moves less than 3 CSS pixels | Optional interaction attachment arbitrates the click/zoom boundary | One additive click proposal; no native box zoom | `Optional selection Shift clicks tolerate small pointer jitter` |
| Shift drag reaches 3 CSS pixels | Native MapLibre box zoom | Native navigation remains usable; selection does not claim the drag | `Rectangle interruptions recover and stale selection callbacks retire` |
| Alt rectangle begins during an already-running camera animation | Rectangle attachment rejects acquisition | No rectangle proposal | `Optional selection rejects rectangles during ongoing camera movement` |
| Camera begins moving, renderer/scene changes, Escape or capture is lost during a rectangle | Rectangle attachment cancels its lease and overlay | No abandoned proposal; accepted selection persists and the next rectangle works | Rectangle interruption and renderer-loss cases |
| Data changes during an active rectangle | Query resolves displayed representations at release | Current displayed geometry and accepted feature snapshots; no pre-drag stored positions | Rectangle interruption/live-update case |
| Release observer acquires and releases another interaction owner | Rectangle completion revision | Abandoned completion emits no proposal even when the final owner is empty | `Optional selection rejects a lease round trip during rectangle release` |
| Same-ID model data updates before replacement draw | Model publication owns the completed hit geometry | Old displayed box remains queryable with current accepted data; removal retires ownership | `Optional selection model rectangle queries retain the completed displayed frame until replacement draws` |

Alt-left selection can be intercepted by operating-system/window-manager shortcuts. This is a platform limitation of the approved gesture, not a second library gesture policy.
