import type { Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment, EntityState, MapConfiguration } from './types';
import type { HeightAt, GeoPoint } from './entity-geometry';
import { cameraFootprint, cameraRay, localFrame } from './entity-geometry';
import { cameraVolume, visibleCameraEdges } from './camera-volume';
import { cameraTerrain, cameraTerrainPreparationBounds } from './gpu-camera-terrain';
import type { CameraTerrain } from './gpu-camera-terrain';
import type { Primitive } from './entity-layer';
import { GpuCameras, sameCamera, sameCameraAppearance } from './gpu-cameras';
import type { GpuCamera } from './gpu-cameras';
import { parseColor } from './color';

type Color = Primitive['color'];

/** The only rendering seam the coverage owner needs from the GPU adapter. */
export type SensorCameraAdapter = {
  set(values: GpuCamera[], retained?: readonly GpuCamera[]): void;
  attach(): void;
  pick(x: number, y: number): { entityId: string; attachmentId?: string }[];
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
  elevationUnavailable: boolean;
  /** Shared placement/attachment preparation; camera ranges are owned here. */
  elevationPreparing: boolean;
};

export type SensorCameraOutput = {
  geometry: Primitive[];
  footprintTriangles: number;
  coverage: EntityState['coverage'];
};

type Displayed = { geometry: Primitive[]; terrain: boolean; value?: GpuCamera };
type TerrainPatch = { terrain: CameraTerrain; time: number };

type TerrainWork = {
  patch?: TerrainPatch;
  preparing?: AbortController;
  settled?: [number, number];
};
type CameraState = {
  lifecycle: number;
  requested?: GpuCamera;
  displayed?: Displayed;
  terrainPending: boolean;
  computationFailed?: boolean;
};
type EntityCoverage = {
  input: SensorCameraInput;
  cameras: Map<string, CameraState>;
  terrain: Map<number, TerrainWork>;
  status: EntityState['coverage'];
  timer?: ReturnType<typeof setTimeout>;
};

function plainCameraPrimitives(
  entityId: string,
  origin: GeoPoint,
  ground: number,
  camera: CameraAttachment,
  configuration: MapConfiguration,
): { geometry: Primitive[]; footprintTriangles: number } {
  const rgba = parseColor(camera.color ?? '#288b59', 0.22);
  const display = (point: GeoPoint): GeoPoint => [
    point[0],
    point[1],
    configuration.terrain ? point[2] * configuration.exaggeration : point[2],
  ];
  const geometry: Primitive[] = [];
  const add = (
    vertices: GeoPoint[],
    mode: Primitive['mode'],
    value: Color,
    surface = false,
    size?: number,
  ) => {
    if (!vertices.length) return;
    geometry.push({
      entityId,
      attachmentId: camera.id,
      mode,
      vertices: surface ? vertices : vertices.map(display),
      color: value,
      size,
      surface,
    });
  };

  const footprint = cameraFootprint(origin, camera, ground);
  if ((camera.volumeOpacity ?? 0) > 0 || camera.wireframe) {
    const local = localFrame(origin);
    const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) => {
      const ray = cameraRay(camera, x, y);
      const distance = ray[2] < 0
        ? Math.min(camera.range, (origin[2] - ground) / -ray[2])
        : camera.range;
      return local(ray[0] * distance, ray[1] * distance, ray[2] * distance);
    });
    const faces: GeoPoint[] = [];
    const rays: GeoPoint[] = [];
    corners.forEach((a, index) => {
      const b = corners[(index + 1) % corners.length]!;
      faces.push(origin, a, b);
      rays.push(origin, a, a, b);
    });
    if ((camera.volumeOpacity ?? 0) > 0)
      add(faces, 'triangles', [rgba[0], rgba[1], rgba[2], camera.volumeOpacity!]);
    if (camera.wireframe)
      add(rays, 'lines', parseColor('#8bab97', 1), false, camera.wireframeWidth ?? 3);
  }
  if (footprint.length) {
    add(footprint, 'polygon', [rgba[0], rgba[1], rgba[2], camera.fillOpacity ?? 0.25], true);
    if (camera.outline ?? true)
      add(
        footprint.flatMap((point, index) => [point, footprint[(index + 1) % footprint.length]!]),
        'lines',
        [rgba[0], rgba[1], rgba[2], 0.95],
        true,
        camera.outlineWidth ?? 3,
      );
  }
  return { geometry, footprintTriangles: footprint.length ? 2 : 0 };
}

function cameraVolumePrimitives(
  entityId: string,
  origin: GeoPoint,
  camera: CameraAttachment,
  volume: ReturnType<typeof cameraVolume>,
  configuration: MapConfiguration,
  terrain: CameraTerrain,
): Primitive[] {
  const display = (point: GeoPoint): GeoPoint => [
    point[0],
    point[1],
    configuration.terrain ? point[2] * configuration.exaggeration : point[2],
  ];
  const faces: GeoPoint[] = [];
  volume.corners.forEach((a, index) => {
    const b = volume.corners[(index + 1) % 4]!;
    faces.push(origin, a, b);
  });
  const geometry: Primitive[] = [];
  if ((camera.volumeOpacity ?? 0) > 0)
    geometry.push({
      entityId,
      attachmentId: camera.id,
      mode: 'triangles',
      vertices: faces.map(display),
      color: parseColor(camera.color ?? '#288b59', camera.volumeOpacity!),
    });
  if (camera.wireframe)
    geometry.push({
      entityId,
      attachmentId: camera.id,
      mode: 'lines',
      vertices: visibleCameraEdges(origin, volume, terrain).map(display),
      color: parseColor('#8bab97', 1),
      size: camera.wireframeWidth ?? 3,
    });
  return geometry;
}

/** Coordinates all sensor-camera display lifecycles while keeping GPU details private. */
export class SensorCameraCoverage {
  private readonly adapter: SensorCameraAdapter;
  private readonly entities = new Map<string, EntityCoverage>();
  private lifecycleSequence = 0;
  private adapterDirty = false;
  private failed = false;
  private destroyed = false;

  constructor(
    private readonly options: {
      map: GLMap;
      height: HeightAt;
      prepare?: (positions: readonly [number, number][], signal: AbortSignal) => Promise<void>;
      diagnostic: (cause: unknown) => void;
      rendererDiagnostic?: (cause: unknown) => void;
      changed: (entityId: string) => void;
      displayed?: (entityId: string) => void;
      elevationUnavailable: () => boolean;
      pollTerrain?: boolean;
      adapter?: SensorCameraAdapterFactory;
    },
  ) {
    const factory = options.adapter ?? ((map, completed, failed) => new GpuCameras(map, completed, failed));
    this.adapter = factory(options.map, (value, publish) => this.complete(value, publish), cause => this.fail(cause));
  }

  update(input: SensorCameraInput): SensorCameraOutput {
    if (this.destroyed) return { geometry: [], footprintTriangles: 0, coverage: 'unavailable' };
    let entity = this.entities.get(input.entityId);
    if (!entity) {
      entity = { input, cameras: new Map(), terrain: new Map(), status: 'ready' };
      this.entities.set(input.entityId, entity);
    }
    entity.input = input;
    const visible = input.configuration.entityVisibility.footprints;
    const usable = input.placement === 'airborne' && input.origin[2] > input.ground + 0.01 && visible;
    const waitingForPlacement = input.placement === 'elevation-unavailable' && visible;
    const active = new Set((usable || waitingForPlacement) ? input.cameras.map(camera => camera.id) : []);
    for (const id of entity.cameras.keys()) if (!active.has(id)) entity.cameras.delete(id);
    for (const id of active) if (!entity.cameras.has(id)) {
      entity.cameras.set(id, { lifecycle: ++this.lifecycleSequence, terrainPending: false });
    }
    const terrainRanges = usable || waitingForPlacement
      ? new Set(input.cameras.filter(camera => camera.terrainVisibility).map(camera => camera.range))
      : new Set<number>();
    this.pruneTerrainWork(entity, terrainRanges);
    let footprintTriangles = 0;

    if (usable) {
      for (const camera of input.cameras) {
        const state = entity.cameras.get(camera.id)!;
        if (camera.terrainVisibility) {
          // Switching to terrain visibility must not retain the plain geometry
          // while the first terrain mask is pending.
          if (!state.displayed?.terrain) state.displayed = undefined;
          continue;
        }
        state.requested = undefined;
        state.terrainPending = false;
        const plain = plainCameraPrimitives(input.entityId, input.origin, input.ground, camera, input.configuration);
        state.displayed = { geometry: plain.geometry, terrain: false };
        footprintTriangles += plain.footprintTriangles;
      }
      this.updateTerrain(entity);
    } else if (waitingForPlacement) {
      this.updateTerrain(entity);
      if (input.elevationUnavailable && !this.isPreparing(input.entityId)) {
        for (const camera of input.cameras) if (!camera.terrainVisibility)
          entity.cameras.get(camera.id)!.displayed = undefined;
      }
    }

    this.adapterDirty = true;
    entity.status = this.coverageFor(entity);
    return { geometry: this.output(input.entityId), footprintTriangles, coverage: entity.status };
  }

  remove(entityId: string) {
    const entity = this.entities.get(entityId);
    this.entities.delete(entityId);
    if (entity) this.clearTerrainWork(entity);
    this.adapterDirty = true;
  }

  output(entityId: string): Primitive[] {
    const entity = this.entities.get(entityId);
    return entity ? [...entity.cameras.values()].flatMap(camera => camera.displayed?.geometry ?? []) : [];
  }

  allGeometry(): Primitive[] {
    return [...this.entities.keys()].flatMap(entityId => this.output(entityId));
  }

  status(entityId: string) {
    return this.entities.get(entityId)?.status ?? 'ready';
  }

  isPreparing(entityId: string) {
    const entity = this.entities.get(entityId);
    return entity ? [...entity.terrain.values()].some(work => work.preparing !== undefined) : false;
  }

  /** Invalidate queued adapter work while retaining the last displayed result. */
  invalidate(entityId?: string) {
    for (const [id, entity] of this.entities) {
      if (entityId !== undefined && id !== entityId) continue;
      for (const camera of entity.cameras.values()) {
        camera.lifecycle = ++this.lifecycleSequence;
        if (camera.requested) camera.requested = { ...camera.requested, lifecycle: camera.lifecycle };
      }
    }
  }

  pick(x: number, y: number) {
    return this.adapter.pick(x, y);
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

  elevationChanged() {
    for (const [entityId, entity] of this.entities) {
      if (!entity.terrain.size) continue;
      for (const work of entity.terrain.values()) {
        if (work.patch && !work.patch.terrain.ready) {
          work.patch = undefined;
          work.settled = undefined;
        }
      }
      if (!this.destroyed) this.options.changed(entityId);
    }
  }

  resetElevation() {
    for (const [entityId, entity] of this.entities) {
      this.discardTerrain(entity);
      if (!this.destroyed) this.options.changed(entityId);
    }
  }

  private discardTerrain(entity: EntityCoverage) {
    this.clearTerrainWork(entity);
    for (const [id, camera] of entity.cameras) {
      // Keep the accepted display while refreshed terrain loads, but require a
      // newly built request before any result can publish or become ready.
      camera.lifecycle = ++this.lifecycleSequence;
      camera.requested = undefined;
      camera.terrainPending = entity.input.cameras.some(input => input.id === id && input.terrainVisibility);
    }
    entity.status = !this.failed && [...entity.cameras.values()].some(camera => camera.terrainPending)
      ? 'loading' : this.coverageFor(entity);
    this.adapterDirty = true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entity of this.entities.values()) this.clearTerrainWork(entity);
    this.adapter.destroy();
    this.entities.clear();
  }

  private updateTerrain(entity: EntityCoverage) {
    const input = entity.input;
    for (const camera of input.cameras) {
      if (!camera.terrainVisibility) continue;
      const state = entity.cameras.get(camera.id)!;
      let terrain: CameraTerrain;
      try {
        terrain = this.terrainFor(entity, camera.range);
        if (terrain.ready && input.placement !== 'elevation-unavailable') {
          const volume = cameraVolume(input.origin, camera, terrain);
          state.requested = {
            entityId: input.entityId,
            camera,
            lifecycle: state.lifecycle,
            origin: input.origin,
            terrain,
            volume,
            geometry: cameraVolumePrimitives(input.entityId, input.origin, camera, volume, input.configuration, terrain),
          };
        }
        state.computationFailed = false;
      } catch (cause) {
        state.computationFailed = true;
        state.terrainPending = false;
        state.displayed = undefined;
        state.requested = undefined;
        this.options.diagnostic(cause);
        continue;
      }
      if (!terrain.ready || input.placement === 'elevation-unavailable') {
        state.terrainPending = true;
        if (this.terrainUnavailable(entity, camera.range)) {
          state.displayed = undefined;
          state.requested = undefined;
        }
        continue;
      }
      state.terrainPending = false;
    }
  }

  private terrainFor(entity: EntityCoverage, range: number) {
    const input = entity.input;
    let work = entity.terrain.get(range);
    if (!work) {
      work = {};
      entity.terrain.set(range, work);
    }
    const cached = work.patch;
    const now = performance.now();
    if (work.settled && (work.settled[0] !== input.origin[0] || work.settled[1] !== input.origin[1])) {
      work.settled = undefined;
    }
    const terrain = cached && !cached.terrain.ready && now - cached.time < 250
      ? cached.terrain
      : cameraTerrain(input.origin[0], input.origin[1], range, this.options.height, cached?.terrain);
    if (!cached || terrain !== cached.terrain) work.patch = { terrain, time: now };
    if (!terrain.ready || input.placement === 'elevation-unavailable') {
      // A reusable patch says nothing about the current center sample. Resolve
      // placement before constructing a request, even when this patch is ready.
      if (!input.elevationPreparing) this.requestPreparation(entity, range, work);
      if (this.options.pollTerrain !== false && !terrain.failed && !this.options.prepare && !entity.timer) {
        entity.timer = setTimeout(() => {
          entity.timer = undefined;
          if (!this.destroyed) this.options.changed(input.entityId);
        }, 250);
      }
    }
    return terrain;
  }

  private requestPreparation(entity: EntityCoverage, range: number, work: TerrainWork) {
    if (!this.options.prepare || work.preparing || work.settled) return;
    const input = entity.input;
    const origin: [number, number] = [input.origin[0], input.origin[1]];
    const positions: [number, number][] = [origin];
    const [west, south, east, north] = cameraTerrainPreparationBounds(origin[0], origin[1], range);
    const bounded = (lng: number) => ((lng + 180) % 360 + 360) % 360 - 180;
    for (const lng of [west, origin[0], east]) for (const lat of [south, origin[1], north])
      positions.push([bounded(lng), lat]);
    // A range may serve several cameras. Cancel its work only when no active
    // camera needs it, without aborting another entity or range's preparation.
    const controller = new AbortController();
    work.preparing = controller;
    void Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return this.options.prepare!(positions, controller.signal);
      })
      .catch(cause => {
        if (!controller.signal.aborted) this.options.diagnostic(cause);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        work.preparing = undefined;
        work.settled = origin;
        if (work.patch) work.patch.time = 0;
        if (!this.destroyed) this.options.changed(input.entityId);
      });
  }

  private complete(value: GpuCamera, publish: () => void) {
    const entity = this.entities.get(value.entityId);
    const state = entity?.cameras.get(value.camera.id);
    const camera = entity?.input.cameras.find(camera => camera.id === value.camera.id);
    if (this.destroyed || this.failed || state?.lifecycle !== value.lifecycle || !state.requested || !camera || !sameCameraAppearance(value, { camera })) return false;
    publish();
    state.displayed = { geometry: value.geometry, terrain: true, value };
    if (entity) {
      entity.status = this.coverageFor(entity);
      this.options.displayed?.(value.entityId);
    }
    return true;
  }

  private fail(cause: unknown) {
    if (this.destroyed || this.failed) return;
    this.failed = true;
    for (const entity of this.entities.values()) {
      for (const camera of entity.cameras.values()) if (camera.displayed?.terrain) camera.displayed = undefined;
    }
    (this.options.rendererDiagnostic ?? this.options.diagnostic)(cause);
    try { this.adapter.set([]); } catch { /* the adapter already reported the renderer failure */ }
    for (const [entityId, entity] of this.entities) {
      entity.status = this.coverageFor(entity);
      this.options.changed(entityId);
    }
  }

  private coverageFor(entity: EntityCoverage) {
    const input = entity.input;
    if (!entity.cameras.size) return input.elevationUnavailable && input.placement === 'elevation-unavailable' ? 'unavailable' : 'ready';
    let coverage: EntityState['coverage'] = 'ready';
    if (input.placement === 'elevation-unavailable' && input.elevationPreparing) coverage = 'loading';
    for (const camera of input.cameras) {
      const state = entity.cameras.get(camera.id);
      if (!camera.terrainVisibility || !state) continue;
      const preparing = entity.terrain.get(camera.range)?.preparing !== undefined;
      if (this.failed || state.computationFailed || input.elevationUnavailable &&
        (input.placement === 'elevation-unavailable' || !this.options.height.forRange) &&
        !preparing && !state.requested && !state.terrainPending) return 'unavailable';
      if (state.terrainPending) {
        if (this.terrainUnavailable(entity, camera.range)) return 'unavailable';
        coverage = 'loading';
      } else if (state.requested && (!state.displayed?.value || !sameCamera(state.displayed.value, state.requested))) coverage = 'loading';
      else if (!state.requested && !state.displayed) {
        if (input.elevationUnavailable && (input.placement === 'elevation-unavailable' || !this.options.height.forRange)) return 'unavailable';
        coverage = 'loading';
      }
    }
    return coverage;
  }

  private terrainUnavailable(entity: EntityCoverage, range: number) {
    const work = entity.terrain.get(range);
    if (work?.preparing) return false;
    // A successful cached patch cannot settle a later placement preparation.
    if (work?.patch?.terrain.ready && entity.input.elevationPreparing) return false;
    // One settled range must not wait for an unrelated camera's preparation.
    return Boolean(work?.patch?.terrain.failed || work?.settled ||
      (this.options.pollTerrain === false && !this.options.prepare && !entity.input.elevationPreparing && work?.patch && !work.patch.terrain.ready) ||
      entity.input.elevationUnavailable &&
      (entity.input.placement === 'elevation-unavailable' || !this.options.height.forRange));
  }

  private clearTerrainWork(entity: EntityCoverage) {
    this.pruneTerrainWork(entity, new Set());
  }

  private pruneTerrainWork(entity: EntityCoverage, ranges: ReadonlySet<number>) {
    for (const [range, work] of entity.terrain) if (!ranges.has(range)) {
      entity.terrain.delete(range);
      work.preparing?.abort();
    }
    if (!ranges.size) {
      clearTimeout(entity.timer);
      entity.timer = undefined;
    }
  }

  /** Submit once after the scene has applied its complete batch of changes. */
  flush() {
    if (this.destroyed || !this.adapterDirty) return;
    this.adapterDirty = false;
    const requested: GpuCamera[] = [];
    const retained: GpuCamera[] = [];
    if (!this.failed) for (const entity of this.entities.values()) for (const camera of entity.cameras.values()) {
      if (camera.requested) requested.push(camera.requested);
      else if (camera.displayed?.value) retained.push(camera.displayed.value);
    }
    try { this.adapter.set(requested, retained); }
    catch (cause) { this.fail(cause); }
  }
}
