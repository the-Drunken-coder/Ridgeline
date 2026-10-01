import type { IconDefinition, MapFeature, Properties, Viewport } from './types';

export type OverlayContent = { element: HTMLElement; dispose?: () => void };
export type FeatureContentRenderer<P extends Properties> = (feature: MapFeature<P>) => HTMLElement | OverlayContent;
type Content = { element: Node; dispose?: () => void };
type ContentHost<P extends Properties> = Pick<Viewport<P>, 'getName' | 'getStyle' | 'getIcon' | 'reportCallbackError'>;

/** Owns one mounted feature's content, including results superseded inside consumer callbacks. */
export function createFeatureContent<P extends Properties>(
  container: HTMLElement,
  host: ContentHost<P>,
  renderFeature?: FeatureContentRenderer<P>,
) {
  let content: Content | undefined;
  let name: string | undefined;
  let icon: IconDefinition | undefined;
  let revision = 0;
  let destroyed = false;

  function release(previous: Content | undefined) {
    try { previous?.dispose?.(); } catch { /* A consumer disposer must not interrupt replacement or cleanup. */ }
  }
  function nameFor(feature: MapFeature<P>) {
    try { return host.getName(feature); }
    catch (cause) {
      host.reportCallbackError(cause, 'name', feature.id);
      return feature.id;
    }
  }
  function iconFor(feature: MapFeature<P>) {
    try {
      const id = host.getStyle(feature).icon;
      return id ? host.getIcon(id) : undefined;
    } catch {
      // A failed style callback leaves the feature available by name.
      return undefined;
    }
  }
  function defaultContent(nextName: string, nextIcon: IconDefinition | undefined) {
    const element = document.createElement('span'); element.className = 'rl-feature-content';
    if (nextIcon) {
      if (nextIcon.url) {
        const image = document.createElement('img'); image.src = nextIcon.url; image.alt = ''; image.width = 20; image.height = 20; element.append(image);
      } else {
        const canvas = document.createElement('canvas'); canvas.width = nextIcon.image.width; canvas.height = nextIcon.image.height;
        const context = canvas.getContext('2d');
        if (nextIcon.image instanceof ImageData) context?.putImageData(nextIcon.image, 0, 0); else context?.drawImage(nextIcon.image, 0, 0);
        canvas.setAttribute('aria-hidden', 'true'); element.append(canvas);
      }
    }
    const label = document.createElement('span'); label.textContent = nextName; element.append(label);
    return element;
  }

  return {
    update(feature: MapFeature<P> | undefined) {
      if (destroyed) return;
      const version = ++revision;
      const current = () => !destroyed && revision === version;
      const nextName = feature ? nameFor(feature) : undefined;
      if (!current()) return;
      let nextIcon = feature && !renderFeature ? iconFor(feature) : undefined;
      if (!current()) return;
      // Default content depends on name and icon, not movement. Check the destination too.
      if (!renderFeature && content && name === nextName && icon === nextIcon && container.firstChild === content.element)
        return { name: nextName };
      let custom: HTMLElement | OverlayContent | undefined;
      if (feature && renderFeature) {
        try { custom = renderFeature(feature); }
        catch (cause) { host.reportCallbackError(cause, 'renderFeature', feature.id); }
      }
      let next: Content | undefined = custom instanceof HTMLElement ? { element: custom } : custom;
      if (!current()) { release(next); return; }
      if (!next) {
        if (feature && renderFeature) nextIcon = iconFor(feature);
        if (!current()) return;
        next = { element: nextName === undefined ? document.createTextNode('Unavailable') : defaultContent(nextName, nextIcon) };
      }
      const previous = content;
      content = undefined;
      release(previous);
      if (!current()) { release(next); return; }
      // Ownership must be recorded before connecting custom elements can call back into the UI.
      content = next; name = nextName; icon = nextIcon;
      container.replaceChildren(next.element);
      return current() ? { name: nextName } : undefined;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; revision++;
      const previous = content;
      content = undefined;
      container.replaceChildren();
      release(previous);
    },
  };
}
