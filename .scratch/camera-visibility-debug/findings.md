> Archived experiment: the visibility renderer and executable probe were removed in the four-corner overlay reset. Commands below are historical. See `docs/camera-lessons-learned.md`.

# High-altitude preset: false blocked cells

2026-09-24. Checkout HEAD 7698e95 plus the existing uncommitted camera implementation. This investigation changes only the isolated debug harness under this directory. Production shaders and the playground remain unchanged.

## Reproduction

The harness uses the current depth-pass shader, terrain triangles, grid construction, and `cornerVisible` shader function. Transform feedback reads each corner decision directly, before coloring, outlining, or grouping. Sensor: 2000 m AGL, bearing 105 degrees, elevation -10 degrees, 60 by 40 degree FOV, range 6001 m. Origin 6.864, 45.918, the preset's initial position. Requested 50 m cells become 150 m. Counts include only cells with all corners in range/FOV. Corner counts include duplicate corners shared between cells.

The independent CPU reference tests the same piecewise-linear terrain mesh at every ray crossing of a horizontal, vertical, or diagonal triangle boundary, with a 0.35 m tolerance. These crossings include all possible clearance extrema. It is a reference for this mesh, not for higher-resolution real-world terrain.

Command:

```
PLAYWRIGHT_BROWSERS_PATH=/tmp/ridgeline-playwright node .scratch/camera-visibility-debug/run.mjs 'terrain=flat&assert=1' 'terrain=flat&linear=1&assert=1' 'terrain=alpine' 'terrain=alpine&linear=1'
```

The command exits 1 deliberately because the production flat-ground assertion fails. Adding `linear=1` selects an isolated experimental shader/depth target, not a production setting. `results.json` contains software-GPU outputs. Real alpine runs require elevation network access.

## App browser GPU results

| Terrain | Depth comparison | Red cells | Incorrectly red cells | False-blocked corner samples | False-clear corner samples |
| --- | --- | ---: | ---: | ---: | ---: |
| Flat | Production nonlinear depth | 396 / 400 | 396 | 1292 | 0 |
| Flat | Experimental linear depth | 0 / 400 | 0 | 0 | 0 |
| Alpine | Production nonlinear depth | 631 / 657 | 230 | 664 | 0 |
| Alpine | Experimental linear depth | 407 / 657 | 6 | 12 | 0 |

Both alpine variants retained all 1604 CPU-confirmed blocked corner samples. The experimental path leaves six false-red cells; the cause of those remaining disagreements has not been isolated. Changing the four-corner classification rule is not needed to remove the major error.

## Controlled comparisons on software GPU

Flat ground red cells: production 337/400; explicitly high-precision depth sampler 337/400; near plane 10 m 18/400; near plane 100 m 0/400; linear depth with original 1 m near plane 0/400. Repeated baseline and linear runs gave identical results. Alpine production 524/657 red with 123 falsely red; linear 407/657 red with 6 falsely red. No GL errors.

The 1 m near plane and 6001 m far range make nonlinear depth storage/reconstruction inaccurate enough to exceed the 0.35 m comparison tolerance. On the app browser the median uncorrected depth discrepancy for false-red alpine corners was about 0.84 m. This metric is explanatory only: the real shader also applies a receiver-plane correction. A single erroneous corner colors a whole cell red, magnifying the precision problem.

## Recommended next change

Store forward sensor distance in an R32F color attachment, while retaining the existing depth attachment for surface ordering. Read that distance directly for visibility, avoiding nonlinear depth reconstruction. The isolated experiment used EXT_color_buffer_float and retained the original near plane, terrain mesh, depth-map dimensions, tolerance, and four-corner classification. Moving the near plane alone is a useful diagnostic but risks clipping nearby terrain in other scenarios.

Before production adoption: test close obstructions, ridge silhouettes, short and long ranges, motion, float-target capability/fallback handling, volume clipping/picking, and remaining boundary disagreements. Do not widen the tolerance globally or discard all small red regions to mask this error.

## Integration follow-up

Linear forward depth is now integrated in `src/gpu-cameras.ts` and the shared sensor shaders. The depth attachment still orders terrain, the R32F color attachment stores forward meters, and the far-range clear uses `clearBufferfv`. Allocation, release, and the existing CPU fallback cover the added target and missing float-color-buffer support.

The probe now runs production linear depth by default; use `legacy=1` to reconstruct the prior nonlinear comparison. The old command above is historical. Current reproduction:

```
PLAYWRIGHT_BROWSERS_PATH=/tmp/ridgeline-playwright node .scratch/camera-visibility-debug/run.mjs 'terrain=flat&assert=1' 'terrain=alpine'
```

Post-integration: flat ground 0/400 red; alpine 407/657 red, six falsely red cells, zero false-clear corner samples. These remaining disagreements are still unresolved. The packaged browser suite includes an unobstructed high-altitude/long-range regression alongside ridge blocking, normal footprint/volume restoration, appearance, and picking tests.
