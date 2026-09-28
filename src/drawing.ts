import { GeoJSONSource, Marker } from "maplibre-gl";
import type { MapMouseEvent } from "maplibre-gl";
import type { Feature, Geometry } from "geojson";
import type { MapFeature, Properties, Viewport } from "./types";
import type {
  DrawingOptions,
  DrawingPosition,
  DrawingShape,
} from "./drawing-types";
import { createDrawingSession, drawingHandles } from "./drawing-session";
import {
  bearing,
  destination,
  distance,
  measurements,
  position,
  shapeGeometry,
  sizeFromPoint,
  shapeVertices,
  unroll,
  wrapLongitude,
} from "./drawing-geometry";
import { createArrowheads } from "./arrowheads";
import { getViewportDrawingInternals } from "./viewport";

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
    cursor: DrawingPosition | undefined,
    active = false,
    restoreDoubleClick = false;
  let snapEnabled = true,
    pointerType = "mouse",
    bypassSnap = false;
  const previewListeners = new Set<() => void>();
  const abort = new AbortController();
  function editable() {
    return ["editing", "rejected"].includes(session.getState().phase);
  }
  function snap(
    point: DrawingPosition,
    skip = false,
    except?: number | "draft",
  ): DrawingPosition {
    if (!snapEnabled || skip) return point;
    const state = session.getState(),
      screen = map.project(point),
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
      if (
        !feature ||
        feature.id === state.draft?.feature.id ||
        options.canSnap?.(feature) === false
      )
        continue;
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
        ...drawingHandles(state.draft.shape)
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
      if (d < best) {
        best = d;
        chosen = candidate;
      }
    }
    return chosen;
  }
  function previewShape(): DrawingShape | undefined {
    const draft = session.getState().draft;
    if (!draft) return;
    const shape = structuredClone(draft.shape);
    if (draft.placing && cursor && editable()) {
      if ("vertices" in shape) {
        if (
          !shape.vertices.at(-1) ||
          distance(shape.vertices.at(-1)!, cursor) > 0.001
        )
          shape.vertices.push(cursor);
      } else if (
        draft.placed &&
        (shape.kind === "circle" || shape.kind === "rectangle")
      )
        return sizeFromPoint(shape, cursor);
    }
    return shape;
  }
  function renderGeometry() {
    if (disposed || !map.getSource(SOURCE)) return;
    const state = session.getState(),
      draft = state.draft,
      shape = previewShape();
    const features: Feature<Geometry>[] = [];
    let arrow: MapFeature | undefined;
    if (
      draft &&
      shape &&
      (draft.placed || ("vertices" in shape && shape.vertices.length))
    ) {
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
    for (const listener of previewListeners) listener();
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
          button.focus({ preventScroll: true });
          previous =
            markers.get(key)?.position ??
            position(marker.getLngLat().toArray());
          session.beginGesture();
        });
        marker.on("drag", () => {
          if (!editable()) return;
          const next = snap(
            position(marker.getLngLat().toArray()),
            bypassSnap,
            key === "move" || (index === 0 && draft && "center" in draft.shape)
              ? "draft" : index,
          );
          if (key === "move") {
            session.translate(previous, next);
            previous = next;
          } else move(next);
        });
        marker.on("dragend", () => session.endGesture());
        button.addEventListener(
          "keydown",
          (e) => {
            if (!editable()) return;
            if (e.key === "Delete" || e.key === "Backspace") {
              if (index !== undefined && draft && "vertices" in draft.shape) {
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
            const next = position(map.unproject(point).toArray());
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
    if (draft && (draft.placed || !draft.placing)) {
      drawingHandles(draft.shape).forEach((h, i) =>
        handle(
          `vertex-${i}`,
          h.label,
          h.position,
          (p) => session.moveVertex(i, p),
          i,
        ),
      );
      if ("vertices" in draft.shape) {
        const points = unroll(draft.shape.vertices);
        if (points.length) {
          const center: DrawingPosition = [
            wrapLongitude(points.reduce((s, p) => s + p[0], 0) / points.length),
            points.reduce((s, p) => s + p[1], 0) / points.length,
          ];
          handle("move", "Move drawing", center, () => {});
        }
        const edgeCount =
          draft.shape.kind === "polygon" ? points.length : points.length - 1;
        for (let i = 0; i < edgeCount; i++) {
          const a = points[i]!,
            b = points[(i + 1) % points.length]!;
          const midpoint = destination(a, distance(a, b) / 2, bearing(a, b));
          handle(
            `insert-${i}`,
            `Insert vertex after ${i + 1}`,
            midpoint,
            () => {},
            undefined,
            () => session.insertVertex(i, midpoint),
          );
        }
      }
    }
    for (const [key, item] of markers)
      if (!keep.has(key)) {
        item.marker.remove();
        markers.delete(key);
      }
  }
  function render() {
    cursor = undefined;
    const next = Boolean(session.getState().draft);
    if (next && !active) {
      restoreDoubleClick = map.doubleClickZoom.isEnabled();
      map.doubleClickZoom.disable();
    } else if (!next && active) {
      if (restoreDoubleClick) map.doubleClickZoom.enable();
      cursor = undefined;
    }
    const editingId = session.getState().draft?.before?.id;
    drawingInternals.setEditing(editingId ?? null);
    active = next;
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
      !editable() ||
      pointerType !== "mouse" ||
      event.originalEvent.detail > 1
    )
      return;
    session.addPoint(
      snap(position(event.lngLat.toArray()), event.originalEvent.altKey),
    );
  }
  function onMove(event: MapMouseEvent) {
    if (!session.getState().draft?.placing || !editable()) return;
    cursor = snap(position(event.lngLat.toArray()), event.originalEvent.altKey);
    renderGeometry();
  }
  map.on("click", onClick);
  map.on("mousemove", onMove);
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
      if (event.key === "Alt") bypassSnap = true;
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    "keyup",
    (event) => {
      if (event.key === "Alt") bypassSnap = false;
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    "blur",
    () => {
      bypassSnap = false;
    },
    { signal: abort.signal },
  );
  const off = session.onChange(render);
  const offPrepared = drawingInternals.onPrepared(prepare);
  let offDestroy = () => {};
  function destroy() {
    if (disposed) return;
    session.destroy();
    disposed = true;
    drawingInternals.setEditing(null);
    previewListeners.clear();
    attached.delete(viewport.map);
    off();
    offPrepared();
    offDestroy();
    abort.abort();
    map.off("click", onClick);
    map.off("mousemove", onMove);
    for (const item of markers.values()) item.marker.remove();
    markers.clear();
    for (const layer of [...layers].reverse())
      if (map.getLayer(layer)) map.removeLayer(layer);
    draftArrowheads.remove();
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
  offDestroy = viewport.on("destroy", destroy);
  return {
    ...session,
    destroy,
    getMeasurements: () => {
      const shape = previewShape();
      return shape ? measurements(shape) : { length: 0 };
    },
    onPreview: (listener: () => void) => {
      previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    },
    setSnapping(value: boolean) {
      snapEnabled = value;
    },
    getSnapping: () => snapEnabled,
  };
}
export type DrawingEditor<P extends Properties = Properties> = ReturnType<
  typeof attachDrawing<P>
>;
