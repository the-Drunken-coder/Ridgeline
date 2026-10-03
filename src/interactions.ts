import { createFeatureContent } from './feature-content';
import type { FeatureContentRenderer, OverlayContent } from './feature-content';
import type { Interaction, MapFeature, Properties, Viewport } from './types';

export type { OverlayContent } from './feature-content';
export type InteractionOptions<P extends Properties> = {
  picker?: boolean;
  hover?: boolean;
  /** Show navigation and selectable-feature cursor feedback. */
  visualFeedback?: boolean;
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
    const element = active, previousChoices = [...choices.values()], disposers = activeDisposers, focus = focusBeforeOpen;
    active = null; candidates = []; choices.clear(); activeDisposers = []; focusBeforeOpen = null;
    // Detach all old ownership before disposal can synchronously open replacement UI.
    element?.remove(); hideTooltip();
    for (const choice of previousChoices) choice.content.destroy();
    release(disposers);
    if (restoreFocus && !disposed && operation === version && focus?.isConnected) focus.focus({ preventScroll: true });
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
  function request(id: string) {
    if (!viewport.getFeature(id)) return;
    close(true); viewport.requestSelection([id], clickedAttachments);
  }
  function button(label: string, action: () => void) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
    element.addEventListener('click', event => { event.stopPropagation(); action(); });
    return element;
  }
  function drawPicker(focus = false) {
    const picker = active;
    if (!picker || disposed) return;
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
  }
  subscriptions.push(viewport.on('click', event => {
    if (disposed) return;
    if (active) { close(); return; }
    const version = operation;
    hideTooltip();
    if (disposed || operation !== version || viewport.getInteractionOwner()) return;
    clickedAttachments = event.attachments;
    if (event.features.length > 1 && options.picker !== false) {
      operation++;
      candidates = event.features.map(feature => feature.id); anchor = event.point; page = 0;
      focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : viewport.map.getCanvas();
      active = document.createElement('div'); active.className = 'rl-picker'; active.setAttribute('role', 'group'); active.setAttribute('aria-label', 'Choose a feature');
      root.append(active); drawPicker(true);
    } else viewport.requestSelection(event.features[0] ? [event.features[0].id] : [], event.attachments);
  }));
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
    const version = close();
    const current = () => !disposed && operation === version;
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
    if (disposed) return;
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
  const closeOnMove = () => close();
  viewport.map.on('movestart', closeOnMove);
  viewport.map.on('resize', closeOnMove);
  function destroy() {
    if (disposed) return;
    disposed = true; close(); setCursor(undefined); abort.abort();
    viewport.map.off('movestart', closeOnMove); viewport.map.off('resize', closeOnMove);
    for (const unsubscribe of subscriptions) unsubscribe();
    root.remove();
  }
  subscriptions.push(viewport.on('interactionchange', ({ owner }) => {
    close(); hoveredFeature = false;
    if (owner) refreshCursor();
    else queueMicrotask(() => { if (!disposed) refreshCursor(); });
  }));
  subscriptions.push(viewport.on('destroy', destroy));
  return { destroy, close: () => close() };
}
