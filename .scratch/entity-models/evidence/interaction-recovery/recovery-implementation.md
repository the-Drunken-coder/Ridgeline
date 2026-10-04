# Model recovery implementation, 2026-10-04

Worktree `/tmp/ridgeline-model-recovery`, branch `implement/entity-model-recovery`; started at exact `647458e6f7d4ff3b86a72d6fb86f474457dbf4be`. Canonical spec is root `.scratch/entity-models/spec.md`; ticket cached at `/tmp/ridgeline-model-context/issue-89.md`. Root is integrated verification owner. No public exports, runtime dependencies, PR, push or tracker changes by this worker.

## Ownership and behavior

Owned `src/models.ts`, `src/model-layer.ts`, `tests/models.test.ts`, and new `tests/model-recovery.browser.ts`. Root supplied browser wiring. Shared scene/viewport changes were delegated to sole owner model_research; feedback resources to sole owner projection. Those owners' commits are merged for actual integrated execution.

- Registry retains accepted definition bytes and parsed CPU data independently of its optional drawable GPU record. Asset status remains ready through loss. Completed registration promises remain completed. Pending replacement keeps its own promise, parsed data and revision; only its upload attempt is aborted.
- Actual context invalidation releases GPU wrappers and stops accepted rebuild/pending upload controllers. New renderer starts independent accepted-A rebuild and pending-B registration; either completion order is safe. Failed B retains/rebuilds A; late A cannot overwrite B. Unregister/destroy stop both. Exact-once registry disposal is guarded against callback destruction during loss traversal.
- Restore asset failure emits `MODEL_LOAD_FAILED`, context `{operation: 'restoreModel', modelId, recoverable: true}`, retaining its cause and CPU acceptance. It waits for explicit `retryUpdates()` or a new renderer generation. Shader/frame failures continue using `MODEL_RENDERER_FAILED`. A failed native MapLibre painter restoration is forwarded through the shared viewport bridge so waiting registrations reject with their own model context.
- ModelLayer detects `gl.isContextLost()` in onRemove before MapLibre's later map loss event. It clears prepared frames, notifies scene/viewport before registry changed callbacks, retires the renderer's programs and constructs a fresh renderer after restoration. Ordinary live style reattachment keeps usable model resources.
- Last-drawn publication includes `modelsDrawn:boolean`; scene owns pick boxes and representation callbacks. A consumer custom prerender can invalidate the prepared revision, so render repeats the existing bounded preflight using that MapLibre frame's input before changing visibility/drawing. No automatic retry scheduler or diagnostic is added for normal data invalidation.

## Executed regressions and corrections

- Registry tests first failed without `contextLost()` / `retry()`, then passed retained CPU identity, both rebuild/replacement orders, failed replacement while accepted rebuild waits, late disposal, callbacks unregistering/destroying, and explicit retry.
- A callback destroying registry during its first loss notification caused duplicate second-resource disposal (3 versus 2); traversal ownership guard and clearing entries before destroy cleanup fix it.
- Public consumer custom prerender configure(distance=1) after model preparation produced 0 icon pixels and 0 model pixels. Bounded render-time reprepare fixes it. Reverse direction, last removal, reintroduction at new placement and exact completed-frame pick dispatch are covered.
- Last removal initially exposed 112 old airborne icon pixels because the scene had geometryDirty but no dirty IDs. Scene owner commit `8b0627b` flushes dirty geometry before model preparation.
- Actual MapLibre 6.11 style replacement uses Style._remove(), which does not call custom onRemove. Pending native decode may continue on the same live context. Tests assert current installation and retained resources, without requiring unnecessary decode restart. Feedback owner commit `1743252` retains same-context program/buffer/VAO across repeated onAdd.
- Configuring a new basemap while actually lost reproduced stale pre-loss background restoration. Confirmed RED log `recovery-config-loss-confirmed-red.log`; viewport owner commit `6a1d116a1f7692a6fdcd9fa779050f45ec8caa2b` defers accepted native style changes until the restored painter exists. Final combined case passes with the new basemap and current pending replacement.

## Browser cases and criteria

Export `modelRecoveryCases`, using the same private Context type as registration/material modules. Root wiring names are exact:

| Case | Coverage |
| --- | --- |
| models retain resources through basemap replacement | Shared image decode count stable across live styles, retained feedback program/buffer, pending real JPEG completion, source bitmap closure, selection, shared model after one entity is removed. |
| models rebuild current presentation after real context loss | Actual WEBGL_lose_context events; PNG and solid models; ready asset versus withheld representation; pending JPEG replacement; current color/location/selection/ground attachment; model choice inside dead zone; real pointer click/hover with no stale model/attachment hit while lost; five seconds with zero renders after settling. Latest accepted basemap while lost is now included. |
| model recovery cancels stale native image completions | Actual loss during held real native decode, current replacement wins, accepted rebuild unregister/destroy, every late bitmap closes, no asset diagnostic for intentional cancellation and no repaint after destruction. |
| model recovery reports allocation failure and retries explicitly | Real context rebuild with partial buffer, shader/program and texture allocation failure; exact native cleanup; usable eligible icon fallback; explicit retry; callback-driven destroy; failed native MapLibre painter recreation rejects pending registration. |
| model frames recover from consumer prerender mutations | Both switching directions, removal/reintroduction, first-frame pixels, snapshot and exact completed-frame pick coherence after consumer callback invalidation. Direct map click dispatch here checks that precise publication; separate main recovery/picking cases exercise actual pointer gestures. |

First combined browser run passed all five at `f1af57d` plus render-time preflight fix (`recovery-first-combined.log`). Expanded five passed on clean `2af53a7d5fe1e7f9ee445dde5759cc997771ea1a` (`recovery-expanded.log`) before the additional accepted-basemap-during-loss regression. Seventeen focused registry tests passed before frontier merges. These are historical, not final integrated acceptance pins.

## Limits

Chromium / Linux ANGLE SwiftShader is local correctness evidence. Actual WEBGL_lose_context is available and exercised; missing extension is an explicit unsupported automation error, not a browser support claim. No target hardware, Firefox/Safari/Edge acceptance, triangle/material guidance, GPU timing or throughput claim. Hardware #80/#91 remains pending.

## Final handoff and verification pins

Final clean branch tip: `02a36ee95488b1850e2aaedd0fb70fac6d1e2abf`.
Final tree: `e6b9927d5b939ab535440508ac7e5833d32e988b`.
Includes root `8c8278c`, scene/viewport/picking `6a1d116`, final hasLabel bridge, model feedback retention and all worker changes. Root/scene integration owner should merge this whole branch into the combined frontier. Do not cherry-pick only the latest documentation merge.

- Reviewed own registry/layer diff and traced the shared scene/viewport bridges at `ffe9899ad97e9cc92236305302b6c7d03ed3d51e`. No production changes after that revision. Final changes `81f7b7a` / `20b75a2` strengthen only the allocation-failure browser fixture; `02a36ee` merges root evidence docs. Reviewed those final diffs and verified clean worktree and git diff --check.
- `pnpm check` passed at clean `ffe9899`; includes ticket validation, main TypeScript and control-lab TypeScript. Log `recovery-final-check.log`.
- `node --import tsx --test tests/models.test.ts tests/model-*.test.ts`: 49/49 passed at clean `ffe9899`. Log `recovery-final-focused.log`.
- Actual packed consumer, 26/26 model workflow cases passed at `ffe9899`. Includes registration, materials, placement, switching, presentation, picking and recovery. Log `recovery-final-browser.log`. Build/pack/consumer install/typecheck/build log is `recovery-final-package.log`; its first Playwright invocation selected zero tests because an anchored filter was applied to full titles. Corrected unanchored filter then exercised the already prepared exact consumer and passed all 26.
- Additional unrelated-content assertions initially sampled before restored native sources finished loading; the fixture now waits for public map.loaded() before inspecting those pixels. The stronger allocation case passes after repacking from `81f7b7a` plus that one-line fixture correction, now committed as `20b75a2`. Log `recovery-final-unrelated-settled.log`. Consumer TypeScript/build passed in that run; standalone TypeScript also passed at `81f7b7a` (`recovery-final-types.log`). No production or other test changes followed, only the root evidence merge.
- Latest packed library SHA-256: `80b08fb6685fa60bc9bb0ef1bcd3fedaaa20bbc0acf6f32336e4b4171df7a00d`.
- `recovery-browser-environment.json`: Chromium 153.0.8010.12, Linux x64, ANGLE Vulkan SwiftShader, real context-loss extension available. Generated 2026-10-04T23:29:14Z.

No remaining known #89 implementation gap. Actual unsupported hardware/browser cases and target performance remain unverified as described above. Root remains the owner of combined review, exact integrated checks and ticket closeout. Parent requested this worker to act as merger only after explicit approval of the final combined pin; no root merge performed in this implementation phase.

