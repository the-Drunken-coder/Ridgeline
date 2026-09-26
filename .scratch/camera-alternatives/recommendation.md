# Camera awareness alternatives

Research date: September 24, 2026. Two Luna agents at extra-high reasoning researched packages and GitHub implementations. This is a research result, not an implementation decision. No production changes or dependency installations were made.

## Finding

There are existing implementations worth borrowing from, but no verified maintained drop-in MapLibre package for the entire moving-camera feature was found. The lowest-ownership choice depends on whether hill occlusion is essential.

| Route | What we gain | What remains or is lost |
| --- | --- | --- |
| Keep MapLibre and use a directional ground footprint | Uses our existing simple geometry/native-layer path; no new analysis engine | Gives direction and approximate coverage, not hill-hidden regions |
| Adapt GeoLibre's quick viewshed | TypeScript terrain line-of-sight analysis in a worker, compatible with the MapLibre image-overlay approach | Needs camera FOV filtering, update scheduling, terrain caching and missing-data handling; not demonstrated at moving-camera frame rates |
| Cesium ion SDK sensors | Ready-made rectangular sensors, environment intersection, occlusion styling and viewshed controls | Separate licensed SDK; Cesium scene/renderer integration or migration; viewshed limitations still apply |
| ArcGIS ViewshedAnalysis | Documented observer, direction, FOV and range analysis in a 3D scene | SceneView integration or migration, Esri terms and data/service choices; results depend on scene detail |

The product goal favors a simple direction/footprint display as the live baseline. If approximate hill visibility still matters, my recommendation is to evaluate a low-frequency or on-demand worker result separately. A renderer migration solely for this feature appears disproportionate to the stated goal. This is an engineering recommendation, not a measured comparison.

## Strongest MapLibre-compatible source lead

GeoLibre's [quick-viewshed source](https://github.com/opengeos/GeoLibre/blob/main/packages/processing/src/terrain-viewshed.ts) separates terrain assembly from `computeViewshed` and `computeViewshedAsync`. It is plain TypeScript, not the separate Whitebox WASM toolchain. The observer height is configurable in the function interface, although the [quick-action UI](https://geolibre.app/user-guide/map-controls/#viewshed-from-a-clicked-point) uses 1.8 m above ground.

The algorithm walks a line to each DEM cell and compares intervening slopes. Its cost is O(n³) in grid width; the source aims for roughly 512 cells across the analyzed square. A worker prevents UI blocking, but does not make it a frame-rate algorithm. The source comments explicitly warn of seconds of blocking on modest hardware if it falls back to the main thread. This is a source claim, not our benchmark.

Its [root license](https://github.com/opengeos/GeoLibre/blob/main/LICENSE) is MIT. Adaptation still needs inspection: the terrain assembler initializes a zero-filled mosaic and skips failed tiles, so missing patches can act like zero elevation. We should preserve Ridgeline's unknown-data behavior instead. It is not a direct substitute for the current moving-camera subsystem.

## Ready-made sensor alternatives

[Cesium ion SDK RectangularSensorGraphics](https://cesium.com/learn/ion-sdk/ref-doc/RectangularSensorGraphics.html) is the closest feature match: camera-shaped volume, terrain/environment intersection, visible/blocked styling, and configurable viewshed resolution. It belongs to the [separately licensed ion SDK](https://cesium.com/learn/cesiumjs-learn/cesium-ion-sdk/), not the free CesiumJS frustum geometry constructors.

[ArcGIS ViewshedAnalysis](https://developers.arcgis.com/javascript/latest/api-reference/esri-analysis-ViewshedAnalysis.html) is another maintained ready-made analysis API. It operates in SceneView, not inside MapLibre. Neither option has been installed, benchmarked, or tested against our terrain.

## Next evaluation, if selected

Compare a simple live footprint with one worker-based terrain snapshot at the same pose and DEM. Measure update latency and UI responsiveness, check whether camera FOV adaptation is small, and inspect missing-tile and ridge behavior. Decide whether the extra visibility information is worth owning before replacing anything.

See [package survey](packages.md), [GitHub implementations](github.md), and [current-system baseline](current-system.md) for supporting details.
