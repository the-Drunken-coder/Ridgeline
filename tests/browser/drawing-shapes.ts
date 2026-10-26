import { createViewport, attachDrawing, attachDrawingControls, shapeGeometry, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { style, point, check, pointer, browserKey, browserClick, browserDrag, untilPixel } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingShapesCases = {
  "Real pointer drawing previews stay ephemeral, snap, and place circle and rotated rectangle": async caseContext => {
    const { own, container, until } = caseContext;
    const draw=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[point('preview-anchor',-.025)],logger:()=>{}}));
    await draw.ready;
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
  },
  "Accepted shape definitions survive consumer storage and viewport recreation": async caseContext => {
    const { own, container } = caseContext;
    const first = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await first.ready;
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
    const second = own(createViewport({ container, basemap: style('#f4f4f4'), camera: { center: [0, 0], zoom: 12 }, features: restored, logger: () => {} }));
    await second.ready;
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
  },
  "Rejected drawing remains editable and cancellation preserves accepted data": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
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
  },
  "Vertex dragging moves the draft and restores unchanged snap targets": async caseContext => {
    const { own, container, until } = caseContext;
    const line:MapFeature={type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[.01,0]]}};
    const draw=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:13},features:[line,point('anchor',0)],logger:()=>{}}));
    await draw.ready;
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
  },
  "Whole-shape dragging follows the pointer without snapping to its own vertices": async caseContext => {
    const { own, container, until } = caseContext;
    const shape={kind:'polygon' as const,vertices:[[-.0026,-.0026],[.0026,-.0026],[.0026,.0026],[-.0026,.0026]] as [number,number][]};
    const feature:MapFeature={type:'Feature',id:'moving',geometry:shapeGeometry(shape),properties:{}};
    const draw=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[feature],logger:()=>{}}));
    await draw.ready;
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
  },
  "Drawing attachment cleans up when its preparation diagnostic destroys the viewport": async caseContext => {
    const { own, container } = caseContext;
    const diagnostics: RidgelineError[] = [];
    const draw = own(createViewport({ container, basemap: style(), logger: () => {}, onError: error => {
      diagnostics.push(error);
      if (error.code === 'CALLBACK_FAILED') draw.destroy();
    } }));
    await draw.ready;
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
  },
  "Forwarding viewport wrappers share drawing ownership and allow reattachment": async caseContext => {
    const { own, container } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
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
  },
  "Centered drawing handles keep independent keyboard and drag behavior": async caseContext => {
    const { own, container, until } = caseContext;
    const draw=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:13},logger:()=>{}}));
    await draw.ready;
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
  },
  "Arrowheads follow accepted geometry updates and disappear on deletion": async caseContext => {
    const { own, container, until } = caseContext;
    const arrowShape = { kind:'arrow' as const, vertices:[[-.01,0],[.01,0]] as [number,number][] };
    const arrow:MapFeature = { type:'Feature', id:'arrow', geometry:shapeGeometry(arrowShape), properties:{}, drawing:{version:1,shape:arrowShape,style:{color:'#ff0000',fillColor:'#ff0000',lineWidth:3,fillOpacity:0,dashed:false,label:''}} };
    const draw=own(createViewport({container,basemap:style(),features:[arrow],camera:{center:[0,0],zoom:12},logger:()=>{}}));await draw.ready;
    const heads=()=>draw.map.queryRenderedFeatures({layers:['rl:arrowheads']});
    await until(()=>heads().some(f=>f.properties._rl_feature_id==='arrow'),'initial arrowhead rendered');
    arrow.drawing!.shape={kind:'arrow',vertices:[[0,-.01],[0,.01]]};arrow.geometry=shapeGeometry(arrow.drawing!.shape);draw.upsert([arrow]);
    await until(()=>heads().some(f=>Math.abs(Number(f.properties.bearing))<1),'arrowhead follows direction');
    draw.remove(['arrow']);await until(()=>heads().length===0,'arrowhead removed');draw.destroy();
  },
  "Arrow editing, basemap replacement, failure, cancellation and retry keep shaft and head coherent": async caseContext => {
    const { own, container, until } = caseContext;
    const oldShape = { kind: 'arrow' as const, vertices: [[-.01, 0], [.01, 0]] as [number, number][] };
    const newShape = { kind: 'arrow' as const, vertices: [[-.01, .02], [.01, .02]] as [number, number][] };
    const arrow: MapFeature = { type: 'Feature', id: 'coherent-arrow', properties: {}, geometry: shapeGeometry(oldShape),
      drawing: { version: 1, shape: oldShape, style: { color: '#ff0000', fillColor: '#ff0000', lineWidth: 3,
        fillOpacity: 0, dashed: false, label: '' } } };
    const errors: RidgelineError[] = [];
    let fail = false;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, .01], zoom: 12 },
      features: [arrow, point('arrow-neighbor', -.04)], style: feature => {
        if (feature.id === arrow.id && fail) throw new Error('Arrow styling failed');
        return { color: '#008855' };
      }, logger: () => {}, onError: error => errors.push(error) }));
    await draw.ready;
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
  },
} satisfies BrowserCaseModule;
