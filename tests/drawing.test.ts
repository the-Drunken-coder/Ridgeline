import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawingSession } from "../src/drawing-session";
import {
  DEFAULT_DRAWING_STYLE,
  destination,
  distance,
  position,
  unroll,
} from "../src/drawing-geometry";
import { measurements, shapeGeometry, validateShape } from "../src/drawing-shapes";
import { FeatureStore } from "../src/features";
import { RidgelineError } from "../src/errors";
import { arrowFeatures } from "../src/arrowheads";
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
  const diagnostics: RidgelineError[] = [];
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
    reportCallbackError: (cause: unknown, operation: string, featureId?: string) => {
      diagnostics.push(new RidgelineError("CALLBACK_FAILED", "A consumer callback threw.",
        { operation, recoverable: true, featureId }, cause));
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
  return { host, editor, requests, diagnostics, owner: () => owner };
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

test("Bounded stored vertices retain their exact coordinates when used as drawing positions", () => {
  for (const coordinate of [[-179.65, 0], [0.015, 60], [180, -45]] satisfies DrawingPosition[])
    assert.deepEqual(position(coordinate), coordinate);
  assert.deepEqual(position([181, 20]), [-179, 20]);
});

for (const action of ["destroy", "conflict", "permission"] as const) {
  test(`Pending notification ${action} prevents persistence from starting`, async () => {
    let permitted = true;
    const { editor, host, requests, owner } = fixture({ canEdit: () => permitted });
    const before = feature({ kind: "line", vertices: [[0, 0], [0.01, 0]] });
    host.upsert([before]);
    editor.edit(before.id);
    editor.moveVertex(1, [0.02, 0]);
    let armed = true;
    editor.onChange(() => {
      if (!armed || editor.getState().phase !== "pending") return;
      armed = false;
      if (action === "destroy") editor.destroy();
      else if (action === "conflict") host.upsert([{ ...before, properties: { name: "newer" } }]);
      else { permitted = false; editor.refreshPermissions(); }
    });
    assert.equal(await editor.finish(), false);
    assert.equal(requests.length, 0);
    assert.deepEqual(host.getFeature(before.id)?.geometry, before.geometry);
    assert.equal(editor.getState().phase, action === "destroy" ? "idle" : action === "conflict" ? "conflict" : "forbidden");
    if (action === "destroy") assert.equal(owner(), null);
    editor.destroy();
  });
}

for (const action of ["cancel", "destroy"] as const) {
  test(`Interaction acquisition interrupted by ${action} releases its lease and stays idle`, () => {
    const { editor, host, owner } = fixture();
    const acquire = host.acquireInteraction;
    host.acquireInteraction = (name) => {
      const release = acquire(name);
      editor[action]();
      return release;
    };
    editor.start("line");
    assert.equal(editor.getState().phase, "idle");
    assert.equal(owner(), null);
    editor.destroy();
    editor.destroy();
    const remounted = createDrawingSession(host, {
      createFeature: () => ({ id: "remount", properties: {} }),
      submit: () => ({ accepted: true }),
    });
    host.acquireInteraction = acquire;
    remounted.start("line");
    assert.equal(owner(), "drawing");
    remounted.destroy();
    assert.equal(owner(), null);
  });
}

for (const action of ["cancel", "replace", "destroy"] as const) {
  for (const operation of ["vertex", "style", "finish"] as const) {
    test(`Initial ${operation} permission cannot ${action} and redirect the original action`, async () => {
      let armed = false, nextId = 0;
      const { editor, host, requests } = fixture({
        createFeature: () => ({ id: `owned-${++nextId}`, properties: {} }),
        canEdit: () => {
          if (armed) {
            armed = false;
            if (action === "destroy") editor.destroy();
            else {
              editor.cancel();
              if (action === "replace") line(editor);
            }
          }
          return true;
        },
      });
      line(editor);
      armed = true;
      if (operation === "finish") await assert.rejects(editor.finish());
      else assert.throws(() => operation === "vertex" ? editor.moveVertex(0, [5, 5]) : editor.setStyle({ label: "obsolete" }));
      assert.equal(requests.length, 0);
      assert.equal(host.getFeature("owned-1"), undefined);
      if (action === "replace") {
        assert.deepEqual(editor.getState().draft?.shape, { kind: "line", vertices: [[0, 0], [0.01, 0]] });
        assert.equal(editor.getState().draft?.style.label, "");
      } else assert.equal(editor.getState().phase, "idle");
      editor.destroy();
    });
  }
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

test("Small circle areas use the stable spherical result", () => {
  for (const radius of [0.06, 0.07]) {
    const shape: DrawingShape = { kind: "circle", center: [0, 0], radius };
    const expected = Math.PI * radius ** 2 *
      (1 - radius ** 2 / (12 * 6_371_008.8 ** 2));
    assert.ok(Math.abs(measurements(shape).area! - expected) < expected * 1e-10);
  }
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

test("Drawing snapshots coordinates at every point mutation", async () => {
  const { editor, requests } = fixture();
  const first: DrawingPosition = [0, 0], second: DrawingPosition = [1, 0];
  editor.start("line");
  editor.addPoint(first);
  editor.addPoint(second);
  first[0] = 50;
  second[0] = 50;
  const inserted: DrawingPosition = [0.5, 0];
  editor.insertVertex(0, inserted);
  inserted[0] = 60;
  const moved: DrawingPosition = [2, 0];
  editor.moveVertex(2, moved);
  moved[0] = 70;
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [0.5, 0], [2, 0]],
  });
  editor.undo();
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [0.5, 0], [1, 0]],
  });
  editor.redo();
  assert.equal(await editor.finish(), true);
  assert.deepEqual(requests[0]?.after?.geometry, {
    type: "LineString", coordinates: [[0, 0], [0.5, 0], [2, 0]],
  });
});

test("History keeps only the last 100 completed changes, including gestures and redo", () => {
  const { editor } = fixture();
  line(editor);
  for (let i = 1; i <= 120; i++) {
    editor.beginGesture();
    editor.moveVertex(1, [i / 100, 0]);
    editor.endGesture();
  }
  for (let i = 0; i < 100; i++) editor.undo();
  assert.equal(editor.getState().canUndo, false);
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [0.2, 0]],
  });
  for (let i = 0; i < 100; i++) editor.redo();
  assert.equal(editor.getState().canRedo, false);
  editor.undo();
  editor.setStyle({ label: "Later" });
  assert.equal(editor.getState().canRedo, false);
});

test("Ordinary edits independently retain only the last 100 draft actions", () => {
  const { editor } = fixture();
  line(editor);
  for (let i = 1; i <= 120; i++) editor.setStyle({ label: `Edit ${i}` });
  for (let i = 120; i > 20; i--) {
    assert.equal(editor.getState().canUndo, true);
    assert.equal(editor.getState().draft?.style.label, `Edit ${i}`);
    editor.undo();
  }
  assert.equal(editor.getState().canUndo, false);
  assert.equal(editor.getState().draft?.style.label, "Edit 20");
  for (let i = 0; i < 100; i++) editor.redo();
  assert.equal(editor.getState().canRedo, false);
  assert.equal(editor.getState().draft?.style.label, "Edit 120");
});

test("Undo during a gesture settles that gesture before later edits", () => {
  const { editor } = fixture();
  line(editor);
  editor.beginGesture();
  editor.moveVertex(1, [2, 0]);
  editor.undo();
  editor.moveVertex(1, [3, 0]); // A late drag event before pointer release.
  editor.endGesture();
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [0.01, 0]],
  });
  editor.addPoint([4, 0]);
  editor.moveVertex(1, [5, 0]);
  editor.undo();
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [0.01, 0], [4, 0]],
  });
  editor.undo();
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [0.01, 0]],
  });
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

test("A failing drawing observer cannot block another observer or submission cleanup", async () => {
  const { editor, host, owner, diagnostics } = fixture();
  editor.onChange(() => { throw new Error("observer failed"); });
  let healthy = 0;
  editor.onChange(() => { healthy++; });
  line(editor);
  assert.equal(await editor.finish(), true);
  assert.equal(owner(), null);
  assert.equal(host.getFeature("new")?.geometry.type, "LineString");
  assert.ok(healthy >= 4);
  assert.ok(diagnostics.some(error =>
    error.code === "CALLBACK_FAILED" &&
    error.context.operation === "drawing.onChange" &&
    error.cause instanceof Error && error.cause.message === "observer failed"));
});

test("A rejected submission cannot clear a newer request started in its notification", async () => {
  const decisions: ((value: DrawingDecision) => void)[] = [];
  const { editor, host } = fixture({
    submit: () => new Promise(resolve => { decisions.push(resolve); }),
  });
  line(editor);
  let restarted: Promise<boolean> | undefined;
  editor.onChange(() => {
    if (editor.getState().phase === "rejected" && !restarted) {
      editor.setStyle({ label: "Again" });
      restarted = editor.finish();
    }
  });
  const first = editor.finish();
  decisions[0]!({ accepted: false, reason: "Try again" });
  assert.equal(await first, false);
  assert.equal(editor.getState().phase, "pending");
  decisions[1]!({ accepted: true });
  assert.equal(await restarted, true);
  assert.equal(host.getFeature("new")?.drawing?.style.label, "Again");
});

test("An accepted submission cannot clear a newer request started in its notification", async () => {
  const decisions: ((value: DrawingDecision) => void)[] = [];
  let nextId = 0;
  const { editor, host } = fixture({
    createFeature: () => ({ id: `new-${++nextId}`, properties: {} }),
    submit: () => new Promise(resolve => { decisions.push(resolve); }),
  });
  line(editor);
  let restarted: Promise<boolean> | undefined;
  editor.onChange(() => {
    if (editor.getState().phase === "idle" && !restarted) {
      editor.start("line");
      editor.addPoint([10, 0]);
      editor.addPoint([11, 0]);
      restarted = editor.finish();
    }
  });
  const first = editor.finish();
  decisions[0]!({ accepted: true });
  assert.equal(await first, true);
  assert.equal(editor.getState().phase, "pending");
  decisions[1]!({ accepted: true });
  assert.equal(await restarted, true);
  assert.ok(host.getFeature("new-1"));
  assert.ok(host.getFeature("new-2"));
});

test("Editing properties with BigInt and cycles retains them through history and acceptance", async () => {
  const { editor, host, requests } = fixture();
  const properties: Properties = { amount: 12n };
  properties.self = properties;
  const before = feature({ kind: "line", vertices: [[0, 0], [1, 0]] });
  before.properties = properties;
  host.upsert([before]);
  editor.edit(before.id);
  editor.moveVertex(1, [2, 0]);
  editor.undo();
  editor.redo();
  assert.equal(await editor.finish(), true);
  assert.equal(requests[0]?.after?.properties.amount, 12n);
  assert.equal(requests[0]?.after?.properties.self, requests[0]?.after?.properties);
  assert.deepEqual(host.getFeature(before.id)?.geometry, {
    type: "LineString", coordinates: [[0, 0], [2, 0]],
  });
});

test("Edited geometry drops an imported bounding box that no longer contains it", async () => {
  const { editor, host, requests } = fixture();
  const before: MapFeature = {
    type: "Feature", id: "bounded", properties: {},
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    bbox: [0, 0, 1, 1],
  };
  host.upsert([before]);
  editor.edit(before.id);
  editor.moveVertex(1, [2, 2]);
  assert.equal(await editor.finish(), true);
  assert.equal(requests[0]?.after?.bbox, undefined);
  assert.equal(host.getFeature(before.id)?.bbox, undefined);
  assert.deepEqual(host.getFeature(before.id)?.geometry, {
    type: "LineString", coordinates: [[0, 0], [2, 2]],
  });
});

test("Replacement drafts retain their own interaction release", () => {
  const { editor, host, owner } = fixture();
  const original = host.acquireInteraction;
  let replace = false;
  host.acquireInteraction = (name) => {
    const release = original(name);
    return () => {
      release();
      if (replace) {
        replace = false;
        editor.start("line");
      }
    };
  };
  line(editor);
  replace = true;
  editor.cancel();
  assert.equal(owner(), "drawing");
  editor.cancel();
  assert.equal(owner(), null);
  editor.start("line");
  editor.destroy();
  assert.equal(owner(), null);
});

test("A draft opened by accepted datachange survives the prior submission", async () => {
  const { editor, host } = fixture();
  const before = feature({ kind: "line", vertices: [[0, 0], [1, 0]] });
  host.upsert([before]);
  editor.edit(before.id);
  editor.moveVertex(1, [2, 0]);
  let opened = false;
  host.on("datachange", ({ ids }) => {
    if (!opened && ids.includes(before.id)) {
      opened = true;
      editor.edit(before.id);
      editor.moveVertex(1, [3, 0]);
    }
  });
  assert.equal(await editor.finish(), true);
  assert.equal(editor.getState().phase, "editing");
  assert.deepEqual(editor.getState().draft?.shape, {
    kind: "line", vertices: [[0, 0], [3, 0]],
  });
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
for (const action of ["cancel", "destroy", "replace"] as const) {
  test(`Final drawing permission can ${action} without committing the obsolete draft`, async () => {
    let settled = false, acted = false, nextId = 0;
    const { editor, host, owner } = fixture({
      createFeature: () => ({ id: `permission-${++nextId}`, properties: {} }),
      submit: () => { settled = true; return { accepted: true }; },
      canEdit: () => {
        if (settled && !acted) {
          acted = true;
          if (action === "destroy") editor.destroy();
          else {
            editor.cancel();
            if (action === "replace") line(editor);
          }
        }
        return true;
      },
    });
    try {
      line(editor);
      assert.equal(await editor.finish(), false);
      assert.ok(acted);
      assert.equal(host.getFeature("permission-1"), undefined);
      assert.equal(editor.getState().phase, action === "replace" ? "editing" : "idle");
      assert.equal(owner(), action === "replace" ? "drawing" : null);
      if (action === "replace") {
        assert.equal(editor.getState().draft?.feature.id, "permission-2");
        assert.equal(await editor.finish(), true);
        assert.ok(host.getFeature("permission-2"));
      }
    } finally { editor.destroy(); }
  });
}

test("Final permission cannot clear a replacement submission started by that callback", async () => {
  let submissions = 0, replaced = false, nextId = 0;
  let decide: (value: DrawingDecision) => void = () => {};
  let replacement: Promise<boolean> | undefined;
  const { editor, host } = fixture({
    createFeature: () => ({ id: `replacement-${++nextId}`, properties: {} }),
    submit: () => {
      if (++submissions === 1) return { accepted: true };
      return new Promise(resolve => { decide = resolve; });
    },
    canEdit: () => {
      if (submissions === 1 && !replaced) {
        replaced = true;
        editor.cancel();
        line(editor);
        replacement = editor.finish();
      }
      return true;
    },
  });
  try {
    line(editor);
    assert.equal(await editor.finish(), false);
    assert.equal(editor.getState().phase, "pending");
    assert.equal(host.getFeature("replacement-1"), undefined);
    decide({ accepted: true });
    assert.equal(await replacement, true);
    assert.ok(host.getFeature("replacement-2"));
    assert.equal(editor.getState().phase, "idle");
  } finally { editor.destroy(); }
});

for (const operation of ["update", "delete"] as const) {
  test(`External update inside final ${operation} permission preserves the newer feature`, async () => {
    let settled = false, updated = false, signal: AbortSignal | undefined;
    const before = feature({ kind: "line", vertices: [[0, 0], [1, 0]] });
    const newer = feature({ kind: "line", vertices: [[0, 0], [3, 0]] });
    newer.properties.revision = 2;
    const { editor, host } = fixture({
      submit: (_change, currentSignal) => {
        signal = currentSignal;
        settled = true;
        return { accepted: true };
      },
      canEdit: () => {
        if (settled && !updated) { updated = true; host.upsert([newer]); }
        return true;
      },
    });
    try {
      host.upsert([before]);
      editor.edit(before.id);
      editor.moveVertex(1, [2, 0]);
      assert.equal(await (operation === "update" ? editor.finish() : editor.delete()), false);
      assert.ok(updated && signal?.aborted);
      assert.deepEqual(host.getFeature(before.id), newer);
      assert.equal(editor.getState().phase, "conflict");
    } finally { editor.destroy(); }
  });
}

test("Final permission cannot commit geometry or style changed inside that callback", async () => {
  for (const field of ["shape", "style"] as const) {
    let settled = false, changed = false;
    const { editor, host } = fixture({
      submit: () => { settled = true; return { accepted: true }; },
      canEdit: () => {
        if (settled && !changed) {
          changed = true;
          if (field === "shape") editor.moveVertex(1, [3, 0]);
          else editor.setStyle({ label: "New draft" });
        }
        return true;
      },
    });
    try {
      line(editor);
      assert.equal(await editor.finish(), false);
      assert.equal(host.getFeature("new"), undefined);
      assert.equal(editor.getState().phase, "editing");
      if (field === "shape") assert.deepEqual(editor.getState().draft?.shape, {
        kind: "line", vertices: [[0, 0], [3, 0]],
      });
      else assert.equal(editor.getState().draft?.style.label, "New draft");
      assert.equal(await editor.finish(), true);
    } finally { editor.destroy(); }
  }
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
  editor.setCursor([0.01, 0]);
  assert.equal(previews, 1, "An unchanged cursor must not schedule another preview update");
  const preview = editor.getPreview()!;
  if ("vertices" in preview) preview.vertices[1]![0] = 99;
  assert.deepEqual(editor.getPreview(), { kind: "line", vertices: [[0, 0], [0.01, 0]] });
  editor.setStyle({ label: "Updated" });
  assert.equal(changes, 1);
  assert.equal(previews, 2);
  assert.deepEqual(editor.getPreview(), editor.getState().draft?.shape);
  editor.setCursor([0.01, 0]);
  assert.equal(previews, 3, "The same position must restore a cursor cleared by a draft change");
  assert.deepEqual(editor.getPreview(), { kind: "line", vertices: [[0, 0], [0.01, 0]] });
  offChange(); offPreview();
  editor.destroy();
});

test("Throwing session listeners do not block preview updates or accepted submission cleanup", async () => {
  let decide: (value: DrawingDecision) => void = () => {};
  const { editor, host, owner, diagnostics } = fixture({
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
  assert.ok(diagnostics.some(error =>
    error.code === "CALLBACK_FAILED" &&
    error.context.operation === "drawing.onPreview" &&
    error.cause instanceof Error && error.cause.message === "Consumer preview listener failed"));
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


test("Permission exceptions retain geometry and history and differ from explicit denial", () => {
  let mode: "allow" | "deny" | "throw" = "allow";
  const cause = new Error("Permission service failed");
  const { editor, diagnostics, host } = fixture({ canEdit: () => {
    if (mode === "throw") throw cause;
    return mode === "allow";
  } });
  line(editor);
  editor.setStyle({ label: "Preserved" });
  editor.beginGesture(); editor.moveVertex(1, [0.02, 0]);
  const retained = editor.getState().draft;
  mode = "throw"; editor.refreshPermissions();
  assert.equal(editor.getState().phase, "forbidden");
  assert.match(editor.getState().message!, /could not be checked/);
  assert.deepEqual(editor.getState().draft, retained);
  assert.throws(() => editor.moveVertex(1, [0.03, 0]), /cannot be edited/);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.cause, cause);
  assert.deepEqual(diagnostics[0]?.context, { operation: "drawing.canEdit", recoverable: true, featureId: "new" });
  editor.endGesture();
  mode = "deny"; editor.refreshPermissions();
  assert.match(editor.getState().message!, /permission removed/);
  assert.equal(diagnostics.length, 1);
  mode = "allow"; editor.refreshPermissions();
  assert.equal(editor.getState().phase, "editing");
  editor.undo();
  assert.deepEqual(editor.getState().draft?.shape, { kind: "line", vertices: [[0, 0], [0.01, 0]] });
  assert.equal(editor.getState().draft?.style.label, "Preserved");
  editor.redo(); assert.deepEqual(editor.getState().draft, retained);
  editor.cancel(); assert.equal(host.getFeature("new"), undefined);
});

for (const operation of ["create", "update", "delete"] as const) {
  test(`Failed pending ${operation} permission stays locked through repair and ignores late acceptance`, async () => {
    let failed = false, signal: AbortSignal | undefined;
    let decide: (value: DrawingDecision) => void = () => {};
    const cause = new Error("Pending permission check failed");
    const { editor, host, diagnostics } = fixture({
      canEdit: (_feature, kind) => { if (failed && kind === operation) throw cause; return true; },
      submit: (_change, currentSignal) => { signal = currentSignal; return new Promise(resolve => { decide = resolve; }); },
    });
    const original = feature({ kind: "line", vertices: [[0, 0], [0.01, 0]] });
    if (operation === "create") line(editor);
    else { host.upsert([original]); editor.edit(original.id); editor.moveVertex(1, [0.02, 0]); }
    const retained = editor.getState().draft;
    const request = operation === "delete" ? editor.delete() : editor.finish();
    failed = true; editor.refreshPermissions();
    assert.equal(signal?.aborted, true);
    assert.equal(editor.getState().phase, "pending");
    assert.match(editor.getState().message!, /could not be checked/);
    assert.throws(() => editor.cancel(), /Wait/);
    assert.throws(() => editor.undo(), /cannot be edited/);
    await assert.rejects(editor.finish(), /cannot be edited/);
    failed = false; editor.refreshPermissions();
    assert.equal(editor.getState().phase, "pending");
    assert.throws(() => editor.cancel(), /Wait/);
    decide({ accepted: true });
    assert.equal(await request, false);
    assert.deepEqual(editor.getState().draft, retained);
    assert.deepEqual(host.getFeature(original.id), operation === "create" ? undefined : original);
    assert.equal(diagnostics[0]?.cause, cause);
    editor.refreshPermissions();
    assert.equal(editor.getState().phase, "editing");
    if (operation !== "create") { editor.undo(); assert.deepEqual(editor.getState().draft?.shape, original.drawing?.shape); }
    editor.cancel();
  });
}

test("Permission reports have one fixed cooldown across operations, recovery and replacement", (t) => {
  let now = 100_000, failed = false, nextId = 0;
  t.mock.method(Date, "now", () => now);
  const { editor, host, diagnostics } = fixture({
    createFeature: () => ({ id: `bounded-${++nextId}`, properties: {} }),
    canEdit: () => { if (failed) throw new Error("Unavailable"); return true; },
  });
  line(editor); failed = true;
  for (let i = 0; i < 100; i++) { editor.refreshPermissions(); editor.getState(); editor.getPreview(); }
  assert.equal(diagnostics.length, 1);
  failed = false; editor.refreshPermissions(); editor.cancel();
  host.upsert([feature({ kind: "point", position: [0, 0] })]); editor.edit("existing");
  failed = true; editor.refreshPermissions(); editor.canDelete();
  assert.equal(diagnostics.length, 1);
  now += 9_999; editor.refreshPermissions(); assert.equal(diagnostics.length, 1);
  now++; editor.canDelete(); assert.equal(diagnostics.length, 2);
  editor.destroy();
});

for (const action of ["cancel", "destroy", "replace", "repair", "conflict"] as const) {
  test(`Permission diagnostic can ${action} without mutating obsolete work`, () => {
    let failed = false, nextId = 0;
    const { editor, host, owner } = fixture({
      createFeature: () => ({ id: `observer-${++nextId}`, properties: {} }),
      canEdit: () => { if (failed) throw new Error("Observer permission failure"); return true; },
    });
    if (action === "conflict") {
      host.upsert([feature({ kind: "line", vertices: [[0, 0], [1, 0]] })]); editor.edit("existing");
    } else line(editor);
    let reports = 0;
    host.reportCallbackError = () => {
      reports++;
      editor.getState(); editor.getPreview(); editor.refreshPermissions();
      if (action === "destroy") editor.destroy();
      else if (action === "repair") { failed = false; editor.refreshPermissions(); }
      else if (action === "conflict") host.upsert([feature({ kind: "line", vertices: [[0, 0], [2, 0]] })]);
      else {
        editor.cancel();
        if (action === "replace") { failed = false; line(editor); }
      }
    };
    failed = true;
    assert.throws(() => editor.moveVertex(1, [3, 0]), /cannot be edited/);
    assert.equal(reports, 1);
    const state = editor.getState();
    assert.equal(state.phase, action === "replace" || action === "repair" ? "editing" : action === "conflict" ? "conflict" : "idle");
    if (action === "replace") {
      assert.equal(state.draft?.feature.id, "observer-2");
      assert.deepEqual(state.draft?.shape, { kind: "line", vertices: [[0, 0], [0.01, 0]] });
    }
    assert.equal(owner(), action === "cancel" || action === "destroy" ? null : "drawing");
    editor.destroy();
  });
}

test("A delete permission exception reports feedback while permitted update edits remain available", () => {
  const { editor, host, diagnostics } = fixture({ canEdit: (_feature, kind) => {
    if (kind === "delete") throw new Error("Delete permission unavailable");
    return true;
  } });
  host.upsert([feature({ kind: "point", position: [0, 0] })]); editor.edit("existing");
  editor.onChange(() => { editor.getState(); });
  assert.equal(editor.canDelete(), false);
  assert.equal(editor.getState().phase, "rejected");
  assert.match(editor.getState().message!, /could not be checked/);
  editor.setStyle({ label: "Update permitted" });
  assert.equal(editor.getState().draft?.style.label, "Update permitted");
  assert.equal(diagnostics.length, 1);
  editor.destroy();
});

for (const action of ["cancel", "destroy", "replace", "repair"] as const) {
  test(`Final permission failure diagnostic can ${action} without applying or clearing an obsolete save`, async () => {
    let failed = false, nextId = 0, calls = 0;
    const decisions: ((value: DrawingDecision) => void)[] = [];
    const signals: AbortSignal[] = [];
    const { editor, host, diagnostics } = fixture({
      createFeature: () => ({ id: `final-failure-${++nextId}`, properties: {} }),
      canEdit: () => { if (failed) throw new Error("Final permission failed"); return true; },
      submit: (_change, signal) => { calls++; signals.push(signal); return new Promise(resolve => { decisions.push(resolve); }); },
    });
    const report = host.reportCallbackError;
    let replacement: Promise<boolean> | undefined;
    host.reportCallbackError = (cause, operation, featureId) => {
      report(cause, operation, featureId);
      if (action === "destroy") editor.destroy();
      else if (action === "repair") { failed = false; editor.refreshPermissions(); }
      else {
        editor.cancel();
        if (action === "replace") { failed = false; line(editor); replacement = editor.finish(); }
      }
    };
    line(editor);
    const request = editor.finish();
    failed = true; decisions[0]!({ accepted: true });
    assert.equal(await request, false);
    assert.equal(host.getFeature("final-failure-1"), undefined);
    assert.equal(signals[0]?.aborted, true);
    assert.equal(diagnostics.length, 1);
    if (action === "replace") {
      assert.equal(calls, 2);
      assert.equal(editor.getState().phase, "pending");
      decisions[1]!({ accepted: true });
      assert.equal(await replacement, true);
      assert.ok(host.getFeature("final-failure-2"));
    } else {
      assert.equal(editor.getState().phase, action === "repair" ? "rejected" : "idle");
      if (action === "repair") editor.moveVertex(1, [0.02, 0]);
    }
    editor.destroy();
  });
}


test("A state read cannot cache failed old permission against an unread replacement draft", () => {
  let failed = false, nextId = 0;
  const { editor, host, diagnostics } = fixture({
    createFeature: () => ({ id: `unread-replacement-${++nextId}`, properties: {} }),
    canEdit: () => { if (failed) throw new Error("Replace without reading"); return true; },
  });
  host.upsert([feature({ kind: "line", vertices: [[0, 0], [0.01, 0]] })]); editor.edit("existing");
  const report = host.reportCallbackError;
  host.reportCallbackError = (cause, operation, featureId) => {
    report(cause, operation, featureId);
    editor.cancel(); editor.start("line");
  };
  failed = true;
  const state = editor.getState();
  assert.equal(state.phase, "editing");
  assert.equal(state.draft?.feature.id, "unread-replacement-1");
  assert.equal(state.draft?.placed, 0);
  assert.equal(state.message, undefined);
  assert.deepEqual(editor.getState(), state);
  assert.equal(diagnostics.length, 1);
  editor.destroy();
});

test("An update permission exception does not disable independently permitted deletion", async () => {
  const { editor, host, diagnostics } = fixture({ canEdit: (_feature, operation) => {
    if (operation === "update") throw new Error("Update check failed");
    return true;
  } });
  host.upsert([feature({ kind: "point", position: [0, 0] })]);
  editor.onChange(() => { editor.getState(); editor.canDelete(); });
  editor.edit("existing");
  assert.equal(editor.getState().phase, "forbidden");
  assert.match(editor.getState().message!, /could not be checked/);
  assert.equal(editor.canDelete(), true);
  assert.equal(await editor.delete(), true);
  assert.equal(host.getFeature("existing"), undefined);
  assert.equal(diagnostics.length, 1);
  editor.destroy();
});


for (const action of ["replace", "destroy"] as const) {
  test(`A permission callback that ${action}s its draft before throwing retains the original failure context`, () => {
    let armed = false, nextId = 0;
    const cause = new Error("Old permission callback failed after changing its owner");
    const { editor, host, diagnostics, owner } = fixture({
      createFeature: () => ({ id: `callback-owner-${++nextId}`, properties: {} }),
      canEdit: () => {
        if (armed) {
          armed = false;
          if (action === "destroy") editor.destroy();
          else { editor.cancel(); editor.start("line"); }
          throw cause;
        }
        return true;
      },
    });
    line(editor); armed = true;
    assert.throws(() => editor.moveVertex(1, [0.02, 0]));
    assert.equal(host.getFeature("callback-owner-1"), undefined);
    assert.equal(diagnostics.length, action === "destroy" ? 0 : 1);
    if (action === "replace") {
      assert.equal(diagnostics[0]?.cause, cause);
      assert.equal(diagnostics[0]?.context.featureId, "callback-owner-1");
      assert.equal(diagnostics[0]?.context.operation, "drawing.canEdit");
      assert.equal(editor.getState().phase, "editing");
      assert.equal(editor.getState().draft?.feature.id, "callback-owner-2");
      assert.equal(editor.getState().draft?.placed, 0);
    } else assert.equal(owner(), null);
    editor.destroy();
  });
}

for (const observer of [false, true]) for (const action of ['read', 'refresh'] as const) {
  test(`Permission callback ${action} is bounded with observer ${observer}`, () => {
    let check = () => {}, depth = 0, maxDepth = 0;
    const { editor, diagnostics } = fixture({ canEdit: () => {
      depth++; maxDepth = Math.max(maxDepth, depth);
      try {
        if (depth > 12) throw new Error('Recursive permission check');
        check(); return true;
      } finally { depth--; }
    } });
    line(editor);
    if (observer) editor.onChange(() => { editor.getState(); });
    check = () => { if (action === 'read') { editor.getState(); editor.getPreview(); } else editor.refreshPermissions(); };
    editor.refreshPermissions();
    assert.equal(editor.getState().phase, 'editing');
    assert.equal(maxDepth, 1);
    assert.equal(diagnostics.length, 0);
    check = () => {};
    editor.moveVertex(1, [.02, 0]);
    assert.deepEqual(editor.getState().draft?.shape, { kind: 'line', vertices: [[0, 0], [.02, 0]] });
    editor.destroy();
  });
}

test('One refresh clears recovered delete feedback for state-before-button readers', () => {
  let failed = true;
  const { editor, host } = fixture({ canEdit: (_feature, kind) => {
    if (failed && kind === 'delete') throw new Error('Delete check unavailable');
    return true;
  } });
  host.upsert([feature({ kind: 'point', position: [0, 0] })]); editor.edit('existing');
  const messages: (string | undefined)[] = [];
  editor.onChange(() => { messages.push(editor.getState().message); editor.canDelete(); });
  assert.equal(editor.canDelete(), false);
  assert.match(editor.getState().message!, /could not be checked/);
  failed = false; editor.refreshPermissions();
  assert.equal(editor.getState().phase, 'editing');
  assert.equal(editor.getState().message, undefined);
  assert.equal(messages.at(-1), undefined);
  editor.destroy();
});

test('Delete permission failure and repair retain the consumer rejection until a correction', async () => {
  let failed = false;
  const { editor, host } = fixture({
    canEdit: (_feature, operation) => { if (failed && operation === 'delete') throw new Error('Delete temporarily unavailable'); return true; },
    submit: () => ({ accepted: false, reason: 'Application requires a corrected route' }),
  });
  host.upsert([feature({ kind: 'line', vertices: [[0, 0], [.01, 0]] })]); editor.edit('existing');
  assert.equal(await editor.finish(), false);
  failed = true; assert.equal(editor.canDelete(), false);
  assert.match(editor.getState().message!, /could not be checked/);
  failed = false; editor.canDelete();
  assert.equal(editor.getState().phase, 'rejected');
  assert.equal(editor.getState().message, 'Application requires a corrected route');
  editor.moveVertex(1, [.02, 0]); assert.equal(editor.getState().phase, 'editing');
  editor.destroy();
});

for (const operation of ['create', 'update', 'delete'] as const) {
  test(`Abort-aware ${operation} rejection retains permission failure after pending repair`, async () => {
    let failed = false;
    const cause = new Error('Permission check failed before abort rejection');
    const { editor, host, diagnostics } = fixture({
      canEdit: (_feature, kind) => { if (failed && kind === operation) throw cause; return true; },
      submit: (_change, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Remote request aborted', 'AbortError')), { once: true });
      }),
    });
    if (operation === 'create') line(editor);
    else { host.upsert([feature({ kind: 'line', vertices: [[0, 0], [.01, 0]] })]); editor.edit('existing'); }
    const retained = editor.getState().draft;
    const request = operation === 'delete' ? editor.delete() : editor.finish();
    failed = true; editor.refreshPermissions();
    failed = false; editor.refreshPermissions();
    assert.equal(editor.getState().phase, 'pending');
    assert.equal(await request, false);
    assert.equal(editor.getState().phase, 'rejected');
    assert.match(editor.getState().message!, /could not be checked/);
    assert.deepEqual(editor.getState().draft, retained);
    assert.equal(diagnostics[0]?.cause, cause);
    editor.refreshPermissions(); assert.equal(editor.getState().phase, 'editing');
    editor.cancel();
  });
}
