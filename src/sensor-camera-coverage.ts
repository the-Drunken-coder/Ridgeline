import type { Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment, EntityState, MapConfiguration } from './types';
import type { GeoPoint } from './entity-geometry';
import { cameraVolume, plainCameraPrimitives, terrainCameraPrimitives } from './camera-volume';
import { cameraTerrain, cameraTerrainCovers, cameraTerrainHalfExtent, cameraTerrainPreparationBounds } from './gpu-camera-terrain';
import type { CameraTerrain } from './gpu-camera-terrain';
import type { EntityGeometry } from './entity-primitives';
import { GpuCameras, sameCamera, sameCameraAppearance } from './gpu-cameras';
import type { GpuCamera } from './gpu-cameras';
import { cameraAreaKey, placementAreaKey, type Elevation } from './elevation';
import type { ScreenRectangle } from './screen-rectangle';


/** The only rendering seam the coverage owner needs from the GPU adapter. */
export type SensorCameraAdapter = {
  set(values: GpuCamera[], retained?: readonly GpuCamera[]): void;
  attach(): void;
  pick(x: number, y: number): { entityId: string; attachmentId?: string }[];
  query?(rectangle: ScreenRectangle): { entityId: string; attachmentId?: string }[];
  retry(): void;
  destroy(): void;
};

export type SensorCameraAdapterFactory = (
  map: GLMap,
  completed: (value: GpuCamera, publish: () => void) => boolean,
  failed: (cause: unknown) => void,
) => SensorCameraAdapter;

export type SensorCameraInput = {
  entityId: string;
  origin: GeoPoint;
  ground: number;
  placement: EntityState['placement'];
  cameras: readonly CameraAttachment[];
  configuration: MapConfiguration;
};

export type SensorCameraOutput = {
  geometry: EntityGeometry;
  footprintTriangles: number;
  coverage: EntityState['coverage'];
};

type TerrainWork = {
  patch?: CameraTerrain;
  center?: readonly [number, number];
  revision?: number;
};
type TerrainReadiness =
  | { kind: 'ready'; terrain: CameraTerrain }
  | { kind: 'preparing' }
  | { kind: 'unavailable' };
type CameraPhase =
  | { kind: 'plain'; geometry?: EntityGeometry }
  | { kind: 'waiting'; shown?: GpuCamera; inFlight?: GpuCamera }
  | { kind: 'requested'; request: GpuCamera; shown?: GpuCamera }
  | { kind: 'displayed'; request: GpuCamera; shown: GpuCamera }
  | { kind: 'unavailable' };
type CameraState = { lifecycle: number; phase: CameraPhase };
type EntityCoverage = {
  input: SensorCameraInput;
  cameras: Map<string, CameraState>;
  terrain: Map<number, TerrainWork>;
};

function startCamera(terrainVisibility: boolean): CameraPhase {
  return terrainVisibility ? { kind: 'waiting' } : { kind: 'plain' };
}

function showPlainCamera(geometry?: EntityGeometry): CameraPhase {
  return { kind: 'plain', geometry };
}

function markUnavailable(): CameraPhase {
  return { kind: 'unavailable' };
}

function shown(phase: CameraPhase): GpuCamera | undefined {
  return phase.kind === 'waiting' || phase.kind === 'requested' || phase.kind === 'displayed'
    ? phase.shown : undefined;
}

function submitted(phase: CameraPhase): GpuCamera | undefined {
  if (phase.kind === 'waiting') return phase.inFlight;
  if (phase.kind === 'requested' || phase.kind === 'displayed') return phase.request;
}

function requestCamera(phase: CameraPhase, request: GpuCamera): CameraPhase {
  const previous = shown(phase);
  if (previous && sameCamera(previous, request)) return { kind: 'displayed', request, shown: previous };
  return { kind: 'requested', request, shown: previous };
}

function waitForCamera(phase: CameraPhase): CameraPhase {
  return { kind: 'waiting', shown: shown(phase), inFlight: submitted(phase) };
}

function discardCamera(phase: CameraPhase): CameraPhase {
  return { kind: 'waiting', shown: shown(phase) };
}

function completeCamera(phase: CameraPhase, value: GpuCamera): CameraPhase {
  if (phase.kind === 'waiting') return { ...phase, shown: value };
  if (phase.kind === 'requested' || phase.kind === 'displayed')
    return sameCamera(value, phase.request)
      ? { kind: 'displayed', request: phase.request, shown: value }
      : { kind: 'requested', request: phase.request, shown: value };
  return phase;
}

function restampCamera(phase: CameraPhase, lifecycle: number): CameraPhase {
  if (phase.kind === 'waiting') return {
    ...phase, inFlight: phase.inFlight && { ...phase.inFlight, lifecycle },
  };
  if (phase.kind === 'requested' || phase.kind === 'displayed')
    return { ...phase, request: { ...phase.request, lifecycle } };
  return phase;
}

/** Coordinates all sensor-camera display lifecycles while keeping GPU details private. */
export class SensorCameraCoverage {
  private readonly adapter: SensorCameraAdapter;
  private readonly entities = new Map<string, EntityCoverage>();
  private readonly requestedRanges = new Map<string, Map<number, readonly [number, number]>>();
  private lifecycleSequence = 0;
  private adapterDirty = false;
  private failed = false;
  private destroyed = false;

  constructor(
    private readonly options: {
      map: GLMap;
      elevation: Elevation;
      rendererDiagnostic: (cause: unknown) => void;
      changed: (entityId: string) => void;
      displayed?: (entityId: string) => void;
      publishStyle?: (publish: () => void) => void;
      adapter?: SensorCameraAdapterFactory;
    },
  ) {
    const factory = options.adapter ?? ((map, completed, failed) => new GpuCameras(map, completed, failed, options.publishStyle));
    this.adapter = factory(options.map, (value, publish) => this.complete(value, publish), cause => this.fail(cause));
  }

  /** Register camera terrain needs before the scene starts deferred elevation work. */
  requestAreas(entityId: string, center: readonly [number, number], cameras: readonly CameraAttachment[], visible: boolean) {
    const ranges = new Set(visible ? cameras.filter(camera => camera.terrainVisibility).map(camera => camera.range) : []);
    const previous = this.requestedRanges.get(entityId);
    for (const range of previous?.keys() ?? []) if (!ranges.has(range)) this.options.elevation.release(this.terrainKey(entityId, range));
    const next = new Map<number, readonly [number, number]>();
    const entity = this.entities.get(entityId);
    for (const range of ranges) {
      const requestedCenter = previous?.get(range);
      const patch = entity?.terrain.get(range)?.patch;
      if (requestedCenter && (requestedCenter[0] === center[0] && requestedCenter[1] === center[1] ||
        patch && cameraTerrainCovers(patch, center, range))) {
        next.set(range, requestedCenter);
        continue;
      }
      this.options.elevation.request(this.terrainKey(entityId, range), center, cameraTerrainHalfExtent(range),
        cameraTerrainPreparationBounds(center[0], center[1], range), range);
      next.set(range, [center[0], center[1]]);
    }
    if (ranges.size) this.requestedRanges.set(entityId, next);
    else this.requestedRanges.delete(entityId);
    if (entity) this.pruneTerrainWork(entity, ranges);
  }

  private terrainKey(entityId: string, range: number) {
    return cameraAreaKey(entityId, range);
  }

  update(input: SensorCameraInput): SensorCameraOutput {
    if (this.destroyed) return { geometry: { ground: [], airborne: [] }, footprintTriangles: 0, coverage: 'unavailable' };
    let entity = this.entities.get(input.entityId);
    if (!entity) {
      entity = { input, cameras: new Map(), terrain: new Map() };
      this.entities.set(input.entityId, entity);
    }
    entity.input = input;
    const visible = input.configuration.entityVisibility.footprints;
    const usable = input.placement === 'airborne' && input.origin[2] > input.ground + 0.01 && visible;
    const waitingForPlacement = input.placement === 'elevation-unavailable' && visible;
    const active = new Set((usable || waitingForPlacement) ? input.cameras.map(camera => camera.id) : []);
    for (const id of entity.cameras.keys()) if (!active.has(id)) entity.cameras.delete(id);
    for (const camera of input.cameras) if (active.has(camera.id)) {
      const state = entity.cameras.get(camera.id);
      if (!state) entity.cameras.set(camera.id, {
        lifecycle: ++this.lifecycleSequence,
        phase: startCamera(Boolean(camera.terrainVisibility)),
      });
      else if (Boolean(camera.terrainVisibility) === (state.phase.kind === 'plain')) {
        state.lifecycle = ++this.lifecycleSequence;
        state.phase = startCamera(Boolean(camera.terrainVisibility));
      }
    }
    const terrainRanges = usable || waitingForPlacement
      ? new Set(input.cameras.filter(camera => camera.terrainVisibility).map(camera => camera.range))
      : new Set<number>();
    this.requestAreas(input.entityId, [input.origin[0], input.origin[1]], input.cameras, usable || waitingForPlacement);
    this.pruneTerrainWork(entity, terrainRanges);
    let footprintTriangles = 0;

    if (usable) {
      for (const camera of input.cameras) {
        const state = entity.cameras.get(camera.id)!;
        if (camera.terrainVisibility) continue;
        const plain = plainCameraPrimitives(input.entityId, input.origin, input.ground, camera);
        state.phase = showPlainCamera(plain.geometry);
        footprintTriangles += plain.footprintTriangles;
      }
      this.updateTerrain(entity);
    } else if (waitingForPlacement) {
      this.updateTerrain(entity);
      if (this.options.elevation.readiness(placementAreaKey(input.entityId)) === 'unavailable') {
        for (const camera of input.cameras) if (!camera.terrainVisibility)
          entity.cameras.get(camera.id)!.phase = showPlainCamera();
      }
    }

    this.adapterDirty = true;
    return { geometry: this.output(input.entityId), footprintTriangles, coverage: this.coverageFor(entity) };
  }

  remove(entityId: string) {
    const entity = this.entities.get(entityId);
    this.entities.delete(entityId);
    this.requestAreas(entityId, [0, 0], [], false);
    if (entity) entity.terrain.clear();
    this.adapterDirty = true;
  }

  /** A failed required scene calculation invalidates completed and queued coverage. */
  unavailable(entityId: string) {
    const entity = this.entities.get(entityId);
    if (!entity || this.destroyed) return;
    entity.terrain.clear();
    for (const camera of entity.cameras.values()) {
      camera.lifecycle = ++this.lifecycleSequence;
      camera.phase = markUnavailable();
    }
    this.adapterDirty = true;
  }

  output(entityId: string): EntityGeometry {
    const entity = this.entities.get(entityId);
    const geometry: EntityGeometry = { ground: [], airborne: [] };
    if (entity) for (const { phase } of entity.cameras.values()) {
      if (phase.kind === 'plain') {
        if (phase.geometry) {
          geometry.ground.push(...phase.geometry.ground);
          geometry.airborne.push(...phase.geometry.airborne);
        }
      } else geometry.airborne.push(...shown(phase)?.geometry ?? []);
    }
    return geometry;
  }

  allGeometry(): EntityGeometry {
    const geometry = [...this.entities.keys()].map(entityId => this.output(entityId));
    return { ground: geometry.flatMap(value => value.ground), airborne: geometry.flatMap(value => value.airborne) };
  }

  status(entityId: string) {
    const entity = this.entities.get(entityId);
    return entity ? this.coverageFor(entity) : 'ready';
  }

  /** Invalidate queued adapter work while retaining the last displayed result. */
  invalidate(entityId?: string) {
    for (const [id, entity] of this.entities) {
      if (entityId !== undefined && id !== entityId) continue;
      for (const camera of entity.cameras.values()) {
        camera.lifecycle = ++this.lifecycleSequence;
        camera.phase = restampCamera(camera.phase, camera.lifecycle);
      }
    }
  }

  pick(x: number, y: number) {
    return this.adapter.pick(x, y);
  }
  query(rectangle: ScreenRectangle) {
    return this.adapter.query?.(rectangle) ?? [];
  }

  attach() {
    this.adapter.attach();
  }

  retry() {
    if (this.destroyed) return;
    this.failed = false;
    for (const entity of this.entities.values()) this.discardTerrain(entity);
    this.adapter.retry();
    for (const entityId of this.entities.keys()) this.options.changed(entityId);
  }

  resetElevation() {
    for (const [entityId, entity] of this.entities) {
      this.discardTerrain(entity);
      this.options.changed(entityId);
    }
  }

  private discardTerrain(entity: EntityCoverage) {
    entity.terrain.clear();
    for (const [id, camera] of entity.cameras) {
      // Keep the accepted display while refreshed terrain loads, but require a
      // newly built request before any result can publish or become ready.
      camera.lifecycle = ++this.lifecycleSequence;
      if (entity.input.cameras.some(input => input.id === id && input.terrainVisibility))
        camera.phase = this.failed ? markUnavailable() : discardCamera(camera.phase);
    }
    this.adapterDirty = true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entityId of this.requestedRanges.keys()) this.requestAreas(entityId, [0, 0], [], false);
    this.adapter.destroy();
    this.entities.clear();
  }

  private updateTerrain(entity: EntityCoverage) {
    const input = entity.input;
    for (const camera of input.cameras) {
      if (!camera.terrainVisibility) continue;
      const state = entity.cameras.get(camera.id)!;
      if (this.failed) {
        state.phase = markUnavailable();
        continue;
      }
      try {
        const readiness = this.terrainReadiness(entity, camera.range);
        if (readiness.kind !== 'ready') {
          state.phase = readiness.kind === 'unavailable'
            ? markUnavailable() : waitForCamera(state.phase);
          continue;
        }
        const terrain = readiness.terrain;
        const volume = cameraVolume(input.origin, camera, terrain);
        const request: GpuCamera = {
          entityId: input.entityId,
          camera,
          lifecycle: state.lifecycle,
          origin: input.origin,
          terrain,
          volume,
          geometry: terrainCameraPrimitives(input.entityId, input.origin, camera, volume, terrain),
        };
        state.phase = requestCamera(state.phase, request);
      } catch (cause) {
        state.phase = markUnavailable();
        this.options.rendererDiagnostic(cause);
      }
    }
  }

  /** Translate the current preparation and placement inputs into one camera answer. */
  private terrainReadiness(entity: EntityCoverage, range: number): TerrainReadiness {
    const terrain = this.terrainFor(entity, range);
    if (terrain.ready && entity.input.placement !== 'elevation-unavailable')
      return { kind: 'ready', terrain };
    return this.terrainUnavailable(entity, range, terrain.ready)
      ? { kind: 'unavailable' } : { kind: 'preparing' };
  }

  private terrainFor(entity: EntityCoverage, range: number) {
    const input = entity.input;
    let work = entity.terrain.get(range);
    if (!work) {
      work = {};
      entity.terrain.set(range, work);
    }
    const key = this.terrainKey(input.entityId, range);
    const revision = this.options.elevation.revision(key);
    const center: readonly [number, number] = [input.origin[0], input.origin[1]];
    if (!work.patch || work.revision !== revision || work.center?.[0] !== center[0] || work.center?.[1] !== center[1]) {
      // An incomplete patch is expensive to sample and only changes after
      // elevation does, movement, or a source reset.
      work.patch = cameraTerrain(center[0], center[1], range,
        this.options.elevation.sampling(), work.patch);
      work.center = center;
      work.revision = revision;
    }
    const terrain = work.patch;
    if (!terrain.ready)
      this.options.elevation.requirePreparation(key);
    return terrain;
  }

  private complete(value: GpuCamera, publish: () => void) {
    const entity = this.entities.get(value.entityId);
    const state = entity?.cameras.get(value.camera.id);
    const camera = entity?.input.cameras.find(camera => camera.id === value.camera.id);
    if (this.destroyed || this.failed || state?.lifecycle !== value.lifecycle
      || !submitted(state.phase) || !camera || !camera.terrainVisibility
      || !sameCameraAppearance(value, { camera })) return false;
    publish();
    state.phase = completeCamera(state.phase, value);
    if (entity) {
      this.options.displayed?.(value.entityId);
    }
    return true;
  }

  private fail(cause: unknown) {
    if (this.destroyed || this.failed) return;
    this.failed = true;
    for (const entity of this.entities.values()) {
      for (const camera of entity.cameras.values()) if (camera.phase.kind !== 'plain')
        camera.phase = markUnavailable();
    }
    this.options.rendererDiagnostic(cause);
    try { this.adapter.set([]); } catch { /* the adapter already reported the renderer failure */ }
    for (const entityId of this.entities.keys()) {
      this.options.changed(entityId);
    }
  }

  private coverageFor(entity: EntityCoverage) {
    const input = entity.input;
    const placementUnavailable = input.placement === 'elevation-unavailable';
    const placementReadiness = placementUnavailable
      ? this.options.elevation.readiness(placementAreaKey(input.entityId)) : undefined;
    if (!entity.cameras.size) return placementUnavailable && placementReadiness === 'unavailable' ? 'unavailable' : 'ready';
    let coverage: EntityState['coverage'] = 'ready';
    if (placementUnavailable && placementReadiness === 'loading') coverage = 'loading';
    for (const { phase } of entity.cameras.values()) {
      if (phase.kind === 'unavailable') return 'unavailable';
      if (phase.kind === 'waiting' || phase.kind === 'requested') coverage = 'loading';
    }
    return coverage === 'ready' && placementUnavailable && placementReadiness === 'unavailable'
      ? 'unavailable' : coverage;
  }

  private terrainUnavailable(entity: EntityCoverage, range: number, terrainReady: boolean) {
    if (entity.terrain.get(range)?.patch?.failed) return true;
    const cameraReadiness = this.options.elevation.readiness(this.terrainKey(entity.input.entityId, range));
    // A pending camera area can still supply an unknown center even when an
    // earlier placement request has settled without data.
    if (cameraReadiness === 'loading') return false;
    if (entity.input.placement === 'elevation-unavailable' &&
      this.options.elevation.readiness(placementAreaKey(entity.input.entityId)) === 'unavailable') return true;
    return !terrainReady;
  }

  private pruneTerrainWork(entity: EntityCoverage, ranges: ReadonlySet<number>) {
    for (const range of entity.terrain.keys()) if (!ranges.has(range)) {
      entity.terrain.delete(range);
    }
  }

  /** Submit once after the scene has applied its complete batch of changes. */
  flush() {
    if (this.destroyed || !this.adapterDirty) return;
    this.adapterDirty = false;
    const requested: GpuCamera[] = [];
    const retained: GpuCamera[] = [];
    if (!this.failed) for (const entity of this.entities.values()) for (const camera of entity.cameras.values()) {
      const request = submitted(camera.phase);
      if (request) requested.push(request);
      else {
        const previous = shown(camera.phase);
        if (previous) retained.push(previous);
      }
    }
    try { this.adapter.set(requested, retained); }
    catch (cause) { this.fail(cause); }
  }
}
