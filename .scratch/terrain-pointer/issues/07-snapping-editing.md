# 07: Snap and edit ground positions precisely

Status: ready-for-agent

**What to build:** Extend reliable ground targeting to visible vertex snapping, existing ground-point editing, handle dragging, and keyboard movement. Show the exact snapped position and preserve valid draft geometry when an attempted edit reaches unavailable terrain.

**Blocked by:** 05, [Place ground points with reliable target feedback](05-ground-placement.md).

## Context

Read the [terrain-aware pointer specification](../spec.md), especially snapping precedence, editing failure behavior, and testing decisions. Reuse the shared target resolver and approved B rendering from the blocking ticket. Respect the [existing drawing scope](../../map-drawing/spec.md) and its shape-definition and undo contracts.

This ticket does not depend on the navigation/hover ticket: its editing and snapping workflow must work with the drawing adapter alone. If both tickets are implemented concurrently, assign ownership before changing shared drawing or cursor code.

## Acceptance criteria

- [ ] Placement and ground-handle operations first require a valid ground target, then apply the existing 12 CSS pixel vertex snap tolerance, consumer filters, and eligibility exclusions. Behind-terrain, airborne, unavailable, or otherwise ineligible vertices cannot become snap targets.
- [ ] A valid eligible vertex wins over unsnapped ground. The preview and action use the same chosen coordinate, and snapping copies the vertex position without adding a persistent attachment.
- [ ] Snapping shows a distinct target indicator and a short guide from the screen pointer when displaced. Unsnapped placement has one readable crosshair, not doubled pointer glyphs. Approved B remains the underlying appearance.
- [ ] Alt bypass continues to work during placement and dragging. Pressing or releasing Alt with a stationary pointer immediately refreshes the preview and subsequent action together.
- [ ] Existing ordinary point editing, vertex handles, shape handles, and whole-shape movement use validated screen-derived positions. Focused keyboard handle movement and larger Shift steps follow the same validity rules without changing established keyboard semantics.
- [ ] Invalid drag movements or keyboard steps leave the last valid draft geometry intact and show restrained unavailable feedback. A drag retains valid movement already made and ends as one existing undoable gesture; cancel and undo retain their contracts.
- [ ] Ground targeting appears only during an active position action, not merely because an inspector is open. Editing permissions, locked/pending states, rejected drafts, and shape metadata remain respected.
- [ ] Existing programmatic geographic edits remain renderer-independent. No new snapping modes, airborne editing, or drawing tools are added.
- [ ] Packaged browser tests use real pointer and keyboard input to verify visible and occluded candidates, consumer snap filters, airborne overlap, stationary-pointer Alt toggling, handle dragging through valid/unavailable ground, and one-gesture undo. Preview and committed positions meet the specification's accuracy requirements.
- [ ] Documentation and the public-API playground demonstrate snapping and safe ground edits. Type checking, affected browser workflows, relevant geometry/state tests, package build, and playground validation pass.
