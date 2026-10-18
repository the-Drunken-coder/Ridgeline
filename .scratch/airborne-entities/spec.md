# Airborne entities and attached geometry

Scope clarification, 2026-10-11: the user reaffirmed consumer ownership of movement timing, interpolation and playback. The [viewport workflow upgrades](../viewport-upgrades/spec.md) omit a motion/history controller and replay UI; applications supply current geometry and pose through the existing feature API.

Status: Implemented. The playground uses the expanded inspector and the library exposes the same entity and attachment model to consumers.

## Requested capabilities

- Display a moving entity at a specified altitude above the map.
- Attach centered shapes and directional sensor geometry to an entity.
- Let the consuming application own movement timing, interpolation, route authoring, and playback.

## Current contract

An entity can use altitude above local ground or the elevation provider's sea-level datum. It can carry multiple ground areas, airborne zones, and sensor cameras. Attachments follow the entity, are centered on it, and are removed with it.

Sensor bearing is clockwise from geographic north. Sensor elevation is relative to the local level horizon. These directions are independent of entity heading and travel direction. A sensor camera has horizontal and vertical FOV angles and a finite maximum slant range.

The camera's four corner rays define a directional ground overlay. Plain overlays project those rays onto the horizontal plane at the entity's ground elevation, then MapLibre drapes the resulting quadrilateral over displayed terrain. A skyward camera has no ground overlay. With `terrainVisibility: true`, GPU coverage tests the finite camera frustum and range directly, so elevated terrain outside that flat projected quadrilateral can still be classified. Missing terrain remains unknown and is withheld.

The camera volume and wireframe respect the finite range and the camera rays. Wireframe edges stop at cached terrain intersections. Completed terrain coverage and its matching camera geometry publish together, so movement cannot advance one without the other. Terrain display, projection, and exaggeration affect presentation but do not change physical coverage.

## Shapes and display controls

- Ground areas support circles and simple polygons.
- Airborne zones support spheres and cylinders.
- `entityVisibility.footprints` controls camera volumes and ground footprints together. `entityVisibility.zones` and `entityVisibility.groundLines` independently control attached zones and ground-position guide lines.
- Camera appearance supports visible and blocked colors and opacities, footprint outlines, volume opacity, and wireframe width.

## Missing data and placement

- When required terrain height is unavailable, retain the ground-position marker, withhold dependent geometry, and report elevation as unavailable. Unknown terrain must not silently become sea level.
- An absent altitude can place an entity on the ground when `groundIfNoAltitude` is enabled. When disabled, withhold the entity and report missing position information. Explicit zero is supplied altitude.
- A supplied airborne position below terrain retains the ground-position marker, reports invalid placement, and withholds airborne geometry. The supplied altitude is not rewritten.

## Interaction and lifecycle

- Clicking an attachment identifies the attachment and requests selection of its owning entity.
- Removing an entity removes all of its attachments. Geometry that must survive removal is a separate feature.
- Moving an entity moves attached geometry without changing the sensor's north-relative direction or the map camera.

## Limits and verification

Terrain visibility is an approximation bounded by the cached terrain representation and GPU mask resolution. Small obstructions can be missed. Building obstruction and survey-grade analysis are outside scope. The validation workload of 1,000 points with 100 ms movement input and 10 camera entities is a target for exercising the feature, not a capacity promise.

Verification covers altitude references, range and FOV, ridge blocking when terrain visibility is enabled, skyward and missing-terrain cases, below-terrain placement, independent display controls, projection and exaggeration independence, attachment picking, and removal cleanup. Performance claims require a separately described, repeatable measurement.

## Requirement reconciliation, 2026-10-18

This amendment records the current API and the provenance of two requirement differences.
It preserves the earlier text and current runtime defaults.

The [original approved requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/7698e957a38bfd2330f648358455082d692c1295/.scratch/airborne-entities/spec.md#altitude-and-attachments) explicitly rejected a flat-plane footprint approximation and required terrain intersection and hill obstruction.
Its [display controls](https://github.com/the-Drunken-coder/Ridgeline/blob/7698e957a38bfd2330f648358455082d692c1295/.scratch/airborne-entities/spec.md#display-controls) also required independent visibility controls for camera volumes, ground footprints, zones, and ground-position guide lines.

[PR #8](https://github.com/the-Drunken-coder/Ridgeline/pull/8), merged on 2026-09-26, disclosed the compatibility changes.
Terrain obstruction became opt-in through `terrainVisibility`.
The rewrite removed `volumeColor` and `entityVisibility.volumes` in favor of the current color, volume appearance, and grouped footprint controls.
The retained spec and PR description do not establish explicit user approval for those requirement changes.
That historical approval gap remains unresolved.

The implemented modes have distinct meanings.
The default projected quadrilateral is a visual overlay draped over displayed terrain.
It does not classify hill obstruction.
Enabling `terrainVisibility` uses the finite sensor frustum and cached physical terrain to estimate visible and blocked ground.
Unknown terrain remains withheld, and the approximation limits above still apply.

The current API provides the following display controls.

- `entityVisibility.footprints` is the shared global gate for camera volumes, wireframes, and ground overlays.
- With that gate enabled, `volumeOpacity: 0` and `wireframe: false` hide a camera's volume and wireframe.
- With that gate enabled, `fillOpacity: 0`, `blockedOpacity: 0`, and `outline: false` hide its ground overlay.
- `entityVisibility.zones` and `entityVisibility.groundLines` remain independent global controls.

The per-camera appearance recipes can independently hide the two camera representations.
They do not restore the removed global volume switch or independently stop terrain computation and resource preparation.
No new API or behavior change is part of this factual reconciliation.
Any correction of the original terrain default or global-control promise requires a separate compatibility decision and public-consumer acceptance criteria.
