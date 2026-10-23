import type { FeatureStyle, MapFeature, Properties } from './types';

export type NativeRecord<P extends Properties> = {
  readonly feature: MapFeature<P>;
  readonly style: FeatureStyle;
  readonly markerKey?: string;
};

/** Installed display and staged literals have different retirement rules. */
export class NativeDisplayBook<P extends Properties> {
  private installed = new Map<string, NativeRecord<P>>();
  private staged = new Map<string, Set<FeatureStyle>>();

  stage(record: NativeRecord<P>) {
    const styles = this.staged.get(record.feature.id) ?? new Set<FeatureStyle>();
    styles.add(record.style);
    this.staged.set(record.feature.id, styles);
  }

  commit(id: string, record: NativeRecord<P> | null) {
    if (record) {
      // A newly introduced arrow keeps the arrowhead source's insertion order.
      if (record.feature.drawing?.shape.kind === 'arrow' && this.installed.get(id)?.feature.drawing?.shape.kind !== 'arrow') this.installed.delete(id);
      this.installed.set(id, record);
    }
    else this.installed.delete(id);
    this.staged.delete(id);
  }

  replace(records: readonly NativeRecord<P>[]) {
    this.installed = new Map(records.map(record => [record.feature.id, record]));
    this.staged.clear();
  }

  get(id: string) { return this.installed.get(id); }

  *styles() {
    for (const record of this.installed.values()) yield record.style;
    // Rejected updates may already have installed geometry using any staged variant.
    for (const styles of this.staged.values()) yield* styles;
  }

  arrows() {
    return [...this.installed.values()].flatMap(({ feature }) => feature.drawing?.shape.kind === 'arrow' ? [feature] : []);
  }

  withdrawMarker(id: string) {
    const record = this.installed.get(id);
    // Accepted removal withdraws readiness before the retained display is replaced.
    if (record?.markerKey) this.installed.set(id, { feature: record.feature, style: record.style });
  }
}
