# Final independent Standards re-review

Date: 2026-10-05 UTC.
Reviewer: independent Matt Code Review Standards worker. Root owns integrated verification.

## Revisions and scope

Base: `2733cee9fe9440237a36e90d9efa2fc4239b87c3`.
Original complete-diff review: `1e4c2c589902ecf9c6509acff725d31912d90de7`, source tree `b948ba66a835753b8e63c22d161a2e31686a2893`.
First corrective review/execution: `31221198ab629d6030d8c0ba2aab93aac2811acc`, source tree `8e6c0efa6f852371658ab9cb49846ea7f872a703`.
Final reviewed and exercised head: `cf09290e615dfc4809b09519fdfb0825c4642ba9`, source tree `04413b0db510cc12b4794ea53f98cf331003ac53`.

The prior full-base review is recorded in `/tmp/ridgeline-model-context/final-standards-review.md`. This review inspected the corrective delta `1e4c2c5...3122119`, then the final source/test delta `3122119...cf09290`. Together they cover the final full-base diff. Root later integrated the final pin as `708988d1253863412f73915a650b610518ddb9fc`. Independently checked exact full-tree equality (`70a7b68e0c0ac2899ba39213265050b64baac637`), source equality (`04413b0db510cc12b4794ea53f98cf331003ac53`) and tests equality (`d7fddd93adccfae4cdb4aa07a5b4dbacf31e7981`) against `cf09290`. There is no delivery delta, so this final review transfers to the integrated revision; my execution pin remains `cf09290`. Evidence-only historical additions were inspected as evidence, not interpreted as current test results or product source. No source changes occurred after the final pin during this review.

Execution checkout: `/tmp/ridgeline-model-standards-review`, created as an independent detached worktree. During execution its only untracked item was a dependency symlink `node_modules` to the root's installed dependencies. No tracked or source files were modified. The symlink was removed after execution, leaving the review worktree clean. Root and implementation-worker checkouts were never mutated or used for execution. All review scripts, logs and JSON are outside the repository.

Read the repository AGENTS and authoritative CODE_CONVENTIONS, glossary, accepted ADRs, domain and issue-tracker guidance, package commands, public README, exact canonical `.scratch/entity-models/spec.md` and `/tmp/ridgeline-model-context/issue-90.md`. Acceptance coverage belongs to the separate Spec axis. Hardware #80/#91 remains pending by user direction; parent #81 remains unchanged.

## Final result

No remaining documented-standard violation or actionable new heuristic finding was found in the final corrective source/test hunks. The confirmed callback frame and native-container ownership failures below are resolved at the final pin. This is an independent Standards result with explicit CPU evidence. It is not a claim that the final integrated packaged-browser suite, hosted checks or target hardware have passed.

## Callback frame and final box histories

Relevant hunks: `src/entities.ts` captures revision/configuration before `flush()` and rejects the attempt if a consumer changed the owner; draw/hit/presentation submission checks the final enlarged projected box. `src/entity-projection.ts` supplies the narrow viewport-intersection predicate. `ModelLayer.prerender` already bounds re-preparation to two attempts.

Rules applied: CODE_CONVENTIONS ownership/currentness lines 39-41, completeness audit lines 58-65, and behavior-based module tests lines 49-53.

Executed real `EntityScene`, registry, layer, renderer and production measurement interfaces, with the same GL recording double and controlled RAF queue that demonstrated the original bug. Original invalid history accepted altitude 100, then synchronously upserted 300 from the placement callback. At `1e4c2c5` that submitted 100 and emitted facts for the newer accepted revision. At both corrective pins it rejects that mixed attempt and submits altitude 300 in the first completed frame. Valid control accepts 300 before preparation and also submits 300. Both final histories have no pending repair frame. The formerly summary-identical valid/invalid facts no longer conceal different uploaded placement.

Evidence at final pin: `/tmp/ridgeline-model-context/standards-final-frame-{callback,valid}.{mts,json}`. Scripts assert accepted altitude, recorded uploaded instance altitude and follow-up state through real interfaces; no source-text assertions.

The offscreen CPU preparation history has one onscreen entity and another whose projection is x=1888.89 in a 1000-pixel viewport. Previously both entered the proposed draw batch. Final real scene/model-layer preparation proposes exactly one instance. `model-frame.test.ts` separately executes final-box inclusion and enlarged-box partial visibility; the projection tests execute depth clipping. Inspection confirms offscreen culling does not erase the logical model choice or hysteresis state and that the same gate owns draw, hit and presentation publication.

Evidence: `/tmp/ridgeline-model-context/standards-final-cull.{mts,json}`. GPU drawing is stubbed in this focused CPU probe; no pixel or hardware claim follows from it.

## Native render and remount ownership histories

Relevant final hunks: `src/viewport.ts` wraps the native `_render` stack, retires owned DOM before delivering `destroy`, suppresses later native container cleanup, and defers native resource removal until the outer render unwinds. `src/entities.ts` synchronously calls `EntityLayer.onRemove()` during scene destruction.

Traced owners outside the diff: installed MapLibre 6.11 `Map._render`, `redraw`, repaint scheduling, `remove` and `_cleanupContainer`; `Painter.render`/`renderLayer`; actual `drawCustom`; style source, tile and custom-layer teardown; native default control `onRemove`; `createArrowheads`; `EntityLayer`, `ModelLayer`, registry, renderer, model feedback, publication and viewport callbacks. The native painter continues using style/tile resources after a custom callback, so full `map.remove()` must wait for the native stack. Arrowhead source/layer removal follows that same boundary. Logical cancellation and owned custom resources retire synchronously, and repeated native custom-layer cleanup tolerates that prior retirement. Native removal aborts the next frame and removes map-specific handlers, workers and controls. Existing publication/registry tests cover late completion and replaced destination owners.

At `3122119`, executed a new invalid history through public `createViewport`: a destroy listener creates another viewport in the same container before old native DOM cleanup. Exact installed `Map.prototype._cleanupContainer` removes the replacement's shared `maplibregl-map` class despite leaving its canvas. Both ordinary destruction and active-native-render destruction failed. Remount after destroy returned and nested render controls retained the class. This established a real ownership/currentness breach under CODE_CONVENTIONS lines 39 and 41, not a hypothetical smell. Evidence: `/tmp/ridgeline-model-context/standards-viewport-cleanup-probe.{mts,json}`. Root reports that its implementation worker independently reproduced both failures with the actual packed public browser API; that execution is owned by root, not claimed as this reviewer's check.

At `cf09290`, reran the identical public interface fixture with the exact installed cleanup function and added the nested-render listener variant. All five histories pass: ordinary listener remount, active-render listener remount, active-render remount after return, nested-render remount after return, and nested-render listener remount. Each observes zero old canvases before mount, exactly one replacement canvas afterward, preserved shared container class, and exactly one old native removal. The nested control also asserts no native removal before the outer render returns. Repeated old destruction preserves the replacement; destroying the replacement removes its own canvas.

Evidence: `/tmp/ridgeline-model-context/standards-viewport-cleanup-final.{mts,json}` plus `standards-viewport-maplibre-stub.mjs`. Scope: real viewport/scene/registry/publication code, native Map constructor/render/remove doubles, exact installed native DOM cleanup. This preserves the failing cleanup ordering while requiring no browser or GPU. It does not emulate all native painter internals or establish browser pixels. The permanent new packaged-browser case covers ordinary and active-render listener remount through actual public calls; inspection found its disposal/control assertions consistent with the repaired ownership boundary.

## Executed checks and limits

At both `3122119` and final `cf09290`, executed:

```sh
node --import tsx --test tests/model-frame.test.ts tests/models.test.ts tests/model-placement.test.ts tests/model-switching.test.ts tests/model-picking.test.ts tests/model-presentation.test.ts tests/entity-projection.test.ts tests/entity-layer.test.ts tests/elevation.test.ts tests/entity-scene.test.ts tests/feature-publication.test.ts tools/model-measurement/report.test.ts
```

Result each time: 95 passed, zero failed/cancelled/skipped. Logs: `/tmp/ridgeline-model-context/final-standards-rereview-tests.log` and `final-standards-rereview-final-tests.log`. Final callback, valid control, culling and five-history cleanup scripts all exit successfully. Diff whitespace checks pass for the final corrective delta and product source/test/script corrective hunks; tooling-enforced whitespace is not a Standards finding.

No browser/GPU jobs, tracker updates, source fixes, PRs, comments, pushes or hosted actions were performed. Root/worker owns final public browser regression and integrated checks at the final pin. No PR or hosted evidence exists. The optional shader consolidation judgement from the earlier review remains non-blocking and was intentionally not reopened. Hardware performance and Safari support remain unverified by this review.
