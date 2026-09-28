import { shapeGeometry } from './drawing-geometry';
import { addArrowImage, arrowFeatures, ARROW_IMAGE } from './drawing-render';
import { Map as GLMap, GeoJSONSource } from 'maplibre-gl';
import type { LayerSpecification, MapMouseEvent, ErrorEvent as GLErrorEvent } from 'maplibre-gl';
import { createReporter, RidgelineError } from './errors';
import { FeatureStore } from './features';
import { createFeaturePublication } from './feature-publication';
import { FEATURE_SOURCE as SOURCE, mapLibreFeaturePublication, sourceFeatureId } from './maplibre-feature-publication';
import { hillshadePaint, resolveHillshade } from './hillshade';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from './entities';
import type { FeatureStyle, IconDefinition, Interaction, MapConfiguration, MapFeature, Properties, Viewport, ViewportEvents, ViewportOptions } from './types';

const TERRAIN = 'rl:terrain';
const SHADE = 'rl:hillshade';
const layerIds = ['rl:fill', 'rl:line', 'rl:dashed', 'rl:arrowheads', 'rl:points', 'rl:icons', 'rl:labels'];

export const DEFAULT_BASEMAP = 'https://tiles.openfreemap.org/styles/liberty';
export const DEFAULT_ELEVATION = {
  url: 'https://tiles.mapterhorn.com/tilejson.json',
  encoding: 'terrarium',
  tileSize: 512,
} satisfies MapConfiguration['elevation'];

/** Creates one viewport. Data may be supplied before ready; destroy is always safe. */
export function createViewport<P extends Properties = Properties>(options: ViewportOptions<P>): Viewport<P> {
  const store = new FeatureStore<P>();
  const publishedArrows = new Map<string, MapFeature<P>>();
  const report = createReporter(options.logger);
  const icons = new Map<string, IconDefinition>();
  let selected = new Set<string>();
  let previewId: string | null = null;
  let interactionOwner: string | null = null;
  let destroyed = false;
  let prepared = false;
  let readySettled = false;
  let hovered = '';
  let configuration: MapConfiguration = {
    basemap: structuredClone(options.basemap ?? DEFAULT_BASEMAP),
    projection: options.projection ?? 'flat',
    terrain: options.terrain ?? false,
    hillshade: options.hillshade ?? false,
    hillshadeOptions: {},
    exaggeration: options.exaggeration ?? 1,
    elevation: structuredClone(options.elevation ?? DEFAULT_ELEVATION),
    entityVisibility: { ...DEFAULT_ENTITY_VISIBILITY, ...options.entityVisibility },
  };
  const listeners: { [K in keyof ViewportEvents<P>]: Set<(value: ViewportEvents<P>[K]) => void> } = {
    interactionchange: new Set(), selectionchange: new Set(), click: new Set(), hover: new Set(), contextmenu: new Set(), selectionrequest: new Set(),
    datachange: new Set(), entitychange: new Set(), camerachange: new Set(), diagnostic: new Set(), destroy: new Set(),
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
    configuration.hillshadeOptions = resolveHillshade(options.hillshadeOptions);
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
  const entities = new EntityScene<P>({ map, configuration: () => configuration, style: getStyle, sampler: options.elevationSampler, diagnostic,
    changed: ids => {
      publication.update(ids.flatMap(id => { const feature = store.get(id); return feature ? [feature] : []; }));
      emit('entitychange', { ids });
    },
  });
  const publication = createFeaturePublication({ store, target: mapLibreFeaturePublication(map), render: rendered, sourceId: sourceFeatureId, diagnostic,
    beforeSubmit: () => {},
    published: (id, feature) => {
      const wasArrow = publishedArrows.has(id);
      if (feature?.drawing?.shape.kind === 'arrow') publishedArrows.set(id, feature);
      else publishedArrows.delete(id);
      if (wasArrow || publishedArrows.has(id)) syncArrows();
      synchronizeState(id);
    },
    restored: features => {
      publishedArrows.clear();
      for (const feature of features) if (feature.drawing?.shape.kind === 'arrow') publishedArrows.set(feature.id, feature);
    },
  });
  entities.set(store.all());
  const timer = setTimeout(() => {
    if (!readySettled) failReady(new RidgelineError('INITIALIZATION_TIMEOUT', 'The initial map style did not become ready in time.', { operation: 'initialize', recoverable: false }));
  }, options.initializationTimeoutMs ?? 20_000);
  function failReady(error: RidgelineError) {
    if (!readySettled) { readySettled = true; clearTimeout(timer); rejectReady(error); }
    diagnostic(error);
  }
  function getName(feature: MapFeature<P>) {
    const name = options.name?.(structuredClone(feature)) ?? feature.properties.name;
    return typeof name === 'string' && name.trim() ? name : feature.id;
  }
  function getStyle(feature: MapFeature<P>): FeatureStyle { return { ...options.style?.(structuredClone(feature)), ...feature.drawing?.style }; }
  function rendered(feature: MapFeature<P>): MapFeature {
    const style = getStyle(feature);
    const marker = entities.marker(feature);
    return {
      type: 'Feature', id: feature.id,
      geometry: feature.drawing ? shapeGeometry(feature.drawing.shape, true)
        : marker.position ? { type: 'Point', coordinates: marker.position } : feature.geometry,
      properties: {
        _rl_id: sourceFeatureId(feature.id), _rl_feature_id: feature.id,
        _rl_color: style.color ?? '#216e5b', _rl_fill: style.fillColor ?? style.color ?? '#216e5b', _rl_dashed: style.dashed ?? false, _rl_radius: style.radius ?? 6,
        _rl_width: style.lineWidth ?? 3, _rl_opacity: style.fillOpacity ?? 0.2,
        _rl_icon: style.icon && icons.has(style.icon) ? `rl:icon:${style.icon}` : '',
        _rl_label: style.label ?? '',
        _rl_hidden: !marker.visible, _rl_airborne: !marker.ground, _rl_height: marker.offset,
      },
    };
  }
  function synchronizeState(id: string) {
    if (prepared && map.getSource(SOURCE) && store.has(id)) map.setFeatureState({ source: SOURCE, id: sourceFeatureId(id) }, { selected: selected.has(id), hover: previewId === id });
  }
  function applyElevation(replace = false) {
    if (!prepared || destroyed) return;
    if (replace) {
      map.setTerrain(null);
      if (destroyed) return;
      if (map.getLayer(SHADE)) map.removeLayer(SHADE);
      if (destroyed) return;
      if (map.getSource(TERRAIN)) map.removeSource(TERRAIN);
      if (destroyed) return;
      if (map.getSource(SHADE)) map.removeSource(SHADE);
      if (destroyed) return;
    }
    for (const [id, enabled] of [[TERRAIN, configuration.terrain], [SHADE, configuration.hillshade]] as const) {
      if (destroyed) return;
      if (enabled && !map.getSource(id)) map.addSource(id, { type: 'raster-dem', ...configuration.elevation });
    }
    if (destroyed) return;
    map.setTerrain(configuration.terrain ? { source: TERRAIN, exaggeration: configuration.exaggeration } : null);
    if (destroyed) return;
    if (configuration.hillshade && !map.getLayer(SHADE)) {
      const before = map.getStyle().layers?.find(layer => layer.type === 'symbol' || layer.id.startsWith('rl:'))?.id;
      map.addLayer({ id: SHADE, type: 'hillshade', source: SHADE, paint: hillshadePaint(configuration.hillshadeOptions) }, before);
    }
    if (destroyed) return;
    if (configuration.hillshade && map.getLayer(SHADE)) {
      const paint = hillshadePaint(configuration.hillshadeOptions);
      for (const key of Object.keys(paint) as (keyof typeof paint)[]) {
        if (destroyed) return;
        map.setPaintProperty(SHADE, key, paint[key]);
      }
    }
    if (destroyed) return;
    if (!configuration.hillshade && map.getLayer(SHADE)) map.removeLayer(SHADE);
    if (destroyed) return;
    if (!configuration.terrain && map.getSource(TERRAIN)) map.removeSource(TERRAIN);
    if (destroyed) return;
    if (!configuration.hillshade && map.getSource(SHADE)) map.removeSource(SHADE);
  }

  function syncArrows() {
    if (!prepared || destroyed) return;
    addArrowImage(map);
    if (destroyed) return;
    const arrows = arrowFeatures([...publishedArrows.values()]);
    const source = map.getSource('rl:arrows');
    if (source instanceof GeoJSONSource) source.setData(arrows);
    else map.addSource('rl:arrows', { type: 'geojson', promoteId: '_rl_id', data: arrows });
    if (destroyed) return;
    if (!map.getLayer('rl:arrowheads')) map.addLayer({ id: 'rl:arrowheads', type: 'symbol', source: 'rl:arrows', layout: { 'icon-image': ARROW_IMAGE, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true }, paint: { 'icon-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'icon-color': ['get', 'color'] } });
  }

  function prepareStyle() {
    if (destroyed) return;
    try {
      prepared = true;
      map.setProjection({ type: configuration.projection === 'flat' ? 'mercator' : 'globe' });
      if (destroyed) return;
      for (const [id, icon] of icons) {
        if (destroyed) return;
        if (!map.hasImage(`rl:icon:${id}`)) map.addImage(`rl:icon:${id}`, icon.image, { pixelRatio: icon.pixelRatio ?? 1 });
      }
      if (destroyed) return;
      publication.restore();
      if (destroyed) return;
      const layers: LayerSpecification[] = [
        { id: 'rl:fill', type: 'fill', source: SOURCE, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['get', '_rl_fill'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, ['boolean', ['feature-state', 'selected'], false], 0.45, ['get', '_rl_opacity']] } },
        { id: 'rl:line', type: 'line', source: SOURCE, filter: ['all', ['in', '$type', 'LineString', 'Polygon'], ['!=', '_rl_dashed', true]], paint: { 'line-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', ['get', '_rl_color']], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, ['get', '_rl_width']] } },
        { id: 'rl:dashed', type: 'line', source: SOURCE, filter: ['all', ['in', '$type', 'LineString', 'Polygon'], ['==', '_rl_dashed', true]], paint: { 'line-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', ['get', '_rl_color']], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, ['get', '_rl_width']], 'line-dasharray': [3, 2] } },
        { id: 'rl:points', type: 'circle', source: SOURCE, filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_airborne', true], ['!=', '_rl_hidden', true]], paint: { 'circle-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 12, ['get', '_rl_radius']], 'circle-color': ['get', '_rl_color'], 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2], 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', '#ffffff'] } },
        { id: 'rl:icons', type: 'symbol', source: SOURCE, filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_icon', ''], ['!=', '_rl_hidden', true]], layout: { 'icon-image': ['get', '_rl_icon'], 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-height-offset': ['get', '_rl_height'] }, paint: { 'icon-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1] } },
        { id: 'rl:labels', type: 'symbol', source: SOURCE, filter: ['!=', '_rl_hidden', true], layout: { 'text-field': ['get', '_rl_label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.8], 'text-anchor': 'top', 'symbol-height-offset': ['get', '_rl_height'] }, paint: { 'text-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'text-color': '#203b32', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
      ];
      for (const layer of layers) { if (destroyed) return; if (!map.getLayer(layer.id)) map.addLayer(layer); }
      syncArrows();
      if (destroyed) return;
      applyElevation();
      if (destroyed) return;
      entities.attach();
      if (destroyed) return;
      for (const id of selected) synchronizeState(id);
      if (previewId) synchronizeState(previewId);
      if (!readySettled) { readySettled = true; clearTimeout(timer); resolveReady(); }
    } catch (cause) {
      prepared = false;
      publication.retire();
      failReady(new RidgelineError('STYLE_FAILED', 'Unable to initialize Ridgeline map layers.', { operation: 'style', recoverable: readySettled }, cause));
    }
  }
  function interaction(event: MapMouseEvent, tolerance: number): Interaction<P> {
    const features: MapFeature<P>[] = [];
    const attachments: Interaction<P>['attachments'] = [];
    if (prepared) {
      const { x, y } = event.point;
      const hits = map.queryRenderedFeatures([[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]], { layers: layerIds.filter(id => map.getLayer(id)) });
      const seen = new Set<string>();
      const seenAttachments = new Set<string>();
      const addEntityHits = (hits: ReturnType<typeof entities.pickAbove>) => { for (const hit of hits) {
        const feature = store.get(hit.entityId);
        if (!feature) continue;
        if (!seen.has(feature.id)) { seen.add(feature.id); features.push(feature); }
        if (hit.attachmentId) {
          const key = JSON.stringify([feature.id, hit.attachmentId]);
          if (!seenAttachments.has(key)) { seenAttachments.add(key); attachments.push({ entityId: feature.id, attachmentId: hit.attachmentId }); }
        }
      } };
      addEntityHits(entities.pickAbove(x, y, tolerance));
      for (const hit of hits) {
        const id = hit.properties?._rl_feature_id;
        if (typeof id !== 'string' || seen.has(id)) continue;
        const feature = store.get(id);
        if (feature) { seen.add(id); features.push(feature); }
      }
      addEntityHits(entities.pickGround(x, y, tolerance));
    }
    return { features, attachments, point: { x: event.point.x, y: event.point.y }, lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat }, originalEvent: event.originalEvent };
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
  map.on('click', event => { if (!interactionOwner) emit('click', interaction(event, 12)); });
  map.on('contextmenu', event => { if (!interactionOwner) emit('contextmenu', interaction(event, 6)); });
  map.on('mousemove', event => {
    if (interactionOwner) return;
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
    reportCallbackError(cause: unknown, operation: string, featureId?: string) {
      diagnostic(new RidgelineError('CALLBACK_FAILED', 'A consumer callback threw.',
        { operation, recoverable: true, featureId }, cause));
    },
    getInteractionOwner: () => interactionOwner,
    acquireInteraction(owner) {
      assertActive();
      if (interactionOwner) throw new Error(`Map interaction is owned by ${interactionOwner}.`);
      if (!owner.trim()) throw new Error('An interaction owner needs a name.');
      interactionOwner = owner; hovered = ''; viewport.preview(null); emit('interactionchange', { owner });
      let released = false;
      return () => { if (released) return; released = true; interactionOwner = null; hovered = ''; if (!destroyed) emit('interactionchange', { owner: null }); };
    },
    upsert(features) {
      assertActive();
      try {
        const changed = store.upsert(features);
        entities.set(changed);
        publication.update(changed);
        emit('datachange', { ids: changed.map(feature => feature.id), removed: [] });
      } catch (cause) {
        const error = cause instanceof RidgelineError ? cause : new RidgelineError('INVALID_FEATURE', 'Feature data could not be copied.', { operation: 'upsert', recoverable: true }, cause);
        diagnostic(error); throw error;
      }
    },
    remove(ids) {
      assertActive(); const removed = store.remove(ids);
      entities.set([], removed);
      publication.update([], removed);
      for (const id of removed) { selected.delete(id); if (previewId === id) previewId = null; if (prepared) map.removeFeatureState({ source: SOURCE, id: sourceFeatureId(id) }); }
      if (removed.length) entities.selection([...selected]);
      emit('datachange', { ids: [], removed });
    },
    clear() { viewport.remove(store.ids()); },
    retryUpdates() {
      assertActive();
      entities.retry();
      publication.retry();
    },
    getFeature: id => store.get(id), getFeatures: () => store.all(), getEntityState: id => entities.getState(id), getName, getStyle,
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
      const affected: MapFeature<P>[] = [];
      for (const feature of store.all()) {
        try { if (getStyle(feature).icon === id) affected.push(feature); }
        catch { affected.push(feature); } // Publication reports and retains failed work for retry.
      }
      publication.update(affected);
      if (affected.length) emit('datachange', { ids: affected.map(feature => feature.id), removed: [] });
    },
    setSelection(ids) {
      assertActive(); const previous = selected; selected = new Set(ids.filter(id => store.has(id)));
      entities.selection([...selected]);
      for (const id of new Set([...previous, ...selected])) synchronizeState(id);
      emit('selectionchange', { ids: [...selected] });
    },
    getSelection: () => [...selected],
    preview(id) {
      if (destroyed) return;
      const previous = previewId; previewId = id && store.has(id) ? id : null;
      if (previous) synchronizeState(previous); if (previewId) synchronizeState(previewId);
    },
    requestSelection(ids, attachments = []) {
      assertActive(); if (interactionOwner) return;
      const selectedIds = ids.filter(id => store.has(id));
      emit('selectionrequest', { ids: selectedIds, attachments: attachments.filter(hit => selectedIds.includes(hit.entityId) && store.get(hit.entityId)?.entity?.attachments?.some(a => a.id === hit.attachmentId)).map(hit => ({ ...hit })) });
    },
    configure(next) {
      assertActive();
      if (next.exaggeration !== undefined && (!Number.isFinite(next.exaggeration) || next.exaggeration < 0)) {
        const error = new RidgelineError('INVALID_CONFIGURATION', 'Terrain exaggeration must be a finite nonnegative number.', { operation: 'configure', recoverable: true });
        diagnostic(error); throw error;
      }
      let hillshadeOptions;
      try { hillshadeOptions = resolveHillshade(next.hillshadeOptions, configuration.hillshadeOptions); }
      catch (cause) { if (cause instanceof RidgelineError) diagnostic(cause); throw cause; }
      const styleChanged = next.basemap !== undefined && next.basemap !== configuration.basemap;
      configuration = {
        basemap: structuredClone(next.basemap ?? configuration.basemap),
        projection: next.projection ?? configuration.projection,
        terrain: next.terrain ?? configuration.terrain,
        hillshade: next.hillshade ?? configuration.hillshade,
        hillshadeOptions,
        exaggeration: next.exaggeration ?? configuration.exaggeration,
        elevation: structuredClone(next.elevation ?? configuration.elevation),
        entityVisibility: { ...configuration.entityVisibility, ...next.entityVisibility },
      };
      entities.configure(next.elevation !== undefined);
      if (styleChanged) { prepared = false; publication.retire(); map.setStyle(configuration.basemap, { diff: false }); }
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
      publication.destroy();
      if (!readySettled) { readySettled = true; rejectReady(new RidgelineError('DESTROYED', 'Viewport was destroyed before initialization completed.', { operation: 'initialize', recoverable: false })); }
      clearTimeout(timer); resize.disconnect();
      entities.destroy();
      map.getCanvas().removeEventListener('mouseleave', onLeave);
      map.remove(); icons.clear(); selected.clear(); store.remove(store.ids());
      for (const set of Object.values(listeners)) set.clear();
    },
  };
  return viewport;
}
