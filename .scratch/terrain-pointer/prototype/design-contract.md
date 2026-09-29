# Terrain pointer comparison

Question: which target treatment makes ground placement clear at shallow camera angles while staying quiet top-down?

Static review artifact, not an interactive map or production implementation. Serve the repository with `python3 -m http.server 5173` and open `/.scratch/terrain-pointer/prototype/index.html`. No dependencies required.

## Verdict

On 2026-09-29 the user chose B, Ground contact: a terrain footprint with a crisp screen-facing crosshair. Preserve this visual direction for implementation. Keep top-down feedback simple and maintain a readable crosshair when the footprint flattens at shallow angles. The user's choice resolves appearance, not the provisional interaction details below or untested terrain accuracy.

## Design contract

- Show three distinct treatments against the same schematic terrain, route, and target position. This is a local comparison sheet because the requested deliverable is static mocks, not a new playground experience.
- Retain Ridgeline's system font, warm white surfaces, green-gray borders, and orange interaction accent. Map imagery dominates. No decorative cards, animation, or inert product controls.
- Compare both top-down and shallow views. Separate review controls from proposed map feedback.
- A: screen-facing reticle. B: terrain contact ring plus reticle. C: offset locator with an explicit ground endpoint. C's leader length is screen space, not altitude.
- Required states: placement, vertex snap, selectable hover, map drag during a tool, unavailable terrain, and sky. Camera changes only presentation. Navigation remains ordinary screen-pointer feedback.
- On narrow screens, stack alternatives vertically and preserve the map aspect ratio. Review controls wrap. Keyboard and URL variant selection are supported.
- Schematic terrain is generated with canvas; it illustrates presentation only. It does not validate renderer picking, surface alignment, visibility, or placement accuracy.

## References

[Blender's 3D Cursor](https://docs.blender.org/manual/en/4.3/editors/3dview/3d_cursor.html) distinguishes a placement reference from the ordinary mouse pointer. [ArcGIS snapping](https://pro.arcgis.com/en/pro-app/3.3/help/editing/multipatch-and-3d-object-snapping.htm) uses an explicit snap symbol and guides. These inform separate pointer, terrain contact, and snap feedback. UIZZE's public catalogue was checked, but no relevant inspectable terrain-cursor reference was available; no catalogue design is claimed as a source.

## Engineering recommendation

Reuse the pinned renderer's existing terrain intersection behind a narrow version-bound adapter. Pair a strict hit with loaded elevation validation. Share the resolved target between previews and commits; refresh on pointer, camera, and terrain changes without an idle render loop. Prefer a supported upstream query if one becomes available. See [source research](../research/terrain-picking.md).

Private API coupling and real browser accuracy need verification during implementation. Existing raw elevation sampling cannot by itself prove agreement with currently rendered terrain.

## Provisional behavior for these mocks

The active ground tool owns placement; eligible vertex snapping wins over an unsnapped ground target. Navigation temporarily suppresses placement feedback. Ordinary navigation hover highlights a selectable feature. Invalid or unknown ground targets have no placement marker. These examples do not settle every overlap or transition case in the interaction ticket.
