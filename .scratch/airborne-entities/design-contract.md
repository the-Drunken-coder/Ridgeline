# Airborne entity playground design contract

Status: Accepted and implemented with the expanded inspector.

## Purpose

Inspect a moving airborne entity and see how its altitude, attached zones, and sensor direction relate to terrain. Selecting an entity shows its camera controls.

## Accepted layout

Keep the approved Field desk sidebar and surrounding chrome. The map remains the dominant view, selection stays in the sidebar, and the existing radial picker is unchanged. Entity altitude and the selected camera's fields remain in one sidebar flow, suitable for inspecting one sensor at a time.

Preserve the existing earthy green palette, compact system typography, structural dividers, and desktop product target. The layout must remain readable at narrow review widths without claiming mobile product support.

## Required states

The playground must expose normal terrain coverage, missing altitude with ground fallback enabled and disabled, missing terrain height, below-terrain placement, a skyward camera, loading elevation, and no selected entity. The shared `entityVisibility` controls must show the effects of hiding footprints, zones, or ground lines.

## Camera appearance

The inspector includes separate visible and blocked colors and opacities, a footprint outline, cone shading, and a wireframe toggle and width. Volume opacity and wireframe visibility are independent. The camera-overlay switch hides the footprint and volume together. Controls fit within the existing sidebar without adding panel chrome.

## Constraints

Do not add decorative cards or pills, section subtitles, continuous animation, or a new dashboard shell. Static layout review uses illustrative geometry only; runtime terrain and rendering behavior are validated by the library checks.
