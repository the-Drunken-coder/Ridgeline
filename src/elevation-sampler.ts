import type { ElevationProvider } from './types';
import { ElevationBounds } from './elevation-bounds';

type Tile = { size: number; values: Float32Array; bounds: ElevationBounds };
const MAX_LAT = 85.05112878;
const EARTH_RADIUS_METERS = 6_371_008.8;
export function tilePosition(lng: number, lat: number, zoom: number) {
  const n = 2 ** zoom,
    latitude = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: (((((lng + 180) / 360) * n) % n) + n) % n,
    y: Math.max(0, Math.min(n - 1e-9, ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * n)),
  };
}
export function decodeElevation(
  red: number,
  green: number,
  blue: number,
  encoding: ElevationProvider['encoding'] = 'mapbox',
  factors: Pick<ElevationProvider, 'redFactor' | 'greenFactor' | 'blueFactor' | 'baseShift'> = {},
) {
  if (encoding === 'custom')
    return (
      red * (factors.redFactor ?? 1) +
      green * (factors.greenFactor ?? 1) +
      blue * (factors.blueFactor ?? 1) +
      (factors.baseShift ?? 0)
    );
  return encoding === 'terrarium'
    ? red * 256 + green + blue / 256 - 32768
    : (red * 65536 + green * 256 + blue) * 0.1 - 10000;
}

/** Raw DEM heights stay independent of MapLibre terrain visibility and exaggeration. */
export class RasterElevationSampler {
  private tiles = new Map<string, Tile>();
  private queued = new Map<string, [number, number]>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private noData = new Set<string>();
  private controller = new AbortController();
  private templates: string[] = [];
  private zoom = 12;
  private ready = false;
  private started = false;
  constructor(
    private provider: ElevationProvider,
    private changed: () => void,
    private error: (cause: unknown) => void,
  ) {}

  sample(lng: number, lat: number): number | null {
    if (!this.started) {
      this.started = true;
      void this.initialize();
    }
    if (!this.ready) return null;
    if (Math.abs(lat) > MAX_LAT) {
      this.failed.add('latitude');
      return null;
    }
    const p = tilePosition(lng, lat, this.zoom),
      x = Math.floor(p.x),
      y = Math.floor(p.y);
    const tile = this.getTile(x, y);
    if (!tile) return null;
    // DEM values represent pixel centres. Sample adjacent tiles across borders.
    const px = (p.x - x) * tile.size - 0.5,
      py = (p.y - y) * tile.size - 0.5,
      ix = Math.floor(px),
      iy = Math.floor(py),
      fx = px - ix,
      fy = py - iy;
    // Most ray samples stay inside one tile. Avoid four neighbour lookups in this hot path.
    if (ix >= 0 && iy >= 0 && ix + 1 < tile.size && iy + 1 < tile.size) {
      const i = iy * tile.size + ix;
      const result = tile.values[i]! * (1 - fx) * (1 - fy) +
        tile.values[i + 1]! * fx * (1 - fy) +
        tile.values[i + tile.size]! * (1 - fx) * fy +
        tile.values[i + tile.size + 1]! * fx * fy;
      if (!Number.isFinite(result)) this.markNoData(x, y);
      return Number.isFinite(result) ? result : null;
    }
    const value = (xx: number, yy: number) => {
      const dx = Math.floor(xx / tile.size),
        dy = Math.floor(yy / tile.size);
      const neighbour = dx || dy ? this.getTile(x + dx, y + dy) : tile;
      if (!neighbour || neighbour.size !== tile.size) return NaN;
      const result =
        neighbour.values[((yy + tile.size) % tile.size) * tile.size + ((xx + tile.size) % tile.size)]!;
      if (!Number.isFinite(result)) this.markNoData(x + dx, y + dy);
      return result;
    };
    const result =
      value(ix, iy) * (1 - fx) * (1 - fy) +
      value(ix + 1, iy) * fx * (1 - fy) +
      value(ix, iy + 1) * (1 - fx) * fy +
      value(ix + 1, iy + 1) * fx * fy;
    return Number.isFinite(result) ? result : null;
  }
  /** Upper bound for every bilinear sample in a geographic rectangle, including tile borders. */
  maximum(west: number, south: number, east: number, north: number): number | null {
    if (!this.ready || south < -MAX_LAT || north > MAX_LAT || east - west >= 360) return null;
    const start = tilePosition(west, north, this.zoom), endY = tilePosition(east, south, this.zoom).y;
    const first = this.getTile(Math.floor(start.x), Math.floor(start.y));
    if (!first) return null;
    const size = first.size, endX = start.x + (east - west) / 360 * 2 ** this.zoom;
    // Include every pixel supporting bilinear interpolation, not just pixel centres inside the box.
    const x0 = Math.floor(start.x * size - 0.5), x1 = Math.floor(endX * size - 0.5) + 1;
    const y0 = Math.floor(start.y * size - 0.5), y1 = Math.floor(endY * size - 0.5) + 1;
    let maximum = -Infinity;
    for (let y = Math.floor(y0 / size); y <= Math.floor(y1 / size); y++)
      for (let x = Math.floor(x0 / size); x <= Math.floor(x1 / size); x++) {
        const tile = this.getTile(x, y);
        if (!tile || tile.size !== size) return null;
        maximum = Math.max(maximum, tile.bounds.maximum(
          Math.max(0, x0 - x * size), Math.max(0, y0 - y * size),
          Math.min(size - 1, x1 - x * size), Math.min(size - 1, y1 - y * size),
        ));
      }
    return Number.isFinite(maximum) ? maximum : null;
  }
  private getTile(x: number, y: number) {
    const n = 2 ** this.zoom;
    if (y < 0 || y >= n) {
      this.failed.add('latitude');
      return undefined;
    }
    x = (x + n) % n;
    const key = `${x}/${y}`,
      tile = this.tiles.get(key);
    if (!tile && !this.pending.has(key) && !this.failed.has(key)) {
      this.queued.set(key, [x, y]);
      this.pump();
    }
    return tile;
  }
  private markNoData(x: number, y: number) {
    const n = 2 ** this.zoom;
    if (y >= 0 && y < n) this.noData.add(`${((x % n) + n) % n}/${y}`);
  }
  /** Unknown samples settle only when this area needs failed data. */
  readiness(center: readonly [number, number], radiusMeters: number): 'loading' | 'unavailable' {
    if (this.failed.has('source')) return 'unavailable';
    const [lng, lat] = center;
    const angularRadius = radiusMeters / EARTH_RADIUS_METERS;
    const south = lat - angularRadius * 180 / Math.PI;
    const north = lat + angularRadius * 180 / Math.PI;
    if (south < -MAX_LAT || north > MAX_LAT) return 'unavailable';
    if (!this.ready) return 'loading';

    const longitudeRadius = Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(lat * Math.PI / 180))) * 180 / Math.PI;
    const n = 2 ** this.zoom;
    const firstX = Math.floor((lng - longitudeRadius + 180) / 360 * n);
    const lastX = Math.floor((lng + longitudeRadius + 180) / 360 * n);
    const firstY = Math.floor(tilePosition(lng, north, this.zoom).y);
    const lastY = Math.floor(tilePosition(lng, south, this.zoom).y);
    for (const keys of [this.failed, this.noData])
      for (const key of keys) {
        const [x, y] = key.split('/').map(Number);
        if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) continue;
        const distance = ((x - firstX) % n + n) % n;
        if (distance <= lastX - firstX && y >= firstY && y <= lastY) return 'unavailable';
      }
    return 'loading';
  }
  unavailable() {
    return this.failed.size > 0 || this.noData.size > 0;
  }
  retry() {
    this.failed.clear();
    this.noData.clear();
    if (!this.ready) {
      this.started = false;
    }
    this.changed();
  }
  destroy() {
    this.controller.abort();
    this.tiles.clear();
    this.queued.clear();
  }

  private async initialize() {
    try {
      let templates = this.provider.tiles;
      let maxzoom = this.provider.maxzoom ?? 12,
        minzoom = this.provider.minzoom ?? 0;
      if (!templates?.length && this.provider.url) {
        const response = await fetch(this.provider.url, {
          signal: this.controller.signal,
        });
        if (!response.ok) throw new Error(`Elevation TileJSON: HTTP ${response.status}`);
        const json: unknown = await response.json();
        if (
          !json ||
          typeof json !== 'object' ||
          !('tiles' in json) ||
          !Array.isArray(json.tiles) ||
          !json.tiles.every((v): v is string => typeof v === 'string')
        )
          throw new Error('Elevation TileJSON has no tile templates.');
        templates = json.tiles.map((value) =>
          new URL(value, this.provider.url).href.replaceAll('%7B', '{').replaceAll('%7D', '}'),
        );
        if ('maxzoom' in json && typeof json.maxzoom === 'number') maxzoom = Math.min(maxzoom, json.maxzoom);
        if ('minzoom' in json && typeof json.minzoom === 'number') minzoom = Math.max(minzoom, json.minzoom);
      }
      if (!templates?.length) throw new Error('Elevation source needs tiles or a TileJSON URL.');
      if (this.controller.signal.aborted) return;
      if (![minzoom, maxzoom].every((v) => Number.isInteger(v) && v >= 0 && v <= 24) || minzoom > maxzoom)
        throw new Error('Elevation zoom bounds must be integers between 0 and 24.');
      this.templates = templates;
      this.zoom = Math.max(minzoom, Math.min(12, maxzoom));
      this.ready = true;
      this.changed();
    } catch (cause) {
      if (!this.controller.signal.aborted) {
        this.failed.add('source');
        this.error(cause);
        this.changed();
      }
    }
  }
  private pump() {
    while (this.pending.size < 6 && this.queued.size && !this.controller.signal.aborted) {
      const entry = this.queued.entries().next().value;
      if (!entry) return;
      const [key, [x, y]] = entry;
      this.queued.delete(key);
      this.pending.add(key);
      void this.load(x, y)
        .then((tile) => {
          if (this.controller.signal.aborted) return;
          this.tiles.set(key, tile);
          while (this.tiles.size > 256) this.tiles.delete(this.tiles.keys().next().value!);
        })
        .catch((cause) => {
          if (!this.controller.signal.aborted) {
            this.failed.add(key);
            this.error(cause);
          }
        })
        .finally(() => {
          this.pending.delete(key);
          if (!this.controller.signal.aborted) {
            this.changed();
            this.pump();
          }
        });
    }
  }
  private async load(x: number, y: number): Promise<Tile> {
    const template = this.templates[(x + y) % this.templates.length]!;
    const tileY = y;
    const url = template
      .replaceAll('{z}', String(this.zoom))
      .replaceAll('{x}', String(x))
      .replaceAll('{y}', String(tileY))
      .replaceAll('{ratio}', '');
    const response = await fetch(url, { signal: this.controller.signal });
    if (!response.ok) throw new Error(`Elevation tile: HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        context = canvas.getContext('2d');
      if (!context || bitmap.width !== bitmap.height) throw new Error('Elevation tile could not be decoded.');
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data,
        values = new Float32Array(bitmap.width * bitmap.height);
      for (let i = 0; i < values.length; i++)
        values[i] =
          data[i * 4 + 3] === 0
            ? NaN
            : decodeElevation(
                data[i * 4]!,
                data[i * 4 + 1]!,
                data[i * 4 + 2]!,
                this.provider.encoding,
                this.provider,
              );
      return { size: bitmap.width, values, bounds: new ElevationBounds(values, bitmap.width) };
    } finally {
      bitmap.close();
    }
  }
}
