# Map drawing and editing

Scope update, 2026-10-11: the user authorized [viewport workflow upgrades](../viewport-upgrades/spec.md), including edge snapping, exact segment length/bearing, polygon hole creation/editing and touch input. Those requirements supersede the initial deferrals below for this upgrade branch. The original approval and dated verification remain historical evidence.

Status: ready-for-human

Behavior design agreed through questions 1 through 21. The user selected mock A and authorized implementation. The implementation uses a labeled tool rail and fixed inspector with optional controls over a reusable drawing API.

## Accepted scope

- Drawings are ordinary geographic features. Consumers assign domain meaning such as routes or boundaries and own persistence and application workflows.
- Initial tools: connected line segments, polygons, rectangles, circles, and simple arrows. Drawings may have labels.
- Defer freehand drawing and standalone text.
- Support creation, moving whole drawings, reshaping, adding and removing vertices where applicable, deletion, and undo/redo.
- Support editing existing consumer-supplied features when the consumer permits it.
- Initial drawings stay on the ground. Altitude and attachment to moving entities require separate design coordinated with the airborne work.

## Accepted drawing and editing behavior

- Circles retain their center and radius, rectangles retain their rectangular shape, and simple arrows are lines with arrowheads. Ordinary polygons retain free vertex editing.
- Ridgeline manages a temporary draft and submits the completed change to the consumer for acceptance or rejection. Cancellation leaves the original feature untouched.
- Only one drawing or editing operation is active at a time. It owns geometry clicks while map navigation remains available. Switching tools requires explicitly finishing or cancelling the current draft. Exact gestures remain coordinated with the separate control-scheme design.
- Initial drawing and editing input is mouse and keyboard, including keyboard operation of editing handles. Touch and pen drawing are deferred.
- Show live lengths and areas, support exact circle-radius and rectangle-dimension entry, and offer optional snapping to existing vertices. Road, grid, and edge snapping are deferred.
- Initial appearance controls cover stroke color and width, solid or dashed lines, fill color and opacity, and optional label text. Consumers choose defaults and can restrict the available controls. Patterned fills and elaborate arrow styles are deferred.

## Accepted change ownership and portability

- Undo during editing reverses draft actions. After acceptance, one completed edit becomes one undoable application change. The consumer owns accepted-change history so drawing undo can work alongside its other actions.
- Rejected drafts remain available for correction with the rejection reason. If the underlying feature changes or disappears during editing, preserve the draft but block submission until the user discards it or restarts against the latest version. Unrelated feature updates do not interrupt editing.
- Supply ordinary GeoJSON geometry together with a documented shape definition that consumers preserve when saving and reloading. Imported geometry without a definition remains an ordinary line or polygon; do not infer its original shape type.
- Provide a callable drawing API and optional reusable controls. Consumers can replace the controls, choose available tools, and enforce permissions. Coordinate default controls with the separate control-scheme work and review static mocks before implementation.

## Accepted geographic scope

- Measure horizontal geographic distances and areas, independent of zoom and terrain exaggeration. Offer metric and imperial display units.
- Support flat maps, globe views, terrain, and date-line crossing. Initially exclude shapes enclosing a pole or covering more than half the Earth.
- Initial editable polygons are single, non-self-intersecting polygons without holes. Invalid drafts remain editable but cannot be submitted.
- Defer creating or editing polygons with holes. Existing polygons with holes remain displayable without losing their holes.

## Accepted session and interaction details

- Edit one feature at a time. Movement, geometry, style, and label changes remain in one draft until Finish. Finishing returns to normal selection after consumer acceptance. Deletion also requires consumer acceptance and is undoable. Batch editing and continuous drawing are deferred.
- While the consumer decides on a submitted change, show a pending state and prevent duplicate submissions or further edits. Map navigation remains available. Rejection unlocks the draft for correction. Loss of editing permission preserves the draft but disables submission.
- After an external update, the consumer invalidates undo/redo entries touching that feature while retaining unrelated history. Undo must not silently overwrite an external update.
- Rectangles support rotation and exact width, height, and bearing. Arrows follow connected line segments with one arrowhead at the end and a Reverse direction action. Curved and double-headed arrows are deferred.
- Optional snapping targets visible vertices on features the consumer permits, including the current draft. Provide a temporary keyboard override. Snapping copies a position without creating an attachment or following later feature movement.

## Approved callback failure recovery

Approved on 2026-10-03 for [#47](https://github.com/the-Drunken-coder/Ridgeline/issues/47) and [#48](https://github.com/the-Drunken-coder/Ridgeline/issues/48). The #48 thread is the integration owner for both deliveries and their shared [closeout record](callback-failures-closeout.md).

- A throwing `canEdit` blocks the affected create, update, or delete operation. Preserve the draft, draft history, and last permitted geometry. Distinguish a failed permission check from an explicit denial in user feedback. Settle an interrupted gesture without applying later movement. Navigation remains available; cancellation remains available outside pending submission.
- During a pending save, a failed permission check aborts the submission signal but retains the editing and cancellation lock until the consumer promise settles. Repair and `refreshPermissions()` must not unlock an unsettled request. Ignore its late acceptance, including after permission recovery. Preserve the draft for correction or cancellation after settlement. Immediate local cancellation is a separate contract decision; consumer persistence still needs atomic baseline/version checks.
- A throwing `canSnap` excludes that feature from the current resolution. Continue with another permitted nearby target or valid unsnapped ground. Never bypass terrain validation. Apply the same behavior to preview, placement, handle dragging, and keyboard movement. Alt bypass does not invoke the filter.
- Report through existing callback diagnostics with `CALLBACK_FAILED`, original cause, affected feature ID, and operation `drawing.canEdit` or `drawing.canSnap`. Each callback has one timestamp per session or attachment and reports at most once per 10,000 ms across all feature IDs and permission kinds. Record the timestamp before dispatch. Success, explicit denial, refresh, and draft replacement do not reset the timer. Keep constant diagnostic bookkeeping memory while still evaluating checks for recovery.
- Recursive observer-driven refresh must not recursively invoke the same callback. After consumer callbacks and diagnostic observers, recheck ownership, draft changes, submission identity, and relevant scene/settings changes. Cancelled, destroyed, replaced, or obsolete work must not publish feedback, mutate a replacement draft, visit later candidates, or accept an old submission.
- Recover the existing draft when the callback is repaired and current permissions or targets are refreshed. Unrelated accepted features and external-conflict rules retain their existing behavior.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Permission exception or explicit denial | #48 drawing session | Both block affected changes; only exception reports cause and failure feedback | Focused create/update/delete state checks |
| Permission failure during a gesture | #48 session, #47 attachment integration | Last permitted geometry and history retained; obsolete movement stops | Session checks and real handle input |
| Permission failure during pending save, repair, settlement | #48 submission owner | Signal aborted, lock retained until settlement, late acceptance ignored | Deferred consumer submission through public drawing attachment |
| Snap filter exception | #47 drawing attachment | Failed feature excluded; another eligible target or valid ground used | Real pointer, handle and keyboard input |
| Observer refreshes, cancels, destroys, replaces, or changes scene | Current session/attachment owner | Bounded reporting and no obsolete feedback, geometry, or candidate iteration | Reentrant state checks and packaged browser workflows |
| Callback repaired or snapping bypassed | Current drawing owner | Same draft recovers; terrain validation stays active | Continue real drawing workflow and observe a quiet reporting interval |

#47 owns `src/drawing.ts` and its tracker issue. #48 owns this spec, `README.md`, `src/drawing-session.ts`, `src/drawing-types.ts` if needed, `tests/drawing.test.ts`, packaged browser regressions and registration, and the shared closeout record. Both tickets require the combined browser evidence before acceptance.

## Verified project context

The initial design checkout at a8ac826 contained agent documentation only. The existing viewport implementation was inspected read-only at commit dd92590. Implementation was then based on main at 7698e95.

That implementation supports GeoJSON Point, LineString, and Polygon features, stable string feature IDs, consumer-controlled selection, feature styling and labels, flat and globe projection, and terrain. Its public API has no drawing or geometry-editing operations. Its consumer-owned-workflows ADR assigns persistence and application workflows to consumers.

The root glossary in this checkout preserves that implementation's existing glossary and adds the accepted drawing terms.

## ORBAT Mapper reference

- [Map edit mode](https://docs.orbat-mapper.app/guide/map-edit-mode) documents geometry drawing, vertex editing, translation, styling, and labels.
- [Drawing tools](https://raw.githubusercontent.com/orbat-mapper/orbat-mapper/main/src/modules/scenarioeditor/DrawToolSplitButton.vue) include points, lines, polygons, rectangles, and circles.
- [Control measures](https://www.npmjs.com/package/%40orbat-mapper/control-measures) give tactical graphics separate kinds, control points, and options. Ridgeline's accepted scope is generic geographic features with consumer-assigned meaning.

## Selected UI

Mock A was selected. The separate control lab remains isolated; drawing owns feature interactions through a viewport interaction lease. README documents the implemented mouse and keyboard bindings.

## Design tree

- Generic geographic features, accepted in round one.
  - Ground-only tool and editing scope, accepted in round one.
  - Shape identity, precision tools, and appearance controls, accepted in round two.
    - Shape-definition portability and geographic limits, accepted in round three.
    - Rectangle orientation, arrow direction, and snapping relationships, accepted in round four.
- Consumer ownership, accepted in rounds one and two.
  - Draft acceptance, interaction precedence, and input devices, accepted in round two.
    - Rejection and concurrent changes to the edited feature, accepted in round three.
    - Pending submission and permission changes, accepted in round four.
  - Draft history versus accepted-change history, accepted in round three.
    - Session boundaries and history invalidation after external changes, accepted in round four.
- Callable API and optional reusable controls, accepted in round three.
  - Tool rail and fixed inspector A selected; implemented gestures documented in README.

## Next steps

Review the implementation on codex/map-drawing, based on origin/main at 7698e95.

## Implementation verification

Implementation completed locally on 2026-09-23. `pnpm check` passes; `pnpm test` passes 29 tests; `pnpm test:browser` passes 21 checks against the packed package; `pnpm build:playground` succeeds. The build retains Vite's large-chunk warning for the playground.

Focused checks cover geometry and metadata round trips, invalid geometry, draft undo, consumer acceptance/rejection, concurrent feature updates, permission changes, teardown during submission, interaction ownership, style replacement, and arrowhead updates/removal. Live browser checks cover terrain-backed creation, vertex dragging and undo, circle preview measurements, rectangle dimensions and rotation, acceptance, and a 320-pixel layout without horizontal overflow. A 1,000 m by 500 m rectangle at 45 degrees reports 0.500 square kilometers.

Ground mouse/keyboard editing is the implemented scope. Touch/pen drawing, freehand, holes editing, and airborne drawing remain deferred as agreed. Measurements use the documented spherical model.
