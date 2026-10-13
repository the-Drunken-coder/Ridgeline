import { attachDrawing, attachDrawingControls, createViewport, shapeGeometry } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import type { StyleSpecification } from 'maplibre-gl';
import { captureMapPixels, pixelToCss, waitForVisible } from './browser-observation';



type Context = {
  container: HTMLElement;
  setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string): Promise<void>;
};
const style: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] };
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function clickMap(viewport: Viewport, position: [number, number]) {
  check(window.drawingPointer, 'Native pointer bridge required');
  const point = viewport.map.project(position);
  await window.drawingPointer('click', point.x, point.y);
}
async function click(selector: string) {
  check(window.browserClick, 'Native control bridge required');
  await window.browserClick(selector);
}
function controls(viewport: Viewport, editor: ReturnType<typeof attachDrawing>) {
  const tools = document.createElement('div'), inspector = document.createElement('div');
  document.body.append(tools, inspector);
  const attachment = attachDrawingControls(viewport, editor, { tools, inspector });
  return () => { attachment.destroy(); tools.remove(); inspector.remove(); };
}

export const workflowDrawingCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  {
    name: 'Drawing upgrades holes and exact segments save reload and retain draft history',
    async run({ container, setCurrent, until }) {
      const viewport = createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {} });
      setCurrent(viewport); await viewport.ready;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'polygon-with-hole', properties: {} }), submit: () => ({ accepted: true }) });
      const disposeControls = controls(viewport, editor);
      try {
        editor.start('polygon');
        for (const point of [[-.009, -.006], [.009, -.006], [.009, .006], [-.009, .006]] satisfies [number, number][])
          await clickMap(viewport, point);
        await click('[data-field="action:Add hole"]');
        check(editor.getState().draft?.placingRing === 1, 'Hole placement did not start');
        for (const point of [[-.003, -.002], [.003, -.002], [.003, .002], [-.003, .002]] satisfies [number, number][])
          await clickMap(viewport, point);
        await click('[data-field="action:Finish hole"]');
        check(!editor.getState().draft?.placing, 'Hole placement did not end');
        const highlighted = () => viewport.map.queryRenderedFeatures({ layers: ['rl:draft-active-segment'] });
        const currentSegmentShown = () => {
          const selected = document.querySelector<HTMLSelectElement>('[data-field="Segment"]');
          const ring = document.querySelector<HTMLSelectElement>('[data-field="Ring"]');
          if (!selected || !ring) return false;
          const segment = editor.getSegments().find(item => item.ring === ring.selectedIndex && item.index === Number(selected.value) - 1);
          if (!segment) return false;
          const midpoint = viewport.map.project([(segment.start[0] + segment.end[0]) / 2, (segment.start[1] + segment.end[1]) / 2]);
          return viewport.map.queryRenderedFeatures([[midpoint.x - 2, midpoint.y - 2], [midpoint.x + 2, midpoint.y + 2]], { layers: ['rl:draft-active-segment'] }).length > 0;
        };
        const directionPixels = async () => {
          check(window.browserCaptureMap, 'Composed map screenshot bridge required');
          const selected = document.querySelector<HTMLSelectElement>('[data-field="Segment"]');
          const ring = document.querySelector<HTMLSelectElement>('[data-field="Ring"]');
          check(selected && ring, 'Directed segment controls missing');
          const segment = editor.getSegments().find(item => item.ring === ring.selectedIndex && item.index === Number(selected.value) - 1);
          check(segment, 'Selected directed segment missing');
          const start = viewport.map.project(segment.start), end = viewport.map.project(segment.end);
          const bounds = container.getBoundingClientRect();
          const documentBounds = { left: bounds.left + scrollX, top: bounds.top + scrollY,
            right: bounds.right + scrollX, bottom: bounds.bottom + scrollY };
          const endpointHandle = [...container.querySelectorAll<HTMLButtonElement>('.rl-drawing-handle')].find(button => {
            const box = button.getBoundingClientRect();
            return Math.hypot(box.left + box.width / 2 - bounds.left - end.x, box.top + box.height / 2 - bounds.top - end.y) < 1;
          });
          check(endpointHandle && !endpointHandle.disabled, 'Endpoint edit handle must be present during direction observation');
          viewport.map.setPaintProperty('rl:draft-segment-arrow', 'icon-opacity-transition', { duration: 0, delay: 0 });
          await captureMapPixels(viewport, 2000);
          const captured = await window.browserCaptureMap();
          let withoutHead: string;
          viewport.map.setPaintProperty('rl:draft-segment-arrow', 'icon-opacity', 0);
          try {
            await captureMapPixels(viewport, 2000);
            withoutHead = await window.browserCaptureMap();
          } finally {
            viewport.map.setPaintProperty('rl:draft-segment-arrow', 'icon-opacity', 1);
            await captureMapPixels(viewport, 2000);
          }
          const decode = async (encoded: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            check(context, 'Screenshot pixel context unavailable');
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height);
          };
          const [shown, hidden] = await Promise.all([decode(captured), decode(withoutHead)]);
          check(shown.width === hidden.width && shown.height === hidden.height, 'Composed head observations changed their crop');
          // Element screenshots enclose fractional document bounds with integer
          // CSS pixels. Preserve that crop origin instead of stretching it.
          const crop = { left: Math.floor(documentBounds.left + .001), top: Math.floor(documentBounds.top + .001),
            right: Math.ceil(documentBounds.right - .001), bottom: Math.ceil(documentBounds.bottom - .001) };
          const geometry = { width: shown.width, height: shown.height, cssWidth: crop.right - crop.left,
            cssHeight: crop.bottom - crop.top, origin: 'top-left' as const };
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          check(length > 40, 'Directed segment must be long enough to separate its head from other handles');
          const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
          const wings: [number, number] = [0, 0];
          const foreground = [25, 128, 92];
          for (let y = 0; y < shown.height; y++) for (let x = 0; x < shown.width; x++) {
            const index = (y * shown.width + x) * 4;
            const point = pixelToCss(geometry, { x, y });
            const dx = point.x - (documentBounds.left - crop.left) - end.x;
            const dy = point.y - (documentBounds.top - crop.top) - end.y;
            const behind = -(dx * direction.x + dy * direction.y);
            const side = dx * -direction.y + dy * direction.x;
            if (!(behind > 8 && behind < 22 && Math.abs(side) > 3.5 && Math.abs(side) < 8)) continue;
            // The composed image pair differs only in head opacity. Unchanged
            // shaft pixels and handle glyphs contribute nothing; partially
            // covered edge pixels contribute their visible green ink fraction.
            let ink = 0, fullInk = 0;
            for (const [channel, color] of foreground.entries()) {
              const contrast = hidden.data[index + channel]! - color;
              ink += (hidden.data[index + channel]! - shown.data[index + channel]!) * contrast;
              fullInk += contrast * contrast;
            }
            if (fullInk) wings[side > 0 ? 1 : 0] += Math.max(0, Math.min(1, ink / fullInk));
          }
          const scale = shown.width / geometry.cssWidth * shown.height / geometry.cssHeight;
          const visible = wings.map(count => count / scale);
          window.drawingDirectionObservation = { image: captured, wings: visible, handle: endpointHandle.getAttribute('aria-label') };
          return visible;
        };
        const visibleDirection = async (description: string) => {
          await until(currentSegmentShown, description);
          // Compare visible ink area so rotated, partially covered SDF pixels
          // count without assuming either wing has fully colored pixels.
          await waitForVisible(directionPixels, wings => wings.every(count => count >= 6), { timeout: 8000, description });
        };
        await until(currentSegmentShown, 'selected directed hole segment highlighted');
        await visibleDirection('selected hole direction beside endpoint handle');
        const endpoint = [...container.querySelectorAll<HTMLButtonElement>('.rl-drawing-handle')]
          .find(button => button.getAttribute('aria-label') === window.drawingDirectionObservation?.handle);
        check(endpoint, 'Observed endpoint handle missing before controlled coverage');
        const originalSize = { width: endpoint.style.width, height: endpoint.style.height };
        endpoint.style.width = '40px'; endpoint.style.height = '40px';
        try {
          await waitForVisible(directionPixels, wings => wings.every(count => count < .1), {
            timeout: 8000, description: 'composed pixel criterion detects the head covered by its endpoint handle',
          });
        } finally { endpoint.style.width = originalSize.width; endpoint.style.height = originalSize.height; }
        await visibleDirection('direction restored beside endpoint handle');
        check(window.browserKey, 'Native inspector key bridge required');
        await click('[data-field="Segment"]');
        await window.browserKey('ArrowDown');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Segment"]')?.value === '2' && currentSegmentShown(), 'segment selection updates map');
        await visibleDirection('changed segment direction beside endpoint handle');
        await click('[data-field="Ring"]');
        await window.browserKey('ArrowUp');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Boundary' && currentSegmentShown(), 'boundary selection updates map');
        await visibleDirection('boundary direction beside endpoint handle');
        await click('[data-field="Ring"]');
        await window.browserKey('ArrowDown');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Hole 1' && currentSegmentShown(), 'hole selection restores directed segment');
        await visibleDirection('restored hole direction beside endpoint handle');
        const beforeNumeric = editor.getState().draft!.shape;
        check(window.browserFill && window.browserKey, 'Native numeric input bridge required');
        await window.browserFill('[data-field="Distance (m)"]', '500');
        await window.browserKey('Tab');
        await until(() => Math.abs(editor.getSegments().find(segment => segment.ring === 1 && segment.index === 0)!.length - 500) < .01, 'exact hole segment distance');
        await until(currentSegmentShown, 'highlight follows exact segment edit');
        await visibleDirection('edited segment direction beside endpoint handle');
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(beforeNumeric), 'Numeric undo changed another ring');
        await until(currentSegmentShown, 'highlight follows numeric undo');
        await visibleDirection('undone segment direction beside endpoint handle');
        editor.redo();
        const savedShape = editor.getState().draft!.shape;
        await click('[data-field="action:Finish"]');
        await until(() => Boolean(viewport.getFeature('polygon-with-hole')), 'saved polygon');
        await until(() => highlighted().length === 0 && viewport.map.queryRenderedFeatures({ layers: ['rl:draft-segment-arrow'] }).length === 0, 'submission clears directed segment');
        const saved = viewport.getFeature('polygon-with-hole')!;
        check(saved.geometry.type === 'Polygon' && saved.geometry.coordinates.length === 2, 'Accepted geometry dropped the hole');
        check(JSON.stringify(saved.geometry) === JSON.stringify(shapeGeometry(savedShape)), 'Saved shape and geometry disagree');
        const storage = new Map<string, MapFeature>([[saved.id, structuredClone(saved)]]);
        viewport.upsert([...storage.values()]);
        editor.edit(saved.id);
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(savedShape), 'Reload changed the shape definition');
        await click('[data-field="Ring"]');
        await window.browserKey('ArrowDown');
        await window.browserKey('Tab');
        await until(() => document.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Hole 1', 'saved hole selected');
        const validArea = editor.getMeasurements().area;
        check(validArea !== undefined && validArea > 0, 'Valid hole must have meaningful positive area');
        const areaText = () => document.querySelector<HTMLOutputElement>('[aria-label="Drawing measurements"]')?.textContent ?? '';
        const originalAreaText = areaText();
        check(!originalAreaText.includes('unavailable') && originalAreaText.includes('Area '), 'Valid polygon area was not displayed');
        await window.browserFill('[data-field="Distance (m)"]', '20000');
        await window.browserKey('Tab');
        await until(() => Boolean(editor.getState().validation) && areaText().includes('Area unavailable'), 'invalid hole area unavailable in inspector');
        const invalid = editor.getState();
        check(invalid.measurements.area !== undefined && invalid.measurements.area < 0, 'Oversized hole did not preserve its negative raw area');
        check(editor.getMeasurements().area === invalid.measurements.area, 'Live invalid measurement was clamped or hidden');
        check(invalid.canUndo && invalid.phase === 'editing', 'Invalid draft did not remain editable and undoable');
        check(document.querySelector<HTMLButtonElement>('[data-field="action:Finish"]')?.disabled, 'Invalid Finish control was enabled');
        const distanceField = document.querySelector<HTMLInputElement>('[data-field="Distance (m)"]');
        check(distanceField && !distanceField.disabled, 'Invalid draft numeric editing was disabled or missing');
        check(!(await editor.finish()), 'Invalid hole was submitted');
        check(JSON.stringify(viewport.getFeature(saved.id)) === JSON.stringify(saved), 'Blocked invalid submission changed accepted data');
        check(JSON.stringify(editor.getState().draft) === JSON.stringify(invalid.draft), 'Blocked invalid submission lost the draft');
        await click('[data-field="action:Undo"]');
        await until(() => !editor.getState().validation && areaText() === originalAreaText, 'undo restores meaningful displayed area');
        check(editor.getMeasurements().area === validArea && editor.getState().measurements.area === validArea, 'Undo failed to restore valid raw area');
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(savedShape), 'Invalid-hole undo changed the accepted shape');
        check(JSON.stringify(viewport.getFeature(saved.id)) === JSON.stringify(saved), 'Invalid-hole undo changed accepted data');
        await visibleDirection('invalid-hole undo direction beside endpoint handle');
        editor.removeHole(1);
        editor.undo();
        check(JSON.stringify(shapeGeometry(editor.getState().draft!.shape)) === JSON.stringify(saved.geometry), 'Hole removal undo lost geometry');
        editor.cancel();
        check(JSON.stringify(viewport.getFeature(saved.id)) === JSON.stringify(saved), 'Draft cancellation changed accepted data');
      } finally { disposeControls(); editor.destroy(); viewport.destroy(); }
    },
  },
  {
    name: 'Drawing upgrades edge snapping is opt in respects Alt filters and callback scene changes',
    async run({ container, setCurrent, until }) {
      const edge: MapFeature = { type: 'Feature', id: 'edge', properties: {}, geometry: { type: 'LineString', coordinates: [[-.02, 0], [.02, 0]] } };
      const viewport = createViewport({ container, basemap: style, camera: { center: [0, .004], zoom: 13 }, features: [edge], logger: () => {} });
      setCurrent(viewport); await viewport.ready;
      await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:line'] }).length > 0, 'eligible edge rendered');
      let failFilter = false, moveCamera = false, insidePlacementClick = false, changedDuringClick = false;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'new-line', properties: {} }), submit: () => ({ accepted: true }),
        canSnap: () => {
          if (failFilter) throw new Error('Filter unavailable');
          if (moveCamera) { moveCamera = false; changedDuringClick = insidePlacementClick; viewport.map.jumpTo({ center: [.001, .004] }); }
          return true;
        } });
      try {
        editor.start('line');
        await clickMap(viewport, [0, .012]);
        check(window.drawingPointer && window.browserKeyDown && window.browserKeyUp, 'Native pointer/key bridges required');
        const target = (longitude = 0) => { const point = viewport.map.project([longitude, 0]); return { x: point.x, y: point.y + 6 }; };
        const place = async (longitude = 0) => { const point = target(longitude); await window.drawingPointer!('click', point.x, point.y); };
        const end = () => { const shape = editor.getState().draft!.shape; check(shape.kind === 'line', 'Missing line draft'); return shape.vertices.at(-1)!; };
        await place();
        check(Math.abs(end()[1]) > 1e-5, 'Default unexpectedly enabled edge snapping');
        editor.undo(); editor.setEdgeSnapping(true);
        const edgeTarget = target();
        await window.drawingPointer("move", edgeTarget.x, edgeTarget.y);
        await until(() => Boolean(container.querySelector('.rl-ground-snap-ring[data-snap-kind="edge"]:not([hidden])')), "edge snap feedback");
        check(container.querySelector('.rl-ground-snap-ring')!.getAttribute("stroke-dasharray") === "3 3", "Edge target did not use a dashed ring");
        const vertexTarget = viewport.map.project([-.02, 0]);
        await window.drawingPointer("move", vertexTarget.x + 3, vertexTarget.y + 3);
        await until(() => Boolean(container.querySelector('.rl-ground-snap-ring[data-snap-kind="vertex"]:not([hidden])')), "vertex snap feedback");
        check(container.querySelector('.rl-ground-snap-ring')!.getAttribute("stroke-dasharray") === "none", "Vertex target retained edge feedback");
        await place();
        check(Math.abs(end()[1]) < 1e-9 && Math.abs(end()[0]) < 1e-5, 'Edge snap missed the middle of the visible line');
        editor.undo();
        await window.browserKeyDown('Alt');
        try { await place(); } finally { await window.browserKeyUp('Alt'); }
        check(Math.abs(end()[1]) > 1e-5, 'Alt did not bypass edge snapping');
        editor.undo(); failFilter = true;
        await place();
        check(Math.abs(end()[1]) > 1e-5, 'Failed filter still allowed edge snapping');
        editor.undo(); failFilter = false;
        check(window.browserStationaryClick, 'Native stationary click bridge required');
        const beforeInterruptedClick = target();
        await window.drawingPointer('move', beforeInterruptedClick.x, beforeInterruptedClick.y);
        viewport.map.getCanvas().addEventListener('click', () => { insidePlacementClick = true; moveCamera = true; }, { once: true, capture: true });
        try { await window.browserStationaryClick(); } finally { insidePlacementClick = false; }
        check(changedDuringClick && !moveCamera, 'Camera callback did not execute inside the native placement click');
        const interrupted = editor.getState().draft!.shape;
        check(interrupted.kind === 'line' && interrupted.vertices.length === 1, 'Scene-changing filter placed an obsolete edge target');
        await place();
        check(Math.abs(end()[1]) < 1e-9, 'Edge snapping did not recover after camera change');
        const drawingStyle = editor.getState().draft!.style;
        editor.cancel();
        const crossingShape = { kind: 'line' as const, vertices: [[179.98, 0], [-179.98, 0]] satisfies [number, number][] };
        const longEdge: MapFeature = { ...edge, id: 'long-edge', geometry: shapeGeometry(crossingShape) };
        const renderedAtTarget = (id: string, longitude = 0) => {
          const point = target(longitude);
          return viewport.map.queryRenderedFeatures([[point.x - 12, point.y - 12], [point.x + 12, point.y + 12]], { layers: ['rl:line'] })
            .some(feature => feature.properties._rl_feature_id === id);
        };
        viewport.remove([edge.id]);
        viewport.upsert([longEdge]);
        viewport.map.jumpTo({ center: [0, .004] });
        await until(() => renderedAtTarget(longEdge.id), 'ordinary long GeoJSON edge rendered at its middle');
        editor.start('line');
        await clickMap(viewport, [0, .012]);
        await place();
        check(Math.abs(end()[0]) < 1e-5 && Math.abs(end()[1]) < 1e-9, 'Ordinary long GeoJSON edge was shortened while snapping');
        editor.cancel();
        const crossing: MapFeature = { ...longEdge, id: 'crossing-edge', drawing: { version: 1, shape: crossingShape, style: drawingStyle } };
        viewport.remove([longEdge.id]);
        viewport.upsert([crossing]);
        viewport.map.jumpTo({ center: [180, .004] });
        await until(() => renderedAtTarget(crossing.id, 180), 'saved date-line edge rendered at its middle');
        editor.start('line');
        await clickMap(viewport, [180, .012]);
        await place(180);
        check(Math.abs(Math.abs(end()[0]) - 180) < 1e-5 && Math.abs(end()[1]) < 1e-9, 'Date-line edge snapped to a different world copy');
      } finally { editor.destroy(); viewport.destroy(); }
    },
  },
  {
    name: 'Drawing upgrades touch taps handles cancellation and two finger navigation use native input',
    async run({ container, setCurrent, until }) {
      const viewport = createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {} });
      setCurrent(viewport); await viewport.ready;
      let allowed = true;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'touch-line', properties: {} }), submit: () => ({ accepted: true }), canEdit: () => allowed });
      try {
        check(window.browserTouch, 'Native CDP touch bridge required');
        const touch = window.browserTouch;
        const pagePoint = (position: [number, number]) => {
          const point = viewport.map.project(position), box = viewport.map.getCanvas().getBoundingClientRect();
          return { x: box.left + point.x, y: box.top + point.y };
        };
        const tap = async (position: [number, number]) => {
          await touch('start', [{ id: 0, ...pagePoint(position) }]);
          await touch('end', []);
        };
        editor.start('line');
        await touch('start', [{ id: 0, ...pagePoint([-.005, .004]) }]);
        await until(() => Boolean(editor.getPreview()) && Boolean(container.querySelector('.rl-ground-crosshair:not([hidden])')), 'touch placement preview');
        await touch('cancel', []);
        check(editor.getState().draft?.placed === 0 && !editor.getPreview(), 'Cancelled placement contact retained a point or preview');
        check(!container.querySelector('.rl-ground-crosshair:not([hidden])'), 'Cancelled placement contact retained its reticle');
        await tap([-.003, 0]);
        await until(() => editor.getState().draft?.placed === 1, 'first touch vertex');
        await tap([.003, 0]);
        await until(() => editor.getState().draft?.placed === 2, 'second touch vertex');
        const original = editor.getState().draft!.shape;
        const initialCenter = viewport.map.getCenter();
        const canvasBox = viewport.map.getCanvas().getBoundingClientRect();
        const oneFinger = { x: canvasBox.left + 100, y: canvasBox.top + 80 };
        await touch('start', [{ id: 0, ...oneFinger }]);
        await touch('move', [{ id: 0, x: oneFinger.x + 45, y: oneFinger.y + 20 }]);
        await touch('end', []);
        await new Promise(resolve => setTimeout(resolve, 250));
        check(JSON.stringify(viewport.map.getCenter().toArray()) === JSON.stringify(initialCenter.toArray()) && editor.getState().draft?.placed === 2,
          'One-finger canvas drawing panned or placed a point during a drag');

        const first = pagePoint([-.002, -.003]), second = { x: first.x + 80, y: first.y };
        await touch('start', [{ id: 0, ...first }]);
        await touch('start', [{ id: 0, ...first }, { id: 1, ...second }]);
        for (let i = 1; i <= 6; i++) await touch('move', [
          { id: 0, x: first.x + i * 8, y: first.y + i * 4 }, { id: 1, x: second.x + i * 8, y: second.y + i * 4 },
        ]);
        await touch('end', [{ id: 0, x: first.x + 48, y: first.y + 24 }]);
        await touch('move', [{ id: 0, x: first.x + 80, y: first.y + 24 }]);
        await touch('end', []);
        await until(() => !viewport.map.isMoving(), 'touch camera settled');
        check(Math.abs(viewport.map.getCenter().lng - initialCenter.lng) > 1e-5, 'Two-finger native pan did not move the camera');
        check(editor.getState().draft?.placed === 2, 'Navigation added a vertex after one finger lifted');
        const handle = () => {
          const button = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
          check(button, 'First editing handle missing');
          const box = button.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        };
        let point = handle();
        await touch('start', [{ id: 0, ...point }]);
        await touch('move', [{ id: 0, x: point.x + 35, y: point.y + 20 }]);
        await touch('end', []);
        check(JSON.stringify(editor.getState().draft!.shape) !== JSON.stringify(original), 'Native touch handle drag changed no geometry');
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Touch drag did not create one undo action');
        point = handle();
        await touch('start', [{ id: 0, ...point }]);
        await touch('move', [{ id: 0, x: point.x + 20, y: point.y + 12 }]);
        const partial = editor.getState().draft!.shape;
        await touch('cancel', []);
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(partial), 'Touch cancellation discarded last valid movement');
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Cancelled touch gesture was not one undo action');
        point = handle();
        await touch('start', [{ id: 0, ...point }]);
        await touch('move', [{ id: 0, x: point.x + 20, y: point.y + 12 }]);
        const permitted = editor.getState().draft!.shape;
        allowed = false; editor.refreshPermissions();
        await touch('move', [{ id: 0, x: point.x + 60, y: point.y + 12 }]);
        await touch('end', []);
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(permitted), 'Permission loss continued a stale touch drag');
        allowed = true; editor.refreshPermissions();
        editor.undo();
        check(JSON.stringify(editor.getState().draft!.shape) === JSON.stringify(original), 'Permission-interrupted gesture was not undoable');
        check(await editor.finish(), 'Touch draft did not finish');
        check(viewport.getFeature('touch-line')?.geometry.type === 'LineString', 'Touch draft was not accepted');
      } finally { editor.destroy(); viewport.destroy(); }
    },
  },
  {
    name: 'Drawing upgrades touch survives live updates with atomic drag history',
    async run({ container, setCurrent, until }) {
      const viewport = createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 13 }, logger: () => {},
        features: [{ type: 'Feature', id: 'live', geometry: { type: 'Point', coordinates: [.01, .01] }, properties: {} }] });
      setCurrent(viewport); await viewport.ready;
      const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'touch-line', properties: {} }), submit: () => ({ accepted: true }) });
      let n = 0;
      const timer = setInterval(() => viewport.upsert([{ type: 'Feature', id: 'live', geometry: { type: 'Point', coordinates: [.01 + (++n % 10) * 1e-5, .01] }, properties: {} }]), 33);
      try {
        check(window.browserTouch, 'Native CDP touch bridge required');
        const touch = window.browserTouch;
        const pagePoint = (position: [number, number]) => {
          const point = viewport.map.project(position), box = viewport.map.getCanvas().getBoundingClientRect();
          return { x: box.left + point.x, y: box.top + point.y };
        };
        editor.start('line');
        let placedTaps = 0;
        for (let i = 0; i < 5; i++) {
          const before = editor.getState().draft!.placed;
          await touch('start', [{ id: 0, ...pagePoint([-.006 + i * .003, 0]) }]);
          await new Promise(r => setTimeout(r, 40));
          await touch('end', []);
          for (let t = 0; t < 75 && editor.getState().draft!.placed <= before; t++) await new Promise(r => setTimeout(r, 20));
          if (editor.getState().draft!.placed > before) placedTaps++;
          await new Promise(r => setTimeout(r, 400));
        }

        check(placedTaps === 5, `Live updates discarded ${5 - placedTaps} of 5 touch taps`);
        editor.setSnapping(false);
        const original = JSON.stringify(editor.getState().draft!.shape);
        const button = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]');
        check(button, 'Touch handle missing after placement');
        const trace: string[] = [];
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => trace.push(type));
        const box = button.getBoundingClientRect(), start = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const target = document.elementFromPoint(start.x, start.y);
        check(target && (target === button || button.contains(target)), `Touch handle is covered by ${target?.outerHTML}; pointerEvents=${getComputedStyle(button).pointerEvents}`);
        await touch('start', [{ id: 0, ...start }]);
        await touch('move', [{ id: 0, x: start.x + 20, y: start.y + 12 }]);
        const partial = JSON.stringify(editor.getState().draft!.shape);
        check(partial !== original, `Touch drag did not begin: ${trace.join(',')}; phase=${editor.getState().phase}; shape=${original}; box=${JSON.stringify(box)}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        await touch('move', [{ id: 0, x: start.x + 45, y: start.y + 24 }]);
        await touch('end', []);
        const complete = JSON.stringify(editor.getState().draft!.shape);
        check(complete !== partial, 'Live updates stole the active touch handle drag');
        editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === original, 'Live touch drag was split into multiple undo entries');
        editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === complete, 'Live touch drag redo lost completed geometry');
      } finally { clearInterval(timer); editor.destroy(); viewport.destroy(); }
    },
  },

  { name: 'Drawing upgrades snapping toggles retain native keyboard focus', async run({ container, setCurrent, until }) {
    const viewport = createViewport({ container, basemap: style, logger: () => {} }); setCurrent(viewport);
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'line', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement("div"), inspector = document.createElement("div");
    document.body.append(tools, inspector);
    const controls = attachDrawingControls(viewport, editor, { tools, inspector });
    try {
      await viewport.ready; editor.start('line');
      check(window.browserClick && window.browserKey, 'Native checkbox keyboard bridge unavailable');
      await window.browserClick('.rl-drawing-snap:has-text("Snapping") input');
      await window.browserKey('Space');
      check(document.activeElement instanceof HTMLInputElement && document.activeElement.closest('.rl-drawing-snap'), 'Snapping rerender lost focus');
      check(editor.getSnapping(), 'Keyboard did not restore snapping');
      await window.browserKey('Tab'); await window.browserKey('Space');
      check(document.activeElement instanceof HTMLInputElement && document.activeElement.checked && editor.getEdgeSnapping(), 'Edge snapping rerender lost usable keyboard focus');
    } finally { controls.destroy(); tools.remove(); inspector.remove(); editor.destroy(); viewport.destroy(); }
  } },
  { name: 'Drawing upgrades mouse gesture ownership survives live updates and retires on blur', async run({ container, setCurrent, until }) {
    const viewport = createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 15 }, logger: () => {} }); setCurrent(viewport);
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'line', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      await viewport.ready; editor.start('line'); editor.addPoint([-.003, 0]); editor.addPoint([.003, 0]); editor.setSnapping(false);
      check(window.browserMouse && window.browserClick, 'Native mouse bridge unavailable');
      const button = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]'); check(button, 'Mouse handle absent');
      const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const trace: string[] = [];
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => trace.push(type));
      editor.onChange(() => trace.push(JSON.stringify(editor.getState().draft!.shape)));
      const original = JSON.stringify(editor.getState().draft!.shape);
      await window.browserMouse('down', x, y); await window.browserMouse('move', x + 20, y + 10);
      const partial = JSON.stringify(editor.getState().draft!.shape); check(partial !== original, 'Mouse drag never began');
      viewport.upsert([{ type: 'Feature', id: 'live', properties: {}, geometry: { type: 'Point', coordinates: [.01, .01] } }]);
      viewport.setCamera({ bearing: 12 });
      await window.browserMouse('move', x + 40, y + 20);
      const live = JSON.stringify(editor.getState().draft!.shape); check(live !== partial, `Data/camera frames ended the active mouse gesture: ${trace.join(';')}`);
      // Delivered blur is supporting cancellation evidence; handle movement uses native input.
      window.dispatchEvent(new Event('blur'));
      await window.browserMouse('move', x + 70, y + 30); await window.browserMouse('up', x + 70, y + 30);
      check(JSON.stringify(editor.getState().draft!.shape) === live, 'Blur failed to retire the mouse gesture');
      editor.undo(); check(JSON.stringify(editor.getState().draft!.shape) === original, 'Mouse interruption split draft history');
      editor.redo(); check(JSON.stringify(editor.getState().draft!.shape) === live, 'Mouse interruption redo lost the partial draft');
    } finally { editor.destroy(); viewport.destroy(); }
  } },

  { name: 'Drawing upgrades numeric validation updates while keyboard focus stays in the field', async run({ container, setCurrent, until }) {
    const viewport = createViewport({ container, basemap: style, camera: { center: [0, 0], zoom: 15 }, logger: () => {} }); setCurrent(viewport);
    const editor = attachDrawing(viewport, { createFeature: () => ({ id: 'polygon', properties: {} }), submit: () => ({ accepted: true }) });
    const tools = document.createElement('div'), inspector = document.createElement('div'); document.body.append(tools, inspector);
    const controls = attachDrawingControls(viewport, editor, { tools, inspector });
    try {
      await viewport.ready; editor.start('polygon');
      for (const point of [[-.005, -.005], [.005, -.005], [.005, .005], [-.005, .005]] as [number, number][]) editor.addPoint(point);
      editor.finishRing(); editor.startHole();
      for (const point of [[-.002, -.002], [.002, -.002], [.002, .002], [-.002, .002]] as [number, number][]) editor.addPoint(point);
      editor.finishRing();
      check(!editor.getState().validation, 'Numeric validation fixture is invalid');
      check(window.browserFill && window.browserKey && window.browserClick, 'Native field bridge unavailable');
      await window.browserClick('[data-field="Ring"]'); await window.browserKey('ArrowDown'); await window.browserKey('Tab');
      await until(() => inspector.querySelector<HTMLSelectElement>('[data-field="Ring"]')?.value === 'Hole 1', 'choose the hole segment');
      await window.browserFill('[data-field="Distance (m)"]', '100000'); await window.browserKey('Tab');
      await until(() => Boolean(editor.getState().validation), 'numeric edit creates invalid topology');
      check(document.activeElement instanceof HTMLInputElement && inspector.contains(document.activeElement), 'Numeric edit lost field focus');
      const validation = editor.getState().validation;
      check(inspector.querySelector('.rl-drawing-note')?.textContent === validation, 'Focused numeric edit left textual validation stale');
      await window.browserKey('Tab');
      check(inspector.querySelector('.rl-drawing-note')?.textContent === validation, 'Tab to another input hid textual validation');
      await window.browserClick('[data-field="action:Undo"]');
      check(!editor.getState().validation && !inspector.querySelector('.rl-drawing-note'), 'Numeric undo left stale validation');
    } finally { controls.destroy(); tools.remove(); inspector.remove(); editor.destroy(); viewport.destroy(); }
  } },
];
