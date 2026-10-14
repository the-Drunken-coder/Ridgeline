import type { Map as GLMap } from 'maplibre-gl';
import { FEATURE_SOURCE, sourceFeatureId } from './maplibre-feature-publication';
import { modelPresentationGeometry } from './model-presentation';
import type { ModelPresentation } from './model-presentation';
import type { LabelStyle } from './types';

/** Native symbol buckets own collision layout. A stamp hides old buckets until their layout catches up. */
export class ModelLabels {
  private offsets = new Map<string, [number, number]>();
  private written = new Map<string, string>();
  private destination?: object;
  private destroyed = false;
  constructor(private map: GLMap, private changed: (ids: string[]) => void) {}
  properties(id: string, style?: LabelStyle) {
    const adjusted = this.offsets.get(id);
    const offset = adjusted ?? style?.offset ?? (style?.anchor && style.anchor !== 'top' ? [0, 0] : [0, 1.8]);
    return { _rl_label_offset: [...offset], _rl_label_stamp: adjusted ? JSON.stringify(adjusted) : '' };
  }
  acceptsHit(id: string, stamp: unknown) {
    return !this.destroyed && (typeof stamp === 'string' ? stamp : '') === this.properties(id)._rl_label_stamp;
  }
  commit(records: readonly ModelPresentation[], current: () => boolean) {
    if (this.destroyed || !current()) return false;
    const next = new Map<string, [number, number]>();
    for (const record of records) {
      if (!record.hasLabel) continue;
      const offset = modelPresentationGeometry(record).labelOffset;
      const requested = record.labelStyle?.offset ?? (record.labelStyle?.anchor && record.labelStyle.anchor !== 'top' ? [0, 0] : [0, 1.8]);
      const previous = next.get(record.id);
      if ((offset[0] !== requested[0] || offset[1] !== requested[1]) && (!previous || Math.hypot(...offset) > Math.hypot(...previous))) next.set(record.id, offset);
    }
    const changed = [...new Set([...this.offsets.keys(), ...next.keys()])]
      .filter(id => JSON.stringify(this.offsets.get(id)) !== JSON.stringify(next.get(id)));
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
