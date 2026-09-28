import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawingSession } from "../src/drawing-session";
import {
  DEFAULT_DRAWING_STYLE,
  destination,
  distance,
  measurements,
  shapeGeometry,
  unroll,
  validateShape,
} from "../src/drawing-geometry";
import { FeatureStore } from "../src/features";
import { arrowFeatures } from "../src/drawing-render";
import type {
  DrawingChange,
  DrawingDecision,
  DrawingOptions,
  DrawingPosition,
  DrawingShape,
} from "../src/drawing-types";
import type { MapFeature, Properties } from "../src/types";

function fixture(overrides: Partial<DrawingOptions<Properties>> = {}) {
  const store = new FeatureStore<Properties>();
  const listeners = new Set<
    (event: { ids: string[]; removed: string[] }) => void
  >();
  let owner: string | null = null;
  const host = {
    getFeature: (id: string) => store.get(id),
    getStyle: () => ({}),
    upsert: (features: readonly MapFeature[]) => {
      store.upsert(features);
      for (const fn of listeners)
        fn({ ids: features.map((f) => f.id), removed: [] });
    },
    remove: (ids: readonly string[]) => {
      const removed = store.remove(ids);
      for (const fn of listeners) fn({ ids: [], removed });
    },
    on: (
      _event: "datachange",
      fn: (event: { ids: string[]; removed: string[] }) => void,
    ) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    acquireInteraction: (name: string) => {
      if (owner) throw new Error("Owned");
      owner = name;
      return () => {
        owner = null;
      };
    },
  };
  const requests: DrawingChange[] = [];
  const editor = createDrawingSession(host, {
    createFeature: () => ({
      id: "new",
      properties: { name: "New" },
    }),
    submit: (change) => {
      requests.push(change);
      return { accepted: true };
    },
    ...overrides,
  });
  return { host, editor, requests, owner: () => owner };
}
function line(editor: ReturnType<typeof fixture>["editor"]) {
  editor.start("line");
  editor.addPoint([0, 0]);
  editor.addPoint([0.01, 0]);
}
function feature(shape: DrawingShape, id = "existing"): MapFeature {
  return {
    type: "Feature",
    id,
    geometry: shapeGeometry(shape),
    properties: { name: id },
    drawing: { version: 1, shape, style: { ...DEFAULT_DRAWING_STYLE } },
  };
}

test("Circle and rotated rectangle retain meter-based definitions across storage", () => {
  const store = new FeatureStore();
  for (const shape of [
    { kind: "circle", center: [179.999, 45], radius: 1000 },
    {
      kind: "rectangle",
      center: [179.999, 45],
      width: 2000,
      height: 1000,
      bearing: 35,
    },
  ] satisfies DrawingShape[]) {
    assert.equal(validateShape(shape), undefined);
    store.upsert([JSON.parse(JSON.stringify(feature(shape), (_key, value: unknown) =>
      typeof value === "number" ? Number(value.toFixed(9)) : value))]);
    assert.deepEqual(store.get("existing")?.drawing?.shape, shape);
    assert.ok(measurements(shape).area! > 1_900_000);
    const geometry = shapeGeometry(shape, true);
    assert.equal(geometry.type, "Polygon");
    if (geometry.type === "Polygon")
      assert.ok(
        Math.max(...geometry.coordinates[0]!.map((p) => p[0]!)) -
          Math.min(...geometry.coordinates[0]!.map((p) => p[0]!)) <
          1,
      );
  }
  assert.ok(
    Math.abs(
      distance([179.999, 45], destination([179.999, 45], 1000, 90)) - 1000,
    ) < 0.001,
  );
});
test("Reject crossing, repeated, polar and hemisphere-sized shapes; preserve date-line geometry", () => {
  assert.match(
    validateShape({
      kind: "polygon",
      vertices: [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ],
    })!,
    /cross/,
  );
  assert.match(
    validateShape({
      kind: "polygon",
      vertices: [
        [0, 0],
        [1, 0],
        [1, 0],
        [0, 1],
      ],
    })!,
    /distinct/,
  );
  assert.match(
    validateShape({
      kind: "polygon",
      vertices: [
        [-120, 80],
        [0, 80],
        [120, 80],
      ],
    })!,
    /pole/,
  );
  assert.match(
    validateShape({ kind: "circle", center: [0, 0], radius: 20_000_000 })!,
    /hemisphere/,
  );
  for (const shape of [
    { kind: "circle", center: [0, 100], radius: 100 },
    {
      kind: "rectangle",
      center: [999, 0],
      width: 100,
      height: 100,
      bearing: 0,
    },
  ] satisfies DrawingShape[])
    assert.match(validateShape(shape)!, /coordinates/);
  assert.equal(
    validateShape({
      kind: "polygon",
      vertices: [
        [179, 0],
        [-179, 0],
        [-179, 1],
        [179, 1],
      ],
    }),
    undefined,
  );
  assert.deepEqual(
    unroll([
      [179, 0],
      [-179, 0],
    ]),
    [
      [179, 0],
      [181, 0],
    ],
  );
});
test("Feature validation rejects stale shape metadata and preserves ordinary polygons with holes", () => {
  const store = new FeatureStore();
  const f = feature({ kind: "circle", center: [0, 0], radius: 100 });
  f.geometry = { type: "Point", coordinates: [0, 0] };
  assert.throws(() => store.upsert([f]), /match/);
  const moved = feature({ kind: "circle", center: [0, 0], radius: 100 });
  if (moved.geometry.type === "Polygon") moved.geometry.coordinates[0]![1]![0]! += 0.001;
  assert.throws(() => store.upsert([moved]), /match/);
  const hole: MapFeature = {
    type: "Feature",
    id: "hole",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 0],
        ],
        [
          [1, 1],
          [1.1, 1],
          [1.1, 1.1],
          [1, 1],
        ],
      ],
    },
  };
  const { host, editor } = fixture();
  host.upsert([hole]);
  assert.throws(() => editor.edit("hole"), /holes/);
  assert.deepEqual(host.getFeature("hole"), hole);
});
test("Arrowheads follow Mercator segments at high latitude and across the date line", () => {
  for (const [vertices, expected] of [
    [[[0, 60], [40, 60]], 90],
    [[[179, 60], [-179, 60]], 90],
    [[[-179, 60], [179, 60]], -90],
    [[[40, 40], [40, 60]], 0],
  ] satisfies [DrawingPosition[], number][]) {
    const head = arrowFeatures([feature({ kind: "arrow", vertices })]).features[0]!;
    assert.equal(head.properties?.bearing, expected);
  }
});
test("New drawing permissions receive placed geometry rather than a fabricated origin", async () => {
  const seen: MapFeature["geometry"][] = [];
  const { editor, requests } = fixture({
    canEdit: (candidate, operation) => {
      assert.equal(operation, "create");
      seen.push(candidate.geometry);
      return candidate.geometry.type === "LineString"
        && candidate.geometry.coordinates.every(p => p[0]! >= 10);
    },
  });
  editor.start("line");
  assert.equal(editor.getState().phase, "editing");
  assert.equal(seen.length, 0);
  editor.addPoint([10, 20]);
  editor.addPoint([11, 21]);
  assert.equal(await editor.finish(), true);
  assert.deepEqual(requests[0]?.after?.geometry, { type: "LineString", coordinates: [[10, 20], [11, 21]] });
  assert.ok(seen.length > 0);
  assert.ok(seen.every(geometry => geometry.type === "LineString" && geometry.coordinates[0]?.[0] === 10));
});
test("Draft undo, gesture grouping and cancellation never mutate consumer data", () => {
  const { host, editor, owner } = fixture();
  line(editor);
  assert.equal(owner(), "drawing");
  assert.equal(host.getFeature("new"), undefined);
  editor.beginGesture();
  editor.moveVertex(1, [0.02, 0]);
  editor.moveVertex(1, [0.03, 0]);
  editor.endGesture();
  editor.undo();
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line",
    vertices: [
      [0, 0],
      [0.01, 0],
    ],
  });
  editor.redo();
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line",
    vertices: [
      [0, 0],
      [0.03, 0],
    ],
  });
  editor.cancel();
  assert.equal(owner(), null);
  assert.equal(host.getFeature("new"), undefined);
});
test("A completed edit is submitted once and applies only after acceptance", async () => {
  let decide: (value: DrawingDecision) => void = () => {};
  const { host, editor } = fixture({
    submit: () =>
      new Promise((resolve) => {
        decide = resolve;
      }),
  });
  line(editor);
  const pending = editor.finish();
  assert.equal(editor.getState().phase, "pending");
  assert.equal(host.getFeature("new"), undefined);
  await assert.rejects(editor.finish(), /cannot be edited/);
  assert.throws(() => editor.setStyle({ label: "Later" }), /cannot be edited/);
  decide({ accepted: true });
  assert.equal(await pending, true);
  assert.equal(editor.getState().phase, "idle");
  assert.equal(host.getFeature("new")?.drawing?.shape.kind, "line");
});
test("Rejection retains draft; unrelated updates leave it intact; accepted edit preserves properties", async () => {
  const { host, editor } = fixture({
    submit: () => ({ accepted: false, reason: "Outside area" }),
  });
  line(editor);
  await editor.finish();
  assert.equal(editor.getState().phase, "rejected");
  assert.equal(editor.getState().message, "Outside area");
  editor.setStyle({ label: "Corrected" });
  host.upsert([feature({ kind: "point", position: [1, 1] }, "other")]);
  assert.equal(editor.getState().phase, "editing");
  const accepted = fixture();
  const before = feature({
    kind: "line",
    vertices: [
      [0, 0],
      [1, 0],
    ],
  });
  before.properties.extra = { retain: true };
  accepted.host.upsert([before]);
  accepted.editor.edit(before.id);
  accepted.editor.setStyle({ label: "Changed" });
  await accepted.editor.finish();
  assert.deepEqual(accepted.host.getFeature(before.id)?.properties.extra, {
    retain: true,
  });
});
test("External update during submission aborts and cannot overwrite the newer feature", async () => {
  let decide: (v: DrawingDecision) => void = () => {},
    signal: AbortSignal | undefined;
  const { host, editor } = fixture({
    submit: (_change, s) => {
      signal = s;
      return new Promise((resolve) => {
        decide = resolve;
      });
    },
  });
  const before = feature({
    kind: "line",
    vertices: [
      [0, 0],
      [1, 0],
    ],
  });
  host.upsert([before]);
  editor.edit(before.id);
  editor.moveVertex(1, [2, 0]);
  const pending = editor.finish();
  const newer = feature({
    kind: "line",
    vertices: [
      [0, 0],
      [3, 0],
    ],
  });
  host.upsert([newer]);
  assert.ok(signal?.aborted);
  decide({ accepted: true });
  assert.equal(await pending, false);
  assert.equal(editor.getState().phase, "conflict");
  assert.deepEqual(host.getFeature(before.id), newer);
  editor.restart();
  assert.deepEqual(editor.getState().draft?.shape, newer.drawing?.shape);
});
test("Lost permission blocks acceptance and preserves the draft", async () => {
  let permitted = true,
    decide: (v: DrawingDecision) => void = () => {};
  const { host, editor } = fixture({
    canEdit: () => permitted,
    submit: () =>
      new Promise((resolve) => {
        decide = resolve;
      }),
  });
  line(editor);
  const pending = editor.finish();
  permitted = false;
  editor.refreshPermissions();
  decide({ accepted: true });
  assert.equal(await pending, false);
  assert.equal(editor.getState().phase, "forbidden");
  assert.ok(editor.getState().draft);
  assert.equal(host.getFeature("new"), undefined);
});
test("Destroying a pending session releases ownership and ignores a late result", async () => {
  let decide: (v: DrawingDecision) => void = () => {};
  const { host, editor, owner } = fixture({
    submit: () =>
      new Promise((resolve) => {
        decide = resolve;
      }),
  });
  line(editor);
  const pending = editor.finish();
  editor.destroy();
  decide({ accepted: true });
  assert.equal(await pending, false);
  assert.equal(owner(), null);
  assert.equal(host.getFeature("new"), undefined);
});
test("Delete uses the same acceptance boundary and style restrictions are enforced", async () => {
  const { host, editor, requests } = fixture({ styleFields: ["label"] });
  const before = feature({
    kind: "arrow",
    vertices: [
      [0, 0],
      [1, 0],
    ],
  });
  host.upsert([before]);
  editor.edit(before.id);
  assert.throws(() => editor.setStyle({ color: "red" }), /controlled/);
  editor.reverse();
  await editor.delete();
  assert.equal(host.getFeature(before.id), undefined);
  assert.equal(requests[0]?.kind, "delete");
  assert.deepEqual(requests[0]?.before, before);
});
test("Exact dimensions cannot submit a new shape before its center is placed", async () => {
  const { host, editor } = fixture();
  editor.start("circle");
  editor.setShape({ kind: "circle", center: [0, 0], radius: 500 });
  assert.match(editor.getState().validation!, /place/);
  assert.equal(await editor.finish(), false);
  assert.equal(host.getFeature("new"), undefined);
});
test("Editing an ordinary feature inherits only defined drawing styles", async () => {
  const { host, editor } = fixture();
  host.getStyle = () => ({ color: "#123456", label: undefined });
  host.upsert([
    {
      type: "Feature",
      id: "ordinary",
      properties: { name: "Kept" },
      geometry: { type: "Point", coordinates: [0, 0] },
    },
  ]);
  editor.edit("ordinary");
  assert.equal(editor.getState().validation, undefined);
  assert.equal(editor.getState().draft?.style.label, "");
  assert.equal(editor.getState().draft?.style.color, "#123456");
  assert.equal(await editor.finish(), true);
  assert.equal(host.getFeature("ordinary")?.properties.name, "Kept");
  assert.equal(host.getFeature("ordinary")?.drawing, undefined);
  host.getStyle = () => ({ color: "#654321", label: "Updated" });
  editor.edit("ordinary");
  assert.equal(editor.getState().draft?.style.color, "#654321");
  editor.setStyle({ label: "Custom" });
  editor.undo();
  await editor.finish();
  assert.equal(host.getFeature("ordinary")?.drawing, undefined);
  editor.edit("ordinary");
  editor.setStyle({ label: "Custom" });
  await editor.finish();
  assert.equal(host.getFeature("ordinary")?.drawing?.style.label, "Custom");
});

test("Delete permission is independent of update permission", async () => {
  const { host, editor, requests } = fixture({ canEdit: (_feature, operation) => operation === "delete" });
  const before = feature({ kind: "line", vertices: [[0, 0], [1, 0]] });
  host.upsert([before]);
  editor.edit(before.id);
  assert.equal(editor.getState().phase, "forbidden");
  assert.equal(editor.canDelete(), true);
  assert.throws(() => editor.moveVertex(1, [2, 0]), /cannot be edited/);
  assert.equal(await editor.delete(), true);
  assert.equal(requests[0]?.kind, "delete");
  assert.equal(host.getFeature(before.id), undefined);
});

test("Revoking pending delete permission aborts and explains discarded acceptance", async () => {
  for (const restorePermission of [false, true]) {
    let permitted = true, signal: AbortSignal | undefined;
    let decide: (value: DrawingDecision) => void = () => {};
    const { host, editor } = fixture({
      canEdit: (_feature, operation) => operation !== "delete" || permitted,
      submit: (_change, currentSignal) => { signal = currentSignal; return new Promise(resolve => { decide = resolve; }); },
    });
    const before = feature({ kind: "point", position: [0, 0] });
    host.upsert([before]); editor.edit(before.id);
    const pending = editor.delete();
    assert.equal(editor.canDelete(), false);
    permitted = false; editor.refreshPermissions();
    assert.equal(signal?.aborted, true);
    if (restorePermission) { permitted = true; editor.refreshPermissions(); }
    decide({ accepted: true });
    assert.equal(await pending, false);
    assert.equal(editor.getState().phase, "rejected");
    assert.match(editor.getState().message!, /Permission changed/);
    assert.deepEqual(host.getFeature(before.id), before);
    editor.destroy();
  }
});

for (const tool of ["circle", "rectangle"] as const) {
  test(`${tool} placement preserves the center and groups sizing into one undo action`, () => {
    const { editor, host } = fixture();
    const center: DrawingPosition = [179.999, 45];
    editor.start(tool);
    const initial = editor.getState();
    editor.addPoint(center);
    const first = editor.getState().draft!;
    assert.equal(first.placing, true);
    assert.equal(first.placed, 1);
    assert.ok("center" in first.shape);
    assert.deepEqual(first.shape.center, center);
    assert.equal(editor.getState().measurements.area, 0);

    const edge = destination(center, 1000, 70);
    editor.addPoint(edge);
    const sized = editor.getState().draft!;
    assert.equal(sized.placing, false);
    assert.equal(sized.placed, 2);
    assert.ok("center" in sized.shape);
    assert.deepEqual(sized.shape.center, center);
    assert.ok(editor.getState().measurements.area! > 0);
    if (sized.shape.kind === "circle")
      assert.ok(Math.abs(sized.shape.radius - 1000) < 0.001);
    assert.equal(host.getFeature("new"), undefined);

    editor.undo();
    assert.deepEqual(editor.getState().draft, first);
    editor.undo();
    assert.deepEqual(editor.getState().draft, initial.draft);
    assert.equal(editor.getState().canUndo, false);
    editor.redo();
    editor.redo();
    assert.deepEqual(editor.getState().draft, sized);
    editor.destroy();
  });
}

test("Rectangle placement uses the current bearing and keeps the clicked corner", () => {
  const { editor } = fixture();
  editor.start("rectangle"); editor.addPoint([0, 0]);
  editor.setShape({ kind: "rectangle", center: [0, 0], width: 0, height: 0, bearing: 45 });
  const corner = destination([0, 0], 1000, 70);
  editor.addPoint(corner);
  const geometry = shapeGeometry(editor.getState().draft!.shape);
  assert.equal(geometry.type, "Polygon");
  if (geometry.type !== "Polygon") return;
  assert.ok(geometry.coordinates[0]!.some(p => distance(corner, [p[0]!, p[1]!]) < .001));
});

test("Detailed polygon validation detects distant crossing edges and keeps snapshots detached", () => {
  const vertices = Array.from({ length: 2000 }, (_, i) => destination([179.999, 0], 1000, i / 2000 * 360));
  const shape: DrawingShape = { kind: "polygon", vertices };
  assert.equal(validateShape(shape), undefined);
  const crossed = structuredClone(shape);
  [crossed.vertices[300], crossed.vertices[1300]] = [crossed.vertices[1300]!, crossed.vertices[300]!];
  assert.match(validateShape(crossed)!, /cross/);
  const { host, editor } = fixture();
  host.upsert([feature(shape)]); editor.edit("existing");
  const state = editor.getState();
  state.draft!.style.color = "red";
  assert.notEqual(editor.getState().draft?.style.color, "red");
  editor.setShape(crossed);
  assert.match(editor.getState().validation!, /cross/);
  editor.undo();
  assert.equal(editor.getState().validation, undefined);
});

test("Session previews match placement for the first and later vertex of every vertex tool", () => {
  for (const tool of ["line", "polygon", "arrow"] as const) {
    const { editor } = fixture();
    editor.start(tool);
    assert.equal(editor.getPreview(), undefined);
    for (const point of [[0, 0], [0.01, 0], [0.01, 0.01]] satisfies DrawingPosition[]) {
      editor.setCursor(point);
      const preview = editor.getPreview();
      const live = editor.getMeasurements();
      assert.deepEqual(live, measurements(preview!));
      editor.addPoint(point);
      assert.deepEqual(editor.getState().draft?.shape, preview);
      assert.deepEqual(editor.getState().measurements, live);
    }
    editor.destroy();
  }
});

test("Centered shape previews use the same sizing as placement, including rectangle bearing", () => {
  for (const tool of ["circle", "rectangle"] as const) {
    const { editor } = fixture();
    const center: DrawingPosition = [179.999, 45];
    const corner = destination(center, 1000, 70);
    editor.start(tool);
    editor.setCursor(center);
    assert.equal(editor.getPreview(), undefined);
    assert.deepEqual(editor.getMeasurements(), { length: 0 });
    editor.addPoint(center);
    assert.equal(editor.getPreview()?.kind, tool);
    if (tool === "rectangle")
      editor.setShape({ kind: "rectangle", center, width: 0, height: 0, bearing: 45 });
    editor.setCursor(corner);
    const preview = editor.getPreview();
    const live = editor.getMeasurements();
    assert.deepEqual(live, measurements(preview!));
    editor.addPoint(corner);
    assert.deepEqual(editor.getState().draft?.shape, preview);
    assert.deepEqual(editor.getState().measurements, live);
    editor.setCursor(destination(center, 2000, 70));
    assert.deepEqual(editor.getPreview(), preview);
    editor.destroy();
  }
});

test("Cursor updates leave draft state and history untouched and notify preview listeners only", () => {
  const { editor } = fixture();
  editor.start("line");
  editor.addPoint([0, 0]);
  const original = editor.getState();
  let changes = 0, previews = 0;
  const offChange = editor.onChange(() => { changes++; });
  const offPreview = editor.onPreview(() => { previews++; });
  const cursor: DrawingPosition = [0.01, 0];
  editor.setCursor(cursor);
  cursor[0] = 99;
  assert.deepEqual(editor.getState(), original);
  assert.deepEqual(editor.getPreview(), { kind: "line", vertices: [[0, 0], [0.01, 0]] });
  assert.deepEqual(editor.getMeasurements(), measurements(editor.getPreview()!));
  assert.equal(changes, 0);
  assert.equal(previews, 1);
  const preview = editor.getPreview()!;
  if ("vertices" in preview) preview.vertices[1]![0] = 99;
  assert.deepEqual(editor.getPreview(), { kind: "line", vertices: [[0, 0], [0.01, 0]] });
  editor.setStyle({ label: "Updated" });
  assert.equal(changes, 1);
  assert.equal(previews, 2);
  assert.deepEqual(editor.getPreview(), editor.getState().draft?.shape);
  offChange(); offPreview();
  editor.destroy();
});

test("Throwing session listeners do not block preview updates or accepted submission cleanup", async () => {
  let decide: (value: DrawingDecision) => void = () => {};
  const { editor, host, owner } = fixture({
    submit: () => new Promise(resolve => { decide = resolve; }),
  });
  line(editor);
  let changes = 0, previews = 0;
  editor.onChange(() => { throw new Error("Consumer change listener failed"); });
  editor.onChange(() => { changes++; });
  editor.onPreview(() => { throw new Error("Consumer preview listener failed"); });
  editor.onPreview(() => { previews++; });

  editor.setCursor([0.02, 0]);
  assert.deepEqual(editor.getPreview(), { kind: "line", vertices: [[0, 0], [0.01, 0], [0.02, 0]] });
  assert.equal(previews, 1);
  const submission = editor.finish();
  assert.equal(editor.getState().phase, "pending");
  assert.equal(changes, 1);
  assert.equal(previews, 2);
  decide({ accepted: true });
  assert.equal(await submission, true);
  assert.equal(changes, 2);
  assert.equal(previews, 3);
  assert.equal(owner(), null);
  assert.ok(host.getFeature("new"));
  editor.destroy();
});

test("Preview deduplication follows placement across the one millimeter boundary", () => {
  const { editor } = fixture();
  editor.start("line");
  editor.addPoint([0, 0]);
  for (const meters of [0.0009, 0.0011]) {
    const point = destination([0, 0], meters, 90);
    editor.setCursor(point);
    const preview = editor.getPreview();
    const before = editor.getState();
    editor.addPoint(point);
    assert.deepEqual(editor.getState().draft?.shape, preview);
    assert.equal(editor.getState().draft?.placed, meters < 0.001 ? before.draft?.placed : before.draft!.placed + 1);
  }
  const boundary: DrawingPosition = [0.001 / 6_371_008.8 / (Math.PI / 180), 0];
  assert.equal(distance([0, 0], boundary), 0.001);
  editor.undo();
  editor.setCursor(boundary);
  const preview = editor.getPreview();
  editor.addPoint(boundary);
  assert.deepEqual(editor.getState().draft?.shape, preview);
  assert.equal(editor.getState().draft?.placed, 2);
  editor.destroy();
});

test("Draft changes, undo, redo, cancellation, and destruction clear the cursor", () => {
  const { editor } = fixture();
  editor.start("line");
  editor.addPoint([0, 0]);
  editor.setCursor([0.02, 0]);
  editor.addPoint([0.01, 0]);
  assert.deepEqual(editor.getPreview(), editor.getState().draft?.shape);
  editor.setCursor([0.03, 0]);
  editor.undo();
  assert.deepEqual(editor.getPreview(), editor.getState().draft?.shape);
  editor.setCursor([0.03, 0]);
  editor.redo();
  assert.deepEqual(editor.getPreview(), editor.getState().draft?.shape);
  editor.setCursor([0.03, 0]);
  editor.cancel();
  assert.equal(editor.getPreview(), undefined);
  editor.start("polygon");
  assert.equal(editor.getPreview(), undefined);
  editor.setCursor([0.03, 0]);
  editor.destroy();
  assert.equal(editor.getPreview(), undefined);
});

test("Pending, conflict, and forbidden phases show only committed geometry", async () => {
  let decide: (value: DrawingDecision) => void = () => {};
  const pending = fixture({ submit: () => new Promise(resolve => { decide = resolve; }) });
  line(pending.editor);
  pending.editor.setCursor([0.02, 0]);
  const request = pending.editor.finish();
  pending.editor.setCursor([0.03, 0]);
  assert.equal(pending.editor.getState().phase, "pending");
  assert.deepEqual(pending.editor.getPreview(), pending.editor.getState().draft?.shape);
  decide({ accepted: false, reason: "Try again" });
  assert.equal(await request, false);
  pending.editor.setCursor([0.03, 0]);
  assert.equal(pending.editor.getState().phase, "rejected");
  assert.notDeepEqual(pending.editor.getPreview(), pending.editor.getState().draft?.shape);
  pending.editor.destroy();

  let permitted = true;
  const forbidden = fixture({ canEdit: () => permitted });
  forbidden.editor.start("line");
  forbidden.editor.addPoint([0, 0]);
  permitted = false;
  forbidden.editor.refreshPermissions();
  forbidden.editor.setCursor([0.01, 0]);
  assert.equal(forbidden.editor.getState().phase, "forbidden");
  assert.deepEqual(forbidden.editor.getPreview(), forbidden.editor.getState().draft?.shape);
  forbidden.editor.destroy();

  const conflicted = fixture();
  conflicted.editor.start("line");
  conflicted.editor.addPoint([0, 0]);
  conflicted.host.upsert([feature({ kind: "point", position: [0, 0] }, "new")]);
  conflicted.editor.setCursor([0.01, 0]);
  assert.equal(conflicted.editor.getState().phase, "conflict");
  assert.deepEqual(conflicted.editor.getPreview(), conflicted.editor.getState().draft?.shape);
  conflicted.editor.destroy();
});
