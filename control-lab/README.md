# Ridgeline control lab

The control lab demonstrates the Everyday map controls with simulated units on an embedded SVG street sample. It is an isolated interaction sandbox, separate from the Ridgeline viewport library and MapLibre playground. Orders place units immediately and leave a route trail. There is no device connection, pathfinding, or movement simulation.

## Run

Requires Node.js 22.12 or newer and pnpm. From the repository root:

```sh
pnpm install
pnpm dev:controls
```

Open the local URL printed by Vite. `pnpm build:controls` checks TypeScript and builds `control-lab/dist/`. `pnpm test:controls` checks selection, order placement, and camera geometry. `pnpm test:controls:browser` drives the rendered controls with Chromium mouse, keyboard, and wheel input. The root `pnpm check` and `pnpm test` commands also check this workspace.

## Controls

Drag the map to pan and scroll toward the pointer to zoom. Select a unit, choose **Move here**, then click its destination. Shift-click toggles additional units. **Frame** centers the selection; **Fit** resets the camera; **Reset scene** restores the sample units. Space-drag and middle-drag also pan. Escape cancels an armed move.

The map embeds a 2,000-feature sample of [City of Boston EOT streets](https://gisportal.boston.gov/ArcGIS/rest/services/Basemaps/basemap_IPS/MapServer/11), downloaded September 23, 2026 and projected with D3's Mercator projection. It is a fixed display reference, not a complete street dataset. Source and projection metadata are stored with the geometry in `src/assets/boston-streets.json`. The app makes no network requests for map data at runtime.
