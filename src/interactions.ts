import { createFeatureContent } from './feature-content';
import { attachBoxSelection } from './box-selection';
import { getViewportAttachmentInternals } from './viewport-attachments';
import type { FeatureContentRenderer, OverlayContent } from './feature-content';
import type { Interaction, MapFeature, Properties, Viewport } from './types';

export type { OverlayContent } from './feature-content';
export type InteractionOptions<P extends Properties> = {
  picker?: boolean;
  hover?: boolean;
  /** Show navigation and selectable-feature cursor feedback. */
  visualFeedback?: boolean;
  /** Shift-click toggles a candidate against the consumer's current selection. */
  additiveSelection?: boolean;
  /** Alt-left drag replaces selection; Alt-Shift-left drag adds. Native Shift box zoom is retained. */
  boxSelection?: boolean;
  /** Own the markup while Ridgeline owns placement and lifetime. */
  renderFeature?: FeatureContentRenderer<P>;
  contextMenu?: (interaction: Interaction<P>, close: () => void) => HTMLElement | OverlayContent | null;
};

/** Optional DOM UI. Attaching it does not take ownership of application selection. */
export function attachInteractions<P extends Properties>(viewport: Viewport<P>, options: InteractionOptions<P> = {}) {
  const root = document.createElement('div');
  root.className = 'rl-ui';
  viewport.container.append(root);
  const abort = new AbortController();
  const subscriptions: (() => void)[] = [];
  let disposed = false;
  let operation = 0;
  let active: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  let tooltipFeatureId: string | null = null;
  let tooltipPoint: { x: number; y: number } | null = null;
  let page = 0;
  let candidates: string[] = [];
  let anchor = { x: 0, y: 0 };
  let activeDisposers: (() => void)[] = [];
  let tooltipContent: ReturnType<typeof createFeatureContent<P>> | null = null;
  let focusBeforeOpen: HTMLElement | null = null;
  let buildingPicker = false;
  const canvas = viewport.map.getCanvas();
  let cursorBefore = '';
  let cursorValue: 'grab' | 'grabbing' | 'pointer' | undefined;
  let overCanvas = false;
  let pressed = false;
  let hoveredFeature = false;
  function setCursor(value: typeof cursorValue) {
    if (options.visualFeedback === false) return;
    if (value === cursorValue) return;
    if (cursorValue && canvas.style.cursor === cursorValue) canvas.style.cursor = cursorBefore;
    cursorValue = undefined;
    if (value && !viewport.getInteractionOwner()) {
      cursorBefore = canvas.style.cursor;
      canvas.style.cursor = value;
      cursorValue = value;
    }
  }
  function refreshCursor() {
    setCursor(overCanvas && !viewport.getInteractionOwner()
      ? pressed ? 'grabbing' : hoveredFeature ? 'pointer' : 'grab'
      : undefined);
  }
  const choices = new Map<string, {
    button: HTMLButtonElement;
    content: ReturnType<typeof createFeatureContent<P>>;
  }>();

  function releaseChoices() {
    const previous = [...choices.values()];
    choices.clear();
    for (const choice of previous) choice.content.destroy();
  }
  function refreshChoice(id: string) {
    const choice = choices.get(id);
    if (!choice) return;
    const feature = viewport.getFeature(id);
    const result = choice.content.update(feature);
    if (!result || disposed || choices.get(id) !== choice) return;
    const hadFocus = document.activeElement === choice.button;
    choice.button.disabled = !feature;
    choice.button.setAttribute('aria-label', feature ? `Select ${result.name}` : 'Feature no longer available');
    if (!feature && hadFocus) {
      const buttons = [...choices.values()].map(item => item.button);
      const index = buttons.indexOf(choice.button);
      const next = [...buttons.slice(index + 1), ...buttons.slice(0, index)].find(button => !button.disabled);
      (next ?? active?.querySelector<HTMLButtonElement>('.rl-picker-close'))?.focus({ preventScroll: true });
    }
  }

  function release(disposers: (() => void)[]) {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch { /* Finish disposing the remaining UI. */ } }
  }
  function hideTooltip() {
    const element = tooltip, content = tooltipContent;
    tooltip = null; tooltipContent = null; tooltipFeatureId = null; tooltipPoint = null;
    viewport.preview(null); element?.remove(); content?.destroy();
  }
  function close(restoreFocus = false) {
    const version = ++operation;
    const restoreRemovedFocus = Boolean(active?.contains(document.activeElement));
    const element = active, previousChoices = [...choices.values()], disposers = activeDisposers, focus = focusBeforeOpen;
    active = null; candidates = []; choices.clear(); activeDisposers = []; focusBeforeOpen = null;
    // Detach all old ownership before disposal can synchronously open replacement UI.
    element?.remove(); hideTooltip();
    for (const choice of previousChoices) choice.content.destroy();
    release(disposers);
    if (restoreFocus && restoreRemovedFocus && !disposed && operation === version && focus?.isConnected &&
      (document.activeElement === document.body || !document.activeElement?.isConnected)) focus.focus({ preventScroll: true });
    return version;
  }
  function position(element: HTMLElement, point: { x: number; y: number }, centered = false) {
    const width = element.offsetWidth, height = element.offsetHeight;
    element.style.left = `${Math.max(4, Math.min(viewport.container.clientWidth - width - 4, point.x - (centered ? width / 2 : 0)))}px`;
    element.style.top = `${Math.max(4, Math.min(viewport.container.clientHeight - height - 4, point.y - (centered ? height / 2 : 0)))}px`;
  }
  function hover(feature: MapFeature<P>, point: { x: number; y: number }) {
    if (disposed) return;
    let element = tooltip, content = tooltipContent;
    if (!element || !content) {
      element = document.createElement('div'); element.className = 'rl-tooltip'; element.setAttribute('role', 'tooltip');
      content = createFeatureContent(element, viewport, options.renderFeature);
      tooltip = element; tooltipContent = content;
    }
    tooltipFeatureId = feature.id;
    tooltipPoint = point;
    if (!content.update(feature) || disposed || tooltipContent !== content) return;
    if (element.parentNode !== root) root.append(element);
    if (disposed || tooltipContent !== content) return;
    position(element, { x: point.x + 16, y: point.y + 18 });
    viewport.preview(feature.id);
  }
  let clickedAttachments: Interaction<P>['attachments'] = [];
  let additiveClick = false;
  let sceneRevision = 0;
  function clickIds(id?: string) {
    if (!additiveClick) return id ? [id] : [];
    const selection = viewport.getSelection();
    return !id ? selection : selection.includes(id) ? selection.filter(value => value !== id) : [...selection, id];
  }
  function request(id: string) {
    if (!viewport.getFeature(id)) return;
    const attachments = clickedAttachments, revision = sceneRevision, ids = clickIds(id), version = close(true);
    if (!disposed && operation === version && revision === sceneRevision && !viewport.getInteractionOwner() && viewport.getFeature(id))
      viewport.requestSelection(ids, attachments);
  }
  function button(label: string, action: () => void) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
    element.addEventListener('click', event => { event.stopPropagation(); action(); });
    return element;
  }
  function drawPicker(focus = false) {
    const picker = active;
    if (!picker || disposed) return;
    buildingPicker = true;
    try {
      const disposers = activeDisposers; activeDisposers = [];
      releaseChoices(); release(disposers);
      if (disposed || active !== picker) return;
      picker.replaceChildren();
      const size = Math.min(360, viewport.container.clientWidth - 12, viewport.container.clientHeight - 12);
      picker.style.width = `${size}px`; picker.style.height = `${size}px`;
      const center = size / 2, radius = center - 3, inside = Math.min(60, radius * .4);
      const slice = candidates.slice(page * 8, page * 8 + 8);
      const buttons: HTMLButtonElement[] = [];
      for (const [index, id] of slice.entries()) {
        if (disposed || active !== picker) return;
        const angle = -Math.PI / 2 + index * Math.PI * 2 / slice.length;
        const start = angle - Math.PI / slice.length + .008;
        const end = angle + Math.PI / slice.length - .008;
        const points: string[] = [];
        for (let step = 0; step <= 24; step++) {
          const a = start + (end - start) * step / 24;
          points.push(`${center + radius * Math.cos(a)}px ${center + radius * Math.sin(a)}px`);
        }
        for (let step = 24; step >= 0; step--) {
          const a = start + (end - start) * step / 24;
          points.push(`${center + inside * Math.cos(a)}px ${center + inside * Math.sin(a)}px`);
        }
        const choice = button('', () => request(id));
        choice.className = 'rl-sector'; choice.dataset.featureId = id;
        choice.style.clipPath = `polygon(${points.join(',')})`;
        const label = document.createElement('span'); label.className = 'rl-sector-label';
        const labelRadius = (radius + inside) / 2;
        label.style.left = `${center + Math.cos(angle) * labelRadius}px`;
        label.style.top = `${center + Math.sin(angle) * labelRadius}px`;
        if (size < 330) label.style.width = '68px';
        choices.set(id, { button: choice, content: createFeatureContent(label, viewport, options.renderFeature) });
        refreshChoice(id);
        if (disposed || active !== picker) return;
        choice.append(label);
        const show = () => { const current = viewport.getFeature(id); if (current) viewport.preview(id); };
        choice.addEventListener('mouseenter', show); choice.addEventListener('focus', show);
        choice.addEventListener('mouseleave', () => viewport.preview(null));
        choice.addEventListener('blur', () => viewport.preview(null));
        choice.addEventListener('keydown', event => {
          if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const enabled = buttons.filter(item => !item.disabled);
          const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
          enabled[(enabled.indexOf(choice) + direction + enabled.length) % enabled.length]?.focus({ preventScroll: true });
        });
        buttons.push(choice); picker.append(choice);
      }
      if (disposed || active !== picker) return;
      const hub = document.createElement('div'); hub.className = 'rl-picker-hub';
      const count = document.createElement('strong'); count.textContent = `${candidates.length} features`;
      const range = document.createElement('span'); range.textContent = `${page * 8 + 1}–${Math.min((page + 1) * 8, candidates.length)} of ${candidates.length}`;
      const nav = document.createElement('div'); nav.className = 'rl-picker-pages';
      const previous = button('‹', () => { page--; drawPicker(true); }); previous.setAttribute('aria-label', 'Previous candidates'); previous.disabled = page === 0;
      const next = button('›', () => { page++; drawPicker(true); }); next.setAttribute('aria-label', 'Next candidates'); next.disabled = (page + 1) * 8 >= candidates.length;
      const dismiss = button('Close', () => close(true)); dismiss.className = 'rl-picker-close';
      nav.append(previous, next); hub.append(count, range, nav, dismiss); picker.append(hub);
      position(picker, anchor, true);
      if (focus) buttons.find(item => !item.disabled)?.focus({ preventScroll: true });
    } finally { buildingPicker = false; }
  }
  const onClick = (event: Interaction<P>) => {
    if (disposed) return;
    if (active) { close(); return; }
    const version = operation, revision = sceneRevision;
    hideTooltip();
    if (disposed || operation !== version || revision !== sceneRevision || viewport.getInteractionOwner()) return;
    clickedAttachments = event.attachments;
    additiveClick = options.additiveSelection === true && event.originalEvent.shiftKey;
    if (event.features.length > 1 && options.picker !== false) {
      operation++;
      candidates = event.features.map(feature => feature.id); anchor = event.point; page = 0;
      focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : viewport.map.getCanvas();
      active = document.createElement('div'); active.className = 'rl-picker'; active.setAttribute('role', 'group'); active.setAttribute('aria-label', 'Choose a feature');
      root.append(active); drawPicker(true);
    } else viewport.requestSelection(clickIds(event.features[0]?.id), event.attachments);
  };
  subscriptions.push(viewport.on('click', onClick));
  // One gesture decision owns the Shift click/box-zoom boundary. MapLibre's
  // equality-only mouseup check treats even sub-threshold jitter as a zoom.
  // Data invalidates picking, while only gesture loss invalidates a held press.
  // Release re-picks the current display; the epoch also guards reentrant reset.
  let shiftRevision = 0;
  let shiftPress: { start: { x: number; y: number }; revision: number; dragged: boolean } | undefined;
  let suppressShiftClick = false;
  const mousePoint = (event: MouseEvent) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left - canvas.clientLeft, y: event.clientY - bounds.top - canvas.clientTop };
  };
  canvas.addEventListener('mousedown', event => {
    suppressShiftClick = false;
    if (options.additiveSelection && event.shiftKey && !event.altKey && event.button === 0 && !viewport.getInteractionOwner())
      shiftPress = { start: mousePoint(event), revision: shiftRevision, dragged: false };
  }, { capture: true, signal: abort.signal });
  window.addEventListener('mousemove', event => {
    if (shiftPress) {
      const point = mousePoint(event);
      shiftPress.dragged ||= Math.hypot(point.x - shiftPress.start.x, point.y - shiftPress.start.y) >= 3;
    }
  }, { capture: true, signal: abort.signal });
  window.addEventListener('mouseup', event => {
    if (!shiftPress || event.button !== 0) return;
    const press = shiftPress; shiftPress = undefined;
    const point = mousePoint(event);
    if (press.dragged || Math.hypot(point.x - press.start.x, point.y - press.start.y) >= 3) return;
    viewport.map.boxZoom.reset();
    suppressShiftClick = true;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!disposed && press.revision === shiftRevision && !viewport.getInteractionOwner())
      getViewportAttachmentInternals(viewport)?.dispatchClick(point, event);
  }, { capture: true, signal: abort.signal });
  canvas.addEventListener('click', event => {
    if (suppressShiftClick) { suppressShiftClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, signal: abort.signal });
  const cancelShift = () => {
    shiftRevision++;
    if (!shiftPress) return;
    shiftPress = undefined; suppressShiftClick = true; viewport.map.boxZoom.reset();
  };
  window.addEventListener('blur', cancelShift, { signal: abort.signal });
  canvas.addEventListener('blur', cancelShift, { signal: abort.signal });
  document.addEventListener('pointercancel', cancelShift, { signal: abort.signal });
  canvas.addEventListener('lostpointercapture', cancelShift, { signal: abort.signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelShift(); }, { signal: abort.signal });
  subscriptions.push(viewport.on('hover', event => {
    if (disposed) return;
    hoveredFeature = Boolean(event.features[0]);
    refreshCursor();
    if (active || options.hover === false) return;
    const feature = event.features[0];
    if (feature) hover(feature, event.point); else hideTooltip();
  }));
  subscriptions.push(viewport.on('contextmenu', event => {
    if (disposed || !options.contextMenu) return;
    event.originalEvent.preventDefault();
    const revision = sceneRevision, version = close();
    const current = () => !disposed && operation === version && sceneRevision === revision;
    if (!current()) return;
    focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const custom = options.contextMenu(event, () => { if (current()) close(true); });
    if (!current()) {
      if (custom && !(custom instanceof HTMLElement) && custom.dispose) release([custom.dispose]);
      return;
    }
    if (!custom) return;
    const element = document.createElement('div'); element.className = 'rl-context';
    active = element;
    if (custom instanceof HTMLElement) element.append(custom);
    else { element.append(custom.element); if (custom.dispose) activeDisposers.push(custom.dispose); }
    root.append(element);
    if (!current()) return;
    position(element, event.point);
    element.querySelector('button')?.focus({ preventScroll: true });
  }));
  subscriptions.push(viewport.on('datachange', event => {
    sceneRevision++;
    if (disposed) return;
    if (buildingPicker && active) { close(); return; }
    if (tooltipFeatureId && event.removed.includes(tooltipFeatureId)) hideTooltip();
    else if (tooltipFeatureId && tooltipPoint && event.ids.includes(tooltipFeatureId)) {
      const feature = viewport.getFeature(tooltipFeatureId);
      if (feature) hover(feature, tooltipPoint);
    }
    for (const id of new Set([...event.ids, ...event.removed])) refreshChoice(id);
  }));
  root.addEventListener('click', event => event.stopPropagation(), { signal: abort.signal });
  root.addEventListener('dblclick', event => event.stopPropagation(), { signal: abort.signal });
  root.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); }, { signal: abort.signal });
  root.addEventListener('pointerdown', event => event.stopPropagation(), { signal: abort.signal });
  root.addEventListener('mousedown', event => event.stopPropagation(), { signal: abort.signal });
  root.addEventListener('touchstart', event => event.stopPropagation(), { signal: abort.signal });
  root.addEventListener('wheel', event => event.stopPropagation(), { signal: abort.signal });
  viewport.container.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (active) { close(true); event.stopPropagation(); }
    else hideTooltip();
  }, { signal: abort.signal });
  viewport.container.addEventListener('mouseleave', hideTooltip, { signal: abort.signal });
  canvas.addEventListener('mouseenter', () => { overCanvas = true; refreshCursor(); }, { signal: abort.signal });
  canvas.addEventListener('mousemove', () => { overCanvas = true; refreshCursor(); }, { signal: abort.signal });
  canvas.addEventListener('mouseleave', () => { overCanvas = false; pressed = false; hoveredFeature = false; refreshCursor(); }, { signal: abort.signal });
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') { pressed = true; refreshCursor(); }
  }, { signal: abort.signal });
  document.addEventListener('pointerup', () => { pressed = false; refreshCursor(); }, { signal: abort.signal });
  document.addEventListener('pointercancel', () => { pressed = false; refreshCursor(); }, { signal: abort.signal });
  window.addEventListener('blur', () => { pressed = false; overCanvas = false; refreshCursor(); }, { signal: abort.signal });
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !viewport.container.contains(event.target)) close();
  }, { signal: abort.signal });
  const closeOnMove = () => { sceneRevision++; cancelShift(); close(); };
  const internals = getViewportAttachmentInternals(viewport);
  if (internals) subscriptions.push(internals.onViewInvalidation(reason => {
    if (reason.kind === 'resize' || reason.kind === 'camera' && reason.phase === 'start') closeOnMove();
    else if (reason.kind !== 'camera' || reason.phase !== 'end') cancelShift();
  }));
  subscriptions.push(viewport.on('entitychange', () => { sceneRevision++; }));
  const boxSelection = options.boxSelection ? attachBoxSelection(viewport, () => close(true)) : undefined;
  function destroy() {
    if (disposed) return;
    disposed = true; cancelShift(); boxSelection?.destroy(); close(); setCursor(undefined); abort.abort();
    for (const unsubscribe of subscriptions) unsubscribe();
    root.remove();
  }
  subscriptions.push(viewport.on('interactionchange', ({ owner }) => {
    cancelShift();
    sceneRevision++;
    close(); hoveredFeature = false;
    if (owner) refreshCursor();
    else queueMicrotask(() => { if (!disposed) refreshCursor(); });
  }));
  subscriptions.push(viewport.on('destroy', destroy));
  return { destroy, close: () => close() };
}
