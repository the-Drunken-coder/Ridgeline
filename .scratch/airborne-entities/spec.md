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
