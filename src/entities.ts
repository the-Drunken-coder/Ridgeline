import type { ModelMeasurement } from './model-measurement';
import { MercatorCoordinate, Point } from 'maplibre-gl';
import { ModelFeedbackLayer } from './model-feedback-layer';
import { modelFeedback } from './model-presentation';
import type { ModelPresentation } from './model-presentation';
import { ModelLayer } from './model-layer';
import type { ModelFrame } from './model-layer';
import { EntityProjection, entityVertex } from './entity-projection';
import { modelPlacement } from './model-placement';
import { pickModelBox } from './model-picking';
import { modelFloorScale, modelScreenBox } from './model-frame';
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
  EntityModelSettings,
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
  measurement?: ModelMeasurement;
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
  commitPresentation?(records: readonly ModelPresentation[], current: () => boolean): boolean;
  contextLost?(): void;
  contextRestored?(): void;
};

export class EntityScene<P extends Properties> {
  readonly layer: EntityLayer;
  readonly modelLayer?: ModelLayer;
  private feedbackLayer: ModelFeedbackLayer;
  private previewed: string | null = null;
  private preparedModels = new Map<string, { feature: MapFeature<P>; style: FeatureStyle; settings: EntityModelSettings }>();
  private choices = new Map<string, ModelChoice>();
  private published = new Map<string, EntityState['representation']>();
  private revision = 0;
  private lost = false;
  private modelHits: { feature: MapFeature<P>; polygons: NonNullable<ReturnType<typeof modelScreenBox>>['polygons'] }[] = [];
  private terrainDepth?: (point: { x: number; y: number }) => number | undefined;
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
    this.feedbackLayer = new ModelFeedbackLayer(cause => options.diagnostic(new RidgelineError('MODEL_RENDERER_FAILED',
      'Model feedback could not render.', { operation: 'models', recoverable: true }, cause)));
    if (options.models) this.modelLayer = new ModelLayer(options.models, {
      measurement: options.measurement, prepare: (projection, available) => this.prepareModelFrame(projection, available), diagnostic: options.diagnostic,
      contextLost: () => this.contextLost(),
      contextRestored: () => { this.lost = false; options.contextRestored?.(); this.invalidate(); },
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
        if (this.dirty.size) this.schedule('elevation-change');
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
        this.schedule('coverage-change');
        options.changed([id]);
      },
      displayed: id => {
        const state = this.states.get(id);
        if (state) state.coverage = combineCoverage(this.nonCameraCoverage.get(id) ?? 'ready', this.coverage.status(id));
        this.renderLayers(false);
        options.changed([id]);
      },
    });
  }
  set(features: readonly MapFeature<P>[], removed: readonly string[] = []) {
    if (this.destroyed) return;
    this.revision++;
    const retired = new Set([...removed, ...features.filter(feature => !feature.entity).map(feature => feature.id)]);
    const referencesChanged = new Set(features.filter(feature => feature.entity &&
      this.features.get(feature.id)?.entity?.model?.id !== feature.entity.model?.id).map(feature => feature.id));
    // Install the whole accepted batch before aborting old work. An abort callback
    // may replace any member; its newer feature must survive the remaining cleanup.
    for (const id of retired) {
      this.features.delete(id);
      this.states.delete(id);
      this.preparedModels.delete(id); this.modelDiagnostics.delete(id); this.choices.delete(id); this.published.delete(id);
      this.nonCameraCoverage.delete(id);
      this.positions.delete(id);
      this.geometryDirty = this.geometry.delete(id) || this.geometryDirty;
      this.dirty.delete(id);
      this.diagnosticKeys.delete(id);
    }
    for (const feature of features) if (feature.entity) {
      this.features.set(feature.id, feature);
      this.dirty.add(feature.id);
    }
    const current = (feature: MapFeature<P>) => !this.destroyed && this.features.get(feature.id) === feature;
    for (const id of retired) {
      if (this.destroyed || this.features.has(id)) continue;
      this.coverage.remove(id);
      if (this.destroyed || this.features.has(id)) continue;
      this.elevation.release(placementAreaKey(id));
      if (this.destroyed || this.features.has(id)) continue;
      this.elevation.release(modelAreaKey(id));
    }
    for (const feature of features) if (referencesChanged.has(feature.id) && current(feature))
      this.elevation.release(modelAreaKey(feature.id));
    const areas: { feature: MapFeature<P>; request: { key: string; center: [number, number]; radiusMeters: number } }[] = [];
    const footprintsVisible = this.options.configuration().entityVisibility.footprints;
    for (const feature of features) {
      if (!current(feature) || !feature.entity || feature.geometry.type !== 'Point') continue;
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
      areas.push({ feature, request: { key: placementAreaKey(feature.id), center, radiusMeters } });
    }
    this.elevation.requestBatch(areas.filter(area => current(area.feature)).map(area => area.request), { deferProbe: true });
    this.schedule('accepted-entities');
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
  preview(id: string | null) {
    if (this.previewed === id || this.destroyed) return;
    this.previewed = id; this.revision++;
    if (!this.lost) this.options.map.triggerRepaint();
  }
  selection(ids: readonly string[]) {
    if (this.destroyed) return;
    const next = new Set(ids);
    if (next.size === this.selected.size && [...next].every(id => this.selected.has(id))) return;
    this.revision++;
    for (const id of new Set([...this.selected, ...next]))
      if (this.selected.has(id) !== next.has(id) && this.features.has(id)) this.dirty.add(id);
    this.selected = next;
    if (this.dirty.size) this.schedule('selection');
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
    if (ids.length) { this.schedule('model-status'); (this.options.representationChanged ?? this.options.changed)(ids); }
    if (!this.destroyed && !this.lost) this.options.map.triggerRepaint();
  }
  pickAbove(x: number, y: number, tolerance: number) {
    if (this.lost || this.destroyed) return [];
    const pickStart = this.options.measurement?.begin();
    const models: { entityId: string; attachmentId?: string; depth: number }[] = this.modelHits.flatMap(({ feature, polygons }) => {
      if (this.features.get(feature.id) !== feature) return [];
      const point = pickModelBox(polygons, x, y, tolerance, this.terrainDepth);
      return point ? [{ entityId: feature.id, depth: point.depth }] : [];
    });
    if (pickStart !== undefined) this.options.measurement!.end('picking', pickStart, { boxes: this.modelHits.length });
    return [...[...models, ...this.layer.pick(x, y, tolerance)].sort((a, b) => a.depth - b.depth), ...this.coverage.pick(x, y)];
  }
  contextLost() {
    if (this.lost || this.destroyed) return;
    this.lost = true; this.revision++; this.feedbackLayer.clear();
    this.modelHits = []; this.terrainDepth = undefined;
    const ids = [...this.published.keys()];
    this.published = new Map(ids.map(id => [id, 'withheld']));
    this.options.contextLost?.();
    this.modelLayer?.contextLost();
    if (!this.destroyed && ids.length) (this.options.representationChanged ?? this.options.changed)(ids);
  }
  pickGround(x: number, y: number, tolerance: number) {
    return this.groundLayer.pick(x, y, tolerance);
  }
  attach() {
    this.modelHits = []; this.terrainDepth = undefined;
    this.groundLayer.attach();
    this.coverage.attach();
    if (!this.options.map.getLayer(this.layer.id)) this.options.map.addLayer(this.layer);
    if (this.modelLayer && !this.options.map.getLayer(this.modelLayer.id)) this.options.map.addLayer(this.modelLayer, this.layer.id);
    if (!this.options.map.getLayer(this.feedbackLayer.id)) this.options.map.addLayer(this.feedbackLayer);
    this.invalidate();
  }
  destroy() {
    this.coverage.destroy();
    this.destroyed = true;
    this.modelHits = []; this.terrainDepth = undefined;
    cancelAnimationFrame(this.frame);
    this.elevation.destroy();
    this.layer.onRemove();
    this.modelLayer?.destroy(); this.feedbackLayer.destroy();
    this.preparedModels.clear(); this.modelDiagnostics.clear(); this.choices.clear(); this.published.clear();
    this.features.clear();
    this.geometry.clear();
    this.states.clear();
    this.nonCameraCoverage.clear();
    this.positions.clear();
  }
  private invalidate() {
    for (const id of this.features.keys()) this.dirty.add(id);
    this.schedule('invalidation');
  }
  private trace(phase: 'schedule' | 'preparation-start' | 'preparation-end', cause: string) {
    const measurement = this.options.measurement;
    if (measurement?.idleEnabled) measurement.event(phase, { cause, sceneRevision: this.revision,
      updateRevision: measurement.revision, pendingEntities: this.dirty.size, framePending: this.frame !== 0 });
  }
  private schedule(cause: string) {
    this.trace('schedule', cause);
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => this.flush());
  }
  private flush() {
    this.trace('preparation-start', 'entity-flush');
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
    this.trace('preparation-end', 'entity-flush');
  }
  private build(feature: MapFeature<P>) {
    const revision = this.revision;
    const current = () => {
      if (this.destroyed || this.features.get(feature.id) !== feature) return false;
      if (this.revision === revision) return true;
      // Selection, preview or configuration callbacks can invalidate this attempt
      // without replacing the feature. Keep its consumed work queued for recovery.
      this.dirty.add(feature.id);
      this.schedule('interrupted-preparation');
      return false;
    };
    let style: FeatureStyle;
    try { style = this.options.style(feature); }
    catch (cause) {
      this.options.diagnostic(new RidgelineError('CALLBACK_FAILED', 'An entity style callback threw.',
        { operation: 'style', recoverable: true, featureId: feature.id }, cause));
      return;
    }
    if (!current()) return;
    const input = { feature, configuration: this.options.configuration(), style, selected: this.selected.has(feature.id) };
    const placementKey = placementAreaKey(feature.id);
    const result = computeEntity(input, this.elevation.sampling(),
      (lng, lat) => this.elevation.failedAt(placementKey, lng, lat));
    // A consumer sampler can remove or replace the entity during computation.
    if (!current()) return;
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
    if (!current()) return;
    const placementCoverage = result.state.coverage;
    result.state.coverage = combineCoverage(placementCoverage, camera.coverage);
    result.state.footprintTriangles = camera.footprintTriangles;
    const preparedStyle = { ...style, modelAppearance: modelAppearance(style.modelAppearance) };
    const settings = modelSettings(input.configuration.entityModels ?? DEFAULT_ENTITY_MODELS, feature.entity?.model);
    this.prepareModel(feature, result);
    if (!current()) return;
    if (this.preparedModels.get(feature.id)?.feature.entity?.model?.id !== feature.entity?.model?.id ||
      feature.entity?.heading === undefined || result.state.model?.status === 'unavailable')
      this.choices.delete(feature.id);
    // Pose and appearance belong to the same successful preparation as placement
    // and attachments. Failed updates must not mix accepted data with old geometry.
    this.preparedModels.set(feature.id, { feature, style: preparedStyle, settings });
    this.nonCameraCoverage.set(feature.id, placementCoverage);
    this.apply(feature.id, result);
  }

  private prepareModel(feature: MapFeature<P>, result: EntityComputationResult) {
    const entity = feature.entity, reference = entity?.model, registry = this.options.models;
    if (!reference || !registry) { this.modelDiagnostics.delete(feature.id); return; }
    const status = registry.status(reference.id);
    result.state.model = status;
    const problem = entity.heading === undefined ? 'MODEL_HEADING_MISSING' : status.status === 'unavailable' ? 'MODEL_UNAVAILABLE' : undefined;
    if (problem) {
      const key = `${problem}:${reference.id}`;
      if (this.modelDiagnostics.get(feature.id) !== key) {
        this.modelDiagnostics.set(feature.id, key);
        this.options.diagnostic(new RidgelineError(problem, problem === 'MODEL_HEADING_MISSING' ? 'Entity model requires heading.' : 'The referenced model is unavailable.',
          { operation: 'entities', recoverable: true, featureId: feature.id, modelId: reference.id }));
      }
    } else this.modelDiagnostics.delete(feature.id);
  }

  private prepareModelFrame(projection: EntityProjection, rendererAvailable: boolean): ModelFrame | undefined {
    if (this.destroyed || this.lost) return;
    const revision = this.revision, registry = this.options.models, configuration = this.options.configuration();
    const current = () => !this.destroyed && !this.lost && this.revision === revision && this.options.configuration() === configuration;
    if (this.dirty.size || this.geometryDirty) this.flush();
    // Computation publishes consumer callbacks. A replacement must be computed
    // by the layer's next bounded attempt before any cached placement is used.
    if (!current()) return;
    const measured = this.options.measurement?.enabled;
    const updateRevision = measured ? this.options.measurement!.revision : 0;
    const frame = measured ? this.options.measurement!.frame() : 0;
    let placementMs = 0, projectionScalingMs = 0;
    this.options.beginNativeFrame?.();
    const choices = new Map<string, ModelChoice>(), representations = new Map<string, EntityState['representation']>();
    const grouped = new Map<RegisteredModel<ModelGpu>, ModelDraw>();
    const hits: typeof this.modelHits = [];
    const presentation: ModelPresentation[] = [];
    const center = this.options.map.getCenter(), frameOrigin = MercatorCoordinate.fromLngLat([wrapLongitude(center.lng), center.lat]);
    const origin: [number, number] = [frameOrigin.x, frameOrigin.y];
    const transform = this.options.map._camera.transform;
    const camera = MercatorCoordinate.fromLngLat(transform.getCameraLngLat());
    const cameraHeight = transform.getCameraAltitude();
    for (const [id, accepted] of this.features) {
      const prepared = this.preparedModels.get(id);
      if (!prepared) continue;
      const { feature, style, settings } = prepared;
      const entity = feature.entity, state = this.states.get(id);
      if (!entity || !state || feature.geometry.type !== 'Point') continue;
      const reference = entity.model, asset = reference && registry?.get(reference.id);
      const status = reference ? registry?.status(reference.id).status ?? 'unavailable' : 'unavailable';
      const point = MercatorCoordinate.fromLngLat([wrapLongitude(feature.geometry.coordinates[0]!),
        Math.max(-85.05112878, Math.min(85.05112878, feature.geometry.coordinates[1]!))]);
      const height = (state.altitude ?? 0) * verticalScale(configuration), unit = point.meterInMercatorCoordinateUnits(), dx = point.x - camera.x;
      const distance = Math.hypot((dx - Math.round(dx)) / unit, (point.y - camera.y) / unit, height - cameraHeight);
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
        let phaseStart = measured ? performance.now() : 0;
        const physical = modelPlacement(input, this.elevation.sampling());
        if (measured) placementMs += performance.now() - phaseStart;
        if (!current()) return;
        let placement = physical;
        for (let refinement = 0; refinement < 4 && placement.status === 'ready'; refinement++) {
          if (measured) phaseStart = performance.now();
          const factor = modelFloorScale(projection, placement, origin, settings.minimumSizePixels);
          if (measured) projectionScalingMs += performance.now() - phaseStart;
          if (factor <= 1) break;
          if (measured) phaseStart = performance.now();
          placement = modelPlacement({ ...input, displayScale: placement.displayScale * factor }, this.elevation.sampling());
          if (measured) placementMs += performance.now() - phaseStart;
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
          representation = 'model';
          if (measured) phaseStart = performance.now();
          const box = modelScreenBox(projection, placement, origin);
          if (measured) projectionScalingMs += performance.now() - phaseStart;
          if (box && projection.intersectsViewport(box)) {
            const draw = grouped.get(asset) ?? { asset, origin, instances: [] };
            draw.instances.push({ feedback: modelFeedback(this.selected.has(id), this.previewed === id), basis: placement.basis, anchor: entityVertex(placement.position, origin),
              appearance: style.modelAppearance && { ...style.modelAppearance } });
            grouped.set(asset, draw);
            hits.push({ feature: accepted, polygons: box.polygons });
            const anchor = projection.project(placement.position, origin);
            const labelHeight = state.placement === 'airborne' ? (state.altitude ?? 0) * verticalScale(configuration)
              : configuration.terrain ? (state.ground ?? 0) * configuration.exaggeration : 0;
            const labelAnchor = projection.project([input.location[0], input.location[1], labelHeight], origin);
            if (anchor && labelAnchor) presentation.push({ id, anchor, labelAnchor, box, hasLabel: Boolean(style.label), feedback: modelFeedback(this.selected.has(id), this.previewed === id) });
          }
        }
      }
      representations.set(id, representation);
    }
    if (!current()) return;
    if (measured) this.options.measurement!.event('scene-cpu', { frame, updateRevision, placementMs, projectionScalingMs });
    const drawnTransform = transform.clone(), terrain = this.options.map.terrain;
    const terrainDepth = (point: { x: number; y: number }) => {
      if (!terrain) return undefined;
      const location = drawnTransform.screenPointToLocation(new Point(point.x, point.y), terrain);
      const height = this.options.map.queryTerrainElevation(location);
      return height === null ? undefined : projection.project([location.lng, location.lat, height])?.depth;
    };
    return { draws: [...grouped.values()], current,
      commit: () => {
        if (!current()) return false;
        const hidden = new Map([...representations].map(([id, representation]) => [id, representation !== 'icon']));
        if (this.options.commitPresentation?.(presentation, current) === false || !current()) return false;
        if (this.options.commitVisibility?.(hidden, current) === false || !current()) return false;
        this.feedbackLayer.set(presentation, current);
        this.layer.suppressPoints(new Set([...hidden].filter(([, hide]) => hide).map(([id]) => id)));
        return true;
      },
      publish: modelsDrawn => {
        if (!current()) return;
        this.modelHits = modelsDrawn ? hits : [];
        if (measured) this.options.measurement!.event('frame', { frame, sceneRevision: revision, updateRevision,
          drawnModels: modelsDrawn ? [...grouped.values()].reduce((sum, draw) => sum + draw.instances.length, 0) : 0,
          clippedBoxes: modelsDrawn ? hits.length : 0,
          batches: modelsDrawn ? [...grouped.values()].reduce((sum, draw) => sum + draw.asset.model.batches.length, 0) : 0,
          triangles: modelsDrawn ? [...grouped.values()].reduce((sum, draw) => sum + draw.instances.length * draw.asset.model.batches.reduce((n, batch) => n + batch.indices.length / 3, 0), 0) : 0 });
        this.terrainDepth = modelsDrawn ? terrainDepth : undefined;
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
