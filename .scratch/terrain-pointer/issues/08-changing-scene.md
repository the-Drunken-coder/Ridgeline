# 08: Keep targeting correct as the scene changes

Status: ready-for-agent

**What to build:** Keep the approved ground feedback and placement/editing result current while the camera, terrain, projection, or viewport changes. Recover from delayed or failed terrain without restarting the tool, and leave no stale feedback or continuous rendering after work ends.

**Blocked by:** 06, [Coordinate navigation, hover, and placement](06-navigation-hover.md); 07, [Snap and edit ground positions precisely](07-snapping-editing.md).

## Context

Read the full [terrain-aware pointer specification](../spec.md), especially updates and cleanup and the complete testing matrix. The blockers deliver navigation transitions and screen-derived edits. This slice makes those completed workflows survive scene changes together; it is not a tests-only or cleanup-only ticket.

Reuse their resolver, feedback, ownership, and disposal mechanisms. Preserve the [approved appearance](03-feedback-appearance.md), existing public contracts, and implementation documentation established by the earlier tickets.

## Acceptance criteria

- [ ] A stationary pointer receives current feedback as camera, terrain, projection, viewport size, snapping candidates, or tool/modifier state changes. Updates use current displayed state and cannot republish an obsolete target.
- [ ] Delayed, failed, and recovered elevation data produce the specified unavailable state and automatic recovery. Draft work survives; clicks, handle movements, and keyboard steps cannot apply fallback coordinates while their target is unavailable.
- [ ] Camera navigation, projection transitions, exaggeration changes, and supported date-line scenes preserve target meaning and stored geographic geometry. More than one exaggeration setting is verified without double application.
- [ ] Terrain/source and style replacement retire obsolete markers and pending results. Enabled-but-loading terrain is never confused with deliberately disabled terrain. Resuming placement or editing uses the replacement scene without restarting the tool.
- [ ] Loading changes affecting footprint surroundings do not fabricate a ring or invalidate a genuinely valid center. Changes affecting the center itself remove its actionable marker and block the position action.
- [ ] Pending/rejected submissions, permission changes, owner replacement, pointer or gesture loss, and destruction during updates remain coherent across both placement and handle editing. Stale completions cannot restore old output or mutate a newer session.
- [ ] Repeated attachment, detachment, and viewport destruction leave no duplicate overlays, retained cursor overrides, or observable callbacks after disposal. Resource ownership is idempotent and caches/geometry remain bounded.
- [ ] Updates are coalesced on demand. After the scene settles, unchanged feedback does not drive continued frames, animation, or repeated geometry publication. Availability status changes are restrained and do not announce every pointer movement.
- [ ] Real packaged-consumer browser journeys exercise camera movement under a stationary pointer, delayed/failed/recovered elevation, resize, projection and style replacement, and destruction while placement or editing is active. They observe public state, rendered output, committed geometry, and cleanup rather than private implementation calls.
- [ ] Independent known-terrain fixtures verify the correct visible ground region and the specification's 2 CSS pixel stable-scene agreement. The completed feature is checked top-down and shallow, on flat and globe projections, with terrain enabled/disabled and valid positive/zero/negative elevations.
- [ ] The playground can demonstrate the complete feature through public APIs. Public behavior, visual opt-outs, renderer coupling, and supported recovery are documented. Type checking, affected packaged-browser and focused tests, package build, and playground validation pass; control-lab checks run if that consumer is affected.
- [ ] Completion records distinguish verified desktop browser behavior from untested physical GPUs, other browsers, and production performance. No additional product capability or survey-grade accuracy is claimed.
