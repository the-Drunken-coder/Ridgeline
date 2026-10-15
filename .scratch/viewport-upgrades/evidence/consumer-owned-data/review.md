# Review of consumer-owned data boundary

Recorded 2026-10-11. Integration owner: root. Baseline/HEAD: cbef055b14fe218aa24611031c4ba1a9aa0ed540 plus uncommitted runtime/test/config digest 50853a463fee75ff3edc4a75d7332ba42388a588c263b0893256a7253977d46e, 182 files. Canonical spec: .scratch/viewport-upgrades/spec.md.

## Standards

Root reviewed the combined delivery and traced the removal through public exports, package/declaration generation, copied consumer fixtures, browser registration, CSS, starter mounting and disposal. The independent reviewer read CODE_CONVENTIONS.md and the lifecycle, rendering, interactions and testing standards, the review procedure, glossary, ADR-0001 and public guides. It independently recomputed the same final input digest and found no outstanding code findings within the removal/starter scope.

Inspection found an inaccurate documentation reference to setFeatures, which the Viewport does not expose. The guide, README and spec now use upsert/remove/clear; no new API was introduced. Native starter execution found a stale application selection label after changing mode: clear removes selected IDs but emits datachange, while the label listens to selectionchange. The consumer reset now explicitly applies empty selection. The existing native test failed in all three engines before this fix and passes in all three afterward. Core selection event semantics remain unchanged.

No motion modules, exports, controls, styles or test registrations remain. Existing playground movement timers and frame loops remain consumer-owned and unchanged. Rendering snapshots, retry bookkeeping and drawing draft undo stay within the display/interaction boundary. No additional library dependency or temporal data schema was added.

## Spec

The user's 2026-10-11 correction withdraws sample history, timeline scrubbing, interpolation, playback, retained trails and camera-follow policy from Ridgeline. The implementation removes all ten new motion-related files and their integrations. The starter now has selection/styling and drawing/storage recipes. Drawing retains its approved rail and fixed inspector; the replay layout dependency is closed by withdrawal.

The existing feature and camera APIs let applications submit their chosen current geometry/pose and camera. Native packaged checks verify incremental replacement preserves camera and selection, and moving picker choices remain stable. Current support reruns the unchanged selection/presentation/drawing integrations across three engines. The revised starter saves/reopens exact numeric edits, preserves native keyboard focus, fits at 390 CSS px and disposes drawing controls on scenario switch.

Root inspected the retained desktop and narrow drawing screenshots. Fields remain readable and structured, the rail/inspector retain the approved design, and the narrow layout has no horizontal overflow. This removal introduces no new visual direction.

## Verification and limits

Final pnpm check, 33 support cases, three consumer update/touch cases and the playground production build pass. The 424 library/tooling tests and five control-lab tests passed at the initial removal input; only starter main.ts changed afterward, and its installed-package build and all three engine journeys were repeated. Before/after final manifests match. Full 196-case Chromium, playground browser, control-lab browser and measurement-tool suites were not rerun for this removal; their prior checks remain historical evidence for unchanged files.

Hosted checks are excluded by the user's publishing constraint. Physical GPUs/devices, installed browsers, pen, manual screen-reader acceptance and long-session memory remain unverified. Rectangle/model/GPU query approximations remain documented. Earlier motion/replay evidence remains unchanged and explicitly historical. Review is inspection evidence; producer reports establish execution.
