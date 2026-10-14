import { GeolocateControl, NavigationControl, ScaleControl } from 'maplibre-gl';
import type { ControlPosition, FullscreenControlOptions, GeolocateControlOptions, IControl, NavigationControlOptions, ScaleControlOptions } from 'maplibre-gl';
import { ownedFullscreen } from './owned-fullscreen';
import { formatCoordinate } from './coordinates';
import type { CoordinateFormatOptions } from './coordinates';
import { RidgelineError } from './errors';
import type { MapConfiguration, Properties, Viewport } from './types';

export type BasemapChoice = { id: string; name: string; basemap: MapConfiguration['basemap'] };
type ControlName = 'navigation' | 'scale' | 'fullscreen' | 'geolocate' | 'coordinates' | 'basemaps';
export type MapControlsOptions = {
  navigation?: boolean | NavigationControlOptions;
  scale?: boolean | ScaleControlOptions;
  fullscreen?: boolean | FullscreenControlOptions;
  /** Opt-in. Location is requested only after the user activates the native control. */
  geolocate?: boolean | GeolocateControlOptions;
  coordinates?: boolean | CoordinateFormatOptions;
  basemaps?: readonly BasemapChoice[];
  positions?: Partial<Record<ControlName, ControlPosition>>;
};

/** Install standard MapLibre controls and optional coordinate/basemap controls with one lifetime. */
export function attachMapControls<P extends Properties>(viewport: Viewport<P>, options: MapControlsOptions = {}) {
  const map = viewport.map;
  const controls: IControl[] = [];
  const cleanup: (() => void)[] = [];
  const abort = new AbortController();
  let disposed = false;
  let addingControl: IControl | undefined;
  const positions = { navigation: 'top-right', scale: 'bottom-left', fullscreen: 'top-right',
    geolocate: 'top-right', coordinates: 'bottom-right', basemaps: 'top-left', ...options.positions } satisfies Record<ControlName, ControlPosition>;
  for (const value of Object.values(positions)) {
    if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(value))
      throw new RidgelineError('INVALID_CONFIGURATION', 'Invalid map control position.', { operation: 'controls.attach', recoverable: true });
  }
  const choices = options.basemaps ? structuredClone(options.basemaps) : [];
  const ids = new Set<string>();
  for (const choice of choices) {
    if (!choice.id || !choice.name || ids.has(choice.id) || !choice.basemap)
      throw new RidgelineError('INVALID_CONFIGURATION', 'Basemap choices need unique IDs, names and styles.', { operation: 'controls.attach', recoverable: true });
    ids.add(choice.id);
  }
  const coordinateOptions = typeof options.coordinates === 'object' ? { ...options.coordinates } : {};
  if (options.coordinates) formatCoordinate([0, 0], coordinateOptions);
  function add(control: IControl, name: ControlName) {
    controls.push(control);
    addingControl = control;
    map.addControl(control, positions[name]);
    addingControl = undefined;
  }
  function domControl(node: HTMLElement): IControl {
    node.classList.add('maplibregl-ctrl', 'rl-map-control');
    return { onAdd: () => node, onRemove: () => { node.remove(); } };
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    for (const release of cleanup.splice(0)) {
      try { release(); } catch (cause) { viewport.reportCallbackError(cause, 'controls.destroy'); }
    }
    for (const control of controls.splice(0).reverse()) {
      // Native onAdd can install resources before addControl registers it.
      try { if (map.hasControl(control) || control === addingControl) map.removeControl(control); }
      catch (cause) { viewport.reportCallbackError(cause, 'controls.destroy'); }
    }
    addingControl = undefined;
  }
  try {
    if (options.navigation !== false) add(new NavigationControl(typeof options.navigation === 'object' ? options.navigation : {}), 'navigation');
    if (options.scale !== false) add(new ScaleControl(typeof options.scale === 'object' ? options.scale : {}), 'scale');
    if (options.fullscreen !== false) add(ownedFullscreen(viewport, typeof options.fullscreen === 'object' ? options.fullscreen : {}), 'fullscreen');
    if (options.geolocate) add(new GeolocateControl(typeof options.geolocate === 'object' ? options.geolocate : {}), 'geolocate');
    if (options.coordinates) {
      const output = document.createElement('output');
      output.classList.add('rl-coordinates');
      output.setAttribute('aria-label', 'Map center coordinates');
      // Readout is intentionally not live: announcing every camera frame interrupts navigation.
      output.setAttribute('aria-live', 'off');
      const render = () => {
        if (disposed) return;
        const center = map.getCenter();
        output.style.maxWidth = `${Math.max(40, viewport.container.clientWidth - 30)}px`;
        output.value = formatCoordinate([((center.lng + 180) % 360 + 360) % 360 - 180, center.lat], coordinateOptions);
      };
      add(domControl(output), 'coordinates');
      cleanup.push(viewport.on('camerachange', render));
      map.on('resize', render);
      cleanup.push(() => { map.off('resize', render); });
      render();
    }
    if (choices.length) {
      const label = document.createElement('label');
      label.classList.add('rl-basemaps');
      label.append(document.createTextNode('Basemap'));
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Basemap');
      const keys = new Map(choices.map(choice => [choice.id, JSON.stringify(choice.basemap)]));
      for (const choice of choices) select.add(new Option(choice.name, choice.id));
      const unknown = new Option('Custom', ''); unknown.disabled = true; select.add(unknown);
      let selectedId = '';
      function render() {
        if (disposed) return;
        const current = JSON.stringify(viewport.getConfiguration().basemap);
        // Equivalent styles retain the user's label until the accepted style changes.
        selectedId = (keys.get(selectedId) === current ? selectedId :
          choices.find(choice => keys.get(choice.id) === current)?.id) ?? '';
        select.value = selectedId;
      }
      select.addEventListener('change', () => {
        const choice = choices.find(choice => choice.id === select.value);
        if (!choice || disposed) return;
        selectedId = choice.id;
        try { viewport.configure({ basemap: choice.basemap }); }
        catch (cause) { viewport.reportCallbackError(cause, 'controls.basemap'); }
        render();
      }, { signal: abort.signal });
      label.append(select);
      add(domControl(label), 'basemaps');
      cleanup.push(viewport.on('configurationchange', render));
      render();
    }
    cleanup.push(viewport.on('destroy', destroy));
  } catch (cause) { destroy(); throw cause; }
  return { destroy };
}
