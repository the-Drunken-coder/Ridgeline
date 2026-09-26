# Sensor-camera coverage review

Reviewed integration: `6048c83f559c0cae451cede8ccc7af05e996fc1f`
Base: `cc1b4070643aef8e088d14e891daf5e06cbfc8a6`
Spec: [spec.md](spec.md), GitHub issue #11.

## Standards

- Documented testing violation: newly added packaged browser assertions inspected private camera maps, pending/submitted results, and geometry draw arrays. Replace the new assertions with observable renderer output, state, and picking. Keep detailed controlled geometry assertions at the one private owner boundary.
- Judgment call: camera-specific volume geometry still lived in entity computation, while the new owner added camera geometry and color conversion. Move camera geometry under camera ownership and share the color conversion without broader cleanup.

Standards review found no other hard user-guideline or ADR breach. Two findings, one documented testing violation and one module-ownership judgment call.

## Spec

- Confirmed packaged failure: ordinary entity upserts invalidated camera lifecycles, suppressing intermediate results during continuous movement. Ordinary movement must retain completion eligibility while readiness still follows the current request.
- Confirmed private lifecycle failure: retry advanced the lifecycle token but resubmitted the old-token request. Retried work must use the current input and an active token.
- Confirmed custom-sampler regression: entities with only plain cameras skipped all elevation preparation. A sampler returning null until prepare ran left the entity unavailable indefinitely. Preserve placement preparation independently of camera patch preparation.

Spec review found no scope creep. Three confirmed behavior defects, including the packaged integration failure identified before the independent review.

## Validation before repairs

- Baseline: type checks, 42 library unit tests, 15 control-lab tests, and 36 packaged browser checks passed.
- Integrated implementation: type checks, existing unit tests, and package build passed.
- New controlled lifecycle tests: 5 of 6 passed, with retry exposing the defect above.
- Packaged integration: failed at intermediate camera publication after passing the preceding checks.

## Disposition

All findings are assigned to one repair implementer. Final validation and commit evidence will be recorded after repairs.
