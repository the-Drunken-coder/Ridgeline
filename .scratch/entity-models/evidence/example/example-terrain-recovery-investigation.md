# Example terrain and reentry recovery investigation

Read-only investigation on 2026-10-05. Canonical spec: root `.scratch/entity-models/spec.md`; ticket `/tmp/ridgeline-model-context/issue-90.md`. Inspected clean example revision `a2ef7d322337b33b8a2640925788f5ba97b607c3`, saved `example-three-workflows.log`, matching Playwright artifacts, native MapLibre6.11 source and projection's public-state diagnostic capture. Projection owns browser execution; root owns integration; primary owns production changes. No repository edits, browser launches, process polling or signals were performed by this investigator.

## Completed observations

Default terrain→models recovered naturally in `example-state-default.json`: all8 entities had model status ready, representation model, coverage ready, ground0 agreeing with nativeGround0; aircraft altitudes35/60. It reached this state at26.24s from probe navigation, with13 renders, one idle and no errors. No retry, terrain reconfiguration or entity update was needed after entry. This completed history disproves the claim that unchanged terrain/provider ownership necessarily prevents recovery.

Cancellation/return also recovered without intervention in `example-state-cancel.json`. At13.9s all8 features existed and their registrations were ready, but coverage was loading, representation withheld and raw ground unknown while nativeGround was already0. At31.5s all8 had ready coverage, model representation, raw ground0 and the correct35/60m airborne altitude. This is direct evidence that the0/0 text described withheld representations during preparation, not lost features or a permanently canceled registration. The raw sampler recovery callback reached the current reentered entities.

The earlier default test's final error-context actually shows `Loading models…`→`0 models · 0 icons`→`0 models · 6 icons`. Its last observed state was still progressing. Cancellation/reentry's saved assertion ended at0/0. Neither text reports withheld count, raw elevation state or whether a completed model frame has been published, so these are not sufficient evidence of missing entities or permanently stalled recovery.

## Exact ownership trace

- Consumer model mount and unmount configure only entityVisibility. `viewport.configure` preserves elevation values and calls `EntityScene.configure(false)`. Only an explicit `next.elevation` causes `Elevation.reset`; that path is absent in these histories.
- Native `applyElevation(false)` does not replace the DEM sources. It calls MapLibre `setTerrain` again. MapLibre destroys old Terrain framebuffer/mesh resources and its TerrainTileManager wrapper, then creates a new wrapper around the retained source TileManager. `TerrainTileManager.destruct` changes native flags and releases render-to-texture resources; it has no reference to Ridgeline's raw sampler.
- Raw entity elevation owns a separate `RasterElevationSampler`, controller, parsed tiles and area subscriptions. `EntityScene.set` adds replacement/current area subscriptions before work begins. Removal releases placement/model/camera area subscriptions. Releasing the last area can abort a consumer-supplied preparation Work, but there is no such Work for the default raster provider. It does not abort the raster sampler's controller or clear its cache.
- The raster provider initializes lazily at its first sample. After TileJSON readiness it notifies current area keys; after each parsed DEM tile, its `finally` notifies affected current areas. `Elevation.notify` increments area revisions; the scene marks those current entities dirty and schedules a flush. The flush recomputes placement, calls `EntityLayer.set`, which requests repaint, updates native publication, and lets the next completed model frame publish representation changes. No missing edge was found in this source trace.
- Model-fetch cancellation is a separate owner. Disposed example instances abort fetch and skip post-fetch registration/upsert; unregister cancels existing registry attempts. New instances own new lifetimes. No old-instance cleanup runs again after new mount in the inspected consumer flow.

Therefore native Terrain recreation is concrete extra work, but source inspection does not connect it to a lost or canceled raw preparation. The successful default-history recovery supplies behavior evidence matching that separation.

## Timing evidence and limits

Saved failed default trace: four assets complete around00:28:55; the raw TileJSON response completes around00:29:15.98 after16.79s, and its DEM response completes00:29:16.06, leaving roughly9s before the30s expectation expires. Saved cancel/reentry trace: second assets around00:28:00.4, raw TileJSON completes00:28:16.28 after11.45s, DEM00:28:16.32, leaving roughly5s of its20s expectation. Native DEM responses completed much earlier. All relevant resources returned200 except the deliberately aborted first drone request.

In the successful default diagnostic, raw DEM networking completes at6.06s, but ready entity events arrive around25.97s. This isolates a long post-network preparation/render interval. The earlier successful standalone profile also contains long sampled wall time in canvas/color/DEM load paths, which can include GPU readback waits. Neither record identifies the precise expensive native function in the failed run, so do not label these intervals pure CPU parse time or assert a specific driver failure.

The combined workflow separately exceeded its overall120s budget after successful rendering, input, appearance, unload/load and replacement steps; screenshots alone took roughly18s and21s in that run. That timeout is different from an established recovery failure.

## Conclusion and remaining scope

Both requested histories have now completed recovery through their existing owners. No missed recovery or lost preparation ownership was demonstrated. The cancellation capture also records one initial entity computation near9994ms, consistent with substantial synchronous cold work, but no exact expensive native function was isolated. Projection will keep the actual behavior assertions and use budgets supported by these cold-transition observations; root owns combined verification. Projection separately owns its stale-reset consumer history, which is outside this terrain investigation.

Any subsequent production optimization should be supported by its own controlled measurement and original-history regression test, rather than attributed to the redundant setTerrain call without evidence. These captures establish recovery in local software Chromium; hardware #80/#91 and broader supported-browser/performance acceptance remain pending.
