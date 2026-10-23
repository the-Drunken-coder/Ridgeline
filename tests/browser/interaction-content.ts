import { createViewport, attachInteractions } from '@ridgeline/map';
import { style, point, check, pointer, browserKey, browserClick, browserDrag } from './helpers';
import type { BrowserCaseModule } from './context';


export const interactionContentCases = {
  "Reliability content keeps a menu closed when its factory closes synchronously": async caseContext => {
    const { own, container } = caseContext;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} }));
    await map.ready;
    let disposed = 0, opened = 0;
    const content = document.createElement('button'); content.textContent = 'Obsolete action';
    const interactions = attachInteractions(map, { contextMenu: (_, close) => {
      opened++; close(); return { element: content, dispose: () => { disposed++; } };
    } });
    try {
      const canvas = map.map.getCanvas(); canvas.focus();
      const rect = canvas.getBoundingClientRect();
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
      check(opened === 1, 'Native right click did not reach the menu factory');
      check(!container.querySelector('.rl-context') && !content.isConnected, 'Synchronous close reopened obsolete menu content');
      check(disposed === 1, 'Synchronous close did not release returned content once');
      check(document.activeElement === canvas, 'Closed content stole keyboard focus');
      await browserKey('Escape');
      interactions.destroy(); interactions.destroy();
      check(disposed === 1, 'Repeated teardown disposed closed content twice');
    } finally { interactions.destroy(); map.destroy(); }
  },
  "Reliability content keeps a menu opened by tooltip disposal during a native picker click": async caseContext => {
    const { own, container, until } = caseContext;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: [point('tooltip-replacement-a'), point('tooltip-replacement-b')], logger: () => {} }));
    await map.ready;
    const canvas = map.map.getCanvas(), location = map.map.project([0, 0]);
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    let replace = false, tooltipDisposed = 0, opened = 0, menuDisposed = 0;
    const interactions = attachInteractions(map, {
      renderFeature: feature => {
        const element = document.createElement('span'); element.textContent = feature.id;
        return { element, dispose: () => {
          if (!replace) return;
          replace = false; tooltipDisposed++;
          // Only the consumer disposer introduces a nested interaction; hover
          // and the outer picker request use native browser input.
          map.map.fire('contextmenu', { point: location, lngLat: map.map.unproject(location), originalEvent: new MouseEvent('contextmenu') });
        } };
      },
      contextMenu: () => { opened++; return { element: replacement, dispose: () => { menuDisposed++; } }; },
    });
    try {
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).length === 2, 'tooltip replacement candidates render');
      canvas.focus();
      await pointer('move', location);
      await until(() => !!container.querySelector('.rl-tooltip'), 'native hover mounted disposable tooltip');
      replace = true;
      await pointer('click', location);
      check(tooltipDisposed === 1 && opened === 1, 'Native click did not exercise replacement from tooltip disposal');
      check(replacement.isConnected && !!container.querySelector('.rl-context'), 'Tooltip disposal replacement menu did not mount');
      check(!container.querySelector('.rl-picker'), 'Obsolete native click mounted a picker over the replacement menu');
      check(document.activeElement === replacement && menuDisposed === 0, 'Obsolete native click changed replacement focus or lifetime');
      await browserKey('Escape');
      check(!container.querySelector('.rl-context, .rl-picker') && !replacement.isConnected && menuDisposed === 1,
        'Keyboard dismissal left replacement content mounted or disposed it incorrectly');
      check(document.activeElement === canvas, 'Replacement dismissal did not restore canvas focus');
      interactions.destroy(); interactions.destroy();
      check(tooltipDisposed === 1 && menuDisposed === 1, 'Repeated teardown repeated replacement disposal');
    } finally { replace = false; interactions.destroy(); map.destroy(); }
  },
  "Reliability content keeps replacement focus when a menu disposer opens another menu": async caseContext => {
    const { own, container } = caseContext;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} }));
    await map.ready;
    const canvas = map.map.getCanvas();
    let opened = 0, oldDisposed = 0, newDisposed = 0;
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    const interactions = attachInteractions(map, { contextMenu: event => {
      opened++;
      if (opened > 1) return { element: replacement, dispose: () => { newDisposed++; } };
      const original = document.createElement('button'); original.textContent = 'Original action';
      return { element: original, dispose: () => {
        oldDisposed++;
        canvas.focus();
        map.map.fire('contextmenu', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent });
      } };
    } });
    try {
      canvas.focus();
      const rect = canvas.getBoundingClientRect();
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
      check(opened === 1, 'Native right click did not open the original menu');
      await browserKey('Escape');
      check(opened === 2 && oldDisposed === 1 && newDisposed === 0, 'Closing the original menu disposed its replacement');
      check(replacement.isConnected && document.activeElement === replacement, 'Obsolete close stole replacement focus');
      await browserKey('Escape');
      check(!replacement.isConnected && newDisposed === 1, 'Keyboard dismissal did not dispose replacement once');
      check(document.activeElement === canvas, 'Replacement dismissal lost saved focus');
      interactions.destroy(); interactions.destroy();
      check(oldDisposed === 1 && newDisposed === 1, 'Repeated teardown repeated disposal');
    } finally { interactions.destroy(); map.destroy(); }
  },
  "Reliability content releases menu results after helper or viewport destruction": async caseContext => {
    const { own, container } = caseContext;
    for (const destroyViewport of [false, true]) {
      const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} }));
      await map.ready;
      let disposed = 0, opened = 0;
      const content = document.createElement('button'); content.textContent = 'Destroyed action';
      const interactions = attachInteractions(map, { contextMenu: () => {
        opened++;
        if (destroyViewport) map.destroy(); else interactions.destroy();
        return { element: content, dispose: () => { disposed++; } };
      } });
      try {
        const canvas = map.map.getCanvas(); canvas.focus();
        const rect = canvas.getBoundingClientRect();
        if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
        await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
        check(opened === 1 && disposed === 1, 'Destroyed menu factory leaked returned content');
        check(!container.querySelector('.rl-context') && !content.isConnected && document.activeElement !== content, 'Destroyed menu result mounted or received focus');
        await browserKey('Escape');
        interactions.destroy(); interactions.destroy(); map.destroy(); map.destroy();
        check(disposed === 1, 'Destroyed content was disposed repeatedly');
      } finally { interactions.destroy(); map.destroy(); }
    }
  },
  "Reliability content ignores obsolete factory results and close callbacks": async caseContext => {
    const { own, container } = caseContext;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 }, logger: () => {} }));
    await map.ready;
    let opened = 0, oldDisposed = 0, newDisposed = 0;
    let obsoleteClose: (() => void) | undefined;
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    const obsolete = document.createElement('button'); obsolete.textContent = 'Obsolete action';
    const interactions = attachInteractions(map, { contextMenu: (event, close) => {
      opened++;
      if (opened > 1) return { element: replacement, dispose: () => { newDisposed++; } };
      obsoleteClose = close;
      map.map.fire('contextmenu', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent });
      return { element: obsolete, dispose: () => { oldDisposed++; close(); } };
    } });
    try {
      const canvas = map.map.getCanvas(); canvas.focus();
      const rect = canvas.getBoundingClientRect();
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + 200, rect.top + 200, rect.left + 200, rect.top + 200, 'right');
      check(opened === 2 && oldDisposed === 1 && newDisposed === 0, 'Replaced factory result did not release exactly once');
      check(!obsolete.isConnected && replacement.isConnected && document.activeElement === replacement, 'Obsolete factory result replaced current content or focus');
      obsoleteClose?.();
      check(replacement.isConnected && document.activeElement === replacement && newDisposed === 0, 'An obsolete close callback affected current content');
      await browserKey('Escape');
      check(!replacement.isConnected && newDisposed === 1 && document.activeElement === canvas, 'Keyboard dismissal lost current disposal or focus');
      interactions.destroy(); interactions.destroy();
      check(oldDisposed === 1 && newDisposed === 1, 'Repeated teardown repeated menu disposal');
    } finally { interactions.destroy(); map.destroy(); }
  },
  "Reliability content keeps a replacement menu alive when picker page disposal opens it": async caseContext => {
    const { own, container, until } = caseContext;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: Array.from({ length: 10 }, (_, index) => point(`page-${index}`)), logger: () => {} }));
    await map.ready;
    let replace = false, menuDisposed = 0;
    const replacement = document.createElement('button'); replacement.textContent = 'Replacement action';
    const canvas = map.map.getCanvas();
    const interactions = attachInteractions(map, {
      contextMenu: () => ({ element: replacement, dispose: () => { menuDisposed++; } }),
      renderFeature: feature => {
        const element = document.createElement('span'); element.textContent = feature.id;
        return { element, dispose: () => {
          if (!replace) return;
          replace = false;
          canvas.focus();
          map.map.fire('contextmenu', { point: { x: 200, y: 200 }, lngLat: map.map.unproject([200, 200]), originalEvent: new MouseEvent('contextmenu') });
        } };
      },
    });
    try {
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).length === 10, 'overlapping picker candidates render');
      await pointer('click', map.map.project([0, 0]));
      check(Boolean(container.querySelector('.rl-picker')), 'Native click did not open the picker');
      replace = true;
      await browserClick('.rl-picker-pages button[aria-label="Next candidates"]');
      check(replacement.isConnected && document.activeElement === replacement && menuDisposed === 0, 'Obsolete picker page disposed replacement content or focus');
      await browserKey('Escape');
      check(!replacement.isConnected && menuDisposed === 1 && document.activeElement === canvas, 'Replacement menu dismissal lost disposal or focus');
      interactions.destroy(); interactions.destroy();
      check(menuDisposed === 1, 'Teardown disposed the replacement twice');
    } finally { interactions.destroy(); map.destroy(); }
  },
  "Reliability content lets a picker replace a pending menu factory": async caseContext => {
    const { own, container, until } = caseContext;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: [point('factory-a'), point('factory-b')], logger: () => {} }));
    await map.ready;
    let disposed = 0, opened = 0;
    const obsolete = document.createElement('button'); obsolete.textContent = 'Obsolete action';
    const interactions = attachInteractions(map, { contextMenu: event => {
      opened++;
      map.map.fire('click', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent });
      return { element: obsolete, dispose: () => { disposed++; } };
    } });
    try {
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).length === 2, 'factory replacement candidates render');
      const canvas = map.map.getCanvas(); canvas.focus();
      const rect = canvas.getBoundingClientRect(), location = map.map.project([0, 0]);
      if (!window.browserDrag) throw new Error('Browser input bridge unavailable');
      await window.browserDrag(rect.left + location.x, rect.top + location.y, rect.left + location.x, rect.top + location.y, 'right');
      check(opened === 1 && disposed === 1 && !obsolete.isConnected && !container.querySelector('.rl-context'), 'Menu factory overwrote a replacement picker');
      const picker = container.querySelector('.rl-picker');
      check(picker?.contains(document.activeElement) && picker.querySelectorAll('.rl-sector').length === 2, 'Replacement picker lost choices or focus');
      await browserKey('Escape');
      check(!container.querySelector('.rl-picker') && document.activeElement === canvas, 'Replacement picker dismissal lost focus');
      interactions.destroy(); interactions.destroy();
      check(disposed === 1, 'Obsolete menu content was disposed repeatedly');
    } finally { interactions.destroy(); map.destroy(); }
  },
} satisfies BrowserCaseModule;
