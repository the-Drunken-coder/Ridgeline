import type { ElevationProvider } from './types';
import { ElevationBounds } from './elevation-bounds';

type Tile = { size: number; values: Float32Array; bounds: ElevationBounds };
type MissingPixels = { size: number; stride: number; bits: Uint32Array };
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
  // Missing-pixel history follows retained tiles; active failed areas pin their tiles.
  private noData = new Map<string, MissingPixels>();
  private controller = new AbortController();
  private templates: string[] = [];
  private zoom = 12;
  private ready = false;
  private started = false;
  constructor(
    private provider: ElevationProvider,
    private changed: (tileKey?: string) => void,
    private error: (cause: unknown) => void,
    private retainNoData: (tileKey: string) => boolean = () => false,
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
      const values = [tile.values[i]!, tile.values[i + 1]!,
        tile.values[i + tile.size]!, tile.values[i + tile.size + 1]!];
      const result = values[0]! * (1 - fx) * (1 - fy) +
        values[1]! * fx * (1 - fy) +
        values[2]! * (1 - fx) * fy + values[3]! * fx * fy;
      if (!Number.isFinite(result)) {
        if (!Number.isFinite(values[0])) this.markNoData(x, y, ix, iy, tile.size);
        if (!Number.isFinite(values[1])) this.markNoData(x, y, ix + 1, iy, tile.size);
        if (!Number.isFinite(values[2])) this.markNoData(x, y, ix, iy + 1, tile.size);
        if (!Number.isFinite(values[3])) this.markNoData(x, y, ix + 1, iy + 1, tile.size);
      }
      return Number.isFinite(result) ? result : null;
    }
    const value = (xx: number, yy: number) => {
      const dx = Math.floor(xx / tile.size),
        dy = Math.floor(yy / tile.size);
      const neighbour = dx || dy ? this.getTile(x + dx, y + dy) : tile;
      if (!neighbour || neighbour.size !== tile.size) return NaN;
      const result =
        neighbour.values[((yy + tile.size) % tile.size) * tile.size + ((xx + tile.size) % tile.size)]!;
      if (!Number.isFinite(result))
        this.markNoData(x + dx, y + dy, (xx + tile.size) % tile.size, (yy + tile.size) % tile.size, tile.size);
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
  private markNoData(x: number, y: number, px: number, py: number, size: number) {
    const n = 2 ** this.zoom;
    if (y < 0 || y >= n) return;
    const key = `${((x % n) + n) % n}/${y}`;
    let missing = this.noData.get(key);
    if (!missing) {
      const stride = Math.ceil(size / 32);
      missing = { size, stride, bits: new Uint32Array(size * stride) };
      this.noData.set(key, missing);
    }
    missing.bits[py * missing.stride + (px >> 5)]! |= 1 << (px & 31);
  }
  private areaBounds(center: readonly [number, number], radiusMeters: number) {
    const [lng, lat] = center;
    const angularRadius = radiusMeters / EARTH_RADIUS_METERS;
    const south = lat - angularRadius * 180 / Math.PI;
    const north = lat + angularRadius * 180 / Math.PI;
    if (south < -MAX_LAT || north > MAX_LAT) return null;
    const longitudeRadius = Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(lat * Math.PI / 180))) * 180 / Math.PI;
    const n = 2 ** this.zoom;
    const westX = (lng - longitudeRadius + 180) / 360 * n;
    const eastX = (lng + longitudeRadius + 180) / 360 * n;
    const northY = tilePosition(lng, north, this.zoom).y;
    const southY = tilePosition(lng, south, this.zoom).y;
    const tileSize = this.tiles.values().next().value?.size ?? this.provider.tileSize ?? 256;
    const border = 0.5 / tileSize;
    return {
      westX, eastX, northY, southY, n,
      firstX: Math.floor(westX - border), lastX: Math.floor(eastX + border),
      firstY: Math.floor(northY - border), lastY: Math.floor(southY + border),
    };
  }
  /** Whether a loaded tile could affect this requested area. */
  affects(center: readonly [number, number], radiusMeters: number, tileKey: string) {
    const bounds = this.areaBounds(center, radiusMeters);
    if (!bounds) return false;
    const [x, y] = tileKey.split('/').map(Number);
    if (x === undefined || y === undefined || y < bounds.firstY || y > bounds.lastY) return false;
    const distance = ((x - bounds.firstX) % bounds.n + bounds.n) % bounds.n;
    return bounds.lastX - bounds.firstX >= bounds.n || distance <= bounds.lastX - bounds.firstX;
  }
  /** A sampled missing pixel in this tile affects the requested area. */
  noDataAffects(center: readonly [number, number], radiusMeters: number, tileKey: string) {
    const bounds = this.areaBounds(center, radiusMeters);
    if (!bounds || !this.affects(center, radiusMeters, tileKey)) return false;
    const missing = this.noData.get(tileKey);
    if (!missing) return false;
    const [canonicalX, y] = tileKey.split('/').map(Number);
    if (canonicalX === undefined || y === undefined) return false;
    const x = bounds.firstX + ((canonicalX - bounds.firstX) % bounds.n + bounds.n) % bounds.n;
    return this.missingInBounds(missing, x, y, bounds);
  }
  private missingInBounds(missing: MissingPixels, x: number, y: number, bounds: NonNullable<ReturnType<RasterElevationSampler['areaBounds']>>) {
    const { size, stride, bits } = missing;
    const x0 = Math.max(0, Math.floor((bounds.westX - x) * size - 0.5));
    const x1 = Math.min(size - 1, Math.floor((bounds.eastX - x) * size - 0.5) + 1);
    const y0 = Math.max(0, Math.floor((bounds.northY - y) * size - 0.5));
    const y1 = Math.min(size - 1, Math.floor((bounds.southY - y) * size - 0.5) + 1);
    if (x1 < x0 || y1 < y0) return false;
    const firstWord = x0 >> 5, lastWord = x1 >> 5;
    for (let py = y0; py <= y1; py++) for (let word = firstWord; word <= lastWord; word++) {
      const left = word === firstWord ? -1 << (x0 & 31) : -1;
      const right = word === lastWord ? -1 >>> (31 - (x1 & 31)) : -1;
      if ((bits[py * stride + word]! & left & right) !== 0) return true;
    }
    return false;
  }
  /** Unknown samples settle only when this area needs failed data. */
  readiness(center: readonly [number, number], radiusMeters: number): 'loading' | 'unavailable' {
    if (this.failed.has('source')) return 'unavailable';
    const bounds = this.areaBounds(center, radiusMeters);
    if (!bounds) return 'unavailable';
    if (!this.ready) return 'loading';
    const { n, firstX, lastX, firstY, lastY } = bounds;
    if (lastX - firstX >= n) {
      for (const key of this.failed) {
        const y = Number(key.split('/')[1]);
        if (Number.isInteger(y) && y >= firstY && y <= lastY) return 'unavailable';
      }
      for (const [key, missing] of this.noData) {
        const [canonicalX, y] = key.split('/').map(Number);
        if (canonicalX === undefined || y === undefined || y < firstY || y > lastY) continue;
        const x = firstX + ((canonicalX - firstX) % n + n) % n;
        if (this.missingInBounds(missing, x, y, bounds)) return 'unavailable';
      }
      return 'loading';
    }
    // Readiness examines only tiles intersecting this request, regardless of
    // how many failures have accumulated elsewhere in the world.
    for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
      const key = `${((x % n) + n) % n}/${y}`;
      if (this.failed.has(key)) return 'unavailable';
      const missing = this.noData.get(key);
      if (missing && this.missingInBounds(missing, x, y, bounds)) return 'unavailable';
    }
    return 'loading';
  }
  retry() {
    this.failed.clear();
    this.noData.clear();
    this.trim();
    if (!this.ready) {
      this.started = false;
    }
    this.changed();
  }
  destroy() {
    this.controller.abort();
    this.tiles.clear();
    this.queued.clear();
    this.noData.clear();
  }

  /** Keep 256 ordinary tiles plus tiles carrying missing data for active areas. */
  trim() {
    const retained = new Set([...this.noData.keys()].filter(key => this.retainNoData(key)));
    while (this.tiles.size - retained.size > 256) {
      let candidate: string | undefined;
      for (const key of this.tiles.keys()) if (!retained.has(key)) {
        candidate = key;
        break;
      }
      if (!candidate) return;
      this.tiles.delete(candidate);
      this.noData.delete(candidate);
    }
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
          this.trim();
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
            this.changed(key);
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
