import type { ElevationProvider } from './types';
import { ElevationBounds } from './elevation-bounds';

type Tile = { size: number; values: Float32Array; bounds: ElevationBounds };
const MAX_LAT = 85.05112878;
const WORLD_METERS = 2 * Math.PI * 6_378_137;
// A 50 km camera patch at zoom 12 and latitude 46 spans about 400 source tiles.
// Keep one such working set resident so readiness can converge without refetching.
const TILE_CACHE_LIMIT = 512;
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
      -(factors.baseShift ?? 0)
    );
  return encoding === 'terrarium'
    ? red * 256 + green + blue / 256 - 32768
    : (red * 65536 + green * 256 + blue) * 0.1 - 10000;
}

/** Raw DEM heights stay independent of MapLibre terrain visibility and exaggeration. */
export class RasterElevationSampler {
  private tiles = new Map<string, Tile>();
  private queued = new Map<string, [number, number, number]>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private controller = new AbortController();
  private templates: string[] = [];
  private zoom = 12;
  private minZoom = 0;
  private encoding: ElevationProvider['encoding'] = 'mapbox';
  private scheme: 'xyz' | 'tms' = 'xyz';
  private ready = false;
  private started = false;
  constructor(
    private provider: ElevationProvider,
    private changed: () => void,
    private error: (cause: unknown) => void,
    private pixelRatio = globalThis.devicePixelRatio ?? 1,
  ) {}

  sample(lng: number, lat: number): number | null {
    return this.sampleAt(lng, lat, this.zoom);
  }
  /** Large patches use coarser source tiles while retaining the fixed analysis mesh. */
  forRange(range: number, lat: number) {
    const tileBudgetAcross = 10;
    const zoom = () => Math.max(this.minZoom, Math.min(this.zoom, Math.floor(Math.log2(
      tileBudgetAcross * WORLD_METERS * Math.cos(lat * Math.PI / 180) / (range * 2.6),
    ))));
    return Object.assign(
      (lng: number, latitude: number) => this.sampleAt(lng, latitude, zoom()),
      { failedAt: (lng: number, latitude: number) => this.unavailableAt(lng, latitude, zoom()) },
    );
  }
  private sampleAt(lng: number, lat: number, zoom: number): number | null {
    if (!this.started) {
      this.started = true;
      void this.initialize();
      return null;
    }
    if (!this.ready) return null;
    if (Math.abs(lat) > MAX_LAT) {
      return null;
    }
    const p = tilePosition(lng, lat, zoom),
      x = Math.floor(p.x),
      y = Math.floor(p.y);
    const tile = this.getTile(x, y, zoom);
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
      return Number.isFinite(result) ? result : null;
    }
    const value = (xx: number, yy: number) => {
      const dx = Math.floor(xx / tile.size),
        dy = Math.floor(yy / tile.size);
      const neighbour = dx || dy ? this.getTile(x + dx, y + dy, zoom) : tile;
      if (!neighbour || neighbour.size !== tile.size) return NaN;
      const result =
        neighbour.values[((yy + tile.size) % tile.size) * tile.size + ((xx + tile.size) % tile.size)]!;
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
  private getTile(x: number, y: number, zoom = this.zoom) {
    const n = 2 ** zoom;
    if (y < 0 || y >= n) {
      return undefined;
    }
    x = (x + n) % n;
    const key = `${zoom}/${x}/${y}`,
      tile = this.tiles.get(key);
    if (tile) { this.tiles.delete(key); this.tiles.set(key, tile); }
    if (!tile && !this.pending.has(key) && !this.failed.has(key)) {
      this.queued.set(key, [x, y, zoom]);
      this.pump();
    }
    return tile;
  }
  unavailable() {
    return this.failed.size > 0;
  }
  unavailableAt(lng: number, lat: number, zoom = this.zoom) {
    if (this.failed.has('source') || Math.abs(lat) > MAX_LAT) return true;
    const p = tilePosition(lng, lat, zoom);
    const n = 2 ** zoom;
    const size = this.tiles.get(`${zoom}/${Math.floor(p.x)}/${Math.floor(p.y)}`)?.size;
    if (!size) return this.failed.has(`${zoom}/${Math.floor(p.x)}/${Math.floor(p.y)}`);
    const x0 = Math.floor(p.x * size - .5), y0 = Math.floor(p.y * size - .5);
    for (const px of [x0, x0 + 1]) for (const py of [y0, y0 + 1]) {
      const x = ((Math.floor(px / size) % n) + n) % n;
      const y = Math.floor(py / size);
      if (this.failed.has(`${zoom}/${x}/${y}`)) return true;
      const tile = this.tiles.get(`${zoom}/${x}/${y}`);
      if (tile && !Number.isFinite(tile.values[((py % size + size) % size) * size + ((px % size + size) % size)])) return true;
    }
    return false;
  }
  retry() {
    this.failed.clear();
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
      let encoding = this.provider.encoding ?? 'mapbox';
      const configuredScheme = 'scheme' in this.provider ? this.provider.scheme : undefined;
      let scheme: 'xyz' | 'tms' = configuredScheme === 'tms' ? 'tms' : 'xyz';
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
        if (this.provider.maxzoom === undefined && 'maxzoom' in json && typeof json.maxzoom === 'number') maxzoom = json.maxzoom;
        if (this.provider.minzoom === undefined && 'minzoom' in json && typeof json.minzoom === 'number') minzoom = json.minzoom;
        if (this.provider.encoding === undefined && 'encoding' in json &&
          (json.encoding === 'mapbox' || json.encoding === 'terrarium' || json.encoding === 'custom'))
          encoding = json.encoding;
        if (configuredScheme === undefined && 'scheme' in json && (json.scheme === 'xyz' || json.scheme === 'tms'))
          scheme = json.scheme;
      }
      if (!templates?.length) throw new Error('Elevation source needs tiles or a TileJSON URL.');
      if (this.controller.signal.aborted) return;
      if (![minzoom, maxzoom].every((v) => Number.isInteger(v) && v >= 0 && v <= 24) || minzoom > maxzoom)
        throw new Error('Elevation zoom bounds must be integers between 0 and 24.');
      this.templates = templates;
      this.zoom = Math.max(minzoom, Math.min(12, maxzoom));
      this.minZoom = minzoom;
      this.encoding = encoding;
      this.scheme = scheme;
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
      const [key, [x, y, zoom]] = entry;
      this.queued.delete(key);
      this.pending.add(key);
      void this.load(x, y, zoom)
        .then((tile) => {
          if (this.controller.signal.aborted) return;
          this.tiles.set(key, tile);
          while (this.tiles.size > TILE_CACHE_LIMIT) this.tiles.delete(this.tiles.keys().next().value!);
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
  private async load(x: number, y: number, zoom: number): Promise<Tile> {
    const template = this.templates[(x + y) % this.templates.length]!;
    const tileY = this.scheme === 'tms' ? 2 ** zoom - y - 1 : y;
    let quadkey = '';
    for (let bit = zoom - 1; bit >= 0; bit--)
      quadkey += String(((x >> bit) & 1) + 2 * ((y >> bit) & 1));
    const extent = WORLD_METERS / 2 ** zoom;
    const west = x * extent - WORLD_METERS / 2;
    const south = WORLD_METERS / 2 - (y + 1) * extent;
    const bbox = `${west},${south},${west + extent},${south + extent}`;
    const url = template
      .replaceAll('{z}', String(zoom))
      .replaceAll('{x}', String(x))
      .replaceAll('{y}', String(tileY))
      .replaceAll('{ratio}', this.pixelRatio > 1 ? '@2x' : '')
      .replaceAll('{prefix}', (x % 16).toString(16) + (y % 16).toString(16))
      .replaceAll('{quadkey}', quadkey)
      .replaceAll('{bbox-epsg-3857}', bbox);
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
                this.encoding,
                this.provider,
              );
      return { size: bitmap.width, values, bounds: new ElevationBounds(values, bitmap.width) };
    } finally {
      bitmap.close();
    }
  }
}
