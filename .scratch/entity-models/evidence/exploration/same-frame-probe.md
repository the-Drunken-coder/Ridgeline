# Same-frame feature-state upload probe

Executed 2026-10-04 against the public packed Ridgeline viewport built from final #82, checkout `0f24d275099b83c999e3afa949f638959e589f16`. No repository edits or tracker writes. This establishes a candidate dependency for #86, not complete model switching or its failure guarantees.

Calling the existing `map.style.tileManagers['rl:features'].prepare(map.painter.context)` after changing circle/icon feature state during a custom layer's `prerender` updated both rendered representations in that same frame. Ordinary `map.setFeatureState` at the same point without preparation took one more frame.

## Executed evidence

- Six scenarios: flat with the probe layer below/above points and icons; full globe below; intermediate projection blend 0.5 above; flat with terrain below; globe with terrain above. Terrain used the repository's local flat DEM fixture. Camera pitch 25°, bearing 17°, CSS canvas 640 × 360, device pixel ratio 1.
- Each scenario ran six changed-state commands separately, including independent circle/icon visibility, and ten alternations on consecutive render frames for each mechanism. All 96 explicit-preparation commands showed the target pixels in the first frame. All 96 ordinary control commands showed the previous pixels in that frame. Separately scheduled commands settled after one followup frame in both paths.
- The public viewport created the actual `rl:features` source, red circle, and registered blue image icon. The existing `editing` feature state served as an opacity control. It was an analogy for representation suppression, not a proposed model API.
- Pixel evidence came from `gl.readPixels` at the map's `render` event, after its main pass. Visible red counts were 492 in flat views and 490 in globe/blend views; blue was 729 throughout. Explicit-preparation first frames contained either those exact baseline counts or zero, including independently hidden features. A configured 1000 ms style transition did not interpolate these feature-state opacity changes.
- Repeating an unchanged target skipped state writes and explicit preparation. The one deliberately requested frame produced no followup. After each scenario, five seconds of idle produced zero render/prerender/prepare calls. Public `setFeatureState` still schedules one bounded followup for actual changes even when preparation already updated that frame.
- No page errors, map errors, viewport diagnostics, or GL errors were observed. This experiment uses Chromium `153.0.8010.12`, MapLibre `6.11.0`, ANGLE Vulkan SwiftShader. It provides no target-hardware timing or cost evidence.

The packed module SHA-256 is `e7684c91f48b8a98f3a826d0f227b549fb33804e2749cd89245bc3e59789f178`. It was loaded from `/tmp/ridgeline-model-projection/.artifacts/consumer/node_modules/@ridgeline/map/dist/ridgeline.js`, not imported from production TypeScript. T3 preview had no connected host; this permitted fallback used a standalone Node server on an OS-assigned ephemeral port and closed it afterward. Port 5174 was not used.

## Recipe and artifacts

Run `node /tmp/ridgeline-model-context/same-frame-probe.mjs`, then `node /tmp/ridgeline-model-context/same-frame-probe-validate.mjs`. Dependencies and the packed module are resolved from `/tmp/ridgeline-model-projection`.

- `same-frame-probe.mjs`: complete server and public consumer experiment. The only runtime instrumentation wraps the existing source manager's prepare method to count calls, then restores it.
- `same-frame-probe.json`: per-frame pixels, target states, prepare counts, layer order, projection blend, browser/backend metadata, errors.
- `same-frame-probe.log`: concise scenario results.
- `same-frame-probe-validate.mjs`: assertions against saved results, including exact visible pixel counts and zero hidden pixels, expected control lag, all unchanged and quiet-frame counts.
- `same-frame-probe-validation.json`: passing aggregate checks.

## Installed-source implications and limits

Paths below are relative to `node_modules/maplibre-gl/src` in the same checkout.

1. `ui/map.ts:4430–4469` updates sources, terrain transform and placement before drawing. `render/painter.ts:528` prepares used sources, then `:557` starts the offscreen pass and custom prerender. The main pass follows. `webgl/draw/draw_custom.ts:56` invokes prerender and then resets tracked GL state. Consequently the frame should be derived from that prerender's actual projection input. Camera events alone are incomplete.
2. `tile/tile_manager.ts:223` coalesces state, uploads all in-view tiles, and prepares their images. `source/source_state.ts:132` increments the state revision and updates tile paint arrays. `data/program_configuration.ts:568` only reevaluates state-dependent paint binders. This is a synchronous paint update for existing loaded features. It does not wait for new GeoJSON publication, perform symbol placement again, or make an unloaded source feature available.
3. Upload-failure atomicity is unproven. This method mutates state and multiple tile buffers in place and returns no transactional success value. `tile/tile.ts:366` can allocate/upload pending resources. There is no rollback around this sequence. `draw_custom.ts:56,74` also has no local try/finally for a thrown custom callback. Complete model program/resource/instance preflight should precede visibility publication, but this experiment does not prove recovery from failed source uploads, context loss, or failure after drawing starts. Do not infer that generic partial GPU failure can be undone.
4. Preflight must validate the current source manager, style and painter/context generation. `style/style.ts:1435` can fire an error event and return when a feature-state target is invalid; lack of an exception is not proof that it committed. Do not run consumer callbacks between plan, state writes, upload and draw. Existing image preparation may also touch registered image machinery; synchronous reentrancy and source replacement need the real implementation's tests.
5. Layer-order independence here applies to prerender's visibility commit, because every offscreen pass precedes the main pass. It does not prove draw-time failure recovery. If a custom main-pass render fails after a fallback layer already drew, restoring opacity cannot redraw that earlier layer. Keep actual model/fallback/attachment order and recovery under #86's acceptance tests.
6. Render-to-texture caches are excluded. `webgl/render_to_texture.ts:19` lists background/fill/line/raster/hillshade/color-relief, not circle/symbol. Its `prepareForRender` is called at `render/painter.ts:548`, before custom prerender, and captures feature-state revisions into cache fingerprints. Rerunning only the source manager does not refresh those earlier cache decisions. Restrict this candidate adapter to live circle/symbol opacity; do not generalize it to terrain-draped fills or lines.
7. The settled icon was configured to allow overlap and ignore placement by the existing viewport contract. A 1000 ms style transition was present, but animated camera changes, symbol collision/fade changes, labels, actual model threshold hysteresis, unavailable assets, framebuffer failure, recovery and reentrant callbacks remain untested here. Opacity-zero native query hits also require filtering in the real representation integration.

The useful foundation interface remains separate model-frame preparation/preflight and drawing. The candidate allows a prepared frame to publish its native fallback visibility before drawing. Actual #86 checks must couple those pixels to real model presence, representation state and picking before declaring the feature complete. Additional source preparation and its bounded scheduled followup have unmeasured target-hardware cost; #80/#91 remain pending.
