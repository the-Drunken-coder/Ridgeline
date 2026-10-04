import type { Map as GLMap } from 'maplibre-gl';
import { FEATURE_SOURCE, sourceFeatureId } from './maplibre-feature-publication';

/** Pinned MapLibre integration for live circle/symbol opacity, never terrain RTT paint. */
export class ModelVisibility {
  private destination?: object;
  private hidden = new Map<string, boolean>();
  constructor(private map: GLMap) {}
  commit(next: ReadonlyMap<string, boolean>, current: () => boolean) {
    const map = this.map, style = map.style, manager = style?.tileManagers[FEATURE_SOURCE], context = map.painter?.context;
    if (!manager || !context || !map.getSource(FEATURE_SOURCE)) return false;
    const changed = this.destination !== manager;
    const target = new Map([...this.hidden.keys()].map(id => [id, false]));
    for (const [id, hidden] of next) target.set(id, hidden);
    let wrote = false;
    for (const [id, hidden] of target) {
      if (!current() || map.style !== style || map.style.tileManagers[FEATURE_SOURCE] !== manager) { this.invalidate(); return false; }
      if (!changed && this.hidden.get(id) === hidden) continue;
      map.setFeatureState({ source: FEATURE_SOURCE, id: sourceFeatureId(id) }, { model: hidden });
      wrote = true;
    }
    try {
      if (wrote) {
        // Model preflight uses raw WebGL calls. Native tile uploads must not trust
        // the cached bindings from before that custom work.
        context.setDirty();
        manager.prepare(context);
      }
    }
    catch (cause) { this.invalidate(); throw cause; }
    if (!current() || map.style !== style || map.style.tileManagers[FEATURE_SOURCE] !== manager || map.painter.context !== context) { this.invalidate(); return false; }
    this.destination = manager; this.hidden = new Map(next);
    return true;
  }
  invalidate() { this.destination = undefined; this.hidden.clear(); }
}
