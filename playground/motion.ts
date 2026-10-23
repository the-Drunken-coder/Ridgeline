import type { Viewport } from '@ridgeline/map';
import { airborneFeatures, defaultAirborneSettings, mountAirborneInspector } from './airborne';
import type { AirborneSettings } from './airborne';
import { element } from './dom';
import { movingFeatures, terrainFeatures } from './samples';
import type { Sample } from './samples';

export type MotionScenario = 'moving' | 'airborne' | 'airborne-single';
type ActiveMeasurement = { updateCosts: number[]; destroy(): void };

export function mountMotionScenario(viewport: Viewport<Sample>, scenario: MotionScenario) {
  const lifetime = new AbortController();
  const pauseButton = element('#pause', HTMLButtonElement);
  const measureButton = element('#measure', HTMLButtonElement);
  const output = element('#measurement', HTMLOutputElement);
  const description = element('#motion-description', HTMLElement);
  const airborne = scenario !== 'moving';
  const movingCount = scenario === 'airborne-single' ? 1 : 100;
  const cameraCount = airborne ? movingCount === 1 ? 1 : 10 : 0;
  const settings = new Map<string, AirborneSettings>();
  let tick = 0;
  let paused = false;
  let measurement: ActiveMeasurement | undefined;

  pauseButton.textContent = 'Pause';
  measureButton.disabled = false;
  output.textContent = 'No measurement yet';
  description.textContent = scenario === 'airborne-single'
    ? '1 flying asset · 1 camera · frame-synced motion'
    : airborne ? '1,000 points · 100 moving · 10 cameras · 10 updates/s'
    : '1,000 points · 100 moving · 10 updates/s';

  if (airborne) {
    viewport.configure({ entityVisibility: { footprints: true, zones: movingCount !== 1, groundLines: movingCount !== 1 } });
    viewport.upsert(airborneFeatures(0, movingCount === 1 ? 1 : 1_000, settings));
    viewport.setSelection(['moving-0']);
  } else viewport.upsert([...movingFeatures(), ...terrainFeatures().filter(feature => feature.geometry.type !== 'Point')]);

  const inspector = airborne ? mountAirborneInspector(viewport, element('#airborne-demo', HTMLElement),
    id => settings.get(id) ?? defaultAirborneSettings,
    (id, next) => { settings.set(id, next); viewport.upsert(airborneFeatures(tick, movingCount, settings)); }) : undefined;

  function advance(delta: number) {
    if (paused || document.hidden) return;
    tick += delta;
    const updates = airborne ? airborneFeatures(tick, movingCount, settings) : movingFeatures(tick, movingCount);
    const start = performance.now(); viewport.upsert(updates);
    measurement?.updateCosts.push(performance.now() - start);
  }
  const stopMotion = startMotion(advance, scenario === 'airborne-single');

  pauseButton.addEventListener('click', () => {
    paused = !paused; pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }, { signal: lifetime.signal });
  measureButton.addEventListener('click', () => {
    measurement?.destroy();
    paused = false; pauseButton.textContent = 'Pause'; measureButton.disabled = true;
    output.textContent = 'Measuring for 10 seconds…';
    const intervals: number[] = [], entityCosts: number[] = [], coverageAges: number[] = [];
    let renderedFrames = 0, frame = 0;
    const start = performance.now(); let last = start;
    const onRender = () => { renderedFrames++; };
    viewport.map.on('render', onRender);
    const offEntities = viewport.on('entitychange', ({ ids }) => {
      entityCosts.push(ids.reduce((sum, id) => sum + (viewport.getEntityState(id)?.computationMs ?? 0), 0));
    });
    const run: ActiveMeasurement = {
      updateCosts: [],
      destroy() {
        cancelAnimationFrame(frame); viewport.map.off('render', onRender); offEntities();
        if (measurement === run) { measurement = undefined; measureButton.disabled = false; }
      },
    };
    measurement = run;
    const percentile = (values: number[]) => [...values].sort((a,b) => a-b)[Math.floor(values.length * .95)] ?? 0;
    const sample = (now: number) => {
      if (measurement !== run) return;
      if (document.hidden) { output.textContent = 'Measurement canceled because this tab was hidden.'; run.destroy(); return; }
      intervals.push(now - last); last = now;
      if (airborne) {
        const states = Array.from({ length: cameraCount }, (_, index) => viewport.getEntityState(`moving-${index}`));
        if (states.every(state => state?.coverage === 'ready')) coverageAges.push(Math.max(...states.map(state => Math.max(0, performance.timeOrigin + performance.now() - state!.computedAt))));
      }
      if (now - start < 10_000) { frame = requestAnimationFrame(sample); return; }
      const seconds = (now - start) / 1_000;
      output.textContent = `${Math.round(intervals.length / seconds)} UI frames/s · p95 UI frame ${percentile(intervals).toFixed(1)} ms · ${(renderedFrames / seconds).toFixed(1)} map renders/s · p95 update submission ${percentile(run.updateCosts).toFixed(2)} ms · ${run.updateCosts.length} batches. Map renders are demand-driven; GPU duration is not measured.`;
      if (airborne) output.textContent += ` Entity computation p95 ${percentile(entityCosts).toFixed(1)} ms per batch; ${coverageAges.length ? `coverage age p95 ${percentile(coverageAges).toFixed(0)} ms` : 'coverage not ready for age measurement'}.`;
      run.destroy();
    };
    frame = requestAnimationFrame(sample);
  }, { signal: lifetime.signal });

  return {
    destroy() {
      if (lifetime.signal.aborted) return;
      lifetime.abort(); stopMotion(); measurement?.destroy(); inspector?.destroy();
      pauseButton.textContent = 'Pause'; output.textContent = 'No measurement yet';
      description.textContent = '1,000 points · 100 moving · 10 updates/s';
    },
  };
}

function startMotion(advance: (delta: number) => void, frameSynced: boolean) {
  if (frameSynced) {
    let previous = performance.now(), frame = 0;
    const animate = (now: number) => {
      advance(Math.min(100, now - previous) / 100); previous = now;
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }
  const timer = setInterval(() => advance(1), 100);
  return () => clearInterval(timer);
}
