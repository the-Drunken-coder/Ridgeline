> Camera scope was reset to an unoccluded four-corner terrain overlay on September 24. Earlier visibility requirements and results below are historical. Current contract: `docs/camera-lessons-learned.md`.

# Airborne rendering and verification

Status: Implemented and verified locally on 2026-09-23. The user selected Expanded inspector (A).

## Baseline and architecture

Branch `codex/airborne-entities` starts at `b6abf671700f0e17519c60fab6ada5637cbb3005`. MapLibre GL JS remains pinned to 6.11.0. No runtime dependencies were added.

`src/entity-geometry.ts` owns geographic transforms, validation, ray intersections, and meshes. `src/elevation-sampler.ts` fetches and caches unexaggerated DEM heights independently of the map's visual terrain state. `src/entity-computation.ts` prepares placement, derived state, and render geometry. `src/entities.ts` owns completed snapshots and schedules dirty updates. Eligible flat-map cameras use `src/gpu-cameras.ts`; the built-in raster CPU fallback runs through `src/entity-worker.ts`; `src/entity-computation-client.ts` coalesces pending positions and rejects obsolete results. Custom sampler callbacks retain synchronous computation. `src/elevation-bounds.ts` supplies conservative DEM maxima for clear-air ray skips. `src/entity-layer.ts` renders shared-depth airborne geometry and picks it using the same projection transforms. `src/entity-ground.ts` renders footprints and ground zones as native terrain-draped polygons and uses renderer picking. Native symbols use the supported height offset. Application timing and interpolation remain outside Ridgeline.

The custom layer supports flat and globe projection shaders. Symbols convert physical heights into offsets above the displayed terrain. All input coordinates remain 2D GeoJSON with altitude held separately, so the original feature contract continues to reject ambiguous third coordinates.

## Terrain calculation and limits

Raw raster DEM sampling supports Mapbox, Terrarium, and custom channel factors. Bilinear samples use pixel centres and cross tile boundaries. The sampler chooses zoom 12 within provider bounds, caps concurrent fetches at six and decoded tiles at 256, aborts on replacement/destruction, and retries failures explicitly. Null never becomes a physical zero-height sample. A consumer can provide a different raw elevation sampler.

Camera range is slant distance. The volume now clips each sampled ray to its first terrain hit; only unobstructed rays form the maximum-range cap. Mixed hit/range cap cells subdivide twice and unresolved cap pieces are omitted. Rim segments refine toward 25 m length and 0.1 m chord deviation, with an eight-level cap. The footprint starts with 21 × 15 rays, then checks a 15-point barycentric lattice in each candidate ground triangle. Mixed visible/hidden triangles subdivide toward 25 m edges with a six-level cap. Large hit-distance jumps remain disconnected. Rays step at most 5 m, sample at most 1 m when endpoint clearance drops below 10 m, and bisect crossings eight times. The work limit is 8,192 outer steps; unresolved rays withhold dependent geometry. These limits remain approximations, not a global spatial-error guarantee. Ground zones sample their interior with a target 50 m edge length and a six-level subdivision cap.

Buildings are excluded. Spherical-Earth local coordinates handle antimeridian crossings, but long-range ellipsoidal/geoid corrections and polar raster coverage beyond approximately ±85.05° are deferred. Raw DEM and display terrain use different levels of detail, so native symbol anchors can differ slightly from meshes. The custom layer is translucent with shared terrain depth; it does not perform order-independent transparency between overlapping volumes.

## Verified behavior

- Sixteen Node tests pass, including north/level orientation, straight-down rays, range and sky misses, unknown terrain, near-ridge obstruction, antimeridian/high-latitude geometry, concave polygon area, atomic validation, zero altitude, all RGB encodings, camera far range, and zone interior terrain sampling.
- Eighteen packed-consumer browser checks pass. New checks cover AGL/MSL placement, missing and below-terrain fallbacks, globe shader compilation, owner/attachment selection, basemap restoration, removal, and raw custom-DEM coverage unchanged with terrain off/on and exaggeration 0.5, 1, and 2.
- Strict TypeScript checking, library build, and production playground build pass. The existing large-chunk warning remains.
- The real-terrain playground was inspected with the selected expanded inspector. Production measurement details are in `docs/performance.md`.

The camera-appearance follow-up passes 17 Node tests and 19 packed-consumer browser checks. Rendered-pixel assertions cover custom color and opacity, wireframe-only rendering and picking, and hidden volumes losing their hit target. Type checking and the production playground build pass. Live playground review covered compact controls at 492 and 1280 pixels, color/strength edits, the independent wireframe toggle, and appearance retained during movement. The existing large-chunk build warning remains.

Desktop Safari, long-session memory profiling, external DEM outages during sustained motion, and precision against surveyed terrain remain unverified. Results do not establish a maximum load ceiling.

## Relevant renderer contracts

- [Elevated symbols](https://maplibre.org/maplibre-gl-js/docs/examples/elevate-symbols-above-the-terrain/) and [symbol height properties](https://maplibre.org/maplibre-style-spec/layers/#symbol-height-offset).
- [Custom 3D layers](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) and [projection inputs](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/CustomRenderMethodInput/).
- [Map terrain queries](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#queryterrainelevation): displayed elevation cannot supply the required terrain-off physical calculation. The pinned local renderer source was also inspected for pixel-centre sampling and symbol elevation behavior.

## Mock boundary

The original static A/B/C mock remains a layout review artifact. Its screenshot and illustrative geometry are not runtime correctness evidence. Implementation and runtime checks above are separate.

## Patchy footprint rendering fix

The original footprint used custom triangles lifted two metres above sampled terrain. A display DEM only five metres higher hid otherwise visible coverage. The packed-consumer pixel test reproduced missing fill at all four unobstructed sample positions (`0,0,0,0` green-channel values); matching display and sample heights made it pass. Footprints and ground zones now use native draped fill/line layers, while airborne volumes retain the custom depth-tested layer. The failing five-metre mismatch now passes, as do selection, style restoration, removal, and physical-coverage checks. Internal triangle antialiasing is disabled to prevent seams. The raw terrain visibility calculation is unchanged.

## Terrain obstruction correction

The pre-fix volume had no terrain input, so its maximum-range shell continued through hills. A deterministic fixture found 1,456 underground volume vertices. Footprint faces connected visible corner hits without checking the ground inside the triangle; a smooth hill fixture showed hidden terrain painted at 355.7 m north. Fixed-count ray marching also skipped a nine-metre ridge at 5 km range. The new tests separately cover interior shadow exclusion, short ridges on long rays, grazing crests, deformed rims, and a volume that must not reappear above ground beyond a ridge. A packed-consumer pixel test checks that the visible approach stays green and the hidden slope does not.

The former vertical-step ridge test snapped ray hits onto a roof above the camera's FOV. Its terrain fixture now has a sloped approach, allowing a physically visible ground patch while retaining the same far-side obstruction assertion. Unknown terrain continues to withhold geometry. The raster sampler now evaluates interior bilinear samples directly, retaining the existing neighbour-tile path at borders.

Temporary timing logs and the paused-by-default debugging change were removed. No performance or high-rate movement guarantee is added; see docs/performance.md.

Final verification: `pnpm check`, all 22 Node tests, all 20 packed-consumer browser checks, and `pnpm build:playground` pass. The existing chunk-size warning remains. The live single-asset scene was inspected with the corrected geometry, then paused through its normal controls for review. No browser errors were reported.

## Movement performance repair

The terrain correction caused sustained main-thread stalls. Built-in raster geometry now runs in an inline-bundled worker, with one active task and the newest pending input per entity. Completed positions keep native markers aligned with their camera geometry. Changed settings, elevation replacement, removal, and destruction invalidate obsolete results. Render buffers and ground GeoJSON update only when geometry changes.

DEM maximum-height blocks permit conservative clear-air skips. A flat-ground fixture produces identical meshes with 118,971 height samples instead of 905,869. Unknown terrain and narrow ridges retain the fine-sampling path. Worker startup failures report a diagnostic before synchronous fallback. The packed-consumer test explicitly rejects this fallback. See `docs/performance.md` for live measurements and remaining computation latency.

Performance repair verification: strict TypeScript, 28 Node tests, 20 packed-consumer browser checks, and both builds pass. The final production single-asset run recorded 119 UI frame callbacks/s and all 100 requested movement batches in ten seconds. Computation p95 remains 256.4 ms in the worker.

## GPU experiment

The user selected a separate GPU sensor-depth prototype after the worker path remained visibly discontinuous. See [GPU prototype results](gpu-prototype.md) for its scope, ridge readback check, measured sensor update rates, and integration limits. The experiment runs at `/gpu-camera.html`; the subsequent integration is described below.

## GPU integration into the main map

`src/gpu-cameras.ts` owns sensor depth maps, deformed volumes, mask transfer, raster overlays, and GPU volume picking. `src/gpu-camera-shaders.ts` keeps the shared depth convention and receiver-plane visibility correction together. `src/gpu-camera-terrain.ts` caches raw DEM patches with a movement margin. Flat maps use this path for built-in raster providers between 20 m and 10 km range and below 80 degrees latitude. Other cases retain the existing CPU path.

A top-down mask passes through pixel-pack buffers and fences rather than blocking the main thread on readPixels. At most two mask copies wait per camera; removed cameras release their pending copies, and obsolete appearance results are discarded. The native raster overlay drapes on MapLibre terrain and remains independent of displayed exaggeration. Cropping transparent mask borders limits expensive terrain recomposition. No MapLibre private renderer properties are used.

The single-asset demo advances from elapsed frame time. The multi-asset load scenario retains its requested 10 Hz input rate. Ground zones use fewer CPU triangles when a conservative DEM bound proves the whole draped area is available. Marker placement and non-camera attachments remain in the existing entity renderer.

GPU camera updates are counted separately from UI frame callbacks. CPU preparation time excludes GPU work, asynchronous mask transfer, and native terrain compositing. Public state exposes optional cameraUpdates and cameraUpdatedAt; raster footprints have no CPU footprint triangles.

The packed-consumer suite now explicitly exercises GPU ridge shadows, volume truncation, terrain-off projection, native draping, style replacement, deletion, footprint ownership, custom volume color/opacity, wireframe-only picking, and hidden volume removal. The original CPU fixtures continue to exercise fallback paths.

The production full-map run with all single-asset attachments enabled measured 41.6 fresh sensor updates/s and 0.7 ms p95 CPU preparation at 1280 × 720. The isolated prototype's 120 updates/s is not a full-map claim. Details and latency caveats are in `docs/performance.md`.

Final integration verification: strict TypeScript, 31 Node tests, all 22 packed-consumer browser checks, and the library and playground builds pass. The real main-map scene reports coverage ready with no browser errors. The standard large-chunk warning remains.

## Moving footprint polish

A deterministic 48-frame browser fixture moves one downward-facing camera in one-metre steps over flat DEM terrain. Before the fix, painted footprint area varied from 19,632 to 28,336 pixels. Image bounds were being changed in custom prerender, after MapLibre had already prepared source textures. That paired new crop coordinates with an older texture during the current frame. Completed mask readbacks now publish once after rendering, so the following frame uploads pixels and prepares the matching bounds together.

Coverage filtering compares four neighbouring sensor-depth samples against the receiver plane before interpolating visibility. Inverse forward depth gives the plane correction in sensor UV space. FOV and range edges fade inward over one mask pixel; native raster sampling is linear and crops include a transparent border. Terrain tolerance remains 0.35 m. This is spatial antialiasing, without blending stale camera positions into the current mask.

The moving-footprint check requires area variation below 10%, no centroid jump of four screen pixels for a one-metre movement, and fractional edge coverage. Ridge-shadow, truncated-volume, appearance, picking, style replacement, and removal checks remain in the browser suite.

## Isolated coverage speckles

A deterministic rough-terrain fixture reproduced sixteen enclosed one- or two-texel holes in the GPU footprint. It checks the published raster mask at three adjacent sensor positions and independently reads a pixel behind a broad ridge. A simple neighbour vote reduced noise but could trim a connected shadow and leave a new isolated remnant.

The final GPU filter checks both members of a potential pair and all surrounding neighbours. It fills only complete components of one or two low-coverage texels, including diagonally connected pairs. Larger connected components and the outer boundary remain unchanged. The fill uses the weakest surrounding solid alpha, and a solid neighbour must exceed seven-eighths of the nominal footprint opacity. The sensor depth comparison and its 0.35 m tolerance are unchanged. This deliberately suppresses terrain occlusion smaller than that display threshold; at 2 km range, one mask texel is approximately 10 m wide.

Filtering uses one full-screen GPU pass with a shared RGBA target before asynchronous readback. The displayed footprint and picking consume the same filtered mask. Resources are released on layer removal; no temporal accumulation or CPU terrain work was added. The sixteen small components disappear in the fixture while the broad ridge shadow remains unpainted. Strict TypeScript, 31 Node tests, 24 packed-consumer browser checks, and both builds pass.

## Temporal diagnostics and replay

The remaining live-map flicker is not established as fixed. The new `onCameraDiagnostic` observer captures sensor/terrain revisions, mask queue/discard/publication events, matching mask positions, camera/display settings, crop bounds, mask age, and alpha changes. It is opt-in; observer exceptions cannot trigger renderer fallback. The playground enables bounded local trace recording with `?cameraDiagnostics=1` and a download action. Publication timestamps precede final display and must not be read as presentation latency.

`pnpm test:camera-motion` records 48 consecutive intermediate frames for each of eight simulated cases: flat or rough ridge terrain, with footprints, filled volumes, both, or wireframes. Poses hold, advance in quarter-metre increments, reverse, and hold again. All eight cases passed the stationary and flat-interior brightness checks. Rough-terrain changes are measured rather than automatically classified as defects. The replay records PNGs, per-frame metrics, renderer trace events, browser logs, and a standalone HTML player.

The sensitivity control `pnpm test:camera-motion --inject-flicker` deliberately hides a held footprint for one frame and correctly fails at frame 4: 55,809 changed pixels, including 48,417 interior brightness drops. It saves separate failure artifacts. The ordinary simulation passing does not reproduce or rule out the user's remaining real-terrain flicker; real provider LOD, driver behavior, wider motion, and other camera poses remain outside this small fixture set. Live diagnostic samples showed mask ages of 20.5–23 ms and one terrain revision, not a confirmed explanation for the visible artifact.

### Continuous ground coverage follow-up

The user clarified that solidity means steadier coverage, with unchanged transparency. The synthetic unobstructed downslope passed, but the live Mapterhorn alpine route reproduced interior flashes consistently: up to 37 pixels darkened in a frame under quarter-metre movement. Crop bounds remained constant. The new route assertion failed before the filter change.

The GPU filter now follows complete eight-connected low-coverage components, filling only those with at most eight mask texels total. Previously the limit was two. A component connected to a larger shadow or the image boundary stays unchanged; the fill uses the weakest surrounding solid alpha. The reproduced alpine route now has zero interior dropouts, with opacity still 45%. This intentionally simplifies small real occlusions along with sampling speckles; it does not change sensor depth tolerance or add temporal persistence.

The alpine case is opt-in because it uses the public terrain provider. `pnpm test:camera-motion --scenario=alpine-footprint` runs it. The default suite also adds an unobstructed downslope in all four display modes. Wider motion, other terrain locations, and driver-specific behavior remain outside the reproduced case.

Validation after the continuity change: strict TypeScript, 31 Node tests, 24 packed-consumer browser checks, all 12 synthetic motion cases, the opt-in alpine footprint case, and both builds pass. The synthetic DEM remains encoded with zero base shift so the displayed and sampled heights match. The full software-rendered motion suite has a six-minute timeout for its twelve cases.

### Selected four-corner grid diagnostic

The user selected C from the camera-cell prototype: world-anchored coarse terrain squares with four corner rays, green only when all corner samples are visible, red when any is blocked. The preview is preserved at `/Users/lanearaujo/.codex/visualizations/2026/09/23/01a0ceb3-13aa-7131-bb07-2ac2e507e453/camera-cell-prototype.html`.

`CameraAttachment.debugCellSize` selects the GPU-only diagnostic. The depth pass and source terrain detail remain unchanged. Cached per-instance corners and receiver normals follow the existing terrain triangles; instanced lines sample the sensor depth without CPU ray marches or coverage-mask readback. The diagnostic draws blocked geometry through terrain and dashes the ray after its first depth hit. Normal coverage and attachment picking are restored when the option is removed. Diagnostic lines themselves do not pick attachments. Four clear corners are a sampled result, not a guarantee for the entire cell interior.

The single-aircraft demo enables 50 m cells by default, with independent cells/rays switches and a normal-view toggle. Large requested grids use a coarser integer multiple to bound work, reported in trace events. Existing CPU, globe, unsupported range, and custom sampler paths retain normal coverage.

Validation: 34 Node tests, 24 packed-consumer browser checks, strict TypeScript, and both builds pass. The opt-in 48-frame alpine-cells motion capture passes stationary stability and visible-image checks; moving line changes are recorded rather than classified as footprint holes. Live controls were checked at 100 m and 50 m and through normal/grid switching. A ten-second local Chromium run at 50 m, with tracing enabled, measured 76.1 map renders and fresh sensor updates per second, p95 UI frame interval 17.3 ms, and p95 update submission 0.20 ms. This is a short local observation, not a GPU-duration or end-to-end latency measurement.
