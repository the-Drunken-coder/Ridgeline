# Airborne rendering and verification

Status: Implemented and verified locally on 2026-09-23. The user selected Expanded inspector (A).

## Baseline and architecture

Branch `codex/airborne-entities` starts at `b6abf671700f0e17519c60fab6ada5637cbb3005`. MapLibre GL JS remains pinned to 6.11.0. No runtime dependencies were added.

`src/entity-geometry.ts` owns geographic transforms, validation, ray intersections, and meshes. `src/elevation-sampler.ts` fetches and caches unexaggerated DEM heights independently of the map's visual terrain state. `src/entities.ts` handles entity placement, derived state, dirty updates, fallback decisions, and geometry ownership. `src/entity-layer.ts` renders shared-depth airborne geometry and picks it using the same projection transforms. `src/entity-ground.ts` renders footprints and ground zones as native terrain-draped polygons and uses renderer picking. Native symbols use the supported height offset. Application timing and interpolation remain outside Ridgeline.

The custom layer supports flat and globe projection shaders. Symbols convert physical heights into offsets above the displayed terrain. All input coordinates remain 2D GeoJSON with altitude held separately, so the original feature contract continues to reject ambiguous third coordinates.

## Terrain calculation and limits

Raw raster DEM sampling supports Mapbox, Terrarium, and custom channel factors. Bilinear samples use pixel centres and cross tile boundaries. The sampler chooses zoom 12 within provider bounds, caps concurrent fetches at six and decoded tiles at 256, aborts on replacement/destruction, and retries failures explicitly. Null never becomes a physical zero-height sample. A consumer can provide a different raw elevation sampler.

Camera range is slant distance. The volume includes a tessellated spherical far boundary so its range agrees with ray calculations. Footprints use 21 × 15 rays, up to 128 march steps per ray, and eight bisection refinements at the first crossing. Adjacent hits differing by more than one sixth of range are not joined. This preserves separate patches across large depth jumps but is an approximation: narrow obstacles between march steps, unprobed holes between rays, and small DEM details can be missed. There is no measured global spatial-error guarantee. Ground zones sample their interior with a target 50 m edge length and a six-level subdivision cap.

Buildings are excluded. Spherical-Earth local coordinates handle antimeridian crossings, but long-range ellipsoidal/geoid corrections and polar raster coverage beyond approximately ±85.05° are deferred. Raw DEM and display terrain use different levels of detail, so native symbol anchors can differ slightly from meshes. The custom layer is translucent with shared terrain depth; it does not perform order-independent transparency between overlapping volumes.

## Verified behavior

- Sixteen Node tests pass, including north/level orientation, straight-down rays, range and sky misses, unknown terrain, near-ridge obstruction, antimeridian/high-latitude geometry, concave polygon area, atomic validation, zero altitude, all RGB encodings, camera far range, and zone interior terrain sampling.
- Eighteen packed-consumer browser checks pass. New checks cover AGL/MSL placement, missing and below-terrain fallbacks, globe shader compilation, owner/attachment selection, basemap restoration, removal, and raw custom-DEM coverage unchanged with terrain off/on and exaggeration 0.5, 1, and 2.
- Strict TypeScript checking, library build, and production playground build pass. The existing large-chunk warning remains.
- The real-terrain playground was inspected with the selected expanded inspector. Production measurement details are in `docs/performance.md`.

Desktop Safari, long-session memory profiling, external DEM outages during sustained motion, and precision against surveyed terrain remain unverified. Results do not establish a maximum load ceiling.

## Relevant renderer contracts

- [Elevated symbols](https://maplibre.org/maplibre-gl-js/docs/examples/elevate-symbols-above-the-terrain/) and [symbol height properties](https://maplibre.org/maplibre-style-spec/layers/#symbol-height-offset).
- [Custom 3D layers](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) and [projection inputs](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/CustomRenderMethodInput/).
- [Map terrain queries](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#queryterrainelevation): displayed elevation cannot supply the required terrain-off physical calculation. The pinned local renderer source was also inspected for pixel-centre sampling and symbol elevation behavior.

## Mock boundary

The original static A/B/C mock remains a layout review artifact. Its screenshot and illustrative geometry are not runtime correctness evidence. Implementation and runtime checks above are separate.

## Patchy footprint rendering fix

The original footprint used custom triangles lifted two metres above sampled terrain. A display DEM only five metres higher hid otherwise visible coverage. The packed-consumer pixel test reproduced missing fill at all four unobstructed sample positions (`0,0,0,0` green-channel values); matching display and sample heights made it pass. Footprints and ground zones now use native draped fill/line layers, while airborne volumes retain the custom depth-tested layer. The failing five-metre mismatch now passes, as do selection, style restoration, removal, and physical-coverage checks. Internal triangle antialiasing is disabled to prevent seams. The raw terrain visibility calculation is unchanged.
