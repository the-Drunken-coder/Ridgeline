import { useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject } from 'react';
import { toWorld, zoomAt, type Action, type Camera, type Point, type Scene, type Viewport } from './model';

type Gesture = { pointer: number; start: Point; camera: Camera; moved: boolean };

/** The map surface owns pan and destination gestures. Unit buttons own selection. */
export function useControls(
  stageRef: RefObject<HTMLDivElement | null>, surfaceRef: RefObject<HTMLButtonElement | null>,
  scene: Scene, dispatch: Dispatch<Action>, viewport: Viewport,
) {
  const sceneRef = useRef(scene);
  useLayoutEffect(() => { sceneRef.current = scene; }, [scene]);

  useEffect(() => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface) return;
    const abort = new AbortController();
    const options = { signal: abort.signal };
    let gesture: Gesture | undefined;
    let space = false;

    const point = (event: MouseEvent): Point => {
      const rect = stage.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const clearGesture = () => {
      if (gesture && surface.hasPointerCapture(gesture.pointer)) surface.releasePointerCapture(gesture.pointer);
      gesture = undefined;
    };
    const cancelInterrupted = () => { clearGesture(); space = false; };

    stage.addEventListener('pointerdown', event => {
      if (gesture || (event.button !== 0 && event.button !== 1) || !(event.target instanceof Element)) return;
      const unit = sceneRef.current.units.find(unit => event.target instanceof Element && event.target.closest('[data-unit]')?.getAttribute('data-unit') === unit.id);
      if (unit && event.button === 0 && !space) {
        dispatch({ type: 'select', id: unit.id, additive: event.shiftKey });
        surface.focus({ preventScroll: true });
        event.preventDefault();
        return;
      }
      if (!event.target.closest('.map-surface') && !unit) return;
      const p = point(event);
      gesture = { pointer: event.pointerId, start: p, camera: sceneRef.current.camera, moved: false };
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
      event.preventDefault();
    }, options);

    stage.addEventListener('pointermove', event => {
      if (!gesture || event.pointerId !== gesture.pointer) return;
      const p = point(event);
      const delta = { x: p.x - gesture.start.x, y: p.y - gesture.start.y };
      gesture.moved ||= Math.hypot(delta.x, delta.y) > 5;
      if (gesture.moved) dispatch({ type: 'camera', camera: { ...gesture.camera, x: gesture.camera.x + delta.x, y: gesture.camera.y + delta.y } });
    }, options);

    stage.addEventListener('pointerup', event => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const moved = gesture.moved;
      const p = point(event);
      clearGesture();
      if (!moved && event.button === 0 && !space && sceneRef.current.armed) {
        dispatch({ type: 'move', point: toWorld(p, sceneRef.current.camera, viewport) });
      }
    }, options);
    stage.addEventListener('pointercancel', cancelInterrupted, options);
    surface.addEventListener('lostpointercapture', () => { if (gesture) cancelInterrupted(); }, options);
    surface.addEventListener('wheel', event => {
      event.preventDefault();
      if (gesture) return;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
      dispatch({ type: 'camera', camera: zoomAt(sceneRef.current.camera, viewport, point(event), Math.exp(-pixels * 0.0015)) });
    }, { ...options, passive: false });
    stage.addEventListener('keydown', event => {
      if (event.key === 'Escape') { dispatch({ type: 'cancel' }); clearGesture(); surface.focus({ preventScroll: true }); }
      if (event.key === ' ' && event.target === surface) { space = true; event.preventDefault(); }
    }, options);
    window.addEventListener('keyup', event => { if (event.key === ' ') space = false; }, options);
    window.addEventListener('blur', cancelInterrupted, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelInterrupted(); }, options);
    return () => { abort.abort(); clearGesture(); };
  }, [stageRef, surfaceRef, dispatch, viewport]);
}
