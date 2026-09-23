import type { SchemeId, Tool } from './schemes';

export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Viewport = { width: number; height: number };
export type UnitId = 'alpha' | 'bravo' | 'charlie';
export type Unit = Point & { id: UnitId; name: string };
export type Order = { ids: UnitId[]; points: Point[] };
export type Placement = Point & { id: UnitId };

export const beacon: Point = { x: 730, y: 205 };
export const homeCamera: Camera = { x: 0, y: 0, zoom: 1 };
export const initialUnits: Unit[] = [
  { id: 'alpha', name: 'Alpha', x: 315, y: 375 },
  { id: 'bravo', name: 'Bravo', x: 485, y: 290 },
  { id: 'charlie', name: 'Charlie', x: 645, y: 405 },
];

export type Scene = {
  scheme: SchemeId;
  tool: Tool;
  camera: Camera;
  units: Unit[];
  selected: UnitId[];
  armed: boolean;
  route: Point[];
  formation: Placement[];
  orders: Order[];
  trails: Order[];
  message: string;
};

export function createScene(scheme: SchemeId = 'maps'): Scene {
  return {
    scheme, tool: 'pan', camera: { ...homeCamera }, units: initialUnits.map(unit => ({ ...unit })),
    selected: scheme === 'formation' ? initialUnits.map(unit => unit.id) : ['alpha'],
    armed: false, route: [], formation: [], orders: [], trails: [], message: 'Ready.',
  };
}

export function mapScale(viewport: Viewport, camera: Camera) {
  return Math.min(viewport.width / 900, viewport.height / 580) * camera.zoom;
}

export function toScreen(point: Point, camera: Camera, viewport: Viewport): Point {
  const scale = mapScale(viewport, camera);
  return { x: viewport.width / 2 + (point.x - 500) * scale + camera.x,
    y: viewport.height / 2 + (point.y - 310) * scale + camera.y };
}

export function toWorld(point: Point, camera: Camera, viewport: Viewport): Point {
  const scale = mapScale(viewport, camera);
  return { x: (point.x - viewport.width / 2 - camera.x) / scale + 500,
    y: (point.y - viewport.height / 2 - camera.y) / scale + 310 };
}

export function zoomAt(camera: Camera, viewport: Viewport, anchor: Point, factor: number): Camera {
  const world = toWorld(anchor, camera, viewport);
  const next = { ...camera, zoom: Math.min(4, Math.max(0.5, camera.zoom * factor)) };
  const screen = toScreen(world, next, viewport);
  return { ...next, x: next.x + anchor.x - screen.x, y: next.y + anchor.y - screen.y };
}

export function frameUnits(units: Unit[], camera: Camera, viewport: Viewport): Camera {
  if (!units.length) return camera;
  const scale = mapScale(viewport, camera);
  return { ...camera,
    x: -(units.reduce((sum, unit) => sum + unit.x, 0) / units.length - 500) * scale,
    y: -(units.reduce((sum, unit) => sum + unit.y, 0) / units.length - 310) * scale };
}

export function lineFormation(ids: UnitId[], start: Point, end: Point): Placement[] {
  return ids.map((id, index) => {
    const fraction = ids.length === 1 ? 0.5 : index / (ids.length - 1);
    return { id, x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
  });
}

function applyOrder(units: Unit[], order: Order): Unit[] {
  const end = order.points.at(-1);
  if (!end) return units;
  return units.map(unit => {
    const index = order.ids.indexOf(unit.id);
    return index < 0 ? unit : { ...unit, x: end.x + (index - (order.ids.length - 1) / 2) * 40, y: end.y };
  });
}

function trailFor(units: Unit[], order: Order): Order {
  const start = units.find(unit => order.ids.includes(unit.id));
  return { ...order, points: start ? [{ x: start.x, y: start.y }, ...order.points] : order.points };
}

export type Action =
  | { type: 'scheme'; scheme: SchemeId }
  | { type: 'tool'; tool: Tool }
  | { type: 'select'; ids: UnitId[]; additive?: boolean }
  | { type: 'toggle-unit'; id: UnitId; additive: boolean }
  | { type: 'camera'; camera: Camera }
  | { type: 'pan'; delta: Point }
  | { type: 'arm' }
  | { type: 'route'; points: Point[] }
  | { type: 'formation'; placements: Placement[] }
  | { type: 'apply-formation' }
  | { type: 'send-route' }
  | { type: 'move'; point: Point; ids?: UnitId[] }
  | { type: 'place'; placement: Placement }
  | { type: 'execute' }
  | { type: 'undo' }
  | { type: 'hold'; ids?: UnitId[] }
  | { type: 'cancel' }
  | { type: 'reset' }
  | { type: 'message'; message: string };

function withSelection(scene: Scene, selected: UnitId[]): Scene {
  return { ...scene, selected, route: [], formation: [],
    message: selected.length ? `${selected.join(', ')} selected.` : 'Selection cleared.' };
}

export function reducer(scene: Scene, action: Action): Scene {
  switch (action.type) {
    case 'scheme':
      return { ...scene, scheme: action.scheme, tool: 'pan', armed: false, route: [], formation: [],
        selected: action.scheme === 'formation' ? scene.units.map(unit => unit.id) : scene.selected,
        message: 'Control scheme changed. Unit positions preserved.' };
    case 'tool': return { ...scene, tool: action.tool, armed: false, message: `${action.tool} tool selected.` };
    case 'select': return withSelection(scene, action.additive ? [...new Set([...scene.selected, ...action.ids])] : action.ids);
    case 'toggle-unit': return withSelection(scene, !action.additive ? [action.id] : scene.selected.includes(action.id)
      ? scene.selected.filter(id => id !== action.id) : [...scene.selected, action.id]);
    case 'camera': return { ...scene, camera: action.camera };
    case 'pan': return { ...scene, camera: { ...scene.camera, x: scene.camera.x + action.delta.x, y: scene.camera.y + action.delta.y } };
    case 'arm': return { ...scene, armed: scene.selected.length > 0, message: scene.selected.length ? 'Click a destination.' : 'Select at least one unit.' };
    case 'route': return { ...scene, route: action.points, message: action.points.length > 1 ? 'Route preview ready. Enter sends it.' : 'Draw a route.' };
    case 'formation': return { ...scene, formation: action.placements, message: action.placements.length ? 'Formation preview ready.' : 'Select at least one unit.' };
    case 'apply-formation': {
      if (!scene.formation.length) return scene;
      return { ...scene, units: scene.units.map(unit => ({ ...unit, ...scene.formation.find(p => p.id === unit.id) })),
        formation: [], trails: [], message: 'Formation placed.' };
    }
    case 'send-route': {
      if (scene.route.length < 2 || !scene.selected.length) return scene;
      const order = { ids: scene.selected, points: scene.route };
      return { ...scene, units: applyOrder(scene.units, order), route: [], trails: [trailFor(scene.units, order)], message: 'Route sent.' };
    }
    case 'move': {
      const ids = action.ids ?? scene.selected;
      if (!ids.length) return { ...scene, message: 'Select at least one unit.' };
      const order = { ids: [...ids], points: [action.point] };
      if (scene.scheme === 'plan') return { ...scene, armed: false, orders: [...scene.orders, order], message: `Order ${scene.orders.length + 1} queued.` };
      return { ...scene, units: applyOrder(scene.units, order), armed: false, route: [],
        trails: [trailFor(scene.units, order)], message: `${ids.join(', ')} moved.` };
    }
    case 'place': return { ...scene, units: scene.units.map(unit => unit.id === action.placement.id ? { ...unit, ...action.placement } : unit),
      trails: [], message: `${action.placement.id} placed.` };
    case 'execute': {
      if (!scene.orders.length) return scene;
      let units = scene.units;
      const trails = scene.orders.map(order => {
        const trail = trailFor(units, order);
        units = applyOrder(units, order);
        return trail;
      });
      return { ...scene, units, trails, orders: [], message: `${scene.orders.length} queued ${scene.orders.length === 1 ? 'order' : 'orders'} executed.` };
    }
    case 'undo': return { ...scene, orders: scene.orders.slice(0, -1), message: scene.orders.length ? 'Last queued order removed.' : 'No queued orders.' };
    case 'hold': {
      const ids = action.ids ?? scene.selected;
      const orders = scene.orders.map(order => ({ ...order, ids: order.ids.filter(id => !ids.includes(id)) })).filter(order => order.ids.length);
      return { ...scene, orders, armed: false, route: [], formation: [], message: ids.length ? `${ids.join(', ')} holding.` : 'No units selected.' };
    }
    case 'cancel': return { ...scene, armed: false, route: [], formation: [], message: 'Cancelled.' };
    case 'reset': return { ...createScene(scene.scheme), message: 'Scene reset.' };
    case 'message': return { ...scene, message: action.message };
  }
}

export type Command =
  | { kind: 'move'; ids: UnitId[]; destination: 'beacon' | { column: number; row: number } }
  | { kind: 'select' | 'hold'; ids: UnitId[] }
  | { kind: 'error'; message: string };

function namedUnits(name: string): UnitId[] {
  return initialUnits.filter(unit => name === 'all' || name === unit.id).map(unit => unit.id);
}

export function parseCommand(input: string): Command {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const move = /^(alpha|bravo|charlie|all) to (beacon|[abc][123])$/.exec(normalized);
  if (move?.[1] && move[2]) {
    const target = move[2];
    return { kind: 'move', ids: namedUnits(move[1]), destination: target === 'beacon' ? 'beacon' :
      { column: 'abc'.indexOf(target.charAt(0)), row: Number(target.charAt(1)) - 1 } };
  }
  const simple = /^(select|hold) (alpha|bravo|charlie|all)$/.exec(normalized);
  if (simple?.[2] && (simple[1] === 'select' || simple[1] === 'hold')) return { kind: simple[1], ids: namedUnits(simple[2]) };
  return { kind: 'error', message: 'Unknown command. Try “alpha to B2” or “all to beacon”.' };
}
