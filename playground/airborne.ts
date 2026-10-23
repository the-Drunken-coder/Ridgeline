import type { EntityAttachment, MapFeature, Viewport } from '@ridgeline/map';
import { movingFeatures } from './samples';
import type { Sample } from './samples';

export type AirborneSettings = {
  altitude: number;
  reference: 'ground' | 'sea-level';
  bearing: number;
  elevation: number;
  fovX: number;
  fovY: number;
  range: number;
  color: string;
  blockedColor: string;
  blockedStrength: number;
  fillStrength: number;
  outlineWidth: number;
  outline: boolean;
  volumeStrength: number;
  wireframe: boolean;
  wireframeWidth: number;
  fallback: boolean;
  example: string;
};
export const defaultAirborneSettings: AirborneSettings = {
  altitude: 300,
  reference: 'ground',
  bearing: 60,
  elevation: -35,
  fovX: 60,
  fovY: 40,
  range: 2000,
  color: '#60a078',
  blockedColor: '#c46a60',
  blockedStrength: 18,
  fillStrength: 13,
  outlineWidth: 1.5,
  volumeStrength: 10,
  wireframe: true,
  wireframeWidth: 3,
  outline: true,
  fallback: true,
  example: 'normal',
};

export function airborneFeatures(
  tick: number,
  count: number,
  overrides: ReadonlyMap<string, AirborneSettings>,
): MapFeature<Sample>[] {
  return movingFeatures(tick, count).map((feature, index) => {
    if (index >= 100) return feature;
    const settings = overrides.get(feature.id) ?? defaultAirborneSettings;
    feature.properties.name = index === 0 ? 'Kestrel 01' : `Aircraft ${index + 1}`;
    feature.properties.kind = 'Airborne entity';
    feature.properties.icon = undefined;
    feature.properties.color = '#246d50';
    feature.properties.label = index < 10 ? feature.properties.name : undefined;
    if (feature.geometry.type === 'Point')
      feature.geometry.coordinates = [
        6.864 + (index % 10) * 0.002 + Math.sin(tick / 30 + index) * 0.001,
        45.917 + Math.floor(index / 10) * 0.002 + Math.cos(tick / 30 + index) * 0.001,
      ];
    const camera: EntityAttachment = {
      id: 'camera',
      name: 'Camera 01',
      type: 'camera',
      bearing: settings.bearing,
      elevation: settings.example === 'sky' ? 45 : settings.elevation,
      fovX: settings.fovX,
      fovY: settings.fovY,
      range: settings.range,
      color: settings.color,
      terrainVisibility: true,
      blockedColor: settings.blockedColor,
      blockedOpacity: settings.blockedStrength / 100,
      fillOpacity: settings.fillStrength / 100,
      volumeOpacity: settings.volumeStrength / 100,
      wireframe: settings.wireframe,
      wireframeWidth: settings.wireframeWidth,
      outline: settings.outline,
      outlineWidth: settings.outlineWidth,
    };
    feature.entity = {
      altitude:
        settings.example === 'missing'
          ? undefined
          : settings.example === 'below'
            ? { meters: -10, reference: 'ground' }
            : { meters: settings.altitude, reference: settings.reference },
      groundIfNoAltitude: settings.fallback,
      attachments:
        index === 0
          ? [
              camera,
              {
                id: 'safety',
                name: 'Safety sphere',
                type: 'sphere',
                radius: 150,
                color: '#7756a2',
              },
              {
                id: 'ground-zone',
                name: 'Ground zone',
                type: 'circle',
                radius: 250,
                color: '#326899',
              },
            ]
          : index < 10
            ? [camera]
            : [],
    };
    return feature;
  });
}

/** Controls for the selected entity and its simple camera overlay. */
export function mountAirborneInspector(
  viewport: Viewport<Sample>, container: HTMLElement,
  getSettings: (id: string) => AirborneSettings,
  onSettings: (id: string, settings: AirborneSettings) => void,
) {
  const controller = new AbortController();
  let previousId: string | undefined;
  const settings = { ...defaultAirborneSettings };
  const numeric = ['altitude', 'bearing', 'elevation', 'fovX', 'fovY', 'range', 'fillStrength', 'blockedStrength', 'outlineWidth', 'volumeStrength', 'wireframeWidth'] as const;
  const numberField = (key: typeof numeric[number], label: string, min: number, max: number, step = 1) =>
    `<label class="setting">${label}<input data-setting="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  container.innerHTML = `<h2>Airborne entities</h2>
    <label class="setting">Example<select data-setting="example"><option value="normal">Normal</option><option value="missing">Missing altitude</option><option value="below">Below terrain</option><option value="sky">Camera facing sky</option></select></label>
    <div class="airborne-visibility"><label><input type="checkbox" data-visible="footprints">Camera overlay</label><label><input type="checkbox" data-visible="zones">Zones</label><label><input type="checkbox" data-visible="groundLines">Ground lines</label></div>
    <h2>Altitude</h2>${numberField('altitude', 'Meters', -10000, 100000, 10)}
    <label class="setting">Reference<select data-setting="reference"><option value="ground">Above ground</option><option value="sea-level">Sea level</option></select></label>
    <label class="setting">Ground if no altitude<input type="checkbox" data-setting="fallback"></label>
    <h2>Camera overlay</h2>
    ${numberField('bearing', 'Bearing °', -360, 360)}
    ${numberField('elevation', 'Elevation °', -90, 90)}
    ${numberField('fovX', 'Horizontal FOV °', 1, 179)}
    ${numberField('fovY', 'Vertical FOV °', 1, 179)}
    ${numberField('range', 'Range m', 1, 100000)}
    <div class="camera-appearance">
      <div class="setting"><span>Visible color</span><div class="camera-color"><input type="color" data-setting="color" aria-label="Visible color"><input type="text" data-setting="color" aria-label="Visible hex color" pattern="#[0-9a-fA-F]{6}" maxlength="7" required></div></div>
      <label class="setting camera-strength">Visible opacity<input type="range" data-setting="fillStrength" min="0" max="100"><output data-strength></output></label>
      <div class="setting"><span>Blocked color</span><div class="camera-color"><input type="color" data-setting="blockedColor" aria-label="Blocked color"><input type="text" data-setting="blockedColor" aria-label="Blocked hex color" pattern="#[0-9a-fA-F]{6}" maxlength="7" required></div></div>
      <label class="setting camera-strength">Blocked opacity<input type="range" data-setting="blockedStrength" min="0" max="100"><output data-blocked-strength></output></label>
      <label class="setting">Outline<input type="checkbox" data-setting="outline"></label>
      ${numberField('outlineWidth', 'Outline width px', 1, 12, .5)}
      <label class="setting camera-strength">Cone shading<input type="range" data-setting="volumeStrength" min="0" max="100"><output data-volume-strength></output></label>
      <label class="setting">Wireframe<input type="checkbox" data-setting="wireframe"></label>
      ${numberField('wireframeWidth', 'Wireframe width px', 1, 12, .5)}
    </div><p>GPU terrain visibility. Missing terrain is left unshaded.</p><p data-state role="status"></p>`;
  function render() {
    const id = viewport.getSelection()[0], feature = id ? viewport.getFeature(id) : undefined;
    if (id !== previousId) { Object.assign(settings, id ? getSettings(id) : defaultAirborneSettings); previousId = id; }
    for (const input of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
      input.disabled = !feature?.entity;
      if (input === document.activeElement) continue;
      const key = input.dataset.setting as keyof AirborneSettings;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = settings[key] === true;
      else input.value = String(settings[key]);
    }
    for (const input of container.querySelectorAll<HTMLInputElement>('[data-visible]')) {
      const key = input.dataset.visible;
      if (key === 'footprints' || key === 'zones' || key === 'groundLines') input.checked = viewport.getConfiguration().entityVisibility[key];
    }
    container.querySelector<HTMLOutputElement>('[data-strength]')!.value = `${settings.fillStrength}%`;
    container.querySelector<HTMLOutputElement>('[data-blocked-strength]')!.value = `${settings.blockedStrength}%`;
    container.querySelector<HTMLOutputElement>('[data-volume-strength]')!.value = `${settings.volumeStrength}%`;
    const state = id ? viewport.getEntityState(id) : undefined;
    container.querySelector<HTMLElement>('[data-state]')!.textContent = state ? `${state.placement.replaceAll('-', ' ')} · overlay ${state.coverage}` : 'Select an airborne entity.';
  }
  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !input.checkValidity()) return;
    const visibility = input.dataset.visible;
    if (input instanceof HTMLInputElement && (visibility === 'footprints' || visibility === 'zones' || visibility === 'groundLines')) {
      viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, [visibility]: input.checked } });
      render(); return;
    }
    const key = input.dataset.setting;
    const numberKey = numeric.find(k => k === key);
    if (numberKey && input instanceof HTMLInputElement && Number.isFinite(input.valueAsNumber)) settings[numberKey] = input.valueAsNumber;
    else if ((key === 'outline' || key === 'fallback' || key === 'wireframe') && input instanceof HTMLInputElement) settings[key] = input.checked;
    else if (key === 'color' || key === 'blockedColor') settings[key] = input.value;
    else if (key === 'reference' && (input.value === 'ground' || input.value === 'sea-level')) settings.reference = input.value;
    else if (key === 'example') settings.example = input.value;
    else return;
    const id = viewport.getSelection()[0];
    if (id) onSettings(id, { ...settings });
    render();
  }, { signal: controller.signal });
  const offState = viewport.on('entitychange', render);
  const offSelection = viewport.on('selectionchange', render);
  render();
  return { destroy() { controller.abort(); offState(); offSelection(); container.replaceChildren(); } };
}
