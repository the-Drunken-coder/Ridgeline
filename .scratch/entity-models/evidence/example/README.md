# Playground example evidence

Captured on 2026-10-05. Root owns integrated verification. These are historical worker runs, separately identified from final combined production checks.

[Delivery and observable-transition record](example-closeout.md) identifies the example delivery `15c928ce6ebb5c80144c2b10f7910b95948811c8` and its integrated tree. The [five-case successful run](example-final-playground.log) and [machine-readable outcomes](example-final-results.json) exercised clean `5b337bfee1f4f77202fca2916028e7cc992961bd` before later measurement and review corrections. The delivery's [type checks](example-post-merge-check.log) and [playground build](example-post-merge-build.log) passed after integrating the then-current root.

The [example image](example-final-ui.jpeg) is a scaled Playwright screencast frame. [Capture settings](example-final-gallery.json) record its exact clean revision, CSS size, camera and software-rendering flags. The exact browser version was not captured in that worker run. [Licensed asset metadata](example-assets.json) identifies drone, tank and plane assets under CC BY 3.0, and the Kenney boat under CC0.

The [three-workflow unsuccessful run](example-three-workflows.log) is retained with its diagnosis. Its long workflow exhausted the total test budget; default terrain and cancellation return recovered after the former readiness limits. [Read-only investigation](example-terrain-recovery-investigation.md), [default terrain observations](example-state-default.json) and [cancellation observations](example-state-cancel.json) found recovery without further input. The [sampler](example-state-probe.mjs) used a [temporary diagnostic main](example-diagnostic-main.ts) that exposed the existing public viewport, an explicit uncommitted diagnostic-only change, subsequently restored. These observations do not identify a missed production ownership boundary.

A separate [failed-reset regression](example-reset-red.log) reproduced stale sibling fetch completion overwriting a newer accepted replacement at `c5f460c`. [Its captured pixels](example-reset-red.png) support that failure. Operation revision guards fixed it at `f161563250a15ea493d52ac073ab14c3866ec57b`; the successful final suite retains the late-fetch and five-second assertions.

Software Chromium checks and images do not satisfy Apple M1 Pro, desktop discrete-GPU or native Safari acceptance. Those remain pending in #80/#91.
