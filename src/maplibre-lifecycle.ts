import type { Map as GLMap } from 'maplibre-gl';
import type { RidgelineError } from './errors';

export function createMapLibreLifecycle(map: GLMap, releaseNative: () => RidgelineError | undefined) {
  const nativeRender = map._render, cleanupContainer = map._cleanupContainer;
  let renderDepth = 0;
  let pendingRemoval: (() => RidgelineError | undefined) | undefined;

  function removeNative() {
    try { return releaseNative(); }
    finally {
      map._render = nativeRender; map._cleanupContainer = cleanupContainer;
    }
  }

  // MapLibre keeps using its style and tiles after a custom layer callback.
  // Native removal must wait for the outermost render to finish using them.
  map._render = function (time) {
    renderDepth++;
    try { return nativeRender.call(this, time); }
    finally {
      renderDepth--;
      if (!renderDepth && pendingRemoval) {
        const remove = pendingRemoval; pendingRemoval = undefined;
        remove();
      }
    }
  };

  return {
    retireContainer(): void {
      map._cleanupContainer = () => {};
      cleanupContainer.call(map);
    },
    requestRemoval(): RidgelineError | undefined {
      if (renderDepth) { pendingRemoval = removeNative; return; }
      return removeNative();
    },
  };
}
