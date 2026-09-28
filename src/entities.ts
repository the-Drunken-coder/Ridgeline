import type { Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from './entity-layer';
import { EntityGround } from './entity-ground';
import type { Primitive } from './entity-layer';
import { localFrame } from './entity-geometry';
import { computeEntity } from './entity-computation';
import type { EntityComputationResult } from './entity-computation';
import type { HeightAt } from './entity-geometry';
import { RasterElevationSampler } from './elevation-sampler';
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
const verticalScale = (configuration: MapConfiguration) =>
  configuration.terrain ? configuration.exaggeration : 1;
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
  private raster: RasterElevationSampler;
  private customGeneration = new AbortController();
  private preparing = new Map<string, Promise<void>>();
  private coverage: SensorCameraCoverage;
  private footprintsVisible: boolean;
  private diagnosticKeys = new Map<string, string>();
  constructor(private options: SceneOptions<P>) {
    this.footprintsVisible = options.configuration().entityVisibility.footprints;
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
    if (!options.sampler) this.height.maximum = (west, south, east, north) => this.raster.maximum(west, south, east, north);
    this.coverage = new SensorCameraCoverage({
      map: options.map,
      height: this.height,
      prepare: options.sampler?.prepare?.bind(options.sampler),
      elevationUnavailable: () => this.raster.unavailable(),
      pollTerrain: !options.sampler,
      diagnostic: cause => options.diagnostic(new RidgelineError(
        'ELEVATION_UNAVAILABLE',
        'Consumer elevation source could not prepare sensor terrain.',
        { operation: 'entities', recoverable: true },
        cause,
      )),
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
  private createSampler() {
    return new RasterElevationSampler(
      this.options.configuration().elevation,
      () => {
        this.coverage?.elevationChanged();
        this.invalidate();
      },
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
      this.preparing.delete(id);
      this.coverage.remove(id);
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
        this.preparing.delete(feature.id);
        this.coverage.remove(feature.id);
        this.features.delete(feature.id);
        this.states.delete(feature.id);
        this.positions.delete(feature.id);
        this.geometryDirty = this.geometry.delete(feature.id) || this.geometryDirty;
        this.diagnosticKeys.delete(feature.id);
      }
    }
    this.schedule();
    const footprintsVisible = this.options.configuration().entityVisibility.footprints;
    const sharedPreparation = features.filter(feature => {
      const attachments = feature.entity?.attachments ?? [];
      const hasTerrainCamera = attachments.some(attachment => attachment.type === 'camera' && attachment.terrainVisibility);
      const hasSharedAttachment = attachments.some(attachment => attachment.type !== 'camera');
      // Terrain-visibility cameras own their wider patch preparation. Plain
      // cameras still need the shared center sample for entity placement;
      // non-camera attachments also need their own terrain samples. Ground
      // entities and hidden terrain cameras still need a placement sample.
      const needsPlacement = feature.entity && !feature.entity.altitude;
      return feature.entity && (needsPlacement || !hasTerrainCamera || hasSharedAttachment || !footprintsVisible);
    });
    if (this.options.sampler?.prepare && sharedPreparation.length) {
      const positions: [number, number][] = [];
      for (const f of sharedPreparation)
        if (f.entity && f.geometry.type === 'Point') {
          const [lng, lat] = f.geometry.coordinates;
          if (lng === undefined || lat === undefined) continue;
          positions.push([lng, lat]);
          const local = localFrame([lng, lat, 0]);
          for (const a of f.entity.attachments ?? []) {
            if (a.type === 'camera') continue;
            const range = a.type === 'polygon'
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
      const preparation = this.options.sampler.prepare(positions, generation.signal);
      for (const feature of sharedPreparation) if (feature.entity) this.preparing.set(feature.id, preparation);
      void preparation
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
        })
        .finally(() => {
          if (generation.signal.aborted) return;
          for (const [id, pending] of this.preparing) if (pending === preparation) {
            this.preparing.delete(id);
          }
          this.invalidate();
        });
    }
  }
  configure(elevationChanged = false) {
    const footprintsVisible = this.options.configuration().entityVisibility.footprints;
    const hidingCoverage = this.footprintsVisible && !footprintsVisible;
    this.footprintsVisible = footprintsVisible;
    this.coverage.invalidate();
    if (elevationChanged) {
      this.coverage.resetElevation();
      this.raster.destroy();
      this.raster = this.createSampler();
      this.customGeneration.abort();
      this.customGeneration = new AbortController();
      this.preparing.clear();
    }
    if (this.options.sampler?.prepare && hidingCoverage) {
      // Hiding coverage cancels camera terrain work. Placement still needs its
      // center sample, including when coverage is hidden before the first build.
      this.set([...this.features.values()].filter(feature => {
        if (this.preparing.has(feature.id) || feature.geometry.type !== 'Point') return false;
        const [lng, lat] = feature.geometry.coordinates;
        return lng !== undefined && lat !== undefined && this.height(lng, lat) === null;
      }));
    }
    this.invalidate();
  }
  retry() {
    this.coverage.retry();
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
      position: this.positions.get(feature.id),
      offset: airborne ? (config.terrain ? (altitude - ground) * verticalScale(config) : altitude) : 0,
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
    this.customGeneration.abort();
    this.preparing.clear();
    this.raster.destroy();
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
  private height: HeightAt = (lng, lat) => {
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
    const unavailable = () => this.options.sampler
      ? !this.preparing.has(feature.id) && !this.coverage.isPreparing(feature.id)
      : this.raster.unavailable();
    const result = computeEntity(input, this.height, unavailable);
    const ground = result.state.ground ?? 0;
    const altitude = result.state.altitude ?? ground;
    const camera = this.coverage.update({
      entityId: feature.id,
      origin: [result.position[0], result.position[1], altitude],
      ground,
      placement: result.state.placement,
      cameras: feature.entity?.attachments?.filter((attachment): attachment is CameraAttachment => attachment.type === 'camera') ?? [],
      configuration: input.configuration,
      elevationUnavailable: this.options.sampler ? !this.preparing.has(feature.id) : this.raster.unavailable(),
      elevationPreparing: this.options.sampler ? this.preparing.has(feature.id) : false,
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
    this.layer.set(primitives.filter(p => !p.surface), verticalScale(this.options.configuration()));
    if (includeGround) this.groundLayer.set(primitives.filter(p => p.surface));
  }
}
