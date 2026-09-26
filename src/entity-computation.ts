import type { EntityAttachment, EntityState, FeatureStyle, MapConfiguration, MapFeature } from './types';
import type { Primitive } from './entity-layer';
import { groundZone, localFrame } from './entity-geometry';
import type { GeoPoint, HeightAt } from './entity-geometry';

export type EntityComputationInput = {
  feature: MapFeature;
  configuration: MapConfiguration;
  style: FeatureStyle;
  selected: boolean;
};
export type EntityComputationResult = {
  primitives: Primitive[];
  position: [number, number];
  state: EntityState;
  diagnostic?: 'ALTITUDE_MISSING' | 'BELOW_TERRAIN';
};
const colors = new Map<string, Primitive['color']>();

export function computeEntity(input: EntityComputationInput, height: HeightAt, unavailable: () => boolean): EntityComputationResult {
  const { feature, configuration: config, style, selected } = input;
  if (feature.geometry.type !== 'Point' || !feature.entity) throw new Error('Expected a point entity.');
  const started = performance.now(),
    lng = feature.geometry.coordinates[0]!,
    lat = feature.geometry.coordinates[1]!,
    entity = feature.entity;
  const visibility = config.entityVisibility;
  const ground = height(lng, lat);
  let placement: EntityState['placement'] = 'ground';
  let altitude = ground ?? undefined;
  if (!entity.altitude) {
    if (entity.groundIfNoAltitude === false) placement = 'withheld';
  } else if (ground === null) placement = 'elevation-unavailable';
  else {
    altitude = entity.altitude.meters + (entity.altitude.reference === 'ground' ? ground : 0);
    placement = altitude < ground ? 'below-terrain' : 'airborne';
  }
  const diagnostic =
    placement === 'withheld'
      ? 'ALTITUDE_MISSING'
      : placement === 'below-terrain'
        ? 'BELOW_TERRAIN'
        : undefined;
  const primitives: Primitive[] = [];
  let missing = ground === null;
  const entityColor = color(style.color ?? '#216e5b', 1);
  const display = (p: GeoPoint): GeoPoint => [
    p[0],
    p[1],
    config.terrain ? p[2] * config.exaggeration : p[2],
  ];
  const add = (
    vertices: GeoPoint[],
    mode: Primitive['mode'],
    rgba: Primitive['color'],
    attachmentId?: string,
    surface = false,
    size?: number,
  ) => {
    if (vertices.length)
      primitives.push({
        entityId: feature.id,
        attachmentId,
        mode,
        vertices: surface ? vertices : vertices.map(display),
        color: rgba,
        size,
        surface,
      });
  };
  if (placement === 'airborne' && altitude !== undefined) {
    const origin: GeoPoint = [lng, lat, altitude],
      radius = style.radius ?? 6;
    add(
      [origin],
      'points',
      selected ? [1, 0.65, 0.2, 1] : [1, 1, 1, 1],
      undefined,
      false,
      radius * 2 + 5,
    );
    add([origin], 'points', entityColor, undefined, false, radius * 2);
    if (visibility.groundLines && ground !== null)
      add([origin, [lng, lat, config.terrain ? ground : 0]], 'lines', [
        ...entityColor.slice(0, 3),
        0.7,
      ] as Primitive['color']);
  }
  if (altitude !== undefined && ground !== null && placement !== 'withheld') {
    const origin: GeoPoint = [lng, lat, placement === 'airborne' ? altitude : ground],
      local = localFrame(origin);
    for (const attachment of entity.attachments ?? []) {
      const rgba = color(
        attachment.color ?? (attachment.type === 'camera' ? '#288b59' : '#8060ae'),
        0.22,
      );
      if (attachment.type === 'camera') continue;
      if (visibility.zones) {
        if (attachment.type === 'circle' || attachment.type === 'polygon') {
          const boundary =
            attachment.type === 'polygon'
              ? attachment.vertices
              : Array.from({ length: 48 }, (_, i): [number, number] => [
                  Math.sin((i * Math.PI) / 24) * attachment.radius,
                  Math.cos((i * Math.PI) / 24) * attachment.radius,
                ]);
          const zone = groundZone(origin, boundary, height, true);
          missing ||= zone.missing;
          add(zone.triangles, 'triangles', rgba, attachment.id, true);
          add(zone.lines, 'lines', [rgba[0], rgba[1], rgba[2], 0.9], attachment.id, true);
        } else if (placement === 'airborne') {
          const mesh = volume(attachment, local);
          add(mesh, 'triangles', rgba, attachment.id);
        }
      }
    }
  }
  return { primitives, position: [lng, lat], diagnostic, state: {
    placement,
    altitude,
    ground: ground ?? undefined,
    coverage: missing ? (unavailable() ? 'unavailable' : 'loading') : 'ready',
    footprintTriangles: 0,
    computedAt: performance.timeOrigin + performance.now(),
    computationMs: performance.now() - started,
  } };
}
function volume(
  attachment: Extract<EntityAttachment, { type: 'sphere' | 'cylinder' }>,
  local: ReturnType<typeof localFrame>,
) {
  const mesh: GeoPoint[] = [],
    rings = attachment.type === 'sphere' ? 12 : 1,
    segments = 32;
  const point = (i: number, j: number) => {
    const angle = (i * 2 * Math.PI) / segments,
      t = j / rings;
    const radius =
      attachment.type === 'sphere' ? Math.sin(t * Math.PI) * attachment.radius : attachment.radius;
    const z =
      attachment.type === 'sphere'
        ? Math.cos(t * Math.PI) * attachment.radius
        : (t - 0.5) * attachment.height;
    return local(Math.sin(angle) * radius, Math.cos(angle) * radius, z);
  };
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segments; i++) {
      const a = point(i, j),
        b = point(i + 1, j),
        c = point(i, j + 1),
        d = point(i + 1, j + 1);
      mesh.push(a, b, c, b, d, c);
    }
  if (attachment.type === 'cylinder')
    for (let i = 0; i < segments; i++) {
      mesh.push(local(0, 0, -attachment.height / 2), point(i, 0), point(i + 1, 0));
      mesh.push(local(0, 0, attachment.height / 2), point(i, 1), point(i + 1, 1));
    }
  return mesh;
}
function color(value: string, alpha: number): Primitive['color'] {
  const key = `${value}:${alpha}`,
    cached = colors.get(key);
  if (cached) return cached;
  const context = new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) return [0.13, 0.43, 0.36, alpha];
  context.fillStyle = '#216e5b';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const p = context.getImageData(0, 0, 1, 1).data;
  const rgba: Primitive['color'] = [p[0]! / 255, p[1]! / 255, p[2]! / 255, alpha];
  colors.set(key, rgba);
  return rgba;
}
