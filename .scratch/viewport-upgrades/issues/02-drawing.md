# Precision drawing and touch

Status: resolved

Spec: [Viewport workflow upgrades](../spec.md)
Blocked by: none
Acceptance depends on: satisfied by root stylesheet, controls integration and packed browser input registration
Integration owner: root, [shared closeout](../closeout.md)

## Owned scope

`src/drawing*.ts`, drawing geometry/shapes/session/controls modules, drawing-focused tests and `tests/workflow-drawing.browser.ts`. Preserve the approved rail/fixed inspector direction. Ask before changing viewport, feature validation or shared CSS. No README, exports, playground or shared browser registration edits.

## Acceptance criteria

- Edge snapping honors visibility, tolerance, permission/filter failures, Alt bypass, terrain and current scene ownership.
- Exact segment length/bearing moves only the end vertex, works on exterior/hole rings, and supports draft undo/redo with documented spherical units.
- Imported/created polygon holes preserve geometry/metadata; all rings translate/edit/measure/validate and round trip; invalid drafts remain editable but cannot submit.
- Touch tap/drag/Finish/Cancel is usable alongside two-finger camera navigation and existing keyboard/mouse input. Cancellation/blur/capture/permission changes settle partial gestures safely.
- Existing pending/rejection/conflict/permission callback guarantees and controls focus remain intact. Provide real-input browser helper and precise integration instructions.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Edge target/scene/callback changes | Drawing attachment | Current valid ground target or withheld placement | Packed pointer and callback history |
| Ring/segment edit and undo | Drawing session | Every ring retained and history coherent | Geometry/state tests |
| Touch becomes multi-touch/cancels | Drawing attachment | No accidental vertex; navigation remains usable | Native touch browser input |
| Pending/rejected/conflicting edit | Session and controls | Existing locks/recovery/focus retained | Public submission/control workflows |
