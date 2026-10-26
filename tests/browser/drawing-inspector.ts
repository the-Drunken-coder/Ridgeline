import { createViewport, attachDrawing, attachDrawingControls } from '@ridgeline/map';
import { style, check, pointer } from './helpers';
import type { BrowserCaseModule } from './context';


export const drawingInspectorCases = {
  "An earlier pointer release cannot replace controls during a later native press": async caseContext => {
    const { own, container } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'successive-presses', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:600px;z-index:10';
    container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    const schedule = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
    const delayed = new Map<number, () => void>();
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      editor.setStyle({ label: 'first' }); editor.setStyle({ label: 'second' });
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      const button = inspector.querySelector<HTMLButtonElement>('[data-field="action:Undo"]')!;
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      // Deliver zero-delay tasks after the next native press, reproducing a busy browser event loop.
      Object.defineProperty(window, 'setTimeout', { configurable: true, writable: true, value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay !== 0 || typeof handler !== 'function') return schedule(handler, delay, ...args);
        const id = schedule(() => {}, 60_000);
        delayed.set(id, () => handler(...args));
        return id;
      } });
      Object.defineProperty(window, 'clearTimeout', { configurable: true, writable: true, value: (id?: number) => { if (id !== undefined) delayed.delete(id); clear(id); } });
      await window.browserMouse('down', x, y); await window.browserMouse('up', x, y);
      check(editor.getState().draft?.style.label === 'first', 'First native Undo did not run');
      await window.browserMouse('down', x, y);
      window.setTimeout = schedule; window.clearTimeout = clear;
      for (const [id, callback] of delayed) { clear(id); callback(); }
      delayed.clear();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(button.isConnected, 'An older pointer release replaced the button held by the next press');
      await window.browserMouse('up', x, y);
      check(editor.getState().draft?.style.label === '', 'Second native Undo did not run');
    } finally {
      window.setTimeout = schedule; window.clearTimeout = clear;
      for (const id of delayed.keys()) clear(id);
      if (window.browserMouse) await window.browserMouse('up', 0, 0);
      controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
    }
  },
  "Inspector resumes updates after window blur or lost pointer capture": async caseContext => {
    const { own, container, until } = caseContext;
    const draw = own(createViewport({ container, basemap: style(), logger: () => {} }));
    await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'pointer-loss', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:600px;z-index:10';
    container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      for (const loss of ['blur', 'capture']) {
        const output = inspector.querySelector('output')!;
        output.scrollIntoView({ block: 'center' });
        let pointerId: number | undefined;
        if (loss === 'capture') output.addEventListener('pointerdown', event => {
          pointerId = event.pointerId;
          output.setPointerCapture(event.pointerId);
        }, { once: true });
        const rect = output.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        await window.browserMouse('down', x, y);
        if (loss === 'capture') await window.browserMouse('move', x + 1, y);
        try {
          editor.setStyle({ label: loss });
          check(inspector.querySelector<HTMLInputElement>('[data-field="Label"]')?.value !== loss, `Control rebuilt before the ${loss} pointer press ended`);
          if (loss === 'blur') {
            // Browser focus loss is controlled here; the preceding pointer press is native.
            window.dispatchEvent(new Event('blur'));
          } else {
            check(pointerId !== undefined, 'Native press did not reach the inspector');
            output.releasePointerCapture(pointerId!);
            await window.browserMouse('move', x + 2, y);
          }
          await until(() => inspector.querySelector<HTMLInputElement>('[data-field="Label"]')?.value === loss, `inspector update after ${loss}`);
        } finally { await window.browserMouse('up', x, y); }
      }
    } finally { controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove(); }
  },
} satisfies BrowserCaseModule;
