import { createViewport, attachInteractions, attachDrawing, shapeGeometry } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import { style, point, check, pointer, browserKey, browserDrag } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingGroundInputCases = {
  "Invalid terrain preserves ground handle edits and keyboard movement": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    dem.getContext('2d')!.fillStyle = 'rgb(100,0,0)';
    dem.getContext('2d')!.fillRect(0, 0, 256, 256);
    const line: MapFeature = { type: 'Feature', id: 'terrain-edit', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 1,
        greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} }));
    await draw.ready;
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
      check(!container.querySelector('.rl-ground-crosshair:not([hidden]), .rl-ground-unavailable:not([hidden])'),
        'Scene replacement retained obsolete gesture feedback');
      check(JSON.stringify(editor.getState().draft?.shape) === lastValid,
        'Terrain loss changed a stationary drag');
      await window.browserMouse('move', x + 80, y + 40);
      check(!container.querySelector('.rl-ground-crosshair:not([hidden]), .rl-ground-unavailable:not([hidden])'), 'Retired drag revived feedback');
      check(JSON.stringify(editor.getState().draft?.shape) === lastValid, 'Invalid drag changed the last valid shape');
      await window.browserMouse('up', x + 80, y + 40);
      const currentHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); if (!currentHandle) throw new Error('Scene replacement lost the current handle');
      currentHandle.focus();
      await browserKey('Shift+ArrowRight');
      await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'new keyboard input resolves unavailable terrain');
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
  },
  "Old keyboard feedback cannot clear a later unavailable click": async caseContext => {
    const { own, container } = caseContext;
    const line: MapFeature = { type: 'Feature', id: 'timer-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: ['/missing-keyboard-dem.png'], encoding: 'custom', redFactor: 1,
        greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} }));
    await draw.ready;
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
  },
  "Ground drawing target follows real pointer placement and clears on sky": async caseContext => {
    const { own, container } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12, pitch: 85 }, logger: () => {} }));
    await draw.ready;
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
  },
  "Navigation and feature hover give way to active ground placement": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('hover-target', .025)], logger: () => {} }));
    await draw.ready;
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
  },
  "Ground feedback respects preview callbacks that cancel, destroy, or replace drawing": async caseContext => {
    const { own, container } = caseContext;
    for (const action of ['cancel', 'destroy', 'replace'] as const) {
      const draw = own(createViewport({ container, basemap: style(), terrain: false,
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
      await draw.ready;
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
  },
  "Ground drawing restores the snapped preview after changing draft style": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 12 }, features: [point('style-snap-anchor', .025)], logger: () => {} }));
    await draw.ready;
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
  },
  "Ground drawing keeps a valid polar target without an unsafe footprint": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), terrain: false, projection: 'globe',
      camera: { center: [0, 85], zoom: 1, pitch: 0 }, logger: () => {} }));
    await draw.ready;
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
  },
} satisfies BrowserCaseModule;
