import { createViewport, attachDrawing, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { addProtocol, removeProtocol } from 'maplibre-gl';
import { style, point, check, pointer, browserKey, browserDrag } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingGroundRecoveryCases = {
  "Ground drawing recovers beneath a stationary pointer and settles without idle work": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `ground-recovery-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    addProtocol(protocol, async () => {
      requested = true;
      await gate;
      return { data: data.slice(0) };
    });
    try {
      const draw = own(createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom', redFactor: 1,
          greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));

      try {
        await draw.ready;
        const editor = attachDrawing(draw, { createFeature: () => ({ id: 'stationary-target', properties: {} }),
          submit: () => ({ accepted: true }) });
        try {
          editor.start('line');
          await pointer('move', draw.map.project([0, 0]));
          await until(() => requested, 'delayed DEM request');
          check(editor.getPreview() === undefined, 'Unloaded DEM produced a draft preview');
          check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'Unloaded DEM did not show unavailable feedback');
          let idle = false, renders = 0, previews = 0;
          const onRender = () => { idle = false; renders++; };
          const onIdle = () => { idle = true; };
          draw.map.on('render', onRender);
          draw.map.on('idle', onIdle);
          const offPreview = editor.onPreview(() => { previews++; });
          try {
            release();
            let phase = 'native DEM readiness';
            try {
              // Software-rendered terrain can still be compiling after the
              // held response settles. Separate readiness from the idle bound.
              await until(() => draw.map.queryTerrainElevation([0, 0]) === 0, phase, 20_000);
              phase = 'stationary preview and crosshair recovery';
              await until(() => {
                const preview = editor.getPreview();
                return preview?.kind === 'line' && preview.vertices.length === 1 &&
                  !!container.querySelector('.rl-ground-crosshair:not([hidden])');
              }, phase);
              phase = 'recovered renderer idle';
              await until(() => idle, phase);
              phase = 'consistent recovered state';
              const preview = editor.getPreview();
              check(idle && preview?.kind === 'line' && preview.vertices.length === 1 &&
                draw.map.queryTerrainElevation([0, 0]) === 0 &&
                !!container.querySelector('.rl-ground-crosshair:not([hidden])'),
                'Recovered terrain, preview, crosshair and idle state do not agree');
            } catch (cause) {
              throw new Error(`Stationary recovery state: ${JSON.stringify({ phase, idle, renders, previews,
                preview: editor.getPreview(), terrain: draw.map.queryTerrainElevation([0, 0]),
                crosshair: !!container.querySelector('.rl-ground-crosshair:not([hidden])'),
                moving: draw.map.isMoving(), loaded: draw.map.areTilesLoaded() })}`, { cause });
            }
            check(renders > 0 && previews > 0, 'Terrain recovery did not publish a fresh preview');
            check(editor.getState().draft?.placed === 0, 'Terrain recovery placed a draft point');
            const settledRenders = renders, settledPreviews = previews;
            // Observe the settled map without pointer input or scheduling renderer work.
            await new Promise<void>(resolve => setTimeout(resolve, 500));
            check(renders === settledRenders && previews === settledPreviews,
              `Idle target kept updating: ${renders - settledRenders} renders, ${previews - settledPreviews} previews`);
          } finally {
            offPreview();
            draw.map.off('render', onRender);
            draw.map.off('idle', onIdle);
          }
        } finally { editor.destroy(); }
      } finally { draw.destroy(); }
    } finally {
      release();
      removeProtocol(protocol);
    }
  },
  "Failed and replaced elevation retire a stationary target until new terrain loads": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const first = `ground-first-${crypto.randomUUID()}`;
    const failed = `ground-failed-${crypto.randomUUID()}`;
    const replacement = `ground-replacement-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    let failedRequest = false;
    addProtocol(first, async () => ({ data: data.slice(0) }));
    addProtocol(failed, async () => {
      failedRequest = true;
      throw new Error('Synthetic elevation failure');
    });
    addProtocol(replacement, async () => {
      requested = true;
      await gate;
      return { data: data.slice(0) };
    });
    const elevation = (protocol: string) => ({ tiles: [`${protocol}://dem/{z}/{x}/{y}.png`],
      encoding: 'custom' as const, redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 });
    try {
      const draw = own(createViewport({ container, basemap: style(), terrain: true, elevation: elevation(first),
        camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));

      const errors: RidgelineError[] = [];
      const offDiagnostic = draw.on('diagnostic', error => errors.push(error));
      try {
        await draw.ready;
        const editor = attachDrawing(draw, { createFeature: () => ({ id: 'replacement-line', properties: {} }),
          submit: () => ({ accepted: true }) });
        try {
          editor.start('line');
          const screen = draw.map.project([0, 0]);
          await pointer('move', screen);
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'initial terrain target');
          draw.configure({ elevation: elevation(failed) });
          check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Failed source replacement retained old target');
          await until(() => failedRequest && errors.some(error => error.code === 'ELEVATION_UNAVAILABLE' &&
            error.context.sourceId === 'rl:terrain'), 'failed DEM diagnostic');
          await until(() => !!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'failed terrain unavailable feedback');
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Failed terrain permitted placement');
          draw.configure({ elevation: elevation(replacement) });
          check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Old terrain target remained after replacement');
          await until(() => requested, 'replacement DEM request');
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Loading replacement terrain permitted placement');
          check(!!container.querySelector('.rl-ground-unavailable:not([hidden])'), 'Loading replacement terrain lacked unavailable feedback');
          release();
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'replacement terrain target');
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 1, 'Recovered terrain did not permit placement');
        } finally { editor.destroy(); }
      } finally { offDiagnostic(); draw.destroy(); }
    } finally {
      release();
      removeProtocol(first);
      removeProtocol(failed);
      removeProtocol(replacement);
    }
  },
  "Stationary placement follows camera, projection, resize, and style replacement": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 5 }, logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'scene-line', properties: {} }),
      submit: () => ({ accepted: true }) });
    const screen = { x: 320, y: 180 };
    const preview = () => {
      const shape = editor.getPreview();
      return shape?.kind === 'line' ? shape.vertices[0] : undefined;
    };
    const agrees = () => {
      const vertex = preview();
      if (!vertex) return false;
      const displayed = draw.map.project(vertex);
      return Math.hypot(displayed.x - screen.x, displayed.y - screen.y) < 2;
    };
    try {
      editor.start('line');
      await pointer('move', screen);
      await until(agrees, 'initial stationary placement');
      draw.setCamera({ center: [10, 5], zoom: 5, bearing: 25, pitch: 40 });
      await until(() => agrees() && Math.abs(preview()?.[0] ?? 0) > 5, 'camera refresh at stationary pointer');
      const moved = preview()!;
      draw.configure({ projection: 'globe' });
      await until(() => draw.map.getProjection()?.type === 'globe' && agrees(), 'globe stationary placement');
      check(Math.hypot(preview()![0] - moved[0], preview()![1] - moved[1]) < 5,
        'Projection transition selected a distant region');
      container.style.width = '700px';
      await until(() => draw.map.getCanvas().clientWidth === 700 && agrees() &&
        Math.abs(preview()![0] - moved[0]) > .01, 'resized stationary placement');
      draw.configure({ basemap: style('#e2e8e4') });
      check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Style replacement retained an old target');
      await until(() => draw.map.getLayer('rl:draft-line') !== undefined && agrees() &&
        !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'style replacement target recovery');
      await pointer('click', screen);
      const shape = editor.getState().draft?.shape;
      if (shape?.kind !== 'line' || shape.vertices.length !== 1) throw new Error('Scene click did not place one vertex');
      const placed = draw.map.project(shape.vertices[0]!);
      check(Math.hypot(placed.x - screen.x, placed.y - screen.y) < 2, 'Scene click disagrees with target');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Style replacement keeps a ground edit and releases its handles on destruction": async caseContext => {
    const { own, container, until } = caseContext;
    const feature: MapFeature = { type: 'Feature', id: 'scene-edit', properties: {},
      geometry: { type: 'LineString', coordinates: [[-.01, 0], [.01, 0]] } };
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [feature], logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }),
      submit: () => ({ accepted: true }) });
    try {
      editor.edit('scene-edit');
      await until(() => !!container.querySelector('[aria-label="Vertex 1"]'), 'initial edit handle');
      draw.configure({ basemap: style('#dce9e2') });
      await until(() => draw.map.getLayer('rl:draft-line') !== undefined &&
        !!container.querySelector('[aria-label="Vertex 1"]'), 'edit handle after style replacement');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
      handle.focus();
      await browserKey('ArrowRight');
      const shape = editor.getState().draft?.shape;
      check(shape?.kind === 'line' && shape.vertices[0]![0] > -.01,
        'Edit handle did not use the replacement scene');
      check(draw.getFeature('scene-edit')?.geometry.type === 'LineString', 'Draft edit mutated accepted geometry');
      draw.destroy();
      check(!container.querySelector('.rl-ground-feedback,.rl-drawing-handle'), 'Viewport destruction retained edit feedback or handles');
      editor.destroy();
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Date-line ground placement follows displayed exaggeration on flat and globe": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(200,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `ground-dateline-${crypto.randomUUID()}`;
    let holdReload = false, reloadRequested = false;
    let releaseReload = () => {};
    const reloadGate = new Promise<void>(resolve => { releaseReload = resolve; });
    addProtocol(protocol, async () => {
      if (holdReload) { reloadRequested = true; await reloadGate; }
      return { data: data.slice(0) };
    });
    const known: [number, number] = [179.8, 0];
    try {
      const draw = own(createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom',
          redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 },
        camera: { center: known, zoom: 7, pitch: 50 }, logger: () => {} }));
      await draw.ready;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'dateline-line', properties: {} }),
        submit: () => ({ accepted: true }) });
      try {
        editor.start('line');
        editor.setSnapping(false);
        for (const projection of ['flat', 'globe'] as const) {
          let firstLatitude: number | undefined;
          for (const exaggeration of [1, 2]) {
            let liveUpdates = 0;
            const liveTimer = projection === 'flat' && exaggeration === 2 ? setInterval(() => {
              draw.upsert([point('unrelated-live', 170 + (++liveUpdates % 100) * .0001)]);
            }, 16) : undefined;
            try {
            holdReload = projection === 'globe' && exaggeration === 1;
            draw.configure({ projection, exaggeration });
            const screen = { x: 320, y: 180 };
            await pointer('move', screen);
            type TerrainReadinessObservation = ReturnType<typeof readiness>;
            const readiness = () => ({ projection: draw.map.getProjection()?.type,
              terrainLoaded: draw.map.isSourceLoaded('rl:terrain'), elevation: draw.map.queryTerrainElevation(known),
              terrain: draw.map.getTerrain(), center: draw.map.getCenter().toArray(), moving: draw.map.isMoving(),
              loaded: draw.map.loaded(), liveUpdates, reloadRequested, preview: editor.getPreview(),
              crosshair: !!container.querySelector('.rl-ground-crosshair:not([hidden])') });
            let observed: TerrainReadinessObservation = readiness();
            try {
              await until(() => {
                observed = readiness();
                return (!liveTimer || observed.liveUpdates >= 2) && (!holdReload || observed.reloadRequested) &&
                  observed.projection === (projection === 'flat' ? 'mercator' : 'globe') &&
                  observed.terrain?.exaggeration === exaggeration && observed.preview?.kind === 'line' && observed.crosshair &&
                  Math.abs((observed.elevation ?? NaN) - 100 * exaggeration) < 1;
              }, `${projection} terrain at exaggeration ${exaggeration}`);
            } catch (cause) {
              throw new Error(`Date-line terrain readiness: ${JSON.stringify({ expected: { projection, exaggeration, elevation: 100 * exaggeration }, observed })}`, { cause });
            }
            await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'),
              `${projection} ground target at exaggeration ${exaggeration}`);
            const shape = editor.getPreview();
            if (shape?.kind !== 'line') throw new Error('Missing date-line preview');
            const placed = shape.vertices.at(-1)!;
            const longitudeDifference = ((placed[0] - known[0] + 540) % 360) - 180;
            check(Math.abs(longitudeDifference) < .001 && Math.abs(placed[1] - known[1]) < .1,
              `${projection} exaggeration ${exaggeration} changed stored geography: ${placed}`);
            if (firstLatitude === undefined) firstLatitude = placed[1];
            else check(Math.abs(placed[1] - firstLatitude) < .002,
              `${projection} uniform terrain shifted geographic placement under exaggeration: ${firstLatitude}, ${placed[1]}`);
            if (holdReload) {
              check(!observed.terrainLoaded, 'Globe target did not exercise a pending DEM reload');
              holdReload = false;
              releaseReload();
            }
            } finally { clearInterval(liveTimer); }
          }
        }
        await pointer('click', { x: 320, y: 180 });
        check(editor.getState().draft?.placed === 1, 'Date-line scene did not place the current target');
      } finally { editor.destroy(); draw.destroy(); }
    } finally { releaseReload(); removeProtocol(protocol); }
  },
  "Stationary target resumes after permission and submission changes": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
    let permitted = true;
    let reject!: (value: { accepted: false; reason: string }) => void;
    const decision = new Promise<{ accepted: false; reason: string }>(resolve => { reject = resolve; });
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'permission-line', properties: {} }),
      canEdit: () => permitted, submit: () => decision });
    const marker = () => !!container.querySelector('.rl-ground-crosshair:not([hidden])');
    try {
      editor.start('line');
      const center = draw.map.project([0, 0]);
      await pointer('move', center);
      await until(marker, 'initial placement target');
      await pointer('click', center);
      await pointer('move', { x: center.x + 80, y: center.y });
      permitted = false;
      editor.refreshPermissions();
      check(!marker(), 'Permission loss retained actionable feedback');
      permitted = true;
      editor.refreshPermissions();
      await until(marker, 'target after permission restoration');
      await pointer('click', { x: center.x + 80, y: center.y });
      await pointer('move', { x: center.x + 150, y: center.y });
      await until(marker, 'target before submission');
      const pending = editor.finish();
      check(editor.getState().phase === 'pending' && !marker(), 'Pending submission retained actionable feedback');
      reject({ accepted: false, reason: 'Try again' });
      check(await pending === false, 'Rejected submission was accepted');
      await until(marker, 'target after rejection without pointer movement');
      check(editor.getState().draft?.placed === 2, 'Submission transition changed draft points');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Drawing cursor opt-out preserves a consumer grabbing cursor": async caseContext => {
    const { own, container } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} }));
    await draw.ready;
    const canvas = draw.map.getCanvas();
    canvas.style.cursor = 'grabbing';
    const editor = attachDrawing(draw, { visualFeedback: false,
      createFeature: () => ({ id: 'cursor-line', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      editor.start('line');
      const bounds = canvas.getBoundingClientRect();
      await window.browserDrag!(bounds.left + 300, bounds.top + 180, bounds.left + 350, bounds.top + 200);
      check(canvas.style.cursor === 'grabbing', 'Navigation restored a cursor drawing did not own');
      editor.destroy();
      check(canvas.style.cursor === 'grabbing', 'Destroy restored a cursor drawing did not own');
    } finally { editor.destroy(); draw.destroy(); }
  },
  "Snap callbacks cannot place a target from a replaced scene": async caseContext => {
    const { own, container, until } = caseContext;
    const protocol = `snap-scene-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    addProtocol(protocol, async () => { await gate; throw new Error('Terrain held for scene replacement'); });
    const elevation = { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom' as const,
      redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 };
    try {
      const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
        features: [point('scene-snap')], logger: () => {} }));
      await draw.ready;
      let replace = false;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'scene-click', properties: {} }),
        canSnap: () => {
          if (replace) { replace = false; draw.configure({ terrain: true, elevation }); }
          return true;
        }, submit: () => ({ accepted: true }) });
      try {
        editor.start('line');
        const screen = draw.map.project([0, 0]);
        await until(() => draw.map.queryRenderedFeatures([[screen.x - 12, screen.y - 12],
          [screen.x + 12, screen.y + 12]], { layers: ['rl:points'] }).length > 0, 'snap candidate visible');
        await pointer('move', screen);
        await until(() => editor.getPreview()?.kind === 'line', 'initial ground preview');
        let stalePreview = false;
        const offPreview = editor.onPreview(() => {
          if (replace === false && draw.getConfiguration().terrain && editor.getPreview()) stalePreview = true;
        });
        try {
          replace = true;
          await pointer('move', { x: screen.x + 1, y: screen.y });
          check(!stalePreview && editor.getPreview() === undefined,
            'Scene replacement republished a ground preview from the old scene');
          draw.configure({ terrain: false });
          await until(() => !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'flat target restored');
          replace = true;
          await pointer('click', screen);
          check(editor.getState().draft?.placed === 0, 'Snap callback placed a target from the replaced scene');
        } finally { offPreview(); }
      } finally { editor.destroy(); draw.destroy(); }
    } finally { release(); removeProtocol(protocol); }
  },
  "A valid terrain center keeps its target while footprint tiles load": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    const protocol = `partial-footprint-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let neighboringTileRequested = false;
    addProtocol(protocol, async params => {
      const zoom = Number(params.url.split('/').at(-3));
      const x = Number(params.url.split('/').at(-2));
      if (x >= 2 ** (zoom - 1)) { neighboringTileRequested = true; await gate; }
      return { data: data.slice(0) };
    });
    try {
      const center: [number, number] = [-0.001, 0];
      const draw = own(createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`], encoding: 'custom',
          redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 12 },
        camera: { center, zoom: 12 }, logger: () => {} }));
      await draw.ready;
      const editor = attachDrawing(draw, { createFeature: () => ({ id: 'partial-footprint', properties: {} }),
        submit: () => ({ accepted: true }) });
      try {
        editor.start('line');
        const screen = draw.map.project(center);
        await pointer('move', screen);
        await until(() => neighboringTileRequested &&
          !!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'valid center beside pending terrain');
        check(!container.querySelector('.rl-ground-footprint:not([hidden])'),
          'Footprint crossed unavailable surrounding terrain');
        await pointer('click', screen);
        check(editor.getState().draft?.placed === 1, 'Missing footprint blocked a valid center');
      } finally { editor.destroy(); draw.destroy(); }
    } finally { release(); removeProtocol(protocol); }
  },
  "Destroying during terrain replacement releases active drawing work": async caseContext => {
    const { own, container, until } = caseContext;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!;
    context.fillStyle = 'rgb(100,0,0)'; context.fillRect(0, 0, 256, 256);
    const data = await (await fetch(dem.toDataURL())).arrayBuffer();
    for (const editing of [false, true]) {
      const protocol = `pending-destroy-${crypto.randomUUID()}`;
      let release = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      let requested = false, completed = false;
      addProtocol(protocol, async () => {
        requested = true;
        await gate;
        completed = true;
        return { data: data.slice(0) };
      });
      try {
        const draw = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
          features: [point('edit-after-destroy')], logger: () => {} }));
        await draw.ready;
        const editor = attachDrawing(draw, { createFeature: () => ({ id: 'place-after-destroy', properties: {} }),
          submit: () => ({ accepted: true }) });
        let previews = 0;
        const offPreview = editor.onPreview(() => { previews++; });
        try {
          if (editing) editor.edit('edit-after-destroy');
          else { editor.start('line'); await pointer('move', draw.map.project([0, 0])); }
          draw.configure({ terrain: true, elevation: { tiles: [`${protocol}://dem/{z}/{x}/{y}.png`],
            encoding: 'custom', redFactor: 1, greenFactor: 0, blueFactor: 0, baseShift: 100, maxzoom: 0 } });
          await until(() => requested, 'terrain request before active drawing destruction');
          draw.destroy();
          const afterDestroy = previews;
          check(!container.querySelector('canvas,.rl-ground-feedback,.rl-drawing-handle'),
            'Destroyed viewport retained drawing or map elements');
          release();
          await until(() => completed, 'pending terrain response');
          await new Promise<void>(resolve => setTimeout(resolve, 100));
          check(previews === afterDestroy && !container.querySelector('canvas,.rl-ground-feedback,.rl-drawing-handle'),
            'Pending terrain restored drawing output after destruction');
        } finally { offPreview(); editor.destroy(); draw.destroy(); }
      } finally { release(); removeProtocol(protocol); }
    }
  },
} satisfies BrowserCaseModule;
