# GPU camera terrain visibility

The playground colors visible and hill-blocked ground separately, with configurable colors and opacities. A cached 257×257 terrain mesh supplies physical elevations. A 2048×2048 linear-depth sensor target records terrain in the camera view. The map drapes the completed 1024×1024 color mask over terrain using a native raster source.

Completed pixel-buffer transfers publish asynchronously. Movement does not run CPU ray marching or rebuild the mesh inside its cached margin. Missing terrain stays unshaded. Terrain coverage stays inside the same finite camera volume used by the wireframe. Floating-point color targets are required; failures report a diagnostic. The old `cameraDiagnostics` query parameter is ignored.

## Boundary refinement

The first pass classifies 1536×1536 terrain locations. Nine locations contribute visible and known fractions to each cell in a 512×512 coarse grid. The final pass inspects the cell and its eight neighbors. Entirely visible or blocked neighborhoods retain a solid color; empty neighborhoods remain transparent.

Every remaining pixel tests an 8×8 pattern of smaller positions directly against sensor depth. Each position compares the four neighboring depth texels, then interpolates their visibility results. Positions follow the local mesh triangle plane using ground-position derivatives. This reaches one eighth of a display texel, rather than interpolating the old binary vote. Neighbor checks include boundaries between individually uniform cells. Camera side-plane, end-cap, and range clipping apply to every smaller sample.

The visible and blocked area fractions determine the final pixel color and alpha. Transparent colors do not tint the other region. Linear raster sampling removes square-pixel magnification during display. A spatial smoothing pass then suppresses small visibility islands before styling. There is no temporal history.

The terrain mesh and depth map still limit accuracy. Refinement cannot recover a ridge missing from those inputs, and local-plane interpolation approximates positions spanning a triangle boundary. Tiny occluders missed by the coarse boundary search may be omitted. This is a bounded raster contour, not an exact vector boundary or an adaptive DEM fetch.

## Slope correction and checks

Depth comparison intersects the local terrain triangle plane with the sensor depth texel's actual ray. Derivatives are evaluated before clipping. This avoids the former capped first-order correction that produced false shadows on steep unobstructed slopes.

Browser tests cover flat ground, genuine hill shadows, movement across an unobstructed slope, and a controlled depth boundary moving by less than one display pixel. The focused shader test checks a narrow transition and independent transparency. Synthetic tests do not establish visual stability on all real terrain.

## Cost

The final mask remains 4 MiB per camera update. Sensor resolution increased from 1024 to 2048 per side, so sensor attachments require four times the storage. Boundary pixels evaluate 64 positions with four depth comparisons per position; solid neighborhoods skip these comparisons. CPU elevation sampling is unchanged. Real-terrain frame rate and motion quality still need evaluation.

See [lessons learned](camera-lessons-learned.md).

## Region borders and camera volume

Measured coverage is retained in a separate GPU texture before styling. A styling pass finds changes in visibility and footprint coverage, drawing a border in the color of the region on each side. This does not change visibility classification. The outline toggle controls both internal borders and the native footprint outline. Internal borders use mask-space width, so apparent width changes with map scale.

The playground uses restrained treatment A: muted green `#60a078` and red `#c46a60`, 13% visible fill, 18% blocked fill, 10% cone shading, a 3 px muted wireframe, and a 1.5 px ground border. Cone shading and wireframe are independently adjustable. All four corner rays end at maximum slant range; the four side triangles stay on the FOV planes. Shared scene depth hides portions beneath displayed terrain. The volume no longer samples and vertically drapes its perimeter. Ground coverage is classified only inside this finite volume, including its end cap. It retains blocked regions behind terrain rather than terminating the entire analysis at corner-ray terrain hits.

## Depth-pixel transitions

A controlled GPU test reproduced visibility snapping from 0 to 255 across a fraction of one sensor texel. Visibility now uses bilinear weights over four separate depth comparisons, with receiver-plane correction evaluated at each texel ray. Depths themselves are never blended. The coarse grid retains fractional visibility so an uncertain boundary is sent to refinement instead of becoming a solid cell. This adds no temporal history or delayed transitions. It reduces sampling shimmer within one sensor texel; it does not establish that every real-terrain flicker is gone.

## Analysis reuse and bounded ground work

Each camera retains its measured coverage independently. Changes to origin, bearing, elevation, either FOV, range, volume, or terrain invalidate analysis. Changes to colors, opacities, and borders reuse coverage and perform one styling draw instead of all six rendering passes. Repeated equivalent inputs submit no new GPU work. Completed transfers retain their submitted terrain coordinates; obsolete appearance results are discarded before readback.

Ground classification and refinement use a padded scissor rectangle around the maximum camera range. The full targets are cleared first. Sensor depth remains uncropped so intervening terrain still blocks the camera. Scissor state is restored before returning control to MapLibre. This skips ground beyond camera range without changing terrain or sensor resolution.

The renderer's internal `getDiagnostics()` reports submitted analysis, style, and publication counts. They are work counters, not GPU timing measurements. Retaining coverage adds a 4 MiB texture for each additional camera beyond the first; the 4 MiB publication transfer remains.

## General zone smoothing

A 7×7 weighted neighborhood smooths the measured visible/blocked fractions before styling and outlining. A soft majority threshold removes small islands while keeping larger region interiors solid. This operates on classification, not the final colors, so fill colors and opacity remain independent. Each pixel retains its original footprint coverage; unshaded areas are not filled by neighbors. Outlines follow the smoothed regions.

The radius is three pixels in the 1024×1024 ground mask, so its physical size depends on camera range and the cached terrain patch. At a 6 km range the radius is about 46 m. Narrow real obstructions and small visible gaps can disappear. This intentionally favors a steadier approximate display over fine visibility detail. It adds one GPU pass and one shared 4 MiB temporary texture, with no extra CPU transfer. Appearance-only updates still reuse the result.

## One camera volume and one published pose

`camera-volume.ts` constructs four normalized corner rays at the configured range and their common end-cap plane. The drawn sides, eight wireframe segments, and GPU end-cap test use that same result. Upward rays remain upward; they are never forced onto ground. Terrain-depth visibility still determines red versus green within this finite pyramid. The plain non-visibility ground overlay keeps its legacy reference-plane projection, but it no longer defines GPU coverage or deforms the wireframe.

GPU transfers retain their complete submitted camera snapshot, including geometry. After a rendered frame, publication installs the completed image and matching volume geometry for the next frame. New telemetry can be queued while the previous completed pair stays visible. Camera geometry does not jump ahead of its mask. This introduces shared presentation latency, not a claim of zero latency. Entity markers continue following current telemetry.

Bearing and elevation control aim; horizontal and vertical FOV control angular width. +90 degrees points up and -90 degrees down. Tests check that all rendered corner offsets stay collinear with the FOV rays, remain within range, and share a common cap. GPU checks reject coverage beyond that cap. Browser movement checks compare published mask origins with actual camera geometry, while hill-shadow tests preserve visible and blocked regions.

## Hide wireframe behind terrain

Display edges are clipped using the cached camera terrain mesh. Each corner line ends at its first terrain crossing and cannot resume beyond the hill. Far-cap edges are split into short segments and retained only where endpoint and midpoint rays are clear from the camera. This affects wireframe display only: the finite analysis volume and red blocked-ground coverage remain intact. It adds bounded CPU mesh sampling, but no additional DEM requests. Sampling uses half-cell ray steps and a refined hit interval; features below the cached terrain resolution may still be missed.

The wireframe also joins neighboring terrain intersections along each FOV side, including midpoint samples. This draws the cone's ground-contact outline using the existing wireframe color and width. Rays that miss terrain do not create ground edges, and skyward cameras do not gain an invented footprint. The outline uses cached-mesh intersections, so detail remains limited by that mesh.
