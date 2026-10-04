import { MercatorCoordinate } from 'maplibre-gl';
import { ModelLayer } from './model-layer';
import type { ModelFrame } from './model-layer';
import { EntityProjection, entityVertex } from './entity-projection';
import { modelPlacement } from './model-placement';
import { modelFloorScale } from './model-frame';
import { modelChoice } from './model-switching';
import type { ModelChoice } from './model-switching';
import { wrapLongitude } from './longitude';
import type { ModelDraw, ModelGpu } from './model-renderer';
import type { ModelRegistry, RegisteredModel } from './models';
import { DEFAULT_ENTITY_MODELS, modelAppearance, modelSettings } from './model-settings';
import type { Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from './entity-layer';
import { EntityGround } from './entity-ground';
import type { Primitive } from './entity-layer';
import { computeEntity } from './entity-computation';
import type { EntityComputationResult } from './entity-computation';
import { Elevation, entityIdForAreaKey, placementAreaKey, modelAreaKey } from './elevation';
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
  beginNativeFrame?(): void;
  nativeAvailable?(feature: MapFeature<P>, style: FeatureStyle): boolean;
  commitVisibility?(hidden: ReadonlyMap<string, boolean>, current: () => boolean): boolean;
  representationChanged?(ids: string[]): void;
};

export class EntityScene<P extends Properties> {
  readonly layer: EntityLayer;
  readonly modelLayer?: ModelLayer;
  private modelStyles = new Map<string, FeatureStyle>();
  private choices = new Map<string, ModelChoice>();
  private published = new Map<string, EntityState['representation']>();
  private revision = 0;
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
    if (options.models) this.modelLayer = new ModelLayer(options.models, {
      prepare: (projection, available) => this.prepareModelFrame(projection, available), diagnostic: options.diagnostic,
    });
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
    this.revision++;
    for (const id of removed) {
      this.coverage.remove(id);
      this.elevation.release(placementAreaKey(id)); this.elevation.release(modelAreaKey(id));
      this.features.delete(id);
      this.states.delete(id);
      this.modelStyles.delete(id); this.modelDiagnostics.delete(id); this.choices.delete(id); this.published.delete(id);
      this.nonCameraCoverage.delete(id);
      this.positions.delete(id);
      this.geometryDirty = this.geometry.delete(id) || this.geometryDirty;
      this.dirty.delete(id);
      this.diagnosticKeys.delete(id);
    }
    for (const feature of features) {
      if (feature.entity) {
        if (this.features.get(feature.id)?.entity?.model?.id !== feature.entity.model?.id) {
          this.choices.delete(feature.id); this.elevation.release(modelAreaKey(feature.id));
        }
        this.features.set(feature.id, feature);
        this.dirty.add(feature.id);
      } else {
        this.coverage.remove(feature.id);
        this.elevation.release(placementAreaKey(feature.id)); this.elevation.release(modelAreaKey(feature.id));
        this.features.delete(feature.id);
        this.states.delete(feature.id);
        this.modelStyles.delete(feature.id); this.modelDiagnostics.delete(feature.id); this.choices.delete(feature.id); this.published.delete(feature.id);
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
    this.revision++;
    if (elevationChanged) {
      this.elevation.reset(this.options.configuration().elevation);
      this.coverage.resetElevation();
    } else this.coverage.invalidate();
    this.invalidate();
  }
  retry() {
    this.revision++;
    this.modelLayer?.retry();
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
    return state && { ...state, representation: this.modelLayer ? this.published.get(id) ?? 'withheld' : state.representation, model: reference ? this.options.models?.status(reference.id) : undefined };
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
    this.revision++;
    if (this.options.models?.status(modelId).status === 'unavailable') for (const id of ids) { this.choices.delete(id); this.elevation.release(modelAreaKey(id)); }
    for (const id of ids) this.dirty.add(id);
    if (ids.length) { this.schedule(); (this.options.representationChanged ?? this.options.changed)(ids); }
    if (!this.destroyed) this.options.map.triggerRepaint();
  }
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
    this.modelStyles.clear(); this.modelDiagnostics.clear(); this.choices.clear(); this.published.clear();
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
    cancelAnimationFrame(this.frame);
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
    if (this.destroyed) return;
    this.coverage.flush();
    if (this.destroyed) return;
    this.render();
    if (ids.length && !this.destroyed) this.options.changed(ids.filter(id => this.features.has(id)));
  }
  private build(feature: MapFeature<P>) {
    const revision = this.revision;
    let style: FeatureStyle;
    try { style = this.options.style(feature); }
    catch (cause) {
      this.options.diagnostic(new RidgelineError('CALLBACK_FAILED', 'An entity style callback threw.',
        { operation: 'style', recoverable: true, featureId: feature.id }, cause));
      return;
    }
    if (this.destroyed || this.revision !== revision || this.features.get(feature.id) !== feature) return;
    const input = { feature, configuration: this.options.configuration(), style, selected: this.selected.has(feature.id) };
    const placementKey = placementAreaKey(feature.id);
    const result = computeEntity(input, this.elevation.sampling(),
      (lng, lat) => this.elevation.failedAt(placementKey, lng, lat));
    // A consumer sampler can remove or replace the entity during computation.
    if (this.destroyed || this.revision !== revision || this.features.get(feature.id) !== feature) return;
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
    if (this.destroyed || this.revision !== revision || this.features.get(feature.id) !== feature) return;
    const placementCoverage = result.state.coverage;
    this.nonCameraCoverage.set(feature.id, placementCoverage);
    result.state.coverage = combineCoverage(placementCoverage, camera.coverage);
    result.state.footprintTriangles = camera.footprintTriangles;
    this.prepareModel(feature, style, result);
    if (this.destroyed || this.revision !== revision || this.features.get(feature.id) !== feature) return;
    this.apply(feature.id, result);
  }

  private prepareModel(feature: MapFeature<P>, style: FeatureStyle, result: EntityComputationResult) {
    this.modelStyles.set(feature.id, { ...style, modelAppearance: modelAppearance(style.modelAppearance) });
    const entity = feature.entity, reference = entity?.model, registry = this.options.models;
    if (!reference || !registry) { this.modelDiagnostics.delete(feature.id); this.choices.delete(feature.id); return; }
    const status = registry.status(reference.id);
    result.state.model = status;
    const problem = entity.heading === undefined ? 'MODEL_HEADING_MISSING' : status.status === 'unavailable' ? 'MODEL_UNAVAILABLE' : undefined;
    if (problem) {
      this.choices.delete(feature.id);
      const key = `${problem}:${reference.id}`;
      if (this.modelDiagnostics.get(feature.id) !== key) {
        this.modelDiagnostics.set(feature.id, key);
        this.options.diagnostic(new RidgelineError(problem, problem === 'MODEL_HEADING_MISSING' ? 'Entity model requires heading.' : 'The referenced model is unavailable.',
          { operation: 'entities', recoverable: true, featureId: feature.id, modelId: reference.id }));
      }
    } else this.modelDiagnostics.delete(feature.id);
  }

  private prepareModelFrame(projection: EntityProjection, rendererAvailable: boolean): ModelFrame | undefined {
    if (this.destroyed) return;
    if (this.dirty.size) this.flush();
    if (this.destroyed) return;
    const revision = this.revision, registry = this.options.models, configuration = this.options.configuration();
    const current = () => !this.destroyed && this.revision === revision && this.options.configuration() === configuration;
    this.options.beginNativeFrame?.();
    const choices = new Map<string, ModelChoice>(), representations = new Map<string, EntityState['representation']>();
    const grouped = new Map<RegisteredModel<ModelGpu>, ModelDraw>();
    const center = this.options.map.getCenter(), frameOrigin = MercatorCoordinate.fromLngLat([wrapLongitude(center.lng), center.lat]);
    const origin: [number, number] = [frameOrigin.x, frameOrigin.y];
    const transform = this.options.map._camera.transform;
    const camera = MercatorCoordinate.fromLngLat(transform.getCameraLngLat());
    const cameraHeight = transform.getCameraAltitude();
    for (const [id, feature] of this.features) {
      const entity = feature.entity, state = this.states.get(id), style = this.modelStyles.get(id) ?? {};
      if (!entity || !state || feature.geometry.type !== 'Point') continue;
      const reference = entity.model, asset = reference && registry?.get(reference.id);
      const status = reference ? registry?.status(reference.id).status ?? 'unavailable' : 'unavailable';
      const point = MercatorCoordinate.fromLngLat([wrapLongitude(feature.geometry.coordinates[0]!),
        Math.max(-85.05112878, Math.min(85.05112878, feature.geometry.coordinates[1]!))]);
      const height = (state.altitude ?? 0) * verticalScale(configuration), unit = point.meterInMercatorCoordinateUnits(), dx = point.x - camera.x;
      const distance = Math.hypot((dx - Math.round(dx)) / unit, (point.y - camera.y) / unit, height - cameraHeight);
      const settings = modelSettings(configuration.entityModels ?? DEFAULT_ENTITY_MODELS, reference);
      const eligible = Boolean(rendererAvailable && asset && state.ground !== undefined && (state.placement === 'ground' || state.placement === 'airborne'));
      const choice = modelChoice(this.choices.get(id), { modelId: reference?.id, heading: entity.heading, status, eligible, distance, settings });
      if (choice) choices.set(id, choice);
      if (!choice?.model) this.elevation.release(modelAreaKey(id));
      if (!current()) return;
      let representation: EntityState['representation'] = state.placement === 'withheld' ? 'withheld' :
        this.options.nativeAvailable?.(feature, style) !== false || state.placement === 'airborne' ? 'icon' : 'withheld';
      if (choice?.model && eligible && asset && entity.heading !== undefined) {
        const input = { bounds: asset.model.bounds, location: [feature.geometry.coordinates[0]!, feature.geometry.coordinates[1]!] as [number, number],
          placement: state.placement, altitude: state.altitude, heading: entity.heading, pitch: entity.pitch, roll: entity.roll,
          metersPerUnit: asset.definition.metersPerUnit, headingOffset: asset.definition.headingOffset,
          followSlope: reference?.followSlope, terrain: configuration.terrain, exaggeration: configuration.exaggeration };
        const physical = modelPlacement(input, this.elevation.sampling());
        if (!current()) return;
        let placement = physical;
        for (let refinement = 0; refinement < 4 && placement.status === 'ready'; refinement++) {
          const factor = modelFloorScale(projection, placement, origin, settings.minimumSizePixels);
          if (factor <= 1) break;
          placement = modelPlacement({ ...input, displayScale: placement.displayScale * factor }, this.elevation.sampling());
          if (!current()) return;
        }
        if (!current()) return;
        if (placement.status !== 'ineligible') {
          const key = modelAreaKey(id);
          this.elevation.requestBatch([{ key, center: input.location, radiusMeters: placement.radiusMeters,
            requiredPositions: placement.requiredPositions }], { deferProbe: true });
          if (!current()) return;
          if (placement.status === 'unknown') this.elevation.requirePreparation(key);
        }
        if (!current()) return;
        if (placement.status === 'ready') {
          const draw = grouped.get(asset) ?? { asset, origin, instances: [] };
          draw.instances.push({ basis: placement.basis, anchor: entityVertex(placement.position, origin),
            appearance: style.modelAppearance && { ...style.modelAppearance } });
          grouped.set(asset, draw);
          representation = 'model';
        }
      }
      representations.set(id, representation);
    }
    if (!current()) return;
    return { draws: [...grouped.values()], current,
      commit: () => {
        if (!current()) return false;
        const hidden = new Map([...representations].map(([id, representation]) => [id, representation !== 'icon']));
        if (this.options.commitVisibility?.(hidden, current) === false || !current()) return false;
        this.layer.suppressPoints(new Set([...hidden].filter(([, hide]) => hide).map(([id]) => id)));
        return true;
      },
      publish: () => {
        if (!current()) return;
        this.choices = choices;
        const changed = [...representations].filter(([id, representation]) => this.published.get(id) !== representation).map(([id]) => id);
        this.published = representations;
        if (changed.length) (this.options.representationChanged ?? this.options.changed)(changed);
      },
    };
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
    this.layer.set(primitives.filter(p => !p.surface), verticalScale(this.options.configuration()));
    if (includeGround) this.groundLayer.set(primitives.filter(p => p.surface));
  }
}
