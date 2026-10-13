import { attachDrawing, attachMapControls, createViewport, formatCoordinate } from '@ridgeline/map';
import type { Viewport } from '@ridgeline/map';
import { NavigationControl, ScaleControl } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
function basemap(name: string, color: string): StyleSpecification {
  return { version: 8, name, sources: {}, layers: [{ id: `base:${name}`, type: 'background', paint: { 'background-color': color } }] };
}
function selector(container: HTMLElement) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Basemap"]');
  if (!select) throw new Error('Basemap selector missing');
  return select;
}
async function key(value: string) {
  if (!window.browserKey) throw new Error('Native keyboard bridge unavailable');
  await window.browserKey(value);
}
async function tabTo(select: HTMLSelectElement) {
  for (let count = 0; document.activeElement !== select && count < 16; count++) await key('Tab');
  check(document.activeElement === select, 'Native Tab did not reach the basemap selector');
}
async function observe(predicate: () => boolean, description: string, duration = 350) {
  const start = performance.now();
  do {
    check(predicate(), description);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  } while (performance.now() - start < duration);
}
export const workflowControlCases = [
  { name: 'Workflow controls expose coordinates preserve native ownership and release on teardown', async run(context: Context) {
    const viewport = createViewport({ container: context.container,
      basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
      camera: { center: [179, 60], zoom: 4 }, logger: () => {} });
    context.setCurrent(viewport);
    await viewport.ready;
    const consumerControl = new NavigationControl({ showCompass: false });
    viewport.map.addControl(consumerControl, 'top-left');
    const controls = attachMapControls(viewport, { fullscreen: false, coordinates: { format: 'dms', precision: 2 } });
    try {
      const readout = context.container.querySelector<HTMLOutputElement>('.rl-coordinates');
      check(readout?.value === formatCoordinate([179, 60], { format: 'dms', precision: 2 }), 'Initial coordinate output differs');
      viewport.setCamera({ center: [-179, 70] }, { duration: 0 });
      check(readout?.value === formatCoordinate([-179, 70], { format: 'dms', precision: 2 }), 'Readout did not follow the camera');
      if (!window.browserClick) throw new Error('Native click bridge unavailable');
      await window.browserClick('.maplibregl-ctrl-top-right .maplibregl-ctrl-zoom-in');
      await context.until(() => viewport.map.getZoom() > 4.9, 'native navigation zoom');
      controls.destroy(); controls.destroy();
      check(!context.container.querySelector('.rl-coordinates'), 'Coordinate control remains after destroy');
      check(viewport.map.hasControl(consumerControl), 'Attachment removed the consumer control');
      check(context.container.querySelectorAll('.maplibregl-ctrl-zoom-in').length === 1, 'Owned navigation was not removed');
      attachMapControls(viewport, { navigation: false, scale: false, fullscreen: false, coordinates: true });
      viewport.destroy();
      check(!context.container.querySelector('.rl-map-control'), 'Viewport destruction retained attached controls');
    } finally { controls.destroy(); viewport.destroy(); }
  } },
  { name: 'Basemap selector follows accepted external and failed style configuration', async run(context: Context) {
    const first = { version: 8 as const, name: 'First', sources: {}, layers: [] };
    const second = { version: 8 as const, name: 'Second', sources: {}, layers: [{ id: 'background', type: 'background' as const }] };
    const failedStyle = 'data:application/json,%7B%22invalid%22%3Atrue%7D';
    const viewport = createViewport({ container: context.container, basemap: first, logger: () => {} });
    context.setCurrent(viewport);
    await viewport.ready;
    const controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: false,
      basemaps: [{ id: 'first', name: 'First', basemap: first }, { id: 'second', name: 'Second', basemap: second },
        { id: 'failed', name: 'Unavailable', basemap: failedStyle }] });
    try {
      const select = context.container.querySelector<HTMLSelectElement>('select[aria-label="Basemap"]');
      check(select?.value === 'first', 'Initial basemap differs');
      viewport.configure({ basemap: second });
      check(select?.value === 'second', 'External configuration did not update selector synchronously');
      await context.until(() => viewport.map.getStyle()?.name === 'Second' && !!viewport.map.getLayer('background') && !!viewport.map.getLayer('rl:points'), 'second basemap publication');
      const offReentrant = viewport.on('configurationchange', () => {
        offReentrant();
        viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: false } });
      });
      viewport.configure({ basemap: first });
      await context.until(() => viewport.map.getStyle()?.name === 'First' && !viewport.map.getLayer('background') && !!viewport.map.getLayer('rl:points'), 'basemap retained through reentrant configuration patch');
      check(select?.value === 'first', 'Reentrant patch lost the requested basemap');
      check(!viewport.getConfiguration().entityVisibility.groundLines, 'Reentrant visibility patch was lost');
      let styleFailed = false;
      const off = viewport.on('diagnostic', diagnostic => { if (diagnostic.code === 'STYLE_FAILED') styleFailed = true; });
      try {
        viewport.configure({ basemap: failedStyle });
        check(select?.value === 'failed', 'Accepted loading configuration did not update selector');
        await context.until(() => styleFailed, 'failed basemap diagnostic');
        check(select?.value === 'failed', 'Failed load diverged from accepted basemap configuration');
      } finally { off(); }
      viewport.configure({ basemap: { ...first, name: 'Custom' } });
      check(select?.value === '', 'Unmatched accepted style did not show Custom');
      viewport.configure({ basemap: first });
      check(select?.value === 'first', 'Selector did not recover');
    } finally { controls.destroy(); viewport.destroy(); }
  } },
  { name: 'Basemap selector native keyboard retains equivalent choices and follows external styles', async run(context: Context) {
    const same = basemap('Same', '#dce9dd'), different = basemap('Different', '#e8dcce');
    const viewport = createViewport({ container: context.container, basemap: same, logger: () => {} });
    context.setCurrent(viewport); await viewport.ready;
    const controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: false,
      basemaps: [{ id: 'first', name: 'First label', basemap: same }, { id: 'second', name: 'Second label', basemap: same },
        { id: 'different', name: 'Different', basemap: different }] });
    try {
      const select = selector(context.container), nativeSource = viewport.map.getSource('rl:features');
      let reloads = 0; viewport.map.on('styledataloading', () => { reloads++; });
      await tabTo(select);
      await key('ArrowDown'); await key('Tab');
      check(reloads === 0 && viewport.map.getSource('rl:features') === nativeSource, 'Equivalent style selection unnecessarily retired the native display');
      check(select.value === 'second' && select.selectedOptions[0]?.text === 'Second label', 'Equivalent choice lost its selected label');
      await context.until(() => viewport.map.getStyle()?.name === 'Same' && !!viewport.map.getLayer('base:Same') && !!viewport.map.getLayer('rl:points'), 'equivalent choice native style');
      check(JSON.stringify(viewport.getConfiguration().basemap) === JSON.stringify(same), 'Equivalent choice changed the accepted style');
      viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: false } });
      check(select.value === 'second', 'Unrelated configuration reset the selected label');
      await tabTo(select);
      await key('ArrowDown'); await key('Tab');
      await context.until(() => select.value === 'different' && viewport.map.getStyle()?.name === 'Different' &&
        !!viewport.map.getLayer('base:Different') && !!viewport.map.getLayer('rl:points'), 'native keyboard distinct basemap publication');
      check(JSON.stringify(viewport.getConfiguration().basemap) === JSON.stringify(different), 'Keyboard choice did not become accepted configuration');
      await tabTo(select);
      check(document.activeElement === select && !select.disabled, 'Selector lost keyboard usability after style publication');
      viewport.configure({ basemap: same });
      check(select.value === 'first', 'External style change did not follow accepted configuration');
      check(document.activeElement === select, 'External configuration lost selector focus');
      viewport.configure({ basemap: basemap('Custom', '#ffffff') });
      check(select.value === '' && select.selectedOptions[0]?.text === 'Custom', 'Unmatched style did not show Custom');
      viewport.configure({ basemap: different });
      await context.until(() => select.value === 'different' && viewport.map.getStyle()?.name === 'Different' &&
        !!viewport.map.getLayer('base:Different') && !!viewport.map.getLayer('rl:points'), 'selector recovery from Custom');
    } finally { controls.destroy(); viewport.destroy(); }
  } },
  { name: 'Basemap selector drawing preview reentry publishes current style after patch and replacement', async run(context: Context) {
    for (const action of ['patch', 'replace'] as const) {
      const first = basemap('First', '#ffffff'), requested = basemap('Requested', '#e3ece4'), latest = basemap('Latest', '#eee1d1');
      const viewport = createViewport({ container: context.container, basemap: first, logger: () => {} });
      context.setCurrent(viewport); await viewport.ready;
      const controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: false,
        basemaps: [{ id: 'first', name: 'First', basemap: first }, { id: 'requested', name: 'Requested', basemap: requested },
          { id: 'latest', name: 'Latest', basemap: latest }] });
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: `preview-${action}`, properties: {} }), submit: () => ({ accepted: true }) });
      try {
        editor.start('line'); editor.addPoint([0, 0]); editor.setCursor([1, 1]);
        const preview = editor.getPreview();
        check(preview?.kind === 'line' && preview.vertices.length === 2, 'Required nonempty drawing preview cursor missing');
        let callbacks = 0;
        const off = editor.onPreview(() => {
          if (callbacks++) return;
          const cleared = editor.getPreview();
          check(cleared?.kind === 'line' && cleared.vertices.length === 1, 'Scene invalidation did not clear the actual preview cursor');
          viewport.configure({ ...(action === 'replace' ? { basemap: latest } : {}),
            entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: false } });
        });
        try { viewport.configure({ basemap: requested }); }
        finally { off(); }
        check(callbacks > 0, 'Real drawing onPreview callback did not reenter configuration');
        const accepted = action === 'replace' ? latest : requested;
        check(JSON.stringify(viewport.getConfiguration().basemap) === JSON.stringify(accepted), 'Drawing callback lost the latest accepted basemap');
        check(!viewport.getConfiguration().entityVisibility.groundLines, 'Drawing callback lost the unrelated configuration patch');
        const select = selector(context.container);
        check(select.value === (action === 'replace' ? 'latest' : 'requested'), 'Selector disagrees with accepted callback configuration');
        await context.until(() => viewport.map.getStyle()?.name === accepted.name && !!viewport.map.getLayer(`base:${accepted.name}`) &&
          !!viewport.map.getLayer('rl:points'), `${action}: current native basemap publication`);
        await observe(() => viewport.map.getStyle()?.name === accepted.name && !!viewport.map.getLayer(`base:${accepted.name}`) &&
          !viewport.map.getLayer('base:First') && (action !== 'replace' || !viewport.map.getLayer('base:Requested')),
        `${action}: obsolete native basemap replaced the accepted style`);
        check(editor.getState().draft?.feature.id === `preview-${action}`, 'Basemap publication lost the drawing draft');
      } finally { editor.destroy(); controls.destroy(); viewport.destroy(); }
    }
  } },
  { name: 'Basemap selector drawing preview destruction leaves replacement controls usable', async run(context: Context) {
    const first = basemap('Old', '#ffffff'), requested = basemap('Abandoned', '#e3ece4'), replacementStyle = basemap('Replacement', '#eee1d1');
    const viewport = createViewport({ container: context.container, basemap: first, logger: () => {} });
    context.setCurrent(viewport); await viewport.ready;
    const controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: false,
      coordinates: true, basemaps: [{ id: 'old', name: 'Old', basemap: first }, { id: 'abandoned', name: 'Abandoned', basemap: requested }] });
    const oldCanvas = viewport.map.getCanvas(), oldSelect = selector(context.container);
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'destroyed-preview', properties: {} }), submit: () => ({ accepted: true }) });
    let replacement: Viewport | undefined, replacementControls: ReturnType<typeof attachMapControls> | undefined;
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.setCursor([1, 1]);
      const preview = editor.getPreview();
      check(preview?.kind === 'line' && preview.vertices.length === 2, 'Required destruction preview cursor missing');
      let callbacks = 0;
      const off = editor.onPreview(() => {
        if (callbacks++) return;
        viewport.destroy();
        replacement = createViewport({ container: context.container, basemap: replacementStyle, camera: { center: [0, 0], zoom: 3 }, logger: () => {} });
        context.setCurrent(replacement);
      });
      try { viewport.configure({ basemap: requested }); }
      finally { off(); }
      check(callbacks > 0 && replacement, 'Drawing preview did not destroy and replace the viewport');
      const current = replacement;
      if (!current) throw new Error('Replacement viewport missing');
      await current.ready;
      check(!oldCanvas.isConnected && !oldSelect.isConnected, 'Old viewport canvas or controls survived callback destruction');
      const consumerControl = new NavigationControl({ showCompass: false });
      current.map.addControl(consumerControl, 'top-left');
      replacementControls = attachMapControls(current, { fullscreen: false, coordinates: true });
      current.setCamera({ center: [1, 1] }, { duration: 0 });
      check(context.container.querySelector<HTMLOutputElement>('.rl-coordinates')?.value === formatCoordinate([1, 1]), 'Replacement camera/readout is unusable');
      if (!window.browserClick) throw new Error('Native click bridge unavailable');
      await window.browserClick('.maplibregl-ctrl-top-right .maplibregl-ctrl-zoom-in');
      await context.until(() => current.map.getZoom() > 3.9, 'replacement native control navigation');
      replacementControls.destroy();
      check(current.map.hasControl(consumerControl) && context.container.querySelectorAll('.maplibregl-ctrl-zoom-in').length === 1,
        'Replacement attachment removed independent consumer controls');
      await observe(() => current.map.getStyle()?.name === 'Replacement' && !!current.map.getLayer('base:Replacement') &&
        !current.map.getLayer('base:Abandoned') && context.container.querySelectorAll('canvas').length === 1 && !oldCanvas.isConnected,
      'Abandoned viewport work changed the replacement');
    } finally { replacementControls?.destroy(); replacement?.destroy(); editor.destroy(); controls.destroy(); viewport.destroy(); }
  } },
  { name: 'Workflow controls clean partial native initialization and preserve consumer controls', async run(context: Context) {
    const viewport = createViewport({ container: context.container, basemap: basemap('Partial', '#ffffff'), camera: { center: [0, 0], zoom: 3 }, logger: () => {} });
    context.setCurrent(viewport); await viewport.ready;
    const consumerControl = new NavigationControl({ showCompass: false });
    viewport.map.addControl(consumerControl, 'top-left');
    const originalOnAdd = ScaleControl.prototype.onAdd;
    let partialReached = false, nativeFailure: unknown, attachFailure: unknown;
    let controls: ReturnType<typeof attachMapControls> | undefined;
    // Retain native setup and its actual failure, recording only the public boundary.
    ScaleControl.prototype.onAdd = function (map) {
      try { return originalOnAdd.call(this, map); }
      catch (cause) {
        partialReached = !!map.getContainer().querySelector('.maplibregl-ctrl-scale') && !map.hasControl(this);
        nativeFailure = cause;
        throw cause;
      }
    };
    try {
      try { attachMapControls(viewport, { scale: { maxWidth: Infinity }, fullscreen: false }); }
      catch (cause) { attachFailure = cause; }
      finally { ScaleControl.prototype.onAdd = originalOnAdd; }
      check(partialReached, 'Required native onAdd failure before control registration was not reached');
      check(nativeFailure instanceof Error && attachFailure === nativeFailure, 'Cleanup replaced the original native initialization error');
      check(!context.container.querySelector('.maplibregl-ctrl-scale'), 'Partial native scale DOM survived rejection');
      check(viewport.map.hasControl(consumerControl) && context.container.querySelectorAll('.maplibregl-ctrl-zoom-in').length === 1,
        'Failed attachment did not preserve independent consumer controls');
      viewport.setCamera({ center: [1, 1] }, { duration: 0 });
      check(viewport.map.getCenter().lng === 1 && viewport.map.getCenter().lat === 1, 'Leaked partial native listener blocked camera movement');
      controls = attachMapControls(viewport, { fullscreen: false, coordinates: true });
      check(context.container.querySelectorAll('.maplibregl-ctrl-scale').length === 1, 'Valid attachment did not recover scale installation');
      if (!window.browserClick) throw new Error('Native click bridge unavailable');
      await window.browserClick('.maplibregl-ctrl-top-right .maplibregl-ctrl-zoom-in');
      await context.until(() => viewport.map.getZoom() > 3.9, 'valid native control after failed setup');
      controls.destroy(); controls.destroy();
      viewport.setCamera({ center: [2, 2] }, { duration: 0 });
      check(!context.container.querySelector('.maplibregl-ctrl-scale') && !context.container.querySelector('.rl-coordinates') &&
        viewport.map.hasControl(consumerControl) && context.container.querySelectorAll('.maplibregl-ctrl-zoom-in').length === 1,
      'Recovered attachment cleanup removed consumer controls or retained owned resources');
    } finally { ScaleControl.prototype.onAdd = originalOnAdd; controls?.destroy(); viewport.destroy(); }
  } },
  { name: 'Native geolocation waits for activation and releases its active watch', async run(context: Context) {
    const originalLocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    let requests = 0, cleared = 0;
    let lateSuccess: PositionCallback | undefined;
    const geolocation: Geolocation = {
      getCurrentPosition() { requests++; },
      watchPosition(success) { requests++; lateSuccess = success; return 73; },
      clearWatch(id) { check(id === 73, 'Unexpected watch retired'); cleared++; },
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    const viewport = createViewport({ container: context.container,
      basemap: { version: 8, sources: {}, layers: [] }, logger: () => {} });
    context.setCurrent(viewport);
    let controls: ReturnType<typeof attachMapControls> | undefined;
    try {
      await viewport.ready;
      controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: false,
        geolocate: { trackUserLocation: true } });
      await context.until(() => !!context.container.querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate:not(:disabled)'), 'native geolocation ready');
      check(requests === 0, 'Attachment requested location before activation');
      if (!window.browserClick) throw new Error('Native click bridge unavailable');
      await window.browserClick('.maplibregl-ctrl-geolocate');
      check(requests === 1 && lateSuccess, 'User activation did not establish location watch');
      controls.destroy(); controls.destroy();
      check(cleared === 1, 'Owned active watch was not retired exactly once');
      const camera = viewport.map.getCenter().toArray();
      lateSuccess?.({ timestamp: Date.now(), coords: { longitude: 6, latitude: 45, accuracy: 10,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return {}; } }, toJSON() { return {}; } });
      check(JSON.stringify(viewport.map.getCenter().toArray()) === JSON.stringify(camera), 'Late location changed camera after retirement');
      check(!context.container.querySelector('.maplibregl-ctrl-geolocate'), 'Retired location control remains');
    } finally {
      controls?.destroy(); viewport.destroy();
      if (originalLocation) Object.defineProperty(navigator, 'geolocation', originalLocation);
      else Reflect.deleteProperty(navigator, 'geolocation');
      if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
      else Reflect.deleteProperty(navigator, 'permissions');
    }
  } },
  { name: 'Native fullscreen options retain viewport container as default target', async run(context: Context) {
    const viewport = createViewport({ container: context.container,
      basemap: { version: 8, sources: {}, layers: [] }, logger: () => {} });
    context.setCurrent(viewport);
    await viewport.ready;
    const controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: {} });
    try {
      if (!window.browserClick) throw new Error('Native click bridge unavailable');
      await window.browserClick('.maplibregl-ctrl-fullscreen');
      await context.until(() => document.fullscreenElement === context.container ||
        context.container.classList.contains('maplibregl-pseudo-fullscreen'), 'fullscreen viewport target');
      await window.browserClick('.maplibregl-ctrl-shrink');
      await context.until(() => !document.fullscreenElement &&
        !context.container.classList.contains('maplibregl-pseudo-fullscreen'), 'fullscreen exit');
    } finally { controls.destroy(); viewport.destroy(); }
  } },

  { name: 'Native fullscreen retirement restores owned layout and cooperative gestures', async run(context: Context) {
    for (const pseudo of [true, false]) for (const throughViewport of [false, true]) for (const cooperative of [true, false]) {
      const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [] }, logger: () => {} });
      context.setCurrent(viewport); await viewport.ready;
      if (cooperative) viewport.map.cooperativeGestures.enable(); else viewport.map.cooperativeGestures.disable();
      const controls = attachMapControls(viewport, { navigation: false, scale: false, fullscreen: { pseudo } });
      try {
        if (!window.browserClick) throw new Error('Native fullscreen click bridge unavailable');
        await window.browserClick('.maplibregl-ctrl-fullscreen');
        await context.until(() => document.fullscreenElement === context.container || context.container.classList.contains('maplibregl-pseudo-fullscreen'), 'owned fullscreen entered');
        await context.until(() => !viewport.map.cooperativeGestures.isEnabled(), 'fullscreen cooperative gestures disabled');
        if (throughViewport) viewport.destroy(); else controls.destroy();
        await context.until(() => !document.fullscreenElement && !context.container.classList.contains('maplibregl-pseudo-fullscreen'), 'owned fullscreen retirement');
        check(viewport.map.cooperativeGestures.isEnabled() === cooperative, 'Fullscreen retirement did not restore cooperative gestures');
      } finally { controls.destroy(); viewport.destroy(); }
    }
  } },
] as const;
