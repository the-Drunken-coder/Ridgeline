import { wrapLongitude } from './longitude';
import type { HeightAt } from './entity-geometry';
import { localFrame } from './entity-geometry';
import { RasterElevationSampler } from './elevation-sampler';
import { RidgelineError } from './errors';
import type { ElevationProvider, ElevationSampler } from './types';

export type ElevationArea = {
  key: string;
  center: readonly [number, number];
  radiusMeters: number;
  preparationBounds?: readonly [number, number, number, number];
  sampleRange?: number;
};

type Area = ElevationArea & { work?: Work; revision: number; unavailable?: boolean };
type WorkStatus =
  | { phase: 'scheduled'; deferred: boolean; force: boolean }
  | { phase: 'pending' }
  | { phase: 'settled'; prepared: boolean };
type Work = {
  keys: Set<string>;
  areas: ElevationArea[];
  controller: AbortController;
  status: WorkStatus;
};

export const placementAreaKey = (entityId: string) => `placement:${entityId}`;
export const cameraAreaKey = (entityId: string, range: number) => `camera:${entityId}:${range}`;
export function entityIdForAreaKey(key: string) {
  if (key.startsWith('placement:')) return key.slice('placement:'.length);
  if (key.startsWith('camera:')) return key.slice('camera:'.length, key.lastIndexOf(':'));
  return undefined;
}

type ElevationOptions = {
  provider: ElevationProvider;
  sampler?: ElevationSampler;
  changed: (keys: readonly string[]) => void;
  diagnostic: (error: RidgelineError) => void;
  pixelRatio?: number;
};

const EARTH_RADIUS = 6_371_008.8;
const radians = Math.PI / 180;

function contains(outer: ElevationArea, inner: ElevationArea) {
  if (outer.preparationBounds) {
    const [west, south, east, north] = outer.preparationBounds;
    return positions(inner).every(([lng, lat]) => {
      const x = lng + Math.round((outer.center[0] - lng) / 360) * 360;
      return x >= west && x <= east && lat >= south && lat <= north;
    });
  }
  if (inner.preparationBounds) return false;
  const [outerLng, outerLat] = outer.center;
  const [innerLng, innerLat] = inner.center;
  const deltaLng = ((innerLng - outerLng + 540) % 360) - 180;
  const deltaLat = (innerLat - outerLat) * radians / 2;
  const a = Math.sin(deltaLat) ** 2 +
    Math.cos(outerLat * radians) * Math.cos(innerLat * radians) * Math.sin(deltaLng * radians / 2) ** 2;
  const distance = 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  return distance + inner.radiusMeters <= outer.radiusMeters + 1e-6;
}

function positions(area: ElevationArea): [number, number][] {
  const output: [number, number][] = [[wrapLongitude(area.center[0]), area.center[1]]];
  if (area.preparationBounds) {
    const [west, south, east, north] = area.preparationBounds;
    for (const lng of [west, area.center[0], east]) for (const lat of [south, area.center[1], north])
      output.push([wrapLongitude(lng), lat]);
    return output;
  }
  if (area.radiusMeters === 0) return output;
  const local = localFrame([area.center[0], area.center[1], 0]);
  for (const east of [-area.radiusMeters, 0, area.radiusMeters])
    for (const north of [-area.radiusMeters, 0, area.radiusMeters]) {
      const point = local(east, north, 0);
      output.push([wrapLongitude(point[0]), point[1]]);
    }
  return output;
}

/** Owns raw elevation and readiness for all entity and camera area requests. */
export class Elevation {
  private readonly areas = new Map<string, Area>();
  private readonly works = new Set<Work>();
  private raster?: RasterElevationSampler;
  private destroyed = false;
  private revisionCounter = 0;

  constructor(private readonly options: ElevationOptions) {
    if (!options.sampler) this.raster = this.createRaster(options.provider);
  }

  height(lng: number, lat: number): number | null {
    if (this.destroyed) return null;
    const value = this.options.sampler
      ? this.options.sampler.sample(wrapLongitude(lng), lat)
      : this.raster!.sample(lng, lat);
    return value !== null && Number.isFinite(value) ? value : null;
  }

  maximum(west: number, south: number, east: number, north: number): number | null {
    return this.destroyed ? null : this.raster?.maximum(west, south, east, north) ?? null;
  }

  sampling(): HeightAt {
    const height: HeightAt = (lng, lat) => this.height(lng, lat);
    if (this.raster) {
      height.maximum = (west, south, east, north) => this.maximum(west, south, east, north);
      height.forRange = (range, lat) => this.raster!.forRange(range, lat);
      height.failedAt = (lng, lat) => this.raster!.unavailableAt(lng, lat);
    }
    return height;
  }

  failedAt(key: string, lng: number, lat: number) {
    return this.raster ? this.raster.unavailableAt(lng, lat) : this.readiness(key) === 'unavailable';
  }

  request(key: string, center: readonly [number, number], radiusMeters: number,
    preparationBounds?: ElevationArea['preparationBounds'], sampleRange?: number): void {
    this.requestBatch([{ key, center, radiusMeters, preparationBounds, sampleRange }]);
  }

  /** New areas in one call share a consumer preparation and its signal. */
  requestBatch(requests: readonly ElevationArea[], options: { deferProbe?: boolean } = {}): void {
    if (this.destroyed) return;
    const fresh: Area[] = [];
    for (const request of requests) {
      const previous = this.areas.get(request.key);
      if (previous && previous.center[0] === request.center[0] &&
          previous.center[1] === request.center[1] && previous.radiusMeters === request.radiusMeters) {
        if (!options.deferProbe) this.startDeferred(previous.work);
        continue;
      }
      if (previous) this.release(request.key);
      const area: Area = {
        key: request.key,
        center: [request.center[0], request.center[1]],
        radiusMeters: request.radiusMeters,
        preparationBounds: request.preparationBounds,
        sampleRange: request.sampleRange,
        revision: ++this.revisionCounter,
      };
      this.areas.set(area.key, area);
      if (this.options.sampler?.prepare) fresh.push(area);
    }
    if (!fresh.length) return;

    const unclaimed: Area[] = [];
    for (const area of fresh) {
      const covering = [...this.works].find(work =>
        work.keys.size && work.status.phase !== 'settled' &&
        work.areas.some(candidate => work.keys.has(candidate.key) && contains(candidate, area)));
      if (covering) {
        area.work = covering;
        covering.keys.add(area.key);
        covering.areas.push(area);
        if (!options.deferProbe) this.startDeferred(covering);
      } else unclaimed.push(area);
    }
    if (!unclaimed.length) return;

    // A wider camera request arriving in the same turn can take over a
    // scheduled placement request before either reaches the consumer.
    if (unclaimed.length === 1) {
      const wider = unclaimed[0]!;
      for (const work of [...this.works]) {
        if (work.status.phase !== 'scheduled' || !work.areas.every(area => contains(wider, area))) continue;
        for (const key of work.keys) {
          const area = this.areas.get(key);
          if (area) unclaimed.push(area);
        }
        work.keys.clear();
        work.controller.abort();
        this.works.delete(work);
      }
    }

    const work: Work = {
      keys: new Set(unclaimed.map(area => area.key)),
      areas: unclaimed,
      controller: new AbortController(),
      status: { phase: 'scheduled', deferred: options.deferProbe ?? false, force: false },
    };
    for (const area of unclaimed) area.work = work;
    this.works.add(work);
    if (work.status.phase === 'scheduled' && !work.status.deferred) queueMicrotask(() => this.start(work));
  }

  release(key: string): void {
    const area = this.areas.get(key);
    if (!area) return;
    this.areas.delete(key);
    const work = area.work;
    if (!work) return;
    work.keys.delete(key);
    work.areas = work.areas.filter(area => area.key !== key);
    if (!work.keys.size) {
      work.controller.abort();
      this.works.delete(work);
    }
  }

  /** A caller found unknown elevation beyond the area's preparation grid. */
  requirePreparation(key: string): void {
    const work = this.areas.get(key)?.work;
    if (!work || this.destroyed) return;
    if (work.status.phase === 'scheduled') {
      work.status.force = true;
      this.startDeferred(work);
    } else if (work.status.phase === 'settled' && !work.status.prepared) {
      work.status = { phase: 'scheduled', deferred: false, force: true };
      queueMicrotask(() => this.start(work));
    }
  }

  /** Changes whenever this requested area's elevation might have changed. */
  revision(key: string): number {
    return this.areas.get(key)?.revision ?? 0;
  }

  /** Unknown samples are loading until their area settles. Known heights are ready. */
  readiness(key: string): 'loading' | 'unavailable' {
    const area = this.areas.get(key);
    if (!area || this.destroyed) return 'unavailable';
    if (this.options.sampler)
      return area.work && area.work.status.phase !== 'settled' ? 'loading' : 'unavailable';
    area.unavailable ||= this.raster!.readiness(area.center, area.radiusMeters, area.preparationBounds, area.sampleRange) === 'unavailable';
    return area.unavailable ? 'unavailable' : 'loading';
  }

  retry(): void {
    if (this.destroyed) return;
    if (this.raster) {
      for (const area of this.areas.values()) area.unavailable = false;
      this.raster.retry();
      this.notify([...this.areas.keys()]);
    } else this.restart();
  }

  reset(provider: ElevationProvider): void {
    if (this.destroyed) return;
    if (this.raster) {
      for (const area of this.areas.values()) area.unavailable = false;
      this.raster.destroy();
      this.raster = this.createRaster(provider);
      this.notify([...this.areas.keys()]);
    } else this.restart();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const work of this.works) work.controller.abort();
    this.works.clear();
    this.areas.clear();
    this.raster?.destroy();
  }

  private createRaster(provider: ElevationProvider) {
    return new RasterElevationSampler(
      provider,
      tileKey => this.notify([...this.areas.values()]
        .filter(area => !tileKey || this.raster?.affects(area.center, area.radiusMeters, tileKey, area.preparationBounds))
        .map(area => area.key)),
      cause => this.report('Raw elevation data is unavailable for entity placement or sensor coverage.', cause),
      this.options.pixelRatio,
    );
  }

  private start(work: Work) {
    if (this.destroyed || !this.works.has(work) || work.controller.signal.aborted ||
        work.status.phase !== 'scheduled' || work.status.deferred) return;
    const sampler = this.options.sampler;
    if (!sampler?.prepare) return;
    const samples = work.areas.filter(area => work.keys.has(area.key)).flatMap(positions);
    let known = false;
    try {
      known = !work.status.force && samples.every(([lng, lat]) => this.height(lng, lat) !== null);
    } catch (cause) {
      work.status = { phase: 'settled', prepared: true };
      this.report('Consumer elevation source could not sample entity or sensor terrain.', cause);
      this.notify([...work.keys]);
      return;
    }
    if (known) {
      work.status = { phase: 'settled', prepared: false };
      this.notify([...work.keys]);
      return;
    }
    work.status = { phase: 'pending' };
    // Call as a method so a stateful consumer sampler keeps its receiver.
    void Promise.resolve().then(() => {
      if (!work.controller.signal.aborted) return sampler.prepare!(samples, work.controller.signal);
    })
      .then(
        () => this.settle(work),
        cause => {
          if (!work.controller.signal.aborted && this.works.has(work))
            this.report('Consumer elevation source could not prepare entity or sensor terrain.', cause);
          this.settle(work);
        },
      );
  }

  private startDeferred(work?: Work) {
    if (!work || work.status.phase !== 'scheduled' || !work.status.deferred) return;
    work.status.deferred = false;
    queueMicrotask(() => this.start(work));
  }

  private settle(work: Work) {
    if (this.destroyed || work.controller.signal.aborted || !this.works.has(work)) return;
    work.status = { phase: 'settled', prepared: true };
    this.notify([...work.keys]);
  }

  private restart() {
    const requests = [...this.areas.values()].map(({ key, center, radiusMeters, preparationBounds, sampleRange }) => ({ key, center, radiusMeters, preparationBounds, sampleRange }));
    for (const work of this.works) work.controller.abort();
    this.works.clear();
    this.areas.clear();
    this.requestBatch(requests);
    this.notify(requests.map(request => request.key));
  }

  private report(message: string, cause: unknown) {
    if (this.destroyed) return;
    try {
      this.options.diagnostic(new RidgelineError(
        'ELEVATION_UNAVAILABLE', message, { operation: 'entities', recoverable: true }, cause,
      ));
    } catch { /* Consumer diagnostic callbacks cannot interrupt preparation. */ }
  }

  private notify(keys: readonly string[]) {
    if (this.destroyed || !keys.length) return;
    for (const key of keys) {
      const area = this.areas.get(key);
      if (area) area.revision = ++this.revisionCounter;
    }
    // A consumer's event handler must not interrupt resource cleanup.
    try { this.options.changed(keys); } catch { /* Consumer callback failures are isolated by the viewport. */ }
  }
}
