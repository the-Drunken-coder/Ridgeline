import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject } from 'react';
import { frameUnits, lineFormation, toScreen, toWorld, zoomAt, type Action, type Camera, type Placement, type Point, type Scene, type UnitId, type Viewport } from './model';

type Gesture = {
  pointer: number;
  kind: 'pan' | 'box' | 'route' | 'formation' | 'unit';
  start: Point;
  end: Point;
  camera: Camera;
  world: Point;
  moved: boolean;
  additive: boolean;
  ids: UnitId[];
  unit?: UnitId;
  points: Point[];
};

export type GesturePreview = { box?: { start: Point; end: Point }; placement?: Placement };
export type ContextMenu = { screen: Point; world: Point };

/** One input owner prevents scheme shortcuts and map gestures from competing. */
export function useControls(
  stageRef: RefObject<HTMLDivElement | null>, surfaceRef: RefObject<HTMLButtonElement | null>,
  scene: Scene, dispatch: Dispatch<Action>, viewport: Viewport, edgePan: boolean,
) {
  const sceneRef = useRef(scene);
  const [preview, setPreview] = useState<GesturePreview>({});
  const [context, setContext] = useState<ContextMenu | null>(null);
  useLayoutEffect(() => { sceneRef.current = scene; }, [scene]);

  useEffect(() => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface) return;
    const abort = new AbortController();
    const options = { signal: abort.signal };
    let gesture: Gesture | undefined;
    let space = false;
    let frame = 0;
    let lastFrame = 0;
    let edge: Point = { x: 0, y: 0 };

    const point = (event: MouseEvent): Point => {
      const rect = stage.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const world = (p: Point) => toWorld(p, sceneRef.current.camera, viewport);
    const stopEdge = () => { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; edge = { x: 0, y: 0 }; };
    const clearGesture = () => {
      if (gesture && surface.hasPointerCapture(gesture.pointer)) surface.releasePointerCapture(gesture.pointer);
      gesture = undefined;
      setPreview({});
    };
    const cancel = () => { clearGesture(); stopEdge(); space = false; setContext(null); dispatch({ type: 'cancel' }); };
    const tick = (time: number) => {
      if (gesture || !edgePan || sceneRef.current.scheme !== 'rts' || (!edge.x && !edge.y)) { stopEdge(); return; }
      const seconds = lastFrame ? Math.min(time - lastFrame, 32) / 1000 : 0;
      lastFrame = time;
      dispatch({ type: 'pan', delta: { x: -edge.x * seconds * 260, y: -edge.y * seconds * 260 } });
      frame = requestAnimationFrame(tick);
    };

    stage.addEventListener('pointerdown', event => {
      if (gesture || (event.button !== 0 && event.button !== 1) || !(event.target instanceof Element)) return;
      const current = sceneRef.current;
      if (current.scheme === 'rts' && event.ctrlKey) return;
      const unit = current.units.find(unit => event.target instanceof Element && event.target.closest('[data-unit]')?.getAttribute('data-unit') === unit.id);
      if (!unit && !event.target.closest('.map-surface')) return;
      stopEdge(); setContext(null); surface.focus({ preventScroll: true });
      const navigating = space || event.button === 1;
      if (unit && !navigating) {
        dispatch({ type: 'toggle-unit', id: unit.id, additive: event.shiftKey });
        if (current.scheme !== 'direct') return;
      }
      const p = point(event);
      let kind: Gesture['kind'] = 'pan';
      if (unit && !navigating) kind = 'unit';
      else if (!space && event.button === 0 && !current.armed) {
        if (current.scheme === 'rts' || (current.scheme === 'tools' && current.tool === 'select')) kind = 'box';
        if (current.scheme === 'route') kind = 'route';
        if (current.scheme === 'formation') kind = 'formation';
      }
      if ((kind === 'route' || kind === 'formation') && !current.selected.length) {
        dispatch({ type: 'message', message: 'Select at least one unit.' }); return;
      }
      gesture = { pointer: event.pointerId, kind, start: p, end: p, camera: current.camera, world: world(p), moved: false,
        additive: event.shiftKey, unit: kind === 'unit' ? unit?.id : undefined, ids: [...current.selected], points: [world(p)] };
      if (kind === 'route' || kind === 'formation') dispatch({ type: 'cancel' });
      surface.setPointerCapture(event.pointerId);
      event.preventDefault();
    }, options);

    stage.addEventListener('pointermove', event => {
      const p = point(event);
      if (!gesture) {
        if (sceneRef.current.scheme === 'rts' && edgePan && event.pointerType === 'mouse' && event.target instanceof Element && event.target.closest('.map-surface')) {
          edge = { x: p.x < 22 ? -1 : p.x > viewport.width - 22 ? 1 : 0, y: p.y < 22 ? -1 : p.y > viewport.height - 22 ? 1 : 0 };
          if (!frame && (edge.x || edge.y)) frame = requestAnimationFrame(tick);
          if (!edge.x && !edge.y) stopEdge();
        } else stopEdge();
        return;
      }
      if (event.pointerId !== gesture.pointer) return;
      gesture.end = p;
      const delta = { x: p.x - gesture.start.x, y: p.y - gesture.start.y };
      gesture.moved ||= Math.hypot(delta.x, delta.y) > 5;
      if (!gesture.moved) return;
      switch (gesture.kind) {
        case 'pan': dispatch({ type: 'camera', camera: { ...gesture.camera, x: gesture.camera.x + delta.x, y: gesture.camera.y + delta.y } }); break;
        case 'unit': if (gesture.unit) setPreview({ placement: { id: gesture.unit, ...world(p) } }); break;
        case 'box': setPreview({ box: { start: gesture.start, end: p } }); break;
        case 'route': {
          const last = gesture.points.at(-1);
          const lastScreen = last ? toScreen(last, sceneRef.current.camera, viewport) : p;
          if (Math.hypot(p.x - lastScreen.x, p.y - lastScreen.y) > 4) gesture.points.push(world(p));
          dispatch({ type: 'route', points: [...gesture.points] }); break;
        }
        case 'formation': dispatch({ type: 'formation', placements: lineFormation(gesture.ids, gesture.world, world(p)) }); break;
      }
    }, options);

    stage.addEventListener('pointerup', event => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const ended = gesture;
      const p = point(event);
      clearGesture();
      const current = sceneRef.current;
      if (ended.moved) {
        if (ended.kind === 'unit' && ended.unit) dispatch({ type: 'place', placement: { id: ended.unit, ...world(p) } });
        if (ended.kind === 'box') {
          const ids = current.units.filter(unit => {
            const screen = toScreen(unit, current.camera, viewport);
            return screen.x >= Math.min(ended.start.x, p.x) && screen.x <= Math.max(ended.start.x, p.x)
              && screen.y >= Math.min(ended.start.y, p.y) && screen.y <= Math.max(ended.start.y, p.y);
          }).map(unit => unit.id);
          dispatch({ type: 'select', ids, additive: ended.additive });
        }
        if (ended.kind === 'route') dispatch({ type: 'route', points: [...ended.points, world(p)] });
        return;
      }
      if (ended.unit || event.button === 1 || space) return;
      if (current.armed || (current.scheme === 'tools' && current.tool === 'move') || current.scheme === 'plan') dispatch({ type: 'move', point: world(p) });
      else if (current.scheme === 'radial') setContext({ screen: p, world: world(p) });
      else if (ended.kind === 'box' && !ended.additive) dispatch({ type: 'select', ids: [] });
    }, options);
    stage.addEventListener('pointercancel', cancel, options);
    surface.addEventListener('lostpointercapture', () => { if (gesture) cancel(); }, options);
    stage.addEventListener('pointerleave', stopEdge, options);
    stage.addEventListener('contextmenu', event => {
      if (sceneRef.current.scheme !== 'rts' || !(event.target instanceof Element) || !event.target.closest('.map-surface')) return;
      event.preventDefault(); stopEdge(); dispatch({ type: 'move', point: world(point(event)) });
    }, options);
    surface.addEventListener('wheel', event => {
      event.preventDefault();
      if (gesture) return;
      stopEdge(); setContext(null);
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
      dispatch({ type: 'camera', camera: zoomAt(sceneRef.current.camera, viewport, point(event), Math.exp(-pixels * 0.0015)) });
    }, { ...options, passive: false });

    stage.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = sceneRef.current;
      const key = event.key.toLowerCase();
      if (key === 'escape') { cancel(); surface.focus({ preventScroll: true }); return; }
      if (key === ' ' && event.target === surface) { space = true; event.preventDefault(); }
      if (gesture) return;
      if (current.scheme === 'route' && key === 'enter' && event.target === surface) { event.preventDefault(); dispatch({ type: 'send-route' }); }
      if (current.scheme !== 'keys' && current.scheme !== 'rts') return;
      const unit = current.units[Number(key) - 1];
      if (['1', '2', '3'].includes(key) && unit) dispatch({ type: 'select', ids: [unit.id] });
      if (key === 'm') dispatch({ type: 'arm' });
      if (key === 'h') dispatch({ type: 'hold' });
      if (key === 'f') dispatch({ type: 'camera', camera: frameUnits(current.units.filter(u => current.selected.includes(u.id)), current.camera, viewport) });
      const directions: Record<string, Point> = { arrowup: { x: 0, y: 28 }, arrowdown: { x: 0, y: -28 }, arrowleft: { x: 28, y: 0 }, arrowright: { x: -28, y: 0 } };
      if (current.scheme === 'keys') Object.assign(directions, { w: directions.arrowup, s: directions.arrowdown, a: directions.arrowleft, d: directions.arrowright });
      const delta = directions[key];
      if (delta) { event.preventDefault(); dispatch({ type: 'pan', delta }); }
    }, options);
    window.addEventListener('keyup', event => { if (event.key === ' ') space = false; }, options);
    window.addEventListener('blur', cancel, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
    return () => { abort.abort(); clearGesture(); stopEdge(); setContext(null); };
  }, [stageRef, surfaceRef, scene.scheme, dispatch, viewport, edgePan]);

  return { preview, context, closeContext: () => setContext(null) };
}
