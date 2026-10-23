import { attachDrawing, attachDrawingControls, createViewport, shapeGeometry } from '@ridgeline/map';
import type { DrawingDecision, DrawingEditor, DrawingOptions, DrawingShape, MapFeature, Properties, Viewport } from '@ridgeline/map';
import { NavigationControl } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { captureMapPixels, pixelToCss, waitForVisible } from './browser-observation';

import type { BrowserCaseContext as Context, BrowserCaseModule } from './context';
const basemap: StyleSpecification = { version: 8, sources: {}, layers: [
  { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
] };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function line(id: string, revision: number): MapFeature {
  return { type: 'Feature', id, properties: { revision }, geometry: {
    type: 'LineString', coordinates: [[-.001, revision * .0004], [.001, revision * .0004]],
  } };
}
function arrow(id: string, latitude: number): MapFeature {
  const shape: DrawingShape = { kind: 'arrow', vertices: [[-.001, latitude], [.001, latitude]] };
  return { type: 'Feature', id, properties: {}, geometry: shapeGeometry(shape), drawing: { version: 1, shape,
    style: { color: '#d11f73', fillColor: '#d11f73', lineWidth: 6, fillOpacity: .2, dashed: false, label: '' } } };
}
async function key(value: string) {
  check(window.browserKey, 'Physical keyboard bridge required');
  await window.browserKey(value);
}
async function click(selector: string) {
  check(window.browserClick, 'Physical click bridge required');
  await window.browserClick(selector);
}
function mountControls(viewport: Viewport, editor: DrawingEditor,
  history?: Parameters<typeof attachDrawingControls>[2]['history']) {
  const tools = document.createElement('div'), inspector = document.createElement('div'), focus = document.createElement('button');
  tools.id = 'review-tools'; inspector.id = 'review-inspector'; focus.id = 'review-focus';
  focus.textContent = 'Focus controls';
  tools.style.cssText = 'position:absolute;left:0;top:0;width:100px;z-index:5';
  inspector.style.cssText = 'position:absolute;right:0;top:0;width:230px;height:100%;z-index:5';
  focus.style.cssText = 'position:absolute;left:110px;bottom:0;z-index:5';
  viewport.container.append(focus, tools, inspector);
  const controls = attachDrawingControls(viewport, editor, { tools, inspector, history });
  return { tools, inspector, focus, destroy() { controls.destroy(); tools.remove(); inspector.remove(); focus.remove(); } };
}
function shortcutCounts() {
  const captured: boolean[] = [], application: boolean[] = [];
  const matches = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
  const capture = (event: KeyboardEvent) => { if (matches(event)) captured.push(event.shiftKey); };
  const bubble = (event: KeyboardEvent) => { if (matches(event)) { check(!event.defaultPrevented, 'Application shortcut arrived already prevented'); application.push(event.shiftKey); } };
  document.addEventListener('keydown', capture, true);
  document.addEventListener('keydown', bubble);
  return { captured, application, destroy() { document.removeEventListener('keydown', capture, true); document.removeEventListener('keydown', bubble); } };
}


export const drawingReviewCases = {
  "Drawing review opening callbacks preserve conflicts and restart the latest accepted baseline": async ({ container, own }) => {
    for (const callback of ['style', 'interaction'] as const)
    for (const update of ['update', 'remove', 'unrelated'] as const) {
      const before = line('opening', 1), latest = line('opening', 2);
      let armed = false, invoked = 0, submitted = 0;
      const publish = () => {
        armed = false; invoked++;
        if (update === 'remove') viewport.remove([before.id]);
        else viewport.upsert([update === 'update' ? latest : { ...latest, id: 'other' }]);
      };
      const viewport = own(createViewport({ container, basemap, camera: { center: [0, 0], zoom: 16 },
        features: [before], logger: () => {}, style: feature => {
          if (armed && callback === 'style' && feature.id === before.id) publish();
          return { color: '#216e5b' };
        } }));
      await viewport.ready;
      const editor = attachDrawing<Properties>(viewport, { createFeature: () => ({ id: 'unused', properties: {} }),
        submit: () => { submitted++; return { accepted: true }; } });
      const off = viewport.on('interactionchange', ({ owner }) => { if (armed && callback === 'interaction' && owner === 'drawing') publish(); });
      try {
        armed = true; editor.edit(before.id);
        check(invoked === 1, `${callback}/${update} did not reach its opening callback once`);
        check(editor.getState().draft?.before?.properties.revision === 1, 'Opening replaced its original baseline');
        check(JSON.stringify(shapeGeometry(editor.getState().draft!.shape)) === JSON.stringify(before.geometry), 'Opening discarded the original draft');
        if (update === 'unrelated') {
          check(editor.getState().phase === 'editing', 'Unrelated update interrupted opening');
          check(await editor.finish(), 'Unrelated opening could not finish');
          check(submitted === 1 && viewport.getFeature('other')?.properties.revision === 2, 'Unrelated accepted data or submission was lost');
        } else {
          check(editor.getState().phase === 'conflict', `${callback}/${update} installed an obsolete editable draft`);
          let rejected = false;
          try { await editor.finish(); } catch (error) { rejected = error instanceof Error && /cannot be edited/.test(error.message); }
          check(rejected && submitted === 0, 'Conflicted opening reached consumer persistence');
          check(update === 'remove' ? !viewport.getFeature(before.id) : viewport.getFeature(before.id)?.properties.revision === 2,
            'Conflicted opening overwrote accepted data');
          if (update === 'update') {
            editor.restart();
            check(editor.getState().phase === 'editing' && editor.getState().draft?.before?.properties.revision === 2, 'Restart did not recover the latest baseline');
            editor.moveVertex(1, [.0015, .0008]);
            check(await editor.finish(), 'Restarted opening could not finish');
            check(viewport.getFeature(before.id)?.properties.revision === 2, 'Restart lost the latest properties');
          } else editor.cancel();
        }
        check(viewport.getInteractionOwner() === null, 'Completed opening retained its lease');
      } finally { off(); editor.destroy(); viewport.destroy(); }
    }
  },
  "Drawing review nested destroy preserves replacement resources handles navigation and registration": async ({ container, own, until }) => {
    const originalFeature = arrow('original', -.0008), replacementFeature = arrow('replacement', .0008);
    const viewport = own(createViewport({ container, basemap, camera: { center: [0, 0], zoom: 16 },
      features: [originalFeature, replacementFeature], logger: () => {} }));
    await viewport.ready;
    viewport.map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    const options: DrawingOptions<Properties> = { createFeature: () => ({ id: 'unused', properties: {} }), submit: () => ({ accepted: true }) };
    const original = attachDrawing(viewport, options);
    let replacement: DrawingEditor | undefined, sourceAtMount: ReturnType<typeof viewport.map.getSource>;
    let releases = 0, releasedNavigation = false;
    const off = viewport.on('interactionchange', ({ owner }) => {
      if (owner || releases) return;
      releases++;
      original.destroy();
      releasedNavigation = viewport.map.doubleClickZoom.isEnabled();
      replacement = attachDrawing(viewport, options);
      replacement.edit(replacementFeature.id);
      sourceAtMount = viewport.map.getSource('rl:draft');
    });
    try {
      check(viewport.map.doubleClickZoom.isEnabled(), 'Double-click navigation must begin enabled');
      original.edit(originalFeature.id);
      check(!viewport.map.doubleClickZoom.isEnabled(), 'Original draft did not own double-click completion');
      await until(() => !!viewport.map.getSource('rl:draft-arrows') && container.querySelectorAll('.rl-drawing-handle').length >= 3,
        'original draft arrow and handles mounted');
      original.destroy(); off();
      check(releases === 1 && replacement, 'Required nested destroy/remount callback did not complete');
      const editor = replacement;
      const retainedSource = viewport.map.getSource('rl:draft');
      check(sourceAtMount && retainedSource === sourceAtMount, 'Outer teardown removed the replacement source');
      check(viewport.map.getSource('rl:draft-arrows') && viewport.map.getLayer('rl:draft-arrow'), 'Outer teardown removed the replacement arrowhead');
      check(editor.getState().phase === 'editing' && viewport.getInteractionOwner() === 'drawing', 'Replacement lost draft or lease ownership');
      check(releasedNavigation && !viewport.map.doubleClickZoom.isEnabled(), 'Replacement inherited the old disabled double-click state');
      let blocked = false, extra: DrawingEditor | undefined;
      try { extra = attachDrawing(viewport, options); }
      catch (error) { blocked = error instanceof Error && /already attached/.test(error.message); }
      finally { extra?.destroy(); }
      check(blocked, 'Outer teardown removed the replacement attachment guard');
      await until(() => viewport.map.querySourceFeatures('rl:features').some(hit => hit.properties._rl_feature_id === replacementFeature.id), 'replacement accepted feature published');
      const accepted = viewport.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === replacementFeature.id);
      check(accepted?.id !== undefined, 'Replacement accepted source feature is missing');
      check(viewport.map.getFeatureState({ source: 'rl:features', id: accepted.id }).editing === true, 'Outer teardown cleared replacement editing state');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]');
      check(handle && !handle.disabled && handle.getBoundingClientRect().width > 0, 'Replacement handle is not visible and enabled');
      await waitForVisible(() => captureMapPixels(viewport), image => {
        const target = viewport.map.project([-.0004, .0008]);
        let ink = 0;
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const at = (y * image.width + x) * 4;
          if (image.bytes[at]! < 140 || image.bytes[at + 1]! > 85 || image.bytes[at + 2]! < 60) continue;
          const point = pixelToCss(image, { x, y });
          if (Math.abs(point.x - target.x) < 7 && Math.abs(point.y - target.y) < 7) ink++;
        }
        return ink >= 10;
      }, { timeout: 8000, description: 'replacement draft shaft pixels' });
      const shape = JSON.stringify(editor.getState().draft!.shape);
      handle.focus(); check(document.activeElement === handle, 'Replacement handle could not take focus');
      await key('ArrowRight');
      check(JSON.stringify(editor.getState().draft!.shape) !== shape && editor.getState().canUndo, 'Replacement handle did not edit its draft');
      await key('ControlOrMeta+z');
      check(JSON.stringify(editor.getState().draft!.shape) === shape, 'Replacement handle movement did not undo once');
      const zoom = viewport.map.getZoom();
      await click('.maplibregl-ctrl-zoom-in');
      await until(() => viewport.map.getZoom() > zoom + .9 && !viewport.map.isMoving(), 'replacement native navigation');
      original.destroy(); original.destroy();
      check(viewport.map.getSource('rl:draft') === retainedSource && editor.getState().phase === 'editing', 'Repeated old destroy changed replacement resources');
      check(await editor.finish(), 'Replacement could not finish');
      check(JSON.stringify(viewport.getFeature(replacementFeature.id)) === JSON.stringify(replacementFeature), 'Replacement finish damaged metadata or accepted geometry');
      check(viewport.getInteractionOwner() === null && viewport.map.doubleClickZoom.isEnabled(), 'Replacement did not restore double-click navigation and release ownership');
      const acceptedZoom = viewport.map.getZoom();
      await click('.maplibregl-ctrl-zoom-in');
      await until(() => viewport.map.getZoom() > acceptedZoom + .9 && !viewport.map.isMoving(), 'post-replacement native navigation');
      editor.destroy(); editor.destroy(); original.destroy();
      check(!viewport.map.getSource('rl:draft') && container.querySelectorAll('.rl-drawing-handle').length === 0, 'Replacement teardown retained its resources');
      const final = attachDrawing(viewport, options); final.start('line'); final.destroy();
      check(viewport.getInteractionOwner() === null && viewport.map.doubleClickZoom.isEnabled(), 'Fresh attachment after replacement lost navigation or ownership');
      viewport.map.doubleClickZoom.disable();
      const disabled = attachDrawing(viewport, options); disabled.start('line'); disabled.destroy();
      check(!viewport.map.doubleClickZoom.isEnabled(), 'Teardown enabled double-click navigation disabled by the consumer');
    } finally { off(); replacement?.destroy(); original.destroy(); viewport.destroy(); }
  },
  "Drawing review idle toolbar Undo and Redo reach application shortcuts once": async ({ container, own }) => {
    const viewport = own(createViewport({ container, basemap, logger: () => {} }));
    await viewport.ready;
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'idle', properties: {} }), submit: () => ({ accepted: true }) });
    const controls = mountControls(viewport, editor), shortcuts = shortcutCounts();
    try {
      await click('#review-focus'); await key('Tab');
      check(document.activeElement === controls.tools.querySelector('[data-field="action:Line"]') && editor.getState().phase === 'idle', 'Native Tab did not focus an idle drawing tool');
      await key('ControlOrMeta+z');
      check(JSON.stringify(shortcuts.captured) === '[false]' && JSON.stringify(shortcuts.application) === '[false]', 'Idle toolbar swallowed or duplicated application Undo');
      await key('ControlOrMeta+Shift+z');
      check(JSON.stringify(shortcuts.captured) === '[false,true]' && JSON.stringify(shortcuts.application) === '[false,true]', 'Idle toolbar swallowed or duplicated application Redo');
      await click('#review-focus'); await key('ControlOrMeta+z'); await key('ControlOrMeta+Shift+z');
      check(JSON.stringify(shortcuts.application) === '[false,true,false,true]' && shortcuts.captured.length === 4, 'Outside-toolbar shortcut control did not reach the application once per key');
      check(editor.getState().phase === 'idle' && viewport.getInteractionOwner() === null, 'Idle shortcuts opened a draft or interaction lease');
    } finally { shortcuts.destroy(); controls.destroy(); editor.destroy(); viewport.destroy(); }
  },
  "Drawing review nested draft and supplied history shortcuts perform exactly one owned action": async ({ container, own }) => {
    const viewport = own(createViewport({ container, basemap, camera: { center: [0, 0], zoom: 14 }, logger: () => {} }));
    await viewport.ready;
    let settle: ((decision: DrawingDecision) => void) | undefined;
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'shortcuts', properties: {} }),
      submit: () => new Promise<DrawingDecision>(resolve => { settle = resolve; }) });
    const historyActions: string[] = [];
    let historyPosition = 1, draftActions = 0;
    const controls = mountControls(viewport, editor, {
      undo() { historyActions.push('undo'); historyPosition--; }, redo() { historyActions.push('redo'); historyPosition++; },
      canUndo: () => historyPosition > 0, canRedo: () => historyPosition < 1,
    });
    const shortcuts = shortcutCounts();
    const off = editor.onChange(() => { draftActions++; });
    const focusAction = (name: string) => {
      const button = controls.inspector.querySelector<HTMLButtonElement>(`[data-field="action:${name}"]`);
      check(button && !button.disabled, `Required ${name} control is unavailable`);
      button.focus(); check(document.activeElement === button, `Required ${name} control lost focus`);
    };
    let pending: Promise<boolean> | undefined;
    try {
      focusAction('Undo'); await key('ControlOrMeta+z');
      check(historyPosition === 0 && JSON.stringify(historyActions) === '["undo"]', 'Accepted history Undo ran more than once');
      focusAction('Redo'); await key('ControlOrMeta+Shift+z');
      check(Number(historyPosition) === 1 && JSON.stringify(historyActions) === '["undo","redo"]', 'Accepted history Redo ran more than once');
      await click('#review-tools [data-field="action:Line"]');
      editor.addPoint([-.001, 0]); editor.addPoint([0, .001]); editor.addPoint([.001, 0]);
      draftActions = 0;
      focusAction('Undo'); await key('ControlOrMeta+z');
      let shape = editor.getState().draft?.shape;
      check(shape?.kind === 'line' && shape.vertices.length === 2 && draftActions === 1, 'Nested draft Undo did not perform exactly one action');
      focusAction('Redo'); await key('ControlOrMeta+Shift+z');
      shape = editor.getState().draft?.shape;
      check(shape?.kind === 'line' && shape.vertices.length === 3 && Number(draftActions) === 2, 'Nested draft Redo did not perform exactly one action');
      check(JSON.stringify(historyActions) === '["undo","redo"]' && shortcuts.application.length === 0, 'Draft shortcut escaped to accepted history or the application');
      pending = editor.finish();
      check(editor.getState().phase === 'pending' && settle, 'Required pending submission was not reached');
      const pendingShape = JSON.stringify(editor.getState().draft!.shape);
      const panel = controls.inspector.querySelector<HTMLElement>('.rl-drawing-inspector');
      check(panel, 'Pending drawing inspector is missing'); panel.tabIndex = 0; panel.focus();
      check(document.activeElement === panel, 'Pending inspector could not take focus');
      draftActions = 0;
      await key('ControlOrMeta+z'); await key('ControlOrMeta+Shift+z');
      check(editor.getState().phase === 'pending' && JSON.stringify(editor.getState().draft!.shape) === pendingShape && draftActions === 0,
        'Disabled pending Undo or Redo changed the draft');
      check(shortcuts.application.length === 0 && historyActions.length === 2, 'Pending draft shortcut escaped its owner');
      settle({ accepted: false, reason: 'Review rejection' });
      check(await pending === false && editor.getState().phase === 'rejected', 'Pending draft did not recover after rejection');
      pending = undefined;
      await click('#review-inspector [data-field="Label"]');
      await key('ControlOrMeta+z');
      check(JSON.stringify(shortcuts.application) === '[false]', 'Form-field Undo exclusion did not preserve the application shortcut');
      check(JSON.stringify(historyActions) === '["undo","redo"]' && shortcuts.captured.length === 7, 'Shortcut ownership lost or duplicated a physical key');
      editor.cancel();
      check(viewport.getInteractionOwner() === null && !viewport.getFeature('shortcuts'), 'Rejected shortcut workflow changed accepted data');
    } finally {
      settle?.({ accepted: false, reason: 'Test cleanup' }); if (pending) await pending;
      off(); shortcuts.destroy(); controls.destroy(); editor.destroy(); viewport.destroy();
    }
  },
} satisfies BrowserCaseModule;
