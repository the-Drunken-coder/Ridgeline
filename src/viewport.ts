import { Map as GLMap, GeoJSONSource } from 'maplibre-gl';
import type { LayerSpecification, MapMouseEvent, ErrorEvent as GLErrorEvent } from 'maplibre-gl';
import { createReporter, RidgelineError } from './errors';
import { FeatureStore } from './features';
import type { FeatureStyle, IconDefinition, Interaction, MapConfiguration, MapFeature, Properties, Viewport, ViewportEvents, ViewportOptions } from './types';

const SOURCE = 'rl:features';
const TERRAIN = 'rl:terrain';
const SHADE = 'rl:hillshade';
const layerIds = ['rl:fill', 'rl:line', 'rl:points', 'rl:icons', 'rl:labels'];

export const DEFAULT_BASEMAP = 'https://tiles.openfreemap.org/styles/liberty';
export const DEFAULT_ELEVATION = {
  url: 'https://tiles.mapterhorn.com/tilejson.json',
  encoding: 'terrarium',
  tileSize: 512,
} satisfies MapConfiguration['elevation'];

/** Creates one viewport. Data may be supplied before ready; destroy is always safe. */
export function createViewport<P extends Properties = Properties>(options: ViewportOptions<P>): Viewport<P> {
  const store = new FeatureStore<P>();
  const report = createReporter(options.logger);
  const icons = new Map<string, IconDefinition>();
  const pending = new Map<string, MapFeature<P> | null>();
  let selected = new Set<string>();
  let previewId: string | null = null;
  let destroyed = false;
  let prepared = false;
  let readySettled = false;
  let frame = 0;
  let hovered = '';
  let configuration: MapConfiguration = {
    basemap: options.basemap ?? DEFAULT_BASEMAP,
    projection: options.projection ?? 'flat',
    terrain: options.terrain ?? false,
    hillshade: options.hillshade ?? false,
    exaggeration: options.exaggeration ?? 1,
    elevation: structuredClone(options.elevation ?? DEFAULT_ELEVATION),
  };
  const listeners: { [K in keyof ViewportEvents<P>]: Set<(value: ViewportEvents<P>[K]) => void> } = {
    click: new Set(), hover: new Set(), contextmenu: new Set(), selectionrequest: new Set(),
    datachange: new Set(), camerachange: new Set(), diagnostic: new Set(), destroy: new Set(),
  };
  function diagnostic(error: RidgelineError) {
    if (destroyed) return;
    report(error);
    try { options.onError?.(error); } catch { /* Keep diagnostic observers isolated. */ }
    emit('diagnostic', error);
  }
  function emit<K extends keyof ViewportEvents<P>>(event: K, value: ViewportEvents<P>[K]) {
    for (const listener of listeners[event]) {
      try { listener(value); } catch (cause) {
        const error = new RidgelineError('CALLBACK_FAILED', `A ${event} listener threw.`, { operation: event, recoverable: true }, cause);
        if (event === 'diagnostic') report(error); else diagnostic(error);
      }
    }
  }
  function assertActive() {
    if (destroyed) throw new RidgelineError('DESTROYED', 'This viewport has been destroyed.', { operation: 'access', recoverable: false });
  }
  let resolveReady: () => void;
  let rejectReady: (reason: RidgelineError) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // An intentionally abandoned mount still exposes a rejected ready promise, without a global unhandled rejection.
  void ready.catch(() => {});
  let map: GLMap;
  try {
    if (!Number.isFinite(configuration.exaggeration) || configuration.exaggeration < 0) throw new RidgelineError('INVALID_CONFIGURATION', 'Terrain exaggeration must be a finite nonnegative number.', { operation: 'create', recoverable: false });
    if (options.features) store.upsert(options.features);
    map = new GLMap({
      container: options.container,
      style: configuration.basemap,
      center: [6.87, 45.92], zoom: 11,
      ...options.camera,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    });
  } catch (cause) {
    const error = new RidgelineError('INITIALIZATION_FAILED', 'Unable to create the map viewport.', { operation: 'create', recoverable: false }, cause);
    diagnostic(error);
    throw error;
  }
  const timer = setTimeout(() => {
    if (!readySettled) failReady(new RidgelineError('INITIALIZATION_TIMEOUT', 'The initial map style did not become ready in time.', { operation: 'initialize', recoverable: false }));
  }, options.initializationTimeoutMs ?? 20_000);
  function failReady(error: RidgelineError) {
    if (!readySettled) { readySettled = true; clearTimeout(timer); rejectReady(error); }
    diagnostic(error);
  }
  function getName(feature: MapFeature<P>) {
    const name = options.name?.(feature) ?? feature.properties.name;
    return typeof name === 'string' && name.trim() ? name : feature.id;
  }
  function getStyle(feature: MapFeature<P>): FeatureStyle { return options.style?.(feature) ?? {}; }
  function rendered(feature: MapFeature<P>): MapFeature {
    const style = getStyle(feature);
    return {
      type: 'Feature', id: feature.id, geometry: feature.geometry,
      properties: {
        _rl_id: feature.id,
        _rl_color: style.color ?? '#216e5b', _rl_radius: style.radius ?? 6,
        _rl_width: style.lineWidth ?? 3, _rl_opacity: style.fillOpacity ?? 0.2,
        _rl_icon: style.icon && icons.has(style.icon) ? `rl:icon:${style.icon}` : '',
        _rl_label: style.label ?? '',
      },
    };
  }
  function synchronizeState(id: string) {
    if (prepared && map.getSource(SOURCE) && store.has(id)) map.setFeatureState({ source: SOURCE, id }, { selected: selected.has(id), hover: previewId === id });
  }
  function flush() {
    frame = 0;
    if (destroyed || !prepared) return;
    const source = map.getSource(SOURCE);
    if (!(source instanceof GeoJSONSource)) return;
    const changes = [...pending.entries()];
    pending.clear();
    if (!changes.length) return;
    try {
      const add = changes.flatMap(([, feature]) => feature ? [rendered(feature)] : []);
      const remove = changes.filter(([, feature]) => feature === null).map(([id]) => id);
      // updateData.add replaces an existing ID, including all geometry and properties.
      void source.updateData({ add, remove }).then(() => {
        if (!destroyed && map.getSource(SOURCE) === source) for (const [id] of changes) synchronizeState(id);
      }).catch(cause => {
        if (!destroyed && map.getSource(SOURCE) === source) diagnostic(new RidgelineError('UPDATE_FAILED', 'The renderer could not apply a feature update.', { operation: 'upsert', recoverable: true }, cause));
      });
    } catch (cause) {
      diagnostic(new RidgelineError('UPDATE_FAILED', 'Unable to prepare a feature update.', { operation: 'upsert', recoverable: true }, cause));
    }
  }
  function schedule() { if (!frame && prepared) frame = requestAnimationFrame(flush); }

  function applyElevation(replace = false) {
    if (!prepared) return;
    if (replace) {
      map.setTerrain(null);
      if (map.getLayer(SHADE)) map.removeLayer(SHADE);
      if (map.getSource(TERRAIN)) map.removeSource(TERRAIN);
      if (map.getSource(SHADE)) map.removeSource(SHADE);
    }
    for (const [id, enabled] of [[TERRAIN, configuration.terrain], [SHADE, configuration.hillshade]] as const) {
      if (enabled && !map.getSource(id)) map.addSource(id, { type: 'raster-dem', ...configuration.elevation });
    }
    map.setTerrain(configuration.terrain ? { source: TERRAIN, exaggeration: configuration.exaggeration } : null);
    if (configuration.hillshade && !map.getLayer(SHADE)) {
      const before = map.getStyle().layers?.find(layer => layer.type === 'symbol' || layer.id.startsWith('rl:'))?.id;
      map.addLayer({ id: SHADE, type: 'hillshade', source: SHADE, paint: { 'hillshade-exaggeration': 0.35 } }, before);
    }
    if (!configuration.hillshade && map.getLayer(SHADE)) map.removeLayer(SHADE);
    if (!configuration.terrain && map.getSource(TERRAIN)) map.removeSource(TERRAIN);
    if (!configuration.hillshade && map.getSource(SHADE)) map.removeSource(SHADE);
  }

  function prepareStyle() {
    if (destroyed) return;
    try {
      prepared = true;
      pending.clear();
      map.setProjection({ type: configuration.projection === 'flat' ? 'mercator' : 'globe' });
      for (const [id, icon] of icons) if (!map.hasImage(`rl:icon:${id}`)) map.addImage(`rl:icon:${id}`, icon.image, { pixelRatio: icon.pixelRatio ?? 1 });
      if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', promoteId: '_rl_id', data: { type: 'FeatureCollection', features: store.all().map(rendered) } });
      const layers: LayerSpecification[] = [
        { id: 'rl:fill', type: 'fill', source: SOURCE, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['get', '_rl_color'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.45, ['get', '_rl_opacity']] } },
        { id: 'rl:line', type: 'line', source: SOURCE, filter: ['in', '$type', 'LineString', 'Polygon'], paint: { 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', ['get', '_rl_color']], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, ['get', '_rl_width']] } },
        { id: 'rl:points', type: 'circle', source: SOURCE, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 12, ['get', '_rl_radius']], 'circle-color': ['get', '_rl_color'], 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2], 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', '#ffffff'] } },
        { id: 'rl:icons', type: 'symbol', source: SOURCE, filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_icon', '']], layout: { 'icon-image': ['get', '_rl_icon'], 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
        { id: 'rl:labels', type: 'symbol', source: SOURCE, layout: { 'text-field': ['get', '_rl_label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.8], 'text-anchor': 'top' }, paint: { 'text-color': '#203b32', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
      ];
      for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
      applyElevation();
      for (const id of selected) synchronizeState(id);
      if (previewId) synchronizeState(previewId);
      if (!readySettled) { readySettled = true; clearTimeout(timer); resolveReady(); }
    } catch (cause) {
      prepared = false;
      failReady(new RidgelineError('STYLE_FAILED', 'Unable to initialize Ridgeline map layers.', { operation: 'style', recoverable: readySettled }, cause));
    }
  }
  function interaction(event: MapMouseEvent, tolerance: number): Interaction<P> {
    const features: MapFeature<P>[] = [];
    if (prepared) {
      const { x, y } = event.point;
      const hits = map.queryRenderedFeatures([[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]], { layers: layerIds.filter(id => map.getLayer(id)) });
      const seen = new Set<string>();
      for (const hit of hits) {
        if (typeof hit.id !== 'string' || seen.has(hit.id)) continue;
        const feature = store.get(hit.id);
        if (feature) { seen.add(hit.id); features.push(feature); }
      }
    }
    return { features, point: { x: event.point.x, y: event.point.y }, lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat }, originalEvent: event.originalEvent };
  }
  function onError(event: GLErrorEvent) {
    const sourceId = 'sourceId' in event && typeof event.sourceId === 'string' ? event.sourceId : undefined;
    const elevation = sourceId === TERRAIN || sourceId === SHADE;
    const error = new RidgelineError(elevation ? 'ELEVATION_UNAVAILABLE' : prepared ? 'ASSET_FAILED' : 'STYLE_FAILED',
      elevation ? 'Elevation data is unavailable. Other map content can still be used.' : event.error.message,
      { operation: elevation ? 'elevation' : 'renderer', recoverable: prepared || elevation, sourceId }, event.error);
    if (!prepared && !readySettled && !sourceId) failReady(error); else diagnostic(error);
  }
  map.on('style.load', prepareStyle);
  map.on('error', onError);
  map.on('click', event => emit('click', interaction(event, 12)));
  map.on('contextmenu', event => emit('contextmenu', interaction(event, 6)));
  map.on('mousemove', event => {
    const value = interaction(event, 3);
    const id = value.features[0]?.id ?? '';
    if (id !== hovered) { hovered = id; emit('hover', value); }
  });
  map.on('moveend', () => emit('camerachange', { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }));
  const resize = new ResizeObserver(() => { if (!destroyed) map.resize(); });
  resize.observe(options.container);
  const onLeave = () => { hovered = ''; viewport.preview(null); };
  map.getCanvas().addEventListener('mouseleave', onLeave);

  const viewport: Viewport<P> = {
    ready, container: options.container, map,
    upsert(features) {
      assertActive();
      try {
        const changed = store.upsert(features);
        for (const feature of changed) pending.set(feature.id, feature);
        schedule(); emit('datachange', { ids: changed.map(feature => feature.id), removed: [] });
      } catch (cause) {
        const error = cause instanceof RidgelineError ? cause : new RidgelineError('INVALID_FEATURE', 'Feature data could not be copied.', { operation: 'upsert', recoverable: true }, cause);
        diagnostic(error); throw error;
      }
    },
    remove(ids) {
      assertActive(); const removed = store.remove(ids);
      for (const id of removed) { pending.set(id, null); selected.delete(id); if (previewId === id) previewId = null; if (prepared) map.removeFeatureState({ source: SOURCE, id }); }
      schedule(); emit('datachange', { ids: [], removed });
    },
    clear() { viewport.remove(store.ids()); },
    getFeature: id => store.get(id), getFeatures: () => store.all(), getName, getStyle,
    getIcon: id => icons.get(id),
    registerIcon(id, definition) {
      assertActive();
      if (!id.trim()) throw new RidgelineError('ICON_FAILED', 'An icon needs a nonempty ID.', { operation: 'registerIcon', recoverable: true });
      const key = `rl:icon:${id}`;
      if (prepared) {
        if (map.hasImage(key)) map.removeImage(key);
        map.addImage(key, definition.image, { pixelRatio: definition.pixelRatio ?? 1 });
      }
      icons.set(id, definition);
      for (const feature of store.all()) if (getStyle(feature).icon === id) pending.set(feature.id, feature);
      schedule();
    },
    setSelection(ids) {
      assertActive(); const previous = selected; selected = new Set(ids.filter(id => store.has(id)));
      for (const id of new Set([...previous, ...selected])) synchronizeState(id);
    },
    getSelection: () => [...selected],
    preview(id) {
      if (destroyed) return;
      const previous = previewId; previewId = id && store.has(id) ? id : null;
      if (previous) synchronizeState(previous); if (previewId) synchronizeState(previewId);
    },
    requestSelection(ids) { assertActive(); emit('selectionrequest', { ids: ids.filter(id => store.has(id)) }); },
    configure(next) {
      assertActive();
      if (next.exaggeration !== undefined && (!Number.isFinite(next.exaggeration) || next.exaggeration < 0)) {
        const error = new RidgelineError('INVALID_CONFIGURATION', 'Terrain exaggeration must be a finite nonnegative number.', { operation: 'configure', recoverable: true });
        diagnostic(error); throw error;
      }
      const styleChanged = next.basemap !== undefined && next.basemap !== configuration.basemap;
      configuration = {
        basemap: next.basemap ?? configuration.basemap,
        projection: next.projection ?? configuration.projection,
        terrain: next.terrain ?? configuration.terrain,
        hillshade: next.hillshade ?? configuration.hillshade,
        exaggeration: next.exaggeration ?? configuration.exaggeration,
        elevation: structuredClone(next.elevation ?? configuration.elevation),
      };
      if (styleChanged) { prepared = false; map.setStyle(configuration.basemap, { diff: false }); }
      else if (prepared) {
        map.setProjection({ type: configuration.projection === 'flat' ? 'mercator' : 'globe' });
        applyElevation(next.elevation !== undefined);
      }
    },
    getConfiguration: () => structuredClone(configuration),
    setCamera(camera, animation) { assertActive(); if (animation?.duration) map.easeTo({ ...camera, duration: animation.duration }); else map.jumpTo(camera); },
    fitBounds(bounds, animation) { assertActive(); map.fitBounds(bounds, { duration: animation?.duration ?? 0, padding: animation?.padding ?? 48 }); },
    on(event, listener) { assertActive(); listeners[event].add(listener); return () => listeners[event].delete(listener); },
    destroy() {
      if (destroyed) return;
      destroyed = true; prepared = false; emit('destroy', undefined);
      if (!readySettled) { readySettled = true; rejectReady(new RidgelineError('DESTROYED', 'Viewport was destroyed before initialization completed.', { operation: 'initialize', recoverable: false })); }
      clearTimeout(timer); cancelAnimationFrame(frame); resize.disconnect();
      map.getCanvas().removeEventListener('mouseleave', onLeave);
      map.remove(); pending.clear(); icons.clear(); selected.clear(); store.remove(store.ids());
      for (const set of Object.values(listeners)) set.clear();
    },
  };
  return viewport;
}
