import { createViewport, attachDrawing, attachDrawingControls } from '@ridgeline/map';
import { style, check, pointer, browserClick } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingOwnershipCases = {
  "Reliability drawing callback ownership and interrupted acquisition": async caseContext => {
    const { own, container } = caseContext;
    for (const action of ['replace', 'destroy', 'conflict', 'permission'] as const) {
      const draw = own(createViewport({ container, basemap: style(), terrain: false,
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
      await draw.ready;
      let armed = false, permitted = true, submissions = 0, nextId = 0;
      const editor = attachDrawing(draw, {
        createFeature: () => ({ id: `owner-${++nextId}`, properties: {} }),
        submit: () => { submissions++; return { accepted: true }; },
        canEdit: () => {
          if (armed && action === 'replace') {
            armed = false;
            editor.cancel(); editor.start('line');
            editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
          }
          return permitted;
        },
      });
      const tools = document.createElement('div'), inspector = document.createElement('div');
      container.after(tools, inspector);
      const controls = attachDrawingControls(draw, editor, { tools, inspector });
      try {
        await browserClick('[data-field="action:Line"]');
        await pointer('click', draw.map.project([0, 0]));
        await pointer('click', draw.map.project([.015, 0]));
        const original = editor.getState().draft?.feature;
        if (!original) throw new Error('Original draft missing');
        editor.onChange(() => {
          if (!armed || action === 'replace' || editor.getState().phase !== 'pending') return;
          armed = false;
          if (action === 'destroy') editor.destroy();
          else if (action === 'conflict') draw.upsert([{ ...original,
            geometry: { type: 'LineString', coordinates: [[0, 0], [.025, 0]] } }]);
          else { permitted = false; editor.refreshPermissions(); }
        });
        armed = true;
        await browserClick('[data-field="action:Finish"]');
        check(!armed, `${action} callback was not exercised`);
        check(submissions === 0, `${action} started obsolete persistence`);
        if (action === 'replace') {
          const draft = editor.getState().draft;
          check(draft?.feature.id === 'owner-2' && draft.shape.kind === 'line' &&
            JSON.stringify(draft.shape.vertices) === JSON.stringify([[0, 0], [.01, 0]]), 'Finish changed replacement draft');
        } else if (action === 'destroy') check(draw.getInteractionOwner() === null, 'Destroyed session retained ownership');
        else check(editor.getState().phase === (action === 'conflict' ? 'conflict' : 'forbidden'), 'Invalidated draft was not retained');
      } finally { controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove(); }
    }
    const draw = own(createViewport({ container, basemap: style(), terrain: false,
      camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'acquisition', properties: {} }),
      submit: () => ({ accepted: true }) });
    const off = draw.on('interactionchange', ({ owner }) => { if (owner === 'drawing') editor.destroy(); });
    editor.start('line'); off();
    check(draw.getInteractionOwner() === null && editor.getState().phase === 'idle', 'Acquisition resurrected destroyed session');
    const remounted = attachDrawing(draw, { createFeature: () => ({ id: 'remounted', properties: {} }),
      submit: () => ({ accepted: true }) });
    try {
      remounted.start('line');
      await pointer('click', draw.map.project([0, 0]));
      await pointer('click', draw.map.project([.01, 0]));
      check(await remounted.finish(), 'Remounted drawing could not finish');
      check(draw.getInteractionOwner() === null && !!draw.getFeature('remounted'), 'Remount did not release ownership after acceptance');
    } finally { remounted.destroy(); draw.destroy(); }
  },
} satisfies BrowserCaseModule;
