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

Keep useful coverage when runtime grows. Runs approaching fifteen minutes should prompt investigation of setup costs and case timings, followed by additional parallelism where warranted.

## Browser reports

Each packaged shard uploads `blob-packaged-N` and `results-packaged-N`. The control lab uploads `blob-control`. Failure screenshots and traces use separate `failures-packaged-N` and `failures-control` artifacts. The `browser-reports` job combines available blobs into the downloadable `browser-report` HTML artifact even if a shard fails. It also compares Playwright discovery against all four execution reports, rejecting omitted, duplicated, skipped, or retried cases. The report job is required by `validate`.

## Nightly stress and failure tracking

The nightly workflow runs at 03:17 UTC and accepts manual runs on the default branch. It repeats four scenarios ten times each across two runners, with one browser worker per runner and zero retries. The scenarios cover pointer drawing, raster terrain recovery, destruction/remount, and terrain preparation completing after replacement. Scenario names and bounds live in [the nightly reporter](../scripts/ci/nightly-report.mjs). Browser jobs have a 25-minute limit; reporting has a 10-minute limit. Run either shard locally with `node scripts/ci/run-nightly.mjs 1` or `node scripts/ci/run-nightly.mjs 2`.

The `nightly-1` and `nightly-2` artifacts retain JSON, HTML reports, traces, and failure screenshots for fourteen days. Only the trusted default-branch reporting job receives issue-writing permission. It creates an issue per failing scenario/project identity, adds a comment when that failure recurs in another run, and avoids duplicate comments when the same run is reported again. A later pass leaves the issue open. Missing or incomplete reports produce an infrastructure issue and fail reporting; API failures also fail the job.

Reporting is serialized across nightly runs. `queue: max` preserves up to 100 pending reporters; GitHub cancels arrivals beyond that limit. See [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Ordinary PR validation has no issue-writing permission.

The [consumer journey audit](consumer-testing-audit.md) maps existing coverage and the added lifecycle regression. Module tests remain responsible for detailed geometry, validation, publication, and asynchronous ownership invariants.

## Enforcement and environment

On 2026-09-29, GitHub reported this repository as private, with no existing rulesets or branch protection. The implementation configured and read back protection for `main` requiring `validate`, with strict status checks. Administrator bypass remains enabled. Repository visibility was not changed. Private-repository hosted runner usage still applies.

Desktop Chromium with software WebGL is the verified browser target. These checks do not establish Firefox or WebKit support, physical-GPU behavior, touch interaction, complete accessibility, or long-session production memory guarantees. Dependency and browser installation need network access on a fresh machine.

## Verification record, 2026-09-29

Local checks passed type checking, 168 Node tests, five control-lab state tests, all 88 packaged browser cases, four production control-lab browser cases, and both consumer builds. Both nightly shards passed, totaling 40 executions. The reporter accepted those actual JSON results without making an issue API request. The playground build retains its existing large-chunk warning.

The controlled GitHub reporting exercise used synthetic failures in [#33](https://github.com/the-Drunken-coder/Ridgeline/issues/33) and [#34](https://github.com/the-Drunken-coder/Ridgeline/issues/34). It verified creation, idempotent same-run reporting, recurrence comments, distinct scenario identities, and leaving issues open after a pass. Those synthetic issues were then explicitly closed as test cleanup. Local HTTP integration tests additionally cover incomplete reports, API failure, and recovery after a partial write.

Standards and Spec reviews found no actionable issues in the implementation. Hosted verification then caught report-upload and Node setup defects that local tests did not cover; those required fixes before accepting CI results.
