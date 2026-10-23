import { DEFAULT_ELEVATION } from '@ridgeline/map';
import type { ModelAppearance, Viewport } from '@ridgeline/map';
import { element } from './dom';
import { drawingFeatures, mountDrawingDemo } from './drawing';
import { mountModelExample } from './model-example';
import { mountMotionScenario } from './motion';
import { groups, overlapFeatures, terrainFeatures } from './samples';
import type { Sample } from './samples';

export type ActiveScenario = {
  destroy(): void;
  resetCamera(): void;
  appearance?: (id: string) => ModelAppearance | undefined;
};
type ScenarioId = 'terrain' | 'drawing' | 'models' | 'overlap' | 'moving' | 'airborne-single' | 'airborne' | 'sidc' | 'empty' | 'error';
type ScenarioContext = {
  viewport: Viewport<Sample>;
  modelContainer: HTMLElement;
  onPlacementChange: (active: boolean) => void;
  onSelectionChange: () => void;
  reload: () => void;
};
type Camera = Parameters<Viewport<Sample>['setCamera']>[0];
export const defaultCamera = { center: [6.88, 45.92], zoom: 12.5, pitch: 55, bearing: -20 } satisfies Camera;
const cameras: Record<Exclude<ScenarioId, 'models'>, Camera> = {
  terrain: defaultCamera, drawing: defaultCamera, empty: defaultCamera, error: defaultCamera,
  sidc: { center: [6.87,45.924], zoom: 13.5, pitch: 0, bearing: 0 },
  overlap: { center: [6.869,45.925], zoom: 14.3, pitch: 0, bearing: 0 },
  moving: { center: [6.869,45.92], zoom: 12.9, pitch: 0, bearing: 0 },
  'airborne-single': { center: [6.867,45.920], zoom: 14, pitch: 60, bearing: -20 },
  airborne: { center: [6.872,45.92], zoom: 13.5, pitch: 60, bearing: -20 },
};

export function scenarioId(value: string): ScenarioId {
  switch (value) {
    case 'terrain': case 'drawing': case 'models': case 'overlap': case 'moving':
    case 'airborne-single': case 'airborne': case 'sidc': case 'empty': case 'error': return value;
    default: return 'terrain';
  }
}

export function mountScenario(id: ScenarioId, context: ScenarioContext): ActiveScenario {
  const { viewport, modelContainer, onSelectionChange } = context;
  const airborne = id === 'airborne' || id === 'airborne-single';
  document.body.classList.toggle('drawing-scenario', id === 'drawing');
  element('#drawing-tools', HTMLDivElement).hidden = id !== 'drawing';
  element('#drawing-inspector', HTMLDivElement).hidden = id !== 'drawing';
  document.body.classList.toggle('sidc-scenario', id === 'sidc');
  document.body.classList.toggle('airborne-scenario', airborne);
  element('#map-settings', HTMLDetailsElement).open = !airborne && id !== 'drawing' && id !== 'models';
  element('#sidc-demo', HTMLElement).hidden = id !== 'sidc';
  element('#airborne-demo', HTMLElement).hidden = !airborne;
  modelContainer.hidden = id !== 'models';
  element('#selection', HTMLElement).hidden = id === 'sidc';
  element('#diagnostics', HTMLDivElement).hidden = true;
  element('#groups', HTMLDivElement).hidden = id !== 'overlap';
  element('#motion', HTMLElement).hidden = !airborne && id !== 'moving';
  const notice = element('#notice', HTMLDivElement);
  notice.hidden = id !== 'empty'; notice.textContent = 'No features. Choose a test scenario to add sample data.';
  viewport.clear(); viewport.setSelection([]); onSelectionChange();

  const unavailableTile = `${location.origin}/unavailable-elevation/{z}/{x}/{y}.png`;
  const failingElevation = viewport.getConfiguration().elevation.tiles?.[0] === unavailableTile;
  if (failingElevation !== (id === 'error')) viewport.configure({ elevation: id === 'error'
    ? { tiles: [unavailableTile], encoding: 'terrarium', tileSize: 512, maxzoom: 12 }
    : DEFAULT_ELEVATION });

  if (id === 'models') return mountModelExample(viewport, modelContainer);
  const resetCamera = () => viewport.setCamera(cameras[id]);
  switch (id) {
    case 'drawing': {
      viewport.upsert(drawingFeatures());
      const demo = mountDrawingDemo(viewport, element('#drawing-tools', HTMLDivElement), element('#drawing-inspector', HTMLDivElement));
      viewport.setSelection(['drawing-0']);
      return { destroy: demo.destroy, resetCamera };
    }
    case 'overlap': {
      viewport.upsert(overlapFeatures());
      const lifetime = new AbortController();
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-group]')) button.addEventListener('click', () => {
        const group = groups.find(group => group.count === Number(button.dataset.group));
        if (group) viewport.setCamera({ center: [group.center[0]!, group.center[1]!], zoom: 17, pitch: 0, bearing: 0 });
      }, { signal: lifetime.signal });
      return { destroy() { lifetime.abort(); }, resetCamera };
    }
    case 'moving': case 'airborne': case 'airborne-single':
      return { ...mountMotionScenario(viewport, id), resetCamera };
    case 'sidc': return { ...mountSidcScenario(context), resetCamera };
    case 'error':
      element('#terrain', HTMLInputElement).checked = true; viewport.configure({ terrain: true });
      viewport.upsert(terrainFeatures());
      return { destroy() {}, resetCamera };
    case 'terrain':
      viewport.upsert(terrainFeatures());
      return { destroy() {}, resetCamera };
    case 'empty': return { destroy() {}, resetCamera };
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

function mountSidcScenario({ viewport, onPlacementChange, onSelectionChange, reload }: ScenarioContext) {
  const lifetime = new AbortController();
  const content = element('#sidc-content', HTMLDivElement);
  let demo: ReturnType<typeof import('./sidc-demo').mountSidcDemo> | undefined;
  let offSelection: (() => void) | undefined;
  content.textContent = 'Loading SIDC Kit…';
  void import('./sidc-demo').then(({ mountSidcDemo }) => {
    if (lifetime.signal.aborted) return;
    demo = mountSidcDemo({ viewport, container: content, onPlacementChange, onSelectionChange });
    offSelection = viewport.on('selectionchange', demo.renderSelection);
  }).catch(() => {
    if (lifetime.signal.aborted) return;
    content.textContent = 'SIDC Kit could not load. ';
    const retry = document.createElement('button'); retry.textContent = 'Retry demo';
    retry.addEventListener('click', reload, { signal: lifetime.signal }); content.append(retry);
  });
  return { destroy() {
    if (lifetime.signal.aborted) return;
    lifetime.abort(); offSelection?.(); demo?.destroy();
  } };
}
