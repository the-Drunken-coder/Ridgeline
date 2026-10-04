import { MercatorCoordinate } from 'maplibre-gl';
import { ModelLayer } from './model-layer';
import type { ModelInstance } from './model-layer';
import type { ModelGpu } from './model-renderer';
import type { ModelRegistry } from './models';
import { DEFAULT_ENTITY_MODELS, modelAppearance, modelSettings } from './model-settings';
import type { Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from './entity-layer';
import { EntityGround } from './entity-ground';
import type { Primitive } from './entity-layer';
import { computeEntity } from './entity-computation';
import type { EntityComputationResult } from './entity-computation';
import { Elevation, entityIdForAreaKey, placementAreaKey } from './elevation';
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
const combineCoverage = (a: EntityState['coverage'], b: EntityState['coverage']): EntityState['coverage'] =>
  a === 'unavailable' || b === 'unavailable' ? 'unavailable' : a === 'loading' || b === 'loading' ? 'loading' : 'ready';
const verticalScale = (configuration: MapConfiguration) =>
  configuration.terrain ? configuration.exaggeration : 1;
type SceneOptions<P extends Properties> = {
  map: GLMap;
  configuration: () => MapConfiguration;
  style: (feature: MapFeature<P>) => FeatureStyle;
  sampler?: ElevationSampler;
  diagnostic: (error: RidgelineError) => void;
  changed: (ids: string[]) => void;
  models?: ModelRegistry<ModelGpu>;
};

export class EntityScene<P extends Properties> {
  readonly layer: EntityLayer;
  readonly modelLayer?: ModelLayer;
  private modelInstances = new Map<string, ModelInstance>();
  private modelDiagnostics = new Map<string, string>();
  private groundLayer: EntityGround;
  private features = new Map<string, MapFeature<P>>();
  private states = new Map<string, EntityState>();
  private nonCameraCoverage = new Map<string, EntityState['coverage']>();
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
    if (options.models) this.modelLayer = new ModelLayer(options.models, options.diagnostic);
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
      pixelRatio: options.map.getPixelRatio(),
      changed: keys => {
        for (const key of keys) {
          const id = entityIdForAreaKey(key);
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
        if (state) state.coverage = combineCoverage(this.nonCameraCoverage.get(id) ?? 'ready', this.coverage.status(id));
        this.geometryDirty = true;
        this.renderLayers(false);
        options.changed([id]);
      },
    });
  }
  set(features: readonly MapFeature<P>[], removed: readonly string[] = []) {
    for (const id of removed) {
      this.coverage.remove(id);
      this.elevation.release(placementAreaKey(id));
      this.features.delete(id);
      this.states.delete(id);
      this.modelInstances.delete(id); this.modelDiagnostics.delete(id);
      this.nonCameraCoverage.delete(id);
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
        this.elevation.release(placementAreaKey(feature.id));
        this.features.delete(feature.id);
        this.states.delete(feature.id);
        this.modelInstances.delete(feature.id); this.modelDiagnostics.delete(feature.id);
        this.nonCameraCoverage.delete(feature.id);
        this.positions.delete(feature.id);
        this.geometryDirty = this.geometry.delete(feature.id) || this.geometryDirty;
        this.diagnosticKeys.delete(feature.id);
      }
    }
    const areas: { key: string; center: [number, number]; radiusMeters: number }[] = [];
    const footprintsVisible = this.options.configuration().entityVisibility.footprints;
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
      const previous = this.states.get(feature.id);
      const cameraCapable = previous === undefined || previous.placement === 'elevation-unavailable' ||
        (previous.placement === 'airborne' && (previous.altitude ?? 0) > (previous.ground ?? 0) + 0.01);
      this.coverage.requestAreas(feature.id, center,
        attachments.filter((attachment): attachment is CameraAttachment => attachment.type === 'camera'),
        footprintsVisible && Boolean(feature.entity.altitude) && cameraCapable);
      areas.push({ key: placementAreaKey(feature.id), center, radiusMeters });
    }
    this.elevation.requestBatch(areas, { deferProbe: true });
    this.schedule();
  }
  configure(elevationChanged = false) {
    if (elevationChanged) {
      this.elevation.reset(this.options.configuration().elevation);
      this.coverage.resetElevation();
    } else this.coverage.invalidate();
    this.invalidate();
  }
  retry() {
    this.layer.retry();
    this.elevation.retry();
    this.coverage.retry();
    this.invalidate();
  }
  selection(ids: readonly string[]) {
    const next = new Set(ids);
    for (const id of new Set([...this.selected, ...next]))
      if (this.selected.has(id) !== next.has(id) && this.features.has(id)) this.dirty.add(id);
    this.selected = next;
    if (this.dirty.size) this.schedule();
  }
  getState(id: string) {
    const state = this.states.get(id);
    const reference = this.features.get(id)?.entity?.model;
    return state && { ...state, model: reference ? this.options.models?.status(reference.id) : undefined };
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
      offset: airborne ? (config.terrain ? (altitude - ground) * verticalScale(config) : altitude) : 0,
    };
  }
  modelsChanged(modelId: string) {
    if (this.destroyed) return;
    const ids = [...this.features.values()].filter(feature => feature.entity?.model?.id === modelId).map(feature => feature.id);
    for (const id of ids) this.dirty.add(id);
    if (ids.length) { this.schedule(); this.options.changed(ids); }
  }
  cameraChanged() { if ([...this.features.values()].some(feature => feature.entity?.model)) this.invalidate(); }
  pickAbove(x: number, y: number, tolerance: number) {
    return [...this.layer.pick(x, y, tolerance), ...this.coverage.pick(x, y)];
  }
  pickGround(x: number, y: number, tolerance: number) {
    return this.groundLayer.pick(x, y, tolerance);
  }
  attach() {
    this.groundLayer.attach();
    this.coverage.attach();
    if (!this.options.map.getLayer(this.layer.id)) this.options.map.addLayer(this.layer);
    if (this.modelLayer && !this.options.map.getLayer(this.modelLayer.id)) this.options.map.addLayer(this.modelLayer, this.layer.id);
    this.invalidate();
  }
  destroy() {
    this.coverage.destroy();
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.elevation.destroy();
    this.modelLayer?.destroy();
    this.modelInstances.clear(); this.modelDiagnostics.clear();
    this.features.clear();
    this.geometry.clear();
    this.states.clear();
    this.nonCameraCoverage.clear();
    this.positions.clear();
  }
  private invalidate() {
    for (const id of this.features.keys()) this.dirty.add(id);
    this.schedule();
  }
  private schedule() {
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => this.flush());
  }
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
        if (this.destroyed || this.features.get(id) !== feature) continue;
        this.coverage.unavailable(id);
        const state = this.states.get(id);
        if (state) this.states.set(id, { ...state, coverage: 'unavailable', footprintTriangles: 0 });
        // Preserve the last valid placement and non-camera attachments while
        // removing coverage whose required elevation calculation failed.
        this.geometryDirty = true;
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
    let style: FeatureStyle;
    try { style = this.options.style(feature); }
    catch (cause) {
      this.options.diagnostic(new RidgelineError('CALLBACK_FAILED', 'An entity style callback threw.',
        { operation: 'style', recoverable: true, featureId: feature.id }, cause));
      return;
    }
    if (this.destroyed || this.features.get(feature.id) !== feature) return;
    const input = { feature, configuration: this.options.configuration(), style, selected: this.selected.has(feature.id) };
    const placementKey = placementAreaKey(feature.id);
    const result = computeEntity(input, this.elevation.sampling(),
      (lng, lat) => this.elevation.failedAt(placementKey, lng, lat));
    // A consumer sampler can remove or replace the entity during computation.
    if (this.destroyed || this.features.get(feature.id) !== feature) return;
    if (result.state.coverage !== 'ready') {
      // A ground area can contain unknown samples between its preparation grid points.
      this.elevation.requirePreparation(placementKey);
      result.state.coverage = this.elevation.readiness(placementKey);
    }
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
    if (this.destroyed || this.features.get(feature.id) !== feature) return;
    const placementCoverage = result.state.coverage;
    this.nonCameraCoverage.set(feature.id, placementCoverage);
    result.state.coverage = combineCoverage(placementCoverage, camera.coverage);
    result.state.footprintTriangles = camera.footprintTriangles;
    this.prepareModel(feature, style, result);
    if (this.destroyed || this.features.get(feature.id) !== feature) return;
    this.apply(feature.id, result);
  }

  private prepareModel(feature: MapFeature<P>, style: FeatureStyle, result: EntityComputationResult) {
    this.modelInstances.delete(feature.id);
    const entity = feature.entity, reference = entity?.model, registry = this.options.models;
    if (!reference || !registry) { this.modelDiagnostics.delete(feature.id); return; }
    const status = registry.status(reference.id), asset = registry.get(reference.id);
    result.state.model = status;
    const problem = entity.heading === undefined ? 'MODEL_HEADING_MISSING' : status.status === 'unavailable' ? 'MODEL_UNAVAILABLE' : undefined;
    if (problem) {
      const key = `${problem}:${reference.id}`;
      if (this.modelDiagnostics.get(feature.id) !== key) {
        this.modelDiagnostics.set(feature.id, key);
        this.options.diagnostic(new RidgelineError(problem, problem === 'MODEL_HEADING_MISSING' ? 'Entity model requires heading.' : 'The referenced model is unavailable.',
          { operation: 'entities', recoverable: true, featureId: feature.id, modelId: reference.id }));
      }
      return;
    }
    this.modelDiagnostics.delete(feature.id);
    if (!asset || !registry.available || entity.heading === undefined || result.state.ground === undefined ||
      !['ground', 'airborne'].includes(result.state.placement) || result.state.altitude === undefined) return;
    const settings = modelSettings(this.options.configuration().entityModels ?? DEFAULT_ENTITY_MODELS, reference);
    const [lng, lat] = result.position;
    const transform = this.options.map._camera.transform;
    const camera = MercatorCoordinate.fromLngLat(transform.getCameraLngLat());
    const point = MercatorCoordinate.fromLngLat([lng, lat]);
    const unit = point.meterInMercatorCoordinateUnits(), dx = point.x - camera.x;
    const height = result.state.altitude * verticalScale(this.options.configuration());
    if (Math.hypot((dx - Math.round(dx)) / unit, (point.y - camera.y) / unit, height - transform.getCameraAltitude()) >= settings.switchDistanceMeters) return;
    const appearance = modelAppearance(style.modelAppearance);
    this.modelInstances.set(feature.id, { id: feature.id, modelId: reference.id, asset, position: [lng, lat, height],
      heading: entity.heading, pitch: entity.pitch ?? 0, roll: entity.roll ?? 0, grounded: result.state.placement === 'ground', appearance });
    result.state.representation = 'model';
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
    this.layer.set(primitives.filter(p => !p.surface && !(p.mode === 'points' && this.states.get(p.entityId)?.representation === 'model')), verticalScale(this.options.configuration()));
    this.modelLayer?.set([...this.modelInstances.values()]);
    if (includeGround) this.groundLayer.set(primitives.filter(p => p.surface));
  }
}
