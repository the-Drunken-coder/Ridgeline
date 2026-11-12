import { createViewport } from '@ridgeline/map';
import { attachEntities } from '@ridgeline/map/entities';
import type { Properties, ViewportOptions } from '@ridgeline/map';

/**
 * createViewport, then attach models and GPU cameras, then upsert any initial features.
 * Initial features go through upsert after the renderer exists, so invalid ones fail with
 * INVALID_FEATURE, not INITIALIZATION_FAILED. Cases that assert createViewport's
 * initial validation must call createViewport directly.
 */
export function createEntityViewport<P extends Properties>(options: ViewportOptions<P>) {
  const { features, ...rest } = options;
  const viewport = createViewport(rest);
  try {
    attachEntities(viewport);
    if (features?.length) viewport.upsert(features);
    return viewport;
  } catch (cause) {
    try { viewport.destroy(); } catch { /* Preserve the setup failure. */ }
    throw cause;
  }
}
