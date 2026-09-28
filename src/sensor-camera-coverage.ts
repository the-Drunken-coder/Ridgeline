import type { Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment, EntityState, MapConfiguration } from './types';
import type { HeightAt, GeoPoint } from './entity-geometry';
import { cameraFootprint, cameraRay, localFrame } from './entity-geometry';
import { cameraVolume, visibleCameraEdges } from './camera-volume';
import { cameraTerrain } from './gpu-camera-terrain';
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

type TerrainPatch = { terrain: CameraTerrain; time: number };

type TerrainWork = {
  patch?: TerrainPatch;
  preparing?: AbortController;
  settled?: [number, number];
};
type TerrainReadiness =
  | { kind: 'ready'; terrain: CameraTerrain }
  | { kind: 'preparing' }
  | { kind: 'unavailable' };
type CameraPhase =
  | { kind: 'plain'; geometry?: Primitive[] }
  | { kind: 'waiting'; shown?: GpuCamera; inFlight?: GpuCamera }
  | { kind: 'requested'; request: GpuCamera; shown?: GpuCamera }
  | { kind: 'displayed'; request: GpuCamera; shown: GpuCamera }
  | { kind: 'unavailable' };
type CameraState = { lifecycle: number; phase: CameraPhase };
type EntityCoverage = {
  input: SensorCameraInput;
  cameras: Map<string, CameraState>;
  terrain: Map<number, TerrainWork>;
  timer?: ReturnType<typeof setTimeout>;
};

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
        phase: camera.terrainVisibility ? { kind: 'waiting' } : { kind: 'plain' },
      });
      else if (camera.terrainVisibility === (state.phase.kind === 'plain')) {
        state.lifecycle = ++this.lifecycleSequence;
        state.phase = camera.terrainVisibility ? { kind: 'waiting' } : { kind: 'plain' };
      }
    }
    const terrainRanges = usable || waitingForPlacement
      ? new Set(input.cameras.filter(camera => camera.terrainVisibility).map(camera => camera.range))
      : new Set<number>();
    this.pruneTerrainWork(entity, terrainRanges);
    let footprintTriangles = 0;

    if (usable) {
      for (const camera of input.cameras) {
        const state = entity.cameras.get(camera.id)!;
        if (camera.terrainVisibility) continue;
        const plain = plainCameraPrimitives(input.entityId, input.origin, input.ground, camera, input.configuration);
        state.phase = { kind: 'plain', geometry: plain.geometry };
        footprintTriangles += plain.footprintTriangles;
      }
      this.updateTerrain(entity);
    } else if (waitingForPlacement) {
      this.updateTerrain(entity);
      if (input.elevationUnavailable && !this.isPreparing(input.entityId)) {
        for (const camera of input.cameras) if (!camera.terrainVisibility)
          entity.cameras.get(camera.id)!.phase = { kind: 'plain' };
      }
    }

    this.adapterDirty = true;
    return { geometry: this.output(input.entityId), footprintTriangles, coverage: this.coverageFor(entity) };
  }

  remove(entityId: string) {
    const entity = this.entities.get(entityId);
    this.entities.delete(entityId);
    if (entity) this.clearTerrainWork(entity);
    this.adapterDirty = true;
  }

  output(entityId: string): Primitive[] {
    const entity = this.entities.get(entityId);
    return entity ? [...entity.cameras.values()].flatMap(camera => camera.phase.kind === 'plain'
      ? camera.phase.geometry ?? [] : shown(camera.phase)?.geometry ?? []) : [];
  }

  allGeometry(): Primitive[] {
    return [...this.entities.keys()].flatMap(entityId => this.output(entityId));
  }

  status(entityId: string) {
    const entity = this.entities.get(entityId);
    return entity ? this.coverageFor(entity) : 'ready';
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
        camera.phase = restampCamera(camera.phase, camera.lifecycle);
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
      if (entity.input.cameras.some(input => input.id === id && input.terrainVisibility))
        camera.phase = { kind: 'waiting', shown: shown(camera.phase) };
    }
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
      if (this.failed) {
        state.phase = { kind: 'unavailable' };
        continue;
      }
      const readiness = this.terrainReadiness(entity, camera.range);
      if (readiness.kind !== 'ready') {
        state.phase = readiness.kind === 'unavailable'
          ? { kind: 'unavailable' } : waitForCamera(state.phase);
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
        geometry: cameraVolumePrimitives(input.entityId, input.origin, camera, volume, input.configuration, terrain),
      };
      state.phase = requestCamera(state.phase, request);
    }
  }

  /** Translate the current preparation and placement inputs into one camera answer. */
  private terrainReadiness(entity: EntityCoverage, range: number): TerrainReadiness {
    const terrain = this.terrainFor(entity, range);
    if (terrain.ready && entity.input.placement !== 'elevation-unavailable')
      return { kind: 'ready', terrain };
    return this.terrainUnavailable(entity, range)
      ? { kind: 'unavailable' } : { kind: 'preparing' };
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
      if (this.options.pollTerrain !== false && !this.options.elevationUnavailable() && !this.options.prepare && !entity.timer) {
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
    const local = localFrame([...origin, 0]);
    const positions: [number, number][] = [origin];
    const margin = range * 1.3;
    for (const x of [-margin, 0, margin]) for (const y of [-margin, 0, margin]) {
      const point = local(x, y, 0);
      positions.push([point[0], point[1]]);
    }
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
        camera.phase = { kind: 'unavailable' };
    }
    (this.options.rendererDiagnostic ?? this.options.diagnostic)(cause);
    try { this.adapter.set([]); } catch { /* the adapter already reported the renderer failure */ }
    for (const entityId of this.entities.keys()) {
      this.options.changed(entityId);
    }
  }

  private coverageFor(entity: EntityCoverage) {
    const input = entity.input;
    if (!entity.cameras.size) return input.elevationUnavailable && input.placement === 'elevation-unavailable' ? 'unavailable' : 'ready';
    let coverage: EntityState['coverage'] = 'ready';
    if (input.placement === 'elevation-unavailable' && input.elevationPreparing) coverage = 'loading';
    for (const { phase } of entity.cameras.values()) {
      if (phase.kind === 'unavailable') return 'unavailable';
      if (phase.kind === 'waiting' || phase.kind === 'requested') coverage = 'loading';
    }
    return coverage;
  }

  private terrainUnavailable(entity: EntityCoverage, range: number) {
    const work = entity.terrain.get(range);
    if (work?.preparing) return false;
    // A successful cached patch cannot settle a later placement preparation.
    if (work?.patch?.terrain.ready && entity.input.elevationPreparing) return false;
    // One settled range must not wait for an unrelated camera's preparation.
    return Boolean(work?.settled) || entity.input.elevationUnavailable;
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
