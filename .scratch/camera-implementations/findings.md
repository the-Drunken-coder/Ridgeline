# Existing camera-coverage implementations

Research date: 2026-09-24. Scope: actual application and rendering source, not package discovery. Five parallel research agents inspected Cesium, MapLibre, drone applications, other terrain engines, and a candidate drone simulator. No production code changed.

## Best matches

| Implementation | Verified behavior | Important gap |
| --- | --- | --- |
| [OpenGlobus projector and UAV examples](https://github.com/openglobus/openglobus/blob/61757dbc79604e37b3e85192ca1945b94c982d2a/sandbox/uav/uav.js) | Sensor position/orientation, horizontal and vertical view angles, range, frustum, and colored terrain projection gated by terrain depth. UAV example synchronizes pose each draw. | Visible projection only; no explicit red blocked-region fill. Uses OpenGlobus terrain and renderer, not MapLibre. |
| [DigitalArsenal/SensorShadow](https://github.com/DigitalArsenal/SensorShadow/tree/c0f90220e57e3a8878c2b2718642fc27e5a949fa) | Sensor shadow map and GPU post-process tint terrain visible/blocked, with configurable colors and optional frustum. | Hardcoded 120-degree FOV/canvas aspect. Existing shadow camera updates position without copying changed direction/frustum. Uses private Cesium APIs. |
| [hh-hang/vid3d-projection](https://github.com/hh-hang/vid3d-projection) | Configurable geographic camera pose, azimuth/elevation/roll, FOV/aspect/range, helper frustum, and depth-tested video projection. | Video projection rather than red/green classification; setters rebuild resources. Uses private Cesium APIs. |
| [CallMarcus/dji-drone-metadata-embedder](https://github.com/CallMarcus/dji-drone-metadata-embedder) | Real MapLibre drone-flight playback with altitude, gimbal direction, HFOV/VFOV, moving footprint and terrain-stopped corner beams. | Ground polygon is calculated on a flat reference plane and draped. It does not classify the footprint's interior for hill occlusion. |
| [Esri Dynamic Situational Awareness Qt](https://github.com/Esri/dynamic-situational-awareness-qt) | Complete situational-awareness application with moving tracked objects and terrain-aware viewsheds/line of sight. | General observer rather than drone-camera workflow; the actual visibility algorithm resides in the ArcGIS SDK, not the open application source. |

## Start here

OpenGlobus is the strongest new implementation reference. Its [projector example](https://github.com/openglobus/openglobus/blob/61757dbc79604e37b3e85192ca1945b94c982d2a/sandbox/projectors/projectors.js) configures the visual system; its [UAV example](https://github.com/openglobus/openglobus/blob/61757dbc79604e37b3e85192ca1945b94c982d2a/sandbox/uav/uav.js) updates pose; [DepthCamera.ts](https://github.com/openglobus/openglobus/blob/61757dbc79604e37b3e85192ca1945b94c982d2a/src/control/depthCamera/DepthCamera.ts) renders scene depth; and [projectors.glsl](https://github.com/openglobus/openglobus/blob/61757dbc79604e37b3e85192ca1945b94c982d2a/src/shaders/common/projectors.glsl) rejects terrain hidden from that camera. The author advertises a [live projector demonstration](https://sandbox.openglobus.org/examples/projector). The fill stays on the GPU; its optional footprint outline uses framebuffer readback. Apache-2.0.

For the exact green/red presentation, inspect SensorShadow's [class](https://github.com/DigitalArsenal/SensorShadow/blob/c0f90220e57e3a8878c2b2718642fc27e5a949fa/src/SensorShadow.js) and [fragment shader](https://github.com/DigitalArsenal/SensorShadow/blob/c0f90220e57e3a8878c2b2718642fc27e5a949fa/src/SensorShadow.fragment.shader.glsl). It is a useful rendering reference, not a complete moving-camera implementation to adopt unchanged. Apache-2.0.

For a configurable camera counterpart, inspect [vid3d-projection's Cesium implementation](https://github.com/hh-hang/vid3d-projection/blob/main/src/cesium-video-projection.ts) and [published demo](https://hh-hang.github.io/vid3d-projection/). MIT.

For a product already using our map engine, inspect the DJI viewer's [gaze implementation](https://github.com/CallMarcus/dji-drone-metadata-embedder/blob/master/src/dji_metadata_embedder/geo/flightmap3d_gaze_js.py) and [geospatial walkthrough](https://callmarcus.github.io/dji-drone-metadata-embedder/geospatial/). Its deliberate approximation is documented and tested. MIT.

## What this suggests

The closest 3D implementations reuse their host renderer's terrain geometry and sensor-depth rendering, then project or classify coverage on the GPU. That is the architectural pattern worth comparing with Ridgeline's separate terrain representation and mask readback. It does not establish that switching engines would eliminate flicker, and it is not a drop-in MapLibre integration.

No inspected MapLibre project combined all three: moving directional camera pose, full terrain occlusion, and visible/blocked ground classification. OpenGlobus is the closest dynamic terrain projector; SensorShadow is the closest classification display. These are source-level findings. Published demos were not runtime benchmarked, and smoothness on Ridgeline's terrain and motion remains untested.

## Detailed evidence

- [Other terrain engines / OpenGlobus](other-engines.md)
- [Cesium implementations](cesium.md)
- [MapLibre implementations and partial matches](maplibre.md)
- [Drone and situational-awareness applications](drone-systems.md)
- [Rejected ResQ lead](resq.md): current source implements LiDAR and radio-link occlusion, not camera coverage.

## Applied to Ridgeline

Kept the existing sensor-depth algorithm and MapLibre renderer. Separated per-camera coverage from appearance, reused unchanged analysis, attached submitted terrain/style metadata to asynchronous publication, and bounded ground classification/refinement with padded footprint scissors. The sensor-depth pass remains full-frame. No external source code or engine-private APIs were copied.

Validation: `pnpm check`, 19 unit tests, and all 23 packed-consumer browser checks passed. The browser test measures zero additional sensor-depth submissions for four appearance updates and verifies a bearing change submits fresh depth. Existing real-occluder, flat-plane, sloped-plane movement, and subpixel contour tests pass. This is functional and work-count evidence, not a hardware frame-rate comparison or proof that real-terrain flicker is eliminated.
