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
  DEFAULT_DRAWING_STYLE,
  validateDrawingStyle,
} from "./drawing-geometry";
import {
  emptyShape,
  insertVertex as insertShapeVertex,
  measurements,
  placePoint,
  removeVertex as removeShapeVertex,
  reverseShape,
  shapeFromGeometry,
  shapeGeometry,
  shapeHandles,
  translateShape,
  validateShape,
} from "./drawing-shapes";

type DrawingHost<P extends Properties> = Pick<
  Viewport<P>,
  "getFeature" | "getStyle" | "upsert" | "remove" | "acquireInteraction" | "reportCallbackError"
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
  const permissionFailures = new Set<DrawingChange<P>["kind"]>();
  const permissionResults = new Map<DrawingChange<P>["kind"], boolean>();
  let lastPermissionReport = -Infinity;
  let checkingPermission: DrawingDraft<P> | undefined;
  let refreshAfterPermission = false;
  let refreshingPermission = false;
  let revision = 0;
  const permissionFailureMessage = "Editing permission could not be checked. Your draft is preserved.";
  let initialStyle: DrawingStyle | undefined;
  let snapshot: DrawingState<P> | undefined;
  let gesture: DrawingDraft<P> | undefined;
  let gestureCancelled = false;
  let cursor: DrawingPosition | undefined;
  const listeners = new Set<() => void>();
  const previewListeners = new Set<() => void>();
  function emit(callbacks: Set<() => void>, operation: string) {
    for (const callback of callbacks) {
      try {
        callback();
      } catch (cause) {
        host.reportCallbackError(cause, operation);
      }
    }
  }
  const tools = [...(options.tools ?? DRAWING_TOOLS)];
  const styleFields =
    options.styleFields ??
    (Object.keys(DEFAULT_DRAWING_STYLE) as (keyof DrawingStyle)[]);
  function reportPermissionError(cause: unknown, featureId: string) {
    if (disposed) return;
    const now = Date.now();
    if (now - lastPermissionReport < 10_000) return;
    lastPermissionReport = now;
    host.reportCallbackError(cause, "drawing.canEdit", featureId);
  }
  function allowed(
    operation: DrawingChange<P>["kind"] = draft?.before ? "update" : "create",
  ) {
    const current = draft, checkedRevision = revision;
    if (!current || disposed) return false;
    if (!current.before && !current.placed) return true;
    // A diagnostic observer can read or refresh the session synchronously.
    // Reuse the last result for nested checks, or block an unchecked operation.
    // Defer explicit refresh until this check ends.
    if (checkingPermission === current) return permissionResults.get(operation) ?? false;
    let notifyFailure = false;
    checkingPermission = current;
    try {
      const permitted = options.canEdit?.(
        structuredClone(current.before ?? { ...current.feature, geometry: shapeGeometry(current.shape) }),
        operation,
      ) ?? true;
      if (disposed || draft !== current || revision !== checkedRevision) return false;
      permissionResults.set(operation, permitted);
      notifyFailure = permissionFailures.delete(operation);
      // Nested observer reads may have cached a provisional denial.
      snapshot = undefined;
      if (!permissionFailures.size && !pending && reason === permissionFailureMessage) {
        reason = undefined;
        notifyFailure = true;
      }
      return permitted;
    } catch (cause) {
      if (disposed) return false;
      if (draft !== current || revision !== checkedRevision) {
        // Report the callback that failed, without marking its replacement draft.
        reportPermissionError(cause, current.feature.id);
        return false;
      }
      notifyFailure = !permissionFailures.has(operation);
      permissionResults.set(operation, false);
      permissionFailures.add(operation);
      snapshot = undefined;
      if (submission?.kind === operation) {
        reason = permissionFailureMessage;
        submission.controller.abort();
      }
      if (gesture) {
        if (!sameDraft(gesture, current)) {
          pushPast(gesture);
          future = [];
        }
        gesture = undefined;
        gestureCancelled = true;
      }
      reportPermissionError(cause, current.feature.id);
      return false;
    } finally {
      if (checkingPermission === current) checkingPermission = undefined;
      if (refreshAfterPermission) {
        refreshAfterPermission = false;
        refreshingPermission = true;
        try {
          refreshPermissions();
          // Complete one deferred refresh. Its observer reads must not schedule
          // another refresh or leave a provisional snapshot behind.
          getState();
        } finally {
          refreshingPermission = false;
        }
      }
      // Publish after the observer guard ends. A delete failure must not cache
      // a provisional denial of an independently permitted update operation.
      if (notifyFailure && !disposed && draft === current && revision === checkedRevision) notify();
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
            : reason || permissionFailures.size
              ? "rejected"
              : "editing";
  }
  function getState(): DrawingState<P> {
    if (snapshot) return structuredClone(snapshot);
    const current = draft, checkedRevision = revision;
    const editable = allowed();
    // Observers may already have computed the replacement or refreshed state.
    if (snapshot) return structuredClone(snapshot);
    if (draft !== current || revision !== checkedRevision) return getState();
    const currentPhase = phase(editable);
    const operation = draft?.before ? "update" : "create";
    snapshot = {
      phase: currentPhase,
      draft,
      message:
        currentPhase === "conflict"
          ? "This feature changed. Discard or restart with the latest feature."
          : currentPhase === "forbidden"
            ? permissionFailures.has(operation) ? permissionFailureMessage : "Editing permission removed. Your draft is preserved."
            : permissionFailures.size ? permissionFailureMessage : reason,
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
  function getPreview(): DrawingShape | undefined {
    const state = getState();
    if (!state.draft) return;
    const candidate = { ...state.draft, shape: structuredClone(state.draft.shape) };
    if (
      candidate.placing && cursor &&
      ["editing", "rejected"].includes(state.phase) &&
      ("vertices" in candidate.shape || candidate.placed)
    ) {
      const placed = placePoint(candidate.shape, candidate.placed, cursor);
      if (placed) {
        candidate.shape = placed.shape;
        candidate.placing = placed.placing;
        candidate.placed++;
      }
    }
    if (!candidate.placed || ("vertices" in candidate.shape && !candidate.shape.vertices.length))
      return;
    return candidate.shape;
  }
  function getMeasurements() {
    const shape = getPreview();
    return shape ? measurements(shape) : { length: 0 };
  }
  function setCursor(position: DrawingPosition | undefined) {
    if (disposed) return;
    // This owner also clears the cursor on draft changes, so it owns deduplication.
    if (position?.[0] === cursor?.[0] && position?.[1] === cursor?.[1]) return;
    cursor = position && [...position];
    emit(previewListeners, "drawing.onPreview");
  }
  function notify() {
    revision++;
    cursor = undefined;
    snapshot = undefined;
    emit(listeners, "drawing.onChange");
    emit(previewListeners, "drawing.onPreview");
  }

  function sameDraft(a: DrawingDraft<P>, b: DrawingDraft<P>) {
    return a.placed === b.placed && a.placing === b.placing &&
      JSON.stringify(a.shape) === JSON.stringify(b.shape) &&
      JSON.stringify(a.style) === JSON.stringify(b.style);
  }
  function pushPast(previous: DrawingDraft<P>) {
    past.push(previous);
    if (past.length > 100) past.shift();
  }
  function requireDraft(operation?: DrawingChange<P>["kind"]) {
    if (disposed) throw new Error("Drawing session has been destroyed.");
    const current = draft, checkedRevision = revision;
    if (!current || pending || conflict || !allowed(operation) ||
      disposed || draft !== current || revision !== checkedRevision || pending || conflict)
      throw new Error("This draft cannot be edited now.");
    return current;
  }
  function change(update: (current: DrawingDraft<P>) => void) {
    const current = requireDraft();
    if (gestureCancelled) return;
    const before = structuredClone(current);
    update(current);
    if (sameDraft(before, current)) return;
    if (!gesture) pushPast(before);
    future = [];
    reason = undefined;
    notify();
  }
  function open(next: DrawingDraft<P>) {
    if (disposed) throw new Error("Drawing session has been destroyed.");
    if (draft) throw new Error("Finish or cancel the current drawing first.");
    release = host.acquireInteraction("drawing");
    draft = next;
    permissionFailures.clear();
    permissionResults.clear();
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
    const owned = release;
    release = undefined;
    draft = undefined;
    permissionFailures.clear();
    permissionResults.clear();
    refreshAfterPermission = false;
    initialStyle = undefined;
    past = [];
    future = [];
    gesture = undefined;
    gestureCancelled = false;
    conflict = false;
    reason = undefined;
    owned?.();
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
    const shape = emptyShape(tool);
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
    const shape = before.drawing?.shape ?? shapeFromGeometry(before.geometry);
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
      const placed = placePoint(current.shape, current.placed, p);
      if (!placed) return;
      current.shape = placed.shape;
      current.placing = placed.placing;
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
      const handle = shapeHandles(current.shape)[index];
      if (!handle) throw new Error("Unknown vertex.");
      current.shape = handle.move(p);
    });
  }
  function insertVertex(after: number, p: DrawingPosition) {
    change((current) => {
      current.shape = insertShapeVertex(current.shape, after, p);
    });
  }
  function removeVertex(index: number) {
    change((current) => {
      current.shape = removeShapeVertex(current.shape, index);
    });
  }
  function translate(from: DrawingPosition, to: DrawingPosition) {
    change((current) => {
      current.shape = translateShape(current.shape, from, to);
    });
  }
  function reverse() {
    change((current) => {
      current.shape = reverseShape(current.shape);
    });
  }
  function undo() {
    requireDraft();
    if (gesture) {
      if (!sameDraft(gesture, draft!)) {
        future.push(structuredClone(draft!));
        draft = gesture;
      }
      gesture = undefined;
      gestureCancelled = true;
      reason = undefined;
      notify();
      return;
    }
    const hadCursor = cursor !== undefined;
    cursor = undefined;
    const next = past.pop();
    if (next) {
      future.push(structuredClone(draft!));
      draft = next;
      reason = undefined;
      notify();
    } else if (hadCursor) emit(previewListeners, "drawing.onPreview");
  }
  function redo() {
    requireDraft();
    const hadCursor = cursor !== undefined;
    cursor = undefined;
    const next = future.pop();
    if (next) {
      pushPast(structuredClone(draft!));
      draft = next;
      reason = undefined;
      notify();
    } else if (hadCursor) emit(previewListeners, "drawing.onPreview");
  }
  function beginGesture() {
    requireDraft();
    gesture = structuredClone(draft);
    gestureCancelled = false;
  }
  function endGesture() {
    if (gesture && draft && !sameDraft(gesture, draft)) {
      pushPast(gesture);
      future = [];
    }
    gesture = undefined;
    gestureCancelled = false;
    notify();
  }
  async function submit(remove = false) {
    const current = requireDraft(remove ? "delete" : undefined);
    const { shape, style } = current;
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
    delete after.bbox;
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
    const active = { controller: new AbortController(), kind: request.kind };
    submission = active;
    notify();
    try {
      if (disposed || submission !== active || draft !== current) return false;
      const mayStart = !conflict && !active.controller.signal.aborted && allowed(request.kind);
      if (disposed || submission !== active || draft !== current) return false;
      if (!mayStart || conflict || active.controller.signal.aborted ||
        current.shape !== shape || current.style !== style) {
        pending = false;
        reason ??= "Permission changed while this request was pending. Review the draft and try again.";
        notify();
        return false;
      }
      const decision = await options.submit(
        structuredClone(request),
        active.controller.signal,
      );
      if (disposed || submission !== active || draft !== current) return false;
      pending = false;
      const permitted = !conflict && !active.controller.signal.aborted && allowed(request.kind);
      // Permission callbacks can end, replace, or change this draft synchronously.
      if (disposed || submission !== active || draft !== current ||
        current.shape !== shape || current.style !== style) return false;
      if (conflict || active.controller.signal.aborted || !permitted) {
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
      if (draft === current) cancel();
      return true;
    } catch (error) {
      if (!disposed && submission === active && draft === current) {
        pending = false;
        reason =
          error instanceof Error
            ? error.message
            : "The application could not accept the change.";
        notify();
      }
      return false;
    } finally {
      if (submission === active) submission = undefined;
    }
  }
  const off = host.on("datachange", ({ ids, removed }) => {
    if (applying) {
      if (draft && (ids.includes(draft.feature.id) || removed.includes(draft.feature.id))) {
        pending = false;
        cancel();
      }
      return;
    }
    if (
      !draft ||
      (!ids.includes(draft.feature.id) && !removed.includes(draft.feature.id))
    )
      return;
    conflict = true;
    submission?.controller.abort();
    notify();
  });
  function refreshPermissions() {
    if (disposed) return;
    if (checkingPermission && checkingPermission === draft) {
      if (!refreshingPermission) refreshAfterPermission = true;
      return;
    }
    const current = draft, active = submission, checkedRevision = revision;
    if (current && active) {
      const permitted = allowed(active.kind);
      if (disposed || draft !== current || submission !== active || revision !== checkedRevision) return;
      if (!permitted) {
        reason = permissionFailures.has(active.kind) ? permissionFailureMessage
          : "Permission changed while this request was pending. Review the draft and try again.";
        active.controller.abort();
      }
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
    previewListeners.clear();
  }
  return {
    getState,
    getPreview,
    getMeasurements,
    setCursor,
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
    onPreview: (listener: () => void) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
  };
}
export type DrawingSession<P extends Properties = Properties> = ReturnType<
  typeof createDrawingSession<P>
>;
