# Placement and screen-floor proposal for #85/#86

Read-only investigation on 2026-10-04. Canonical requirements: `/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/.scratch/entity-models/spec.md`, fetched `/tmp/ridgeline-model-context/issue-85.md`, and accepted #75/#77/#78. Reviewed CODE_CONVENTIONS.md, GLOSSARY.md, domain guidance, the three ADRs, and existing EntityScene/Elevation/EntityProjection ownership. No repository or tracker edits. No conflict with an accepted ADR identified. Root owns integration; implementation waits for #83.

## Executed results

`model-placement-probe.mjs` is an independent numerical reference, not production code. Run from `/tmp/ridgeline-model-projection` with `node --import tsx /tmp/ridgeline-model-context/model-placement-probe.mjs`. The resulting `.json` contains full cases, and `.log` summarizes assertions.

- 768 planar ground cases covered multiple headings, registration offsets, slopes, exaggerations 0/0.5/1/3, and physical/display scales from 0.3048 to 1000. Maximum normal error was 0.000000854°, clearance ranged from 0.0199999999995 to 0.0200000000041 m, and transformed dimensions differed from the expected rigid size by at most 6.83e-13 m. These are Euclidean local-plane calculations, not rendered terrain acceptance.
- 105 floor calculations used the actual shared EntityProjection with 35 captured public packed-viewport MapLibre matrices. They covered zoom 18/19/20, date-line coordinates and ±1 world copies, plus globe blends 1/0.75/0.5/0.25/0. Vehicle, tall narrow tower, and tilted ground-vehicle boxes reached 40 CSS px within 5.12e-8 px of the numerical target. World-copy comparisons differed by at most 2.08e-8 CSS px. A single `floor / originalExtent` scale overshot by 0.012–0.089 px in these cases; no sampled case undershot. Remeasure after scaling/contact placement instead of assuming exact proportionality. This reference uses 48 bisections as an oracle, not a recommended per-frame iteration budget.
- All 35 captured cameras kept an outward +Y triangle CCW with the proper fixed axis rotation; all 35 made it clockwise with the reflected axis mapping. This is projected-winding evidence, not a replacement for single-sided GPU rendering.
- Actual Elevation execution retained unknown heights while prepare was pending, notified the owner after resolution, and ignored a cancelled completion. An exact-point sampler exposed a real integration limit: the existing 10 supplied positions are center plus a 3×3 grid, including the duplicated center. A rotated corner between these positions remained null; after preparation settled, `requirePreparation` did not ask for the corner, and readiness was unavailable.

`model-placement-probe-frames.mjs` captures matrices through the public packed viewport on an ephemeral server, never port 5174. Captured `.json` records Chromium 153.0.8010.12 and the 35 cameras. It uses MapLibre 6.11.0 and the final #82 packed package from checkout `0f24d275099b83c999e3afa949f638959e589f16`. The browser only supplied matrices. No model rendering, contact screenshots, hardware benchmark, integrated recovery, or #85 acceptance was claimed.

## Axes, handedness and orientation

A proper fixed rotation from glTF +Y up/+Z forward to ENU is `[-x, z, y]`. Its determinant is +1. Thus authored **-X is physical right** for an asset facing authored +Z. Mapping `[x,z,y]` instead has determinant -1 and reflects the asset. Do not call that a fixed rotation.

Use body coordinates `r=-x`, `u=y`, `f=z`, then compose these operations in order:

1. Registered clockwise heading offset `o`: `r0=r*cos(o)+f*sin(o)`, `f0=-r*sin(o)+f*cos(o)`.
2. Positive right-side-down roll `rho`: `r1=r0*cos(rho)+u*sin(rho)`, `u1=-r0*sin(rho)+u*cos(rho)`.
3. Positive nose-up pitch `p`: `u2=u1*cos(p)+f0*sin(p)`, `f2=-u1*sin(p)+f0*cos(p)`.
4. Clockwise geographic heading `h`: `E=r1*cos(h)+f2*sin(h)`, `N=-r1*sin(h)+f2*cos(h)`, `U=u2`.

Angles are converted from degrees once. Apply this to the three authored unit axes to obtain basis columns. Multiply columns uniformly by `metersPerUnit * displayScale`, never by terrain exaggeration. Missing airborne pitch/roll is zero. Adding offset to heading after pitch/roll is wrong for an authored direction correction. For a +X-nose asset, offset +90, heading 0 and pitch +20, the correct nose is approximately `[0, 0.93969, 0.34202]`; the heading-sum shortcut leaves it `[0,1,0]`.

Culling must consider the complete projection. The Mercator north-to-negative-Y conversion is another reflection, but it does not justify changing `frontFace` in isolation. With captured MapLibre matrices, the proper mapping retained the outward top triangle under `gl.CCW`; the reflected current mapping rejected it. Use an asymmetric +Z nose, visibly distinct authored -X right wing, +Y mast, and differently colored outward single-sided triangles on multiple faces. Check headings, combined pitch/roll and offset, both projections, normal lighting, and double-sided behavior. A solid symmetric cube can hide a reflection or show its interior faces.

## Ground contact without deformation

For a known local displayed terrain plane `height(E,N)=c+a*E+b*N`, preserve heading while fitting slope:

- `F = normalize([sin(h), cos(h), a*sin(h)+b*cos(h)])`
- `U = normalize([-a,-b,1])`
- `R = normalize(cross(F,U))`

Map corrected body coordinates to `r*R + u*U + f*F`. This supplies ground tilt and ignores explicit pitch/roll when followSlope is enabled. When followSlope is disabled, use the explicit airborne orientation sequence instead. A symmetric finite-difference or least-squares grid fits a true plane exactly; a sampled uneven patch remains an approximation.

Center the parsed bounds at `(min+max)/2` in authored coordinates before transformation. Keep the transformed box center's east/north location at the entity's geographic anchor. For transformed base corners `q_i`, solve the vertical center directly:

`centerHeight = max_i(displayedGroundAt(q_i.E,q_i.N) - q_i.U) + clearance`

Use a small meter clearance such as 0.02; do not enlarge or exaggerate it. For a planar aligned base all four requirements are identical. With explicit arbitrary tilt, use all eight box corners when necessary so an inverted model does not bury its other face. Bbox contact is conservative and is not wheel contact.

Do not first lift by the lowest rotated corner and then only raise farther. A tested slope of 0.3 with a 2×2×6 m box produced 0.756 m of extra float with that shortcut. Recompute contact after display enlargement; otherwise the enlarged base can sink or float. Keep the unmodified raw geographic entity altitude and attachment origin separately from this display center.

For visible terrain, fit/contact against the displayed surface: apply exaggeration to sampled ground heights before fitting the plane, then rotate the rigid unscaled model to that plane. For terrain disabled, the displayed ground surface is flat at zero, while required raw center height still governs eligibility/below-terrain state. This is a recommended interpretation to keep contact consistent with the visible surface; real integration should pin it with a terrain-toggle fixture. Airborne display center follows the existing displayed entity altitude, but body offsets stay meter-sized.

## Small module boundary

Keep `model-placement.ts` synchronous and free of MapLibre, GL resources, registry ownership, events and async work. A useful input is parsed bounds, registered scale/offset, entity orientation/followSlope, the already resolved placement/known raw anchor height, terrain display settings, and displayScale. Supply raw HeightAt only through the scene-owned Elevation path.

Return a discriminated result:

- `ready`: authored bounds center, three ENU basis columns in meters per authored unit, displayed geographic center, the eight ENU box offsets from that center, and the terrain footprint/probes used.
- `unknown`: the missing required geographic probes plus conservative required footprint, without invented height or drawable geometry.
- `ineligible`: existing withheld/below-terrain/invalid-placement reason. Do not reinterpret offscreen or behind-planet culling as unavailable placement.

This fits core's proposed render records. #86 converts the displayed center to the one shared Mercator origin and packs `{ basis, anchor: [relativeX, relativeY, displayHeight, unitsPerMeter], appearance }`. It uses those same basis/corners for size, labels and last-drawn picking. Asset bounds/settings stay shared and immutable. No second feature store is needed.

The geometry and frame owner must agree one corner-to-world conversion. Current shader offset math is affine Mercator XY plus meter height. `localFrame` is an ECEF tangent conversion with curvature in altitude. They are close for small models but are not identical. Do not derive CPU boxes with one and GPU vertices with the other. Also account for whether height uses the anchor's units-per-meter or each corner latitude's units-per-meter. Resolve this inside the shared projection path and verify zoom 18–20; do not create a model-only projection formula.

## Elevation preparation and publication

EntityScene owns raw Elevation, area lifetimes, revision checks and recovery. Existing `set` computes placement radius from attachments only, so models need their own footprint even without attachments. A conservative radius is half the bounds diagonal times registered scale and current displayScale; heading/tilt cannot exceed that radius around the centered box. Preserve attachment requests when replacing or releasing model requests.

A practical integration can use one model-area key per entity, recognized by `entityIdForAreaKey`, or widen the existing placement area. Distinct model ownership avoids discarding unrelated attachment preparation. New ready assets, asset bounds/scale changes, entity movement, terrain configuration, and a larger required display footprint must invalidate that area. Enlarged ground footprint can change with camera motion, so preparation cannot occur only in `upsert`.

If contact samples actual transformed corners, preparation must include those exact positions. Extend the existing area request internally with explicit required positions, or use an equivalent bounded request that demonstrably prepares them. Include those positions, preparation bounds and sample range in request identity; current equality checks only center/radius. Containment/deduplication must preserve all required probes. The numerical exact-point-sampler reproduction shows why a matching radius alone is insufficient. A simpler grid-only fitted-plane contact policy can reuse the current grid, but must sample exactly that requested grid and explicitly retain uneven-terrain approximation limits; it cannot also depend on unrequested corner heights.

The frame coordinator may predict an enlarged footprint from the currently known plane, request its coverage through the scene, and withhold the model until its required samples are known. Do not request async work directly from the pure geometry function. Bound and coalesce repeated footprint requests; stop once the current frame's footprint is covered. Use the same raw sampler/range selection for readiness and contact. Unknown is null, including nonfinite sampler values; it is never zero. A model may be withheld while the existing ground marker remains eligible, and temporary unknown terrain must retain hysteresis choice.

After every consumer sampler/preparation or diagnostic callback, recheck both current feature identity and configuration/placement revision, plus registry/model revision where relevant. A callback can change terrain/exaggeration without replacing the feature. Checking only `feature === previousFeature` can publish stale old-configuration geometry. Removal releases work, configuration/provider reset cancels old work, and late completion cannot install geometry or emit changes. Existing `Elevation.changed` already schedules stationary recovery. Samplers have no new hot-swap API; stateful sampler changes without prepare use documented `retryUpdates`, while provider changes use configure/reset.

## Floor, clipping and remaining hard cases

Compute `max(maxX-minX, maxY-minY)` from all six projected box faces, clipping against near/far planes before dividing by W. Use CSS canvas dimensions, not backing-buffer pixels. A tall tilted model cannot be sized from horizontal radius alone. Use scale 1 when floor is zero or real size already exceeds the floor. Otherwise solve with bounded remeasurement after contact; the reference's high-iteration bisection is only an oracle. Pin a practical accuracy/iteration budget and measure its cost in #80.

Use one origin/world copy for all box vertices. Do not independently wrap corners near the date line. A box crossing the near plane needs face intersections, not just projection of surviving corners. Fully clipped/offscreen/behind-planet geometry produces no box hit but does not reset representation. The current shared `clip` returns null for back-planet points at almost-full globe; a face straddling that boundary needs a coherent partial-face policy, not an arbitrary whole-face disappearance. The present probes cover depth-plane clipping, not that limb case.

Keep model displayScale and contact lift out of attachment inputs. Ground markers/lines/areas remain at their original geographic points; airborne volumes and sensor geometry retain their raw origins and dimensions. The model's enlarged silhouette may cover them according to physical depth, but must not move them outward to match its visual edge. Labels/rings are separate presentation work.

Outstanding integrated evidence includes actual GPU culling/lighting, high-latitude and wide/tall bodies, partial planet-limb faces, near-plane boxes, exact CPU/GPU corner mapping, dateline elevation sampling, terrain-toggle/exaggeration contact, changing footprints under camera motion, delayed provider/sampler recovery and callback cancellation, unchanged attachment measurements, and visual records of uneven-ground float/intersection. Planar contact at enlarged size waits for #86 integration. Target hardware remains pending under #80/#91.
