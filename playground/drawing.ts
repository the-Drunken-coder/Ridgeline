import {
  attachDrawing,
  attachDrawingControls,
  shapeGeometry,
} from "@ridgeline/map";
import type {
  DrawingChange,
  DrawingShape,
  MapFeature,
  Viewport,
} from "@ridgeline/map";
import type { Sample } from "./samples";

/** Example consumer owns accepted history; the drawing library only owns draft history. */
export function mountDrawingDemo(
  viewport: Viewport<Sample>,
  tools: HTMLElement,
  inspector: HTMLElement,
) {
  const past: DrawingChange<Sample>[] = [],
    future: DrawingChange<Sample>[] = [];
  let applying = false,
    expected: DrawingChange<Sample> | undefined;
  function id(change: DrawingChange<Sample>) {
    return (change.after ?? change.before)!.id;
  }
  function same(
    a: MapFeature<Sample> | undefined,
    b: MapFeature<Sample> | undefined,
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function apply(feature: MapFeature<Sample> | undefined, featureId: string) {
    applying = true;
    try {
      if (feature) viewport.upsert([feature]);
      else viewport.remove([featureId]);
    } finally {
      applying = false;
    }
  }
  function travel(
    source: DrawingChange<Sample>[],
    target: DrawingChange<Sample>[],
    undo: boolean,
  ) {
    const change = source.at(-1);
    if (!change) return;
    const current = viewport.getFeature(id(change)),
      wanted = undo ? change.after : change.before;
    if (!same(current, wanted)) {
      source.pop();
      return;
    }
    source.pop();
    apply(undo ? change.before : change.after, id(change));
    target.push(change);
  }
  const editor = attachDrawing(viewport, {
    createFeature: (geometry) => ({
      type: "Feature",
      id: crypto.randomUUID(),
      geometry,
      properties: { name: "Drawing", kind: "Drawing", color: "#b15624" },
    }),
    submit: (change) => {
      if (!same(viewport.getFeature(id(change)), change.before))
        return {
          accepted: false,
          reason: "The source feature changed. Restart the edit.",
        };
      // This demo accepts synchronously. A real consumer would persist against before here.
      expected = structuredClone(change);
      return { accepted: true };
    },
  });
  const off = viewport.on("datachange", ({ ids, removed }) => {
    if (applying) return;
    const changed = new Set([...ids, ...removed]);
    if (
      expected &&
      changed.has(id(expected)) &&
      same(viewport.getFeature(id(expected)), expected.after)
    ) {
      past.push(expected);
      future.length = 0;
      changed.delete(id(expected));
      viewport.setSelection(expected.after ? [id(expected)] : []);
      expected = undefined;
    }
    for (const stack of [past, future])
      for (let i = stack.length - 1; i >= 0; i--)
        if (changed.has(id(stack[i]!))) stack.splice(i, 1);
  });
  const history = {
    undo: () => travel(past, future, true),
    redo: () => travel(future, past, false),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
  const controls = attachDrawingControls(viewport, editor, {
    tools,
    inspector,
    history,
  });
  const keydown = (event: KeyboardEvent) => {
    if (
      editor.getState().draft ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
      controls.refresh();
    }
  };
  viewport.container.addEventListener("keydown", keydown);
  return {
    editor,
    destroy() {
      viewport.container.removeEventListener("keydown", keydown);
      controls.destroy();
      editor.destroy();
      off();
    },
  };
}
export function drawingFeatures(): MapFeature<Sample>[] {
  const items: { name: string; shape: DrawingShape; color: string }[] = [
    {
      name: "Survey area",
      shape: {
        kind: "polygon",
        vertices: [
          [6.864, 45.924],
          [6.879, 45.931],
          [6.894, 45.925],
          [6.878, 45.917],
        ],
      },
      color: "#b15624",
    },
    {
      name: "Approach",
      shape: {
        kind: "arrow",
        vertices: [
          [6.843, 45.914],
          [6.851, 45.919],
          [6.861, 45.921],
        ],
      },
      color: "#32624c",
    },
    {
      name: "Assembly",
      shape: { kind: "circle", center: [6.897, 45.935], radius: 350 },
      color: "#355f93",
    },
  ];
  return items.map((item, i) => ({
    type: "Feature",
    id: `drawing-${i}`,
    geometry: shapeGeometry(item.shape),
    properties: { name: item.name, kind: "Drawing", color: item.color },
    drawing: {
      version: 1,
      shape: item.shape,
      style: {
        color: item.color,
        fillColor: item.color,
        lineWidth: 3,
        fillOpacity: 0.18,
        dashed: false,
        label: item.name,
      },
    },
  }));
}
