import type { Properties, Viewport } from "./types";
import type { DrawingEditor } from "./drawing";
import type { DrawingStyle, DrawingSegment } from "./drawing-types";
import { shapeHandles, shapeParameters, validateShape } from "./drawing-shapes";

export type DrawingControlsOptions = {
  tools: HTMLElement;
  inspector: HTMLElement;
  units?: "metric" | "imperial";
  /** Accepted-change undo belongs to the consumer. Draft undo remains inside the editor. */
  history?: {
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
  };
};
const names = {
  line: "Line",
  polygon: "Polygon",
  rectangle: "Rectangle",
  circle: "Circle",
  arrow: "Arrow",
  point: "Point",
};

/** Optional labeled tool rail and fixed inspector, mounted in consumer-owned containers. */
export function attachDrawingControls<P extends Properties>(
  viewport: Viewport<P>,
  editor: DrawingEditor<P>,
  options: DrawingControlsOptions,
) {
  const rail = document.createElement("nav"),
    panel = document.createElement("section");
  rail.className = "rl-drawing-tools";
  rail.setAttribute("aria-label", "Drawing tools");
  panel.className = "rl-drawing-inspector";
  panel.setAttribute("aria-label", "Drawing inspector");
  options.tools.append(rail);
  options.inspector.append(panel);
  let units = options.units ?? "metric",
    error: string | undefined,
    disposed = false,
    rendering = false,
    changingField = false,
    pointerPressed = false,
    renderTimer: ReturnType<typeof setTimeout> | undefined,
    releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  let selectedRing = 0, selectedSegment = 0, selectedDraft: string | undefined;
  function draftActionAvailability(state: ReturnType<typeof editor.getState>) {
    return {
      Undo: !state.canUndo,
      Redo: !state.canRedo,
      Finish: !["editing", "rejected"].includes(state.phase) || Boolean(state.validation),
      Cancel: state.phase === "pending",
      "Delete drawing": !editor.canDelete(),
    };
  }
  function refreshDraftActions() {
    const state = editor.getState();
    if (!state.draft) return;
    refreshDraftMessage(state);
    for (const [label, disabled] of Object.entries(draftActionAvailability(state))) {
      const button = panel.querySelector<HTMLButtonElement>(`button[data-field="action:${label}"]`);
      if (button) button.disabled = disabled;
    }
  }
  function refreshDraftMessage(state: ReturnType<typeof editor.getState>) {
    const message = state.phase === "pending" ? "Waiting for application approval." : state.message ?? state.validation;
    const current = panel.querySelector<HTMLParagraphElement>(".rl-drawing-note");
    if (!message) { current?.remove(); return; }
    const note = current ?? document.createElement("p");
    note.className = "rl-drawing-note";
    note.textContent = message;
    note.setAttribute("role", state.phase === "pending" ? "status" : "alert");
    if (!current) panel.append(note);
  }
  function scheduleRender() {
    if (renderTimer !== undefined || pointerPressed) return;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      if (!pointerPressed && !(document.activeElement instanceof HTMLInputElement && panel.contains(document.activeElement))) render();
    }, 0);
  }
  function fieldChanged(update: () => void) {
    changingField = true;
    try {
      update();
    } catch (cause) {
      fail(cause);
    } finally {
      changingField = false;
      scheduleRender();
    }
  }
  const action = (
    label: string,
    fn: () => void | Promise<unknown>,
    disabled = false,
    primary = false,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.field = `action:${label}`;
    button.disabled = disabled;
    if (primary) button.className = "rl-drawing-finish";
    button.addEventListener("click", () => {
      error = undefined;
      try {
        const result = fn();
        if (result instanceof Promise) void result.catch(fail);
      } catch (cause) {
        fail(cause);
      }
    });
    return button;
  };
  function fail(cause: unknown) {
    error =
      cause instanceof Error
        ? cause.message
        : "The drawing could not be changed.";
    if (changingField || pointerPressed) scheduleRender();
    else render();
  }
  function field(label: string, input: HTMLElement) {
    const row = document.createElement("label");
    row.textContent = label;
    row.append(input);
    return row;
  }
  function text(
    label: string,
    value: string,
    onChange: (value: string) => void,
    disabled = false,
    type = "text",
  ) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.disabled = disabled;
    input.dataset.field = label;
    input.addEventListener("change", () => fieldChanged(() => onChange(input.value)));
    return field(label, input);
  }
  function select(
    label: string,
    value: string,
    choices: readonly string[],
    onChange: (value: string) => void,
    disabled = false,
  ) {
    const input = document.createElement("select");
    input.disabled = disabled;
    input.dataset.field = label;
    for (const choice of choices) {
      const item = document.createElement("option");
      item.value = choice;
      item.textContent = choice;
      input.append(item);
    }
    input.value = value;
    input.addEventListener("change", () => fieldChanged(() => onChange(input.value)));
    return field(label, input);
  }
  function row(...children: HTMLElement[]) {
    const element = document.createElement("div");
    element.className = "rl-drawing-row";
    element.append(...children);
    return element;
  }
  function measurementText() {
    const measure = editor.getMeasurements();
    const length =
      units === "metric"
        ? `${(measure.length / 1000).toFixed(2)} km`
        : `${(measure.length / 1609.344).toFixed(2)} mi`;
    if (measure.area === undefined) return `Length ${length}`;
    const shape = editor.getPreview();
    const area = shape && validateShape(shape)
      ? "unavailable"
      : units === "metric"
        ? `${(measure.area / 1e6).toFixed(3)} km²`
        : `${(measure.area / 4046.8564224).toFixed(2)} acres`;
    return `Area ${area} · Edge ${length}`;
  }
  function render() {
    if (disposed) return;
    const state = editor.getState(),
      draft = state.draft;
    let activeSegment: DrawingSegment | undefined;
    const focused =
      document.activeElement instanceof HTMLElement &&
      (panel.contains(document.activeElement) || rail.contains(document.activeElement))
        ? document.activeElement.dataset.field
        : undefined;
    rendering = true;
    try {
      rail.replaceChildren();
      panel.replaceChildren();
    } finally {
      rendering = false;
    }
    for (const tool of editor.tools) {
      const button = action(
        names[tool],
        () => editor.start(tool),
        Boolean(draft),
      );
      button.setAttribute("aria-pressed", String(draft?.shape.kind === tool));
      rail.append(button);
    }
    const heading = document.createElement("h2");
    heading.textContent = draft
      ? `${names[draft.shape.kind]} · Draft`
      : "Drawing";
    panel.append(heading);
    const unitPicker = select(
      "Units",
      units,
      ["metric", "imperial"],
      (value) => {
        units = value === "imperial" ? "imperial" : "metric";
        render();
      },
    );
    if (!draft) {
      const selected = viewport.getSelection()[0],
        feature = selected ? viewport.getFeature(selected) : undefined;
      const hint = document.createElement("p");
      hint.textContent = feature
        ? viewport.getName(feature)
        : "Choose a tool or select a feature.";
      panel.append(hint);
      if (feature)
        panel.append(
          action(
            "Edit drawing",
            () => editor.edit(feature.id),
            Boolean(feature.entity),
          ),
        );
      if (options.history)
        panel.append(
          row(
            action(
              "Undo",
              () => {
                options.history!.undo();
                render();
              },
              !options.history.canUndo(),
            ),
            action(
              "Redo",
              () => {
                options.history!.redo();
                render();
              },
              !options.history.canRedo(),
            ),
          ),
        );
      panel.append(unitPicker);
    } else {
      const locked = !["editing", "rejected"].includes(state.phase),
        style = draft.style,
        shape = draft.shape;
      const measurements = document.createElement("output");
      measurements.className = "rl-drawing-measurements";
      measurements.setAttribute("aria-label", "Drawing measurements");
      measurements.textContent = measurementText();
      measurements.setAttribute("aria-live", "off");
      panel.append(measurements);
      const editable = (key: keyof DrawingStyle) =>
        !locked && editor.styleFields.includes(key);
      panel.append(
        text(
          "Label",
          style.label,
          (value) => editor.setStyle({ label: value }),
          !editable("label"),
        ),
      );
      const scale = units === "metric" ? 1 : 0.3048,
        suffix = units === "metric" ? "m" : "ft";
      if (selectedDraft !== draft.feature.id) {
        selectedDraft = draft.feature.id;
        selectedRing = 0;
        selectedSegment = 0;
      }
      if (shape.kind === "polygon") {
        const rings = ["Boundary", ...(shape.holes ?? []).map((_, i) => `Hole ${i + 1}`)];
        selectedRing = Math.min(selectedRing, rings.length - 1);
        panel.append(select("Ring", rings[selectedRing]!, rings, value => {
          selectedRing = rings.indexOf(value);
          selectedSegment = 0;
          render();
        }, locked));
        panel.append(row(
          action("Add hole", () => {
            editor.startHole();
            selectedRing = editor.getState().draft?.placingRing ?? 0;
            selectedSegment = 0;
            render();
          }, locked || Boolean(draft.placingRing) || Boolean(validateShape(shape))),
          action("Delete hole", () => { editor.removeHole(selectedRing); selectedRing = 0; render(); }, locked || !selectedRing),
        ));
        if (draft.placingRing)
          panel.append(action("Finish hole", () => editor.finishRing(), locked || Boolean(state.validation)));
        else if (draft.placing)
          panel.append(action("Close boundary", () => editor.finishRing(), locked || Boolean(state.validation)));
      } else selectedRing = 0;
      const segments = editor.getSegments().filter(segment => segment.ring === selectedRing);
      if (segments.length) {
        selectedSegment = Math.min(selectedSegment, segments.length - 1);
        const segment = segments[selectedSegment]!;
        activeSegment = segment;
        panel.append(select("Segment", String(selectedSegment + 1), segments.map((_, i) => String(i + 1)), value => {
          selectedSegment = Number(value) - 1;
          render();
        }, locked));
        panel.append(row(
          text(`Distance (${suffix})`, String(Number((segment.length / scale).toFixed(3))), value =>
            editor.setSegment(segment, { length: Number(value) * scale }), locked, "number"),
          text("Bearing (°)", String(Number(segment.bearing.toFixed(3))), value =>
            editor.setSegment(segment, { bearing: Number(value) }), locked, "number"),
        ));
      }
      const parameters = shapeParameters(shape);
      const parameterField = (parameter: (typeof parameters)[number]) =>
        text(
          parameter.unit === "length"
            ? `${parameter.label} (${suffix})`
            : `${parameter.label} (°)`,
          String(
            Number(
              (parameter.value / (parameter.unit === "length" ? scale : 1)).toFixed(2),
            ),
          ),
          (value) => {
            const current = editor.getState().draft?.shape;
            if (!current || current.kind !== shape.kind) return;
            const field = shapeParameters(current).find(field => field.label === parameter.label);
            if (field) editor.setShape(field.set(Number(value) * (field.unit === "length" ? scale : 1)));
          },
          locked,
          "number",
        );
      const dimensions = parameters.filter(
        (parameter) =>
          parameter.label === "Width" || parameter.label === "Height",
      );
      for (const parameter of parameters) {
        if (parameter.label === "Width")
          panel.append(row(...dimensions.map(parameterField)));
        else if (parameter.label !== "Height") panel.append(parameterField(parameter));
      }
      if (shape.kind === "arrow")
        panel.append(
          action("Reverse direction", () => editor.reverse(), locked),
        );
      panel.append(
        row(
          text(
            "Stroke",
            style.color,
            (value) => editor.setStyle({ color: value }),
            !editable("color"),
          ),
          text(
            "Width (px)",
            String(style.lineWidth),
            (value) => editor.setStyle({ lineWidth: Number(value) }),
            !editable("lineWidth"),
            "number",
          ),
        ),
      );
      panel.append(
        row(
          text(
            "Fill",
            style.fillColor,
            (value) => editor.setStyle({ fillColor: value }),
            !editable("fillColor"),
          ),
          text(
            "Opacity (%)",
            String(Number((style.fillOpacity * 100).toFixed(2))),
            (value) => editor.setStyle({ fillOpacity: Number(value) / 100 }),
            !editable("fillOpacity"),
            "number",
          ),
        ),
      );
      panel.append(
        select(
          "Line",
          style.dashed ? "Dashed" : "Solid",
          ["Solid", "Dashed"],
          (value) => editor.setStyle({ dashed: value === "Dashed" }),
          !editable("dashed"),
        ),
      );
      const snap = document.createElement("input");
      snap.type = "checkbox";
      snap.dataset.field = "Snapping";
      snap.checked = editor.getSnapping();
      snap.disabled = locked;
      snap.addEventListener("change", () => { editor.setSnapping(snap.checked); render(); });
      const snapLabel = field("Snapping", snap);
      snapLabel.className = "rl-drawing-snap";
      panel.append(snapLabel);
      const edgeSnap = document.createElement("input");
      edgeSnap.type = "checkbox";
      edgeSnap.dataset.field = "Include edges";
      edgeSnap.checked = editor.getEdgeSnapping();
      edgeSnap.disabled = locked || !editor.getSnapping();
      edgeSnap.addEventListener("change", () => { editor.setEdgeSnapping(edgeSnap.checked); render(); });
      const edgeLabel = field("Include edges", edgeSnap);
      edgeLabel.className = "rl-drawing-snap";
      panel.append(edgeLabel);
      panel.append(unitPicker);
      refreshDraftMessage(state);
      if (
        state.phase === "conflict" &&
        draft.before &&
        viewport.getFeature(draft.before.id)
      )
        panel.append(
          action("Restart with latest feature", () => editor.restart()),
        );
      const disabled = draftActionAvailability(state);
      panel.append(
        row(
          action("Undo", () => editor.undo(), disabled.Undo),
          action("Redo", () => editor.redo(), disabled.Redo),
        ),
      );
      panel.append(
        row(
          action("Cancel", () => editor.cancel(), disabled.Cancel),
          action(
            state.phase === "pending" ? "Pending" : "Finish",
            () => editor.finish(),
            disabled.Finish,
            true,
          ),
        ),
      );
      if (draft.before)
        panel.append(
          action(
            "Delete drawing",
            () => editor.delete(),
            disabled["Delete drawing"],
          ),
        );
      const help = document.createElement("p");
      help.className = "rl-drawing-help";
      help.textContent = draft.placing
        ? "Click or tap to add points. Use two fingers to navigate on touch."
        : shapeHandles(draft.shape).some((handle) => handle.removable)
          ? "Drag handles to reshape. Use + to insert a vertex."
          : "Drag handles to move or reshape.";
      panel.append(help);
    }
    editor.setActiveSegment(activeSegment);
    if (error) {
      const note = document.createElement("p");
      note.setAttribute("role", "alert");
      note.textContent = error;
      panel.append(note);
    }
    if (focused) {
      const candidates = [
        ...rail.querySelectorAll<HTMLElement>("[data-field]:not(:disabled)"),
        ...panel.querySelectorAll<HTMLElement>("[data-field]:not(:disabled)"),
      ];
      const target = candidates.find((element) => element.dataset.field === focused)
        ?? panel.querySelector<HTMLElement>("button[data-field]:not(:disabled)")
        ?? candidates[0];
      target?.focus({ preventScroll: true });
    }
  }
  const offPreview = editor.onPreview(() => {
    const output = panel.querySelector("output");
    if (output) output.textContent = measurementText();
  });
  const off = editor.onChange(() => {
      error = undefined;
      if (changingField || pointerPressed) {
        refreshDraftActions();
        scheduleRender();
      }
      else render();
    }),
    offSelection = viewport.on("selectionchange", render),
    offData = viewport.on("datachange", () => {
      if (!editor.getState().draft) render();
    });
  for (const container of [rail, panel])
    container.addEventListener(
      "keydown",
      (event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement
        )
          return;
        if (
          event.key === "Escape" &&
          editor.getState().draft &&
          editor.getState().phase !== "pending"
        ) {
          event.preventDefault();
          event.stopPropagation();
          editor.cancel();
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          event.stopPropagation();
          const state = editor.getState();
          if (state.draft) {
            if (event.shiftKey && state.canRedo) editor.redo();
            else if (!event.shiftKey && state.canUndo) editor.undo();
          } else if (options.history) {
            if (event.shiftKey) options.history.redo();
            else options.history.undo();
            render();
          }
        }
      },
      { signal: abort.signal },
    );
  function clearReleaseTimer() {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = undefined;
  }
  function destroy() {
    clearReleaseTimer();
    if (disposed) return;
    disposed = true;
    if (renderTimer !== undefined) clearTimeout(renderTimer);
    abort.abort();
    off();
    offPreview();
    offSelection();
    offData();
    offDestroy();
    editor.setActiveSegment(undefined);
    rail.remove();
    panel.remove();
  }
  const offDestroy = viewport.on("destroy", destroy);
  panel.addEventListener("focusout", () => {
    if (!rendering && !pointerPressed) scheduleRender();
  }, { signal: abort.signal });
  panel.addEventListener("pointerdown", () => {
    clearReleaseTimer();
    pointerPressed = true;
    if (renderTimer !== undefined) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
  }, { signal: abort.signal });
  document.addEventListener("click", () => {
    if (!pointerPressed) return;
    endPointerPress();
  }, { signal: abort.signal });
  document.addEventListener("pointerup", () => {
    if (!pointerPressed) return;
    clearReleaseTimer();
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (pointerPressed && !disposed) endPointerPress();
    }, 0);
  }, { signal: abort.signal });
  function endPointerPress() {
    clearReleaseTimer();
    pointerPressed = false;
    scheduleRender();
  }
  document.addEventListener("pointercancel", endPointerPress, { signal: abort.signal });
  document.addEventListener("lostpointercapture", endPointerPress, { signal: abort.signal });
  window.addEventListener("blur", endPointerPress, { signal: abort.signal });
  render();
  return { destroy, refresh: render };
}
