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
import type {
  DrawingChange,
  DrawingDecision,
  DrawingOptions,
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
    createFeature: (geometry) => ({
      type: "Feature",
      id: "new",
      geometry,
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
    store.upsert([JSON.parse(JSON.stringify(feature(shape)))]);
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
});
