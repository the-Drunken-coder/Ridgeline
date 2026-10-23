import { createViewport } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import type { CustomRenderMethodInput } from 'maplibre-gl';
import { axisModelGlb, groundModelGlb, planarTerrain } from './model-placement-fixtures';

import type { BrowserCaseContext as Context, BrowserCaseModule } from './context';
type Vec3 = [number, number, number];
type Pixels = { count: number; x: number; y: number; left: number; right: number; top: number; bottom: number };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const basemap = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#ffffff' } }] };
const feature = (location: [number, number], airborne = false): MapFeature => ({ type: 'Feature', id: 'model', properties: {},
  geometry: { type: 'Point', coordinates: location }, entity: { heading: 0, model: { id: 'asset', minimumSizePixels: 0 },
    ...(airborne ? { altitude: { meters: 8, reference: 'ground' as const } } : {}) } });
async function idle(viewport: Viewport) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Placement map did not settle')), 15000);
    viewport.map.once('idle', () => { clearTimeout(timer); resolve(); }); viewport.map.triggerRepaint();
  });
}
function reference(viewport: Viewport) {
  let input: CustomRenderMethodInput | undefined;
  viewport.map.addLayer({ id: 'placement-reference', type: 'custom', renderingMode: '3d', render(_gl, frame) { input = frame; } });
  return () => { if (!input) throw new Error('No placement projection frame'); return input; };
}
async function pixels(viewport: Viewport) {
  return new Promise<{ red: Pixels; green: Pixels; blue: Pixels }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Placement pixels timed out')), 8000);
    viewport.map.once('render', () => {
      clearTimeout(timer);
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
      if (!gl) { reject(new Error('WebGL2 unavailable')); return; }
      const bytes = new Uint8Array(canvas.width * canvas.height * 4), ratio = canvas.width / canvas.clientWidth;
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      const empty = (): Pixels => ({ count: 0, x: 0, y: 0, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
      const result = { red: empty(), green: empty(), blue: empty() };
      for (let i = 0; i < bytes.length; i += 4) {
        const r = bytes[i]!, g = bytes[i + 1]!, b = bytes[i + 2]!;
        const target = r > 100 && g < 50 && b < 50 ? result.red : g > 100 && r < 50 && b < 50 ? result.green : b > r + 30 && b > g + 30 ? result.blue : undefined;
        if (!target) continue;
        const x = (i / 4 % canvas.width + .5) / ratio, y = (canvas.height - Math.floor(i / 4 / canvas.width) - .5) / ratio;
        target.count++; target.x += x; target.y += y; target.left = Math.min(target.left, x); target.right = Math.max(target.right, x);
        target.top = Math.min(target.top, y); target.bottom = Math.max(target.bottom, y);
      }
      for (const value of Object.values(result)) if (value.count) { value.x /= value.count; value.y /= value.count; }
      resolve(result);
    }); viewport.map.triggerRepaint();
  });
}

// Independent double-precision reference from the documented geographic/meter input and MapLibre's matrices.
function project(viewport: Viewport, input: CustomRenderMethodInput, anchor: Vec3, offset: Vec3) {
  const radians = Math.PI / 180, radius = 6371008.8, units = 1 / (2 * Math.PI * radius * Math.cos(anchor[1] * radians));
  const x = (anchor[0] + 180) / 360 + offset[0] * units;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + anchor[1] * radians / 2)) / Math.PI) / 2 - offset[1] * units;
  const height = anchor[2] + offset[2], copy = Math.round((viewport.map.getCenter().lng - anchor[0]) / 360);
  const multiply = (matrix: ArrayLike<number>, value: number[]) => [0, 1, 2, 3].map(row =>
    matrix[row]! * value[0]! + matrix[row + 4]! * value[1]! + matrix[row + 8]! * value[2]! + matrix[row + 12]!);
  const d = input.defaultProjectionData;
  let clip = multiply(d.mainMatrix, [x + copy, y, height * units]);
  if (input.shaderData.define.includes('GLOBE')) {
    const lon = x * Math.PI * 2 - Math.PI, lat = 2 * Math.atan(Math.exp(Math.PI - y * Math.PI * 2)) - Math.PI / 2, r = 1 + height / radius;
    const sphere = multiply(d.mainMatrix, [Math.sin(lon) * Math.cos(lat) * r, Math.sin(lat) * r, Math.cos(lon) * Math.cos(lat) * r]);
    const flat = multiply(d.fallbackMatrix, [x + copy, y, height * units]);
    clip = sphere.map((value, axis) => value * d.projectionTransition + flat[axis]! * (1 - d.projectionTransition));
  }
  const canvas = viewport.map.getCanvas();
  return { x: (clip[0]! / clip[3]! + 1) * canvas.clientWidth / 2, y: (1 - clip[1]! / clip[3]!) * canvas.clientHeight / 2 };
}
function closePixel(actual: Pixels, expected: { x: number; y: number }, description: string) {
  check(actual.count > 0, `${description} did not draw`);
  check(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= 1,
    `${description} center ${actual.x},${actual.y} differs from ${expected.x},${expected.y}`);
}

function rasterBounds(viewport: Viewport, points: { x: number; y: number }[]) {
  const cross = (a: typeof points[number], b: typeof a, c: typeof a) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y), hull: typeof points = [];
  for (const sequence of [sorted, [...sorted].reverse()]) {
    const edge: typeof points = [];
    for (const point of sequence) {
      while (edge.length >= 2 && cross(edge[edge.length - 2]!, edge[edge.length - 1]!, point) <= 0) edge.pop();
      edge.push(point);
    }
    hull.push(...edge.slice(0, -1));
  }
  const mapCanvas = viewport.map.getCanvas(), ratio = mapCanvas.width / mapCanvas.clientWidth;
  const canvas = document.createElement('canvas'); canvas.width = mapCanvas.width; canvas.height = mapCanvas.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Reference raster needs a canvas');
  context.scale(ratio, ratio); context.beginPath(); hull.forEach(point => context.lineTo(point.x, point.y)); context.closePath(); context.fill();
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 205) {
    const x = (i / 4 % canvas.width + .5) / ratio, y = (Math.floor(i / 4 / canvas.width) + .5) / ratio;
    bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
  }
  return bounds;
}


export const modelPlacementCases = {
  "Model heading pitch roll and authored offset preserve physical axes": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 18, pitch: 60, bearing: 0 },
      elevationSampler: { sample: () => 0 }, entityModels: { switchDistanceMeters: 1e9, deadZoneMeters: 0, minimumSizePixels: 0 },
      style: () => ({ radius: 0, color: '#fff', modelAppearance: { mode: 'original' } }), logger: () => {} }));

    try {
      await viewport.ready; const frame = reference(viewport), unit = 6, diagonal = unit * Math.sqrt(3) / 2;
      await viewport.registerModel('asset', { bytes: axisModelGlb(), metersPerUnit: 2 });
      for (const projection of ['flat', 'globe'] as const) {
        viewport.configure({ projection });
        for (const variant of [
          { heading: 0, pitch: 0, roll: 0, nose: [0, unit, 0], right: [unit, 0, 0], up: [0, 0, unit] },
          { heading: 90, pitch: 0, roll: 0, nose: [unit, 0, 0], right: [0, -unit, 0], up: [0, 0, unit] },
          { heading: 0, pitch: 30, roll: 0, nose: [0, diagonal, unit / 2], right: [unit, 0, 0], up: [0, -unit / 2, diagonal] },
          { heading: 0, pitch: 0, roll: 30, nose: [0, unit, 0], right: [diagonal, 0, -unit / 2], up: [unit / 2, 0, diagonal] },
        ] satisfies { heading: number; pitch: number; roll: number; nose: Vec3; right: Vec3; up: Vec3 }[]) {
          const entity = feature([0, 0], true); Object.assign(entity.entity!, { heading: variant.heading, pitch: variant.pitch, roll: variant.roll });
          viewport.upsert([entity]); await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'oriented model'); await idle(viewport);
          const actual = await pixels(viewport), input = frame();
          closePixel(actual.red, project(viewport, input, [0, 0, 8], variant.nose), 'nose');
          closePixel(actual.green, project(viewport, input, [0, 0, 8], variant.right), 'physical right');
          closePixel(actual.blue, project(viewport, input, [0, 0, 8], variant.up), 'up');
        }
        await viewport.registerModel('asset', { bytes: axisModelGlb(true), metersPerUnit: 2, headingOffset: 90 });
        const entity = feature([0, 0], true); Object.assign(entity.entity!, { pitch: 30 }); viewport.upsert([entity]); await idle(viewport);
        const actual = await pixels(viewport), input = frame();
        closePixel(actual.red, project(viewport, input, [0, 0, 8], [0, diagonal, unit / 2]), 'corrected authored nose');
        closePixel(actual.green, project(viewport, input, [0, 0, 8], [unit, 0, 0]), 'corrected authored right');
        await viewport.registerModel('asset', { bytes: axisModelGlb(), metersPerUnit: 2 });
      }
      let sawBlend = false;
      for (const projection of ['flat', 'globe'] as const) {
        viewport.configure({ projection });
        for (const zoom of projection === 'globe' ? [11, 11.25, 11.5, 11.75, 12, 18, 19, 20] : [18, 19, 20]) {
          const metersPerUnit = 2 ** (19 - zoom), unit = 3 * metersPerUnit, altitude = 4 * metersPerUnit;
          await viewport.registerModel('asset', { bytes: axisModelGlb(), metersPerUnit });
          for (const [longitude, copy] of [[6.87, 0], [179.99999, 1], [-179.99999, -1]] as const) {
            viewport.map.jumpTo({ center: [longitude + copy * 360, 46], zoom, pitch: 35, bearing: 23 });
            const entity = feature([longitude, 46], true); entity.entity!.altitude = { meters: altitude, reference: 'ground' };
            viewport.upsert([entity]); await idle(viewport);
            const actual = await pixels(viewport), input = frame(), anchor: Vec3 = [longitude, 46, altitude];
            const blend = input.defaultProjectionData.projectionTransition; sawBlend ||= blend > 0 && blend < 1;
            const description = `${projection}, zoom ${zoom}, longitude ${longitude}, copy ${copy}, blend ${blend}`;
            closePixel(actual.red, project(viewport, input, anchor, [0, unit, 0]), `nose: ${description}`);
            closePixel(actual.green, project(viewport, input, anchor, [unit, 0, 0]), `right: ${description}`);
            closePixel(actual.blue, project(viewport, input, anchor, [0, 0, unit]), `up: ${description}`);
            check(viewport.getFeature('model')?.geometry.coordinates[0] === longitude, 'World-copy projection changed the geographic anchor');
          }
        }
      }
      check(sawBlend, 'Model precision cases did not exercise continuous globe blending');
      viewport.map.jumpTo({ center: [0, 0], zoom: 3, pitch: 0, bearing: 0 });
      await viewport.registerModel('asset', { bytes: axisModelGlb(), metersPerUnit: 100000 });
      const planetary = feature([0, 0], true); planetary.entity!.altitude = { meters: 400000, reference: 'sea-level' };
      viewport.upsert([planetary]); await idle(viewport);
      check((await pixels(viewport)).red.count > 0, 'Planet hiding fixture has no visible front model');
      planetary.geometry.coordinates = [180, 0]; viewport.upsert([planetary]); await idle(viewport);
      const hidden = await pixels(viewport);
      check(hidden.red.count + hidden.green.count + hidden.blue.count === 0, 'The model rendered through the planet');
    } finally { viewport.destroy(); }
  },
  "Ground models follow planar terrain at real and enlarged size": async (context) => {
    const terrain = planarTerrain(), viewport = context.own(createViewport({ container: context.container, basemap, terrain: true, elevation: terrain.elevation,
      elevationSampler: { sample: terrain.sample }, camera: { center: terrain.location, zoom: 18, pitch: 60, bearing: 23 },
      style: () => ({ radius: 0, color: '#fff', modelAppearance: { mode: 'color', color: '#ff0000' } }), logger: () => {} }));

    try {
      await viewport.ready; const frame = reference(viewport); await viewport.registerModel('asset', { bytes: groundModelGlb() });
      const normalize = (v: Vec3): Vec3 => { const length = Math.hypot(...v); return [v[0] / length, v[1] / length, v[2] / length]; };
      for (const pixelRatio of [1, 2]) for (const exaggeration of [1, 2]) for (const minimumSizePixels of [0, 40]) {
        viewport.map.setPixelRatio(pixelRatio); viewport.configure({ exaggeration });
        const entity = feature(terrain.location); entity.entity!.heading = 37; entity.entity!.model!.minimumSizePixels = minimumSizePixels;
        viewport.upsert([entity]); await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'ground model'); await idle(viewport);
        const actual = (await pixels(viewport)).red, input = frame(), angle = 37 * Math.PI / 180;
        const a = terrain.eastSlope * exaggeration, b = terrain.northSlope * exaggeration;
        const up = normalize([-a, -b, 1]), forward = normalize([Math.sin(angle), Math.cos(angle), a * Math.sin(angle) + b * Math.cos(angle)]);
        const right = normalize([forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]]);
        const bounds = (scale: number) => {
          const center = 100 * exaggeration + scale * Math.sqrt(1 + a * a + b * b) + .02;
          const points = [-2, 2].flatMap(x => [-1, 1].flatMap(y => [-2, 2].map(z => {
            const offset: Vec3 = [0, 0, 0]; for (let axis = 0; axis < 3; axis++) offset[axis] = (-x * right[axis]! + y * up[axis]! + z * forward[axis]!) * scale;
            return project(viewport, input, [...terrain.location, center], offset);
          })));
          const left = Math.min(...points.map(p => p.x)), rightEdge = Math.max(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
          return { points, size: Math.max(rightEdge - left, bottom - top) };
        };
        let scale = 1;
        if (minimumSizePixels && bounds(1).size < minimumSizePixels) {
          let lo = 1, hi = 2; while (bounds(hi).size < minimumSizePixels) hi *= 2;
          for (let step = 0; step < 30; step++) { const mid = (lo + hi) / 2; if (bounds(mid).size < minimumSizePixels) lo = mid; else hi = mid; } scale = hi;
        }
        // Compare equivalent opaque raster coverage. A sharp projected corner need not cover its extreme pixel.
        const expected = rasterBounds(viewport, bounds(scale).points); check(actual.count > 20, 'Ground model did not draw');
        for (const side of ['left', 'right', 'top', 'bottom'] as const)
          check(Math.abs(actual[side] - expected[side]) <= 1, `Ground ${side} differs: ${JSON.stringify({ actual, expected, scale, minimumSizePixels, exaggeration, pixelRatio })}`);
        check(viewport.getFeature('model')?.geometry.coordinates[0] === terrain.location[0], 'Ground contact changed the geographic anchor');
      }
      viewport.map.setPixelRatio(1); viewport.configure({ exaggeration: 1 });
      const attached = feature(terrain.location);
      attached.entity!.attachments = [{ id: 'physical-zone', type: 'polygon', color: '#0000ff', vertices: [[8, -6], [18, -6], [18, 6], [8, 6]] }];
      viewport.upsert([attached]); await idle(viewport); const physical = await pixels(viewport);
      attached.entity!.model!.minimumSizePixels = 40; viewport.upsert([attached]); await idle(viewport); const enlarged = await pixels(viewport);
      check(physical.blue.count > 15 && enlarged.blue.count > 15, 'Physical attachment has no visible pixels');
      check(enlarged.red.right - enlarged.red.left > 1.5 * (physical.red.right - physical.red.left), 'Attachment comparison did not enlarge the model');
      for (const side of ['left', 'right', 'top', 'bottom'] as const)
        check(Math.abs(physical.blue[side] - enlarged.blue[side]) <= .5, `Model enlargement moved the physical attachment ${side}`);
    } finally { viewport.destroy(); }
  },
  "Model placement recovers from unknown terrain without moving entities": async (context) => {
    const terrain = planarTerrain(0, 0), known = new Map<string, number>();
    const requests: { positions: readonly [number, number][]; signal: AbortSignal; done: boolean; resolve(): void }[] = [];
    const viewport = context.own(createViewport({ container: context.container, basemap, terrain: true, elevation: terrain.elevation,
      camera: { center: terrain.location, zoom: 18, pitch: 45, bearing: 0 },
      elevationSampler: { sample: (lng, lat) => known.get(`${lng},${lat}`) ?? null,
        prepare: (positions, signal) => new Promise<void>(resolve => requests.push({ positions, signal, done: false, resolve })) },
      style: () => ({ color: '#00ff00', radius: 6, modelAppearance: { mode: 'color', color: '#ff0000' } }), logger: () => {} }));

    const complete = () => { for (const request of requests) if (!request.done) { request.done = true;
      for (const point of request.positions) known.set(point.join(','), 100); request.resolve(); } };
    try {
      await viewport.ready; await viewport.registerModel('asset', { bytes: groundModelGlb() });
      viewport.upsert([feature(terrain.location)]);
      await context.until(() => requests.length > 0, 'initial terrain preparation'); await idle(viewport);
      check(viewport.getEntityState('model')?.representation !== 'model', 'Unknown terrain became a model');
      const unknown = await pixels(viewport);
      check(unknown.red.count === 0, 'Unknown terrain was drawn as height zero');
      check(unknown.green.count > 0, 'Unknown terrain lost the fallback point');
      for (let round = 0; round < 8 && viewport.getEntityState('model')?.representation !== 'model'; round++) {
        complete(); await context.until(() => requests.some(request => !request.done && !request.signal.aborted) || viewport.getEntityState('model')?.representation === 'model', 'stationary terrain recovery');
      }
      check(viewport.getEntityState('model')?.representation === 'model', 'Prepared terrain did not recover without another entity update');
      await idle(viewport); check((await pixels(viewport)).red.count > 20, 'Recovered model has no pixels');
      const invalid = feature(terrain.location); invalid.entity!.altitude = { meters: -1, reference: 'ground' }; viewport.upsert([invalid]);
      await context.until(() => viewport.getEntityState('model')?.placement === 'below-terrain', 'below terrain placement'); await idle(viewport);
      check((await pixels(viewport)).red.count === 0, 'Below-terrain model remained visible');
      const valid = feature(terrain.location, true); viewport.upsert([valid]);
      await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'valid airborne recovery');
      known.clear(); viewport.configure({ elevation: { ...terrain.elevation, attribution: 'replacement provider' } });
      await context.until(() => requests.some(request => !request.done && !request.signal.aborted), 'replacement provider preparation');
      viewport.remove(['model']);
      check(requests.every(request => request.done || request.signal.aborted), 'Removal retained active preparation');
      complete(); await idle(viewport);
      check(!viewport.getEntityState('model') && !viewport.getFeature('model'), 'Cancelled terrain completion resurrected the entity');
      check((await pixels(viewport)).red.count === 0, 'Removed entity retained model pixels');
      await idle(viewport); let rendered = 0; const count = () => { rendered++; }; viewport.map.on('render', count);
      await new Promise(resolve => setTimeout(resolve, 5000)); viewport.map.off('render', count);
      check(rendered === 0, 'Placement recovery left a render loop');
    } finally { complete(); viewport.destroy(); }
  },
} satisfies BrowserCaseModule;
