import type { Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from './entity-layer';
import { EntityGround } from './entity-ground';
import type { Primitive } from './entity-layer';
import { computeEntity } from './entity-computation';
import type { EntityComputationResult } from './entity-computation';
import { Elevation } from './elevation';
import { SensorCameraCoverage } from './sensor-camera-coverage';
import { RidgelineError } from './errors';
import type {
  ElevationSampler,
  CameraAttachment,
  EntityState,
  FeatureStyle,
  MapConfiguration,
  MapFeature,
  Properties,
} from './types';

export const DEFAULT_ENTITY_VISIBILITY = {
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
  private positions = new Map<string, [number, number]>();
  private geometry = new Map<string, Primitive[]>();
  private geometryDirty = false;
  private dirty = new Set<string>();
  private selected = new Set<string>();
  private frame = 0;
  private destroyed = false;
  private elevation: Elevation;
  private coverage: SensorCameraCoverage;
  private diagnosticKeys = new Map<string, string>();
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
    this.elevation = new Elevation({
      provider: options.configuration().elevation,
      sampler: options.sampler,
      diagnostic: options.diagnostic,
      changed: keys => {
        for (const key of keys) {
          const id = key.startsWith('placement:') ? key.slice('placement:'.length)
            : key.startsWith('camera:') ? key.slice('camera:'.length, key.lastIndexOf(':'))
            : undefined;
          if (id && this.features.has(id)) this.dirty.add(id);
        }
        if (this.dirty.size) this.schedule();
      },
    });
    this.coverage = new SensorCameraCoverage({
      map: options.map,
      elevation: this.elevation,
      rendererDiagnostic: cause => options.diagnostic(new RidgelineError(
        'UPDATE_FAILED',
        'GPU camera visibility is unavailable.',
        { operation: 'entities', recoverable: true },
        cause,
      )),
      changed: id => {
        this.dirty.add(id);
        this.schedule();
        options.changed([id]);
      },
      displayed: id => {
        const state = this.states.get(id);
        if (state) state.coverage = this.coverage.status(id);
        this.geometryDirty = true;
        this.renderLayers(false);
        options.changed([id]);
      },
    });
  }
  set(features: readonly MapFeature<P>[], removed: readonly string[] = []) {
    for (const id of removed) {
      this.coverage.remove(id);
      this.elevation.release(`placement:${id}`);
      this.features.delete(id);
      this.states.delete(id);
      this.positions.delete(id);
      this.geometryDirty = this.geometry.delete(id) || this.geometryDirty;
      this.dirty.delete(id);
      this.diagnosticKeys.delete(id);
    }
    for (const feature of features) {
      if (feature.entity) {
        this.features.set(feature.id, feature);
        this.dirty.add(feature.id);
      } else {
        this.coverage.remove(feature.id);
        this.elevation.release(`placement:${feature.id}`);
        this.features.delete(feature.id);
        this.states.delete(feature.id);
        this.positions.delete(feature.id);
        this.geometryDirty = this.geometry.delete(feature.id) || this.geometryDirty;
        this.diagnosticKeys.delete(feature.id);
      }
    }
    const areas: { key: string; center: [number, number]; radiusMeters: number }[] = [];
    const visible = this.options.configuration().entityVisibility.footprints;
    for (const feature of features) {
      if (!feature.entity || feature.geometry.type !== 'Point') continue;
      const [lng, lat] = feature.geometry.coordinates;
      if (lng === undefined || lat === undefined) continue;
      const center: [number, number] = [lng, lat];
      const attachments = feature.entity.attachments ?? [];
      const radiusMeters = attachments.reduce((radius, attachment) => {
        if (attachment.type === 'camera') return radius;
        const extent = attachment.type === 'polygon'
          ? Math.max(...attachment.vertices.map(vertex => Math.hypot(...vertex)))
          : attachment.radius;
        return Math.max(radius, extent);
      }, 0);
      this.coverage.requestAreas(feature.id, center,
        attachments.filter((attachment): attachment is CameraAttachment => attachment.type === 'camera'), visible);
      areas.push({ key: `placement:${feature.id}`, center, radiusMeters });
    }
    this.elevation.requestBatch(areas);
    this.schedule();
  }
  configure(elevationChanged = false) {
    if (elevationChanged) {
      this.elevation.reset(this.options.configuration().elevation);
      this.coverage.retry();
    } else this.coverage.invalidate();
    this.invalidate();
  }
  retry() {
    this.elevation.retry();
    this.coverage.retry();
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
      position: this.positions.get(feature.id),
      offset: airborne ? (config.terrain ? (altitude - ground) * config.exaggeration : altitude) : 0,
    };
  }
  pick(x: number, y: number, tolerance: number) {
    return [...this.layer.pick(x, y, tolerance), ...this.groundLayer.pick(x, y, tolerance), ...this.coverage.pick(x, y)];
  }
  attach() {
    this.groundLayer.attach();
    this.coverage.attach();
    if (!this.options.map.getLayer(this.layer.id)) this.options.map.addLayer(this.layer);
    this.invalidate();
  }
  destroy() {
    this.coverage.destroy();
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.elevation.destroy();
    this.features.clear();
    this.geometry.clear();
    this.states.clear();
    this.positions.clear();
  }
  private invalidate() {
    for (const id of this.features.keys()) this.dirty.add(id);
    this.schedule();
  }
  private schedule() {
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => this.flush());
  }
  private height = (lng: number, lat: number) => this.elevation.height(lng, lat);
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
        this.geometryDirty = this.geometry.delete(id) || this.geometryDirty;
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
    this.coverage.flush();
    this.render();
    if (ids.length) this.options.changed(ids);
  }
  private build(feature: MapFeature<P>) {
    const input = { feature, configuration: this.options.configuration(), style: this.options.style(feature), selected: this.selected.has(feature.id) };
    const result = computeEntity(input, this.height,
      this.elevation.readiness(`placement:${feature.id}`),
      (west, south, east, north) => this.elevation.maximum(west, south, east, north));
    const ground = result.state.ground ?? 0;
    const altitude = result.state.altitude ?? ground;
    const camera = this.coverage.update({
      entityId: feature.id,
      origin: [result.position[0], result.position[1], altitude],
      ground,
      placement: result.state.placement,
      cameras: feature.entity?.attachments?.filter((attachment): attachment is CameraAttachment => attachment.type === 'camera') ?? [],
      configuration: input.configuration,
    });
    result.state.coverage = camera.coverage === 'ready' ? result.state.coverage : camera.coverage;
    result.state.footprintTriangles = camera.footprintTriangles;
    this.apply(feature.id, result);
  }

  private apply(id: string, result: EntityComputationResult) {
    if (this.destroyed || !this.features.has(id)) return;
    this.geometry.set(id, result.primitives);
    this.geometryDirty = true;
    this.states.set(id, result.state);
    this.positions.set(id, result.position);
    const diagnostic = result.diagnostic;
    if (diagnostic && this.diagnosticKeys.get(id) !== diagnostic)
      this.options.diagnostic(new RidgelineError(diagnostic,
        diagnostic === 'ALTITUDE_MISSING' ? 'Entity altitude is missing and ground fallback is disabled.' : 'Entity is below terrain; only its ground position is shown.',
        { operation: 'entities', recoverable: true, featureId: id }));
    if (diagnostic) this.diagnosticKeys.set(id, diagnostic);
    else this.diagnosticKeys.delete(id);
  }
  private render() {
    if (!this.geometryDirty) return;
    this.geometryDirty = false;
    this.renderLayers();
  }
  private renderLayers(includeGround = true) {
    const primitives = [...this.geometry.values()].flat().concat(this.coverage.allGeometry());
    this.layer.set(primitives.filter(p => !p.surface));
    if (includeGround) this.groundLayer.set(primitives.filter(p => p.surface));
  }
}
