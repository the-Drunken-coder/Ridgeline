# Consolidation verification record

## Reconciliation, 2026-10-21

The user requested reconciliation with current main and waived further Mac and desktop-GPU acceptance as disproportionate.
Fetched main is `e197fe92138ed90576e1804bc2ed72e9278fd97d`.
The original pushed branch remains preserved at `0a9cf2e827a0b1a68928f86ae35f67d8314cbd2c`.
The prepared branch is `t3/reconcile-project-alignment`, based directly on that main revision.
No Ridgeline PR, merge, deployment, hardware run, or hardware schedule is part of this work.

| Area | What current main contains | Prepared scope |
| --- | --- | --- |
| macOS CI | Required Ubuntu/macOS module jobs and the canonical temporary-path assertion fix from #121 | Retained unchanged |
| CPU comparison | Informational paired comparisons, baseline ancestry and geometry-alias checks | Retained unchanged, no performance result claimed |
| Native teardown | Original inline implementation, identical production source tree to the old consolidation base | Carry the previously reviewed two-file extraction without new runtime logic |
| Sensor and support documentation | Original spec/support blobs and newer CI README text | Carry factual reconciliation while preserving current CI policy |
| Consolidation history | None of the four original branch commits landed | Preserve the plan, closeout, historical handoff, and all five evidence files |
| Device acceptance | Historical Mac failures and an incomplete hardware gate | Record the user-authorized waiver and retire the hardware assignment |

The remaining target-device matrix is **WAIVED / NOT PERFORMED**, never passed, under the [canonical acceptance amendment](../entity-models/spec.md#acceptance-amendment-2026-10-21).
It no longer blocks this work. The dependent measured guideline and advisory remain unproduced; no threshold was invented.
GitHub #80 and #91 remain open as observed. This amendment changes the acceptance requirement, not their live tracker status.
The old [Mac handoff](mac-acceptance.md) is retained as history and must not be executed as a pending assignment.

Current main's [historical Mac report](../../docs/ci-validation.md#historical-mac-acceptance-report-2026-10-18) records Node, packaged/support, and installed Chrome failures.
The path assertion fix already landed. No claim is made that it repaired the reported browser failures.
Those failures remain recorded; no qualifying complete hardware matrix was established and no fresh Mac result is claimed here.
Separate manual accessibility, physical-touch, and Windows/NVDA coverage remain unverified.
VoiceOver on Safari remains an unverified accessibility limitation, not a blocking Mac acceptance assignment. No manual accessibility run is assigned here.

The administrative tracker handoff is to record the existing user waiver on #80 and remove its hardware dependency from #91, while retaining historical failures and marking the guideline/advisory unproduced.
The waiver decision is already made; this is not another product decision or request for hardware work.
No issue comment, closure, or status update was performed in this preparation.

The [sensor-compatibility decision](../airborne-entities/spec.md#requirement-reconciliation-2026-10-18) remains unresolved.
The original requirements called for terrain obstruction and independent global display controls; the current API makes terrain obstruction opt-in and groups camera geometry under the footprint gate.
The retained approval gap was not resolved by this waiver. Deciding whether to retain that contract or restore the original promises needs a separate compatibility decision.
This reconciliation changes neither sensor defaults nor public APIs.

Fresh Linux checks passed at `33d76eaeb88f2ded9a8297a95eb9972e9f0cc7c6` with a clean tracked worktree.
`pnpm check` and `pnpm test` passed, including 511 Node tests and five control-lab tests.
The focused packaged run passed 13 teardown, remount, cleanup-failure, context-phase, model-frame, recovery, and picking histories.
It also built and installed fresh consumer and starter packages and verified 77 package files and 28 package-document links.
All 60 built `dist/` files match the previously reviewed runtime archive byte for byte.
The fresh package SHA-256 is recorded with the validation results.

Direct comparisons verify the complete production source and airborne amendment equal the original branch, all five historical evidence files are byte-identical, and the historical plan/closeout/handoff bodies remain intact.
Current main's workflows, CI scripts, tests, package configuration, and lockfile are unchanged.
The local document check passed 123 links across 13 documents.
No full `pnpm validate`, fresh hosted run, or hardware collection was performed for this reconciliation.
Earlier full-suite results below remain pinned historical evidence, not a fresh aggregate pass.

The [reconciliation evidence](evidence/reconciliation-2026-10-21/README.md) retains the fresh package, both command logs, validation context, rerunnable verifier, and original review reports.
Its [manifest](evidence/reconciliation-2026-10-21/manifest.json) records 19 raw members and the exercised revision.
The fresh package SHA-256 is `300c2ece2410327ccdfd6dbed5f54b119a937c3a296369e61c0fc20c9cb07d19`.
The promoted raw archive SHA-256 is `6122ed4a20ebb31044181bc6c7fa9c2a217bf85855d150d1d1e223eef617ebf0`.
The existing promotion tool passed dry-run and actual verification. The parent independently checked all member hashes and reran the verifier from the extracted archive successfully.
The reproduction instructions include fetching the preserved original branch before verification in a fresh clone.

The [independent review and dispatch record](evidence/reconciliation-2026-10-21/review.md) found no material defects or source-comment flags.
The accepted follow-up made the package comparison reproducible and clarified VoiceOver and tracker status.
The final reviewer executed the verifier with exit 0. No additional source or shipped documentation changed after the exercised revision.
The local trail continues append-only in `.audit/project-consolidation.tsv`; its dated excerpt is retained with the evidence.

## Historical verification record, 2026-10-18

Local implementation and all required validation stages are VERIFIED.
The post-change aggregate command was interrupted. Its unfinished stages passed in a sequential rerun at unchanged source.
Hardware acceptance and the historical sensor approval gap remain open.
The [plan](plan.md) owns this execution scope. GitHub Issues retain ticket status.

## Code and delivery

- Baseline and original main are `482d16433a91f6cdf7dc67d57a3763d84d59abce`.
- The documentation amendment is `dac8c75`.
- The runtime revision for final local validation and Mac collection is `89a68852e890a1f859302dc8ff69ec3935afe890`.
- The delivery branch is `t3/assess-project-alignment`.
- No pull request, merge, deployment command, recurring schedule, or tracker write was performed.

The runtime revision contains all source changes and factual README and support corrections.
Consolidation planning and handoff documents were untracked during its local run and are outside the package file allowlist.
Subsequent closeout edits must identify any changed packaged documentation separately from this tested runtime.
The documentation follow-up is `358bb9a172c67a17fffe97f7a94cb36a4fb35788`.
Its fresh package, starter builds, archive inventory and links, and synchronous-remount browser case passed.
All 60 shipped files under `dist/` match the tested runtime archive byte for byte.
The documentation package SHA-256 is `2b63d5e739986a48eae8460ccbbd2417ed2c389801a961bd56fbbf55c580bb6f`.

## Changes and ownership

`src/maplibre-lifecycle.ts` owns captured MapLibre hooks, render depth, pending native removal, early container retirement, and hook restoration.
`createViewport` keeps logical destruction, event order, independent owner cleanup, reporting, and first-error selection.
The helper has two operations and no public package export.
The viewport no longer holds or mutates the native hook state.
Both private hooks and the MapLibre 6.11.0 pin remain in use under ADR-0002.

The separate removal call always executes before selecting the first error.
A proposed short-circuit assignment was rejected because an earlier cleanup error would skip native release.
The selected closure omits redundant removal and retirement statuses.
No model, scene, picking, publication, recovery, or idle scheduling owner moved.
No new public API, dependency, or performance claim was added.

The [existing sensor spec](../airborne-entities/spec.md#requirement-reconciliation-2026-10-18) now records the original terrain and independent-control promises, the compatibility changes disclosed in PR #8, and current appearance recipes.
Current defaults remain unchanged.
Explicit historical user approval for those changes is absent from the retained spec and PR description.
That provenance gap remains unresolved.

The README now treats closed issue #50 as dated macOS evidence.
The support guide now records PRs #114 through #118 as merged historical work.
Neither correction expands browser or runtime support promises.

## Executed verification

The environment is Linux x64 with Node 24.21.0, pnpm 11.0.9, and Playwright 1.63.0.
Installed test engines report Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6.
This workspace exposes no physical GPU.

| Check | Exercised input | Result |
| --- | --- | --- |
| Baseline `pnpm validate` | `482d16433a91f6cdf7dc67d57a3763d84d59abce` with only untracked consolidation documents | VERIFIED |
| Post-change `pnpm check` | Reviewed source later committed at `89a6885` | VERIFIED |
| Entity scene and layer module tests | Same source, 21 tests | VERIFIED |
| Focused packaged browser histories | Same source, 19 cases | VERIFIED |
| Final `pnpm validate` | `89a68852e890a1f859302dc8ff69ec3935afe890` with only untracked consolidation documents | INCONCLUSIVE, terminated by SIGTERM with exit 143 |
| Resumed unfinished validation stages | Same unchanged runtime revision | VERIFIED, exit 0 |
| Documentation package and remount case | `358bb9a172c67a17fffe97f7a94cb36a4fb35788`, one packaged browser case | VERIFIED |
| Built runtime comparison | All 60 `dist/` files from the tested and documentation packages | VERIFIED, byte-identical |

The baseline passed 498 Node tests, five control-lab state tests, 257 packaged browser cases, 144 support cases, six playground cases, five control-lab browser cases, both application builds, and seven measurement verification tests.
Its package SHA-256 is `702afb4d60de827e5618b6f6f37742ecdac5ac7e356c6c3446c2c022f0a445c9`.

The final aggregate completed type checks, module tests, all 257 packaged cases, and all 144 support cases before termination during the playground suite.
The source of SIGTERM is unconfirmed. No assertion failure was reported before the interruption.
The original log and partial output were preserved.
The parent stopped the owned orphaned preview, verified that its processes were no longer active, then released the lock according to the CI validation guide.
The entire playground suite and all later validation stages passed sequentially at the unchanged runtime revision.
This record does not claim a completed post-change aggregate command.
All original validation stages passed across those two executions, with the same counts as the baseline.
The tested runtime package SHA-256 is `6497e6016c4a0d1b25cc7f843a38464c0f1138045be0668e3c42f1f4912a208e`.

The focused run covered synchronous remounts, callback destruction, cleanup failures, all four context phases, initialization, late terrain completion, model registration invalidation, completed-frame picking, context recovery, and full quiet-period observations.
No new tests or private-hook mocks were needed.
Nested native render depth above one and cleanup faults during an active render remain inspection-only histories, as in the baseline.

## Review and remaining acceptance

Two independent sketches were compared and judged by Grok 4.7.
Claude Opus 5.5 found no actionable correctness issue in the complete source diff.
The reviewed source hashes match the committed runtime files.
Comment review found no deletions or suppressions requiring action.
It retained the two-line comment explaining the verified external MapLibre lifetime constraint.

The independent decision-trail audit required more precise recovery evidence and safer Mac collection instructions.
The append-only trail now retains the failed process scan and labels the disappeared process's identity as an inference.
The Mac handoff separates command sessions and pins each completed per-case measurement before the next invocation.
It records complete coverage across retained indexes rather than treating an individual case as a complete matrix.
The final audit found no remaining material flags. Its verdict is static and establishes no Mac pass.

## Retained evidence

The [evidence bundle](evidence/final/README.md) retains the [verification summary](evidence/final/summary.md), [review and dispatch record](evidence/final/review.md), and [revision and hash manifest](evidence/final/manifest.json).
Its compressed raw archive holds 56 original reports, contexts, package archives, review results, and the decision-trail snapshot.
That snapshot includes the final audit disposition. The local `.audit/project-consolidation.tsv` continues append-only with curation and delivery checks.
Producer output remains ignored, and selected browser runs remain pinned.

The existing promotion workflow completed a dry run and publication with these commands.

```sh
node scripts/promote-evidence.mjs .artifacts/project-consolidation-promotion.json --dry-run
node scripts/promote-evidence.mjs .artifacts/project-consolidation-promotion.json
```

Promotion verified all selected bytes and six curated links without rerunning runtime checks.
The parent independently checked every archived member against both its manifest hash and producer bytes.
The retained runtime and documentation archives also passed the 60-file comparison again after promotion.
The raw archive SHA-256 is `da7559b79fe568b2543db0bfce28020c9ffafd1c708dddcda84df886db10bade`.
The source and check pins remain those recorded above. Final handoff and evidence edits are outside the package file allowlist.
Hosted verification is unavailable because no PR or hosted run was requested.

## Deferred acceptance

- [#80](https://github.com/the-Drunken-coder/Ridgeline/issues/80) remains open for the M1 Pro and desktop discrete-GPU matrix and installed browsers.
- The user has a Mac agent available later. Its chip, browsers, and ability to observe Safari and VoiceOver remain unverified. Use the [Mac handoff](mac-acceptance.md).
- No desktop discrete-GPU fixture is available. Its browser and performance requirements remain INCONCLUSIVE.
- [#91](https://github.com/the-Drunken-coder/Ridgeline/issues/91) remains dependent on measured #80 evidence. No invented model limit or advisory was added. Prerequisite #90 is closed.
- Physical touch and manual NVDA remain unverified. VoiceOver requires actual observable Mac output.
- Any change to the original sensor default or removed global visibility control requires a separate compatibility decision before implementation.

The entire consolidation and model production acceptance are not complete while these obligations remain open.
