# Ridgeline starter

This plain TypeScript/Vite application installs the packed package without source aliases or playground code. Its examples show optional selection/styling and application-owned drawing storage.

Use Node 24 and pnpm 11. From a fresh Ridgeline checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination .artifacts
pnpm --dir examples/starter install
pnpm --dir examples/starter build
pnpm --dir examples/starter dev
```

The starter has its own dependency installation and TypeScript configuration. Its build checks the installed declarations and produces `examples/starter/dist`. The repository browser suite also exercises the starter through its packed-package consumer; that suite's generated configuration does not replace this standalone build.

Open `/?offline` for a blank local basemap without tile-service requests. The standard example loads OpenFreeMap and its glyphs. Neither mode enables terrain or asks for location permission.

- [main.ts](main.ts) mounts the viewport, standard controls and consumer selection policy, then disposes every attachment on page exit.
- [drawing.ts](drawing.ts) saves complete features, including drawing shape metadata, to this origin's browser localStorage. Switching back to Drawing or reloading the page restores them through `upsert`. Check Reject next save before Finish to retain a rejected draft, then retry Finish to save it. Browser storage failures also reject the save without changing accepted data. If restoration fails, every save is rejected and the original stored bytes remain protected. Reset repeats restoration without clearing them. Clear unreadable saved drawings explicitly removes the failed dataset and permits saving the retained draft.

This storage recipe is for one page, not concurrent editors. It compares the accepted `before` feature against its local saved map. A server or multi-tab application needs its own atomic version check, permissions and persistence policy. Saved drawings remain until you clear the site's browser storage. Reset example remounts and restores them; it does not erase storage. The recipe does not implement accepted-change undo.

To copy the recipe outside the repository, copy this directory, place the built archive at a path you control, and change `@ridgeline/map` in `package.json` to that file path. For example, with the archive beside `package.json`, use `file:./ridgeline-map-0.1.0.tgz`. Run `pnpm install`, `pnpm build` and `pnpm dev` inside the copied directory. Keep the included `pnpm-workspace.yaml`, which permits Vite's esbuild installation.

Applications drive live movement by sending complete current features through `upsert`; clocks, history and replay stay in application code. See the [live update guide](../../docs/viewport-tools.md#consumer-owned-live-updates). After copying the recipe alone, use the guide in the installed package at `node_modules/@ridgeline/map/docs/viewport-tools.md`.

Cleanup attempts every independent attachment and reports teardown failures after those attempts. Readiness errors are shown through the viewport error callback; exceptions while resetting the application remain visible.
