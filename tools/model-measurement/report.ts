/** Nearest-rank percentiles are meaningful only after at least two observations. */
export function distribution(values: readonly number[]) {
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Timing samples must be finite and nonnegative.');
  if (values.length < 2) return { samples: values.length, status: values.length ? 'insufficient-samples' : 'unavailable' } as const;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (value: number) => sorted[Math.ceil(value * sorted.length) - 1]!;
  return { samples: sorted.length, status: 'available', p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) } as const;
}

import type { TimingRecord } from './observer';
export type Update = { sequence: number; start: number; end: number };
export type NativeObservation = { sequence: number; time: number };
/** Match immutable accepted/frame facts, never the observer-time current store. */
export function correlateUpdates(updates: Update[], records: TimingRecord[], native: NativeObservation[], instrumented: boolean, expectedModels: number) {
  const accepted = records.filter(record => record.name === 'accepted-update');
  const drawn = records.filter(record => record.name === 'frame' && record.detail.drawnModels === expectedModels);
  const newestModel = Math.max(0, ...drawn.map(record => Number(record.detail.updateRevision)));
  const newestNative = Math.max(0, ...native.map(record => record.sequence));
  return updates.map(update => {
    const ownership = accepted.filter(record => record.startTime >= update.start && record.startTime <= update.end);
    const revision = ownership.length === 1 ? Number(ownership[0]!.detail.revision) : undefined;
    const modelFrame = revision === undefined ? undefined : drawn.find(record => record.detail.updateRevision === revision && record.startTime >= update.start);
    const nativeFrame = native.find(record => record.sequence === update.sequence && record.time >= update.start);
    return { ...update, revision,
      model: expectedModels === 0 ? 'not-applicable' : !instrumented ? 'unavailable' : revision === undefined ? 'ambiguous-acceptance' : modelFrame ? modelFrame.startTime - update.start : newestModel > revision ? 'superseded' : 'pending',
      native: !instrumented ? 'unavailable' : nativeFrame ? nativeFrame.time - update.start : newestNative > update.sequence ? 'superseded' : 'pending' };
  });
}
export function summarize(records: TimingRecord[], updates: Update[], native: NativeObservation[], frames: { time: number; interval: number }[], instrumented: boolean, expectedModels: number) {
  const latency = correlateUpdates(updates, records, native, instrumented, expectedModels);
  const values = (key: 'model' | 'native') => latency.flatMap(value => typeof value[key] === 'number' ? [value[key]] : []);
  const phases = ['parse', 'decode-wall', 'texture-upload', 'geometry-upload', 'shader-compile', 'instance-preparation', 'submit', 'picking'];
  return { frameIntervalMs: distribution(frames.map(frame => frame.interval)), upsertCpuMs: distribution(updates.map(update => update.end - update.start)),
    modelVisibleLatencyMs: distribution(values('model')), nativeProbeVisibleLatencyMs: distribution(values('native')),
    latencyOutcomes: { model: latency.map(value => value.model), native: latency.map(value => value.native) },
    phases: Object.fromEntries(phases.map(phase => [phase, distribution(records.filter(record => record.name === phase).map(record => record.duration))])),
    placementCpuMs: distribution(records.filter(record => record.name === 'scene-cpu').map(record => Number(record.detail.placementMs))),
    projectionScalingCpuMs: distribution(records.filter(record => record.name === 'scene-cpu').map(record => Number(record.detail.projectionScalingMs))), latency };
}
