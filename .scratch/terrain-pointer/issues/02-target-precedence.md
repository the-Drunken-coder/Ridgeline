# Decide target precedence and gesture transitions

Type: grilling
Status: open
Blocked by: 01, 04
Parent: [Terrain-aware pointer feedback](../map.md)

## Question

During ground placement and editing, what should happen when a selectable feature, airborne entity, eligible snap vertex, and terrain overlap under the pointer? Decide which target wins, what happens when navigation starts or ends during an active tool, and what feedback and recovery users get when terrain becomes unavailable or changes under a stationary pointer.

Preserve consumer-owned selection and existing drawing interaction ownership. Resolve behavior with the user against concrete scenes, using the terrain-picking research to distinguish feasible behavior from assumptions.
