# Terrain-aware pointer feedback

Label: wayfinder:map

## Destination

An agreed behavior spec for navigation, feature hover, and precise ground placement in Ridgeline, ready for implementation after visual direction and terrain-picking limits are settled.

## Notes

- Planning only. The user approved the proposed direction in conversation on 2026-09-29.
- Navigation and precise placement are both essential. Keep a stable screen pointer during navigation; show a terrain target during placement or ground editing. Suppress placement feedback during map dragging.
- Feature hover identifies selectable features. Placement previews identify the location a click will affect, including vertex snapping. Unavailable targets must not permit a fabricated ground placement.
- Tool intent determines behavior. Camera angle adapts presentation. Top-down feedback stays simple; shallow-angle feedback must remain legible.
- Ridgeline owns reusable interaction feedback. Consumers retain workflow and selection ownership under [consumer-owned workflows](../../docs/adr/0001-consumer-owned-workflows.md).
- Consult matt-wayfinder for map traversal, matt-grilling and matt-domain-modeling for human decisions, matt-research for research, and matt-prototype for visual exploration. Present distinct static mocks and wait for the user's choice before implementing a visual direction.
- Use [domain vocabulary](../../CONTEXT.md), [drawing scope](../map-drawing/spec.md), and [airborne entity behavior](../airborne-entities/spec.md) when resolving overlap with existing features.
- Current review: [Choose terrain-target feedback across camera angles](issues/03-feedback-appearance.md) contains three static treatments and browser captures. The user delegated technical recommendations and wants concrete visual choices; avoid asking them to choose renderer APIs.

## Decisions so far

- [Establish reliable terrain targeting with MapLibre](issues/01-terrain-picking.md): coordinate and elevation fallbacks require an explicit validity strategy; exact-version source evidence and pending browser experiments are recorded in the ticket.

## Not yet specified

Consumer configuration and the final feedback interface depend on the chosen interaction and visual behavior. Revisit whether those choices expose further decisions before assembling the implementation spec.

## Out of scope

- Airborne point placement and choosing altitude or depth.
- New snapping modes beyond existing vertex snapping.
- Changing navigation gestures or adding measurement tools.
- Production implementation during this wayfinding effort.
