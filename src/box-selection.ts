import { getViewportDrawingInternals } from './viewport';
import type { Properties, Viewport } from './types';

/** Alt-left owns only its rectangle; native Shift box zoom and other navigation keep their input. */
export function attachBoxSelection<P extends Properties>(viewport: Viewport<P>, beforeStart: () => void) {
  const canvas = viewport.map.getCanvas(), abort = new AbortController();
  const subscriptions: (() => void)[] = [];
  let disposed = false, suppressClick = false, completing = false, revision = 0;
  type Gesture = { pointer: number; start: { x: number; y: number }; end: { x: number; y: number }; additive: boolean;
    element: HTMLDivElement; release?: () => void };
  let gesture: Gesture | undefined;
  const point = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left - canvas.clientLeft, y: event.clientY - bounds.top - canvas.clientTop };
  };
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  function clearGesture() {
    const previous = gesture;
    gesture = undefined;
    if (!previous) return;
    suppressClick = true;
    previous.element.remove();
    if (canvas.hasPointerCapture(previous.pointer)) canvas.releasePointerCapture(previous.pointer);
    previous.release?.();
  }
  function cancel() { revision++; clearGesture(); }
  const invalidate = cancel;
  function dataChanged() { revision++; }
  function draw() {
    if (!gesture) return;
    const { start, end, element } = gesture;
    element.style.left = `${Math.min(start.x, end.x)}px`; element.style.top = `${Math.min(start.y, end.y)}px`;
    element.style.width = `${Math.abs(end.x - start.x)}px`; element.style.height = `${Math.abs(end.y - start.y)}px`;
  }
  canvas.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (disposed || gesture || viewport.map.isMoving() || event.pointerType !== 'mouse' || event.button !== 0 || !event.altKey || viewport.getInteractionOwner()) return;
    const version = revision;
    beforeStart();
    if (disposed || revision !== version || viewport.map.isMoving() || viewport.getInteractionOwner()) return;
    const start = point(event), element = document.createElement('div');
    element.className = 'rl-selection-box'; element.setAttribute('aria-hidden', 'true');
    const next: Gesture = { pointer: event.pointerId, start, end: start, additive: event.shiftKey, element };
    gesture = next;
    const release = viewport.acquireInteraction('rectangle-selection');
    if (disposed || gesture !== next || viewport.getInteractionOwner() !== 'rectangle-selection') { release(); return; }
    next.release = release; viewport.map.getCanvasContainer().append(element); draw();
    canvas.setPointerCapture(event.pointerId); consume(event);
  }, { capture: true, signal: abort.signal });
  canvas.addEventListener('mousedown', event => { if (gesture) consume(event); }, { capture: true, signal: abort.signal });
  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (!(event.buttons & 1)) { cancel(); return; }
    gesture.end = point(event); draw(); consume(event);
  }, { capture: true, signal: abort.signal });
  document.addEventListener('pointerup', event => {
    const previous = gesture;
    if (!previous || event.pointerId !== previous.pointer) return;
    previous.end = point(event); consume(event); suppressClick = true;
    // Query while owning the gesture. Release may synchronously give drawing ownership to another observer.
    const version = revision;
    let result: ReturnType<Viewport<P>['queryFeatures']> | undefined;
    try { result = viewport.queryFeatures([previous.start, previous.end]); }
    catch (cause) { viewport.reportCallbackError(cause, 'boxSelection'); }
    finally {
      completing = true;
      try { clearGesture(); } finally { completing = false; }
    }
    if (!result) return;
    const ids = result.features.map(feature => feature.id);
    const moved = Math.hypot(previous.end.x - previous.start.x, previous.end.y - previous.start.y) >= 3;
    if (!disposed && revision === version && moved && !viewport.getInteractionOwner()) {
      viewport.requestSelection(previous.additive ? [...new Set([...viewport.getSelection(), ...ids])] : ids, result.attachments);
    }
  }, { capture: true, signal: abort.signal });
  canvas.addEventListener('click', event => { if (suppressClick) { suppressClick = false; consume(event); } }, { capture: true, signal: abort.signal });
  document.addEventListener('pointercancel', cancel, { capture: true, signal: abort.signal });
  canvas.addEventListener('lostpointercapture', cancel, { signal: abort.signal });
  window.addEventListener('blur', cancel, { signal: abort.signal });
  document.addEventListener('keydown', event => {
    if (gesture && event.key === 'Escape') { consume(event); cancel(); }
  }, { capture: true, signal: abort.signal });
  viewport.map.on('movestart', invalidate); viewport.map.on('move', invalidate); viewport.map.on('resize', invalidate); viewport.map.on('style.load', invalidate);
  subscriptions.push(viewport.on('datachange', dataChanged), viewport.on('entitychange', dataChanged),
    viewport.on('interactionchange', ({ owner }) => { if ((gesture && owner !== 'rectangle-selection') || (completing && owner)) invalidate(); }));
  const internals = getViewportDrawingInternals(viewport);
  if (internals) subscriptions.push(internals.onSceneChange(invalidate));
  function destroy() {
    if (disposed) return;
    disposed = true; cancel(); abort.abort();
    viewport.map.off('movestart', invalidate); viewport.map.off('move', invalidate); viewport.map.off('resize', invalidate); viewport.map.off('style.load', invalidate);
    for (const unsubscribe of subscriptions) unsubscribe();
  }
  subscriptions.push(viewport.on('destroy', destroy));
  return { destroy, cancel };
}
