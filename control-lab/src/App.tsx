import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import streets from './assets/boston-streets.json';
import { beacon, createScene, frameUnits, homeCamera, mapScale, reducer, toScreen, zoomAt, type Point, type Viewport } from './model';
import { useControls } from './useControls';

const labels = [{ name: 'BEACON HILL', x: 385, y: 160 }, { name: 'BOSTON COMMON', x: 310, y: 505 }, { name: 'DOWNTOWN', x: 675, y: 460 }];

export function App() {
  const [scene, dispatch] = useReducer(reducer, undefined, createScene);
  const [viewport, setViewport] = useState<Viewport>({ width: 900, height: 540 });
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLButtonElement>(null);
  useControls(stageRef, surfaceRef, scene, dispatch, viewport);
  const scale = mapScale(viewport, scene.camera);
  const screen = (point: Point) => toScreen(point, scene.camera, viewport);
  const path = (points: Point[]) => points.map((point, i) => { const p = screen(point); return `${i ? 'L' : 'M'}${p.x},${p.y}`; }).join(' ');
  const focusMap = () => surfaceRef.current?.focus({ preventScroll: true });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => setViewport({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  function zoom(factor: number) { dispatch({ type: 'camera', camera: zoomAt(scene.camera, viewport, { x: viewport.width / 2, y: viewport.height / 2 }, factor) }); focusMap(); }

  return <div className="app">
    <header><span className="brand">RIDGELINE</span><span>Everyday map</span><span className="prototype">Simulated units</span></header>
    <main>
      <p id="control-help" className="hint">Drag to pan. Scroll to zoom. Select a unit, choose Move here, then click a destination.</p>
      <div ref={stageRef} className="stage">
        <button ref={surfaceRef} type="button" className={`map-surface ${scene.armed ? 'targeting' : ''}`} aria-label="Map. Click to focus keyboard controls." aria-describedby="control-help">
          <svg width={viewport.width} height={viewport.height} aria-hidden="true">
            <g transform={`translate(${viewport.width / 2 + scene.camera.x - 500 * scale},${viewport.height / 2 + scene.camera.y - 310 * scale}) scale(${scale})`}><path className="roads" d={streets.path} /></g>
            {scene.trails.map((trail, i) => <path key={`trail-${i}`} className="trail" d={path(trail.points)} />)}
          </svg>
        </button>
        {labels.map(label => <span className="map-label" key={label.name} style={{ left: screen(label).x, top: screen(label).y }}>{label.name}</span>)}
        <span className="beacon" style={{ left: screen(beacon).x, top: screen(beacon).y }}>◎ Beacon</span>
        {scene.units.map(unit => { const p = screen(unit); return <button type="button" key={unit.id} className="unit" data-unit={unit.id} aria-label={`Select ${unit.name}`} aria-pressed={scene.selected.includes(unit.id)} style={{ left: p.x, top: p.y }} onClick={event => { if (event.detail === 0) dispatch({ type: 'select', id: unit.id, additive: event.shiftKey }); }}>{unit.name}</button>; })}
        <div className="overlay top-left"><strong>{scene.selected.length ? scene.selected.join(' + ') : 'No selection'}</strong><span className="panel-label">Unit inspector</span><div className="row"><button disabled={!scene.selected.length} aria-pressed={scene.armed} onClick={() => { dispatch({ type: 'arm' }); focusMap(); }}>{scene.armed ? 'Click destination' : 'Move here'}</button><button disabled={!scene.selected.length} onClick={() => { dispatch({ type: 'camera', camera: frameUnits(scene.units.filter(unit => scene.selected.includes(unit.id)), scene.camera, viewport) }); focusMap(); }}>Frame</button></div></div>
        <div className="zoom"><button onClick={() => zoom(1.25)} aria-label="Zoom in">+</button><button onClick={() => zoom(0.8)} aria-label="Zoom out">−</button><button onClick={() => { dispatch({ type: 'camera', camera: homeCamera }); focusMap(); }} aria-label="Reset camera">Fit</button></div>
      </div>
      <div className="status"><span role="status">{scene.message}</span><span className="selection">{scene.selected.length} selected · {Math.round(scene.camera.zoom * 100)}%</span></div>
      <div className="actions"><button onClick={() => { dispatch({ type: 'reset' }); focusMap(); }}>Reset scene</button></div>
    </main>
    <footer><span>Desktop mouse / trackpad</span><span>Orders jump to destination. Routes remain visible.</span><a href={streets.source} target="_blank" rel="noreferrer">Streets: City of Boston</a></footer>
  </div>;
}
