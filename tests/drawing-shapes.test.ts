import assert from "node:assert/strict";
import { test } from "node:test";
import { destination, distance } from "../src/drawing-geometry";
import {
  emptyShape,
  placePoint,
  shapeFromGeometry,
  shapeHandles,
  shapeInsertHandles,
  shapeMoveHandle,
  shapeParameters,
  validateShape,
} from "../src/drawing-shapes";
import type { DrawingShape, DrawingTool } from "../src/drawing-types";

const samples: { shape: DrawingShape; labels: string[] }[] = [
  { shape: { kind: "point", position: [1, 2] }, labels: ["Position"] },
  { shape: { kind: "line", vertices: [[1, 2], [2, 3]] }, labels: ["Vertex 1", "Vertex 2"] },
  { shape: { kind: "polygon", vertices: [[1, 2], [2, 3], [3, 2]] }, labels: ["Vertex 1", "Vertex 2", "Vertex 3"] },
  { shape: { kind: "arrow", vertices: [[1, 2], [2, 3]] }, labels: ["Vertex 1", "Vertex 2"] },
  { shape: { kind: "circle", center: [1, 2], radius: 200 }, labels: ["Center", "Radius"] },
  { shape: { kind: "rectangle", center: [1, 2], width: 400, height: 200, bearing: 35 }, labels: ["Center", "Width", "Height", "Bearing"] },
];

test("each kind's handles keep their order and moving to the current position keeps its definition", () => {
  for (const { shape, labels } of samples) {
    const handles = shapeHandles(shape);
    assert.deepEqual(handles.map((handle) => handle.label), labels);
    for (const handle of handles) {
      const moved = handle.move(handle.position);
      assert.equal(moved.kind, shape.kind);
      if (shape.kind === "rectangle" && moved.kind === "rectangle") {
        assert.ok(Math.abs(moved.width - shape.width) < 0.001);
        assert.ok(Math.abs(moved.height - shape.height) < 0.001);
        assert.ok(Math.abs(moved.bearing - shape.bearing) < 1e-8);
        assert.deepEqual(moved.center, shape.center);
      } else if (shape.kind === "circle" && moved.kind === "circle") {
        assert.ok(Math.abs(moved.radius - shape.radius) < 0.001);
        assert.deepEqual(moved.center, shape.center);
      } else {
        assert.deepEqual(moved, shape);
      }
    }
  }
});

test("rectangle handles change only their named parameter and center moves the definition", () => {
  const shape = samples.at(-1)!.shape;
  assert.equal(shape.kind, "rectangle");
  const [center, width, height, bearing] = shapeHandles(shape);
  assert.equal(center!.carriesShape, true);
  assert.equal(width!.carriesShape, false);
  assert.equal(width!.removable, false);
  const movedCenter = center!.move([3, 4]);
  assert.deepEqual(movedCenter, { ...shape, center: [3, 4] });
  const movedWidth = width!.move(destination(shape.center, 300, shape.bearing + 90));
  assert.equal(movedWidth.kind, "rectangle");
  assert.ok(Math.abs(movedWidth.width - 600) < 0.001);
  assert.equal(movedWidth.height, shape.height);
  assert.equal(movedWidth.bearing, shape.bearing);
  const movedHeight = height!.move(destination(shape.center, 150, shape.bearing));
  assert.equal(movedHeight.kind, "rectangle");
  assert.equal(movedHeight.width, shape.width);
  assert.ok(Math.abs(movedHeight.height - 300) < 0.001);
  assert.equal(movedHeight.bearing, shape.bearing);
  const movedBearing = bearing!.move(destination(shape.center, 200, 70));
  assert.equal(movedBearing.kind, "rectangle");
  assert.equal(movedBearing.width, shape.width);
  assert.equal(movedBearing.height, shape.height);
  assert.ok(Math.abs(movedBearing.bearing - 70) < 1e-8);
});

test("circle center carries the definition without changing radius", () => {
  const circle = samples[4]!.shape;
  assert.equal(circle.kind, "circle");
  const [center, radius] = shapeHandles(circle);
  assert.equal(center!.carriesShape, true);
  assert.equal(radius!.carriesShape, false);
  assert.deepEqual(center!.move([3, 4]), { ...circle, center: [3, 4] });
});

test("placement keeps vertex rules and sizes centered shapes from the second click", () => {
  for (const tool of ["line", "polygon", "arrow"] satisfies DrawingTool[]) {
    const first = placePoint(emptyShape(tool), 0, [0, 0])!;
    assert.equal(first.placing, true);
    assert.equal(placePoint(first.shape, 1, [0, 0]), undefined);
    const second = placePoint(first.shape, 1, [1, 0])!;
    assert.equal(second.placing, true);
    assert.deepEqual(second.shape, { kind: tool, vertices: [[0, 0], [1, 0]] });
  }
  const center: [number, number] = [1, 2];
  const circle = placePoint(emptyShape("circle"), 0, center)!;
  const sizedCircle = placePoint(circle.shape, 1, destination(center, 250, 90))!;
  assert.equal(sizedCircle.placing, false);
  assert.equal(sizedCircle.shape.kind, "circle");
  assert.ok(Math.abs(sizedCircle.shape.radius - 250) < 0.001);
  const rectangle = { kind: "rectangle", center, width: 0, height: 0, bearing: 35 } as const;
  const corner = destination(center, Math.hypot(200, 100), 35 + Math.atan2(200, 100) * 180 / Math.PI);
  const sizedRectangle = placePoint(rectangle, 1, corner)!;
  assert.equal(sizedRectangle.placing, false);
  assert.equal(sizedRectangle.shape.kind, "rectangle");
  assert.ok(Math.abs(sizedRectangle.shape.width - 400) < 0.001);
  assert.ok(Math.abs(sizedRectangle.shape.height - 200) < 0.001);
  assert.equal(sizedRectangle.shape.bearing, 35);
});

test("insert handles follow edge closure, and ordinary geometry stays ordinary", () => {
  for (const { shape } of samples) {
    const inserts = shapeInsertHandles(shape);
    const expected = shape.kind === "polygon" ? 3 : shape.kind === "line" || shape.kind === "arrow" ? 1 : 0;
    assert.equal(inserts.length, expected);
    assert.deepEqual(inserts.map((handle) => handle.label),
      Array.from({ length: expected }, (_, index) => `Insert vertex after ${index + 1}`));
    assert.equal(Boolean(shapeMoveHandle(shape)), "vertices" in shape);
  }
  const line = samples[1]!.shape;
  assert.equal(line.kind, "line");
  assert.ok(distance(shapeInsertHandles(line)[0]!.position, [1.5, 2.5]) < 100);
  const polygon = samples[2]!.shape;
  assert.equal(polygon.kind, "polygon");
  const closing = shapeInsertHandles(polygon)[2]!.position;
  assert.ok(distance(closing, [2, 2]) < 100);
  assert.deepEqual(shapeFromGeometry({ type: "Point", coordinates: [1, 2] }), { kind: "point", position: [1, 2] });
  assert.deepEqual(shapeFromGeometry({ type: "LineString", coordinates: [[1, 2], [2, 3]] }), line);
  assert.deepEqual(shapeFromGeometry({ type: "Polygon", coordinates: [[[1, 2], [2, 3], [3, 2], [1, 2]]] }), samples[2]!.shape);
});

test("inspector parameters keep labels, units, values and one-parameter setters", () => {
  const rectangle = samples.at(-1)!.shape;
  assert.deepEqual(shapeParameters(rectangle).map(({ label, unit, value }) => [label, unit, value]),
    [["Width", "length", 400], ["Height", "length", 200], ["Bearing", "angle", 35]]);
  for (const parameter of shapeParameters(rectangle)) {
    const updated = parameter.set(parameter.value + 1);
    assert.equal(updated.kind, "rectangle");
    assert.deepEqual(shapeParameters(updated).map(({ value }) => value),
      shapeParameters(rectangle).map((item) => item.label === parameter.label ? item.value + 1 : item.value));
  }
  assert.deepEqual(shapeParameters(samples[4]!.shape).map(({ label }) => label), ["Radius"]);
});

test("unknown shape names retain the validation error", () => {
  assert.equal(validateShape({ kind: "toString" } as unknown as DrawingShape), "Unknown drawing shape.");
});
