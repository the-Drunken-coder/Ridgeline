# Decide target precedence and gesture transitions

Type: grilling
Status: resolved
Blocked by: 01, 04
Parent: [Terrain-aware pointer feedback](../map.md)

## Question

During ground placement and editing, what should happen when a selectable feature, airborne entity, eligible snap vertex, and terrain overlap under the pointer? Decide which target wins, what happens when navigation starts or ends during an active tool, and what feedback and recovery users get when terrain becomes unavailable or changes under a stationary pointer.

Preserve consumer-owned selection and existing drawing interaction ownership. Resolve behavior with the user against concrete scenes, using the terrain-picking research to distinguish feasible behavior from assumptions.

## Answer

Resolved during the user's requested specification synthesis on 2026-09-29. The [implementation specification](../spec.md#interaction-precedence-and-transitions) is now authoritative for precedence and gesture transitions. It preserves existing drawing ownership and eligible vertex snapping, suspends feedback during navigation, and skips invalid screen-derived geometry changes while retaining valid draft work.

These details are engineering synthesis of the approved scope and existing contracts, not a claim of separate user approval for every transition. The user explicitly requested synthesis without another interview.
