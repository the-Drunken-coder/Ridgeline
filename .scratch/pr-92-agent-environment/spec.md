# Improve validation and review safeguards after PR #92

**Kind:** spec

Status: specified for implementation; no safeguards in this spec have been implemented or verified by this publication.

Created: 2026-10-05. Source: the PR #92 retrospective and the user's request to turn its six recommendations into a spec. Testing boundaries were confirmed by the user. Baseline: merged PR #92, main revision `bf4cfca0ccaa7b781f7e3671d4982000bc9c3c50`, containing PR head `eb878b9617151f92d1136df24b07bb947ecc239e`.

## Problem Statement

Ridgeline's development environment lets important checks and review cases fall outside the normal workflow. PR #92 passed extensive local checks and independent reviews, but later review found a parser allocation problem, incomplete entity recovery, and an incorrectly configured measurement workload. Browser debugging also competed with disk exhaustion, coordinate conversion mistakes, slow screenshot capture, and an intermittent idle assertion with no identified scheduling cause.

The fixes landed in PR #92. The remaining problem is recurrence: a future agent can skip the measurement suite, repeat the same review blind spots, or spend hours diagnosing an unhealthy test environment. Development evidence also grew to 316 files and roughly 118,000 text lines before a separate curation pass.

The maintainer needs the routine workflow to run the relevant checks, expose resource failures early, give reviewers concrete ownership histories to inspect, and retain useful evidence without accumulating every experiment.

## Solution

Improve the existing environment in six areas:

1. Make parser allocation bounds an explicit semantic review obligation, building on the existing regression.
2. Include measurement checks in local validation and required CI.
3. Give reviewers a focused reference for entity state ownership and callback histories.
4. Add browser-run disk preflight and bounded retention of inactive generated artifacts.
5. Reuse browser observation helpers for pixel coordinates, visible readiness, and idle-failure diagnostics.
6. Produce transient development evidence outside versioned feature evidence, then promote a curated final set at closeout.

Implement measurement gating and resource checks first. Keep the work proportional to these failures: extend existing commands, tests, and documentation rather than introducing another validation framework or changing the viewport's public API.

## User Stories

1. As a maintainer, I want one local validation command to include measurement checks, so that a successful run covers the tooling used for acceptance evidence.
2. As a maintainer, I want CI to run the same measurement checks, so that individual agents cannot accidentally omit them.
3. As a maintainer, I want the required CI gate to reject failed, cancelled, missing, or skipped measurement verification, so that an incomplete run cannot report success.
4. As a developer, I want measurement verification to exercise the packed library and its real consumer, so that development aliases cannot hide integration failures.
5. As a reviewer, I want the approved 40 CSS px workload to remain checked, so that reports describe the intended model treatment.
6. As a developer, I want measurement failure artifacts to identify the exercised revision and command, so that a failed run can be reproduced.
7. As a reviewer, I want to trace external counts into parser allocations, so that a small model asset cannot request unchecked decoding expansion.
8. As a reviewer, I want explicit attention to implicit and derived allocations, so that fields without backing bytes receive the same scrutiny as stored data.
9. As a developer, I want malformed allocation fixtures to fail safely, so that regression testing does not exhaust the machine running it.
10. As a consumer, I want valid supported model assets to retain their existing behavior, so that review improvements do not introduce arbitrary asset restrictions.
11. As a reviewer, I want a short map of accepted feature data, prepared entity geometry, and completed rendered frames, so that I can identify the owner of each observable result.
12. As a reviewer, I want callback histories that include throwing and non-destructive mutations, so that review covers more than cancellation and destruction.
13. As a consumer, I want a failed style update to preserve the complete last successfully prepared presentation, so that position, orientation, appearance, attachments, and picking remain consistent.
14. As a consumer, I want a diagnostic callback that changes selection or preview to recover interrupted current work, so that an accepted entity does not remain stranded.
15. As a consumer, I want replacement or removal during a callback to retire older work, so that stale geometry and events cannot return.
16. As a consumer, I want destruction and remount during a callback to preserve the replacement viewport, so that old cleanup cannot damage the new owner.
17. As a reviewer, I want concrete attempted histories and their outcomes recorded at pinned revisions, so that a clean review has inspectable evidence.
18. As a developer, I want browser runners to check available disk before expensive setup, so that storage failure is diagnosed before a long test run.
19. As a developer, I want low-space errors to report the relevant filesystem and required capacity, so that I can take a precise recovery action.
20. As a developer, I want repeated local runs to retain a bounded set of inactive generated consumers and artifacts, so that disposable output cannot fill the disk indefinitely.
21. As a developer, I want cleanup to preserve active or interrupted run ownership, so that it cannot remove output still used by child processes.
22. As a maintainer, I want tracked files, pinned evidence, and external paths protected from cleanup, so that resource management cannot erase source or acceptance evidence.
23. As a test author, I want shared conversion between CSS and drawing-buffer pixels, so that picking and pixel assertions work at more than one pixel ratio.
24. As a test author, I want conversions to account for origin direction and actual canvas dimensions, so that WebGL readback coordinates identify the intended point.
25. As a test author, I want readiness assertions to wait for the required visible pixels, so that published model state is not mistaken for completed screenshot capture.
26. As a test author, I want visibility checks to reject transparent background and unrelated geometry, so that a blank model does not satisfy the assertion.
27. As a developer, I want software-rendering deadlines to cover browser setup and observed capture delays, so that fixture creation does not time out before test-level budgets apply.
28. As a reviewer, I want actual pointer and keyboard workflows retained, so that helper extraction cannot replace real interaction with synthetic handler calls.
29. As a developer, I want an idle assertion failure to retain bounded scheduling evidence, so that the next investigation can identify unfinished work or an unexpected render.
30. As a maintainer, I want idle assertions to keep their full quiet interval and zero-render requirement, so that timing improvements cannot hide a render loop.
31. As a developer, I want intermediate logs, probes, screenshots, and repeated reports to remain transient, so that routine experiments do not inflate the versioned feature record.
32. As a maintainer, I want closeout to retain final reviews, revision pins, useful visuals, summaries, and byte-exact raw reports, so that the evidence remains auditable after curation.
33. As a reviewer, I want archive hashes and reproduction instructions, so that compact evidence remains independently verifiable.
34. As a maintainer, I want historical and current evidence clearly distinguished, so that an old successful run cannot be presented as verification of newer changes.
35. As a maintainer, I want semantic review guidance reached through focused pointers, so that agents do not carry another large always-loaded instruction block.
36. As a maintainer, I want software correctness checks kept separate from target-hardware acceptance, so that environment improvements do not imply unmeasured performance or browser support.

## Implementation Decisions

- Extend the existing validation commands, aggregate CI gate, browser runners, packaged-consumer fixtures, and repository review guidance. Keep dependencies and abstractions proportional to the work.
- Run the existing measurement command exactly once in local full validation. Add a dedicated measurement CI job with the browser and build prerequisites it actually needs, and make its result part of the existing required aggregate gate. Keep raw producer output and failure artifacts available on failure.
- Reuse the existing workload and instrumentation tests. Preserve the assertion for the approved 40 CSS px model-size floor and the real packed-library probe. Ordinary verification does not run the complete target-hardware measurement matrix.
- Add the parser allocation obligation to the existing conventions read by reviewers. Review external counts, multiplication, implicit zero-filled values, derived arrays, and repeated decoding against the bound that actually limits each allocation. A review records its reasoning and an executed safe reproduction where practical. This is a semantic obligation, not a syntactic lint rule.
- Preserve the parser bound and regressions merged in PR #92. This work does not set a model triangle guideline or redefine the supported GLB subset. Newly demonstrated defects receive focused behavioral regressions; do not duplicate existing tests merely to restate their checks.
- Add one focused entity review reference, reached from the existing conventions when changes affect entity preparation, publication, callbacks, recovery, or disposal. Describe accepted feature data, the last successful prepared presentation, terrain preparation, representation choice, model frame preparation, completed drawing, and native feature publication. Name which owner or revision makes each result current and which events retire it.
- The callback reference includes throwing style callbacks; diagnostic callbacks changing selection or preview; replacement, removal and reintroduction of the same feature ID; restoration of earlier input; configuration changes after failed preparation; and destruction with same-container remount. Link existing executable cases rather than maintaining copied contracts.
- Browser-run resource handling belongs to development tooling, outside the public viewport API. Apply disk preflight to packaged, playground, control-lab, and measurement browser commands before their expensive install, build, or browser setup. Reuse their current ownership rules rather than adding a competing lock system.
- Document one nonzero free-space threshold for the affected filesystem, supported by observed setup and artifact growth, and allow an explicit per-run override. Check the filesystem that will receive generated output. Failure reports available and required bytes, the command, and a recovery action; an unreadable capacity result is an infrastructure error, not a successful check.
- Cleanup has explicit ownership and retention bounds. Limit candidates to recognized, ignored generated output inside the checkout. Preserve current runs, interrupted runs whose children may still be active, selected failure evidence, and anything outside the declared retention policy. Never infer that a lock is abandoned solely because its parent PID is absent.
- Exclude tracked files, curated evidence, permanent fixtures, and paths reached through symlinks from deletion. Prefer existing fixed consumer directories and selective replacement over a new cache service. Record deleted paths and keep required failure output available until it is retained or explicitly released.
- Browser observation helpers remain test support. Use actual CSS and physical canvas dimensions, including independent horizontal and vertical scales and the WebGL bottom-origin conversion. Browser device pixel ratio and the map's configured pixel ratio are distinct facts.
- Visible-readiness helpers poll the existing fixture-specific pixel criterion with a bounded deadline. Retain successful coordinates for subsequent real pointer input. Keep alpha and color/shape criteria that distinguish models from background and attachments; a generic helper must not weaken the existing threshold.
- Preserve the setup, action, and rendering budgets corrected in PR #92. Apply fixture budgets before browser-context creation. Continuous screenshot tracing remains separate from explicit pixel assertions and failure capture; changing diagnostic capture does not establish causation for every software-rendering delay.
- Preserve a complete five-second quiet interval with zero unexpected render frames after observable work settles. On failure, capture a bounded timeline of renders, readiness/publication changes, pending work, and scheduling causes available from the existing rendering path. Any added observation is opt-in or test-owned, disposed after the run, and must not schedule rendering itself. Treat an unexplained extra frame as unresolved evidence rather than adding automatic retries or accepting it as harmless.
- Intermediate development output stays in the existing ignored artifact area. Versioned feature evidence is an explicit closeout promotion: final review reports, a compact revision/check record, readable summaries, selected visuals, and compressed byte-exact producer reports with member hashes and reproduction instructions. Useful research and decision artifacts may still be versioned deliberately.
- Clarify the existing tracker and verification guidance to distinguish transient output from curated supporting evidence. Preserve existing historical evidence and permanent tests. Do not add another global steering document or rewrite unrelated guidance.
- Name one integration owner before any parallel implementation. The owner reviews the combined diff and records reviewed, locally exercised, and hosted-tested revisions separately. Specification publication itself makes no implementation or merge-readiness claim.

## Testing Decisions

The user confirmed the existing validation commands and real packaged-consumer/browser workflows as the primary testing boundaries, with focused checks for parser allocation and browser-runner resource failures. A good test executes observable behavior and preserves the relevant failure mode. It does not read source text to assert an implementation pattern or replace real interaction with mocked handlers.

- Exercise measurement verification through its existing command and actual packed consumer. Verify local command inclusion and aggregate CI failure handling with executable command/gate tests and actual hosted producer output. Reuse existing validation automation fixtures for failed, cancelled, missing, and skipped prerequisites.
- Exercise parser rejection through the current parser interface and public model-registration workflows where relevant. Use moderate-size malformed fixtures or safely intercepted resource requests, never genuine billion-element allocations. Retain successful supported-asset cases alongside rejection behavior.
- Exercise callback histories through the packaged viewport interface, real terrain/recovery paths, visible models and attachments, and actual picking. Focused entity tests can establish preparation and publication invariants, but cannot substitute for browser pixels or native teardown.
- Exercise disk preflight and retention through runner process boundaries in temporary directories. Simulate available-capacity results at the filesystem boundary instead of filling the real disk. Preserve actual filesystem ownership, locks, symlinks, and protected files in cleanup tests.
- Exercise coordinate conversions and visible readiness through existing browser fixtures at map pixel ratios 1 and 2. Include a case where browser device pixel ratio differs from the map ratio, WebGL readback needs vertical inversion, and a screenshot becomes visible after model state is ready. Keep flat/globe coverage when projection affects the existing case.
- Exercise idle failure capture with a controlled delayed publication/render and a genuinely settled scene. The former must fail and retain a bounded diagnostic timeline; the latter must pass a complete five-second observation. Verify that observation does not create new render work.
- Validate promoted evidence by comparing archive members with producer bytes and recorded hashes, verifying links and reproduction instructions, and checking that disposable output remains ignored. Evidence curation must not alter runtime inputs or permanent regressions.
- Follow prior art in the executable validation-gate fixtures, packaged browser-runner ownership tests, parser fixtures, model frame/recovery browser workflows, playground screenshot polling, and measurement report/workload/pixel/instrumentation checks. Prefer extending those seams to adding another test harness.

### Acceptance criteria

1. Local full validation runs all existing ordinary checks and the measurement suite exactly once; the measurement consumer is typechecked and built against the packed library.
2. Hosted validation runs measurement checks at the current revision. The required aggregate gate succeeds only when that job succeeds, and rejects its failure, cancellation, missing result, and unexpected skip. Retained evidence identifies the PR head and actual tested checkout.
3. The existing 40 CSS px workload assertion and packed instrumentation/ownership probe execute in the required workflow, with useful producer artifacts on failure. Hardware measurements remain a separate gate.
4. The reviewer guidance explicitly requires an allocation-bound trace for changed parsers, including implicit and derived allocations. Its linked executable regression rejects the PR #92 failure safely, and supported assets continue to pass.
5. The focused entity reference identifies the owner and invalidation rule for each stage, and maps every listed callback history to an existing executable case or an explicit additional regression. Review evidence records attempted histories and outcomes without claiming unexecuted coverage.
6. Packaged-browser checks retain the complete last successful model pose, settings, representation choice, attachments, and picking after styling failure; selection/preview diagnostics recover current interrupted work; replacement/removal/destruction histories cannot publish obsolete work.
7. Every affected browser entrypoint checks the relevant filesystem before expensive setup. Insufficient or unreadable capacity produces a nonzero exit with available/required capacity and command context. The documented threshold has a recorded rationale and a per-run override.
8. Repeated runs remain within the documented generated-output retention policy. Cleanup tests prove preservation of active/interrupted ownership, pinned failures, tracked files, curated evidence, external paths, and symlink targets.
9. Shared pixel observation works at map ratios 1 and 2, including a differing browser ratio and WebGL origin conversion. Transparent background or unrelated attachment pixels cannot satisfy the model fixture's visibility criterion; actual pointer input still picks the intended entity.
10. A fixture with delayed screenshot visibility passes only after the existing pixel criterion is met, and an absent model fails at the bounded deadline. Browser setup receives the intended budget before fixtures execute.
11. The idle check retains the full five-second zero-render assertion. A controlled extra render fails with bounded, revision-linked scheduling evidence; a settled scene passes without observation scheduling more work. Unexplained failures remain identified as limits.
12. A closeout dry run promotes the curated evidence set, preserves raw bytes and verifiable archive hashes, leaves intermediate experiments ignored, and distinguishes historical runs from evidence for current inputs. No existing historical record or permanent test is deleted as part of this change.
13. The integration owner records the final reviewed and locally exercised revisions, required hosted results for the current PR revision, and remaining limits. Each criterion has evidence or an explicit gap before the work is reported resolved.

## Out of Scope

- Reimplementing the entity-model feature or reopening defects already corrected in PR #92 without a new reproduction.
- Changing the public viewport API, supported model format, rendering architecture, model triangle guideline, or consumer-owned application workflows.
- Performing the Apple M1 Pro, desktop discrete-GPU, or target-browser acceptance matrix; those deliveries remain in #80 and #91.
- Introducing another lint/test framework, a machine-wide scheduler, a general cache service, or a broad rewrite of global agent instructions.
- Increasing permitted idle renders, weakening visible/picking assertions, adding automatic browser retries, or presenting software-rendering delays as hardware performance measurements.
- Deleting existing tracked historical evidence, fixtures, source, or unrelated package caches; rewriting Git history or opening/merging a PR as part of specification publication.
- Splitting or delegating implementation tickets during this publication. Any later breakdown follows the repository tracker rules and passes this exact canonical spec to workers and reviewers.

## Further Notes

The retrospective investigated implementation and follow-up review sessions on 2026-10-05. Its reported defects were fixed before PR #92 merged. Disk exhaustion was directly observed through `ENOSPC` and 48 MB free space; a causal connection between disk pressure and every renderer error was not established. The intermittent culling idle check passed ten unchanged local repetitions and a hosted rerun, but the extra hosted frame's cause remains unknown.

One integration owner should coordinate all six workstreams. There is no hardware dependency for implementing this environment work. Hosted verification depends on a PR or other authorized verification branch existing later; successful local checks alone do not establish merge readiness.

Repository context and source evidence:

- [Merged feature and review discussion, PR #92](https://github.com/the-Drunken-coder/Ridgeline/pull/92).
- [Parser allocation reproduction and correction](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4181213595).
- [Pinned implementation and correction closeout](https://github.com/the-Drunken-coder/Ridgeline/blob/eb878b9617151f92d1136df24b07bb947ecc239e/.scratch/entity-models/closeout.md).
- [Pinned evidence inventory and archive policy](https://github.com/the-Drunken-coder/Ridgeline/blob/eb878b9617151f92d1136df24b07bb947ecc239e/.scratch/entity-models/evidence/README.md).
- [Pinned validation commands](https://github.com/the-Drunken-coder/Ridgeline/blob/eb878b9617151f92d1136df24b07bb947ecc239e/package.json) and [CI workflow](https://github.com/the-Drunken-coder/Ridgeline/blob/eb878b9617151f92d1136df24b07bb947ecc239e/.github/workflows/validation.yml).
- [Repository conventions](../../CODE_CONVENTIONS.md), [domain vocabulary](../../GLOSSARY.md), [consumer-owned workflow decision](../../docs/adr/0001-consumer-owned-workflows.md), and [MapLibre integration decision](../../docs/adr/0002-maplibre-extension-access.md).
- [Tracker and closeout requirements](../../docs/agents/issue-tracker.md), [CI and local runner guidance](../../docs/ci-validation.md), and [portable measurement consumer](../../tools/model-measurement/README.md).
- [Pending hardware evidence, #80](https://github.com/the-Drunken-coder/Ridgeline/issues/80) and [pending limits and production acceptance, #91](https://github.com/the-Drunken-coder/Ridgeline/issues/91).

This spec records the six improvements discussed in the retrospective. It authorizes later implementation through the tracker; this publication creates requirements and makes no claim that the environment changes already exist.
