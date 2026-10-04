import { chromium } from '/tmp/ridgeline-model-projection/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
const root = '/tmp/ridgeline-model-projection/';
const dist = root + 'node_modules/maplibre-gl/dist/';
const packed = root + '.artifacts/consumer/node_modules/@ridgeline/map/dist/ridgeline.js';
const html = `<!doctype html><html><head><link rel="stylesheet" href="/maplibre-gl.css"><style>html,body{margin:0}#map{position:relative;width:640px;height:360px}</style><script type="importmap">{"imports":{"maplibre-gl":"/maplibre-gl.mjs"}}</script></head><body><div id="map"></div></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    const file = { '/maplibre-gl.mjs': dist + 'maplibre-gl.mjs', '/maplibre-gl-shared.mjs': dist + 'maplibre-gl-shared.mjs', '/worker.mjs': dist + 'maplibre-gl-worker.mjs', '/maplibre-gl.css': dist + 'maplibre-gl.css', '/ridgeline.js': packed, '/terrain.png': root + 'tests/fixtures/flat-terrain.png' }[req.url];
    if (!file) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', req.url.endsWith('.png') ? 'image/png' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(file));
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = { date: new Date().toISOString(), browser: browser.version(), maplibre: JSON.parse(await readFile(root + 'node_modules/maplibre-gl/package.json')).version, packedSha256: createHash('sha256').update(await readFile(packed)).digest('hex'), launchArgs: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], scenarios: [], pageErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => result.pageErrors.push(error.message));
  for (const scenario of [
    { name: 'flat-below', projection: 'flat', zoom: 16, delta: .0008, order: 'below' },
    { name: 'flat-above', projection: 'flat', zoom: 16, delta: .0008, order: 'above' },
    { name: 'globe-below', projection: 'globe', zoom: 5, delta: 1.6, order: 'below' },
    { name: 'blend-above', projection: 'globe', zoom: 11.5, delta: .018, order: 'above' },
    { name: 'flat-terrain-below', projection: 'flat', zoom: 14, delta: .0032, order: 'below', terrain: true },
    { name: 'globe-terrain-above', projection: 'globe', zoom: 5, delta: 1.6, order: 'above', terrain: true },
  ]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const data = await page.evaluate(async scenario => {
      const { createViewport } = await import('/ridgeline.js');
      const { setWorkerUrl } = await import('/maplibre-gl.mjs');
      setWorkerUrl('/worker.mjs');
      const errors = [];
      const viewport = createViewport({ container: document.querySelector('#map'), projection: scenario.projection, terrain: scenario.terrain ?? false, hillshade: false,
        elevation: { tiles: [location.origin + '/terrain.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 0 },
        basemap: { version: 8, transition: { duration: 1000, delay: 0 }, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }] },
        camera: { center: [0, 0], zoom: scenario.zoom, pitch: 25, bearing: 17 },
        style: feature => feature.id === 'circle' ? { color: '#ff0000', radius: 13, label: '' } : { color: '#fff', radius: 0, icon: 'blue-square', label: '' },
        logger: error => errors.push({ code: error.code, message: error.message }),
      });
      await viewport.ready;
      const map = viewport.map;
      map.on('error', e => errors.push({ mapError: e.error.message }));
      const icon = new ImageData(28, 28);
      for (let i = 0; i < icon.data.length; i += 4) { icon.data[i + 2] = 255; icon.data[i + 3] = 255; }
      viewport.registerIcon('blue-square', { image: icon, pixelRatio: 1 });
      viewport.upsert(['circle', 'icon'].map((id, index) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [scenario.delta * (index ? 1 : -1), 0] }, properties: {} })));
      const gl = map.painter.context.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const metadata = { renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), glVersion: gl.getParameter(gl.VERSION) };
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      function capture() {
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let red = 0, blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 200 && pixels[i + 1] < 50 && pixels[i + 2] < 50) red++;
          if (pixels[i] < 50 && pixels[i + 1] < 50 && pixels[i + 2] > 200) blue++;
        }
        return { red, blue };
      }
      const frames = [];
      let frame = 0, pending, activeCommand = null, blend, prerenders = 0, renders = 0, prepareCalls = 0, explicitPrepareCalls = 0;
      let last = { circle: false, icon: false };
      let burstQueue = [];
      const tileManager = map.style.tileManagers['rl:features'];
      if (!tileManager) throw Error('No existing feature source manager');
      const originalPrepare = tileManager.prepare;
      tileManager.prepare = function (context) { prepareCalls++; return originalPrepare.call(this, context); };
      const layer = { id: 'same-frame-probe', type: 'custom', renderingMode: '3d',
        prerender(_gl, input) {
          prerenders++;
          blend = input.defaultProjectionData.projectionTransition;
          if (!pending) pending = burstQueue.shift();
          if (!pending) return;
          const command = pending; pending = undefined; activeCommand = command;
          command.prerenderOrdinal = prerenders;
          command.prepareCallsBefore = prepareCalls;
          command.changes = [];
          for (const id of ['circle', 'icon']) {
            if (last[id] === command.hidden[id]) continue;
            map.setFeatureState({ source: 'rl:features', id: 'rl:' + id }, { editing: command.hidden[id] });
            last[id] = command.hidden[id]; command.changes.push(id);
          }
          if (command.mode === 'prepare' && command.changes.length) {
            if (map.style.tileManagers['rl:features'] !== tileManager) throw Error('Source changed');
            tileManager.prepare(map.painter.context); explicitPrepareCalls++;
          }
          command.prepareCallsAfter = prepareCalls;
          command.stateAfter = ['circle', 'icon'].map(id => map.getFeatureState({ source: 'rl:features', id: 'rl:' + id }));
        },
        render() { renders++; },
      };
      map.addLayer(layer, scenario.order === 'below' ? 'rl:points' : undefined);
      map.on('render', () => { frames.push({ frame: ++frame, command: activeCommand?.id ?? null, prerenders, renders, prepareCalls, explicitPrepareCalls, blend, ...capture() }); });
      function idle() { return new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('idle timeout')), 20000); map.once('idle', () => { clearTimeout(timeout); resolve(); }); map.triggerRepaint(); }); }
      await idle();
      if (frames.at(-1).red < 100 || frames.at(-1).blue < 100) throw Error('Initial features missing: ' + JSON.stringify(frames.at(-1)));
      const initial = frames.at(-1);
      const commands = [];
      for (const mode of ['ordinary', 'prepare']) {
        for (const hidden of [{ circle: true, icon: true }, { circle: false, icon: false }, { circle: true, icon: false }, { circle: false, icon: true }, { circle: true, icon: true }, { circle: false, icon: false }, { circle: false, icon: false }]) {
          const command = { id: commands.length, mode, hidden, before: frames.at(-1) };
          const start = frames.length;
          pending = command;
          await idle();
          command.frames = frames.slice(start);
          command.firstFrameMatches = command.frames[0].red > 100 === !hidden.circle && command.frames[0].blue > 100 === !hidden.icon;
          command.settledMatches = command.frames.at(-1).red > 100 === !hidden.circle && command.frames.at(-1).blue > 100 === !hidden.icon;
          commands.push(command);
        }
      }
      const bursts = [];
      for (const mode of ['ordinary', 'prepare']) {
        const start = frames.length;
        const burst = Array.from({ length: 10 }, (_, index) => ({ id: 'burst-' + mode + '-' + index, mode, hidden: { circle: index % 2 === 0, icon: index % 2 === 0 } }));
        burstQueue = [...burst];
        await idle();
        for (const command of burst) {
          command.frames = frames.slice(start).filter(f => f.command === command.id);
          command.firstFrameMatches = command.frames[0].red > 100 === !command.hidden.circle && command.frames[0].blue > 100 === !command.hidden.icon;
        }
        bursts.push({ mode, commands: burst });
      }
      const quietStart = { frames: frame, prerenders, renders, prepareCalls, explicitPrepareCalls };
      await new Promise(resolve => setTimeout(resolve, 5000));
      const quietDelta = { frames: frame - quietStart.frames, prerenders: prerenders - quietStart.prerenders, renders: renders - quietStart.renders, prepareCalls: prepareCalls - quietStart.prepareCalls, explicitPrepareCalls: explicitPrepareCalls - quietStart.explicitPrepareCalls };
      const answer = { scenario, metadata, size: [gl.drawingBufferWidth, gl.drawingBufferHeight], initial, commands, bursts, quietDelta, errors, glError: gl.getError(), layerOrder: map.getStyle().layers.map(l => l.id) };
      tileManager.prepare = originalPrepare;
      viewport.destroy();
      return answer;
    }, scenario);
    result.scenarios.push(data);
    console.log(JSON.stringify({ name: scenario.name, ordinary: data.commands.filter(c => c.mode === 'ordinary').map(c => ({ changes: c.changes.length, first: c.firstFrameMatches, settled: c.settledMatches, frames: c.frames.length })), prepare: data.commands.filter(c => c.mode === 'prepare').map(c => ({ changes: c.changes.length, first: c.firstFrameMatches, settled: c.settledMatches, frames: c.frames.length })), bursts: data.bursts.map(b => ({ mode: b.mode, firstFrameMatches: b.commands.map(c => c.firstFrameMatches) })), quiet: data.quietDelta, errors: data.errors, glError: data.glError }));
    await writeFile('/tmp/ridgeline-model-context/same-frame-probe.json', JSON.stringify(result, null, 2));
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
