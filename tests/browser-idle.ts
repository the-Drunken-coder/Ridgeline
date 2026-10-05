import type { Viewport } from '@ridgeline/map';

type Detail = Record<string, string | number | boolean>;
type EvidenceContext = { revision: string; status: string; diffSha256: string; command: string[]; testCase: string };
type TimelineEvent = { time: number; event: string; detail: Detail };
const quietMs = 5000;
const eventLimit = 128;

function state(viewport: Viewport) {
  return { loaded: viewport.map.loaded(), styleLoaded: viewport.map.isStyleLoaded() === true, moving: viewport.map.isMoving(),
    entities: viewport.getFeatures().slice(0, 16).map(feature => ({ id: feature.id, state: viewport.getEntityState(feature.id) })) };
}
export type IdleObservation = { context: string; source: EvidenceContext; startedAt: number; endedAt: number;
  observedMs: number; renders: number; droppedEvents: number; instrumentation: boolean; result: 'quiet' | 'failed' | 'stopped';
  initial: ReturnType<typeof state>; final: ReturnType<typeof state>; events: TimelineEvent[] };
declare global {
  interface Window { browserEvidenceContext?: EvidenceContext; browserIdleObservations?: IdleObservation[] }
}
export class IdleObservationFailure extends Error {
  constructor(readonly observation: IdleObservation) {
    super(`${observation.context}: observation ${observation.result}, ${observation.renders} unexpected render frames during ${observation.observedMs.toFixed(1)} ms. Scheduling evidence is retained in idle-observations.json.`);
  }
}

/** Observe only. Call after visible readiness and native settlement, outside pixel captures. */
export function observeIdle(viewport: Viewport, context: string, { instrumentation = true } = {}) {
  const canvas = viewport.map.getCanvas(), map = viewport.map;
  const measureBefore = canvas.dataset.ridgelineMeasure, idleBefore = canvas.dataset.ridgelineIdle;
  const startedAt = performance.now(), initial = state(viewport), events: TimelineEvent[] = [];
  const source = structuredClone(window.browserEvidenceContext ?? { revision: 'unknown', status: 'unknown', diffSha256: 'unknown', command: [], testCase: context });
  let stopped = false, renders = 0, droppedEvents = 0, result: IdleObservation | undefined;
  let waitTimer: ReturnType<typeof setTimeout> | undefined, wakeWait: (() => void) | undefined;
  const mark = (event: string, detail: Detail = {}, time = performance.now()) => {
    if (stopped) return;
    const bounded = Object.fromEntries(Object.entries(detail).slice(0, 24).map(([key, value]) =>
      [key, typeof value === 'string' ? value.slice(0, 1024) : value]));
    events.push({ time: time - startedAt, event, detail: bounded });
    if (events.length > eventLimit) { events.shift(); droppedEvents++; }
  };
  const rendered = () => { renders++; mark('render', { loaded: map.loaded() }); };
  const idle = () => mark('idle', { loaded: map.loaded() });
  const data = () => mark('data', { loaded: map.loaded(), styleLoaded: map.isStyleLoaded() === true });
  const changed = () => mark('entitychange', { entities: initial.entities.length });
  map.on('render', rendered); map.on('idle', idle); map.on('data', data);
  const offChanged = viewport.on('entitychange', changed);
  let offDestroyed = () => {};
  const triggerRepaint = map.triggerRepaint;
  const trigger = function (this: typeof map) {
    mark('triggerRepaint', { stack: new Error().stack?.split('\n').slice(1, 7).join('\n') ?? 'unavailable' });
    return triggerRepaint.call(this);
  };
  const consume = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.startTime < startedAt || !(entry instanceof PerformanceMeasure) ||
          !['accepted-update', 'schedule', 'preparation-start', 'preparation-end', 'frame'].some(phase => entry.name === `ridgeline:model:${phase}`)) continue;
      const detail: unknown = entry.detail;
      if (typeof detail !== 'object' || detail === null) continue;
      const values: Detail = {};
      for (const [key, value] of Object.entries(detail))
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = value;
      mark(entry.name, values, entry.startTime);
    }
  };
  const observer = instrumentation ? new PerformanceObserver(list => consume(list.getEntries())) : undefined;
  if (instrumentation) {
    canvas.dataset.ridgelineMeasure = 'true'; canvas.dataset.ridgelineIdle = 'true';
    map.triggerRepaint = trigger;
    observer?.observe({ type: 'measure' });
  }
  mark('begin', { loaded: initial.loaded, instrumentation });
  const finish = (outcome: IdleObservation['result']) => {
    if (result) return result;
    if (waitTimer) clearTimeout(waitTimer);
    wakeWait?.(); waitTimer = undefined; wakeWait = undefined;
    if (observer) { consume(observer.takeRecords()); observer.disconnect(); }
    map.off('render', rendered); map.off('idle', idle); map.off('data', data); offChanged(); offDestroyed();
    if (instrumentation) {
      if (map.triggerRepaint === trigger) map.triggerRepaint = triggerRepaint;
      if (measureBefore === undefined) delete canvas.dataset.ridgelineMeasure; else canvas.dataset.ridgelineMeasure = measureBefore;
      if (idleBefore === undefined) delete canvas.dataset.ridgelineIdle; else canvas.dataset.ridgelineIdle = idleBefore;
    }
    const endedAt = performance.now();
    result = { context, source, startedAt, endedAt, observedMs: endedAt - startedAt, renders, droppedEvents, instrumentation,
      result: outcome, initial, final: state(viewport), events: events.slice().sort((a, b) => a.time - b.time) };
    stopped = true;
    const retained = window.browserIdleObservations ??= [];
    retained.push(result); if (retained.length > 4) retained.shift();
    return result;
  };
  offDestroyed = viewport.on('destroy', () => { finish('stopped'); });
  return { mark, stop: () => finish('stopped'),
    async assertQuiet() {
      while (!stopped && performance.now() - startedAt < quietMs)
        await new Promise<void>(resolve => {
          wakeWait = resolve;
          waitTimer = setTimeout(() => { waitTimer = undefined; wakeWait = undefined; resolve(); }, Math.ceil(quietMs - (performance.now() - startedAt)));
        });
      const observation = finish(renders === 0 ? 'quiet' : 'failed');
      if (observation.result !== 'quiet' || observation.renders !== 0 || observation.observedMs < quietMs) throw new IdleObservationFailure(observation);
      return observation;
    },
  };
}
