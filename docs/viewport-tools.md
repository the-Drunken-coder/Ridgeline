# Viewport tools

Optional attachments preserve consumer-owned application state and retire with their viewport. Import from `@ridgeline/map`; import `@ridgeline/map/style.css` for UI.

## Map controls and coordinates

```ts
import { attachMapControls, formatCoordinate, parseCoordinate,
  geographicDistance, geographicBearing, geographicDestination } from '@ridgeline/map';

const controls = attachMapControls(viewport, {
  coordinates: { format: 'dms', precision: 1 },
  geolocate: true,
  scale: { unit: 'metric' },
  positions: { coordinates: 'bottom-right' },
  basemaps: [
    { id: 'liberty', name: 'Liberty', basemap: 'https://tiles.openfreemap.org/styles/liberty' },
  ],
});
const position = parseCoordinate('6.87 E, 45.92 N');
const text = formatCoordinate(position, { format: 'ddm' });
const meters = geographicDistance(position, [6.88, 45.93]);
const bearing = geographicBearing(position, [6.88, 45.93]);
const next = geographicDestination(position, 500, 90);
// On unmount: controls.destroy();
```

`navigation`, `scale` and `fullscreen` are enabled by default. Set any to `false` or pass its native MapLibre options. `geolocate`, `coordinates` and `basemaps` are off unless supplied. Geolocation uses the native control and requests permission after user activation. Fullscreen targets `viewport.container` by default. Navigation, fullscreen and geolocation default to `top-right`; scale to `bottom-left`; coordinates to `bottom-right`; basemaps to `top-left`. Override each in `positions` with a MapLibre control corner.

The coordinate readout shows the map center and normalizes its displayed longitude to [-180, 180). It does not track the pointer. It updates with camera movement and resize without announcing every frame. Basemap choices need unique nonempty IDs and names and a valid style URL/object. They are copied on attachment. The selector calls `configure` and follows accepted configuration even if the style fails to load; an unmatched current style appears as `Custom`. A chosen entry keeps its label when several entries use equivalent styles. A different external style clears that local choice and matches the first equivalent entry in the supplied order. The attachment removes only controls it installed, including partial initialization resources.

`configurationchange` emits a detached snapshot after `configure` initiates its renderer update. It reports accepted configuration and does not imply that the style has loaded or that the renderer is ready. Native geolocation teardown clears an active watch. MapLibre 6.11.0 does not expose cancellation of a one-shot location request or its ten-second fallback timer; late results are ignored after removal.

All geographic helpers use `[longitude, latitude]`, with longitude [-180, 180] and latitude [-90, 90]. Inputs must be finite. They do not transform coordinate reference systems.

| Helper | Contract |
| --- | --- |
| `formatCoordinate(position, { format, precision })` | `dd` by default with 5 decimal places; `ddm` defaults to 3 decimal minutes and `dms` to 1 decimal second. Precision is an integer 0–8 in the final unit. Emits longitude E/W first, then comma-separated latitude N/S. Rounding carries into the next unit. Negative zero uses E/N. |
| `parseCoordinate(text)` | Two comma-separated DD, DDM or DMS coordinates, longitude first. Accept signs or the appropriate hemisphere letters, but not both on one coordinate. Minutes/seconds must be below 60 and preceding units whole. Rejects malformed/out-of-range input and text longer than 256 characters. |
| `geographicDistance(from, to)` | Horizontal spherical distance in meters. |
| `geographicBearing(from, to)` | Initial clockwise bearing from geographic north, normalized to [0, 360). Rejects coincident positions, antipodes and exact pole origins because direction is undefined. |
| `geographicDestination(from, meters, degrees)` | Destination for a finite nonnegative distance and finite bearing; output longitude is wrapped. Positive distance from an exact pole is rejected; zero distance returns a detached origin. |

Distance, bearing and destination use Ridgeline's 6,371,008.8 m spherical Earth radius. They exclude terrain slope and are not ellipsoidal survey calculations.


## Feature presentation

Supply a `style(feature)` accessor to `createViewport`. Callback results are validated and copied before rendering. Invalid style output reports `INVALID_FEATURE` with operation `style` and leaves the feature's last rendered version available while its working source remains available. Context loss can withhold output; source replacement rebuilds current features whose styling succeeds. Call `refreshStyles()` after changing an external palette, or pass IDs to refresh a subset. It uses current stored features without replacing accepted data, emitting `datachange`, moving the camera or interrupting a drawing draft. Selection and hover feedback update without feature replacement.

```ts
const viewport = createViewport<{ name: string }>({
  container,
  style: feature => ({
    color: '#216e5b',
    lineWidth: 3,
    dashArray: [4, 2],
    label: feature.properties.name,
    labelStyle: {
      font: ['Noto Sans Regular'], size: 14,
      haloColor: '#ffffff', haloWidth: 2,
      anchor: 'top', offset: [0, 2],
    },
    selected: { color: '#be4b1b', lineWidth: 5, labelColor: '#8f3514' },
    hover: { color: '#db6a20' },
  }),
});
```

| Style field | Default and units |
| --- | --- |
| `color`, `fillColor` | Stroke/dot `#216e5b`; fill inherits `color`. |
| `radius`, `lineWidth`, `fillOpacity` | 6 CSS px, 3 CSS px, 0.2. Opacity is 0–1. |
| `dashed`, `dashArray` | Solid by default. `dashed: true` uses `[3, 2]`; explicit `dashArray` overrides it. Values alternate dash/gap lengths in line-width units. |
| `icon` | Registered icon ID, otherwise a dot. Registration and fetching remain consumer-owned. |
| `iconSize` | 1, multiplying the registered image's pixel-ratio-adjusted size. Must be positive and finite. |
| `iconRotation`, `iconRotationAlignment` | 0 clockwise degrees, relative to `'viewport'`; use `'map'` for map-relative rotation. |
| `iconAnchor` | `'center'`. |
| `label` | Optional text. |
| `labelStyle.font`, `size` | `['Noto Sans Regular']`, 12 CSS px. Size must be positive and finite. |
| `labelStyle.color`, `haloColor`, `haloWidth` | `#203b32`, `#ffffff`, 1.5 CSS px. Halo width is nonnegative. |
| `labelStyle.anchor`, `offset` | `'top'`, `[0, 1.8]` in text-size units. An explicit non-top anchor defaults to `[0, 0]`. |
| `selected`, `hover` | Optional overrides for `color`, `radius`, `lineWidth`, `fillColor`, `fillOpacity`, `labelColor`, `iconOpacity`. Omitted fields keep existing feedback. |
| `selected.enabled`, `hover.enabled` | `true`. Set to `false` to retain base appearance for that state. Disabled selection suppresses hover appearance while selected. Selection identity and label priority are unaffected. |
| `selected.modelBrightness`, `hover.modelBrightness` | 0.18 and 0.08. Finite values from 0 to 1 brighten a model toward white; zero retains its base material colors. |

Anchors are `center`, `left`, `right`, `top`, `bottom`, and the four corner combinations such as `top-left`. Fonts need 1–16 nonempty names available through the basemap glyph source or MapLibre's local font configuration. Ridgeline does not install fonts. Offsets contain two finite numbers. Dash arrays contain 1–32 nonnegative finite lengths, including at least one positive length. Colors use MapLibre-supported CSS color strings.

Explicit selection overrides hover per field. Labels on models use the same label style and collision rules, with additional offset in the anchor direction to clear model bounds. Model feedback rings accept highlight color and line width; set `lineWidth: 0` to hide the ring while retaining configured brightening. Icon size/rotation/opacity describe the icon representation and do not resize, rotate or hide a 3D model. Use `modelAppearance` and entity pose for that representation. Saved drawing appearance retains its documented stroke/fill/width/opacity/dash/label precedence over the accessor.

Default selection feedback preserves an already thick line; explicit highlight widths still take precedence.


## Selection and rectangle queries

Selected labels get placement priority over unselected labels. Collision suppression remains enabled, so selected labels can still be hidden when they collide with each other. Selection and deselection update placement without replacing consumer features.

```ts
import { attachInteractions } from '@ridgeline/map';

const interactions = attachInteractions(viewport, {
  additiveSelection: true,
  boxSelection: true,
});
const off = viewport.on('selectionrequest', ({ ids }) => {
  viewport.setSelection(ids);
});

const { features, attachments } = viewport.queryFeatures([
  { x: 20, y: 40 },
  { x: 240, y: 180 },
]);
// On unmount: off(); interactions.destroy();
```

`additiveSelection` and `boxSelection` default to `false`. Picker, hover and cursor feedback remain enabled by default. Selection requests never apply selection by themselves.

| Input with its option enabled | Request |
| --- | --- |
| Shift-click a feature | Toggle it against `getSelection()`. An overlap picker retains the original click's modifier. |
| Shift-click empty map | Preserve current selection. |
| Alt-left-drag | Replace selection with features intersecting the rectangle. |
| Alt+Shift-left-drag | Add rectangle hits to the current consumer selection, without duplicates. |
| Ordinary Shift-drag | Native MapLibre box zoom. |

Rectangle selection is a mouse gesture on the map canvas and requires at least 3 CSS pixels of movement. It reserves interaction while active. Escape, blur, pointer cancellation, capture loss, camera movement, resize, renderer context loss, basemap/projection/terrain/elevation changes or another interaction owner cancel it without changing accepted selection. Ordinary feature and entity updates keep it active; release queries current displayed representations. It rechecks data and ownership before requesting selection. A canceled or completed rectangle does not produce an extra click selection.

`queryFeatures(bounds)` accepts two opposite corners in canvas CSS pixels, in either order. Its result is an object, `{ features, attachments }`. Features are detached consumer snapshots, deduplicated in feature-store order. Attachment hits use `{ entityId, attachmentId }` and retain declaration order within each entity. Attachment hits also include their owning feature in `features`.

The query uses displayed native features, entity geometry and clipped projected model boxes, including the displayed world copy. It excludes the feature under drawing edit and withheld representations. Custom 3D rectangle hits conservatively intersect projected accepted geometry and can include geometry hidden by terrain. Model boxes can include empty space between parts and transparent cutouts. GPU coverage uses nonzero-alpha texel spans with projected span corners to approximate terrain draping. Rectangle selection is not mesh- or pixel-accurate. Ordinary and additive point picking retain their terrain-depth rejection. Direct queries return empty arrays before readiness or during renderer context loss. Rectangle gestures refuse unavailable queries and never turn them into a completed empty selection. Querying does not apply selection or acquire interaction ownership.

Modifiers at mouse release determine click intent. Releasing Shift before mouseup performs one ordinary click; holding it through release toggles selection. Drags retain native box zoom once the 3 CSS pixel threshold is reached.



## Drawing extensions

The [drawing guide in README](../README.md#drawing-and-editing) covers submission, permissions, conflict and accepted-change ownership. The APIs below operate inside the same draft. They are available on `createDrawingSession` and `attachDrawing`, except active-segment feedback (`setActiveSegment`), screen snapping and touch gestures, which require the attached editor.

### Rings and holes

Polygon `DrawingShape` uses open `vertices` for its exterior and optional open `holes: DrawingPosition[][]`. Do not repeat the first point at the end of a shape ring. `shapeGeometry` closes every ring for GeoJSON. Preserve both geometry and `drawing: { version: 1, shape, style }` in storage; holes extend version 1 additively. Editing imported hole geometry preserves its rings. Translating a polygon moves all rings.

| Method | Behavior |
| --- | --- |
| `startHole()` | Require a valid polygon and no hole currently being placed; add an empty hole and route subsequent `addPoint` calls into it. |
| `finishRing()` | End placement after at least three vertices. Invalid geometry remains editable and blocks submission. |
| `removeHole(ring)` | Remove a positive, one-based hole ring. Ring 0 is the exterior and cannot be removed through this method. |
| `moveVertex(index, position, ring = 0)` | Move the ring-local vertex. |
| `insertVertex(after, position, ring = 0)` | Insert after the ring-local vertex. |
| `removeVertex(index, ring = 0)` | Remove the ring-local vertex. |

Draw the exterior, close it with `finishRing`, then call `startHole`, place hole vertices and call `finishRing` again. `finish()` submits the entire drawing. Controls provide Boundary/Hole selection, Add hole, Delete hole, Close boundary and Finish hole. A hole must lie strictly inside the exterior; it cannot touch or cross another boundary. Holes cannot overlap or nest. Invalid drafts remain editable and undoable, but submission is blocked. Area subtracts hole interiors; perimeter includes every ring.

### Exact segments

`getSegments()` returns detached `{ ring, index, start, end, length, bearing }` records for lines, arrows and polygon rings. `index` is zero-based within the ring. Length is horizontal spherical meters and bearing is initial clockwise-from-north degrees in [0, 360). Circles and rectangles retain their own parameter controls.

```ts
const segment = drawing.getSegments()[0];
if (segment) {
  drawing.setSegment({ ring: segment.ring, index: segment.index }, {
    length: 250, bearing: 90,
  });
}
```

`setSegment(address, values)` holds the start fixed and moves the end using geographic destination. Omitted length or bearing retains that value. Length must be positive, finite and below half the spherical Earth's circumference; bearing must be finite. Changing a shared endpoint also changes its neighboring segment. The inspector commits each distance/bearing field change as one draft undo action. Metric/imperial display units do not change stored meters or degrees.

`setActiveSegment({ ring, index })` highlights a directed draft segment without changing geometry or draft history. Pass `undefined` to clear it. The inspector keeps this feedback synchronized with its ring and segment fields. Vertex snap targets use solid rings; edge snap targets use dashed rings. Alt bypass remains available.

### Snapping and touch

`snapping.vertices` defaults to `true`; `snapping.edges` defaults to `false`. Edge snapping targets visible eligible line/polygon segments, including holes, within 12 CSS pixels. Vertices win when an edge is at most 1 CSS pixel closer. `canSnap` filters both, Alt bypasses both, and a valid displayed ground target is required first. Edge targets follow the rendered segment under the current projection and terrain rather than a straight screen chord between endpoints. Ordinary GeoJSON retains its longitude span; saved drawings use their render-only unwrapped crossing. Snapping copies a position without linking features.

`setSnapping(boolean)` controls the editor's master switch; `getSnapping()` reads it. `setEdgeSnapping(boolean)` / `getEdgeSnapping()` control the edge option. The inspector's Snapping and Include edges controls expose these switches. Disabling the master leaves the edge preference available for re-enabling it.

Touch taps place points, handle drags edit, and two fingers navigate the map. A one-finger canvas drag does not pan during an active drawing draft. Use Finish and Cancel buttons; there is no double-tap completion. Starting multi-touch settles a partial handle edit and suppresses an accidental later tap. Cancellation, capture loss, native camera navigation and lost edit permission retire the active screen gesture while retaining valid draft changes as one undo action. Mouse navigation and keyboard handles remain available. Pen-specific placement and physical-device acceptance are not established; consult the [support matrix](support.md).


## Consumer-owned live updates

Your application decides which positions and poses to display and when to update them. Send complete current features through `upsert`, and retire displayed features through `remove` or `clear`. Updates use the existing feature contract; no timestamp or trajectory schema is required. `upsert` replaces a feature by ID, so include all current properties, entity settings and attachments you want retained. The viewport validates and snapshots that display state and coalesces rendering updates.

Source storage, networking, time selection, interpolation, historical samples, retention, replay controls and camera-follow policy belong to the application. Send a path as an ordinary LineString if you want one displayed. Send application-selected camera changes through `setCamera` or use the exposed MapLibre map. Feature updates do not move the camera or change selection by stable ID.

The playground's moving-feature and airborne examples already drive movement from consumer code through these APIs. Drawing drafts and viewport snapshots remain display and interaction state; the application accepts drawing changes into its own authoritative storage.


Drawing snapping uses ordinary ground GeoJSON vertices and edges. Entity-owned geometry and its 3D attachments remain outside that snapping policy. A consumer filter can reject eligible geometry; it does not make an entity attachment a ground target.

Programmatic camera frames and live entity updates invalidate pending ground/snap resolution without ending a valid drawing gesture. Permission loss retires both mouse placement and touch contacts even if permission is repaired before release. Native handle cleanup does not require a mouseup to return to the original page. Snapping coordinates come from the retained published ground feature; the consumer filter still sees current accepted feature data.
