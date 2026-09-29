# parallel-validation

Status: ready-for-agent
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

Acceptance remains pending. The hosted PR run at `4fc9bfd` failed in the report fixture and correctly failed `validate`. File-backed reports and diagnostic retention have local evidence but no hosted run of the revised implementation. PR supersession was configured but not separately exercised. The coordinating agent must complete integrated review and hosted verification after all deliveries are committed. See the [shared closeout record](../../../docs/ci-validation.md#current-closeout-record).
