import { createViewport, attachDrawing } from '@ridgeline/map';
import { style, point, check, pointer } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingGroundDemCases = {
  "Ground drawing uses loaded ridge, zero, and negative DEM cells and rejects missing DEM": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    context.fillStyle = 'rgb(240,0,0)'; context.fillRect(0, 100, 256, 42);
    context.fillStyle = 'rgb(40,0,0)'; context.fillRect(0, 180, 256, 76);
    const latitude = (pixel: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * pixel / 256))) * 180 / Math.PI;
    const fixture = [
      { name: 'ridge', latitude: latitude(120), expected: 140 },
      { name: 'zero', latitude: latitude(60), expected: 0 },
      { name: 'negative', latitude: latitude(210), expected: -60 },
    ];
    const terrainErrors: string[] = [];
    const draw = own(createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
      camera: { center: [0.04, latitude(120)], zoom: 12, pitch: 55 }, onError: error => terrainErrors.push(error.message), logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'dem-drawing', properties: {} }), submit: () => ({ accepted: true }) });
    editor.start('line');
    for (const sample of fixture) {
      draw.setCamera({ center: [0, sample.name === 'ridge' ? latitude(110) : sample.latitude],
        zoom: sample.name === 'ridge' ? 3 : 12, pitch: 55 });
      const geographic: [number, number] = [0.04, sample.latitude];
      await until(() => Math.abs((draw.map.queryTerrainElevation(geographic) ?? NaN) - sample.expected) < 1,
        `${sample.name} DEM fixture loaded`).catch(() => { throw new Error(`${sample.name} elevation is ${draw.map.queryTerrainElevation(geographic)}; ${terrainErrors.join('; ')}`); });
      const screen = draw.map.project(geographic);
      check(screen.x >= 0 && screen.y >= 0 && screen.x < container.clientWidth && screen.y < container.clientHeight,
        `${sample.name} fixture is outside viewport`);
      await pointer('move', screen);
      const crosshair = container.querySelector<SVGPathElement>('.rl-ground-crosshair')!;
      check(!crosshair.hasAttribute('hidden'), `${sample.name} target is unavailable`);
      const bounds = crosshair.getBBox();
      const shown = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await pointer('click', screen);
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line') throw new Error('Line draft disappeared');
      const committed = shape.vertices.at(-1)!;
      const placed = draw.map.project(committed);
      check(Math.hypot(placed.x - shown.x, placed.y - shown.y) < 2, `${sample.name} preview and placement differ`);
      check(sample.name === 'ridge'
        ? committed[1] <= latitude(100) && committed[1] >= latitude(142)
        : Math.abs(committed[1] - sample.latitude) < 0.003,
      `${sample.name} chose a different ground region: ${committed[1]} versus ${sample.latitude}`);
      check(Math.abs((draw.map.queryTerrainElevation(committed) ?? NaN) - sample.expected) < 1,
        `${sample.name} was placed on another elevation region`);
    }
    draw.configure({ projection: 'globe' });
    draw.setCamera({ center: [0, latitude(120)], zoom: 3, pitch: 45 });
    const globeGeographic: [number, number] = [15, latitude(120)];
    await until(() => Math.abs((draw.map.queryTerrainElevation(globeGeographic) ?? NaN) - 140) < 1,
      'globe ridge DEM loaded');
    const globeTarget = draw.map.project(globeGeographic);
    check(globeTarget.x >= 0 && globeTarget.y >= 0 && globeTarget.x < container.clientWidth && globeTarget.y < container.clientHeight,
      `Globe ridge target outside viewport: ${globeTarget.x}, ${globeTarget.y}`);
    await pointer('move', globeTarget);
    check(!container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'Globe terrain target is unavailable');
    check(!container.querySelector('.rl-ground-footprint')?.hasAttribute('hidden'), 'Globe terrain footprint is unavailable');
    await pointer('click', globeTarget);
    const globeShape = editor.getState().draft?.shape;
    check(globeShape?.kind === 'line' && globeShape.vertices.length === 4, 'Globe terrain click did not place a point');
    editor.cancel();
    draw.configure({ projection: 'flat' });
    for (const sample of fixture.filter(sample => sample.expected !== 0)) {
      const anchor: [number, number] = [0, sample.latitude];
      const id = `${sample.name}-snap-anchor`;
      draw.upsert([{ type: 'Feature', id, geometry: { type: 'Point', coordinates: anchor }, properties: {} }]);
      draw.setCamera({ center: anchor, zoom: 12, pitch: 55 });
      await until(() => Math.abs((draw.map.queryTerrainElevation(anchor) ?? NaN) - sample.expected) < 1 &&
        draw.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(feature => feature.properties._rl_feature_id === id),
      `${sample.name} snap anchor rendered on loaded terrain`);
      editor.start('line');
      const projected = draw.map.project(anchor);
      const near = { x: projected.x + 6, y: projected.y };
      await pointer('move', near);
      const preview = editor.getPreview();
      check(preview?.kind === 'line' && JSON.stringify(preview.vertices[0]) === JSON.stringify(anchor),
        `${sample.name} elevated anchor did not snap in preview`);
      await pointer('click', near);
      const placed = editor.getState().draft?.shape;
      check(placed?.kind === 'line' && JSON.stringify(placed.vertices[0]) === JSON.stringify(anchor),
        `${sample.name} elevated anchor was not copied exactly`);
      editor.cancel();
    }
    editor.destroy(); draw.destroy();

    const missing = own(createViewport({ container, basemap: style(), terrain: false,
      elevation: { tiles: ['/missing-ground-target-dem.png'], encoding: 'custom', redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await missing.ready;
    const blocked = attachDrawing(missing, { createFeature: () => ({ id: 'missing-dem', properties: {} }), submit: () => ({ accepted: true }) });
    blocked.start('line');
    const center = missing.map.project([0, 0]);
    await pointer('move', center);
    const initialPreview = blocked.getPreview();
    check(initialPreview?.kind === 'line' && initialPreview.vertices.length === 1, 'Valid base surface had no preview');
    missing.configure({ terrain: true });
    await pointer('click', center);
    check(blocked.getState().draft?.placed === 0 && blocked.getPreview() === undefined,
      'An unavailable click retained the old ground preview');
    await pointer('move', center);
    check(container.querySelector('.rl-ground-crosshair')?.hasAttribute('hidden'), 'Missing DEM showed a valid target');
    blocked.destroy();
    const withoutVisuals = attachDrawing(missing, { visualFeedback: false,
      createFeature: () => ({ id: 'missing-dem-no-visual', properties: {} }), submit: () => ({ accepted: true }) });
    withoutVisuals.start('line');
    await pointer('click', center);
    check(withoutVisuals.getState().draft?.placed === 0, 'Visual opt-out accepted missing DEM');
    withoutVisuals.destroy(); missing.destroy();
  },
  "Ground drawing chooses a foreground ridge over terrain behind it": async caseContext => {
    const { own, container, until } = caseContext;
    // An exaggerated synthetic ridge makes a foreground hit distinct from the flat terrain behind it.
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    context.fillStyle = 'rgb(240,0,0)'; context.fillRect(0, 112, 256, 16);
    const latitude = (pixel: number) => Math.atan(Math.sinh(Math.PI *
      (1 - 2 * (128 + pixel / 256) / 256))) * 180 / Math.PI;
    const behind: [number, number] = [0.04, latitude(90)];
    const ridge: [number, number] = [0.04, latitude(120)];
    const draw = own(createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0,
        blueFactor: 0, baseShift: 10000, minzoom: 8, maxzoom: 8 },
      camera: { center: [0.04, latitude(155)], zoom: 10, pitch: 75 },
      features: [{ type: 'Feature', id: 'occluded-snap', properties: { name: 'Behind ridge' },
        geometry: { type: 'Point', coordinates: behind } }], logger: () => {} }));
    await draw.ready;
    await until(() => Math.abs((draw.map.queryTerrainElevation(ridge) ?? NaN) - 14000) < 1 &&
      Math.abs(draw.map.queryTerrainElevation(behind) ?? NaN) < 1, 'foreground and rear DEM loaded');
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'ridge-depth', properties: {} }), submit: () => ({ accepted: true }) });
    editor.start('line');
    const rearScreen = draw.map.project(behind);
    check(rearScreen.x >= 0 && rearScreen.y >= 0 && rearScreen.x < container.clientWidth && rearScreen.y < container.clientHeight,
      `Rear terrain is outside viewport: ${rearScreen.x}, ${rearScreen.y}`);
    await pointer('move', rearScreen);
    const preview = editor.getPreview();
    check(preview?.kind === 'line' && preview.vertices[0]?.[1] !== behind[1],
      'Occluded vertex replaced the visible terrain target');
    const crosshair = container.querySelector<SVGPathElement>('.rl-ground-crosshair');
    if (!crosshair || crosshair.hasAttribute('hidden')) throw new Error('Foreground ridge target did not appear');
    const bounds = crosshair.getBBox();
    const shown = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await pointer('click', rearScreen);
    const shape = editor.getState().draft?.shape;
    if (shape?.kind !== 'line' || shape.vertices.length !== 1) throw new Error(`Foreground target did not place: ${JSON.stringify(shape)}`);
    const placed = shape.vertices[0]!;
    check(placed[1] <= latitude(112) + 0.001 && placed[1] >= latitude(128) - 0.001,
      `Behind-terrain fallback won over ridge: ${placed[1]} versus ridge ${latitude(112)} to ${latitude(128)}`);
    check((draw.map.queryTerrainElevation(placed) ?? 0) > 1000,
      `Foreground placement height ${draw.map.queryTerrainElevation(placed)} at ${placed[1]}`);
    const placedScreen = draw.map.project(placed);
    check(Math.hypot(placedScreen.x - shown.x, placedScreen.y - shown.y) < 2,
      'Foreground preview and placement differ');
    editor.destroy(); draw.destroy();
  },
} satisfies BrowserCaseModule;
