# nightly-reporting

Status: ready-for-agent
Blocked by: none
Acceptance depends on: ticket 03's late-terrain scenario and ticket 01's integrated verification
Integration owner: PR #35 coordinating agent, through ticket 01
Spec: [Consumer testing and parallel CI](../spec.md)

Implement bounded nightly drawing/recovery/remount repetitions and deduplicated GitHub issue reporting with executable controlled integration tests. Own nightly workflow, reporting scripts and reporting tests. Coordinate report interfaces with ticket 01.

## Acceptance criteria

- Scheduled and manual default-branch runs exercise drawing, terrain recovery, and destruction/remount, including ticket 03's late-terrain scenario. Document bounded repeats, shards, and timeouts.
- Each scenario/project has repetitions 0 through 9 exactly once across reports. Missing or duplicate identities, invalid indices, runner errors, and incomplete reports produce an infrastructure issue and fail reporting. Verify through `reportNightly`.
- A first failure creates an issue containing scenario identity, revision, run, and artifact links. Recurrence updates the same open issue, repeated reporting is idempotent, distinct failures remain distinguishable, and a later pass leaves issues open.
- Concurrent reporting is serialized. Issue API failures fail visibly. Verify that reporting can resume after one issue write succeeds and a later write fails, without duplicating issues or recurrence evidence.
- Only trusted nightly reporting receives issue-writing permission. Ordinary PR validation works without it.
- Run the actual integrated nightly scenarios after ticket 03 delivers its case, and record the tested revision and hosted result through ticket 01.

## Evidence and remaining work

Implementation is present. Local HTTP tests verify recurrence, idempotency, distinct failures, pass retention, incomplete results, runner errors, and rejected writes. New local regressions reject duplicated or invalid repetitions and accept distinct repetitions distributed across shards. Earlier hosted nightly and issue-reporting exercises are historical evidence in the [verification record](../../../docs/ci-validation.md#verification-record-2026-09-29).

Acceptance remains pending. Local HTTP tests now verify recovery after partial issue creation and partial recurrence-comment writes without duplication. The revised reporter has not run with the integrated nightly suite on hosted CI. The coordinating agent owns those checks and the [shared closeout record](../../../docs/ci-validation.md#current-closeout-record).
