import { createViewport, attachDrawing, shapeGeometry, RidgelineError } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import { addProtocol, removeProtocol } from 'maplibre-gl';
import type { CustomLayerInterface } from 'maplibre-gl';
import { style, point, check, pointer, browserKey, browserClick, browserDrag } from './helpers';
import type { BrowserCaseModule, BrowserCaseRun } from './context';

function dateLineDrawing(projection: "flat" | "globe", terrain: false | true, blockingQuery = false): BrowserCaseRun {
  return async caseContext => {
    const { container, own, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(128,100,0)'; context.fillRect(0, 0, 256, 256);
    const image = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `reliable-world-${crypto.randomUUID()}`;
    addProtocol(protocol, async () => ({ data: image.slice(0) }));
    const anchor: [number, number] = [-179.65, 0];
    const elevation = { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'terrarium' as const, maxzoom: 0 };
    try {
        const options = { container, basemap: style(), terrain, elevation, projection,
          camera: { center: [179.8, 0] as [number, number], zoom: 7, pitch: projection === 'globe' ? 50 : 0 }, logger: () => {} };
        let draw = own(createViewport({ ...options, features: [point('world-anchor', anchor[0])] }));
        const addLayer = draw.map.addLayer;
        let modelLayer: CustomLayerInterface | undefined;
        if (blockingQuery) draw.map.addLayer = function (layer, beforeId) {
          if (layer.id === 'rl:models' && layer.type === 'custom') modelLayer = layer;
          return addLayer.call(this, layer, beforeId);
        };
        try { await draw.ready; }
        finally { draw.map.addLayer = addLayer; }
        if (terrain) await until(() => draw.map.loaded() && Math.abs((draw.map.queryTerrainElevation(anchor) ?? NaN) - 100) < 1,
          `${projection} date-line elevation loaded`);
        let editor = attachDrawing(draw, { createFeature: () => ({ id: 'world-line', properties: {} }),
          submit: () => ({ accepted: true }) });
        try {
          editor.start('line'); editor.setSnapping(false);
          await pointer('click', draw.map.project([179.4, 0]));
          const canonicalGlobeTerrain = projection === 'globe' && terrain;
          if (canonicalGlobeTerrain) {
            // The pinned globe renderer loads DEM samplers on its canonical
            // side. Navigate across the seam before placing on western terrain.
            const canvas = draw.map.getCanvas().getBoundingClientRect();
            await browserDrag(canvas.x + 340, canvas.y + 250, canvas.x + 250, canvas.y + 250);
            draw.setCamera({ center: [-179.8, 0] });
            let liveUpdates = 0;
            let observedEmptyFrame = false, heldQuery = false;
            const prerender = modelLayer?.prerender;
            if (blockingQuery) {
              if (!modelLayer || !prerender) throw new Error('The model custom layer must be installed');
              check(draw.getFeatures().every(feature => !feature.entity?.model), 'The drawing fixture must have no model references');
              modelLayer.prerender = function (gl, input) {
                if (liveUpdates === 0) return prerender.call(this, gl, input);
                observedEmptyFrame = true;
                const getError = gl.getError;
                gl.getError = function () {
                  const error = getError.call(this);
                  if (!heldQuery) {
                    heldQuery = true;
                    // A synchronous network hold models a blocking native query without spinning the CPU.
                    const request = new XMLHttpRequest();
                    request.open('GET', '/empty-model-query-hold', false); request.send();
                    check(request.status === 200, 'The controlled query hold must complete');
                  }
                  return error;
                };
                try { return prerender.call(this, gl, input); }
                finally { gl.getError = getError; }
              };
            }
            const started = performance.now();
            const live = setInterval(() => {
              const next = liveUpdates + 1;
              draw.upsert([point('western-readiness-live', 170 + (next % 100) * .0001)]);
              liveUpdates = next;
            }, 16);
            try {
              // Global loaded() includes unrelated feature publication. Require
              // the DEM and camera used by this target while live data continues.
              await until(() => (!blockingQuery || observedEmptyFrame) && liveUpdates >= 2 && !draw.map.isMoving() && draw.map.isSourceLoaded('rl:terrain') === true &&
                Math.abs((draw.map.queryTerrainElevation(anchor) ?? NaN) - 100) < 1, 'western globe terrain loaded');
              if (blockingQuery) {
                check(performance.now() - started <= 8000, 'Western terrain readiness exceeded eight seconds');
                check(observedEmptyFrame, 'Model prerender must run after a live upsert returns with no registered models');
              }
            } catch (cause) {
              throw new Error(`Western terrain readiness: ${JSON.stringify({ liveUpdates, loaded: draw.map.loaded(),
                terrainLoaded: draw.map.isSourceLoaded('rl:terrain'), elevation: draw.map.queryTerrainElevation(anchor),
                moving: draw.map.isMoving() })}`, { cause });
            } finally {
              clearInterval(live);
              if (modelLayer && prerender) modelLayer.prerender = prerender;
            }
          }
          const across = draw.map.project(canonicalGlobeTerrain ? [-179.6, 0] : [180.4, 0]);
          await pointer('move', across);
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), `${projection}/${terrain} date-line ground`);
          const preview = editor.getPreview();
          if (preview?.kind !== 'line') throw new Error('Date-line preview missing');
          const next = preview.vertices.at(-1)!;
          check(Math.abs(next[0]) <= 180 && Math.abs(next[1]) <= 90, `Date-line target is unbounded: ${next}`);
          await pointer('click', across);
          check(await editor.finish(), `${projection}/${terrain} date-line Finish failed`);
          const saved = draw.getFeature('world-line');
          if (!saved?.drawing || saved.geometry.type !== 'LineString') throw new Error('Saved date-line line missing');
          check(saved.geometry.coordinates.every(p => Math.abs(p[0]!) <= 180) &&
            saved.geometry.coordinates[0]![0]! > 0 && saved.geometry.coordinates[1]![0]! < 0, 'Crossing geometry was not bounded');
          const restored: MapFeature = JSON.parse(JSON.stringify(saved));
          editor.destroy(); draw.destroy();
          draw = own(createViewport({ ...options, camera: { ...options.camera,
            center: canonicalGlobeTerrain ? [-179.8, 0] : options.camera.center },
            features: [restored, point('world-anchor', anchor[0])] }));
          await draw.ready;
          if (terrain) await until(() => draw.map.loaded() && Math.abs((draw.map.queryTerrainElevation(anchor) ?? NaN) - 100) < 1,
            `${projection} reloaded date-line elevation`);
          editor = attachDrawing(draw, { createFeature: () => ({ id: 'world-snap', properties: {} }),
            canSnap: feature => feature.id === 'world-anchor', submit: () => ({ accepted: true }) });
          editor.edit('world-line');
          check(JSON.stringify(editor.getState().draft?.shape) === JSON.stringify(restored.drawing?.shape), 'Reload changed shape definition');
          const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
          if (!handle) throw new Error('Reloaded date-line handle missing');
          const box = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
          const visible = draw.map.project(canonicalGlobeTerrain ? [-179.6, 0] : [180.4, 0]);
          check(Math.hypot(box.x + box.width / 2 - canvas.x - visible.x,
            box.y + box.height / 2 - canvas.y - visible.y) < 2, 'Reloaded handle used another world copy');
          check(await editor.finish(), 'Reloaded date-line edit could not finish');
          await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(f => f.properties._rl_feature_id === 'world-anchor'), 'date-line snap anchor');
          editor.start('line');
          const screen = draw.map.project(canonicalGlobeTerrain ? anchor : [180.35, 0]);
          await pointer('move', { x: screen.x + 5, y: screen.y + 3 });
          const ring = container.querySelector<SVGCircleElement>('.rl-ground-snap-ring:not([hidden])');
          check(!!ring && Math.hypot(Number(ring.getAttribute('cx')) - screen.x,
            Number(ring.getAttribute('cy')) - screen.y) < 1, `Snap feedback projected a distant world copy: ${JSON.stringify({
              projection, terrain, screen, ring: ring?.outerHTML, preview: editor.getPreview(),
              hits: draw.map.queryRenderedFeatures([[screen.x - 12, screen.y - 12], [screen.x + 12, screen.y + 12]], { layers: ['rl:points', 'rl:line'] }).map(f => f.properties._rl_feature_id) })}`);
          await pointer('click', { x: screen.x + 5, y: screen.y + 3 });
          const snapped = editor.getState().draft?.shape;
          check(snapped?.kind === 'line' && snapped.vertices[0]?.[0] === anchor[0] &&
            snapped.vertices[0]?.[1] === anchor[1], 'Snap did not copy the stored vertex exactly');
          await pointer('move', { x: screen.x + 5, y: screen.y + 3 });
          draw.setCamera({ center: canonicalGlobeTerrain ? [-179.78, 0] : [179.82, 0] });
          await until(() => {
            const moved = draw.map.project(canonicalGlobeTerrain ? anchor : [180.35, 0]);
            const currentRing = container.querySelector<SVGCircleElement>('.rl-ground-snap-ring:not([hidden])');
            return !!currentRing && Math.hypot(Number(currentRing.getAttribute('cx')) - moved.x,
              Number(currentRing.getAttribute('cy')) - moved.y) < 1;
          }, 'stationary date-line snap feedback follows view');
          if (terrain) {
            const before = JSON.stringify(editor.getState().draft?.shape);
            draw.configure({ elevation: { tiles: ['/missing-world-dem.png'], encoding: 'terrarium', maxzoom: 0 } });
            await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'date-line replacement retires old elevation');
            await pointer('click', { x: screen.x + 5, y: screen.y + 3 });
            check(JSON.stringify(editor.getState().draft?.shape) === before, 'Missing replacement elevation reused old globe coverage');
          }
        } finally { editor.destroy(); draw.destroy(); }
    } finally { removeProtocol(protocol); }
  };
}

export const drawingProjectionCases = {
  "Reliability drawing insertion handles preserve displayed edges": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 60], zoom: 4 }, logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      for (const [kind, center, vertices] of [
        ['line', [0, 60], [[-20, 60], [20, 60]]],
        ['arrow', [179.8, 60], [[179, 60], [-179, 60]]],
        ['polygon', [179.8, 60], [[179, 60], [-179, 60], [-179, 61], [179, 61]]],
      ] as const) {
        const shape = { kind, vertices: vertices.map(([longitude, latitude]): [number, number] => [longitude, latitude]) };
        const feature: MapFeature = { type: 'Feature', id: `insert-${kind}`, properties: {}, geometry: shapeGeometry(shape),
          drawing: { version: 1, shape, style: { color: '#008855', fillColor: '#008855', lineWidth: 3,
            fillOpacity: .2, dashed: false, label: '' } } };
        draw.upsert([feature]); draw.setCamera({ center: [...center], zoom: kind === 'line' ? 4 : 7 });
        for (const projection of ['flat', 'globe'] as const) {
          draw.configure({ projection });
          await until(() => draw.map.getProjection()?.type === (projection === 'flat' ? 'mercator' : 'globe'), 'insertion projection');
          editor.edit(feature.id);
          const button = container.querySelector<HTMLButtonElement>('[aria-label="Insert vertex after 1"]');
          if (!button) throw new Error('Insertion handle missing');
          const box = button.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
          const screen = { x: box.x + box.width / 2 - canvas.x, y: box.y + box.height / 2 - canvas.y };
          const expected = draw.map.project(kind === 'line' ? [0, 60] : [180, 60]);
          check(Math.hypot(screen.x - expected.x, screen.y - expected.y) < 1,
            `${kind}/${projection} insertion handle was displaced from the displayed edge`);
          await until(() => draw.map.queryRenderedFeatures([[screen.x - 2, screen.y - 2], [screen.x + 2, screen.y + 2]],
            { layers: ['rl:draft-line'] }).length > 0, 'displayed edge beneath insertion handle');
          await browserClick('[aria-label="Insert vertex after 1"]');
          const inserted = editor.getState().draft?.shape;
          if (!inserted || !('vertices' in inserted)) throw new Error('Inserted geometry missing');
          check(inserted.vertices.length === vertices.length + 1 &&
            Math.abs(inserted.vertices[1]![1] - 60) < 1e-10, 'Insertion bent the existing edge');
          const point = draw.map.project([kind === 'line' ? inserted.vertices[1]![0] : 180, inserted.vertices[1]![1]]);
          check(Math.hypot(point.x - screen.x, point.y - screen.y) < 1, 'Activation inserted another coordinate');
          check(JSON.stringify(inserted.vertices.filter((_, i) => i !== 1)) === JSON.stringify(vertices), 'Insertion changed original vertices');
          editor.cancel();
        }
        draw.remove([feature.id]);
      }
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Reliability drawing snapping follows the pointer world copy at low zoom": async caseContext => {
    const { container, own, until } = caseContext;
    container.style.width = '800px';
    const anchor: [number, number] = [-179, 0];
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 0 }, features: [point('multi-world-anchor', anchor[0])], logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'multi-world-draft', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      const screen = draw.map.project([181, 0]);
      await until(() => draw.map.queryRenderedFeatures([[screen.x - 8, screen.y - 8], [screen.x + 8, screen.y + 8]],
        { layers: ['rl:points'] }).some(f => f.properties._rl_feature_id === 'multi-world-anchor'), 'alternate visible world vertex');
      editor.start('line');
      await pointer('move', { x: screen.x + 4, y: screen.y + 3 });
      const preview = editor.getPreview();
      check(preview?.kind === 'line' && JSON.stringify(preview.vertices[0]) === JSON.stringify(anchor), 'Visible alternate world vertex was excluded from snapping');
      const ring = container.querySelector<SVGCircleElement>('.rl-ground-snap-ring:not([hidden])');
      check(!!ring && Math.hypot(Number(ring.getAttribute('cx')) - screen.x,
        Number(ring.getAttribute('cy')) - screen.y) < 1, 'Low-zoom snap ring projected on the other visible copy');
      await pointer('click', { x: screen.x + 4, y: screen.y + 3 });
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      if (!handle) throw new Error('Placed world-copy handle missing');
      const box = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
      check(Math.hypot(box.x + box.width / 2 - canvas.x - screen.x,
        box.y + box.height / 2 - canvas.y - screen.y) < 1, 'Placed handle used the other visible copy');
    } finally { editor.destroy(); draw.destroy(); container.style.width = ''; }
  },
  "Reliability drawing snap failures recover on the visible world copy and respect unavailable terrain": async caseContext => {
    const { container, own, until } = caseContext;
    container.style.width = '800px';
    const closest: [number, number] = [-179, 0], healthy: [number, number] = [-174, 0];
    const diagnostics: RidgelineError[] = [], cause = new Error('Alternate world snap failure');
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 0 }, features: [point('world-failed', closest[0]), point('world-healthy', healthy[0])],
      onError: error => diagnostics.push(error), logger: () => {} }));
    await draw.ready;
    let failed = true, calls = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'world-failure-draft', properties: {} }),
      canSnap: feature => { calls++; if (failed && feature.id === 'world-failed') throw cause; return true; },
      submit: () => ({ accepted: true }) });
    const screen = draw.map.project([181, 0]), input = { x: screen.x + 2, y: screen.y + 2 };
    function expectSnap(coordinate: [number, number]) {
      const preview = editor.getPreview(), expected = draw.map.project([coordinate[0] + 360, coordinate[1]]);
      check(preview?.kind === 'line' && JSON.stringify(preview.vertices[0]) === JSON.stringify(coordinate),
        `Alternate world resolution chose the wrong stored vertex: ${JSON.stringify(preview)}`);
      const ring = container.querySelector<SVGCircleElement>('.rl-ground-snap-ring:not([hidden])');
      check(!!ring && Math.hypot(Number(ring.getAttribute('cx')) - expected.x,
        Number(ring.getAttribute('cy')) - expected.y) < 1, 'Recovered snap ring used the other visible world copy');
    }
    try {
      await until(() => {
        const hits = draw.map.queryRenderedFeatures([[input.x - 12, input.y - 12], [input.x + 12, input.y + 12]],
          { layers: ['rl:points'] }).map(feature => feature.properties._rl_feature_id);
        return hits.includes('world-failed') && hits.includes('world-healthy');
      }, 'both alternate world candidates rendered');
      editor.start('line');
      await pointer('move', input);
      expectSnap(healthy);
      check(diagnostics.length === 1 && diagnostics[0]?.cause === cause && diagnostics[0]?.code === 'CALLBACK_FAILED' &&
        diagnostics[0]?.context.operation === 'drawing.canSnap' && diagnostics[0]?.context.featureId === 'world-failed',
      'Alternate world filter failure lost its diagnostic context');
      failed = false; editor.setSnapping(true);
      expectSnap(closest);
      draw.configure({ terrain: true, elevation: { tiles: ['/missing-world-failure-dem.png'], encoding: 'terrarium', maxzoom: 0 } });
      await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'alternate world terrain unavailable');
      const before = JSON.stringify(editor.getState().draft?.shape), beforeCalls = calls;
      await pointer('click', input);
      check(JSON.stringify(editor.getState().draft?.shape) === before && calls === beforeCalls,
        'An eligible recovered world-copy vertex bypassed unavailable terrain');
      draw.configure({ terrain: false });
      await until(() => !!container.querySelector('.rl-ground-snap-ring:not([hidden])'), 'alternate world valid ground recovered');
      expectSnap(closest);
      await pointer('click', input);
      const placed = editor.getState().draft?.shape;
      check(placed?.kind === 'line' && JSON.stringify(placed.vertices) === JSON.stringify([closest]),
        'Recovered world-copy placement did not retain the exact bounded coordinate');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      if (!handle) throw new Error('Recovered world-copy handle missing');
      const box = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
      check(Math.hypot(box.x + box.width / 2 - canvas.x - screen.x,
        box.y + box.height / 2 - canvas.y - screen.y) < 1, 'Recovered world-copy handle moved to the other visible copy');
    } finally { editor.destroy(); draw.destroy(); container.style.width = ''; }
  },
  "Reliability drawing restores rejected handle edits on a third visible world copy": async caseContext => {
    const { container, own, until } = caseContext;
    container.style.width = '1600px';
    const line: MapFeature = { type: 'Feature', id: 'third-copy-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[179, 0], [80, 40]] } };
    const draw = own(createViewport({ container, basemap: style(), terrain: false, features: [line],
      camera: { center: [0, 0], zoom: 0 }, logger: () => {} }));
    await draw.ready;
    // The public MapLibre camera extension keeps multiple longitude turns in
    // view while accepted drawing coordinates remain bounded.
    draw.map.setCenter([-720, 0]);
    check(draw.map.getCenter().lng === -720, 'Native renderer did not retain the unwrapped center');
    let armed = false, callbacks = 0, permissionReads = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'third-copy-edit', properties: {} }),
      canEdit: () => { permissionReads++; return true; },
      canSnap: feature => {
        if (!armed || feature.id !== 'third-copy-anchor') return false;
        callbacks++; editor.setSnapping(true); return true;
      }, submit: () => ({ accepted: true }) });
    try {
      if (!window.browserMouse) throw new Error('Third-copy reentrant native bridge missing');
      editor.setSnapping(false); editor.edit(line.id);
      const original = draw.map.project([-541, 0]), canvas = draw.map.getCanvas().getBoundingClientRect();
      const next = { x: original.x - 10, y: original.y + 10 };
      const coordinate = draw.map.unproject([next.x, next.y]).wrap().toArray();
      draw.upsert([{ ...point('third-copy-anchor'), geometry: { type: 'Point', coordinates: coordinate } }]);
      await until(() => draw.map.queryRenderedFeatures([[next.x - 12, next.y - 12], [next.x + 12, next.y + 12]],
        { layers: ['rl:points'] }).some(feature => feature.properties._rl_feature_id === 'third-copy-anchor'),
      'third-copy reentrant anchor rendered');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      if (!handle) throw new Error('Third-copy reentrant handle missing');
      const initial = JSON.stringify(editor.getState().draft?.shape), box = handle.getBoundingClientRect();
      check(Math.hypot(box.left + box.width / 2 - canvas.left - original.x,
        box.top + box.height / 2 - canvas.top - original.y) < 2, 'Third-copy reentrant placement did not establish the original world copy');
      check(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === handle, 'Another handle obscures the third-copy vertex');
      await window.browserMouse('down', box.left + box.width / 2, box.top + box.height / 2);
      const readsBefore = permissionReads;
      await window.browserMouse('move', canvas.left + original.x - 5, canvas.top + original.y);
      check(permissionReads > readsBefore && JSON.stringify(editor.getState().draft?.shape) !== initial,
        'Third-copy edit did not establish an active valid native gesture');
      editor.setSnapping(true);
      const before = JSON.stringify(editor.getState().draft?.shape), held = handle.getBoundingClientRect();
      armed = true;
      await window.browserMouse('move', canvas.left + next.x, canvas.top + next.y);
      check(callbacks >= 1 && JSON.stringify(editor.getState().draft?.shape) === before,
        'Reentrant snap settings did not invalidate movement without changing the draft');
      const shown = handle.getBoundingClientRect();
      check(Math.hypot(shown.left - held.left, shown.top - held.top) < 2,
        `Reentrant snap restoration moved the handle to another visible world copy: ${JSON.stringify({ held: held.toJSON(), shown: shown.toJSON(), before })}`);
      await window.browserMouse('up', canvas.left + next.x, canvas.top + next.y);
      const settled = handle.getBoundingClientRect();
      check(JSON.stringify(editor.getState().draft?.shape) === before && Math.hypot(settled.left - held.left, settled.top - held.top) < 2, 'Drag release changed the retained vertex or its world copy');
      check(JSON.stringify(draw.getFeature(line.id)) === JSON.stringify(line), 'Rejected dragging changed the accepted feature');
    } finally { armed = false; editor.destroy(); draw.destroy(); container.style.width = ''; }
  },
  "Reliability drawing preserves rejected handle edits after camera turns and reversal": async caseContext => {
    const { container, own, until } = caseContext;
    container.style.width = '1600px';
    const line: MapFeature = { type: 'Feature', id: 'camera-copy-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[179, 0], [80, 40]] } };
    const draw = own(createViewport({ container, basemap: style(), terrain: false, features: [line],
      camera: { center: [0, 0], zoom: 0 }, logger: () => {} }));
    await draw.ready;
    let armed = false, callbacks = 0, permissionReads = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-camera-copy', properties: {} }),
      canEdit: () => { permissionReads++; return true; },
      canSnap: feature => {
        if (!armed || feature.id !== 'camera-copy-anchor') return false;
        callbacks++; editor.setSnapping(true); return true;
      }, submit: () => ({ accepted: true }) });
    try {
      if (!window.browserMouse) throw new Error('Camera-copy native bridge missing');
      editor.edit(line.id);
      const before = JSON.stringify(editor.getState().draft?.shape);
      // Camera movement wraps the live marker without rerendering the draft.
      for (let longitude = 90; longitude <= 1440; longitude += 90)
        draw.map.jumpTo({ center: [longitude, 0], zoom: 0 });
      for (let longitude = 1350; longitude >= 720; longitude -= 90)
        draw.map.jumpTo({ center: [longitude, 0], zoom: 0 });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(draw.map.getCenter().lng === 720 && JSON.stringify(editor.getState().draft?.shape) === before,
        'Camera turns changed the draft or lost the unwrapped renderer center');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      if (!handle) throw new Error('Camera-copy handle missing');
      const held = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
      const original = { x: held.left + held.width / 2 - canvas.left, y: held.top + held.height / 2 - canvas.top };
      const location = draw.map.unproject([original.x, original.y]);
      const expected = draw.map.project([899, 0]);
      check(Math.abs(location.lng) > 720 && Math.hypot(original.x - expected.x, original.y - expected.y) < 1,
        `Camera turns did not establish a distant current marker copy: ${JSON.stringify({ longitude: location.lng, held: held.toJSON() })}`);
      const hit = document.elementFromPoint(held.left + held.width / 2, held.top + held.height / 2);
      check(hit === handle || !!hit && handle.contains(hit), 'Native camera-copy press would hit another handle');
      const target = { x: original.x - 10, y: original.y + 10 };
      draw.upsert([{ ...point('camera-copy-anchor'), geometry: { type: 'Point', coordinates: draw.map.unproject([target.x, target.y]).wrap().toArray() } }]);
      await until(() => draw.map.queryRenderedFeatures([[target.x - 12, target.y - 12], [target.x + 12, target.y + 12]],
        { layers: ['rl:points'] }).some(feature => feature.properties._rl_feature_id === 'camera-copy-anchor'),
      'camera-copy snap anchor rendered');
      editor.setSnapping(true);
      await window.browserMouse('down', canvas.left + original.x, canvas.top + original.y);
      const readsBefore = permissionReads;
      armed = true;
      await window.browserMouse('move', canvas.left + target.x, canvas.top + target.y);
      check(permissionReads > readsBefore && callbacks >= 1 && JSON.stringify(editor.getState().draft?.shape) === before,
        `Native camera-copy movement did not run its rejected gesture: ${JSON.stringify({ readsBefore, permissionReads, callbacks, before, after: editor.getState().draft?.shape })}`);
      const shown = handle.getBoundingClientRect();
      check(Math.hypot(shown.left - held.left, shown.top - held.top) < 2,
        `Rejected editing restored a stale camera copy: ${JSON.stringify({ longitude: location.lng, held: held.toJSON(), shown: shown.toJSON() })}`);
      await window.browserMouse('up', canvas.left + target.x, canvas.top + target.y);
      armed = false;
      const settled = handle.getBoundingClientRect();
      check(JSON.stringify(editor.getState().draft?.shape) === before && Math.hypot(settled.left - held.left, settled.top - held.top) < 2,
        'Settling rejected editing changed its draft or current marker copy');
      check(JSON.stringify(draw.getFeature(line.id)) === JSON.stringify(line), 'Camera-copy editing changed accepted feature data');
    } finally { armed = false; editor.destroy(); draw.destroy(); container.style.width = ''; }
  },
  "Reliability drawing keyboard movement excludes carried shape vertices": async caseContext => {
    const { own, container } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 16 }, logger: () => {} }));
    await draw.ready;
    const origin = draw.map.project([0, 0]);
    const circleShape = { kind: 'circle' as const, center: [0, 0] as [number, number], radius: 15 };
    const circle: MapFeature = { type: 'Feature', id: 'carried-circle', properties: {}, geometry: shapeGeometry(circleShape),
      drawing: { version: 1, shape: circleShape, style: { color: '#008855', fillColor: '#008855', lineWidth: 2,
        fillOpacity: .2, dashed: false, label: '' } } };
    const endpoints = [-16, 16].map(x => draw.map.unproject([origin.x + x, origin.y]).toArray());
    const line: MapFeature = { type: 'Feature', id: 'carried-line', properties: {},
      geometry: { type: 'LineString', coordinates: endpoints } };
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      for (const [feature, label] of [[circle, 'Center'], [line, 'Move drawing']] as const) {
        draw.upsert([feature]); editor.edit(feature.id);
        const handle = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
        if (!handle) throw new Error(`${label} handle missing`);
        handle.focus();
        await browserKey('ArrowRight');
        const shape = editor.getState().draft?.shape;
        let center: [number, number];
        if (shape?.kind === 'circle') {
          check(shape.radius === 15, 'Center movement changed the circle radius');
          center = shape.center;
        } else if (shape?.kind === 'line') center = [(shape.vertices[0]![0] + shape.vertices[1]![0]) / 2,
          (shape.vertices[0]![1] + shape.vertices[1]![1]) / 2];
        else throw new Error('Carried shape missing');
        const screen = draw.map.project(center);
        check(Math.abs(screen.x - origin.x - 10) < 1 && Math.abs(screen.y - origin.y) < 1,
          'Carried shape snapped to one of its own vertices');
        check(document.activeElement === handle, 'Carried shape movement lost focus');
        editor.cancel(); draw.remove([feature.id]);
      }
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Reliability drawing keyboard snapping follows pointer policy": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
    const origin = draw.map.project([0, 0]);
    const target = draw.map.unproject([origin.x + 16, origin.y]).toArray();
    const end = draw.map.unproject([origin.x + 60, origin.y + 60]).toArray();
    const line: MapFeature = { type: 'Feature', id: 'keyboard-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], end] } };
    draw.upsert([line, { type: 'Feature', id: 'keyboard-anchor', properties: {},
      geometry: { type: 'Point', coordinates: target } }]);
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] })
      .some(f => f.properties._rl_feature_id === 'keyboard-anchor'), 'keyboard anchor rendered');
    let excluded = false;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }),
      canSnap: feature => feature.id !== 'keyboard-anchor' || !excluded, submit: () => ({ accepted: true }) });
    const vertex = () => {
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line') throw new Error('Keyboard line draft missing');
      return shape.vertices[0]!;
    };
    const exact = () => JSON.stringify(vertex()) === JSON.stringify(target);
    const freeStep = () => {
      const screen = draw.map.project(vertex());
      check(!exact() && Math.abs(screen.x - origin.x - 10) < 1 && Math.abs(screen.y - origin.y) < 1, 'Bypass did not make a free 10-pixel ground edit');
    };
    try {
      editor.edit(line.id);
      await browserClick('[aria-label="Vertex 1"]');
      container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!.focus();
      check(document.activeElement?.getAttribute('aria-label') === 'Vertex 1', 'Keyboard handle was not focused');
      await browserKey('ArrowRight');
      check(exact(), `Keyboard edit missed an eligible vertex: ${JSON.stringify({ actual: vertex(), target })}`);
      check(document.activeElement?.getAttribute('aria-label') === 'Vertex 1', 'Snapping lost handle focus');
      await browserKey('ControlOrMeta+z');
      check(JSON.stringify(vertex()) === JSON.stringify([0, 0]), 'Undo did not restore the original keyboard vertex');
      await browserKey('Alt+ArrowRight'); freeStep();
      await browserKey('ControlOrMeta+z');
      editor.setSnapping(false);
      await browserKey('ArrowRight'); freeStep();
      await browserKey('ControlOrMeta+z');
      editor.setSnapping(true); excluded = true;
      await browserKey('ArrowRight'); freeStep();
      await browserKey('ControlOrMeta+z'); excluded = false;
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
      const box = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
      await browserDrag(box.x + box.width / 2, box.y + box.height / 2,
        canvas.x + origin.x + 10, canvas.y + origin.y);
      check(exact(), 'Pointer and keyboard edits disagreed on the same snap target');
      await browserKey('ControlOrMeta+z');
      const unchanged = JSON.stringify(editor.getState().draft?.shape);
      draw.configure({ terrain: true, elevation: { tiles: ['/missing-keyboard-dem.png'], encoding: 'terrarium', maxzoom: 0 } });
      await browserClick('[aria-label="Vertex 1"]');
      container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!.focus();
      await browserKey('Shift+ArrowRight');
      check(JSON.stringify(editor.getState().draft?.shape) === unchanged, 'Unavailable ground changed the keyboard draft');
      check(document.activeElement?.getAttribute('aria-label') === 'Vertex 1', 'Unavailable ground lost keyboard focus');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Reliability drawing date-line storage snapping and reload flat without terrain": dateLineDrawing("flat", false),
  "Reliability drawing date-line storage snapping and reload flat with terrain": dateLineDrawing("flat", true),
  "Reliability drawing date-line storage snapping and reload globe without terrain": dateLineDrawing("globe", false),
  "Reliability drawing date-line storage snapping and reload globe with terrain": dateLineDrawing("globe", true),
  "Reliability drawing date-line stays live with a blocking empty-model query": dateLineDrawing("globe", true, true),
} satisfies BrowserCaseModule;
