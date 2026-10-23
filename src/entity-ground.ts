import type { FeatureCollection, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import type { GeoJSONSource, Map as GLMap } from 'maplibre-gl';
import type { GroundPrimitive } from './entity-primitives';
import { rectangleBounds } from './screen-rectangle';
import type { ScreenRectangle } from './screen-rectangle';

const SOURCE = 'rl:entity-ground';
const FILL = 'rl:entity-ground-fill';
const LINE = 'rl:entity-ground-line';
type GroundProperties = { entityId: string; attachmentId: string; color: string; opacity: number; width: number };
type GroundData = FeatureCollection<Polygon | MultiPolygon | MultiLineString, GroundProperties>;

/** Let the renderer drape coverage onto its terrain instead of depth-testing a second terrain mesh. */
export class EntityGround {
  private data: GroundData = { type: 'FeatureCollection', features: [] };
  constructor(private map: GLMap) {}

  attach() {
    if (!this.map.getSource(SOURCE)) this.map.addSource(SOURCE, { type: 'geojson', data: this.data });
    if (!this.map.getLayer(FILL))
      this.map.addLayer(
        {
          id: FILL,
          type: 'fill',
          source: SOURCE,
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
            'fill-antialias': false,
          },
        },
        'rl:points',
      );
    if (!this.map.getLayer(LINE))
      this.map.addLayer(
        {
          id: LINE,
          type: 'line',
          source: SOURCE,
          filter: ['==', '$type', 'LineString'],
          paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'opacity'], 'line-width': ['get', 'width'] },
        },
        'rl:points',
      );
  }

  set(primitives: readonly GroundPrimitive[]) {
    const features: GroundData['features'] = [];
    for (const primitive of primitives) {
      if (primitive.color[3] <= 0) continue;
      const { vertices, color, entityId, attachmentId } = primitive;
      // Keep small shapes crossing the antimeridian local rather than spanning the whole map.
      const reference = vertices[0]?.[0] ?? 0;
      const points: Position[] = vertices.map(([lng, lat]) => [
        lng + Math.round((reference - lng) / 360) * 360,
        lat,
      ]);
      const properties = {
        entityId,
        attachmentId,
        color: `rgb(${color
          .slice(0, 3)
          .map((v) => Math.round(v * 255))
          .join(',')})`,
        opacity: color[3],
        width: primitive.size ?? 1,
      };
      if (primitive.mode === 'polygon') {
        features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[...points, points[0]!]] } });
      } else if (primitive.mode === 'triangles') {
        const coordinates: MultiPolygon['coordinates'] = [];
        for (let i = 0; i < points.length; i += 3)
          coordinates.push([[points[i]!, points[i + 1]!, points[i + 2]!, points[i]!]]);
        features.push({ type: 'Feature', properties, geometry: { type: 'MultiPolygon', coordinates } });
      } else {
        const coordinates: MultiLineString['coordinates'] = [];
        for (let i = 0; i < points.length; i += 2) coordinates.push([points[i]!, points[i + 1]!]);
        features.push({ type: 'Feature', properties, geometry: { type: 'MultiLineString', coordinates } });
      }
    }
    if (!features.length && !this.data.features.length) return;
    this.data = { type: 'FeatureCollection', features };
    this.map.getSource<GeoJSONSource>(SOURCE)?.setData(this.data);
  }

  pick(x: number, y: number, tolerance: number) {
    return this.query({ minX: x - tolerance, minY: y - tolerance, maxX: x + tolerance, maxY: y + tolerance });
  }
  query(rectangle: ScreenRectangle) {
    const layers = [FILL, LINE].filter((id) => this.map.getLayer(id));
    if (!layers.length) return [];
    return this.map
      .queryRenderedFeatures(
        rectangleBounds(rectangle),
        { layers },
      )
      .flatMap(({ properties }) =>
        typeof properties.entityId === 'string' && typeof properties.attachmentId === 'string'
          ? [{ entityId: properties.entityId, attachmentId: properties.attachmentId }]
          : [],
      );
  }
}
