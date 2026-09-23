import type { Interaction, MapFeature, Properties, Viewport } from './types';

export type OverlayContent = { element: HTMLElement; dispose?: () => void };
export type InteractionOptions<P extends Properties> = {
  picker?: boolean;
  hover?: boolean;
  /** Own the markup while Ridgeline owns placement and lifetime. */
  renderFeature?: (feature: MapFeature<P>) => HTMLElement | OverlayContent;
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
  let active: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  let page = 0;
  let candidates: string[] = [];
  let anchor = { x: 0, y: 0 };
  let activeDisposers: (() => void)[] = [];
  let tooltipDisposers: (() => void)[] = [];
  let focusBeforeOpen: HTMLElement | null = null;

  function release(disposers: (() => void)[]) {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch { /* Finish disposing the remaining UI. */ } }
  }
  function content(feature: MapFeature<P>, disposers: (() => void)[]) {
    const custom = options.renderFeature?.(feature);
    if (custom) {
      if (custom instanceof HTMLElement) return custom;
      if (custom.dispose) disposers.push(custom.dispose);
      return custom.element;
    }
    const element = document.createElement('span');
    element.className = 'rl-feature-content';
    const style = viewport.getStyle(feature);
    const icon = style.icon && viewport.getIcon(style.icon);
    if (icon) {
      if (icon.url) {
        const image = document.createElement('img'); image.src = icon.url; image.alt = ''; image.width = 20; image.height = 20; element.append(image);
      } else {
        const canvas = document.createElement('canvas'); canvas.width = icon.image.width; canvas.height = icon.image.height;
        const context = canvas.getContext('2d');
        if (icon.image instanceof ImageData) context?.putImageData(icon.image, 0, 0); else context?.drawImage(icon.image, 0, 0);
        canvas.setAttribute('aria-hidden', 'true'); element.append(canvas);
      }
    }
    const name = document.createElement('span'); name.textContent = viewport.getName(feature); element.append(name);
    return element;
  }
  function hideTooltip() { tooltip?.remove(); tooltip = null; release(tooltipDisposers); viewport.preview(null); }
  function close(restoreFocus = false) {
    active?.remove(); active = null; candidates = [];
    release(activeDisposers); hideTooltip();
    if (restoreFocus && focusBeforeOpen?.isConnected) focusBeforeOpen.focus({ preventScroll: true });
    focusBeforeOpen = null;
  }
  function position(element: HTMLElement, point: { x: number; y: number }, centered = false) {
    const width = element.offsetWidth, height = element.offsetHeight;
    element.style.left = `${Math.max(4, Math.min(viewport.container.clientWidth - width - 4, point.x - (centered ? width / 2 : 0)))}px`;
    element.style.top = `${Math.max(4, Math.min(viewport.container.clientHeight - height - 4, point.y - (centered ? height / 2 : 0)))}px`;
  }
  function hover(feature: MapFeature<P>, point: { x: number; y: number }) {
    hideTooltip();
    tooltip = document.createElement('div'); tooltip.className = 'rl-tooltip'; tooltip.setAttribute('role', 'tooltip');
    tooltip.append(content(feature, tooltipDisposers)); root.append(tooltip);
    position(tooltip, { x: point.x + 16, y: point.y + 18 });
    viewport.preview(feature.id);
  }
  function request(id: string) {
    if (!viewport.getFeature(id)) return;
    close(true); viewport.requestSelection([id]);
  }
  function button(label: string, action: () => void) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
    element.addEventListener('click', event => { event.stopPropagation(); action(); });
    return element;
  }
  function drawPicker(focus = false) {
    if (!active) return;
    release(activeDisposers); active.replaceChildren();
    const size = Math.min(360, viewport.container.clientWidth - 12, viewport.container.clientHeight - 12);
    active.style.width = `${size}px`; active.style.height = `${size}px`;
    const center = size / 2, radius = center - 3, inside = Math.min(60, radius * .4);
    const slice = candidates.slice(page * 8, page * 8 + 8);
    const buttons: HTMLButtonElement[] = [];
    slice.forEach((id, index) => {
      const feature = viewport.getFeature(id);
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
      choice.disabled = !feature;
      choice.setAttribute('aria-label', feature ? `Select ${viewport.getName(feature)}` : 'Feature no longer available');
      const label = document.createElement('span'); label.className = 'rl-sector-label';
      const labelRadius = (radius + inside) / 2;
      label.style.left = `${center + Math.cos(angle) * labelRadius}px`;
      label.style.top = `${center + Math.sin(angle) * labelRadius}px`;
      if (size < 330) label.style.width = '68px';
      if (feature) label.append(content(feature, activeDisposers)); else label.textContent = 'Unavailable';
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
      buttons.push(choice); active?.append(choice);
    });
    const hub = document.createElement('div'); hub.className = 'rl-picker-hub';
    const count = document.createElement('strong'); count.textContent = `${candidates.length} features`;
    const range = document.createElement('span'); range.textContent = `${page * 8 + 1}–${Math.min((page + 1) * 8, candidates.length)} of ${candidates.length}`;
    const nav = document.createElement('div'); nav.className = 'rl-picker-pages';
    const previous = button('‹', () => { page--; drawPicker(true); }); previous.setAttribute('aria-label', 'Previous candidates'); previous.disabled = page === 0;
    const next = button('›', () => { page++; drawPicker(true); }); next.setAttribute('aria-label', 'Next candidates'); next.disabled = (page + 1) * 8 >= candidates.length;
    const dismiss = button('Close', () => close(true)); dismiss.className = 'rl-picker-close';
    nav.append(previous, next); hub.append(count, range, nav, dismiss); active.append(hub);
    position(active, anchor, true);
    if (focus) buttons.find(item => !item.disabled)?.focus({ preventScroll: true });
  }
  subscriptions.push(viewport.on('click', event => {
    if (active) { close(); return; }
    hideTooltip();
    if (event.features.length > 1 && options.picker !== false) {
      candidates = event.features.map(feature => feature.id); anchor = event.point; page = 0;
      focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : viewport.map.getCanvas();
      active = document.createElement('div'); active.className = 'rl-picker'; active.setAttribute('role', 'group'); active.setAttribute('aria-label', 'Choose a feature');
      root.append(active); drawPicker(true);
    } else viewport.requestSelection(event.features[0] ? [event.features[0].id] : []);
  }));
  subscriptions.push(viewport.on('hover', event => {
    if (active || options.hover === false) return;
    const feature = event.features[0];
    if (feature) hover(feature, event.point); else hideTooltip();
  }));
  subscriptions.push(viewport.on('contextmenu', event => {
    if (!options.contextMenu) return;
    event.originalEvent.preventDefault(); close();
    const custom = options.contextMenu(event, () => close(true));
    if (!custom) return;
    focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active = document.createElement('div'); active.className = 'rl-context';
    if (custom instanceof HTMLElement) active.append(custom);
    else { active.append(custom.element); if (custom.dispose) activeDisposers.push(custom.dispose); }
    root.append(active); position(active, event.point);
    active.querySelector('button')?.focus({ preventScroll: true });
  }));
  subscriptions.push(viewport.on('datachange', event => {
    if (event.removed.length) hideTooltip();
    for (const element of root.querySelectorAll<HTMLButtonElement>('[data-feature-id]')) {
      if (event.removed.includes(element.dataset.featureId ?? '')) { element.disabled = true; element.setAttribute('aria-label', 'Feature no longer available'); }
    }
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
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !viewport.container.contains(event.target)) close();
  }, { signal: abort.signal });
  const closeOnMove = () => close();
  viewport.map.on('movestart', closeOnMove);
  viewport.map.on('resize', closeOnMove);
  function destroy() {
    if (disposed) return;
    disposed = true; close(); abort.abort();
    viewport.map.off('movestart', closeOnMove); viewport.map.off('resize', closeOnMove);
    for (const unsubscribe of subscriptions) unsubscribe();
    root.remove();
  }
  subscriptions.push(viewport.on('destroy', destroy));
  return { destroy, close: () => close() };
}
