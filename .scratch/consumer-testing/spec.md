# Consumer testing and parallel CI

Status: ready-for-agent

## Problem Statement

Maintainers need confidence that Ridgeline works for real consumers before changes merge. Tests should establish complete workflows through the installed package, including rendering, interaction, recovery, and cleanup. Focused module tests should cover detailed invariants and failure paths that support those workflows.

The existing testing foundation is strong, but CI executes every check sequentially in one job. An early failure prevents later checks from reporting results. Both browser suites use one worker, and the packaged browser cases are registered in a single spec file. CI runs only for pull requests. There is no scheduled stress testing or automatic tracking of nightly failures.

The maintainer prioritizes thoroughness over short runs. Five or ten minutes is acceptable. Runs approaching fifteen minutes should prompt investigation and further parallelization, without cutting useful coverage to meet an arbitrary time target.

## Solution

Make consumer end-to-end testing the central source of integration confidence. Audit critical journeys, retain useful module coverage, and run the complete ordinary validation suite on every pull request and push to the default branch. Execute independent checks concurrently and distribute packaged browser cases across runners.

Expose one required validation result that succeeds only when all required checks succeed. Preserve useful diagnostics and provide readable combined browser results. Run additional lifecycle and recovery stress scenarios nightly, with failures automatically tracked in GitHub issues.

## User Stories

1. As a consumer developer, I want tests to install the packed library into a separate application, so that broken package exports, declarations, styles, or bundling fail before release.
2. As a consumer developer, I want complete viewport workflows tested through public interfaces, so that passing internal tests also have evidence of working integration.
3. As a viewport user, I want mouse and keyboard interactions tested with real browser input, so that focus, gestures, and event propagation work together.
4. As a consumer developer, I want feature updates and selection tested together, so that live changes preserve the intended display and interaction state.
5. As a consumer developer, I want drawing creation, editing, acceptance, cancellation, and reload covered, so that consumer-owned data remains coherent across editing sessions.
6. As a consumer developer, I want terrain and camera failure recovery exercised, so that missing data and asynchronous results cannot silently corrupt displayed output.
7. As a consumer developer, I want destruction and remount behavior exercised, so that obsolete work cannot affect replacement viewports.
8. As a maintainer, I want a focused audit of critical consumer journeys, so that concrete gaps receive tests instead of accumulating speculative test cases.
9. As a maintainer, I want focused geometry, validation, and state tests retained, so that detailed edge cases remain inexpensive to diagnose.
10. As a contributor, I want every pull request to run the full ordinary suite, so that change classification cannot accidentally omit a relevant check.
11. As a maintainer, I want the same validation on the default branch, so that failures in merged changes remain visible.
12. As a contributor, I want independent checks to run concurrently, so that one failure does not prevent feedback from unrelated checks.
13. As a contributor, I want browser cases distributed across runners, so that thorough coverage does not require unnecessary sequential waiting.
14. As a contributor, I want superseded pull-request runs cancelled, so that runners remain available for current revisions.
15. As a maintainer, I want one stable required merge check, so that changes cannot merge with failed or incomplete validation.
16. As a maintainer, I want retry-only passes treated as unresolved failures, so that intermittent defects remain visible.
17. As a contributor, I want traces, screenshots, and combined reports, so that I can investigate failures without reproducing the entire environment locally.
18. As a control-lab maintainer, I want browser tests to exercise its production build, so that development-server behavior cannot hide build integration defects.
19. As a maintainer, I want nightly repetitions of lifecycle and recovery scenarios, so that timing-sensitive failures have more opportunities to appear.
20. As a maintainer, I want nightly failures to create or update a GitHub issue, so that failures become actionable work without duplicate reports.
21. As a maintainer, I want failure issues to remain open until the cause is resolved, so that a later passing run does not erase an intermittent defect.
22. As a maintainer, I want manual workflow execution, so that I can verify changes and reproduce CI behavior when needed.
23. As a maintainer, I want branch rules to enforce the validation gate where supported, so that documented expectations also govern merging.
24. As a maintainer, I want thoroughness preserved as the suite grows, so that runtime pressure leads to better parallelism rather than weaker checks.

## Implementation Decisions

- Preserve the current library, consumer, and module boundaries. This work changes validation and its automation, with no new public library API or renderer abstraction.
- Use independent jobs for type checking, module tests, packaged consumer browser tests, control-lab browser tests, and consumer production builds. Avoid unnecessary dependencies between these jobs.
- Start packaged browser execution with four shards on standard GitHub-hosted Linux runners. Verify case isolation and enable test-level sharding or split case registration so all shards receive useful work. A matrix alone cannot effectively divide the current single-file registration.
- Prefer distribution across runners before increasing software-WebGL contention within each runner. Adjust shard and worker counts from observed setup costs and case timings.
- Preserve the packed-package consumer boundary on every browser shard. Build reuse is acceptable only if it preserves the exact revision, package installation, declaration checking, and production-consumer behavior being validated.
- Run the complete ordinary suite for every pull request and default-branch push, without path-based exclusions initially. Provide manual execution. Cancel superseded runs for the same pull request without cancelling unrelated pull requests.
- Let independent jobs and shards finish when another fails, unless the entire run is superseded or explicitly cancelled.
- Keep a stable aggregate check named `validate`. It must evaluate all required job outcomes and succeed only when every required job succeeds. Failed, cancelled, missing, or unexpectedly skipped required work must never produce a successful gate.
- Keep required checks strict. The existing zero-retry behavior is a valid default. If diagnostic retries are introduced, an initial unexplained failure must still fail required validation. Temporary exceptions require explicit tracking rather than silent acceptance.
- Preserve screenshots and traces for browser failures. Use unique artifact identities per suite and shard, and combine browser reports into a readable result. Reporting must preserve available failure evidence when another shard fails.
- Exercise the control lab through its production build and preview server. Preserve real mouse, keyboard, and wheel workflows.
- Audit critical consumer journeys against existing coverage and record the findings. Add tests for concrete gaps; do not add duplicate tests merely to increase end-to-end test counts.
- Add a scheduled nightly workflow that repeatedly exercises representative drawing, terrain recovery, and destruction/remount scenarios. Repetitions supplement the complete required PR suite. Choose and document bounded repeat counts, shard counts, and timeouts during implementation.
- Authorize the nightly workflow to create and update GitHub failure-tracking issues. Include failing scenario identities, revision, run links, and artifact links. Use stable failure identities to update an existing open issue for the same failure, including across repeated or concurrent reporting attempts.
- Leave nightly failure issues open when later runs pass. Resolution requires addressing the cause. Make reporting failures visible in the workflow result rather than silently losing follow-up work.
- Scope issue-writing permission to the trusted nightly reporting operation. Ordinary PR validation must work without issue-writing credentials, including contributions from forks.
- Configure branch rules to require `validate` where repository permissions and the GitHub plan support enforcement. Inspect existing rules and preserve unrelated protections. If enforcement is unavailable, report that specific limitation without weakening the workflow gate or claiming enforcement succeeded.
- Design for public-repository standard runners, but leave repository visibility unchanged. Private-repository minute usage remains relevant until visibility changes separately.
- Update testing documentation to describe the resulting local commands, required CI jobs, reports, nightly behavior, and verified environment limits.

## Testing Decisions

- Prefer the highest existing seam: a separate consumer using the installed package. Use the existing packaged browser harness as prior art for export, declaration, rendering, interaction, recovery, and lifecycle checks. No new public testing interface is required.
- Retain focused module tests for geometry, validation, publication, elevation, drawing state, and asynchronous ownership. Assert observable outcomes and invariants rather than private call sequences.
- Use real browser input whenever gestures, focus, or event propagation are under test. Keep controlled failure injection at existing dependency interfaces where it preserves the actual failure mode.
- Use the existing control-lab browser journeys against the production build as the second consumer boundary.
- Validate sharding by comparing discovered cases with the combined executed results. Every ordinary browser case must run, with no accidental omission or duplication across the ordinary shards. Intentional nightly repetition is separate.
- Verify the actual CI workflow and aggregate gate. Exercise successful validation and controlled failure conditions, including a failed shard and an unexpectedly skipped prerequisite. Cancelled or superseded runs must not yield a successful merge gate.
- Verify that independent checks still report after a sibling failure and that available failure artifacts and combined results remain accessible.
- Verify nightly failure reporting with controlled failures: first occurrence creates an issue, recurrence updates the same open issue, distinct failures remain distinguishable, and a later pass does not close the issue. Use executable reporting behavior and a clearly identified integration exercise; do not test workflow source text as a substitute.
- Verify the effective branch requirement where configuration is supported. Distinguish implemented configuration, observed GitHub behavior, and any administrative limitation.
- Run relevant type checks, module tests, both browser suites, and consumer builds after implementation. Report hosted CI evidence separately from local results.
- Do not pursue a numerical majority of end-to-end tests, arbitrary coverage percentages, or a five-minute runtime target. Around fifteen minutes is a signal to investigate bottlenecks and parallelism, not a reason to omit checks.

## Out of Scope

- Changing repository visibility, opening a pull request, or merging changes.
- Implementing Firefox and WebKit coverage in this change. Desktop Chromium, Firefox, and Safari-related compatibility are the intended direction; establishing Firefox and WebKit coverage is a separate follow-up.
- Claiming that desktop Chromium with software WebGL establishes physical-GPU, touch, complete accessibility, or long-session production memory guarantees.
- Replacing useful module tests wholesale with browser tests, or adding source-text assertions and implementation-mirroring tests.
- Rewriting the library architecture, adding public API solely for tests, or introducing unrelated application workflows into the library.
- Paid larger runners, repository visibility changes, and unrelated branch-rule changes.

## Further Notes

The review on 2026-09-29 found 87 registered packaged browser cases, four control-lab browser cases, and fourteen library module-test files. The five most recent completed validation runs observed during that review passed and took roughly three and a half to five and a half minutes. These are dated observations, not performance guarantees or coverage targets.

GitHub reported the repository as private during the review, despite the initial public-repository assumption. Standard GitHub-hosted runner usage is free for public repositories. Verify current visibility and plan capabilities during implementation without changing visibility.

The project issue tracker is local Markdown. This document publishes the implementation spec there with the agreed ready-for-agent status. Future nightly failure issues are an explicitly authorized GitHub automation channel and do not move the project's general spec and ticket workflow to GitHub.

The testing boundaries and operational choices above synthesize the completed interview. No further testing-boundary interview is needed before implementing this spec.

