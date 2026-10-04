import type { DrawingData } from './drawing-types';
import type { Feature, LineString, Point, Polygon } from 'geojson';
import type { CameraOptions, HillshadeLayerSpecification, LngLatBoundsLike, Map as MapLibreMap, RasterDEMSourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { Logger, RidgelineError } from './errors';

export type Properties = Record<string, unknown>;
export type MapFeature<P extends Properties = Properties> = Feature<Point | LineString | Polygon, P> & { id: string; entity?: Entity; drawing?: DrawingData };
export type Altitude = { meters: number; reference: 'ground' | 'sea-level' };
type AttachmentBase = { id: string; name?: string; color?: string };
export type CameraAttachment = AttachmentBase & {
  type: 'camera';
  bearing: number;
  elevation: number;
  fovX: number;
  fovY: number;
  range: number;
  /** Visible fill color uses the attachment color; opacity is between 0 and 1. */
  fillOpacity?: number;
  /** Enable GPU terrain visibility within the camera's finite frustum and range. */
  terrainVisibility?: boolean;
  blockedColor?: string;
  blockedOpacity?: number;
  outline?: boolean;
  outlineWidth?: number;
  /** Shaded sides from the asset to the terrain footprint. */
  volumeOpacity?: number;
  wireframe?: boolean;
  wireframeWidth?: number;
};
export type EntityAttachment = CameraAttachment
  | AttachmentBase & { type: 'sphere'; radius: number }
  | AttachmentBase & { type: 'cylinder'; radius: number; height: number }
  | AttachmentBase & { type: 'circle'; radius: number }
  | AttachmentBase & { type: 'polygon'; /** Open boundary in east/north meters relative to the entity. */ vertices: [number, number][] };
export type ModelAppearance = { mode: 'color'; color: string } | { mode: 'original' };
export type ModelDefinition = { bytes: ArrayBuffer; metersPerUnit?: number; headingOffset?: number; appearance?: ModelAppearance };
export type EntityModelSettings = { switchDistanceMeters: number; deadZoneMeters: number; minimumSizePixels: number };
export type EntityModel = Partial<EntityModelSettings> & { id: string; followSlope?: boolean };
export type EntityModelState = { id: string; status: 'loading' | 'ready' | 'unavailable' | 'failed'; replacementPending: boolean };
export type Entity = { model?: EntityModel; heading?: number; pitch?: number; roll?: number; altitude?: Altitude; groundIfNoAltitude?: boolean; attachments?: EntityAttachment[] };
export type EntityVisibility = { footprints: boolean; zones: boolean; groundLines: boolean };
export type EntityState = {
  representation: 'icon' | 'model' | 'withheld';
  model?: EntityModelState;
  placement: 'airborne' | 'ground' | 'withheld' | 'elevation-unavailable' | 'below-terrain';
  altitude?: number;
  ground?: number;
  coverage: 'ready' | 'loading' | 'unavailable';
  computedAt: number;
  computationMs: number;
  /** Number of triangles represented by the ground overlay. */
  footprintTriangles: number;
};
/** An optional raw, unexaggerated terrain source, useful for offline data and deterministic tests. */
export type ElevationSampler = { sample(lng: number, lat: number): number | null; prepare?(positions: readonly [number, number][], signal: AbortSignal): Promise<void> };
export type FeatureStyle = {
  modelAppearance?: ModelAppearance;
  color?: string;
  radius?: number;
  lineWidth?: number;
  fillOpacity?: number;
  fillColor?: string;
  dashed?: boolean;
  icon?: string;
  label?: string;
};
export type ElevationProvider = Omit<RasterDEMSourceSpecification, 'type'> & { scheme?: 'xyz' | 'tms' };
type HillshadePaint = NonNullable<HillshadeLayerSpecification['paint']>;
export type HillshadeOptions = {
  method?: Extract<HillshadePaint['hillshade-method'], string>;
  direction?: number | number[];
  altitude?: number | number[];
  anchor?: 'map' | 'viewport';
  intensity?: number;
  shadowColor?: string;
  highlightColor?: string;
  accentColor?: string;
};
export type MapConfiguration = {
  basemap: string | StyleSpecification;
  projection: 'flat' | 'globe';
  terrain: boolean;
  hillshade: boolean;
  hillshadeOptions: HillshadeOptions;
  exaggeration: number;
  elevation: ElevationProvider;
  entityVisibility: EntityVisibility;
  entityModels: EntityModelSettings;
};
export type Interaction<P extends Properties> = {
  features: MapFeature<P>[];
  point: { x: number; y: number };
  lngLat: { lng: number; lat: number };
  originalEvent: MouseEvent;
  attachments: { entityId: string; attachmentId: string }[];
};
export type ViewportEvents<P extends Properties> = {
  interactionchange: { owner: string | null };
  selectionchange: { ids: string[] };
  click: Interaction<P>;
  hover: Interaction<P>;
  contextmenu: Interaction<P>;
  selectionrequest: { ids: string[]; attachments: Interaction<P>['attachments'] };
  datachange: { ids: string[]; removed: string[] };
  entitychange: { ids: string[] };
  camerachange: CameraOptions;
  diagnostic: RidgelineError;
  destroy: undefined;
};
export type ViewportOptions<P extends Properties> = Partial<MapConfiguration> & {
  container: HTMLElement;
  camera?: CameraOptions;
  features?: readonly MapFeature<P>[];
  name?: (feature: MapFeature<P>) => string;
  style?: (feature: MapFeature<P>) => FeatureStyle;
  logger?: Logger;
  onError?: (error: RidgelineError) => void;
  initializationTimeoutMs?: number;
  elevationSampler?: ElevationSampler;
};
export type IconDefinition = {
  image: ImageData | HTMLImageElement | ImageBitmap;
  /** The same icon as a data/blob/http URL, for optional DOM interaction UI. */
  url?: string;
  pixelRatio?: number;
};
export interface Viewport<P extends Properties = Properties> {
  readonly ready: Promise<void>;
  readonly container: HTMLElement;
  /** Direct renderer access. The rl: prefix is reserved for Ridgeline resources. */
  readonly map: MapLibreMap;
  /** Exclusively own feature interactions while leaving camera navigation available. */
  acquireInteraction(owner: string): () => void;
  getInteractionOwner(): string | null;
  upsert(features: readonly MapFeature<P>[]): void;
  remove(ids: readonly string[]): void;
  clear(): void;
  /** Retry failed feature updates once, using the latest stored data. */
  retryUpdates(): void;
  getFeature(id: string): MapFeature<P> | undefined;
  getFeatures(): MapFeature<P>[];
  getEntityState(id: string): EntityState | undefined;
  getName(feature: MapFeature<P>): string;
  getStyle(feature: MapFeature<P>): FeatureStyle;
  /** Report a failure in a consumer callback used by an attached UI. */
  reportCallbackError(cause: unknown, operation: string, featureId?: string): void;
  getIcon(id: string): IconDefinition | undefined;
  registerModel(id: string, definition: ModelDefinition): Promise<void>;
  unregisterModel(id: string): void;
  registerIcon(id: string, definition: IconDefinition): void;
  setSelection(ids: readonly string[]): void;
  getSelection(): string[];
  preview(id: string | null): void;
  requestSelection(ids: string[], attachments?: Interaction<P>['attachments']): void;
  configure(configuration: Partial<MapConfiguration>): void;
  getConfiguration(): MapConfiguration;
  setCamera(camera: CameraOptions, options?: { duration?: number }): void;
  fitBounds(bounds: LngLatBoundsLike, options?: { duration?: number; padding?: number }): void;
  on<K extends keyof ViewportEvents<P>>(event: K, listener: (value: ViewportEvents<P>[K]) => void): () => void;
  destroy(): void;
}
