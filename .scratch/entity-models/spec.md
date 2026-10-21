# Entity models and representation switching

Status: Approved for implementation on 2026-10-04. Implemented and locally verified as recorded in [closeout](closeout.md). Further Mac and desktop-GPU acceptance is WAIVED / NOT PERFORMED under the [2026-10-21 amendment](#acceptance-amendment-2026-10-21). No measured triangle guideline or cost advisory has been produced.

Source: [Entity models and representation switching](https://github.com/the-Drunken-coder/Ridgeline/issues/71). The user approved all seven final recommendations in the live discussion on 2026-10-04. Earlier architecture and appearance decisions are indexed by that map. This file is the canonical implementation requirement source.

Final decisions: [consumer API](https://github.com/the-Drunken-coder/Ridgeline/issues/77#issuecomment-5983846918), [interaction and placement](https://github.com/the-Drunken-coder/Ridgeline/issues/78#issuecomment-5983847186), and [browser/verification targets](https://github.com/the-Drunken-coder/Ridgeline/issues/79#issuecomment-5983847512).

## Purpose and scope

An Entity keeps its Feature ID, display name, consumer-owned selection and attachments while switching between its Icon and a Model according to camera distance. Ordinary point features keep icons. Ridgeline supplies no model assets and fetches no application model files.

Implement on a fresh branch based on current main. Keep `prototype/entity-models` unmerged. Its parser, projection work and evidence are references; import useful code selectively, without its comparison UI, instrumentation or temporary registry. A small public-API playground example and meaningful packaged-consumer tests belong with production work.

Consumers own model acquisition, their color palette, entity motion and application workflows, as required by [consumer-owned workflows](https://github.com/the-Drunken-coder/Ridgeline/blob/main/docs/adr/0001-consumer-owned-workflows.md). Existing geographic placement, snapshot ownership, errors, interaction leases and callback-safe disposal contracts remain applicable.

## Public contract

Use the following contract when implementing. Names and units are explicit so consumers do not need renderer knowledge.

```ts
type ModelAppearance =
  | { mode: 'color'; color: string }
  | { mode: 'original' };

type ModelDefinition = {
  bytes: ArrayBuffer;
  metersPerUnit?: number; // Positive; defaults to 1.
  headingOffset?: number; // Degrees clockwise; defaults to 0.
  appearance?: ModelAppearance;
};

type EntityModelSettings = {
  switchDistanceMeters: number;
  deadZoneMeters: number;
  minimumSizePixels: number; // CSS pixels; zero means real size only.
};

type EntityModel = Partial<EntityModelSettings> & {
  id: string;
  followSlope?: boolean; // Defaults to true for ground placement.
};
```

- Add `registerModel(id, definition): Promise<void>` and `unregisterModel(id): void` to the Viewport. Registration is per viewport. The promise resolves after parsing, image decode, successful GPU upload and atomic installation of that revision. Before viewport readiness or during context loss, it waits for a usable renderer; readiness failure rejects it. `viewport.ready` continues to mean viewport readiness, not completion of all model loads.
- Extend Entity with optional `model: EntityModel`, `heading`, `pitch` and `roll`. Heading is clockwise from geographic north, independent of travel direction and sensor bearing. Pitch is positive nose-up; roll is positive right-side-down. Angles are degrees. Missing Heading leaves the Entity as an Icon and reports a diagnostic. Missing pitch/roll means zero for airborne placement. Ground slope following supplies ground pitch/roll; explicit pitch/roll applies when slope following is disabled.
- Keep Icon and label selection in the existing style callback. Add `FeatureStyle.modelAppearance?: ModelAppearance`. This avoids accidentally treating the existing generic `style.color` default as an assigned model color.
- Add `entityModels: EntityModelSettings` to viewport configuration, with defaults of 2,000 m, 200 m and 40 CSS px. Per-entity fields override these defaults. Configuration changes update existing entities without changing their identity or selection.
- Validate effective settings atomically: positive finite switching distance, finite nonnegative dead-zone width smaller than twice the distance, and finite nonnegative screen-size floor. Validate model IDs, finite angles, positive finite scale and appearance colors through the existing error mechanism. Copy bytes and settings before asynchronous work; subsequent consumer mutation cannot change an accepted registration.
- Extend `getEntityState` snapshots with `representation: 'icon' | 'model' | 'withheld'` and optional `model: { id, status: 'loading' | 'ready' | 'unavailable' | 'failed', replacementPending: boolean }`. Status describes the referenced asset, not pixel visibility. A working old registration stays ready while replacement is pending. First registration remains loading until installed; absent/unregistered assets are unavailable; failed initial registration is failed. Representation describes the latest renderer publication, not whether the entity is within the camera view or behind terrain; renderer loss or placement that forbids both forms is withheld. Publish changes through `entitychange`. Keep parser arrays, textures, GPU handles and hysteresis state private; do not add a second feature registry or an application palette registry.

Two entities can reference the same Model ID with different `modelAppearance` values. Geometry and textures are shared; their appearance and selection are independent. Updating a style or changing a palette-driven entity through `upsert` does not reload its registered Model. Application palette changes use the existing update flow.

Contract sketch for the public API, with application-supplied `container` and `tankBytes`:

```ts
const appearances = new Map<string, ModelAppearance>([
  ['orange-tank', { mode: 'color', color: '#db7428' }],
  ['original-tank', { mode: 'original' }],
]);
const viewport = createViewport({
  container,
  style: feature => ({
    icon: 'tank-icon',
    modelAppearance: appearances.get(feature.id),
  }),
});
await viewport.registerModel('tank', {
  bytes: tankBytes, metersPerUnit: 1, headingOffset: 90,
});
viewport.upsert([
  {
    type: 'Feature', id: 'orange-tank', properties: {},
    geometry: { type: 'Point', coordinates: [6.87, 45.92] },
    entity: { model: { id: 'tank' }, heading: 90 },
  },
  {
    type: 'Feature', id: 'original-tank', properties: {},
    geometry: { type: 'Point', coordinates: [6.88, 45.92] },
    entity: { model: { id: 'tank' }, heading: 180 },
  },
]);
appearances.set('orange-tank', { mode: 'color', color: '#2478c4' });
const orange = viewport.getFeature('orange-tank');
if (orange) viewport.upsert([orange]);
await viewport.registerModel('tank', { bytes: replacementBytes });
viewport.unregisterModel('tank');
```

The application registers `tank-icon` through the existing icon API. Replacement rejects on failure while retaining the working Model. Removing the Model leaves both entities and their selection intact. The implemented package exposes these model methods; see [README](../../README.md) for consumer examples.

### Registration and lifecycle

Initial loading, unavailable models and rejected initial registrations use the existing Icon representation. There is never a partially accepted Model. Registration failure rejects the promise and reports a named diagnostic with the model ID and operation.

Replacing a Model ID is atomic. Keep its last successfully registered version until the replacement is ready; failed replacement retains that version. Removing a registration discards pending work and its owned resources, returning referencing entities to Icons without removing the entities or their selection. Unknown IDs are harmless. Removing one entity does not remove a shared registration.

Each registration has a current revision. Completion after replacement, removal or viewport destruction cannot install resources, restore an entity, schedule a render or mutate current state. Its pending promise rejects with `RidgelineError` code `MODEL_LOAD_CANCELLED`; intentional cancellation does not emit an asset-failure diagnostic. Partial decode/upload failure cleans up newly owned resources while preserving a working previous registration.

Basemap changes retain model registrations, resources and hysteresis choices. Context loss withholds drawing until restoration; rebuild resources from retained source bytes and restore current entities, colors, selection and hysteresis choices, including inside the dead zone. Already completed registration promises remain completed. Destroy releases bytes, decoded images, arrays, GPU resources, listeners and scheduled work, including partial initialization. Resource ownership and cancellation must work even when a consumer callback synchronously removes a model/entity or destroys the viewport.

### Formats and diagnostics

Follow [Choose how Ridgeline draws and loads models](https://github.com/the-Drunken-coder/Ridgeline/issues/75): an in-house static GLB v2 subset, with one embedded binary buffer and embedded PNG/JPEG base-color images. Preserve its accepted accessor/material features and named unsupported-feature rejection rules. External images/buffers need consumer-side repackaging; provide an example rather than a network resolver.

Use model-specific diagnostics through `RidgelineError`, `onError`, the diagnostic event and existing bounded logging. Distinguish missing Heading, unavailable Model, malformed asset/decode/upload failure and a named unsupported GLB feature. Model failures must not hide unrelated entities or attachments. A measured triangle/material guideline will support an advisory too-heavy diagnostic, rather than automatic simplification. Do not invent a limit or claim a model is over an unmeasured guideline.

Parsing remains at registration, initially on the main thread behind a pure parser interface. Target-browser measurements exceeding the existing 50 ms trigger require revisiting worker parsing before readiness. A worker change must not alter this consumer contract.

## Appearance and switching

Retain the accepted architecture: a separate instanced model layer directly below the entity attachment layer, one shared entity projection/precision/world-copy path, a viewport-owned registry, and scene-owned Representation coordination. Batch draws by model/material. CPU scaling and oriented-box picking use that same projected frame. Move label presentation above the Model layer to satisfy the approved readability rule. Atomic same-frame switching refines the earlier prototype's following-frame icon handoff.

Default model color is bright magenta, `#FF00FF`. Appearance precedence is per-entity model appearance, then registered Model appearance, then the magenta fallback. An explicit original-material override bypasses lower-priority color defaults.

Assigned color replaces texture RGB, base-color RGB, vertex RGB and colored emission. Preserve geometry, normals, alpha/cut-out shape and lighting. Original mode restores the supported imported colors/textures with the agreed simple lighting, not full physically based rendering. Do not destructively modify consumer GLBs. Highlighting is a temporary display effect and never changes the assigned color or material settings.

Use an enlarged minimum of 40 CSS px, based on the projected model bounding box's largest dimension, then let real-world size exceed that floor up close. Model dimensions are not multiplied by terrain exaggeration. Registration scale fixes real-world dimensions; `headingOffset` fixes the authored forward direction.

Switch using camera-to-entity distance. Defaults enter Model below 1,900 m and return to Icon above 2,100 m. Inside the band, retain the previous Representation. An entity with no previous state starts as an Icon until it crosses the Model entrance boundary. Threshold equality retains state. Changing data or configuration evaluates the latest effective settings. If a Model becomes available inside the band, retain the Icon until entry rather than bypassing the dead zone.

Swap instantly in a consistent rendered frame, with exactly one eligible representation visible. No fade. Removing/changing the Model reference, unregistering it or losing required Heading resets the choice to Icon. Temporary renderer or terrain unavailability retains the existing hysteresis choice while displaying only the eligible fallback; recovery restores that choice inside the band. Stable IDs, selection and picker content survive all switches.

## Interaction and placement

Use CPU oriented-box picking, based on the last drawn scale, projection and world copy. Empty space between thin parts and transparent cut-out regions can be clickable. Match existing nearby-click/hover tolerances, terrain-depth approximation, near-plane clipping and overlap ordering. Box areas behind known terrain are rejected; this is a box approximation, not mesh- or pixel-accurate visibility. Unknown elevation is not zero and must respect existing withheld-placement behavior.

Overlapping entities use the existing Radial picker, with each Entity's Icon and display name at every distance. Keep stable choice positions, removed-choice behavior, keyboard focus and consumer-owned selection. Events identify the original Entity and any actual attachment hits, never a separate model feature.

Hover is refreshed when pointer movement, camera movement, entity movement, model readiness/removal or switching changes the visible candidate beneath a stationary pointer. Refreshes are event-driven and stop after the scene settles. Consumer callbacks can cancel or replace state; do not emit stale follow-up changes or resurrect removed hover.

Labels placed by the existing collision system draw above the Model and beyond its projected visible edge, with readable clearance. Collision suppression is allowed; this does not promise every label remains visible in a crowded scene. Existing font requirements remain applicable. Ground lines, ground areas, airborne volumes and sensor geometry keep their actual geographic origins and physical dimensions. Enlargement moves neither an attachment origin nor a ground-position marker. Model/attachment depth ordering must preserve their existing physical relationships; labels and interaction decoration are a separate readable overlay.

Selection and hover both show a ring around the Model at its altitude and brighten it. Airborne rings follow the aircraft rather than moving to its ground position. Hover uses a thinner ring and gentle brightening; selection uses a thicker ring and stronger brightening. Selection wins when both apply. Keep rings readable against arbitrary model colors and original materials. Effects remain static while idle; no pulse or decorative animation.

Ground vehicles follow the sampled local slope as rigid models. Keep their geographic anchor and physical scale stable. Terrain contact is approximate: some floating and intersection is accepted on uneven ground, particularly at enlarged size. Do not promise exact wheel/track contact, deform meshes or guess unknown ground height. On a planar fixture, base contact and slope alignment must be consistent at real and enlarged size. Withhold a Model when required terrain height is unknown, even if the Entity's ground marker remains eligible. Below-terrain or otherwise withheld placement also withholds the Model. Retain the existing eligible Icon/ground marker and diagnostics; recover automatically when terrain or valid placement becomes available, without a new pointer movement or entity update.

### Required observable transitions

| Change | Owner | Expected result and verification |
| --- | --- | --- |
| First registration completes or fails | Viewport registry | Eligible Model becomes available, or Icon remains with a diagnostic. Feature ID and selection persist. Exercise actual decode and invalid GLBs. |
| Registration replaced, removed or destroyed during decode | Viewport registry | Newest revision wins; stale completion has no effect. Failed replacement retains the working Model. Remove/destroy releases resources. |
| Entity/color changes while sharing a Model | Consumer update flow | Only current entity data/appearance changes; other instances and shared resources remain valid. |
| Camera crosses threshold or configuration changes | Representation coordinator | Dead zone retains state; instant swap draws one representation. Validate frame-by-frame with both model and icon eligible. |
| Entity/camera/model changes under a stationary pointer | Viewport interactions | Hover updates or clears without mouse motion, then settles to idle. Test real pointer input. |
| Callback removes/replaces data or destroys the viewport | Current operation owner | No stale events, mounts, uploads or render scheduling after cancellation. |
| Basemap changes or context restores | Viewport resource owner | Current models, colors, selection and attachments recover without duplication or stale resources. |
| Enlarged Model overlaps labels/attachments | Renderer and interactions | Collision-placed label clears the Model; actual attachment origin/size and picker identity remain unchanged. |

## Verification and readiness

The hardware matrix and measurement-dependent readiness clauses below preserve the original approved scope. The [2026-10-21 amendment](#acceptance-amendment-2026-10-21) supersedes those blocking requirements. Software correctness requirements remain applicable.

Target desktop stable Chrome, Edge, Firefox and Safari, recording exact browser/OS versions. Safari is verified on macOS; software WebKit is not a substitute for Safari hardware evidence. Mobile and touch are outside this implementation. Model rendering needs the agreed WebGL capabilities; unsupported capability reports a diagnostic and leaves eligible entities as Icons. GPU timer-query availability is optional: record its absence rather than treating missing timing as zero.

Implementation may proceed before hardware evidence. Production readiness requires the following measurements on the actual integrated production revision, not just the throwaway prototype. The hardware gap and triangle guideline are tracked in [Measure model performance and correctness on target browsers](https://github.com/the-Drunken-coder/Ridgeline/issues/80). The planning map can publish this spec before that gate passes.

### Acceptance matrix

| Axis | Required coverage |
| --- | --- |
| Hardware | Apple M1 Pro plus one representative desktop discrete GPU. Record the discrete device before baseline collection; claims apply to measured devices, not every GPU in their class. |
| Browsers/platforms | Chrome and Firefox on both hardware fixtures; Safari on the M1 Pro/macOS; Edge on the desktop fixture. Record actual driver/backend and versions. |
| Canvas | 1,280 × 720 CSS px, pixel ratios 1 and 2. Record physical canvas dimensions, terrain/provider/exaggeration and all settings. |
| Scene | Seeded workload with 25 drones, tanks, planes and boats each, plus 1,000 icons; update every 100 ms through public `upsert`. Also run an icon-only baseline. |
| Camera/projection | Flat and globe, terrain enabled, with stationary and moving-camera segments. Choose views that actually show all 100 Model instances and report drawn counts. |
| Materials/appearance | Replacement colors, magenta fallback and original materials; combined selection/hover, solid, cut-out, double-sided and supported translucent fixtures. |
| Duration | Warm up for at least 10 s after asset/tile readiness, then collect three runs of at least 30 s per performance case. Report sample counts and cold-load runs separately. |
| Geometry sweep | Original, 4× and 16× submitted triangle workloads, with counts/materials recorded. Extra triangles preserve the shapes; this does not characterize every possible texture/material cost. |

The user-approved goal is smooth 60 fps. Engineering pass criteria on a 60 Hz display are frame-interval p50 at most 17.5 ms, p95 at most 20 ms and p99 at most 33.4 ms in each warmed original representative workload run; visible update latency p95 at most 100 ms for the 100 ms input flow. Larger 4×/16× stress sweeps may fail; their passing/failing boundary helps derive the guideline. Report all failures. These are chosen acceptance thresholds, not measured results. Faster displays can be capped to the reference cadence for comparison.

Record total frame intervals, model CPU projection/scaling/picking, CPU submission, upsert time and unique completed GPU queries where available. Never sum overlapping CPU/GPU timings, reuse a stale query as a window result, or infer a percentile from a single frame. No completed GPU sample means unavailable. If the icon-only baseline fails, report it as a baseline limitation; it does not demonstrate that the full workload passes.

Derive the per-model triangle guideline from passing original/4×/16× workloads across both hardware fixtures, reporting material counts and appearance modes. A triangle count alone is not a universal capacity guarantee. Publish the guideline and advisory-diagnostic policy with the evidence before production readiness.

### Correctness checks

- Exercise meter-scale models at zoom 18, 19 and 20, date-line crossing and world copies. Compare their anchor with an independent double-precision projection reference; unexplained error/jitter must stay within one CSS px. Raw elevation availability and coordinate precision are separate checks.
- Review continuous globe transition at normal frame rates, local up direction, planet hiding and near-plane clipping. Reject unexplained discontinuities beyond one CSS px relative to the expected camera path. Terrain occlusion remains bounded by the shared sampled terrain, with box-picking limitations documented.
- On a controlled planar terrain fixture, slope alignment error is at most one degree and base clearance is between zero and 0.1 m, at real and enlarged size. Uneven-footprint float/intersection is an accepted limitation, recorded visually without claiming survey-grade contact.
- Check swaps frame-by-frame for no doubled representation or blank frame while both representations are eligible. Test threshold equality, both directions, the dead zone, initial loading and eligibility loss.
- After movement, loading and tiles settle, observe at least five seconds with no self-scheduled render loop. Moving-data workloads may schedule their necessary updates.
- Exercise actual pointer/keyboard picking, overlapping entities, empty box areas, known terrain-hidden box faces, stationary-pointer changes, labels and attachments. Test arbitrary colors, magenta and original materials with both highlight states.
- Verify atomic invalid batches, malformed/unsupported GLBs, actual image decode, failed replacement, shared resource lifetime, stale completions, callback cancellation, basemap changes, context loss/restore and partial allocation failure through real public workflows.
- Use focused parser/geometry/state tests and the packaged-consumer browser suite. Validate the public declarations, playground and affected consumers. Record the exact reviewed and exercised revisions in one integrated closeout record.
- Re-measure the parser/renderer and net production bundle delta. The earlier 11.13 KiB gzip chunk sum is dated prototype evidence, not the new package size.

Save raw samples, settings, screenshots, short recordings and failures with revision-pinned links. Software WebGL remains a smoke check. The previous Apple M1 Pro preview disconnected before model rendering, so it supplies no hardware performance evidence. No per-model triangle guideline currently exists.

## Acceptance amendment, 2026-10-21

The user explicitly waived the Mac and desktop-GPU acceptance work as disproportionate to this project in the [coordinating conversation](t3-thread://v1/c9184cd0-5a0d-48dd-a925-38b0c1373370).
The remaining target-device matrix, including its installed-browser measurements and device correctness collection, is **WAIVED / NOT PERFORMED**.
It no longer blocks consolidation or model readiness. No agent or user hardware collection is required or scheduled.
Earlier partial Mac attempts and reported failures remain historical results; this waiver neither repairs them nor converts them into passes.

The measurement-dependent triangle/material guideline and too-heavy advisory under [#91](https://github.com/the-Drunken-coder/Ridgeline/issues/91) remain unproduced.
Their dependency on the waived [#80](https://github.com/the-Drunken-coder/Ridgeline/issues/80) matrix no longer blocks this work.
Do not invent a model limit, claim the 60 fps targets passed, or treat informational CPU comparisons as target-browser parse or GPU evidence.
The original acceptance matrix and rationale remain above as history.
The GitHub ticket statuses are unchanged by this document amendment.

Public behavior, registration and diagnostic contracts, software correctness histories, hosted module CI on both operating systems, and available packaged browser/measurement checks remain applicable.
Separate manual accessibility, physical-touch, and Windows/NVDA coverage remain unverified.
VoiceOver on Safari remains an unverified accessibility limitation, not a blocking Mac acceptance assignment. No manual accessibility run is assigned by this reconciliation.
The [historical sensor-compatibility decision](../airborne-entities/spec.md#requirement-reconciliation-2026-10-18) is separate and remains unresolved.

## Out of scope

Grouping units, animated parts, model drawing/editing tools, touch/mobile support, ordinary-point Models, automatic distant simplification, full 3D engines, physically based materials/shadows, precise mesh/pixel picking, deforming vehicles and exact wheel/track contact. Application networking, palettes and selection workflows remain consumer-owned.

No prototype merge or PR is authorized by this spec. Production work is a separate effort from the planning map.
