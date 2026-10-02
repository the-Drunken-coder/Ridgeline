import type { Position } from "geojson";
import { Color } from "@maplibre/maplibre-gl-style-spec";
import { wrapLongitude } from "./longitude";
export { wrapLongitude } from "./longitude";
import type {
  DrawingPosition,
  DrawingStyle,
} from "./drawing-types";

const R = 6_371_008.8;
const rad = Math.PI / 180;
export function position(p: Position): DrawingPosition {
  const longitude = p[0]!;
  return [Math.abs(longitude) <= 180 ? longitude : wrapLongitude(longitude), p[1]!];
}
export function distance(a: DrawingPosition, b: DrawingPosition) {
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function bearing(a: DrawingPosition, b: DrawingPosition) {
  const delta = (b[0] - a[0]) * rad;
  return (
    Math.atan2(
      Math.sin(delta) * Math.cos(b[1] * rad),
      Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
        Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(delta),
    ) / rad
  );
}
export function destination(
  origin: DrawingPosition,
  meters: number,
  degrees: number,
): DrawingPosition {
  const d = meters / R,
    angle = degrees * rad,
    lat = origin[1] * rad;
  const nextLat = Math.asin(
    Math.max(
      -1,
      Math.min(
        1,
        Math.sin(lat) * Math.cos(d) +
          Math.cos(lat) * Math.sin(d) * Math.cos(angle),
      ),
    ),
  );
  return [
    wrapLongitude(
      origin[0] +
        Math.atan2(
          Math.sin(angle) * Math.sin(d) * Math.cos(lat),
          Math.cos(d) - Math.sin(lat) * Math.sin(nextLat),
        ) /
          rad,
    ),
    nextLat / rad,
  ];
}
/** Unroll neighboring longitudes for rendering and planar intersection checks at the date line. */
export function unroll(
  vertices: readonly DrawingPosition[],
): DrawingPosition[] {
  const result: DrawingPosition[] = [];
  for (const p of vertices) {
    const previous = result.at(-1)?.[0] ?? p[0];
    result.push([previous + wrapLongitude(p[0] - previous), p[1]]);
  }
  return result;
}
export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  color: "#b15624",
  fillColor: "#b15624",
  lineWidth: 3,
  fillOpacity: 0.18,
  dashed: false,
  label: "",
};
export function validateDrawingStyle(style: DrawingStyle): string | undefined {
  if (!style || !Color.parse(style.color) || !Color.parse(style.fillColor))
    return "Choose valid stroke and fill colors.";
  if (
    !Number.isFinite(style.lineWidth) ||
    style.lineWidth <= 0 ||
    !Number.isFinite(style.fillOpacity) ||
    style.fillOpacity < 0 ||
    style.fillOpacity > 1 ||
    typeof style.dashed !== "boolean" ||
    typeof style.label !== "string"
  )
    return "Invalid drawing appearance.";
}
