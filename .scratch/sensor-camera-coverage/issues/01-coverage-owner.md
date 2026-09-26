# Own sensor-camera coverage lifecycle
Status: ready-for-human
Blocked by: none

Implement the internal owner described in ../spec.md. Move both plain and terrain camera output, terrain preparation/cache requirements, completion, readiness, failure and recovery out of EntityScene. Keep GpuCameras private and preserve its rendering protections. Own src/ changes and focused existing pure-test adjustments. Validate type checks and unit tests. No public API changes.

## Completion

Implemented and validated on the PR branch. See [review and validation](../review.md) for findings, repairs, and final checks.
