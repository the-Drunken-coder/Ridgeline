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

