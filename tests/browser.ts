import { checkGpuVote } from './gpu-vote';
import { browserCases } from './browser-cases';
import { createViewport, createDrawingSession, attachInteractions, attachDrawing, attachDrawingControls, shapeGeometry, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature, Viewport } from '@ridgeline/map';
import { MercatorCoordinate, GeoJSONSource, ErrorEvent as MapErrorEvent, setWorkerUrl, addProtocol, removeProtocol } from 'maplibre-gl';
import type { CustomLayerInterface, ImageSource, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';

declare global {
  interface Window {
    drawingPointer?: (action: 'move' | 'click', x: number, y: number) => Promise<void>;
    browserKey?: (key: string) => Promise<void>;
    browserKeyDown?: (key: string) => Promise<void>;
    browserKeyUp?: (key: string) => Promise<void>;
    browserStationaryClick?: () => Promise<void>;
    browserDrag?: (fromX: number, fromY: number, toX: number, toY: number, button?: 'left' | 'right') => Promise<void>;
    browserClick?: (selector: string) => Promise<void>;
    cleanupBrowserCase?: () => void;
    browserMouse?: (action: 'down' | 'move' | 'up' | 'click', x: number, y: number) => Promise<void>;
    browserFill?: (selector: string, value: string) => Promise<void>;
  }
}

setWorkerUrl(workerUrl);
const container = document.querySelector<HTMLDivElement>('#map')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const style = (color = '#e9efea'): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': color } }] });
const point = (id: string, lng = 0): MapFeature => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [lng, 0] } });
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
let current: Viewport | undefined;
const selectedCase = new URLSearchParams(location.search).get('case');
let ran = false;
const registeredCases: string[] = [];
status.dataset.state = 'running';
async function until(predicate: () => boolean, description: string, timeout = 8_000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${description}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
async function run(name: string, test: () => Promise<void>) {
  registeredCases.push(name);
  if (name !== selectedCase) return;
  ran = true;
  const row = document.createElement('li'); row.textContent = name; results.append(row);
  try { await test(); row.className = 'pass'; row.textContent = `PASS: ${name}`; }
  catch (error) { row.className = 'fail'; row.textContent = `FAIL: ${name}: ${error instanceof Error ? error.stack : String(error)}`; throw error; }
}
async function pointer(action: 'move' | 'click', point: { x: number; y: number }) {
  const drawingPointer = window.drawingPointer;
  if (!drawingPointer) throw new Error('Playwright pointer bridge is unavailable.');
  await drawingPointer(action, point.x, point.y);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
async function browserKey(key: string) {
  if (!window.browserKey) throw new Error('Playwright keyboard bridge is unavailable.');
  await window.browserKey(key);
}
async function browserClick(selector: string) {
  if (!window.browserClick) throw new Error('Playwright click bridge is unavailable.');
  await window.browserClick(selector);
}
async function browserDrag(fromX: number, fromY: number, toX: number, toY: number) {
  if (!window.browserDrag) throw new Error('Playwright drag bridge is unavailable.');
  await window.browserDrag(fromX, fromY, toX, toY);
}
async function pixelAt(viewport: Viewport, coordinates: [number, number], timeoutMs: number, description: string): Promise<{ red: number; green: number; blue: number }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); viewport.map.off('render', onRender); };
    const onRender = () => {
      cleanup();
      try {
        const canvas = viewport.map.getCanvas();
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error(`WebGL2 unavailable while reading pixel: ${description}`);
        const scale = canvas.width / canvas.clientWidth;
        const point = viewport.map.project(coordinates);
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.round(point.x * scale), canvas.height - 1 - Math.round(point.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const [red, green, blue] = pixel;
        if (red === undefined || green === undefined || blue === undefined) throw new Error(`Incomplete pixel sample: ${description}`);
        resolve({ red, green, blue });
      } catch (error) { reject(error); }
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for map render: ${description}`));
    }, timeoutMs);
    try {
      viewport.map.on('render', onRender);
      viewport.map.triggerRepaint();
    } catch (error) { cleanup(); reject(error); }
  });
}
async function untilPixel(viewport: Viewport, coordinates: [number, number], visible: boolean, description: string) {
  const start = performance.now();
  while (true) {
    const remaining = 8_000 - (performance.now() - start);
    if (remaining <= 0) throw new Error(`Timed out: ${description}`);
    const { red, green, blue } = await pixelAt(viewport, coordinates, remaining, description);
    const isLine = Math.max(red, green, blue) - Math.min(red, green, blue) > 35;
    if (isLine === visible) return;
    if (performance.now() - start > 8_000) throw new Error(`Timed out: ${description} (${red}, ${green}, ${blue})`);
  }
}
async function suite() {
  await run('Reliability publication retires styling when callbacks replace the basemap', async () => {
    for (const initial of [true, false]) {
      let replace = initial;
      let map: Viewport | undefined;
      const diagnostics: RidgelineError[] = [];
      map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('scene-current')], logger: () => {}, onError: error => diagnostics.push(error),
        style: () => {
          if (replace && map) {
            replace = false;
            map.configure({ basemap: style('#ccddee') });
            map.upsert([point('scene-current', .03)]);
            map.setSelection(['scene-current']);
          }
          return { color: '#ff0000' };
        },
      });
      current = map;
      try {
        await map.ready;
        if (!initial) { replace = true; map.configure({ basemap: style('#eedddd') }); }
        const active = map;
        await until(() => Boolean(active.map.getLayer('rl:points')) && active.map.queryRenderedFeatures({ layers: ['rl:points'] })
          .some(hit => hit.properties._rl_feature_id === 'scene-current' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02),
          `${initial ? 'initial' : 'later'} replacement renders current geometry`);
        check(active.getSelection()[0] === 'scene-current', 'Basemap replacement lost current selection');
        check(active.map.getFeatureState({ source: 'rl:features', id: 'rl:scene-current' }).selected === true, 'Replacement lost selection display');
        check(!diagnostics.some(error => error.code === 'STYLE_FAILED'), 'Obsolete restoration reported a style failure');
      } finally { map.destroy(); }
    }
  });

  await run('Reliability publication keeps updates made during icon registration', async () => {
    let replace = false;
    const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: [point('icon-current')], logger: () => {}, style: () => {
        if (replace) { replace = false; map.upsert([point('icon-current', .03)]); }
        return { icon: 'callback-icon' };
      },
    });
    current = map;
    try {
      await map.ready;
      replace = true;
      map.registerIcon('callback-icon', { image: new ImageData(1, 1) });
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(hit =>
        hit.properties._rl_feature_id === 'icon-current' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02), 'icon refresh renders the accepted callback update');
      const feature = map.getFeature('icon-current');
      check(feature?.geometry.type === 'Point' && feature.geometry.coordinates[0] === .03, 'Icon callback update was not accepted');
    } finally { map.destroy(); }
  });
  await run('Reliability publication keeps removals and scene changes made by later icon callbacks', async () => {
    for (const action of ['remove', 'scene', 'destroy']) {
      let armed = false, afterDestroy = 0;
      const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('icon-earlier'), point('icon-trigger', -.03), point('icon-later', .06)], logger: () => {},
        style: feature => {
          if (armed && feature.id === 'icon-trigger') {
            armed = false;
            if (action === 'remove') map.remove(['icon-earlier']);
            else if (action === 'scene') { map.configure({ basemap: style('#ccddee') }); map.upsert([point('icon-earlier', .03)]); }
            else map.destroy();
          } else if (action === 'destroy' && !map.getFeature('icon-trigger') && feature.id === 'icon-later') afterDestroy++;
          return { icon: 'callback-icon' };
        },
      });
      current = map;
      try {
        await map.ready;
        armed = true;
        map.registerIcon('callback-icon', { image: new ImageData(1, 1) });
        if (action === 'destroy') { check(afterDestroy === 0, 'Styling continued after viewport destruction'); continue; }
        await map.map.once('idle');
        const hits = map.map.queryRenderedFeatures({ layers: ['rl:points'] });
        if (action === 'remove') {
          check(!map.getFeature('icon-earlier') && !hits.some(hit => hit.properties._rl_feature_id === 'icon-earlier'), 'A later icon callback restored a removed feature');
        } else {
          check(hits.some(hit => hit.properties._rl_feature_id === 'icon-earlier' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02), 'Icon refresh overwrote the replacement scene');
        }
      } finally { map.destroy(); }
    }
  });
  await run('Reliability publication runs a requested reset after a held update settles', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const onAdd = GeoJSONSource.prototype.onAdd;
    let rejected = false, workerLoads = 0;
    GeoJSONSource.prototype.onAdd = function(map) {
      if (this.id === 'rl:features') {
        this.actorPromise = this.actorPromise.then(actor => new Proxy(actor, {
          get(target, property, receiver) {
            if (property !== 'sendAsync') return Reflect.get(target, property, receiver);
            const send = target.sendAsync.bind(target);
            return new Proxy(send, { apply(fn, receiver, args) {
              const message: unknown = args[0];
              if (message && typeof message === 'object' && 'type' in message && message.type === 'LD') {
                workerLoads++;
                if (!rejected) {
                  rejected = true;
                  return Promise.reject(new Error('Injected GeoJSON worker load rejection'));
                }
              }
              return Reflect.apply(fn, receiver, args);
            } });
          },
        }));
      }
      onAdd.call(this, map);
    };
    let map: Viewport | undefined;
    try {
      map = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('worker-latest'), point('worker-removed')], logger: () => {} });
      const active = map;
      const diagnostics: RidgelineError[] = [];
      active.on('diagnostic', error => diagnostics.push(error));
      await active.ready;
      await until(() => rejected && diagnostics.some(error => error.code === 'UPDATE_FAILED' && error.context.sourceId === 'rl:features'),
        'initial GeoJSON worker rejection reported');
      const rendered = () => active.map.queryRenderedFeatures({ layers: ['rl:points'] });
      check(!rendered().some(hit => hit.properties._rl_feature_id === 'worker-latest'), 'Failed initial load appeared before retry');
      const source = active.map.getSource('rl:features');
      if (!(source instanceof GeoJSONSource)) throw new Error('Missing feature source');
      let settle: (() => void) | undefined;
      source.updateData = () => new Promise<void>(resolve => { settle = resolve; });
      active.upsert([{ ...point('worker-latest', .03), properties: { name: 'Latest' } }]);
      active.remove(['worker-removed']);
      await until(() => Boolean(settle), 'held publication began');
      active.retryUpdates();
      settle!();
      await until(() => rendered().some(hit => hit.properties._rl_feature_id === 'worker-latest' &&
        hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02) &&
        !rendered().some(hit => hit.properties._rl_feature_id === 'worker-removed'), 'worker recovery with latest snapshot');
      check(workerLoads >= 2, 'Retry did not reach the GeoJSON worker');
    } finally {
      map?.destroy();
      GeoJSONSource.prototype.onAdd = onAdd;
      mount.remove();
    }
  });
  await run('Reliability content keeps a menu closed when its factory closes synchronously', async () => {
    const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} });
    current = map; await map.ready;
    let disposed = 0, opened = 0;
    const content = document.createElement('button'); content.textContent = 'Obsolete action';
    const interactions = attachInteractions(map, { contextMenu: (_, close) => {
      opened++; close(); return { element: content, dispose: () => { disposed++; } };
    } });
    try {
      const canvas = map.map.getCanvas(); canvas.focus();
      const rect = canvas.getBoundingClientRect();
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
      check(opened === 1, 'Native right click did not reach the menu factory');
      check(!container.querySelector('.rl-context') && !content.isConnected, 'Synchronous close reopened obsolete menu content');
      check(disposed === 1, 'Synchronous close did not release returned content once');
      check(document.activeElement === canvas, 'Closed content stole keyboard focus');
      await browserKey('Escape');
      interactions.destroy(); interactions.destroy();
      check(disposed === 1, 'Repeated teardown disposed closed content twice');
    } finally { interactions.destroy(); map.destroy(); }
  });
  await run('Reliability content keeps replacement focus when a menu disposer opens another menu', async () => {
    const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} });
    current = map; await map.ready;
    const canvas = map.map.getCanvas();
    let opened = 0, oldDisposed = 0, newDisposed = 0;
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    const interactions = attachInteractions(map, { contextMenu: event => {
      opened++;
      if (opened > 1) return { element: replacement, dispose: () => { newDisposed++; } };
      const original = document.createElement('button'); original.textContent = 'Original action';
      return { element: original, dispose: () => {
        oldDisposed++;
        canvas.focus();
        map.map.fire('contextmenu', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent });
      } };
    } });
    try {
      canvas.focus();
      const rect = canvas.getBoundingClientRect();
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
      check(opened === 1, 'Native right click did not open the original menu');
      await browserKey('Escape');
      check(opened === 2 && oldDisposed === 1 && newDisposed === 0, 'Closing the original menu disposed its replacement');
      check(replacement.isConnected && document.activeElement === replacement, 'Obsolete close stole replacement focus');
      await browserKey('Escape');
      check(!replacement.isConnected && newDisposed === 1, 'Keyboard dismissal did not dispose replacement once');
      check(document.activeElement === canvas, 'Replacement dismissal lost saved focus');
      interactions.destroy(); interactions.destroy();
      check(oldDisposed === 1 && newDisposed === 1, 'Repeated teardown repeated disposal');
    } finally { interactions.destroy(); map.destroy(); }
  });
  await run('Reliability content releases menu results after helper or viewport destruction', async () => {
    for (const destroyViewport of [false, true]) {
      const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} });
      current = map; await map.ready;
      let disposed = 0, opened = 0;
      const content = document.createElement('button'); content.textContent = 'Destroyed action';
      const interactions = attachInteractions(map, { contextMenu: () => {
        opened++;
        if (destroyViewport) map.destroy(); else interactions.destroy();
        return { element: content, dispose: () => { disposed++; } };
      } });
      try {
        const canvas = map.map.getCanvas(); canvas.focus();
        const rect = canvas.getBoundingClientRect();
        if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
        await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
        check(opened === 1 && disposed === 1, 'Destroyed menu factory leaked returned content');
        check(!container.querySelector('.rl-context') && !content.isConnected && document.activeElement !== content, 'Destroyed menu result mounted or received focus');
        await browserKey('Escape');
        interactions.destroy(); interactions.destroy(); map.destroy(); map.destroy();
        check(disposed === 1, 'Destroyed content was disposed repeatedly');
      } finally { interactions.destroy(); map.destroy(); }
    }
  });
  await run('Reliability content ignores obsolete factory results and close callbacks', async () => {
    const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} });
    current = map; await map.ready;
    let opened = 0, oldDisposed = 0, newDisposed = 0;
    let obsoleteClose: (() => void) | undefined;
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    const obsolete = document.createElement('button'); obsolete.textContent = 'Obsolete action';
    const interactions = attachInteractions(map, { contextMenu: (event, close) => {
      opened++;
      if (opened > 1) return { element: replacement, dispose: () => { newDisposed++; } };
      obsoleteClose = close;
      map.map.fire('contextmenu', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent });
      return { element: obsolete, dispose: () => { oldDisposed++; close(); } };
    } });
    try {
      const canvas = map.map.getCanvas(); canvas.focus();
      const rect = canvas.getBoundingClientRect();
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
      check(opened === 2 && oldDisposed === 1 && newDisposed === 0, 'Replaced factory result did not release exactly once');
      check(!obsolete.isConnected && replacement.isConnected && document.activeElement === replacement, 'Obsolete factory result replaced current content or focus');
      obsoleteClose?.();
      check(replacement.isConnected && document.activeElement === replacement && newDisposed === 0, 'An obsolete close callback affected current content');
      await browserKey('Escape');
      check(!replacement.isConnected && newDisposed === 1 && document.activeElement === canvas, 'Keyboard dismissal lost current disposal or focus');
      interactions.destroy(); interactions.destroy();
      check(oldDisposed === 1 && newDisposed === 1, 'Repeated teardown repeated menu disposal');
    } finally { interactions.destroy(); map.destroy(); }
  });
  await run('Reliability content keeps a replacement menu alive when picker page disposal opens it', async () => {
    const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: Array.from({ length: 10 }, (_, index) => point(`page-${index}`)), logger: () => {} });
    current = map; await map.ready;
    let replace = false, menuDisposed = 0;
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    const canvas = map.map.getCanvas();
    const interactions = attachInteractions(map, {
      contextMenu: () => ({ element: replacement, dispose: () => { menuDisposed++; } }),
      renderFeature: feature => {
        const element = document.createElement('span'); element.textContent = feature.id;
        return { element, dispose: () => {
          if (!replace) return;
          replace = false;
          canvas.focus();
          map.map.fire('contextmenu', { point: { x: 200, y: 200 }, lngLat: map.map.unproject([200, 200]), originalEvent: new MouseEvent('contextmenu') });
        } };
      },
    });
    try {
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).length === 10, 'overlapping picker candidates render');
      await pointer('click', map.map.project([0, 0]));
      check(Boolean(container.querySelector('.rl-picker')), 'Native click did not open the picker');
      replace = true;
      await browserClick('.rl-picker-pages button[aria-label="Next candidates"]');
      check(replacement.isConnected && document.activeElement === replacement && menuDisposed === 0, 'Obsolete picker page disposed replacement content or focus');
      await browserKey('Escape');
      check(!replacement.isConnected && menuDisposed === 1 && document.activeElement === canvas, 'Replacement menu dismissal lost disposal or focus');
      interactions.destroy(); interactions.destroy();
      check(menuDisposed === 1, 'Teardown disposed the replacement twice');
    } finally { interactions.destroy(); map.destroy(); }
  });
  await run('Reliability content lets a picker replace a pending menu factory', async () => {
    const map = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: [point('factory-a'), point('factory-b')], logger: () => {} });
    current = map; await map.ready;
    let disposed = 0, opened = 0;
    const obsolete = document.createElement('button'); obsolete.textContent = 'Obsolete action';
    const interactions = attachInteractions(map, { contextMenu: event => {
      opened++;
      map.map.fire('click', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent });
      return { element: obsolete, dispose: () => { disposed++; } };
    } });
    try {
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).length === 2, 'factory replacement candidates render');
      const canvas = map.map.getCanvas(); canvas.focus();
      const rect = canvas.getBoundingClientRect(), location = map.map.project([0, 0]);
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + location.x, rect.top + location.y, rect.left + location.x, rect.top + location.y, 'right');
      check(opened === 1 && disposed === 1 && !obsolete.isConnected && !container.querySelector('.rl-context'), 'Menu factory overwrote a replacement picker');
      const picker = container.querySelector('.rl-picker');
      check(picker?.contains(document.activeElement) && picker.querySelectorAll('.rl-sector').length === 2, 'Replacement picker lost choices or focus');
      await browserKey('Escape');
      check(!container.querySelector('.rl-picker') && document.activeElement === canvas, 'Replacement picker dismissal lost focus');
      interactions.destroy(); interactions.destroy();
      check(disposed === 1, 'Obsolete menu content was disposed repeatedly');
    } finally { interactions.destroy(); map.destroy(); }
  });
  await run('Raw terrain and the installed renderer agree on nonzero TMS tile templates', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
    const image = dem.toDataURL();
    const prefix = 'https://terrain-addressing.test/';
    const tiles = [`${prefix}{z}/{x}/{y}.png?quadkey={quadkey}&prefix={prefix}&bounds={bbox-epsg-3857}`];
    const metadata = `data:application/json,${encodeURIComponent(JSON.stringify({
      tilejson: '3.0.0', tiles, minzoom: 2, maxzoom: 2, encoding: 'terrarium', scheme: 'tms',
    }))}`;
    const rawRequests: string[] = [], rendererRequests: string[] = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(prefix)) { rawRequests.push(url); return fetch(image, init); }
      return fetch(input, init);
    };
    let air: Viewport | undefined;
    try {
      air = createViewport({ container, basemap: style(), camera: { center: [-45, 40], zoom: 3 }, logger: () => {} });
      current = air;
      const active = air;
      await active.ready;
      active.map.setTransformRequest(url => {
        if (url.startsWith(prefix)) { rendererRequests.push(url); return { url: image }; }
        return { url };
      });
      active.configure({ terrain: true, elevation: { url: metadata, tileSize: 256 } });
      active.upsert([{ ...point('addressed-terrain'), geometry: { type: 'Point', coordinates: [-45, 40] }, entity: {} }]);
      await until(() => active.getEntityState('addressed-terrain')?.ground === 0 &&
        active.map.queryTerrainElevation([-45, 40]) === 0 &&
        rawRequests.some(url => new URL(url).pathname === '/2/1/2.png') &&
        rendererRequests.some(url => new URL(url).pathname === '/2/1/2.png'), 'raw and rendered TMS requests and known flat height');
      const raw = rawRequests.find(url => new URL(url).pathname === '/2/1/2.png')!;
      const rendered = rendererRequests.find(url => new URL(url).pathname === '/2/1/2.png')!;
      check(new URL(raw).pathname === new URL(rendered).pathname, 'Raw and renderer disagree on TMS addressing');
      for (const url of [raw, rendered]) {
        const parameters = new URL(url).searchParams;
        check(parameters.get('quadkey') === '03' && parameters.get('prefix') === '11', 'Tile template tokens do not match the independently known tile');
        const bounds = parameters.get('bounds')?.split(',').map(Number);
        const expected = [-10018754.171394622, 0, 0, 10018754.171394622];
        // Equivalent projection calculations can differ in their last floating-point digit.
        check(bounds?.length === 4 && bounds.every((value, i) => Math.abs(value - expected[i]!) < 1e-6), 'Projected tile bounds differ from the known northwest equatorial tile');
      }
      check([...rawRequests, ...rendererRequests].every(url => !/[{}]/.test(url)), 'A terrain template token remained unresolved');
    } finally { air?.destroy(); window.fetch = fetch; }
  });
  await run('An earlier pointer release cannot replace controls during a later native press', async () => {
    const draw = createViewport({ container, basemap: style(), logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'successive-presses', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:600px;z-index:10';
    container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    const schedule = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
    const delayed = new Map<number, () => void>();
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      editor.setStyle({ label: 'first' }); editor.setStyle({ label: 'second' });
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      const button = inspector.querySelector<HTMLButtonElement>('[data-field="action:Undo"]')!;
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      // Deliver zero-delay tasks after the next native press, reproducing a busy browser event loop.
      Object.defineProperty(window, 'setTimeout', { configurable: true, writable: true, value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay !== 0 || typeof handler !== 'function') return schedule(handler, delay, ...args);
        const id = schedule(() => {}, 60_000);
        delayed.set(id, () => handler(...args));
        return id;
      } });
      Object.defineProperty(window, 'clearTimeout', { configurable: true, writable: true, value: (id?: number) => { if (id !== undefined) delayed.delete(id); clear(id); } });
      await window.browserMouse('down', x, y); await window.browserMouse('up', x, y);
      check(editor.getState().draft?.style.label === 'first', 'First native Undo did not run');
      await window.browserMouse('down', x, y);
      window.setTimeout = schedule; window.clearTimeout = clear;
      for (const [id, callback] of delayed) { clear(id); callback(); }
      delayed.clear();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(button.isConnected, 'An older pointer release replaced the button held by the next press');
      await window.browserMouse('up', x, y);
      check(editor.getState().draft?.style.label === '', 'Second native Undo did not run');
    } finally {
      window.setTimeout = schedule; window.clearTimeout = clear;
      for (const id of delayed.keys()) clear(id);
      if (window.browserMouse) await window.browserMouse('up', 0, 0);
      controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
    }
  });
  await run('Inspector resumes updates after window blur or lost pointer capture', async () => {
    const draw = createViewport({ container, basemap: style(), logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'pointer-loss', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:600px;z-index:10';
    container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      for (const loss of ['blur', 'capture']) {
        const output = inspector.querySelector('output')!;
        output.scrollIntoView({ block: 'center' });
        let pointerId: number | undefined;
        if (loss === 'capture') output.addEventListener('pointerdown', event => {
          pointerId = event.pointerId;
          output.setPointerCapture(event.pointerId);
        }, { once: true });
        const rect = output.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        await window.browserMouse('down', x, y);
        if (loss === 'capture') await window.browserMouse('move', x + 1, y);
        try {
          editor.setStyle({ label: loss });
          check(inspector.querySelector<HTMLInputElement>('[data-field="Label"]')?.value !== loss, `Control rebuilt before the ${loss} pointer press ended`);
          if (loss === 'blur') {
            // Browser focus loss is controlled here; the preceding pointer press is native.
            window.dispatchEvent(new Event('blur'));
          } else {
            check(pointerId !== undefined, 'Native press did not reach the inspector');
            output.releasePointerCapture(pointerId!);
            await window.browserMouse('move', x + 2, y);
          }
          await until(() => inspector.querySelector<HTMLInputElement>('[data-field="Label"]')?.value === loss, `inspector update after ${loss}`);
        } finally { await window.browserMouse('up', x, y); }
      }
    } finally { controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove(); }
  });
  await run('Preparation failures preserve construction and update publication and release the viewport', async () => {
    for (const immediate of [true, false]) {
      const errors: RidgelineError[] = [];
      const feature = (id: string, lng: number): MapFeature => ({ ...point(id, lng), entity: {
        altitude: { meters: 100, reference: 'sea-level' }, attachments: [{ id: 'body', type: 'sphere', radius: 20 }],
      } });
      const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
        features: [feature('initial-preparation', 0)], logger: () => {}, onError: error => errors.push(error),
        elevationSampler: { sample: () => null, prepare: () => {
          if (immediate) throw new Error('Immediate preparation failure');
          return Promise.reject(new Error('Rejected preparation failure'));
        } } });
      current = air;
      try {
        await air.ready;
        await until(() => errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'construction preparation diagnostic');
        check(air.getFeature('initial-preparation') !== undefined, 'Construction lost accepted data');
        const changes: string[] = [];
        air.on('datachange', event => changes.push(...event.ids));
        errors.length = 0;
        air.upsert([feature('updated-preparation', .01), point('healthy-preparation', -.01)]);
        await until(() => errors.some(error => error.code === 'ELEVATION_UNAVAILABLE') &&
          air.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(hit => hit.properties._rl_feature_id === 'healthy-preparation'),
        'update diagnostic and healthy publication');
        check(changes.includes('updated-preparation') && changes.includes('healthy-preparation'), 'Preparation failure interrupted datachange');
        check(air.getFeature('updated-preparation') !== undefined && air.getEntityState('updated-preparation')?.coverage === 'unavailable', 'Accepted entity update was abandoned');
        check(errors.some(error => error.context.operation === 'entities' && error.cause instanceof Error), 'Preparation diagnostic lost context or cause');
      } finally { air.destroy(); }
      check(!container.querySelector('canvas'), 'Preparation failure leaked a canvas after destroy');
    }
  });
  await run('Removing an entity from preparation leaves accepted data and rendered output absent', async () => {
    let removeDuringPreparation = false;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {},
      elevationSampler: { sample: () => null, prepare: async () => {
        if (removeDuringPreparation) { removeDuringPreparation = false; air.remove(['removed-in-preparation']); }
      } } });
    current = air;
    try {
      await air.ready;
      removeDuringPreparation = true;
      air.upsert([{ ...point('removed-in-preparation'), entity: { altitude: { meters: 100, reference: 'sea-level' },
        attachments: [{ id: 'zone', type: 'circle', radius: 100 }] } }, point('healthy-after-removal', .01)]);
      await until(() => !air.getFeature('removed-in-preparation') &&
        air.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(hit => hit.properties._rl_feature_id === 'healthy-after-removal'),
      'reentrant removal and healthy publication');
      await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
      check(!air.getEntityState('removed-in-preparation'), 'Removed entity retained computation state');
      check(!air.map.querySourceFeatures('rl:features').some(hit => hit.properties._rl_feature_id === 'removed-in-preparation'), 'Removed feature reached the source');
      check(!air.map.queryRenderedFeatures().some(hit => hit.properties._rl_feature_id === 'removed-in-preparation' || hit.properties.entityId === 'removed-in-preparation'), 'Removed entity left rendered geometry');
    } finally { air.destroy(); }
  });
  await run('Removing an entity during elevation sampling clears its displayed camera', async () => {
    let armed = false, removed = false;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, .0008], zoom: 16 }, logger: () => {},
      elevationSampler: { sample: () => {
        if (armed && !removed) { removed = true; air.remove(['sampled-camera']); }
        return 0;
      } } });
    current = air;
    try {
      await air.ready;
      const feature: MapFeature = { ...point('sampled-camera'), entity: {
        altitude: { meters: 100, reference: 'ground' }, attachments: [
          { id: 'view', type: 'camera', range: 300, bearing: 0, elevation: -45, fovX: 60, fovY: 40,
            color: '#e02020', fillOpacity: 1, outline: false, volumeOpacity: 0 },
        ],
      } };
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial sampled camera');
      await untilPixel(air, [0, .0008], true, 'initial camera fill');
      armed = true;
      air.upsert([{ ...feature, properties: { revision: 2 } }]);
      await until(() => removed && !air.getFeature(feature.id) && !air.getEntityState(feature.id), 'removal from sampling');
      await untilPixel(air, [0, .0008], false, 'removed camera fill stays absent');
      await until(() => !air.map.querySourceFeatures('rl:entity-ground').some(hit => hit.properties.entityId === feature.id), 'removed camera source output');
      check(!air.map.queryRenderedFeatures().some(hit => hit.properties.entityId === feature.id), 'Sampling removal restored camera geometry');
    } finally { air.destroy(); }
  });
  await run('Destroying from a restoration diagnostic stops callbacks and resource creation', async () => {
    let restoring = false, destroyed = false, callbacksAfterDestroy = 0, resourcesAfterDestroy = 0;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, features: [point('broken-restore'), point('later-restore')],
      logger: () => {}, style: feature => {
        if (destroyed) callbacksAfterDestroy++;
        if (restoring && feature.id === 'broken-restore') throw new Error('Restoration style failure');
        return {};
      }, onError: error => {
        if (restoring && error.code === 'UPDATE_FAILED' && !destroyed) { destroyed = true; air.destroy(); }
      } });
    current = air;
    try {
      await air.ready;
      await until(() => air.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'initial restoration features');
      const addSource = air.map.addSource.bind(air.map), addLayer = air.map.addLayer.bind(air.map);
      air.map.addSource = (...args) => { if (destroyed) resourcesAfterDestroy++; return addSource(...args); };
      air.map.addLayer = (...args) => { if (destroyed) resourcesAfterDestroy++; return addLayer(...args); };
      restoring = true;
      air.configure({ basemap: style('#ffffff') });
      await until(() => destroyed, 'destruction from restoration error callback');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(callbacksAfterDestroy === 0, 'Restoration called styling after destruction');
      check(resourcesAfterDestroy === 0, 'Restoration created sources or layers after destruction');
      check(!container.querySelector('canvas'), 'Restoration destruction left a canvas');
    } finally { air.destroy(); }
  });
  await run('Unrelated terrain failure preserves the displayed mask of a pending replacement', async () => {
    let pending = false, finish: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), camera: { center: [.02, 0], zoom: 16 }, logger: () => {},
      elevationSampler: {
        sample: (lng, lat) => !pending || (Math.abs(lat) < 1e-8 && (Math.abs(lng) < 1e-8 || Math.abs(lng - .04) < 1e-8)) ? 0 : null,
        prepare: positions => {
          if (!pending) return Promise.resolve();
          if (Math.abs(positions[0]![0]) < .01) return Promise.reject(new Error('Unrelated region failed'));
          return new Promise<void>(resolve => { finish = () => { pending = false; resolve(); }; });
        },
      } });
    current = air;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0,
      elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const sensor = (id: string, lng: number): MapFeature => ({ ...point(id, lng), entity: {
      altitude: { meters: 100, reference: 'sea-level' }, attachments: [camera],
    } });
    try {
      await air.ready;
      air.upsert([sensor('retained-region', .02)]);
      await until(() => air.getEntityState('retained-region')?.coverage === 'ready', 'completed retained camera');
      const mask = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
      check(mask, 'Initial camera mask absent');
      const image = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      let picked = '';
      air.on('click', event => { picked = event.attachments[0]?.entityId ?? ''; });
      await pointer('click', air.map.project([.02, .0008]));
      check(picked === 'retained-region', 'Initial camera was not selectable at the retained test point');
      pending = true;
      air.upsert([sensor('retained-region', .04), sensor('failed-region', 0)]);
      await until(() => air.getEntityState('failed-region')?.coverage === 'unavailable' &&
        air.getEntityState('retained-region')?.coverage === 'loading' && Boolean(finish), 'regional failure with retained replacement');
      check(mask && air.map.getLayer(mask.id) && air.map.getSource<ImageSource>(mask.id)?.image === image, 'Unrelated failure replaced or removed the displayed mask');
      picked = '';
      await pointer('click', air.map.project([.02, .0008]));
      check(picked === 'retained-region', 'Retained camera stopped being selectable');
      finish!();
      await until(() => air.getEntityState('retained-region')?.coverage === 'ready', 'replacement completes after unrelated failure');
    } finally { finish?.(); air.destroy(); }
  });
  await run('Destroy during initialization, repeat destroy, then remount', async () => {
    const abandoned = createViewport({ container, basemap: style() });
    abandoned.on('destroy', () => abandoned.destroy());
    attachInteractions(abandoned);
    abandoned.destroy(); abandoned.destroy();
    await abandoned.ready.then(() => { throw new Error('Expected canceled readiness'); }, error => check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Structured cancellation'));
    check(!container.querySelector('canvas,.rl-ui'), 'Old canvas or overlay remains');
  });
  await run('Late terrain preparation cannot affect a replacement viewport', async () => {
    let finishPreparation: (() => void) | undefined;
    let preparationSignal: AbortSignal | undefined;
    let available = false;
    let destroyed = false;
    let lateErrors = 0;
    const abandoned = createViewport({ container, basemap: style(), logger: () => {},
      onError: () => { if (destroyed) lateErrors++; },
      elevationSampler: {
        sample: () => available ? 12 : null,
        // Some consumer loaders cannot stop their underlying work after cancellation.
        prepare: (_positions, signal) => {
          preparationSignal = signal;
          return new Promise<void>(resolve => { finishPreparation = resolve; });
        },
      },
    });
    current = abandoned;
    let replacement: Viewport | undefined;
    try {
      await abandoned.ready;
      abandoned.upsert([{ ...point('shared-id'), entity: { altitude: { meters: 100, reference: 'ground' } } }]);
      await until(() => Boolean(finishPreparation), 'old viewport terrain preparation starts');
      abandoned.destroy();
      destroyed = true;
      check(preparationSignal?.aborted, 'Destroy did not cancel terrain preparation');
      check(!container.querySelector('canvas,.rl-ui'), 'Old viewport retained DOM');

      replacement = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 8 },
        features: [{ ...point('shared-id'), properties: { name: 'Replacement' } }],
      });
      current = replacement;
      const mounted = replacement;
      await mounted.ready;
      const ui = attachInteractions(mounted);
      const off = mounted.on('selectionrequest', event => mounted.setSelection(event.ids));
      try {
        available = true;
        finishPreparation?.();
        await until(() => mounted.map.queryRenderedFeatures({ layers: ['rl:points'] })
          .some(hit => hit.properties._rl_feature_id === 'shared-id'), 'replacement renders after old terrain completes');
        await pointer('click', mounted.map.project([0, 0]));
        check(mounted.getSelection()[0] === 'shared-id', 'Replacement stopped accepting real clicks');
        check(mounted.getFeature('shared-id')?.properties.name === 'Replacement', 'Old preparation replaced current data');
        check(!mounted.getFeature('shared-id')?.entity, 'Old airborne entity leaked into replacement');
        check(container.querySelectorAll('canvas').length === 1, 'Old preparation recreated a canvas');
        check(lateErrors === 0, 'Destroyed viewport emitted a late diagnostic');
      } finally { off(); ui.destroy(); }
    } finally {
      finishPreparation?.(); abandoned.destroy(); replacement?.destroy();
    }
  });
  const viewport = createViewport({ container, basemap: style(), camera: { center: [0,0], zoom: 8 }, features: [point('initial')], style: feature => { if (feature.properties.broken) throw new Error('Broken style'); return { color: feature.properties.color === 'red' ? '#ff0000' : '#008855', icon: typeof feature.properties.icon === 'string' ? feature.properties.icon : undefined }; }, logger: () => {} });
  current = viewport;
  const hits = () => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] });
  viewport.upsert([point('queued')]);
  await viewport.ready;
  await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'base feature rendered');
  const featureState = (id: string) => {
    const sourceFeature = viewport.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === id);
    return sourceFeature?.id === undefined ? {} : viewport.map.getFeatureState({ source: 'rl:features', id: sourceFeature.id });
  };
  await run('Queued features render with stable string IDs and click events', async () => {
    check(!viewport.map.getLayer('rl:camera-gpu'), 'Ground-only viewport allocated the camera renderer');
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'queued feature rendered');
    check(hits().some(hit => hit.properties._rl_feature_id === 'initial'), 'Initial feature missing');
    let ids: string[] = [];
    const off = viewport.on('click', event => { ids = event.features.map(feature => feature.id); });
    await pointer('click', viewport.map.project([0,0]));
    check(ids.includes('queued') && ids.includes('initial'), 'Consumer click IDs missing'); off();
  });
  await run('Reserved feature IDs remain selectable without inherited state', async () => {
    const id = '__proto__';
    viewport.upsert([point(id, .08)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === id), 'reserved ID rendered');
    viewport.setSelection([id]);
    viewport.preview(id);
    check(viewport.getSelection()[0] === id, 'Reserved ID was rejected by selection');
    let clicked = '';
    const off = viewport.on('click', event => { clicked = event.features[0]?.id ?? ''; });
    await pointer('click', viewport.map.project([.08, 0]));
    check(clicked === id, `Reserved ID click returned ${clicked}`);
    const unrelated: Record<string, unknown> = {};
    check(unrelated.selected === undefined && unrelated.hover === undefined, 'Feature state polluted unrelated objects');
    off(); viewport.preview(null); viewport.remove([id]);
  });
  await run('Incremental updates replace data without moving the camera', async () => {
    const center = viewport.map.getCenter().toArray().join(',');
    viewport.setSelection(['queued']);
    viewport.upsert([{ ...point('queued', .03), properties: { name: 'Renamed', color: 'red' } }]);
    viewport.remove(['initial', 'unknown']);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued' && hit.properties._rl_color === '#ff0000') && !hits().some(hit => hit.properties._rl_feature_id === 'initial'), 'incremental replace/remove');
    check(viewport.map.getCenter().toArray().join(',') === center, 'Camera moved');
    check(viewport.getFeature('queued')?.properties.name === 'Renamed', 'Name not replaced');
    check(featureState('queued').selected, 'Selection state lost');
  });
  await run('A mutating style callback cannot change accepted or rendered feature data', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const feature = { ...point('snapshot'), properties: { name: 'Original' } };
    const map = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [feature], style: value => {
        value.properties.name = 'Mutated';
        if (value.geometry.type === 'Point') value.geometry.coordinates[0] = .1;
        return { color: '#008855' };
      }, logger: () => {} });
    try {
      await map.ready;
      await until(() => map.map.queryRenderedFeatures(map.map.project([0, 0]), { layers: ['rl:points'] })
        .some(hit => hit.properties._rl_feature_id === 'snapshot'), 'snapshot rendered at accepted position');
      const accepted = map.getFeature('snapshot');
      check(accepted?.properties.name === 'Original', 'Style callback mutated accepted properties');
      check(accepted?.geometry.type === 'Point' && accepted.geometry.coordinates[0] === 0,
        'Style callback mutated accepted coordinates');
      check(!map.map.queryRenderedFeatures(map.map.project([.1, 0]), { layers: ['rl:points'] })
        .some(hit => hit.properties._rl_feature_id === 'snapshot'), 'Style callback moved rendered geometry');
    } finally { map.destroy(); mount.remove(); }
  });
  await run('Removing and reinserting an airborne ID does not restore its selection', async () => {
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, elevationSampler: { sample: () => 0 }, logger: () => {} });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('selected-air'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'zone', type: 'circle', radius: 100 }] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'selected airborne entity');
      air.setSelection([feature.id]);
      check(air.getSelection()[0] === feature.id, 'Airborne entity was not selected');
      air.remove([feature.id]);
      check(air.getSelection().length === 0, 'Removal kept the ID selected');
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'reinserted airborne entity');
      check(air.getSelection().length === 0, 'Reinserted airborne entity regained selection');
      const sourceFeature = () => air.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === feature.id);
      await until(() => sourceFeature()?.id !== undefined, 'reinserted source feature');
      const state = air.map.getFeatureState({ source: 'rl:features', id: sourceFeature()!.id! });
      check(state.selected !== true, 'Reinserted feature retained renderer selection state');
    } finally { air.destroy(); }
  });
  await run('Mutating object basemaps does not change accepted configuration or style', async () => {
    const first = style('#112233');
    const map = createViewport({ container, basemap: first, logger: () => {} });
    current = map;
    try {
      await map.ready;
      first.layers[0] = { id: 'background', type: 'background', paint: { 'background-color': '#ff0000' } };
      check(map.map.getPaintProperty('background', 'background-color') === '#112233', 'Creation input changed the displayed style');
      const acceptedFirst = map.getConfiguration().basemap;
      check(typeof acceptedFirst !== 'string' && acceptedFirst.layers[0]?.type === 'background' &&
        acceptedFirst.layers[0].paint?.['background-color'] === '#112233', 'Creation input changed accepted basemap');
      const second = style('#445566');
      map.configure({ basemap: second });
      await until(() => map.map.isStyleLoaded() === true &&
        map.map.getPaintProperty('background', 'background-color') === '#445566', 'configured basemap loaded');
      second.layers[0] = { id: 'background', type: 'background', paint: { 'background-color': '#00ff00' } };
      const acceptedSecond = map.getConfiguration().basemap;
      check(typeof acceptedSecond !== 'string' && acceptedSecond.layers[0]?.type === 'background' &&
        acceptedSecond.layers[0].paint?.['background-color'] === '#445566', 'Configure input changed accepted basemap');
      check(map.map.getPaintProperty('background', 'background-color') === '#445566', 'Configure input changed displayed style');
    } finally { map.destroy(); }
  });
  await run('Style replacement preserves data and selection', async () => {
    viewport.setSelection(['queued']);
    viewport.configure({ basemap: style('#ddeedd'), projection: 'globe' });
    viewport.upsert([point('during-style')]);
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.properties._rl_feature_id === 'during-style'), 'style rehydration');
    check(viewport.getSelection()[0] === 'queued', 'Selected ID lost');
    check(featureState('queued').selected, 'Selection display lost');
    const before = viewport.getConfiguration();
    viewport.configure({ basemap: undefined, terrain: undefined, hillshade: undefined });
    const after = viewport.getConfiguration();
    check(JSON.stringify(after) === JSON.stringify(before), 'Undefined settings changed configuration');
    check(Boolean(viewport.map.getLayer('rl:points')), 'Undefined basemap replaced the style');
  });
  await run('A broken style isolates one feature and retries only on request', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures.push(error); });
    viewport.upsert([point('broken'), point('remove-me')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'broken') && hits().some(hit => hit.properties._rl_feature_id === 'remove-me'), 'recovery setup');
    viewport.upsert([{ ...point('broken'), properties: { broken: true } }, point('healthy')]);
    viewport.remove(['remove-me']);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'healthy') && !hits().some(hit => hit.properties._rl_feature_id === 'remove-me'), 'healthy changes survive');
    check(failures.length === 1 && failures[0]?.context.featureId === 'broken', 'Failure must identify the feature');
    check(hits().some(hit => hit.properties._rl_feature_id === 'broken'), 'Last rendered version should remain');
    viewport.upsert([point('healthy', .01)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'healthy' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .005), 'unrelated update');
    check(failures.length === 1, 'Broken callback retried automatically');
    viewport.retryUpdates();
    await until(() => failures.length === 2, 'explicit retry');
    viewport.upsert([{ ...point('broken'), properties: { color: 'red' } }]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'broken' && hit.properties._rl_color === '#ff0000'), 'corrected feature');
    viewport.remove(['broken', 'healthy']);
    await until(() => !hits().some(hit => ['broken', 'healthy'].includes(String(hit.properties._rl_feature_id))), 'recovery cleanup');
    off();
  });
  await run('Renderer rejection preserves removals and never restores an older update', async () => {
    viewport.upsert([point('retry-remove'), point('retry-update')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'retry-remove') && hits().some(hit => hit.properties._rl_feature_id === 'retry-update'), 'renderer setup');
    const source = viewport.map.getSource('rl:features');
    if (!(source instanceof GeoJSONSource)) throw new Error('Missing GeoJSON source');
    const update = source.updateData.bind(source);
    let rejectUpdate: ((reason: Error) => void) | undefined;
    let calls = 0;
    source.updateData = diff => {
      calls++;
      if (calls === 1) return new Promise<void>((_, reject) => { rejectUpdate = reject; });
      return update(diff);
    };
    viewport.remove(['retry-remove']);
    viewport.upsert([point('retry-update', .01)]);
    await until(() => Boolean(rejectUpdate), 'pending renderer submission');
    viewport.upsert([{ ...point('retry-update', .02), properties: { color: 'red' } }]);
    rejectUpdate!(new Error('Injected renderer rejection'));
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'retry-update' && hit.properties._rl_color === '#ff0000'), 'newer replacement');
    check(calls === 2, 'Failed batch retried automatically');
    check(hits().some(hit => hit.properties._rl_feature_id === 'retry-remove'), 'Injected failed removal unexpectedly applied');
    viewport.retryUpdates();
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'retry-remove'), 'removal retry');
    check(hits().some(hit => hit.properties._rl_feature_id === 'retry-update' && hit.properties._rl_color === '#ff0000'), 'Retry restored stale data');
    source.updateData = update;
    viewport.remove(['retry-update']);
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'retry-update'), 'renderer cleanup');
  });
  await run('Source error events retain updates even when updateData resolves', async () => {
    const source = viewport.map.getSource('rl:features');
    if (!(source instanceof GeoJSONSource)) throw new Error('Missing GeoJSON source');
    const update = source.updateData.bind(source);
    let failures = 0;
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures++; });
    source.updateData = async () => { source.fire(new MapErrorEvent(new Error('Injected worker error'))); };
    viewport.upsert([point('worker-retry')]);
    await until(() => failures === 1, 'source failure diagnostic');
    source.updateData = update;
    viewport.retryUpdates();
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'worker-retry'), 'worker error retry');
    viewport.remove(['worker-retry']);
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'worker-retry'), 'worker cleanup');
    off();
  });
  await run('An initial GeoJSON worker-load rejection recovers with the latest accepted features', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const onAdd = GeoJSONSource.prototype.onAdd;
    let rejected = false, workerLoads = 0;
    GeoJSONSource.prototype.onAdd = function(map) {
      if (this.id === 'rl:features') {
        this.actorPromise = this.actorPromise.then(actor => new Proxy(actor, {
          get(target, property, receiver) {
            if (property !== 'sendAsync') return Reflect.get(target, property, receiver);
            const send = target.sendAsync.bind(target);
            return new Proxy(send, { apply(fn, receiver, args) {
              const message: unknown = args[0];
              if (message && typeof message === 'object' && 'type' in message && message.type === 'LD') {
                workerLoads++;
                if (!rejected) {
                  rejected = true;
                  return Promise.reject(new Error('Injected GeoJSON worker load rejection'));
                }
              }
              return Reflect.apply(fn, receiver, args);
            } });
          },
        }));
      }
      onAdd.call(this, map);
    };
    let map: Viewport | undefined;
    try {
      map = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('worker-latest'), point('worker-removed')], logger: () => {} });
      const active = map;
      const diagnostics: RidgelineError[] = [];
      active.on('diagnostic', error => diagnostics.push(error));
      await active.ready;
      await until(() => rejected && diagnostics.some(error => error.code === 'UPDATE_FAILED' && error.context.sourceId === 'rl:features'),
        'initial GeoJSON worker rejection reported');
      const rendered = () => active.map.queryRenderedFeatures({ layers: ['rl:points'] });
      check(!rendered().some(hit => hit.properties._rl_feature_id === 'worker-latest'), 'Failed initial load appeared before retry');
      active.upsert([{ ...point('worker-latest', .03), properties: { name: 'Latest' } }]);
      active.remove(['worker-removed']);
      active.retryUpdates();
      await until(() => rendered().some(hit => hit.properties._rl_feature_id === 'worker-latest' &&
        hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02) &&
        !rendered().some(hit => hit.properties._rl_feature_id === 'worker-removed'), 'worker recovery with latest snapshot');
      check(workerLoads >= 2, 'Retry did not reach the GeoJSON worker');
    } finally {
      map?.destroy();
      GeoJSONSource.prototype.onAdd = onAdd;
      mount.remove();
    }
  });
  await run('A retired source cannot restore stale changes after a basemap switch', async () => {
    const source = viewport.map.getSource('rl:features');
    if (!(source instanceof GeoJSONSource)) throw new Error('Missing GeoJSON source');
    let rejectUpdate: ((reason: Error) => void) | undefined;
    source.updateData = () => new Promise<void>((_, reject) => { rejectUpdate = reject; });
    viewport.upsert([point('retired-update')]);
    await until(() => Boolean(rejectUpdate), 'old source submission');
    viewport.configure({ basemap: style('#ddeedd') });
    viewport.upsert([{ ...point('retired-update'), properties: { color: 'red' } }]);
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.properties._rl_feature_id === 'retired-update' && hit.properties._rl_color === '#ff0000'), 'new source snapshot');
    rejectUpdate!(new Error('Retired source rejection'));
    viewport.remove(['retired-update']);
    viewport.retryUpdates();
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'retired-update'), 'retired source cleanup');
    viewport.retryUpdates();
    viewport.upsert([point('during-style')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'during-style'), 'new source still accepts updates');
    check(!hits().some(hit => hit.properties._rl_feature_id === 'retired-update'), 'Old source resurrected removed data');
  });
  await run('A broken style does not block basemap restoration or later updates', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures.push(error); });
    viewport.upsert([point('rebuild-broken'), point('rebuild-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'rebuild-broken') && hits().some(hit => hit.properties._rl_feature_id === 'rebuild-healthy'), 'rebuild setup');
    viewport.upsert([{ ...point('rebuild-broken'), properties: { name: 'Broken', broken: true } }]);
    await until(() => failures.length === 1, 'broken style diagnostic');
    viewport.configure({ basemap: style('#dce7dc') });
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.properties._rl_feature_id === 'rebuild-healthy'), 'healthy feature after rebuild');
    check(!hits().some(hit => hit.properties._rl_feature_id === 'rebuild-broken'), 'Broken feature rendered during rebuild');
    check(failures.length === 2 && failures[1]?.context.featureId === 'rebuild-broken', `Rebuild failure did not identify feature: ${failures.map(error => `${error.context.operation}/${error.context.featureId}: ${error.message}: ${error.cause}`).join('; ')}`);
    viewport.upsert([point('rebuild-later')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'rebuild-later'), 'update after partial rebuild');
    viewport.upsert([point('rebuild-broken')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'rebuild-broken'), 'corrected feature after rebuild');
    viewport.remove(['rebuild-broken', 'rebuild-healthy', 'rebuild-later']);
    await until(() => !hits().some(hit => String(hit.properties._rl_feature_id).startsWith('rebuild-')), 'rebuild cleanup');
    off();
  });
  await run('Escape reaches consumers unless a picker is open', async () => {
    const ui = attachInteractions(viewport);
    let bubbled = 0;
    const onKeydown = () => { bubbled++; };
    document.addEventListener('keydown', onKeydown);
    viewport.map.getCanvas().focus();
    await browserKey('Escape');
    check(bubbled === 1, 'Escape was intercepted without an overlay');
    await pointer('click', viewport.map.project([0,0]));
    check(Boolean(container.querySelector('.rl-picker')), 'Picker did not open');
    await browserKey('Escape');
    check(!container.querySelector('.rl-picker') && bubbled === 1, 'Escape did not stay with the open picker');
    document.removeEventListener('keydown', onKeydown);
    ui.destroy();
  });
  await run('Keyboard picker activation selects the chosen overlapping feature', async () => {
    const ui = attachInteractions(viewport);
    let requested = '';
    const off = viewport.on('selectionrequest', event => {
      requested = event.ids[0] ?? '';
      viewport.setSelection(requested ? [requested] : []);
    });
    await pointer('click', viewport.map.project([0,0]));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
    check(buttons.length >= 2, 'Overlapping features did not open a picker');
    const target = buttons[1]!.dataset.featureId!;
    buttons[0]!.focus();
    await browserKey('ArrowRight');
    check(document.activeElement === buttons[1], 'Arrow key did not move picker focus');
    await browserKey('Enter');
    check(requested === target && viewport.getSelection()[0] === target, 'Enter did not request and apply the focused choice');
    check(!container.querySelector('.rl-picker'), 'Picker remained open after selection');
    off(); ui.destroy();
  });
  await run('Picker candidates stay stable during movement; UI disposes once', async () => {
    let renders = 0, disposals = 0;
    const live = new Set<number>();
    const ui = attachInteractions(viewport, { renderFeature: feature => { const element = document.createElement('span'); element.textContent = viewport.getName(feature); const id = ++renders; live.add(id); return { element, dispose: () => { check(live.delete(id), 'Custom content disposed twice'); disposals++; } }; } });
    await pointer('click', viewport.map.project([0,0]));
    const ids = [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId);
    check(ids.length === 2, 'Expected two picker candidates');
    viewport.upsert([{ ...point('queued', .001), properties: { name: 'Moved candidate' } }]);
    check(ids.join(',') === [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId).join(','), 'Picker reordered');
    check(disposals > 0, 'Changed custom content was not disposed');
    ui.destroy(); ui.destroy(); check(live.size === 0 && disposals === renders, 'Custom UI content leaked or disposed twice');
    check(!container.querySelector('.rl-ui'), 'Overlay remains');
  });
  await run('Feature content keeps the newest update from render and disposal callbacks', async () => {
    for (const callback of ['render', 'dispose'] as const) {
      const feature = (name: string): MapFeature => ({ ...point('content-target'), properties: { name } });
      viewport.upsert([feature('Initial'), point('content-other')]);
      await until(() => hits().some(hit => hit.properties._rl_feature_id === 'content-target'), 'content target rendered');
      let armed = false, renders = 0, disposals = 0;
      const live = new Set<number>();
      const replace = () => { armed = false; viewport.upsert([feature('Newest')]); };
      const ui = attachInteractions(viewport, {
        hover: false,
        renderFeature(current) {
          const name = viewport.getName(current);
          const element = document.createElement('span'); element.textContent = name;
          const id = ++renders; live.add(id);
          if (armed && callback === 'render' && current.id === 'content-target' && name === 'Intermediate') replace();
          return { element, dispose() {
            check(live.delete(id), 'Feature content disposed twice'); disposals++;
            if (armed && callback === 'dispose' && current.id === 'content-target' && name === 'Initial') replace();
          } };
        },
      });
      try {
        await pointer('click', viewport.map.project([0, 0]));
        const choice = container.querySelector<HTMLButtonElement>('[data-feature-id="content-target"]');
        check(choice, 'Missing content choice');
        choice?.focus();
        armed = true;
        viewport.upsert([feature('Intermediate')]);
        check(choice?.textContent === 'Newest', `${callback} callback restored obsolete content`);
        check(choice?.getAttribute('aria-label') === 'Select Newest', `${callback} callback restored an obsolete accessible name`);
        check(document.activeElement === choice, `${callback} callback lost focus`);
      } finally {
        armed = false;
        ui.destroy(); ui.destroy();
        check(live.size === 0 && disposals === renders, 'Nested content update leaked a result');
        viewport.remove(['content-target', 'content-other']);
      }
    }
  });
  await run('Feature content returned after interaction destruction is disposed once', async () => {
    for (const surface of ['picker', 'hover'] as const) {
      const lng = surface === 'hover' ? .2 : 0;
      viewport.upsert([point('destroy-content', lng), point('destroy-other', lng)]);
      await until(() => hits().some(hit => hit.properties._rl_feature_id === 'destroy-content'), 'destruction target rendered');
      let ui: ReturnType<typeof attachInteractions> | undefined;
      let renders = 0, disposals = 0;
      const failures: RidgelineError[] = [];
      const off = viewport.on('diagnostic', error => { if (error.code === 'CALLBACK_FAILED') failures.push(error); });
      ui = attachInteractions(viewport, {
        hover: surface === 'hover',
        renderFeature() {
          const element = document.createElement('span'); element.textContent = 'Discarded content';
          renders++;
          ui?.destroy();
          return { element, dispose() { disposals++; } };
        },
      });
      try {
        await pointer(surface === 'hover' ? 'move' : 'click', viewport.map.project([lng, 0]));
        ui.destroy();
        check(renders === 1 && disposals === renders, `${surface} retained content returned after destruction`);
        check(!container.querySelector('.rl-ui, .rl-tooltip, .rl-picker'), `${surface} restored destroyed interaction UI`);
        check(failures.length === 0, `${surface} continued using destroyed interaction state`);
      } finally {
        ui.destroy(); off(); viewport.remove(['destroy-content', 'destroy-other']);
      }
    }
  });
  await run('Picker refreshes names, icons and availability without replacing buttons or focus', async () => {
    viewport.upsert([point('queued')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'picker setup');
    const ui = attachInteractions(viewport);
    await pointer('click', viewport.map.project([0,0]));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
    const choice = buttons[0]!;
    const id = choice.dataset.featureId!;
    const original = viewport.getFeature(id)!;
    choice.focus();
    const label = choice.querySelector('.rl-feature-content');
    viewport.upsert([{ ...original, geometry: { type: 'Point', coordinates: [.01, 0] } }]);
    check(choice.querySelector('.rl-feature-content') === label, 'Position update rebuilt default content');
    const iconUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
    viewport.registerIcon('picker-icon', { image: new ImageData(2, 2), url: iconUrl });
    const renamed = { ...original, properties: { name: 'Updated candidate', icon: 'picker-icon' } };
    viewport.upsert([renamed]);
    check(choice.textContent === 'Updated candidate' && choice.getAttribute('aria-label') === 'Select Updated candidate', 'Stale picker name');
    check(choice.querySelector('img')?.getAttribute('src') === iconUrl, 'Stale picker icon');
    check(document.activeElement === choice, 'Keyboard focus lost');
    check(buttons.every((button, index) => container.querySelectorAll('[data-feature-id]')[index] === button), 'Buttons replaced or reordered');
    viewport.remove([id]);
    check(choice.disabled && choice.textContent === 'Unavailable', 'Removed candidate still available');
    check(document.activeElement === buttons[1], 'Removing the focused candidate lost keyboard access');
    viewport.upsert([renamed]);
    check(!choice.disabled && choice.textContent === 'Updated candidate', 'Reintroduced candidate stayed disabled');
    choice.focus();
    await browserKey('ArrowRight');
    check(document.activeElement === buttons[1], 'Keyboard navigation broke after refresh');
    ui.destroy();
  });
  await run('Replacing a registered icon updates the map and an open picker', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const iconMap = createViewport({
      container: mount, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('icon-target'), point('icon-other')],
      style: feature => ({ icon: feature.id === 'icon-target' ? 'swap' : undefined }),
      logger: () => {},
    });
    const pixels = (red: boolean) => {
      const image = new ImageData(24, 24);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = red ? 255 : 0;
        image.data[i + 1] = red ? 0 : 255;
        image.data[i + 3] = 255;
      }
      return image;
    };
    const color = new Uint8Array(4);
    try {
      await iconMap.ready;
      const canvas = iconMap.map.getCanvas();
      const gl = canvas.getContext('webgl2');
      check(Boolean(gl), 'Icon map has no WebGL2 context');
      iconMap.map.on('render', () => {
        const point = iconMap.map.project([0, 0]);
        const scale = canvas.width / canvas.clientWidth;
        gl!.readPixels(Math.round(point.x * scale), canvas.height - 1 - Math.round(point.y * scale), 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, color);
      });
      iconMap.registerIcon('swap', { image: pixels(true), url: 'data:image/svg+xml,red' });
      await until(() => color[0]! > 200 && color[1]! < 50, 'first icon rendered red');
      const ui = attachInteractions(iconMap);
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      const iconBox = iconMap.map.getCanvas().getBoundingClientRect();
      const iconPoint = iconMap.map.project([0, 0]);
      await window.browserMouse('click', iconBox.left + iconPoint.x, iconBox.top + iconPoint.y);
      const choice = mount.querySelector<HTMLButtonElement>('[data-feature-id="icon-target"]')!;
      check(choice.querySelector('img')?.getAttribute('src') === 'data:image/svg+xml,red', 'Picker lacked the first icon');
      iconMap.registerIcon('swap', { image: pixels(false), url: 'data:image/svg+xml,green' });
      await until(() => color[1]! > 200 && color[0]! < 50, 'replacement icon rendered green');
      check(choice.querySelector('img')?.getAttribute('src') === 'data:image/svg+xml,green', 'Open picker kept the old icon');
      ui.destroy();
    } finally {
      iconMap.destroy();
      mount.remove();
    }
  });
  await run('Icon registration isolates an unrelated failing style callback', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.context.featureId === 'icon-broken') failures.push(error); });
    viewport.upsert([
      { ...point('icon-healthy'), properties: { name: 'Healthy icon', icon: 'isolated-icon' } },
      { ...point('icon-broken'), properties: { name: 'Broken icon', broken: true } },
    ]);
    const image = new ImageData(16, 16);
    for (let i = 0; i < image.data.length; i += 4) { image.data[i] = 255; image.data[i + 3] = 255; }
    viewport.registerIcon('isolated-icon', { image });
    await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:icons'] })
      .some(hit => hit.properties._rl_feature_id === 'icon-healthy'), 'healthy icon published');
    check(failures.length > 0, 'Broken style callback did not report its feature ID');
    viewport.upsert([point('icon-broken')]);
    viewport.retryUpdates();
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'icon-broken'), 'recovered broken icon feature');
    viewport.remove(['icon-healthy', 'icon-broken']); off();
  });
  await run('A broken style falls back to names without interrupting the picker', async () => {
    viewport.upsert([point('picker-broken'), point('picker-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'picker-broken') && hits().some(hit => hit.properties._rl_feature_id === 'picker-healthy'), 'picker failure setup');
    viewport.upsert([{ ...point('picker-broken'), properties: { name: 'Broken candidate', broken: true } }]);
    const ui = attachInteractions(viewport);
    await pointer('click', viewport.map.project([0,0]));
    check(Boolean(container.querySelector('.rl-picker-hub button.rl-picker-close')), 'Picker stopped before drawing Close');
    const broken = container.querySelector<HTMLButtonElement>('[data-feature-id="picker-broken"]');
    const healthy = container.querySelector<HTMLButtonElement>('[data-feature-id="picker-healthy"]');
    check(broken?.textContent === 'Broken candidate' && Boolean(healthy), 'Picker did not show the name fallback');
    viewport.upsert([
      { ...point('picker-broken'), properties: { name: 'Broken renamed', broken: true } },
      { ...point('picker-healthy'), properties: { name: 'Healthy renamed' } },
    ]);
    check(broken?.textContent === 'Broken renamed' && healthy?.textContent === 'Healthy renamed', 'Broken style blocked another candidate refresh');
    ui.destroy();
    viewport.upsert([point('picker-broken')]);
    viewport.remove(['picker-broken', 'picker-healthy']);
  });
  await run('Hover content follows the current feature and survives unrelated removal', async () => {
    viewport.upsert([point('hover-current', .08), point('hover-unrelated', -.08)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'hover-current'), 'hover feature rendered');
    const ui = attachInteractions(viewport);
    await pointer('move', viewport.map.project([.08, 0]));
    await until(() => container.querySelector('.rl-tooltip')?.textContent === 'hover-current', 'hover tooltip');
    viewport.upsert([{ ...point('hover-current', .08), properties: { name: 'Current name' } }]);
    check(container.querySelector('.rl-tooltip')?.textContent === 'Current name', 'Hover tooltip kept stale content');
    viewport.remove(['hover-unrelated']);
    check(container.querySelector('.rl-tooltip')?.textContent === 'Current name', 'Unrelated removal hid the hovered feature');
    ui.destroy();
    viewport.remove(['hover-current']);
  });
  await run('A failed custom picker choice keeps the other choice and keyboard selection usable', async () => {
    viewport.upsert([point('custom-broken'), point('custom-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'custom-broken') && hits().some(hit => hit.properties._rl_feature_id === 'custom-healthy'), 'custom picker setup');
    const failures: RidgelineError[] = [];
    const offDiagnostic = viewport.on('diagnostic', error => { if (error.context.operation === 'renderFeature') failures.push(error); });
    let selection: string[] = [];
    const offSelection = viewport.on('selectionrequest', event => { selection = event.ids; });
    const ui = attachInteractions(viewport, {
      renderFeature(feature) {
        if (feature.properties.broken) throw new Error('Custom choice failed');
        const label = document.createElement('span');
        label.textContent = viewport.getName(feature);
        return label;
      },
    });
    await pointer('click', viewport.map.project([0, 0]));
    const broken = container.querySelector<HTMLButtonElement>('[data-feature-id="custom-broken"]')!;
    const healthy = container.querySelector<HTMLButtonElement>('[data-feature-id="custom-healthy"]')!;
    broken.focus();
    viewport.upsert([
      { ...point('custom-broken'), properties: { name: 'Broken current', broken: true } },
      { ...point('custom-healthy'), properties: { name: 'Healthy current' } },
    ]);
    check(broken.textContent === 'Broken current' && healthy.textContent === 'Healthy current', 'One custom renderer blocked choice refresh');
    check(document.activeElement === broken && !broken.disabled, 'Failed choice lost focus or became unavailable');
    check(failures.length === 1 && failures[0]?.context.featureId === 'custom-broken', 'Custom renderer failure was not reported');
    if (!window.browserKey) throw new Error('Playwright keyboard bridge required');
    await window.browserKey('Enter');
    check(selection[0] === 'custom-broken', 'Failed choice could not be selected with the keyboard');
    offSelection(); offDiagnostic(); ui.destroy();
    viewport.remove(['custom-broken', 'custom-healthy']);
  });
  await run('Point above a ground area wins the click and picker-free selection', async () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px';
    overlay.append(mount);
    document.body.append(overlay);
    const air = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 16 },
      elevationSampler: { sample: () => 0 }, logger: () => {} });
    let ui: ReturnType<typeof attachInteractions> | undefined;
    try {
      await air.ready;
      air.upsert([
        { ...point('ground-area', -.002), entity: { attachments: [{ id: 'zone', type: 'circle', radius: 500 }] } },
        point('top-point'),
      ]);
      await until(() => {
        const hits = air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points', 'rl:entity-ground-fill'] });
        return air.getEntityState('ground-area')?.coverage === 'ready' &&
          hits.some(hit => hit.properties._rl_feature_id === 'top-point') &&
          hits.some(hit => hit.properties.entityId === 'ground-area');
      },
      'overlapping ground area and point');
      const rendered = air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points', 'rl:entity-ground-fill'] });
      check(rendered[0]?.properties._rl_feature_id === 'top-point',
        `Test setup did not render the point above the ground area: ${rendered.slice(0, 4).map(hit => `${hit.layer.id}/${hit.properties._rl_feature_id ?? hit.properties.entityId}`).join(',')}`);
      let clicked: string[] = [];
      let requested: string[] = [];
      let clickEvents = 0;
      air.on('click', event => { clickEvents++; clicked = event.features.map(feature => feature.id); });
      air.on('selectionrequest', event => { requested = event.ids; });
      ui = attachInteractions(air, { picker: false });
      const pointAt = air.map.project([0, 0]);
      const rect = air.map.getCanvas().getBoundingClientRect();
      if (!window.browserClick) throw new Error('Playwright click bridge required');
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      await window.browserMouse('click', rect.left + pointAt.x, rect.top + pointAt.y);
      check(clicked[0] === 'top-point' && clicked.includes('ground-area'),
        `Click order differed from rendering: ${clicked}; events=${clickEvents}`);
      check(requested[0] === 'top-point', `Picker-free selection chose ${requested[0]}`);
    } finally {
      ui?.destroy(); air.destroy(); overlay.remove();
    }
  });
  await run('Hillshade options update live and survive toggles and basemap replacement', async () => {
    viewport.configure({ hillshade: true, elevation: { tiles: [], encoding: 'terrarium', tileSize: 256 }, hillshadeOptions: { method: 'igor', direction: 270, altitude: 30, anchor: 'map', intensity: .6, shadowColor: '#123456', highlightColor: '#eeeeee', accentColor: '#345678' } });
    const expected = viewport.map.getLayer('rl:hillshade')?.serialize().paint;
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-method') === 'igor', 'Hillshade method not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-illumination-direction') === 270, 'Hillshade direction not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-illumination-altitude') === 30, 'Hillshade altitude not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-illumination-anchor') === 'map', 'Hillshade anchor not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-shadow-color') === '#123456', 'Hillshade shadow color not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-highlight-color') === '#eeeeee', 'Hillshade highlight color not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-accent-color') === '#345678', 'Hillshade accent color not applied');
    viewport.configure({ hillshadeOptions: { intensity: .2 } });
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-exaggeration') === .2, 'Live intensity did not change');
    check(viewport.getConfiguration().hillshadeOptions.direction === 270, 'Partial settings discarded direction');
    viewport.configure({ hillshadeOptions: { intensity: .6 }, hillshade: false });
    check(!viewport.map.getLayer('rl:hillshade'), 'Hillshade toggle did not disable layer');
    viewport.configure({ hillshade: true, basemap: style('#eeeeee') });
    await until(() => Boolean(viewport.map.getLayer('rl:hillshade')), 'hillshade style restoration');
    check(JSON.stringify(viewport.map.getLayer('rl:hillshade')?.serialize().paint) === JSON.stringify(expected), 'Hillshade settings lost after style change');
    const before = viewport.getConfiguration();
    try { viewport.configure({ hillshadeOptions: { intensity: 2 }, terrain: true }); throw new Error('Invalid intensity accepted'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION', 'Expected invalid configuration'); }
    check(JSON.stringify(viewport.getConfiguration()) === JSON.stringify(before), 'Invalid settings partially applied');
    try { viewport.configure({ hillshadeOptions: { shadowColor: 'not-a-color' } }); throw new Error('Invalid color accepted'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION', 'Expected invalid color diagnostic'); }
    check(JSON.stringify(viewport.getConfiguration()) === JSON.stringify(before), 'Invalid color changed configuration');
    viewport.configure({ hillshade: false });
  });
  await run('Completed viewport releases DOM and rejects further mutation', async () => {
    viewport.destroy(); viewport.destroy();
    check(!container.querySelector('canvas,.rl-ui'), 'DOM remains');
    try { viewport.upsert([point('late')]); throw new Error('Mutation unexpectedly succeeded'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Expected DESTROYED'); }
  });
  if (selectedCase) viewport.destroy();
  await run('Airborne placement, attachment lifecycle, fallbacks, and globe shaders work through the package', async () => {
    let missing=false;
    const errors: RidgelineError[]=[];
    const air=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:14,pitch:55},elevationSampler:{sample:()=>missing?null:100},logger:()=>{},onError:error=>errors.push(error)});
    current=air;
    await air.ready;
    const aircraft:MapFeature={...point('aircraft'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',bearing:0,elevation:-45,fovX:60,fovY:40,range:1000,volumeOpacity:.28,wireframe:true,wireframeWidth:5},{id:'zone',type:'sphere',radius:100}]}};
    air.upsert([aircraft]);
    await until(()=>air.getEntityState('aircraft')?.coverage==='ready','airborne terrain ready');
    check(air.getEntityState('aircraft')?.altitude===400,'AGL conversion lost ground height');
    check((air.getEntityState('aircraft')?.footprintTriangles??0)>0,'Ground footprint absent');
    check(!air.map.getLayer('rl:camera-gpu'), 'Plain camera overlay allocated the GPU visibility renderer');
    const triangles=air.getEntityState('aircraft')!.footprintTriangles;
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const ui = attachInteractions(air, {picker:false});
    let selectedAttachment = '';
    air.on('selectionrequest', event => { selectedAttachment = event.attachments[0]?.attachmentId ?? ''; });
    // A nadir ground zone is selectable through the same public event path as a feature.
    air.upsert([{...aircraft, entity:{...aircraft.entity, attachments:[{id:'ground-zone',type:'polygon',vertices:[[-200,-200],[200,-200],[200,200],[-200,200]]}]}}]);
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===0,'zone replacement');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    await pointer('click', air.map.project([0.001,0]));
    check(selectedAttachment==='ground-zone','Attachment identity lost in selection request');
    ui.destroy();
    air.upsert([aircraft]);
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===triangles,'camera restored');
    air.configure({exaggeration:2,projection:'globe'});
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===triangles&&Boolean(air.map.getLayer('rl:entities')),'globe entity layer');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    check(!errors.some(e=>e.context.operation==='entities'&&e.code==='UPDATE_FAILED'),errors.map(e=>`${e.message}: ${e.cause}`).join('\n'));
    air.configure({basemap:style('#ffffff')});
    await until(()=>Boolean(air.map.getLayer('rl:entities')),'entity layer restored after style replacement');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    check(air.getEntityState('aircraft')?.footprintTriangles===triangles,'Style replacement changed coverage');
    air.upsert([{...aircraft,entity:{...aircraft.entity,altitude:{meters:450,reference:'sea-level'}}}]);
    await until(()=>air.getEntityState('aircraft')?.altitude===450,'MSL placement');
    missing=true;air.retryUpdates();
    await until(()=>air.getEntityState('aircraft')?.placement==='elevation-unavailable','missing terrain fallback');
    missing=false;air.upsert([{...aircraft,entity:{groundIfNoAltitude:false}}]);
    await until(()=>air.getEntityState('aircraft')?.placement==='withheld','missing altitude disabled');
    air.upsert([{...aircraft,entity:{altitude:{meters:0,reference:'sea-level'}}}]);
    await until(()=>air.getEntityState('aircraft')?.placement==='below-terrain','zero is an explicit below-terrain altitude');
    air.remove(['aircraft']);check(!air.getEntityState('aircraft'),'Removed entity state remains');
    air.destroy();
  });
  await run('Wireframe-only camera interiors do not intercept clicks', async () => {
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      camera: { center: [0,0], zoom: 17, pitch: 0 }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', bearing: 0, elevation: -90,
      fovX: 60, fovY: 60, range: 1000, fillOpacity: 0, outline: false, wireframe: true, volumeOpacity: .2 };
    const feature: MapFeature = { ...point('wireframe'), entity: { altitude: { meters: 300, reference: 'ground' }, attachments: [camera] } };
    let attachment = '';
    air.on('click', event => { attachment = event.attachments[0]?.attachmentId ?? ''; });
    const click = () => pointer('click', air.map.project([.0006,.0004]));
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'camera volume');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    await click(); check(attachment === camera.id, 'Visible camera face was not selectable');
    const before = air.getEntityState(feature.id)!.computedAt;
    air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...camera, volumeOpacity: 0 }] } }]);
    await until(() => air.getEntityState(feature.id)!.computedAt > before, 'wireframe-only update');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    await click(); check(attachment === '', 'Invisible camera face intercepted a click');
    air.destroy();
  });
  await run('A real click selects a visible camera face clipped by the view', async () => {
    const air = createViewport({ container, basemap: style('#000000'), elevationSampler: { sample: () => 0 },
      camera: { center: [0, .001], zoom: 18, pitch: 45 }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'clipped-camera', type: 'camera', bearing: 0, elevation: -45,
      fovX: 60, fovY: 40, range: 1000, color: '#00ff00', volumeOpacity: 1, fillOpacity: 0, outline: false };
    const feature: MapFeature = { ...point('clipped-aircraft'), entity: { altitude: { meters: 300, reference: 'ground' }, attachments: [camera] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'clipped camera volume');
      await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
      const layer = air.map.getLayer('rl:entities') as unknown as { implementation: {
        draws: { entityId: string; attachmentId?: string; mode: string; vertices: [number, number, number][] }[];
        project(point: [number, number, number]): { x: number; y: number } | null;
        clippedTriangle(points: [number, number, number][]): { x: number; y: number }[];
      } };
      const geometry = layer.implementation;
      const face = geometry.draws.find(draw => draw.entityId === feature.id && draw.attachmentId === camera.id && draw.mode === 'triangles');
      check(face, 'Camera face was not rendered');
      const canvas = air.map.getCanvas();
      const inside = (x: number, y: number, polygon: { x: number; y: number }[]) => {
        let contained = false;
        for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
          const first = polygon[a]!, last = polygon[b]!;
          if ((first.y > y) !== (last.y > y) && x < (last.x - first.x) * (y - first.y) / (last.y - first.y) + first.x)
            contained = !contained;
        }
        return contained;
      };
      const candidates: { x: number; y: number }[] = [];
      for (let i = 0; i < face!.vertices.length; i += 3) {
        const triangle = face!.vertices.slice(i, i + 3);
        const projected = triangle.map(vertex => geometry.project(vertex));
        if (projected.every(Boolean) || projected.every(point => !point)) continue;
        const clipped = geometry.clippedTriangle(triangle);
        if (clipped.length < 3) continue;
        for (let y = 24; y < canvas.clientHeight - 24; y += 24)
          for (let x = 24; x < canvas.clientWidth - 24; x += 24)
            if (inside(x, y, clipped)) candidates.push({ x, y });
      }
      check(candidates.length > 0, 'No partially clipped camera face intersects the visible canvas');
      const visible = await new Promise<{ x: number; y: number } | undefined>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Timed out reading the clipped camera face')), 5_000);
        air.map.once('render', () => {
          window.clearTimeout(timeout);
          const gl = canvas.getContext('webgl2')!;
          const scale = canvas.width / canvas.clientWidth;
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (const candidate of candidates) {
            const x = Math.round(candidate.x * scale), y = canvas.height - 1 - Math.round(candidate.y * scale);
            const index = (y * canvas.width + x) * 4;
            if (pixels[index + 1]! > 100 && pixels[index]! < 80 && pixels[index + 2]! < 80) {
              resolve(candidate); return;
            }
          }
          resolve(undefined);
        });
        air.map.triggerRepaint();
      });
      check(visible, 'Clipped camera face was not visibly rendered');
      const ui = attachInteractions(air, { picker: false });
      let clicked = '';
      let selected = '';
      const offClick = air.on('click', event => { clicked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
      const offSelection = air.on('selectionrequest', event => { selected = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
      try {
        await pointer('click', visible!);
        check(clicked === camera.id, `Native click missed the visible clipped face: ${clicked}`);
        check(selected === camera.id, `Selection request lost the clipped face identity: ${selected}`);

      } finally { offClick(); offSelection(); ui.destroy(); }
    } finally { air.destroy(); }
  });
  await run('Incomplete custom camera terrain settles without polling and retries explicitly', async () => {
    let samples = 0, available = false;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => { samples++; return available || (lng === 0 && lat === 0) ? 0 : null; },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('missing-patch'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => samples > 66000, 'incomplete patch sampled');
    const initialSamples = samples;
    await new Promise(resolve => setTimeout(resolve, 700));
    check(samples === initialSamples, `Unknown terrain kept polling: ${samples - initialSamples} extra samples`);
    check(air.getEntityState(feature.id)?.coverage === 'unavailable', 'Unknown custom terrain stayed loading');
    available = true; air.retryUpdates();
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'explicit terrain retry');
    available = false; air.retryUpdates();
    await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'retry discards stale terrain');
    check(!air.map.getLayer('rl:camera-gpu'), 'Unknown terrain retained its previous mask');
    air.destroy();
  });
  await run('Custom terrain preparation settles missing data and refreshes the cached patch', async () => {
    let available = false, finish = () => {}, extent = 0;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => available || (lng === 0 && lat === 0) ? 0 : null,
      prepare: positions => new Promise<void>(resolve => {
        finish = resolve;
        extent = Math.max(...positions.map(([lng, lat]) => Math.max(Math.abs(lng), Math.abs(lat)) * 111195));
      }),
    } });
    current = air; await air.ready;
    air.upsert([{ ...point('prepared-patch'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'loading', 'pending terrain preparation');
    check(extent > 389, 'Preparation omitted the terrain patch movement margin');
    finish();
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'unavailable', 'settled incomplete preparation');
    air.retryUpdates();
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'loading', 'retry prepares terrain');
    available = true; finish();
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'ready', 'completed terrain preparation');
    air.destroy();
  });
  await run('Mixed terrain cameras retain shared preparation for non-camera attachments', async () => {
    const preparedBounds: [number, number, number, number][] = [];
    const preparationExtents: number[] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => preparedBounds.some(([west, south, east, north]) =>
        lng >= west && lng <= east && lat >= south && lat <= north) ? 0 : null,
      prepare: async positions => {
        preparationExtents.push(Math.max(...positions.map(([lng, lat]) => Math.max(Math.abs(lng), Math.abs(lat)) * 111195)));
        const longitudes = positions.map(([lng]) => lng), latitudes = positions.map(([, lat]) => lat);
        preparedBounds.push([Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)]);
      },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('mixed-prepared'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [
      { id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 10 },
      { id: 'zone', type: 'circle', radius: 100 },
    ] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'mixed terrain preparation');
    check(preparationExtents.some(extent => extent > 90), `Shared preparation omitted the non-camera terrain extent: ${preparationExtents}`);
    air.destroy();
  });
  await run('A ready camera does not hide unavailable ground attachment terrain', async () => {
    const known = (lng: number, lat: number) => Math.abs(lng) < .00055 && Math.abs(lat) < .00055;
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: (lng, lat) => known(lng, lat) ? 0 : null }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'near-camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 10 };
    const near: MapFeature = { ...point('near-only'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const mixed: MapFeature = { ...point('near-plus-zone'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [camera, { id: 'wide-zone', type: 'circle', radius: 300 }] } };
    air.upsert([near, mixed]);
    await until(() => air.getEntityState(near.id)?.coverage === 'ready', 'near camera ready');
    await until(() => air.getEntityState(mixed.id)?.coverage === 'unavailable', 'wide ground area unavailable');
    check(air.getEntityState(mixed.id)?.coverage === 'unavailable', 'Ready camera hid unknown ground terrain');
    air.destroy();
  });
  await run('One failed terrain region does not settle another pending camera', async () => {
    let secondReady = false;
    let finishSecond: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample(lng, lat) {
        if (Math.abs(lat) < 1e-8 && (Math.abs(lng) < 1e-8 || Math.abs(lng - .02) < 1e-8)) return 0;
        return secondReady && Math.abs(lng - .02) < .01 ? 0 : null;
      },
      prepare(positions) {
        if (Math.abs(positions[0]![0]) < .01) return Promise.reject(new Error('First region failed'));
        return new Promise<void>(resolve => { finishSecond = () => { secondReady = true; resolve(); }; });
      },
    } });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 };
    const first: MapFeature = { ...point('failed-region'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const second: MapFeature = { ...point('pending-region', .02), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    try {
      air.upsert([first, second]);
      await until(() => air.getEntityState(first.id)?.coverage === 'unavailable' &&
        air.getEntityState(second.id)?.coverage === 'loading' && Boolean(finishSecond), 'independent terrain statuses');
      finishSecond!();
      await until(() => air.getEntityState(second.id)?.coverage === 'ready', 'second camera after unrelated failure');
      check(air.getEntityState(first.id)?.coverage === 'unavailable', 'Unrelated success changed failed region');
    } finally { finishSecond?.(); air.destroy(); }
  });
  await run('A failed airborne style update retains its last complete display', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), camera: { center: [.005, 0], zoom: 15 },
      elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error),
      style: feature => { if (feature.properties.fail) throw new Error('Airborne style failed'); return { color: '#1166aa' }; } });
    current = air; await air.ready;
    const original: MapFeature = { ...point('retained-air'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'zone', type: 'circle', radius: 100 }, { id: 'ball', type: 'sphere', radius: 30 }] } };
    const moved: MapFeature = { ...original, geometry: { type: 'Point', coordinates: [.01, 0] } };
    const zoneAt = (lng: number) => air.map.queryRenderedFeatures(air.map.project([lng, 0]), { layers: ['rl:entity-ground-fill'] })
      .some(hit => hit.properties.entityId === original.id && hit.properties.attachmentId === 'zone');
    try {
      air.upsert([original]);
      await until(() => zoneAt(0), 'initial airborne ground attachment');
      air.upsert([{ ...moved, properties: { fail: true } }]);
      await until(() => errors.some(error => error.context.featureId === original.id && error.code === 'UPDATE_FAILED'), 'airborne style failure');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(zoneAt(0) && !zoneAt(.01), 'Failed style update moved or erased retained ground attachment');
      const accepted = air.getFeature(original.id);
      check(accepted?.geometry.type === 'Point' && accepted.geometry.coordinates[0] === .01,
        'Accepted data did not advance after style failure');
      air.upsert([moved]);
      await until(() => zoneAt(.01) && !zoneAt(0), 'corrected airborne update');
    } finally { air.destroy(); }
  });
  await run('Airborne shader creation recovers through retryUpdates', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style('#ffffff'), camera: { center: [0, 0], zoom: 17, pitch: 45 },
      elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const createProgram = gl.createProgram.bind(gl);
    let failOnce = true;
    Object.defineProperty(gl, 'createProgram', { configurable: true, value: () => {
      if (failOnce) { failOnce = false; return null; }
      return createProgram();
    } });
    const feature: MapFeature = { ...point('shader-retry'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'ball', type: 'sphere', radius: 100, color: '#ff0000' }] } };
    const redPixels = () => new Promise<number>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), context = canvas.getContext('webgl2')!;
        const values = new Uint8Array(300 * 300 * 4);
        context.readPixels(Math.floor(canvas.width / 2) - 150, Math.floor(canvas.height / 2) - 150,
          300, 300, context.RGBA, context.UNSIGNED_BYTE, values);
        let count = 0;
        for (let i = 0; i < values.length; i += 4)
          if (values[i]! > values[i + 1]! + 20 && values[i]! > values[i + 2]! + 20) count++;
        resolve(count);
      });
      air.map.triggerRepaint();
    });
    try {
      air.upsert([feature]);
      await until(() => errors.some(error => error.code === 'UPDATE_FAILED' && error.context.operation === 'entities'), 'airborne shader failure');
      Object.defineProperty(gl, 'createProgram', { configurable: true, value: createProgram });
      check(await redPixels() === 0, 'Failed shader still drew airborne geometry');
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'entity retry state');
      check(await redPixels() > 0, 'Retry did not restore airborne geometry');
    } finally { Object.defineProperty(gl, 'createProgram', { configurable: true, value: createProgram }); air.destroy(); }
  });
  await run('Custom elevation preparation also covers entities with only plain cameras', async () => {
    let prepared = false, prepareCalls = 0;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => prepared ? 0 : null,
      prepare: async () => { prepareCalls++; prepared = true; },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('plain-prepared'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: false, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'plain camera preparation');
    check(prepareCalls === 1, `Plain camera skipped shared elevation preparation: ${prepareCalls}`);
    check(air.getEntityState(feature.id)?.placement === 'airborne', 'Prepared plain camera remained elevation-unavailable');
    check((air.getEntityState(feature.id)?.footprintTriangles ?? 0) > 0, 'Prepared plain camera has no footprint');
    check(!air.map.getLayer('rl:camera-gpu'), 'Plain camera allocated the GPU visibility renderer');
    air.destroy();
  });
  await run('A moved airborne camera prepares a missing center while retaining historical coverage', async () => {
    const movedLng = .00005;
    let centerAvailable = true;
    let prepareCalls = 0;
    let preparedPositions: readonly [number, number][] = [];
    let finishPreparation: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, logger: () => {}, elevationSampler: {
      sample: (lng, lat) => {
        if (Math.abs(lng) < 1e-8 && Math.abs(lat) < 1e-8) return 12;
        if (Math.abs(lng - movedLng) < 1e-8 && Math.abs(lat) < 1e-8) return centerAvailable ? 12 : null;
        return 0;
      },
      prepare: (requested, signal) => {
        prepareCalls++;
        preparedPositions = requested.map(([lng, lat]) => [lng, lat] as [number, number]);
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(new DOMException('aborted', 'AbortError'));
          };
          if (signal.aborted) { abort(); return; }
          signal.addEventListener('abort', abort, { once: true });
          finishPreparation = () => {
            signal.removeEventListener('abort', abort);
            resolve();
          };
        });
      },
    } });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('moving-airborne'), entity: {
      altitude: { meters: 100, reference: 'ground' }, attachments: [camera],
    } };
    air.upsert([feature]);
    await until(() => {
      const state = air.getEntityState(feature.id);
      return state?.ground === 12 && state.altitude === 112 && state.placement === 'airborne' && state.coverage === 'ready';
    }, 'initial airborne camera');
    let picked = '';
    const off = air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const screen = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', screen);
      return picked;
    };
    try {
      check(await pickAt(0, .0008) === camera.id, 'Initial airborne camera coverage was not pickable');
      centerAvailable = false;
      air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [movedLng, 0] } }]);
      await until(() => prepareCalls === 1 && air.getEntityState(feature.id)?.placement === 'elevation-unavailable', 'center preparation and placement after movement');
      const pending = air.getEntityState(feature.id);
      check(pending?.placement === 'elevation-unavailable' && pending.coverage === 'loading', `Missing center did not remain loading during preparation: ${JSON.stringify(pending)}; calls=${prepareCalls}`);
      check(preparedPositions.some(([lng, lat]) => Math.abs(lng - movedLng) < 1e-8 && Math.abs(lat) < 1e-8), 'Preparation omitted the moved center');
      check(await pickAt(0, .0008) === camera.id, 'Historical camera coverage disappeared during center preparation');
      centerAvailable = true;
      finishPreparation?.();
      finishPreparation = undefined;
      await until(() => {
        const state = air.getEntityState(feature.id);
        return state?.ground === 12 && state.altitude === 112 && state.placement === 'airborne' && state.coverage === 'ready';
      }, 'recovered airborne camera');
    } finally {
      finishPreparation?.();
      off();
      air.destroy();
    }
  });
  await run('Switching to a plain camera during unresolved placement drops terrain coverage', async () => {
    const missingLng = .0001;
    let resolvePreparation: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => Math.abs(lng - missingLng) < 1e-8 && Math.abs(lat) < 1e-8 ? null : 0,
      prepare: async () => new Promise<void>(resolve => { resolvePreparation = resolve; }),
    } });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('camera-kind-switch'), entity: {
      altitude: { meters: 100, reference: 'ground' }, attachments: [camera],
    } };
    const mask = () => air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:'));
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready' && mask(), 'initial terrain camera coverage');
    try {
      air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [missingLng, 0] },
        entity: { ...feature.entity!, attachments: [{ ...camera, terrainVisibility: false }] } }]);
      await until(() => air.getEntityState(feature.id)?.placement === 'elevation-unavailable', 'plain camera placement preparation');
      check(!mask(), 'Terrain mask remained after switching to a plain camera');
      check(!air.map.getLayer('rl:camera-gpu'), 'Plain camera retained the terrain renderer');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(!mask(), 'Late terrain completion restored a plain camera mask');
    } finally {
      resolvePreparation?.();
      air.destroy();
    }
  });
  await run('No-altitude terrain cameras use prepared ground placement without GPU coverage', async () => {
    let prepared = false;
    let positions: readonly [number, number][] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => prepared ? 12 : null,
      prepare: async requested => { positions = requested; prepared = true; },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('prepared-ground'), entity: { attachments: [{ id: 'camera', type: 'camera',
      terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.ground === 12 && air.getEntityState(feature.id)?.coverage === 'ready', 'prepared ground placement');
    const state = air.getEntityState(feature.id)!;
    check(state.placement === 'ground', `No-altitude entity placement was ${state.placement}`);
    check(positions.some(([lng, lat]) => Math.abs(lng) < 1e-9 && Math.abs(lat) < 1e-9), 'Preparation omitted the entity center');
    check(!air.map.getLayer('rl:camera-gpu'), 'Ground-placed terrain camera allocated GPU coverage');
    air.destroy();
  });
  await run('Stateful elevation samplers retain their prepare method receiver', async () => {
    class StatefulSampler {
      #centerReady = false;
      #patchReady = false;
      sample(lng: number, lat: number) {
        if (lng === 0 && lat === 0) return this.#centerReady ? 0 : null;
        return this.#patchReady ? 0 : null;
      }
      async prepare(positions: readonly [number, number][]) {
        this.#centerReady = true;
        if (positions.some(([lng, lat]) => lng !== 0 || lat !== 0)) this.#patchReady = true;
      }
    }
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {},
      elevationSampler: new StatefulSampler(), onError: error => errors.push(error) });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('stateful-sampler'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne' && air.getEntityState(feature.id)?.coverage === 'ready', 'stateful sampler camera coverage');
    check(!errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'Stateful sampler preparation failed');
    air.destroy();
  });
  await run('Hidden terrain cameras still prepare placement elevation after movement', async () => {
    class HiddenSampler {
      #prepared = new Set<string>();
      calls = 0;
      sample(lng: number, lat: number) { return this.#prepared.has(`${lng},${lat}`) ? 0 : null; }
      async prepare(positions: readonly [number, number][]) {
        this.calls++;
        for (const [lng, lat] of positions) this.#prepared.add(`${lng},${lat}`);
      }
    }
    const sampler = new HiddenSampler();
    const air = createViewport({ container, basemap: style(), logger: () => {},
      entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: sampler });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('hidden-placement'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne', 'hidden initial placement');
    check(sampler.calls >= 1, 'Hidden terrain camera did not prepare entity elevation');
    check(air.getEntityState(feature.id)?.coverage === 'ready', 'Hidden placement remained unavailable');
    const before = air.getEntityState(feature.id)!.computedAt;
    air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [.01, 0] } }]);
    await until(() => {
      const state = air.getEntityState(feature.id);
      return state?.computedAt !== undefined && state.computedAt > before && state.placement === 'airborne';
    }, 'hidden moved placement');
    check(sampler.calls >= 2, 'Hidden movement did not prepare the new entity position');
    check(!air.map.getLayer('rl:camera-gpu'), 'Hidden camera allocated GPU coverage');
    air.destroy();
  });
  await run('Hiding coverage keeps shared placement preparation active', async () => {
    class PendingSampler {
      #ready = false;
      calls = 0;
      signal?: AbortSignal;
      finish?: () => void;
      sample() { return this.#ready ? 0 : null; }
      prepare(_positions: readonly [number, number][], signal: AbortSignal) {
        this.calls++;
        this.signal = signal;
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(new DOMException('aborted', 'AbortError'));
          };
          if (signal.aborted) { abort(); return; }
          signal.addEventListener('abort', abort, { once: true });
          this.finish = () => {
            signal.removeEventListener('abort', abort);
            this.#ready = true;
            resolve();
          };
        });
      }
    }
    const sampler = new PendingSampler();
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {}, onError: error => errors.push(error), elevationSampler: sampler });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('hide-pending'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => sampler.calls === 1 && air.getEntityState(feature.id)?.coverage === 'loading', 'initial camera preparation');
    air.configure({ entityVisibility: { footprints: false, zones: false, groundLines: false } });
    check(sampler.calls === 1 && !sampler.signal?.aborted, 'Hiding coverage cancelled shared placement preparation');
    sampler.finish?.();
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne', 'placement recovery after hiding coverage');
    check(air.getEntityState(feature.id)?.coverage === 'ready', 'Hidden placement remained loading');
    check(!errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'Aborted camera preparation reported a diagnostic');
    air.destroy();
  });
  await run('Hidden unavailable placement waits for explicit retry after display configuration changes', async () => {
    let ready = false, recover = false, preparations = 0;
    const air = createViewport({ container, basemap: style(), logger: () => {},
      entityVisibility: { footprints: false, zones: false, groundLines: false },
      elevationSampler: { sample: () => ready ? 0 : null, prepare: async () => { preparations++; ready = recover; } } });
    current = air; await air.ready;
    air.upsert([{ ...point('hidden-unavailable'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
    await until(() => air.getEntityState('hidden-unavailable')?.coverage === 'unavailable', 'settled hidden placement');
    const before = air.getEntityState('hidden-unavailable')!.computedAt;
    const attempts = preparations;
    air.configure({ projection: 'globe', entityVisibility: { footprints: false, zones: false, groundLines: false } });
    await until(() => air.getEntityState('hidden-unavailable')!.computedAt > before, 'hidden display reconfiguration');
    check(preparations === attempts, 'Display configuration retried settled unavailable elevation');
    recover = true;
    air.retryUpdates();
    await until(() => air.getEntityState('hidden-unavailable')?.placement === 'airborne', 'explicit hidden placement retry');
    check(preparations > attempts, 'Explicit retry did not prepare placement elevation');
    air.destroy();
  });
  await run('Raw DEM placement and coverage remain physical with terrain off and exaggerated', async () => {
    const errors: RidgelineError[] = [];
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(1,0,0)'; context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:100,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},camera:{center:[0,0],zoom:14,pitch:50},onError:error=>errors.push(error),logger:()=>{}});
    current=air; await air.ready;
    air.upsert([
      {...point('raw'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',bearing:0,elevation:-45,fovX:50,fovY:30,range:1000},{id:'cylinder',type:'cylinder',radius:50,height:80}]}},
      {...point('raw-visibility'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',terrainVisibility:true,bearing:0,elevation:-45,fovX:50,fovY:30,range:1000}]}},
    ]);
    await until(()=>air.getEntityState('raw')?.coverage==='ready'&&air.getEntityState('raw-visibility')?.coverage==='ready','raw DEM decoding');
    check(air.getEntityState('raw')?.altitude===400,'Raw custom DEM did not decode to 100 metres');
    const triangles=air.getEntityState('raw')!.footprintTriangles;
    const visibilityTriangles=air.getEntityState('raw-visibility')!.footprintTriangles;
    const completedMask = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
    const completedImage = completedMask && air.map.getSource<ImageSource>(completedMask.id)?.image;
    let pickedRetained = false;
    air.on('click', event => { pickedRetained = event.attachments.some(hit => hit.entityId === 'raw-visibility' && hit.attachmentId === 'camera'); });
    for(const exaggeration of [0.5,1,2]) {
      const before=air.getEntityState('raw')!.computedAt;
      const visibilityBefore=air.getEntityState('raw-visibility')!.computedAt;
      air.configure({terrain:true,exaggeration});
      await until(()=>air.getEntityState('raw')!.computedAt>before&&air.getEntityState('raw-visibility')!.computedAt>visibilityBefore&&air.getEntityState('raw-visibility')?.coverage==='ready','terrain display recomputation');
      check(air.getEntityState('raw')?.footprintTriangles===triangles,'Terrain display changed physical coverage');
      check(air.getEntityState('raw-visibility')?.footprintTriangles===visibilityTriangles,'Exaggeration changed terrain visibility camera footprint');
      check(air.getEntityState('raw')?.altitude===400,'Exaggeration changed physical altitude');
      check(air.getEntityState('raw-visibility')?.altitude===400,'Exaggeration changed terrain visibility camera altitude');
      const maskLayer=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'));
      check(maskLayer&&air.map.getSource<ImageSource>(maskLayer.id)?.image instanceof ImageData,`Terrain visibility mask missing at exaggeration ${exaggeration}`);
      check(maskLayer && air.map.getSource<ImageSource>(maskLayer.id)?.image === completedImage, 'Exaggeration discarded completed physical coverage');
      await until(() => air.map.loaded(), 'display terrain ready');
      pickedRetained = false;
      await pointer('click', air.map.project([0, .0027]));
      check(pickedRetained, `Retained coverage was not pickable at exaggeration ${exaggeration}`);
    }
    air.configure({ projection: 'globe' });
    await until(() => air.getEntityState('raw')?.coverage === 'ready', 'globe camera overlay');
    check((air.getEntityState('raw')?.footprintTriangles ?? 0) > 0, 'Globe lost camera coverage');
    air.configure({ projection: 'flat', terrain: false });
    await until(() => air.getEntityState('raw')?.coverage === 'ready', 'Overlay restored after globe');
    air.remove(['raw','raw-visibility']);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    let remaining=0; air.on('click',event=>{remaining=event.features.length;});
    await pointer('click', air.map.project([0,0]));
    check(remaining===0,'Removed attachments still pickable');
    check(!errors.some(error=>error.code==='UPDATE_FAILED'), 'Entity overlay reported an update failure: '+errors.map(error=>error.message).join(', '));
    air.destroy();
  });
  await run('Custom DEM shifts agree with the installed renderer on both sides of zero', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(1,0,0)'; context.fillRect(0, 0, 256, 256);
    for (const [shift, expected] of [[40, 60], [-40, 140]] as const) {
      const air = createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0,
          blueFactor: 0, baseShift: shift, maxzoom: 0 }, camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
      current = air;
      try {
        await air.ready;
        air.upsert([{ ...point(`shift-${shift}`), entity: {} }]);
        await until(() => Math.abs((air.getEntityState(`shift-${shift}`)?.ground ?? NaN) - expected) < .1 &&
          Math.abs((air.map.queryTerrainElevation([0, 0]) ?? NaN) - expected) < .1, `custom shift ${shift} renderer agreement`);
        check(Math.abs(air.getEntityState(`shift-${shift}`)!.ground! - expected) < .1, `Raw custom shift ${shift} disagreed`);
      } finally { air.destroy(); }
    }
  });
  await run('TileJSON Terrarium metadata decodes flat ground in raw and displayed terrain', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
    const tilejson = { tilejson: '3.0.0', tiles: [dem.toDataURL()], minzoom: 0, maxzoom: 0,
      encoding: 'terrarium', scheme: 'tms' };
    const url = `data:application/json,${encodeURIComponent(JSON.stringify(tilejson))}`;
    const air = createViewport({ container, basemap: style(), terrain: true,
      elevation: { url }, camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = air;
    try {
      await air.ready;
      air.upsert([{ ...point('tilejson-flat'), entity: {} }]);
      await until(() => air.getEntityState('tilejson-flat')?.ground === 0 &&
        Math.abs(air.map.queryTerrainElevation([0, 0]) ?? NaN) < .1, 'TileJSON flat terrain agreement');
      check(air.getEntityState('tilejson-flat')?.ground === 0, 'TileJSON Terrarium raw height was not zero');
    } finally { air.destroy(); }
  });
  await run('A 50 km camera at latitude 46 settles with bounded raw terrain loading', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(0,0,0)'; context.fillRect(0, 0, 256, 256);
    const air = createViewport({ container, basemap: style(),
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 0, greenFactor: 0,
        blueFactor: 0, baseShift: 0, minzoom: 0, maxzoom: 12 },
      camera: { center: [0, 46], zoom: 9 }, logger: () => {} });
    current = air;
    const feature: MapFeature = { ...point('wide-range'), geometry: { type: 'Point', coordinates: [0, 46] },
      entity: { altitude: { meters: 1000, reference: 'ground' }, attachments: [{ id: 'camera', type: 'camera',
        terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 50_000 }] } };
    try {
      await air.ready;
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', '50 km terrain convergence', 20_000);
      check(air.getEntityState(feature.id)?.coverage === 'ready', 'Wide camera never reached ready');
    } finally { air.destroy(); }
  });
  await run('Exaggerated terrain keeps sphere and plain camera volume pickable', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(1,0,0)'; context.fillRect(0,0,256,256);
    const air = createViewport({ container, basemap: style(), terrain: true, exaggeration: 1,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0,0], zoom: 14, pitch: 60 }, logger: () => {} });
    current = air; await air.ready;
    const sphere: MapFeature = { ...point('pick-sphere', -.004), entity: { altitude: { meters: 200, reference: 'ground' },
      attachments: [{ id: 'sphere', type: 'sphere', radius: 35 }] } };
    const cameraAttachment: CameraAttachment = { id: 'camera', type: 'camera', bearing: 0, elevation: -45,
      fovX: 60, fovY: 40, range: 180, volumeOpacity: .3, fillOpacity: 0, outline: false };
    const camera: MapFeature = { ...point('pick-camera', .004), entity: { altitude: { meters: 200, reference: 'ground' },
      attachments: [cameraAttachment] } };
    let projection: number[] | undefined;
    const projectionLayer: CustomLayerInterface = { id: 'test:height-projection', type: 'custom', renderingMode: '3d',
      render(_gl, input) { projection = Array.from(input.defaultProjectionData.mainMatrix); } };
    air.map.addLayer(projectionLayer);
    const projectHeight = (lng: number, lat: number, height: number) => {
      const matrix = projection;
      if (!matrix) throw new Error('Map projection is unavailable');
      const coordinate = MercatorCoordinate.fromLngLat([lng, lat], height);
      const point = [coordinate.x, coordinate.y, coordinate.z, 1];
      const clip = [0, 1, 2, 3].map(row => matrix[row]! * point[0]! + matrix[row + 4]! * point[1]!
        + matrix[row + 8]! * point[2]! + matrix[row + 12]!);
      const canvas = air.map.getCanvas();
      return { x: (clip[0]! / clip[3]! + 1) * canvas.clientWidth / 2,
        y: (1 - clip[1]! / clip[3]!) * canvas.clientHeight / 2 };
    };
    let picked: string[] = [];
    let clicks = 0;
    air.on('click', event => { clicks++; picked = event.attachments.map(hit => hit.attachmentId); });
    const pick = async (screen: { x: number; y: number }) => {
      const before = clicks;
      picked = [];
      await pointer('click', screen);
      check(clicks > before, 'Real pointer click did not reach the viewport');
      return picked;
    };
    air.upsert([sphere, camera]);
    await until(() => air.getEntityState(sphere.id)?.coverage === 'ready'
      && air.getEntityState(camera.id)?.coverage === 'ready' && Boolean(projection), 'exaggerated picking geometry');
    check((air.getEntityState(camera.id)?.footprintTriangles ?? 0) > 0, 'Plain camera has no ground footprint');
    // Centroid of the face between the sensor origin and its two lower corner rays.
    const radians = Math.PI / 180;
    const elevation = cameraAttachment.elevation * radians;
    const halfX = Math.tan(cameraAttachment.fovX * radians / 2);
    const halfY = Math.tan(cameraAttachment.fovY * radians / 2);
    const north = Math.cos(elevation) + halfY * Math.sin(elevation);
    const up = Math.sin(elevation) - halfY * Math.cos(elevation);
    const distance = cameraAttachment.range * 2 / (3 * Math.hypot(halfX, north, up));
    const radius = 6371008.8 + 300 + up * distance;
    const face = { lat: Math.atan2(north * distance, radius) / radians,
      rawHeight: Math.hypot(radius, north * distance) - 6371008.8 };
    for (const exaggeration of [1, 2]) {
      const before = air.getEntityState(sphere.id)!.computedAt;
      air.configure({ exaggeration });
      if (exaggeration !== 1) await until(() => air.getEntityState(sphere.id)!.computedAt > before
        && air.getEntityState(camera.id)?.coverage === 'ready', 'exaggerated picking update');
      await until(() => air.map.loaded() && Math.abs((air.map.queryTerrainElevation([-.004, 0]) ?? 0) - 100 * exaggeration) < .1
        && Math.abs((air.map.queryTerrainElevation([.004, 0]) ?? 0) - 100 * exaggeration) < .1, 'exaggerated terrain ready for picking');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check((await pick(projectHeight(-.004, 0, 300 * exaggeration))).includes('sphere'),
        `Sphere was not pickable at exaggeration ${exaggeration}`);
      check((await pick(projectHeight(.004, face.lat, face.rawHeight * exaggeration))).includes('camera'),
        `Plain camera face was not pickable at exaggeration ${exaggeration}`);
      if (exaggeration === 2) {
        check(!(await pick(projectHeight(-.004, 0, 300))).includes('sphere'), 'Sphere remained pickable at its raw-height position');
        check(!(await pick(projectHeight(.004, face.lat, face.rawHeight))).includes('camera'), 'Camera face remained pickable at its raw-height position');
      }
    }
    air.destroy();
  });
  await run('Visible footprint stays filled when displayed terrain differs slightly from sampled terrain', async () => {
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(105,0,0)'; context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style('#000000'),terrain:true,elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:1,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},elevationSampler:{sample:()=>100},camera:{center:[0,0],zoom:17,pitch:0},entityVisibility:{footprints:true,zones:false,groundLines:false},logger:()=>{}});
    current=air; await air.ready;
    air.upsert([{...point('visible'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',color:'#00ff00',bearing:0,elevation:-90,fovX:60,fovY:60,range:1000}]}}]);
    await until(()=>air.getEntityState('visible')?.coverage==='ready' && Math.abs((air.map.queryTerrainElevation([0,0])??0)-105)<0.1,'synthetic terrain and coverage');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const pixels=await new Promise<number[]>(resolve=>{
      air.map.once('render',()=>{
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, greens:number[]=[];
        for(const lng of [-0.0006,0.0006]) for(const lat of [-0.0006,0.0006]) {
          const p=air.map.project([lng,lat]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          greens.push(pixel[1]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels.every(green=>green>50),`Visible ground has unpainted gaps: green pixels ${pixels.join(',')}`);
    air.destroy();
  });
  await run('Camera overlay remains filled across a hill without testing occlusion', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 20 * Math.exp(-(((lat * meters - 300) / 40) ** 2));
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: hill }, camera: { center: [0, 310 / meters], zoom: 17, pitch: 0 },
      entityVisibility: { footprints: true, zones: false, groundLines: false }, logger: () => {} });
    current = air; await air.ready;
    air.upsert([{ ...point('hill-shadow'), entity: { altitude: { meters: 100, reference: 'sea-level' },
      attachments: [{ id: 'camera', type: 'camera', color: '#00ff00', bearing: 0, elevation: -15, fovX: 60, fovY: 40, range: 2000 }] } }]);
    await until(() => air.getEntityState('hill-shadow')?.coverage === 'ready', 'hill coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[]>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2')!, greens: number[] = [];
        for (const north of [250, 355]) {
          const p = air.map.project([0, north / meters]), pixel = new Uint8Array(4), scale = canvas.width / canvas.clientWidth;
          gl.readPixels(Math.round(p.x * scale), canvas.height - 1 - Math.round(p.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          greens.push(pixel[1]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels[0]! > 50, `Visible approach lost coverage: ${pixels}`);
    check(pixels[1]! > 50, `Overlay incorrectly removed the far slope: ${pixels}`);
    air.destroy();
  });
  await run('Final drawing permission cannot overwrite or revive consumer data', async () => {
    const draw = createViewport({ container, basemap: style(), logger: () => {} });
    current = draw;
    try {
      await draw.ready;
      for (const action of ['cancel', 'replace', 'update', 'remove'] as const) {
        draw.clear();
        const original: MapFeature = { type: 'Feature', id: 'permission-line', properties: { revision: 1 },
          geometry: { type: 'LineString', coordinates: [[0, 0], [.001, 0]] } };
        const newer: MapFeature = { ...original, properties: { revision: 2 },
          geometry: { type: 'LineString', coordinates: [[0, 0], [.003, 0]] } };
        draw.upsert([original]);
        let settled = false, acted = false, signal: AbortSignal | undefined;
        const editor = createDrawingSession(draw, {
          createFeature: () => ({ id: 'replacement', properties: {} }),
          submit: (_change, currentSignal) => { signal = currentSignal; settled = true; return { accepted: true }; },
          canEdit: () => {
            if (settled && !acted) {
              acted = true;
              if (action === 'update') draw.upsert([newer]);
              else if (action === 'remove') draw.remove([original.id]);
              else {
                editor.cancel();
                if (action === 'replace') {
                  editor.start('line'); editor.addPoint([1, 0]); editor.addPoint([1.001, 0]);
                }
              }
            }
            return true;
          },
        });
        try {
          editor.edit(original.id); editor.moveVertex(1, [.002, 0]);
          check(await editor.finish() === false && acted, `${action} allowed stale drawing acceptance`);
          const expected = action === 'update' ? newer : action === 'remove' ? undefined : original;
          check(JSON.stringify(draw.getFeature(original.id)) === JSON.stringify(expected), `${action} lost consumer data`);
          if (action === 'update' || action === 'remove') {
            check(signal?.aborted && editor.getState().phase === 'conflict', `${action} lost its conflict or abort`);
          } else if (action === 'replace') {
            check(editor.getState().draft?.feature.id === 'replacement' && draw.getInteractionOwner() === 'drawing', 'Replacement lost its draft or ownership');
            check(await editor.finish() && !!draw.getFeature('replacement'), 'Replacement draft could not finish');
          } else check(editor.getState().phase === 'idle' && draw.getInteractionOwner() === null, 'Cancelled draft retained ownership');
        } finally { editor.destroy(); }
      }
    } finally { draw.destroy(); }
  });
  await run('Drawing creates accepted features, owns clicks, edits with keyboard and survives style reload', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center:[0,0], zoom:12 }, logger:()=>{} });
    current = draw;
    await draw.ready;
    let clicks=0, accepts=0;
    draw.on('click',()=>{clicks++;});
    const editor=attachDrawing(draw,{
      createFeature:()=>({id:'drawn',properties:{name:'Drawn'}}),
      submit:()=>{accepts++;return {accepted:true};},
    });
    const tools=document.createElement('div'),inspector=document.createElement('div');container.after(tools,inspector);
    const controls=attachDrawingControls(draw,editor,{tools,inspector});
    await until(()=>Boolean(draw.map.getSource('rl:draft')),'draft source attached');
    await browserClick('[data-field="action:Polygon"]');
    check(inspector.contains(document.activeElement), 'Starting a tool lost keyboard focus');
    for(const p of [[0,0],[.02,0],[.02,.02],[0,.02]] as [number,number][]){
      await pointer('click', draw.map.project(p));
    }
    check(clicks===0,'Drawing clicks escaped to consumer selection');
    check(container.querySelectorAll('.rl-drawing-handle').length>=4,'Vertex handles missing');
    check(!draw.getFeature('drawn'),'Unaccepted draft entered store');
    check(inspector.textContent?.includes('Area'),'Measurements missing');
    const undo = inspector.querySelector<HTMLButtonElement>('[data-field="action:Undo"]')!;
    undo.focus(); await browserKey('Control+z');
    const undone=editor.getState().draft?.shape;
    check(undone?.kind==='polygon'&&undone.vertices.length===3,'Nested controls applied Undo more than once');
    check(document.activeElement?.getAttribute('data-field')==='action:Undo','Undo lost keyboard focus');
    const redo = inspector.querySelector<HTMLButtonElement>('[data-field="action:Redo"]')!;
    redo.focus(); await browserKey('Control+Shift+z');
    const redone=editor.getState().draft?.shape;
    check(redone?.kind==='polygon'&&redone.vertices.length===4,'Nested controls applied Redo more than once');
    check(inspector.contains(document.activeElement),'Disabled redo lost keyboard focus');
    editor.setStyle({fillOpacity:0.29});
    check(inspector.querySelector<HTMLInputElement>('[data-field="Opacity (%)"]')?.value==='29','Opacity displayed floating-point noise');
    await browserClick('[data-field="action:Finish"]');
    await until(() => accepts === 1, 'drawing accepted through Finish control');
    check(accepts===1&&draw.getFeature('drawn')?.geometry.type==='Polygon','Accepted polygon not stored');
    editor.edit('drawn');
    const original=JSON.stringify(editor.getState().draft?.shape);
    const handle=container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
    handle.focus();await browserKey('ArrowRight');
    check(JSON.stringify(editor.getState().draft?.shape)!==original,'Keyboard did not move a vertex');
    editor.undo();check(JSON.stringify(editor.getState().draft?.shape)===original,'Draft undo failed');
    draw.configure({basemap:style('#dddddd'),projection:'globe'});
    await until(()=>Boolean(draw.map.getLayer('rl:draft-fill')),'draft restored after style replacement');
    check(Boolean(editor.getState().draft),'Style replacement discarded the draft');
    await until(() => draw.map.querySourceFeatures('rl:features').some(hit => hit.properties._rl_feature_id === 'drawn'), 'edited source restored');
    const editedSource = draw.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === 'drawn');
    await until(() => editedSource?.id !== undefined && Boolean(draw.map.getFeatureState({source:'rl:features',id:editedSource.id}).editing), 'editing state restored');
    check(editedSource?.id !== undefined && draw.map.getFeatureState({source:'rl:features',id:editedSource.id}).editing,'Original feature not hidden during edit');
    editor.cancel();check(editedSource?.id !== undefined && !draw.map.getFeatureState({source:'rl:features',id:editedSource.id}).editing,'Cancel left original hidden');
    controls.destroy();editor.destroy();check(!container.querySelector('.rl-drawing-handle'),'Handle leaked on destroy');
    check(!draw.map.getSource('rl:draft'),'Draft source leaked on destroy');
    draw.destroy();tools.remove();inspector.remove();
  });
  await run('Inspector label editing preserves Tab and the first real Finish click', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    let accepts = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'inspector-finish', properties: {} }), submit: () => { accepts++; return { accepted: true }; } });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.id = 'case25-inspector'; container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      if (!window.browserFill || !window.browserKey || !window.browserClick) throw new Error('Playwright input bridge required');
      await window.browserFill('#case25-inspector [data-field="Label"]', 'First label');
      await window.browserKey('Tab');
      check(document.activeElement?.getAttribute('data-field') === 'Stroke', 'Tab skipped the next inspector field');
      await window.browserFill('#case25-inspector [data-field="Label"]', 'Final label');
      await window.browserClick('#case25-inspector [data-field="action:Finish"]');
      await until(() => Boolean(draw.getFeature('inspector-finish')), 'first Finish click accepted');
      check(accepts === 1 && draw.getFeature('inspector-finish')?.drawing?.style.label === 'Final label', 'Finish lost the label or submitted twice');
    } finally {
      controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
    }
  });
  await run('Inspector rectangle fields retain consecutive native edits and undo history', async () => {
    const shape = { kind: 'rectangle' as const, center: [0, 0] as [number, number], width: 100, height: 80, bearing: 0 };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 15 },
      features: [{ type: 'Feature', id: 'rectangle-fields', properties: {}, geometry: shapeGeometry(shape), drawing: { version: 1, shape, style: { color: '#008855', fillColor: '#008855', lineWidth: 2, fillOpacity: .2, dashed: false, label: '' } } }], logger: () => {} });
    current = draw; await draw.ready;
    let accepts = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }), submit: () => { accepts++; return { accepted: true }; } });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.id = 'rectangle-inspector';
    // Consumer controls sit outside the clipped MapLibre viewport.
    document.body.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    const dimensions = (width: number, height: number, bearing: number) => {
      const current = editor.getState().draft?.shape;
      check(current?.kind === 'rectangle' && current.width === width && current.height === height && current.bearing === bearing,
        `Expected rectangle ${width}/${height}/${bearing}, received ${JSON.stringify(current)}`);
    };
    try {
      editor.edit('rectangle-fields');
      if (!window.browserFill) throw new Error('Playwright fill bridge required');
      await window.browserFill('#rectangle-inspector [data-field="Width (m)"]', '240');
      await browserKey('Tab');
      check(document.activeElement?.getAttribute('data-field') === 'Height (m)', 'Width Tab missed Height');
      await window.browserFill('#rectangle-inspector [data-field="Height (m)"]', '160');
      await browserKey('Tab');
      check(document.activeElement?.getAttribute('data-field') === 'Bearing (°)', 'Height Tab missed Bearing');
      await window.browserFill('#rectangle-inspector [data-field="Bearing (°)"]', '35');
      await browserKey('Tab');
      dimensions(240, 160, 35);
      await browserClick('#rectangle-inspector [data-field="action:Undo"]'); dimensions(240, 160, 0);
      await browserClick('#rectangle-inspector [data-field="action:Undo"]'); dimensions(240, 80, 0);
      await browserClick('#rectangle-inspector [data-field="action:Undo"]'); dimensions(100, 80, 0);
      for (let i = 0; i < 3; i++) await browserClick('#rectangle-inspector [data-field="action:Redo"]');
      dimensions(240, 160, 35);
      await browserClick('#rectangle-inspector [data-field="action:Finish"]');
      await until(() => accepts === 1 && editor.getState().phase === 'idle', 'rectangle accepted once');
      const accepted = draw.getFeature('rectangle-fields')?.drawing?.shape;
      check(accepted?.kind === 'rectangle' && accepted.width === 240 && accepted.height === 160 && accepted.bearing === 35,
        'Finish lost consecutive rectangle changes');
    } finally { controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove(); }
  });
  await run('Deleting the focused final vertex keeps keyboard undo reachable', async () => {
    const line: MapFeature = { type: 'Feature', id: 'focus-line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'new-focus', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      editor.edit('focus-line');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      handle.focus();
      if (!window.browserKey) throw new Error('Playwright keyboard bridge required');
      await window.browserKey('Delete');
      const shape = editor.getState().draft?.shape;
      check(shape?.kind === 'line' && shape.vertices.length === 1, 'Delete did not remove the last vertex');
      const focus = document.activeElement;
      check(focus instanceof HTMLElement && focus.isConnected &&
        (focus.getAttribute('aria-label') === 'Vertex 1' || focus.getAttribute('aria-label') === 'Move drawing' || focus === draw.map.getCanvas()),
      'Deleting the focused handle lost editor focus');
      await window.browserKey('Control+z');
      const restored = editor.getState().draft?.shape;
      check(restored?.kind === 'line' && restored.vertices.length === 2, 'Keyboard undo could not restore the deleted vertex');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Undo during a real vertex drag leaves later edits individually undoable', async () => {
    const line: MapFeature = { type: 'Feature', id: 'gesture-line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'new-gesture', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      editor.edit('gesture-line');
      await until(() => draw.map.loaded(), 'gesture map ready');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      const rect = handle.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      if (!window.browserMouse || !window.browserKey) throw new Error('Playwright input bridge required');
      await window.browserMouse('down', x, y);
      await window.browserMouse('move', x + 40, y);
      await until(() => {
        const shape = editor.getState().draft?.shape;
        return shape?.kind === 'line' && shape.vertices[1]?.[0] !== .01;
      }, 'vertex moved during drag');
      await window.browserKey('Control+z');
      await window.browserMouse('up', x + 40, y);
      const afterUndo = editor.getState().draft?.shape;
      check(afterUndo?.kind === 'line' && Math.abs((afterUndo.vertices[1]?.[0] ?? 0) - .01) < 1e-10, 'Undo during drag left the moved vertex');
      editor.insertVertex(0, [.005, 0]);
      editor.moveVertex(1, [.006, 0]);
      editor.undo();
      const afterMoveUndo = editor.getState().draft?.shape;
      check(afterMoveUndo?.kind === 'line' && afterMoveUndo.vertices.length === 3 && afterMoveUndo.vertices[1]?.[0] === .005,
        'Undo skipped the later vertex move');
      editor.undo();
      const afterInsertUndo = editor.getState().draft?.shape;
      check(afterInsertUndo?.kind === 'line' && afterInsertUndo.vertices.length === 2, 'Undo skipped the later insertion');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Rejected submission during a handle drag keeps the next keyboard edit separate', async () => {
    const line: MapFeature = { type: 'Feature', id: 'submitted-drag', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [line], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-submission', properties: {} }),
      submit: () => ({ accepted: false, reason: 'Try another position' }) });
    try {
      editor.edit('submitted-drag');
      await until(() => draw.map.loaded(), 'submission drag map ready');
      const original = JSON.stringify(editor.getState().draft?.shape);
      let finishing: Promise<boolean> | undefined;
      let submitted = false;
      const off = editor.onChange(() => {
        const shape = editor.getState().draft?.shape;
        if (!submitted && shape?.kind === 'line' && JSON.stringify(shape) !== original) {
          submitted = true;
          finishing = editor.finish();
        }
      });
      try {
        const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
        if (!handle || !window.browserMouse) throw new Error('Playwright handle input bridge unavailable');
        const box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        await window.browserMouse('down', x, y);
        await window.browserMouse('move', x + 40, y);
        await until(() => Boolean(finishing) && editor.getState().phase === 'rejected', 'drag submission rejected');
        await window.browserMouse('up', x + 40, y);
        check(await finishing === false, 'Consumer rejection was not returned');
        const dragged = JSON.stringify(editor.getState().draft?.shape);
        check(dragged !== original, 'Submission began without a valid drag movement');
        const focused = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
        if (!focused) throw new Error('Rejected draft lost its vertex handle');
        focused.focus();
        await browserKey('ArrowRight');
        const keyboard = JSON.stringify(editor.getState().draft?.shape);
        check(keyboard !== dragged, 'Keyboard step after rejection did not edit the draft');
        editor.undo();
        check(JSON.stringify(editor.getState().draft?.shape) === dragged,
          'First undo after rejection reverted the drag together with the keyboard step');
        editor.undo();
        check(JSON.stringify(editor.getState().draft?.shape) === original,
          'Second undo after rejection did not restore the pre-drag geometry');
      } finally { off(); }
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Revoking edit permission during a handle drag clears feedback and restores the handle', async () => {
    const line: MapFeature = { type: 'Feature', id: 'permission-drag', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [line], logger: () => {} });
    current = draw; await draw.ready;
    let permitted = true;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-permission', properties: {} }),
      canEdit: () => permitted, submit: () => ({ accepted: true }) });
    try {
      editor.edit('permission-drag');
      await until(() => draw.map.loaded(), 'permission drag map ready');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
      if (!handle || !window.browserMouse) throw new Error('Real handle input bridge unavailable');
      const box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const canvasBox = draw.map.getCanvas().getBoundingClientRect();
      const initialPosition = draw.map.project([.01, 0]);
      const markerOffset = { x: x - canvasBox.left - initialPosition.x, y: y - canvasBox.top - initialPosition.y };
      await window.browserMouse('down', x, y);
      await window.browserMouse('move', x + 40, y);
      await until(() => {
        const shape = editor.getState().draft?.shape;
        return shape?.kind === 'line' && shape.vertices[1]?.[0] !== .01;
      }, 'vertex moved before permission loss');
      const moved = JSON.stringify(editor.getState().draft?.shape);
      permitted = false;
      editor.refreshPermissions();
      check(editor.getState().phase === 'forbidden', 'Revoked permission did not lock the draft');
      check(container.querySelector('.rl-ground-feedback')?.hasAttribute('hidden') === true,
        'Revoked permission retained drag feedback');
      check(handle.disabled, 'Revoked permission left the handle enabled');
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line') throw new Error('Revoked permission lost the line draft');
      const expected = draw.map.project(shape.vertices[1]!);
      const lockedBox = handle.getBoundingClientRect();
      check(Math.hypot(lockedBox.left + lockedBox.width / 2 - canvasBox.left - expected.x - markerOffset.x,
        lockedBox.top + lockedBox.height / 2 - canvasBox.top - expected.y - markerOffset.y) < 2,
      'Revoked permission left the handle away from its draft position');
      await window.browserMouse('up', x + 40, y);
      check(JSON.stringify(editor.getState().draft?.shape) === moved, 'Drag changed after permission loss');
      permitted = true;
      editor.refreshPermissions();
      check(!handle.disabled && editor.getState().phase === 'editing', 'Restored permission did not unlock the handle');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Ordinary edits preserve dynamic styles, delete-only controls, and hover recovery', async () => {
    const line: MapFeature = {type:'Feature',id:'line',geometry:{type:'LineString',coordinates:[[-.01,0],[.01,0]]},properties:{closed:false}};
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[line,point('hover',.02)],
      style:feature=>({color:feature.properties.closed?'#cc2222':'#008855',dashed:true,lineWidth:2}),logger:()=>{}});
    current=draw;await draw.ready;
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).length>0,'hover target rendered');
    let hovers=0; draw.on('hover',()=>hovers++);
    const hover=()=>pointer('move',draw.map.project([.02,0]));
    await hover();const previous=hovers,release=draw.acquireInteraction('test');
    await pointer('move',draw.map.project([0,0]));await hover();release();
    check(hovers===previous,'Interaction owner leaked hover events');
    await pointer('move',draw.map.project([0,0]));await hover();
    check(hovers>previous,'Hover did not resume after releasing interaction ownership');
    const orangePixels=()=>new Promise<number>(resolve=>{
      draw.map.once('render',()=>{
        const canvas=draw.map.getCanvas(),gl=canvas.getContext('webgl2')!,scale=canvas.width/canvas.clientWidth,p=draw.map.project([0,0]);
        const pixels=new Uint8Array(100*24*4);
        gl.readPixels(Math.round(p.x*scale)-50,canvas.height-Math.round(p.y*scale)-12,100,24,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]!-219)<3&&Math.abs(pixels[i+1]!-106)<3&&Math.abs(pixels[i+2]!-32)<3)count++;
        resolve(count);
      });draw.map.triggerRepaint();
    });
    draw.preview('line');const hovered=await orangePixels();
    draw.setSelection(['line']);const selected=await orangePixels();
    check(hovered>0&&selected>hovered,'Dashed line did not show hover color and selection width');
    let deleteOnly=false;
    const editor=attachDrawing(draw,{createFeature:()=>({id:'new',properties:{}}),styleFields:[],canEdit:(_f,op)=>!deleteOnly||op==='delete',submit:()=>({accepted:true})});
    const tools=document.createElement('div'),inspector=document.createElement('div');container.after(tools,inspector);
    const controls=attachDrawingControls(draw,editor,{tools,inspector});
    editor.edit('line');editor.moveVertex(1,[.015,0]);check(await editor.finish(),'Ordinary edit failed');
    check(!draw.getFeature('line')?.drawing,'Geometry-only edit added fixed appearance');
    draw.upsert([{...draw.getFeature('line')!,properties:{closed:true}}]);
    check(draw.getStyle(draw.getFeature('line')!).color==='#cc2222','Consumer style stopped following properties');
    deleteOnly=true;editor.edit('line');
    const button=inspector.querySelector<HTMLButtonElement>('[data-field="action:Delete drawing"]')!;
    check(!button.disabled,'Delete-only permission disabled the Delete control');await browserClick('[data-field="action:Delete drawing"]');
    await until(()=>!draw.getFeature('line'),'delete-only action applied');
    controls.destroy();editor.destroy();draw.destroy();tools.remove();inspector.remove();
  });
  await run('Drawing snapping visits only nearby rendered candidates', async () => {
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[point('near',0),point('far',0.04)],logger:()=>{}});
    current=draw;await draw.ready;
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).length>=2,'snap targets rendered');
    const visited:string[]=[];
    const editor=attachDrawing(draw,{createFeature:()=>({id:'snapped',properties:{}}),submit:()=>({accepted:true}),canSnap:feature=>{visited.push(feature.id);return true;}});
    editor.start('line');
    const origin=draw.map.project([0,0]);
    const cursor={x:origin.x+4,y:origin.y};
    await pointer('click',cursor);
    const shape=editor.getState().draft?.shape;
    check(shape?.kind==='line'&&shape.vertices[0]?.[0]===0&&shape.vertices[0]?.[1]===0,'Nearby vertex did not snap');
    check(visited.length>0&&visited.every(id=>id==='near'),'Snapping inspected features outside its pointer radius');
    editor.destroy();draw.destroy();
  });
  await run('Snap callback replacement leaves no stale handle drag behind', async () => {
    const line: MapFeature = { type: 'Feature', id: 'edited-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[.02, 0], [.03, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [.01, 0], zoom: 13 },
      features: [line, point('snap-replacement-anchor', 0)], logger: () => {} });
    current = draw; await draw.ready;
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] })
      .some(hit => hit.properties._rl_feature_id === 'snap-replacement-anchor'), 'replacement snap anchor rendered');
    let editor: ReturnType<typeof attachDrawing>;
    let replaced = false;
    editor = attachDrawing(draw, { createFeature: () => ({ id: 'replacement-draft', properties: {} }),
      submit: () => ({ accepted: true }), canSnap: feature => {
        if (feature.id === 'snap-replacement-anchor' && !replaced) {
          replaced = true;
          editor.cancel();
          editor.start('line');
        }
        return true;
      } });
    try {
      editor.edit('edited-line');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      if (!handle) throw new Error('Editable vertex handle missing');
      const box = handle.getBoundingClientRect(), target = draw.map.project([0, 0]);
      await browserDrag(box.left + box.width / 2, box.top + box.height / 2,
        draw.map.getCanvas().getBoundingClientRect().left + target.x + 5,
        draw.map.getCanvas().getBoundingClientRect().top + target.y);
      check(replaced, 'Real handle drag did not reach canSnap');
      const state = editor.getState();
      check(state.phase === 'editing' && state.draft?.feature.id === 'replacement-draft' &&
        state.draft.placed === 0 && state.draft.shape.kind === 'line' && state.draft.shape.vertices.length === 0,
      'Old handle drag changed the replacement draft');
      check(editor.getPreview() === undefined && !!container.querySelector('.rl-ground-feedback[hidden]'),
        'Old handle drag left feedback on the replacement draft');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Stationary Alt toggles visible snap preview and placed vertex', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('eligible', .025), point('filtered', -.025),
        { ...point('airborne', .05), entity: { altitude: { meters: 100, reference: 'sea-level' } } }], logger: () => {} });
    current = draw; await draw.ready;
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).length >= 3, 'snap candidates rendered');
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'alt-snap', properties: {} }),
      canSnap: feature => feature.id !== 'filtered', submit: () => ({ accepted: true }) });
    const eligible = draw.getFeature('eligible');
    if (eligible?.geometry.type !== 'Point') throw new Error('Eligible snap feature missing');
    const eligiblePosition = eligible.geometry.coordinates;
    const anchor = draw.map.project([.025, 0]);
    const screen = { x: anchor.x + 6, y: anchor.y };
    try {
      editor.start('line');
      await pointer('move', screen);
      const snapped = editor.getPreview();
      check(snapped?.kind === 'line' && Math.abs((snapped.vertices[0]?.[0] ?? 0) - eligiblePosition[0]!) < 1e-10 &&
        snapped.vertices[0]?.[1] === eligiblePosition[1],
        `Visible eligible vertex did not win the ground target: ${JSON.stringify({ snapped, anchor, screen,
          hits: draw.map.queryRenderedFeatures([[screen.x - 12, screen.y - 12], [screen.x + 12, screen.y + 12]], { layers: ['rl:points'] })
            .map(hit => hit.properties._rl_feature_id) })}`);
      const snappedCoordinate = snapped?.kind === 'line' ? snapped.vertices[0] : undefined;
      check(!!container.querySelector('.rl-ground-snap-ring:not([hidden])') &&
        !!container.querySelector('.rl-ground-snap-guide:not([hidden])'), 'Displaced snap target lost its ring or guide');
      if (!window.browserKeyDown || !window.browserKeyUp) throw new Error('Playwright held-key bridge required');
      await window.browserKeyDown('Alt');
      await until(() => {
        const preview = editor.getPreview();
        return preview?.kind === 'line' && Math.abs((preview.vertices[0]?.[0] ?? 0) - .025) > 1e-5;
      }, 'stationary Alt bypass preview');
      check(!!container.querySelector('.rl-ground-snap-ring[hidden]'), 'Alt bypass retained the snap indicator');
      const free = editor.getPreview();
      await window.browserKeyUp('Alt');
      await until(() => {
        const preview = editor.getPreview();
        return preview?.kind === 'line' && JSON.stringify(preview.vertices[0]) === JSON.stringify(snappedCoordinate);
      }, 'stationary Alt release restores snapping');
      await window.browserKeyDown('Alt');
      await until(() => {
        const preview = editor.getPreview();
        return preview?.kind === 'line' && JSON.stringify(preview.vertices[0]) === JSON.stringify(free?.kind === 'line' ? free.vertices[0] : undefined);
      }, 'stationary Alt press restores free placement');
      await pointer('click', screen);
      const placed = editor.getState().draft?.shape;
      check(placed?.kind === 'line' && free?.kind === 'line' &&
        Math.hypot(draw.map.project(placed.vertices[0]!).x - screen.x,
          draw.map.project(placed.vertices[0]!).y - screen.y) < 2 &&
        JSON.stringify(placed.vertices[0]) === JSON.stringify(free.vertices[0]),
      'Alt placement disagreed with the unsnapped preview');
      await window.browserKeyUp('Alt');
      editor.cancel();
      editor.start('line');
      await pointer('move', screen);
      await pointer('click', screen);
      const snappedPlacement = editor.getState().draft?.shape;
      check(snappedPlacement?.kind === 'line' &&
        JSON.stringify(snappedPlacement.vertices[0]) === JSON.stringify(snappedCoordinate),
        'Released Alt placement did not copy the anchor exactly');
      editor.cancel();
      for (const id of ['filtered', 'airborne']) {
        editor.start('line');
        const target = draw.map.project(id === 'filtered' ? [-.025, 0] : [.05, 0]);
        await pointer('move', { x: target.x + 6, y: target.y });
        const preview = editor.getPreview();
        check(preview?.kind === 'line' && Math.abs((preview.vertices[0]?.[0] ?? 0) -
          (id === 'filtered' ? -.025 : .05)) > 1e-5, `${id} became a snap target`);
        editor.cancel();
      }
    } finally {
      await window.browserKeyUp?.('Alt');
      editor.destroy(); draw.destroy();
    }
  });
  await run('Invalid terrain preserves ground handle edits and keyboard movement', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    dem.getContext('2d')!.fillStyle = 'rgb(100,0,0)';
    dem.getContext('2d')!.fillRect(0, 0, 256, 256);
    const line: MapFeature = { type: 'Feature', id: 'terrain-edit', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 1,
        greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} });
    current = draw; await draw.ready;
    await until(() => draw.map.queryTerrainElevation([0, 0]) === 0, 'edit terrain loaded');
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }),
      submit: () => ({ accepted: true }) });
    try {
      editor.start('line');
      await pointer('move', draw.map.project([0, 0]));
      await until(() => editor.getPreview()?.kind === 'line' &&
        !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'loaded edit terrain target');
      editor.cancel();
      editor.edit('terrain-edit');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
      handle.focus();
      await browserKey('ArrowRight');
      const beforeDrag = editor.getState().draft?.shape;
      check(beforeDrag?.kind === 'line' && beforeDrag.vertices[0]?.[0] !== 0,
        `Valid keyboard move did not reach the draft: ${JSON.stringify({ beforeDrag, active: document.activeElement?.getAttribute('aria-label'),
          elevation: draw.map.queryTerrainElevation([0, 0]), unavailable: !!container.querySelector('.rl-ground-unavailable:not([hidden])'),
          handle: handle.getBoundingClientRect().toJSON() })}`);
      const box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      await window.browserMouse('down', x, y);
      await window.browserMouse('move', x + 40, y + 20);
      await until(() => {
        const shape = editor.getState().draft?.shape;
        return shape?.kind === 'line' && JSON.stringify(shape) !== JSON.stringify(beforeDrag);
      }, 'valid ground drag step');
      const lastValid = JSON.stringify(editor.getState().draft?.shape);
      draw.configure({ elevation: { tiles: ['/missing-edit-dem.png'], encoding: 'custom', redFactor: 1,
        greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 } });
      await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'),
        'stationary drag reacts to unavailable terrain');
      check(JSON.stringify(editor.getState().draft?.shape) === lastValid,
        'Terrain loss changed a stationary drag');
      await window.browserMouse('move', x + 80, y + 40);
      await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'invalid drag feedback');
      check(JSON.stringify(editor.getState().draft?.shape) === lastValid, 'Invalid drag changed the last valid shape');
      await window.browserMouse('up', x + 80, y + 40);
      handle.focus();
      await browserKey('Shift+ArrowRight');
      check(JSON.stringify(editor.getState().draft?.shape) === lastValid, 'Invalid large keyboard step changed the shape');
      editor.undo();
      check(JSON.stringify(editor.getState().draft?.shape) === JSON.stringify(beforeDrag),
        'One undo did not restore the shape before the drag');

      editor.cancel();
      const circleShape = { kind: 'circle' as const, center: [-.02, 0] as [number, number], radius: 200 };
      const circle: MapFeature = { type: 'Feature', id: 'terrain-circle', properties: {}, geometry: shapeGeometry(circleShape),
        drawing: { version: 1, shape: circleShape, style: { color: '#008855', fillColor: '#008855',
          lineWidth: 2, fillOpacity: .2, dashed: false, label: '' } } };
      const polygon: MapFeature = { type: 'Feature', id: 'terrain-polygon', properties: {},
        geometry: { type: 'Polygon', coordinates: [[[0, .003], [.004, .003], [.004, .007], [0, .007], [0, .003]]] } };
      const groundPoint: MapFeature = { type: 'Feature', id: 'terrain-point', properties: {},
        geometry: { type: 'Point', coordinates: [.02, 0] } };
      draw.upsert([groundPoint, circle, polygon]);
      for (const [id, label] of [['terrain-point', 'Position'], ['terrain-circle', 'Radius'],
        ['terrain-polygon', 'Move drawing']] as const) {
        const accepted = JSON.stringify(draw.getFeature(id));
        editor.edit(id);
        const unchanged = JSON.stringify(editor.getState().draft?.shape);
        const editHandle = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
        if (!editHandle) throw new Error(`${label} handle missing`);
        const bounds = editHandle.getBoundingClientRect();
        const startX = bounds.left + bounds.width / 2, startY = bounds.top + bounds.height / 2;
        await window.browserMouse('down', startX, startY);
        await window.browserMouse('move', startX + 35, startY + 20);
        await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), `${label} unavailable drag feedback`);
        check(JSON.stringify(editor.getState().draft?.shape) === unchanged, `${label} drag changed geometry on missing terrain`);
        await window.browserMouse('up', startX + 35, startY + 20);
        editHandle.focus();
        await browserKey('Shift+ArrowRight');
        check(JSON.stringify(editor.getState().draft?.shape) === unchanged, `${label} keyboard step changed geometry on missing terrain`);
        editor.cancel();
        check(JSON.stringify(draw.getFeature(id)) === accepted, `${label} edit changed accepted geometry or shape metadata`);
      }
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Old keyboard feedback cannot clear a later unavailable click', async () => {
    const line: MapFeature = { type: 'Feature', id: 'timer-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: ['/missing-keyboard-dem.png'], encoding: 'custom', redFactor: 1,
        greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'later-draft', properties: {} }),
      submit: () => ({ accepted: true }) });
    try {
      editor.edit('timer-line');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      if (!handle || !window.browserMouse || !window.browserStationaryClick) throw new Error('Real input bridge unavailable');
      const box = handle.getBoundingClientRect();
      await window.browserMouse('move', box.left + box.width / 2, box.top + box.height / 2);
      handle.focus();
      await browserKey('ArrowRight');
      check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'Invalid keyboard step gave no feedback');
      editor.cancel();
      editor.start('line');
      await window.browserStationaryClick();
      check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'Unavailable click gave no feedback');
      await new Promise(resolve => setTimeout(resolve, 850));
      check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'),
        'Old keyboard timer cleared the newer unavailable click');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Ground drawing target follows real pointer placement and clears on sky', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12, pitch: 85 }, logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'ground-target', properties: {} }), submit: () => ({ accepted: true }) });
    editor.start('line');
    const center = draw.map.project([0, 0]);
    await pointer('move', center);
    const crosshair = container.querySelector<SVGPathElement>('.rl-ground-crosshair');
    if (!crosshair || crosshair.hasAttribute('hidden')) throw new Error('Ground target did not appear');
    check(!container.querySelector('.rl-ground-footprint')?.hasAttribute('hidden'), 'Ground contact footprint did not appear');
    await pointer('click', center);
    const shape = editor.getState().draft?.shape;
    if (shape?.kind !== 'line' || shape.vertices.length !== 1) throw new Error('Ground click did not place one point');
    const placed = draw.map.project(shape.vertices[0]!);
    check(Math.hypot(placed.x - center.x, placed.y - center.y) < 2, 'Placed point disagrees with target');
    const bounds = draw.map.getCanvas().getBoundingClientRect();
    await window.browserMouse!('move', bounds.right + 10, bounds.top + center.y);
    check(crosshair.hasAttribute('hidden'), 'Leaving the canvas retained placement feedback');
    await pointer('move', center);
    check(!crosshair.hasAttribute('hidden'), 'Re-entering the canvas did not restore placement feedback');
    await window.browserMouse!('down', bounds.left + center.x + 35, bounds.top + center.y + 35);
    await window.browserMouse!('move', bounds.left + center.x + 75, bounds.top + center.y + 55);
    check(crosshair.hasAttribute('hidden'), 'Map drag kept placement feedback visible');
    await window.browserMouse!('up', bounds.left + center.x + 75, bounds.top + center.y + 55);
    check(editor.getState().draft?.placed === 1, 'Map drag placed a point');
    draw.configure({ projection: 'globe' });
    draw.setCamera({ center: [0, 0], zoom: 1, pitch: 0 });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const sky = { x: 2, y: 2 };
    await pointer('move', sky);
    check(crosshair.hasAttribute('hidden'), 'Sky pointer kept a ground target');
    await pointer('click', sky);
    check(editor.getState().draft?.placed === 1, 'Sky click changed the draft');
    editor.cancel();
    check(crosshair.hasAttribute('hidden'), 'Cancellation retained ground feedback');
    check(draw.map.getCanvas().style.cursor !== 'none', 'Cancellation retained the drawing cursor override');
    editor.destroy();
    const plain = attachDrawing(draw, { visualFeedback: false,
      createFeature: () => ({ id: 'no-visual', properties: {} }), submit: () => ({ accepted: true }) });
    plain.start('line');
    draw.configure({ projection: 'flat' });
    draw.setCamera({ center: [0, 0], zoom: 12, pitch: 0 });
    await pointer('click', draw.map.project([0, 0]));
    check(plain.getState().draft?.placed === 1, 'Visual opt-out disabled placement');
    check(!container.querySelector('.rl-ground-feedback'), 'Visual opt-out created an overlay');
    plain.destroy(); draw.destroy();
  });
  await run('Navigation and feature hover give way to active ground placement', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('hover-target', .025)], logger: () => {} });
    current = draw; await draw.ready;
    const canvas = draw.map.getCanvas();
    canvas.style.cursor = 'help';
    const requests: string[][] = [];
    const hoverIds: string[] = [];
    draw.on('selectionrequest', event => requests.push(event.ids));
    draw.on('hover', event => hoverIds.push(event.features[0]?.id ?? ''));
    const ui = attachInteractions(draw);
    const feature = draw.map.project([.025, 0]);
    const empty = draw.map.project([-.025, 0]);
    await pointer('move', empty);
    check(canvas.style.cursor === 'grab', 'Empty map did not show navigation cursor');
    check(!container.querySelector('.rl-ground-feedback'), 'Ordinary navigation created a ground target');
    await pointer('move', feature);
    check(canvas.style.cursor === 'pointer', 'Selectable feature did not show hover cursor');
    check(requests.length === 0, 'Hover requested selection');
    await pointer('click', feature);
    check(requests.at(-1)?.[0] === 'hover-target', 'Feature selection changed');
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'navigation-line', properties: {} }),
      submit: () => ({ accepted: true }) });
    editor.start('line');
    await pointer('move', feature);
    check(canvas.style.cursor === 'none', 'Feature hover overrode the ground target');
    await pointer('click', feature);
    check(editor.getState().draft?.placed === 1 && requests.length === 1, 'Feature stole the placement click');
    const before = editor.getState().draft?.shape;
    const bounds = canvas.getBoundingClientRect();
    const from = { x: bounds.left + empty.x, y: bounds.top + empty.y };
    await window.browserMouse!('down', from.x, from.y);
    await window.browserMouse!('move', from.x + 55, from.y + 25);
    check(container.querySelector('.rl-ground-feedback')?.hasAttribute('hidden'), 'Navigation retained target feedback');
    check(canvas.style.cursor === 'grabbing', 'Navigation did not show grabbing feedback');
    await window.browserMouse!('up', from.x + 55, from.y + 25);
    check(editor.getState().draft?.placed === 1 && JSON.stringify(editor.getState().draft?.shape) === JSON.stringify(before), 'Drag changed the draft');
    await until(() => !container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'target resumed after navigation');
    const bearing = draw.map.getBearing();
    await window.browserDrag!(from.x, from.y, from.x + 45, from.y + 40, 'right');
    await until(() => Math.abs(draw.map.getBearing() - bearing) > 1, 'right drag rotated camera');
    await until(() => !container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'target resumed after rotation');
    check(editor.getState().draft?.placed === 1 && requests.length === 1, 'Rotation changed drawing or selection');
    const featureAfterRotation = draw.map.project([.025, 0]);
    await pointer('move', featureAfterRotation);
    editor.cancel();
    await until(() => canvas.style.cursor === 'pointer', 'feature hover resumed after drawing release');
    editor.destroy(); ui.destroy();
    check(canvas.style.cursor === 'help', 'Detach did not restore the earlier cursor');
    const quietUi = attachInteractions(draw, { visualFeedback: false, hover: false, picker: false });
    const currentFeature = draw.map.project([.025, 0]);
    await pointer('move', currentFeature);
    check(canvas.style.cursor === 'help', 'Interaction visual opt-out changed the cursor');
    await pointer('click', currentFeature);
    check(requests.at(-1)?.[0] === 'hover-target', 'Interaction visual opt-out disabled selection');
    quietUi.destroy();
    const quietDrawing = attachDrawing(draw, { visualFeedback: false,
      createFeature: () => ({ id: 'quiet-navigation-line', properties: {} }), submit: () => ({ accepted: true }) });
    quietDrawing.start('line');
    await pointer('click', currentFeature);
    check(quietDrawing.getState().draft?.placed === 1 && !container.querySelector('.rl-ground-feedback'),
      'Drawing visual opt-out changed placement or created feedback');
    quietDrawing.destroy();
    const removalUi = attachInteractions(draw);
    await pointer('move', draw.map.project([.025, 0]));
    check(canvas.style.cursor === 'pointer', 'Feature cursor did not resume after visual opt-out');
    draw.upsert([point('hover-target', -.025)]);
    await until(() => canvas.style.cursor === 'grab', 'cursor followed feature moved away from stationary pointer');
    check(hoverIds.at(-1) === '', 'Moving a feature away did not clear stationary hover');
    draw.upsert([point('hover-target', .025)]);
    await until(() => canvas.style.cursor === 'pointer', 'cursor followed feature moved under stationary pointer');
    check(hoverIds.at(-1) === 'hover-target', 'Moving a feature under the pointer did not restore hover');
    const cameraCenter = draw.map.getCenter().toArray();
    await new Promise<void>(resolve => {
      draw.map.once('moveend', () => resolve());
      draw.setCamera({ center: [cameraCenter[0] + .2, cameraCenter[1]] });
    });
    check(canvas.style.cursor === 'grab' && hoverIds.at(-1) === '',
      'Moving the camera did not clear stationary feature hover at move end');
    await new Promise<void>(resolve => {
      draw.map.once('moveend', () => resolve());
      draw.setCamera({ center: cameraCenter });
    });
    check(canvas.style.cursor === 'pointer' && hoverIds.at(-1) === 'hover-target',
      'Returning the camera did not restore stationary feature hover at move end');
    draw.remove(['hover-target']);
    check(canvas.style.cursor === 'grab', 'Removing hovered feature retained the pointer cursor');
    removalUi.destroy();
    draw.destroy();
  });
  await run('Ground feedback respects preview callbacks that cancel, destroy, or replace drawing', async () => {
    for (const action of ['cancel', 'destroy', 'replace'] as const) {
      const draw = createViewport({ container, basemap: style(), terrain: false,
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
      current = draw; await draw.ready;
      let nextId = 0;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: `callback-draft-${nextId++}`, properties: {} }),
        submit: () => ({ accepted: true }) });
      const canvas = draw.map.getCanvas();
      canvas.style.cursor = 'help';
      editor.start('line');
      let invoked = false;
      editor.onPreview(() => {
        if (invoked) return;
        invoked = true;
        if (action === 'replace') { editor.cancel(); editor.start('line'); }
        else editor[action]();
      });
      const screen = draw.map.project([0, 0]);
      await pointer('move', screen);
      check(invoked, `${action} callback did not run`);
      const state = editor.getState();
      check(action === 'replace'
        ? state.phase === 'editing' && state.draft?.feature.id === 'callback-draft-1' && state.draft.placed === 0
        : state.phase === 'idle', `${action} callback left the wrong drawing session`);
      const feedback = container.querySelector('.rl-ground-feedback');
      check(action === 'destroy' ? !feedback : feedback?.hasAttribute('hidden'), `${action} callback revived old feedback`);
      check(canvas.style.cursor === 'help', `${action} callback retained the drawing cursor`);
      check(editor.getPreview() === undefined, `${action} callback retained the old preview`);
      if (action === 'replace') {
        await pointer('move', { x: screen.x + 20, y: screen.y });
        const preview = editor.getPreview();
        check(preview?.kind === 'line' && preview.vertices.length === 1, 'Replacement drawing did not resume preview');
        check(!container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'Replacement drawing did not resume feedback');
      }
      editor.destroy();
      check(canvas.style.cursor === 'help', 'Repeated cleanup changed the restored cursor');
      draw.destroy();
    }
  });
  await run('Ground drawing restores the snapped preview after changing draft style', async () => {
    const draw = createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 12 }, features: [point('style-snap-anchor', .025)], logger: () => {} });
    current = draw; await draw.ready;
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] })
      .some(feature => feature.properties._rl_feature_id === 'style-snap-anchor'), 'style snap anchor rendered');
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'style-preview', properties: {} }),
      submit: () => ({ accepted: true }) });
    editor.start('line');
    await pointer('click', draw.map.project([0, 0]));
    const anchor = draw.map.project([.025, 0]);
    await pointer('move', { x: anchor.x + 4, y: anchor.y });
    const before = editor.getPreview();
    check(before?.kind === 'line' && before.vertices.length === 2 && Math.abs((before.vertices[1]?.[0] ?? NaN) - .025) < 1e-10,
      'Initial line preview did not reach the snap anchor');
    editor.setStyle({ color: '#ff0000' });
    await pointer('move', { x: anchor.x + 5, y: anchor.y });
    const preview = editor.getPreview();
    check(preview?.kind === 'line' && preview.vertices.length === 2 && Math.abs((preview.vertices[1]?.[0] ?? NaN) - .025) < 1e-10 &&
      preview.vertices[1]?.[1] === 0, 'Style change left the snapped preview without its next vertex');
    check(editor.getState().draft?.placed === 1, 'Restoring the preview placed a draft vertex');
    await pointer('click', { x: anchor.x + 5, y: anchor.y });
    const committed = editor.getState().draft?.shape;
    check(JSON.stringify(committed) === JSON.stringify(preview), 'Next click disagreed with the restored snapped preview');
    editor.destroy(); draw.destroy();
  });
  await run('Ground drawing keeps a valid polar target without an unsafe footprint', async () => {
    const draw = createViewport({ container, basemap: style(), terrain: false, projection: 'globe',
      camera: { center: [0, 85], zoom: 1, pitch: 0 }, logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'polar-target', properties: {} }),
      submit: () => ({ accepted: true }) });
    editor.setSnapping(false);
    editor.start('line');
    await until(() => Math.abs(draw.map.unproject(draw.map.project([0, 89.5])).lat - 89.5) < .01,
      'globe projection reaches the polar fixture');
    const screen = draw.map.project([0, 89.5]);
    check(screen.x > 0 && screen.y > 0 && screen.x < container.clientWidth && screen.y < container.clientHeight,
      'Polar fixture is outside the viewport');
    await pointer('move', screen);
    const crosshair = container.querySelector<SVGPathElement>('.rl-ground-crosshair');
    if (!crosshair || crosshair.hasAttribute('hidden')) throw new Error('Valid polar target lost its crosshair');
    check(container.querySelector('.rl-ground-footprint')?.hasAttribute('hidden'), 'Unsafe polar footprint remained visible');
    const bounds = crosshair.getBBox();
    const shown = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await pointer('click', screen);
    const shape = editor.getState().draft?.shape;
    if (shape?.kind !== 'line' || shape.vertices.length !== 1) throw new Error('Valid polar click did not place one point');
    const vertex = shape.vertices[0]!;
    check(vertex[1] > 88 && vertex[1] <= 90, 'Polar click selected another ground region');
    const placed = draw.map.project(vertex);
    check(Math.hypot(placed.x - shown.x, placed.y - shown.y) < 2, 'Polar crosshair and placement disagree');
    editor.destroy(); draw.destroy();
  });
  await run('Ground drawing recovers beneath a stationary pointer and settles without idle work', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `ground-recovery-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    addProtocol(protocol, async () => {
      requested = true;
      await gate;
      return { data: data.slice(0) };
    });
    try {
      const draw = createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom', redFactor: 1,
          greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
      current = draw;
      try {
        await draw.ready;
        const editor = attachDrawing(draw, { createFeature: () => ({ id: 'stationary-target', properties: {} }),
          submit: () => ({ accepted: true }) });
        try {
          editor.start('line');
          await pointer('move', draw.map.project([0, 0]));
          await until(() => requested, 'delayed DEM request');
          check(editor.getPreview() === undefined, 'Unloaded DEM produced a draft preview');
          check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'Unloaded DEM did not show unavailable feedback');
          let idle = false, renders = 0, previews = 0;
          const onRender = () => { idle = false; renders++; };
          const onIdle = () => { idle = true; };
          draw.map.on('render', onRender);
          draw.map.on('idle', onIdle);
          const offPreview = editor.onPreview(() => { previews++; });
          try {
            release();
            await until(() => {
              const preview = editor.getPreview();
              return idle && preview?.kind === 'line' && preview.vertices.length === 1 &&
                draw.map.queryTerrainElevation([0, 0]) === 0 &&
                !!container.querySelector('.rl-ground-crosshair:not([hidden])');
            }, 'stationary target recovery and renderer idle');
            check(renders > 0 && previews > 0, 'Terrain recovery did not publish a fresh preview');
            check(editor.getState().draft?.placed === 0, 'Terrain recovery placed a draft point');
            const settledRenders = renders, settledPreviews = previews;
            // Observe the settled map without pointer input or scheduling renderer work.
            await new Promise<void>(resolve => setTimeout(resolve, 500));
            check(renders === settledRenders && previews === settledPreviews,
              `Idle target kept updating: ${renders - settledRenders} renders, ${previews - settledPreviews} previews`);
          } finally {
            offPreview();
            draw.map.off('render', onRender);
            draw.map.off('idle', onIdle);
          }
        } finally { editor.destroy(); }
      } finally { draw.destroy(); }
    } finally {
      release();
      removeProtocol(protocol);
    }
  });
  await run('Failed and replaced elevation retire a stationary target until new terrain loads', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const first = `ground-first-${crypto.randomUUID()}`;
    const failed = `ground-failed-${crypto.randomUUID()}`;
    const replacement = `ground-replacement-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    let failedRequest = false;
    addProtocol(first, async () => ({ data: data.slice(0) }));
    addProtocol(failed, async () => {
      failedRequest = true;
      throw new Error('Synthetic elevation failure');
    });
    addProtocol(replacement, async () => {
      requested = true;
      await gate;
      return { data: data.slice(0) };
    });
    const elevation = (protocol: string) => ({ tiles: [`${protocol}://dem/{z}/{x}/{y}.png`],
      encoding: 'custom' as const, redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 });
    try {
      const draw = createViewport({ container, basemap: style(), terrain: true, elevation: elevation(first),
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
      current = draw;
      const errors: RidgelineError[] = [];
      const offDiagnostic = draw.on('diagnostic', error => errors.push(error));
      try {
        await draw.ready;
        const editor = attachDrawing(draw, { createFeature: () => ({ id: 'replacement-line', properties: {} }),
          submit: () => ({ accepted: true }) });
        try {
          editor.start('line');
          const screen = draw.map.project([0, 0]);
          await pointer('move', screen);
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'initial terrain target');
          draw.configure({ elevation: elevation(failed) });
          check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Failed source replacement retained old target');
          await until(() => failedRequest && errors.some(error => error.code === 'ELEVATION_UNAVAILABLE' &&
            error.context.sourceId === 'rl:terrain'), 'failed DEM diagnostic');
          await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'failed terrain unavailable feedback');
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Failed terrain permitted placement');
          draw.configure({ elevation: elevation(replacement) });
          check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Old terrain target remained after replacement');
          await until(() => requested, 'replacement DEM request');
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Loading replacement terrain permitted placement');
          check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'Loading replacement terrain lacked unavailable feedback');
          release();
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'replacement terrain target');
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 1, 'Recovered terrain did not permit placement');
        } finally { editor.destroy(); }
      } finally { offDiagnostic(); draw.destroy(); }
    } finally {
      release();
      removeProtocol(first);
      removeProtocol(failed);
      removeProtocol(replacement);
    }
  });
  await run('Stationary placement follows camera, projection, resize, and style replacement', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 5 }, logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'scene-line', properties: {} }),
      submit: () => ({ accepted: true }) });
    const screen = { x: 320, y: 180 };
    const preview = () => {
      const shape = editor.getPreview();
      return shape?.kind === 'line' ? shape.vertices[0] : undefined;
    };
    const agrees = () => {
      const vertex = preview();
      if (!vertex) return false;
      const displayed = draw.map.project(vertex);
      return Math.hypot(displayed.x - screen.x, displayed.y - screen.y) < 2;
    };
    try {
      editor.start('line');
      await pointer('move', screen);
      await until(agrees, 'initial stationary placement');
      draw.setCamera({ center: [10, 5], zoom: 5, bearing: 25, pitch: 40 });
      await until(() => agrees() && Math.abs(preview()?.[0] ?? 0) > 5, 'camera refresh at stationary pointer');
      const moved = preview()!;
      draw.configure({ projection: 'globe' });
      await until(() => draw.map.getProjection()?.type === 'globe' && agrees(), 'globe stationary placement');
      check(Math.hypot(preview()![0] - moved[0], preview()![1] - moved[1]) < 5,
        'Projection transition selected a distant region');
      container.style.width = '700px';
      await until(() => draw.map.getCanvas().clientWidth === 700 && agrees() &&
        Math.abs(preview()![0] - moved[0]) > .01, 'resized stationary placement');
      draw.configure({ basemap: style('#e2e8e4') });
      check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Style replacement retained an old target');
      await until(() => draw.map.getLayer('rl:draft-line') !== undefined && agrees() &&
        !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'style replacement target recovery');
      await pointer('click', screen);
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line' || shape.vertices.length !== 1) throw new Error('Scene click did not place one vertex');
      const placed = draw.map.project(shape.vertices[0]!);
      check(Math.hypot(placed.x - screen.x, placed.y - screen.y) < 2, 'Scene click disagrees with target');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Style replacement keeps a ground edit and releases its handles on destruction', async () => {
    const feature: MapFeature = { type: 'Feature', id: 'scene-edit', properties: {},
      geometry: { type: 'LineString', coordinates: [[-.01, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [feature], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }),
      submit: () => ({ accepted: true }) });
    try {
      editor.edit('scene-edit');
      await until(() => !!container.querySelector('[aria-label="Vertex 1"]'), 'initial edit handle');
      draw.configure({ basemap: style('#dce9e2') });
      await until(() => draw.map.getLayer('rl:draft-line') !== undefined &&
        !!container.querySelector('[aria-label="Vertex 1"]'), 'edit handle after style replacement');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
      handle.focus();
      await browserKey('ArrowRight');
      const shape = editor.getState().draft?.shape;
      check(shape?.kind === 'line' && shape.vertices[0]![0] > -.01,
        'Edit handle did not use the replacement scene');
      check(draw.getFeature('scene-edit')?.geometry.type === 'LineString', 'Draft edit mutated accepted geometry');
      draw.destroy();
      check(!container.querySelector('.rl-ground-feedback,.rl-drawing-handle'), 'Viewport destruction retained edit feedback or handles');
      editor.destroy();
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Date-line ground placement follows displayed exaggeration on flat and globe', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(200,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `ground-dateline-${crypto.randomUUID()}`;
    addProtocol(protocol, async () => ({ data: data.slice(0) }));
    const known: [number, number] = [179.8, 0];
    try {
      const draw = createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom',
          redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
        camera: { center: known, zoom: 7, pitch: 50 }, logger: () => {} });
      current = draw; await draw.ready;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'dateline-line', properties: {} }),
        submit: () => ({ accepted: true }) });
      try {
        editor.start('line');
        editor.setSnapping(false);
        for (const projection of ['flat', 'globe'] as const) {
          let firstLatitude: number | undefined;
          for (const exaggeration of [1, 2]) {
            draw.configure({ projection, exaggeration });
            await until(() => draw.map.getProjection()?.type === (projection === 'flat' ? 'mercator' : 'globe') &&
              draw.map.loaded() && Math.abs((draw.map.queryTerrainElevation(known) ?? NaN) - 100 * exaggeration) < 1,
              `${projection} terrain at exaggeration ${exaggeration}`);
            const screen = { x: 320, y: 180 };
            await pointer('move', screen);
            await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'),
              `${projection} ground target at exaggeration ${exaggeration}`);
            const shape = editor.getPreview();
            if (shape?.kind !== 'line') throw new Error('Missing date-line preview');
            const placed = shape.vertices.at(-1)!;
            const longitudeDifference = ((placed[0] - known[0] + 540) % 360) - 180;
            check(Math.abs(longitudeDifference) < .001 && Math.abs(placed[1] - known[1]) < .1,
              `${projection} exaggeration ${exaggeration} changed stored geography: ${placed}`);
            if (firstLatitude === undefined) firstLatitude = placed[1];
            else check(Math.abs(placed[1] - firstLatitude) < .002,
              `${projection} uniform terrain shifted geographic placement under exaggeration: ${firstLatitude}, ${placed[1]}`);
          }
        }
        await pointer('click', { x: 320, y: 180 });
        check(editor.getState().draft?.placed === 1, 'Date-line scene did not place the current target');
      } finally { editor.destroy(); draw.destroy(); }
    } finally { removeProtocol(protocol); }
  });
  await run('Stationary target resumes after permission and submission changes', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    let permitted = true;
    let reject!: (value: { accepted: false; reason: string }) => void;
    const decision = new Promise<{ accepted: false; reason: string }>(resolve => { reject = resolve; });
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'permission-line', properties: {} }),
      canEdit: () => permitted, submit: () => decision });
    const marker = () => !!container.querySelector('.rl-ground-crosshair:not([hidden])');
    try {
      editor.start('line');
      const center = draw.map.project([0, 0]);
      await pointer('move', center);
      await until(marker, 'initial placement target');
      await pointer('click', center);
      await pointer('move', { x: center.x + 80, y: center.y });
      permitted = false;
      editor.refreshPermissions();
      check(!marker(), 'Permission loss retained actionable feedback');
      permitted = true;
      editor.refreshPermissions();
      await until(marker, 'target after permission restoration');
      await pointer('click', { x: center.x + 80, y: center.y });
      await pointer('move', { x: center.x + 150, y: center.y });
      await until(marker, 'target before submission');
      const pending = editor.finish();
      check(editor.getState().phase === 'pending' && !marker(), 'Pending submission retained actionable feedback');
      reject({ accepted: false, reason: 'Try again' });
      check(await pending === false, 'Rejected submission was accepted');
      await until(marker, 'target after rejection without pointer movement');
      check(editor.getState().draft?.placed === 2, 'Submission transition changed draft points');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Drawing cursor opt-out preserves a consumer grabbing cursor', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    const canvas = draw.map.getCanvas();
    canvas.style.cursor = 'grabbing';
    const editor = attachDrawing(draw, { visualFeedback: false,
      createFeature: () => ({ id: 'cursor-line', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      editor.start('line');
      const bounds = canvas.getBoundingClientRect();
      await window.browserDrag!(bounds.left + 300, bounds.top + 180, bounds.left + 350, bounds.top + 200);
      check(canvas.style.cursor === 'grabbing', 'Navigation restored a cursor drawing did not own');
      editor.destroy();
      check(canvas.style.cursor === 'grabbing', 'Destroy restored a cursor drawing did not own');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Snap callbacks cannot place a target from a replaced scene', async () => {
    const protocol = `snap-scene-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    addProtocol(protocol, async () => { await gate; throw new Error('Terrain held for scene replacement'); });
    const elevation = { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom' as const,
      redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 };
    try {
      const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
        features: [point('scene-snap')], logger: () => {} });
      current = draw; await draw.ready;
      let replace = false;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'scene-click', properties: {} }),
        canSnap: () => {
          if (replace) { replace = false; draw.configure({ terrain: true, elevation }); }
          return true;
        }, submit: () => ({ accepted: true }) });
      try {
        editor.start('line');
        const screen = draw.map.project([0, 0]);
        await until(() => draw.map.queryRenderedFeatures([[screen.x - 12, screen.y - 12],
          [screen.x + 12, screen.y + 12]], { layers: ['rl:points'] }).length > 0, 'snap candidate visible');
        await pointer('move', screen);
        await until(() => editor.getPreview()?.kind === 'line', 'initial ground preview');
        let stalePreview = false;
        const offPreview = editor.onPreview(() => {
          if (replace === false && draw.getConfiguration().terrain && editor.getPreview()) stalePreview = true;
        });
        try {
          replace = true;
          await pointer('move', { x: screen.x + 1, y: screen.y });
          check(!stalePreview && editor.getPreview() === undefined,
            'Scene replacement republished a ground preview from the old scene');
          draw.configure({ terrain: false });
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'flat target restored');
          replace = true;
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Snap callback placed a target from the replaced scene');
        } finally { offPreview(); }
      } finally { editor.destroy(); draw.destroy(); }
    } finally { release(); removeProtocol(protocol); }
  });
  await run('A valid terrain center keeps its target while footprint tiles load', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `partial-footprint-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let neighboringTileRequested = false;
    addProtocol(protocol, async params => {
      const zoom = Number(params.url.split('/').at(-3));
      const x = Number(params.url.split('/').at(-2));
      if (x >= 2 ** (zoom - 1)) { neighboringTileRequested = true; await gate; }
      return { data: data.slice(0) };
    });
    try {
      const center: [number, number] = [-0.001, 0];
      const draw = createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom',
          redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 12 },
        camera: { center, zoom: 12 }, logger: () => {} });
      current = draw; await draw.ready;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'partial-footprint', properties: {} }),
        submit: () => ({ accepted: true }) });
      try {
        editor.start('line');
        const screen = draw.map.project(center);
        await pointer('move', screen);
        await until(() => neighboringTileRequested &&
          !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'valid center beside pending terrain');
        check(!container.querySelector('.rl-ground-footprint:not([hidden])'),
          'Footprint crossed unavailable surrounding terrain');
        await pointer('click', screen);
        check(editor.getState().draft?.placed === 1, 'Missing footprint blocked a valid center');
      } finally { editor.destroy(); draw.destroy(); }
    } finally { release(); removeProtocol(protocol); }
  });
  await run('Destroying during terrain replacement releases active drawing work', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    for (const editing of [false, true]) {
      const protocol = `pending-destroy-${crypto.randomUUID()}`;
      let release = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      let requested = false, completed = false;
      addProtocol(protocol, async () => {
        requested = true;
        await gate;
        completed = true;
        return { data: data.slice(0) };
      });
      try {
        const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
          features: [point('edit-after-destroy')], logger: () => {} });
        current = draw; await draw.ready;
        const editor = attachDrawing(draw, { createFeature: () => ({ id: 'place-after-destroy', properties: {} }),
          submit: () => ({ accepted: true }) });
        let previews = 0;
        const offPreview = editor.onPreview(() => { previews++; });
        try {
          if (editing) editor.edit('edit-after-destroy');
          else { editor.start('line'); await pointer('move', draw.map.project([0, 0])); }
          draw.configure({ terrain: true, elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`],
            encoding: 'custom', redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 } });
          await until(() => requested, 'terrain request before active drawing destruction');
          draw.destroy();
          const afterDestroy = previews;
          check(!container.querySelector('canvas,.rl-ground-feedback,.rl-drawing-handle'),
            'Destroyed viewport retained drawing or map elements');
          release();
          await until(() => completed, 'pending terrain response');
          await new Promise<void>(resolve => setTimeout(resolve, 100));
          check(previews === afterDestroy && !container.querySelector('canvas,.rl-ground-feedback,.rl-drawing-handle'),
            'Pending terrain restored drawing output after destruction');
        } finally { offPreview(); editor.destroy(); draw.destroy(); }
      } finally { release(); removeProtocol(protocol); }
    }
  });
  await run('Ground drawing uses loaded ridge, zero, and negative DEM cells and rejects missing DEM', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    context.fillStyle = 'rgb(240,0,0)'; context.fillRect(0, 100, 256, 42);
    context.fillStyle = 'rgb(40,0,0)'; context.fillRect(0, 180, 256, 76);
    const latitude = (pixel: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * pixel / 256))) * 180 / Math.PI;
    const fixture = [
      { name: 'ridge', latitude: latitude(120), expected: 140 },
      { name: 'zero', latitude: latitude(60), expected: 0 },
      { name: 'negative', latitude: latitude(210), expected: -60 },
    ];
    const terrainErrors: string[] = [];
    const draw = createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
      camera: { center: [0.04, latitude(120)], zoom: 12, pitch: 55 }, onError: error => terrainErrors.push(error.message), logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'dem-drawing', properties: {} }), submit: () => ({ accepted: true }) });
    editor.start('line');
    for (const sample of fixture) {
      draw.setCamera({ center: [0, sample.name === 'ridge' ? latitude(110) : sample.latitude],
        zoom: sample.name === 'ridge' ? 3 : 12, pitch: 55 });
      const geographic: [number, number] = [0.04, sample.latitude];
      await until(() => Math.abs((draw.map.queryTerrainElevation(geographic) ?? NaN) - sample.expected) < 1,
        `${sample.name} DEM fixture loaded`).catch(() => { throw new Error(`${sample.name} elevation is ${draw.map.queryTerrainElevation(geographic)}; ${terrainErrors.join('; ')}`); });
      const screen = draw.map.project(geographic);
      check(screen.x >= 0 && screen.y >= 0 && screen.x < container.clientWidth && screen.y < container.clientHeight,
        `${sample.name} fixture is outside viewport`);
      await pointer('move', screen);
      const crosshair = container.querySelector<SVGPathElement>('.rl-ground-crosshair')!;
      check(!crosshair.hasAttribute('hidden'), `${sample.name} target is unavailable`);
      const bounds = crosshair.getBBox();
      const shown = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await pointer('click', screen);
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line') throw new Error('Line draft disappeared');
      const committed = shape.vertices.at(-1)!;
      const placed = draw.map.project(committed);
      check(Math.hypot(placed.x - shown.x, placed.y - shown.y) < 2, `${sample.name} preview and placement differ`);
      check(sample.name === 'ridge'
        ? committed[1] <= latitude(100) && committed[1] >= latitude(142)
        : Math.abs(committed[1] - sample.latitude) < 0.003,
      `${sample.name} chose a different ground region: ${committed[1]} versus ${sample.latitude}`);
      check(Math.abs((draw.map.queryTerrainElevation(committed) ?? NaN) - sample.expected) < 1,
        `${sample.name} was placed on another elevation region`);
    }
    draw.configure({ projection: 'globe' });
    draw.setCamera({ center: [0, latitude(120)], zoom: 3, pitch: 45 });
    const globeGeographic: [number, number] = [15, latitude(120)];
    await until(() => Math.abs((draw.map.queryTerrainElevation(globeGeographic) ?? NaN) - 140) < 1,
      'globe ridge DEM loaded');
    const globeTarget = draw.map.project(globeGeographic);
    check(globeTarget.x >= 0 && globeTarget.y >= 0 && globeTarget.x < container.clientWidth && globeTarget.y < container.clientHeight,
      `Globe ridge target outside viewport: ${globeTarget.x}, ${globeTarget.y}`);
    await pointer('move', globeTarget);
    check(!container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'Globe terrain target is unavailable');
    check(!container.querySelector('.rl-ground-footprint')?.hasAttribute('hidden'), 'Globe terrain footprint is unavailable');
    await pointer('click', globeTarget);
    const globeShape = editor.getState().draft?.shape;
    check(globeShape?.kind === 'line' && globeShape.vertices.length === 4, 'Globe terrain click did not place a point');
    editor.cancel();
    draw.configure({ projection: 'flat' });
    for (const sample of fixture.filter(sample => sample.expected !== 0)) {
      const anchor: [number, number] = [0, sample.latitude];
      const id = `${sample.name}-snap-anchor`;
      draw.upsert([{ type: 'Feature', id, geometry: { type: 'Point', coordinates: anchor }, properties: {} }]);
      draw.setCamera({ center: anchor, zoom: 12, pitch: 55 });
      await until(() => Math.abs((draw.map.queryTerrainElevation(anchor) ?? NaN) - sample.expected) < 1 &&
        draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(feature => feature.properties._rl_feature_id === id),
      `${sample.name} snap anchor rendered on loaded terrain`);
      editor.start('line');
      const projected = draw.map.project(anchor);
      const near = { x: projected.x + 6, y: projected.y };
      await pointer('move', near);
      const preview = editor.getPreview();
      check(preview?.kind === 'line' && JSON.stringify(preview.vertices[0]) === JSON.stringify(anchor),
        `${sample.name} elevated anchor did not snap in preview`);
      await pointer('click', near);
      const placed = editor.getState().draft?.shape;
      check(placed?.kind === 'line' && JSON.stringify(placed.vertices[0]) === JSON.stringify(anchor),
        `${sample.name} elevated anchor was not copied exactly`);
      editor.cancel();
    }
    editor.destroy(); draw.destroy();

    const missing = createViewport({ container, basemap: style(), terrain: false,
      elevation: { tiles: ['/missing-ground-target-dem.png'], encoding: 'custom', redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = missing; await missing.ready;
    const blocked = attachDrawing(missing, { createFeature: () => ({ id: 'missing-dem', properties: {} }), submit: () => ({ accepted: true }) });
    blocked.start('line');
    const center = missing.map.project([0, 0]);
    await pointer('move', center);
    const initialPreview = blocked.getPreview();
    check(initialPreview?.kind === 'line' && initialPreview.vertices.length === 1, 'Valid base surface had no preview');
    missing.configure({ terrain: true });
    await pointer('click', center);
    check(blocked.getState().draft?.placed === 0 && blocked.getPreview() === undefined,
      'An unavailable click retained the old ground preview');
    await pointer('move', center);
    check(container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'Missing DEM showed a valid target');
    blocked.destroy();
    const withoutVisuals = attachDrawing(missing, { visualFeedback: false,
      createFeature: () => ({ id: 'missing-dem-no-visual', properties: {} }), submit: () => ({ accepted: true }) });
    withoutVisuals.start('line');
    await pointer('click', center);
    check(withoutVisuals.getState().draft?.placed === 0, 'Visual opt-out accepted missing DEM');
    withoutVisuals.destroy(); missing.destroy();
  });
  await run('Ground drawing chooses a foreground ridge over terrain behind it', async () => {
    // An exaggerated synthetic ridge makes a foreground hit distinct from the flat terrain behind it.
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    context.fillStyle = 'rgb(240,0,0)'; context.fillRect(0, 112, 256, 16);
    const latitude = (pixel: number) => Math.atan(Math.sinh(Math.PI *
      (1 - 2 * (128 + pixel / 256) / 256))) * 180 / Math.PI;
    const behind: [number, number] = [0.04, latitude(90)];
    const ridge: [number, number] = [0.04, latitude(120)];
    const draw = createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0,
        blueFactor: 0, baseShift: 10000, minzoom: 8, maxzoom: 8 },
      camera: { center: [0.04, latitude(155)], zoom: 10, pitch: 75 },
      features: [{ type: 'Feature', id: 'occluded-snap', properties: { name: 'Behind ridge' },
        geometry: { type: 'Point', coordinates: behind } }], logger: () => {} });
    current = draw; await draw.ready;
    await until(() => Math.abs((draw.map.queryTerrainElevation(ridge) ?? NaN) - 14000) < 1 &&
      Math.abs(draw.map.queryTerrainElevation(behind) ?? NaN) < 1, 'foreground and rear DEM loaded');
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'ridge-depth', properties: {} }), submit: () => ({ accepted: true }) });
    editor.start('line');
    const rearScreen = draw.map.project(behind);
    check(rearScreen.x >= 0 && rearScreen.y >= 0 && rearScreen.x < container.clientWidth && rearScreen.y < container.clientHeight,
      `Rear terrain is outside viewport: ${rearScreen.x}, ${rearScreen.y}`);
    await pointer('move', rearScreen);
    const preview = editor.getPreview();
    check(preview?.kind === 'line' && preview.vertices[0]?.[1] !== behind[1],
      'Occluded vertex replaced the visible terrain target');
    const crosshair = container.querySelector<SVGPathElement>('.rl-ground-crosshair');
    if (!crosshair || crosshair.hasAttribute('hidden')) throw new Error('Foreground ridge target did not appear');
    const bounds = crosshair.getBBox();
    const shown = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await pointer('click', rearScreen);
    const shape = editor.getState().draft?.shape;
    if (shape?.kind !== 'line' || shape.vertices.length !== 1) throw new Error(`Foreground target did not place: ${JSON.stringify(shape)}`);
    const placed = shape.vertices[0]!;
    check(placed[1] <= latitude(112) + 0.001 && placed[1] >= latitude(128) - 0.001,
      `Behind-terrain fallback won over ridge: ${placed[1]} versus ridge ${latitude(112)} to ${latitude(128)}`);
    check((draw.map.queryTerrainElevation(placed) ?? 0) > 1000,
      `Foreground placement height ${draw.map.queryTerrainElevation(placed)} at ${placed[1]}`);
    const placedScreen = draw.map.project(placed);
    check(Math.hypot(placedScreen.x - shown.x, placedScreen.y - shown.y) < 2,
      'Foreground preview and placement differ');
    editor.destroy(); draw.destroy();
  });
  await run('Real pointer drawing previews stay ephemeral, snap, and place circle and rotated rectangle', async () => {
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[point('preview-anchor',-.025)],logger:()=>{}});
    current=draw;await draw.ready;
    let nextId=0;
    const editor=attachDrawing(draw,{createFeature:()=>({id:`pointer-${nextId++}`,properties:{}}),submit:()=>({accepted:true})});
    const visibleDraft=()=>draw.map.queryRenderedFeatures({layers:['rl:draft-fill']}).map(feature=>feature.geometry);
    const previewDistance=(target:{x:number;y:number})=>Math.min(...visibleDraft().flatMap(geometry=>
      geometry.type==='Polygon'?(geometry.coordinates[0]??[]).map(([lng,lat])=>{
        if(lng===undefined||lat===undefined)return Infinity;
        const edge=draw.map.project([lng,lat]);
        return Math.hypot(edge.x-target.x,edge.y-target.y);
      }):[]));
    const center=draw.map.project([0,0]);
    editor.start('circle');
    await pointer('click',center);
    const circleBefore=editor.getState(),circleDraft=JSON.stringify(circleBefore.draft),circleUndo=circleBefore.canUndo;
    const circleEdge={x:center.x+70,y:center.y};
    await pointer('move',circleEdge);
    await until(()=>previewDistance(circleEdge)<1.5,'visible circle preview reaches pointer');
    const circlePreview=editor.getMeasurements();
    check(circlePreview.length>0&&circlePreview.area!>0,'Circle preview did not follow the pointer');
    const circleDuring=editor.getState();
    check(JSON.stringify(circleDuring.draft)===circleDraft,'Circle preview mutated the draft');
    check(circleDuring.canUndo===circleUndo,'Circle preview added an undo entry');
    await pointer('click',circleEdge);
    const circleShape=editor.getState().draft!.shape;
    editor.undo();
    const circleUndone=editor.getState().draft;
    check(circleUndone?.placing===true&&circleUndone.placed===1,'Undo did not restore the first circle placement');
    check(circleUndone?.shape.kind==='circle'&&circleUndone.shape.radius===0,'Undo retained the second circle placement');
    editor.redo();
    check(await editor.finish(),'Circle change was not accepted');
    check(JSON.stringify(draw.getFeature('pointer-0')?.geometry)===JSON.stringify(shapeGeometry(circleShape)),'Accepted circle differs from placed geometry');

    editor.start('rectangle');
    await pointer('click',center);
    const rectangleCenter=editor.getState().draft!.shape;
    if(rectangleCenter.kind!=='rectangle')throw new Error('Rectangle draft was not created');
    editor.setShape({...rectangleCenter,width:0,height:0,bearing:45});
    const rectangleBefore=editor.getState(),rectangleDraft=JSON.stringify(rectangleBefore.draft),rectangleUndo=rectangleBefore.canUndo;
    const rectanglePoint={x:center.x+86,y:center.y-42};
    await pointer('move',rectanglePoint);
    await until(()=>previewDistance(rectanglePoint)<1.5,'visible rectangle preview reaches pointer');
    const rectanglePreview=editor.getMeasurements();
    check(rectanglePreview.length>0&&rectanglePreview.area!>0,'Rectangle preview did not follow the pointer');
    const rectangleDuring=editor.getState();
    check(JSON.stringify(rectangleDuring.draft)===rectangleDraft,'Rectangle preview mutated the draft');
    check(rectangleDuring.canUndo===rectangleUndo,'Rectangle preview added an undo entry');
    await pointer('click',rectanglePoint);
    const rectangleAfter=editor.getState().draft!;
    if(rectangleAfter.shape.kind!=='rectangle'||rectangleAfter.placing)throw new Error('Rectangle second placement did not finish placement');
    const rectangleShape=rectangleAfter.shape;
    const geometry=shapeGeometry(rectangleShape);
    if(geometry.type!=='Polygon')throw new Error('Rectangle geometry was not a polygon');
    const cornerDistance=Math.min(...geometry.coordinates[0]!.slice(0,-1).map(([lng,lat])=>{
      if(lng===undefined||lat===undefined)return Infinity;
      const corner=draw.map.project([lng,lat]);
      return Math.hypot(corner.x-rectanglePoint.x,corner.y-rectanglePoint.y);
    }));
    // Browser mouse events round CSS coordinates, so compare within one screen pixel.
    check(cornerDistance<1,`Committed rectangle missed the clicked corner by ${cornerDistance} pixels`);
    editor.undo();
    const rectangleUndone=editor.getState().draft;
    check(JSON.stringify(rectangleUndone)===rectangleDraft,'Undo did not restore the first rotated rectangle placement');
    editor.redo();
    check(await editor.finish(),'Rectangle change was not accepted');
    check(JSON.stringify(draw.getFeature('pointer-1')?.geometry)===JSON.stringify(geometry),'Accepted rectangle differs from placed geometry');
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).some(feature=>feature.properties._rl_feature_id==='preview-anchor'),'preview snap anchor rendered');
    editor.start('line');
    const anchor=draw.map.project([-.025,0]);
    await pointer('move',{x:anchor.x+4,y:anchor.y});
    const snappedPreview=editor.getPreview();
    const snappedVertex=snappedPreview?.kind==='line' ? snappedPreview.vertices[0] : undefined;
    const snappedPoint=snappedVertex && draw.map.project(snappedVertex);
    check(snappedPoint&&Math.hypot(snappedPoint.x-anchor.x,snappedPoint.y-anchor.y)<1,'Real pointer preview did not snap to the visible feature');
    const snappedFootprint=container.querySelector<SVGPathElement>('.rl-ground-footprint');
    if(!snappedFootprint||snappedFootprint.hasAttribute('hidden'))throw new Error('Snapped target lost its ground footprint');
    const ring=snappedFootprint.getBBox();
    check(Math.hypot(ring.x+ring.width/2-anchor.x,ring.y+ring.height/2-anchor.y)<2,'Ground footprint did not follow the snapped target');
    editor.cancel();
    editor.destroy();draw.destroy();
  });
  await run('Accepted shape definitions survive consumer storage and viewport recreation', async () => {
    const first = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = first; await first.ready;
    let next = 0;
    const editor = attachDrawing(first, {
      createFeature: () => ({ id: `stored-${next++}`, properties: { name: 'Stored drawing' } }),
      submit: () => ({ accepted: true }),
    });
    editor.start('circle'); editor.addPoint([0, 0]); editor.addPoint([.005, 0]);
    check(await editor.finish(), 'Circle acceptance failed');
    editor.start('rectangle'); editor.addPoint([0, 0]);
    const rectangle = editor.getState().draft?.shape;
    if (rectangle?.kind !== 'rectangle') throw new Error('Rectangle shape missing');
    editor.setShape({ ...rectangle, width: 600, height: 350, bearing: 35 });
    check(await editor.finish(), 'Rectangle acceptance failed');
    editor.start('arrow'); editor.addPoint([0, 0]); editor.addPoint([.005, .005]);
    check(await editor.finish(), 'Arrow acceptance failed');
    const before = ['stored-0', 'stored-1', 'stored-2'].map(id => first.getFeature(id));
    check(before.every(feature => feature?.drawing), 'Accepted feature lost its shape definition');
    const originalShapes = before.map(feature => feature?.drawing?.shape);
    const stored = JSON.stringify(before);
    editor.destroy(); first.destroy();

    const restored = JSON.parse(stored) as MapFeature[];
    const second = createViewport({ container, basemap: style('#f4f4f4'), camera: { center: [0, 0], zoom: 12 }, features: restored, logger: () => {} });
    current = second; await second.ready;
    const reloaded = attachDrawing(second, {
      createFeature: () => ({ id: 'unused', properties: {} }),
      submit: () => ({ accepted: true }),
    });
    reloaded.edit('stored-0');
    const circle = reloaded.getState().draft?.shape;
    if (circle?.kind !== 'circle' || Math.abs(circle.radius - 556) > 1) throw new Error('Circle radius was not restored');
    check(JSON.stringify(circle) === JSON.stringify(originalShapes[0]), 'Circle definition changed during storage');
    reloaded.setShape({ ...circle, radius: circle.radius + 100 });
    check(await reloaded.finish(), 'Reloaded circle could not be edited');
    const editedCircle = second.getFeature('stored-0')?.drawing?.shape;
    check(editedCircle?.kind === 'circle' && Math.abs(editedCircle.radius - circle.radius - 100) < .001, 'Circle lost shape-specific editing');
    reloaded.edit('stored-1');
    const restoredRectangle = reloaded.getState().draft?.shape;
    if (restoredRectangle?.kind !== 'rectangle' || restoredRectangle.bearing !== 35 || restoredRectangle.width !== 600) throw new Error('Rectangle dimensions were not restored');
    reloaded.setShape({ ...restoredRectangle, width: 700 });
    check(await reloaded.finish(), 'Reloaded rectangle could not be edited');
    const editedRectangle = second.getFeature('stored-1')?.drawing?.shape;
    check(editedRectangle?.kind === 'rectangle' && editedRectangle.width === 700, 'Rectangle width edit was not saved');
    reloaded.edit('stored-2');
    const arrow = reloaded.getState().draft?.shape;
    if (arrow?.kind !== 'arrow' || JSON.stringify(arrow.vertices) !== JSON.stringify([[0, 0], [.005, .005]])) throw new Error('Arrow direction was not restored');
    check(JSON.stringify(arrow) === JSON.stringify(originalShapes[2]), 'Arrow definition changed during storage');
    reloaded.setShape({ ...arrow, vertices: [[0, 0], [.01, .005]] });
    check(await reloaded.finish(), 'Reloaded arrow could not be edited');
    const editedArrow = second.getFeature('stored-2')?.drawing?.shape;
    check(editedArrow?.kind === 'arrow' && editedArrow.vertices[1]?.[0] === .01, 'Arrow lost shape-specific editing');
    reloaded.destroy(); second.destroy();
  });
  await run('Rejected drawing remains editable and cancellation preserves accepted data', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    let accept = false;
    const editor = attachDrawing(draw, {
      createFeature: () => ({ id: 'rejected', properties: { name: 'Rejected draft' } }),
      submit: () => accept ? { accepted: true } : { accepted: false, reason: 'Try another location' },
    });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    container.after(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    await browserClick('[data-field="action:Circle"]');
    await pointer('click', draw.map.project([0, 0]));
    await pointer('click', draw.map.project([.005, 0]));
    await browserClick('[data-field="action:Finish"]');
    await until(() => editor.getState().phase === 'rejected', 'rejection feedback');
    check(!draw.getFeature('rejected') && editor.getState().draft?.shape.kind === 'circle', 'Rejection lost draft or saved it');
    const rejectedShape = editor.getState().draft?.shape;
    if (rejectedShape?.kind !== 'circle') throw new Error('Rejected circle shape missing');
    const radiusInput = inspector.querySelector<HTMLInputElement>('[data-field="Radius (m)"]');
    if (!radiusInput || radiusInput.disabled) throw new Error('Rejected circle lost its editable radius field');
    await browserClick('[data-field="Radius (m)"]');
    await browserKey('ControlOrMeta+A');
    for (const digit of '700') await browserKey(digit);
    await browserKey('Tab');
    const revisedShape = editor.getState().draft?.shape;
    if (revisedShape?.kind !== 'circle' || revisedShape.radius !== 700) throw new Error('Editing the rejected draft did not change its radius');
    accept = true;
    await browserClick('[data-field="action:Finish"]');
    await until(() => Boolean(draw.getFeature('rejected')), 'accepted retry');
    const acceptedShape = draw.getFeature('rejected')?.drawing?.shape;
    check(acceptedShape?.kind === 'circle' && Math.abs(acceptedShape.radius - revisedShape.radius) < .001, 'Accepted retry lost the draft edit');
    const accepted = JSON.stringify(draw.getFeature('rejected'));
    editor.edit('rejected');
    const shape = editor.getState().draft?.shape;
    if (shape?.kind !== 'circle') throw new Error('Accepted circle could not be edited');
    editor.setShape({ ...shape, radius: shape.radius + 200 });
    await browserClick('[data-field="action:Cancel"]');
    check(JSON.stringify(draw.getFeature('rejected')) === accepted, 'Cancel changed accepted feature');
    controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
  });
  await run('Vertex dragging moves the draft and restores unchanged snap targets', async () => {
    const line:MapFeature={type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[.01,0]]}};
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:13},features:[line,point('anchor',0)],logger:()=>{}});
    current=draw;await draw.ready;
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).length>0,'snap anchor rendered');
    const editor=attachDrawing(draw,{createFeature:()=>({id:'new',properties:{}}),submit:()=>({accepted:true})});editor.edit('line');
    await until(()=>draw.map.loaded(),'handle map ready');
    const handle=container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
    const rect=handle.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await browserDrag(x,y,x+7,y);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const shape=editor.getState().draft?.shape,end=handle.getBoundingClientRect();
    check(shape?.kind==='line'&&shape.vertices[0]?.[0]===0&&shape.vertices[0]?.[1]===0,'Dragged vertex did not snap back to its anchor');
    check(Math.abs(end.x+end.width/2-x)<0.5&&Math.abs(end.y+end.height/2-y)<0.5,'Handle stayed displaced from its unchanged snap target');
    if (!window.browserMouse || !window.browserKeyDown || !window.browserKeyUp) throw new Error('Playwright held-key bridge required');
    await window.browserMouse('down', x, y);
    try {
      await window.browserMouse('move', x + 7, y);
      await window.browserKeyDown('Alt');
      await until(() => {
        const draft = editor.getState().draft?.shape;
        return draft?.kind === 'line' && Math.abs(draft.vertices[0]?.[0] ?? 0) > 1e-5;
      }, 'Alt bypass during stationary handle drag');
      check(!!container.querySelector('.rl-ground-snap-ring[hidden]'), 'Alt drag retained a snap indicator');
      await window.browserKeyUp('Alt');
      await until(() => {
        const draft = editor.getState().draft?.shape;
        return draft?.kind === 'line' && draft.vertices[0]?.[0] === 0 && draft.vertices[0]?.[1] === 0;
      }, 'stationary drag re-snaps after Alt release');
    } finally {
      await window.browserKeyUp('Alt');
      await window.browserMouse('up', x + 7, y);
    }
    await browserDrag(x,y,x+30,y+35);
    const moved=editor.getState().draft?.shape,movedRect=handle.getBoundingClientRect();
    check(moved?.kind==='line'&&Math.abs(moved.vertices[0]![0])>.0001&&Math.abs(moved.vertices[0]![1])>.0001,'Dragging did not move the vertex in the draft');
    check(Math.abs(movedRect.x+movedRect.width/2-x-30)<1&&Math.abs(movedRect.y+movedRect.height/2-y-35)<1,'Handle did not follow the moved vertex');
    editor.destroy();draw.destroy();
  });
  await run('Whole-shape dragging follows the pointer without snapping to its own vertices', async () => {
    const shape={kind:'polygon' as const,vertices:[[-.0026,-.0026],[.0026,-.0026],[.0026,.0026],[-.0026,.0026]] as [number,number][]};
    const feature:MapFeature={type:'Feature',id:'moving',geometry:shapeGeometry(shape),properties:{}};
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[feature],logger:()=>{}});
    current=draw;await draw.ready;
    const editor=attachDrawing(draw,{createFeature:()=>({id:'new',properties:{}}),submit:()=>({accepted:true})});
    editor.edit('moving');
    await until(()=>draw.map.loaded(),'drag map ready');
    const handle=container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]')!;
    const rect=handle.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const origin=draw.map.project([0,0]);
    await browserDrag(x,y,x+30,y+30);
    const draft=editor.getState().draft?.shape;
    if(draft?.kind!=='polygon')throw new Error('Missing polygon draft');
    const center=draw.map.project([draft.vertices.reduce((sum,p)=>sum+p[0],0)/draft.vertices.length,draft.vertices.reduce((sum,p)=>sum+p[1],0)/draft.vertices.length]);
    check(Math.abs(center.x-origin.x-30)<0.5&&Math.abs(center.y-origin.y-30)<0.5,'Whole drawing jumped to its own moving vertex');
    editor.destroy();draw.destroy();
  });
  await run('Drawing attachment cleans up when its preparation diagnostic destroys the viewport', async () => {
    const diagnostics: RidgelineError[] = [];
    const draw = createViewport({ container, basemap: style(), logger: () => {}, onError: error => {
      diagnostics.push(error);
      if (error.code === 'CALLBACK_FAILED') draw.destroy();
    } });
    current = draw; await draw.ready;
    const addSource = draw.map.addSource.bind(draw.map);
    draw.map.addSource = (id, source) => {
      if (id === 'rl:draft') throw new Error('Draft source preparation failed');
      return addSource(id, source);
    };
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'never-started', properties: {} }), submit: () => ({ accepted: true }) });
    check(diagnostics.some(error => error.code === 'CALLBACK_FAILED'), 'Preparation failure was not diagnosed');
    check(!container.querySelector('canvas,.rl-drawing-handle'), 'Destroyed viewport retained drawing DOM');
    let disposed = false;
    try { editor.start('line'); } catch (error) { disposed = error instanceof Error && error.message.includes('destroyed'); }
    check(disposed, 'Attachment survived synchronous viewport destruction');
    editor.destroy(); draw.destroy();
  });
  await run('Forwarding viewport wrappers share drawing ownership and allow reattachment', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    const options = { createFeature: () => ({ id: 'wrapped', properties: {} }), submit: () => ({ accepted: true as const }) };
    const wrapper: Viewport = { ...draw };
    const editor = attachDrawing(wrapper, options);
    try {
      let rejected = false;
      try { attachDrawing({ ...draw }, options); } catch (error) {
        rejected = error instanceof Error && error.message.includes('already attached');
      }
      check(rejected, 'A second wrapper bypassed drawing attachment ownership');
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      check(draw.getInteractionOwner() !== null, 'Wrapped editor did not acquire interaction ownership');
      editor.cancel(); editor.destroy();
      check(draw.getInteractionOwner() === null, 'Destroyed wrapped editor retained interaction ownership');
      check(!draw.map.getSource('rl:draft'), 'Destroyed wrapped editor retained its source');
      const replacement = attachDrawing(draw, options);
      try {
        replacement.start('circle'); replacement.addPoint([0, 0]); replacement.addPoint([.005, 0]);
        check(await replacement.finish(), 'Reattached editor failed to submit');
        check(draw.getFeature('wrapped')?.drawing?.shape.kind === 'circle', 'Reattached editor did not publish');
      } finally { replacement.destroy(); }
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Centered drawing handles keep independent keyboard and drag behavior', async () => {
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:13},logger:()=>{}});
    current=draw;await draw.ready;
    const editor=attachDrawing(draw,{createFeature:()=>({id:'centered',properties:{}}),submit:()=>({accepted:true})});
    editor.start('rectangle');editor.addPoint([0,0]);editor.addPoint([.004,.004]);
    const rectangle=editor.getState().draft!.shape;
    if(rectangle.kind!=='rectangle')throw new Error('Missing rectangle draft');
    editor.setShape({...rectangle,width:600,height:350,bearing:35});
    const before=editor.getState().draft!.shape;
    if(before.kind!=='rectangle')throw new Error('Missing rotated rectangle');
    const width=container.querySelector<HTMLButtonElement>('[aria-label="Width"]')!;
    if (!window.browserKey || !window.browserMouse) throw new Error('Playwright input bridge required');
    width.focus();await window.browserKey('ArrowRight');
    const after=editor.getState().draft!.shape;
    check(after.kind==='rectangle'&&after.width!==before.width&&after.height===before.height&&after.bearing===before.bearing&&JSON.stringify(after.center)===JSON.stringify(before.center),'Width keyboard step changed another rectangle parameter');
    editor.undo();
    check(JSON.stringify(editor.getState().draft!.shape)===JSON.stringify(before),'One undo did not restore the rectangle width');
    editor.cancel();

    const origin=draw.map.project([0,0]),edge=draw.map.unproject([origin.x+80,origin.y]);
    editor.start('circle');editor.addPoint([0,0]);editor.addPoint([edge.lng,edge.lat]);
    await until(()=>draw.map.loaded(),'circle handle map ready');
    const centerHandle = container.querySelector<HTMLButtonElement>('[aria-label="Center"]')!;
    const box = centerHandle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    await window.browserMouse('down', x, y);
    for (let step = 1; step <= 9; step++) await window.browserMouse('move', x + step * 8, y);
    await window.browserMouse('up', x + 72, y);
    const circle=editor.getState().draft!.shape;
    if(circle.kind!=='circle')throw new Error('Missing circle draft');
    check(Math.abs(draw.map.project(circle.center).x-origin.x-72)<1,'Circle Center snapped to its own Radius handle');
    editor.destroy();draw.destroy();
  });
  await run('Arrowheads follow accepted geometry updates and disappear on deletion', async () => {
    const arrowShape = { kind:'arrow' as const, vertices:[[-.01,0],[.01,0]] as [number,number][] };
    const arrow:MapFeature = { type:'Feature', id:'arrow', geometry:shapeGeometry(arrowShape), properties:{}, drawing:{version:1,shape:arrowShape,style:{color:'#ff0000',fillColor:'#ff0000',lineWidth:3,fillOpacity:0,dashed:false,label:''}} };
    const draw=createViewport({container,basemap:style(),features:[arrow],camera:{center:[0,0],zoom:12},logger:()=>{}});current=draw;await draw.ready;
    const heads=()=>draw.map.queryRenderedFeatures({layers:['rl:arrowheads']});
    await until(()=>heads().some(f=>f.properties._rl_feature_id==='arrow'),'initial arrowhead rendered');
    arrow.drawing!.shape={kind:'arrow',vertices:[[0,-.01],[0,.01]]};arrow.geometry=shapeGeometry(arrow.drawing!.shape);draw.upsert([arrow]);
    await until(()=>heads().some(f=>Math.abs(Number(f.properties.bearing))<1),'arrowhead follows direction');
    draw.remove(['arrow']);await until(()=>heads().length===0,'arrowhead removed');draw.destroy();
  });
  await run('Arrow editing, basemap replacement, failure, cancellation and retry keep shaft and head coherent', async () => {
    const oldShape = { kind: 'arrow' as const, vertices: [[-.01, 0], [.01, 0]] as [number, number][] };
    const newShape = { kind: 'arrow' as const, vertices: [[-.01, .02], [.01, .02]] as [number, number][] };
    const arrow: MapFeature = { type: 'Feature', id: 'coherent-arrow', properties: {}, geometry: shapeGeometry(oldShape),
      drawing: { version: 1, shape: oldShape, style: { color: '#ff0000', fillColor: '#ff0000', lineWidth: 3,
        fillOpacity: 0, dashed: false, label: '' } } };
    const errors: RidgelineError[] = [];
    let fail = false;
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, .01], zoom: 12 },
      features: [arrow, point('arrow-neighbor', -.04)], style: feature => {
        if (feature.id === arrow.id && fail) throw new Error('Arrow styling failed');
        return { color: '#008855' };
      }, logger: () => {}, onError: error => errors.push(error) });
    current = draw; await draw.ready;
    const visible = (layer: string, lng: number, lat: number) => draw.map.queryRenderedFeatures(draw.map.project([lng, lat]), { layers: [layer] })
      .some(hit => hit.properties._rl_feature_id === arrow.id);
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'new', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      await until(() => visible('rl:line', 0, 0) && visible('rl:arrowheads', .01, 0), 'original arrow shaft and head');
      editor.edit(arrow.id);
      editor.setShape({ kind: 'arrow', vertices: [[-.01, .01], [.01, .01]] });
      draw.configure({ basemap: style('#dddddd') });
      await until(() => Boolean(draw.map.getLayer('rl:draft-arrow')) && Boolean(draw.map.getLayer('rl:arrowheads')), 'arrow layers restored');
      await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:draft-arrow'] }).some(hit =>
        hit.geometry.type === 'Point' && Math.abs(hit.geometry.coordinates[1]! - .01) < .0001), 'draft arrowhead restored');
      await until(() => !visible('rl:arrowheads', .01, 0), 'accepted head hidden');
      await untilPixel(draw, [0, 0], false, 'accepted shaft hidden');
      await untilPixel(draw, [0, .01], true, 'draft shaft restored');
      fail = true;
      draw.upsert([
        { ...arrow, geometry: shapeGeometry(newShape), drawing: { ...arrow.drawing!, shape: newShape }, properties: { fail: true } },
        point('arrow-neighbor', .04),
      ]);
      await until(() => errors.some(error => error.context.featureId === arrow.id) &&
        draw.map.queryRenderedFeatures(draw.map.project([.04, 0]), { layers: ['rl:points'] })
          .some(hit => hit.properties._rl_feature_id === 'arrow-neighbor'), 'healthy feature advanced after arrow failure');
      check(Boolean(editor.getState().draft), 'External failed update discarded the draft');
      editor.cancel();
      await until(() => visible('rl:line', 0, 0) && visible('rl:arrowheads', .01, 0), 'cancel restores published shaft and head');
      await untilPixel(draw, [0, 0], true, 'cancel restores published shaft');
      await untilPixel(draw, [0, .01], false, 'cancel removes draft shaft');
      check(visible('rl:line', 0, 0) && visible('rl:arrowheads', .01, 0), 'Failed arrow lost its previous complete shape');
      check(!visible('rl:line', 0, .02) && !visible('rl:arrowheads', .01, .02), 'Failed arrow published a split new shape');
      fail = false;
      draw.retryUpdates();
      await until(() => visible('rl:line', 0, .02) && visible('rl:arrowheads', .01, .02), 'corrected arrow published');
      await untilPixel(draw, [0, .02], true, 'retry publishes new shaft');
      await untilPixel(draw, [0, 0], false, 'retry removes historical shaft');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Terrain visibility colors the approach green and the hill shadow red', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 150 * Math.exp(-(((lat * meters - 300) / 40) ** 2));
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: hill }, camera: { center: [0, 480 / meters], zoom: 15, pitch: 0 },
      entityVisibility: { footprints: true, zones: false, groundLines: false }, logger: () => {} });
    current = air; await air.ready;
    air.upsert([{ ...point('hill-shadow'), entity: { altitude: { meters: 100, reference: 'sea-level' },
      attachments: [{ id: 'camera', type: 'camera', color: '#00ff00', terrainVisibility: true, blockedColor: '#ff0000', fillOpacity: .6, blockedOpacity: .6, bearing: 0, elevation: -15, fovX: 60, fovY: 40, range: 2000 }] } }]);
    await until(() => air.getEntityState('hill-shadow')?.coverage === 'ready', 'hill coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[]>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2')!, greens: number[] = [];
        for (const north of [210, 750]) {
          const p = air.map.project([0, north / meters]), pixel = new Uint8Array(4), scale = canvas.width / canvas.clientWidth;
          gl.readPixels(Math.round(p.x * scale), canvas.height - 1 - Math.round(p.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          greens.push(north === 210 ? pixel[1]! : pixel[0]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels[0]! > 50, `Visible approach lost coverage: ${pixels}`);
    check(pixels[1]! > 50, `Blocked far slope was not red: ${pixels}`);
    const maskLayer=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'));
    check(!!maskLayer,'Missing GPU coverage layer');
    const mask=air.map.getSource<ImageSource>(maskLayer!.id)!.image;
    check(mask instanceof ImageData,'Expected completed GPU mask pixels');
    if(mask instanceof ImageData) {
      let mixed=0;
      for(let i=0;i<mask.data.length;i+=4) if(mask.data[i+3]!>0 && mask.data[i]!>0 && mask.data[i+1]!>0) mixed++;
      check(mixed<mask.width*mask.height*.03,`Contour transition is too broad: ${mixed} mixed pixels`);
    }
    check(air.map.getPaintProperty(maskLayer!.id,'raster-resampling')==='linear','Measured contours use square-pixel magnification');

    air.destroy();
  });
  await run('Camera volume covers rising terrain inside its true FOV', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 100 * Math.exp(-(((lat * meters - 120) / 60) ** 2));
    const air = createViewport({container, basemap: style('#000000'), elevationSampler: {sample: hill},
      camera: {center: [0,80/meters], zoom:18, pitch:0}, logger:()=>{}});
    current=air; await air.ready;
    air.upsert([{...point('near-hill'),entity:{altitude:{meters:100,reference:'sea-level'},attachments:[{
      id:'camera',type:'camera',terrainVisibility:true,color:'#00ff00',fillOpacity:.6,blockedColor:'#ff0000',blockedOpacity:.6,
      bearing:0,elevation:-15,fovX:60,fovY:40,range:1000,
    }]}}]);
    await until(()=>air.getEntityState('near-hill')?.coverage==='ready','near hillside coverage');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const pixel=await new Promise<Uint8Array>(resolve=>{
      air.map.once('render',()=>{
        const canvas=air.map.getCanvas(),gl=canvas.getContext('webgl2')!,p=air.map.project([0,80/meters]);
        const scale=canvas.width/canvas.clientWidth,value=new Uint8Array(4);
        gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,value);
        resolve(value);
      });air.map.triggerRepaint();
    });
    check(pixel[1]!>100&&pixel[0]!<25,`Finite camera volume excluded visible hillside: ${pixel}`);
    air.destroy();
  });
  await run('Raster tile arrivals recover camera coverage despite unrelated missing terrain', async () => {
    const dem=document.createElement('canvas');dem.width=dem.height=256;
    const context=dem.getContext('2d')!;context.fillStyle='#000000';context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:0,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:12},logger:()=>{}});
    current=air;await air.ready;
    air.upsert([{...point('outside'),geometry:{type:'Point',coordinates:[0,86]},entity:{}}]);
    await until(()=>air.getEntityState('outside')?.coverage==='unavailable','out-of-range terrain');
    air.remove(['outside']);
    const location:MapFeature={...point('warm'),geometry:{type:'Point',coordinates:[.07,.044]},entity:{}};
    air.upsert([location]);await until(()=>air.getEntityState('warm')?.ground===0,'camera center tile');
    air.upsert([{...location,id:'border-camera',entity:{altitude:{meters:100,reference:'ground'},attachments:[{
      id:'camera',type:'camera',terrainVisibility:true,bearing:0,elevation:-45,fovX:60,fovY:40,range:2000,
    }]}}]);
    await until(()=>air.getEntityState('border-camera')?.coverage==='ready','neighboring terrain patch recovers without retry');
    air.destroy();
  });
  await run('A displayed camera failure removes only its coverage and retry uses current inputs', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    air.upsert([{ ...point('ground-survivor'), entity: { attachments: [{ id: 'zone', type: 'circle', radius: 50 }] } }]);
    await until(() => air.getEntityState('ground-survivor')?.coverage === 'ready', 'unrelated ground coverage');
    const failingCamera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: .1, wireframe: true };
    const feature: MapFeature = { ...point('failing-camera'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [failingCamera] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial camera coverage');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    let fail = false;
    gl.clientWaitSync = (sync, flags, timeout) => fail ? gl.WAIT_FAILED : clientWaitSync(sync, flags, timeout);
    const cameraMask = () => air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
    let pickedAttachment = '';
    air.on('click', event => { pickedAttachment = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickCoverage = async () => {
      const point = air.map.project([.0006, .0004]);
      pickedAttachment = '';
      await pointer('click', point);
      return pickedAttachment;
    };
    try {
      const initialMask = cameraMask();
      check(Boolean(initialMask), 'Initial camera mask missing');
      check(await pickCoverage() === 'camera', 'Initial camera coverage was not pickable');
      air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...failingCamera, bearing: 15 }] } }]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'loading', 'camera replacement pending');
      fail = true;
      await until(() => errors.some(error => error.code === 'UPDATE_FAILED'), 'displayed camera failure diagnostic');
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'failed camera coverage');
      check(!cameraMask(), 'Failed camera mask remained visible');
      check(await pickCoverage() === '', 'Failed camera coverage remained pickable');
      check(air.getEntityState('ground-survivor')?.coverage === 'ready', 'Camera failure removed unrelated ground coverage');
      fail = false;
      air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...failingCamera, bearing: 30, color: '#0000ff' }] } }]);
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'current camera retry');
      const mask = cameraMask();
      const source = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      check(source instanceof ImageData && source.data.some((value, index) => index % 4 === 2 && value > 100), 'Retry restored stale camera appearance instead of current inputs');
      check(air.getEntityState('ground-survivor')?.coverage === 'ready', 'Current camera retry disturbed unrelated ground coverage');
      check(await pickCoverage() === 'camera', 'Current camera coverage was not pickable after retry');
    } finally {
      gl.clientWaitSync = clientWaitSync;
      air.destroy();
    }
  });
  await run('Failed GPU target allocation releases its resources and retries', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    air.upsert([{...point('plain-zone'),entity:{attachments:[{id:'zone',type:'circle',radius:50}]}}]);
    await until(()=>air.getEntityState('plain-zone')?.coverage==='ready','plain zone ready');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const createFramebuffer = gl.createFramebuffer.bind(gl), deleteFramebuffer = gl.deleteFramebuffer.bind(gl);
    const createTexture = gl.createTexture.bind(gl), deleteTexture = gl.deleteTexture.bind(gl);
    const checkFramebufferStatus = gl.checkFramebufferStatus.bind(gl);
    const frames = new Set<WebGLFramebuffer>(), textures = new Set<WebGLTexture>();
    gl.createFramebuffer = () => { const value = createFramebuffer(); if (value) frames.add(value); return value; };
    gl.createTexture = () => { const value = createTexture(); if (value) textures.add(value); return value; };
    gl.deleteFramebuffer = value => { if (value) frames.delete(value); deleteFramebuffer(value); };
    gl.deleteTexture = value => { if (value) textures.delete(value); deleteTexture(value); };
    gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    try {
      air.upsert([{ ...point('gpu-failure'), entity: { altitude: { meters: 100, reference: 'ground' },
        attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
      await until(() => air.getEntityState('gpu-failure')?.coverage === 'unavailable', 'GPU allocation failure');
      check(air.getEntityState('plain-zone')?.coverage==='ready','GPU failure changed unrelated ground coverage');
      check(errors.some(error => error.code === 'UPDATE_FAILED'), 'GPU failure did not report a diagnostic');
      check(frames.size === 0 && textures.size === 0, `Failed GPU allocation leaked ${frames.size} framebuffers and ${textures.size} textures`);
      gl.checkFramebufferStatus = checkFramebufferStatus;
      air.retryUpdates();
      await until(() => air.getEntityState('gpu-failure')?.coverage === 'ready', 'GPU allocation recovery');
    } finally {
      gl.checkFramebufferStatus = checkFramebufferStatus;
      air.destroy();
      gl.createFramebuffer = createFramebuffer; gl.deleteFramebuffer = deleteFramebuffer;
      gl.createTexture = createTexture; gl.deleteTexture = deleteTexture;
    }
  });
  await run('A null GPU synchronization result reports failure and recovers on retry', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const fenceSync = gl.fenceSync.bind(gl);
    let failOnce = true;
    gl.fenceSync = (condition, flags) => {
      if (failOnce) { failOnce = false; return null; }
      return fenceSync(condition, flags);
    };
    const feature: MapFeature = { ...point('null-fence'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45,
        fovX: 60, fovY: 40, range: 300 }] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'null GPU sync failure');
      check(errors.some(error => error.code === 'UPDATE_FAILED'), 'Null GPU sync did not report a diagnostic');
      check(!air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:')), 'Failed sync published camera coverage');
      gl.fenceSync = fenceSync;
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU sync retry');
      check(air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:')), 'Retry did not publish camera coverage');
    } finally { gl.fenceSync = fenceSync; air.destroy(); }
  });
  await run('Coverage readiness follows every camera, pose changes, and ground placement', async () => {
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 }, logger: () => {} });
    current = air; await air.ready;
    air.upsert([{...point('ground'),entity:{attachments:[{id:'zone',type:'circle',radius:50}]}}]);
    await until(()=>air.getEntityState('ground')?.coverage==='ready','ground geometry ready');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    const texImage2D = gl.texImage2D;
    const source=air.map.getSource<GeoJSONSource>('rl:entity-ground')!,setData=source.setData.bind(source);
    let sensorTargets=0,groundUploads=0;
    gl.texImage2D=new Proxy(texImage2D,{apply(target,context:WebGL2RenderingContext,args:unknown[]){
      if(args[3]===2048&&args[4]===2048)sensorTargets++;
      return Reflect.apply(target,context,args);
    }});
    source.setData=(...args)=>{groundUploads++;return setData(...args);};
    let first: WebGLSync | undefined;
    let releaseSecond = false;
    let heldWaits = 0;
    let completionBudget: number | undefined;
    gl.clientWaitSync = (sync, flags, timeout) => {
      first ??= sync;
      if (sync !== first && (!releaseSecond || completionBudget === 0)) {
        heldWaits++;
        return gl.TIMEOUT_EXPIRED;
      }
      const status = clientWaitSync(sync, flags, timeout);
      if (sync !== first && status !== gl.TIMEOUT_EXPIRED && completionBudget !== undefined) completionBudget--;
      return status;
    };
    const camera: CameraAttachment = { id: 'first', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: .1, wireframe: true };
    const published = () => air.map.getStyle().layers.filter(layer => layer.id.startsWith('rl:camera-mask:'))
      .filter(layer => air.map.getSource<ImageSource>(layer.id)?.image instanceof ImageData).length;
    const feature: MapFeature = { ...point('two-cameras'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [camera, { ...camera, id: 'second', bearing: 90 }] } };
    const masks = () => air.map.getStyle().layers
      .filter(layer => layer.id.startsWith('rl:camera-mask:'))
      .map(layer => air.map.getSource<ImageSource>(layer.id)?.image)
      .filter((image): image is ImageData => image instanceof ImageData);
    const maskSignature = () => masks().map(image => {
      let sum = 0;
      for (let index = 0; index < image.data.length; index += 4) sum = (sum + image.data[index]! * 3 + image.data[index + 1]! * 5 + image.data[index + 2]! * 7 + image.data[index + 3]!) % 0x1_0000_0000;
      return sum;
    });
    let pickedAttachments: string[] = [];
    air.on('click', event => { pickedAttachments = event.attachments.filter(hit => hit.entityId === feature.id).map(hit => hit.attachmentId); });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      pickedAttachments = [];
      await pointer('click', point);
      return pickedAttachments;
    };
    try {
      air.upsert([feature]);
      await until(() => published() === 1, 'first camera publishes while second is pending');
      check(air.getEntityState('two-cameras')?.coverage === 'loading', 'Entity became ready before its second camera published');
      check((await pickAt(0, .0008)).includes('first'), 'First camera result was not pickable');
      check(!(await pickAt(.0008, 0)).includes('second'), 'Second camera result published before its fence completed');
      releaseSecond = true;
      await until(() => air.getEntityState('two-cameras')?.coverage === 'ready', 'both camera masks published');
      check(published() === 2, 'Ready entity is missing camera coverage');
      check(sensorTargets===2,`Two cameras allocated ${sensorTargets} sensor targets instead of sharing one pair`);
      check(groundUploads===1,`GPU publication resubmitted unchanged ground geometry ${groundUploads} times`);
      releaseSecond = false;
      const oldSignature = maskSignature();
      check(oldSignature.length === 2, 'Initial camera images missing');
      heldWaits = 0;
      let before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [.0001,0] } }]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'camera replacement before equivalent configuration');
      await until(() => heldWaits > 0, 'camera replacement fence held');
      air.configure({ projection: 'flat', terrain: false, exaggeration: 1 });
      check(air.getEntityState(feature.id)?.coverage === 'loading', 'Equivalent configuration lost the pending camera state');
      check(JSON.stringify(maskSignature()) === JSON.stringify(oldSignature), 'Equivalent configuration dropped completed camera coverage');
      releaseSecond = true;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'equivalent configuration republishes camera coverage');
      releaseSecond = false;
      const movedSignature = maskSignature();
      before = air.getEntityState(feature.id)!.computedAt;
      for (const lng of [.0002, .0003]) {
        air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [lng,0] } }]);
        await until(() => air.getEntityState(feature.id)!.computedAt > before, 'moved camera submitted');
        before = air.getEntityState(feature.id)!.computedAt;
        check(air.getEntityState(feature.id)?.coverage === 'loading', 'Old camera pose was reported ready for new input');
        check(JSON.stringify(maskSignature()) === JSON.stringify(movedSignature), 'Previous camera result disappeared while replacement was pending');
      }
      completionBudget = 1;
      releaseSecond = true;
      await until(() => {
        const current = maskSignature();
        return current.length === 2 && current[0] !== movedSignature[0];
      }, 'intermediate camera result published');
      check(air.getEntityState(feature.id)?.coverage === 'loading', 'Intermediate camera result marked the newest request ready');
      completionBudget = undefined;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'moved camera masks published');
      check((await pickAt(.0003, .0008)).includes('first'), 'Final camera result was not pickable at the current position');
      before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([{ ...feature, entity: { ...feature.entity!, altitude: { meters: 0, reference: 'ground' } } }]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'ground-level camera computed');
      check(air.getEntityState(feature.id)?.coverage === 'ready', 'Known ground-level camera stayed loading');
      check(!air.map.getLayer('rl:camera-gpu'), 'Ground-level camera retained GPU geometry');
    } finally { gl.clientWaitSync = clientWaitSync; gl.texImage2D=texImage2D;source.setData=setData;air.destroy(); }
  });
  await run('Rejected camera frames do not replace the displayed picking mask', async () => {
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('rejected-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    let first: WebGLSync | undefined;
    let release = false;
    let completions = 0;
    let heldWaits = 0;
    gl.clientWaitSync = (sync, flags, timeout) => {
      first ??= sync;
      if (sync !== first && (!release || completions === 0)) {
        heldWaits++;
        return gl.TIMEOUT_EXPIRED;
      }
      const status = clientWaitSync(sync, flags, timeout);
      if (sync !== first && status !== gl.TIMEOUT_EXPIRED && completions > 0) completions--;
      return status;
    };
    let picked = '';
    air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', point);
      return picked;
    };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial camera coverage');
      check(await pickAt(0, .0008) === camera.id, 'Initial camera coverage was not pickable');
      release = false;
      const moved = { ...feature, geometry: { type: 'Point' as const, coordinates: [.003, 0] as [number, number] },
        entity: { ...feature.entity!, attachments: [{ ...camera, bearing: 180 }] } };
      let before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([moved]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'moved camera submission');
      await until(() => heldWaits > 0, 'moved camera fence held');
      const changed = { ...moved, entity: { ...moved.entity!, attachments: [{ ...camera, color: '#0000ff', bearing: 180, volumeOpacity: 0, wireframe: false }] } };
      before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([changed]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'appearance replacement');
      const previousHolds = heldWaits;
      release = true;
      completions = 1;
      await until(() => heldWaits > previousHolds, 'replacement frame held after rejected result');
      check(await pickAt(0, .0008) === camera.id, 'Rejected readback replaced the displayed picking mask');
      check(await pickAt(0, -.0008) === '', 'Rejected readback created a south-side picking hit');
      gl.clientWaitSync = clientWaitSync;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'replacement camera coverage');
    } finally {
      gl.clientWaitSync = clientWaitSync;
      air.destroy();
    }
  });
  await run('Retained camera masks survive a style rebuild during terrain retry', async () => {
    let available = true;
    let finish: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: {
      sample: () => available ? 0 : null,
      prepare: async () => new Promise<void>(resolve => { finish = resolve; }),
    }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('retained-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial retained camera');
    let picked = '';
    const off = air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', point);
      return picked;
    };
    try {
      check(await pickAt(0, .0008) === camera.id, 'Initial retained camera was not pickable');
      available = false;
      air.retryUpdates();
      await until(() => Boolean(finish) && air.getEntityState(feature.id)?.coverage === 'loading', 'pending retained retry');
      air.configure({ basemap: style('#ffffff') });
      await until(() => Boolean(air.map.getLayer('rl:camera-gpu')), 'camera layer after style rebuild');
      check(await pickAt(0, .0008) === camera.id, 'Style rebuild dropped retained camera picking');
      available = true;
      finish!(); finish = undefined;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'retained camera retry');
    } finally {
      finish?.();
      off();
      air.destroy();
    }
  });
  await run('GPU visibility preserves flat-ground coverage at long range and caches terrain during movement', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    let samples = 0;
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: () => { samples++; return 0; }, prepare: async () => {} },
      camera: { center: [0, 4000 / meters], zoom: 16, pitch: 0 }, logger: () => {} });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('gpu-flat'), entity: { altitude: { meters: 2000, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, color: '#00ff00', blockedColor: '#ff0000',
        fillOpacity: .6, blockedOpacity: .6, wireframe:true, volumeOpacity:.1, bearing: 0, elevation: -10, fovX: 60, fovY: 40, range: 6001 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU flat coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[][]>(resolve => {
      air.map.once('render', () => {
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, values:number[][]=[];
        for (const east of [-200,200]) {
          const p=air.map.project([east/meters,4000/meters]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          values.push([...pixel]);
        }
        resolve(values);
      }); air.map.triggerRepaint();
    });
    check(pixels.every(p => p[1]! > 100 && p[0]! < 25), 'Flat terrain falsely blocked: '+JSON.stringify(pixels));
    // Count actual sensor-depth submissions while changing appearance on a stationary camera.
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const drawElements = gl.drawElements;
    let sensorPasses = 0;
    gl.drawElements = function(...args: Parameters<WebGL2RenderingContext['drawElements']>) {
      const viewport = this.getParameter(this.VIEWPORT) as Int32Array;
      if (viewport[2] === 2048 && this.getParameter(this.FRAMEBUFFER_BINDING)) sensorPasses++;
      return drawElements.apply(this, args);
    };
    try {
      const camera = feature.entity!.attachments![0] as CameraAttachment;
      const maskId = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'))!.id;
      for (const opacity of [.2, .8, .4]) {
        air.upsert([{...feature, entity: {...feature.entity!, attachments: [{...camera, color: '#0000ff', fillOpacity: opacity}]}}]);
        await until(() => {
          const image = air.map.getSource<ImageSource>(maskId)?.image;
          return image instanceof ImageData && image.data.some((value, i) => i % 4 === 2 && value === 255 && Math.abs(image.data[i+1]! - opacity*255) < 2);
        }, 'cached visibility restyled');
      }
      check(sensorPasses === 0, `Appearance edits reran ${sensorPasses} sensor depth passes`);
      air.upsert([feature]);
      await until(() => {
        const image = air.map.getSource<ImageSource>(maskId)?.image;
        return image instanceof ImageData && image.data.some((value, i) => i % 4 === 1 && value === 255);
      }, 'original appearance restored');
      check(sensorPasses === 0, 'Restoring appearance reran visibility');
      air.upsert([{...feature, entity: {...feature.entity!, attachments: [{...camera, bearing: 15}]}}]);
      await until(() => sensorPasses > 0, 'changed camera aim recomputed depth');
    } finally { gl.drawElements = drawElements; }
    const assertSynchronized=()=>{
      const gpu=air.map.getLayer('rl:camera-gpu') as unknown as {implementation:{cameras:Map<string,{published?:{origin:number[]}}>}};
      const geometry=air.map.getLayer('rl:entities') as unknown as {implementation:{draws:{attachmentId?:string;vertices:number[][]}[]}};
      const published=gpu.implementation.cameras.values().next().value?.published;
      const corner=geometry.implementation.draws.find(draw=>draw.attachmentId==='camera')?.vertices[0];
      check(!!published&&!!corner,'Published camera geometry missing');
      check(JSON.stringify(published!.origin)===JSON.stringify(corner),'Wireframe and mask use different poses');
    };
    const initialSamples=samples;
    for(let i=0;i<24;i++) {
      air.upsert([{...feature,geometry:{type:'Point',coordinates:[i*.000001,0]}}]);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      assertSynchronized();
    }
    assertSynchronized();
    check(samples-initialSamples<=30,'Movement rebuilt terrain: '+(samples-initialSamples)+' samples');
    air.remove([feature.id]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    check(!air.map.getStyle().layers.some(layer=>layer.id.startsWith('rl:camera-mask:')), 'Removed GPU mask remains');
    check(!air.map.getLayer('rl:camera-gpu'), 'Last camera removal retained GPU resources');
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU camera recreated after removal');
    await new Promise<void>(resolve => {
      air.map.once('style.load', () => resolve());
      air.configure({ basemap: style('#101010') });
    });
    await until(() => {
      const mask = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
      const image = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      return image instanceof ImageData && image.data.some((value, i) => i % 4 === 3 && value > 0);
    }, 'GPU mask republished after style replacement');
    air.configure({ entityVisibility: { footprints: false, zones: false, groundLines: false } });
    await until(() => !air.map.getLayer('rl:camera-gpu'), 'Hidden cameras release GPU resources');
    air.configure({ entityVisibility: { footprints: true, zones: false, groundLines: false } });
    await until(() => Boolean(air.map.getLayer('rl:camera-gpu')) && air.getEntityState(feature.id)?.coverage === 'ready', 'Visible camera restores GPU resources');
    air.destroy();
  });
  await run('GPU grid stays clear across a sloped plane during movement', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    let samples = 0;
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: (_lng, lat) => { samples++; return lat * meters * .4; } },
      camera: { center: [0, 4000 / meters], zoom: 16, pitch: 0 }, logger: () => {} });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('gpu-flat'), entity: { altitude: { meters: 2000, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, color: '#00ff00', blockedColor: '#ff0000',
        fillOpacity: .6, blockedOpacity: .6, bearing: 0, elevation: -10, fovX: 60, fovY: 40, range: 6001 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU flat coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[][]>(resolve => {
      air.map.once('render', () => {
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, values:number[][]=[];
        for (const east of [-200,200]) {
          const p=air.map.project([east/meters,4000/meters]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          values.push([...pixel]);
        }
        resolve(values);
      }); air.map.triggerRepaint();
    });
    check(pixels.every(p => p[1]! > 100 && p[0]! < 25), 'Flat terrain falsely blocked: '+JSON.stringify(pixels));
    const maskId=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'))!.id;
    const assertClear=()=> {
      const image=air.map.getSource<ImageSource>(maskId)!.image;
      check(image instanceof ImageData,'GPU mask missing');
      if(image instanceof ImageData){
        let red=0,filled=0;
        for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]!>0){filled++;if(image.data[i]!>25)red++;}
        check(filled>100,'Slope mask unexpectedly empty');
        check(red===0,`Unobstructed slope has ${red}/${filled} false blocked pixels`);
      }
    };
    assertClear();
    const initialSamples=samples;
    for(let i=0;i<24;i++) {
      air.upsert([{...feature,geometry:{type:'Point',coordinates:[i*.000001,0]}}]);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      assertClear();
    }
    check(samples-initialSamples<=30,'Movement rebuilt terrain: '+(samples-initialSamples)+' samples');
    air.remove([feature.id]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    check(!air.map.getStyle().layers.some(layer=>layer.id.startsWith('rl:camera-mask:')), 'Removed GPU mask remains');
    air.destroy();
  });
  await run('GPU voting and depth-refined contours respond to subpixel boundaries', async () => { checkGpuVote(); });
  if (registeredCases.length !== browserCases.length || registeredCases.some((name, index) => name !== browserCases[index])) {
    throw new Error('Browser case manifest differs from registered checks.');
  }
  if (!selectedCase) {
    status.dataset.state = 'ready';
    status.textContent = 'Consumer fixture ready. Run cases with pnpm test:browser.';
    return;
  }
  if (!ran) throw new Error(`Unknown browser case: ${selectedCase}`);
  status.dataset.state = 'passed';
  status.textContent = `${selectedCase} passed through the installed package.`;
}
window.cleanupBrowserCase = () => current?.destroy();
void suite().catch(error => { status.dataset.state = 'failed'; status.textContent = `Failed: ${error instanceof Error ? error.stack : String(error)}`; });
