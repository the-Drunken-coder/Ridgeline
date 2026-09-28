import type { LineString, Point, Polygon, Position } from "geojson";
import { Color } from "@maplibre/maplibre-gl-style-spec";
import { wrapLongitude } from "./longitude";
export { wrapLongitude } from "./longitude";
import type {
  DrawingPosition,
  DrawingShape,
  DrawingStyle,
} from "./drawing-types";

const R = 6_371_008.8;
const rad = Math.PI / 180;
export function position(p: Position): DrawingPosition {
  return [wrapLongitude(p[0]!), p[1]!];
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
/** Size a centered shape identically for cursor previews and committed placement. */
export function sizeFromPoint(
  shape: Extract<DrawingShape, { kind: "circle" | "rectangle" }>,
  point: DrawingPosition,
) {
  const d = distance(shape.center, point);
  if (shape.kind === "circle") return { ...shape, radius: d };
  const angle = ((bearing(shape.center, point) - shape.bearing) * Math.PI) / 180;
  return {
    ...shape,
    width: 2 * Math.abs(d * Math.sin(angle)),
    height: 2 * Math.abs(d * Math.cos(angle)),
  };
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
export function shapeVertices(shape: DrawingShape): DrawingPosition[] {
  if ("vertices" in shape) return structuredClone(shape.vertices);
  if (shape.kind === "point") return [shape.position];
  if (shape.kind === "circle")
    return Array.from({ length: 96 }, (_, index) =>
      destination(shape.center, shape.radius, (index * 360) / 96),
    );
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) =>
    destination(
      shape.center,
      Math.hypot(shape.width / 2, shape.height / 2),
      shape.bearing + Math.atan2(x! * shape.width, y! * shape.height) / rad,
    ),
  );
}
export function shapeGeometry(
  shape: DrawingShape,
  render = false,
): Point | LineString | Polygon {
  if (shape.kind === "point")
    return { type: "Point", coordinates: [...shape.position] };
  const points = shapeVertices(shape);
  const ring =
    shape.kind === "polygon" ||
    shape.kind === "circle" ||
    shape.kind === "rectangle";
  if (ring && points.length) points.push([...points[0]!]);
  const coordinates = render ? unroll(points) : points;
  return ring
    ? { type: "Polygon", coordinates: [coordinates] }
    : { type: "LineString", coordinates };
}
function signedArea(points: readonly DrawingPosition[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    sum +=
      (b[0] - a[0]) * rad * (2 + Math.sin(a[1] * rad) + Math.sin(b[1] * rad));
  }
  return (sum * R * R) / 2;
}
export function measurements(shape: DrawingShape) {
  const points = shapeVertices(shape),
    closed = ["polygon", "circle", "rectangle"].includes(shape.kind);
  const length =
    points.reduce(
      (sum, p, i) => sum + (i ? distance(points[i - 1]!, p) : 0),
      0,
    ) + (closed && points.length ? distance(points.at(-1)!, points[0]!) : 0);
  return {
    length,
    ...(closed
      ? {
          area:
            shape.kind === "circle"
              ? 4 * Math.PI * R * R * Math.sin(shape.radius / (2 * R)) ** 2
              : Math.abs(signedArea(unroll(points))),
        }
      : {}),
  };
}
function intersects(
  a: DrawingPosition,
  b: DrawingPosition,
  c: DrawingPosition,
  d: DrawingPosition,
) {
  const cross = (p: DrawingPosition, q: DrawingPosition, r: DrawingPosition) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const within = (p: DrawingPosition, q: DrawingPosition, r: DrawingPosition) =>
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    (abC === 0 && within(a, b, c)) ||
    (abD === 0 && within(a, b, d)) ||
    (cdA === 0 && within(c, d, a)) ||
    (cdB === 0 && within(c, d, b))
  );
}
export function validateShape(shape: DrawingShape): string | undefined {
  if (
    !shape ||
    !["point", "line", "polygon", "circle", "rectangle", "arrow"].includes(
      shape.kind,
    )
  )
    return "Unknown drawing shape.";
  if (
    shape.kind === "circle" &&
    (!Number.isFinite(shape.radius) ||
      shape.radius <= 0 ||
      shape.radius >= (Math.PI * R) / 2)
  )
    return "Radius must be positive and smaller than a hemisphere.";
  if (
    shape.kind === "rectangle" &&
    (![shape.width, shape.height, shape.bearing].every(Number.isFinite) ||
      shape.width <= 0 ||
      shape.height <= 0 ||
      Math.hypot(shape.width, shape.height) >= Math.PI * R)
  )
    return "Enter positive rectangle dimensions smaller than a hemisphere.";
  const definingPoints =
    "center" in shape
      ? [shape.center]
      : "position" in shape
        ? [shape.position]
        : shape.vertices;
  if (
    definingPoints.some(
      (p) =>
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) >= 90,
    )
  )
    return "Use finite ground coordinates away from the poles.";
  const raw = shapeVertices(shape);
  if (raw.some((p) => Math.abs(p[1]) >= 90))
    return "Use finite ground coordinates away from the poles.";
  const closed = ["polygon", "rectangle", "circle"].includes(shape.kind);
  if (raw.length < (closed ? 3 : shape.kind === "point" ? 1 : 2))
    return closed
      ? "Add at least three vertices."
      : "Add at least two vertices.";
  const points = unroll(raw);
  if (
    closed &&
    Math.abs(
      points.at(-1)![0] +
        wrapLongitude(points[0]![0] - points.at(-1)![0]) -
        points[0]![0],
    ) > 1
  )
    return "Shapes enclosing a pole are not supported.";
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++)
    if (distance(points[i]!, points[(i + 1) % points.length]!) < 0.001)
      return "Adjacent vertices must be distinct.";
  if (closed) {
    if (Math.abs(signedArea(points)) >= 2 * Math.PI * R * R)
      return "Shapes covering more than half the Earth are not supported.";
    // Only overlapping edge bounds can intersect. Sweep in longitude order.
    const segments = points
      .map((a, index) => {
        const b = points[(index + 1) % edges]!;
        return {
          a, b, index,
          minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
          minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]),
        };
      })
      .sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < segments.length; i++)
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i]!, b = segments[j]!;
        if (b.minX > a.maxX) break;
        const gap = Math.abs(a.index - b.index);
        if (gap === 1 || gap === edges - 1 || b.minY > a.maxY || b.maxY < a.minY)
          continue;
        if (intersects(a.a, a.b, b.a, b.b))
          return "Edges cross. Adjust a vertex before finishing.";
      }
    if (Math.abs(signedArea(points)) < 0.01)
      return "The polygon needs a nonzero area.";
  }
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
export function translateShape(
  shape: DrawingShape,
  from: DrawingPosition,
  to: DrawingPosition,
): DrawingShape {
  const meters = distance(from, to),
    degrees = bearing(from, to);
  const shift = (p: DrawingPosition) => destination(p, meters, degrees);
  if ("vertices" in shape)
    return { ...shape, vertices: shape.vertices.map(shift) };
  if (shape.kind === "point")
    return { ...shape, position: shift(shape.position) };
  return { ...shape, center: shift(shape.center) };
}
