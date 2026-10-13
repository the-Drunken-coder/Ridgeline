import { attachInteractions, createViewport } from '@ridgeline/map';
import type { MapFeature, ModelAppearance, Viewport } from '@ridgeline/map';
import { GeoJSONSource } from 'maplibre-gl';
import { materialGlb } from './model-material-fixtures';
import { groundModelGlb } from './model-placement-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
type Pixels = { bytes: Uint8Array; width: number; height: number; ratio: number };
async function idle(viewport: Viewport) {
  await new Promise<void>(resolve => { viewport.map.once('idle', () => resolve()); viewport.map.triggerRepaint(); });
}
async function pixels(viewport: Viewport): Promise<Pixels> {
  await new Promise<void>(resolve => { viewport.map.once('render', () => resolve()); viewport.map.triggerRepaint(); });
  return new Promise(resolve => {
    viewport.map.once('render', () => {
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      resolve({ bytes, width: canvas.width, height: canvas.height, ratio: viewport.map.getPixelRatio() });
    }); viewport.map.triggerRepaint();
  });
}
function centerBrightness(image: Pixels) {
  let value = 0;
  for (let y = image.height / 2 - 4; y < image.height / 2 + 4; y++) for (let x = image.width / 2 - 4; x < image.width / 2 + 4; x++) {
    const index = (Math.floor(y) * image.width + Math.floor(x)) * 4;
    value += image.bytes[index]! + image.bytes[index + 1]! + image.bytes[index + 2]!;
  }
  return value / 64;
}
function region(image: Pixels, predicate: (r: number, g: number, b: number) => boolean,
  clip?: { left: number; right: number; top: number; bottom: number }) {
  let count = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let i = 0; i < image.bytes.length; i += 4) if (predicate(image.bytes[i]!, image.bytes[i + 1]!, image.bytes[i + 2]!)) {
    const x = (i / 4 % image.width + .5) / image.ratio, y = (image.height - Math.floor(i / 4 / image.width) - .5) / image.ratio;
    if (clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom)) continue;
    count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { count, left, right, top, bottom };
}
const red = (r: number, g: number, b: number) => r > 150 && g < 70 && b < 70;
const blue = (r: number, g: number, b: number) => b > 120 && b > r + 70 && b > g + 70;
const orange = (r: number, g: number, b: number) => r > 220 && g > 100 && g < 190 && b < 80;
const feature = (floor = 0, altitude: number | null = 20): MapFeature => ({ type: 'Feature', id: 'instance', properties: {},
  geometry: { type: 'Point', coordinates: [0, 0] }, entity: { heading: 0,
    model: { id: 'body', minimumSizePixels: floor }, ...(altitude === null ? {} : { altitude: { meters: altitude, reference: 'ground' as const } }) } });
export const modelPresentationCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Model feedback preserves appearance and follows model altitude', async run(context) {
    let appearance: ModelAppearance | undefined;
    const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
      camera: { center: [0, 0], zoom: 18, pitch: 0 }, features: [feature()], elevationSampler: { sample: () => 0 },
      style: () => ({ modelAppearance: appearance }), logger: () => {} });
    context.setCurrent(viewport);
    const interactions = attachInteractions(viewport, { picker: false });
    try {
      await viewport.ready;
      await viewport.registerModel('body', { bytes: materialGlb([{ unlit: true, baseColor: [.1, .3, .5, 1] }]), metersPerUnit: 10 });
      await context.until(() => viewport.getEntityState('instance')?.representation === 'model', 'model feedback subject');
      for (appearance of [undefined, { mode: 'color', color: 'rebeccapurple' }, { mode: 'original' }] as const) {
        viewport.upsert([feature()]);
        const baseline = centerBrightness(await pixels(viewport));
        viewport.preview('instance'); const hover = centerBrightness(await pixels(viewport));
        viewport.setSelection(['instance']); const both = centerBrightness(await pixels(viewport));
        viewport.preview(null); const selected = centerBrightness(await pixels(viewport));
        check(hover > baseline + 15, `Hover did not brighten ${appearance?.mode ?? 'fallback'}: ${baseline}/${hover}`);
        check(selected > hover + 10 && both === selected, 'Selection did not win with stronger temporary brightening');
        viewport.setSelection([]);
        check(centerBrightness(await pixels(viewport)) === baseline, 'Clearing feedback changed assigned material appearance');
      }
      if (!window.drawingPointer) throw new Error('Actual pointer bridge unavailable');
      const baseline = centerBrightness(await pixels(viewport));
      await window.drawingPointer('move', 320, 180);
      check(centerBrightness(await pixels(viewport)) > baseline + 15, 'Actual pointer hover did not brighten the model');
      await window.drawingPointer('move', 5, 5);
      check(centerBrightness(await pixels(viewport)) === baseline, 'Leaving the model retained hover brightening');
      appearance = { mode: 'color', color: '#0000ff' };
      for (const altitude of [null, 25]) for (const floor of [0, 90]) {
        viewport.map.jumpTo({ pitch: 55, bearing: 27 }); viewport.upsert([feature(floor, altitude)]); await idle(viewport);
        const body = region(await pixels(viewport), blue);
        viewport.setSelection(['instance']); const ring = region(await pixels(viewport), orange);
        check(body.count > 20 && ring.count > 100, 'Ground/airborne real/enlarged feedback has no visible body or ring');
        check(ring.left < body.left - 3 && ring.right > body.right + 3 && ring.top < body.top - 3 && ring.bottom > body.bottom + 3,
          'Feedback ring did not enclose the displayed model at its altitude');
        check(Math.abs((ring.top + ring.bottom - body.top - body.bottom) / 2) < 4,
          'Airborne feedback ring followed the ground marker instead of the model');
        viewport.setSelection([]);
      }
      viewport.map.jumpTo({ pitch: 0, bearing: 0 });
      appearance = { mode: 'original' }; viewport.upsert([feature()]);
      for (const alphaMode of ['MASK', 'BLEND'] as const) {
        const bytes = materialGlb([{ image: 'alpha', unlit: true, baseColor: [.1, .3, .5, .8],
          alphaMode, alphaCutoff: .3, doubleSided: true, backFace: true }]);
        const original = new Uint8Array(bytes).slice();
        await viewport.registerModel('body', { bytes, metersPerUnit: 10 });
        const baseline = await pixels(viewport), bounds = region(baseline, (r, g, b) => r < 245 || g < 245 || b < 245);
        check(bounds.count > 100, `${alphaMode}: original double-sided fixture has no body`);
        viewport.setSelection(['instance']); const selected = await pixels(viewport);
        let changed = 0;
        for (let i = 0; i < baseline.bytes.length; i += 4) {
          const x = i / 4 % baseline.width + .5, y = baseline.height - Math.floor(i / 4 / baseline.width) - .5;
          if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
          const before = baseline.bytes[i]! + baseline.bytes[i + 1]! + baseline.bytes[i + 2]!;
          const after = selected.bytes[i]! + selected.bytes[i + 1]! + selected.bytes[i + 2]!;
          if (before === 765) check(after === before, `${alphaMode}: feedback filled transparent texels`);
          else { check(after >= before, `${alphaMode}: feedback darkened original materials`); if (after > before + 5) changed++; }
        }
        check(changed > 100 && region(selected, orange).count > 100, `${alphaMode}: original material feedback was unreadable`);
        viewport.setSelection([]); const restored = await pixels(viewport);
        check(restored.bytes.every((value, index) => value === baseline.bytes[index]), `${alphaMode}: clearing feedback did not restore the exact material frame`);
        check(new Uint8Array(bytes).every((value, index) => value === original[index]), 'Feedback modified the source GLB');
      }
    } finally { interactions.destroy(); viewport.destroy(); }
  } },
  { name: 'Model labels wait for current collision layout beyond enlarged bounds', async run(context) {
    let label = '';
    const glyphs = new URL('./fixtures/noto-sans/0-255.pbf', import.meta.url).href + '?fontstack={fontstack}&range={range}';
    const basemap = { version: 8 as const, glyphs, sources: {}, layers: [
      { id: 'background', type: 'background' as const, paint: { 'background-color': '#ffffff' } }] };
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 17, pitch: 0 },
      elevationSampler: { sample: () => 0 }, style: () => ({ label, radius: 0, modelAppearance: { mode: 'color', color: '#ff0000' } }), logger: () => {} });
    context.setCurrent(viewport);
    try {
      await viewport.ready; await viewport.registerModel('body', { bytes: groundModelGlb() });
      viewport.upsert([feature(90, null)]); await idle(viewport);
      const unlabeledSource = viewport.map.getSource('rl:features'); if (!(unlabeledSource instanceof GeoJSONSource)) throw new Error('No native source');
      const nativeUpdate = unlabeledSource.updateData; let layouts = 0;
      unlabeledSource.updateData = function (diff) { layouts++; return nativeUpdate.call(this, diff); };
      viewport.map.jumpTo({ pitch: 55, bearing: 27 }); await idle(viewport);
      unlabeledSource.updateData = nativeUpdate;
      check(layouts === 0, `Camera movement republished ${layouts} native layouts for a model without a label`);
      label = 'LABEL'; viewport.map.jumpTo({ pitch: 0, bearing: 0 });
      viewport.upsert([feature(0, null)]); viewport.map.setPaintProperty('rl:labels', 'text-color', '#0000ff'); await idle(viewport);
      check(region(await pixels(viewport), blue).count > 50, 'Baseline native label has no real glyph pixels');
      const source = viewport.map.getSource('rl:features'); if (!(source instanceof GeoJSONSource)) throw new Error('No native feature source');
      const update = source.updateData, pending: (() => Promise<void>)[] = [];
      source.updateData = function (diff) { return new Promise<void>((resolve, reject) => pending.push(() => update.call(this, diff).then(resolve, reject))); };
      viewport.upsert([feature(90, null)]);
      await context.until(() => pending.length > 0, 'held native label layout publication');
      const held = await pixels(viewport);
      check(region(held, red).right - region(held, red).left > 80, 'Delayed layout did not accompany actual model enlargement');
      check(region(held, blue).count === 0, 'Old native collision layout remained visible inside the enlarged model');
      await new Promise(resolve => setTimeout(resolve, 300));
      check(region(await pixels(viewport), blue).count === 0, 'Stale label reappeared while publication remained delayed');
      source.updateData = update;
      for (const release of pending) await release(); await idle(viewport);
      const clear = (image: Pixels) => {
        const body = region(image, red), label = region(image, blue);
        check(body.count > 50 && label.count > 50 && label.top >= body.bottom + 8,
          `Native collision label did not clear actual model pixels: ${JSON.stringify({ body, label })}`);
      };
      clear(await pixels(viewport));
      const second = feature(90, null); second.id = 'second'; viewport.upsert([second]); await idle(viewport);
      check(new Set(viewport.map.queryRenderedFeatures({ layers: ['rl:labels'] }).map(hit => hit.id)).size === 1,
        'Model label offset disabled native collision suppression');
      viewport.remove(['second']);
      for (const altitude of [null, 25]) {
        viewport.map.jumpTo({ pitch: 55, bearing: 27 }); viewport.upsert([feature(90, altitude)]); await idle(viewport); clear(await pixels(viewport));
      }
      viewport.configure({ basemap: { ...basemap, layers: [{ ...basemap.layers[0]!, id: 'replacement-background' }] } });
      await context.until(() => viewport.map.getSource('rl:features') !== source && Boolean(viewport.map.getLayer('rl:labels')), 'new label source generation');
      viewport.map.setPaintProperty('rl:labels', 'text-color', '#0000ff'); await idle(viewport); clear(await pixels(viewport));
      viewport.remove(['instance']); viewport.upsert([feature(90, 25)]); await idle(viewport);
      clear(await pixels(viewport));
      label = ''; viewport.upsert([feature(90, 25)]); await idle(viewport);
      check(region(await pixels(viewport), blue).count === 0, 'Cleared model label retained glyphs');
      check(viewport.map.querySourceFeatures('rl:features').every(hit => hit.properties?._rl_label_stamp === ''), 'Clearing text retained its enlarged layout stamp');
      label = 'LABEL'; viewport.upsert([feature(90, 25)]); await idle(viewport); clear(await pixels(viewport));
      if (!window.drawingPointer) throw new Error('Actual pointer bridge unavailable');
      let clicked: string[] = []; const unclick = viewport.on('click', event => { clicked = event.features.map(feature => feature.id); });
      const visibleLabel = region(await pixels(viewport), blue);
      await window.drawingPointer('click', (visibleLabel.left + visibleLabel.right) / 2, (visibleLabel.top + visibleLabel.bottom) / 2);
      check(clicked[0] === 'instance', 'Native model label lost its public click target');
      viewport.map.jumpTo({ pitch: 0, bearing: 0 }); viewport.upsert([feature(90, null)]); await idle(viewport);
      const oldLabel = region(await pixels(viewport), blue), point: [number, number] = [(oldLabel.left + oldLabel.right) / 2, (oldLabel.top + oldLabel.bottom) / 2];
      const currentSource = viewport.map.getSource('rl:features'); if (!(currentSource instanceof GeoJSONSource)) throw new Error('No current native source');
      const apply = currentSource.updateData, heldLayouts: (() => Promise<void>)[] = [];
      currentSource.updateData = function (diff) { return new Promise<void>((resolve, reject) => heldLayouts.push(() => apply.call(this, diff).then(resolve, reject))); };
      viewport.upsert([feature(120, null)]); await context.until(() => heldLayouts.length > 0, 'held second label enlargement');
      const hidden = await pixels(viewport);
      check(region(hidden, blue).count === 0 && point[1] > region(hidden, red).bottom + 13, 'Stale label pick fixture is not outside the current body');
      check(viewport.map.queryRenderedFeatures(point, { layers: ['rl:labels'] }).length > 0, 'Stale native label bucket disappeared before the hit check');
      clicked = []; await window.drawingPointer('click', ...point);
      check(clicked.length === 0, 'Opacity-zero stale native label remained a public hit');
      currentSource.updateData = apply; for (const release of heldLayouts) await release(); await idle(viewport); unclick();
      check(viewport.map.querySourceFeatures('rl:features').every(hit => JSON.stringify(hit.properties?._rl_label_font) === JSON.stringify(['Noto Sans Regular'])),
        'Model labels changed the default font contract');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model enlargement preserves physical attachments and quiet presentation', async run(context) {
    const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
      camera: { center: [0, 0], zoom: 18, pitch: 55, bearing: 27 }, elevationSampler: { sample: () => 0 },
      entityVisibility: { footprints: true, zones: true, groundLines: true },
      style: () => ({ color: '#00ff00', modelAppearance: { mode: 'color', color: '#ff0000' } }), logger: () => {} });
    context.setCurrent(viewport);
    try {
      await viewport.ready; await viewport.registerModel('body', { bytes: groundModelGlb() });
      for (const attachment of [
        { id: 'ground-zone', type: 'polygon' as const, color: '#0000ff', vertices: [[15, -5], [25, -5], [25, 5], [15, 5]] as [number, number][] },
        { id: 'volume', type: 'sphere' as const, color: '#0000ff', radius: 20 },
        { id: 'sensor', type: 'camera' as const, color: '#0000ff', bearing: 90, elevation: -35, fovX: 35, fovY: 25, range: 70, wireframe: true, volumeOpacity: .15 },
      ]) {
        const entity = feature(0, 25); entity.entity!.attachments = [attachment]; viewport.upsert([entity]); await idle(viewport);
        const physical = await pixels(viewport);
        entity.entity!.model!.minimumSizePixels = 45; viewport.upsert([entity]); await idle(viewport); const enlarged = await pixels(viewport);
        const bodyA = region(physical, red), bodyB = region(enlarged, red);
        check(bodyB.right - bodyB.left > (bodyA.right - bodyA.left) * 1.5, 'Attachment fixture did not enlarge the visible body');
        const cover = { left: Math.min(bodyA.left, bodyB.left) - 2, right: Math.max(bodyA.right, bodyB.right) + 2,
          top: Math.min(bodyA.top, bodyB.top) - 2, bottom: Math.max(bodyA.bottom, bodyB.bottom) + 2 };
        // A larger opaque body may hide the physical sensor apex. Every physical pixel
        // beyond those body bounds must remain fixed, including the sensor's outgoing edges.
        for (let i = 0; i < physical.bytes.length; i += 4) {
          const x = i / 4 % physical.width + .5, y = physical.height - Math.floor(i / 4 / physical.width) - .5;
          if (x >= cover.left && x <= cover.right && y >= cover.top && y <= cover.bottom) {
            physical.bytes.fill(255, i, i + 4); enlarged.bytes.fill(255, i, i + 4); continue;
          }
          check(blue(physical.bytes[i]!, physical.bytes[i + 1]!, physical.bytes[i + 2]!) ===
            blue(enlarged.bytes[i]!, enlarged.bytes[i + 1]!, enlarged.bytes[i + 2]!), `Enlargement moved a visible ${attachment.type} pixel`);
        }
        const a = region(physical, blue), b = region(enlarged, blue);
        check(a.count > 10 && b.count > 10, `No physical pixels for ${attachment.type}`);
        for (const side of ['left', 'right', 'top', 'bottom'] as const)
          check(Math.abs(a[side] - b[side]) <= 1, `Enlargement moved ${attachment.type} ${side}: ${a[side]}/${b[side]}`);
        const ground = (r: number, g: number, b: number) => g > 100 && g > r + 10 && g > b + 10;
        const before = region(physical, ground), after = region(enlarged, ground);
        check(before.count > 0 && after.count > 0, `No visible physical ground line: ${JSON.stringify({ before, after, attachment })}`);
        check(Math.abs(before.bottom - after.bottom) <= .5 && Math.abs(before.left - after.left) <= .5 && Math.abs(before.right - after.right) <= .5,
          'Enlargement moved physical ground marker/line');
        const anchor = viewport.map.project([0, 0]);
        const clip = { left: anchor.x - 2, right: anchor.x + 2, top: anchor.y - 6, bottom: anchor.y + 2 };
        for (const image of [physical, enlarged]) {
          const endpoint = region(image, ground, clip);
          check(endpoint.count >= 3 && Math.abs(endpoint.bottom - anchor.y) <= 1.5,
            `Physical ground line missed the independent geographic ground endpoint: ${JSON.stringify({ endpoint, anchor, attachment })}`);
        }
      }
      viewport.unregisterModel('body'); viewport.upsert([feature(0, null)]); await idle(viewport);
      const fallback = await pixels(viewport);
      check(viewport.getEntityState('instance')?.representation === 'icon', 'Ground marker fixture did not use eligible fallback');
      viewport.upsert([feature(90, null)]); await idle(viewport);
      const enlargedFallback = await pixels(viewport);
      check(enlargedFallback.bytes.every((value, index) => value === fallback.bytes[index]), 'Model size floor changed the physical fallback ground marker');
      await viewport.registerModel('body', { bytes: groundModelGlb() }); await idle(viewport);
      viewport.setSelection(['instance']); await idle(viewport);
      // Selection queues scene work, then native publication on the following frame.
      // The first MapLibre idle can precede that already-scheduled publication.
      await new Promise(resolve => setTimeout(resolve, 300)); await idle(viewport);
      let renders = 0; const count = () => renders++; viewport.map.on('render', count);
      await new Promise(resolve => setTimeout(resolve, 5000)); viewport.map.off('render', count);
      check(renders === 0, `Static selected model scheduled ${renders} idle frames`);
    } finally { viewport.destroy(); }
  } },
];
