# Airborne entity playground review

Status: The user selected A, Expanded inspector. Implemented in the playground and verified against the checks in engineering-notes.md.

## Purpose

Inspect a moving airborne entity and see how its altitude, attached zones, and sensor direction relate to the terrain. The primary action is selecting an attachment and inspecting its parameters and displayed geometry.

## Existing design to preserve

Retain the accepted Field desk sidebar and surrounding chrome. Selection remains in the sidebar. Retain the map as the dominant view and the existing earthy green palette, compact system typography, and structural dividers. The existing radial picker remains unchanged.

No decorative cards or pills, section subtitles, em dashes, continuous animation, or new dashboard shell. Desktop is the product target; the review must remain readable at narrow conversation widths without claiming mobile product support.

## Alternatives

- A, Expanded inspector: entity altitude and all camera fields remain visible in a single sidebar flow. Suitable for one sensor at a time.
- B, Attachment list: the sidebar lists the entity's camera and zones, with fields for the selected attachment underneath. Suitable for multiple attachments. This was the agent's recommendation; the user selected A instead.
- C, Map editor: selection and altitude stay in the sidebar, while a compact editor for the selected attachment sits at the map edge. Trades unobstructed map area for proximity to the geometry.

## Required states

Normal terrain footprint; missing altitude with ground fallback enabled and disabled; missing terrain height; supplied position below terrain; camera facing away from the ground; loading elevation; no selected entity. Visibility controls must independently affect volumes, footprints, zones, and ground guide lines in the static preview.

## Reference boundary

The source playground's existing design contract is the primary visual reference. A fresh UIZZE catalogue search was attempted, but the previously documented DailyArt and Google Maps reference pages were inaccessible and a third reference returned 410. Do not claim those screens were freshly visually reviewed. Preserve the already accepted design rather than inventing a new reference-driven style.

The map backdrop is the existing `docs/images/terrain.jpg` from inspected `origin/main`, displayed with its map area framed by CSS. Retain attribution to Mapterhorn, OpenFreeMap, OpenMapTiles, and OpenStreetMap. Overlay positions, sensor outlines, and values are invented sample geometry for layout review, not terrain calculations or live operational data.

## Review boundary

These are static-data alternatives with local controls for comparison. They do not validate MapLibre integration, terrain intersection accuracy, throughput, or frame rate. That review phase ended when the user selected A; implementation now uses the existing playground components.

## Artifact and verification

The comparison is `airborne-designs.html` in the task's authorized visualization directory. Its A/B/C controls switch among all three layouts; the playground scenario selector exposes the required data states. The source is self-contained and below the 1 MB inline size limit.

Browser review covered all three layouts, attachment selection and fields, footprint visibility, missing altitude with both fallback settings, loading and unavailable elevation, below-terrain placement, sky-facing camera, and empty selection. All three layouts fit a 320-pixel review width without horizontal overflow. The inspected browser runs reported no warning or error logs. The embedded JavaScript passed a syntax check.

These results verify the static comparison only. Geometry is illustrative and the terrain backdrop is an existing screenshot. Engineering findings and the remaining runtime checks are in [engineering-notes.md](engineering-notes.md).
