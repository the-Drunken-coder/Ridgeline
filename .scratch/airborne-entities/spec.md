# Airborne entities and attached geometry

Status: Implemented locally with A, Expanded inspector. Verification and numerical limits are recorded in engineering-notes.md and docs/performance.md.

## Requested capabilities

- Display an entity moving at a specified altitude above the map.
- Attach shapes, such as surrounding zones, to an entity as it moves.
- Display directional geometry, including a camera with horizontal and vertical field-of-view angles, bearing, and elevation.

## Confirmed decisions

### Movement

Use the same movement approach as the existing movement demo. The consuming application supplies updated entity positions and owns timing and interpolation. Ridgeline displays those updates. This feature does not introduce a route authoring or playback system into the library.

The user accepted this recommendation explicitly during the design interview.

### Altitude and attachments

- Show entities spatially above the terrain in 3D, with an optional line to their ground position.
- Support altitude above ground and altitude above sea level, with an explicit reference.
- Support multiple attachments per entity. Distinguish areas on the ground from volumes in the air.
- Support both a sensor camera's viewing volume and its ground footprint.
- Ground footprints must follow actual terrain, including hills, and exclude ground hidden behind nearer terrain. The user rejected the proposed flat plane approximation and confirmed terrain obstruction. Building obstruction remains deferred.

The user accepted all remaining first-round recommendations. The implementation follows these requirements using sampled terrain geometry; numerical limits are documented below.

### Direction and attachment origin

- Sensor bearing and elevation use geographic north and the local level horizon as their zero reference. Direction is not relative to the entity's heading or direction of travel.
- Bearing is clockwise from north: north is 0 degrees and east is 90 degrees. Sensor elevation is 0 degrees at level, positive upward, and negative downward.
- All attachments originate at the entity's center. Mount offsets are outside scope; the user considers them unnecessary at the intended map scale.

### Shapes and camera range

- Initial ground areas support circles and custom polygons.
- Initial airborne zones support spheres and cylinders, in addition to sensor viewing volumes. Arbitrary 3D shapes are deferred.
- Each sensor camera has an explicit maximum display range. No ground footprint is shown where its viewing volume does not reach the ground within that range.

### Missing data

- When required terrain height is unavailable, retain a ground-position marker, withhold geometry that depends on the missing height, and report elevation as unavailable. Unknown terrain must not silently become sea level.
- Provide an option to display an entity on the ground when its altitude is absent, enabled by default. When disabled, withhold the entity and report missing position information. An explicit altitude of zero is supplied altitude, not absent altitude.
- Absent altitude is distinct from an explicit altitude whose required terrain data is unavailable.
- When a supplied airborne position is below the terrain, retain a ground-position marker, report invalid airborne placement, and withhold airborne geometry. Do not silently change the supplied altitude.

### Interaction and lifecycle

- Clicking an attachment requests selection of its owning entity and identifies the clicked attachment for the consuming application.
- Removing an entity removes its attachments. Geometry that must survive removal is a separate feature.

### Validation workload

Start with the existing demo's 100 moving entities, including 10 with visible camera viewing volumes and terrain-aware footprints. The inspected demo contains 1,000 total points and supplies movement updates every 100 milliseconds. This is a validation target, not a promised capacity limit or a measured footprint refresh rate.

### Display controls

- Footprints retain physical terrain intersection and obstruction calculations when terrain display is off. Disabling terrain rendering does not substitute flat ground for real elevation data.
- Terrain exaggeration changes displayed geometry only. Coverage calculations use real heights and must not change when exaggeration changes.
- Consumers can independently show or hide camera viewing volumes, ground footprints, attached zones, and ground-position guide lines. Demonstrate these controls in the playground.

Existing behavior to preserve: flat/globe projection and hillshade are display choices. They must not change geographic sensor bearing or physical coverage. Existing map configuration controls are independently configurable.

## Consolidated outcome

An application can move an entity above the map using the existing position-update workflow, declare its altitude reference, and attach centered zones and directional sensor geometry. Each sensor uses geographic bearing, elevation angle, horizontal and vertical field-of-view angles, and maximum range. Its footprint follows actual terrain and excludes terrain hidden behind nearer hills. Display settings do not change physical coverage. Missing or invalid position data follows the explicit fallbacks above, and entity selection and removal include its attachments.

## Verification expectations

- Moving an entity moves its attached geometry without changing its north-relative sensor direction or moving the map camera.
- Above-ground and sea-level altitude references produce the expected placement over changing terrain.
- A ridge prevents the footprint from covering hidden ground behind it. Footprints respect the sensor range and are absent when the viewing volume misses the ground.
- Missing altitude, an explicit zero altitude, missing terrain data, and below-terrain placement follow their distinct agreed behaviors.
- Projection, hillshade, terrain display, and exaggeration preserve physical coverage while changing its presentation as appropriate.
- Attachment clicks identify the attachment and request selection of its entity. Entity removal leaves no attached geometry behind.
- Measure the agreed workload, including footprint refresh rate and latency, before making performance claims.

## Next steps and boundaries

The user confirmed the consolidated design with "looks good to me" and subsequently selected static mock A, Expanded inspector. The interview and mock-selection gates are complete. Implement the selected sidebar inspector while preserving the existing map shell.

The implementation uses raw DEM sampling and a shared-depth custom layer. Terrain visibility is sampled rather than exact: small obstructions between samples can be missed. The ridge, range, placement, display independence, selection, and lifecycle checks pass. See engineering-notes.md for the numerical limits and docs/performance.md for measured performance.

## Existing design baseline

Planning began from scaffold `a8ac826`. Implementation runs on `codex/airborne-entities`, based on `origin/main` at `b6abf671700f0e17519c60fab6ada5637cbb3005`. Its initial viewport specification keeps timing and interpolation consumer-owned and defers airborne features. This proposal extends that ground-only feature scope.

## Comments

- The user confirmed Q3: use the same movement approach as the movement demo.
- The user subsequently accepted the recommendations for Q1, Q2, Q4, and Q5.
- In the second round, the user specified north/level sensor direction references, center-only attachment origins, and actual terrain footprints. They accepted the initial shapes, finite sensor range, missing-terrain behavior, parent selection, and attachment removal recommendations, and requested a ground fallback toggle for absent altitude.
- In the third round, the user accepted terrain obstruction, default-on ground placement for absent altitude, the below-terrain fallback, and a validation target of 100 moving entities with 10 visible sensor footprints.
- In the final round, the user accepted terrain-aware coverage with terrain display off, physical coverage independent of exaggeration, and independent geometry visibility controls.
- The user confirmed the consolidated design. Proceed to engineering validation and static mock review.
- The user selected A, Expanded inspector. Implementation of that direction is authorized.
