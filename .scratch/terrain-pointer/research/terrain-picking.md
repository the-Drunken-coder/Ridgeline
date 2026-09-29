# Terrain picking research

Research date: 2026-09-29. Question: [Establish reliable terrain targeting with MapLibre](../issues/01-terrain-picking.md).

## Finding

MapLibre already intersects terrain for pointer coordinates. The gap is validity: public coordinate APIs can substitute a position when intersection fails, and missing elevation can become zero. Precise placement cannot trust `event.lngLat` alone.

## Version and evidence

Ridgeline pins `maplibre-gl` to `6.11.0`. The official tag was available and resolved to `6d1df7b334ebb2411b918b50a8fbf68c81df2c9a`; its [manifest](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/package.json#L4) reports that version. This research inspected that exact checkout, not latest documentation. Installed source was unavailable at `node_modules/maplibre-gl/src/ui/map.ts`; no dependencies were installed or changed.

## Source findings

- **Pointer coordinates already use terrain.** Mouse events construct `lngLat` through `map.unproject`, which passes terrain into the active transform. [Events](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/ui/events.ts#L664), [Map](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/ui/map.ts#L2087).
- **A coordinate is not proof of a hit.** Mercator tries terrain, then falls back to a horizontal plane at the camera center's elevation. Globe tries terrain, then the sphere; a ray missing the sphere receives a position near the horizon. [Mercator fallback](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/mercator_transform.ts#L382), [plane](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/mercator_transform.ts#L471), [globe fallback](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/vertical_perspective_transform.ts#L859), [horizon](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/vertical_perspective_transform.ts#L978).
- **Missing DEM can look like zero.** `queryTerrainElevation` returns null with terrain disabled; otherwise it returns exaggerated elevation. The underlying sampler returns zero without loaded DEM. Internal coverage samples distinguish `covered` and `demLoaded`, but covered tiles without DEM still participate in intersection as flat zero surfaces. Real zero must remain distinct from unavailable elevation. [Query](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/ui/map.ts#L1520), [elevation fallback](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/render/terrain.ts#L216), [coverage and hit predicate](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/render/terrain.ts#L568).
- **Strict intersection exists internally.** `screenTerrainPointToMercatorCoordinate` returns null for no terrain hit, but is explicitly `@internal`. A non-null hit still needs a loaded-DEM check. `isPointOnMapSurface` is internal too; its globe implementation tests the base sphere and ignores terrain. No complete supported public hit-and-data-validity guard was found. [Contract](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/transform_interface.ts#L364), [Mercator guard](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/mercator_transform.ts#L543), [globe guard](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/vertical_perspective_transform.ts#L909).
- **Exaggeration is already included.** Both projections intersect using exaggerated terrain coverage. Do not apply exaggeration again or save it as physical altitude. Both use bounded sampling and bisection: narrow ridges and shallow rays still need browser verification. Source inspection establishes no pixel-accuracy guarantee. [Mercator intersection](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/mercator_transform.ts#L394), [globe intersection](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/geo/projection/vertical_perspective_transform.ts#L870).

## Recommended integration and remaining decision

Use one owned terrain-target resolver returning an available ground position or an unavailable reason. Preview, snapping, vertex edits, and commit should share that result. Existing `src/drawing.ts` uses event coordinates for click/move and unprojection for some edits. Existing `src/viewport.ts` emits hover only when feature identity changes; that cannot drive continuous target feedback.

Choose the engine boundary before implementation. A supported upstream hit API exposing no-hit and missing-DEM status is preferable. An explicitly version-bound adapter around the existing internal intersection and coverage machinery is the smaller immediate option, but carries upgrade maintenance. Public unprojection plus elevation queries, or a project/unproject round-trip, cannot prove all required validity conditions. This research does not authorize internal API usage.

Remember screen position and recompute when camera, terrain, source, projection, or viewport size changes. New terrain coverage needs synchronization with renderer updates; the [render event](https://github.com/maplibre/maplibre-gl-js/blob/6d1df7b334ebb2411b918b50a8fbf68c81df2c9a/src/ui/events.ts#L182) offers that opportunity. Do not continuously request frames or feed unchanged preview geometry back into rendering. Resolve again at commit through the same path with current snapping. A stale preview must not authorize placement on unavailable terrain.

## Browser experiments still required

1. Compare preview and committed point top-down and at shallow pitch across thin ridges, nearby hills, distant slopes, and tile boundaries.
2. Point at sky and beyond the globe limb; require unavailable feedback and blocked placement, without plane or horizon fallback.
3. Delay and fail DEM tiles, including true sea-level and below-sea-level locations. Verify missing-data status and recovery.
4. Repeat in Mercator, globe, and projection transitions. Change exaggeration, camera, and zoom while the pointer stays stationary.
5. Exercise resize, terrain/style replacement, snapping, and vertex dragging. Verify consistent preview/commit behavior without idle animation or listener leaks.

Validation: exact-version source inspection and documentation diff/link review only. No browser experiments, runtime tests, or implementation. Visual tolerances and performance remain unmeasured.
