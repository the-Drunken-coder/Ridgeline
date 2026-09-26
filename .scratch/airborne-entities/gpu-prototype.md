# GPU camera experiment

The user selected option C on 2026-09-23: test GPU visibility before committing to a production renderer rewrite.

Run `pnpm dev` and open `/gpu-camera.html`. The production playground build includes the same page. Code lives in `playground/prototypes/gpu-camera.ts`, outside the library API. The existing map implementation remains available at `/`.

## What the experiment does

A fixed 6 km square uses a 257 by 257 terrain grid, 131,072 triangles. Real-hills mode samples the existing raw Mapterhorn DEM; known-ridge mode has a deterministic Gaussian ridge. Both the visible terrain and sensor depth pass render this same mesh. Physical height calculations remain independent of the display origin shift used to frame the hills.

Every rendered frame updates the aircraft position and camera direction, renders a 1024-square depth map from the sensor, shades visible terrain, and deforms a 128-square camera boundary using the same depth texture. The range remains a 2 km slant distance. Vertex generation stays on the GPU; normal rendering never reads depth back to the CPU. The terrain is cached after loading. Pausing stops continuous repaints.

The visible terrain renders its own green coverage, avoiding a second coplanar footprint mesh. A fragment depth check rejects camera fragments behind the first sensor-visible terrain. Rim vertices stop at terrain or the range limit. Hit portions of the far cap are omitted because the terrain already draws that surface.

The sensor framebuffer explicitly uses depth range 0 to 1, then restores MapLibre's depth range. Reusing MapLibre's narrower depth range initially made visible ground appear hidden. This was reproduced and corrected using GPU readback.

## Verification

The Check ridge control freezes a known pose. A tiny GPU pass reads two visibility decisions and the centre-ray distance from the actual sensor depth texture. The near slope must be visible, the far slope hidden, and the centre ray must end on the near side of the ridge rather than at maximum range. Observed result: PASS, first hit 857 m out of a 2,000 m range, endpoint 0.2 m below the sampled mesh.

A ten-second development ridge run measured 120.1 actual sensor and geometry updates/s, p95 frame interval 9.0 ms, mean GPU render duration 1.22 ms, and 1,202 fresh depth maps. These are sensor-pass counts, not UI callbacks. GPU durations use disjoint timer queries when available. Browser: Codex Chromium on macOS, natural narrow viewport. These are single-run observations, not a device capacity guarantee.

A ten-second production real-hills run in the same narrow viewport measured 120.1 sensor/geometry updates/s, p95 frame interval 9.4 ms, mean GPU duration 1.45 ms, and 1,201 fresh depth maps.

The final production real-hills run at 1280 × 720 measured 120.1 sensor/geometry updates/s, p95 frame interval 9.0 ms, mean GPU duration 2.15 ms, and 1,201 fresh depth maps. The final ridge check passed again and browser errors remained empty. The real-hills image still shows some depth-map self-shadow speckling and sampled silhouette edges, which need work before production.

Strict TypeScript checking and the library and multipage playground builds pass. The existing large-bundle warning remains. Runtime error logs were empty after loading and checking the ridge.

## Limits before production adoption

This is a local rendering experiment, not a replacement API. It does not yet support multiple sensors, picking/export of GPU shapes, globe projection, standard basemap imagery/labels, exaggeration, or streamed terrain beyond the fixed area. The visible terrain uses approximately 23.4 m grid spacing; the depth map adds angular sampling limits. Coverage permits a 2 m depth bias to reduce self-shadowing, so this does not claim exact survey-grade line of sight. Sensor-visible terrain outside the fixed mesh is unknown, not validated clear air. The chosen flight path and range remain inside the patch.

The fixed GPU surface establishes feasibility on this device. Integrating a shared or consistently sampled terrain representation with the full map, and testing ridge silhouettes at different ranges/resolutions, remain necessary before replacing the worker path.
