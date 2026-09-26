# Camera overlay lessons learned

## September 24 reset

At this reset, the camera feature aimed to draw only a four-sided ground overlay. It does not determine visibility, detect terrain collisions, classify blocked ground, draw rays, or render a viewing volume. Other map features, entity placement, and attached zones remain independent.

## What the experiments taught us

- Terrain draping and visibility are separate problems. A polygon can follow hills without proving the camera can see them.
- CPU terrain ray marching became expensive with moving cameras. Moving computation to a worker did not remove its cost or stale-result lifecycle.
- GPU depth comparisons were much faster, but nonlinear depth reconstruction produced false blocking at long range. In the app-browser flat-ground probe, 396 of 400 cells were incorrectly red. Linear forward distance reduced that to zero.
- On the alpine probe, linear depth reduced false-red cells from 230 to six while preserving the 1,604 reference-blocked corner samples. The six remaining disagreements were not resolved. These were specific test results, not a guarantee of visibility accuracy.
- Marking a whole cell blocked when any corner failed magnified small errors. Four visible corners also never proved that the cell interior was visible.
- Requested versus effective grid spacing made the size control misleading. A 50 m request could produce 150 m cells at the 6 km preset.
- Grouping, per-status colors, ray dashes, depth targets, readback queues, fallback paths, and multiple view modes accumulated much faster than product value was established.
- Separate geometry from appearance. A color change should not require a new terrain analysis.
- Deterministic flat-ground tests and real-terrain comparisons exposed errors that screenshots and frame-rate measurements alone missed.

## Simpler contract

Use altitude, bearing, elevation, horizontal/vertical FOV, and range to project four corner rays onto a horizontal reference plane at the terrain elevation beneath the asset. Downward rays stop at that plane or maximum slant range, whichever comes first. Corners pointing above the plane use the range endpoint's horizontal position. A completely upward-facing camera produces no ground overlay. MapLibre drapes the resulting quadrilateral; hills along its path do not alter the boundary.

Keep one color, fill opacity, outline toggle, and outline width. The high-altitude preset remains an ordinary saved configuration. No grid, sampling-quality controls, blocked-state styling, sensor depth maps, footprint repair filters, camera workers, or experimental renderer modes remain in the runtime.

This is a directional overlay, not a viewshed. Do not describe its fill as visible terrain. If visibility is requested later, treat it as a separate capability with an explicit accuracy/performance contract and ground-truth tests.

## Visibility reintroduced after the reset

The user selected separate visible and blocked color/opacity controls. Visibility now samples the existing footprint at 16×16 cell centers, using at most 64 height samples per target, a 2 m target clearance, and a 200 ms analysis reuse window for moving cameras. Same-status neighbors share row polygons without individual box outlines. Missing elevations stay unshaded. This bounds cost but can miss narrow ridges and within-cell detail. The native draping renderer, footprint boundary, and original optional plain overlay remain. No camera volume, debug rays, GPU readback, or worker pipeline was restored.

## GPU visibility restored

The coarse CPU version produced oversized regions and poor movement performance. Replace it with a cached terrain mesh and GPU depth comparison. Preserve linear forward depth to avoid the earlier precision failure, receiver-plane correction to reduce self-shadowing, and asynchronous pixel-buffer transfers so mask publication does not synchronously wait on unfinished GPU work. Keep the two colors and independent opacities. Do not restore cell boxes, diagnostic rays, or camera volumes. Resolution remains bounded and missing terrain remains unknown.

## Sharp grid and false slope blocking

The restored renderer still softened cell boundaries with linear raster filtering and a blended visibility threshold. Use nearest-neighbor sampling and binary visible/blocked colors for the requested square-grid appearance. A synthetic unobstructed 40% slope exposed 726 falsely blocked pixels out of 9,088 shaded pixels. Replace the capped 2 m depth correction with a terrain-plane intersection at the sensor texel center, evaluating derivatives before any fragment discard. The corrected full-mask test reports zero falsely blocked pixels, including during movement, while the ridge-shadow test still passes. This verifies those synthetic cases, not every real terrain silhouette.

## Hysteresis trial

The user selected hysteresis after continued motion flicker. Store classification separately from styling and look up prior state by ground coordinates. Use separate transition thresholds instead of averaging colors or smoothing terrain. The GPU test holds state across repeated small depth changes, then verifies that stronger changes switch it. This is a stabilization trial, not evidence that all real-terrain flicker has been eliminated.

## Replace hysteresis with spatial voting

The user still observed flicker with hysteresis and requested its removal. Remove the history textures, ground-history transform, and separate transition thresholds. The replacement tests nine terrain locations per cell on the GPU and uses a five-of-nine majority. This can suppress narrow real obstructions as well as noisy samples, and increases GPU classification work. Keep sharp cell edges and independent styling.


## Refine mixed boundaries

Whole coarse cells changing color made the remaining flicker conspicuous. Keep the majority vote for uniform regions, but refine mixed cells from the existing terrain samples with a sliding vote and a finer display mask. This allows curved contours made of smaller raster steps without blending the two display colors. Do not restore temporal history. The extra GPU pass and larger mask transfer need real-terrain performance evaluation; synthetic boundary tests alone cannot establish motion quality.


## Re-test depth at the contour

Refining binary votes and magnifying the mask with nearest-neighbor filtering still looked tiled. Replace the sliding-vote display pass with direct subpixel depth comparisons near coarse boundaries. Inspect neighboring cells so two uniform cells with different classifications still get refinement. Increase sensor resolution to retain more silhouette detail, then calculate color from measured visible and blocked area. The final raster can use linear reconstruction after this measurement. This does not add DEM detail to the cached mesh, and remains bounded by mesh and sensor resolution.


## Continuous sensor sampling

Subpixel ground refinement still used a nearest-pixel sensor lookup. Tiny movement across that sensor boundary produced raw visibility values 0, 255, 255 in a controlled GPU test. Compare four neighboring sensor depths separately against the receiver plane, then interpolate visibility using the sample's position. Do not interpolate terrain depths or restore the rejected temporal-history mechanism. Preserve fractional visibility in the coarse grid so it can request boundary refinement. This targets one reproduced source of shimmer and increases depth reads; real-scene flicker may have other causes.

## Learn from existing terrain projectors

The OpenGlobus UAV/projector examples and Cesium SensorShadow use a sensor-depth pass followed by GPU projection or classification. Ridgeline already uses that core technique. Copying their engine-specific rendering internals would not remove MapLibre's integration boundary. SensorShadow also has incomplete changing-aim updates; its class should not be adopted unchanged.

Keep pose and terrain invalidation separate from appearance. Coverage is now cached per camera, and color, opacity, or border edits run only styling and publication. Equivalent input objects no longer force another analysis. All camera geometry inputs still invalidate together. Completed transfers carry their original terrain and appearance; superseded appearance results are discarded before CPU readback, avoiding a stale-color flash and unnecessary transfer.

Limit ground passes to the footprint's padded raster bounds while retaining the full sensor-depth pass. Cropping the latter could omit a real occluder. The ground textures are cleared before scissoring so prior coverage cannot linger outside a moved footprint. This preserves depth resolution and contour sampling instead of trading accuracy for a lower sample count.

The cost is one retained 4 MiB coverage texture per camera, replacing the former shared coverage texture. Native MapLibre image publication still transfers a 4 MiB color mask per completed update. These changes do not prove that all terrain-motion flicker is fixed or eliminate that transfer. References and source limitations are recorded in `.scratch/camera-implementations/findings.md`.

## General smoothing accepted

The user explicitly accepted losing fine visibility detail to remove distracting small blocked patches. After depth classification, apply a weighted 7×7 spatial filter and soft majority threshold to the visibility fractions. Keep the original footprint coverage and apply colors, transparency, and borders afterward. This can suppress real small obstructions and small visible islands; it does not alter DEM accuracy or claim exact line of sight. The filter uses a three-mask-pixel radius, rather than a constant physical distance. Cached smoothed coverage still supports appearance-only restyling.

## Do not clip terrain visibility to a flat-plane guide

A projected ground quadrilateral is not a conservative bound on the camera's view of hills. Remove it from the visibility shader and cover the full camera-range bounds during ground passes. Keep actual frustum and slant-range checks. The near-hillside browser fixture now receives visible coverage where the old polygon excluded it. Camera angle wiring and angular widths were checked independently; tilt changes ground projection size, not angular FOV.

## Correction: the pyramid footprint is the display boundary

The user clarified that the four corner lines and their terrain footprint define the region to consider. The previous full-frustum expansion was the wrong product behavior. Restore the shared four-corner clip, while retaining terrain visibility and smoothing within it. Do not expand colored coverage past that boundary merely because a hill is inside the mathematical frustum. The current perimeter remains terrain-draped from a reference-plane projection, rather than exact DEM ray intersections.

## Correct malformed corners and mismatched frames

The old footprint forced upward and range-limited corner rays onto the ground. At the 2,000 m preset, that bent the upper corners by about 27 degrees and extended their drawn distance beyond the 6,001 m range. Draping perimeter heights independently also warped the side planes. The old tests checked rays and selected ground pixels, not the rendered volume.

Use one finite volume with four straight maximum-range corner rays and a common cap for drawing and GPU clipping. Do not cap the entire volume at the corner rays' first terrain hits: that experiment removed valid approach coverage and hill-shadow regions. Scene depth hides buried geometry; sensor depth classifies visible and blocked terrain inside the volume. This removes the extra CPU perimeter sampling.

Publish the completed camera snapshot and mask together after drawing, before the next frame's image upload and geometry preparation. Updating the wireframe to new telemetry before the matching mask arrives violates the boundary contract even if both calculations are individually correct. Regression checks now cover corner collinearity, cap/range limits, outside-cap pixels, and matching published geometry during movement.

## A wireframe should not reappear beyond a hill

Map-view depth testing hides buried segments, but a long ray can leave a hill and become visible again on the far side. Clip corner display lines at their first cached-mesh terrain hit, and suppress far-cap segments occluded from the sensor. Keep the analysis volume unchanged so blocked ground remains red. The new ridge test checks all four rays end before the crest and that no far-cap segments remain.

## Draw the ground-contact contour

Stopping corner rays at terrain left the base visually open. Join neighboring first-hit points along the FOV perimeter, using the same ray intersections already needed to hide far edges. Preserve gaps where rays miss terrain instead of forcing those endpoints down. Tests cover a ground outline on flat terrain, a ridge, and no invented ground edges for a skyward camera.
