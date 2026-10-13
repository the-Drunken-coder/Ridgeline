import { ModelMeasurement } from './model-measurement';
import { ModelLabels } from './model-labels';
import { dashExpression, featureStyle, fontExpression, highlightExpression, resolveHighlight, styleProperties } from './feature-style';
import { rectangleBounds, screenRectangle } from './screen-rectangle';
import { ModelVisibility } from './model-visibility';
import { shapeGeometry } from './drawing-shapes';
import { createArrowheads } from './arrowheads';
import { Map as GLMap, GPUInitializationError } from 'maplibre-gl';
import type { ExpressionSpecification, LayerSpecification, MapMouseEvent, ErrorEvent as GLErrorEvent } from 'maplibre-gl';
import { createReporter, RidgelineError } from './errors';
import { FeatureStore } from './features';
import { createFeaturePublication } from './feature-publication';
import { FEATURE_SOURCE as SOURCE, mapLibreFeaturePublication, sourceFeatureId } from './maplibre-feature-publication';
import { hillshadePaint, resolveHillshade } from './hillshade';
import { ModelRegistry } from './models';
import type { ModelGpu } from './model-renderer';
import { DEFAULT_ENTITY_MODELS, modelSettings } from './model-settings';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from './entities';
import type { FeatureQuery, FeatureStyle, IconDefinition, Interaction, MapConfiguration, MapFeature, Properties, ScreenBounds, Viewport, ViewportEvents, ViewportOptions } from './types';

const TERRAIN = 'rl:terrain';
const SHADE = 'rl:hillshade';
const layerIds = ['rl:fill', 'rl:line', 'rl:dashed', 'rl:arrowheads', 'rl:points', 'rl:icons', 'rl:map-icons', 'rl:labels'];

type ViewportDrawingInternals = {
  getDisplayedFeature(id: string): MapFeature | undefined;
  dispatchClick(point: { x: number; y: number }, originalEvent: MouseEvent): void;
  setEditing(id: string | null): void;
  onPrepared(listener: () => void): () => void;
  onSceneChange(listener: () => void): () => void;
  reportTargetError(cause?: unknown): void;
};
const drawingInternals = new WeakMap<object, ViewportDrawingInternals>();

/** Map attachments share this seam without expanding the consumer Viewport API. */
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
  const publishedFeatures = new Map<string, MapFeature<P>>();
  const preparedStyles = new WeakMap<MapFeature<P>, FeatureStyle>();
  const publishedStyles = new Map<string, FeatureStyle>();
  const pendingStyles = new Map<string, FeatureStyle>();
  let styleArraysQueued = false;
  let dashSignature = '';
  let fontSignature = '';
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
  let restoreBasemap = false;
  let pendingElevationReset = false;
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
    datachange: new Set(), entitychange: new Set(), camerachange: new Set(), configurationchange: new Set(), diagnostic: new Set(), destroy: new Set(),
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
  // MapLibre keeps using its style and tiles after a custom layer callback.
  // Retire those resources at the end of that native call, while logical
  // disposal and removal of this viewport's DOM remain synchronous.
  let nativeRenderDepth = 0, removeAfterRender = false;
  const nativeRender = map._render, cleanupContainer = map._cleanupContainer;
  map._render = function (time) {
    nativeRenderDepth++;
    try { return nativeRender.call(this, time); }
    finally {
      nativeRenderDepth--;
      if (!nativeRenderDepth && removeAfterRender) { removeAfterRender = false; removeMap(); }
    }
  };
  function removeMap() {
    arrowheads.remove();
    try { map.remove(); }
    finally { map._render = nativeRender; map._cleanupContainer = cleanupContainer; }
  }
  const modelVisibility = new ModelVisibility(map);
  const modelLabels = new ModelLabels(map, ids => publication.update(ids.flatMap(id => { const feature = store.get(id); return feature ? [feature] : []; })));
  const preparedMarkerKeys = new WeakMap<MapFeature<P>, string>();
  const publishedMarkerKeys = new Map<string, string>();
  let nativeSource: unknown;
  let availableMarkers = new Map<string, string>();
  let frameMarkers: Map<string, string> | undefined;
  const measurement = new ModelMeasurement(map.getCanvas());
  const models = new ModelRegistry<ModelGpu>({ measurement, diagnostic, changed: id => entities.modelsChanged(id) });
  const entities = new EntityScene<P>({ measurement, models, map, configuration: () => configuration, style: getStyle, sampler: options.elevationSampler, diagnostic,
    contextLost: () => {
      contextLost = true; prepared = false; sceneGeneration++; interactionRevision++;
      publication.retire(); modelVisibility.invalidate(); modelLabels.invalidate();
      for (const listener of sceneListeners) {
        if (destroyed) break;
        notifyDrawingListener(listener, 'contextLost');
      }
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
      if (feature) publishedFeatures.set(id, feature); else publishedFeatures.delete(id);
      const style = feature && preparedStyles.get(feature);
      if (style) publishedStyles.set(id, style); else publishedStyles.delete(id);
      pendingStyles.delete(id); refreshStyleArrays();
      const marker = feature && preparedMarkerKeys.get(feature);
      if (marker) publishedMarkerKeys.set(id, marker); else publishedMarkerKeys.delete(id);
      const wasArrow = publishedArrows.has(id);
      if (feature?.drawing?.shape.kind === 'arrow') publishedArrows.set(id, feature);
      else publishedArrows.delete(id);
      if (wasArrow || publishedArrows.has(id)) syncArrows();
      synchronizeState(id);
    },
    restored: features => {
      publishedFeatures.clear();
      for (const feature of features) publishedFeatures.set(feature.id, feature);
      publishedStyles.clear(); pendingStyles.clear();
      for (const feature of features) { const style = preparedStyles.get(feature); if (style) publishedStyles.set(feature.id, style); }
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
  function getStyle(feature: MapFeature<P>): FeatureStyle {
    const callbackStyle = options.style ? featureStyle(options.style(structuredClone(feature))) : {};
    const style = { ...callbackStyle, ...feature.drawing?.style };
    // Saved drawings own their dash choice, including an explicit solid line.
    if (feature.drawing) delete style.dashArray;
    return featureStyle(style);
  }
  function labelPriority() {
    return ['case', ['in', ['get', '_rl_feature_id'], ['literal', [...selected]]], 0, 1] satisfies ExpressionSpecification;
  }
  function refreshLabelPriority() {
    if (prepared && !destroyed && map.getLayer('rl:labels')) map.setLayoutProperty('rl:labels', 'symbol-sort-key', labelPriority());
  }
  function refreshStyleArrays() {
    if (styleArraysQueued || destroyed) return;
    styleArraysQueued = true;
    queueMicrotask(() => {
      styleArraysQueued = false;
      if (destroyed || !prepared) return;
      const styles = [...publishedStyles.values(), ...pendingStyles.values()];
      const expression = dashExpression(styles), signature = JSON.stringify(expression);
      if (map.getLayer('rl:dashed') && signature !== dashSignature) { map.setPaintProperty('rl:dashed', 'line-dasharray', expression); dashSignature = signature; }
      const fonts = fontExpression(styles), fontKey = JSON.stringify(fonts);
      if (!destroyed && prepared && map.getLayer('rl:labels') && fontKey !== fontSignature) { map.setLayoutProperty('rl:labels', 'text-font', fonts); fontSignature = fontKey; }
    });
  }
  function markerKey(feature: MapFeature<P>, style: FeatureStyle) {
    const marker = entities.marker(feature);
    return JSON.stringify([marker.position ?? feature.geometry.coordinates, marker.visible, marker.ground, marker.offset,
      style.icon && icons.has(style.icon) ? style.icon : '', style.color ?? '#216e5b', style.radius ?? 6,
      style.iconSize ?? 1, style.iconRotation ?? 0, style.iconRotationAlignment ?? 'viewport', style.iconAnchor ?? 'center']);
  }
  function rendered(feature: MapFeature<P>): MapFeature {
    const revision = interactionRevision, generation = sceneGeneration;
    const style = getStyle(feature);
    if (destroyed || revision !== interactionRevision || generation !== sceneGeneration) throw new Error('Feature presentation was superseded during styling.');
    preparedStyles.set(feature, style); pendingStyles.set(feature.id, style); refreshStyleArrays();
    const marker = entities.marker(feature), key = feature.entity ? markerKey(feature, style) : undefined;
    if (key) preparedMarkerKeys.set(feature, key);
    return {
      type: 'Feature', id: feature.id,
      geometry: feature.drawing ? shapeGeometry(feature.drawing.shape, true)
        : marker.position ? { type: 'Point', coordinates: marker.position } : feature.geometry,
      properties: {
        ...modelLabels.properties(feature.id, style.labelStyle),
        ...styleProperties(style),
        _rl_id: sourceFeatureId(feature.id), _rl_feature_id: feature.id, ...(key ? { _rl_marker: key } : {}),
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
    arrowheads.show([...publishedArrows.values()].filter(feature => feature.id !== editingId), feature => {
      const style = publishedStyles.get(feature.id);
      const highlight = resolveHighlight(style, selected.has(feature.id), previewId === feature.id);
      return highlight.appearance.color ?? (highlight.hovered ? '#db6a20' : undefined) ?? style?.color ?? feature.drawing?.style.color ?? '#216e5b';
    });
  }

  function notifyDrawingListener(listener: () => void, operation: 'style' | 'configure' | 'contextLost') {
    try { listener(); } catch (cause) {
      diagnostic(new RidgelineError('CALLBACK_FAILED', 'A drawing listener threw.', { operation, recoverable: true }, cause));
    }
  }

  function prepareStyle() {
    if (destroyed || contextLost) return;
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
        { id: 'rl:fill', type: 'fill', source: SOURCE, filter: ['==', '$type', 'Polygon'], paint: {
          'fill-color': highlightExpression('fillColor', ['get', '_rl_fill']),
          'fill-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, highlightExpression('fillOpacity', ['get', '_rl_opacity'], .45)] } },
        { id: 'rl:line', type: 'line', source: SOURCE, filter: ['all', ['in', '$type', 'LineString', 'Polygon'], ['!=', '_rl_dashed', true]], paint: {
          'line-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1],
          'line-color': highlightExpression('color', ['get', '_rl_color'], undefined, '#db6a20'),
          'line-width': highlightExpression('lineWidth', ['get', '_rl_width'], ['max', 5, ['get', '_rl_width']]) } },
        { id: 'rl:dashed', type: 'line', source: SOURCE, filter: ['all', ['in', '$type', 'LineString', 'Polygon'], ['==', '_rl_dashed', true]], paint: {
          'line-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, 1],
          'line-color': highlightExpression('color', ['get', '_rl_color'], undefined, '#db6a20'),
          'line-width': highlightExpression('lineWidth', ['get', '_rl_width'], ['max', 5, ['get', '_rl_width']]),
          'line-dasharray': dashExpression([...publishedStyles.values(), ...pendingStyles.values()]) } },
        { id: 'rl:points', type: 'circle', source: SOURCE, filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_airborne', true], ['!=', '_rl_hidden', true]], paint: {
          'circle-opacity': ['case', ['any', ['boolean', ['feature-state', 'editing'], false], ['boolean', ['feature-state', 'model'], false]], 0, 1],
          'circle-stroke-opacity': ['case', ['any', ['boolean', ['feature-state', 'editing'], false], ['boolean', ['feature-state', 'model'], false]], 0, 1],
          'circle-radius': highlightExpression('radius', ['get', '_rl_radius'], undefined, ['max', 12, ['get', '_rl_radius']]),
          'circle-color': highlightExpression('color', ['get', '_rl_color']),
          'circle-stroke-width': ['case', ['all', ['boolean', ['feature-state', 'selected'], false], ['!=', ['get', '_rl_selected_enabled'], false]], 4, 2],
          'circle-stroke-color': ['case', ['all', ['boolean', ['feature-state', 'selected'], false], ['==', ['get', '_rl_selected_enabled'], false]], '#ffffff',
            ['all', ['boolean', ['feature-state', 'hover'], false], ['!=', ['get', '_rl_hover_enabled'], false]], '#db6a20', '#ffffff'] } },
        ...(['viewport', 'map'] as const).map((alignment): LayerSpecification => ({ id: alignment === 'map' ? 'rl:map-icons' : 'rl:icons', type: 'symbol', source: SOURCE,
          filter: ['all', ['==', '$type', 'Point'], ['!=', '_rl_icon', ''], ['!=', '_rl_hidden', true], ['==', '_rl_icon_alignment', alignment]], layout: {
          'icon-image': ['get', '_rl_icon'], 'icon-size': ['get', '_rl_icon_size'], 'icon-rotate': ['get', '_rl_icon_rotation'],
          'icon-anchor': ['get', '_rl_icon_anchor'], 'icon-rotation-alignment': alignment,
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-height-offset': ['get', '_rl_height'] }, paint: {
          'icon-opacity': ['case', ['any', ['boolean', ['feature-state', 'editing'], false], ['boolean', ['feature-state', 'model'], false]], 0, highlightExpression('iconOpacity', 1)] } })),
        { id: 'rl:labels', type: 'symbol', source: SOURCE, filter: ['!=', '_rl_hidden', true], layout: {
          'symbol-sort-key': labelPriority(), 'text-field': ['get', '_rl_label'], 'text-font': fontExpression([...publishedStyles.values(), ...pendingStyles.values()]), 'text-size': ['get', '_rl_label_size'],
          'text-offset': ['get', '_rl_label_offset'], 'text-anchor': ['get', '_rl_label_anchor'], 'symbol-height-offset': ['get', '_rl_height'] }, paint: {
          'text-opacity': ['case', ['boolean', ['feature-state', 'editing'], false], 0, ['==', ['coalesce', ['get', '_rl_label_stamp'], ''], ['coalesce', ['feature-state', 'labelStamp'], '']], 1, 0],
          'text-color': highlightExpression('labelColor', ['get', '_rl_label_color']), 'text-halo-color': ['get', '_rl_label_halo_color'], 'text-halo-width': ['get', '_rl_label_halo_width'] } },
      ];
      for (const layer of layers) { if (!current()) return; if (!map.getLayer(layer.id)) map.addLayer(layer); }
      dashSignature = ''; fontSignature = ''; refreshStyleArrays();
      syncArrows();
      if (!current()) return;
      applyElevation();
      if (!current()) return;
      entities.attach();
      // Fallbacks draw after models, so a detected model draw failure can expose them in this frame.
      for (const id of ['rl:points', 'rl:icons', 'rl:map-icons', 'rl:labels']) map.moveLayer(id);
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
  function interaction(event: Pick<Interaction<P>, 'point' | 'lngLat' | 'originalEvent'>, tolerance: number): Interaction<P> {
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
        if ((hit.layer.id === 'rl:points' || hit.layer.id === 'rl:icons' || hit.layer.id === 'rl:map-icons') && (representation === 'model' || representation === 'withheld')) continue;
        const feature = store.get(id);
        if (feature) { seen.add(id); features.push(feature); }
      } };
      const overlay = (id: string) => id === 'rl:labels' || id === 'rl:icons' || id === 'rl:map-icons' || id === 'rl:points';
      addNativeHits(hits.filter(hit => overlay(hit.layer.id)));
      addEntityHits(entities.pickAbove(x, y, tolerance));
      addNativeHits(hits.filter(hit => !overlay(hit.layer.id)));
      addEntityHits(entities.pickGround(x, y, tolerance));
    }
    return { features, attachments, point: { x: event.point.x, y: event.point.y }, lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat }, originalEvent: event.originalEvent };
  }
  function queryFeatures(bounds: ScreenBounds): FeatureQuery<P> {
    assertActive();
    let rectangle: ReturnType<typeof screenRectangle>;
    try { rectangle = screenRectangle(bounds); }
    catch (cause) {
      const error = new RidgelineError('INVALID_CONFIGURATION', 'Screen bounds need two finite CSS-pixel points.', { operation: 'queryFeatures', recoverable: true }, cause);
      diagnostic(error); throw error;
    }
    if (!prepared || contextLost) return { features: [], attachments: [] };
    const revision = interactionRevision;
    const ids = new Set<string>(), attachmentIds = new Map<string, Set<string>>();
    for (const hit of map.queryRenderedFeatures(rectangleBounds(rectangle), { layers: layerIds.filter(id => map.getLayer(id)) })) {
      const id = hit.properties?._rl_feature_id;
      if (typeof id !== 'string' || id === editingId || hit.properties?._rl_hidden === true) continue;
      if (hit.layer.id === 'rl:labels' && !modelLabels.acceptsHit(id, hit.properties?._rl_label_stamp)) continue;
      const representation = entities.getState(id)?.representation;
      if ((hit.layer.id === 'rl:points' || hit.layer.id === 'rl:icons' || hit.layer.id === 'rl:map-icons') && (representation === 'model' || representation === 'withheld')) continue;
      const style = publishedStyles.get(id);
      const highlight = resolveHighlight(style, selected.has(id), previewId === id);
      const iconOpacity = highlight.appearance.iconOpacity ?? 1;
      const fillOpacity = highlight.appearance.fillOpacity ?? (highlight.selected ? .45 : style?.fillOpacity ?? .2);
      if ((hit.layer.id === 'rl:icons' || hit.layer.id === 'rl:map-icons') && iconOpacity === 0 || hit.layer.id === 'rl:fill' && fillOpacity === 0) continue;
      ids.add(id);
    }
    for (const hit of entities.query(rectangle)) {
      ids.add(hit.entityId);
      if ('attachmentId' in hit && typeof hit.attachmentId === 'string') {
        let values = attachmentIds.get(hit.entityId);
        if (!values) { values = new Set(); attachmentIds.set(hit.entityId, values); }
        values.add(hit.attachmentId);
      }
    }
    if (destroyed || revision !== interactionRevision) return { features: [], attachments: [] };
    // Store order and attachment declaration order are stable across native tiles and world copies.
    const features = store.all().filter(feature => ids.has(feature.id));
    const attachments = features.flatMap(feature => (feature.entity?.attachments ?? [])
      .filter(attachment => attachmentIds.get(feature.id)?.has(attachment.id))
      .map(attachment => ({ entityId: feature.id, attachmentId: attachment.id })));
    return { features, attachments };
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
  map.on('movestart', () => { interactionRevision++; });
  map.on('resize', () => { interactionRevision++; });
  map.on('error', onError);
  map.on('webglcontextlost', () => entities.contextLost());
  map.on('webglcontextrestored', () => {
    if (destroyed) return;
    contextLost = false;
    // MapLibre first restores its pre-loss style. Apply any newer accepted basemap
    // only after its painter exists; prepareStyle then rebuilds our owned layers.
    if (restoreBasemap) { restoreBasemap = false; map.setStyle(structuredClone(configuration.basemap), { diff: false }); }
  });
  const interactionCurrent = (revision: number) => () => !destroyed && !interactionOwner && interactionRevision === revision;
  function dispatchClick(point: { x: number; y: number }, originalEvent: MouseEvent) {
    if (destroyed || interactionOwner) return;
    const revision = interactionRevision, lngLat = map.unproject([point.x, point.y]);
    emit('click', interaction({ point, lngLat, originalEvent }, 12), interactionCurrent(revision));
  }
  map.on('click', event => dispatchClick(event.point, event.originalEvent));
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
        measurement.accepted(changed.length);
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
      if (removed.length) refreshLabelPriority();
      emit('datachange', { ids: [], removed });
      if (removed.includes(hovered)) refreshHover();
    },
    clear() { viewport.remove(store.ids()); },
    retryUpdates() {
      assertActive();
      entities.retry();
      publication.retry();
    },
    refreshStyles(ids = store.ids()) {
      assertActive(); interactionRevision++;
      const features = [...new Set(ids)].flatMap(id => { const feature = store.get(id); return feature ? [feature] : []; });
      entities.set(features);
      if (destroyed) return;
      // Style callbacks may replace data while entity preparation is running.
      // Native publication must use the latest accepted inputs for each ID.
      publication.update(features.flatMap(feature => { const current = store.get(feature.id); return current ? [current] : []; }));
    },
    getFeature: id => store.get(id), getFeatures: () => store.all(), queryFeatures, getEntityState: id => entities.getState(id), getName, getStyle,
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
      if (previous.size !== selected.size || [...previous].some(id => !selected.has(id))) refreshLabelPriority();
      for (const id of new Set([...previous, ...selected])) synchronizeState(id);
      if ([...previous, ...selected].some(id => publishedArrows.has(id))) syncArrows();
      emit('selectionchange', { ids: [...selected] });
    },
    getSelection: () => [...selected],
    preview(id) {
      if (destroyed) return;
      const previous = previewId; previewId = id && store.has(id) ? id : null;
      entities.preview(previewId);
      if (previous) synchronizeState(previous); if (previewId) synchronizeState(previewId);
      if (publishedArrows.has(previous ?? '') || publishedArrows.has(previewId ?? '')) syncArrows();
    },
    requestSelection(ids, attachments = []) {
      assertActive(); if (interactionOwner) return;
      const selectedIds = [...new Set(ids)].filter(id => store.has(id));
      emit('selectionrequest', { ids: selectedIds, attachments: attachments.filter(hit => selectedIds.includes(hit.entityId) && store.get(hit.entityId)?.entity?.attachments?.some(a => a.id === hit.attachmentId)).map(hit => ({ ...hit })) }, interactionCurrent(interactionRevision));
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
      const styleChanged = next.basemap !== undefined && JSON.stringify(next.basemap) !== JSON.stringify(configuration.basemap);
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
      const configuredScene = configuration;
      if (next.elevation !== undefined) pendingElevationReset = true;
      const sceneChanged = styleChanged || next.projection !== undefined || next.terrain !== undefined ||
        next.exaggeration !== undefined || next.elevation !== undefined;
      if (sceneChanged) interactionRevision++;
      if (styleChanged) { sceneGeneration++; prepared = false; publication.retire(); }
      try {
        if (styleChanged) {
          if (contextLost) restoreBasemap = true;
          else map.setStyle(structuredClone(configuration.basemap), { diff: false });
        }
        else if (prepared) {
          map.setProjection({ type: configuration.projection === 'flat' ? 'mercator' : 'globe' });
          applyElevation(next.elevation !== undefined);
        }
      } finally {
        // Drawing callbacks can configure the viewport too. Start native work
        // before notifying them so an unrelated patch cannot skip this style.
        if (sceneChanged) for (const listener of sceneListeners) {
          // These listeners retire screen-derived work without applying an old
          // configuration. A nested patch must not skip that retirement.
          if (destroyed) break;
          notifyDrawingListener(listener, 'configure');
        }
        if (!destroyed && (configuration === configuredScene || pendingElevationReset)) {
          // Native style observers and preparation abort listeners can reenter.
          // Consume the required reset before callbacks, using current settings.
          const resetElevation = pendingElevationReset; pendingElevationReset = false;
          entities.configure(resetElevation);
        }
        if (!destroyed && configuration === configuredScene)
          emit('configurationchange', structuredClone(configuration), () => !destroyed && configuration === configuredScene);
      }
    },
    getConfiguration: () => structuredClone(configuration),
    setCamera(camera, animation) { assertActive(); if (animation?.duration) map.easeTo({ ...camera, duration: animation.duration }); else map.jumpTo(camera); },
    fitBounds(bounds, animation) { assertActive(); map.fitBounds(bounds, { duration: animation?.duration ?? 0, padding: animation?.padding ?? 48 }); },
    on(event, listener) { assertActive(); listeners[event].add(listener); return () => listeners[event].delete(listener); },
    destroy() {
      if (destroyed) return;
      interactionRevision++; destroyed = true; prepared = false;
      // Destroy listeners may synchronously mount a new viewport in this same
      // container. Retire only our DOM before giving them that ownership.
      cleanupContainer.call(map);
      map._cleanupContainer = () => {};
      emit('destroy', undefined);
      publication.destroy();
      if (!readySettled) { readySettled = true; rejectReady(new RidgelineError('DESTROYED', 'Viewport was destroyed before initialization completed.', { operation: 'initialize', recoverable: false })); }
      clearTimeout(timer); resize.disconnect();
      entities.destroy(); models.destroy(); modelLabels.destroy(); measurement.destroy();
      preparedListeners.clear(); sceneListeners.clear(); drawingInternals.delete(map);
      map.getCanvas().removeEventListener('mouseleave', onLeave);
      if (nativeRenderDepth) removeAfterRender = true;
      else removeMap();
      icons.clear(); selected.clear(); publishedFeatures.clear(); publishedStyles.clear(); pendingStyles.clear(); publishedMarkerKeys.clear(); availableMarkers.clear(); store.remove(store.ids());
      for (const set of Object.values(listeners)) set.clear();
      hoverNotified.clear();
    },
  };
  drawingInternals.set(map, {
    getDisplayedFeature: id => publishedFeatures.get(id),
    dispatchClick,
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
