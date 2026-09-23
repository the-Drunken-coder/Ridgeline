import type { Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from './entity-layer';
import { EntityGround } from './entity-ground';
import type { Primitive } from './entity-layer';
import { cameraFootprint, cameraVolume, groundZone, localFrame } from './entity-geometry';
import type { GeoPoint } from './entity-geometry';
import { RasterElevationSampler } from './elevation-sampler';
import { RidgelineError } from './errors';
import type {
  ElevationSampler,
  EntityAttachment,
  EntityState,
  FeatureStyle,
  MapConfiguration,
  MapFeature,
  Properties,
} from './types';

export const DEFAULT_ENTITY_VISIBILITY = {
  volumes: true,
  footprints: true,
  zones: true,
  groundLines: false,
};
type SceneOptions<P extends Properties> = {
  map: GLMap;
  configuration: () => MapConfiguration;
  style: (feature: MapFeature<P>) => FeatureStyle;
  sampler?: ElevationSampler;
  diagnostic: (error: RidgelineError) => void;
  changed: (ids: string[]) => void;
};

export class EntityScene<P extends Properties> {
  readonly layer: EntityLayer;
  private groundLayer: EntityGround;
  private features = new Map<string, MapFeature<P>>();
  private states = new Map<string, EntityState>();
  private geometry = new Map<string, Primitive[]>();
  private dirty = new Set<string>();
  private selected = new Set<string>();
  private frame = 0;
  private destroyed = false;
  private raster: RasterElevationSampler;
  private customGeneration = new AbortController();
  private diagnosticKeys = new Map<string, string>();
  private colors = new Map<string, Primitive['color']>();
  constructor(private options: SceneOptions<P>) {
    this.groundLayer = new EntityGround(options.map);
    this.layer = new EntityLayer((cause) =>
      options.diagnostic(
        new RidgelineError(
          'UPDATE_FAILED',
          'Airborne geometry could not render.',
          { operation: 'entities', recoverable: true },
          cause,
        ),
      ),
    );
    this.raster = this.createSampler();
  }
  private createSampler() {
    return new RasterElevationSampler(
      this.options.configuration().elevation,
      () => this.invalidate(),
      (cause) =>
        this.options.diagnostic(
          new RidgelineError(
            'ELEVATION_UNAVAILABLE',
            'Raw elevation data is unavailable for entity placement or sensor coverage.',
            { operation: 'entities', recoverable: true },
            cause,
          ),
        ),
    );
  }
  set(features: readonly MapFeature<P>[], removed: readonly string[] = []) {
    for (const id of removed) {
      this.features.delete(id);
      this.states.delete(id);
      this.geometry.delete(id);
      this.dirty.delete(id);
      this.diagnosticKeys.delete(id);
    }
    for (const feature of features) {
      if (feature.entity) {
        this.features.set(feature.id, feature);
        this.dirty.add(feature.id);
      } else {
        this.features.delete(feature.id);
        this.states.delete(feature.id);
        this.geometry.delete(feature.id);
        this.diagnosticKeys.delete(feature.id);
      }
    }
    this.schedule();
    if (this.options.sampler?.prepare && features.some((f) => f.entity)) {
      const positions: [number, number][] = [];
      for (const f of features)
        if (f.entity && f.geometry.type === 'Point') {
          const [lng, lat] = f.geometry.coordinates;
          if (lng === undefined || lat === undefined) continue;
          positions.push([lng, lat]);
          const local = localFrame([lng, lat, 0]);
          for (const a of f.entity.attachments ?? []) {
            const range =
              a.type === 'camera'
                ? a.range
                : a.type === 'polygon'
                  ? Math.max(...a.vertices.map((p) => Math.hypot(...p)))
                  : a.radius;
            for (const x of [-range, 0, range])
              for (const y of [-range, 0, range]) {
                const p = local(x, y, 0);
                positions.push([p[0], p[1]]);
              }
          }
        }
      const generation = this.customGeneration;
      void this.options.sampler
        .prepare(positions, generation.signal)
        .then(() => {
          if (!generation.signal.aborted) this.invalidate();
        })
        .catch((cause) => {
          if (!generation.signal.aborted)
            this.options.diagnostic(
              new RidgelineError(
                'ELEVATION_UNAVAILABLE',
                'Consumer elevation source could not prepare entity terrain.',
                { operation: 'entities', recoverable: true },
                cause,
              ),
            );
        });
    }
  }
  configure(elevationChanged = false) {
    if (elevationChanged) {
      this.raster.destroy();
      this.raster = this.createSampler();
      this.customGeneration.abort();
      this.customGeneration = new AbortController();
    }
    this.invalidate();
  }
  retry() {
    this.raster.retry();
    this.set([...this.features.values()]);
    this.invalidate();
  }
  selection(ids: readonly string[]) {
    this.selected = new Set(ids);
    this.invalidate();
  }
  getState(id: string) {
    const state = this.states.get(id);
    return state && { ...state };
  }
  marker(feature: MapFeature<P>) {
    if (!feature.entity) return { visible: true, ground: true, offset: 0 };
    const state = this.states.get(feature.id),
      config = this.options.configuration();
    if (!feature.entity.altitude && feature.entity.groundIfNoAltitude === false)
      return { visible: false, ground: false, offset: 0 };
    const airborne = state?.placement === 'airborne';
    const altitude = state?.altitude ?? 0,
      ground = state?.ground ?? 0;
    return {
      visible: true,
      ground: !airborne,
      offset: airborne ? (config.terrain ? (altitude - ground) * config.exaggeration : altitude) : 0,
    };
  }
  pick(x: number, y: number, tolerance: number) {
    return [...this.layer.pick(x, y, tolerance), ...this.groundLayer.pick(x, y, tolerance)];
  }
  attach() {
    this.groundLayer.attach();
    if (!this.options.map.getLayer(this.layer.id)) this.options.map.addLayer(this.layer);
    this.invalidate();
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.customGeneration.abort();
    this.raster.destroy();
    this.features.clear();
    this.geometry.clear();
    this.states.clear();
  }
  private invalidate() {
    for (const id of this.features.keys()) this.dirty.add(id);
    this.schedule();
  }
  private schedule() {
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => this.flush());
  }
  private height = (lng: number, lat: number) => {
    const value = this.options.sampler ? this.options.sampler.sample(lng, lat) : this.raster.sample(lng, lat);
    return value !== null && Number.isFinite(value) ? value : null;
  };
  private flush() {
    this.frame = 0;
    if (this.destroyed) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const feature = this.features.get(id);
      if (!feature) continue;
      try {
        this.build(feature);
      } catch (cause) {
        this.geometry.delete(id);
        this.options.diagnostic(
          new RidgelineError(
            'UPDATE_FAILED',
            'An entity could not be prepared.',
            { operation: 'entities', recoverable: true, featureId: id },
            cause,
          ),
        );
      }
    }
    const primitives = [...this.geometry.values()].flat();
    this.layer.set(primitives.filter((p) => !p.surface));
    this.groundLayer.set(primitives.filter((p) => p.surface));
    if (ids.length) this.options.changed(ids);
  }
  private build(feature: MapFeature<P>) {
    if (feature.geometry.type !== 'Point' || !feature.entity) return;
    const started = performance.now(),
      lng = feature.geometry.coordinates[0]!,
      lat = feature.geometry.coordinates[1]!,
      entity = feature.entity;
    const config = this.options.configuration(),
      visibility = config.entityVisibility;
    const ground = this.height(lng, lat);
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
    if (diagnostic && this.diagnosticKeys.get(feature.id) !== diagnostic)
      this.options.diagnostic(
        new RidgelineError(
          diagnostic,
          diagnostic === 'ALTITUDE_MISSING'
            ? 'Entity altitude is missing and ground fallback is disabled.'
            : 'Entity altitude is below terrain; only its ground position is shown.',
          { operation: 'entities', recoverable: true, featureId: feature.id },
        ),
      );
    if (diagnostic) this.diagnosticKeys.set(feature.id, diagnostic);
    else this.diagnosticKeys.delete(feature.id);
    const primitives: Primitive[] = [];
    let footprintTriangles = 0,
      missing = ground === null;
    const style = this.options.style(feature),
      color = this.color(style.color ?? '#216e5b', 1);
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
        this.selected.has(feature.id) ? [1, 0.65, 0.2, 1] : [1, 1, 1, 1],
        undefined,
        false,
        radius * 2 + 5,
      );
      add([origin], 'points', color, undefined, false, radius * 2);
      if (visibility.groundLines && ground !== null)
        add([origin, [lng, lat, config.terrain ? ground : 0]], 'lines', [
          ...color.slice(0, 3),
          0.7,
        ] as Primitive['color']);
    }
    if (altitude !== undefined && ground !== null && placement !== 'withheld') {
      const origin: GeoPoint = [lng, lat, placement === 'airborne' ? altitude : ground],
        local = localFrame(origin);
      for (const attachment of entity.attachments ?? []) {
        const rgba = this.color(
          attachment.color ?? (attachment.type === 'camera' ? '#288b59' : '#8060ae'),
          0.22,
        );
        if (attachment.type === 'camera') {
          if (placement !== 'airborne') continue;
          if (visibility.volumes) {
            const { triangles: sides, lines } = cameraVolume(origin, attachment);
            add(sides, 'triangles', [rgba[0], rgba[1], rgba[2], 0.08], attachment.id);
            add(lines, 'lines', [rgba[0], rgba[1], rgba[2], 0.8], attachment.id);
          }
          if (visibility.footprints) {
            const footprint = cameraFootprint(origin, attachment, this.height);
            missing ||= footprint.missing;
            footprintTriangles += footprint.triangles.length / 3;
            add(footprint.triangles, 'triangles', [rgba[0], rgba[1], rgba[2], 0.45], attachment.id, true);
          }
        } else if (visibility.zones) {
          if (attachment.type === 'circle' || attachment.type === 'polygon') {
            const boundary =
              attachment.type === 'polygon'
                ? attachment.vertices
                : Array.from({ length: 48 }, (_, i): [number, number] => [
                    Math.sin((i * Math.PI) / 24) * attachment.radius,
                    Math.cos((i * Math.PI) / 24) * attachment.radius,
                  ]);
            const zone = groundZone(origin, boundary, this.height);
            missing ||= zone.missing;
            add(zone.triangles, 'triangles', rgba, attachment.id, true);
            add(zone.lines, 'lines', [rgba[0], rgba[1], rgba[2], 0.9], attachment.id, true);
          } else if (placement === 'airborne') {
            const mesh = this.volume(attachment, local);
            add(mesh, 'triangles', rgba, attachment.id);
          }
        }
      }
    }
    this.geometry.set(feature.id, primitives);
    this.states.set(feature.id, {
      placement,
      altitude,
      ground: ground ?? undefined,
      coverage: missing ? (this.raster.unavailable() ? 'unavailable' : 'loading') : 'ready',
      footprintTriangles,
      computedAt: performance.timeOrigin + performance.now(),
      computationMs: performance.now() - started,
    });
  }
  private volume(
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
  private color(value: string, alpha: number): Primitive['color'] {
    const key = `${value}:${alpha}`,
      cached = this.colors.get(key);
    if (cached) return cached;
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (!context) return [0.13, 0.43, 0.36, alpha];
    context.fillStyle = '#216e5b';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const p = context.getImageData(0, 0, 1, 1).data;
    const rgba: Primitive['color'] = [p[0]! / 255, p[1]! / 255, p[2]! / 255, alpha];
    this.colors.set(key, rgba);
    return rgba;
  }
}
