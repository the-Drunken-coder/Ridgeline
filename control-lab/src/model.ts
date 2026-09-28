export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Viewport = { width: number; height: number };
export type UnitId = 'alpha' | 'bravo' | 'charlie';
export type Unit = Point & { id: UnitId; name: string };
export type Trail = { points: Point[] };

export const beacon: Point = { x: 730, y: 205 };
export const homeCamera: Camera = { x: 0, y: 0, zoom: 1 };
export const initialUnits: Unit[] = [
  { id: 'alpha', name: 'Alpha', x: 315, y: 375 },
  { id: 'bravo', name: 'Bravo', x: 485, y: 290 },
  { id: 'charlie', name: 'Charlie', x: 645, y: 405 },
];

export type Scene = {
  camera: Camera;
  units: Unit[];
  selected: UnitId[];
  armed: boolean;
  trails: Trail[];
  message: string;
};

export function createScene(): Scene {
  return {
    camera: { ...homeCamera }, units: initialUnits.map(unit => ({ ...unit })),
    selected: ['alpha'], armed: false, trails: [], message: 'Ready.',
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

export type Action =
  | { type: 'select'; id: UnitId; additive: boolean }
  | { type: 'camera'; camera: Camera }
  | { type: 'arm' }
  | { type: 'move'; point: Point }
  | { type: 'cancel' }
  | { type: 'reset' };

export function reducer(scene: Scene, action: Action): Scene {
  switch (action.type) {
    case 'select': {
      const selected = !action.additive ? [action.id] : scene.selected.includes(action.id)
        ? scene.selected.filter(id => id !== action.id) : [...scene.selected, action.id];
      return { ...scene, selected, armed: scene.armed && selected.length > 0,
        message: selected.length ? `${selected.join(', ')} selected.` : 'Selection cleared.' };
    }
    case 'camera': return { ...scene, camera: action.camera };
    case 'arm': return { ...scene, armed: scene.selected.length > 0, message: scene.selected.length ? 'Click a destination.' : 'Select at least one unit.' };
    case 'move': {
      if (!scene.armed || !scene.selected.length) return scene;
      const start = scene.units.find(unit => scene.selected.includes(unit.id));
      const units = scene.units.map(unit => {
        const index = scene.selected.indexOf(unit.id);
        return index < 0 ? unit : { ...unit, x: action.point.x + (index - (scene.selected.length - 1) / 2) * 40, y: action.point.y };
      });
      return { ...scene, units, armed: false,
        trails: start ? [{ points: [{ x: start.x, y: start.y }, action.point] }] : [],
        message: `${scene.selected.join(', ')} moved.` };
    }
    case 'cancel': return { ...scene, armed: false, message: 'Cancelled.' };
    case 'reset': return { ...createScene(), message: 'Scene reset.' };
  }
}
