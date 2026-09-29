# CI and nightly validation

Every pull request and push to `main` runs the complete ordinary suite. Manual execution is also available. There are no path filters. Independent jobs run type checking, module tests, packaged browser cases, control-lab browser cases, and consumer production builds. A failed job does not cancel its siblings. A newer run for the same pull request cancels the superseded run.

The `validate` job requires successful results from all required jobs. Failure, cancellation, missing results, and unexpected skips fail the gate. Browser retries remain disabled. CI uses four packaged-browser shards with one worker each to avoid competing software-WebGL workloads on a runner. Each shard builds and packs the exact checkout, installs it into a separate consumer, checks declarations, and builds that consumer before testing.

## Local checks

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm validate
pnpm test:browser -- --shard=1/4
```

`pnpm validate` runs local checks sequentially. CI distributes the same checks across jobs. `pnpm test` includes executable validation-automation tests as well as the library and control-lab module tests. Both browser suites use production consumer builds. The packaged suite retains a fresh page per case even when cases are distributed across shards.

The shard-report fixture reads machine-readable reports from explicit JSON files. If it fails, it retains its inputs, reports, and subprocess diagnostics under `.artifacts/validation/`; CI uploads them as `validation-fixture-failures`. Successful fixtures are removed.

Keep useful coverage when runtime grows. Runs approaching fifteen minutes should prompt investigation of setup costs and case timings, followed by additional parallelism where warranted.

## Browser reports

Each packaged shard uploads `blob-packaged-N` and `results-packaged-N`. The control lab uploads `blob-control`. Failure screenshots and traces use separate `failures-packaged-N` and `failures-control` artifacts. The `browser-reports` job combines available blobs into the downloadable `browser-report` HTML artifact even if a shard fails. It also compares Playwright discovery against all four execution reports, rejecting omitted, duplicated, skipped, or retried cases. The report job is required by `validate`.

## Nightly stress and failure tracking

The nightly workflow runs at 03:17 UTC and accepts manual runs on the default branch. It repeats four scenarios ten times each across two runners, with one browser worker per runner and zero retries. The scenarios cover pointer drawing, raster terrain recovery, destruction/remount, and terrain preparation completing after replacement. Scenario names and bounds live in [the nightly reporter](../scripts/ci/nightly-report.mjs). Browser jobs have a 25-minute limit; reporting has a 10-minute limit. Run either shard locally with `node scripts/ci/run-nightly.mjs 1` or `node scripts/ci/run-nightly.mjs 2`.

The `nightly-1` and `nightly-2` artifacts retain JSON, HTML reports, traces, and failure screenshots for fourteen days. Only the trusted default-branch reporting job receives issue-writing permission. It creates an issue per failing scenario/project identity, adds a comment when that failure recurs in another run, and avoids duplicate comments when the same run is reported again. A later pass leaves the issue open. Missing or incomplete reports produce an infrastructure issue and fail reporting; API failures also fail the job.

Completeness requires repetition indices 0 through 9 exactly once for each scenario in every reported project. Duplicate identities across shards, invalid indices, and missing repetitions fail reporting even when the total record count is ten.

Reporting is serialized across nightly runs. `queue: max` preserves up to 100 pending reporters; GitHub cancels arrivals beyond that limit. See [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Ordinary PR validation has no issue-writing permission.

The [consumer journey audit](consumer-testing-audit.md) maps existing coverage and the added lifecycle regression. Module tests remain responsible for detailed geometry, validation, publication, and asynchronous ownership invariants.

## Enforcement and environment

On 2026-09-29, GitHub reported this repository as private, with no existing rulesets or branch protection. The implementation configured and read back protection for `main` requiring `validate`, with strict status checks. Administrator bypass remains enabled. Repository visibility was not changed. Private-repository hosted runner usage still applies.

Desktop Chromium with software WebGL is the verified browser target. These checks do not establish Firefox or WebKit support, physical-GPU behavior, touch interaction, complete accessibility, or long-session production memory guarantees. Dependency and browser installation need network access on a fresh machine.

## Current closeout record

Recorded 2026-09-29. Implementation is present, with local follow-up checks complete; integrated acceptance and merge readiness remain pending.

- Spec: [canonical consumer-testing spec](../.scratch/consumer-testing/spec.md), sourced from GitHub #32.
- Integration owner: PR #35 coordinating agent, through [ticket 01](../.scratch/consumer-testing/issues/01-parallel-validation.md), after deliveries from tickets 02 and 03.
- Reviewed: `5ea50b7b5140d9c6271baeb03dd65b45efad946b...4fc9bfd927d5ac3cd6a4fb94c923c030a0ba86d1`. Standards/Spec review identified the inaccurate coverage claim and failing hosted report fixture. Later review identified count-only nightly completeness. Final integrated review of the follow-up changes is pending.
- Local verification: `5055653c3617ceedc66cf5bfff8a7f4a47251c8f` plus uncommitted changes to the nightly reporter, its tests, validation fixture, and artifact-upload workflow. `pnpm test` passed 175 Node tests and five control-lab tests; `pnpm check` passed. A controlled subprocess failure verified local fixture and diagnostic retention. These results do not establish hosted artifact upload or nightly browser execution for the revised code.
- Hosted verification: [PR run 36518622803](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36518622803) reported head `4fc9bfd927d5ac3cd6a4fb94c923c030a0ba86d1`; the tested merge checkout SHA was not established in this closeout. `module-tests` failed parsing the merged report, and `validate` correctly failed. Type checking, browser jobs, combined reports, and consumer builds passed. No hosted run covers the local follow-up changes.
- Remaining limits: commit and review the integrated changes, verify current required hosted checks and the revised nightly path, exercise PR supersession, and update this record with the resulting revisions. Partial-write recovery now passes local HTTP tests for both issue creation and recurrence comments. Earlier successful runs below remain historical evidence.

## Verification record, 2026-09-29

Local checks passed type checking, 168 Node tests, five control-lab state tests, all 88 packaged browser cases, four production control-lab browser cases, and both consumer builds. Both nightly shards passed, totaling 40 executions. The reporter accepted those actual JSON results without making an issue API request. The playground build retains its existing large-chunk warning.

The controlled GitHub reporting exercise used synthetic failures in [#33](https://github.com/the-Drunken-coder/Ridgeline/issues/33) and [#34](https://github.com/the-Drunken-coder/Ridgeline/issues/34). It verified creation, idempotent same-run reporting, recurrence comments, distinct scenario identities, and leaving issues open after a pass. Those synthetic issues were then explicitly closed as test cleanup. Local HTTP integration tests additionally cover incomplete reports and API failure.

Standards and Spec reviews found no actionable issues in the implementation. Hosted verification then caught report-upload and Node setup defects that local tests did not cover; those required fixes before accepting CI results.

Hosted verification used temporary branches with only the trigger/branch guard changed. Controlled failure commits additionally threw in one packaged case and skipped type checking. These exercise commits are excluded from the implementation branch. The [nightly run](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36513476923) passed both shards and reporting, retaining both report artifacts. The [cancelled run](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36513502891) ended cancelled, and `validate` explicitly rejected cancelled prerequisites. PR supersession is configured but was not separately exercised because this work opened no PR.

The corrected [ordinary validation run](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36513475239) passed every job and the `validate` gate. Its execution audit verified all 88 packaged cases exactly once across four shards, and the combined HTML report was uploaded. In the [controlled failure run](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36513474655), one packaged shard failed and type checking was deliberately skipped. All other independent checks completed successfully; report merging succeeded; `validate` rejected both the failed and skipped results. Downloaded failure artifacts contained the screenshot and trace, and the combined report remained available.

Temporary verification branches and implementer worktrees were removed after these checks. No PR was opened and no implementation was merged into `main`. Scheduled execution starts after the workflow reaches the default branch.
