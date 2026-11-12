import type { Map as GLMap } from 'maplibre-gl';
import type { ElevationSampler, FeatureStyle, LabelStyle, EntityState, MapConfiguration, MapFeature, ModelDefinition, Properties } from './types';
import type { RidgelineError } from './errors';
import type { ScreenRectangle } from './screen-rectangle';

export type EntityInstallHooks<P extends Properties = Properties> = {
  map: GLMap;
  publishCameraStyle(publish: () => void): void;
  configuration(): MapConfiguration;
  getStyle(feature: MapFeature<P>): FeatureStyle;
  sampler?: ElevationSampler;
  diagnostic(error: RidgelineError): void;
  isDestroyed(): boolean;
  beginNativeFrame(): void;
  nativeAvailable(feature: MapFeature<P>, style: FeatureStyle): boolean;
  onContextLost(): void;
  onContextRestored(): void;
  emitEntityChange(ids: string[]): void;
  synchronizeState(id: string): void;
  featuresFor(ids: readonly string[]): MapFeature<P>[];
  updatePublication(features: MapFeature<P>[]): void;
};

export const ENTITIES_REQUIRED =
  'Entities are not attached. Import attachEntities from @ridgeline/map/entities and call it on this viewport first.';

export type EntityMarker = {
  visible: boolean;
  ground: boolean;
  offset: number;
  position?: number[];
};

export type EntityPick = { entityId: string; attachmentId?: string };

export type EntityRuntime<P extends Properties = Properties> = {
  readonly attached: boolean;
  marker(feature: MapFeature<P>): EntityMarker;
  labelProperties(id: string, style?: LabelStyle): { _rl_label_offset: number[]; _rl_label_stamp: string };
  acceptsLabelHit(id: string, stamp: unknown): boolean;
  pickAbove(x: number, y: number, tolerance: number): EntityPick[];
  pickGround(x: number, y: number, tolerance: number): EntityPick[];
  query(rectangle: ScreenRectangle): EntityPick[];
  getState(id: string): EntityState | undefined;
  validateFeature(feature: MapFeature<P>): void;
  accepted(count: number): void;
  set(features: readonly MapFeature<P>[], removed?: readonly string[]): void;
  retry(): void;
  selection(ids: readonly string[]): void;
  preview(id: string | null): void;
  configure(elevationChanged?: boolean): void;
  attach(): void;
  destroy(): void;
  contextLost(): void;
  readinessFailed(error: unknown): void;
  registerModel(id: string, definition: ModelDefinition): Promise<void>;
  unregisterModel(id: string): void;
  invalidatePresentation(): void;
  collectCustomLayers(map: { getLayer(id: string): unknown }): unknown[];
};

export function defaultLabelProperties(style?: LabelStyle) {
  const offset = style?.offset ?? (style?.anchor && style.anchor !== 'top' ? [0, 0] : [0, 1.8]);
  return { _rl_label_offset: [...offset], _rl_label_stamp: '' };
}

export const DEFAULT_ENTITY_MARKER: EntityMarker = { visible: true, ground: true, offset: 0 };

function requireEntities(): never {
  throw new Error(ENTITIES_REQUIRED);
}

export function createDetachedEntityRuntime<P extends Properties = Properties>(): EntityRuntime<P> {
  return {
    attached: false,
    marker: () => DEFAULT_ENTITY_MARKER,
    labelProperties: (_id, style) => defaultLabelProperties(style),
    acceptsLabelHit: (_id, stamp) => (typeof stamp === 'string' ? stamp : '') === '',
    pickAbove: () => [],
    pickGround: () => [],
    query: () => [],
    getState: () => undefined,
    validateFeature(feature) { if (feature.entity) requireEntities(); },
    accepted() {},
    set() {},
    retry() {},
    selection() {},
    preview() {},
    configure() {},
    attach() {},
    destroy() {},
    contextLost() {},
    readinessFailed() {},
    registerModel() { requireEntities(); },
    unregisterModel() { requireEntities(); },
    invalidatePresentation() {},
    collectCustomLayers() { return []; },
  };
}
