# Ridgeline

A framework-neutral TypeScript map viewport with an optional radial feature picker. Consumers supply data and own their application workflows. MapLibre GL JS renders the map; Mapterhorn supplies the default elevation data.

## Core design decisions

Ridgeline is built for anyone who needs an easy-to-use, reusable map viewport. Core design decisions must serve consuming applications generally.

- The playground is one consumer. Its job is to host the map, let people explore it, and exercise the same public API available to everyone.
- The library must work without the playground's code, sidebar, sample data, scenario names, state, or workflows. Dependencies flow from the playground to the library.
- Consumers choose their data, surrounding UI, styling, and application behavior. A playground request belongs in the library only when it solves a reusable mapping need; demonstration controls and scenario logic stay in the playground.
- Keep integration simple through sensible defaults, a small documented API, and optional interaction tools. General usefulness does not require a speculative plugin framework or universal rendering-engine abstraction.

Review each core change against this question: can another application use it without adopting the playground's structure or assumptions? Verify package usability in a separate consuming application, as well as in the playground.

## Run locally

The playground combines the approved Field desk sidebar with Map bench's in-map wheel. It starts over Chamonix with terrain and hillshade enabled. Choose overlapping features to try groups of 2, 3, 8, 10, and 20, or moving features for the 1,000-point workload.

The **SIDC Kit integration** scenario demonstrates [SIDC Kit](https://github.com/the-Drunken-coder/sidc-kit) in the playground. Search its curated symbols, preview one, choose **Place on map**, and click once to add it. Escape or **Cancel** exits placement. Select a symbol to inspect its SIDC and interpreted fields; remove it or reset to the three samples. Leaving the scenario or reloading discards changes.

SIDC Kit is a playground-only development dependency, loaded when that scenario opens. Its search, rendering, and explanation workflows are not Ridgeline map features. The map library receives ordinary features and registered icons through its existing public API; its exports, runtime dependencies, and build contain no SIDC integration. This demo uses the published `sidc-kit@0.3.2` curated catalog, which is smaller than the current upstream repository's catalog. Structured building, reverse lookup, symbol editing, and persistence are outside this demo.

Use Node 22.12+ and pnpm 11.

```sh
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm test:browser
pnpm build:playground
pnpm measure
```

`pnpm build` produces the importable ESM library and declarations in `dist`. `pnpm build:playground` also builds the playground against those exports, without development source aliases. This package is private and has not been published to npm. Install a local tarball in another application:

```sh
pnpm build
pnpm pack --pack-destination .artifacts
# In the consuming application:
pnpm add /absolute/path/to/Ridgeline/.artifacts/ridgeline-map-0.1.0.tgz maplibre-gl@6.11.0
```

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

`MapFeature<YourProperties>` is GeoJSON `Point`, `LineString`, or `Polygon`, with a required nonempty string ID. Coordinates are `[longitude, latitude]`, within geographic bounds; polygon rings must close. Only 2D positions are supported. Features attach to the ground when terrain is enabled.

| Operation | Contract |
| --- | --- |
| `upsert(features)` | Validate and copy the entire batch, then replace geometry and properties for each ID. Last duplicate in a batch wins. |
| `remove(ids)` / `clear()` | Remove features and their selection highlights. Unknown IDs are harmless. |
| `retryUpdates()` | Retry failed incremental changes once using the latest stored data, including pending removals. |
| `getFeature(id)` / `getFeatures()` | Return snapshots, not mutable internal objects. |
| `setSelection(ids)` | Show the application's chosen IDs. Unknown IDs are ignored. |
| `setCamera(camera, { duration })` | Move immediately unless an animation duration is explicitly supplied. |
| `fitBounds(bounds, { duration, padding })` | Frame coordinates, with 48 px padding by default. |
| `configure(settings)` | Independently change basemap, projection, terrain, hillshade, exaggeration, or elevation provider. |
| `on(event, callback)` | Subscribe; the returned function unsubscribes. |
| `destroy()` | Release the map, workers owned by that map, listeners, animation frame, observer, and attached UI. Safe before readiness or repeatedly. |

Updates are accumulated by ID and submitted once per animation frame using MapLibre's incremental GeoJSON API. Moving a feature never moves the camera. The library snapshots data, so properties must be structured-cloneable. Replacing an ID also replaces its name and styling inputs. Use immutable IDs separate from display names.

Only one renderer submission runs at a time; updates arriving during it are coalesced for the next frame. A throwing style callback leaves that feature's last rendered version visible and reports `UPDATE_FAILED` with its `featureId`. Other features and removals in the batch still proceed. Renderer rejections and source error events retain the submitted IDs for recovery. No failed update retries automatically. Fix the callback or renderer problem, then call `retryUpdates()`, or replace the affected feature with `upsert()`. Retries use current data and cannot overwrite a newer queued change. A basemap rebuild restores features whose styling succeeds and retains failed IDs for retry. Store reads reflect accepted data immediately, so failed features may differ from the display until recovery succeeds.

The `name` accessor defaults to `properties.name`, then the ID. The `style` accessor supports `color`, `radius`, `lineWidth`, `fillOpacity`, `icon`, and `label`. Register icons with `registerIcon(id, { image, pixelRatio, url? })`; `image` is decoded `ImageData`, `ImageBitmap`, or an image element. Ridgeline does not fetch application icons. An optional URL lets DOM UI reuse the same picture. Registration replaces an existing icon ID. Keep the application's registered icon set bounded; unregistering individual icons is deferred. Labels require the basemap's glyph configuration and a compatible `Noto Sans Regular` font.

## Interaction and application UI

Core events are `click`, `hover`, `contextmenu`, `selectionrequest`, `datachange`, `camerachange`, `diagnostic`, and `destroy`. Pointer interactions include original consumer features in topmost-first order, screen coordinates, geographic coordinates, and the original mouse event. Click picking includes features within 12 CSS pixels. Hover reports changes to the top feature. The core never changes application selection on its own.

`attachInteractions(viewport, options)` is optional. It adds name/icon hover UI and an eight-per-page radial picker. Arrow keys move between candidates; Enter selects; Escape closes. Hovering previews without selecting. Candidate slots stay fixed while features move; removed choices become disabled. Closing the picker, clicking outside it, or moving the map preserves selection. Set `hover: false` or `picker: false` to disable either behavior; without the picker, a click requests the top candidate.

Open picker choices refresh their names, icons, and availability when their feature changes. Reintroducing an ID enables its existing button. Default content stays intact on position-only updates. Custom `renderFeature` content is recreated for affected visible candidates and its previous `dispose` hook runs once; the button, candidate order, and button focus remain intact.

If a feature's style callback throws while its picker is open, the choice remains available by name without an icon. Other candidates still refresh.

Use `renderFeature(feature)` to supply custom name/icon markup. Use `contextMenu(interaction, close)` to supply application actions. Either hook can return an element or `{ element, dispose }`, for framework mounting and cleanup. The context hook may return `null`. Display names use text content by default. The playground demonstrates a consumer-owned right-click menu.

Override `--rl-surface`, `--rl-text`, `--rl-border`, `--rl-active`, and `--rl-muted` on `.rl-ui` to match your application. Native buttons retain keyboard operation. Current validation is for desktop; touch interaction and a complete accessibility audit remain future work.

`viewport.map` exposes MapLibre for advanced integrations. The `rl:` source/layer/image namespace is reserved. Use `configure` for basemap changes so Ridgeline can restore its features and selection. Consumers own the restoration of their own MapLibre additions after a style change.

## Maps, terrain, and network access

Library defaults: OpenFreeMap Liberty, flat projection, terrain off, hillshade off, exaggeration 1. The playground explicitly enables terrain and hillshade. Both use the configured Mapterhorn Terrarium dataset through separate MapLibre DEM sources, as required by the rendering setup. The attribution control remains visible.

`configure({ projection: 'globe', terrain: true, hillshade: false })` changes those capabilities independently. `elevation` accepts a MapLibre raster DEM configuration without its `type`; supply a TileJSON URL or tile URLs with the correct encoding. `basemap` accepts a style URL or style object. Camera, feature IDs, and selection survive these changes.

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

`RidgelineError` exposes `code`, `message`, `context` (operation, recoverability, optional source/feature ID), and `cause`. Codes cover invalid features/configuration, initialization failure/timeout, style failure, unavailable elevation, unavailable assets, update failure, icon failure, use after destruction, and consumer callback failure. `onError` and the diagnostic event notify consumers. `logger` defaults to `console.error`; repeated code/operation/source combinations are logged at most once per ten seconds. Supply `logger: () => {}` to disable logging.

Recoverable tile failures leave the rest of the map usable. The elevation-unavailable scenario deliberately requests invalid local tiles and lets you retry the default provider. A basemap that fails to load can leave an empty base; the feature model and selection remain retained for a subsequent successful style change.

## Verification

Focused Node tests cover replacement semantics, atomic invalid batches, snapshot ownership, geometry validation, diagnostics, and hillshade option validation. Install Chromium once, then run the browser checks with one command:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

The command builds and packs the library, installs it in a fresh separate consumer, checks its declarations, builds that consumer, and runs the existing fixture in headless Chromium with software WebGL. It exits nonzero for a failed check, uncaught browser error, timeout, or build/setup failure. It uses a local background style and no external map services. Dependency and browser installation require network access on a fresh machine. Playwright is a development dependency only.

For interactive debugging, the same fixture can still be prepared manually:

```sh
pnpm build
pnpm pack --pack-destination .artifacts
node scripts/prepare-consumer.mjs
cd .artifacts/consumer
pnpm install
pnpm build
pnpm dev
```

Open that fixture at port 5174 to inspect its results. It has no source alias and includes focused recovery, picker-refresh, and hillshade configuration regressions. See [measured results](docs/performance.md) for bundle size, workload observations, and validation limits.
