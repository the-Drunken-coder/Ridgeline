# Verify packaged camera rendering behavior
Status: ready-for-human
Blocked by: none for test authoring; 01 for execution
Acceptance depends on: ticket 01's integrated implementation and verification
Integration owner: coordinating agent, through the shared [review record](../review.md)
Spec: [Sensor-camera coverage](../spec.md)

Extend tests/browser.ts at the supported packaged viewport boundary for previous-result continuity, matching geometry, independent publication and failure after displayed output with unrelated ground coverage and current-input retry. Preserve existing real WebGL coverage. Own tests/browser.ts only; coordinate required production fixes with ticket 01.

## Acceptance criteria

- Packaged browser checks prove previous-result continuity, matching displayed geometry, independent sensor publication, and failure after an existing displayed result. Preserve unrelated ground coverage and verify explicit retry uses current inputs.
- Verify through the supported viewport boundary and observable rendering, state, or picking. Retain existing real WebGL coverage and run the packaged browser suite against ticket 01's integrated implementation.

## Completion

Implemented and validated on the PR branch. See [review and validation](../review.md) for findings, repairs, and final checks.

Historical evidence is recorded at `e0a7b6c46496fb277e0b439b5947780e8321e0d0`. This structural ticket update preserves the recorded status and does not establish verification of the current checkout or current hosted checks.
