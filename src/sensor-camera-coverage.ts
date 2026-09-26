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

type Color = Primitive['color'];

/** The only rendering seam the coverage owner needs from the GPU adapter. */
export type SensorCameraAdapter = {
  set(values: GpuCamera[]): void;
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
  elevationPreparing: boolean;
};

export type SensorCameraOutput = {
  geometry: Primitive[];
  footprintTriangles: number;
  coverage: EntityState['coverage'];
};

type Displayed = { geometry: Primitive[]; terrain: boolean; value?: GpuCamera };
type TerrainPatch = { terrain: CameraTerrain; time: number };

const keyOf = (entityId: string, cameraId: string) => JSON.stringify([entityId, cameraId]);
const patchKeyOf = (entityId: string, range: number) => JSON.stringify([entityId, range]);
const belongsTo = (key: string, entityId: string) => {
  try { return JSON.parse(key)[0] === entityId; } catch { return false; }
};
const colors = new Map<string, Color>();

function color(css: string, opacity: number): Color {
  const key = `${css}:${opacity}`;
  const cached = colors.get(key);
  if (cached) return cached;
  const context = new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) return [0.13, 0.43, 0.36, opacity];
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const p = context.getImageData(0, 0, 1, 1).data;
  const result: Color = [p[0]! / 255, p[1]! / 255, p[2]! / 255, opacity];
  colors.set(key, result);
  return result;
}

function plainCameraPrimitives(
  entityId: string,
  origin: GeoPoint,
  ground: number,
  camera: CameraAttachment,
  configuration: MapConfiguration,
): { geometry: Primitive[]; footprintTriangles: number } {
  const rgba = color(camera.color ?? '#288b59', 0.22);
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
      add(rays, 'lines', color('#8bab97', 1), false, camera.wireframeWidth ?? 3);
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
      color: color(camera.color ?? '#288b59', camera.volumeOpacity!),
    });
  if (camera.wireframe)
    geometry.push({
      entityId,
      attachmentId: camera.id,
      mode: 'lines',
      vertices: visibleCameraEdges(origin, volume, terrain).map(display),
      color: color('#8bab97', 1),
      size: camera.wireframeWidth ?? 3,
    });
  return geometry;
}

/** Coordinates all sensor-camera display lifecycles while keeping GPU details private. */
export class SensorCameraCoverage {
  private readonly adapter: SensorCameraAdapter;
  private readonly entities = new Map<string, SensorCameraInput>();
  private readonly terrainPatches = new Map<string, Map<number, TerrainPatch>>();
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly requested = new Map<string, GpuCamera>();
  private readonly displayed = new Map<string, Displayed>();
  private readonly lifecycle = new Map<string, number>();
  private lifecycleSequence = 0;
  private readonly statuses = new Map<string, EntityState['coverage']>();
  private readonly terrainPending = new Set<string>();
  private readonly preparationSettled = new Map<string, { origin: [number, number]; range: number }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private preparationGeneration = new AbortController();
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
    this.entities.set(input.entityId, input);
    const active = new Set<string>();
    const visible = input.configuration.entityVisibility.footprints;
    const usable = input.placement === 'airborne' && input.origin[2] > input.ground + 0.01 && visible;
    let footprintTriangles = 0;

    if (usable) {
      for (const camera of input.cameras) {
        const key = keyOf(input.entityId, camera.id);
        active.add(key);
        if (camera.terrainVisibility) {
          // A camera changing from a plain overlay to terrain visibility must
          // not keep the old plain geometry while its first mask is pending.
          if (!this.displayed.get(key)?.terrain && this.displayed.has(key)) this.displayed.delete(key);
          continue;
        }
        // Likewise, switching away from terrain visibility removes the mask
        // request and its old published geometry as one unit.
        this.requested.delete(key);
        if (this.displayed.get(key)?.terrain) this.displayed.delete(key);
        const plain = plainCameraPrimitives(input.entityId, input.origin, input.ground, camera, input.configuration);
        this.displayed.set(key, { geometry: plain.geometry, terrain: false });
        footprintTriangles += plain.footprintTriangles;
      }
      if (!input.cameras.some(camera => camera.terrainVisibility)) this.clearTerrainPending(input.entityId);
      this.activate(input, active);
      this.updateTerrain(input, active);
    } else if (input.placement === 'elevation-unavailable') {
      if (visible) for (const camera of input.cameras) active.add(keyOf(input.entityId, camera.id));
      if (!visible) this.clearTerrainWork(input.entityId);
      this.activate(input, active);
      if (visible && input.cameras.some(camera => camera.terrainVisibility)) this.updateTerrain(input, active);
      if (input.elevationUnavailable && !this.isPreparing(input.entityId)) {
        for (const camera of input.cameras) if (!camera.terrainVisibility)
          this.displayed.delete(keyOf(input.entityId, camera.id));
      }
    } else {
      this.activate(input, active);
      this.clearTerrainWork(input.entityId);
      this.clearRequested(input.entityId);
    }

    for (const key of [...this.displayed.keys()]) {
      if (belongsTo(key, input.entityId) && !active.has(key)) this.displayed.delete(key);
    }
    for (const key of [...this.requested.keys()]) {
      if (belongsTo(key, input.entityId) && !active.has(key)) this.requested.delete(key);
    }
    for (const key of [...this.terrainPending]) {
      if (belongsTo(key, input.entityId) && !active.has(key)) this.terrainPending.delete(key);
    }
    this.syncAdapter();
    const coverage = this.coverageFor(input, active);
    this.statuses.set(input.entityId, coverage);
    return { geometry: this.geometryFor(input.entityId), footprintTriangles, coverage };
  }

  remove(entityId: string) {
    this.entities.delete(entityId);
    this.clearTerrainWork(entityId);
    this.clearEntity(entityId);
    this.syncAdapter();
  }

  output(entityId: string): Primitive[] {
    return this.geometryFor(entityId);
  }

  allGeometry(): Primitive[] {
    return [...this.displayed.values()].flatMap(value => value.geometry);
  }

  status(entityId: string) {
    return this.statuses.get(entityId) ?? 'ready';
  }

  isPreparing(entityId: string) {
    return [...this.preparing.keys()].some(key => belongsTo(key, entityId));
  }

  /** Invalidate queued adapter work while retaining the last displayed result. */
  invalidate(entityId?: string) {
    for (const key of [...this.lifecycle.keys()]) {
      if (entityId !== undefined && !belongsTo(key, entityId)) continue;
      const next = ++this.lifecycleSequence;
      this.lifecycle.set(key, next);
      const request = this.requested.get(key);
      if (request) this.requested.set(key, { ...request, lifecycle: next });
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
    this.invalidate();
    this.failed = false;
    this.terrainPatches.clear();
    this.preparationSettled.clear();
    this.terrainPending.clear();
    this.adapter.retry();
    this.syncAdapter();
    for (const [entityId, input] of this.entities) {
      const active = this.activeKeys(input);
      this.statuses.set(entityId, this.coverageFor(input, active));
      this.options.changed(entityId);
    }
  }

  elevationChanged() {
    for (const [entityId, patches] of this.terrainPatches) {
      for (const [range, patch] of patches) {
        if (!patch.terrain.ready) {
          patches.delete(range);
          this.preparationSettled.delete(patchKeyOf(entityId, range));
        }
      }
      if (!patches.size) this.terrainPatches.delete(entityId);
      if (!this.destroyed) this.options.changed(entityId);
    }
  }

  resetElevation() {
    this.preparationGeneration.abort();
    this.preparationGeneration = new AbortController();
    this.preparing.clear();
    this.terrainPatches.clear();
    this.preparationSettled.clear();
    for (const entityId of this.entities.keys()) if (!this.destroyed) this.options.changed(entityId);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.preparationGeneration.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.adapter.destroy();
    this.entities.clear();
    this.terrainPatches.clear();
    this.preparing.clear();
    this.requested.clear();
    this.displayed.clear();
    this.terrainPending.clear();
    this.lifecycle.clear();
    this.statuses.clear();
  }

  private updateTerrain(input: SensorCameraInput, active: Set<string>) {
    const cameras = input.cameras.filter(camera => camera.terrainVisibility);
    if (!cameras.length) return;
    for (const camera of cameras) {
      const key = keyOf(input.entityId, camera.id);
      const terrain = this.terrainFor(input, camera.range);
      if (!terrain.ready) {
        active.add(key);
        this.terrainPending.add(key);
        if (input.elevationUnavailable && !this.preparing.has(patchKeyOf(input.entityId, camera.range))) {
          this.displayed.delete(key);
          this.requested.delete(key);
        }
        continue;
      }
      this.terrainPending.delete(key);
      const volume = cameraVolume(input.origin, camera, terrain);
      this.requested.set(key, {
        entityId: input.entityId,
        camera,
        lifecycle: this.lifecycle.get(key)!,
        origin: input.origin,
        terrain,
        volume,
        geometry: cameraVolumePrimitives(input.entityId, input.origin, camera, volume, input.configuration, terrain),
      });
      active.add(key);
    }
  }

  private terrainFor(input: SensorCameraInput, range: number) {
    const patches = this.terrainPatches.get(input.entityId);
    const cached = patches?.get(range);
    const preparationKey = patchKeyOf(input.entityId, range);
    const now = performance.now();
    const settled = this.preparationSettled.get(preparationKey);
    if (settled && (settled.origin[0] !== input.origin[0] || settled.origin[1] !== input.origin[1] || settled.range !== range)) {
      this.preparationSettled.delete(preparationKey);
    }
    const terrain = cached && !cached.terrain.ready && now - cached.time < 250
      ? cached.terrain
      : cameraTerrain(input.origin[0], input.origin[1], range, this.options.height, cached?.terrain);
    if (!cached || terrain !== cached.terrain) {
      const next = patches ?? new Map<number, TerrainPatch>();
      next.set(range, { terrain, time: now });
      this.terrainPatches.set(input.entityId, next);
      if (this.preparationSettled.get(preparationKey)?.range !== range) this.preparationSettled.delete(preparationKey);
    }
    if (!terrain.ready) {
      if (!input.elevationPreparing || this.isPreparing(input.entityId)) this.requestPreparation(input, range);
      if (this.options.pollTerrain !== false && !this.options.elevationUnavailable() && !this.options.prepare && !this.timers.has(input.entityId)) {
        const timer = setTimeout(() => {
          this.timers.delete(input.entityId);
          if (!this.destroyed) this.options.changed(input.entityId);
        }, 250);
        this.timers.set(input.entityId, timer);
      }
    }
    return terrain;
  }

  private requestPreparation(input: SensorCameraInput, range: number) {
    const key = patchKeyOf(input.entityId, range);
    if (!this.options.prepare || this.preparing.has(key) || this.preparationSettled.has(key)) return;
    const local = localFrame([input.origin[0], input.origin[1], 0]);
    const positions: [number, number][] = [[input.origin[0], input.origin[1]]];
    const margin = range * 1.3;
    for (const x of [-margin, 0, margin]) for (const y of [-margin, 0, margin]) {
      const point = local(x, y, 0);
      positions.push([point[0], point[1]]);
    }
    const generation = this.preparationGeneration;
    const preparation = Promise.resolve().then(() => this.options.prepare!(positions, generation.signal));
    this.preparing.set(key, preparation);
    void preparation
      .catch(cause => {
        if (!generation.signal.aborted) this.options.diagnostic(cause);
      })
      .finally(() => {
        if (generation.signal.aborted) return;
        if (this.preparing.get(key) !== preparation) return;
        this.preparing.delete(key);
        this.preparationSettled.set(key, { origin: [input.origin[0], input.origin[1]], range });
        const patch = this.terrainPatches.get(input.entityId)?.get(range);
        if (patch) patch.time = 0;
        if (!this.destroyed) this.options.changed(input.entityId);
      });
  }

  private complete(value: GpuCamera, publish: () => void) {
    const key = keyOf(value.entityId, value.camera.id);
    const request = this.requested.get(key);
    if (this.destroyed || this.failed || this.lifecycle.get(key) !== value.lifecycle || !request || !sameCameraAppearance(value, request)) return false;
    publish();
    this.displayed.set(key, { geometry: value.geometry, terrain: true, value });
    const input = this.entities.get(value.entityId);
    if (input) {
      const status = this.coverageFor(input, this.activeKeys(input));
      this.statuses.set(value.entityId, status);
      this.options.displayed?.(value.entityId);
    }
    return true;
  }

  private fail(cause: unknown) {
    if (this.destroyed || this.failed) return;
    this.failed = true;
    for (const [key, displayed] of this.displayed) if (displayed.terrain) this.displayed.delete(key);
    (this.options.rendererDiagnostic ?? this.options.diagnostic)(cause);
    try { this.adapter.set([]); } catch { /* the adapter already reported the renderer failure */ }
    for (const [entityId, input] of this.entities) {
      const status = this.coverageFor(input, this.activeKeys(input));
      this.statuses.set(entityId, status);
      this.options.changed(entityId);
    }
  }

  private coverageFor(input: SensorCameraInput, active: Set<string>) {
    if (!active.size) return input.elevationUnavailable && input.placement === 'elevation-unavailable' ? 'unavailable' : 'ready';
    let coverage: EntityState['coverage'] = 'ready';
    if (input.placement === 'elevation-unavailable' && input.elevationPreparing) coverage = 'loading';
    for (const key of active) {
      const camera = this.entities.get(input.entityId)?.cameras.find(value => key === keyOf(input.entityId, value.id));
      if (!camera?.terrainVisibility) continue;
      const preparing = this.preparing.has(patchKeyOf(input.entityId, camera.range));
      if (this.failed || input.elevationUnavailable && !preparing && !this.requested.has(key) && !this.terrainPending.has(key)) return 'unavailable';
      if (this.terrainPending.has(key)) {
        coverage = input.elevationUnavailable && !preparing ? 'unavailable' : 'loading';
      } else if (this.requested.has(key) && (!this.displayed.get(key)?.value || !sameCamera(this.displayed.get(key)!.value!, this.requested.get(key)!))) coverage = 'loading';
      else if (!this.requested.has(key) && !this.displayed.has(key)) coverage = input.elevationUnavailable ? 'unavailable' : 'loading';
    }
    return coverage;
  }

  private activeKeys(input: SensorCameraInput) {
    const active = new Set<string>();
    const pending = input.placement === 'elevation-unavailable' && !input.elevationUnavailable;
    if ((input.placement === 'airborne' && input.origin[2] > input.ground + 0.01 || pending) && input.configuration.entityVisibility.footprints)
      for (const camera of input.cameras) active.add(keyOf(input.entityId, camera.id));
    return active;
  }

  private activate(input: SensorCameraInput, active: Set<string>) {
    for (const key of active) if (!this.lifecycle.has(key)) {
      this.lifecycle.set(key, ++this.lifecycleSequence);
    }
    for (const key of [...this.lifecycle.keys()]) if (belongsTo(key, input.entityId) && !active.has(key)) this.lifecycle.delete(key);
  }

  private clearRequested(entityId: string) {
    for (const key of [...this.requested.keys()]) if (belongsTo(key, entityId)) this.requested.delete(key);
    for (const key of [...this.lifecycle.keys()]) if (belongsTo(key, entityId)) this.lifecycle.delete(key);
    this.clearTerrainPending(entityId);
  }

  private clearEntity(entityId: string) {
    for (const key of [...this.displayed.keys()]) if (belongsTo(key, entityId)) this.displayed.delete(key);
    for (const key of [...this.requested.keys()]) if (belongsTo(key, entityId)) this.requested.delete(key);
    for (const key of [...this.lifecycle.keys()]) if (belongsTo(key, entityId)) this.lifecycle.delete(key);
    this.clearTerrainPending(entityId);
    this.statuses.delete(entityId);
  }

  private clearTerrainWork(entityId: string) {
    this.terrainPatches.delete(entityId);
    for (const key of [...this.preparing.keys()]) if (belongsTo(key, entityId)) this.preparing.delete(key);
    for (const key of [...this.preparationSettled.keys()]) if (belongsTo(key, entityId)) this.preparationSettled.delete(key);
    this.clearTerrainPending(entityId);
    const timer = this.timers.get(entityId);
    if (timer) clearTimeout(timer);
    this.timers.delete(entityId);
  }

  private clearTerrainPending(entityId: string) {
    for (const key of [...this.terrainPending]) if (belongsTo(key, entityId)) this.terrainPending.delete(key);
  }

  private geometryFor(entityId: string) {
    return [...this.displayed.entries()]
      .filter(([key]) => belongsTo(key, entityId))
      .flatMap(([, value]) => value.geometry);
  }

  private syncAdapter() {
    if (!this.destroyed) this.adapter.set(this.failed ? [] : [...this.requested.values()]);
  }
}
