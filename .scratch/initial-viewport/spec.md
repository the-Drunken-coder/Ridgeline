# Ridgeline initial viewport

Status: Initial implementation completed locally using Field desk for the surrounding UI and Map bench for UI within the map. Package and playground builds, five unit tests, and six packaged-consumer browser checks pass. Safari validation remains outstanding; see `docs/performance.md`.

## Confirmed brief

- Independent, lightweight TypeScript mapping library with one package and one standalone playground.
- Reusable interactive viewport. Tile services and a new rendering engine are outside scope.
- Start with MapLibre GL JS. Do not build a universal rendering-engine abstraction.
- Default to configurable Mapterhorn elevation data. Use native MapLibre hillshade derived from the same underlying elevation data as terrain.
- Configure projection, terrain, hillshade, basemap styling, and camera independently, subject to verified renderer constraints.
- Provide sensible defaults and a small public API for points, lines, polygons, icons, labels, stable-ID feature updates, camera control, and selection and interaction events.
- Specialized tools are optional. Prefer straightforward extension points to an elaborate plugin framework.
- Consumers supply data and own application workflows. Authentication, application networking, persistence, business logic, and Atlas dependencies stay outside the library.
- Atlas may become a consumer. Integration requests become generic library features only when they belong in a reusable map viewport.
- Prioritize incremental updates, predictable initialization and cleanup, minimal dependencies, and measured bundle size and runtime performance.
- Exercise the public API with representative static and moving sample data.
- Deliver a minimal implementation importable by another application, then expand incrementally.
- Before non-trivial playground UI implementation, present distinct static mocks and wait for the user's choice.

## Accepted in interview round 1

1. The first consumer demonstrates moving objects, routes, areas, selection, and camera control. Terrain elevation and hillshade are also required in this first demonstration. Drawing, editing, clustering, and specialized tools are deferred.
2. Backend-free means no application backend or account requirement. Public map assets may be fetched over the internet; their locations are configurable. Offline packaging and caching are deferred.
3. The package is framework-neutral TypeScript and accepts a DOM container. The playground uses Vite and TypeScript. A dedicated React adapter is deferred.
4. Consumers provide GeoJSON with required stable string IDs, longitude/latitude coordinates, and typed consumer properties. The initial API supports points, lines, polygons, batch upsert, and removal by ID.
5. Common styling options cover colors, line widths, fills, icons, and labels. Documented access to the underlying MapLibre map supports advanced integrations, which intentionally depend on MapLibre. No second styling language.
6. Selection is consumer-controlled. Ridgeline reports interactions and displays selected IDs supplied by the consumer. The playground demonstrates click-to-select. Click and hover are in scope; dragging and editing are deferred.

## Accepted in interview round 2

7. Target current desktop Chrome and Safari first. The baseline workload is 1,000 points, including 100 moving at 10 updates per second, with representative routes and polygons. Measure larger workloads before promising limits. Mobile is deferred.
8. Library defaults are flat projection with terrain and hillshade disabled. The playground opens over mountainous terrain with both enabled. Projection, terrain, and hillshade have independent controls.
9. Initial elevation support means visible terrain and hillshade, with features attached to the ground. Elevation queries, airborne objects, and elevation profiles are deferred.
10. Upserting an existing feature ID replaces its geometry and properties completely. IDs are unique within a viewport. Removing an unknown ID is a no-op. Removed features lose their highlight. Data updates do not move the camera.
11. Interaction events expose matching consumer features in visual stacking order, topmost first. Empty-map clicks expose no matches. Hover identifies the top feature. The radial picker requirement below supersedes automatic topmost selection in the playground when several candidates are present.
13. Feature positions update directly. Consumers own simulation time and interpolation. Camera commands offer immediate movement and explicitly requested animation. Following a moving feature remains a consumer workflow.
14. Recoverable resource failures leave usable map content visible and report the affected capability. Readiness means the style and library-owned layers can accept data, not that every tile has finished loading. Fatal initialization failures reject readiness. Disposal is safe during loading, after readiness, and when called repeatedly.

### Radial feature picker

The user added a first-release requirement: clicking overlapping features or features packed into a small area opens a radial picker. Users hover over candidates and choose which feature to select. The user recalls a similar interaction in ATAK; this is inspiration, not a verified specification of that application's behavior.

Provide the picker as an optional reusable interaction tool, enabled in the playground, rather than a playground-only implementation. A choice still goes through the consumer-controlled selection contract. Drawing, editing, and automatic clustering remain deferred.

## Accepted in interview round 3

15. Clicking an isolated feature selects it immediately in the playground. Several overlapping or closely packed candidates near the click open the radial picker.
16. Show at most eight candidates per page, with previous/next controls and a count. Preserve the radial presentation for larger groups.
17. Hovering a candidate shows its name and temporarily highlights the corresponding feature without changing selection or moving the camera. Keep candidate positions in the picker stable while map features move. Clicking a candidate requests selection. Escape, clicking outside, or moving the map dismisses the picker without changing selection.

### Feature identity and names

Consumers supply a stable ID for each feature. Updates from an external service enter through the consuming application and identify features by that same ID. A feature's display name is separate from its identity; renaming or moving a feature does not change its ID.

The user requires readable feature names on map hover and in the radial picker. Each picker choice displays the feature's icon when present, followed by its name. A missing icon must not prevent naming or selection. All playground features have meaningful names, including duplicate-name cases to demonstrate distinct IDs.

Implementation decision under the user's delegation: default name lookup to the GeoJSON `name` property and allow a consumer-provided name accessor for existing data schemas. An unnamed feature falls back to its stable ID. Reuse the feature's configured icon in the map and picker. Treat consumer display text as text, not HTML.

### Application-styled map UI

The user wants hover information, radial choices, and custom interactions such as right-click menus to match the consuming application's UI.

Implementation decision under the user's delegation: provide themeable optional built-in hover and picker UI, with small content-rendering hooks for consumer-owned UI. Expose the feature IDs, event location, and relevant feature data for click, hover, and right-click interactions. Consumers supply contextual menu content and actions; Ridgeline handles anchoring and cleanup for UI attached through its supported hooks. Keep this framework-neutral and avoid a plugin system. Exact callback signatures, theme tokens, and positioning internals are agent-owned decisions.

Custom UI remains optional. Demonstrate a consumer-defined context menu in the playground using the same extension point offered to other applications. The menu is distinct from the radial picker: the picker chooses a feature; a context menu presents actions supplied by the application.

### Playground scenarios

The sidebar includes a dropdown for switching among testing scenarios. Each scenario exercises the public API and resets its owned sample data, UI, and timers when replaced.

- Overlapping features: distinct groups of 2, 3, 8, 10, and 20 named features. Include exact overlaps and close spacing, icons and no icons, and pagination beyond eight. These are sample arrangements, not an automatic map-clustering feature.
- Terrain and hillshade: a mountainous opening view with independent terrain, hillshade, and projection controls.
- Moving features: the accepted baseline workload, with stable-ID updates and picker behavior while candidates move.
- Interaction and recovery examples: demonstrate application-styled hover/context UI and clear diagnostics for an unavailable resource, without adding a backend.

The overlap scenario and scenario dropdown are explicit user requirements. The other scenarios are agent-selected examples supporting the accepted first-release requirements; their visual presentation will be included in the mock review.

### Error reporting

The user explicitly requires clear error codes and useful diagnostic logging for consumers integrating the package. Use stable structured codes, readable messages, operation context, affected capabilities, and underlying causes where available. Distinguish fatal initialization failures from recoverable asset failures. Provide an injectable logger and a useful default, with duplicate repeated failures suppressed to avoid flooding the console. Exact types and code names are implementation decisions.

### Decision ownership

The user is nontechnical and delegates technical decisions to the agent. Ask about choices that change user-visible behavior, explain the alternatives in those terms, and give a recommendation. Do not ask the user to choose internal architecture, dependency mechanics, types, or packaging techniques.

Under this delegation, preserve Ridgeline-owned features, selection display, and camera across basemap, projection, and elevation configuration changes. Advanced consumers own restoration of their direct MapLibre additions and must avoid changing Ridgeline-owned resources. This resolves the original question 12 implementation contract; the user's numbered answer 12 introduced the radial picker.

## Reference application

The user identified [ORBAT Mapper](https://github.com/orbat-mapper/orbat-mapper) as inspiration and a reference for troubleshooting and lessons. Similar capabilities may be relevant over time. This does not authorize copying its system or expanding the first release to its full feature set.

Research identified [rendering measurements in issue 643](https://github.com/orbat-mapper/orbat-mapper/issues/643) and [external state updates in discussion 253](https://github.com/orbat-mapper/orbat-mapper/discussions/253) as useful references. Lessons to evaluate in Ridgeline are separating camera movement from feature-data updates, measuring initialization separately from incremental updates, and controlling growth of registered image assets. These are design inferences from another application, not measured Ridgeline results or reasons to adopt its domain model.

## Verified renderer facts

- MapLibre supports terrain with globe projection. Exact supported behavior must be checked against the version selected for implementation. [MapLibre v5 release notes](https://github.com/maplibre/maplibre-gl-js/releases/tag/v5.0.0).
- MapLibre's official terrain example uses two raster DEM sources pointing to the same Mapterhorn TileJSON, one for terrain and one for native hillshade. Sharing the underlying elevation data does not require sharing a renderer source instance. [Official terrain example](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/).
- MapLibre exposes incremental GeoJSON updates with unique feature IDs. Ridgeline's public upsert behavior still needs its own explicit contract. [GeoJSONSource API](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/).
- Mapterhorn documents public Terrarium-encoded elevation tiles. Preserve its attribution and keep the provider configurable. [Mapterhorn data access](https://mapterhorn.com/data-access/).

## Current decision frontier

The user confirmed the consolidated experience and chose a hybrid of the reviewed mocks: Field desk's sidebar and surrounding layout, with Map bench's in-map radial wheel. Keep selection details in the sidebar. This authorizes implementation of the selected direction; no further architecture interview or mock approval is needed for this scope.

## Implementation disposition

- Chose OpenFreeMap Liberty, locally generated playground icons, basemap-provided label glyphs, and ESM/declaration exports. The public API and independent packed-consumer verification are documented in `README.md`.
- Measured the accepted workload with terrain/hillshade and brief pan/zoom. Recorded wrapper, renderer, worker, and CSS sizes separately in `docs/performance.md`. Broader device budgets await repeated measurements.
- Presented three distinct static mocks before implementation; the user selected the Field desk / Map bench hybrid.
- Specialized tools other than the requested optional radial picker and small application-UI extension points remain deferred.

The interview ends with a complete specification and explicit confirmation of shared understanding before implementation.
