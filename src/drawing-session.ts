import { validateFeature } from "./features";
import type { MapFeature, Properties, Viewport, ViewportEvents } from "./types";
import type {
  DrawingChange,
  DrawingDraft,
  DrawingOptions,
  DrawingPosition,
  DrawingShape,
  DrawingState,
  DrawingStyle,
  DrawingTool,
} from "./drawing-types";
import {
  bearing,
  DEFAULT_DRAWING_STYLE,
  destination,
  distance,
  measurements,
  position,
  shapeGeometry,
  sizeFromPoint,
  translateShape,
  validateDrawingStyle,
  validateShape,
} from "./drawing-geometry";

type DrawingHost<P extends Properties> = Pick<
  Viewport<P>,
  "getFeature" | "getStyle" | "upsert" | "remove" | "acquireInteraction"
> & {
  on(
    event: "datachange",
    listener: (change: ViewportEvents<P>["datachange"]) => void,
  ): () => void;
};
export const DRAWING_TOOLS: readonly DrawingTool[] = [
  "line",
  "polygon",
  "rectangle",
  "circle",
  "arrow",
];

/** Draft state and consumer acceptance, independent of controls and the renderer. */
export function createDrawingSession<P extends Properties>(
  host: DrawingHost<P>,
  options: DrawingOptions<P>,
) {
  let draft: DrawingDraft<P> | undefined;
  let past: DrawingDraft<P>[] = [],
    future: DrawingDraft<P>[] = [];
  let conflict = false,
    pending = false,
    disposed = false,
    applying = false;
  let reason: string | undefined, release: (() => void) | undefined;
  let submission: {
    controller: AbortController;
    kind: DrawingChange<P>["kind"];
  } | undefined;
  let initialStyle: DrawingStyle | undefined;
  let snapshot: DrawingState<P> | undefined;
  let gesture: DrawingDraft<P> | undefined;
  const listeners = new Set<() => void>();
  const tools = [...(options.tools ?? DRAWING_TOOLS)];
  const styleFields =
    options.styleFields ??
    (Object.keys(DEFAULT_DRAWING_STYLE) as (keyof DrawingStyle)[]);
  function allowed(
    operation: DrawingChange<P>["kind"] = draft?.before ? "update" : "create",
  ) {
    if (!draft) return false;
    if (!draft.before && !draft.placed) return true;
    try {
      return (
        options.canEdit?.(
          structuredClone(draft.before ?? { ...draft.feature, geometry: shapeGeometry(draft.shape) }),
          operation,
        ) ?? true
      );
    } catch {
      return false;
    }
  }
  function phase(editable: boolean): DrawingState<P>["phase"] {
    return !draft
      ? "idle"
      : pending
        ? "pending"
        : conflict
          ? "conflict"
          : !editable
            ? "forbidden"
            : reason
              ? "rejected"
              : "editing";
  }
  function getState(): DrawingState<P> {
    if (snapshot) return structuredClone(snapshot);
    const editable = allowed(), currentPhase = phase(editable);
    snapshot = {
      phase: currentPhase,
      draft,
      message:
        currentPhase === "conflict"
          ? "This feature changed. Discard or restart with the latest feature."
          : currentPhase === "forbidden"
            ? "Editing permission removed. Your draft is preserved."
            : reason,
      validation: draft
        ? !draft.before && !draft.placed
          ? "Click the map to place the drawing."
          : (validateShape(draft.shape) ?? validateDrawingStyle(draft.style))
        : undefined,
      canUndo: !pending && !conflict && editable && past.length > 0,
      canRedo: !pending && !conflict && editable && future.length > 0,
      measurements: draft ? measurements(draft.shape) : { length: 0 },
    };
    return structuredClone(snapshot);
  }
  function notify() {
    snapshot = undefined;
    for (const listener of listeners) listener();
  }
  function requireDraft(operation?: DrawingChange<P>["kind"]) {
    if (disposed) throw new Error("Drawing session has been destroyed.");
    if (!draft || pending || conflict || !allowed(operation))
      throw new Error("This draft cannot be edited now.");
    return draft;
  }
  function change(update: (current: DrawingDraft<P>) => void) {
    const current = requireDraft(),
      before = structuredClone(current);
    update(current);
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    if (!gesture) {
      past.push(before);
      if (past.length > 100) past.shift();
    }
    future = [];
    reason = undefined;
    notify();
  }
  function open(next: DrawingDraft<P>) {
    if (disposed) throw new Error("Drawing session has been destroyed.");
    if (draft) throw new Error("Finish or cancel the current drawing first.");
    release = host.acquireInteraction("drawing");
    draft = next;
    initialStyle = structuredClone(next.style);
    past = [];
    future = [];
    conflict = false;
    reason = undefined;
    notify();
  }
  function cancel() {
    if (pending)
      throw new Error("Wait for the application to decide before cancelling.");
    draft = undefined;
    initialStyle = undefined;
    past = [];
    future = [];
    gesture = undefined;
    conflict = false;
    reason = undefined;
    release?.();
    release = undefined;
    notify();
  }
  function start(tool: DrawingTool) {
    if (!tools.includes(tool))
      throw new Error("This drawing tool is not enabled.");
    const { id, properties } = options.createFeature();
    const feature: MapFeature<P> = structuredClone({
      type: "Feature", id, properties,
      geometry: { type: "Point", coordinates: [0, 0] },
    });
    validateFeature(feature);
    if (host.getFeature(feature.id))
      throw new Error("A new drawing needs an unused feature ID.");
    const shape: DrawingShape =
      tool === "circle"
        ? { kind: tool, center: [0, 0], radius: 0 }
        : tool === "rectangle"
          ? { kind: tool, center: [0, 0], width: 0, height: 0, bearing: 0 }
          : { kind: tool, vertices: [] };
    const style = { ...DEFAULT_DRAWING_STYLE, ...options.defaults };
    const error = validateDrawingStyle(style);
    if (error) throw new Error(error);
    open({ feature, shape, style, placing: true, placed: 0 });
  }
  function edit(id: string) {
    const before = host.getFeature(id);
    if (!before) throw new Error("Feature no longer exists.");
    if (before.entity)
      throw new Error("Entity geometry uses the entity editor.");
    if (
      before.geometry.type === "Polygon" &&
      before.geometry.coordinates.length !== 1
    )
      throw new Error("Editing polygons with holes is not supported.");
    const geometry = before.geometry;
    const shape: DrawingShape =
      before.drawing?.shape ??
      (geometry.type === "Point"
        ? { kind: "point", position: position(geometry.coordinates) }
        : geometry.type === "LineString"
          ? { kind: "line", vertices: geometry.coordinates.map(position) }
          : {
              kind: "polygon",
              vertices: geometry.coordinates[0]!.slice(0, -1).map(position),
            });
    const defaults = { ...DEFAULT_DRAWING_STYLE, ...options.defaults };
    const rendered = host.getStyle(before);
    const style = before.drawing?.style ?? {
      color: rendered.color ?? defaults.color,
      fillColor: rendered.fillColor ?? rendered.color ?? defaults.fillColor,
      lineWidth: rendered.lineWidth ?? defaults.lineWidth,
      fillOpacity: rendered.fillOpacity ?? defaults.fillOpacity,
      dashed: rendered.dashed ?? defaults.dashed,
      label: rendered.label ?? defaults.label,
    };
    open({
      feature: before,
      before: structuredClone(before),
      shape: structuredClone(shape),
      style: structuredClone(style),
      placing: false,
      placed: 2,
    });
  }
  function addPoint(p: DrawingPosition) {
    if (!draft?.placing) return;
    change((current) => {
      const s = current.shape;
      if ("vertices" in s) {
        const last = s.vertices.at(-1);
        if (last && distance(last, p) < 0.001) return;
        s.vertices.push(p);
      } else if (s.kind === "circle" || s.kind === "rectangle") {
        if (!current.placed) s.center = p;
        else {
          current.shape = sizeFromPoint(s, p);
          current.placing = false;
        }
      }
      current.placed++;
    });
  }
  function setShape(shape: DrawingShape) {
    change((current) => {
      if (shape.kind !== current.shape.kind)
        throw new Error("Changing shape kind is not supported.");
      current.shape = structuredClone(shape);
    });
  }
  function setStyle(style: Partial<DrawingStyle>) {
    change((current) => {
      for (const key of Object.keys(style))
        if (!styleFields.includes(key as keyof DrawingStyle))
          throw new Error(
            "This appearance field is controlled by the consumer.",
          );
      const next = { ...current.style, ...style };
      const error = validateDrawingStyle(next);
      if (error) throw new Error(error);
      current.style = next;
    });
  }
  function moveVertex(index: number, p: DrawingPosition) {
    change((current) => {
      const s = current.shape;
      if ("vertices" in s) {
        if (!s.vertices[index]) throw new Error("Unknown vertex.");
        s.vertices[index] = p;
      } else if (s.kind === "point") s.position = p;
      else if (index === 0) s.center = p;
      else if (s.kind === "circle") s.radius = distance(s.center, p);
      else if (index === 1)
        s.width =
          2 *
          Math.abs(
            distance(s.center, p) *
              Math.sin(((bearing(s.center, p) - s.bearing) * Math.PI) / 180),
          );
      else if (index === 2)
        s.height =
          2 *
          Math.abs(
            distance(s.center, p) *
              Math.cos(((bearing(s.center, p) - s.bearing) * Math.PI) / 180),
          );
      else s.bearing = bearing(s.center, p);
    });
  }
  function insertVertex(after: number, p: DrawingPosition) {
    change((current) => {
      if ("vertices" in current.shape)
        current.shape.vertices.splice(after + 1, 0, p);
    });
  }
  function removeVertex(index: number) {
    change((current) => {
      if ("vertices" in current.shape) current.shape.vertices.splice(index, 1);
    });
  }
  function translate(from: DrawingPosition, to: DrawingPosition) {
    change((current) => {
      current.shape = translateShape(current.shape, from, to);
    });
  }
  function reverse() {
    change((current) => {
      if (current.shape.kind === "arrow") current.shape.vertices.reverse();
    });
  }
  function undo() {
    requireDraft();
    const next = past.pop();
    if (next) {
      future.push(structuredClone(draft!));
      draft = next;
      reason = undefined;
      notify();
    }
  }
  function redo() {
    requireDraft();
    const next = future.pop();
    if (next) {
      past.push(structuredClone(draft!));
      draft = next;
      reason = undefined;
      notify();
    }
  }
  function beginGesture() {
    requireDraft();
    gesture = structuredClone(draft);
  }
  function endGesture() {
    if (gesture && draft && JSON.stringify(gesture) !== JSON.stringify(draft)) {
      past.push(gesture);
      future = [];
    }
    gesture = undefined;
    notify();
  }
  async function submit(remove = false) {
    const current = requireDraft(remove ? "delete" : undefined);
    if (remove && !current.before)
      throw new Error("Cancel an unsaved drawing instead.");
    const error = remove
      ? undefined
      : !current.before && !current.placed
        ? "Click the map to place the drawing."
        : (validateShape(current.shape) ?? validateDrawingStyle(current.style));
    if (error) {
      reason = error;
      notify();
      return false;
    }
    const after: MapFeature<P> = {
      ...structuredClone(current.feature),
      geometry: shapeGeometry(current.shape),
    };
    if (
      !current.before || current.before.drawing ||
      JSON.stringify(current.style) !== JSON.stringify(initialStyle)
    )
      after.drawing = {
        version: 1,
        shape: structuredClone(current.shape),
        style: structuredClone(current.style),
      };
    const request: DrawingChange<P> = {
      kind: remove ? "delete" : current.before ? "update" : "create",
      before: current.before && structuredClone(current.before),
      after: remove ? undefined : after,
    };
    pending = true;
    reason = undefined;
    submission = { controller: new AbortController(), kind: request.kind };
    notify();
    try {
      const decision = await options.submit(
        structuredClone(request),
        submission.controller.signal,
      );
      if (disposed) return false;
      pending = false;
      if (conflict || submission.controller.signal.aborted || !allowed(request.kind)) {
        reason ??= "Permission changed while this request was pending. Review the draft and try again.";
        notify();
        return false;
      }
      if (!decision.accepted) {
        reason = decision.reason || "The application rejected this change.";
        notify();
        return false;
      }
      applying = true;
      try {
        if (remove) host.remove([current.feature.id]);
        else host.upsert([after]);
      } finally {
        applying = false;
      }
      cancel();
      return true;
    } catch (error) {
      if (!disposed) {
        pending = false;
        reason =
          error instanceof Error
            ? error.message
            : "The application could not accept the change.";
        notify();
      }
      return false;
    } finally {
      submission = undefined;
    }
  }
  const off = host.on("datachange", ({ ids, removed }) => {
    if (
      !draft ||
      applying ||
      (!ids.includes(draft.feature.id) && !removed.includes(draft.feature.id))
    )
      return;
    conflict = true;
    submission?.controller.abort();
    notify();
  });
  function refreshPermissions() {
    if (draft && submission && !allowed(submission.kind)) {
      submission.controller.abort();
      reason = "Permission changed while this request was pending. Review the draft and try again.";
    }
    notify();
  }
  function restart() {
    if (pending) throw new Error("Submission is pending.");
    const id = draft?.before?.id;
    if (!id || !host.getFeature(id))
      throw new Error(
        "The source feature no longer exists. Discard the draft.",
      );
    cancel();
    edit(id);
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    submission?.controller.abort();
    pending = false;
    cancel();
    off();
    listeners.clear();
  }
  return {
    getState,
    start,
    edit,
    cancel,
    restart,
    addPoint,
    setShape,
    setStyle,
    moveVertex,
    insertVertex,
    removeVertex,
    translate,
    reverse,
    undo,
    redo,
    beginGesture,
    endGesture,
    finish: () => submit(),
    delete: () => submit(true),
    refreshPermissions,
    destroy,
    tools,
    styleFields,
    canDelete: () => !disposed && !pending && !conflict && Boolean(draft?.before) && allowed("delete"),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export type DrawingSession<P extends Properties = Properties> = ReturnType<
  typeof createDrawingSession<P>
>;

/** Handles describe defining parameters, not tessellation points of circles or rectangles. */
export function drawingHandles(
  shape: DrawingShape,
): { position: DrawingPosition; label: string }[] {
  if ("vertices" in shape)
    return shape.vertices.map((position, i) => ({
      position,
      label: `Vertex ${i + 1}`,
    }));
  if (shape.kind === "point")
    return [{ position: shape.position, label: "Position" }];
  if (shape.kind === "circle")
    return [
      { position: shape.center, label: "Center" },
      {
        position: destination(shape.center, shape.radius, 90),
        label: "Radius",
      },
    ];
  return [
    { position: shape.center, label: "Center" },
    {
      position: destination(shape.center, shape.width / 2, shape.bearing + 90),
      label: "Width",
    },
    {
      position: destination(shape.center, shape.height / 2, shape.bearing),
      label: "Height",
    },
    {
      position: destination(
        shape.center,
        shape.height / 2 + Math.max(20, shape.height * 0.2),
        shape.bearing,
      ),
      label: "Bearing",
    },
  ];
}
