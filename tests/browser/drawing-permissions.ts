import { createViewport, createDrawingSession, attachDrawing, attachDrawingControls, RidgelineError } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import { style, point, check, pointer, browserKey, browserDrag } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingPermissionsCases = {
  "Permission failure during real dragging preserves history and locks a repaired pending save": async caseContext => {
    const { own, container, until } = caseContext;
    const original: MapFeature = { type: 'Feature', id: 'permission-failure-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const diagnostics: RidgelineError[] = [], observed: RidgelineError[] = [];
    const cause = new Error('Injected permission check failure');
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [original], onError: error => diagnostics.push(error), logger: () => {} }));
    await draw.ready;
    draw.on('diagnostic', error => observed.push(error));
    let fail = false, abortAware = false, signal: AbortSignal | undefined;
    let decide: (value: { accepted: true }) => void = () => {};
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-failure', properties: {} }),
      canEdit: () => { if (fail) throw cause; return true; },
      submit: (_change, requestSignal) => { signal = requestSignal; return new Promise((resolve, reject) => {
        decide = resolve;
        if (abortAware) requestSignal.addEventListener('abort', () => reject(new DOMException('Remote request aborted', 'AbortError')), { once: true });
      }); } });
    try {
      editor.edit(original.id);
      const initialShape = JSON.stringify(editor.getState().draft?.shape);
      await until(() => draw.map.loaded(), 'permission failure map ready');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
      if (!handle || !window.browserMouse) throw new Error('Real permission drag bridge missing');
      const box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      await window.browserMouse('down', x, y);
      await window.browserMouse('move', x + 35, y);
      await until(() => JSON.stringify(editor.getState().draft?.shape) !== initialShape, 'permitted drag moved');
      const retained = JSON.stringify(editor.getState().draft);
      fail = true;
      await window.browserMouse('move', x + 50, y);
      editor.refreshPermissions();
      check(editor.getState().phase === 'forbidden' && editor.getState().message?.includes('could not be checked'), 'Permission exception became ordinary denial');
      const lockedHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
      check(lockedHandle?.disabled && !!container.querySelector('.rl-ground-feedback[hidden]'), 'Failed check retained actionable current handle or feedback');
      await window.browserMouse('move', x + 70, y); await window.browserMouse('up', x + 70, y);
      check(JSON.stringify(editor.getState().draft) === retained, 'Permission failure changed retained draft');
      check(diagnostics.length === 1 && observed.length === 1 && diagnostics[0]?.cause === cause &&
        diagnostics[0]?.context.operation === 'drawing.canEdit' && diagnostics[0]?.context.featureId === original.id,
      'Permission failure lost cause/context or repeated reports');
      fail = false; editor.refreshPermissions();
      const recoveredHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]'); if (!recoveredHandle) throw new Error('Permission repair lost the current handle');
      recoveredHandle.focus(); await browserKey('Control+z');
      check(JSON.stringify(editor.getState().draft?.shape) === initialShape, `Failure lost gesture undo: ${JSON.stringify(editor.getState())}`);
      await browserKey('Control+Shift+z');
      check(JSON.stringify(editor.getState().draft) === retained, 'Failure lost gesture redo');
      const pending = editor.finish(); fail = true; editor.refreshPermissions();
      check(signal?.aborted && editor.getState().phase === 'pending', 'Failed pending check did not abort and retain lock');
      fail = false; editor.refreshPermissions();
      const canvas = draw.map.getCanvas(); canvas.tabIndex = 0; canvas.focus();
      await browserKey('Escape');
      check(editor.getState().phase === 'pending' && !!editor.getState().draft, 'Repair or Escape unlocked unsettled save');
      decide({ accepted: true });
      check(await pending === false && JSON.stringify(draw.getFeature(original.id)) === JSON.stringify(original), 'Late save changed accepted data');
      editor.refreshPermissions();
      check(editor.getState().phase === 'editing', 'Settled draft did not recover');
      abortAware = true;
      const aborting = editor.finish(); fail = true; editor.refreshPermissions();
      fail = false; editor.refreshPermissions();
      check(editor.getState().phase === 'pending', 'Repair unlocked abort-aware request before settlement');
      check(await aborting === false && editor.getState().message?.includes('could not be checked') &&
        JSON.stringify(editor.getState().draft) === retained, 'Abort rejection lost permission feedback or draft');
      editor.refreshPermissions();
      await browserKey('Escape');
      check(editor.getState().phase === 'idle' && draw.getInteractionOwner() === null, 'Recovered cancellation retained draft/lease');
      check(diagnostics.length === 1 && observed.length === 1, 'Repair and recurrent failure reset diagnostic bound');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Permission diagnostic observers cancel destroy replace and repair the public drawing attachment": async caseContext => {
    const { own, container } = caseContext;
    for (const action of ['cancel', 'destroy', 'replace', 'repair'] as const) {
      const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, logger: () => {} }));
      await draw.ready;
      let fail = false, nextId = 0, reports = 0;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: `permission-observer-${++nextId}`, properties: {} }),
        canEdit: () => { if (fail) throw new Error('Observer permission failure'); return true; }, submit: () => ({ accepted: true }) });
      const off = draw.on('diagnostic', error => {
        if (error.context.operation !== 'drawing.canEdit') return;
        reports++; editor.getState(); editor.getPreview(); editor.refreshPermissions();
        if (action === 'destroy') editor.destroy();
        else if (action === 'repair') { fail = false; editor.refreshPermissions(); }
        else { editor.cancel(); if (action === 'replace') { fail = false; editor.start('line'); } }
      });
      try {
        editor.start('line');
        await pointer('click', draw.map.project([0, 0]));
        fail = true; editor.refreshPermissions();
        check(reports === 1, `${action} permission observer recursively reported`);
        const state = editor.getState();
        check(state.phase === (action === 'replace' || action === 'repair' ? 'editing' : 'idle'), `${action} permission observer lost current state`);
        if (action === 'replace') {
          check(state.draft?.feature.id === 'permission-observer-2' && state.draft.placed === 0 && editor.getPreview() === undefined,
            'Permission observer placed old data in replacement');
          await pointer('click', draw.map.project([.005, 0]));
          check(editor.getState().draft?.placed === 1, 'Replacement could not place after diagnostic');
        } else if (action === 'repair') {
          await pointer('click', draw.map.project([.005, 0]));
          check(editor.getState().draft?.placed === 2, 'Repaired same draft could not place');
        } else check(!container.querySelector('.rl-drawing-handle') && draw.getInteractionOwner() === null,
          `${action} retained drawing resources`);
      } finally { off(); editor.destroy(); draw.destroy(); }
    }
  },
  "Throwing snap filters exclude candidates bound all diagnostics and recover with stationary input": async caseContext => {
    const { own, container, until } = caseContext;
    const diagnostics: RidgelineError[] = [], events: RidgelineError[] = [], logs: RidgelineError[] = [];
    const cause = new Error('Injected snap filter failure');
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [point('failed-snap', 0), point('healthy-snap', .0006)],
      onError: error => diagnostics.push(error), logger: error => logs.push(error) }));
    await draw.ready; draw.on('diagnostic', error => events.push(error));
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).length >= 2, 'failure snap targets rendered');
    let mode: 'one' | 'all' | 'healthy' | 'deny' = 'one', calls = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'snap-failure-draft', properties: {} }),
      canSnap: feature => { calls++; if (mode === 'all' || mode === 'one' && feature.id === 'failed-snap') throw cause; return mode !== 'deny'; },
      submit: () => ({ accepted: true }) });
    try {
      editor.start('line');
      const anchor = draw.map.project([0, 0]), screen = { x: anchor.x + 3, y: anchor.y };
      await pointer('move', screen);
      const preview = editor.getPreview();
      check(preview?.kind === 'line' && Math.abs(preview.vertices[0]![0] - .0006) < 1e-9, `Throwing closest feature blocked healthy candidate: ${JSON.stringify({ preview, diagnostics: diagnostics.map(e => e.context) })}`);
      check(diagnostics.length === 1 && diagnostics[0]?.cause === cause && diagnostics[0]?.context.featureId === 'failed-snap' &&
        diagnostics[0]?.context.operation === 'drawing.canSnap', 'Snap failure lost cause or context');
      mode = 'all'; editor.setSnapping(true);
      const ground = draw.map.unproject([screen.x, screen.y]);
      const fallback = editor.getPreview();
      check(fallback?.kind === 'line' && Math.abs(fallback.vertices[0]![0] - ground.lng) < 1e-8, 'All failing candidates blocked valid ground');
      for (let i = 0; i < 20; i++) { await pointer('move', { x: screen.x + i % 2, y: screen.y }); editor.setSnapping(true); }
      check(diagnostics.length === 1 && events.length === 1 && logs.length === 1, 'Pointer/settings refresh flooded a diagnostic channel');
      if (!window.browserKeyDown || !window.browserKeyUp) throw new Error('Alt bridge missing');
      await window.browserKeyDown('Alt'); const beforeBypass = calls;
      await pointer('move', screen);
      check(calls === beforeBypass, 'Alt bypass called throwing filter');
      await window.browserKeyUp('Alt');
      mode = 'healthy'; editor.setSnapping(true);
      const repaired = editor.getPreview();
      check(repaired?.kind === 'line' && repaired.vertices[0]?.[0] === 0, 'Stationary refresh did not recover filter');
      await pointer('click', screen);
      const placed = editor.getState().draft?.shape;
      check(placed?.kind === 'line' && placed.vertices[0]?.[0] === 0, 'Repaired click disagreed with preview');
      editor.cancel(); editor.start('line'); mode = 'all'; await pointer('move', screen);
      check(diagnostics.length === 1, 'Replacement reset snap report cooldown');
      await new Promise<void>(resolve => setTimeout(resolve, 200));
      check(diagnostics.length === 1 && events.length === 1, 'Quiet scene generated unbounded diagnostics');
      mode = 'deny'; editor.setSnapping(true);
      check(diagnostics.length === 1, 'Explicit false reported callback failure');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Throwing snap filters preserve real keyboard and handle edits and recover targets": async caseContext => {
    const { own, container, until } = caseContext;
    const original: MapFeature = { type: 'Feature', id: 'snap-edit', properties: {},
      geometry: { type: 'LineString', coordinates: [[.001, 0], [.01, 0]] } };
    const diagnostics: RidgelineError[] = [];
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [original, point('snap-edit-anchor')], onError: error => diagnostics.push(error), logger: () => {} }));
    await draw.ready;
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'edit snap anchor rendered');
    let fail = true;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-snap-edit', properties: {} }),
      canSnap: () => { if (fail) throw new Error('Edit snap filter failed'); return true; }, submit: () => ({ accepted: true }) });
    try {
      editor.edit(original.id);
      const firstHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
      firstHandle.focus();
      const initialShape = JSON.stringify(editor.getState().draft?.shape);
      await browserKey('ArrowLeft');
      const unsnapped = editor.getState().draft?.shape;
      check(unsnapped?.kind === 'line' && Math.abs(unsnapped.vertices[0]![0]) > 1e-8 && JSON.stringify(unsnapped) !== initialShape, 'Failed keyboard snap did not use valid ground');
      await browserKey('Control+z'); fail = false;
      await browserKey('ArrowLeft');
      const repaired = editor.getState().draft?.shape;
      check(repaired?.kind === 'line' && Math.abs(repaired.vertices[0]![0]) < 1e-9, `Keyboard edit did not recover snapping: ${JSON.stringify({ repaired, diagnostics: diagnostics.map(e => e.context) })}`);
      editor.undo(); fail = true;
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      const box = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect(), target = draw.map.project([0, 0]);
      await browserDrag(box.left + box.width / 2, box.top + box.height / 2, canvas.left + target.x + 3, canvas.top + target.y);
      const dragged = editor.getState().draft?.shape;
      check(dragged?.kind === 'line' && dragged.vertices[1]?.[0] !== .01 && dragged.vertices[1]?.[0] !== 0, 'Throwing filter blocked real drag or snapped to failed feature');
      check(JSON.stringify(draw.getFeature(original.id)) === JSON.stringify(original), 'Snap edits changed accepted data');
      check(diagnostics.length === 1, 'Keyboard/drag failure reset snap cooldown');
      editor.cancel(); check(draw.getInteractionOwner() === null, 'Snap failure prevented cancellation');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Snap observers invalidate obsolete candidate iteration and placement across owner and scene changes": async caseContext => {
    const { own, container, until } = caseContext;
    for (const throwing of [false, true]) for (const action of ['cancel', 'destroy', 'replace', 'remove', 'update', 'camera', 'animated-camera', 'fit-bounds', 'settings', 'terrain'] as const) {
      const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
        features: [point('observer-snap-a'), point('observer-snap-b', .0006)], logger: () => {} }));
      await draw.ready;
      await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).length >= 2, 'observer snap candidates rendered');
      let armed = false, acted = false, staleVisits = 0, obsoleteVisits = 0, reports = 0;
      const changeOwner = () => {
        acted = true;
        queueMicrotask(() => { obsoleteVisits = staleVisits; armed = false; });
        if (action === 'destroy') editor.destroy();
        else if (action === 'cancel' || action === 'replace') { editor.cancel(); if (action === 'replace') editor.start('line'); }
        else if (action === 'remove') draw.remove(['observer-snap-a', 'observer-snap-b']);
        else if (action === 'update') draw.upsert([point('observer-snap-a', .02), point('observer-snap-b', .021)]);
        else if (action === 'camera') draw.setCamera({ center: [.02, 0] });
        else if (action === 'animated-camera') draw.setCamera({ center: [.02, 0] }, { duration: 500 });
        else if (action === 'fit-bounds') draw.fitBounds([[.015, -.005], [.025, .005]], { duration: 500 });
        else if (action === 'settings') editor.setSnapping(true);
        else draw.configure({ terrain: true, elevation: { tiles: ['data:image/png;base64,invalid'], maxzoom: 0 } });
      };
      const editor = attachDrawing(draw, { createFeature: () => ({ id: `${action}-${throwing}`, properties: {} }),
        canSnap: () => {
          if (!armed) return true;
          if (acted) { staleVisits++; return true; }
          if (throwing) throw new Error('Observer snap exception');
          changeOwner(); return true;
        }, submit: () => ({ accepted: true }) });
      const off = draw.on('diagnostic', error => {
        if (error.context.operation === 'drawing.canSnap') { reports++; changeOwner(); }
      });
      try {
        editor.start('line');
        const screen = draw.map.project([0, 0]);
        await pointer('move', { x: screen.x + 3, y: screen.y });
        await until(() => draw.map.loaded(), 'observer click scene settled');
        armed = true;
        let stalePlaced = false;
        const offChange = editor.onChange(() => { if (acted && editor.getState().draft?.placed) stalePlaced = true; });
        draw.map.getCanvas().focus();
        if (!window.browserStationaryClick) throw new Error('Stationary click bridge missing');
        await window.browserStationaryClick();
        armed = false; offChange();
        check(acted && !stalePlaced && !editor.getState().draft?.placed, `${action}/${throwing} published obsolete position`);
        check(reports === (throwing ? 1 : 0), `${action} diagnostic count changed`);
        if (action === 'replace') check(editor.getState().draft?.feature.id === `${action}-${throwing}`,
          'Old snap changed replacement draft');
        if (action === 'cancel' || action === 'destroy') check(draw.getInteractionOwner() === null, 'Old snap retained interaction lease');
        if (action === 'terrain') {
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Snap exception bypassed unavailable terrain');
        }
        check(obsoleteVisits === 0, `${action}/${throwing} visited a later obsolete candidate`);
        if (action === 'animated-camera' || action === 'fit-bounds') {
          await until(() => !draw.map.isMoving(), 'observer animation settled');
          await pointer('click', draw.map.project([.02, 0]));
          check(editor.getState().draft?.placed === 1, 'Drawing did not recover after animated camera change');
        }
      } finally { off(); editor.destroy(); draw.destroy(); }
    }
  },
  "Permission failure discovered by native placement and keyboard blocks changes without escaping input": async caseContext => {
    const { own, container } = caseContext;
    const original: MapFeature = { type: 'Feature', id: 'native-permission-existing', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const diagnostics: RidgelineError[] = [];
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [original], onError: error => diagnostics.push(error), logger: () => {} }));
    await draw.ready;
    let fail = false;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'native-permission-created', properties: {} }),
      canEdit: () => { if (fail) throw new Error('Permission failed during native input'); return true; }, submit: () => ({ accepted: true }) });
    try {
      editor.start('line'); await pointer('click', draw.map.project([.003, 0]));
      const beforePlacement = JSON.stringify(editor.getState().draft);
      fail = true;
      await pointer('click', draw.map.project([.008, 0]));
      check(editor.getState().phase === 'forbidden' && JSON.stringify(editor.getState().draft) === beforePlacement,
        'Permission exception during native placement changed geometry');
      fail = false; editor.refreshPermissions(); editor.cancel(); editor.edit(original.id);
      const initial = JSON.stringify(editor.getState().draft);
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      handle.focus(); fail = true; await browserKey('ArrowRight');
      check(editor.getState().phase === 'forbidden' && JSON.stringify(editor.getState().draft) === initial,
        'Permission exception during keyboard input changed geometry');
      fail = false; editor.refreshPermissions(); handle.focus(); await browserKey('ArrowRight');
      check(JSON.stringify(editor.getState().draft) !== initial, 'Repaired keyboard edit did not recover');
      check(diagnostics.length === 1, 'Different native operations bypassed shared permission cooldown');
      check(JSON.stringify(draw.getFeature(original.id)) === JSON.stringify(original), 'Native failure modified accepted feature');
      editor.cancel();
    } finally { editor.destroy(); draw.destroy(); }
  },
  "A snap diagnostic that changes settings restores the surviving dragged marker": async caseContext => {
    const { own, container, until } = caseContext;
    const original: MapFeature = { type: 'Feature', id: 'surviving-snap-drag', properties: {},
      geometry: { type: 'LineString', coordinates: [[.001, 0], [.01, 0]] } };
    const diagnostics: RidgelineError[] = [];
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [original, point('surviving-snap-anchor')], onError: error => diagnostics.push(error), logger: () => {} }));
    await draw.ready;
    await until(() => draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'surviving drag anchor rendered');
    let armed = false;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-surviving', properties: {} }),
      canSnap: () => {
        if (armed) { editor.setSnapping(true); throw new Error('Recursive settings during snap'); }
        return true;
      }, submit: () => ({ accepted: true }) });
    const off = draw.on('diagnostic', error => { if (error.context.operation === 'drawing.canSnap') editor.setSnapping(true); });
    try {
      editor.edit(original.id);
      const initial = JSON.stringify(editor.getState().draft?.shape);
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      if (!window.browserMouse) throw new Error('Native marker bridge missing');
      const box = handle.getBoundingClientRect(), canvas = draw.map.getCanvas().getBoundingClientRect();
      const expected = draw.map.project([.01, 0]);
      const offset = { x: box.left + box.width / 2 - canvas.left - expected.x, y: box.top + box.height / 2 - canvas.top - expected.y };
      const target = draw.map.project([0, 0]);
      await window.browserMouse('down', box.left + box.width / 2, box.top + box.height / 2);
      armed = true;
      await window.browserMouse('move', canvas.left + target.x + 3, canvas.top + target.y);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      check(JSON.stringify(editor.getState().draft?.shape) === initial, 'Obsolete snap drag changed geometry');
      const shown = handle.getBoundingClientRect();
      check(Math.hypot(shown.left + shown.width / 2 - canvas.left - expected.x - offset.x,
        shown.top + shown.height / 2 - canvas.top - expected.y - offset.y) < 2,
      'Obsolete snap resolution left a surviving marker away from its draft');
      check(diagnostics.length === 1, 'Recursive settings flooded snap diagnostics');
      await window.browserMouse('up', canvas.left + target.x + 3, canvas.top + target.y);
      armed = false; editor.setSnapping(true);
      check(editor.getState().phase === 'editing', 'Surviving drag did not remain editable');
    } finally { off(); editor.destroy(); draw.destroy(); }
  },
  "Permission callbacks report failures from replaced owners without changing the new draft": async caseContext => {
    const { own, container } = caseContext;
    for (const action of ['replace', 'destroy'] as const) {
      const diagnostics: RidgelineError[] = [];
      const cause = new Error('Permission callback failed after replacing its owner');
      const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
        onError: error => diagnostics.push(error), logger: () => {} }));
      await draw.ready;
      let armed = false, nextId = 0;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: `self-permission-${++nextId}`, properties: {} }),
        canEdit: () => {
          if (armed) {
            armed = false;
            if (action === 'destroy') editor.destroy();
            else { editor.cancel(); editor.start('line'); }
            throw cause;
          }
          return true;
        }, submit: () => ({ accepted: true }) });
      try {
        editor.start('line'); await pointer('click', draw.map.project([0, 0]));
        armed = true; await pointer('click', draw.map.project([.005, 0]));
        check(draw.getFeature('self-permission-1') === undefined, 'Obsolete permission action changed accepted data');
        if (action === 'replace') {
          check(diagnostics.length === 1 && diagnostics[0]?.cause === cause && diagnostics[0]?.context.featureId === 'self-permission-1' &&
            diagnostics[0]?.context.operation === 'drawing.canEdit', 'Owner replacement swallowed original permission failure');
          const state = editor.getState();
          check(state.phase === 'editing' && state.draft?.feature.id === 'self-permission-2' && state.draft.placed === 0,
            'Old permission failure locked or changed replacement draft');
          await pointer('click', draw.map.project([.008, 0]));
          check(editor.getState().draft?.placed === 1, 'Replacement did not remain usable');
        } else check(diagnostics.length === 0 && draw.getInteractionOwner() === null && !container.querySelector('.rl-drawing-handle'),
          'Destroyed permission owner emitted callbacks or retained input resources');
      } finally { editor.destroy(); draw.destroy(); }
    }
  },
  "Permission callbacks that animate the camera stop native edits and recover after settlement": async caseContext => {
    const { own, container, until } = caseContext;
    for (const invalidation of ['camera', 'data'] as const) for (const input of ['placement', 'keyboard', 'drag'] as const) {
      const original: MapFeature = { type: 'Feature', id: 'permission-camera', properties: {},
        geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
      const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [original], logger: () => {} }));
      await draw.ready;
      const unrelated = point('permission-unrelated', .02);
      let armed = false, acted = false, afterCallback: string | undefined;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'permission-camera-new', properties: {} }),
        canEdit: () => { if (armed) { armed = false; acted = true;
          if (invalidation === 'camera') draw.setCamera({ center: [.02, 0] }, { duration: 500 });
          // A new off-target feature is unrelated to this resolved input.
          else draw.upsert([unrelated]);
          queueMicrotask(() => { afterCallback = JSON.stringify(editor.getState().draft); }); } return true; },
        submit: () => ({ accepted: true }) });
      try {
        if (input === 'placement') { editor.start('line'); await pointer('click', draw.map.project([0, 0])); }
        else editor.edit(original.id);
        await until(() => draw.map.loaded(), 'permission camera input ready');
        const retainedDraft = editor.getState().draft;
        if (retainedDraft?.shape.kind !== 'line') throw new Error('Required permission fixture line missing');
        const retainedFirst = retainedDraft.shape.vertices[0];
        if (!retainedFirst) throw new Error('Required first vertex missing');
        const retained = JSON.stringify(retainedDraft);
        const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
        const expectedScreen = input === 'placement' ? draw.map.project([.005, 0]) : draw.map.project([.01, 0]);
        if (input !== 'placement') expectedScreen.x += input === 'keyboard' ? 10 : 25;
        if (input === 'placement') {
          await pointer('move', draw.map.project([.005, 0]));
          armed = true;
          if (!window.browserStationaryClick) throw new Error('Camera placement bridge missing');
          await window.browserStationaryClick();
        } else if (input === 'keyboard') {
          handle!.focus(); armed = true; await browserKey('ArrowRight');
        } else {
          if (!window.browserMouse) throw new Error('Camera drag bridge missing');
          const box = handle!.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
          await window.browserMouse('down', x, y); armed = true;
          await window.browserMouse('move', x + 25, y); await window.browserMouse('up', x + 25, y);
        }
        const afterInput = JSON.stringify(editor.getState().draft);
        check(acted, `${invalidation}/${input} did not reach its required permission callback`);
        if (invalidation === 'camera') {
          check(afterCallback === retained && afterInput === retained,
            `${invalidation}/${input} changed obsolete input: ${JSON.stringify({ acted, immediate: afterCallback === retained, retained, afterCallback, current: editor.getState().draft })}`);
        } else {
          check(afterCallback !== undefined && afterCallback !== retained && afterInput !== retained && editor.getState().phase === 'editing',
            `${input} discarded valid input or permission after unrelated publication`);
          const shape = editor.getState().draft?.shape;
          if (shape?.kind !== 'line') throw new Error(`${input} lost its line`);
          const vertex = shape.vertices[1];
          if (shape.vertices.length !== 2 || !vertex) throw new Error(`${input} did not edit exactly the intended vertex`);
          check(JSON.stringify(shape.vertices[0]) === JSON.stringify(retainedFirst), `${input} moved another vertex`);
          const actualScreen = draw.map.project(vertex);
          // Native client coordinates round CSS pixels; the physical action
          // independently specifies the endpoint within one CSS pixel per axis.
          check(Math.hypot(actualScreen.x - expectedScreen.x, actualScreen.y - expectedScreen.y) < 1.5,
            `${input} applied a different target: ${JSON.stringify({ expectedScreen, actualScreen })}`);
          const retainedData = JSON.stringify(unrelated);
          check(JSON.stringify(draw.getFeature(unrelated.id)) === retainedData, 'Input lost the consumer publication');
          editor.undo(); check(JSON.stringify(editor.getState().draft) === retained, `${input} split unrelated-update undo history`);
          check(JSON.stringify(draw.getFeature(unrelated.id)) === retainedData, 'Draft undo rolled back consumer data');
          editor.redo(); check(JSON.stringify(editor.getState().draft) === afterInput, `${input} changed unrelated-update redo geometry`);
          check(JSON.stringify(draw.getFeature(unrelated.id)) === retainedData, 'Draft redo changed consumer data');
        }
        await until(() => !draw.map.isMoving(), 'permission camera animation settled');
        if (invalidation === 'camera') check(JSON.stringify(editor.getState().draft) === retained, 'Camera settlement applied abandoned input');
        const beforeNext = JSON.stringify(editor.getState().draft);
        if (input === 'placement') {
          const next = draw.map.project([.025, .003]), candidate = draw.map.project([.02, 0]);
          check(Math.hypot(next.x - candidate.x, next.y - candidate.y) > 12, 'Recovery contact must be outside the unrelated snap footprint');
          await pointer('click', next);
        }
        else {
          const recovered = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
          recovered.focus(); await browserKey('ArrowRight');
        }
        check(JSON.stringify(editor.getState().draft) !== beforeNext, `${invalidation}/${input} failed to recover for the next gesture`);
        editor.undo(); check(JSON.stringify(editor.getState().draft) === beforeNext, `${invalidation}/${input} next gesture was not atomic`);
        check(JSON.stringify(draw.getFeature(original.id)) === JSON.stringify(original), 'Camera permission callback changed accepted data');
      } finally { editor.destroy(); draw.destroy(); }
    }
  },
  "Permission controls handle callback reads refreshes and one-step delete recovery": async caseContext => {
    const { own, container } = caseContext;
    const original: MapFeature = { type: 'Feature', id: 'permission-controls', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const diagnostics: RidgelineError[] = [];
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [original], onError: error => diagnostics.push(error), logger: () => {} }));
    await draw.ready;
    let onCheck = () => {}, failed = true, depth = 0, maxDepth = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused-controls', properties: {} }),
      canEdit: (_feature, operation) => {
        depth++; maxDepth = Math.max(maxDepth, depth);
        try { onCheck(); if (failed && operation === 'delete') throw new Error('Controls delete check failed'); return true; }
        finally { depth--; }
      }, submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    try {
      editor.edit(original.id);
      check(editor.getState().message?.includes('could not be checked') && inspector.textContent?.includes('could not be checked'),
        'Delete permission exception did not reach controls');
      failed = false; editor.refreshPermissions();
      check(editor.getState().phase === 'editing' && !inspector.textContent?.includes('could not be checked'),
        'One permission refresh did not clear controls failure feedback');
      onCheck = () => { editor.getState(); editor.getPreview(); editor.refreshPermissions(); };
      editor.refreshPermissions();
      check(editor.getState().phase === 'editing' && maxDepth === 1 && diagnostics.length === 1,
        'Controls permission callback recursively invoked itself or cached denial');
      onCheck = () => {};
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      handle.focus(); const retained = JSON.stringify(editor.getState().draft);
      await browserKey('ArrowRight');
      check(JSON.stringify(editor.getState().draft) !== retained, 'Permission observer recovery blocked keyboard edit');
    } finally { controls.destroy(); editor.destroy(); tools.remove(); inspector.remove(); draw.destroy(); }
  },
  "Final drawing permission cannot overwrite or revive consumer data": async caseContext => {
    const { own, container } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), logger: () => {} }));

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
  },
} satisfies BrowserCaseModule;
