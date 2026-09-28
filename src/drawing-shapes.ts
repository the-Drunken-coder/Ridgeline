import type { LineString, Point, Polygon } from "geojson";
import type { DrawingPosition, DrawingShape, DrawingTool } from "./drawing-types";
import { bearing, destination, distance, position, unroll, wrapLongitude } from "./drawing-geometry";

const R = 6_371_008.8;
const rad = Math.PI / 180;

type Kind = DrawingShape["kind"];
type VertexKind = "line" | "polygon" | "arrow";
type VertexShape<K extends VertexKind = VertexKind> = { kind: K; vertices: DrawingPosition[] };
type ShapeFor<K extends Kind> = K extends VertexKind
  ? VertexShape
  : Extract<DrawingShape, { kind: K }>;

export type ShapeHandle = {
  position: DrawingPosition;
  label: string;
  move: (point: DrawingPosition) => DrawingShape;
  carriesShape: boolean;
  removable: boolean;
};

export type ShapeParameter = {
  label: "Radius" | "Width" | "Height" | "Bearing";
  unit: "length" | "angle";
  value: number;
  set: (value: number) => DrawingShape;
};

type Placement = { shape: DrawingShape; placing: boolean };
type ShapeDefinition<S extends DrawingShape> = {
  closed: boolean;
  minimum: number;
  geometry: "Point" | "LineString" | "Polygon";
  empty?: () => S;
  place: (shape: S, placed: number, point: DrawingPosition) => Placement | undefined;
  handles: (shape: S) => ShapeHandle[];
  vertices: (shape: S) => DrawingPosition[];
  definingPoints: (shape: S) => DrawingPosition[];
  translate: (shape: S, shift: (point: DrawingPosition) => DrawingPosition) => S;
  parameters: (shape: S) => ShapeParameter[];
  editableVertices?: (shape: S) => DrawingPosition[];
  insert?: (shape: S, after: number, point: DrawingPosition) => S;
  remove?: (shape: S, index: number) => S;
  reverse?: (shape: S) => S;
  area?: (shape: S, points: DrawingPosition[]) => number;
  validateDimensions?: (shape: S) => string | undefined;
};

function handle(
  position: DrawingPosition,
  label: string,
  move: (point: DrawingPosition) => DrawingShape,
  carriesShape = false,
  removable = false,
): ShapeHandle {
  return { position, label, move, carriesShape, removable };
}

function vertexDefinition(
  kind: VertexKind,
  closed: boolean,
): ShapeDefinition<VertexShape> {
  return {
    closed,
    minimum: closed ? 3 : 2,
    geometry: closed ? "Polygon" : "LineString",
    empty: () => ({ kind, vertices: [] }),
    place: (shape, _placed, point) => {
      const last = shape.vertices.at(-1);
      if (last && distance(last, point) < 0.001) return;
      return { shape: { ...shape, vertices: [...shape.vertices, [...point]] }, placing: true };
    },
    handles: (shape) => shape.vertices.map((position, index) =>
      handle(
        position,
        `Vertex ${index + 1}`,
        (point) => ({
          ...shape,
          vertices: shape.vertices.map((vertex, i) => i === index ? [...point] : vertex),
        }),
        false,
        true,
      )),
    vertices: (shape) => structuredClone(shape.vertices),
    definingPoints: (shape) => shape.vertices,
    translate: (shape, shift) => ({ ...shape, vertices: shape.vertices.map(shift) }),
    parameters: () => [],
    editableVertices: (shape) => shape.vertices,
    insert: (shape, after, point) => {
      const vertices = [...shape.vertices];
      vertices.splice(after + 1, 0, [...point]);
      return { ...shape, vertices };
    },
    remove: (shape, index) => {
      const vertices = [...shape.vertices];
      vertices.splice(index, 1);
      return { ...shape, vertices };
    },
    ...(kind === "arrow" ? { reverse: (shape: VertexShape) => ({ ...shape, vertices: [...shape.vertices].reverse() }) } : {}),
  };
}

type Rectangle = ShapeFor<"rectangle">;
function rectangleOffset(shape: Rectangle, point: DrawingPosition) {
  const meters = distance(shape.center, point);
  const angle = (bearing(shape.center, point) - shape.bearing) * rad;
  return {
    width: 2 * Math.abs(meters * Math.sin(angle)),
    height: 2 * Math.abs(meters * Math.cos(angle)),
  };
}

const definitions: { [K in Kind]: ShapeDefinition<ShapeFor<K>> } = {
  point: {
    closed: false,
    minimum: 1,
    geometry: "Point",
    place: () => undefined,
    handles: (shape) => [handle(shape.position, "Position", (point) => ({ ...shape, position: [...point] }))],
    vertices: (shape) => [shape.position],
    definingPoints: (shape) => [shape.position],
    translate: (shape, shift) => ({ ...shape, position: shift(shape.position) }),
    parameters: () => [],
  },
  line: vertexDefinition("line", false),
  polygon: vertexDefinition("polygon", true),
  arrow: vertexDefinition("arrow", false),
  circle: {
    closed: true,
    minimum: 3,
    geometry: "Polygon",
    empty: () => ({ kind: "circle", center: [0, 0], radius: 0 }),
    place: (shape, placed, point) => placed
      ? { shape: { ...shape, radius: distance(shape.center, point) }, placing: false }
      : { shape: { ...shape, center: [...point] }, placing: true },
    handles: (shape) => [
      handle(shape.center, "Center", (point) => ({ ...shape, center: [...point] }), true),
      handle(destination(shape.center, shape.radius, 90), "Radius", (point) => ({ ...shape, radius: distance(shape.center, point) })),
    ],
    vertices: (shape) => Array.from({ length: 96 }, (_, index) =>
      destination(shape.center, shape.radius, (index * 360) / 96)),
    definingPoints: (shape) => [shape.center],
    translate: (shape, shift) => ({ ...shape, center: shift(shape.center) }),
    parameters: (shape) => [
      { label: "Radius", unit: "length", value: shape.radius, set: (radius) => ({ ...shape, radius }) },
    ],
    area: (shape) => 4 * Math.PI * R * R * Math.sin(shape.radius / (2 * R)) ** 2,
    validateDimensions: (shape) =>
      !Number.isFinite(shape.radius) || shape.radius <= 0 || shape.radius >= (Math.PI * R) / 2
        ? "Radius must be positive and smaller than a hemisphere."
        : undefined,
  },
  rectangle: {
    closed: true,
    minimum: 3,
    geometry: "Polygon",
    empty: () => ({ kind: "rectangle", center: [0, 0], width: 0, height: 0, bearing: 0 }),
    place: (shape, placed, point) => placed
      ? { shape: { ...shape, ...rectangleOffset(shape, point) }, placing: false }
      : { shape: { ...shape, center: [...point] }, placing: true },
    handles: (shape) => [
      handle(shape.center, "Center", (point) => ({ ...shape, center: [...point] }), true),
      handle(destination(shape.center, shape.width / 2, shape.bearing + 90), "Width", (point) => ({ ...shape, width: rectangleOffset(shape, point).width })),
      handle(destination(shape.center, shape.height / 2, shape.bearing), "Height", (point) => ({ ...shape, height: rectangleOffset(shape, point).height })),
      handle(destination(shape.center, shape.height / 2 + Math.max(20, shape.height * 0.2), shape.bearing), "Bearing", (point) => ({ ...shape, bearing: bearing(shape.center, point) })),
    ],
    vertices: (shape) => ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) =>
      destination(
        shape.center,
        Math.hypot(shape.width / 2, shape.height / 2),
        shape.bearing + Math.atan2(x * shape.width, y * shape.height) / rad,
      )),
    definingPoints: (shape) => [shape.center],
    translate: (shape, shift) => ({ ...shape, center: shift(shape.center) }),
    parameters: (shape) => [
      { label: "Width", unit: "length", value: shape.width, set: (width) => ({ ...shape, width }) },
      { label: "Height", unit: "length", value: shape.height, set: (height) => ({ ...shape, height }) },
      { label: "Bearing", unit: "angle", value: shape.bearing, set: (bearing) => ({ ...shape, bearing }) },
    ],
    validateDimensions: (shape) =>
      ![shape.width, shape.height, shape.bearing].every(Number.isFinite) ||
      shape.width <= 0 || shape.height <= 0 ||
      Math.hypot(shape.width, shape.height) >= Math.PI * R
        ? "Enter positive rectangle dimensions smaller than a hemisphere."
        : undefined,
  },
};

/** Narrow the shape and its rules together before invoking a typed operation. */
function withShapeDefinition<T>(
  shape: DrawingShape,
  operation: <S extends DrawingShape>(shape: S, definition: ShapeDefinition<S>) => T,
): T {
  switch (shape.kind) {
    case "point": return operation(shape, definitions.point);
    case "circle": return operation(shape, definitions.circle);
    case "rectangle": return operation(shape, definitions.rectangle);
    default: return operation(shape, definitions[shape.kind]);
  }
}

export function emptyShape(tool: DrawingTool): DrawingShape {
  return definitions[tool].empty!();
}

export function placePoint(shape: DrawingShape, placed: number, point: DrawingPosition): Placement | undefined {
  return withShapeDefinition(shape, (shape, rules) => rules.place(shape, placed, point));
}

export function shapeHandles(shape: DrawingShape): ShapeHandle[] {
  return withShapeDefinition(shape, (shape, rules) => rules.handles(shape));
}

export function shapeMoveHandle(shape: DrawingShape): { position: DrawingPosition; label: "Move drawing" } | undefined {
  const points = withShapeDefinition(shape, (shape, rules) => rules.editableVertices?.(shape));
  if (!points?.length) return;
  const unrolled = unroll(points);
  return {
    position: [
      wrapLongitude(unrolled.reduce((sum, point) => sum + point[0], 0) / unrolled.length),
      unrolled.reduce((sum, point) => sum + point[1], 0) / unrolled.length,
    ],
    label: "Move drawing",
  };
}

export function shapeInsertHandles(shape: DrawingShape): { after: number; position: DrawingPosition; label: string }[] {
  const points = withShapeDefinition(shape, (shape, rules) => rules.editableVertices?.(shape));
  if (!points) return [];
  const unrolled = unroll(points);
  const edges = definitions[shape.kind].closed ? unrolled.length : unrolled.length - 1;
  return Array.from({ length: Math.max(0, edges) }, (_, after) => {
    const a = unrolled[after]!, b = unrolled[(after + 1) % unrolled.length]!;
    return {
      after,
      position: destination(a, distance(a, b) / 2, bearing(a, b)),
      label: `Insert vertex after ${after + 1}`,
    };
  });
}

export function insertVertex(shape: DrawingShape, after: number, point: DrawingPosition): DrawingShape {
  return withShapeDefinition(shape, (shape, rules) => rules.insert?.(shape, after, point) ?? shape);
}

export function removeVertex(shape: DrawingShape, index: number): DrawingShape {
  return withShapeDefinition(shape, (shape, rules) => rules.remove?.(shape, index) ?? shape);
}

export function reverseShape(shape: DrawingShape): DrawingShape {
  return withShapeDefinition(shape, (shape, rules) => rules.reverse?.(shape) ?? shape);
}

export function shapeParameters(shape: DrawingShape): ShapeParameter[] {
  return withShapeDefinition(shape, (shape, rules) => rules.parameters(shape));
}

export function shapeFromGeometry(geometry: Point | LineString | Polygon): DrawingShape {
  if (geometry.type === "Point") return { kind: "point", position: position(geometry.coordinates) };
  if (geometry.type === "LineString") return { kind: "line", vertices: geometry.coordinates.map(position) };
  return { kind: "polygon", vertices: geometry.coordinates[0]!.slice(0, -1).map(position) };
}

export function shapeVertices(shape: DrawingShape): DrawingPosition[] {
  return withShapeDefinition(shape, (shape, rules) => rules.vertices(shape));
}
export function shapeGeometry(
  shape: DrawingShape,
  render = false,
): Point | LineString | Polygon {
  const definition = definitions[shape.kind];
  const points = shapeVertices(shape);
  if (definition.geometry === "Point")
    return { type: "Point", coordinates: [...points[0]!] };
  const ring = definition.closed;
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
    closed = definitions[shape.kind].closed;
  const length =
    points.reduce(
      (sum, p, i) => sum + (i ? distance(points[i - 1]!, p) : 0),
      0,
    ) + (closed && points.length ? distance(points.at(-1)!, points[0]!) : 0);
  return {
    length,
    ...(closed
      ? {
          area: withShapeDefinition(shape, (shape, rules) => rules.area?.(shape, points)) ?? Math.abs(signedArea(unroll(points))),
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
    !Object.hasOwn(definitions, shape.kind)
  )
    return "Unknown drawing shape.";
  const dimensionError = withShapeDefinition(shape, (shape, rules) => rules.validateDimensions?.(shape));
  if (dimensionError) return dimensionError;
  const definingPoints = withShapeDefinition(shape, (shape, rules) => rules.definingPoints(shape));
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
  const { closed, minimum } = definitions[shape.kind];
  if (raw.length < minimum)
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
export function translateShape(
  shape: DrawingShape,
  from: DrawingPosition,
  to: DrawingPosition,
): DrawingShape {
  const meters = distance(from, to),
    degrees = bearing(from, to);
  const shift = (p: DrawingPosition) => destination(p, meters, degrees);
  return withShapeDefinition(shape, (shape, rules) => rules.translate(shape, shift));
}
