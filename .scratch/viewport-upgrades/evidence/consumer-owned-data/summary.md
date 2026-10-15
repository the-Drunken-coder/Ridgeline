# Consumer-owned data correction

Recorded 2026-10-11. Baseline/HEAD cbef055b14fe218aa24611031c4ba1a9aa0ed540 plus uncommitted runtime/test/config digest 50853a463fee75ff3edc4a75d7332ba42388a588c263b0893256a7253977d46e across 182 files.

Removed the new library motion/history/playback/trail/follow controller and replay controls, exports, CSS, demo and tests. Applications own history, time selection, interpolation, retention, playback and camera policy, and send complete current features through upsert. Display removal uses remove/clear; chosen camera changes use setCamera. Current render snapshots and drawing drafts remain Ridgeline-owned display/interaction state. Existing consumer movement examples remain intact.

Selection/presentation, standard controls/coordinates, drawing holes/exact segments/edge snapping/touch and adoption/support upgrades remain. The starter now has two recipes. Drawing keeps the approved rail and fixed inspector. No replay layout choice is pending and nothing was published, pushed, committed, deployed or opened as a PR.

Typechecks pass. All 424 library/tooling and five control-lab tests pass at the initial removal input. Initial support passed 30/33 and reproduced a stale starter selection label in all three engines. Explicit application reset selection fixes it; the final installed package passes all 33 support checks, 11 per engine, plus three Chromium update/touch checks. Playground production build and declarations pass. Final input manifests match; root and independent review report no outstanding removal/starter findings. Physical/manual/hosted acceptance remains unverified.

Library JS is 322,650 raw and 90,748 gzip bytes; CSS is 7,011 raw and 1,975 gzip bytes. Together the retained upgrades add 40,651 raw and 11,218 gzip bytes over the clean baseline, with no new library dependency. Motion removal reduced the previous upgrade build by 23,939 raw and 6,499 gzip bytes. Payload sizes do not establish hardware performance.

The raw archive retains initial/final input manifests, actual successful and failed reports, environment data, bundle hashes, scope snapshot and the prior closeout. Previous evidence/final remains unchanged and historical. Current producer runs and the reproduced failure remain pinned. Promotion verifies bytes and links without executing checks again.
