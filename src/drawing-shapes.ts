import type { LineString, Point, Polygon } from "geojson";
import { RidgelineError } from "./errors";
import type { DrawingPosition, DrawingSegment, DrawingShape, DrawingTool } from "./drawing-types";
import { bearing, destination, distance, position, unroll, wrapLongitude } from "./drawing-geometry";

const R = 6_371_008.8;
const rad = Math.PI / 180;
function invalidRing(message: string, operation: string): never {
  throw new RidgelineError("INVALID_CONFIGURATION", message, { operation, recoverable: true });
}

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

export function placePoint(shape: DrawingShape, placed: number, point: DrawingPosition, ring = 0): Placement | undefined {
  if (shape.kind === "polygon" && ring > 0) {
    const vertices = shape.holes?.[ring - 1];
    if (!vertices) invalidRing("Unknown polygon ring.", "drawing.addPoint");
    const result = definitions.polygon.place({ kind: "polygon", vertices }, placed, point);
    return result && "vertices" in result.shape
      ? { shape: replaceRing(shape, ring, result.shape.vertices, "drawing.addPoint"), placing: result.placing }
      : undefined;
  }
  return withShapeDefinition(shape, (shape, rules) => rules.place(shape, placed, point));
}

export function shapeHandles(shape: DrawingShape): ShapeHandle[] {
  if (shape.kind === "polygon") return shapeRings(shape).flatMap((vertices, ring) =>
    vertices.map((p, index) => handle(p, ring ? `Hole ${ring} vertex ${index + 1}` : `Vertex ${index + 1}`,
      (point) => replaceRing(shape, ring, vertices.map((vertex, i) => i === index ? [...point] : vertex), "drawing.moveVertex"), false, true)));
  return withShapeDefinition(shape, (shape, rules) => rules.handles(shape));
}
export function shapeRings(shape: DrawingShape): DrawingPosition[][] {
  return shape.kind === "polygon" ? [shape.vertices, ...(shape.holes ?? [])] : [shapeVertices(shape)];
}
function replaceRing(shape: Extract<DrawingShape, { kind: "polygon" }>, ring: number, vertices: DrawingPosition[], operation: string) {
  if (!ring) return { ...shape, vertices };
  if (!shape.holes?.[ring - 1]) invalidRing("Unknown polygon ring.", operation);
  return { ...shape, holes: shape.holes.map((hole, i) => i === ring - 1 ? vertices : hole) };
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

export function shapeInsertHandles(shape: DrawingShape): { ring: number; after: number; position: DrawingPosition; label: string }[] {
  if (shape.kind === "polygon" && shape.holes?.length) return shapeRings(shape).flatMap((vertices, ring) =>
    shapeInsertHandles({ kind: "polygon", vertices }).map((item) => ({ ...item, ring,
      label: ring ? `Insert hole ${ring} vertex after ${item.after + 1}` : item.label })));
  const points = withShapeDefinition(shape, (shape, rules) => rules.editableVertices?.(shape));
  if (!points) return [];
  const unrolled = unroll(points);
  const edges = definitions[shape.kind].closed ? unrolled.length : unrolled.length - 1;
  return Array.from({ length: Math.max(0, edges) }, (_, after) => {
    const a = unrolled[after]!, b = unrolled[(after + 1) % unrolled.length]!;
    // Ordinary edges are straight in Mercator. A great-circle midpoint
    // moves off the displayed edge at high latitude.
    const northing = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + latitude * rad / 2));
    return {
      ring: 0,
      after,
      position: [
        wrapLongitude(a[0] + wrapLongitude(b[0] - a[0]) / 2),
        a[1] === b[1] ? a[1] : (2 * Math.atan(Math.exp((northing(a[1]) + northing(b[1])) / 2)) - Math.PI / 2) / rad,
      ],
      label: `Insert vertex after ${after + 1}`,
    };
  });
}

export function insertVertex(shape: DrawingShape, after: number, point: DrawingPosition, ring = 0): DrawingShape {
  if (!Number.isInteger(ring) || ring < 0 || (ring > 0 && shape.kind !== "polygon")) invalidRing("Unknown polygon ring.", "drawing.insertVertex");
  if (shape.kind === "polygon" && (!Number.isInteger(after) || after < 0 || after >= (shapeRings(shape)[ring]?.length ?? 0)))
    invalidRing("Unknown vertex.", "drawing.insertVertex");
  if (shape.kind === "polygon" && ring) {
    const vertices = shape.holes?.[ring - 1];
    if (!vertices) invalidRing("Unknown polygon ring.", "drawing.insertVertex");
    const next = [...vertices]; next.splice(after + 1, 0, [...point]);
    return replaceRing(shape, ring, next, "drawing.insertVertex");
  }
  return withShapeDefinition(shape, (shape, rules) => rules.insert?.(shape, after, point) ?? shape);
}

export function removeVertex(shape: DrawingShape, index: number, ring = 0): DrawingShape {
  if (!Number.isInteger(ring) || ring < 0 || (ring > 0 && shape.kind !== "polygon")) invalidRing("Unknown polygon ring.", "drawing.removeVertex");
  if (shape.kind === "polygon" && (!Number.isInteger(index) || index < 0 || index >= (shapeRings(shape)[ring]?.length ?? 0)))
    invalidRing("Unknown vertex.", "drawing.removeVertex");
  if (shape.kind === "polygon" && ring) {
    const vertices = shape.holes?.[ring - 1];
    if (!vertices) invalidRing("Unknown polygon ring.", "drawing.removeVertex");
    return replaceRing(shape, ring, vertices.filter((_, i) => i !== index), "drawing.removeVertex");
  }
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
  return { kind: "polygon", vertices: geometry.coordinates[0]!.slice(0, -1).map(position),
    ...(geometry.coordinates.length > 1 ? { holes: geometry.coordinates.slice(1).map(ring => ring.slice(0, -1).map(position)) } : {}) };
}

export function shapeVertices(shape: DrawingShape): DrawingPosition[] {
  return withShapeDefinition(shape, (shape, rules) => rules.vertices(shape));
}
function ringContains(ring: DrawingPosition[], point: DrawingPosition) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function renderPolygonRings(shape: Extract<DrawingShape, { kind: "polygon" }>): DrawingPosition[][] {
  const rings = shapeRings(shape).map(unroll), outer = rings[0]!;
  if (!outer.length || rings.length === 1) return rings;
  const extent = (ring: DrawingPosition[]) => ring.reduce(({ min, max }, point) =>
    ({ min: Math.min(min, point[0]), max: Math.max(max, point[0]) }), { min: Infinity, max: -Infinity });
  const { min, max } = extent(outer);
  let projectedOuter: DrawingPosition[] | undefined;
  return [outer, ...rings.slice(1).map(ring => {
    if (!ring.length) return ring;
    const { min: holeMin, max: holeMax } = extent(ring);
    const preferred = Math.round(((min + max) - (holeMin + holeMax)) / 720);
    const first = Math.ceil((min - holeMin) / 360), last = Math.floor((max - holeMax) / 360);
    const shifted = (copy: number): DrawingPosition[] => ring.map(([lng, lat]) => [lng + 360 * copy, lat]);
    // A wide exterior can span either side of its first vertex. Fit the complete
    // hole to its extent, and use containment when more than one copy can fit.
    if (first === last) return shifted(first);
    if (first > last) return shifted(preferred);
    const projected = projectedOuter ??= topologyPoints(outer);
    const fits = (copy: number) => {
      const hole = topologyPoints(shifted(copy));
      return hole.every(point => ringContains(projected, point)) && !hole.some((a, i) => projected.some((b, j) =>
        intersects(a, hole[(i + 1) % hole.length]!, b, projected[(j + 1) % projected.length]!)));
    };
    if (preferred >= first && preferred <= last && fits(preferred)) return shifted(preferred);
    for (let copy = first; copy <= last; copy++) if (fits(copy)) return shifted(copy);
    return shifted(preferred);
  })];
}
export function shapeGeometry(
  shape: DrawingShape,
  render = false,
): Point | LineString | Polygon {
  if (shape.kind === "polygon") {
    return { type: "Polygon", coordinates: (render ? renderPolygonRings(shape) : shapeRings(shape)).map(ring => {
      const closed: DrawingPosition[] = ring.map(p => [...p]);
      if (closed.length) closed.push([...closed[0]!]);
      return closed;
    }) };
  }
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
export function measurements(shape: DrawingShape): { length: number; area?: number } {
  if (shape.kind === "polygon" && shape.holes?.length) {
    const rings = shapeRings(shape).map(vertices => measurements({ kind: "polygon", vertices }));
    return { length: rings.reduce((sum, ring) => sum + ring.length, 0),
      area: rings[0]!.area! - rings.slice(1).reduce((sum, ring) => sum + ring.area!, 0) };
  }
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
export function shapeSegments(shape: DrawingShape): DrawingSegment[] {
  if (!("vertices" in shape)) return [];
  return shapeRings(shape).flatMap((vertices, ring) => {
    const count = vertices.length < 2 ? 0 : shape.kind === "polygon" ? vertices.length : vertices.length - 1;
    return Array.from({ length: count }, (_, index) => {
      const start = vertices[index]!, end = vertices[(index + 1) % vertices.length]!;
      return { ring, index, start: [...start], end: [...end], length: distance(start, end),
        bearing: (bearing(start, end) + 360) % 360 };
    });
  });
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
function topologyPoints(ring: DrawingPosition[]): DrawingPosition[] {
  // Displayed polygon edges are straight in Mercator, including at high latitude.
  return unroll(ring).map(([lng, lat]) => [lng, Math.log(Math.tan(Math.PI / 4 + lat * rad / 2))]);
}
export function validateShape(shape: DrawingShape): string | undefined {
  if (
    !shape ||
    !Object.hasOwn(definitions, shape.kind)
  )
    return "Unknown drawing shape.";
  if (shape.kind === "polygon" && shape.holes?.length) {
    const rings = shapeRings(shape);
    for (const [i, vertices] of rings.entries()) {
      const error = validateShape({ kind: "polygon", vertices });
      if (error) return i ? `Hole ${i}: ${error}` : error;
    }
    const aligned = renderPolygonRings(shape).map(topologyPoints);
    for (let i = 1; i < aligned.length; i++) {
      const hole = aligned[i]!;
      if (!ringContains(aligned[0]!, hole[0]!)) return `Hole ${i} must lie strictly inside the boundary.`;
      for (let j = 0; j < i; j++) {
        const other = aligned[j]!;
        for (let a = 0; a < hole.length; a++) for (let b = 0; b < other.length; b++)
          if (intersects(hole[a]!, hole[(a + 1) % hole.length]!, other[b]!, other[(b + 1) % other.length]!))
            return `Hole ${i} touches or crosses another boundary.`;
        if (j && (ringContains(other, hole[0]!) || ringContains(hole, other[0]!)))
          return "Holes cannot overlap or contain another hole.";
      }
    }
    return;
  }
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
    const segments = topologyPoints(raw)
      .map((a, index, projected) => {
        const b = projected[(index + 1) % edges]!;
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
  if (shape.kind === "polygon") return { ...shape, vertices: shape.vertices.map(shift),
    ...(shape.holes ? { holes: shape.holes.map(ring => ring.map(shift)) } : {}) };
  return withShapeDefinition(shape, (shape, rules) => rules.translate(shape, shift));
}
