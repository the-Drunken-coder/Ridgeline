import type { MapFeature, Properties } from "./types";

export type DrawingPosition = [longitude: number, latitude: number];
export type DrawingTool = "line" | "polygon" | "rectangle" | "circle" | "arrow";
export type DrawingShape =
  | { kind: "point"; position: DrawingPosition }
  | { kind: "line" | "polygon" | "arrow"; vertices: DrawingPosition[] }
  | { kind: "circle"; center: DrawingPosition; radius: number }
  | {
      kind: "rectangle";
      center: DrawingPosition;
      width: number;
      height: number;
      bearing: number;
    };
export type DrawingStyle = {
  color: string;
  fillColor: string;
  lineWidth: number;
  fillOpacity: number;
  dashed: boolean;
  label: string;
};
/** Preserve this GeoJSON foreign member when saving a drawing. Geometry remains ordinary GeoJSON. */
export type DrawingData = {
  version: 1;
  shape: DrawingShape;
  style: DrawingStyle;
};
export type DrawingChange<P extends Properties = Properties> = {
  kind: "create" | "update" | "delete";
  before?: MapFeature<P>;
  after?: MapFeature<P>;
};
export type DrawingDecision =
  | { accepted: true }
  | { accepted: false; reason: string };
export type DrawingOptions<P extends Properties> = {
  /** Supplies identity and properties before placement. submit receives the completed geometry. */
  createFeature: () => Pick<MapFeature<P>, "id" | "properties">;
  /** Persist atomically against before. Do not also upsert into this viewport; acceptance applies the change. */
  submit: (
    change: DrawingChange<P>,
    signal: AbortSignal,
  ) => DrawingDecision | Promise<DrawingDecision>;
  /** New drawings are checked after their first point is placed, using the current draft geometry. */
  canEdit?: (
    feature: MapFeature<P>,
    operation: DrawingChange<P>["kind"],
  ) => boolean;
  canSnap?: (feature: MapFeature<P>) => boolean;
  tools?: readonly DrawingTool[];
  styleFields?: readonly (keyof DrawingStyle)[];
  defaults?: Partial<DrawingStyle>;
};
export type DrawingDraft<P extends Properties = Properties> = {
  feature: MapFeature<P>;
  before?: MapFeature<P>;
  shape: DrawingShape;
  style: DrawingStyle;
  placing: boolean;
  placed: number;
};
export type DrawingState<P extends Properties = Properties> = {
  phase: "idle" | "editing" | "pending" | "rejected" | "conflict" | "forbidden";
  draft?: DrawingDraft<P>;
  message?: string;
  validation?: string;
  canUndo: boolean;
  canRedo: boolean;
  measurements: { length: number; area?: number };
};
