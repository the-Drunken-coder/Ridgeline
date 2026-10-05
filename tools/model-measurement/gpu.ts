import type { Map as MapLibreMap, CustomLayerInterface } from 'maplibre-gl';

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
type Query = { id: number; handle: WebGLQuery; issuedAt: number };
export type GpuSample = { id: number; issuedAt: number; completedAt: number; milliseconds: number };
/** Queries only this layer's commands. No blocking waits, shared query ownership, or repaint polling. */
export function observeGpu(map: MapLibreMap, enabled: boolean) {
  const samples: GpuSample[] = [], rejected: { id?: number; reason: string }[] = [];
  const projections: number[] = [];
  let gl: WebGL2RenderingContext | undefined, extension: TimerExtension | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, sequence = 0, stopped = false;
  const pending: Query[] = [], restores: (() => void)[] = [];
  let status = enabled ? 'waiting-for-renderer' : 'disabled';
  const poll = () => {
    timer = undefined;
    if (!gl || !extension) return;
    const disjoint = gl.isContextLost() || Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
    for (let i = pending.length - 1; i >= 0; i--) {
      const query = pending[i]!;
      if (disjoint || performance.now() - query.issuedAt > 2000) {
        rejected.push({ id: query.id, reason: disjoint ? 'disjoint-or-lost' : 'timeout' });
      } else if (gl.getQueryParameter(query.handle, gl.QUERY_RESULT_AVAILABLE)) {
        samples.push({ id: query.id, issuedAt: query.issuedAt, completedAt: performance.now(), milliseconds: Number(gl.getQueryParameter(query.handle, gl.QUERY_RESULT)) / 1e6 });
      } else continue;
      gl.deleteQuery(query.handle); pending.splice(i, 1);
    }
    if (pending.length && !stopped) timer = setTimeout(poll, 20);
  };
  const wrap = (layer: CustomLayerInterface) => {
    if (layer.id !== 'rl:models') return;
    const original = layer.render;
    const wrapped: CustomLayerInterface['render'] = function(this: CustomLayerInterface, context, input) {
      if (enabled && projections.length < 256 && !projections.includes(input.defaultProjectionData.projectionTransition)) projections.push(input.defaultProjectionData.projectionTransition);
      gl = context;
      let query: Query | undefined;
      if (enabled && !stopped && !gl.isContextLost()) {
        extension ??= gl.getExtension('EXT_disjoint_timer_query_webgl2');
        status = extension ? 'available' : 'unavailable';
        if (extension && pending.length < 8 && !gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
          const handle = gl.createQuery();
          if (handle) { query = { id: ++sequence, handle, issuedAt: performance.now() }; gl.beginQuery(extension.TIME_ELAPSED_EXT, handle); }
        }
      }
      try { return original.call(this, context, input); }
      finally { if (query && extension) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push(query); if (!timer) timer = setTimeout(poll, 20); } }
    };
    layer.render = wrapped;
    restores.push(() => { if (layer.render === wrapped) layer.render = original; });
  };
  // MapLibre's public custom-layer extension point, pinned to MapLibre 6.11 and rl:models.
  const addLayer = map.addLayer;
  const wrappedAdd: MapLibreMap['addLayer'] = function(this: MapLibreMap, layer, before) {
    if (typeof layer !== 'string' && layer.type === 'custom') wrap(layer);
    return addLayer.call(this, layer, before);
  };
  map.addLayer = wrappedAdd;
  return { samples, rejected, projections, get status() { return samples.length ? status : status === 'available' ? 'no-completed-samples' : status; },
    async destroy() {
      stopped = true;
      const deadline = performance.now() + 2100;
      while (pending.length && performance.now() < deadline) { poll(); await new Promise(resolve => setTimeout(resolve, 20)); }
      if (timer) clearTimeout(timer);
      for (const query of pending) { gl?.deleteQuery(query.handle); rejected.push({ id: query.id, reason: 'disposed' }); }
      pending.length = 0;
      if (map.addLayer === wrappedAdd) map.addLayer = addLayer;
      for (const restore of restores) restore();
    } };
}
