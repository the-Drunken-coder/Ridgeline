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

Focused repair verification found three further cases:

- Mixed terrain-camera and non-camera attachments still needed shared preparation for the non-camera area's samples.
- Equivalent configuration invalidation changed lifecycle tokens without marking the GPU request dirty, so rejected pending work was never replaced.
- A single maximum-range terrain patch blocked every camera on an entity when only the far camera lacked required samples. Terrain readiness must permit the near camera to publish independently.

Spec review found no scope creep. Six confirmed behavior defects across initial and focused repair review, including the packaged integration failure identified before the independent review.

## Validation before repairs

- Baseline: type checks, 42 library unit tests, 15 control-lab tests, and 36 packaged browser checks passed.
- Integrated implementation: type checks, existing unit tests, and package build passed.
- New controlled lifecycle tests: 5 of 6 passed, with retry exposing the defect above.
- Packaged integration: failed at intermediate camera publication after passing the preceding checks.

## Disposition

All six behavior findings and both standards findings were repaired. The standards reviewer confirmed both original findings were addressed. The final repair also prunes obsolete range-specific terrain caches and detaches their preparation callbacks.

Repair commits after rebase: `9bb16e6`, `1f84fe1`, `9dc0f5c`, `e0a7b6c`. Code validated at `e0a7b6c46496fb277e0b439b5947780e8321e0d0`:

- `pnpm check`: passed.
- `pnpm test`: 51 library tests and 15 control-lab tests passed.
- `pnpm build:playground`: production package, declarations, and playground builds passed.
- `pnpm test:browser`: 39 checks passed against the packed package in Chromium with SwiftShader.
- `git diff --check`: passed.

No checks were unavailable. Existing bundle-size warnings remain. The checks establish the supported test environment, not new GPU/browser support or performance claims.
