import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import streets from './assets/boston-streets.json';
import { Controls } from './Controls';
import { beacon, createScene, frameUnits, homeCamera, mapScale, reducer, toScreen, zoomAt, type Point, type Viewport } from './model';
import { readPreferences, writePreferences } from './preferences';
import { schemes, type SchemeId } from './schemes';
import { useControls } from './useControls';

const labels = [{ name: 'BEACON HILL', x: 385, y: 160 }, { name: 'BOSTON COMMON', x: 310, y: 505 }, { name: 'DOWNTOWN', x: 675, y: 460 }];

export function App() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [scene, dispatch] = useReducer(reducer, preferences.scheme, createScene);
  const [viewport, setViewport] = useState<Viewport>({ width: 900, height: 540 });
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLButtonElement>(null);
  const { preview, context, closeContext } = useControls(stageRef, surfaceRef, scene, dispatch, viewport, preferences.edgePan);
  const scheme = schemes.find(scheme => scheme.id === scene.scheme) ?? schemes[0];
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
  useEffect(() => writePreferences({ ...preferences, scheme: scene.scheme }), [preferences, scene.scheme]);

  function changeScheme(id: SchemeId) { closeContext(); dispatch({ type: 'scheme', scheme: id }); focusMap(); }
  function frameSelection() { dispatch({ type: 'camera', camera: frameUnits(scene.units.filter(unit => scene.selected.includes(unit.id)), scene.camera, viewport) }); closeContext(); focusMap(); }
  function zoom(factor: number) { closeContext(); dispatch({ type: 'camera', camera: zoomAt(scene.camera, viewport, { x: viewport.width / 2, y: viewport.height / 2 }, factor) }); focusMap(); }

  return <div className="app">
    <header><span className="brand">RIDGELINE</span><span>Control lab</span><span className="prototype">10 schemes · simulated units</span></header>
    <div className="workspace">
      <nav aria-label="Control schemes">{schemes.map((scheme, index) => <button key={scheme.id} aria-pressed={scene.scheme === scheme.id} onClick={() => changeScheme(scheme.id)}><span className="number">{String(index + 1).padStart(2, '0')}</span>{scheme.name}<span className="favorite-mark" aria-label={preferences.favorites.includes(scheme.id) ? 'Shortlisted' : undefined}>{preferences.favorites.includes(scheme.id) ? '✓' : ''}</span></button>)}</nav>
      <main>
        <div className="scheme-heading"><h1>{scheme.name}</h1><span className="family">{scheme.family}</span></div>
        <p id="control-help" className="hint">{scheme.hint}</p>
        <div ref={stageRef} className={`stage ${['rts', 'keys', 'route', 'formation', 'command'].includes(scene.scheme) ? 'has-bottom' : ''} ${scene.scheme === 'command' ? 'command-mode' : ''}`}>
          <button ref={surfaceRef} type="button" className={`map-surface ${scene.armed ? 'targeting' : ''}`} aria-label="Map. Click to focus keyboard controls." aria-describedby="control-help">
            <svg width={viewport.width} height={viewport.height} aria-hidden="true">
              <g transform={`translate(${viewport.width / 2 + scene.camera.x - 500 * scale},${viewport.height / 2 + scene.camera.y - 310 * scale}) scale(${scale})`}><path className="roads" d={streets.path} /></g>
              {scene.trails.map((trail, i) => <path key={`trail-${i}`} className="trail" d={path(trail.points)} />)}
              {scene.route.length > 1 && <path className="route" d={path(scene.route)} />}
              {scene.orders.map((order, index) => {
                const first = order.points[0];
                if (!first) return null;
                const previous = scene.orders.slice(0, index).reverse().find(prior => prior.ids.some(id => order.ids.includes(id)));
                const start = previous?.points.at(-1) ?? scene.units.find(unit => order.ids.includes(unit.id));
                const p = screen(first);
                return <g key={`order-${index}`}>{start && <path className="route" d={path([start, ...order.points])} />}<circle cx={p.x} cy={p.y} r={10} className="waypoint" /><text x={p.x} y={p.y + 4} textAnchor="middle" className="waypoint-label">{index + 1}</text></g>;
              })}
              {scene.formation.map(point => { const p = screen(point); return <circle key={point.id} className="formation" cx={p.x} cy={p.y} r={15} />; })}
              {preview.box && <rect className="selection-box" x={Math.min(preview.box.start.x, preview.box.end.x)} y={Math.min(preview.box.start.y, preview.box.end.y)} width={Math.abs(preview.box.end.x - preview.box.start.x)} height={Math.abs(preview.box.end.y - preview.box.start.y)} />}
            </svg>
          </button>
          {labels.map(label => <span className="map-label" key={label.name} style={{ left: screen(label).x, top: screen(label).y }}>{label.name}</span>)}
          <span className="beacon" style={{ left: screen(beacon).x, top: screen(beacon).y }}>◎ Beacon</span>
          {scene.units.map(unit => { const p = screen(preview.placement?.id === unit.id ? preview.placement : unit); return <button type="button" key={unit.id} className={`unit ${preview.placement?.id === unit.id ? 'dragging' : ''}`} data-unit={unit.id} aria-label={`Select ${unit.name}`} aria-pressed={scene.selected.includes(unit.id)} style={{ left: p.x, top: p.y }} onClick={event => { if (event.detail === 0) dispatch({ type: 'toggle-unit', id: unit.id, additive: event.shiftKey }); }}>{unit.name}</button>; })}
          <Controls key={scene.scheme} scene={scene} dispatch={dispatch} viewport={viewport} context={context} closeContext={closeContext} focusMap={focusMap} frameSelection={frameSelection} />
          <div className="zoom"><button onClick={() => zoom(1.25)} aria-label="Zoom in">+</button><button onClick={() => zoom(0.8)} aria-label="Zoom out">−</button><button onClick={() => { dispatch({ type: 'camera', camera: homeCamera }); closeContext(); focusMap(); }} aria-label="Reset camera">Fit</button></div>
        </div>
        <div className="status"><span role="status">{scene.message}</span><span className="selection">{scene.selected.length} selected · {Math.round(scene.camera.zoom * 100)}%{scene.orders.length ? ` · ${scene.orders.length} queued` : ''}</span></div>
        <div className="compare"><button aria-pressed={preferences.favorites.includes(scene.scheme)} onClick={() => setPreferences(current => ({ ...current, favorites: current.favorites.includes(scene.scheme) ? current.favorites.filter(id => id !== scene.scheme) : [...current.favorites, scene.scheme] }))}>Keep this one</button><button onClick={() => { closeContext(); dispatch({ type: 'reset' }); focusMap(); }}>Reset scene</button>{scene.scheme === 'rts' && <label className="edge-setting"><input type="checkbox" checked={preferences.edgePan} onChange={event => setPreferences(current => ({ ...current, edgePan: event.target.checked }))} />Edge pan</label>}<span className="saved">{preferences.favorites.length ? `Shortlist: ${preferences.favorites.map(id => schemes.find(scheme => scheme.id === id)?.name).join(', ')}` : 'No shortlist yet'}</span></div>
      </main>
    </div>
    <footer><span>Desktop mouse / trackpad</span><span>Orders jump to destination. Routes remain visible.</span><a href={streets.source} target="_blank" rel="noreferrer">Streets: City of Boston</a></footer>
  </div>;
}
