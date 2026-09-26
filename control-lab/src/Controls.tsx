import { useState, type Dispatch, type ReactNode } from 'react';
import { beacon, parseCommand, toWorld, type Action, type Scene, type Viewport } from './model';
import type { ContextMenu } from './useControls';

type Props = {
  scene: Scene; dispatch: Dispatch<Action>; viewport: Viewport;
  context: ContextMenu | null; closeContext: () => void; focusMap: () => void; frameSelection: () => void;
};

export function Controls({ scene, dispatch, viewport, context, closeContext, focusMap, frameSelection }: Props) {
  const [command, setCommand] = useState('');
  const names = scene.selected.length ? scene.selected.join(' + ') : 'No selection';
  const selected = scene.selected.length > 0;
  function action(action: Action) { dispatch(action); closeContext(); focusMap(); }
  const arm = <button disabled={!selected} aria-pressed={scene.armed} onClick={() => action({ type: 'arm' })}>{scene.armed ? 'Click destination' : 'Move here'}</button>;
  const all = <button onClick={() => action({ type: 'select', ids: scene.units.map(unit => unit.id) })}>Select all</button>;
  const hold = <button disabled={!selected} onClick={() => action({ type: 'hold' })}>Hold [H]</button>;
  let panel: ReactNode;

  switch (scene.scheme) {
    case 'maps': panel = <div className="overlay top-left"><strong>{names}</strong><span className="panel-label">Unit inspector</span><div className="row">{arm}<button disabled={!selected} onClick={frameSelection}>Frame</button></div></div>; break;
    case 'tools': panel = <div className="overlay tool-rail" aria-label="Map tools">{(['pan', 'select', 'move'] as const).map(tool => <button key={tool} aria-pressed={scene.tool === tool} onClick={() => action({ type: 'tool', tool })}>{tool[0]?.toUpperCase()}{tool.slice(1)}</button>)}</div>; break;
    case 'rts': panel = <div className="overlay bottom"><strong>{names}</strong><span className="panel-label">Drag selects · Right-click orders · Arrows pan</span><div className="row">{all}{arm}{hold}<button disabled={!selected} onClick={frameSelection}>Frame [F]</button></div></div>; break;
    case 'keys': panel = <><div className="overlay bottom"><strong className="mode-label">{scene.armed ? 'MOVE: CLICK DESTINATION' : 'CAMERA: WASD'}</strong><div className="row">{scene.units.map((unit, i) => <button key={unit.id} aria-pressed={scene.selected.includes(unit.id)} onClick={() => action({ type: 'select', ids: [unit.id] })}>{i + 1} {unit.name}</button>)}{arm}{hold}</div></div><span className="crosshair" aria-hidden="true">+</span></>; break;
    case 'radial': panel = context && <div className="overlay radial" role="group" aria-label="Commands at selected destination" style={{ left: Math.max(8, Math.min(viewport.width - 268, context.screen.x - 130)), top: Math.max(8, Math.min(viewport.height - 208, context.screen.y - 100)) }}>
      <button className="primary" disabled={!selected} onClick={() => action({ type: 'move', point: context.world })}>Move here</button>
      <button onClick={() => { dispatch({ type: 'pan', delta: { x: viewport.width / 2 - context.screen.x, y: viewport.height / 2 - context.screen.y } }); closeContext(); focusMap(); }}>Focus here</button>
      <button disabled={!selected} onClick={() => action({ type: 'hold' })}>Hold</button>
      <button onClick={() => { closeContext(); focusMap(); }}>Cancel</button>
    </div>; break;
    case 'direct': panel = <div className="overlay top-left"><strong className="mode-label">GRAB A UNIT</strong><span className="panel-label">Release to place · Escape to cancel</span></div>; break;
    case 'route': panel = <div className="overlay bottom"><strong>{names} · {scene.route.length > 1 ? 'Route ready' : 'Draw a route'}</strong><div className="row"><button className="primary" disabled={!selected || scene.route.length < 2} onClick={() => action({ type: 'send-route' })}>Send route ↵</button><button disabled={!scene.route.length} onClick={() => action({ type: 'cancel' })}>Clear route</button><span className="panel-label">Space-drag pans</span></div></div>; break;
    case 'formation': panel = <div className="overlay bottom"><strong>{names}</strong><span className="panel-label">Drag a line. Circles preview the formation.</span><div className="row"><button className="primary" disabled={!scene.formation.length} onClick={() => action({ type: 'apply-formation' })}>Apply formation</button>{all}<button disabled={!scene.formation.length} onClick={() => action({ type: 'cancel' })}>Clear preview</button></div></div>; break;
    case 'plan': panel = <div className="overlay right"><strong>{scene.orders.length} queued orders</strong>{scene.orders.length ? <ol className="orders">{scene.orders.map((order, i) => <li key={i}>{order.ids.join(' + ')}</li>)}</ol> : <span className="panel-label">Click a destination to add</span>}<div className="row"><button className="primary" disabled={!scene.orders.length} onClick={() => action({ type: 'execute' })}>Execute</button><button disabled={!scene.orders.length} onClick={() => action({ type: 'undo' })}>Undo</button></div></div>; break;
    case 'command': panel = <><div className="overlay bottom"><form className="command" onSubmit={event => {
      event.preventDefault();
      const result = parseCommand(command);
      if (result.kind === 'error') { dispatch({ type: 'message', message: result.message }); return; }
      if (result.kind === 'move') {
        const point = result.destination === 'beacon' ? beacon : toWorld({ x: (result.destination.column + 0.5) * viewport.width / 3, y: (result.destination.row + 0.5) * viewport.height / 3 }, scene.camera, viewport);
        dispatch({ type: 'select', ids: result.ids }); dispatch({ type: 'move', ids: result.ids, point });
      } else if (result.kind === 'select') dispatch({ type: 'select', ids: result.ids });
      else dispatch({ type: 'hold', ids: result.ids });
      setCommand('');
    }}><input value={command} onChange={event => setCommand(event.target.value)} aria-label="Command" placeholder="all to beacon" autoComplete="off" spellCheck={false} /><button type="submit" className="primary">Run ↵</button></form><span className="panel-label">alpha / bravo / charlie / all · to A1–C3 or beacon</span></div>
      {['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3'].map((label, index) => <span key={label} className="grid-label" style={{ left: `${index % 3 * 100 / 3 + 2}%`, top: `${Math.floor(index / 3) * 100 / 3 + 2}%` }}>{label}</span>)}
    </>; break;
  }
  return panel;
}
