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
  volumeColor: string;
  fillStrength: number;
  wireframe: boolean;
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
  volumeColor: '#176d46',
  fillStrength: 25,
  wireframe: true,
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
      volumeColor: settings.volumeColor,
      volumeOpacity: settings.fillStrength / 100,
      wireframe: settings.wireframe,
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

/** Playground-only controls for the selected expanded-inspector design. */
export function mountAirborneInspector(
  viewport: Viewport<Sample>,
  container: HTMLElement,
  getSettings: (id: string) => AirborneSettings,
  onSettings: (id: string, settings: AirborneSettings) => void,
) {
  const controller = new AbortController();
  const settings = { ...defaultAirborneSettings };
  let attachmentId = 'camera';
  let previousId: string | undefined;
  container.innerHTML = `<h2>Airborne entities</h2>
    <label class="setting">Example<select data-setting="example"><option value="normal">Normal</option><option value="missing">Missing altitude</option><option value="below">Below terrain</option><option value="sky">Camera facing sky</option></select></label>
    <div class="airborne-visibility"><label><input type="checkbox" data-visible="volumes" checked>Camera volumes</label><label><input type="checkbox" data-visible="footprints" checked>Footprints</label><label><input type="checkbox" data-visible="zones" checked>Zones</label><label><input type="checkbox" data-visible="groundLines" checked>Ground lines</label></div>
    <h2>Altitude</h2><label class="setting">Meters<input data-setting="altitude" type="number" step="10" value="300"></label>
    <label class="setting">Reference<select data-setting="reference"><option value="ground">Above ground</option><option value="sea-level">Sea level</option></select></label>
    <label class="setting">Ground if no altitude<input data-setting="fallback" type="checkbox" checked></label>
    <h2>Attachments</h2><label class="setting">Attachment<select data-attachment><option value="camera">Camera 01</option><option value="safety">Safety sphere</option><option value="ground-zone">Ground zone</option></select></label>
    <div data-camera>
      <label class="setting">Bearing °<input data-setting="bearing" type="number" step="5" value="60"></label>
      <label class="setting">Elevation °<input data-setting="elevation" type="number" min="-90" max="90" step="5" value="-35"></label>
      <label class="setting">Horizontal FOV °<input data-setting="fovX" type="number" min="1" max="179" value="60"></label>
      <label class="setting">Vertical FOV °<input data-setting="fovY" type="number" min="1" max="179" value="40"></label>
      <label class="setting">Range m<input data-setting="range" type="number" min="1" step="100" value="2000"></label>
      <div class="camera-appearance">
        <div class="setting"><span>Color</span><div class="camera-color"><input type="color" aria-label="Volume color" data-setting="volumeColor" value="#176d46"><input type="text" aria-label="Volume hex color" data-setting="volumeColor" value="#176d46" pattern="#[0-9a-fA-F]{6}" required maxlength="7" spellcheck="false"></div></div>
        <label class="setting camera-strength">Fill strength<input type="range" data-setting="fillStrength" min="0" max="100" step="1" value="25"><output data-strength>25%</output></label>
        <label class="setting">Wireframe<input type="checkbox" data-setting="wireframe" checked></label>
      </div>
    </div><dl data-zone hidden></dl><p data-state role="status"></p>`;
  function render() {
    const id = viewport.getSelection()[0],
      feature = id ? viewport.getFeature(id) : undefined;
    if (id !== previousId) {
      previousId = id;
      Object.assign(settings, id ? getSettings(id) : defaultAirborneSettings);
      for (const input of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        '[data-setting]',
      )) {
        const key = input.dataset.setting;
        if ((key === 'fallback' || key === 'wireframe') && input instanceof HTMLInputElement) input.checked = settings[key];
        else if (key && key in settings) input.value = String(settings[key as keyof AirborneSettings]);
      }
    }
    container.querySelector<HTMLOutputElement>('[data-strength]')!.value = `${settings.fillStrength}%`;
    for (const input of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]'))
      input.disabled = !feature?.entity;
    const select = container.querySelector<HTMLSelectElement>('[data-attachment]')!;
    const attachments = feature?.entity?.attachments ?? [];
    if (!attachments.some((a) => a.id === attachmentId)) attachmentId = attachments[0]?.id ?? '';
    const currentIds = Array.from(select.options)
      .map((o) => o.value)
      .join(',');
    if (currentIds !== attachments.map((a) => a.id).join(','))
      select.replaceChildren(...attachments.map((a) => new Option(a.name ?? a.id, a.id)));
    select.value = attachmentId;
    select.disabled = !attachments.length;
    const attachment = attachments.find((a) => a.id === attachmentId);
    container.querySelector<HTMLElement>('[data-camera]')!.hidden = attachment?.type !== 'camera';
    const zone = container.querySelector<HTMLElement>('[data-zone]')!;
    zone.hidden = !attachment || attachment.type === 'camera';
    if (attachment && attachment.type !== 'camera')
      zone.innerHTML =
        `<dt>Shape</dt><dd>${attachment.type}</dd><dt>Origin</dt><dd>Entity center</dd>` +
        ('radius' in attachment ? `<dt>Radius</dt><dd>${attachment.radius} m</dd>` : '');
    const state = id ? viewport.getEntityState(id) : undefined;
    container.querySelector<HTMLElement>('[data-state]')!.textContent = !feature?.entity
      ? 'Select an airborne entity.'
      : !state
        ? 'Loading elevation…'
        : `${state.placement.replaceAll('-', ' ')} · coverage ${state.coverage}`;
  }
  function updateAppearance(target: HTMLInputElement) {
    const key = target.dataset.setting;
    if (!target.checkValidity()) return;
    if (key === 'volumeColor') {
      const color = target.value.toLowerCase();
      if (color === settings.volumeColor) return;
      settings.volumeColor = color;
      for (const input of container.querySelectorAll<HTMLInputElement>('[data-setting="volumeColor"]'))
        input.value = color;
    } else if (key === 'fillStrength') {
      if (target.valueAsNumber === settings.fillStrength) return;
      settings.fillStrength = target.valueAsNumber;
    } else if (key === 'wireframe') {
      if (target.checked === settings.wireframe) return;
      settings.wireframe = target.checked;
    } else return;
    const id = viewport.getSelection()[0];
    if (id) onSettings(id, { ...settings });
    render();
  }
  container.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) updateAppearance(event.target);
  }, { signal: controller.signal });
  container.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (target.hasAttribute('data-visible') && target instanceof HTMLInputElement) {
        const visibility = viewport.getConfiguration().entityVisibility;
        const key = target.dataset.visible;
        if (key === 'volumes' || key === 'footprints' || key === 'zones' || key === 'groundLines')
          viewport.configure({
            entityVisibility: { ...visibility, [key]: target.checked },
          });
      } else if (target.hasAttribute('data-attachment')) {
        attachmentId = target.value;
        render();
      } else {
        const key = target.dataset.setting;
        if (key === 'volumeColor' || key === 'fillStrength' || key === 'wireframe') {
          if (target instanceof HTMLInputElement) {
            updateAppearance(target);
            target.reportValidity();
          }
          return;
        } else if (key === 'fallback' && target instanceof HTMLInputElement) settings.fallback = target.checked;
        else if (key === 'reference') settings.reference = target.value === 'ground' ? 'ground' : 'sea-level';
        else if (key === 'example') settings.example = target.value;
        else if (
          key === 'altitude' ||
          key === 'bearing' ||
          key === 'elevation' ||
          key === 'fovX' ||
          key === 'fovY' ||
          key === 'range'
        ) {
          if (
            !(target instanceof HTMLInputElement) ||
            !target.checkValidity() ||
            !Number.isFinite(target.valueAsNumber)
          ) {
            target.reportValidity();
            return;
          }
          settings[key] = target.valueAsNumber;
        }
        const id = viewport.getSelection()[0];
        if (id) onSettings(id, { ...settings });
        render();
      }
    },
    { signal: controller.signal },
  );
  const offState = viewport.on('entitychange', render),
    offSelection = viewport.on('selectionrequest', () => queueMicrotask(render));
  const offClick = viewport.on('click', (event) => {
    const hit = event.attachments[0];
    if (hit) {
      attachmentId = hit.attachmentId;
      queueMicrotask(render);
    }
  });
  render();
  return {
    render,
    destroy() {
      controller.abort();
      offState();
      offSelection();
      offClick();
      container.replaceChildren();
    },
  };
}
