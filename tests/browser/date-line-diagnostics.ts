import type { Viewport } from '@ridgeline/map';

type Fields = Record<string, string | number | boolean | null | undefined>;
type Entry = { event: string; now: number; dateNow: number; visibility: string; fields: Fields };
type Timeline = {
  timeOrigin: number;
  entries: Entry[];
  dropped: Record<string, number>;
  observerMs: number;
  observerMaxMs: number;
  longTasksSupported: boolean;
};

declare global {
  interface Window {
    dateLineDiagnosticEnabled?: boolean;
    dateLineTimeline?: Timeline;
    stopDateLineDiagnostic?: () => void;
  }
}

export function startDateLineDiagnostics() {
  if (!window.dateLineDiagnosticEnabled) return;
  const timeline: Timeline = { timeOrigin: performance.timeOrigin, entries: [], dropped: {},
    observerMs: 0, observerMaxMs: 0, longTasksSupported: PerformanceObserver.supportedEntryTypes.includes('longtask') };
  window.dateLineTimeline = timeline;
  const limits = { control: 4096, map: 1024, longtask: 256 };
  const counts = { control: 0, map: 0, longtask: 0 };
  const terminalEvents = new Set(['wait.timeout', 'wait.return', 'wait.catch', 'interval.clear',
    'initial.cleanup.entry', 'initial.cleanup.return', 'viewport.cleanup.entry', 'viewport.cleanup.exit', 'case.cleanup', 'diagnostic.stop']);
  const terminalEntries = new Map<string, Entry>();
  const releases: (() => void)[] = [];
  let stopped = false;
  function mark(event: string, fields: Fields = {}, channel: keyof typeof limits = 'control') {
    if (stopped) return;
    if (counts[channel]++ >= limits[channel] && !terminalEvents.has(event)) {
      timeline.dropped[channel] = (timeline.dropped[channel] ?? 0) + 1;
      return;
    }
    const now = performance.now();
    const entry = { event, now, dateNow: Date.now(), visibility: document.visibilityState, fields };
    if (terminalEvents.has(event)) terminalEntries.set(event, entry);
    else timeline.entries.push(entry);
    const name = `pr122:${event}`;
    performance.mark(name, { startTime: now });
    performance.clearMarks(name);
    const cost = performance.now() - now;
    timeline.observerMs += cost;
    timeline.observerMaxMs = Math.max(timeline.observerMaxMs, cost);
  }
  const longTasks = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) mark('longtask', {
      startTime: entry.startTime, duration: entry.duration, name: entry.name,
    }, 'longtask');
  });
  if (timeline.longTasksSupported) longTasks.observe({ type: 'longtask', buffered: false });
  const visibility = () => mark('visibilitychange');
  document.addEventListener('visibilitychange', visibility);
  function stop() {
    if (stopped) return;
    // Drain records that have not yet reached the observer callback before disconnecting.
    for (const entry of longTasks.takeRecords()) mark('longtask', {
      startTime: entry.startTime, duration: entry.duration, name: entry.name,
    }, 'longtask');
    longTasks.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    for (const release of releases) release();
    mark('diagnostic.stop');
    timeline.entries.push(...terminalEntries.values());
    timeline.entries.sort((a, b) => a.now - b.now);
    stopped = true;
  }
  window.stopDateLineDiagnostic = stop;
  mark('diagnostic.start');
  return {
    mark,
    stop,
    observe(viewport: Viewport, generation: string) {
      const map = viewport.map;
      const source = (event: { type: string; sourceId: string; sourceDataType?: string; isSourceLoaded?: boolean }) => {
        if (!['rl:features', 'rl:terrain'].includes(event.sourceId)) return;
        // These are MapLibre source events, not exact worker completion or displayed pixels.
        mark(`map.${event.type}`, { generation, sourceId: event.sourceId,
          sourceDataType: event.sourceDataType, isSourceLoaded: event.isSourceLoaded }, 'map');
      };
      const frame = (event: { type: string }) => mark(`map.${event.type}`, { generation }, 'map');
      map.on('sourcedataloading', source);
      map.on('sourcedata', source);
      map.on('render', frame);
      map.on('idle', frame);
      map.on('remove', frame);
      const offData = viewport.on('datachange', () => mark('viewport.datachange', { generation }, 'map'));
      releases.push(() => {
        map.off('sourcedataloading', source); map.off('sourcedata', source);
        map.off('render', frame); map.off('idle', frame); map.off('remove', frame); offData();
      });
      mark('map.observe', { generation });
    },
  };
}
