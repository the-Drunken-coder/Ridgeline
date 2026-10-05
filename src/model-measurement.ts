type Detail = Record<string, string | number | boolean>;
let viewportSequence = 0;

/** Private opt-in User Timing boundary for the dedicated measurement consumer. */
export class ModelMeasurement {
  readonly viewport = ++viewportSequence;
  revision = 0;
  private sequence = 0;
  private stopped = false;
  private attempts?: WeakMap<AbortSignal, Detail>;
  private attemptSequence = 0;
  private frameSequence = 0;
  constructor(private canvas: HTMLCanvasElement) {}
  get enabled() { return !this.stopped && this.canvas.dataset.ridgelineMeasure === 'true'; }
  get idleEnabled() { return this.enabled && this.canvas.dataset.ridgelineIdle === 'true'; }
  begin() { return this.enabled ? performance.now() : undefined; }
  end(phase: string, start: number, detail?: Detail) { if (this.enabled) this.write(phase, start, performance.now(), detail); }
  attempt(signal: AbortSignal, modelId?: string, kind?: string) {
    if (!this.enabled) return;
    if (modelId !== undefined) {
      this.attempts ??= new WeakMap();
      this.attempts.set(signal, { attempt: ++this.attemptSequence, modelId, kind: kind ?? 'register' });
    }
    return this.attempts?.get(signal);
  }
  frame() { return ++this.frameSequence; }
  event(phase: string, detail: Detail) {
    if (!this.enabled) return;
    const now = performance.now(); this.write(phase, now, now, detail);
  }
  accepted(count: number) {
    if (!this.enabled) return;
    this.revision++; this.event('accepted-update', { revision: this.revision, features: count });
  }
  destroy() { this.stopped = true; }
  private write(phase: string, start: number, end: number, detail?: Detail) {
    if (!this.enabled) return;
    const name = `ridgeline:model:${phase}`;
    try {
      performance.measure(name, { start, end, detail: { viewport: this.viewport, sequence: ++this.sequence, ...detail } });
      // PerformanceObserver receives its own queued entry; the browser timeline stays bounded.
      performance.clearMeasures(name);
    } catch {
      this.stopped = true;
      this.canvas.dataset.ridgelineMeasureError = 'User Timing measures are unavailable.';
    }
  }
}
