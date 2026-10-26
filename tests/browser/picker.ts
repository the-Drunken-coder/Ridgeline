import { createViewport, attachInteractions, RidgelineError } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import { style, point, check, pointer, browserKey, browserClick } from './helpers';
import { withBaseViewport } from './base-viewport';
import type { BrowserCaseModule } from './context';


export const pickerCases = {
  "Escape reaches consumers unless a picker is open": caseContext => withBaseViewport(caseContext, async ({ viewport }) => {
    const { container } = caseContext;
    const ui = attachInteractions(viewport);
    let bubbled = 0;
    const onKeydown = () => { bubbled++; };
    document.addEventListener('keydown', onKeydown);
    viewport.map.getCanvas().focus();
    await browserKey('Escape');
    check(bubbled === 1, 'Escape was intercepted without an overlay');
    await pointer('click', viewport.map.project([0,0]));
    check(Boolean(container.querySelector('.rl-picker')), 'Picker did not open');
    await browserKey('Escape');
    check(!container.querySelector('.rl-picker') && bubbled === 1, 'Escape did not stay with the open picker');
    document.removeEventListener('keydown', onKeydown);
    ui.destroy();
  }),
  "Keyboard picker activation selects the chosen overlapping feature": caseContext => withBaseViewport(caseContext, async ({ viewport }) => {
    const { container } = caseContext;
    const ui = attachInteractions(viewport);
    let requested = '';
    const off = viewport.on('selectionrequest', event => {
      requested = event.ids[0] ?? '';
      viewport.setSelection(requested ? [requested] : []);
    });
    await pointer('click', viewport.map.project([0,0]));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
    check(buttons.length >= 2, 'Overlapping features did not open a picker');
    const target = buttons[1]!.dataset.featureId!;
    buttons[0]!.focus();
    await browserKey('ArrowRight');
    check(document.activeElement === buttons[1], 'Arrow key did not move picker focus');
    await browserKey('Enter');
    check(requested === target && viewport.getSelection()[0] === target, 'Enter did not request and apply the focused choice');
    check(!container.querySelector('.rl-picker'), 'Picker remained open after selection');
    off(); ui.destroy();
  }),
  "Picker candidates stay stable during movement; UI disposes once": caseContext => withBaseViewport(caseContext, async ({ viewport }) => {
    const { container } = caseContext;
    let renders = 0, disposals = 0;
    const live = new Set<number>();
    const ui = attachInteractions(viewport, { renderFeature: feature => { const element = document.createElement('span'); element.textContent = viewport.getName(feature); const id = ++renders; live.add(id); return { element, dispose: () => { check(live.delete(id), 'Custom content disposed twice'); disposals++; } }; } });
    await pointer('click', viewport.map.project([0,0]));
    const ids = [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId);
    check(ids.length === 2, 'Expected two picker candidates');
    viewport.upsert([{ ...point('queued', .001), properties: { name: 'Moved candidate' } }]);
    check(ids.join(',') === [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId).join(','), 'Picker reordered');
    check(disposals > 0, 'Changed custom content was not disposed');
    ui.destroy(); ui.destroy(); check(live.size === 0 && disposals === renders, 'Custom UI content leaked or disposed twice');
    check(!container.querySelector('.rl-ui'), 'Overlay remains');
  }),
  "Feature content keeps the newest update from render and disposal callbacks": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until, container } = caseContext;
    for (const callback of ['render', 'dispose'] as const) {
      const feature = (name: string): MapFeature => ({ ...point('content-target'), properties: { name } });
      viewport.upsert([feature('Initial'), point('content-other')]);
      await until(() => hits().some(hit => hit.properties._rl_feature_id === 'content-target'), 'content target rendered');
      let armed = false, renders = 0, disposals = 0;
      const live = new Set<number>();
      const replace = () => { armed = false; viewport.upsert([feature('Newest')]); };
      const ui = attachInteractions(viewport, {
        hover: false,
        renderFeature(current) {
          const name = viewport.getName(current);
          const element = document.createElement('span'); element.textContent = name;
          const id = ++renders; live.add(id);
          if (armed && callback === 'render' && current.id === 'content-target' && name === 'Intermediate') replace();
          return { element, dispose() {
            check(live.delete(id), 'Feature content disposed twice'); disposals++;
            if (armed && callback === 'dispose' && current.id === 'content-target' && name === 'Initial') replace();
          } };
        },
      });
      try {
        await pointer('click', viewport.map.project([0, 0]));
        const choice = container.querySelector<HTMLButtonElement>('[data-feature-id="content-target"]');
        check(choice, 'Missing content choice');
        choice?.focus();
        armed = true;
        viewport.upsert([feature('Intermediate')]);
        check(choice?.textContent === 'Newest', `${callback} callback restored obsolete content`);
        check(choice?.getAttribute('aria-label') === 'Select Newest', `${callback} callback restored an obsolete accessible name`);
        check(document.activeElement === choice, `${callback} callback lost focus`);
      } finally {
        armed = false;
        ui.destroy(); ui.destroy();
        check(live.size === 0 && disposals === renders, 'Nested content update leaked a result');
        viewport.remove(['content-target', 'content-other']);
      }
    }
  }),
  "Feature content returned after interaction destruction is disposed once": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until, container } = caseContext;
    for (const surface of ['picker', 'hover'] as const) {
      const lng = surface === 'hover' ? .2 : 0;
      viewport.upsert([point('destroy-content', lng), point('destroy-other', lng)]);
      await until(() => hits().some(hit => hit.properties._rl_feature_id === 'destroy-content'), 'destruction target rendered');
      let ui: ReturnType<typeof attachInteractions> | undefined;
      let renders = 0, disposals = 0;
      const failures: RidgelineError[] = [];
      const off = viewport.on('diagnostic', error => { if (error.code === 'CALLBACK_FAILED') failures.push(error); });
      ui = attachInteractions(viewport, {
        hover: surface === 'hover',
        renderFeature() {
          const element = document.createElement('span'); element.textContent = 'Discarded content';
          renders++;
          ui?.destroy();
          return { element, dispose() { disposals++; } };
        },
      });
      try {
        await pointer(surface === 'hover' ? 'move' : 'click', viewport.map.project([lng, 0]));
        ui.destroy();
        check(renders === 1 && disposals === renders, `${surface} retained content returned after destruction`);
        check(!container.querySelector('.rl-ui, .rl-tooltip, .rl-picker'), `${surface} restored destroyed interaction UI`);
        check(failures.length === 0, `${surface} continued using destroyed interaction state`);
      } finally {
        ui.destroy(); off(); viewport.remove(['destroy-content', 'destroy-other']);
      }
    }
  }),
  "Picker refreshes names, icons and availability without replacing buttons or focus": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until, container } = caseContext;
    viewport.upsert([point('queued')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'picker setup');
    const ui = attachInteractions(viewport);
    await pointer('click', viewport.map.project([0,0]));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
    const choice = buttons[0]!;
    const id = choice.dataset.featureId!;
    const original = viewport.getFeature(id)!;
    choice.focus();
    const label = choice.querySelector('.rl-feature-content');
    viewport.upsert([{ ...original, geometry: { type: 'Point', coordinates: [.01, 0] } }]);
    check(choice.querySelector('.rl-feature-content') === label, 'Position update rebuilt default content');
    const iconUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
    viewport.registerIcon('picker-icon', { image: new ImageData(2, 2), url: iconUrl });
    const renamed = { ...original, properties: { name: 'Updated candidate', icon: 'picker-icon' } };
    viewport.upsert([renamed]);
    check(choice.textContent === 'Updated candidate' && choice.getAttribute('aria-label') === 'Select Updated candidate', 'Stale picker name');
    check(choice.querySelector('img')?.getAttribute('src') === iconUrl, 'Stale picker icon');
    check(document.activeElement === choice, 'Keyboard focus lost');
    check(buttons.every((button, index) => container.querySelectorAll('[data-feature-id]')[index] === button), 'Buttons replaced or reordered');
    viewport.remove([id]);
    check(choice.disabled && choice.textContent === 'Unavailable', 'Removed candidate still available');
    check(document.activeElement === buttons[1], 'Removing the focused candidate lost keyboard access');
    viewport.upsert([renamed]);
    check(!choice.disabled && choice.textContent === 'Updated candidate', 'Reintroduced candidate stayed disabled');
    choice.focus();
    await browserKey('ArrowRight');
    check(document.activeElement === buttons[1], 'Keyboard navigation broke after refresh');
    ui.destroy();
  }),
  "Replacing a registered icon updates the map and an open picker": async caseContext => {
    const { own, until } = caseContext;
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const iconMap = own(createViewport({
      container: mount, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('icon-target'), point('icon-other')],
      style: feature => ({ icon: feature.id === 'icon-target' ? 'swap' : undefined }),
      logger: () => {},
    }));
    const pixels = (red: boolean) => {
      const image = new ImageData(24, 24);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = red ? 255 : 0;
        image.data[i + 1] = red ? 0 : 255;
        image.data[i + 3] = 255;
      }
      return image;
    };
    const color = new Uint8Array(4);
    try {
      await iconMap.ready;
      const canvas = iconMap.map.getCanvas();
      const gl = canvas.getContext('webgl2');
      check(Boolean(gl), 'Icon map has no WebGL2 context');
      iconMap.map.on('render', () => {
        const point = iconMap.map.project([0, 0]);
        const scale = canvas.width / canvas.clientWidth;
        gl!.readPixels(Math.round(point.x * scale), canvas.height - 1 - Math.round(point.y * scale), 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, color);
      });
      iconMap.registerIcon('swap', { image: pixels(true), url: 'data:image/svg+xml,red' });
      await until(() => color[0]! > 200 && color[1]! < 50, 'first icon rendered red');
      const ui = attachInteractions(iconMap);
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      const iconBox = iconMap.map.getCanvas().getBoundingClientRect();
      const iconPoint = iconMap.map.project([0, 0]);
      await window.browserMouse('click', iconBox.left + iconPoint.x, iconBox.top + iconPoint.y);
      const choice = mount.querySelector<HTMLButtonElement>('[data-feature-id="icon-target"]')!;
      check(choice.querySelector('img')?.getAttribute('src') === 'data:image/svg+xml,red', 'Picker lacked the first icon');
      iconMap.registerIcon('swap', { image: pixels(false), url: 'data:image/svg+xml,green' });
      await until(() => color[1]! > 200 && color[0]! < 50, 'replacement icon rendered green');
      check(choice.querySelector('img')?.getAttribute('src') === 'data:image/svg+xml,green', 'Open picker kept the old icon');
      ui.destroy();
    } finally {
      iconMap.destroy();
      mount.remove();
    }
  },
  "Icon registration isolates an unrelated failing style callback": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.context.featureId === 'icon-broken') failures.push(error); });
    viewport.upsert([
      { ...point('icon-healthy'), properties: { name: 'Healthy icon', icon: 'isolated-icon' } },
      { ...point('icon-broken'), properties: { name: 'Broken icon', broken: true } },
    ]);
    const image = new ImageData(16, 16);
    for (let i = 0; i < image.data.length; i += 4) { image.data[i] = 255; image.data[i + 3] = 255; }
    viewport.registerIcon('isolated-icon', { image });
    await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:icons'] })
      .some(hit => hit.properties._rl_feature_id === 'icon-healthy'), 'healthy icon published');
    check(failures.length > 0, 'Broken style callback did not report its feature ID');
    viewport.upsert([point('icon-broken')]);
    viewport.retryUpdates();
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'icon-broken'), 'recovered broken icon feature');
    viewport.remove(['icon-healthy', 'icon-broken']); off();
  }),
  "A broken style falls back to names without interrupting the picker": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until, container } = caseContext;
    viewport.upsert([point('picker-broken'), point('picker-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'picker-broken') && hits().some(hit => hit.properties._rl_feature_id === 'picker-healthy'), 'picker failure setup');
    viewport.upsert([{ ...point('picker-broken'), properties: { name: 'Broken candidate', broken: true } }]);
    const ui = attachInteractions(viewport);
    await pointer('click', viewport.map.project([0,0]));
    check(Boolean(container.querySelector('.rl-picker-hub button.rl-picker-close')), 'Picker stopped before drawing Close');
    const broken = container.querySelector<HTMLButtonElement>('[data-feature-id="picker-broken"]');
    const healthy = container.querySelector<HTMLButtonElement>('[data-feature-id="picker-healthy"]');
    check(broken?.textContent === 'Broken candidate' && Boolean(healthy), 'Picker did not show the name fallback');
    viewport.upsert([
      { ...point('picker-broken'), properties: { name: 'Broken renamed', broken: true } },
      { ...point('picker-healthy'), properties: { name: 'Healthy renamed' } },
    ]);
    check(broken?.textContent === 'Broken renamed' && healthy?.textContent === 'Healthy renamed', 'Broken style blocked another candidate refresh');
    ui.destroy();
    viewport.upsert([point('picker-broken')]);
    viewport.remove(['picker-broken', 'picker-healthy']);
  }),
  "Hover content follows the current feature and survives unrelated removal": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until, container } = caseContext;
    viewport.upsert([point('hover-current', .08), point('hover-unrelated', -.08)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'hover-current'), 'hover feature rendered');
    const ui = attachInteractions(viewport);
    await pointer('move', viewport.map.project([.08, 0]));
    await until(() => container.querySelector('.rl-tooltip')?.textContent === 'hover-current', 'hover tooltip');
    viewport.upsert([{ ...point('hover-current', .08), properties: { name: 'Current name' } }]);
    check(container.querySelector('.rl-tooltip')?.textContent === 'Current name', 'Hover tooltip kept stale content');
    viewport.remove(['hover-unrelated']);
    check(container.querySelector('.rl-tooltip')?.textContent === 'Current name', 'Unrelated removal hid the hovered feature');
    ui.destroy();
    viewport.remove(['hover-current']);
  }),
  "A failed custom picker choice keeps the other choice and keyboard selection usable": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until, container } = caseContext;
    viewport.upsert([point('custom-broken'), point('custom-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'custom-broken') && hits().some(hit => hit.properties._rl_feature_id === 'custom-healthy'), 'custom picker setup');
    const failures: RidgelineError[] = [];
    const offDiagnostic = viewport.on('diagnostic', error => { if (error.context.operation === 'renderFeature') failures.push(error); });
    let selection: string[] = [];
    const offSelection = viewport.on('selectionrequest', event => { selection = event.ids; });
    const ui = attachInteractions(viewport, {
      renderFeature(feature) {
        if (feature.properties.broken) throw new Error('Custom choice failed');
        const label = document.createElement('span');
        label.textContent = viewport.getName(feature);
        return label;
      },
    });
    await pointer('click', viewport.map.project([0, 0]));
    const broken = container.querySelector<HTMLButtonElement>('[data-feature-id="custom-broken"]')!;
    const healthy = container.querySelector<HTMLButtonElement>('[data-feature-id="custom-healthy"]')!;
    broken.focus();
    viewport.upsert([
      { ...point('custom-broken'), properties: { name: 'Broken current', broken: true } },
      { ...point('custom-healthy'), properties: { name: 'Healthy current' } },
    ]);
    check(broken.textContent === 'Broken current' && healthy.textContent === 'Healthy current', 'One custom renderer blocked choice refresh');
    check(document.activeElement === broken && !broken.disabled, 'Failed choice lost focus or became unavailable');
    check(failures.length === 1 && failures[0]?.context.featureId === 'custom-broken', 'Custom renderer failure was not reported');
    if (!window.browserKey) throw new Error('Playwright keyboard bridge required');
    await window.browserKey('Enter');
    check(selection[0] === 'custom-broken', 'Failed choice could not be selected with the keyboard');
    offSelection(); offDiagnostic(); ui.destroy();
    viewport.remove(['custom-broken', 'custom-healthy']);
  }),
  "Point above a ground area wins the click and picker-free selection": async caseContext => {
    const { own, until } = caseContext;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px';
    overlay.append(mount);
    document.body.append(overlay);
    const air = own(createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 16 },
      elevationSampler: { sample: () => 0 }, logger: () => {} }));
    let ui: ReturnType<typeof attachInteractions> | undefined;
    try {
      await air.ready;
      air.upsert([
        { ...point('ground-area', -.002), entity: { attachments: [{ id: 'zone', type: 'circle', radius: 500 }] } },
        point('top-point'),
      ]);
      await until(() => {
        const hits = air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points', 'rl:entity-ground-fill'] });
        return air.getEntityState('ground-area')?.coverage === 'ready' &&
          hits.some(hit => hit.properties._rl_feature_id === 'top-point') &&
          hits.some(hit => hit.properties.entityId === 'ground-area');
      },
      'overlapping ground area and point');
      const rendered = air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points', 'rl:entity-ground-fill'] });
      check(rendered[0]?.properties._rl_feature_id === 'top-point',
        `Test setup did not render the point above the ground area: ${rendered.slice(0, 4).map(hit => `${hit.layer.id}/${hit.properties._rl_feature_id ?? hit.properties.entityId}`).join(',')}`);
      let clicked: string[] = [];
      let requested: string[] = [];
      let clickEvents = 0;
      air.on('click', event => { clickEvents++; clicked = event.features.map(feature => feature.id); });
      air.on('selectionrequest', event => { requested = event.ids; });
      ui = attachInteractions(air, { picker: false });
      const pointAt = air.map.project([0, 0]);
      const rect = air.map.getCanvas().getBoundingClientRect();
      if (!window.browserClick) throw new Error('Playwright click bridge required');
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      await window.browserMouse('click', rect.left + pointAt.x, rect.top + pointAt.y);
      check(clicked[0] === 'top-point' && clicked.includes('ground-area'),
        `Click order differed from rendering: ${clicked}; events=${clickEvents}`);
      check(requested[0] === 'top-point', `Picker-free selection chose ${requested[0]}`);
    } finally {
      ui?.destroy(); air.destroy(); overlay.remove();
    }
  },
} satisfies BrowserCaseModule;
