# Coordinate and control correctness

Spec: [Viewport upgrades](../spec.md)
Status: resolved, local working ticket
Blocked by: none
Acceptance depends on: satisfied by root integrated verification
Integration owner: root, [closeout](../closeout.md)
Scope: `src/coordinates.ts`, `src/controls.ts`, coordinate tests and `tests/workflow-controls.browser.ts`. Request shared event/type changes from root.

## Acceptance criteria

- Undefined geographic bearings use existing errors; valid boundary calculations and pole-origin behavior are verified and documented in a handoff to root.
- Optional native controls request location only on activation and retire their owned resources through supported APIs. Record upstream cleanup limits explicitly.
- Basemap readout follows current configuration, including failed or external changes, without replacing consumer controls.
- Focused checks cover demonstrated failures and public control workflows; root runs integrated build/browser checks.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Basemap changes externally or fails to load | Control attachment | Selector matches accepted configuration | Public browser workflow |
| Geolocation activates then attachment retires | Native control and attachment | No stale owned control or active watch remains | Public lifecycle workflow |

## Closeout evidence, 2026-10-11

All changes remain uncommitted and unpublished. Root reviewed and verified handoff digest `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`; the [shared closeout](../closeout.md) records exact commands, prior pins and environment limits.

| Acceptance criterion | Evidence |
| --- | --- |
| Undefined bearing/pole behavior | Five coordinate tests, README and viewport-tools contract |
| Native activation/resource ownership | Geolocation and fullscreen public cases across three engines; upstream one-shot/timer cancellation limit documented |
| Accepted external/failed basemap synchronization | Three-engine basemap case, including reentrant native style update |
| Integrated verification | Root typechecks, unit suite, packed support and production builds; no remaining acceptance gap within supported upstream API |
