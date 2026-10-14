# Testing standards

Read for observable behavior, parsers, tests, report consumers, or verification tooling. Current commands remain authoritative in the relevant `package.json`; [README.md](../../README.md) and [CI validation](../ci-validation.md) explain package and browser workflows.

## Verify the consumer boundary

- Favor real consumer workflows through public interfaces. For package, export, rendering, or lifecycle changes, use the packaged-consumer browser suite so development aliases cannot hide integration failures.
- Test mouse and keyboard behavior with real browser input when gestures, focus, or event propagation are part of the change. Calling a handler or firing a synthetic map event alone does not verify that interaction.
- Use focused module tests for geometry, validation, and state transitions. Assert observable results and invariants, including relevant failure paths, rather than private call sequences.
- Use test doubles only where they preserve the failure mode being tested. Avoid source-text assertions and tests that merely restate the implementation.

## Reach the claimed condition

- Make required test preconditions explicit and unconditional. A passing branch that never reached the trigger is incomplete evidence.
- Deliver controlled late results after the lifecycle transition being tested and before asserting their effects. Keep the observation target available for the required interval. Destruction or replacement of the old owner may be the transition under test.
- Assert every output needed to establish the changed contract, including independently rendered parts. Interaction filtering alone does not prove that stale geometry disappeared.
- A demonstrated regression should fail before its fix when practical. Use the existing interface to expose the failure, rather than asserting private implementation choices.

For example, a late-terrain test must settle its held preparation before asserting the post-completion result. An arrow-cancellation test must observe both draft shaft and head removal. Required source features or controls must be present before their assertions; optional lookup branches cannot silently bypass required behavior.

## Recovery and observation intervals

- A readiness check may finish when its required result appears. A guarantee that stale output or unwanted work stays absent must observe the complete bounded interval after the relevant trigger. Choose the trigger and interval from the failure mechanism being tested.
- For suspected render or update loops, trace what schedules the next update and what stops it. Verify recovery through the real delayed-data path, then observe a bounded quiet period after the renderer settles. Changes to event triggers must preserve recovery with stationary input.

## Tool reports and deterministic checks

- When reviewing code that consumes external tool reports, verify required fields with output produced by the installed tool through its configured reporter. Retain an integration test through the report consumer; synthetic fixtures cover malformed inputs but cannot establish the producer's format.
- Mechanical requirements belong in executable checks. Prefer repairing or extending the existing validator over adding a prose rule that avoids its failure mode. Test validator acceptance and rejection through its interface with actual filesystem, process, or Git behavior where those boundaries matter.

## Parser allocation bounds

- For parser changes, trace external counts and their multiplication into actual allocations, including implicit zero-filled values, derived arrays, and repeated decoding. Identify the enforced bound before each allocation and account for cumulative expansion when data is reused. A bound on stored bytes or one array does not establish a bound on total decoded output. Record the count-to-bound reasoning, pinned source revision, attempted failure histories, and outcomes, distinguishing executed reproductions from inspection and untested hypotheses.
- Exercise parser rejection through existing interfaces with moderate malformed fixtures or safely intercepted resource requests; never create a genuine billion-element allocation. Retain the [GLB allocation and supported-asset regressions](../../tests/model-glb.test.ts), and add a behavioral regression only for a newly demonstrated gap. Use the public model-registration path when proving diagnostics or recovery. Preserve the [supported model contract](../../README.md#shared-models) and merged allocation bound; the measured triangle guideline remains pending.

## Choose and report verification

- Run type checking and the checks covering changed behavior. Validate affected consumers as well: the playground for playground integration and the control lab for its own changes. Broaden testing when the change crosses shared boundaries.
- Documentation-only changes need link, configuration where affected, and diff checks rather than the runtime suite.
- Distinguish completed checks from manual observations and unverified behavior. Keep historical measurements dated rather than presenting them as current guarantees.

Record the reviewed and exercised revisions when reporting verification. The common implementation standards remain in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md).
