export const schemes = [
  { id: 'maps', name: 'Everyday map', family: 'Familiar', hint: 'Drag to pan. Scroll to zoom. Select a unit, choose Move here, then click a destination.' },
  { id: 'tools', name: 'Canvas tools', family: 'Explicit modes', hint: 'Choose Pan, Select, or Move. Select supports box selection. Space-drag always pans.' },
  { id: 'rts', name: 'Classic RTS', family: 'Selection first', hint: 'Drag a box to select. Right-click to move. Arrows or map edges pan. Shift adds to selection.' },
  { id: 'keys', name: 'Keyboard pilot', family: 'Hands on keys', hint: 'WASD pans. 1, 2, 3 selects units. M then click moves. H holds. F frames selection.' },
  { id: 'radial', name: 'Context wheel', family: 'Actions at cursor', hint: 'Select units, then click the ground to open the command wheel. Drag to pan.' },
  { id: 'direct', name: 'Grab & place', family: 'Direct manipulation', hint: 'Drag a unit to preview its new position. Release to place it. Drag empty space to pan.' },
  { id: 'route', name: 'Sketch a route', family: 'Gesture based', hint: 'Select units, then draw their route. Enter sends it. Space-drag pans. Escape cancels.' },
  { id: 'formation', name: 'Formation brush', family: 'Group geometry', hint: 'Select a group, then drag a line to spread it out. Apply formation commits the preview.' },
  { id: 'plan', name: 'Plan, then go', family: 'Staged orders', hint: 'Select units and click destinations to queue orders. Review, then Execute. Drag to pan.' },
  { id: 'command', name: 'Command line', family: 'Text first', hint: 'Try “all to beacon”, “alpha to B2”, “select bravo”, or “hold all”. Enter runs a command.' },
] as const;

export type SchemeId = typeof schemes[number]['id'];
export type Tool = 'pan' | 'select' | 'move';

export function isScheme(value: unknown): value is SchemeId {
  return schemes.some(scheme => scheme.id === value);
}
