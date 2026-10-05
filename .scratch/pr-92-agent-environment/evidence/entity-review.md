# Entity review reference and callback checks, issue #97

Date: 2026-10-05 UTC, completed at 16:16 UTC.

Spec: `.scratch/pr-92-agent-environment/spec.md`, acceptance criteria 5 and 6. Ticket: https://github.com/the-Drunken-coder/Ridgeline/issues/97.
Integration owner: Root coordinator, combined verification #101.
Reviewed: `049c6bfad689055e8d26f14c0f479add924846cd...7699db6c9d16e6483ea36e1f21923d1988bdf677`, scoped diff reviewed for unintended changes.
Local verification: Runtime and test inputs at `049c6bfad689055e8d26f14c0f479add924846cd` in `/tmp/ridgeline-93-entities`; documentation was added during the browser run and committed afterward. Runtime/test/build inputs are identical at final head `7699db6c9d16e6483ea36e1f21923d1988bdf677`.
Hosted verification: None for this slice. Root's combined review/check record remains separate.

## Delivered guidance

`docs/agents/entity-review.md` maps accepted feature snapshots, successful prepared presentation, terrain preparation, representation choices, prepared model frames, completed drawing/picking, and native feature publication to their owning modules and currentness/invalidation checks. It includes native map/container cleanup ownership during callback destruction and synchronous remount.

The reference names exact existing browser cases for every requested callback history, links their source, distinguishes module coverage from browser pixels/native teardown, and directs reviews to retain pinned attempted histories and limits. `CODE_CONVENTIONS.md` links this focused reference only for changes affecting these guarantees. It links authoritative README contracts instead of redefining them.

The final scoped diff contains those two documentation files only. No production code, regression, registry, browser harness, or public contract changed. No new missing history or reproducible implementation defect was found, so no duplicate test was added.

## Executed checks

Installed real dependencies with `pnpm install --frozen-lockfile`. No dependency symlink was created. Generated dependencies/build outputs remain ignored, and the worktree is clean after the commit.

`node --import tsx --test tests/entity-scene.test.ts tests/model-presentation.test.ts tests/model-switching.test.ts tests/model-frame.test.ts tests/models.test.ts` passed 32 tests, with no failures, cancellations, or skips. Producer output: `/tmp/ridgeline-93-context/entities-module-tests.log`.

`pnpm test:browser -- --grep 'Model style failures retain|Model diagnostics preserve|Model frame callbacks publish|Viewport destruction preserves|Model switching preserves choices|Model switching preflights|Models cull off-screen'` passed all 7 selected cases in 22.4 seconds, with zero retries. The runner built and packed the library, installed the package into its separate consumer, and ran that consumer's `tsc --noEmit && vite build` before browser execution. Producer output: `/tmp/ridgeline-93-context/entities-browser-tests.log`.

The browser command ran in the owned checkout with one worker and real Chromium/SwiftShader. The source uses controlled sampler/data/resource failures within the real viewport, terrain, frame, publication, and native map paths. These checks do not establish hardware performance or other-browser acceptance.

All 42 relative links and heading fragments in the conventions/reference resolve. `git diff --check` passes. `git diff 049c6bf..7699db6 -- src tests scripts package.json pnpm-lock.yaml` is empty. The branch `implement/93-entities` includes integration tip `049c6bf`; the requested integration merge was already up to date.

## Attempted histories and observed outcomes

| Executed case | Attempted history and observed result |
| --- | --- |
| Model style failures retain the last complete pose until successful recovery | Accepted location, heading, pitch, roll, altitude, appearance, and model overrides changed while style threw. Earlier model and physical-attachment pixels remained exact; prepared altitude/time stayed earlier while store reads reflected new coordinates. Failed retry and valid configuration changes retained the complete presentation without damaging the shared renderer. Real pointer input picked its retained box. Successful recovery drew the current blue model and retired the old pick box, preserving its neighbor. |
| Model diagnostics preserve entity computation through selection and preview callbacks | `onError` attempted unchanged selection, preview, and selection of a different entity on model-unavailable diagnostics. Placement, icon fallback, accepted data, and attachment pixels recovered without manual retry. The same case restored earlier heading input from a missing-heading diagnostic inside the dead zone; the established model choice and visible body survived. |
| Model frame callbacks publish only current placement and appearance | `entitychange` replaced pose/style during preparation. The first completed frame matched a directly accepted control, retained its neighbor, attributed the latest accepted revision, and owned actual picking. Below-terrain replacement withheld stale model output; removal retired it. A computation callback destroyed twice and synchronously remounted. The old viewport rejected mutation immediately, removed its DOM, stopped owned uploads/draws, and left the replacement canvas/map class intact. |
| Models cull off-screen bodies after enlargement and recover on camera motion | Culling excluded irrelevant submitted instances, frame counts, and boxes while retaining logical representation. The enlarged visible edge was picked with real input. Camera re-entry restored current geometry. After idle, the full five-second interval had zero render frames. |
| Viewport destruction preserves synchronous listener remounts | Destroy listeners remounted in the same container during ordinary destruction and active native render. Both replacement viewports became ready with one canvas/map class retained. Repeated old destruction left the replacement intact. |
| Model switching preserves choices through temporary terrain and asset readiness | Unknown terrain showed fallback; completing pending preparation recovered the retained choice under stationary input. Terrain footprint abortion removed an entity, and provider reset did not revive its preparation. Reference-change cancellation removed one batch member while preserving unrelated accepted work. Removing an ID whose abort callback reintroduced it preserved the new missing-model reference, native GeoJSON publication, and current icon pixels. |
| Model switching preflights failures and rejects reentrant stale frames | Real model buffer and draw failures produced same-frame eligible fallback and explicit recovery. A sampling callback changed configuration; only current settings controlled the frame. An `entitychange` callback removed/reintroduced an ID, with current unavailable registration and icon pixels retained. Destruction during registration cancelled the promise and scheduled no later repaints. |

The focused module cases independently exercised preparation errors, style/sample removal and replacement, retained placement, camera failure recovery, selection, unchanged terrain ownership, model feedback geometry, distance-choice histories, frame culling, and registration/resource cancellation. Their GPU/map collaborators are doubles, so the actual pixel, pointer, and native teardown conclusions above come from the packaged browser executions.

## Remaining limits

- This slice exercised the named `onError` and `entitychange` histories, not every permutation of callback channel or callback order. The reference requires a new concrete history when a changed guarantee lacks coverage.
- Browser context-loss material/texture workflows, the complete packaged suite, playground/control-lab suites, and hosted required checks were not run by this slice. No such broader verification is claimed.
- Independent Standards/Spec review, verification after integration with #94/#95/#98/#99, curated evidence promotion, and the shared #101 closeout belong to root. Hardware/browser acceptance and the measured triangle guideline remain outside this spec.
