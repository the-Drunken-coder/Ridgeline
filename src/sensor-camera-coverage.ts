import { MercatorCoordinate, type Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment, EntityState, MapConfiguration } from './types';
import type { GeoPoint } from './entity-geometry';
import { cameraFootprint, cameraRay, localFrame } from './entity-geometry';
import { cameraVolume, visibleCameraEdges } from './camera-volume';
import { cameraTerrain, cameraTerrainPreparationBounds } from './gpu-camera-terrain';
import type { CameraTerrain } from './gpu-camera-terrain';
import type { Primitive } from './entity-layer';
import { GpuCameras, sameCamera, sameCameraAppearance } from './gpu-cameras';
import type { GpuCamera } from './gpu-cameras';
import { parseColor } from './color';
import { cameraAreaKey, placementAreaKey, type Elevation } from './elevation';

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
};

export type SensorCameraOutput = {
  geometry: Primitive[];
  footprintTriangles: number;
  coverage: EntityState['coverage'];
};

type Displayed = { geometry: Primitive[]; terrain: boolean; value?: GpuCamera };
type TerrainWork = {
  patch?: CameraTerrain;
  center?: readonly [number, number];
  revision?: number;
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
      adapter?: SensorCameraAdapterFactory;
    },
  ) {
    const factory = options.adapter ?? ((map, completed, failed) => new GpuCameras(map, completed, failed));
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
        patch?.ready && this.patchCovers(patch, center, range))) {
        next.set(range, requestedCenter);
        continue;
      }
      this.options.elevation.request(this.terrainKey(entityId, range), center, range * 1.3,
        cameraTerrainPreparationBounds(center[0], center[1], range));
      next.set(range, [center[0], center[1]]);
    }
    if (ranges.size) this.requestedRanges.set(entityId, next);
    else this.requestedRanges.delete(entityId);
    if (entity) this.pruneTerrainWork(entity, ranges);
  }

  private patchCovers(patch: CameraTerrain, center: readonly [number, number], range: number) {
    const point = MercatorCoordinate.fromLngLat([center[0], center[1]]);
    let dx = point.x - patch.centre.x;
    dx -= Math.round(dx);
    const distance = Math.max(Math.abs(dx), Math.abs(point.y - patch.centre.y)) / patch.scale;
    return distance + range <= patch.half && patch.half <= range * 2;
  }

  private terrainKey(entityId: string, range: number) {
    return cameraAreaKey(entityId, range);
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
    this.requestAreas(input.entityId, [input.origin[0], input.origin[1]], input.cameras, usable || waitingForPlacement);
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
      if (this.options.elevation.readiness(placementAreaKey(input.entityId)) === 'unavailable') {
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
    this.requestAreas(entityId, [0, 0], [], false);
    if (entity) entity.terrain.clear();
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

  private discardTerrain(entity: EntityCoverage) {
    entity.terrain.clear();
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
    for (const entityId of this.requestedRanges.keys()) this.requestAreas(entityId, [0, 0], [], false);
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
        this.options.rendererDiagnostic(cause);
        continue;
      }
      if (!terrain.ready || input.placement === 'elevation-unavailable') {
        state.terrainPending = true;
        if (this.terrainUnavailable(entity, camera.range, terrain.ready)) {
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
    this.options.rendererDiagnostic(cause);
    try { this.adapter.set([]); } catch { /* the adapter already reported the renderer failure */ }
    for (const [entityId, entity] of this.entities) {
      entity.status = this.coverageFor(entity);
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
    for (const camera of input.cameras) {
      const state = entity.cameras.get(camera.id);
      if (!camera.terrainVisibility || !state) continue;
      if (this.failed || state.computationFailed) return 'unavailable';
      if (state.terrainPending) {
        if (this.terrainUnavailable(entity, camera.range, entity.terrain.get(camera.range)?.patch?.ready ?? false)) return 'unavailable';
        coverage = 'loading';
      } else if (state.requested && (!state.displayed?.value || !sameCamera(state.displayed.value, state.requested))) coverage = 'loading';
      else if (!state.requested && !state.displayed) {
        if (placementUnavailable && placementReadiness === 'unavailable') return 'unavailable';
        coverage = 'loading';
      }
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
      if (camera.requested) requested.push(camera.requested);
      else if (camera.displayed?.value) retained.push(camera.displayed.value);
    }
    try { this.adapter.set(requested, retained); }
    catch (cause) { this.fail(cause); }
  }
}
