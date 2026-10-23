import { attachDrawing, attachDrawingControls, createViewport, shapeGeometry } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { NavigationControl } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { captureMapPixels, pixelToCss, waitForVisible } from './browser-observation';



import type { BrowserCaseContext as Context, BrowserCaseModule } from './context';
const style: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] };
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function clickMap(viewport: Viewport, position: [number, number]) {
  check(window.drawingPointer, 'Native pointer bridge required');
  const point = viewport.map.project(position);
  await window.drawingPointer('click', point.x, point.y);
}
async function click(selector: string) {
  check(window.browserClick, 'Native control bridge required');
  await window.browserClick(selector);
}
function controls(viewport: Viewport, editor: ReturnType<typeof attachDrawing>) {
  const tools = document.createElement('div'), inspector = document.createElement('div');
  document.body.append(tools, inspector);
  const attachment = attachDrawingControls(viewport, editor, { tools, inspector });
  return () => { attachment.destroy(); tools.remove(); inspector.remove(); };
}


export const workflowDrawingCases = {
  "Drawing upgrades touch and keyboard handle callbacks preserve current targets through mutation admission": async ({ container, own, until }) => {
    for (const input of ['keyboard', 'touch-drag'] as const)
    for (const callback of ['canEdit', 'canSnap', 'diagnostic'] as const)
    for (const action of ['control', 'candidate', 'data'] as const) {
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 16 }, logger: () => {},
        features: [{ type: 'Feature', id: 'handle-snap', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] }));
      await viewport.ready;
      await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'handle snap feature published');
      let armed = false, finalPermission = false, reportPending = false, invoked = 0, callbackActive = false, resolution = 0, retiredResolution = -1, triggerResolution = -1;
      const changes: { position: [number, number]; callbackActive: boolean; resolution: number }[] = [];
      const changeDuringCallback = () => {
        invoked++; triggerResolution = resolution;
        if (action === 'candidate') retiredResolution = resolution;
        if (action === 'candidate') viewport.upsert([{ type: 'Feature', id: 'handle-snap', properties: {}, geometry: { type: 'Point', coordinates: [.002, 0] } }]);
        if (action === 'data') viewport.upsert([{ type: 'Feature', id: 'unrelated', properties: {}, geometry: { type: 'Point', coordinates: [.01, .01] } }]);
      };
      const off = viewport.on('diagnostic', error => {
        if (reportPending && error.context.operation === 'drawing.canSnap') { reportPending = false; changeDuringCallback(); }
      });
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'handle-input', properties: {} }), submit: () => ({ accepted: true }),
        canSnap: () => {
          resolution++;
          if (armed) {
            armed = false;
            if (callback === 'canSnap') changeDuringCallback();
            else if (callback === 'diagnostic') { reportPending = true; throw new Error('Expected handle snap callback failure'); }
            else finalPermission = true;
          }
          return true;
        },
        canEdit: () => {
          if (finalPermission && !invoked) { finalPermission = false; callbackActive = true; try { changeDuringCallback(); } finally { callbackActive = false; } }
          return true;
        } });
      try {
        // Start beyond the12px snap footprint, then enter it with the driven
        // move. Touch contact creation cannot pre-snap before the callback.
        const center = viewport.map.project([0, 0]), anchor = viewport.map.unproject([center.x - 30, center.y]).toArray();
        editor.start('line'); editor.addPoint(anchor); editor.addPoint([-.001, -.001]);
        const before = JSON.stringify(editor.getState().draft!.shape);
        const offChanges = editor.onChange(() => { const draft = editor.getState().draft; if (draft?.shape.kind === 'line') changes.push({ position: [...draft.shape.vertices[0]!], callbackActive, resolution }); });
        const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
        check(handle && window.browserKey, 'Native keyboard handle bridge required');
        handle.focus(); check(document.activeElement === handle, 'Required retained handle focus missing');
        if (input === 'keyboard') {
          armed = true;
          await window.browserKey('Shift+ArrowRight');
        } else {
          const touch = window.browserTouch; check(touch, 'Native handle touch bridge required');
          const handleBox = handle.getBoundingClientRect(), canvasBox = viewport.map.getCanvas().getBoundingClientRect(), target = viewport.map.project([0, 0]);
          armed = true;
          await touch('start', [{ id: 0, x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }]);
          await touch('move', [{ id: 0, x: canvasBox.x + target.x + 6, y: canvasBox.y + target.y }]);
          await touch('end', []);
        }
        check(invoked === 1, `${input}/${callback}/${action} required handle callback was not reached once`);
        offChanges();
        const state = editor.getState(), shape = state.draft?.shape;
        check(state.phase === 'editing' && shape?.kind === 'line', `${input}/${callback}/${action} lost editable line`);
        if (action === 'candidate') {
          // A held drag may resolve again after the callback returns. Retained
          // displayed geometry can still be a fresh snap until publication.
          // No mutation may use the retired resolution or run inside canEdit.
          check(!changes.some(change => change.callbackActive && Math.abs(change.position[0] - anchor[0]) > 1e-7), 'Handle input mutated during its permission callback');
          check(!changes.some(change => Math.abs(change.position[0]) < 1e-7 && change.resolution <= retiredResolution), `${input}/${callback} applied an obsolete handle target: ${JSON.stringify({ retiredResolution, changes })}`);
          if (input === 'keyboard') check(JSON.stringify(shape) === before, `${callback} applied an abandoned keyboard movement`);
          if (JSON.stringify(shape) !== before) {
            const after = JSON.stringify(shape);
            editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === before, 'Refreshed drag split undo history');
            editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === after, 'Refreshed drag redo changed geometry');
            editor.undo();
          }
        } else {
          check(JSON.stringify(shape) !== before, `${input}/${callback}/${action} discarded valid handle input`);
          // Later stationary drag refreshes may snap again. The admitted
          // resolution itself must preserve filtering and ground fallback.
          check(changes.some(change => change.resolution === triggerResolution &&
            Math.abs(change.position[0] - anchor[0]) > 1e-7 &&
            (callback === 'diagnostic' ? Math.abs(change.position[0]) > 1e-7 : Math.abs(change.position[0]) < 1e-7)),
            `${input}/${callback}/${action} changed handle snap semantics: ${JSON.stringify({ triggerResolution, changes })}`);
          const after = JSON.stringify(shape);
          editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === before, 'Handle input split undo history');
          editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === after, 'Handle redo changed accepted geometry');
          editor.undo();
        }
        const nextHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
        check(nextHandle, 'Next handle missing'); nextHandle.focus();
        await window.browserKey('Alt+ArrowLeft');
        check(JSON.stringify(editor.getState().draft!.shape) !== before, `${input}/${callback}/${action} blocked the next gesture`);
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === before, 'Next handle gesture was not atomic');
      } finally { off(); editor.destroy(); viewport.destroy(); }
    }
  },
  "Drawing upgrades touch callbacks preserve current targets and reject obsolete input": async ({ container, own, until }) => {
    for (const callback of ['canSnap', 'canEdit', 'diagnostic'] as const)
    for (const action of ['control', 'candidate', 'policy', 'camera', 'scene', 'replacement', 'data', 'deny'] as const) {
      if (callback === 'diagnostic' && action === 'deny') continue;
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 16 }, logger: () => {},
        features: [{ type: 'Feature', id: 'snap', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] }));
      await viewport.ready;
      await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'snap feature published');
      let armed = false, finalPermission = false, reportPending = false, invoked = 0, denied = false;
      viewport.map.getCanvasContainer().addEventListener('touchend', () => { armed = true; }, { capture: true, once: true });
      const changeDuringCallback = () => {
        invoked++;
        if (action === 'data') viewport.upsert([{ type: 'Feature', id: 'unrelated', properties: {}, geometry: { type: 'Point', coordinates: [.01, .01] } }]);
        if (action === 'candidate') viewport.upsert([{ type: 'Feature', id: 'snap', properties: {}, geometry: { type: 'Point', coordinates: [.002, 0] } }]);
        if (action === 'policy') editor.setSnapping(false);
        if (action === 'camera') viewport.setCamera({ zoom: viewport.map.getZoom() + 1 });
        if (action === 'scene') viewport.configure({ basemap: { ...style, name: 'Changed scene' } });
        if (action === 'replacement') { editor.cancel(); editor.start('line'); }
        denied = action === 'deny';
        return !denied;
      };
      const offDiagnostic = viewport.on('diagnostic', error => {
        if (reportPending && error.context.operation === 'drawing.canSnap') {
          reportPending = false;
          changeDuringCallback();
        }
      });
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'permission-release', properties: {} }), submit: () => ({ accepted: true }),
        canSnap: () => {
          if (armed) {
            armed = false;
            if (callback === 'canSnap') return changeDuringCallback();
            if (callback === 'diagnostic') { reportPending = true; throw new Error('Expected snap callback failure'); }
            finalPermission = true;
          }
          return true;
        },
        canEdit: () => {
          if (finalPermission && !invoked) {
            finalPermission = false;
            return changeDuringCallback();
          }
          return callback !== 'canEdit' || !denied;
        } });
      try {
        const touch = window.browserTouch;
        check(touch, 'Native touch permission bridge required');
        editor.start('line'); editor.addPoint([-.001, 0]);
        const tap = async (position: [number, number], offset = 0) => {
          const point = viewport.map.project(position), box = viewport.map.getCanvas().getBoundingClientRect();
          await touch('start', [{ id: 0, x: box.left + point.x + offset, y: box.top + point.y }]);
          await touch('end', []);
        };
        await tap([0, 0], 6);
        check(invoked === 1, `Required release-time ${callback} callback was not reached exactly once`);
        const state = editor.getState(), draft = state.draft;
        check(draft?.shape.kind === 'line', 'Release lost its current line draft');
        const expectedPhase = callback === 'canEdit' && action === 'deny' ? 'forbidden' : 'editing';
        check(state.phase === expectedPhase, `${callback}/${action} changed permission phase after input: ${state.phase}`);
        if (action === 'replacement') check(draft.shape.vertices.length === 0, 'Obsolete input entered a replacement draft');
        else if (action === 'control' || action === 'data' || (action === 'deny' && callback === 'canSnap')) {
          check(draft.shape.vertices.length === 2, `${callback}/${action} discarded a valid release`);
          const longitude = draft.shape.vertices[1]![0];
          check(action === 'deny' || callback === 'diagnostic' ? Math.abs(longitude) > 1e-7 : Math.abs(longitude) < 1e-7, `${callback}/${action} changed accepted snap semantics`);
          editor.undo(); check(editor.getState().draft?.placed === 1, 'Release created multiple undo entries');
          editor.redo(); check(editor.getState().draft?.placed === 2, 'Redo lost the accepted release');
          editor.undo();
        } else check(draft.shape.vertices.length === 1, `${callback}/${action} accepted obsolete or rejected input`);
        if (callback === 'canEdit' && action === 'deny') { denied = false; editor.refreshPermissions(); }
        if (action === 'scene') await until(() => viewport.map.isStyleLoaded() === true, 'replacement scene ready for later input');
        await tap([.0006, .0006]);
        const expected = action === 'replacement' ? 1 : 2;
        check(editor.getState().draft?.placed === expected, `${action} left the next gesture unusable`);
        editor.undo(); check(editor.getState().draft?.placed === expected - 1, `${action} next gesture was not atomic`);
      } finally { offDiagnostic(); editor.destroy(); viewport.destroy(); }
    }
  },
  "Drawing upgrades touch preserves valid snapping and rejects obsolete release targets": async ({ container, own, until }) => {
    for (const action of ["control", "data", "candidate", "policy", "camera", "replacement"] as const) {
      const update = action === "data";
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 16 }, logger: () => {},
        features: [{ type: 'Feature', id: 'snap', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] }));
      await viewport.ready;
      await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'snap feature published');
      let armed = false, invoked = 0;
      viewport.map.getCanvasContainer().addEventListener('touchend', () => { armed = true; }, { capture: true, once: true });
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'release', properties: {} }), submit: () => ({ accepted: true }),
        canSnap: () => {
          if (armed) {
            armed = false; invoked++;
            if (action === "candidate") viewport.upsert([{ type: "Feature", id: "snap", properties: {}, geometry: { type: "Point", coordinates: [.002, 0] } }]);
            if (action === "policy") editor.setSnapping(false);
            if (action === "camera") viewport.setCamera({ zoom: viewport.map.getZoom() + 1 });
            if (action === "replacement") { editor.cancel(); editor.start("line"); }
            if (update) viewport.upsert([{ type: 'Feature', id: 'unrelated', properties: {}, geometry: { type: 'Point', coordinates: [.01, .01] } }]);
          }
          return true;
        } });
      try {
        check(window.browserTouch, 'Native touch release bridge required'); editor.start('line');
        const point = viewport.map.project([0, 0]), box = viewport.map.getCanvas().getBoundingClientRect();
        await window.browserTouch('start', [{ id: 0, x: box.left + point.x + 6, y: box.top + point.y }]);
        await window.browserTouch('end', []);
        check(invoked === 1, 'Required release-time snap callback was not reached');
        const draft = editor.getState().draft;
        if (action === "candidate" || action === "policy" || action === "camera" || action === "replacement") {
          check(draft?.shape.kind === 'line' && draft.shape.vertices.length === 0, `${action} did not cancel obsolete input`);
          continue;
        }
        check(draft?.shape.kind === 'line' && draft.shape.vertices.length === 1, `Callback ${update ? 'update' : 'control'} discarded a valid touch release`);
        check(Math.abs(draft.shape.vertices[0]![0]) < 1e-7, `Placement ${action} discarded an unchanged visible snap: ${JSON.stringify(draft.shape.vertices[0])}`);
        editor.undo(); check(editor.getState().draft?.placed === 0, 'Release created multiple undo entries');
      } finally { editor.destroy(); viewport.destroy(); }
    }
  },
  "Drawing upgrades invalid hole can close for correction while submission remains blocked": async ({ container, own }) => {
    const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {} }));
    await viewport.ready; let submitted = 0; const submissionCount = () => submitted;
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'correct-hole', properties: {} }), submit: () => { submitted++; return { accepted: true }; } });
    const dispose = controls(viewport, editor);
    try {
      editor.start('polygon');
      for (const p of [[-.01, -.01], [.01, -.01], [.01, .01], [-.01, .01]] satisfies [number, number][]) editor.addPoint(p);
      editor.startHole();
      for (const p of [[-.01, 0], [-.003, .003], [.003, -.003]] satisfies [number, number][]) editor.addPoint(p);
      check(editor.getState().validation, 'Required touching hole is valid');
      const close = document.querySelector<HTMLButtonElement>('[data-field="action:Finish hole"]');
      check(close && !close.disabled, 'Invalid hole cannot exit placement for correction');
      await click('[data-field="action:Finish hole"]');
      check(!editor.getState().draft?.placing && editor.getState().validation, 'Closing discarded invalid geometry or submission validation');
      check(document.querySelector<HTMLButtonElement>('[data-field="action:Finish"]')?.disabled && submissionCount() === 0, 'Invalid hole became submit-ready');
      editor.moveVertex(0, [-.005, 0], 1);
      check(!editor.getState().validation, 'Correction did not restore valid geometry');
      await click('[data-field="action:Finish"]'); check(submissionCount() === 1, 'Corrected hole did not submit once');
    } finally { dispose(); editor.destroy(); viewport.destroy(); }
  },
  "Drawing upgrades edge snapping chooses the nearest edge while retaining vertex preference": async ({ container, own, until }) => {
    for (const vertex of [false, true]) {
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 16 }, logger: () => {} }));
      await viewport.ready;
      const center = viewport.map.project([0, 0]);
      const line = (id: string, offset: number) => ({ type: 'Feature', id, properties: {}, geometry: { type: 'LineString', coordinates: [
        viewport.map.unproject([center.x + offset, center.y - 70]).toArray(), viewport.map.unproject([center.x + offset, center.y + 70]).toArray()] } } satisfies MapFeature);
      const near = line('near', vertex ? 4.5 : 5), far = line('far', 5.5);
      const vertexPosition = viewport.map.unproject([center.x + 5, center.y]).toArray();
      viewport.upsert(vertex ? [{ type: 'Feature', id: 'vertex', properties: {}, geometry: { type: 'Point', coordinates: vertexPosition } }, near, far] : [near, far]);
      await until(() => viewport.queryFeatures([{ x: center.x - 12, y: center.y - 12 }, { x: center.x + 12, y: center.y + 12 }]).features.some(feature => feature.id === 'near'), 'current native snap geometry');
      const ordering = [...new Set(viewport.map.queryRenderedFeatures([[center.x - 12, center.y - 12], [center.x + 12, center.y + 12]], { layers: ['rl:line'] }).map(feature => feature.properties._rl_feature_id))];
      check(ordering[0] === 'far', `Nearest-edge regression requires the farther edge first, saw ${ordering}`);
      const editor = attachDrawing(viewport, { snapping: { vertices: vertex, edges: true }, createFeature: () => ({ id: 'edge-draft', properties: {} }), submit: () => ({ accepted: true }) });
      try {
        editor.start('line'); await clickMap(viewport, [0, 0]);
        const shape = editor.getState().draft!.shape; check(shape.kind === 'line' && shape.vertices.length === 1, 'Native snap placement did not happen');
        const expected = vertex ? vertexPosition[0] : near.geometry.coordinates[0]![0];
        check(typeof expected === 'number' && Math.abs(shape.vertices[0]![0] - expected) < 1e-7, `${vertex ? 'Vertex preference' : 'Nearest edge'} chose longitude ${shape.vertices[0]![0]} instead of ${expected}`);
      } finally { editor.destroy(); viewport.destroy(); }
    }
  },
  "Drawing upgrades native zoom transfers a handle gesture while programmatic zoom preserves it": async ({ container, own, until }) => {
    const modes = ['keyboard-handle', 'keyboard-canvas', 'wheel', 'native-control', 'canvas-pan', 'canvas-rotate', 'canvas-pitch',
      'disabled-handle', 'disabled-canvas', 'prevented-key', 'control-key', 'form-key', 'programmatic', 'consumer-control'] as const;
    for (const mode of modes) {
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 15 }, logger: () => {} }));
      await viewport.ready;
      viewport.map.addControl(new NavigationControl());
      const form = document.createElement('input'), consumerControl = document.createElement('button');
      form.type = 'number'; form.value = '10'; consumerControl.textContent = 'Consumer camera';
      consumerControl.addEventListener('click', () => viewport.setCamera({ zoom: viewport.map.getZoom() + 1 }));
      document.body.append(form, consumerControl);
      const editor = attachDrawing(viewport, { snapping: { vertices: false, edges: false }, createFeature: () => ({ id: 'zoom-draft', properties: {} }), submit: () => ({ accepted: true }) });
      check(window.browserMouse && window.browserWheel && window.browserKey, 'Native mouse/wheel/key bridge unavailable');
      const mouse = window.browserMouse;
      try {
        editor.start('line'); editor.addPoint([-.001, 0]); editor.addPoint([.001, 0]);
        const before = JSON.stringify(editor.getState().draft!.shape), handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]'); check(handle, 'Drag handle unavailable');
        const bounds = handle.getBoundingClientRect(), x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
        await mouse('down', x, y); await mouse('move', x + 30, y + 10);
        check(JSON.stringify(editor.getState().draft!.shape) !== before, 'Native handle drag did not start');
        check(document.activeElement === handle, 'Native drag must retain actual handle focus');
        const camera = () => JSON.stringify({ center: viewport.map.getCenter().toArray(), zoom: viewport.map.getZoom(), bearing: viewport.map.getBearing(), pitch: viewport.map.getPitch() });
        const beforeCamera = camera();
        const nativeCamera = ['keyboard-handle', 'keyboard-canvas', 'wheel', 'native-control', 'canvas-pan', 'canvas-rotate', 'canvas-pitch'].some(value => value === mode);
        const programmaticCamera = mode === 'programmatic' || mode === 'consumer-control';
        let prevented = 0;
        if (mode.startsWith('disabled-')) viewport.map.keyboard.disable();
        if (mode === 'prevented-key') handle.addEventListener('keydown', event => { if (event.key === '+') { prevented++; event.preventDefault(); event.stopPropagation(); } });
        if (mode === 'keyboard-canvas' || mode === 'disabled-canvas' || mode === 'canvas-pan' || mode === 'canvas-rotate' || mode === 'canvas-pitch') {
          viewport.map.getCanvas().focus(); check(document.activeElement === viewport.map.getCanvas(), 'Required canvas focus missing');
        }
        if (mode === 'control-key' || mode === 'native-control') {
          const control = container.querySelector<HTMLButtonElement>('.maplibregl-ctrl-zoom-in'); check(control, 'Native navigation control unavailable');
          control.focus(); check(document.activeElement === control, 'Required control focus missing');
        }
        if (mode === 'form-key') { form.focus(); check(document.activeElement === form, 'Required form focus missing'); }
        if (mode === 'consumer-control') { consumerControl.focus(); check(document.activeElement === consumerControl, 'Consumer control focus missing'); }
        if (mode === 'wheel') await window.browserWheel(-120);
        else if (mode === 'programmatic') viewport.setCamera({ zoom: viewport.map.getZoom() + 1 });
        else await window.browserKey(mode === 'native-control' || mode === 'consumer-control' ? 'Enter'
          : mode === 'canvas-pan' ? 'ArrowRight' : mode === 'canvas-rotate' ? 'Shift+ArrowRight'
          : mode === 'canvas-pitch' ? 'Shift+ArrowUp' : mode === 'form-key' ? 'ArrowUp' : '+');
        if (nativeCamera || programmaticCamera) await until(() => camera() !== beforeCamera && !viewport.map.isMoving(), `${mode} completed camera movement`);
        else {
          const end = performance.now() + 450;
          while (performance.now() < end) {
            check(camera() === beforeCamera && !viewport.map.isMoving(), `${mode} unexpectedly moved the camera`);
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
        if (mode === 'prevented-key') check(prevented > 0, 'Required consumed-key preventDefault callback was not reached');
        if (mode === 'form-key') check(form.value === '11', 'Drawing swallowed the form input command');
        const afterCamera = JSON.stringify(editor.getState().draft!.shape);
        await mouse('move', x + 60, y + 20);
        const afterMove = JSON.stringify(editor.getState().draft!.shape);
        check(nativeCamera ? afterMove === afterCamera : afterMove !== afterCamera, `${mode} ${nativeCamera ? 'retained' : 'discarded'} handle ownership`);
        await mouse('up', x + 60, y + 20);
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === before, `${mode} lost atomic undo`);
        editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === afterMove, `${mode} lost exact redo`);
        const nextHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]'); check(nextHandle, 'Next gesture handle missing');
        await until(() => {
          const bounds = nextHandle.getBoundingClientRect();
          return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.closest('.rl-drawing-handle') === nextHandle;
        }, `${mode} next handle has a native hit target`);
        const nextBounds = nextHandle.getBoundingClientRect(), nextX = nextBounds.left + nextBounds.width / 2, nextY = nextBounds.top + nextBounds.height / 2;
        await mouse('down', nextX, nextY); await mouse('move', nextX + 20, nextY + 10);
        await mouse('up', nextX + 20, nextY + 10);
        const nextShape = JSON.stringify(editor.getState().draft!.shape);
        check(nextShape !== afterMove, `${mode} left the next gesture unusable`);
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === afterMove, `${mode} next gesture did not undo once`);
        editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === nextShape, `${mode} next gesture did not redo exactly`);
        const keyboardHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]'); check(keyboardHandle, 'Keyboard handle missing after recovery');
        keyboardHandle.focus();
        const beforeHandleKeyCamera = camera();
        await window.browserKey('ArrowUp');
        const afterHandleKey = JSON.stringify(editor.getState().draft!.shape);
        check(afterHandleKey !== nextShape && document.activeElement === keyboardHandle, `${mode} swallowed the recovered handle command or lost focus`);
        const quietEnd = performance.now() + 450;
        while (performance.now() < quietEnd) {
          check(camera() === beforeHandleKeyCamera && !viewport.map.isMoving(), `${mode} handle command also navigated the camera`);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === nextShape, `${mode} handle command lost one-step undo`);
        editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === afterHandleKey, `${mode} handle command lost exact redo`);
      } finally { await mouse('up', 1, 1); editor.destroy(); viewport.destroy(); form.remove(); consumerControl.remove(); }
    }
  },
  "Drawing upgrades holes and exact segments save reload and retain draft history": async ({ container, own, until }) => {
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {} }));
      await viewport.ready;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'polygon-with-hole', properties: {} }), submit: () => ({ accepted: true }) });
      const disposeControls = controls(viewport, editor);
      try {
        editor.start('polygon');
        for (const point of [[-.009, -.006], [.009, -.006], [.009, .006], [-.009, .006]] satisfies [number, number][])
          await clickMap(viewport, point);
        await click('[data-field="action:Add hole"]');
        check(editor.getState().draft?.placingRing === 1, 'Hole placement did not start');
        for (const point of [[-.003, -.002], [.003, -.002], [.003, .002], [-.003, .002]] satisfies [number, number][])
          await clickMap(viewport, point);
        await click('[data-field="action:Finish hole"]');
        check(!editor.getState().draft?.placing, 'Hole placement did not end');
        const highlighted = () => viewport.map.queryRenderedFeatures({ layers: ['rl:draft-active-segment'] });
        const currentSegmentShown = () => {
          const selected = document.querySelector<HTMLSelectElement>('[data-field="Segment"]');
          const ring = document.querySelector<HTMLSelectElement>('[data-field="Ring"]');
          if (!selected || !ring) return false;
          const segment = editor.getSegments().find(item => item.ring === ring.selectedIndex && item.index === Number(selected.value) - 1);
          if (!segment) return false;
          const midpoint = viewport.map.project([(segment.start[0] + segment.end[0]) / 2, (segment.start[1] + segment.end[1]) / 2]);
          return viewport.map.queryRenderedFeatures([[midpoint.x - 2, midpoint.y - 2], [midpoint.x + 2, midpoint.y + 2]], { layers: ['rl:draft-active-segment'] }).length > 0;
        };
        const directionPixels = async () => {
          check(window.browserCaptureMap, 'Composed map screenshot bridge required');
          const selected = document.querySelector<HTMLSelectElement>('[data-field="Segment"]');
          const ring = document.querySelector<HTMLSelectElement>('[data-field="Ring"]');
          check(selected && ring, 'Directed segment controls missing');
          const segment = editor.getSegments().find(item => item.ring === ring.selectedIndex && item.index === Number(selected.value) - 1);
          check(segment, 'Selected directed segment missing');
          const start = viewport.map.project(segment.start), end = viewport.map.project(segment.end);
          const bounds = container.getBoundingClientRect();
          const documentBounds = { left: bounds.left + scrollX, top: bounds.top + scrollY,
            right: bounds.right + scrollX, bottom: bounds.bottom + scrollY };
          const endpointHandle = [...container.querySelectorAll<HTMLButtonElement>('.rl-drawing-handle')].find(button => {
            const box = button.getBoundingClientRect();
            return Math.hypot(box.left + box.width / 2 - bounds.left - end.x, box.top + box.height / 2 - bounds.top - end.y) < 1;
          });
          check(endpointHandle && !endpointHandle.disabled, 'Endpoint edit handle must be present during direction observation');
          viewport.map.setPaintProperty('rl:draft-segment-arrow', 'icon-opacity-transition', { duration: 0, delay: 0 });
          await captureMapPixels(viewport, 2000);
          const captured = await window.browserCaptureMap();
          let withoutHead: string;
          viewport.map.setPaintProperty('rl:draft-segment-arrow', 'icon-opacity', 0);
          try {
            await captureMapPixels(viewport, 2000);
            withoutHead = await window.browserCaptureMap();
          } finally {
            viewport.map.setPaintProperty('rl:draft-segment-arrow', 'icon-opacity', 1);
            await captureMapPixels(viewport, 2000);
          }
          const decode = async (encoded: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            check(context, 'Screenshot pixel context unavailable');
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height);
          };
          const [shown, hidden] = await Promise.all([decode(captured), decode(withoutHead)]);
          check(shown.width === hidden.width && shown.height === hidden.height, 'Composed head observations changed their crop');
          // Element screenshots enclose fractional document bounds with integer
          // CSS pixels. Preserve that crop origin instead of stretching it.
          const crop = { left: Math.floor(documentBounds.left + .001), top: Math.floor(documentBounds.top + .001),
            right: Math.ceil(documentBounds.right - .001), bottom: Math.ceil(documentBounds.bottom - .001) };
          const geometry = { width: shown.width, height: shown.height, cssWidth: crop.right - crop.left,
            cssHeight: crop.bottom - crop.top, origin: 'top-left' as const };
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          check(length > 40, 'Directed segment must be long enough to separate its head from other handles');
          const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
          const wings: [number, number] = [0, 0];
          const foreground = [25, 128, 92];
          for (let y = 0; y < shown.height; y++) for (let x = 0; x < shown.width; x++) {
            const index = (y * shown.width + x) * 4;
            const point = pixelToCss(geometry, { x, y });
            const dx = point.x - (documentBounds.left - crop.left) - end.x;
            const dy = point.y - (documentBounds.top - crop.top) - end.y;
            const behind = -(dx * direction.x + dy * direction.y);
            const side = dx * -direction.y + dy * direction.x;
            if (!(behind > 8 && behind < 22 && Math.abs(side) > 3.5 && Math.abs(side) < 8)) continue;
            // The composed image pair differs only in head opacity. Unchanged
            // shaft pixels and handle glyphs contribute nothing; partially
            // covered edge pixels contribute their visible green ink fraction.
            let ink = 0, fullInk = 0;
            for (const [channel, color] of foreground.entries()) {
              const contrast = hidden.data[index + channel]! - color;
              ink += (hidden.data[index + channel]! - shown.data[index + channel]!) * contrast;
              fullInk += contrast * contrast;
            }
            if (fullInk) wings[side > 0 ? 1 : 0] += Math.max(0, Math.min(1, ink / fullInk));
          }
          const scale = shown.width / geometry.cssWidth * shown.height / geometry.cssHeight;
          const visible = wings.map(count => count / scale);
          window.drawingDirectionObservation = { image: captured, wings: visible, handle: endpointHandle.getAttribute('aria-label') };
          return visible;
        };
        const visibleDirection = async (description: string) => {
          await until(currentSegmentShown, description);
          // Compare visible ink area so rotated, partially covered SDF pixels
          // count without assuming either wing has fully colored pixels.
          await waitForVisible(directionPixels, wings => wings.every(count => count >= 6), { timeout: 8000, description });
        };
        await until(currentSegmentShown, 'selected directed hole segment highlighted');
        await visibleDirection('selected hole direction beside endpoint handle');
        const endpoint = [...container.querySelectorAll<HTMLButtonElement>('.rl-drawing-handle')]
          .find(button => button.getAttribute('aria-label') === window.drawingDirectionObservation?.handle);
        check(endpoint, 'Observed endpoint handle missing before controlled coverage');
        const originalSize = { width: endpoint.style.width, height: endpoint.style.height };
        endpoint.style.width = '40px'; endpoint.style.height = '40px';
        try {
          await waitForVisible(directionPixels, wings => wings.every(count => count < .1), {
            timeout: 8000, description: 'composed pixel criterion detects the head covered by its endpoint handle',
          });
        } finally { endpoint.style.width = originalSize.width; endpoint.style.height = originalSize.height; }
        await visibleDirection('direction restored beside endpoint handle');
        check(window.browserKey, 'Native inspector key bridge required');
        await click('[data-field="Segment"]');
        await window.browserKey('ArrowDown');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Segment"]')?.value === '2' && currentSegmentShown(), 'segment selection updates map');
        await visibleDirection('changed segment direction beside endpoint handle');
        await click('[data-field="Ring"]');
        await window.browserKey('ArrowUp');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Boundary' && currentSegmentShown(), 'boundary selection updates map');
        await visibleDirection('boundary direction beside endpoint handle');
        await click('[data-field="Ring"]');
        await window.browserKey('ArrowDown');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Hole 1' && currentSegmentShown(), 'hole selection restores directed segment');
        await visibleDirection('restored hole direction beside endpoint handle');
        const beforeNumeric = editor.getState().draft!.shape;
        check(window.browserFill && window.browserKey, 'Native numeric input bridge required');
        await window.browserFill('[data-field="Distance (m)"]', '500');
        await window.browserKey('Tab');
        await until(() => Math.abs(editor.getSegments().find(segment => segment.ring === 1 && segment.index === 0)!.length - 500) < .01, 'exact hole segment distance');
        await until(currentSegmentShown, 'highlight follows exact segment edit');
        await visibleDirection('edited segment direction beside endpoint handle');
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(beforeNumeric), 'Numeric undo changed another ring');
        await until(currentSegmentShown, 'highlight follows numeric undo');
        await visibleDirection('undone segment direction beside endpoint handle');
        editor.redo();
        const savedShape = editor.getState().draft!.shape;
        await click('[data-field="action:Finish"]');
        await until(() => Boolean(viewport.getFeature('polygon-with-hole')), 'saved polygon');
        await until(() => highlighted().length === 0 && viewport.map.queryRenderedFeatures({ layers: ['rl:draft-segment-arrow'] }).length === 0, 'submission clears directed segment');
        const saved = viewport.getFeature('polygon-with-hole')!;
        check(saved.geometry.type === 'Polygon' && saved.geometry.coordinates.length === 2, 'Accepted geometry dropped the hole');
        check(JSON.stringify(saved.geometry) === JSON.stringify(shapeGeometry(savedShape)), 'Saved shape and geometry disagree');
        const storage = new Map<string, MapFeature>([[saved.id, structuredClone(saved)]]);
        viewport.upsert([...storage.values()]);
        editor.edit(saved.id);
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(savedShape), 'Reload changed the shape definition');
        await click('[data-field="Ring"]');
        await window.browserKey('ArrowDown');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Hole 1', 'saved hole selected');
        const validArea = editor.getMeasurements().area;
        check(validArea !== undefined && validArea > 0, 'Valid hole must have meaningful positive area');
        const areaText = () => document.querySelector<HTMLOutputElement>('[aria-label="Drawing measurements"]')?.textContent ?? '';
        const originalAreaText = areaText();
        check(!originalAreaText.includes('unavailable') && originalAreaText.includes('Area '), 'Valid polygon area was not displayed');
        await window.browserFill('[data-field="Distance (m)"]', '20000');
        await window.browserKey('Tab');
        await until(() => Boolean(editor.getState().validation) && areaText().includes('Area unavailable'), 'invalid hole area unavailable in inspector');
        const invalid = editor.getState();
        check(invalid.measurements.area !== undefined && invalid.measurements.area < 0, 'Oversized hole did not preserve its negative raw area');
        check(editor.getMeasurements().area === invalid.measurements.area, 'Live invalid measurement was clamped or hidden');
        check(invalid.canUndo && invalid.phase === 'editing', 'Invalid draft did not remain editable and undoable');
        check(document.querySelector<HTMLButtonElement>('[data-field="action:Finish"]')?.disabled, 'Invalid Finish control was enabled');
        const distanceField = document.querySelector<HTMLInputElement>('[data-field="Distance (m)"]');
        check(distanceField && !distanceField.disabled, 'Invalid draft numeric editing was disabled or missing');
        check(!(await editor.finish()), 'Invalid hole was submitted');
        check(JSON.stringify(viewport.getFeature(saved.id)) === JSON.stringify(saved), 'Blocked invalid submission changed accepted data');
        check(JSON.stringify(editor.getState().draft) === JSON.stringify(invalid.draft), 'Blocked invalid submission lost the draft');
        await click('[data-field="action:Undo"]');
        await until(() => !editor.getState().validation && areaText() === originalAreaText, 'undo restores meaningful displayed area');
        check(editor.getMeasurements().area === validArea && editor.getState().measurements.area === validArea, 'Undo failed to restore valid raw area');
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(savedShape), 'Invalid-hole undo changed the accepted shape');
        check(JSON.stringify(viewport.getFeature(saved.id)) === JSON.stringify(saved), 'Invalid-hole undo changed accepted data');
        await visibleDirection('invalid-hole undo direction beside endpoint handle');
        editor.removeHole(1);
        editor.undo();
        check(JSON.stringify(shapeGeometry(editor.getState().draft!.shape)) === JSON.stringify(saved.geometry), 'Hole removal undo lost geometry');
        editor.cancel();
        check(JSON.stringify(viewport.getFeature(saved.id)) === JSON.stringify(saved), 'Draft cancellation changed accepted data');
      } finally { disposeControls(); editor.destroy(); viewport.destroy(); }
    },
  "Drawing upgrades edge snapping is opt in respects Alt filters and callback scene changes": async ({ container, own, until }) => {
      const edge: MapFeature = { type: 'Feature', id: 'edge', properties: {}, geometry: { type: 'LineString', coordinates: [[-.02, 0], [.02, 0]] } };
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, .004], zoom: 13 }, features: [edge], logger: () => {} }));
      await viewport.ready;
      await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:line'] }).length > 0, 'eligible edge rendered');
      let failFilter = false, moveCamera = false, insidePlacementClick = false, changedDuringClick = false;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'new-line', properties: {} }), submit: () => ({ accepted: true }),
        canSnap: () => {
          if (failFilter) throw new Error('Filter unavailable');
          if (moveCamera) { moveCamera = false; changedDuringClick = insidePlacementClick; viewport.map.jumpTo({ center: [.001, .004] }); }
          return true;
        } });
      try {
        editor.start('line');
        await clickMap(viewport, [0, .012]);
        check(window.drawingPointer && window.browserKeyDown && window.browserKeyUp, 'Native pointer/key bridges required');
        const target = (longitude = 0) => { const point = viewport.map.project([longitude, 0]); return { x: point.x, y: point.y + 6 }; };
        const place = async (longitude = 0) => { const point = target(longitude); await window.drawingPointer!('click', point.x, point.y); };
        const end = () => { const shape = editor.getState().draft!.shape; check(shape.kind === 'line', 'Missing line draft'); return shape.vertices.at(-1)!; };
        await place();
        check(Math.abs(end()[1]) > 1e-5, 'Default unexpectedly enabled edge snapping');
        editor.undo(); editor.setEdgeSnapping(true);
        const edgeTarget = target();
        await window.drawingPointer("move", edgeTarget.x, edgeTarget.y);
        await until(() => Boolean(container.querySelector('.rl-ground-snap-ring[data-snap-kind="edge"]:not([hidden])')), "edge snap feedback");
        check(container.querySelector('.rl-ground-snap-ring')!.getAttribute("stroke-dasharray") === "3 3", "Edge target did not use a dashed ring");
        const vertexTarget = viewport.map.project([-.02, 0]);
        await window.drawingPointer("move", vertexTarget.x + 3, vertexTarget.y + 3);
        await until(() => Boolean(container.querySelector('.rl-ground-snap-ring[data-snap-kind="vertex"]:not([hidden])')), "vertex snap feedback");
        check(container.querySelector('.rl-ground-snap-ring')!.getAttribute("stroke-dasharray") === "none", "Vertex target retained edge feedback");
        await place();
        check(Math.abs(end()[1]) < 1e-9 && Math.abs(end()[0]) < 1e-5, 'Edge snap missed the middle of the visible line');
        editor.undo();
        await window.browserKeyDown('Alt');
        try { await place(); } finally { await window.browserKeyUp('Alt'); }
        check(Math.abs(end()[1]) > 1e-5, 'Alt did not bypass edge snapping');
        editor.undo(); failFilter = true;
        await place();
        check(Math.abs(end()[1]) > 1e-5, 'Failed filter still allowed edge snapping');
        editor.undo(); failFilter = false;
        check(window.browserStationaryClick, 'Native stationary click bridge required');
        const beforeInterruptedClick = target();
        await window.drawingPointer('move', beforeInterruptedClick.x, beforeInterruptedClick.y);
        viewport.map.getCanvas().addEventListener('click', () => { insidePlacementClick = true; moveCamera = true; }, { once: true, capture: true });
        try { await window.browserStationaryClick(); } finally { insidePlacementClick = false; }
        check(changedDuringClick && !moveCamera, 'Camera callback did not execute inside the native placement click');
        const interrupted = editor.getState().draft!.shape;
        check(interrupted.kind === 'line' && interrupted.vertices.length === 1, 'Scene-changing filter placed an obsolete edge target');
        await place();
        check(Math.abs(end()[1]) < 1e-9, 'Edge snapping did not recover after camera change');
        const drawingStyle = editor.getState().draft!.style;
        editor.cancel();
        const crossingShape = { kind: 'line' as const, vertices: [[179.98, 0], [-179.98, 0]] satisfies [number, number][] };
        const longEdge: MapFeature = { ...edge, id: 'long-edge', geometry: shapeGeometry(crossingShape) };
        const renderedAtTarget = (id: string, longitude = 0) => {
          const point = target(longitude);
          return viewport.map.queryRenderedFeatures([[point.x - 12, point.y - 12], [point.x + 12, point.y + 12]], { layers: ['rl:line'] })
            .some(feature => feature.properties._rl_feature_id === id);
        };
        viewport.remove([edge.id]);
        viewport.upsert([longEdge]);
        viewport.map.jumpTo({ center: [0, .004] });
        await until(() => renderedAtTarget(longEdge.id), 'ordinary long GeoJSON edge rendered at its middle');
        editor.start('line');
        await clickMap(viewport, [0, .012]);
        await place();
        check(Math.abs(end()[0]) < 1e-5 && Math.abs(end()[1]) < 1e-9, 'Ordinary long GeoJSON edge was shortened while snapping');
        editor.cancel();
        const crossing: MapFeature = { ...longEdge, id: 'crossing-edge', drawing: { version: 1, shape: crossingShape, style: drawingStyle } };
        viewport.remove([longEdge.id]);
        viewport.upsert([crossing]);
        viewport.map.jumpTo({ center: [180, .004] });
        await until(() => renderedAtTarget(crossing.id, 180), 'saved date-line edge rendered at its middle');
        editor.start('line');
        await clickMap(viewport, [180, .012]);
        await place(180);
        check(Math.abs(Math.abs(end()[0]) - 180) < 1e-5 && Math.abs(end()[1]) < 1e-9, 'Date-line edge snapped to a different world copy');
      } finally { editor.destroy(); viewport.destroy(); }
    },
  "Drawing upgrades touch taps handles cancellation and two finger navigation use native input": async ({ container, own, until }) => {
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {} }));
      await viewport.ready;
      let allowed = true;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'touch-line', properties: {} }), submit: () => ({ accepted: true }), canEdit: () => allowed });
      try {
        check(window.browserTouch, 'Native CDP touch bridge required');
        const touch = window.browserTouch;
        const pagePoint = (position: [number, number]) => {
          const point = viewport.map.project(position), box = viewport.map.getCanvas().getBoundingClientRect();
          return { x: box.left + point.x, y: box.top + point.y };
        };
        const tap = async (position: [number, number]) => {
          await touch('start', [{ id: 0, ...pagePoint(position) }]);
          await touch('end', []);
        };
        editor.start('line');
        await touch('start', [{ id: 0, ...pagePoint([-.005, .004]) }]);
        await until(() => Boolean(editor.getPreview()) && Boolean(container.querySelector('.rl-ground-crosshair:not([hidden])')), 'touch placement preview');
        await touch('cancel', []);
        check(editor.getState().draft?.placed === 0 && !editor.getPreview(), 'Cancelled placement contact retained a point or preview');
        check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Cancelled placement contact retained its reticle');

        await tap([-.003, 0]);
        await until(() => editor.getState().draft?.placed === 1, 'first touch vertex');
        await touch('start', [{ id: 0, ...pagePoint([-.005, .004]) }]);
        allowed = false; editor.refreshPermissions(); allowed = true; editor.refreshPermissions();
        await touch('end', []);
        check(editor.getState().draft?.placed === 1, 'Permission repair revived an abandoned touch tap');
        check(window.browserMouse, 'Native mouse bridge unavailable');
        const abandoned = pagePoint([-.005, .004]);
        await window.browserMouse('down', abandoned.x, abandoned.y);
        allowed = false; editor.refreshPermissions(); allowed = true; editor.refreshPermissions();
        await window.browserMouse('up', abandoned.x, abandoned.y);
        check(editor.getState().draft?.placed === 1, 'Permission repair revived abandoned mouse placement');
        await tap([.003, 0]);
        await until(() => editor.getState().draft?.placed === 2, 'second touch vertex');
        const original = editor.getState().draft!.shape;
        const initialCenter = viewport.map.getCenter();
        const canvasBox = viewport.map.getCanvas().getBoundingClientRect();
        const oneFinger = { x: canvasBox.left + 100, y: canvasBox.top + 80 };
        await touch('start', [{ id: 0, ...oneFinger }]);
        await touch('move', [{ id: 0, x: oneFinger.x + 45, y: oneFinger.y + 20 }]);
        await touch('end', []);
        await new Promise(resolve => setTimeout(resolve, 250));
        check(JSON.stringify(viewport.map.getCenter().toArray()) === JSON.stringify(initialCenter.toArray()) && editor.getState().draft?.placed === 2,
          'One-finger canvas drawing panned or placed a point during a drag');

        const first = pagePoint([-.002, -.003]), second = { x: first.x + 80, y: first.y };
        await touch('start', [{ id: 0, ...first }]);
        await touch('start', [{ id: 0, ...first }, { id: 1, ...second }]);
        for (let i = 1; i <= 6; i++) await touch('move', [
          { id: 0, x: first.x + i * 8, y: first.y + i * 4 }, { id: 1, x: second.x + i * 8, y: second.y + i * 4 },
        ]);
        await touch('end', [{ id: 0, x: first.x + 48, y: first.y + 24 }]);
        await touch('move', [{ id: 0, x: first.x + 80, y: first.y + 24 }]);
        await touch('end', []);
        await until(() => !viewport.map.isMoving(), 'touch camera settled');
        check(Math.abs(viewport.map.getCenter().lng - initialCenter.lng) > 1e-5, 'Two-finger native pan did not move the camera');
        check(editor.getState().draft?.placed === 2, 'Navigation added a vertex after one finger lifted');
        const handle = () => {
          const button = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
          check(button, 'First editing handle missing');
          const box = button.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        };
        let point = handle();
        await touch('start', [{ id: 0, ...point }]);
        await touch('move', [{ id: 0, x: point.x + 35, y: point.y + 20 }]);
        await touch('end', []);
        check(JSON.stringify(editor.getState().draft!.shape) !== JSON.stringify(original), 'Native touch handle drag changed no geometry');
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Touch drag did not create one undo action');
        const move = container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]'); check(move, 'Whole-shape touch handle absent');
        const moveBox = move.getBoundingClientRect(), movePoint = { x: moveBox.left + moveBox.width / 2, y: moveBox.top + moveBox.height / 2 };
        check(document.elementFromPoint(movePoint.x, movePoint.y) === move, 'Insertion or vertex covered the whole-shape touch handle');
        editor.setSnapping(false);
        await touch('start', [{ id: 0, ...movePoint }]); await touch('move', [{ id: 0, x: movePoint.x + 35, y: movePoint.y + 20 }]); await touch('end', []);
        const moved = editor.getState().draft!.shape; check(moved.kind === 'line' && original.kind === 'line', 'Whole-shape touch fixture changed tool');
        const beforeScreen = viewport.map.project(original.vertices[0]!), afterScreen = viewport.map.project(moved.vertices[0]!);
        check(Math.abs(afterScreen.x - beforeScreen.x - 35) < 1 && Math.abs(afterScreen.y - beforeScreen.y - 20) < 1, 'Offset move handle changed geometry by its display offset');
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Whole-shape touch movement split undo history');
        editor.setSnapping(true);
        point = handle();
        await touch('start', [{ id: 0, ...point }]);
        await touch('move', [{ id: 0, x: point.x + 20, y: point.y + 12 }]);
        const partial = editor.getState().draft!.shape;
        await touch('cancel', []);
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(partial), 'Touch cancellation discarded last valid movement');
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Cancelled touch gesture was not one undo action');
        point = handle();
        await touch('start', [{ id: 0, ...point }]);
        await touch('move', [{ id: 0, x: point.x + 20, y: point.y + 12 }]);
        const permitted = editor.getState().draft!.shape;
        allowed = false; editor.refreshPermissions();
        await touch('move', [{ id: 0, x: point.x + 60, y: point.y + 12 }]);
        await touch('end', []);
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(permitted), 'Permission loss continued a stale touch drag');
        allowed = true; editor.refreshPermissions();
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Permission-interrupted gesture was not undoable');
        let nativeMouseHover = false;
        viewport.map.getCanvas().addEventListener('pointermove', event => { if (event.pointerType === 'mouse') nativeMouseHover = true; });
        check(window.browserMouse, 'Hybrid input mouse bridge unavailable');
        await window.browserMouse('move', canvasBox.left + 100, canvasBox.top + 80);
        await until(() => nativeMouseHover && Boolean(container.querySelector('.rl-ground-crosshair:not([hidden])')), 'physical mouse hover after touch');
        viewport.configure({ terrain: true, elevation: { tiles: ['/missing-hybrid-hover-dem.png'], encoding: 'terrarium', maxzoom: 0 } });
        await until(() => Boolean(container.querySelector('.rl-ground-unavailable:not([hidden])')), 'hybrid stationary hover reflects unavailable terrain');
        viewport.configure({ terrain: false });
        await until(() => Boolean(container.querySelector('.rl-ground-crosshair:not([hidden])')), 'hybrid stationary hover recovers valid ground');
        check(await editor.finish(), 'Touch draft did not finish');
        check(viewport.getFeature('touch-line')?.geometry.type === 'LineString', 'Touch draft was not accepted');
        editor.edit('touch-line'); editor.setSnapping(false);
        const center = viewport.map.project(viewport.map.getCenter());
        const upper = viewport.map.unproject([center.x, center.y - 44]), lower = viewport.map.unproject([center.x, center.y + 44]);
        editor.moveVertex(0, [upper.lng, upper.lat]); editor.moveVertex(1, [lower.lng, lower.lat]);
        const reachable = () => [1, 2].every(index => {
          const button = container.querySelector<HTMLButtonElement>(`[aria-label="Vertex ${index}"]`);
          if (!button) return false;
          const box = button.getBoundingClientRect(); return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button;
        });
        check(reachable(), 'Move control covered an endpoint of the 88px vertical line');
        viewport.setCamera({ bearing: 90 });
        await until(reachable, 'camera rotation preserves independently reachable endpoint targets');
        const endpoint = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(endpoint, 'Rotated endpoint missing');
        const endpointBox = endpoint.getBoundingClientRect(), endpointPoint = { x: endpointBox.left + endpointBox.width / 2, y: endpointBox.top + endpointBox.height / 2 };
        const vertical = JSON.stringify(editor.getState().draft!.shape);
        await touch('start', [{ id: 0, ...endpointPoint }]); await touch('move', [{ id: 0, x: endpointPoint.x + 20, y: endpointPoint.y + 10 }]); await touch('end', []);
        check(JSON.stringify(editor.getState().draft!.shape) !== vertical, 'Covered endpoint could not be edited by native touch');
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === vertical, 'Endpoint recovery lost atomic undo');
        editor.cancel(); viewport.remove(['touch-line']); viewport.setCamera({ center: [0, 0], bearing: 0, pitch: 0 }); editor.start('polygon');
        const polygonCenter = viewport.map.project([0, 0]);
        const offsets = [[0, -48], [48, -48], [48, 0], [48, 48], [0, 48], [-48, 48], [-48, 0], [-48, -48]] satisfies [number, number][];
        for (const [x, y] of offsets) {
          const point = viewport.map.unproject([polygonCenter.x + x, polygonCenter.y + y]); editor.addPoint([point.lng, point.lat]);
        }
        editor.finishRing();
        const footprint = editor.getState().draft!.shape; check(footprint.kind === 'polygon', 'Crowded fixture changed shape kind');
        const holePoint = (x: number, y: number): [number, number] => {
          const point = viewport.map.unproject([polygonCenter.x + x, polygonCenter.y + y]); return [point.lng, point.lat];
        };
        // Occupy the center too, so this history exercises the bounded outside
        // footprint fallback rather than only a free center candidate.
        editor.setShape({ ...footprint, holes: [[holePoint(0, 0), holePoint(4, 0), holePoint(0, 4)]] });
        await until(() => Boolean(container.querySelector('[aria-label="Vertex 8"]')), 'polygon exposes all occupied nearby move positions');
        for (let index = 1; index <= 8; index++) {
          const button = container.querySelector<HTMLButtonElement>(`[aria-label="Vertex ${index}"]`); check(button, 'Polygon vertex absent');
          const box = button.getBoundingClientRect();
          check(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button, 'Move control covered a vertex when all nearby positions were occupied');
        }
        const polygonMove = container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]'); check(polygonMove, 'Polygon move control absent');
        const polygonMoveBox = polygonMove.getBoundingClientRect(), polygonMovePoint = { x: polygonMoveBox.left + polygonMoveBox.width / 2, y: polygonMoveBox.top + polygonMoveBox.height / 2 };
        check(document.elementFromPoint(polygonMovePoint.x, polygonMovePoint.y) === polygonMove, 'Occupied nearby positions made whole-shape movement unreachable');
        const polygonBefore = JSON.stringify(editor.getState().draft!.shape);
        await touch('start', [{ id: 0, ...polygonMovePoint }]); await touch('move', [{ id: 0, x: polygonMovePoint.x + 20, y: polygonMovePoint.y + 10 }]); await touch('end', []);
        check(JSON.stringify(editor.getState().draft!.shape) !== polygonBefore, 'Fallback move control changed no geometry');
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === polygonBefore, 'Fallback movement split undo history');
        viewport.setCamera({ zoom: viewport.map.getZoom() + .5, bearing: 45 });
        const moveReachable = () => {
          const button = container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]');
          if (!button) return false;
          const box = button.getBoundingClientRect(); return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button;
        };
        await until(moveReachable, 'dense footprint movement remains reachable after zoom and rotation');
        check(window.browserKey, 'Native move-control keyboard bridge unavailable'); const nativeKey = window.browserKey;
        async function keyboardMove() {
          const button = container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]'); check(button, 'Keyboard move target absent');
          const canvas = viewport.map.getCanvas(); canvas.tabIndex = 0; canvas.focus();
          const stops = container.querySelectorAll('button').length + 2;
          for (let step = 0; step < stops && document.activeElement !== button; step++) await nativeKey('Tab');
          check(document.activeElement === button, 'Move control was unreachable by native keyboard navigation');
          const before = JSON.stringify(editor.getState().draft!.shape);
          await nativeKey('ArrowRight');
          check(document.activeElement === button && JSON.stringify(editor.getState().draft!.shape) !== before, 'Keyboard move failed or lost focus during target refresh');
          editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === before, 'Keyboard move split undo history');
        }
        await keyboardMove();
        viewport.setCamera({ center: [0, 0], bearing: 0, pitch: 0 });
        const bounds = viewport.map.getCanvas().getBoundingClientRect(), armX = bounds.width / 2 + 60, armY = bounds.height / 2 + 60;
        const wheelCenter = viewport.map.project([0, 0]);
        const wheel = [[0, -48], [0, -armY], [48, -armY], [48, -48], [48, 0], [armX, 0], [armX, 48], [48, 48], [0, 48], [0, armY], [-48, armY], [-48, 48], [-48, 0], [-armX, 0], [-armX, -48], [-48, -48]] satisfies [number, number][];
        const wheelVertices = wheel.map(([x, y]): [number, number] => {
          const point = viewport.map.unproject([wheelCenter.x + x, wheelCenter.y + y]); return [point.lng, point.lat];
        });
        editor.setShape({ kind: 'polygon', vertices: wheelVertices });
        await until(moveReachable, 'off-screen arms retain the free center movement target');
        const wheelMove = container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]'); check(wheelMove, 'Off-screen-arm move target absent');
        const wheelBox = wheelMove.getBoundingClientRect(), wheelPoint = { x: wheelBox.left + wheelBox.width / 2, y: wheelBox.top + wheelBox.height / 2 };
        await touch('start', [{ id: 0, ...wheelPoint }]); await touch('move', [{ id: 0, x: wheelPoint.x + 20, y: wheelPoint.y + 10 }]); await touch('end', []);
        const shiftedWheel = editor.getState().draft!.shape; check(shiftedWheel.kind === 'polygon', 'Movement changed the pinwheel kind');
        check(shiftedWheel.vertices.every((point, index) => JSON.stringify(point) !== JSON.stringify(wheelVertices[index])), 'Movement edited one vertex of the partially off-screen polygon');
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify({ kind: 'polygon', vertices: wheelVertices }), 'Off-screen-arm movement split undo history');
        await keyboardMove();
        editor.setShape({ kind: 'polygon', vertices: [[0, 0], [0, 0], [0, 0]] });
        await until(moveReachable, 'degenerate coincident handles leave movement reachable');
        await keyboardMove();
      } finally { editor.destroy(); viewport.destroy(); }
    },
  "Drawing upgrades touch survives live updates with atomic drag history": async ({ container, own, until }) => {
      const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {}, elevationSampler: { sample: () => 0 }, entityVisibility: { footprints: false, zones: false, groundLines: false },
        features: [{ type: 'Feature', id: 'live', entity: { altitude: { meters: 100, reference: 'ground' } }, geometry: { type: 'Point', coordinates: [.01, .01] }, properties: {} }] }));
      await viewport.ready;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'touch-line', properties: {} }), submit: () => ({ accepted: true }) });
      let n = 0;
      const timer = setInterval(() => viewport.upsert([{ type: 'Feature', id: 'live', entity: { altitude: { meters: 100, reference: 'ground' } }, geometry: { type: 'Point', coordinates: [.01 + (++n % 10) * 1e-5, .01] }, properties: {} }]), 33);
      try {
        check(window.browserTouch, 'Native CDP touch bridge required');
        const touch = window.browserTouch;
        const pagePoint = (position: [number, number]) => {
          const point = viewport.map.project(position), box = viewport.map.getCanvas().getBoundingClientRect();
          return { x: box.left + point.x, y: box.top + point.y };
        };
        editor.start('line');
        let placedTaps = 0;
        for (let i = 0; i < 5; i++) {
          const before = editor.getState().draft!.placed;
          await touch('start', [{ id: 0, ...pagePoint([-.006 + i * .003, 0]) }]);
          await new Promise(r => setTimeout(r, 40));
          await touch('end', []);
          for (let t = 0; t < 75 && editor.getState().draft!.placed <= before; t++) await new Promise(r => setTimeout(r, 20));
          if (editor.getState().draft!.placed > before) placedTaps++;
          await new Promise(r => setTimeout(r, 400));
        }

        check(placedTaps === 5, `Live updates discarded ${5 - placedTaps} of 5 touch taps`);
        editor.setSnapping(false);
        const original = JSON.stringify(editor.getState().draft!.shape);
        const button = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
        check(button, 'Touch handle missing after placement');
        const trace: string[] = [];
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => trace.push(type));
        const box = button.getBoundingClientRect(), start = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const target = document.elementFromPoint(start.x, start.y);
        check(target && (target === button || button.contains(target)), `Touch handle is covered by ${target?.outerHTML}; pointerEvents=${getComputedStyle(button).pointerEvents}`);
        await touch('start', [{ id: 0, ...start }]);
        await touch('move', [{ id: 0, x: start.x + 20, y: start.y + 12 }]);
        const partial = JSON.stringify(editor.getState().draft!.shape);
        check(partial !== original, `Touch drag did not begin: ${trace.join(',')}; phase=${editor.getState().phase}; shape=${original}; box=${JSON.stringify(box)}`);
        const updatesBefore = n;
        // Elapsed time does not guarantee interval callbacks ran under load.
        // Keep the native contact held until the required live updates occur.
        await until(() => n >= updatesBefore + 2, 'two real entity updates during the held touch drag');
        check(n >= updatesBefore + 2, 'Held touch drag did not overlap real entity updates');
        await touch('move', [{ id: 0, x: start.x + 45, y: start.y + 24 }]);
        await touch('end', []);
        const complete = JSON.stringify(editor.getState().draft!.shape);
        check(complete !== partial, 'Live updates stole the active touch handle drag');
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === original, 'Live touch drag was split into multiple undo entries');
        editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === complete, 'Live touch drag redo lost completed geometry');
      } finally { clearInterval(timer); editor.destroy(); viewport.destroy(); }
    },
  "Drawing upgrades snapping toggles retain native keyboard focus": async ({ container, own, until }) => {
    const viewport = own(createViewport({ container, basemap: style, logger: () => {} }));
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'line', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement("div"), inspector = document.createElement("div");
    document.body.append(tools, inspector);
    const controls = attachDrawingControls(viewport, editor, { tools, inspector });
    try {
      await viewport.ready; editor.start('line');
      check(window.browserClick && window.browserKey, 'Native checkbox keyboard bridge unavailable');
      await window.browserClick('.rl-drawing-snap:has-text("Snapping") input');
      await window.browserKey('Space');
      check(document.activeElement instanceof HTMLInputElement && document.activeElement.closest('.rl-drawing-snap'), 'Snapping rerender lost focus');
      check(editor.getSnapping(), 'Keyboard did not restore snapping');
      await window.browserKey('Tab'); await window.browserKey('Space');
      check(document.activeElement instanceof HTMLInputElement && document.activeElement.checked && editor.getEdgeSnapping(), 'Edge snapping rerender lost usable keyboard focus');
    } finally { controls.destroy(); tools.remove(); inspector.remove(); editor.destroy(); viewport.destroy(); }
  },
  "Drawing upgrades mouse gesture ownership survives live updates and retires on blur": async ({ container, own, until }) => {
    const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 15 }, logger: () => {} }));
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'line', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      await viewport.ready; editor.start('line'); editor.addPoint([-.003, 0]); editor.addPoint([.003, 0]); editor.setSnapping(false);
      check(window.browserMouse && window.browserClick && window.browserReleaseMouseElsewhere, 'Native mouse bridge unavailable');
      const button = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(button, 'Mouse handle absent');
      const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const trace: string[] = [];
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => trace.push(type));
      editor.onChange(() => trace.push(JSON.stringify(editor.getState().draft!.shape)));
      const original = JSON.stringify(editor.getState().draft!.shape);
      let releases = 0;
      viewport.map.on('mouseup', () => { releases++; });
      await window.browserMouse('down', x, y); await window.browserMouse('move', x + 20, y + 10);
      const partial = JSON.stringify(editor.getState().draft!.shape); check(partial !== original, 'Mouse drag never began');
      viewport.upsert([{ type: 'Feature', id: 'live', properties: {}, geometry: { type: 'Point', coordinates: [.01, .01] } }]);
      viewport.setCamera({ bearing: 12 });
      await window.browserMouse('move', x + 40, y + 20);
      const live = JSON.stringify(editor.getState().draft!.shape); check(live !== partial, `Data/camera frames ended the active mouse gesture: ${trace.join(';')}`);
      // Delivered blur is supporting cancellation evidence; handle movement uses native input.
      window.dispatchEvent(new Event('blur'));
      const recoveredHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
      check(recoveredHandle && getComputedStyle(recoveredHandle).pointerEvents !== 'none', 'Retired native marker stayed unclickable until mouseup');
      await window.browserMouse('move', x + 70, y + 30);
      await window.browserReleaseMouseElsewhere();
      check(releases === 0, 'Lost-release fixture delivered a mouseup to the old map');
      check(JSON.stringify(editor.getState().draft!.shape) === live, 'Blur failed to retire the mouse gesture');
      editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === original, 'Mouse interruption split draft history');
      editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === live, 'Mouse interruption redo lost the partial draft');
      const nextHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(nextHandle, 'Recovery handle absent');
      const nextBox = nextHandle.getBoundingClientRect(), nextX = nextBox.left + nextBox.width / 2, nextY = nextBox.top + nextBox.height / 2;
      await window.browserMouse('down', nextX, nextY); await window.browserMouse('move', nextX + 30, nextY + 15);
      await window.browserMouse('up', nextX + 30, nextY + 15);
      const recovered = JSON.stringify(editor.getState().draft!.shape);
      check(recovered !== live, 'Next native handle drag failed after losing the old release');
      editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === live, 'Recovery drag did not keep its own atomic history');
      editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === recovered, 'Recovery drag redo failed');
    } finally { editor.destroy(); viewport.destroy(); }
  },
  "Drawing upgrades numeric validation updates while keyboard focus stays in the field": async ({ container, own, until }) => {
    const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 15 }, logger: () => {} }));
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'polygon', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div'); document.body.append(tools, inspector);
    const controls = attachDrawingControls(viewport, editor, { tools, inspector });
    try {
      await viewport.ready; editor.start('polygon');
      for (const point of [[-.005, -.005], [.005, -.005], [.005, .005], [-.005, .005]] as [number, number][]) editor.addPoint(point);
      editor.finishRing(); editor.startHole();
      for (const point of [[-.002, -.002], [.002, -.002], [.002, .002], [-.002, .002]] as [number, number][]) editor.addPoint(point);
      editor.finishRing();
      check(!editor.getState().validation, 'Numeric validation fixture is invalid');
      check(window.browserFill && window.browserKey && window.browserClick, 'Native field bridge unavailable');
      await window.browserClick('[data-field="Ring"]'); await window.browserKey('ArrowDown'); await window.browserKey('Tab');
      await until(() => inspector.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Hole 1', 'choose the hole segment');
      await window.browserFill('[data-field="Distance (m)"]', '100000'); await window.browserKey('Tab');
      await until(() => Boolean(editor.getState().validation), 'numeric edit creates invalid topology');
      check(document.activeElement instanceof HTMLInputElement && inspector.contains(document.activeElement), 'Numeric edit lost field focus');
      const validation = editor.getState().validation;
      check(inspector.querySelector('.rl-drawing-note')?.textContent === validation, 'Focused numeric edit left textual validation stale');
      await window.browserKey('Tab');
      check(inspector.querySelector('.rl-drawing-note')?.textContent === validation, 'Tab to another input hid textual validation');
      await window.browserClick('[data-field="action:Undo"]');
      check(!editor.getState().validation && !inspector.querySelector('.rl-drawing-note'), 'Numeric undo left stale validation');
    } finally { controls.destroy(); tools.remove(); inspector.remove(); editor.destroy(); viewport.destroy(); }
  },
  "Drawing upgrades snapping uses retained displayed geometry after rejected updates": async ({ container, own, until }) => {
    let fail = false; const diagnostics: string[] = [];
    const line: MapFeature = { type: 'Feature', id: 'edge', properties: {}, geometry: { type: 'LineString', coordinates: [[-.01, 0], [.01, 0]] } };
    const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {},
      style: feature => { if (fail && feature.id === 'edge') throw new Error('Retain the drawn edge'); return {}; }, onError: error => diagnostics.push(error.code) }));

    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'draft', properties: {} }), submit: () => ({ accepted: true }), snapping: { edges: true, vertices: false } });
    try {
      await viewport.ready;
      await until(() => viewport.map.querySourceFeatures('rl:features').some(feature => feature.properties._rl_feature_id === 'edge'), 'published edge baseline');
      fail = true; viewport.upsert([{ ...line, geometry: { type: 'LineString', coordinates: [[-.01, .0005], [.01, .0005]] } }]);
      await until(() => diagnostics.includes('UPDATE_FAILED'), 'rejected edge display update');
      const retained = viewport.map.querySourceFeatures('rl:features').find(feature => feature.properties._rl_feature_id === 'edge');
      check(retained?.geometry.type === 'LineString' && retained.geometry.coordinates[0]?.[1] === 0, 'Renderer did not retain the old drawn edge');
      editor.start('line'); editor.addPoint([-.004, .004]);
      // Correct snap, obsolete snap and no snap must land at distinct positions.
      const target = viewport.map.project([0, .0002]), box = viewport.map.getCanvas().getBoundingClientRect();
      check(window.browserMouse, 'Native snap mouse bridge unavailable'); await window.browserMouse('click', box.left + target.x, box.top + target.y);
      await until(() => editor.getState().draft?.placed === 2, 'snapped point placement');
      const shape = editor.getState().draft!.shape; check(shape.kind === 'line' && Math.abs(shape.vertices[1]![1]) < 1e-8, 'Snapping used an undisplayed accepted edge');
      const accepted = viewport.getFeature('edge'); check(accepted?.geometry.type === 'LineString' && accepted.geometry.coordinates[0]?.[1] === .0005, 'Displayed-target snapping overwrote authoritative data');
    } finally { editor.destroy(); viewport.destroy(); }
  },
  "Drawing upgrades permission interruption preserves a reentrant replacement editor": async ({ container, own, until }) => {
    const accepted: MapFeature = { type: 'Feature', id: 'accepted', properties: {}, geometry: { type: 'LineString', coordinates: [[-.003, .002], [.003, .002]] } };
    const viewport = own(createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 15 }, features: [accepted], logger: () => {} }));
    let allowed = true, armed = false, replacementAllowed = true;
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'draft', properties: {} }), submit: () => ({ accepted: true }), canEdit: () => allowed });
    let replacement: ReturnType<typeof attachDrawing> | undefined;
    const query = () => viewport.queryFeatures([{ x: 0, y: 0 }, { x: container.clientWidth, y: container.clientHeight }]).features.map(feature => feature.id);
    try {
      await viewport.ready; await until(() => query().includes('accepted'), 'accepted line drawn before replacement');
      editor.start('line'); editor.addPoint([-.003, 0]); editor.addPoint([.003, 0]); editor.setSnapping(false);
      editor.onChange(() => {
        if (!armed || editor.getState().phase !== 'forbidden') return;
        armed = false; editor.destroy();
        replacement = attachDrawing(viewport, { createFeature: () => ({ id: 'replacement', properties: {} }), submit: () => ({ accepted: true }), canEdit: () => replacementAllowed });
        replacement.edit('accepted');
        check(!query().includes('accepted'), 'Replacement did not hide its accepted feature');
      });
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(handle && window.browserMouse, 'Native replacement probe handle unavailable');
      const bounds = handle.getBoundingClientRect(), x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
      const before = JSON.stringify(editor.getState().draft!.shape);
      await window.browserMouse('down', x, y); await window.browserMouse('move', x + 25, y + 10);
      check(JSON.stringify(editor.getState().draft!.shape) !== before, 'Reentrant replacement fixture never began a native drag');
      armed = true; allowed = false; editor.refreshPermissions();
      check(replacement?.getState().phase === 'editing' && replacement.getState().draft?.before?.id === 'accepted' && viewport.getInteractionOwner() === 'drawing', 'Replacement failed to acquire drawing ownership');
      check(!query().includes('accepted'), 'Retired outer render cleared replacement editing ownership');
      await window.browserMouse('up', x + 25, y + 10);
      check(!query().includes('accepted'), 'Old mouse release cleared replacement editing ownership');
      replacement.setSnapping(false);
      const next = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(next, 'Replacement handle unavailable');
      const box = next.getBoundingClientRect(), nextX = box.left + box.width / 2, nextY = box.top + box.height / 2;
      const original = JSON.stringify(replacement.getState().draft!.shape);
      await window.browserMouse('down', nextX, nextY); await window.browserMouse('move', nextX + 30, nextY + 15); await window.browserMouse('up', nextX + 30, nextY + 15);
      check(JSON.stringify(replacement.getState().draft!.shape) !== original, 'Replacement could not edit after the old callback returned');
      replacement.undo(); check(JSON.stringify(replacement.getState().draft!.shape) === original, 'Replacement drag lost atomic undo');
      const currentReplacement = replacement;
      let cancelOnInterruption = false;
      currentReplacement.onChange(() => {
        if (cancelOnInterruption && currentReplacement.getState().phase === 'forbidden') {
          cancelOnInterruption = false; currentReplacement.cancel();
        }
      });
      const cancelHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(cancelHandle, 'Cancellation history handle missing');
      const cancelBox = cancelHandle.getBoundingClientRect(), cancelX = cancelBox.left + cancelBox.width / 2, cancelY = cancelBox.top + cancelBox.height / 2;
      await window.browserMouse('down', cancelX, cancelY); await window.browserMouse('move', cancelX + 25, cancelY + 10);
      cancelOnInterruption = true; replacementAllowed = false; currentReplacement.refreshPermissions();
      check(currentReplacement.getState().phase === 'idle' && viewport.getInteractionOwner() === null && viewport.map.doubleClickZoom.isEnabled(), 'Retired render revived a cancelled draft or suppressed native navigation');
      check(!container.querySelector('.rl-drawing-handle'), 'Cancelled draft retained its native handles');
      await window.browserMouse('up', cancelX + 25, cancelY + 10);
    } finally { replacement?.destroy(); editor.destroy(); viewport.destroy(); }
  },
} satisfies BrowserCaseModule;
