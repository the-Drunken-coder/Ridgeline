import { localFrame } from './entity-geometry';
import { RasterElevationSampler } from './elevation-sampler';
import { RidgelineError } from './errors';
import type { ElevationProvider, ElevationSampler } from './types';

export type ElevationArea = {
  key: string;
  center: readonly [number, number];
  radiusMeters: number;
};

type Area = ElevationArea & { work?: Work };
type Work = {
  keys: Set<string>;
  areas: ElevationArea[];
  controller: AbortController;
  state: 'scheduled' | 'pending' | 'settled';
  required: boolean;
  prepared: boolean;
};

type ElevationOptions = {
  provider: ElevationProvider;
  sampler?: ElevationSampler;
  changed: (keys: readonly string[]) => void;
  diagnostic: (error: RidgelineError) => void;
};

const EARTH_RADIUS = 6_371_008.8;
const radians = Math.PI / 180;

function contains(outer: ElevationArea, inner: ElevationArea) {
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
  const output: [number, number][] = [[...area.center]];
  if (area.radiusMeters === 0) return output;
  const local = localFrame([area.center[0], area.center[1], 0]);
  for (const east of [-area.radiusMeters, 0, area.radiusMeters])
    for (const north of [-area.radiusMeters, 0, area.radiusMeters]) {
      const point = local(east, north, 0);
      output.push([point[0], point[1]]);
    }
  return output;
}

/** Owns raw elevation and readiness for all entity and camera area requests. */
export class Elevation {
  private readonly areas = new Map<string, Area>();
  private readonly works = new Set<Work>();
  private raster?: RasterElevationSampler;
  private destroyed = false;

  constructor(private readonly options: ElevationOptions) {
    if (!options.sampler) this.raster = this.createRaster(options.provider);
  }

  height(lng: number, lat: number): number | null {
    if (this.destroyed) return null;
    const value = this.options.sampler
      ? this.options.sampler.sample(lng, lat)
      : this.raster!.sample(lng, lat);
    return value !== null && Number.isFinite(value) ? value : null;
  }

  maximum(west: number, south: number, east: number, north: number): number | null {
    return this.destroyed ? null : this.raster?.maximum(west, south, east, north) ?? null;
  }

  request(key: string, center: readonly [number, number], radiusMeters: number): void {
    this.requestBatch([{ key, center, radiusMeters }]);
  }

  /** New areas in one call share a consumer preparation and its signal. */
  requestBatch(requests: readonly ElevationArea[]): void {
    if (this.destroyed) return;
    const fresh: Area[] = [];
    for (const request of requests) {
      const previous = this.areas.get(request.key);
      if (previous && previous.center[0] === request.center[0] &&
          previous.center[1] === request.center[1] && previous.radiusMeters === request.radiusMeters) continue;
      if (previous) this.release(request.key);
      const area: Area = {
        key: request.key,
        center: [request.center[0], request.center[1]],
        radiusMeters: request.radiusMeters,
      };
      this.areas.set(area.key, area);
      if (this.options.sampler?.prepare) fresh.push(area);
    }
    if (!fresh.length) return;

    const unclaimed: Area[] = [];
    for (const area of fresh) {
      const covering = [...this.works].find(work =>
        work.keys.size && work.state !== 'settled' &&
        work.areas.some(candidate => work.keys.has(candidate.key) && contains(candidate, area)));
      if (covering) {
        area.work = covering;
        covering.keys.add(area.key);
      } else unclaimed.push(area);
    }
    if (!unclaimed.length) return;

    // A wider camera request arriving in the same turn can take over a
    // scheduled placement request before either reaches the consumer.
    if (unclaimed.length === 1) {
      const wider = unclaimed[0]!;
      for (const work of [...this.works]) {
        if (work.state !== 'scheduled' || !work.areas.every(area => contains(wider, area))) continue;
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
      state: 'scheduled',
      required: false,
      prepared: false,
    };
    for (const area of unclaimed) area.work = work;
    this.works.add(work);
    queueMicrotask(() => this.start(work));
  }

  release(key: string): void {
    const area = this.areas.get(key);
    if (!area) return;
    this.areas.delete(key);
    const work = area.work;
    if (!work) return;
    work.keys.delete(key);
    if (!work.keys.size) {
      work.controller.abort();
      this.works.delete(work);
    }
  }

  /** A caller found unknown elevation beyond the area's preparation grid. */
  requirePreparation(key: string): void {
    const work = this.areas.get(key)?.work;
    if (!work || work.prepared || this.destroyed) return;
    work.required = true;
    if (work.state === 'settled') {
      work.state = 'scheduled';
      queueMicrotask(() => this.start(work));
    }
  }

  /** Unknown samples are loading until their area settles. Known heights are ready. */
  readiness(key: string): 'loading' | 'unavailable' {
    const area = this.areas.get(key);
    if (!area || this.destroyed) return 'unavailable';
    if (this.options.sampler)
      return area.work && area.work.state !== 'settled' ? 'loading' : 'unavailable';
    return this.raster!.readiness(area.center, area.radiusMeters);
  }

  retry(): void {
    if (this.destroyed) return;
    if (this.raster) {
      this.raster.retry();
      this.notify([...this.areas.keys()]);
    } else this.restart();
  }

  reset(provider: ElevationProvider): void {
    if (this.destroyed) return;
    if (this.raster) {
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
      () => this.notify([...this.areas.keys()]),
      cause => this.report('Raw elevation data is unavailable for entity placement or sensor coverage.', cause),
    );
  }

  private start(work: Work) {
    if (this.destroyed || !this.works.has(work) || work.controller.signal.aborted) return;
    const sampler = this.options.sampler;
    if (!sampler?.prepare) return;
    const samples = work.areas.filter(area => work.keys.has(area.key)).flatMap(positions);
    if (!work.required && samples.every(([lng, lat]) => this.height(lng, lat) !== null)) {
      work.state = 'settled';
      this.notify([...work.keys]);
      return;
    }
    work.state = 'pending';
    work.prepared = true;
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

  private settle(work: Work) {
    if (this.destroyed || work.controller.signal.aborted || !this.works.has(work)) return;
    work.state = 'settled';
    this.notify([...work.keys]);
  }

  private restart() {
    const requests = [...this.areas.values()].map(({ key, center, radiusMeters }) => ({ key, center, radiusMeters }));
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
    // A consumer's event handler must not interrupt resource cleanup.
    try { this.options.changed(keys); } catch { /* Consumer callback failures are isolated by the viewport. */ }
  }
}
