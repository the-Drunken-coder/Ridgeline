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

## Enforcement and environment

On 2026-09-29, GitHub reported this repository as private, with no existing rulesets or branch protection. The implementation configured and read back protection for `main` requiring `validate`, with strict status checks. Administrator bypass remains enabled. Repository visibility was not changed. Private-repository hosted runner usage still applies.

Desktop Chromium with software WebGL is the verified browser target. These checks do not establish Firefox or WebKit support, physical-GPU behavior, touch interaction, complete accessibility, or long-session production memory guarantees. Dependency and browser installation need network access on a fresh machine.
