import { GeoJSONSource, Marker } from "maplibre-gl";
import type { MapMouseEvent } from "maplibre-gl";
import type { Feature, Geometry } from "geojson";
import type { MapFeature, Properties, Viewport } from "./types";
import type {
  DrawingOptions,
  DrawingPosition,
} from "./drawing-types";
import { createDrawingSession } from "./drawing-session";
import {
  position,
  unroll,
  wrapLongitude,
} from "./drawing-geometry";
import { createArrowheads } from "./arrowheads";
import { getViewportDrawingInternals } from "./viewport";
import { createGroundTargetResolver } from "./ground-target";
import type { ScreenPoint } from "./ground-target";
import { createGroundFeedback } from "./ground-feedback";
import {
  shapeGeometry,
  shapeHandles,
  shapeInsertHandles,
  shapeMoveHandle,
  shapeVertices,
} from "./drawing-shapes";

const attached = new WeakSet<object>();
const SOURCE = "rl:draft";
const layers = [
  "rl:draft-fill",
  "rl:draft-line",
  "rl:draft-points",
  "rl:draft-label",
];

/** Map gestures and draft rendering. Controls are optional and attach separately. */
export function attachDrawing<P extends Properties>(
  viewport: Viewport<P>,
  options: DrawingOptions<P>,
) {
  if (attached.has(viewport.map))
    throw new Error("Drawing is already attached to this viewport.");
  const internals = getViewportDrawingInternals(viewport);
  if (!internals)
    throw new Error("Drawing requires a viewport created by createViewport.");
  const drawingInternals = internals;
  attached.add(viewport.map);
  const session = createDrawingSession(viewport, options),
    map = viewport.map;
  const resolveGround = createGroundTargetResolver(map, () => viewport.getConfiguration().terrain,
    cause => drawingInternals.reportTargetError(cause));
  const feedback = options.visualFeedback === false ? undefined : createGroundFeedback(viewport.container, map, resolveGround);
  const draftArrowheads = createArrowheads(map, "rl:draft-arrows", "rl:draft-arrow");
  const markers = new Map<
    string,
    {
      marker: Marker;
      button: HTMLButtonElement;
      position: DrawingPosition;
      insert?: () => void;
    }
  >();
  let disposed = false,
    active = false,
    navigating = false,
    restoreDoubleClick = false;
  let snapEnabled = true,
    pointerType = "mouse",
    bypassSnap = false;
  let pointer: ScreenPoint | undefined;
  let draggingHandle = false;
  let refreshDraggedHandle: (() => void) | undefined;
  let keyboardFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let stateRevision = 0;
  let draftEpoch = 0;
  const abort = new AbortController();
  function editable() {
    return ["editing", "rejected"].includes(session.getState().phase);
  }
  function snap(
    point: DrawingPosition,
    screen: ScreenPoint,
    skip = false,
    except?: number | "draft",
  ): DrawingPosition {
    if (!snapEnabled || skip) return point;
    const state = session.getState(),
      candidates: DrawingPosition[] = [];
    const visible = new Set(
      map
        .queryRenderedFeatures([[screen.x - 12, screen.y - 12], [screen.x + 12, screen.y + 12]], {
          layers: ["rl:fill", "rl:line", "rl:dashed", "rl:points"].filter(
            (id) => map.getLayer(id),
          ),
        })
        .flatMap((f) => typeof f.properties._rl_feature_id === "string" ? [f.properties._rl_feature_id] : []),
    );
    for (const id of visible) {
      const feature = viewport.getFeature(id);
      if (!feature || feature.id === state.draft?.feature.id) continue;
      const allowed = options.canSnap?.(feature);
      if (disposed) return point;
      if (allowed === false) continue;
      if (feature.entity) continue;
      const g = feature.geometry;
      candidates.push(
        ...(g.type === "Point"
          ? [position(g.coordinates)]
          : g.type === "LineString"
            ? g.coordinates.map(position)
            : g.coordinates.flatMap((ring) => ring.slice(0, -1).map(position))),
      );
    }
    if (state.draft && except !== "draft")
      candidates.push(
        ...shapeHandles(state.draft.shape)
          .filter((_, i) => i !== except)
          .map((h) => h.position),
      );
    let best = 12,
      chosen = point;
    for (const candidate of candidates) {
      const projected = map.project([
        point[0] + wrapLongitude(candidate[0] - point[0]),
        candidate[1],
      ]);
      if (
        projected.x < 0 ||
        projected.y < 0 ||
        projected.x > viewport.container.clientWidth ||
        projected.y > viewport.container.clientHeight
      )
        continue;
      const d = Math.hypot(screen.x - projected.x, screen.y - projected.y);
      if (d < best && visibleGroundVertex(candidate, projected)) {
        best = d;
        chosen = candidate;
      }
    }
    return chosen;
  }
  function visibleGroundVertex(candidate: DrawingPosition, screen: ScreenPoint) {
    const hit = resolveGround(screen);
    if (hit.kind !== "available") return false;
    const latitude = candidate[1] * Math.PI / 180;
    const distance = (a: DrawingPosition, b: DrawingPosition) => Math.hypot(
      wrapLongitude(a[0] - b[0]) * Math.cos(latitude), a[1] - b[1],
    );
    if (distance(candidate, hit.position) <= 1e-7) return true;
    let neighbor = resolveGround({ x: screen.x + 2, y: screen.y });
    if (neighbor.kind !== "available") neighbor = resolveGround({ x: screen.x - 2, y: screen.y });
    if (neighbor.kind !== "available") return false;
    return distance(candidate, hit.position) <= Math.max(distance(hit.position, neighbor.position), 1e-7);
  }
  function renderGeometry() {
    if (disposed || !map.getSource(SOURCE)) return;
    const state = session.getState(),
      draft = state.draft,
      shape = session.getPreview();
    const features: Feature<Geometry>[] = [];
    let arrow: MapFeature | undefined;
    if (draft && shape) {
      const points = shapeVertices(shape),
        style = draft.style;
      let geometry: Geometry = shapeGeometry(shape, true);
      if (points.length === 1)
        geometry = { type: "Point", coordinates: points[0]! };
      else if (geometry.type === "Polygon" && points.length < 3)
        geometry = { type: "LineString", coordinates: unroll(points) };
      if (
        points.length &&
        points.every((p) => p.every(Number.isFinite) && Math.abs(p[1]) < 90)
      )
        features.push({
          type: "Feature",
          geometry,
          properties: {
            color: style.color,
            fill: style.fillColor,
            opacity: style.fillOpacity,
            width: style.lineWidth,
            label: style.label,
          },
        });
      if (shape.kind === "arrow")
        arrow = { ...draft.feature, drawing: { version: 1, shape, style } };
      map.setPaintProperty(
        "rl:draft-line",
        "line-dasharray",
        style.dashed ? [3, 2] : [1, 0],
      );
    }
    const source = map.getSource(SOURCE);
    if (source instanceof GeoJSONSource)
      source.setData({ type: "FeatureCollection", features });
    draftArrowheads.show(arrow ? [arrow] : []);
  }
  function prepare() {
    if (disposed) return;
    if (!map.getSource(SOURCE))
      map.addSource(SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    if (!map.getLayer(layers[0]!)) {
      map.addLayer({
        id: layers[0]!,
        type: "fill",
        source: SOURCE,
        filter: ["==", "$type", "Polygon"],
        paint: {
          "fill-color": ["get", "fill"],
          "fill-opacity": ["get", "opacity"],
        },
      });
      map.addLayer({
        id: layers[1]!,
        type: "line",
        source: SOURCE,
        filter: ["in", "$type", "LineString", "Polygon"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
        },
      });
      map.addLayer({
        id: layers[2]!,
        type: "circle",
        source: SOURCE,
        filter: ["==", "$type", "Point"],
        paint: { "circle-radius": 4, "circle-color": ["get", "color"] },
      });
      map.addLayer({
        id: layers[3]!,
        type: "symbol",
        source: SOURCE,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 1.5],
        },
        paint: {
          "text-color": "#203b32",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
    }
    render();
  }
  function updateMarkers() {
    const state = session.getState(),
      draft = state.draft,
      keep = new Set<string>();
    const locked = !editable();
    function handle(
      key: string,
      label: string,
      p: DrawingPosition,
      move: (p: DrawingPosition) => void,
      index?: number,
      insert?: () => void,
    ) {
      if (!p.every(Number.isFinite) || Math.abs(p[1]) >= 90) return;
      keep.add(key);
      let item = markers.get(key);
      if (!item) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rl-drawing-handle";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.textContent = key === "move" ? "↔" : insert ? "+" : "";
        if (key === "move") button.classList.add("rl-drawing-move");
        if (insert) button.classList.add("rl-drawing-insert");
        const marker = new Marker({
          element: button,
          draggable: !insert,
          opacityWhenCovered: 0,
        })
          .setLngLat(p)
          .addTo(map);
        item = { marker, button, position: p };
        markers.set(key, item);
        let previous = p;
        let dragScreen: ScreenPoint | undefined;
        let dragEpoch = draftEpoch;
        const currentDrag = (revision?: number) => !disposed && dragEpoch === draftEpoch &&
          markers.get(key)?.marker === marker && editable() &&
          (revision === undefined || revision === stateRevision);
        button.addEventListener(
          "touchstart",
          (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
          },
          { signal: abort.signal, passive: false },
        );
        button.addEventListener(
          "pointerdown",
          (e) => {
            bypassSnap = e.altKey;
            if (e.pointerType !== "mouse") {
              e.preventDefault();
              e.stopImmediatePropagation();
            }
          },
          { signal: abort.signal },
        );
        button.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (insert && editable()) markers.get(key)?.insert?.();
          },
          { signal: abort.signal },
        );
        button.addEventListener("dblclick", (e) => e.stopPropagation(), {
          signal: abort.signal,
        });
        marker.on("dragstart", () => {
          if (!editable()) return;
          if (keyboardFeedbackTimer) clearTimeout(keyboardFeedbackTimer);
          draggingHandle = true;
          dragEpoch = draftEpoch;
          dragScreen = map.project(marker.getLngLat());
          refreshDraggedHandle = () => { if (dragScreen) applyDrag(dragScreen); };
          button.focus({ preventScroll: true });
          if (dragEpoch !== draftEpoch || !editable()) return;
          previous =
            markers.get(key)?.position ??
            position(marker.getLngLat().toArray());
          session.beginGesture();
        });
        function applyDrag(screen: ScreenPoint) {
          if (!currentDrag()) return;
          const revision = stateRevision;
          const current = session.getState().draft,
            currentHandle = index === undefined || !current
              ? undefined
              : shapeHandles(current.shape)[index];
          const target = resolveGround(screen);
          if (!currentDrag(revision)) return;
          if (target.kind !== "available") {
            marker.setLngLat(markers.get(key)?.position ?? previous);
            feedback?.show(screen, target, undefined);
            return;
          }
          const next = snap(
            target.position,
            screen,
            bypassSnap,
            key === "move" || currentHandle?.carriesShape ? "draft" : index,
          );
          if (!currentDrag(revision)) return;
          feedback?.show(screen, target, next !== target.position ? next : undefined);
          if (!currentDrag(revision)) return;
          const samePosition = (a: DrawingPosition, b: DrawingPosition) =>
            Math.abs(wrapLongitude(a[0] - b[0])) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
          if (key === "move") {
            if (!samePosition(previous, next)) {
              session.translate(previous, next);
              previous = next;
            }
          } else if (!currentHandle || !samePosition(currentHandle.position, next)) move(next);
        }
        marker.on("drag", () => {
          dragScreen = map.project(marker.getLngLat());
          applyDrag(dragScreen);
        });
        marker.on("dragend", () => {
          if (dragEpoch !== draftEpoch) return;
          draggingHandle = false;
          dragScreen = undefined;
          refreshDraggedHandle = undefined;
          feedback?.clear();
          if (editable()) session.endGesture();
        });
        button.addEventListener(
          "keydown",
          (e) => {
            if (!editable()) return;
            if (e.key === "Delete" || e.key === "Backspace") {
              const current = session.getState().draft;
              if (
                index !== undefined &&
                current &&
                shapeHandles(current.shape)[index]?.removable
              ) {
                e.preventDefault();
                e.stopPropagation();
                session.removeVertex(index);
                const remaining = session.getState().draft?.shape;
                const count = remaining && "vertices" in remaining
                  ? remaining.vertices.length : 0;
                const target = markers.get(`vertex-${Math.min(index, count - 1)}`)?.button
                  ?? markers.get("move")?.button;
                if (target) target.focus({ preventScroll: true });
                else {
                  const canvas = map.getCanvas();
                  canvas.tabIndex = 0;
                  canvas.focus({ preventScroll: true });
                }
              }
              return;
            }
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            e.stopPropagation();
            const point = map.project(marker.getLngLat()),
              step = e.shiftKey ? 40 : 10;
            point.x +=
              e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            point.y +=
              e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
            const revision = stateRevision;
            const target = resolveGround(point);
            if (disposed || revision !== stateRevision || !editable()) return;
            if (keyboardFeedbackTimer) clearTimeout(keyboardFeedbackTimer);
            if (target.kind !== "available") {
              feedback?.show(point, target, undefined);
              keyboardFeedbackTimer = setTimeout(() => feedback?.clear(), 800);
              return;
            }
            const next = target.position;
            feedback?.clear();
            if (key === "move")
              session.translate(position(marker.getLngLat().toArray()), next);
            else move(next);
          },
          { signal: abort.signal },
        );
      }
      item.insert = insert;
      const actual = item.marker.getLngLat();
      if (wrapLongitude(actual.lng - p[0]) !== 0 || actual.lat !== p[1])
        item.marker.setLngLat(p);
      item.position = p;
      if (item.marker.isDraggable() !== (!locked && !insert))
        item.marker.setDraggable(!locked && !insert);
      item.button.disabled = locked;
    }
    if (draft && session.getPreview()) {
      shapeHandles(draft.shape).forEach((h, i) =>
        handle(
          `vertex-${i}`,
          h.label,
          h.position,
          (p) => session.moveVertex(i, p),
          i,
        ),
      );
      const move = shapeMoveHandle(draft.shape);
      if (move) handle("move", move.label, move.position, () => {});
      for (const insert of shapeInsertHandles(draft.shape))
        handle(
          `insert-${insert.after}`,
          insert.label,
          insert.position,
          () => {},
          undefined,
          () => session.insertVertex(insert.after, insert.position),
        );
    }
    for (const [key, item] of markers)
      if (!keep.has(key)) {
        item.marker.remove();
        markers.delete(key);
      }
  }
  function render() {
    stateRevision++;
    const next = Boolean(session.getState().draft);
    if (next && !active) {
      restoreDoubleClick = map.doubleClickZoom.isEnabled();
      map.doubleClickZoom.disable();
    } else if (!next && active) {
      draftEpoch++;
      draggingHandle = false;
      refreshDraggedHandle = undefined;
      if (restoreDoubleClick) map.doubleClickZoom.enable();
    }
    if (!editable() && draggingHandle) {
      draftEpoch++;
      draggingHandle = false;
      refreshDraggedHandle = undefined;
      // Ending the gesture notifies onChange synchronously. Its next render
      // clears feedback and restores the locked marker state.
      session.endGesture();
      return;
    }
    const editingId = session.getState().draft?.before?.id;
    drawingInternals.setEditing(editingId ?? null);
    active = next;
    if ((!session.getState().draft?.placing && !draggingHandle) || !editable()) {
      feedback?.clear();
      pointer = undefined;
    }
    map
      .getCanvas()
      .classList.toggle(
        "rl-drawing-active",
        next && Boolean(session.getState().draft?.placing),
      );
    renderGeometry();
    updateMarkers();
  }
  function onClick(event: MapMouseEvent) {
    if (
      disposed ||
      navigating ||
      !editable() ||
      !session.getState().draft?.placing ||
      pointerType !== "mouse" ||
      event.originalEvent.detail > 1
    )
      return;
    const revision = stateRevision;
    const target = resolveGround(event.point);
    if (disposed || revision !== stateRevision) return;
    if (target.kind !== "available") {
      if (keyboardFeedbackTimer) clearTimeout(keyboardFeedbackTimer);
      session.setCursor(undefined);
      if (disposed || revision !== stateRevision) return;
      feedback?.show(event.point, target, undefined);
      return;
    }
    const chosen = snap(target.position, event.point, event.originalEvent.altKey);
    if (disposed || revision !== stateRevision) return;
    session.addPoint(chosen);
  }
  function refreshPointer() {
    if (disposed || navigating || !pointer || !session.getState().draft?.placing || !editable()) return;
    if (keyboardFeedbackTimer) clearTimeout(keyboardFeedbackTimer);
    const point = pointer, revision = stateRevision;
    const target = resolveGround(point);
    if (disposed || revision !== stateRevision || pointer !== point) return;
    const chosen = target.kind === "available" ? snap(target.position, point, bypassSnap) : undefined;
    if (disposed || revision !== stateRevision || pointer !== point) return;
    session.setCursor(chosen);
    // Preview subscribers can cancel, destroy, or replace the draft synchronously.
    if (disposed || revision !== stateRevision || pointer !== point) return;
    feedback?.show(point, target, chosen && target.kind === "available" &&
      (chosen[0] !== target.position[0] || chosen[1] !== target.position[1]) ? chosen : undefined);
  }
  function onMove(event: MapMouseEvent) {
    if (!session.getState().draft?.placing || !editable()) return;
    pointer = { x: event.point.x, y: event.point.y };
    bypassSnap = event.originalEvent.altKey;
    refreshPointer();
  }
  const onLeave = () => {
    pointer = undefined;
    session.setCursor(undefined);
    feedback?.clear();
  };
  const onSceneRender = () => {
    if (pointer) refreshPointer();
    if (draggingHandle) refreshDraggedHandle?.();
  };
  const onTerrainData = (event: { sourceId?: string }) => {
    if (event.sourceId === "rl:terrain") feedback?.invalidate();
  };
  const onStyleData = () => {
    feedback?.invalidate();
  };
  const onDragStart = () => {
    navigating = true;
    session.setCursor(undefined);
    feedback?.clear();
  };
  const onDragEnd = () => {
    navigating = false;
    refreshPointer();
  };
  map.on("click", onClick);
  map.on("mousemove", onMove);
  map.on("render", onSceneRender);
  map.on("sourcedata", onTerrainData);
  map.on("styledata", onStyleData);
  map.on("dragstart", onDragStart);
  map.on("dragend", onDragEnd);
  map.getCanvas().addEventListener("mouseleave", onLeave);
  map.getCanvas().addEventListener(
    "pointerdown",
    (event) => {
      pointerType = event.pointerType;
    },
    { signal: abort.signal },
  );
  viewport.container.addEventListener(
    "keydown",
    (event) => {
      if (
        !session.getState().draft ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        editable()
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) session.redo();
        else session.undo();
      }
      if (event.key === "Escape" && session.getState().phase !== "pending") {
        event.preventDefault();
        event.stopPropagation();
        session.cancel();
      }
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Alt") { bypassSnap = true; refreshPointer(); refreshDraggedHandle?.(); }
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    "keyup",
    (event) => {
      if (event.key === "Alt") { bypassSnap = false; refreshPointer(); refreshDraggedHandle?.(); }
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    "blur",
    () => {
      bypassSnap = false;
      onLeave();
    },
    { signal: abort.signal },
  );
  const off = session.onChange(render);
  let offPrepared = () => {};
  const offPreview = session.onPreview(renderGeometry);
  let offDestroy = () => {};
  function destroy() {
    if (disposed) return;
    session.destroy();
    disposed = true;
    drawingInternals.setEditing(null);
    attached.delete(viewport.map);
    off();
    offPrepared();
    offPreview();
    offDestroy();
    abort.abort();
    if (keyboardFeedbackTimer) clearTimeout(keyboardFeedbackTimer);
    map.off("click", onClick);
    map.off("mousemove", onMove);
    map.off("render", onSceneRender);
    map.off("sourcedata", onTerrainData);
    map.off("styledata", onStyleData);
    map.off("dragstart", onDragStart);
    map.off("dragend", onDragEnd);
    map.getCanvas().removeEventListener("mouseleave", onLeave);
    feedback?.destroy();
    for (const item of markers.values()) item.marker.remove();
    markers.clear();
    for (const layer of [...layers].reverse())
      if (map.getLayer(layer)) map.removeLayer(layer);
    draftArrowheads.remove();
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
  offDestroy = viewport.on("destroy", destroy);
  offPrepared = drawingInternals.onPrepared(prepare);
  if (disposed) offPrepared();
  return {
    ...session,
    destroy,
    setSnapping(value: boolean) {
      snapEnabled = value;
      refreshPointer();
      refreshDraggedHandle?.();
    },
    getSnapping: () => snapEnabled,
  };
}
export type DrawingEditor<P extends Properties = Properties> = ReturnType<
  typeof attachDrawing<P>
>;
