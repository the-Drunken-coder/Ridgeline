import { createViewport, attachInteractions, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature } from '@ridgeline/map';
import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, ImageSource } from 'maplibre-gl';
import { style, point, check, pointer } from './helpers';
import type { BrowserCaseModule } from './context';


export const entityTerrainCases = {
  "Airborne placement, attachment lifecycle, fallbacks, and globe shaders work through the package": async caseContext => {
    const { own, container, until } = caseContext;
    let missing=false;
    const errors: RidgelineError[]=[];
    const air=own(createViewport({container,basemap:style(),camera:{center:[0,0],zoom:14,pitch:55},elevationSampler:{sample:()=>missing?null:100},logger:()=>{},onError:error=>errors.push(error)}));

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
  },
  "Wireframe-only camera interiors do not intercept clicks": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      camera: { center: [0,0], zoom: 17, pitch: 0 }, logger: () => {} }));
    await air.ready;
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
  },
  "A real click selects a visible camera face clipped by the view": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style('#000000'), elevationSampler: { sample: () => 0 },
      camera: { center: [0, .001], zoom: 18, pitch: 45 }, logger: () => {} }));
    await air.ready;
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
  },
  "Incomplete custom camera terrain settles without polling and retries explicitly": async caseContext => {
    const { own, container, until } = caseContext;
    let samples = 0, available = false;
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => { samples++; return available || (lng === 0 && lat === 0) ? 0 : null; },
    } }));
    await air.ready;
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
  },
  "Custom terrain preparation settles missing data and refreshes the cached patch": async caseContext => {
    const { own, container, until } = caseContext;
    let available = false, finish = () => {}, extent = 0;
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => available || (lng === 0 && lat === 0) ? 0 : null,
      prepare: positions => new Promise<void>(resolve => {
        finish = resolve;
        extent = Math.max(...positions.map(([lng, lat]) => Math.max(Math.abs(lng), Math.abs(lat)) * 111195));
      }),
    } }));
    await air.ready;
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
  },
  "Mixed terrain cameras retain shared preparation for non-camera attachments": async caseContext => {
    const { own, container, until } = caseContext;
    const preparedBounds: [number, number, number, number][] = [];
    const preparationExtents: number[] = [];
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => preparedBounds.some(([west, south, east, north]) =>
        lng >= west && lng <= east && lat >= south && lat <= north) ? 0 : null,
      prepare: async positions => {
        preparationExtents.push(Math.max(...positions.map(([lng, lat]) => Math.max(Math.abs(lng), Math.abs(lat)) * 111195)));
        const longitudes = positions.map(([lng]) => lng), latitudes = positions.map(([, lat]) => lat);
        preparedBounds.push([Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)]);
      },
    } }));
    await air.ready;
    const feature: MapFeature = { ...point('mixed-prepared'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [
      { id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 10 },
      { id: 'zone', type: 'circle', radius: 100 },
    ] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'mixed terrain preparation');
    check(preparationExtents.some(extent => extent > 90), `Shared preparation omitted the non-camera terrain extent: ${preparationExtents}`);
    air.destroy();
  },
  "A ready camera does not hide unavailable ground attachment terrain": async caseContext => {
    const { own, container, until } = caseContext;
    const known = (lng: number, lat: number) => Math.abs(lng) < .00055 && Math.abs(lat) < .00055;
    const air = own(createViewport({ container, basemap: style(), elevationSampler: { sample: (lng, lat) => known(lng, lat) ? 0 : null }, logger: () => {} }));
    await air.ready;
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
  },
  "One failed terrain region does not settle another pending camera": async caseContext => {
    const { own, container, until } = caseContext;
    let secondReady = false;
    let finishSecond: (() => void) | undefined;
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample(lng, lat) {
        if (Math.abs(lat) < 1e-8 && (Math.abs(lng) < 1e-8 || Math.abs(lng - .02) < 1e-8)) return 0;
        return secondReady && Math.abs(lng - .02) < .01 ? 0 : null;
      },
      prepare(positions) {
        if (Math.abs(positions[0]![0]) < .01) return Promise.reject(new Error('First region failed'));
        return new Promise<void>(resolve => { finishSecond = () => { secondReady = true; resolve(); }; });
      },
    } }));
    await air.ready;
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
  },
  "A failed airborne style update retains its last complete display": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style(), camera: { center: [.005, 0], zoom: 15 },
      elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error),
      style: feature => { if (feature.properties.fail) throw new Error('Airborne style failed'); return { color: '#1166aa' }; } }));
    await air.ready;
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
  },
  "Airborne shader creation recovers through retryUpdates": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style('#ffffff'), camera: { center: [0, 0], zoom: 17, pitch: 45 },
      elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error) }));
    await air.ready;
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
  },
  "Custom elevation preparation also covers entities with only plain cameras": async caseContext => {
    const { own, container, until } = caseContext;
    let prepared = false, prepareCalls = 0;
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => prepared ? 0 : null,
      prepare: async () => { prepareCalls++; prepared = true; },
    } }));
    await air.ready;
    const feature: MapFeature = { ...point('plain-prepared'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: false, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'plain camera preparation');
    check(prepareCalls === 1, `Plain camera skipped shared elevation preparation: ${prepareCalls}`);
    check(air.getEntityState(feature.id)?.placement === 'airborne', 'Prepared plain camera remained elevation-unavailable');
    check((air.getEntityState(feature.id)?.footprintTriangles ?? 0) > 0, 'Prepared plain camera has no footprint');
    check(!air.map.getLayer('rl:camera-gpu'), 'Plain camera allocated the GPU visibility renderer');
    air.destroy();
  },
  "A moved airborne camera prepares a missing center while retaining historical coverage": async caseContext => {
    const { own, container, until } = caseContext;
    const movedLng = .00005;
    let centerAvailable = true;
    let prepareCalls = 0;
    let preparedPositions: readonly [number, number][] = [];
    let finishPreparation: (() => void) | undefined;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, logger: () => {}, elevationSampler: {
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
    } }));
    await air.ready;
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
  },
  "Switching to a plain camera during unresolved placement drops terrain coverage": async caseContext => {
    const { own, container, until } = caseContext;
    const missingLng = .0001;
    let resolvePreparation: (() => void) | undefined;
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => Math.abs(lng - missingLng) < 1e-8 && Math.abs(lat) < 1e-8 ? null : 0,
      prepare: async () => new Promise<void>(resolve => { resolvePreparation = resolve; }),
    } }));
    await air.ready;
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
  },
  "No-altitude terrain cameras use prepared ground placement without GPU coverage": async caseContext => {
    const { own, container, until } = caseContext;
    let prepared = false;
    let positions: readonly [number, number][] = [];
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => prepared ? 12 : null,
      prepare: async requested => { positions = requested; prepared = true; },
    } }));
    await air.ready;
    const feature: MapFeature = { ...point('prepared-ground'), entity: { attachments: [{ id: 'camera', type: 'camera',
      terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.ground === 12 && air.getEntityState(feature.id)?.coverage === 'ready', 'prepared ground placement');
    const state = air.getEntityState(feature.id)!;
    check(state.placement === 'ground', `No-altitude entity placement was ${state.placement}`);
    check(positions.some(([lng, lat]) => Math.abs(lng) < 1e-9 && Math.abs(lat) < 1e-9), 'Preparation omitted the entity center');
    check(!air.map.getLayer('rl:camera-gpu'), 'Ground-placed terrain camera allocated GPU coverage');
    air.destroy();
  },
  "Stateful elevation samplers retain their prepare method receiver": async caseContext => {
    const { own, container, until } = caseContext;
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
    const air = own(createViewport({ container, basemap: style(), logger: () => {},
      elevationSampler: new StatefulSampler(), onError: error => errors.push(error) }));
    await air.ready;
    const feature: MapFeature = { ...point('stateful-sampler'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne' && air.getEntityState(feature.id)?.coverage === 'ready', 'stateful sampler camera coverage');
    check(!errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'Stateful sampler preparation failed');
    air.destroy();
  },
  "Hidden terrain cameras still prepare placement elevation after movement": async caseContext => {
    const { own, container, until } = caseContext;
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
    const air = own(createViewport({ container, basemap: style(), logger: () => {},
      entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: sampler }));
    await air.ready;
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
  },
  "Hiding coverage keeps shared placement preparation active": async caseContext => {
    const { own, container, until } = caseContext;
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
    const air = own(createViewport({ container, basemap: style(), logger: () => {}, onError: error => errors.push(error), elevationSampler: sampler }));
    await air.ready;
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
  },
  "Hidden unavailable placement waits for explicit retry after display configuration changes": async caseContext => {
    const { own, container, until } = caseContext;
    let ready = false, recover = false, preparations = 0;
    const air = own(createViewport({ container, basemap: style(), logger: () => {},
      entityVisibility: { footprints: false, zones: false, groundLines: false },
      elevationSampler: { sample: () => ready ? 0 : null, prepare: async () => { preparations++; ready = recover; } } }));
    await air.ready;
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
  },
  "Raw DEM placement and coverage remain physical with terrain off and exaggerated": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(1,0,0)'; context.fillRect(0,0,256,256);
    const air=own(createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:100,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},camera:{center:[0,0],zoom:14,pitch:50},onError:error=>errors.push(error),logger:()=>{}}));
    await air.ready;
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
  },
  "Custom DEM shifts agree with the installed renderer on both sides of zero": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(1,0,0)'; context.fillRect(0, 0, 256, 256);
    for (const [shift, expected] of [[40, 60], [-40, 140]] as const) {
      const air = own(createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0,
          blueFactor: 0, baseShift: shift, maxzoom: 0 }, camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));

      try {
        await air.ready;
        air.upsert([{ ...point(`shift-${shift}`), entity: {} }]);
        await until(() => Math.abs((air.getEntityState(`shift-${shift}`)?.ground ?? NaN) - expected) < .1 &&
          Math.abs((air.map.queryTerrainElevation([0, 0]) ?? NaN) - expected) < .1, `custom shift ${shift} renderer agreement`);
        check(Math.abs(air.getEntityState(`shift-${shift}`)!.ground! - expected) < .1, `Raw custom shift ${shift} disagreed`);
      } finally { air.destroy(); }
    }
  },
  "TileJSON Terrarium metadata decodes flat ground in raw and displayed terrain": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
    const tilejson = { tilejson: '3.0.0', tiles: [dem.toDataURL()], minzoom: 0, maxzoom: 0,
      encoding: 'terrarium', scheme: 'tms' };
    const url = `data:application/json,${encodeURIComponent(JSON.stringify(tilejson))}`;
    const air = own(createViewport({ container, basemap: style(), terrain: true,
      elevation: { url }, camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));

    try {
      await air.ready;
      air.upsert([{ ...point('tilejson-flat'), entity: {} }]);
      await until(() => air.getEntityState('tilejson-flat')?.ground === 0 &&
        Math.abs(air.map.queryTerrainElevation([0, 0]) ?? NaN) < .1, 'TileJSON flat terrain agreement');
      check(air.getEntityState('tilejson-flat')?.ground === 0, 'TileJSON Terrarium raw height was not zero');
    } finally { air.destroy(); }
  },
  "A 50 km camera at latitude 46 settles with bounded raw terrain loading": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(0,0,0)'; context.fillRect(0, 0, 256, 256);
    const air = own(createViewport({ container, basemap: style(),
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 0, greenFactor: 0,
        blueFactor: 0, baseShift: 0, minzoom: 0, maxzoom: 12 },
      camera: { center: [0, 46], zoom: 9 }, logger: () => {} }));

    const feature: MapFeature = { ...point('wide-range'), geometry: { type: 'Point', coordinates: [0, 46] },
      entity: { altitude: { meters: 1000, reference: 'ground' }, attachments: [{ id: 'camera', type: 'camera',
        terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 50_000 }] } };
    try {
      await air.ready;
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', '50 km terrain convergence', 20_000);
      check(air.getEntityState(feature.id)?.coverage === 'ready', 'Wide camera never reached ready');
    } finally { air.destroy(); }
  },
  "Exaggerated terrain keeps sphere and plain camera volume pickable": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(1,0,0)'; context.fillRect(0,0,256,256);
    const air = own(createViewport({ container, basemap: style(), terrain: true, exaggeration: 1,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0,0], zoom: 14, pitch: 60 }, logger: () => {} }));
    await air.ready;
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
  },
  "Visible footprint stays filled when displayed terrain differs slightly from sampled terrain": async caseContext => {
    const { own, container, until } = caseContext;
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(105,0,0)'; context.fillRect(0,0,256,256);
    const air=own(createViewport({container,basemap:style('#000000'),terrain:true,elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:1,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},elevationSampler:{sample:()=>100},camera:{center:[0,0],zoom:17,pitch:0},entityVisibility:{footprints:true,zones:false,groundLines:false},logger:()=>{}}));
    await air.ready;
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
  },
  "Camera overlay remains filled across a hill without testing occlusion": async caseContext => {
    const { own, container, until } = caseContext;
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 20 * Math.exp(-(((lat * meters - 300) / 40) ** 2));
    const air = own(createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: hill }, camera: { center: [0, 310 / meters], zoom: 17, pitch: 0 },
      entityVisibility: { footprints: true, zones: false, groundLines: false }, logger: () => {} }));
    await air.ready;
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
  },
} satisfies BrowserCaseModule;
