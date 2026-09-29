# 06: Coordinate navigation, hover, and placement

Status: ready-for-agent

**What to build:** Make the pointer communicate navigation and selectable feature hover, and let users pan or rotate during placement without abandoning their draft or accidentally adding a point. Resume current ground feedback when navigation ends.

**Blocked by:** 05, [Place ground points with reliable target feedback](05-ground-placement.md).

## Context

Read the [terrain-aware pointer specification](../spec.md), particularly ownership and interaction precedence. Reuse the ground-target feedback from the blocking ticket and existing exclusive interaction ownership. Preserve the public selection, hover, attachment picking, and radial-picker contracts.

This ticket owns transitions between ordinary interaction and an active ground tool. It does not introduce new navigation gestures or change consumer selection policy. The final scene-change ticket extends these behaviors across renderer loading and replacement.

## Acceptance criteria

- [ ] Empty map areas use ordinary screen-space navigation feedback and show no following terrain marker. Dragging uses grabbing feedback. Selectable features receive hover feedback without mutating consumer selection.
- [ ] Normal feature picking remains topmost-first, attachments still request selection of their owning entity, and radial-picker behavior remains intact. Hover remains a feature-change event rather than a continuous terrain-position event.
- [ ] The optional interaction helper owns its navigation/hover presentation and exposes a small additive default-on visual-feedback opt-out. Existing hover/picker options keep their documented meanings. Opting out does not disable selection or drawing validation.
- [ ] UI controls and the active interaction owner take priority. Attaching drawing and interactions together produces one coherent cursor state, with no duplicate target markers or conflicting cursor overrides.
- [ ] An active ground tool retains placement ownership even when airborne entities or unrelated selectable features overlap the pointer. Those objects neither steal clicks nor change the target to their altitude.
- [ ] Starting a navigation gesture suppresses the terrain marker and placement preview without discarding the draft. Ending the gesture resolves feedback at the current pointer and camera position. A drag-ending release adds no point.
- [ ] An idle editing inspector, a pending submission, and locked editing do not display an actionable placement target. Cancellation, completion, owner replacement, pointer leave/re-entry, and gesture loss clear or restore feedback according to current state.
- [ ] Cursor changes restore prior styling on detach without overwriting a newer owner's styling. Helpers work individually and together, and cleanup is idempotent.
- [ ] Packaged browser workflows use real input to hover, select, open/close the picker, start drawing, pan/rotate, resume placement, and cancel. They assert preserved draft geometry, no unintended selection or point creation, and correct behavior with optional helpers or feedback disabled.
- [ ] Public documentation and the playground demonstrate navigation during placement. Type checking, affected browser tests, package build, and playground validation pass.
