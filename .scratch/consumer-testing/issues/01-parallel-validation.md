# parallel-validation

Status: resolved
Blocked by: none
Acceptance depends on: integrated deliveries from tickets 02 and 03
Integration owner: PR #35 coordinating agent, through this ticket
Spec: [Consumer testing and parallel CI](../spec.md)

Implement independent ordinary CI jobs, strict validate gate, four useful packaged shards, combined reports and executable gate/shard verification. Own validation workflow, packaged config, scripts for gate/report/shard checks and their tests.

## Acceptance criteria

- Every PR, main push, and manual run executes the complete ordinary suite. Independent jobs and shards finish after a sibling failure; superseded PR runs are cancelled.
- Four useful packaged shards preserve installation of the packed package and execute every discovered case exactly once. Missing, duplicated, skipped, or retried work is rejected.
- `validate` succeeds only when every required job succeeds. Verify failure, skip, and cancellation cases through executable checks and hosted exercises.
- Failure screenshots, traces, and combined reports remain accessible. A failing automation fixture retains its reports and subprocess diagnostics.
- Verify the effective `validate` branch requirement, preserving unrelated protections and recording any administrative limits.
- After tickets 02 and 03 deliver their changes, review the combined diff, run the affected checks, and inspect required hosted checks for the recorded PR revision. Record unresolved findings and limits before accepting the integrated result.

## Evidence and remaining work

Implementation is present. Local gate and shard tests pass, including omission, duplication, interruption, and retry cases. A controlled subprocess failure retained fixture diagnostics. Earlier hosted exercises cover sibling failures, skips, cancellation, browser artifacts, and branch enforcement; see the dated [verification record](../../../docs/ci-validation.md#verification-record-2026-09-29).

Acceptance completed at `96472fd`. Hosted ordinary validation passed every required job and the strict aggregate gate. A newer PR push cancelled the preceding run, verifying supersession. The coordinating agent integrated tickets 02 and 03 and recorded exact reviewed and tested revisions in the [shared closeout record](../../../docs/ci-validation.md#current-closeout-record). Final documentation changes remain subject to the PR gate.
