# Selection and presentation

Status: resolved

Spec: [Viewport workflow upgrades](../spec.md)
Blocked by: none
Acceptance depends on: satisfied by root exports, CSS and packed-consumer integration
Integration owner: root, [shared closeout](../closeout.md)

## Owned scope

`src/types.ts`, `src/viewport.ts`, `src/interactions.ts`, `src/model-labels.ts`, related presentation modules when necessary, `tests/workflow-selection.browser.ts` and focused style validation tests. Ask before touching another owner's files. No shared exports, stylesheet, README, playground or browser registration edits.

## Acceptance criteria

- Optional additive and rectangle selection preserves default behavior, consumer selection requests, active drawing and navigation ownership. Native pointer/keyboard evidence demonstrates selected IDs and interrupted recovery.
- Labels, icons, dash arrays and selected/hover appearance work through native and applicable model-label presentation. Validate/snapshot new fields; callback errors preserve current accepted display and cleanup.
- Reentrant selection/style callbacks cannot request or publish obsolete results after data, camera, owner, or viewport replacement.
- Return exact exports and integration instructions, test results and remaining limits to root.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Shift-click/box gesture | This worker | Deterministic request IDs; default gestures intact | Real pointer inputs |
| Blur/cancel/Escape/drawing acquisition | This worker | Rectangle gone; next gesture usable | Real interruption and later selection |
| Style/preview/selection update | This worker | Native/model label style current without data mutation | Packed consumer presentation checks |
| Callback retires current scene | This worker | No stale request/presentation | Reentrant public callback checks |
