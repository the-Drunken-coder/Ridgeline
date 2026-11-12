# Drawing feedback corrections

Spec: [Viewport upgrades](../spec.md)
Status: resolved, local working ticket
Blocked by: none
Acceptance depends on: satisfied by root integrated verification
Integration owner: root, [closeout](../closeout.md)
Scope: `src/drawing*.ts`, `src/drawing-geometry.ts`, drawing-specific tests. No shared styles, viewport, docs, registration or package edits.

## Acceptance criteria

- Selecting a segment in the existing inspector visibly identifies that directed segment on the map and remains coherent after draft edits and ring changes.
- Snap feedback distinguishes vertex and edge targets while preserving Alt bypass and existing snapping ownership.
- Invalid drafts remain editable; submission, undo, interruption and two-finger navigation retain their documented behavior.
- Focused checks and a public-interface browser case cover the changed feedback; root runs shared builds/browser checks.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Segment/ring changes or draft is undone | Drawing attachment and controls | Current directed edge is highlighted; obsolete feedback disappears | Drawing browser case |
| Snap target changes or gesture is invalidated | Drawing attachment | Target type is clear; stale snap feedback disappears | Existing and focused snapping checks |

## Closeout evidence, 2026-10-11

All changes remain uncommitted and unpublished. Root reviewed and verified handoff digest `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`; the [shared closeout](../closeout.md) records exact commands, prior pins and environment limits.

| Acceptance criterion | Evidence |
| --- | --- |
| Directed segment selection, edits and ring changes | Three-engine drawing/inspector cases and final desktop/narrow captures |
| Vertex/edge targets and Alt bypass | Three-engine edge-snapping case |
| Invalid drafts, undo, submission and interruptions | 96 drawing tests, support rejection/edit workflows and native Chromium touch case |
| Public workflow and shared integration | 9 final drawing support cases, 51 preceding support cases, root builds/checks; no remaining acceptance gap |
