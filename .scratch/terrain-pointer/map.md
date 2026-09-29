# Terrain-aware pointer feedback

Label: wayfinder:map
Status: resolved

## Destination

An agreed behavior spec for navigation, feature hover, and precise ground placement in Ridgeline, ready for implementation after visual direction and terrain-picking limits are settled.

Published as [Terrain-aware pointer feedback specification](spec.md), ready for implementation planning.

## Notes

- Planning only. The user approved the proposed direction in conversation on 2026-09-29.
- Navigation and precise placement are both essential. Keep a stable screen pointer during navigation; show a terrain target during placement or ground editing. Suppress placement feedback during map dragging.
- Feature hover identifies selectable features. Placement previews identify the location a click will affect, including vertex snapping. Unavailable targets must not permit a fabricated ground placement.
- Tool intent determines behavior. Camera angle adapts presentation. Top-down feedback stays simple; shallow-angle feedback must remain legible.
- Ridgeline owns reusable interaction feedback. Consumers retain workflow and selection ownership under [consumer-owned workflows](../../docs/adr/0001-consumer-owned-workflows.md).
- Consult matt-wayfinder for map traversal, matt-grilling and matt-domain-modeling for human decisions, matt-research for research, and matt-prototype for visual exploration. Present distinct static mocks and wait for the user's choice before implementing a visual direction.
- Use [domain vocabulary](../../CONTEXT.md), [drawing scope](../map-drawing/spec.md), and [airborne entity behavior](../airborne-entities/spec.md) when resolving overlap with existing features.
- The user delegated technical recommendations; avoid asking them to choose renderer APIs. The approved visual direction is indexed below.

## Decisions so far

- [Establish reliable terrain targeting with MapLibre](issues/01-terrain-picking.md): coordinate and elevation fallbacks require an explicit validity strategy; exact-version source evidence and pending browser experiments are recorded in the ticket.
- [Choose terrain-target feedback across camera angles](issues/03-feedback-appearance.md): the user chose B, Ground contact, combining a terrain footprint with a readable screen-facing crosshair.
- [Choose how Ridgeline establishes terrain-target validity](issues/04-terrain-validity-strategy.md): the delegated engineering recommendation is a bounded renderer adapter with explicit hit and elevation validity checks.
- [Decide target precedence and gesture transitions](issues/02-target-precedence.md): specification synthesis preserves drawing ownership, vertex snapping, and draft recovery across navigation and unavailable targets.

## Not yet specified

No unresolved planning questions remain for this scope. The specification defines additive visual opt-outs and a shared internal target resolver; concrete API naming and renderer verification belong to implementation.

## Out of scope

- Airborne point placement and choosing altitude or depth.
- New snapping modes beyond existing vertex snapping.
- Changing navigation gestures or adding measurement tools.
- Production implementation during this wayfinding effort.
