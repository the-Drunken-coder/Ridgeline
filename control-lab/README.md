# Ridgeline control lab

A local map-controls playground with all ten approved control schemes. The units are simulated. Orders place them immediately and leave route trails; there is no device connection, pathfinding, or movement simulation.

This is an isolated interaction sandbox using an embedded SVG street sample. It does not use or change the Ridgeline viewport library. The existing MapLibre playground stays available through the root `pnpm dev` command.

The approved design keeps the map dominant, the ten choices in a flat navigation list, and each scheme's controls next to the map. Empty selections disable unavailable actions; routes and formations show previews before commit. The navigation wraps into two columns on narrow screens. There are no decorative cards or idle animations.

## Run

Requires Node.js 22.12 or newer and pnpm.

```sh
pnpm install
pnpm dev:controls
```

Run those commands from the repository root and open the local URL printed by Vite. `pnpm build:controls` checks TypeScript and builds `control-lab/dist/`. `pnpm test:controls` checks selection, order execution, command parsing, formation placement, and camera geometry.

## Control schemes

| Scheme | Main interaction |
| --- | --- |
| Everyday map | Drag to pan; select a unit, arm Move, click a destination. |
| Canvas tools | Explicit Pan, Select, and Move tools; drag a selection box. |
| Classic RTS | Box select, Shift to add, right-click to move, edge/arrow camera pan. |
| Keyboard pilot | WASD camera; 1/2/3 selection; M move, H hold, F frame. |
| Context wheel | Click the ground, then choose Move, Focus, Hold, or Cancel. |
| Grab & place | Drag a unit to preview its position; release to commit. |
| Sketch a route | Draw a route, then Enter or Send route to commit. |
| Formation brush | Drag a line to preview a group formation, then Apply. |
| Plan, then go | Queue destinations for selected units, undo, then execute in order. |
| Command line | `all to beacon`, `alpha to B2`, `select bravo`, `hold all`. |

Scroll zooms toward the pointer in every scheme. Space-drag and middle-drag pan. Escape cancels unfinished gestures and action modes. Shift-click toggles individual units. Grid destinations refer to cells in the current viewport. Keyboard shortcuts apply while focus is in the map area and never intercept command input.

Switching schemes preserves unit positions, the camera, and queued orders. Route and formation previews clear when the scheme or selection changes. Reset scene restores the sample units and clears orders. Hold removes only the selected recipients from queued group orders.

The app remembers the selected scheme, shortlist, and edge-pan setting in local storage. Unit positions and orders reset on reload. The app still works when storage is unavailable.

## Structure

- `src/model.ts`: typed scene, command grammar, order execution, and camera geometry.
- `src/useControls.ts`: pointer capture, gesture cancellation, keyboard controls, and input-driven edge scrolling.
- `src/Controls.tsx`: the controls for each scheme.
- `src/App.tsx`: shared map and scheme selection.

The map embeds a 2,000-feature sample of [City of Boston EOT streets](https://gisportal.boston.gov/ArcGIS/rest/services/Basemaps/basemap_IPS/MapServer/11), downloaded September 23, 2026 and projected with D3's Mercator projection. It is a fixed display reference, not a complete street dataset. Source and projection metadata are stored with the geometry in `src/assets/boston-streets.json`. The app makes no network requests for map data at runtime.
