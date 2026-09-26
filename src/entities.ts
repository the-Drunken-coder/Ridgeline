import { GpuCameras, sameCamera } from './gpu-cameras';
import type { GpuCamera } from './gpu-cameras';
import { cameraTerrain } from './gpu-camera-terrain';
import type { CameraTerrain } from './gpu-camera-terrain';
import type { Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from './entity-layer';
import { EntityGround } from './entity-ground';
import type { Primitive } from './entity-layer';
import { localFrame } from './entity-geometry';
import { cameraVolume } from './camera-volume';
import { computeEntity, cameraVolumePrimitives } from './entity-computation';
import type { EntityComputationResult } from './entity-computation';
import type { HeightAt } from './entity-geometry';
import { RasterElevationSampler } from './elevation-sampler';
import { RidgelineError } from './errors';
import type {
  ElevationSampler,
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
  private raster: RasterElevationSampler;
  private customGeneration = new AbortController();
  private preparing = new Map<string, Promise<void>>();
  private terrainTimer?: ReturnType<typeof setTimeout>;
  private gpu: GpuCameras;
  private displayedCameras = new Map<string, GpuCamera>();
  private gpuValues = new Map<string, GpuCamera[]>();
  private terrainPatches = new Map<string, { terrain: CameraTerrain; time: number }>();
  private gpuFailed = false;
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
    this.gpu = new GpuCameras(options.map, value => {
      const id = value.entityId;
      this.displayedCameras.set(JSON.stringify([id,value.camera.id]),value);
      this.renderLayers();
      const state = this.states.get(id);
      if (state && this.coverageReady(this.gpuValues.get(id) ?? [])) { state.coverage = 'ready'; options.changed([id]); }
    }, cause => {
      this.gpuFailed = true;
      options.diagnostic(new RidgelineError('UPDATE_FAILED', 'GPU camera visibility is unavailable.', {operation:'entities',recoverable:true},cause));
      this.invalidate();
    });
    this.raster = this.createSampler();
    if (!options.sampler) this.height.maximum = (west, south, east, north) => this.raster.maximum(west, south, east, north);
  }
  private createSampler() {
    return new RasterElevationSampler(
      this.options.configuration().elevation,
      () => { this.invalidate(); },
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
      this.gpuValues.delete(id); this.terrainPatches.delete(id);
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
        this.gpuValues.delete(feature.id); this.terrainPatches.delete(feature.id);
        this.features.delete(feature.id);
        this.states.delete(feature.id);
        this.positions.delete(feature.id);
        this.geometryDirty = this.geometry.delete(feature.id) || this.geometryDirty;
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
            if (a.type === 'camera' && !a.terrainVisibility) continue;
            const range =
              a.type === 'camera' ? a.range * 1.3 : a.type === 'polygon'
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
      for (const feature of features) if (feature.entity) this.preparing.set(feature.id, preparation);
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
            if (!this.terrainPatches.get(id)?.terrain.ready) this.terrainPatches.delete(id);
          }
          this.invalidate();
        });
    }
  }
  configure(elevationChanged = false) {
    if (elevationChanged) {
      this.terrainPatches.clear();
      this.raster.destroy();
      this.raster = this.createSampler();
      this.customGeneration.abort();
      this.customGeneration = new AbortController();
      this.preparing.clear();
    }
    this.invalidate();
  }
  retry() {
    this.terrainPatches.clear();
    this.gpuFailed = false;
    this.gpu.retry();
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
      offset: airborne ? (config.terrain ? (altitude - ground) * config.exaggeration : altitude) : 0,
    };
  }
  pick(x: number, y: number, tolerance: number) {
    return [...this.layer.pick(x, y, tolerance), ...this.groundLayer.pick(x, y, tolerance), ...this.gpu.pick(x, y)];
  }
  attach() {
    this.groundLayer.attach();
    this.gpu.attach();
    if (!this.options.map.getLayer(this.layer.id)) this.options.map.addLayer(this.layer);
    this.invalidate();
  }
  destroy() {
    clearTimeout(this.terrainTimer);
    this.gpu.destroy();
    this.terrainPatches.clear(); this.displayedCameras.clear();
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
    this.render();
    if (ids.length) this.options.changed(ids);
  }
  private build(feature: MapFeature<P>) {
    const input = { feature, configuration: this.options.configuration(), style: this.options.style(feature), selected: this.selected.has(feature.id) };
    const unavailable = () => this.options.sampler ? !this.preparing.has(feature.id) : this.raster.unavailable();
    const result = computeEntity(input, this.height, unavailable);
    const values: GpuCamera[] = [];
    if (!this.gpuFailed && result.state.placement === 'airborne' && result.state.altitude! > result.state.ground! + .01 && input.configuration.entityVisibility.footprints) {
      const cameras = feature.entity?.attachments?.flatMap(a => a.type === 'camera' && a.terrainVisibility ? [a] : []) ?? [];
      const range = Math.max(0, ...cameras.map(camera => camera.range));
      if (range > 0) {
        const now = performance.now(), cached = this.terrainPatches.get(feature.id);
        const terrain = cached && !cached.terrain.ready && now-cached.time<250 ? cached.terrain
          : cameraTerrain(result.position[0], result.position[1], range, this.height, cached?.terrain);
        if (!cached || terrain !== cached.terrain) {
          this.terrainPatches.set(feature.id, {terrain,time:now});
        }
        if (!terrain.ready && !this.options.sampler && !this.raster.unavailable() && !this.terrainTimer) this.terrainTimer = setTimeout(() => {
          this.terrainTimer=undefined; this.invalidate();
        },250);
        if (terrain.ready) {
          for (const camera of cameras) {
            const origin: [number,number,number]=[...result.position,result.state.altitude!];
            const volume=cameraVolume(origin,camera,terrain);
            values.push({entityId:feature.id,camera,origin,terrain,volume,
              geometry:cameraVolumePrimitives(feature.id,origin,camera,volume,input.configuration,terrain)});
          }
        }
        result.state.coverage = this.coverageReady(values) ? 'ready' : !terrain.ready && unavailable() ? 'unavailable' : 'loading';
      }
    }
    if (this.gpuFailed) result.state.coverage = 'unavailable';
    this.gpuValues.set(feature.id, values);
    this.apply(feature.id, result);
  }
  private coverageReady(values: readonly GpuCamera[]) {
    return values.length > 0 && values.every(value => {
      const displayed = this.displayedCameras.get(JSON.stringify([value.entityId, value.camera.id]));
      return displayed !== undefined && sameCamera(displayed, value);
    });
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
    const values=[...this.gpuValues.values()].flat();
    const retained=new Set(values.map(v=>JSON.stringify([v.entityId,v.camera.id])));
    for(const key of this.displayedCameras.keys())if(!retained.has(key))this.displayedCameras.delete(key);
    this.gpu.set(values);
    this.renderLayers();
  }
  private renderLayers() {
    const primitives = [...this.geometry.values()].flat().concat([...this.displayedCameras.values()].flatMap(v=>v.geometry));
    this.layer.set(primitives.filter(p => !p.surface));
    this.groundLayer.set(primitives.filter(p => p.surface));
  }
}
