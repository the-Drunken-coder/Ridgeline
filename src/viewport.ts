import { ModelLabels } from './model-labels';
import { ModelVisibility } from './model-visibility';
import { shapeGeometry } from './drawing-shapes';
import { createArrowheads } from './arrowheads';
import { Map as GLMap, GPUInitializationError } from 'maplibre-gl';
import type { LayerSpecification, MapMouseEvent, ErrorEvent as GLErrorEvent } from 'maplibre-gl';
import { createReporter, RidgelineError } from './errors';
import { FeatureStore } from './features';
import { createFeaturePublication } from './feature-publication';
import { FEATURE_SOURCE as SOURCE, mapLibreFeaturePublication, sourceFeatureId } from './maplibre-feature-publication';
import { hillshadePaint, resolveHillshade } from './hillshade';
import { ModelRegistry } from './models';
import type { ModelGpu } from './model-renderer';
import { DEFAULT_ENTITY_MODELS, modelSettings } from './model-settings';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from './entities';
import type { FeatureStyle, IconDefinition, Interaction, MapConfiguration, MapFeature, Properties, Viewport, ViewportEvents, ViewportOptions } from './types';

const TERRAIN = 'rl:terrain';
const SHADE = 'rl:hillshade';
const layerIds = ['rl:fill', 'rl:line', 'rl:dashed', 'rl:arrowheads', 'rl:points', 'rl:icons', 'rl:labels'];

type ViewportDrawingInternals = {
  setEditing(id: string | null): void;
  onPrepared(listener: () => void): () => void;
  onSceneChange(listener: () => void): () => void;
  reportTargetError(cause?: unknown): void;
};
const drawingInternals = new WeakMap<object, ViewportDrawingInternals>();

/** The drawing tools use this seam without expanding the consumer Viewport API. */
export function getViewportDrawingInternals<P extends Properties>(viewport: Viewport<P>): ViewportDrawingInternals | undefined {
  return drawingInternals.get(viewport.map);
}

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
  let editingId: string | null = null;
  const preparedListeners = new Set<() => void>();
  const sceneListeners = new Set<() => void>();
  let interactionOwner: string | null = null;
  let destroyed = false;
  let prepared = false;
  let contextLost = false;
  let interactionRevision = 0;
  let sceneGeneration = 0;
  let readySettled = false;
  let hovered = '';
  let hoverInvalidated = false;
  const hoverNotified = new Set<(value: Interaction<P>) => void>();
  let configuration: MapConfiguration = {
    basemap: structuredClone(options.basemap ?? DEFAULT_BASEMAP),
    projection: options.projection ?? 'flat',
    terrain: options.terrain ?? false,
    hillshade: options.hillshade ?? false,
    hillshadeOptions: {},
    exaggeration: options.exaggeration ?? 1,
    elevation: structuredClone(options.elevation ?? DEFAULT_ELEVATION),
    entityVisibility: { ...DEFAULT_ENTITY_VISIBILITY, ...options.entityVisibility },
    entityModels: { ...DEFAULT_ENTITY_MODELS, ...options.entityModels },
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
  function emit<K extends keyof ViewportEvents<P>>(event: K, value: ViewportEvents<P>[K], current?: () => boolean, notified?: Set<(value: ViewportEvents<P>[K]) => void>) {
    for (const listener of listeners[event]) {
      if (current && !current()) break;
      if (notified?.has(listener)) continue;
      notified?.add(listener);
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
    configuration.entityModels = modelSettings(DEFAULT_ENTITY_MODELS, options.entityModels);
    for (const feature of options.features ?? []) if (feature.entity?.model) modelSettings(configuration.entityModels, feature.entity.model);
    if (options.features) store.upsert(options.features);
    map = new GLMap({
      container: options.container,
      style: structuredClone(configuration.basemap),
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
  const modelVisibility = new ModelVisibility(map);
  const modelLabels = new ModelLabels(map, ids => publication.update(ids.flatMap(id => { const feature = store.get(id); return feature ? [feature] : []; })));
  const preparedMarkerKeys = new WeakMap<MapFeature<P>, string>();
  const publishedMarkerKeys = new Map<string, string>();
  let nativeSource: unknown;
  let availableMarkers = new Map<string, string>();
  let frameMarkers: Map<string, string> | undefined;
  const models = new ModelRegistry<ModelGpu>({ diagnostic, changed: id => entities.modelsChanged(id) });
  const entities = new EntityScene<P>({ models, map, configuration: () => configuration, style: getStyle, sampler: options.elevationSampler, diagnostic,
    contextLost: () => {
      contextLost = true; prepared = false; sceneGeneration++; interactionRevision++;
      publication.retire(); modelVisibility.invalidate(); modelLabels.invalidate();
      scheduleHover();
    },
    contextRestored: () => { contextLost = false; },
    beginNativeFrame: () => { frameMarkers = undefined; },
    nativeAvailable: (feature, style) => {
      const source = map.getSource(SOURCE);
      if (!source) return false;
      if (source !== nativeSource) { nativeSource = source; availableMarkers.clear(); }
      const key = markerKey(feature, style);
      if (availableMarkers.get(feature.id) === key) return true;
      if (publishedMarkerKeys.get(feature.id) === key && map.isSourceLoaded(SOURCE)) {
        availableMarkers.set(feature.id, key); return true;
      }
      frameMarkers ??= new Map(map.querySourceFeatures(SOURCE).flatMap(item =>
        typeof item.properties?._rl_feature_id === 'string' && typeof item.properties?._rl_marker === 'string'
          ? [[item.properties._rl_feature_id, item.properties._rl_marker] as [string, string]] : []));
      if (frameMarkers.get(feature.id) === key) { availableMarkers.set(feature.id, key); return true; }
      return false;
    },
    commitPresentation: (records, current) => modelLabels.commit(records, current),
    commitVisibility: (hidden, current) => modelVisibility.commit(hidden, current),
    representationChanged: ids => { if (!destroyed) emit('entitychange', { ids }); },
    changed: ids => {
      publication.update(ids.flatMap(id => { const feature = store.get(id); return feature ? [feature] : []; }));
      for (const id of ids) { if (destroyed) return; synchronizeState(id); }
      if (!destroyed) emit('entitychange', { ids });
    },
  });
  const arrowheads = createArrowheads(map, 'rl:arrows', 'rl:arrowheads');
  const publication = createFeaturePublication({ store, target: mapLibreFeaturePublication(map), render: rendered, sourceId: sourceFeatureId, diagnostic,
    published: (id, feature) => {
      const marker = feature && preparedMarkerKeys.get(feature);
      if (marker) publishedMarkerKeys.set(id, marker); else publishedMarkerKeys.delete(id);
      const wasArrow = publishedArrows.has(id);
      if (feature?.drawing?.shape.kind === 'arrow') publishedArrows.set(id, feature);
      else publishedArrows.delete(id);
      if (wasArrow || publishedArrows.has(id)) syncArrows();
      synchronizeState(id);
    },
    restored: features => {
      publishedMarkerKeys.clear();
      for (const feature of features) { const key = preparedMarkerKeys.get(feature); if (key) publishedMarkerKeys.set(feature.id, key); }
      publishedArrows.clear();
      for (const feature of features) if (feature.drawing?.shape.kind === 'arrow') publishedArrows.set(feature.id, feature);
    },
  });
  entities.set(store.all());
  const timer = setTimeout(() => {
    if (!readySettled) failReady(new RidgelineError('INITIALIZATION_TIMEOUT', 'The initial map style did not become ready in time.', { operation: 'initialize', recoverable: false }));
  }, options.initializationTimeoutMs ?? 20_000);
  function failReady(error: RidgelineError) {
    if (!readySettled) { readySettled = true; clearTimeout(timer); rejectReady(error); models.readinessFailed(error); }
    diagnostic(error);
  }
  function getName(feature: MapFeature<P>) {
    const name = options.name?.(structuredClone(feature)) ?? feature.properties.name;
    return typeof name === 'string' && name.trim() ? name : feature.id;
  }
  function getStyle(feature: MapFeature<P>): FeatureStyle { return { ...options.style?.(structuredClone(feature)), ...feature.drawing?.style }; }
  function markerKey(feature: MapFeature<P>, style: FeatureStyle) {
    const marker = entities.marker(feature);
    return JSON.stringify([marker.position ?? feature.geometry.coordinates, marker.visible, marker.ground, marker.offset,
      style.icon && icons.has(style.icon) ? style.icon : '', style.color ?? '#216e5b', style.radius ?? 6]);
  }
  function rendered(feature: MapFeature<P>): MapFeature {
    const style = getStyle(feature);
    const marker = entities.marker(feature), key = feature.entity ? markerKey(feature, style) : undefined;
    if (key) preparedMarkerKeys.set(feature, key);
    return {
      type: 'Feature', id: feature.id,
      geometry: feature.drawing ? shapeGeometry(feature.drawing.shape, true)
        : marker.position ? { type: 'Point', coordinates: marker.position } : feature.geometry,
      properties: {
        ...modelLabels.properties(feature.id),
        _rl_id: sourceFeatureId(feature.id), _rl_feature_id: feature.id, ...(key ? { _rl_marker: key } : {}),
        _rl_color: style.color ?? '#216e5b', _rl_fill: style.fillColor ?? style.color ?? '#216e5b', _rl_dashed: style.dashed ?? false, _rl_radius: style.radius ?? 6,
        _rl_width: style.lineWidth ?? 3, _rl_opacity: style.fillOpacity ?? 0.2,
        _rl_icon: style.icon && icons.has(style.icon) ? `rl:icon:${style.icon}` : '',
        _rl_label: style.label ?? '',
        _rl_hidden: !marker.visible, _rl_airborne: !marker.ground, _rl_height: marker.offset,
      },
    };
  }
  function synchronizeState(id: string) {
    if (prepared && map.getSource(SOURCE) && store.has(id)) map.setFeatureState({ source: SOURCE, id: sourceFeatureId(id) }, { selected: selected.has(id), hover: previewId === id, editing: editingId === id });
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
    arrowheads.show([...publishedArrows.values()].filter(feature => feature.id !== editingId));
  }

  function notifyDrawingListener(listener: () => void, operation: 'style' | 'configure') {
    try { listener(); } catch (cause) {
      diagnostic(new RidgelineError('CALLBACK_FAILED', 'A drawing listener threw.', { operation, recoverable: true }, cause));
    }
  }

  function prepareStyle() {
    if (destroyed) return;
    const generation = sceneGeneration;
    const current = () => !destroyed && sceneGeneration === generation;
    try {
      prepared = true;
      map.setProjection({ type: configuration.projection === 'flat' ? 'mercator' : 'globe' });
      if (!current()) return;
      for (const [id, icon] of icons) {
        if (!current()) return;
        if (!map.hasImage(`rl:icon:${id}`)) map.addImage(`rl:icon:${id}`, icon.image, { pixelRatio: icon.pixelRatio ?? 1 });
      }
      if (!current()) return;
      publication.restore();
      if (!current()) return;
      const layers: LayerSpecification[] = [
        { id: 'rl:fill', type: 'fill', source: SOURCE, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['get', '_rl_fill'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, ['boolean', ['feature-state', 'selected'], false], 0.45, ['get', '_rl_opacity']] } },
        { id: 'rl:line', type: 'line', source: SOURCE, filter: ['all', ['in', '$type', 'LineString', 'Polygon'], ['!=', '_rl_dashed', true]], paint: { 'line-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', ['get', '_rl_color']], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, ['get', '_rl_width']] } },
        { id: 'rl:dashed', type: 'line', source: SOURCE, filter: ['all', ['in', '$type', 'LineString', 'Polygon'], ['==', '_rl_dashed', true]], paint: { 'line-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1], 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', ['get', '_rl_color']], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, ['get', '_rl_width']], 'line-dasharray': [3, 2] } },
        { id: 'rl:points', type: 'circle', source: SOURCE, filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_airborne', true], ['!=', '_rl_hidden', true]], paint: { 'circle-opacity': ['case', ['any', ['boolean', ['feature-state', 'editing'], false], ['boolean', ['feature-state', 'model'], false]], 0, 1], 'circle-stroke-opacity': ['case', ['any', ['boolean', ['feature-state', 'editing'], false], ['boolean', ['feature-state', 'model'], false]], 0, 1], 'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 12, ['get', '_rl_radius']], 'circle-color': ['get', '_rl_color'], 'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2], 'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#db6a20', '#ffffff'] } },
        { id: 'rl:icons', type: 'symbol', source: SOURCE, filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_icon', ''], ['!=', '_rl_hidden', true]], layout: { 'icon-image': ['get', '_rl_icon'], 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-height-offset': ['get', '_rl_height'] }, paint: { 'icon-opacity': ['case', ['any', ['boolean', ['feature-state', 'editing'], false], ['boolean', ['feature-state', 'model'], false]], 0, 1] } },
        { id: 'rl:labels', type: 'symbol', source: SOURCE, filter: ['!=', '_rl_hidden', true], layout: { 'text-field': ['get', '_rl_label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': ['coalesce', ['get', '_rl_label_offset'], ['literal', [0, 1.8]]], 'text-anchor': 'top', 'symbol-height-offset': ['get', '_rl_height'] }, paint: { 'text-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, ['==', ['coalesce', ['get', '_rl_label_stamp'], ''], ['coalesce', ['feature-state', 'labelStamp'], '']], 1, 0], 'text-color': '#203b32', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
      ];
      for (const layer of layers) { if (!current()) return; if (!map.getLayer(layer.id)) map.addLayer(layer); }
      syncArrows();
      if (!current()) return;
      applyElevation();
      if (!current()) return;
      entities.attach();
      // Fallbacks draw after models, so a detected model draw failure can expose them in this frame.
      for (const id of ['rl:points', 'rl:icons', 'rl:labels']) map.moveLayer(id);
      modelVisibility.invalidate(); modelLabels.invalidate();
      if (!current()) return;
      for (const id of selected) synchronizeState(id);
      if (previewId) synchronizeState(previewId);
      if (editingId) synchronizeState(editingId);
      if (!readySettled) { readySettled = true; clearTimeout(timer); resolveReady(); }
      for (const listener of preparedListeners) {
        if (!current()) return;
        notifyDrawingListener(listener, 'style');
      }
    } catch (cause) {
      if (!current()) return;
      prepared = false;
      publication.retire();
      failReady(new RidgelineError('STYLE_FAILED', 'Unable to initialize Ridgeline map layers.', { operation: 'style', recoverable: readySettled }, cause));
    }
  }
  function interaction(event: Pick<MapMouseEvent, 'point' | 'lngLat' | 'originalEvent'>, tolerance: number): Interaction<P> {
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
      const addNativeHits = (native: typeof hits) => { for (const hit of native) {
        const id = hit.properties?._rl_feature_id;
        if (typeof id !== 'string' || seen.has(id)) continue;
        if (hit.layer.id === 'rl:labels' && !modelLabels.acceptsHit(id, hit.properties?._rl_label_stamp)) continue;
        const representation = entities.getState(id)?.representation;
        if ((hit.layer.id === 'rl:points' || hit.layer.id === 'rl:icons') && (representation === 'model' || representation === 'withheld')) continue;
        const feature = store.get(id);
        if (feature) { seen.add(id); features.push(feature); }
      } };
      const overlay = (id: string) => id === 'rl:labels' || id === 'rl:icons' || id === 'rl:points';
      addNativeHits(hits.filter(hit => overlay(hit.layer.id)));
      addEntityHits(entities.pickAbove(x, y, tolerance));
      addNativeHits(hits.filter(hit => !overlay(hit.layer.id)));
      addEntityHits(entities.pickGround(x, y, tolerance));
    }
    return { features, attachments, point: { x: event.point.x, y: event.point.y }, lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat }, originalEvent: event.originalEvent };
  }
  function onError(event: GLErrorEvent) {
    if (contextLost && event.error instanceof GPUInitializationError) models.readinessFailed(new RidgelineError('MODEL_RENDERER_FAILED', 'The restored map could not create its rendering context.',
      { operation: 'restoreModel', recoverable: true }, event.error));
    const sourceId = 'sourceId' in event && typeof event.sourceId === 'string' ? event.sourceId : undefined;
    const elevation = sourceId === TERRAIN || sourceId === SHADE;
    const error = new RidgelineError(elevation ? 'ELEVATION_UNAVAILABLE' : prepared ? 'ASSET_FAILED' : 'STYLE_FAILED',
      elevation ? 'Elevation data is unavailable. Other map content can still be used.' : event.error.message,
      { operation: elevation ? 'elevation' : 'renderer', recoverable: prepared || elevation, sourceId }, event.error);
    if (!prepared && !readySettled && !sourceId) failReady(error); else diagnostic(error);
  }
  map.on('style.load', prepareStyle);
  map.on('error', onError);
  map.on('webglcontextlost', () => entities.contextLost());
  map.on('webglcontextrestored', () => { contextLost = false; });
  const interactionCurrent = (revision: number) => () => !destroyed && !interactionOwner && interactionRevision === revision;
  map.on('click', event => { if (!interactionOwner) emit('click', interaction(event, 12), interactionCurrent(interactionRevision)); });
  map.on('contextmenu', event => { if (!interactionOwner) emit('contextmenu', interaction(event, 6), interactionCurrent(interactionRevision)); });
  let lastPointer: Pick<MapMouseEvent, 'point' | 'originalEvent'> | undefined;
  function updateHover(event: Pick<MapMouseEvent, 'point' | 'lngLat' | 'originalEvent'>) {
    const value = interaction(event, 3);
    const id = value.features[0]?.id ?? '';
    if (id !== hovered || hoverInvalidated) {
      const current = interactionCurrent(interactionRevision);
      if (id !== hovered) hoverNotified.clear();
      hovered = id; hoverInvalidated = false; emit('hover', value, current, hoverNotified);
      // A callback can replace a feature before later observers receive it.
      // Resume with the remaining observers after the next draw. Repeating the
      // initiating callback could create a replacement/render loop for the same ID.
      if (!current()) hoverInvalidated = true;
    }
  }
  function refreshHover() {
    if (destroyed || interactionOwner || !lastPointer) return;
    updateHover({ ...lastPointer, lngLat: map.unproject(lastPointer.point) });
  }
  map.on('mousemove', event => {
    lastPointer = { point: event.point, originalEvent: event.originalEvent };
    if (interactionOwner) return;
    updateHover(event);
  });
  let hoverQueued = false;
  function scheduleHover() {
    if (hoverQueued || destroyed) return;
    hoverQueued = true;
    queueMicrotask(() => { hoverQueued = false; refreshHover(); });
  }
  // Run after every completed draw, including camera motion, without scheduling a new frame.
  map.on('render', scheduleHover);
  // Feature publication and camera changes can alter the pick under a still pointer.
  map.on('idle', refreshHover);
  map.on('moveend', () => {
    emit('camerachange', { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
    refreshHover();
  });
  const resize = new ResizeObserver(() => { if (!destroyed) map.resize(); });
  resize.observe(options.container);
  const onLeave = () => { lastPointer = undefined; hovered = ''; hoverNotified.clear(); viewport.preview(null); };
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
      interactionRevision++; interactionOwner = owner; hovered = ''; hoverNotified.clear(); viewport.preview(null); emit('interactionchange', { owner });
      let released = false;
      return () => {
        if (released) return;
        released = true; interactionOwner = null; hovered = '';
        if (!destroyed) {
          emit('interactionchange', { owner: null });
          // Let the outgoing owner finish removing its cursor and feedback first.
          queueMicrotask(refreshHover);
        }
      };
    },
    upsert(features) {
      assertActive();
      try {
        for (const feature of features) if (feature.entity?.model) modelSettings(configuration.entityModels, feature.entity.model);
        const changed = store.upsert(features);
        interactionRevision++;
        entities.set(changed);
        if (destroyed) return;
        const current = changed.flatMap(feature => { const latest = store.get(feature.id); return latest ? [latest] : []; });
        publication.update(current);
        emit('datachange', { ids: current.map(feature => feature.id), removed: [] });
      } catch (cause) {
        const error = cause instanceof RidgelineError ? cause : new RidgelineError('INVALID_FEATURE', 'Feature data could not be copied.', { operation: 'upsert', recoverable: true }, cause);
        diagnostic(error); throw error;
      }
    },
    remove(ids) {
      assertActive(); const accepted = store.remove(ids); interactionRevision++;
      entities.set([], accepted);
      if (destroyed) return;
      const removed = accepted.filter(id => !store.has(id));
      publication.update([], removed);
      for (const id of removed) { selected.delete(id); if (editingId === id) editingId = null; if (previewId === id) previewId = null; if (prepared) map.removeFeatureState({ source: SOURCE, id: sourceFeatureId(id) }); }
      if (removed.length) { modelVisibility.invalidate(); modelLabels.invalidate(); }
      for (const id of removed) { availableMarkers.delete(id); publishedMarkerKeys.delete(id); }
      if (removed.length) entities.selection([...selected]);
      emit('datachange', { ids: [], removed });
      if (removed.includes(hovered)) scheduleHover();
    },
    clear() { viewport.remove(store.ids()); },
    retryUpdates() {
      assertActive();
      entities.retry();
      publication.retry();
    },
    getFeature: id => store.get(id), getFeatures: () => store.all(), getEntityState: id => entities.getState(id), getName, getStyle,
    getIcon: id => icons.get(id),
    registerModel(id, definition) { assertActive(); return models.register(id, definition); },
    unregisterModel(id) { assertActive(); models.unregister(id); },
    registerIcon(id, definition) {
      assertActive();
      if (!id.trim()) throw new RidgelineError('ICON_FAILED', 'An icon needs a nonempty ID.', { operation: 'registerIcon', recoverable: true });
      const key = `rl:icon:${id}`;
      if (prepared) {
        if (map.hasImage(key)) map.removeImage(key);
        if (destroyed) return;
        map.addImage(key, definition.image, { pixelRatio: definition.pixelRatio ?? 1 });
        if (destroyed) return;
      }
      icons.set(id, definition);
      const affectedIds: string[] = [];
      for (const feature of store.all()) {
        let usesIcon = true;
        try { usesIcon = getStyle(feature).icon === id; }
        catch { /* Publication reports and retains failed work for retry. */ }
        if (destroyed) return;
        if (usesIcon) affectedIds.push(feature.id);
      }
      // Any callback can change an ID examined earlier in the registration.
      const affected = affectedIds.flatMap(id => { const feature = store.get(id); return feature ? [feature] : []; });
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
      entities.preview(previewId);
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
      let entityModels;
      try {
        entityModels = modelSettings(configuration.entityModels, next.entityModels);
        for (const feature of store.all()) if (feature.entity?.model) modelSettings(entityModels, feature.entity.model);
      } catch (cause) {
        const error = new RidgelineError('INVALID_CONFIGURATION', 'Invalid effective entity model settings.', { operation: 'configure', recoverable: true }, cause);
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
        entityModels,
      };
      if (styleChanged || next.projection !== undefined || next.terrain !== undefined ||
        next.exaggeration !== undefined || next.elevation !== undefined) {
        const configuredScene = configuration;
        for (const listener of sceneListeners) notifyDrawingListener(listener, 'configure');
        if (destroyed || configuration !== configuredScene) return;
      }
      if (styleChanged) { sceneGeneration++; prepared = false; publication.retire(); }
      const configuredScene = configuration;
      entities.configure(next.elevation !== undefined);
      if (destroyed || configuration !== configuredScene) return;
      if (styleChanged) map.setStyle(structuredClone(configuration.basemap), { diff: false });
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
      interactionRevision++; destroyed = true; prepared = false; emit('destroy', undefined);
      publication.destroy();
      if (!readySettled) { readySettled = true; rejectReady(new RidgelineError('DESTROYED', 'Viewport was destroyed before initialization completed.', { operation: 'initialize', recoverable: false })); }
      clearTimeout(timer); resize.disconnect();
      entities.destroy(); models.destroy(); modelLabels.destroy();
      arrowheads.remove(); preparedListeners.clear(); sceneListeners.clear(); drawingInternals.delete(map);
      map.getCanvas().removeEventListener('mouseleave', onLeave);
      map.remove(); icons.clear(); selected.clear(); publishedMarkerKeys.clear(); availableMarkers.clear(); store.remove(store.ids());
      for (const set of Object.values(listeners)) set.clear();
      hoverNotified.clear();
    },
  };
  drawingInternals.set(map, {
    reportTargetError(cause) {
      diagnostic(new RidgelineError('ELEVATION_UNAVAILABLE', 'Ground targeting requires MapLibre 6.11.0 terrain capabilities.',
        { operation: 'drawing-target', recoverable: true }, cause));
    },
    setEditing(id) {
      if (destroyed || editingId === id) return;
      const previous = editingId;
      editingId = id;
      if (previous) synchronizeState(previous);
      if (id) synchronizeState(id);
      if (publishedArrows.has(previous ?? '') || publishedArrows.has(id ?? '')) syncArrows();
    },
    onPrepared(listener) {
      if (destroyed) return () => {};
      preparedListeners.add(listener);
      if (prepared) notifyDrawingListener(listener, 'style');
      return () => { preparedListeners.delete(listener); };
    },
    onSceneChange(listener) {
      if (destroyed) return () => {};
      sceneListeners.add(listener);
      return () => { sceneListeners.delete(listener); };
    },
  });
  return viewport;
}
