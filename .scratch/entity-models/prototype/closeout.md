# Prototype and appearance-decision closeout

Spec: [Choose model appearance and switching behavior](https://github.com/the-Drunken-coder/Ridgeline/issues/76), with the terminology in [Entity models and representation switching](https://github.com/the-Drunken-coder/Ridgeline/issues/71) and the approach in [Choose how Ridgeline draws and loads models](https://github.com/the-Drunken-coder/Ridgeline/issues/75). This planning map has no approved production implementation spec yet.

Integration owner: root Codex agent. Parser/assets and renderer workers had separate file ownership. The integration owner reviewed their combined implementation and the playground coordinator. An independent reviewer examined projection, switching, picking, material passes and resource lifetime. Findings about slope roll, stale boxes, hidden-icon picking, fade depth writes, MapLibre layer wrappers, and repeated timer samples were corrected before the final runtime commit. The last runtime change synchronizes the existing projection selector when the globe view opens.

Reviewed: `61616e4819d5501d14ea157905b97808e4899866d3f...d6d803bb7fdb622384ca56f1c41e58cf252dab3f`. Root reviewed the integrated runtime diff on 2026-10-04. It implements the requested throwaway path, with the limits in [findings](findings.md). No production readiness claim is made. Later changes before publication are evidence files, acquisition-script license whitespace normalization, and license whitespace only. They were uncommitted during documentation link and diff checks.

Local verification:

- `6b3d12382cbf1dd5e9e989fc1381f5b5e4636d3f`: `node --import tsx --test tests/entity-layer.test.ts tests/entity-scene.test.ts`, 16 passed. [Output](module-checks.log).
- `0aedbc0fd137b6b0c481b325045eeb6f9fcaf50d`: root TypeScript check and `pnpm build:playground` passed after the switching-input step correction. The broader `pnpm check`, including ticket validation and control-lab type checking, had passed on the preceding implementation. No lockfile or runtime dependency changed.
- `0aedbc0fd137b6b0c481b325045eeb6f9fcaf50d`: packaged-browser captures recorded this checkout in the switching, workload, lifecycle, extras, globe and precision JSON. They exercised controls, actual click selection, the dead zone, the existing upsert workflow, context recovery, and projection fixtures. All use software WebGL. The built directory was produced after this commit; its contents were not independently hashed. No runtime files changed during these captures.
- `d6d803bb7fdb622384ca56f1c41e58cf252dab3f`: root TypeScript check and `pnpm build:playground` passed. The projection-selector change is confined to the playground. The [controls capture](software-controls.json) checked globe selection followed by switching back to flat through the existing map control.
- Historical uncommitted prototype before `6b3d123`: `pnpm test:browser -- --grep 'Picker|airborne|globe'`, 19 packaged-consumer browser checks passed. This run covered existing picker, airborne placement and globe behavior. Its exact exercised checkout was not recorded, so it is historical supporting evidence rather than a current-HEAD claim.
- Historical parser checks executed actual downloaded files, a strided mirrored transform fixture, and named unsupported-format rejection paths. Their scope and timing limits are in [model assets](model-assets.md).
- Evidence publication: relative artifact links checked for existence, JavaScript capture syntax checked, and the combined tracked diff checked for whitespace. Original Kenney license wording is retained, with line endings and trailing whitespace normalized. Runtime checks were not repeated for evidence-only additions.

Hosted verification: unavailable. No PR was created, as instructed. No hosted required-check or merge-readiness claim is made.

Remaining limits: integrated and discrete hardware measurements; globe workload timing; a measured triangle guideline; smooth transition and jitter review at normal frame rates; terrain contact across the entire enlarged footprint; label/attachment overlap decisions; production parser, diagnostics and allocation-failure hardening. The appearance ticket is closed with the user's choices in its [resolution comment](https://github.com/the-Drunken-coder/Ridgeline/issues/76#issuecomment-5976929100). The original gallery and runtime do not implement or measure the subsequently chosen replacement colors and combined ring plus brightening.

On 2026-10-04, the user chose to proceed with software smoke checks and record the hardware gap. Hardware measurements remain deferred and the triangle guideline remains unset.

Decision closeout on 2026-10-04: the appearance ticket was resolved after the live exchange. The map has a named gist, and its remaining fog graduated into [the consumer API decision](https://github.com/the-Drunken-coder/Ridgeline/issues/77), [the interaction decision](https://github.com/the-Drunken-coder/Ridgeline/issues/78), [the browser and verification target decision](https://github.com/the-Drunken-coder/Ridgeline/issues/79), and [target-browser measurements](https://github.com/the-Drunken-coder/Ridgeline/issues/80). Native map membership and blocking relationships are recorded in [tracker closeout](tracker-closeout.json). These open tickets are not production implementation tickets.

The decision-closeout changes are documentation only, based on `a31d8cf8c3e4b8c67c890f455e1a93eed49663a7`. Root reviewed the uncommitted documentation diff and checked relative artifact links and whitespace before publication. No runtime code changed and runtime checks were not repeated. The runtime review and exercised revisions above remain the evidence for the original prototype.

Status: prototype implementation complete and locally smoke-checked; appearance decision resolved. Hardware performance and remaining correctness claims are unverified. No production-readiness claim, PR or merge.

Model: gpt-6.1-sol. Harness: Codex in T3 Code. Record date: 2026-10-04.
