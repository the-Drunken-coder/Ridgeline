import type { Feature, FeatureCollection, Point } from "geojson";
import type { Map as GLMap } from "maplibre-gl";
import type { MapFeature } from "./types";
import { sourceFeatureId } from "./maplibre-feature-publication";
import { wrapLongitude } from "./drawing-geometry";
import type { DrawingPosition } from "./drawing-types";

/** GeoJSON line segments are straight in Mercator, so their heads use the rhumb direction. */
function segmentBearing(a: DrawingPosition, b: DrawingPosition) {
  const radians = Math.PI / 180;
  const north = Math.log(Math.tan(Math.PI / 4 + b[1] * radians / 2)
    / Math.tan(Math.PI / 4 + a[1] * radians / 2));
  return Math.atan2(wrapLongitude(b[0] - a[0]) * radians, north) / radians;
}

export const ARROW_IMAGE = "rl:drawing-arrow";
/** A single shared SDF arrowhead stays legible at every zoom without geography-dependent sizing. */
export function addArrowImage(map: GLMap) {
  if (map.hasImage(ARROW_IMAGE)) return;
  const size = 32,
    data = new Uint8Array(size * size * 4);
  for (let y = 3; y < 27; y++)
    for (let x = 0; x < size; x++) {
      if (
        Math.abs(x - 15.5) <= (y - 3) * 0.5 &&
        (y < 17 || Math.abs(x - 15.5) >= (y - 17) * 0.7)
      ) {
        const at = (y * size + x) * 4;
        data[at] = 255;
        data[at + 1] = 255;
        data[at + 2] = 255;
        data[at + 3] = 255;
      }
    }
  map.addImage(
    ARROW_IMAGE,
    { width: size, height: size, data },
    { sdf: true, pixelRatio: 2 },
  );
}
export function arrowFeatures(
  features: readonly MapFeature[],
): FeatureCollection<Point> {
  const result: Feature<Point>[] = [];
  for (const feature of features) {
    const shape = feature.drawing?.shape;
    if (shape?.kind !== "arrow" || shape.vertices.length < 2) continue;
    const last = shape.vertices.at(-1)!,
      previous = shape.vertices.at(-2)!;
    result.push({
      type: "Feature",
      id: sourceFeatureId(feature.id),
      geometry: { type: "Point", coordinates: last },
      properties: {
        color: feature.drawing!.style.color,
        bearing: segmentBearing(previous, last),
        _rl_id: sourceFeatureId(feature.id),
        _rl_feature_id: feature.id,
      },
    });
  }
  return { type: "FeatureCollection", features: result };
}
