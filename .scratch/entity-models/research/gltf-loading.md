# glTF loading research

Research date: 2026-10-03. Question: [Choose a lightweight glTF loading approach](https://github.com/the-Drunken-coder/Ridgeline/issues/73), for the map [Entity models and representation switching](https://github.com/the-Drunken-coder/Ridgeline/issues/71). This note compares options. The choice of how Ridgeline draws and loads models belongs to ticket #75.

## Answer

- **Size.** A minimal in-house GLB parser for the subset below measured 6,491 bytes raw and 2,710 gzip. The smallest maintained library path, the loaders.gl GLB container alone, measured 47,526 raw and 12,933 gzip, and it does not resolve accessors or images. A full loader measured 85,526 / 20,758 (glTF-Transform core) and 189,621 / 49,878 (loaders.gl GLTFLoader). For scale, Ridgeline today is 23,155 / 7,476.
- **Maintenance.** loaders.gl (MIT), glTF-Transform (MIT) and meshoptimizer (MIT) are actively released. gltf-loader-ts (MIT) was last published in 2018. Draco (Apache-2.0) last published its npm decoder in January 2024.
- **Subset.** Every freely licensed vehicle sample tested loads with a small subset: a GLB with one embedded binary buffer, static triangle meshes, base-color materials with embedded PNG or JPEG, and optionally `KHR_mesh_quantization` and `KHR_texture_transform`. Draco, meshopt, KTX2, skins, morph targets and separate `.gltf` files are not needed for those models. Reject them by name.
- **Threads.** For all options, uploading to WebGL happens on the main thread because MapLibre's context lives there. Parsing the subset took 0.3 to 30 ms per model in Node. `createImageBitmap` decodes images in parallel. All candidates are plain JavaScript that could run in a worker. Ridgeline has no worker of its own today.
- **Library extras.** The libraries' extra weight goes to features outside the subset: editing and writing (glTF-Transform), Draco, Basis and meshopt hooks, and decoders fetched from public CDNs (loaders.gl). Fetching from a CDN conflicts with Ridgeline's rule that it does not fetch application assets.

## Ridgeline constraints checked

- Ridgeline pins `maplibre-gl` 6.11.0 and builds an ES library with Vite 8.3.0, externalizing only MapLibre ([package.json](https://github.com/the-Drunken-coder/Ridgeline/blob/61616e4819d5501d14ea157905b97808e4899866/package.json), [vite.config.ts](https://github.com/the-Drunken-coder/Ridgeline/blob/61616e4819d5501d14ea157905b97808e4899866/vite.config.ts)). A new dependency would be bundled into `dist/ridgeline.js`.
- Current library size is 23,155 bytes raw and 7,476 gzip ([docs/performance.md](https://github.com/the-Drunken-coder/Ridgeline/blob/61616e4819d5501d14ea157905b97808e4899866/docs/performance.md)).
- `registerIcon(id, { image, pixelRatio, url? })` takes already decoded images, and "Ridgeline does not fetch application icons" ([README](https://github.com/the-Drunken-coder/Ridgeline/blob/61616e4819d5501d14ea157905b97808e4899866/README.md#L133)). The matching model contract is that consumers hand Ridgeline the bytes of a model, and Ridgeline parses them.
- `src/` contains no Worker today. A Ridgeline-owned worker would be a new packaging concern. Vite emits a `new Worker(new URL(..., import.meta.url))` worker as a separate chunk by default, or inlines it as base64 with `?worker&inline` ([Vite web workers](https://vite.dev/guide/features#web-workers)).

## Size

Method: each candidate's minimal entry point was bundled in `/tmp` with Vite 8.3.0 in library mode, ES format, matching Ridgeline's `vite.config.ts`. Explicitly setting `minify: true` produced byte-identical sizes, so Ridgeline's library build already minifies. Gzip uses Node's `zlib.gzipSync` defaults, as in `scripts/bundle-size.mjs`. Node 24.21.0. The Draco files are separate assets, measured as downloaded.

| Candidate and entry | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| In-house GLB subset, throwaway estimate (`parseGlb`) | 6,491 | 2,710 |
| gltf-loader-ts 0.3.1 (`GltfLoader`) | 13,598 | 3,790 |
| loaders.gl 4.5.2, GLB container only (`parse` + `GLBLoader`) | 47,526 | 12,933 |
| loaders.gl 4.5.2, full (`parse` + `GLTFLoader` + `postProcessGLTF`) | 189,621 | 49,878 |
| glTF-Transform 4.5.1 core (`WebIO.readBinary`) | 85,526 | 20,758 |
| glTF-Transform core + 5 extensions + meshopt decoder | 129,398 | 32,460 |
| meshoptimizer 1.3.0 decoder only (`meshoptimizer/decoder`, WASM embedded) | 27,663 | 7,481 |
| Draco glTF-only decoder (`draco_decoder_gltf.wasm` + wrapper), [google/draco](https://github.com/google/draco/tree/15bdb3a4f15a7a8d77489ac348a7a50d93de17a3/javascript) | 251,049 | 75,248 |
| Draco general decoder 1.5.7 (`draco_decoder.wasm` + wrapper, npm `draco3d` and gstatic) | 344,711 | 100,583 |

Notes:

- Import `meshoptimizer/decoder`, not the package root. Importing `MeshoptDecoder` from `meshoptimizer` pulled the encoder, simplifier and clusterizer too and measured 153,979 / 52,521.
- The loaders.gl full figure excludes code it fetches at runtime. That includes the Draco decoder from `www.gstatic.com` unless the application supplies `draco3d` ([draco-module-loader.js](https://unpkg.com/@loaders.gl/draco@4.5.2/dist/lib/draco-module-loader.js)), and worker scripts from `unpkg.com` ([get-worker-url.js](https://unpkg.com/@loaders.gl/worker-utils@4.5.2/dist/lib/worker-api/get-worker-url.js)). Both URLs appear in the measured bundle.
- The in-house figure is the parser only. Shaders, drawing, flat-normal generation and diagnostics are not included, and nor are fuller validation and tests. It is an order-of-magnitude estimate, not a production size.
- The in-house parser plus the meshopt decoder would be about 34,154 raw and 10,191 gzip, the sum of the two files gzipped separately.

## License and maintenance

Registry and GitHub metadata as of 2026-10-03:

| Package | License | Latest stable | Activity |
| --- | --- | --- | --- |
| [@loaders.gl/gltf](https://www.npmjs.com/package/@loaders.gl/gltf), [@loaders.gl/core](https://www.npmjs.com/package/@loaders.gl/core) | MIT (package LICENSE) | 4.5.2, 2026-09-20 | 5.0.0-alpha.8 on 2026-10-02; repo pushed 2026-10-03 |
| [@gltf-transform/core](https://www.npmjs.com/package/@gltf-transform/core) | MIT | 4.5.1, 2026-09-28 | repo pushed 2026-10-02; personal repository of Don McCurdy |
| [gltf-loader-ts](https://www.npmjs.com/package/gltf-loader-ts) | MIT | 0.3.1, 2018-06-12 | repo last pushed 2019-03-06; unmaintained |
| [meshoptimizer](https://www.npmjs.com/package/meshoptimizer) | MIT | 1.3.0, 2026-09-25 | repo pushed 2026-09-28 |
| [draco3d](https://www.npmjs.com/package/draco3d) | Apache-2.0 | 1.5.7, 2024-01-17 | repo pushed 2026-09-24; no npm release since 2024 |
| [shrekshao/minimal-gltf-loader](https://github.com/shrekshao/minimal-gltf-loader) | MIT | not on npm | last pushed 2021-12-07; excluded |

Dependency trees: `@loaders.gl/gltf` depends on `@loaders.gl/draco`, `images`, `textures`, `schema`, `loader-utils`, `@math.gl/core` and `meshoptimizer`, plus a peer dependency on `@loaders.gl/core`. `@gltf-transform/core` depends only on `property-graph`. gltf-loader-ts has no dependencies. It ships as a CommonJS webpack bundle, so it cannot be tree-shaken.

## Supported glTF subset by candidate

| | GLB | `.gltf` + separate files | Embedded textures | Materials | `KHR_mesh_quantization` | Meshopt | Draco | KTX2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| In-house subset | Yes | No; repackage offline | PNG and JPEG via `createImageBitmap` | Base color factor and texture, alpha mode, double-sided, emissive factor, unlit flag | Yes | No (add 7.5 KB gzip decoder if needed) | No | No |
| gltf-loader-ts | Yes | Yes, via `XMLHttpRequest` | Yes, as `HTMLImageElement` | Raw JSON only | Raw bytes; no byte-stride or extension handling | No | No | No |
| loaders.gl GLTFLoader | Yes | Yes, fetches linked buffers and images | Yes | Raw JSON; `postProcessGLTF` resolves references | Data passed through | Yes, decoder bundled | Yes, decoder loaded at runtime | Via `@loaders.gl/textures`; not exercised |
| glTF-Transform | Yes (`readBinary`) | Yes (`WebIO.read(url)`) | Yes, as raw bytes; no decoding | Full material model, including KHR material extensions when registered | Yes, when registered | Yes, with an application-supplied `MeshoptDecoder` | Yes, with an application-supplied `draco3d` decoder | Stores bytes; no transcoding |

Observed in Node:

- glTF-Transform `readBinary` rejected a Kenney GLB that references an external texture: "Cannot resolve external images with binaryToJSON()".
- Without a decoder, glTF-Transform failed on the Draco-compressed three.js `ferrari.glb`. It also rejects unregistered required extensions ([reader](https://unpkg.com/@gltf-transform/core@4.5.1/dist/index.js), `validate`).
- loaders.gl failed on `ferrari.glb` while trying to load the Draco decoder. I found no code in GLTFLoader that rejects unsupported entries in `extensionsRequired`, so the caller must check them. This came from source search only.

## Parsing without blocking the main thread

- **Must stay on the main thread.** WebGL uploads (`bufferData`, `texImage2D`) must happen on the thread that owns MapLibre's context. This applies to every option.
- **In-house parse cost.** The synchronous part is the GLB header, `JSON.parse` and accessor copies. One run per model in Node 24, including cold JIT, took 0.3 ms (Box), 2 to 15 ms (typical vehicles of 0.4 to 6 MB), 23 ms (ToyCar, 109k triangles) and 30 ms (CarConcept, 11.8 MB, 213k triangles). Browser timings are unverified.
- **Image decoding.** For a `Blob` source, the HTML standard runs `createImageBitmap` decoding "in parallel". `ImageBitmap` is exposed in workers and is transferable ([HTML, ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#the-imagebitmap-interface)). The subset can therefore decode textures off the main thread, even without a worker.
- **loaders.gl.** `GLTFLoader` declares no `worker` option, so it parses on the calling thread ([gltf-loader.js](https://unpkg.com/@loaders.gl/gltf@4.5.2/dist/gltf-loader.js)). `DracoLoader` declares `worker: true`. By default its worker comes from unpkg.
- **glTF-Transform.** It has no built-in worker. It ran in Node with no DOM, so it should work in a worker, but that is unverified in a browser.
- **meshoptimizer.** The decoder offers `useWorkers(count)` and, with SIMD, decodes at 1 to 3 GB/s on modern desktop computers, by its own claim ([README](https://unpkg.com/meshoptimizer@1.3.0/README.md)).
- **gltf-loader-ts.** It decodes images through `HTMLImageElement`, which does not exist in workers.
- **A Ridgeline worker.** Moving parsing into a Ridgeline worker would transfer `ArrayBuffer` and `ImageBitmap` results. The cost is a first worker chunk in the package.

## Sample vehicle models

Each model was run through the throwaway in-house parser in Node. Sources are pinned: [CesiumGS/cesium@e1d443e](https://github.com/CesiumGS/cesium/tree/e1d443e8fdaae0535407b96f7560426583483424/Apps/SampleData/models), [glTF-Sample-Assets@edc7c9e](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models), [three.js@2bebd15](https://github.com/mrdoob/three.js/tree/2bebd158c15d46deb3d772cd400cc6b64f3d908d/examples/models/gltf), and Kenney kits downloaded from kenney.nl ([Watercraft](https://kenney.nl/assets/watercraft-kit), [Pirate](https://kenney.nl/assets/pirate-kit), [Space](https://kenney.nl/assets/space-kit), [Car](https://kenney.nl/assets/car-kit); CC0 per bundled License.txt).

| Model | Kind | Features used | Subset result |
| --- | --- | --- | --- |
| Cesium_Air.glb (587 KB) | Plane | f32 attributes, u16 indices, embedded JPEG and PNG, BLEND alpha, animation | Accepted; animation ignored |
| CesiumDrone.glb (1.2 MB, CC-BY 4.0) | Drone | Tangents, normal and metallic-roughness textures, u8 and u16 indices, animation | Accepted; extra textures ignored |
| Mars/Ingenuity.glb (1.8 MB) | Rotorcraft | 35 primitives, normal and metallic-roughness textures | Accepted |
| GroundVehicle.glb (6.1 MB) | Ground vehicle | 10 embedded JPEGs, full PBR texture set | Accepted |
| CesiumMilkTruck.glb (CC-BY 4.0) | Truck | Base color texture, animation | Accepted |
| ToyCar.glb (CC0) | Car | `KHR_texture_transform`, clearcoat, sheen, transmission (optional) | Accepted; optional material extensions ignored |
| CarConcept.glb (11.8 MB, CC-BY 4.0) | Car | 109 primitives, `KHR_materials_variants`, TEXCOORD_1 | Accepted; variants ignored |
| Duck, glTF-Quantized variant | Quantized test | Requires `KHR_mesh_quantization`; u16 positions, normalized i8 normals, u16 UVs dequantized by `KHR_texture_transform` | Accepted after offline GLB repackaging; bounds match the float Duck |
| three.js ferrari.glb | Car | Requires `KHR_draco_mesh_compression` | Rejected |
| CesiumBalloonKTX2.glb | Balloon | Requires `KHR_texture_basisu` | Rejected |
| Kenney Watercraft, Pirate, Car (168 GLBs) | Boats, ships, cars | f32 attributes, identity `KHR_texture_transform`, double-sided, **external** `Textures/colormap.png` | Accepted only with an image resolver, or after offline repackaging |
| Kenney Space (153 GLBs) | Spacecraft, rovers | f32 attributes, u32 indices, color factors only, `KHR_materials_unlit` declared | Accepted |

A Kenney boat repackaged offline with glTF-Transform `NodeIO` became a self-contained 25,084-byte GLB, which the subset parsed with no resolver.

## Smallest viable subset

**Accept:**

- GLB version 2, with the JSON chunk first and one BIN chunk as buffer 0, which has no `uri` ([GLB format](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-file-format-specification), [GLB-stored buffer](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-stored-buffer)).
- The default scene's node tree, with each node's TRS or matrix composed as T * R * S and flattened to static per-primitive transforms ([transformations](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#transformations)).
- Triangle-list primitives (mode 4) with `POSITION`, plus optional `NORMAL`, `TEXCOORD_0` and `COLOR_0`. Indices may be u8, u16, u32 or absent. If normals are missing, the renderer must compute flat normals; the spec says it MUST ([meshes](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes-overview)).
- All core accessor component types, with `normalized` and `byteStride`. Together these cover [`KHR_mesh_quantization`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Khronos/KHR_mesh_quantization/README.md), which is ratified and always listed in `extensionsRequired`. WebGL2 attributes can read these types directly. Quantized `accessor.min` and `accessor.max` must be dequantized before use as bounds.
- [`KHR_texture_transform`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Khronos/KHR_texture_transform/README.md) offset, rotation and scale. Quantization depends on it for texture coordinate dequantization, and every textured Kenney model declares it.
- Materials: `baseColorFactor`, a `baseColorTexture` on TEXCOORD_0, `alphaMode` and `alphaCutoff`, `doubleSided`, `emissiveFactor`, and [`KHR_materials_unlit`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Khronos/KHR_materials_unlit/README.md). Normal, metallic-roughness, occlusion and emissive textures are ignored, so shading is simple. The look itself is the user's visual choice.
- Embedded PNG and JPEG images in buffer views, decoded with `createImageBitmap` ([images](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#images)).
- Animations, cameras, lights, extra scenes and optional extensions not listed in `extensionsRequired` are ignored, as the spec allows.

**Reject with a named diagnostic:**

- Any `extensionsRequired` entry outside the subset. The core spec says such an asset SHOULD NOT be loaded ([asset](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#asset), [specifying extensions](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#specifying-extensions)), and [`KHR_draco_mesh_compression`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md) says the loader must fail. This covers Draco, [`EXT_meshopt_compression`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Vendor/EXT_meshopt_compression/README.md) and [`KHR_meshopt_compression`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Khronos/KHR_meshopt_compression/README.md) (Release Candidate), [`KHR_texture_basisu`](https://github.com/KhronosGroup/glTF/blob/8e691206fa2e981fc3b8c8bc57e671595576c971/extensions/2.0/Khronos/KHR_texture_basisu/README.md), and required WebP or AVIF textures.
- `.gltf` JSON files, external or data-URI buffers, and external images unless an image resolver is supplied. Repackaging to GLB offline handles these files.
- Skins, morph targets, sparse accessors, non-triangle modes (points, lines, strips and fans), and base-color textures on TEXCOORD_1 or later.

## Implications for the map

- **Scale.** Real-world size varies widely: ToyCar is 7 cm, Kenney models range from 0.17 m to 21 m, and Cesium_Air is 25.7 m. Bounds from accessor min and max give model size cheaply, so a consumer scale or target size will likely be needed.
- **Orientation.** The spec defines +Y up, +Z forward and meters ([coordinate system](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)). Whether these sample models face +Z was not checked visually. A per-model heading offset may be needed.
- **"GLB" does not mean self-contained.** All 168 textured Kenney GLBs reference an external PNG. The consumer API must choose between a resolver callback and requiring self-contained GLBs.
- **Licenses.** The playground can use CC0 Kenney boats and spacecraft, the Cesium drone (CC-BY 4.0, embedded copyright) and the Khronos milk truck (CC-BY 4.0).

## Unverified

- Browser parse timings. All timings are single Node runs. No browser, Safari or Firefox measurement was made.
- Rendering correctness. Parser output was not drawn, so winding order, normals and orientation were not checked visually.
- Tanks. No freely licensed tank GLB was tested. GroundVehicle and the car kits stand in for ground vehicles.
- Licenses of Cesium_Air, GroundVehicle and Ingenuity. None carries an `asset.copyright`, and none is listed in Cesium's LICENSE.md.
- Marketplace exports (Sketchfab, CGTrader and similar). Their extension usage was not inspected because downloads need accounts.
- The loaders.gl Basis transcoder loading path, loaders.gl worker parsing, and glTF-Transform inside a browser worker.
- The production size of an in-house parser, and the Content Security Policy needs of WebAssembly decoders on consumer pages.
