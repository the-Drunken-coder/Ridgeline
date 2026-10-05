export type TimingRecord = { name: string; startTime: number; duration: number; detail: Record<string, string | number | boolean> };

/** Own one asynchronous browser observer; production never calls consumer measurement callbacks. */
export function observeModels() {
  const records: TimingRecord[] = [];
  const consume = (entries: PerformanceEntry[]) => {
    for (const entry of entries) if (entry instanceof PerformanceMeasure && entry.name.startsWith('ridgeline:model:')) {
      const raw: unknown = entry.detail, detail: TimingRecord['detail'] = {};
      if (raw && typeof raw === 'object') for (const [key, value] of Object.entries(raw))
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) detail[key] = value;
      records.push({ name: entry.name.slice('ridgeline:model:'.length), startTime: entry.startTime, duration: entry.duration, detail });
    }
  };
  const observer = new PerformanceObserver(list => consume(list.getEntries()));
  observer.observe({ type: 'measure' });
  return { records, drain() { consume(observer.takeRecords()); }, destroy() { consume(observer.takeRecords()); observer.disconnect(); } };
}
