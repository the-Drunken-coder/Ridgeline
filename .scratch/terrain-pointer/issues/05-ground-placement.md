# 05: Place ground points with reliable target feedback

Status: ready-for-agent

**What to build:** While placing points with an existing ground drawing tool, show approved design B, Ground contact, at the actual ground position the next click will use. A skyward pointer or unavailable elevation must not produce a fabricated point. Deliver this through the public drawing attachment and a working playground example.

**Blocked by:** None (can start immediately).

## Context

Read the [terrain-aware pointer specification](../spec.md), especially ownership, terrain validity, approved appearance, and testing decisions. The [exact-version research](../research/terrain-picking.md) explains why ordinary event coordinates and numeric elevation are insufficient. The [approved appearance decision](03-feedback-appearance.md) and [prototype design contract](../prototype/design-contract.md) preserve visual direction B. The prototype is a visual reference, not production code.

This is the first complete placement slice. Introduce only the internal separation needed to share target resolution between preview and placement. Preserve existing snapping behavior and preview/commit agreement; expanded snap feedback and ground-handle editing are covered by the later snapping ticket. General scene-change recovery is covered by the final ticket, but this slice must already resolve current scene state at click time and clean up its own resources.

## Acceptance criteria

- [ ] Existing ground drawing tools use one target-resolution path for pointer preview and point placement. No new point-creation tool or consumer workflow is added. Programmatic geographic edits and the renderer-independent drawing session retain their contracts.
- [ ] A narrow version-bound adapter uses strict renderer intersection and loaded elevation coverage. A missing capability produces an unavailable result and a bounded diagnostic, never a fallback position or repeated diagnostic flood.
- [ ] With terrain enabled, missing elevation is distinct from genuine zero or negative elevation. With terrain deliberately disabled, the projection's valid base surface remains usable. Sky and beyond-globe-limb positions remain unavailable.
- [ ] B's compact terrain footprint and outlined screen-facing crosshair identify the target at top-down and shallow angles in both flat and globe projections. Exaggeration is applied only through displayed terrain and does not change stored drawing semantics.
- [ ] The footprint stays bounded in screen space, follows available terrain, and never implies a measured area. If its surroundings are unavailable but the center is valid, retain the crosshair without fabricating footprint geometry. Feedback does not intercept input or take focus.
- [ ] Invalid ground clicks do not mutate the draft. Show a restrained unavailable indication without discarding existing draft work. A click resolves current state rather than trusting an obsolete preview.
- [ ] Placement feedback works without the optional interaction helper or default drawing controls. An additive, default-on visual-feedback option can disable the drawing attachment's visuals without disabling target validation or existing snapping.
- [ ] Basic tool completion, cancellation, pointer leave, and attachment/viewport destruction clear feedback and restore owned cursor styling. Listeners and resources have one disposal owner from this first slice; no idle animation loop is introduced.
- [ ] Real packaged-consumer browser input verifies preview and placement against independently known elevation fixtures, including a foreground ridge, valid zero/negative elevations, missing data, and sky. Stable target and committed geometry agree within 2 CSS pixels, and the correct ground region is selected rather than merely a nearby screen pixel.
- [ ] The shipped API documentation explains the visual option and unavailable-placement behavior. The playground demonstrates B through public APIs. Type checking, affected browser workflows, package build, and playground validation pass; any remaining renderer limitations are reported explicitly.

## Comments

The user approved this slice and its dependencies as part of the four-ticket breakdown. The existing planning tickets remain intact; implementation numbering continues after them.
