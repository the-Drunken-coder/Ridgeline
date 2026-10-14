import { FullscreenControl } from 'maplibre-gl';
import type { FullscreenControlOptions, IControl } from 'maplibre-gl';
import type { Properties, Viewport } from './types';

// A retired attachment must not undo a replacement's fullscreen activation.
const owners = new WeakMap<HTMLElement, object>();

/** Native UI, with the entry request and its effects owned by this attachment. */
export function ownedFullscreen<P extends Properties>(viewport: Viewport<P>, options: FullscreenControlOptions): IControl {
  const map = viewport.map, container = options.container ?? viewport.container;
  const native = new FullscreenControl({ ...options, container });
  const token = {}, abort = new AbortController();
  let retired = false, transitioning = false, removed = false, viewportDestroyed = false;
  let cooperative: boolean | undefined;
  const offDestroy = viewport.on('destroy', () => { viewportDestroyed = true; });
  function restore() {
    if (cooperative === undefined) return;
    if (cooperative) map.cooperativeGestures.enable(); else map.cooperativeGestures.disable();
  }
  function exitOwned() {
    if (owners.get(container) !== token) return;
    if (container.classList.contains('maplibregl-pseudo-fullscreen')) {
      container.classList.remove('maplibregl-pseudo-fullscreen');
      if (!viewportDestroyed) map.resize();
    }
    if (document.fullscreenElement === container) {
      void document.exitFullscreen().catch(cause => viewport.reportCallbackError(cause, 'controls.fullscreen'));
    }
    restore();
  }
  function remove() {
    if (removed) return;
    removed = true;
    exitOwned();
    native.onRemove();
    native.off('fullscreenstart', started); native.off('fullscreenend', ended);
    offDestroy();
  }
  function started() {
    // MapLibre disables cooperative gestures AFTER notifying fullscreenstart.
    transitioning = true;
    queueMicrotask(() => { transitioning = false; if (retired) remove(); });
  }
  function ended() {
    transitioning = true;
    queueMicrotask(() => {
      transitioning = false;
      if (owners.get(container) === token && !document.fullscreenElement && !container.classList.contains('maplibregl-pseudo-fullscreen')) {
        restore(); owners.delete(container); cooperative = undefined;
      }
      if (retired) remove();
    });
  }
  native.on('fullscreenstart', started); native.on('fullscreenend', ended);
  return {
    onAdd() {
      const node = native.onAdd(map);
      node.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('button');
        if (!button || button.classList.contains('maplibregl-ctrl-shrink')) return;
        if (retired || document.fullscreenElement === container || container.classList.contains('maplibregl-pseudo-fullscreen')) {
          event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        cooperative = map.cooperativeGestures.isEnabled(); owners.set(container, token);
        if (!options.pseudo && container.requestFullscreen) {
          // Keep the real request promise, so late entry can retire after removal.
          event.preventDefault(); event.stopImmediatePropagation();
          try {
            void container.requestFullscreen().then(() => { if (retired) exitOwned(); }, cause => {
              if (owners.get(container) === token) { owners.delete(container); restore(); cooperative = undefined; }
              viewport.reportCallbackError(cause, 'controls.fullscreen');
            });
          } catch (cause) {
            owners.delete(container); cooperative = undefined;
            viewport.reportCallbackError(cause, 'controls.fullscreen');
          }
        }
      }, { capture: true, signal: abort.signal });
      return node;
    },
    onRemove() {
      if (retired) return;
      retired = true; abort.abort();
      // Native event callbacks still use their map after notifying consumers.
      if (transitioning) queueMicrotask(remove); else remove();
    },
  };
}
