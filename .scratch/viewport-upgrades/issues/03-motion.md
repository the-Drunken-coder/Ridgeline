# Motion and replay (withdrawn)

Status: wontfix

Spec: [Viewport workflow upgrades](../spec.md)
Blocked by: none; the user withdrew this scope on 2026-10-11
Acceptance depends on: none; original implementation criteria are historical
Integration owner: root, [shared closeout](../closeout.md)

The user chose consumer ownership of all temporal data policy on 2026-10-11. The previously implemented controller, retained samples, interpolation, trails, following and replay controls have been removed. Existing feature and camera APIs remain available. No replay layout choice is pending and no external tracker status was changed.

## Owned scope

Original scope: new motion modules, focused tests and replay controls. Root owns removal of those modules and integrations and the updated [consumer-data boundary](../spec.md#consumer-owned-movement). The original criteria below record withdrawn requirements, not current acceptance claims.

## Acceptance criteria

Withdrawn by the user; retained as historical planning context.

- Small optional controller interpolates validated/snapshotted Point samples across date line/heading/compatible altitude with deterministic endpoint/duplicate-time behavior.
- Play/pause/seek/rate/replay and bounded samples/trails behave through a snapshot API/subscription; paused/end/empty schedules no continuous work.
- Trails use owned resources without overwriting consumer IDs. Following preserves camera orientation/zoom and releases on manual navigation, drawing ownership or missing track.
- Reentrant callbacks and destruction retire prior work without overwriting replacements or scheduling obsolete frames. Controller disposal releases listeners and owned data.
- Public behavior tests cover invalid input atomicity, bounds, angular interpolation, reentrant observer histories and clock behavior; packed helper exercises playback/follow/trail teardown.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Play/pause/seek/rate/end | Motion controller | Point/trail/clock agree; idle stops | Controlled state and packed consumer |
| Samples replaced/removed | Motion controller | New bounds/current pose; old work retired | Reentrant replacement checks |
| Manual navigation/drawing acquisition | Motion controller | Follow releases before fighting input | Native input and ownership event |
| Destroy from observer/remount | Motion controller | Old frames/listeners/trails gone | Public lifecycle checks |
