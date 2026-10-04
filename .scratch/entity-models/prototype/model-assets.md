# Model assets and parser smoke checks

Prototype ticket: [Choose model appearance and switching behavior, #76](https://github.com/the-Drunken-coder/Ridgeline/issues/76). Acquisition and checks below were executed on 2026-10-04. These checks cover asset loading, not GPU rendering or browser performance.

## Acquisition

The picks match [#74's resolution](https://github.com/the-Drunken-coder/Ridgeline/issues/74#issuecomment-5974696379). The three Poly Pizza GLBs were downloaded unchanged from the live model pages. Their automatic source-format conversions were supplied by Poly Pizza, not performed for this prototype.

The Kenney ZIP was downloaded from the official Watercraft Kit page. The original `boat-speed-a.glb` references `Textures/colormap.png`. One `@gltf-transform/cli@4.5.1 copy` pass embedded that PNG. No quantization, mesh simplification, compression or joining was applied to any sample.

Run `node .scratch/entity-models/prototype/acquire-models.mjs` from the repository root to repeat acquisition. It uses Python's ZIP reader and installs the offline CLI through `pnpm dlx`. The playground has no new runtime dependency. Exact URLs and acquisition time are in [sources.json](../../../playground/public/entity-models/sources.json).

| Sample | Author | Page | File URL | Saved bytes | Triangles | Material batches | Embedded images |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| Drone | NateGazzard | [Drone](https://poly.pizza/m/DNbUoMtG3H) | [Original GLB](https://static.poly.pizza/4eb88feb-cb2d-46c3-980d-3e704868361c.glb) | 259,676 | 4,564 | 1 | 2,882-byte PNG |
| Tank | KolosStudios | [Tank](https://poly.pizza/m/egcLMSGiuA) | [Original GLB](https://static.poly.pizza/ba4513d6-e5c6-4a4b-a027-2eb7097d6516.glb) | 44,716 | 760 | 5 | None |
| Jet | jeremy | [Jet](https://poly.pizza/m/6fyLMORhgGK) | [Original GLB](https://static.poly.pizza/19d58465-dafb-4df0-a3b8-b0500bd9ed4b.glb) | 77,620 | 1,434 | 4 | None |
| Speedboat | Kenney | [Watercraft Kit 2.1](https://kenney.nl/assets/watercraft-kit) | [Original ZIP](https://kenney.nl/media/pages/assets/watercraft-kit/a335cfed49-1713519620/kenney_watercraft-pack.zip) | 25,084 | 156 | 1 | 8,814-byte PNG |

Original boat GLB was 16,520 bytes. Its separate PNG was 8,814 bytes. The repackaged GLB is 25,084 bytes. There are 11 material batches across all four model types. All samples are opaque; the boat is double-sided. Translucent material rendering therefore needs a separate fixture rather than a claim based on these assets.

| File | SHA-256 |
| --- | --- |
| drone.glb | `bc9f0d765e0fdb838a9baf26b472f955a11bb2509a3337e918054241b134638d` |
| tank.glb | `e6050023af3c703a912418adf2f6564b3e0068ba9cfdbc11dba18e047a50e653` |
| plane.glb | `4196c1920cec466a5211f8d9a86b3eb08ec1772e7e96e73cda7fede525f6e950` |
| boat.glb | `5c4c573f34b9dce89f551eb6501b031dc19f799d6cd9adf97e36857262968740` |

## Attribution

The first three models are [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The scenario must retain these credit lines with clickable source and license links:

- "Drone" by NateGazzard, https://poly.pizza/m/DNbUoMtG3H, licensed under CC BY 3.0, https://creativecommons.org/licenses/by/3.0/. Converted to GLB by Poly Pizza.
- "Tank" by KolosStudios, https://poly.pizza/m/egcLMSGiuA, licensed under CC BY 3.0, https://creativecommons.org/licenses/by/3.0/. Converted to GLB by Poly Pizza.
- "Jet" by jeremy, https://poly.pizza/m/6fyLMORhgGK, licensed under CC BY 3.0, https://creativecommons.org/licenses/by/3.0/. Converted to GLB by Poly Pizza.
- "Watercraft Kit" by Kenney, https://kenney.nl/assets/watercraft-kit, CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/. Repackaged to embed its PNG. Credit is optional under CC0.

Kenney's original [License.txt](../../../playground/public/entity-models/Kenney-License.txt) is retained beside the GLBs.

## Parsed bounds

These are default-scene bounds after node transforms, before the renderer's axis turn, centering or terrain placement. Coordinates retain glTF's +Y up.

| Sample | Minimum X, Y, Z | Maximum X, Y, Z | Front from #74 |
| --- | --- | --- | --- |
| Drone | -0.286715, -0.159208, -0.524731 | 0.286856, 0.048380, 0.256569 | +Z |
| Tank | -7.401291, -0.041452, -2.487616 | 3.944094, 3.537173, 2.574759 | -X |
| Jet | -4.975481, -0.671536, -4.986669 | 4.975474, 1.730182, 6.078570 | +Z |
| Speedboat | -0.892500, 0, -1.685000 | 0.892500, 1.500000, 1.685000 | +Z |

## Local parser checks

The strict focused TypeScript check passed with `pnpm exec tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck playground/entity-model-glb.prototype.ts`.

Executing the parser through `node --import tsx` accepted all four downloaded files. Array lengths matched, all geometry attributes were finite, and every index was within its batch's vertex range. A constructed strided triangle with translation and mirrored nonuniform scale had the expected bounds and outward flat normal. Named rejection smoke checks passed for required Draco, skins, sparse accessors, non-triangle modes, morph targets and external buffers. These were throwaway executable checks, not a production test suite.

Historical Node timing run before the final mirrored-transform change, 21 parses per model, first parse reported separately, remaining 20 sorted. These are Node 24.21.0 main-thread timings on the development host. They are neither browser measurements nor a workload performance claim.

| Sample | First parse, ms | Warm median, ms | Warm maximum, ms |
| --- | ---: | ---: | ---: |
| Drone | 51.85 | 12.48 | 33.39 |
| Tank | 2.41 | 1.69 | 5.90 |
| Jet | 3.07 | 2.80 | 6.90 |
| Speedboat | 0.76 | 0.42 | 0.48 |

The final parser and image-decode helper built standalone with Vite 8.3.0's ES library output measured 12,138 bytes raw and 4,157 bytes gzip using Node `gzipSync`. This includes exported functions and validation. The renderer and shared projection are excluded. It slightly exceeds the 3 to 4 KB gzip parser estimate in #75. Browser parsing, image decoding, texture upload and combined bundle size remain the integration owner's measurements.
