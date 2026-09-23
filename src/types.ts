import type { Feature, LineString, Point, Polygon } from 'geojson';
import type { CameraOptions, HillshadeLayerSpecification, LngLatBoundsLike, Map as MapLibreMap, RasterDEMSourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { Logger, RidgelineError } from './errors';

export type Properties = Record<string, unknown>;
export type MapFeature<P extends Properties = Properties> = Feature<Point | LineString | Polygon, P> & { id: string };
export type FeatureStyle = {
  color?: string;
  radius?: number;
  lineWidth?: number;
  fillOpacity?: number;
  icon?: string;
  label?: string;
};
export type ElevationProvider = Omit<RasterDEMSourceSpecification, 'type'>;
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
};
export type Interaction<P extends Properties> = {
  features: MapFeature<P>[];
  point: { x: number; y: number };
  lngLat: { lng: number; lat: number };
  originalEvent: MouseEvent;
};
export type ViewportEvents<P extends Properties> = {
  click: Interaction<P>;
  hover: Interaction<P>;
  contextmenu: Interaction<P>;
  selectionrequest: { ids: string[] };
  datachange: { ids: string[]; removed: string[] };
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
  upsert(features: readonly MapFeature<P>[]): void;
  remove(ids: readonly string[]): void;
  clear(): void;
  /** Retry failed feature updates once, using the latest stored data. */
  retryUpdates(): void;
  getFeature(id: string): MapFeature<P> | undefined;
  getFeatures(): MapFeature<P>[];
  getName(feature: MapFeature<P>): string;
  getStyle(feature: MapFeature<P>): FeatureStyle;
  getIcon(id: string): IconDefinition | undefined;
  registerIcon(id: string, definition: IconDefinition): void;
  setSelection(ids: readonly string[]): void;
  getSelection(): string[];
  preview(id: string | null): void;
  requestSelection(ids: string[]): void;
  configure(configuration: Partial<MapConfiguration>): void;
  getConfiguration(): MapConfiguration;
  setCamera(camera: CameraOptions, options?: { duration?: number }): void;
  fitBounds(bounds: LngLatBoundsLike, options?: { duration?: number; padding?: number }): void;
  on<K extends keyof ViewportEvents<P>>(event: K, listener: (value: ViewportEvents<P>[K]) => void): () => void;
  destroy(): void;
}
