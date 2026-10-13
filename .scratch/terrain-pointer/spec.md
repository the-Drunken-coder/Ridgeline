# Terrain-aware pointer feedback

Scope update, 2026-10-11: [viewport workflow upgrades](../viewport-upgrades/spec.md) extends drawing targets with optional edge snapping and touch input. It preserves this spec's ground validation and callback/scene ownership guarantees; initial edge/touch deferrals below remain historical context.

Status: ready-for-agent

## Problem Statement

Ridgeline displays three-dimensional terrain, but its pointer feedback does not consistently show the ground location a placement or editing action will affect. At shallow camera angles, small pointer movements can span large ground distances, and a marker drawn only on the ground can become difficult to see. Navigation, feature selection, and precise ground placement need distinct feedback without competing for the same input.

Correctness matters as much as appearance. The pinned renderer can return fallback coordinates after a missed terrain intersection and zero elevation when elevation data is missing. A plausible coordinate does not prove that the user is pointing at valid terrain. Showing a confident placement marker in those cases would mislead the user.

## Solution

Provide terrain-aware pointer feedback for ordinary navigation, selectable feature hover, ground drawing placement, and ground editing. Keep a stable screen pointer during navigation. During an active ground-position action, show the approved B, Ground contact treatment: a terrain footprint with a crisp screen-facing crosshair at the target.

Keep top-down feedback simple. At shallow angles the footprint follows the displayed terrain while the crosshair remains readable. Tool intent determines the action; camera angle changes presentation only. Show a distinct vertex-snap indicator when snapping changes the target. Suppress placement feedback during map navigation, and withhold ground-position changes when the target is unavailable.

One terrain-target result supplies both the preview and the action. Implement this through the existing viewport, interaction helper, and drawing adapter. Consumers retain selection, persistence, and application workflow ownership.

## User Stories

1. As a map user, I want a stable screen pointer over empty terrain, so that normal navigation feels predictable.
2. As a map user, I want a grabbing pointer while dragging the map, so that I can distinguish navigation from placement.
3. As a map user, I want selectable features to receive hover feedback, so that I know which feature a click can select.
4. As a map user, I want ordinary navigation to avoid a following ground marker, so that the map remains uncluttered.
5. As a drawing user, I want to see the ground target before placing a vertex, so that I can judge the next point's location.
6. As a drawing user, I want the preview and placed point to agree, so that a click does not unexpectedly move the point.
7. As a drawing user, I want a small, simple target in a top-down view, so that placement does not obscure nearby detail.
8. As a drawing user, I want a readable crosshair at shallow angles, so that I can still identify the point when its ground footprint flattens.
9. As a drawing user, I want the footprint to follow the terrain, so that its contact with the slope is clear.
10. As a drawing user, I want camera pitch changes to preserve the tool's meaning, so that tilting the map does not change what a click does.
11. As a drawing user, I want eligible vertices to show distinct snap feedback, so that I can distinguish an exact copied position from free placement.
12. As a drawing user, I want to see the relationship between the screen pointer and a displaced snap target, so that snapping is understandable.
13. As a drawing user, I want the existing Alt snapping bypass to remain available, so that I can place a point near a vertex without snapping to it.
14. As a drawing user, I want the same targeting rules while moving handles and existing ground points, so that editing is as reliable as creation.
15. As a keyboard user, I want focused handle movement to respect terrain validity, so that keyboard edits cannot place points through a fallback coordinate.
16. As a drawing user, I want ordinary feature hover to yield to my active tool, so that clicking a placement target does not select an unrelated feature.
17. As a drawing user, I want to pan or rotate without abandoning the draft, so that I can reach a better view while editing.
18. As a drawing user, I want feedback to resume at the current target after navigation, so that the next action uses the new view.
19. As a drawing user, I want skyward pointers to show no valid ground target, so that a click cannot create a distant fallback point.
20. As a drawing user, I want unavailable elevation to be distinguished from actual sea level, so that missing data cannot silently produce a zero-height target.
21. As a drawing user, I want a temporary terrain failure to preserve my draft, so that I can recover without losing accepted editing work.
22. As a drawing user, I want valid feedback to return when terrain becomes available, so that I can continue without restarting the tool.
23. As a drawing user, I want feedback to update when the camera or terrain changes under a stationary pointer, so that it does not show an obsolete position.
24. As a map user, I want usable feedback in flat and globe projections, so that projection changes do not alter interaction rules.
25. As a drawing user, I want targeting to match exaggerated terrain without changing stored geographic geometry, so that presentation settings do not corrupt my drawing.
26. As a drawing user, I want placement to remain available when terrain is deliberately disabled, so that ordinary flat-map and globe drawing still work.
27. As a drawing user, I want feedback to clear when I leave the viewport or end the operation, so that stale targets do not remain on the map.
28. As a consumer developer, I want standard feedback through the existing interaction and drawing attachments, so that I do not have to implement a separate pointer system.
29. As a consumer developer, I want to disable optional visual feedback without disabling safe placement, so that custom presentation can preserve correctness.
30. As a consumer developer, I want feedback resources and cursor changes cleaned up on detach or destruction, so that repeated mounting does not leak state.
31. As a map user, I want idle feedback to stay still and require no continuous animation, so that an idle map does not spend resources on pointer effects.
32. As a consumer developer, I want the documented drawing and selection contracts preserved, so that this feature does not take ownership of my application's workflow.

## Implementation Decisions

### Ownership and integration

- Keep one internal terrain-target resolver shared by placement preview and screen-derived ground edits. Keep rendering, terrain validity, and input ownership behind a small interface. Do not introduce a general cursor framework or an independent terrain ray caster.
- Integrate navigation and selectable-hover feedback with the optional interaction helper. Integrate ground target feedback and safe placement with the drawing adapter, including when the interaction helper or default drawing controls are absent. The viewport coordinates shared state and lifecycle; attaching both helpers must not create duplicate markers or competing cursor writers.
- The drawing session remains renderer-independent. Explicit geographic positions supplied programmatically retain their existing contract. Terrain validation applies when Ridgeline derives a geographic position from screen input, not as a new asynchronous requirement for every geometry mutation.
- Provide a small additive opt-out for each attachment's visual cursor feedback, enabled by default. Disabling visuals does not bypass ground-target validation or existing snapping. Follow existing option conventions and document the final public option names during implementation. Reuse existing appearance tokens; add only the styling hooks required for the approved treatment.
- Existing feature interaction events and their documented geographic coordinates remain compatible. Do not reinterpret them as guaranteed terrain hits or expose renderer internals in public types. Public feature hover remains a feature-change event; the target resolver needs separate internal pointer and scene updates.
- Cover the existing ground drawing tools, their placement points, ordinary point editing, vertex handles, and shape movement handles. This does not add a standalone point-creation tool or new consumer workflow.

### Terrain validity

- Reuse the pinned MapLibre terrain intersection through a narrow, version-bound integration adapter. Use the strict hit result together with loaded elevation coverage checks. Ordinary event coordinates, generic unprojection, and a numeric elevation alone are insufficient proof of validity.
- Keep any private renderer access confined to this adapter, with validated inputs and clear unavailable results when the required capability is absent. Report an incompatible renderer capability through the existing diagnostic mechanism without flooding diagnostics on pointer movement. Treat renderer upgrades as requiring the terrain workflow checks.
- With terrain enabled, a target is available only when a genuine rendered-terrain intersection and the elevation data supporting it are available. A covered tile with missing elevation is not valid ground. True zero and negative elevations are valid when data exists.
- With terrain deliberately disabled, use the projection's base map surface as valid ground. A missing intersection with that surface, including beyond the globe limb, remains unavailable. Do not treat an enabled but loading terrain source as intentionally disabled terrain.
- Intersect the terrain as displayed, including exaggeration, exactly once. Save ordinary geographic drawing coordinates and existing shape definitions; the footprint carries no physical radius or altitude meaning.
- Resolve against the current screen position and current displayed scene at action time, using the same resolver and snap policy as preview. A scene change can legitimately change the next target, but an obsolete preview must never authorize a fallback placement.
- Distinguish unavailable terrain data from no surface hit internally. Expected skyward input is a normal unavailable state, not a library error. Existing terrain-source diagnostics handle loading failures.

### Interaction precedence and transitions

- Viewport UI and an active interaction owner take precedence over normal feature interaction. Drawing continues to use the existing exclusive interaction ownership contract. Do not add a second selection policy.
- Without a ground operation, retain normal topmost feature picking, attachment ownership, selection requests, and radial-picker behavior. Empty map areas receive ordinary navigation feedback. Hovering must not alter consumer selection.
- During ground placement or an active ground-handle operation, require a valid ground target first, then apply existing eligible vertex snapping. Snapped candidates must have a valid displayed ground position and be visible at their projected location. Respect existing snap exclusions, consumer permission filters, and the current 12 CSS pixel tolerance. Do not add airborne or behind-terrain snap candidates.
- A valid eligible snap target wins over the unsnapped terrain position. Preserve Alt bypass. When snapping displaces the target from the screen pointer, show the distinct target indicator and a short guide between them. Store the chosen vertex coordinate exactly as under the existing snapping contract.
- Airborne entities and unrelated selectable features do not steal clicks from an active ground tool or change the target to their altitude. The active tool continues targeting terrain beneath such representations, subject to valid terrain data and existing snap eligibility.
- Starting map navigation suppresses the ground marker and placement preview, without discarding the draft. Ending navigation recomputes from the current pointer and view. The release that ends a navigation drag must not add a drawing point. Preserve existing navigation gestures.
- If an edit moves into unavailable terrain, retain the last valid draft geometry and indicate that further movement cannot be applied. Skip invalid handle movements and keyboard steps; do not jump to a fallback location. End a drag as the existing single gesture, preserving any valid movement already made. Cancel and undo retain their existing behavior.
- Show a terrain target only while choosing a new ground position or manipulating a ground handle. Merely keeping an editing inspector open does not require a following terrain marker. Pending submissions and locked editing must not show an actionable placement target.
- Pointer leave, loss of an active gesture, tool cancellation, completion, or owner replacement clears obsolete feedback. Re-entry or recovery recalculates from current state. Existing focus and keyboard behavior must remain usable.

### Approved visual treatment

- Implement B, Ground contact. Use a compact footprint following terrain with a screen-facing crosshair centered on the resolved target. Preserve contrast against both light and dark map content using the mock's outlined treatment. Use ordinary cursor feedback for navigation and selectable hover.
- Keep the pointer and unsnapped target visually coincident, with one readable crosshair rather than doubled pointer glyphs. For snapping, distinguish the screen pointer from the displaced target. Do not introduce a raised locator, continuously animated marker, or automatic camera movement.
- Keep footprint size bounded in screen space; it must not expand into a huge geographic disk near the horizon. At shallow angles allow the footprint to flatten while maintaining the crosshair's legibility. At top-down angles keep the treatment compact. Pitch never switches the tool's behavior.
- The footprint communicates contact, not a measured area, surveyed accuracy, or a snap radius. Do not fabricate parts of it over unavailable terrain. A valid center can retain its crosshair if the surrounding footprint cannot be rendered reliably; this must not imply that the center itself is unavailable.
- Over sky or unavailable terrain, remove the ground marker and provide a restrained unavailable indication. Keep explanatory text short and tied to the active operation. Do not announce every pointer movement to assistive technology; announce meaningful availability transitions where a status message is provided.
- Feedback is non-interactive and cannot intercept clicks, obscure editing controls, take keyboard focus, or enter the accessibility tab order. Touch and pen continue to follow their existing contracts.

### Updates and cleanup

- Retain the latest pointer position and update when pointer, camera, projection, viewport size, relevant terrain data, snapping candidates, snapping-bypass modifiers, or tool state changes. Pressing or releasing Alt must refresh snapping even when the pointer stays stationary. Handle style and terrain-source replacement without leaving old markers or restoring obsolete targets.
- Schedule work on demand and coalesce updates with rendering. Do not create an idle animation loop or feed unchanged overlay geometry back into renderer updates. Keep geometry and any caches bounded.
- Give listeners, cursor overrides, overlays, scheduled work, and renderer resources one disposal owner. Restore prior cursor styling without overwriting a newer owner's changes. Teardown is idempotent and ignores stale asynchronous results.
- Preserve drawing shape metadata, consumer selection ownership, permissions, submission, and undo history. Document new optional feedback settings and unavailable-placement behavior with implementation; the playground demonstrates them through the public API.

## Testing Decisions

- Use the existing packaged-consumer browser workflow as the primary testing boundary: create a viewport, attach interactions and drawing through public APIs, drive actual mouse and keyboard input, and inspect rendered feedback, public draft/preview state, accepted geometry, selection requests, and cleanup. Do not export the resolver or renderer adapter merely to test it.
- Follow existing browser prior art for real vertex dragging and undo, keyboard handle editing, feature-hover refresh, interaction ownership, style replacement, renderer/elevation agreement, and terrain failure recovery. Reuse deterministic local elevation fixtures and the existing real-input bridge.
- Verify target accuracy independently of the resolver under test. Use known synthetic elevation surfaces and known geographic points rendered by the actual engine, including a foreground ridge and terrain behind it. A test that compares preview with commit alone can miss a shared targeting error.
- For stable loaded scenes, the target crosshair and the displayed location of committed geometry must agree within 2 CSS pixels. Snapping must commit the selected vertex coordinate. At ridgelines, also assert the correct visible ground region, since screen proximity alone cannot distinguish a wrong depth or distant fallback.
- Exercise top-down and shallow views, flat and globe projections, projection transitions, date-line scenes already supported by drawing, and more than one terrain exaggeration setting. Validate positive, zero, and negative elevations with known data. Do not apply exaggeration twice.
- Delay, fail, and restore terrain tiles through the real loading path. Assert that unavailable feedback replaces the marker, clicks and screen-derived edit steps cannot mutate geometry there, the draft survives, and recovery works without restarting the tool. Test sky and beyond-limb input separately from missing data.
- Exercise eligible snapping, Alt bypass, an occluded vertex, an airborne feature over the target, and normal feature selection outside the tool. Toggle Alt with the pointer stationary inside snap range and verify that preview and placement switch together between snapped and unsnapped positions. Verify that navigation during placement adds no point and resumes current feedback afterward.
- Move the camera and change terrain while the pointer remains stationary. Verify that the next target and action use current state. Cover resize, pointer leave/re-entry, pending or rejected submission, style replacement, and destruction during updates.
- Verify drawing works with and without the optional interaction helper and controls; feedback opt-outs preserve terrain validation. Repeated attachment and cleanup must not leave duplicate overlays, cursor overrides, or observable callbacks after disposal.
- Use targeted visual inspection or focused image assertions for ground contact, contrast, crosshair readability, snapping guides, and unavailable feedback. The approved schematic mock is the design reference, not a pixel-perfect renderer baseline. Check that idle feedback does not schedule sustained rendering after the scene settles.
- Add focused geometry or state-transition tests only for difficult deterministic cases not adequately covered by these workflows. Avoid source-text assertions, tests of private call sequences, and mocks that remove real projection or missing-elevation failure modes.
- During implementation, run type checking, the affected packaged-browser workflows and focused tests, package build, and playground validation using current package commands. Run control-lab checks only if that separate consumer changes or a shared change affects it. Record environment limits; desktop software-WebGL coverage is not a physical-GPU or cross-browser guarantee.
- The user confirmed this public-interface browser workflow testing boundary during synthesis. No new testing-only public API is proposed.

## Out of Scope

- Airborne point placement, choosing altitude or free-space depth, and editing entity geometry.
- A new standalone point tool, measurement tool, navigation gesture scheme, or selection policy.
- New snapping modes such as edges, grids, roads, or relationships that remain attached after placement.
- Touch or pen drawing support, haptic feedback, continuous decorative animation, and automatic camera repositioning.
- A general cursor-plugin framework, universal rendering-engine abstraction, or independently owned terrain-intersection engine.
- Survey-grade accuracy, building/mesh placement, or visibility analysis beyond the terrain and feature interaction already described.
- Production use of the throwaway prototype code or a redesign of the surrounding playground interface.

## Further Notes

- The user approved navigation and precise ground placement as equally essential, terrain targets limited to placement/editing, ground-only initial scope, and visual treatment B. Target precedence, failure handling, and the adapter boundary above are engineering synthesis of that direction and existing contracts, not claims that the user separately approved every implementation detail.
- The [wayfinder map](map.md) and its [terrain investigation](issues/01-terrain-picking.md) preserve the discussion. The [exact-version research](research/terrain-picking.md) cites MapLibre 6.11.0 source and explains its coordinate and elevation fallbacks.
- [Approved appearance](issues/03-feedback-appearance.md) records the user's choice. [Prototype design contract](prototype/design-contract.md) and [comparison image](prototype/comparison.png) provide the visual reference. The full comparison and verdict are preserved on branch `prototype/terrain-pointer-feedback`, commit `d3dbc056c9f98387e01f9d5f397be4b6c275c6b7`.
- Respect the existing [consumer-owned workflows](../../docs/adr/0001-consumer-owned-workflows.md), [explicit MapLibre integration](../../docs/adr/0002-maplibre-extension-access.md), and [drawing shape preservation](../../docs/adr/0003-preserve-drawing-shape-definitions.md) decisions. The version-bound adapter narrows the existing MapLibre dependency rather than creating a renderer-neutral API.
- Existing [ground drawing scope](../map-drawing/spec.md) and [airborne entity contract](../airborne-entities/spec.md) remain authoritative outside this feature's feedback and safe screen-targeting changes. [Domain vocabulary](../../GLOSSARY.md) defines terrain target, ground drawing, and selection.
- This spec is ready for implementation planning. Source research and prototype browser checks are complete; real terrain-target accuracy, private-API compatibility under runtime conditions, and performance are implementation validation work, not established guarantees. If the bounded adapter cannot satisfy the validity checks, report the concrete limitation rather than silently weakening placement correctness.
