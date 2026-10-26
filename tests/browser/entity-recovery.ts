import { createViewport, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature, Viewport } from '@ridgeline/map';
import { style, point, check, pointer, pixelAt, untilPixel } from './helpers';
import type { BrowserCaseModule } from './context';


export const entityRecoveryCases = {
  "Reliability entity null buffer allocation diagnoses once and retry renders only current geometry": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style('#ffffff'), camera: { center: [.001, 0], zoom: 17 },
      style: () => ({ color: '#ff0000', radius: 10 }), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) }));
    await air.ready;
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const createBuffer = gl.createBuffer.bind(gl), addLayer = air.map.addLayer.bind(air.map);
    let failed = false, allocationCalls = 0;
    const obsolete: MapFeature = { ...point('obsolete'), entity: { altitude: { meters: 1, reference: 'ground' } } };
    const accepted: MapFeature = { ...point('current', .002), entity: { altitude: { meters: 1, reference: 'ground' } } };
    let clicked: string[] = [];
    air.on('click', event => { clicked = event.features.map(feature => feature.id); });
    try {
      air.upsert([obsolete]);
      await untilPixel(air, [0, 0], true, 'initial entity');
      air.map.addLayer = (layer, beforeId) => {
        if (layer.id !== 'rl:entities' || failed) return addLayer(layer, beforeId);
        failed = true;
        Object.defineProperty(gl, 'createBuffer', { configurable: true, writable: true, value: () => { allocationCalls++; return null; } });
        try { return addLayer(layer, beforeId); }
        finally { gl.createBuffer = createBuffer; }
      };
      air.configure({ basemap: style('#fffffe') });
      await until(() => failed, 'controlled entity allocation');
      check(allocationCalls === 1, 'Fault did not reach entity allocation: ' + allocationCalls);
      await until(() => errors.some(error => error.context.operation === 'entities' && error.code === 'UPDATE_FAILED'), 'entity allocation diagnostic');
      check(allocationCalls === 1, 'Allocation failure was automatically retried');
      check(errors.some(error => error.context.recoverable && error.cause instanceof Error && /entity.*buffer/i.test(error.cause.message)),
        'Allocation diagnostic lost context or cause');
      air.remove([obsolete.id]); air.upsert([accepted]);
      await until(() => air.getEntityState(accepted.id)?.coverage === 'ready', 'current accepted entity');
      await untilPixel(air, [.002, 0], false, 'failed buffer stays invisible');
      let recoveryAllocations = 0;
      gl.createBuffer = () => { recoveryAllocations++; return createBuffer(); };
      air.retryUpdates();
      await untilPixel(air, [.002, 0], true, 'current geometry after retry');
      clicked = [];
      await pointer('click', air.map.project([.002, 0]));
      check(clicked.includes(accepted.id) && !clicked.includes(obsolete.id), 'Retry restored obsolete or unpickable geometry');
      await untilPixel(air, [0, 0], false, 'removed geometry after retry');
      await new Promise<void>(resolve => { air.map.once('idle', () => resolve()); air.map.triggerRepaint(); });
      const settled = recoveryAllocations;
      await new Promise(resolve => setTimeout(resolve, 200));
      check(recoveryAllocations === settled, 'Idle scene kept allocating');
    } finally { gl.createBuffer = createBuffer; air.map.addLayer = addLayer; air.destroy(); air.destroy(); }
  },
  "Reliability entity date-line rendering and real picking agree across order pan and projection": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style('#ffffff'), projection: 'flat',
      camera: { center: [179, 0], zoom: 6 }, elevationSampler: { sample: () => 30 },
      style: () => ({ color: '#ff0000', radius: 10 }), logger: () => {} }));
    await air.ready;
    const distant: MapFeature = { ...point('distant'), entity: { altitude: { meters: 1000, reference: 'ground' } } };
    const nearby: MapFeature = { ...point('date-line', -179), entity: { altitude: { meters: 1000, reference: 'ground' },
      attachments: [{ id: 'volume', type: 'sphere', radius: 20_000, color: '#ff0000' }] } };
    let picked: string[] = [], attachments: string[] = [];
    air.on('click', event => { picked = event.features.map(feature => feature.id); attachments = event.attachments.map(hit => hit.attachmentId); });
    const nearbyLocation = (): [number, number] => [-179 + Math.round((air.map.getCenter().lng + 179) / 360) * 360, 0];
    const assertShown = async (description: string) => {
      const location = nearbyLocation();
      await untilPixel(air, location, true, description + ' point pixels');
      const pixel = await pixelAt(air, location, 8000, description);
      check(pixel.red > pixel.green + 30 && pixel.red > pixel.blue + 30, description + ' point is not red');
      picked = []; attachments = [];
      await pointer('click', air.map.project(location));
      check(picked.includes(nearby.id), description + ' point cannot be picked at ' + JSON.stringify({ location, screen: air.map.project(location), picked, attachments, projection: air.map.getProjection(), center: air.map.getCenter() }));
      const face: [number, number] = [location[0] + .15, 0];
      await untilPixel(air, face, true, description + ' volume pixels');
      picked = []; attachments = [];
      await pointer('click', air.map.project(face));
      check(picked.includes(nearby.id) && attachments.includes('volume'), description + ' visible volume cannot be picked');
      check(air.getEntityState(nearby.id)?.altitude === 1030, 'Rendering changed physical altitude');
      const accepted = air.getFeature(nearby.id);
      check(accepted?.geometry.type === 'Point' && accepted.geometry.coordinates[0] === -179, 'Rendering rewrote accepted longitude');
    };
    try {
      for (const projection of ['flat', 'globe'] as const) {
        air.configure({ projection });
        for (const reverse of [false, true]) {
          air.remove([distant.id, nearby.id]);
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          air.upsert(reverse ? [nearby, distant] : [distant, nearby]);
          air.map.jumpTo({ center: [179, 0], zoom: 6 });
          await until(() => air.getEntityState(nearby.id)?.placement === 'airborne', projection + ' placement');
          await assertShown(projection + (reverse ? ' reversed' : ' original'));
          air.map.jumpTo({ center: [-179, 0] });
          await assertShown(projection + ' crossed date line');
        }
      }
    } finally { air.destroy(); }
  },
  "Reliability entity raster retry fetches repaired no-data and restores current camera pixels": async caseContext => {
    const { own, container, until } = caseContext;
    const tile = document.createElement('canvas'); tile.width = tile.height = 256;
    const context = tile.getContext('2d')!;
    const prefix = 'https://raster-repair.test/';
    let repaired = false, requests = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(prefix)) return originalFetch(input, init);
      requests++;
      context.clearRect(0, 0, 256, 256);
      context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
      if (!repaired) context.clearRect(125, 125, 6, 6);
      return originalFetch(tile.toDataURL(), init);
    };
    const lng = 0, lat = 0;
    const air = own(createViewport({ container, basemap: style('#ffffff'), camera: { center: [lng, lat], zoom: 16 },
      terrain: false, hillshade: false, logger: () => {}, elevation: {
        tiles: [prefix + '{z}/{x}/{y}.png'], encoding: 'terrarium', minzoom: 0, maxzoom: 0, tileSize: 256,
      } }));

    try {
      await air.ready;
      const feature: MapFeature = { ...point('raster-camera'), entity: { altitude: { meters: 100, reference: 'ground' },
        attachments: [{ id: 'view', type: 'camera', terrainVisibility: true, range: 300, bearing: 0,
          elevation: -90, fovX: 60, fovY: 40, color: '#ff0000', blockedColor: '#ff0000', fillOpacity: 1 }] } };
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'missing raster output');
      const before = requests;
      repaired = true;
      const moved: MapFeature = { ...feature, geometry: { type: 'Point', coordinates: [.0001, 0] } };
      air.upsert([moved]);
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'repaired raster camera');
      check(requests > before, 'Retry never fetched repaired missing-data tile');
      await untilPixel(air, [.0004, .0001], true, 'repaired current camera coverage');
      const pixel = await pixelAt(air, [.0004, .0001], 8000, 'repaired current camera coverage');
      check(pixel.red > pixel.green + 30 && pixel.red > pixel.blue + 30, 'Repaired camera coverage is not visible');
      let clicked = false;
      air.on('click', event => { clicked = event.attachments.some(hit => hit.entityId === feature.id && hit.attachmentId === 'view'); });
      await pointer('click', air.map.project([.0004, .0001]));
      check(clicked, 'Recovered raster camera could not be picked');
      await new Promise<void>(resolve => { air.map.once('idle', () => resolve()); air.map.triggerRepaint(); });
      const settled = requests;
      await new Promise(resolve => setTimeout(resolve, 200));
      check(requests === settled, 'Recovered raster kept fetching while idle');
    } finally { air.destroy(); window.fetch = originalFetch; }
  },
  "Reliability entity sampling failure clears completed plain and terrain coverage and retries current data": async caseContext => {
    const { own, container, until } = caseContext;
    const failure = new Error('Required camera elevation failed');
    let broken = false, samples = 0;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style('#ffffff'), camera: { center: [0, 0], zoom: 16 },
      logger: () => {}, onError: error => errors.push(error), elevationSampler: { sample: lng => {
        samples++;
        if (broken && Math.abs(lng) < .003) throw failure;
        return 0;
      } } }));
    await air.ready;
    const camera: CameraAttachment = { id: 'plain', type: 'camera', range: 300, bearing: 0,
      elevation: -90, fovX: 60, fovY: 40, color: '#ff0000', fillOpacity: .8 };
    const feature: MapFeature = { ...point('calculation'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [camera, { ...camera, id: 'terrain', terrainVisibility: true, bearing: 90 },
        { id: 'zone', type: 'circle', radius: 30, color: '#00aa00' }] } };
    const other: MapFeature = { ...point('unrelated', .004), entity: {
      attachments: [{ id: 'other-zone', type: 'circle', radius: 40, color: '#0000ff' }] } };
    const plainVisible = () => air.map.queryRenderedFeatures(air.map.project([.0002, 0]), { layers: ['rl:entity-ground-fill'] })
      .some(hit => hit.properties.entityId === feature.id && hit.properties.attachmentId === 'plain');
    const maskVisible = () => air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:'));
    const zoneVisible = (id: string, lng: number) => air.map.queryRenderedFeatures(air.map.project([lng, 0]), { layers: ['rl:entity-ground-fill'] })
      .some(hit => hit.properties.entityId === id);
    try {
      air.upsert([feature, other]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready' && plainVisible() && maskVisible(), 'completed cameras');
      broken = true;
      const moved: MapFeature = { ...feature, geometry: { type: 'Point', coordinates: [.0005, 0] } };
      air.upsert([moved]);
      await until(() => errors.some(error => error.cause === failure), 'original sampling diagnostic');
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable' && !plainVisible() && !maskVisible(), 'failed coverage removed');
      check(air.getEntityState(feature.id)?.placement === 'airborne', 'Failure erased valid entity placement');
      check(zoneVisible(feature.id, 0) && zoneVisible(other.id, .004), 'Failure erased unrelated ground geometry');
      const accepted = air.getFeature(feature.id);
      check(accepted?.geometry.type === 'Point' && accepted.geometry.coordinates[0] === .0005, 'Failure changed accepted data');
      broken = false;
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready' && maskVisible() && zoneVisible(feature.id, .0005), 'current coverage recovered');
      await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
      const settled = samples;
      await new Promise(resolve => setTimeout(resolve, 200));
      check(samples === settled, 'Recovered scene kept sampling while idle');
    } finally { air.destroy(); }
  },
  "Raw terrain and the installed renderer agree on nonzero TMS tile templates": async caseContext => {
    const { own, container, until } = caseContext;
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
      air = own(createViewport({ container, basemap: style(), camera: { center: [-45, 40], zoom: 3 }, logger: () => {} }));

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
  },
} satisfies BrowserCaseModule;
