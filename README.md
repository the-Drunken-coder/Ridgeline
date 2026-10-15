# Ridgeline

A framework-neutral TypeScript map viewport with optional selection, drawing and map controls. Consumers supply the current display state and own their data and application workflows. MapLibre GL JS renders the map; Mapterhorn supplies the default elevation data.

## Standout features

- [Radial feature picker](#interaction-and-application-ui) for overlapping features, with hover previews, keyboard navigation, and paging. Choices keep their positions while features move.
- [Airborne entities](#airborne-entities-and-attachments) with ground-relative or sea-level altitude. Attached ground zones, airborne volumes, and sensor cameras follow the entity as it moves.
- [Sensor camera terrain visibility](#airborne-entities-and-attachments) with camera footprints and 3D viewing volumes. Optional GPU visibility estimates which ground regions are visible or blocked by hills.
- [Drawing and editing](#drawing-and-editing) for lines, polygons with holes, circles, rectangles, and arrows, with touch input, vertex/edge snapping, exact segment edits, draft undo/redo, and live measurements. Saved shape definitions preserve editing after reload.

## Other map features

- [GeoJSON points, lines, and polygons](#features-and-updates) with configurable icons, labels, dash patterns, and selection/hover appearance.
- [Optional multi-selection](#interaction-and-application-ui) through Shift-click and Alt-drag, plus [standard controls and coordinate helpers](#map-controls-and-coordinates).
- [Live feature updates](#features-and-updates) batched per animation frame, with incremental additions, changes, and removals.
- [Flat and globe projections, 3D terrain, and configurable hillshade](#maps-terrain-and-network-access). Swap basemaps or elevation providers while retaining features and selection.
- [Custom hover content and context menus](#interaction-and-application-ui), themeable interaction UI, and direct MapLibre access for application-specific extensions.

## Core design decisions

Ridgeline is built for anyone who needs an easy-to-use, reusable map viewport. Core design decisions must serve consuming applications generally.

- The playground is one consumer. Its job is to host the map, let people explore it, and exercise the same public API available to everyone.
- The library must work without the playground's code, sidebar, sample data, scenario names, state, or workflows. Dependencies flow from the playground to the library.
- Consumers choose their data, surrounding UI, styling, and application behavior. A playground request belongs in the library only when it solves a reusable mapping need; demonstration controls and scenario logic stay in the playground.
- Keep integration simple through sensible defaults, a small documented API, and optional interaction tools. General usefulness does not require a speculative plugin framework or universal rendering-engine abstraction.

Review each core change against this question: can another application use it without adopting the playground's structure or assumptions? Verify package usability in a separate consuming application, as well as in the playground.

## Run locally

The playground combines the approved Field desk sidebar with Map bench's in-map wheel. It starts over Chamonix with terrain and hillshade enabled. Choose overlapping features to try groups of 2, 3, 8, 10, and 20, or moving features for the 1,000-point workload.

Choose **Entity models**, or open `/?scenario=models`, for pairs of drones, tanks, jets and boats sharing four licensed assets. Select or hover a sample, change its appearance, switch camera distance, replace or unload a shared model, and remove or reset samples. The [example consumer](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/playground/model-example.ts) owns fetching and palettes; its credits link identifies the assets and licenses.

The **SIDC Kit integration** scenario demonstrates [SIDC Kit](https://github.com/the-Drunken-coder/sidc-kit) in the playground. Search its curated symbols, preview one, choose **Place on map**, and click once to add it. Escape or **Cancel** exits placement. Select a symbol to inspect its SIDC and interpreted fields; remove it or reset to the three samples. Leaving the scenario or reloading discards changes.

SIDC Kit is a playground-only development dependency, loaded when that scenario opens. Its search, rendering, and explanation workflows are not Ridgeline map features. The map library receives ordinary features and registered icons through its existing public API; its exports, runtime dependencies, and build contain no SIDC integration. This demo uses the published `sidc-kit@0.3.2` curated catalog, which is smaller than the current upstream repository's catalog. Structured building, reverse lookup, symbol editing, and persistence are outside this demo.

Use Node 22.12+ and pnpm 11.

Node 24 is the reference runtime for required Ubuntu CI. macOS is supported for local validation using manual evidence; it is not an additional required CI job. [Issue #50](https://github.com/the-Drunken-coder/Ridgeline/issues/50) requires current-main macOS validation on Node 24 and focused Node 25.9 checks for temporary-path overlap and rejected-drawing keyboard input. The documented minimum remains Node 22.12+. Focused Node 25.9 checks do not certify every newer runtime.

```sh
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm test:browser
pnpm test:playground:browser
pnpm test:controls:browser
pnpm validate
pnpm build:playground
pnpm measure
```

`pnpm test` runs the fast module and control-lab state tests. `pnpm validate` runs type checking, those tests, the packaged consumer, support, playground and control-lab browser suites, both application builds, and model measurement verification. See [verification](#verification) for browser installation and the scope of each check.

`pnpm build` produces the importable ESM library and declarations in `dist`. `pnpm build:playground` also builds the playground against those exports, without development source aliases. This package is private and has not been published to npm. Install a local tarball in another application:

```sh
pnpm build
pnpm pack --pack-destination .artifacts
# In the consuming application:
pnpm add /absolute/path/to/Ridgeline/.artifacts/ridgeline-map-0.1.0.tgz maplibre-gl@6.11.0
```

The shipped [starter application](examples/starter/README.md) builds against that packed package. It contains plain TypeScript/Vite recipes for selection and styling, and drawing acceptance with application-owned browser storage. It restores complete drawing metadata after reload and demonstrates rejection with a retained draft and retry. See the [viewport tools guide](docs/viewport-tools.md) for the public contracts and the [support matrix](docs/support.md) for recorded browser and device evidence.

## Everyday map control lab

Run `pnpm dev:controls` for the separate [control lab](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/control-lab/README.md). It demonstrates the everyday map controls: pan, zoom, select simulated units, and move them to a clicked destination. `pnpm test:controls` checks its state transitions; `pnpm test:controls:browser` exercises its controls with real browser input. `pnpm build:controls` checks the application build.

The control lab uses simulated units and a fixed SVG street sample. It is an interaction experiment, not an integration with the Ridgeline viewport. Its React dependencies remain in its own private workspace package; the map library and existing playground are unchanged.

## First viewport in Vite

```ts
import { createViewport, attachInteractions } from '@ridgeline/map';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';

// Configure MapLibre's worker once before mounting maps.
setWorkerUrl(workerUrl);
const container = document.querySelector<HTMLElement>('#map')!;
const viewport = createViewport({
  container,
  terrain: true,
  hillshade: true,
  camera: { center: [6.87, 45.92], zoom: 12, pitch: 50 },
  onError: error => console.warn(error.code, error.context, error.cause),
});

viewport.upsert([{
  type: 'Feature', id: 'rescue-1',
  geometry: { type: 'Point', coordinates: [6.87, 45.92] },
  properties: { name: 'Rescue 1' },
}]);

const interactions = attachInteractions(viewport);
const unsubscribe = viewport.on('selectionrequest', ({ ids }) => {
  viewport.setSelection(ids); // The application owns its selection policy.
});
await viewport.ready;

// During application teardown:
// unsubscribe(); interactions.destroy(); viewport.destroy();
// viewport.destroy() also disposes attached interactions automatically.
```

Give the container an explicit height and `position: relative`. This is a browser library: create it after mounting the DOM, not during server rendering. MapLibre 6 requires a worker URL when bundled; other bundlers have their own setup in the [MapLibre installation guide](https://maplibre.org/maplibre-gl-js/docs/). Keep `?worker&url` for Vite so the worker's dependencies are bundled too.

## Features and updates

`MapFeature<YourProperties>` is GeoJSON `Point`, `LineString`, or `Polygon`, with a required nonempty string ID. Coordinates are `[longitude, latitude]`, within geographic bounds; polygon rings must close. Geometry coordinates stay two-dimensional. Ordinary features attach to the ground when terrain is enabled; point features can additionally supply `entity` altitude and attachments.

| Operation | Contract |
| --- | --- |
| `upsert(features)` | Validate and copy the entire batch, then replace geometry, properties, and entity data for each ID. Last duplicate in a batch wins. |
| `remove(ids)` / `clear()` | Remove features and their selection highlights. Unknown IDs are harmless. |
| `retryUpdates()` | Retry failed incremental changes once using the latest stored data, including pending removals. |
| `refreshStyles(ids?)` | Re-evaluate appearance from current stored features, for all IDs or a supplied subset, without replacing data or emitting `datachange`. Unknown IDs are ignored. |
| `getFeature(id)` / `getFeatures()` | Return snapshots, not mutable internal objects. |
| `queryFeatures([{ x, y }, { x, y }])` | Return `{ features, attachments }` intersecting a rectangle in canvas CSS pixels, using displayed representations. |
| `setSelection(ids)` | Show the application's chosen IDs. Unknown IDs are ignored. |
| `setCamera(camera, { duration })` | Move immediately unless an animation duration is explicitly supplied. |
| `fitBounds(bounds, { duration, padding })` | Frame coordinates, with 48 px padding by default. |
| `configure(settings)` | Independently change basemap, projection, terrain, hillshade, exaggeration, or elevation provider. |
| `on(event, callback)` | Subscribe; the returned function unsubscribes. |
| `reportCallbackError(cause, operation, featureId?)` | Send an attached UI callback failure through the viewport's diagnostic and logger channels. |
| `destroy()` | Release the map, its workers, listeners, animation frame, observer, and attached UI. Supports partial setup and repeated calls. Cleanup failures are logged; synchronous teardown throws the first failure after attempting independent owners. |

Updates are accumulated by ID and submitted once per animation frame using MapLibre's incremental GeoJSON API. Moving a feature never moves the camera. The library snapshots data, so properties must be structured-cloneable. Name and style callbacks receive detached snapshots; mutating their arguments cannot alter accepted data. Replacing an ID also replaces its name and styling inputs. Use immutable IDs separate from display names.

Each batch validates the exact snapshots it will retain before accepting any feature. Shared buffers are copied into independent shared storage, preserving graph aliases and view types. Views over growable shared buffers retain their current extent rather than tracking later growth.

Only one renderer submission runs at a time; updates arriving during it are coalesced for the next frame. A throwing style callback leaves that feature's last rendered version visible and reports `UPDATE_FAILED` with its `featureId`. Other features and removals in the batch still proceed. Renderer rejections and source error events retain the submitted IDs for recovery. No failed update retries automatically. Fix the callback or renderer problem, then call `retryUpdates()`, or replace the affected feature with `upsert()`. Retries use current data and cannot overwrite a newer queued change. A basemap rebuild restores features whose styling succeeds and retains failed IDs for retry. Store reads reflect accepted data immediately, so failed features may differ from the display until recovery succeeds.

A style accessor must return an object, including `{}` for defaults. Returning `undefined`, `null`, an array or another non-object is rejected, a compatibility change from the former empty-style fallback. `getStyle` reports invalid output with `INVALID_FEATURE`, operation `style` and the feature ID. Incremental publication retains the working display and reports `UPDATE_FAILED` with that validation cause; entity preparation reports the validation error. Exceptions thrown by the callback retain the existing callback-failure behavior. `retryUpdates()` and `refreshStyles()` use current accepted inputs for recovery.

The `name` accessor defaults to `properties.name`, then the ID. The `style` accessor supports color, radius, width, fill, `dashed`/`dashArray`, registered icons, `labelStyle`, and per-field `selected`/`hover` appearance. Set a state's `enabled: false` to retain base appearance; disabled selection also suppresses hover appearance while selected. Selection identity and label priority remain unchanged. `modelBrightness` controls model brightening toward white from 0 to 1, including zero. Icons have size, rotation, alignment and anchor options. Labels have font, size, color, halo, anchor and offset options; fonts must exist in the basemap's glyph source or local font configuration. Change an external palette, then call `refreshStyles()` without replacing feature data. Point radii, line widths, label sizes and halos use CSS pixels; label offsets use ems, icon size is an image scale, icon rotation is degrees, and dash entries are line-width multiples. [Presentation options](docs/viewport-tools.md#feature-presentation) lists precedence and validation.

Register icons with `registerIcon(id, { image, pixelRatio, url? })`; `image` is decoded `ImageData`, `ImageBitmap`, or an image element. Ridgeline does not fetch application icons. An optional URL lets DOM UI reuse the same picture. Registration replaces an existing icon ID. Keep the application's registered icon set bounded; unregistering individual icons is deferred.

## Airborne entities and attachments

The **Single flying asset** scenario shows one moving aircraft with a four-sided camera overlay draped on terrain. **Airborne entities** provides a larger workload. The inspector controls altitude, direction, FOV, range, color, fill opacity, and outline. Consumers update the current position and pose through `upsert`; their application owns movement timing and interpolation.

```ts
viewport.upsert([{
  type: 'Feature', id: 'aircraft-1',
  geometry: { type: 'Point', coordinates: [6.87, 45.92] },
  properties: { name: 'Kestrel 01' },
  entity: {
    altitude: { meters: 300, reference: 'ground' },
    groundIfNoAltitude: true,
    attachments: [
      { id: 'camera', type: 'camera', bearing: 60, elevation: -35,
        fovX: 60, fovY: 40, range: 2000,
        color: '#176d46', fillOpacity: 0.25, outline: true, outlineWidth: 3 },
      { id: 'safety', type: 'sphere', radius: 150 },
      { id: 'search-area', type: 'circle', radius: 250 },
    ],
  },
}]);
```

Altitude is in meters above local ground (`ground`) or in the elevation provider's sea-level datum (`sea-level`). Bearing is clockwise from geographic north, independently of movement. Elevation is degrees from local level, positive upward. FOV angles must be strictly between 0° and 180°; range is maximum slant distance in meters. All attachments originate at the entity center and have unique IDs within that entity. Optional `name` and CSS `color` describe attachments.

Ground zones support circles with a `radius` and simple polygons with open `vertices: [eastMeters, northMeters][]` boundaries. Overlapping edges, adjacent edges that double back, and nonadjacent edge contacts reject the entire feature batch. Ordinary adjacent shared corners are valid. Airborne zones support spheres with a `radius` and cylinders with a `radius` and full `height`. Dimensions are meters. Attachments remain centered on their entity and are removed with it.

A camera draws a four-sided directional overlay. Its corner rays project onto the horizontal plane at ground elevation beneath the asset, capped at maximum slant range. A corner above the horizon uses its range endpoint's horizontal position; a wholly skyward camera draws no ground overlay. MapLibre drapes the resulting polygon over displayed terrain. By default hills do not clip or block it. Set `terrainVisibility: true` to split the footprint into approximate visible and hill-blocked regions. GPU terrain visibility uses the finite camera frustum and range directly, so elevated terrain outside that flat projected quadrilateral can still be classified.

`entityVisibility` controls `footprints` (camera footprints and volumes together), `zones`, and `groundLines`. The exported `DEFAULT_ENTITY_VISIBILITY` enables footprints and zones and disables ground lines. Camera appearance uses `color`, `fillOpacity` (0–1), `outline`, and `outlineWidth` (1–12 px). With terrain visibility enabled, `color` and `fillOpacity` style visible regions; `blockedColor` and `blockedOpacity` independently style blocked regions. Terrain exaggeration affects display, not the projected boundary. Entity placement still requires ground elevation beneath the asset. Plain camera overlays use native fill and line layers. GPU visibility uses a native terrain-draped raster mask for flat and globe projections.

GPU visibility uses cached terrain and an asynchronous terrain-draped mask. Movement updates the GPU camera state, and only completed masks are published. Visible and blocked colors and opacities remain independent. Missing terrain is withheld. The result is an approximate visibility estimate bounded by cached terrain and mask resolution; small occluders can be missed and no finer elevation data is fetched. WebGL2 floating-point color targets are required, and renderer failures report a diagnostic rather than silently falling back to CPU visibility.

Camera appearance supports `volumeOpacity`, `wireframe`, and `wireframeWidth`. The shaded four-sided volume follows the actual camera rays to a shared maximum-range cap; terrain depth hides portions beneath the ground. GPU coverage is clipped by that finite volume. Completed coverage and its matching wireframe publish together. Wireframes use cached terrain intersections and screen-space triangles so their edges stop at hills and remain visible across WebGL implementations. `outline` enables visible/blocked region borders in the GPU mask. Borders use each region's configured color at full opacity while interiors retain their independent fill opacities. Internal border width is measured in mask texels; the native footprint outline and wireframe widths use screen pixels.

`getEntityState(id)` returns placement, physical altitude and ground height, coverage availability, computation timing, and footprint triangle count. Subscribe to `entitychange` for updated IDs. Missing altitude uses a ground marker unless `groundIfNoAltitude: false`; explicit zero remains a supplied altitude. Missing terrain or below-terrain placement withholds dependent airborne geometry without rewriting the supplied altitude.

### Shared models

Register application-supplied GLB bytes once per viewport, then reference that model from multiple entities. Fetching and palettes belong to the application:

```ts
import type { ModelAppearance } from '@ridgeline/map';

const appearances = new Map<string, ModelAppearance>([
  ['vehicle-1', { mode: 'color', color: '#db7428' }],
  ['vehicle-2', { mode: 'original' }],
]);
const viewport = createViewport({
  container,
  camera: { center: [6.8705, 45.92], zoom: 17, pitch: 45 },
  style: feature => ({
    label: feature.id,
    modelAppearance: appearances.get(feature.id),
  }),
});
const response = await fetch('/models/vehicle.glb');
if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
await viewport.registerModel('vehicle', {
  bytes: await response.arrayBuffer(), metersPerUnit: 1, headingOffset: 0,
});
viewport.upsert(['vehicle-1', 'vehicle-2'].map((id, index) => ({
  type: 'Feature', id, properties: {},
  geometry: { type: 'Point', coordinates: [6.87 + index * .001, 45.92] },
  entity: { model: { id: 'vehicle' }, heading: 90 },
})));
appearances.set('vehicle-1', { mode: 'color', color: '#2478c4' });
const vehicle = viewport.getFeature('vehicle-1');
if (vehicle) viewport.upsert([vehicle]); // Refreshes this instance without reloading.

// Replacement uses the same ID and is atomic; failure retains the working asset.
// await viewport.registerModel('vehicle', { bytes: replacementBytes });
// viewport.unregisterModel('vehicle'); // Keeps both features and their selection.
```

This example uses the default dot while distant or unavailable. To use an image icon instead, register it through the icon API and return its ID as `style.icon`.

Models use a static GLB v2 subset: one embedded binary buffer, node transforms, core accessors, `KHR_mesh_quantization`, normals, optional first texture coordinates and vertex colors. Materials support embedded PNG/JPEG base-color images, base-color factors, `KHR_texture_transform`, opaque/cutout/translucent alpha modes, alpha cutoff, double-sided faces, emissive factors and `KHR_materials_unlit`. Animations, cameras, lights and unsupported texture channels are ignored. Unsupported required extensions, external buffers/images, skins, morph targets, sparse accessors and non-triangle modes reject with a named cause without fetching application resources. `metersPerUnit` defaults to 1 and must be positive; `headingOffset` defaults to zero. Authored +Y is up and +Z is forward. Entity heading is clockwise from north; pitch is positive nose-up and roll positive right-side-down, all in degrees. Heading is required for model display; missing heading reports `MODEL_HEADING_MISSING` and retains the icon.

To bound decoding memory, an implicit zero-filled accessor cannot declare more scalar values than the GLB's byte length. Excessive counts reject with `GLB_INVALID_ACCESSOR_COUNT`.

Decoding also reserves a cumulative logical allocation budget of `min(256 MiB, max(1 MiB, 256 × GLB byte length))` before expanding geometry. It includes repeated nodes and primitives, temporary numeric storage, copied image bytes and final vertex buffers. Exceeding it rejects with `GLB_DECODED_ALLOCATION_LIMIT` through `MODEL_LOAD_FAILED`; a failed replacement retains the working model. This estimate is separate from browser heap usage and hardware or triangle-count guidance.

For a `.gltf` with external buffers or PNG/JPEG files, keep those files at its URI-relative paths and repackage them in your asset pipeline. This [glTF Transform CLI](https://gltf-transform.dev/cli) command was checked with version 4.5.0:

```sh
npx --yes @gltf-transform/cli@4.5.0 copy input.gltf output.glb
```

Supply the resulting embedded GLB bytes to `registerModel`. Repackaging does not add support for skins, morph targets, compressed geometry or unsupported required extensions. Avoid optimization presets that introduce unsupported formats such as Draco or WebP.

Registration copies bytes and settings before asynchronous work and resolves after parsing, image decoding, GPU upload and atomic installation. Native image decoding may finish after cancellation; its late bitmap is closed without installation. It may start before `viewport.ready`, waiting for the model renderer. Viewport readiness remains independent of model loading. A failed replacement retains the previous asset; a newer registration, `unregisterModel(id)` or destruction cancels pending work with `MODEL_LOAD_CANCELLED`. Cancellation does not emit an asset-failure diagnostic. Removing an entity retains its shared registration. Unregistering returns referencing entities to icons and preserves their data and selection; unknown IDs are harmless.

Entity-state snapshots include `representation` (`icon`, `model` or `withheld`) and an optional referenced `model` with `id`, `status` and `replacementPending`. Representation describes the latest completed render publication, independently of whether the entity is inside the view or hidden behind terrain. Initial registration is `loading`, successful upload is `ready`, an absent registration is `unavailable`, and an initial failure is `failed`. A working model stays `ready` while a replacement is pending. These statuses describe registration, independently of visibility. `entitychange` reports updates.

`FeatureStyle.modelAppearance` overrides the registration appearance. Use `{ mode: 'color', color }` for an assigned CSS color or `{ mode: 'original' }` for supported authored colors and textures. Explicit original mode bypasses a registered color; missing both appearances gives magenta (`#FF00FF`). `style.color` does not assign a model color. Upserting an entity refreshes its appearance independently of other instances without reloading shared assets.

Assigned color replaces source texture, base, vertex and emissive RGB while preserving source alpha, cutout shape and simple lighting. CSS color alpha does not replace imported alpha. Original mode restores supported source appearance; neither mode changes the supplied GLB. The renderer uses fixed entity-local directional lighting, or unlit materials, rather than physically based rendering. Opaque and cutout surfaces write depth before translucent surfaces. Translucent geometry has no depth writes and is unsorted, so overlapping translucent surfaces can composite in draw order.

Model IDs must be nonempty strings. Scale and angles must be finite; scale must be positive. Omitted airborne pitch and roll default to zero. Appearance colors use the existing supported CSS color syntax. Invalid registration reports `MODEL_INVALID`; malformed, unsupported or failed decode/upload reports `MODEL_LOAD_FAILED` or `MODEL_UNSUPPORTED` with model ID, operation and cause.

Viewport `entityModels` settings and per-entity overrides validate atomically. `switchDistanceMeters` must be positive and finite; `deadZoneMeters` must be nonnegative and smaller than twice that distance; `minimumSizePixels` must be finite and nonnegative. `DEFAULT_ENTITY_MODELS` contains 2,000 meters, 200 meters and 40 CSS pixels respectively. Omitted or `undefined` per-entity settings inherit viewport defaults. The floor uses the projected box's largest dimension; real size takes over up close. Set `minimumSizePixels: 0` for physical size alone. Terrain exaggeration changes placement height and slope, never model dimensions.

Switching uses camera-to-entity distance. The defaults enter model below 1,900 meters and return to icon above 2,100 meters. Inside the band and at either boundary, the previous choice remains. A newly available model inside the band stays an icon until it crosses the entrance boundary. Removing or changing its reference, unregistering it or losing heading resets the choice. Temporary terrain or renderer unavailability retains the choice while showing an eligible fallback. Native icon opacity and model drawing switch in the same frame.

Ground models follow the sampled local slope as rigid bodies. Set `entity.model.followSlope: false` to use explicit pitch and roll instead. `headingOffset` corrects the authored forward direction before body pitch/roll and geographic heading. Contact uses sampled support locations for the displayed footprint, including enlargement. It is approximate on uneven terrain: intersection or floating between samples is possible. Unknown required heights withhold the model until preparation completes; eligible icons and ground markers remain available. Model enlargement leaves physical attachment origins and dimensions unchanged.

Model picking uses the oriented bounding box from the last drawn placement, including enlargement, projection and displayed world copy. Empty space between thin parts and transparent cutouts can be clickable. Picking clips the near plane and rejects box areas behind sampled known terrain; it is not mesh- or pixel-accurate. Events return the original entity and actual attachment hits. Overlapping entities keep their icons and display names in the radial picker. Hover refreshes when the scene changes under a stationary pointer, then stops scheduling work when the scene settles.

Collision-placed labels draw above models and clear their projected bounds. Normal font requirements and collision suppression still apply. Hover defaults to a thin ring and gentle brightening; selection defaults to a thicker ring and stronger brightening and takes precedence. Per-feature `hover` and `selected` appearance can disable feedback or set `modelBrightness`; rings use their color and line width and follow the model's altitude. These static effects preserve assigned appearance, source materials and physical attachment dimensions.

Basemap changes retain registrations and usable resources. Context loss withholds drawing while retaining accepted assets and hysteresis choices. Restoration rebuilds current models, colors, selection and attachments; a basemap configured during loss applies after restoration. Registration during loss waits for a usable renderer, while already completed promises remain completed. Failed model restoration reports a diagnostic and leaves eligible icon fallback and unrelated geometry usable. `retryUpdates()` explicitly retries failed model resources. Destruction cancels pending work and releases owned resources, including late decoded images.

Target-browser and hardware acceptance remains pending under [the approved entity-model requirements](https://github.com/the-Drunken-coder/Ridgeline/blob/21805ecb7543098f8c9820c476725654e20b31ec/.scratch/entity-models/spec.md). No measured triangle/material guideline or too-heavy advisory is available yet. Local software WebGL checks do not establish Apple M1 Pro, desktop discrete-GPU or Safari support and performance.

The [measurement workflow](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/tools/model-measurement/README.md) builds a separate consumer of the packed library, with 100 models and 1,000 moving icons, an icon baseline, geometry/material sweeps and paired instrumentation off/on runs. Run `pnpm test:measurement` for its report and packaged timing checks, or `pnpm measure:models --smoke` for a short software-rendered sweep. Hardware collection requires recorded machine/browser metadata; native Safari uses `pnpm measure:models --serve`. Raw frame, update, CPU and optional GPU samples remain separate. These commands prepare evidence for the pending hardware gate.

Pointer events include `attachments: { entityId, attachmentId }[]`. Visible camera faces, wireframes, and footprints can select their owning attachment. The optional interaction helper carries attachment hits into `selectionrequest`; the consumer owns selection policy.

An optional `elevationSampler` supplies raw unexaggerated meters through `sample(lng, lat): number | null`; its optional asynchronous `prepare(positions, signal)` loads the needed area. Preparation is skipped when required heights are already known and may be shared by overlapping entity and camera requests. Both methods receive longitude normalized to [-180, 180) and latitude in degrees. Return null for unknown terrain. Incomplete camera terrain reports loading while preparation is pending, then unavailable if required samples remain unknown. A failure elsewhere does not change that camera's status. Completing preparation refreshes incomplete patches; known terrain stays cached during movement. Call `retryUpdates()` when already loaded terrain changes or when data loads without `prepare`. This source changes computation, not the map's displayed DEM, so keep their datums and data aligned.

Selected labels take placement priority over unselected labels, while collision suppression remains enabled. Some selected labels can remain hidden when they collide with each other. Selection updates this priority without replacing consumer features, including after basemap reload.

## Interaction and application UI

Set `additiveSelection: true` for Shift-click toggling and `boxSelection: true` for Alt-left-drag rectangle requests. Both default to false. Alt+Shift-drag adds rectangle IDs to current selection. Ordinary clicks request one topmost feature or the existing overlap picker. Empty additive gestures preserve selection; empty replacement gestures request clearing it. Selection remains request-only.

Shift presses below 3 CSS pixels use release-time picking and suppress native box zoom. Shift drags at or above 3 pixels retain native box zoom. Live data updates preserve the press; camera, scene, focus and ownership loss cancel it. Rectangle gestures cancel on those same losses and reject starts during camera motion.

Core events are `click`, `hover`, `contextmenu`, `selectionrequest`, `datachange`, `entitychange`, `camerachange`, `configurationchange`, `diagnostic`, and `destroy`. Pointer interactions include original consumer features in topmost-first order, screen coordinates, geographic coordinates, and the original mouse event. Click picking includes features within 12 CSS pixels. Point and rectangle queries exclude edited, withheld and zero-opacity native icon/fill representations, while independently visible parts remain pickable. Custom 3D rectangle hits use conservative projected bounds and can include terrain-occluded geometry, empty space between model parts and transparent cutouts. GPU coverage approximates terrain-draped areas with projected nonzero-alpha texel spans. Neither rectangle approximation is mesh- or pixel-accurate. Direct queries return empty arrays while the renderer is unavailable; rectangle gestures do not propose clearing selection from those arrays. Releasing Shift before a sub-threshold mouseup performs one ordinary click. See the [selection guide](docs/viewport-tools.md#selection-and-rectangle-queries). Hover reports changes to the top feature. The core never changes application selection on its own.

`attachInteractions(viewport, options)` is optional. It adds name/icon hover UI and an eight-per-page radial picker. Arrow keys move between candidates; Enter selects; Escape closes. Hovering previews without selecting. Candidate slots stay fixed while features move; removed choices become disabled. Closing the picker, clicking outside it, or moving the map preserves selection. Set `hover: false` or `picker: false` to disable either behavior; without the picker, a click requests the top candidate.

The interaction helper also shows a screen-space grab cursor over empty map areas, a grabbing cursor while dragging, and a pointer over selectable features. `visualFeedback` defaults to `true`; set it to `false` to use your own cursor presentation without changing hover events, selection requests, or picker behavior. Drawing takes cursor priority while it owns interaction.

Open picker choices refresh their names, icons, and availability when their feature changes or a registered icon is replaced. Hover content also refreshes when its feature changes. Reintroducing an ID enables its existing button. Default content stays intact on position-only updates. Custom `renderFeature` content is recreated for affected visible candidates and its previous `dispose` hook runs once; the button, candidate order, and button focus remain intact.

Feature rendering and disposal hooks may synchronously update features, close the interaction UI, or destroy the attachment. Superseded content is discarded and its disposal hook runs once, including content returned after destruction.

If a feature's style callback throws while its picker is open, the choice remains available by name without an icon. If custom content throws, the choice uses default content. Other candidates still refresh. Custom content and name callback failures produce `CALLBACK_FAILED` diagnostics with the affected feature ID.

Use `renderFeature(feature)` to supply custom name/icon markup. Use `contextMenu(interaction, close)` to supply application actions. Either hook can return an element or `{ element, dispose }`, for framework mounting and cleanup. The context hook may return `null`. Calling its `close` synchronously keeps that operation closed. Content returned after closure, replacement, or destruction is disposed once without mounting or taking focus. Display names use text content by default. The playground demonstrates a consumer-owned right-click menu.

Override `--rl-surface`, `--rl-text`, `--rl-border`, `--rl-active`, and `--rl-muted` on `.rl-ui` to match your application. Native buttons retain keyboard operation. Touch selection remains outside this attachment; drawing touch is delivered by the drawing attachment. Physical-device acceptance and a complete accessibility audit remain pending.

`viewport.map` exposes MapLibre for advanced integrations. The `rl:` source/layer/image namespace is reserved. Ridgeline encodes feature IDs inside its MapLibre sources; treat rendered source IDs as internal and use `_rl_feature_id` or viewport events for the original consumer ID. Use `configure` for basemap changes so Ridgeline can restore its features and selection. Consumers own the restoration of their own MapLibre additions after a style change.

## Map controls and coordinates

`attachMapControls(viewport, options)` installs native MapLibre navigation, scale and fullscreen controls by default. Each can be disabled or receive its native options. Geolocation, map-center coordinates and a consumer-supplied basemap selector are opt-in. Location is requested only when the user activates the geolocation control. `positions` selects each control's corner; `destroy()` removes only this attachment's controls.

`formatCoordinate` and `parseCoordinate` handle longitude-first decimal degrees, degrees/minutes and degrees/minutes/seconds. `geographicDistance`, `geographicBearing` and `geographicDestination` use horizontal spherical meters and clockwise-from-north degrees. They do not transform coordinate reference systems or include terrain slope. See [controls and coordinates](docs/viewport-tools.md#map-controls-and-coordinates) for examples, formatting defaults and validation.

MapLibre 6.11.0 has no public cancellation for a one-shot geolocation request or its ten-second fallback timer. Destroying the attachment clears its active watch; it cannot cancel that one-shot request.

`configurationchange` reports accepted configuration independently of asynchronous basemap loading. Fullscreen targets `viewport.container` unless a different container is supplied. Navigation, fullscreen and geolocation default to top-right, scale to bottom-left, coordinates to bottom-right and basemaps to top-left. Equivalent basemap choices retain the chosen label; an unmatched external style displays Custom. Coordinate precision is an integer from 0 to 8 in the final unit. Parsing accepts at most 256 characters and a sign or hemisphere per coordinate, never both. Spherical calculations use a 6,371,008.8 m radius. See the [controls and coordinates guide](docs/viewport-tools.md#map-controls-and-coordinates). Undefined bearings for coincident or antipodal positions and ambiguous polar directions throw `INVALID_CONFIGURATION`.

Destruction retires viewport DOM synchronously and releases native resources. It supports calls before readiness, after renderer loss, during restoration and repeated or reentrant calls from a destroy listener. The viewport emits `destroy` once and no other viewport events after destruction; `ready` still rejects if initialization was abandoned. Synchronously mounted replacements keep their own DOM and resources. Each independent cleanup is attempted even if another fails. Cleanup failures reach the logger with their original cause and `destroy.*` operation; synchronous destruction then throws the first `RidgelineError`. Native cleanup deferred until a rendering callback returns reports failures through the logger without replacing that callback's failure. A failing native teardown may leave its own resources partially released; destroy does not retry it or emit later viewport events.

## Consumer-owned live updates

Applications choose which state to display and submit it through `upsert`, using `remove` or `clear` when displayed features are no longer needed. Ridgeline validates and snapshots the current feature state for rendering. Applications own their source data, transport, history, clocks, interpolation, replay and retention policy.

```ts
// Called when your application has chosen a new display position and pose.
viewport.upsert([{
  type: 'Feature', id: 'rescue-1',
  geometry: { type: 'Point', coordinates: [6.88, 45.93] },
  properties: { name: 'Rescue 1' },
  entity: { heading: 10 },
}]);
```

`upsert` replaces the whole feature for that ID. Supply the complete current properties, entity and attachments you want retained. Feature updates preserve selection by ID and do not move the map camera. Applications can send their chosen camera through `setCamera`, and render a path as an ordinary LineString feature. See [live update ownership](docs/viewport-tools.md#consumer-owned-live-updates).

## Maps, terrain, and network access

Library defaults: OpenFreeMap Liberty, flat projection, terrain off, hillshade off, exaggeration 1. The playground explicitly enables terrain and hillshade. Both use the configured Mapterhorn Terrarium dataset through separate MapLibre DEM sources, as required by the rendering setup. The attribution control remains visible.

`configure({ projection: 'globe', terrain: true, hillshade: false })` changes those capabilities independently. `elevation` accepts a MapLibre raster DEM configuration without its `type`; supply a TileJSON URL or tile URLs with the correct encoding. Raw computation reads TileJSON encoding, zoom limits, and XYZ/TMS scheme unless the configuration overrides them. It resolves `{z}`, `{x}`, `{y}`, `{ratio}`, `{prefix}`, `{quadkey}`, and `{bbox-epsg-3857}` in tile URLs. For `encoding: 'custom'`, MapLibre 6.11.0 and Ridgeline compute height as `red * redFactor + green * greenFactor + blue * blueFactor - baseShift`. Positive `baseShift` lowers the decoded height. Wide camera patches use coarser available DEM zoom levels to keep tile loading within the bounded cache. `basemap` accepts a style URL or style object and snapshots object inputs. Camera, feature IDs, and selection survive these changes.

Use `hillshadeOptions` at creation or through `configure()` to tune shading independently of the `hillshade` toggle:

```ts
viewport.configure({
  hillshade: true,
  hillshadeOptions: {
    method: 'igor', direction: 315, altitude: 35,
    anchor: 'map', intensity: 0.5,
    shadowColor: '#253544', highlightColor: '#fff4df', accentColor: '#243a31',
  },
});
```

Methods are `standard`, `basic`, `combined`, `igor`, and `multidirectional`. Direction is 0–359 degrees, altitude is 0–90 degrees, and intensity is 0–1. Multiple directions or altitudes require `multidirectional`; use arrays for those light angles. Colors use MapLibre color strings. Settings follow [MapLibre's hillshade paint properties](https://maplibre.org/maplibre-style-spec/layers/#hillshade), whose visual effects depend on the selected method.

Exported `DEFAULT_HILLSHADE` preserves the previous appearance: standard method, direction 335, altitude 45, viewport anchoring, intensity 0.35, black shadow/accent, and white highlight. Partial option updates preserve existing fields; `undefined` fields do nothing. Options persist while shading is disabled and across basemap or elevation changes. Terrain `exaggeration` remains separate. Pass `hillshadeOptions: DEFAULT_HILLSHADE` to reset shading.

The default map assets need internet access, but no API key, account, or application backend. Public providers have their own availability and usage terms. Offline packaging, tile caching, geocoding, authentication, persistence, and application networking are outside this library. Consumer-owned feature data is not sent to tile providers; map views still cause tile requests revealing the viewed area.

## Readiness and diagnostics

`ready` means the style and Ridgeline layers can accept data, not that every tile has loaded. Queue data before readiness. A failed initial style or the default 20-second timeout rejects readiness; destroy and recreate after fixing the cause. `initializationTimeoutMs` is configurable. Construction can throw when the container or WebGL context cannot be initialized.

`destroy()` immediately rejects new mutations and removes its canvas before notifying destroy listeners. A listener can mount a replacement in the same container. If destruction happens during a native render call, the old map finishes releasing its rendering resources when that call returns.

`RidgelineError` exposes `code`, `message`, `context` (operation, recoverability, optional source/feature/model ID), and `cause`. Codes cover invalid features/configuration, initialization failure/timeout, style failure, unavailable elevation, unavailable assets, update failure, icon failure, model registration/rendering failure, use after destruction, and consumer callback failure. `onError` and the diagnostic event notify consumers. `logger` defaults to `console.error`; repeated code/operation/resource combinations are logged at most once per ten seconds. Supply `logger: () => {}` to disable logging.

Recoverable tile failures leave the rest of the map usable. The elevation-unavailable scenario deliberately requests invalid local tiles and lets you retry the default provider. A basemap that fails to load can leave an empty base; the feature model and selection remain retained for a subsequent successful style change.

## Verification

Focused Node tests cover replacement semantics, atomic invalid batches, snapshot ownership, geometry validation, diagnostics, hillshade options, coordinates. Install the browsers once, then run the suites:

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:browser
pnpm test:support
pnpm test:playground:browser
pnpm test:controls:browser
```

`pnpm test:browser` builds and packs the library, installs it in a fresh separate consumer, checks its declarations, builds that consumer, then runs independent Playwright cases in headless Chromium with software WebGL. The consumer imports package exports and styles without a source alias and uses local map resources. Each case starts with a fresh page, and failures keep a screenshot and trace in `.artifacts/playwright/`. Package setup and failing cases return a nonzero exit status. Use `pnpm test:browser -- --grep 'Picker'` to run matching cases after the same package preparation.

`pnpm test:support` runs targeted packed-package workflows in Chromium, Firefox and WebKit, including the starter recipes and input/accessibility checks. The [support matrix](docs/support.md) records actual results, commands and remaining device checks. The command's existence does not certify an engine or physical hardware.

Both packaged browser commands require the generated consumer build, a separate fresh install and production build of the starter with its own unchanged configuration, and final package file-inventory and Markdown file/heading-link validation. Failure of any stage fails the command before browser execution.

`pnpm test:controls:browser` builds and previews the separate control lab and uses real mouse, keyboard, and wheel input. Its failure artifacts are in `control-lab/test-results/`. Run one case with `pnpm exec playwright test -c control-lab/playwright.config.ts -g 'dragging an armed map'`.

`pnpm test:playground:browser` builds and previews the real playground against package exports. It verifies applied drawing selection, accepted drawings, clearing, and scenario changes with real input and deterministic map resources. Its failure screenshots and traces are in `.artifacts/playground-tests/`.

`pnpm validate` runs these browser suites with type checking, module tests, affected consumer builds, and `pnpm test:measurement` once. CI distributes the packaged browser suite across four runners, each installing and building its own packed consumer, with one browser worker per runner. See [CI and nightly validation](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/docs/ci-validation.md) for required jobs, disk preflight, generated-output retention, reports, stress runs, and enforcement. Dependency and browser installation require network access on a fresh machine. Playwright is a development dependency only. Software-rendered and synthetic-touch checks do not establish physical touch-device behavior, native Safari, complete accessibility, hardware GPU coverage, or long-session memory guarantees.

Add `--headed` to the targeted browser command to watch the case run. See [measured results](docs/performance.md) for bundle size, workload observations, and validation limits.

The [consumer journey audit](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/docs/consumer-testing-audit.md) records the testing gaps reviewed for parallel CI. The [reliability regression inventory](https://github.com/the-Drunken-coder/Ridgeline/blob/cbef055b14fe218aa24611031c4ba1a9aa0ed540/docs/reliability-validation.md) maps the consumer audit to tests retained across the terrain and drawing integrations.

## Drawing and editing

`attachDrawing` adds ground drawing gestures and a temporary draft layer. `attachDrawingControls` optionally mounts the labeled tool rail and fixed inspector into containers supplied by the application. The playground's **Drawing & editing** scenario demonstrates both and consumer-owned undo/redo.

```ts
import { attachDrawing, attachDrawingControls } from '@ridgeline/map';

const drawing = attachDrawing(viewport, {
  visualFeedback: true,
  createFeature: () => ({
    id: crypto.randomUUID(),
    properties: { name: 'Drawing' },
  }),
  submit: async (change, signal) => {
    // Application code: atomically compare change.before, then persist change.after.
    // For deletion, change.after is absent. Do not upsert into the viewport here.
    await saveDrawingChange(change, signal);
    return { accepted: true };
    // Return { accepted: false, reason: '...' } to retain an editable draft.
  },
  canEdit: (feature, operation) => mayChangeDrawing(feature.id, operation),
  canSnap: feature => feature.properties.snappable !== false,
});
const controls = attachDrawingControls(viewport, drawing, {
  tools: document.querySelector<HTMLElement>('#drawing-tools')!,
  inspector: document.querySelector<HTMLElement>('#drawing-inspector')!,
  units: 'metric',
});
// Consumer-defined functions above own application validation and persistence.
// On unmount: controls.destroy(); drawing.destroy();
```

While a ground drawing tool is placing points, the attachment shows a small terrain footprint and an outlined crosshair at the next valid target. Missing elevation, sky, and positions beyond the globe prevent placement; existing draft points remain. The footprint is a visual contact cue, not a measured area. `visualFeedback` defaults to `true`; set it to `false` to hide these visuals while retaining target validation and snapping. This works without `attachDrawingControls` or `attachInteractions`. Programmatic geographic edits through the drawing session are unchanged.

The target follows camera movement, projection and viewport changes while the pointer stays still. Changing the basemap or elevation source clears the old marker; placement and screen-derived edits resume when the replacement terrain is ready. A loading or failed terrain source is unavailable, unlike deliberately disabled terrain. The draft stays editable, but clicks and handle movements that need a ground position wait for valid displayed terrain. MapLibre 6.11.0 supplies the terrain intersection and coverage data used for this check; renderer upgrades need the terrain browser checks.

Drag the map or right-drag to rotate during placement. The ground target and preview pause during navigation, then resolve at the current pointer and camera position when the gesture ends. Releasing the drag does not place a point. Accepted native camera navigation, including wheel/keyboard zoom, keyboard pan/rotation and navigation controls, ends a held handle gesture while retaining one undo action. Programmatic camera movement updates the target without ending a valid gesture. The playground's **Drawing & editing** scenario demonstrates this with the public drawing attachment.

The API supports lines, polygons with holes, rectangles, circles, and single-headed arrows. Existing ordinary points, lines, and polygons can also be edited with `drawing.edit(id)`. Entity geometry stays outside this editor. `tools`, `styleFields`, and `defaults` let consumers restrict creation and appearance controls. `createFeature` supplies only identity and properties before placement; `submit` receives the completed geometry. `canEdit` is consulted before editing actions and submission. New drawings are checked after the first point is placed, using their current, possibly incomplete geometry. Call `refreshPermissions()` when application permissions change while a draft is open.

Click or tap to add line or polygon vertices. Circles use a center and radius point. Rectangles use a center and a corner, then expose width, height, and bearing. Use Finish to submit and Cancel or Escape to discard. Drag handles to reshape, the central movement handle to move a line or polygon, and the center handle to move a circle or rectangle. Click or tap a `+` handle to insert a vertex. Focused handles support arrow keys, Shift+arrows for a larger step, and Delete/Backspace for ordinary vertices. Hold Alt to bypass snapping during placement, dragging, or keyboard handle movement. During touch drawing, one finger places or edits and two fingers navigate the map. Use explicit Finish/Cancel; double-tap completion and pen-specific placement are not supported. Physical touch-device acceptance remains pending.

Screen-derived drawing edits require a valid ground target before snapping. Vertex snapping defaults on and can be disabled with `snapping: { vertices: false }`; edge snapping is opt-in with `snapping: { edges: true }`. Eligible visible targets within 12 CSS pixels can snap, with vertices taking precedence. `canSnap` filters both kinds and Alt temporarily bypasses them. The snap ring and guide show the exact target when it differs from the screen pointer. An unavailable terrain target leaves the last valid draft geometry in place during a drag or keyboard step. Valid movement already made during the drag remains one undoable gesture. Explicit geographic edits through the drawing session continue to use the positions the consumer supplies. The editor's `setSnapping` toggles snapping and `setEdgeSnapping` toggles its edge option.

`getState()` returns detached snapshots with the phase, draft, validation message, draft history availability, and measurements for the committed draft. `onChange` subscribes to state changes. Programmatic editing uses `start`, `addPoint`, `setShape`, `setStyle`, `moveVertex`, `insertVertex`, `removeVertex`, `translate`, and `reverse`. `beginGesture` / `endGesture` group repeated changes into one draft undo action. `undo` and `redo` operate on the draft only, with up to 100 individual draft actions retained. The optional controls accept a consumer `history` object for accepted-change undo/redo. Consumers must invalidate accepted history entries affected by external updates; the playground demonstrates this.

For polygons, `startHole`, `finishRing` and `removeHole` operate inside the current draft. `finishRing()` ends placement after at least three vertices, including an invalid ring. Its geometry stays editable and undoable; `finish()` still requires a valid complete shape. Ring 0 is the exterior; positive ring numbers address holes in vertex and segment operations. `getSegments()` lists horizontal distances and bearings; `setSegment({ ring, index }, { length, bearing })` holds the start vertex fixed and moves its end. Each numeric field change is one draft undo action. The inspector exposes ring selection, hole creation/deletion and distance/bearing fields. See [drawing extensions](docs/viewport-tools.md#drawing-extensions) for ring closure and touch cancellation.

`DrawingShape` now has a separate polygon union member with optional `holes`. Code whose type utilities depend on the former combined union member may need adjustment; factories that construct a shape from a broadly typed `line | polygon | arrow` kind should narrow the kind before construction. Preserve optional holes when rebuilding polygon definitions. Serialized version-1 polygons without holes remain compatible.

`setActiveSegment({ ring, index })` identifies the directed segment on the map without changing draft geometry or undo history. Pass `undefined` to clear it. The inspector updates this feedback automatically. Vertex snap rings are solid; edge snap rings are dashed.

A pending request locks editing and duplicate submission. Rejections preserve the draft. Update and delete permissions are independent; `refreshPermissions()` aborts a pending request if permission for that operation is revoked, and its late acceptance is ignored. An external update to the edited feature preserves the draft, aborts the submission signal, and blocks acceptance until `restart()` or cancellation. Removal requires cancellation. Unrelated updates do not interrupt editing or discard an unchanged visible snap at release. Each release resolves current displayed ground and snapping once, without retrying consumer snap callbacks. Changes to queried snap candidates, snap policy, camera, scene, permission or the draft during the callback cancel the obsolete input. Destruction ignores late results and releases handles, layers, and interaction ownership. Consumers must enforce atomic version or baseline checks in their persistence layer: an abort signal alone cannot reverse a remote write that already happened. This library applies accepted changes to the viewport; the callback owns saving, not a second viewport mutation.

A throwing `canEdit` blocks the affected operation and preserves the draft, history, and last permitted geometry. It shows a permission-check failure rather than an ordinary denial. Repair the callback and call `refreshPermissions()` to recover. Failure during a pending request aborts its signal but keeps editing and cancellation locked until the consumer promise settles, even if permissions recover first. Its late acceptance is ignored.

A throwing `canSnap` excludes that feature from the current target resolution. Other permitted nearby vertices or valid unsnapped ground remain usable; terrain validation still applies. Alt bypass does not call the filter. Both callbacks report `CALLBACK_FAILED` with the original cause, affected feature ID, and operation `drawing.canEdit` or `drawing.canSnap`. Each callback reports at most once per ten seconds per drawing attachment across all features and permission operations, including diagnostic events and `onError`. Refresh, success, and draft replacement do not reset this bound. Checks still evaluate for recovery, and obsolete work stops after callbacks replace or invalidate its owner.

New drawings include a versioned GeoJSON foreign member, `drawing: { version: 1, shape, style }`. Keep it alongside ordinary `geometry` and application `properties` when saving. Circles retain center/radius; rectangles retain center/width/height/bearing; arrows retain their line vertices and direction. Polygons use open `shape.vertices` and optional open `shape.holes`; `shapeGeometry(shape)` closes every GeoJSON ring. This additive extension keeps version 1 compatible with existing single-ring drawings. `upsert` permits coordinate rounding within 0.0000001 degrees but rejects different geometry types, topology, or larger differences from the shape definition. Geometry-only edits to imported features preserve their ordinary geometry and consumer-controlled appearance. Changing their drawing style adds `drawing` metadata; undoing that style change before submission keeps them ordinary. Drawing appearance overrides the consumer style callback for the drawing's stroke, fill, width, opacity, dash, and label. Both the saved shape definition and geometry use bounded longitude/latitude; render-only coordinates are unrolled at the date line.

Distances and areas use a spherical Earth radius of 6,371,008.8 m, independent of terrain slope, exaggeration, and camera zoom. Rectangles are defined by center-relative east/north dimensions rotated by bearing and projected geodesically onto the ground. Circle display geometry uses 96 segments; its area uses the spherical circle definition. Polygon area subtracts holes and perimeter includes every ring. Holes must lie strictly inside the exterior and cannot touch, intersect, overlap or nest. Invalid draft measurements remain raw calculations and can include negative area; the drawing controls show area as unavailable until geometry is valid. Measurements are geographic estimates, not ellipsoidal survey measurements. Boundary intersection checks follow straight displayed Mercator edges, including at high latitude. This corrects earlier longitude/latitude-plane checks and can reject previously accepted high-latitude shapes whose displayed edges cross. Self-intersecting polygons, degenerate edges, pole-enclosing shapes, and hemisphere-scale shapes cannot be submitted. Metric and imperial units affect display only; stored dimensions are meters and bearings are degrees clockwise from north.

`createDrawingSession` supports the same preview without a map. Call `setCursor(position)` to preview the next placement, `getPreview()` to read its shape, or `setCursor(undefined)` to clear it. Both session and attached editor expose `getMeasurements()` and `onPreview()`: live measurements include the pointer preview, while `getState().measurements` excludes it. `onPreview()` fires for cursor movement and draft changes; `onChange()` reports draft state, history, and submission status.

`viewport.acquireInteraction(owner)` reserves feature clicks, hover, context menus, and selection requests while leaving camera navigation available. It returns an idempotent release function. `interactionchange` lets other tools close their UI; `selectionchange` reports consumer-applied selection. Only one drawing adapter may attach to a viewport. Forwarding wrappers around a Ridgeline viewport are supported when they expose the same MapLibre map; they share that attachment limit. Integrations that listen directly to MapLibre events must honor `getInteractionOwner()`; the separate control lab does not run in the playground.
