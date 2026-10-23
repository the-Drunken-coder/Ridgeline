import { createViewport, attachDrawing, attachDrawingControls, shapeGeometry } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import { style, point, check, pointer, browserKey, browserClick, browserDrag } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingEditingCases = {
  "Drawing creates accepted features, owns clicks, edits with keyboard and survives style reload": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center:[0,0], zoom:12 }, logger:()=>{} }));

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
  },
  "Inspector label editing preserves Tab and the first real Finish click": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
    let accepts = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'inspector-finish', properties: {} }), submit: () => { accepts++; return { accepted: true }; } });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.id = 'case25-inspector';
    // Consumer controls sit outside the clipped MapLibre viewport.
    document.body.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      if (!window.browserFill || !window.browserKey || !window.browserClick) throw new Error('Playwright input bridge required');
      await window.browserFill('#case25-inspector [data-field="Label"]', 'First label');
      for (const field of ['Segment', 'Distance (m)', 'Bearing (°)', 'Stroke']) {
        await window.browserKey('Tab');
        check(document.activeElement?.getAttribute('data-field') === field, `Tab skipped the ${field} inspector field`);
      }
      await window.browserFill('#case25-inspector [data-field="Label"]', 'Final label');
      await window.browserClick('#case25-inspector [data-field="action:Finish"]');
      await until(() => Boolean(draw.getFeature('inspector-finish')), 'first Finish click accepted');
      check(accepts === 1 && draw.getFeature('inspector-finish')?.drawing?.style.label === 'Final label', 'Finish lost the label or submitted twice');
    } finally {
      controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
    }
  },
  "Inspector rectangle fields retain consecutive native edits and undo history": async caseContext => {
    const { own, container, until } = caseContext;
    const shape = { kind: 'rectangle' as const, center: [0, 0] as [number, number], width: 100, height: 80, bearing: 0 };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 15 },
      features: [{ type: 'Feature', id: 'rectangle-fields', properties: {}, geometry: shapeGeometry(shape), drawing: { version: 1, shape, style: { color: '#008855', fillColor: '#008855', lineWidth: 2, fillOpacity: .2, dashed: false, label: '' } } }], logger: () => {} }));
    await draw.ready;
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
  },
  "Deleting the focused final vertex keeps keyboard undo reachable": async caseContext => {
    const { own, container } = caseContext;
    const line: MapFeature = { type: 'Feature', id: 'focus-line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} }));
    await draw.ready;
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
  },
  "Undo during a real vertex drag leaves later edits individually undoable": async caseContext => {
    const { own, container, until } = caseContext;
    const line: MapFeature = { type: 'Feature', id: 'gesture-line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} }));
    await draw.ready;
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
  },
  "Rejected submission during a handle drag keeps the next keyboard edit separate": async caseContext => {
    const { own, container, until } = caseContext;
    const line: MapFeature = { type: 'Feature', id: 'submitted-drag', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [line], logger: () => {} }));
    await draw.ready;
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
  },
  "Revoking edit permission during a handle drag clears feedback and restores the handle": async caseContext => {
    const { own, container, until } = caseContext;
    const line: MapFeature = { type: 'Feature', id: 'permission-drag', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 },
      features: [line], logger: () => {} }));
    await draw.ready;
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
      const lockedHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
      if (!lockedHandle) throw new Error('Revoked permission lost the current handle');
      check(lockedHandle.disabled, 'Revoked permission left the current handle enabled');
      check(document.activeElement === draw.map.getCanvas(), 'Retiring a forbidden handle lost the keyboard fallback');
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line') throw new Error('Revoked permission lost the line draft');
      const expected = draw.map.project(shape.vertices[1]!);
      const lockedBox = lockedHandle.getBoundingClientRect();
      check(Math.hypot(lockedBox.left + lockedBox.width / 2 - canvasBox.left - expected.x - markerOffset.x,
        lockedBox.top + lockedBox.height / 2 - canvasBox.top - expected.y - markerOffset.y) < 2,
      'Revoked permission left the handle away from its draft position');
      await window.browserMouse('up', x + 40, y);
      check(JSON.stringify(editor.getState().draft?.shape) === moved, 'Drag changed after permission loss');
      permitted = true;
      editor.refreshPermissions();
      const restoredHandle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
      if (!restoredHandle) throw new Error('Permission recovery lost the current handle');
      check(!restoredHandle.disabled && editor.getState().phase === 'editing', 'Restored permission did not unlock the current handle');
      restoredHandle.focus(); await browserKey('ArrowRight');
      check(JSON.stringify(editor.getState().draft?.shape) !== moved, 'Retiring native mouse state broke the next keyboard edit');
      editor.undo(); check(JSON.stringify(editor.getState().draft?.shape) === moved, 'Recovered keyboard edit joined the interrupted drag');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Ordinary edits preserve dynamic styles, delete-only controls, and hover recovery": async caseContext => {
    const { own, container, until } = caseContext;
    const line: MapFeature = {type:'Feature',id:'line',geometry:{type:'LineString',coordinates:[[-.01,0],[.01,0]]},properties:{closed:false}};
    const draw=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[line,point('hover',.02)],
      style:feature=>({color:feature.properties.closed?'#cc2222':'#008855',dashed:true,lineWidth:2}),logger:()=>{}}));
    await draw.ready;
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
  },
  "Drawing snapping visits only nearby rendered candidates": async caseContext => {
    const { own, container, until } = caseContext;
    const draw=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[point('near',0),point('far',0.04)],logger:()=>{}}));
    await draw.ready;
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
  },
  "Snap callback replacement leaves no stale handle drag behind": async caseContext => {
    const { own, container, until } = caseContext;
    const line: MapFeature = { type: 'Feature', id: 'edited-line', properties: {},
      geometry: { type: 'LineString', coordinates: [[.02, 0], [.03, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [.01, 0], zoom: 13 },
      features: [line, point('snap-replacement-anchor', 0)], logger: () => {} }));
    await draw.ready;
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
  },
  "Stationary Alt toggles visible snap preview and placed vertex": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('eligible', .025), point('filtered', -.025),
        { ...point('airborne', .05), entity: { altitude: { meters: 100, reference: 'sea-level' } } }], logger: () => {} }));
    await draw.ready;
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
  },
} satisfies BrowserCaseModule;
