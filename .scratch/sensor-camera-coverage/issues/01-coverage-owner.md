# Own sensor-camera coverage lifecycle
Status: ready-for-human
Blocked by: none
Acceptance depends on: tickets 02 and 03 for integrated lifecycle and packaged verification
Integration owner: coordinating agent, through the shared [review record](../review.md)
Spec: [Sensor-camera coverage](../spec.md)

Implement the internal owner described in ../spec.md. Move both plain and terrain camera output, terrain preparation/cache requirements, completion, readiness, failure and recovery out of EntityScene. Keep GpuCameras private and preserve its rendering protections. Own src/ changes and focused existing pure-test adjustments. Validate type checks and unit tests. No public API changes.

## Acceptance criteria

- One internal owner coordinates plain and terrain camera preparation, completion, matching geometry, readiness, failure, and recovery. EntityScene retains entity placement and unrelated attachments; review the integrated diff for duplicate camera completion decisions and public API changes.
- Tickets 02 and 03 verify continuity, independent publication, failure cleanup, and recovery on the combined implementation. Run type checks, module tests, playground build, and packaged browser checks.

## Completion

Implemented and validated on the PR branch. See [review and validation](../review.md) for findings, repairs, and final checks.

Historical evidence is recorded at `e0a7b6c46496fb277e0b439b5947780e8321e0d0`. This structural ticket update preserves the recorded status and does not establish verification of the current checkout or current hosted checks.
