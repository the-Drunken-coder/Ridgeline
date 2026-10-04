import type { Map as GLMap } from 'maplibre-gl';
import { FEATURE_SOURCE, sourceFeatureId } from './maplibre-feature-publication';
import { modelPresentationGeometry } from './model-presentation';
import type { ModelPresentation } from './model-presentation';

/** Native symbol buckets own collision layout. A stamp hides old buckets until their layout catches up. */
export class ModelLabels {
  private offsets = new Map<string, number>();
  private written = new Map<string, string>();
  private destination?: object;
  private destroyed = false;
  constructor(private map: GLMap, private changed: (ids: string[]) => void) {}
  properties(id: string) {
    const offset = this.offsets.get(id) ?? 1.8;
    return { _rl_label_offset: [0, offset], _rl_label_stamp: offset === 1.8 ? '' : String(offset) };
  }
  commit(records: readonly ModelPresentation[], current: () => boolean) {
    if (this.destroyed || !current()) return false;
    const next = new Map<string, number>();
    for (const record of records) {
      const offset = modelPresentationGeometry(record).labelOffset[1];
      if (offset > 1.8) next.set(record.id, Math.max(offset, next.get(record.id) ?? 0));
    }
    const changed = [...new Set([...this.offsets.keys(), ...next.keys()])]
      .filter(id => this.offsets.get(id) !== next.get(id));
    this.offsets = next;
    if (changed.length) this.changed(changed);
    if (this.destroyed || !current()) return false;
    const map = this.map, style = map.style, manager = style?.tileManagers[FEATURE_SOURCE], context = map.painter?.context;
    if (!manager || !context || !map.getSource(FEATURE_SOURCE)) return false;
    const replaced = this.destination !== manager;
    const target = new Set([...this.written.keys(), ...next.keys()]);
    let wrote = false;
    for (const id of target) {
      if (this.destroyed || !current() || map.style !== style || style.tileManagers[FEATURE_SOURCE] !== manager) { this.invalidate(); return false; }
      const stamp = this.properties(id)._rl_label_stamp;
      if (!replaced && this.written.get(id) === stamp) continue;
      // Keep attempted destinations across cancellation so a later fallback can clear them.
      this.written.set(id, stamp);
      map.setFeatureState({ source: FEATURE_SOURCE, id: sourceFeatureId(id) }, { labelStamp: stamp });
      wrote = true;
    }
    try {
      if (wrote) { context.setDirty(); manager.prepare(context); }
    } catch (cause) { this.invalidate(); throw cause; }
    if (this.destroyed || !current() || map.style !== style || style.tileManagers[FEATURE_SOURCE] !== manager || map.painter.context !== context) {
      this.invalidate(); return false;
    }
    this.destination = manager;
    this.written = new Map([...next.keys()].map(id => [id, this.properties(id)._rl_label_stamp]));
    return true;
  }
  invalidate() { this.destination = undefined; }
  destroy() { this.destroyed = true; this.offsets.clear(); this.written.clear(); this.invalidate(); }
}
