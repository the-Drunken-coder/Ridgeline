# Empty model upload query

This is a narrow repair related to [#123](https://github.com/the-Drunken-coder/Ridgeline/issues/123). It is not a complete diagnosis or repair of the original CI failure. Keep that issue open.

## Confirmed repair

`ModelRenderer.prepareFrame` queried GPU error status even when it uploaded no model instances. The guard limits that query to nonempty upload groups. Initialization, frame generation, publication and actual-upload error handling stay in their existing paths. A GPU error query can synchronously block the calling thread, as documented in [WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#avoid_blocking_api_calls_in_production).

The packed-consumer regression reuses the full globe/terrain date-line drawing workflow. With no models, it arms a test-owned synchronous network hold at the real query boundary after an upsert returns. That hold deliberately simulates blocking without CPU spinning. It is not a native GPU-duration measurement or an organic failure capture.

Root ran identical final test bytes against the unguarded source and the guard. Baseline failed the eight-second deadline after the controlled hold, with `liveUpdates:13`. The guard passed the full placement, storage/reload, editing and snapping workflow. The original predicates, real pointer input, 16 ms live updates and zero retries remain. Only the controlled variant additionally waits for its observed empty-frame precondition and checks elapsed readiness time.

[Controlled baseline recording](controlled-red.webm) and [guard recording](controlled-green.webm) show those complete test journeys. Their total durations are not comparable performance measurements because the baseline stops at the failure.

## Verification

- Root `pnpm check` passed, including current browser-test types.
- Root `pnpm test` passed 546 Node tests and five control-lab tests. This preceded the browser-only observer-precondition correction, which was checked by the final typecheck and matched browser runs.
- Five focused packed-browser cases passed for frame currentness, culling, real context loss, consumer prerender mutation, and native instance-upload failure with icon fallback and explicit model recovery.
- Every packed run built and installed its package in a separate consumer, checked declarations, built consumer/starter and checked archive inventory and links. Built and installed runtime hashes match.
- Independent correctness and comment reviews found no actionable findings in source/test head `9df8eb570f2c06682704c33815fdb270d22980cd`.

The context JSON records actual source/test/runtime hashes. Baseline used the same test head with only the guard reversed. Private configs differ only in output location between the matched runs. Node 24.22.1, pnpm 11.0.9 and Playwright Chromium 153.0.8010.12 used Linux software WebGL. No new hardware or performance acceptance is claimed.

## Unresolved original failure

A separate original globe/terrain case failed on the guarded runtime with video off and no controlled hold. It stopped with `liveUpdates:1`, terrain loaded at 100 meters and a stationary camera. Its log, complete source/test/package input archive and Playwright failure trace remain in the raw archive.

Four subsequent five-case histories passed all 20 cases under low-overhead observations and a separately labelled Chrome CPU/GPU trace. Their installed runtime hashes match the guarded failing runtime. No failing instrumented window or additional causal repair was found. These controls do not erase the real failure or establish that #123 is fixed. Full passing-run Chrome captures remain transient in the follow-up checkout paths recorded by its report.

The earlier genuine failure and expiring hosted controls remain in the neighbouring historical-evidence record. None has been relabelled as fixed or harmless. The PR deliberately uses a related-issue link without automatic closure.
