# Globe projection diagnosis and correction review

Read-only investigation on 2026-10-04. No edits to the production or projection worktrees. Executed Node 24 / Playwright Chromium with SwiftShader. This is software-GPU evidence, not hardware acceptance.

## Mechanism

`node /tmp/ridgeline-model-context/globe-gpu-probe.mjs` is a minimal transform-feedback reproduction. It compiles the installed MapLibre 6.11 globe prelude, uses the captured failing projection matrix, and probes longitude 6.87 degrees, latitude 46 degrees, height 6 m. No server or test-suite port is needed.

The GPU returns sphere `[0.08308184146881104, 0.7193397879600525, 0.6895477175712585]`, matching the packaged failure. Double precision expects `[0.08309296131758714, 0.7193398003386511, 0.6896707993153136]`.

The angular input is almost exact: GPU 6.40308952331543 radians, expected 6.403089426791597. The trig output is not: GPU cosine 0.9926429390907288, expected 0.9928201093432615; GPU sine 0.11960101872682571, expected 0.11961701586160008. The exponential/latitude output is close to double precision.

GPU sphere coordinates evaluated with the CPU matrix predict screen `(312.84899, 175.54259)`. Actual GPU clip predicts `(312.84787, 175.53514)`. The independent correct reference is `(320.00180, 179.86278)`. Thus inaccurate large-angle GPU sine/cosine explains the displacement; matrix arithmetic contributes less than 0.01 CSS px in this reproduction. Centroid composition and uniform-binding mismatch are not needed to explain it.

Exact values are in `globe-gpu-probe.json`. The reproduction independently corroborates the projection worker's full packaged-browser transform-feedback probe.

## Correction review

Reviewed the uncommitted implementation in `/tmp/ridgeline-model-projection/src/entity-projection.ts` that introduces `u_globe_local`, `u_globe_origin`, `expDelta`, and `sphereOffset`.

The CPU precomputes east, north and up at the entity origin and multiplies that frame into the global camera matrix using double precision. The GPU computes local spherical offsets. For latitude difference `b`, longitude difference `a`, origin latitude `p`, and final latitude `q`, the returned local coordinates are:

- East: `cos(q) sin(a)`.
- North: `sin(b) + sin(p) cos(q) (1 - cos(a))`.
- Up offset: `cos(b) - 1 - cos(p) cos(q) (1 - cos(a))`.

These are the exact east/north/up dot products of the new sphere point relative to the origin. The half-angle tangent formula computes the correct latitude difference from Mercator Y. Longitude wrapping by whole turns preserves the sphere point. Scaling the offset by `1 + altitude/radius`, then adding altitude along local up, correctly includes elevation. Wide attachment geometry remains nonlinear.

The small-argument exp-minus-one polynomial prevents loss of meter-scale Y deltas. It is an approximation with negligible truncation at its 0.01 threshold for this workload, so avoid describing every arithmetic operation as mathematically exact. The underlying mapping is exact rather than a flat tangent approximation.

The worker already identified one portability correction: replace `pow(sin(angle / 2), 2)` with explicit multiplication. GLSL `pow` is undefined for negative bases even for the exponent 2. SwiftShader happened to return finite values, which does not establish portable behavior.

## Independent GPU exercise

Ran:

```sh
node --import /tmp/ridgeline-model-projection/node_modules/tsx/dist/loader.mjs /tmp/ridgeline-model-context/globe-correction-review.mjs
```

This imports the actual production module, records its `bindFrame` and `bindOrigin` uniform outputs, compiles its exported shader on real WebGL2, and compares transform-feedback clip coordinates with independent double-precision spherical coordinates.

39 sampled combinations cover origins at ordinary longitude, both sides of the date line, latitude 0 and plus/minus 85 degrees; zero and meter-scale deltas; much wider deltas up to 0.49 world; and elevations up to 10 km. No nonfinite result occurred. The original failing anchor's error becomes 0.00185 CSS px. The largest screen-coordinate difference in the sampled wide cases is 0.116 CSS px.

All cases used the same captured camera matrix, so many wide cases are offscreen or behind its camera. This establishes formula and GPU arithmetic consistency for those samples, not the visible-view acceptance matrix. The focused module tests verify CPU world-copy behavior, clipping, copied frame state and globe transition. The projection worker owns packaged browser validation across actual views and must also remove temporary probe instrumentation and restore test cleanup.

No new math blocker found. Actual globe hiding, near-plane rendering, date-line views, continuous transition and complete integrated browser regressions remain the projection worker's validation responsibility. Artifacts: `globe-correction-review.mjs` and `globe-correction-review.json`.


## Native depth continuation

The corrected geographic projection exposed a separate native-depth incompatibility at globe zoom 11, center longitude -539.99999 degrees, latitude 46 degrees, pitch 35 degrees and bearing 23 degrees. The physical entity is longitude -179.99999 at altitude 6 m. Baseline produced 26 partially clipped red pixels; corrected geometric depth produced none.

`node /tmp/ridgeline-model-context/globe-depth-probe.mjs` launches a bare MapLibre map on temporary port 5189 and binary-searches the actual depth-test threshold using one-pixel points. It clears only color within a scissor; native depth remains untouched. This probes the real globe depth pass and succeeds with WebGL error 0.

At the central expected pixel:

- Correct geometric model NDC depth: 0.9981310390206494.
- Correct geometric sea-level depth: 0.9981316811878337.
- Greatest tested depth that passes the native globe buffer: 0.9981195623986423.
- Model deficit: 0.000011476622007067228 NDC.

Across offsets of four screen pixels the deficit ranges from 0.00000170146 to 0.00002107250. A 0.000001 tolerance is insufficient and a larger arbitrary elevation would cover a substantial geometric error.

The native globe depth pass is `Painter._renderTilesDepthBuffer` in installed MapLibre `src/render/painter.ts:357`. It draws tessellated tile meshes using `depth.vertex.glsl`, which calls the same native `projectTileFor3D`. Both native globe and the custom 3D layer use `getDepthModeFor3D`, so depth-range mismatch is ruled out.

A second standalone transform-feedback run, `globe-gpu-probe-dateline.mjs`, shows native sphere coordinates are close to double precision at this longitude. Nevertheless, GPU global matrix arithmetic yields clip `[0.046875, 0.46875, 538.828125, 539.84375]`. Its NDC depth is about 0.99811867, which passes the measured globe threshold. The double clip has z 538.8115248537215 and w 539.8204281698272, giving 0.99813104. Large-coordinate cancellation in z/w creates the depth difference here. This differs from the earlier large-angle trig error, which dominated screen displacement at longitude 6.87.

The root/projection worker selected a compatibility correction: preserve accurate local x/y/w, but use `native.z / native.w * precise.w` for clip z, with native and precise projections using the same transition. This matches the native globe's depth convention without inventing an altitude lift. The measured native depth supports this choice. Full browser behavior is owned by the projection worker and was not independently re-run here.

Handle exactly zero native w explicitly rather than clamping the denominator to a small positive value. Exercise both signs near the camera plane and continuous projection blending. CPU picking still uses precise geometric depth, so real known-terrain rejection and overlap tests remain necessary. Retain the native-depth approximation as a documented renderer compatibility limit. Per-vertex native projection adds work and belongs in the later hardware measurements.

Artifacts: `globe-depth-probe.mjs`, `globe-depth-probe.json`, `globe-gpu-probe-dateline.mjs`, `globe-gpu-probe-dateline.json`. All are outside the repository. Port 5189 was closed after the probe; port 5174 was unused.
