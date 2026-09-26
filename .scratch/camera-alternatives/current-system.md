# Current camera system: research baseline

Inspected September 24, 2026. Research only; this note does not authorize or implement a replacement.

## Product target

Show where a drone camera points and approximately what ground it covers. The user accepts reduced capability if it substantially reduces complexity. Compare approximate footprints separately from terrain-occlusion viewsheds and projected video.

## Existing implementation

- Runtime: TypeScript, MapLibre GL JS 6.11.0, WebGL2. Both flat and globe projections are supported. See [package manifest](../../package.json) and [entity renderer](../../src/entity-layer.ts).
- The simple path already computes four camera corner rays, projects them to a horizontal ground reference with range limits, and draws a native terrain-draped polygon. This is approximate coverage, not a terrain intersection or visibility proof. See [cameraFootprint](../../src/entity-geometry.ts) and [computeEntity](../../src/entity-computation.ts).
- Enabling `terrainVisibility` adds a cached 257-by-257 terrain mesh, a 2048-by-2048 sensor depth map, 1536-by-1536 initial classifications, 512-by-512 coarse voting, and a 1024-by-1024 refined mask. The five draw passes are sensor depth, classifications, voting, boundary refinement, and region styling. See [GPU renderer](../../src/gpu-cameras.ts), [shaders](../../src/gpu-camera-shaders.ts), and [terrain cache](../../src/gpu-camera-terrain.ts).
- Boundary pixels evaluate 64 subpixel positions, each comparing four sensor depths. Each completed color mask crosses back to the CPU as 4 MiB before being published through a MapLibre ImageSource. These are implementation counts, not measured performance results.
- Camera volume and wireframe are separate from the visibility mask. Cone side bases sample the terrain perimeter. See [entity computation](../../src/entity-computation.ts).

The three dedicated GPU camera modules total 532 source lines in this checkout. Shared entity rendering, terrain sampling, playground controls, and tests are additional code, not all camera-specific.

## Replacement acceptance criteria

1. Does it show camera pose and field of view, a ground footprint, actual hill occlusion, or projected imagery? These are different capabilities.
2. Does it work inside MapLibre, require a separate renderer, or imply replacing the map engine?
3. Can its code legally be reused under its published license, and is the implementation actually available?
4. Does it depend on stable public APIs or renderer internals?
5. What remains ours to implement: terrain acquisition, pose conversion, horizon/range handling, movement updates, unknown data, and resource cleanup?
6. Is claimed speed backed by a comparable measurement, or only a demo? No performance guarantee without a local trial.

## MapLibre integration evidence

MapLibre's [custom layer contract](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) supports custom GL rendering with the map camera and shared depth for 3D layers. It is an integration mechanism, not a ready-made sensor viewshed.

The installed version also contains [StyleImageWebGLData](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/StyleImageWebGLData/), which draws into the shared icon atlas. This is not the terrain ImageSource used by our mask, so its existence alone is not evidence of a drop-in GPU-only replacement for the current raster transfer.

No dependencies or production files were changed for this research.
