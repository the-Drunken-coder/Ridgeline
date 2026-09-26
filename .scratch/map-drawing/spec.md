# Map drawing and editing

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
