# consumer-journeys

Status: resolved
Blocked by: none
Acceptance depends on: ticket 01's integrated verification, including ticket 02 consuming the new scenario
Integration owner: PR #35 coordinating agent, through ticket 01
Spec: [Consumer testing and parallel CI](../spec.md)

Audit critical consumer workflows, add concrete missing coverage, run control-lab browser workflows against production build. Own browser test files, control-lab config and consumer audit documentation. Keep existing coverage.

## Acceptance criteria

- Record the critical-journey audit, mapping package installation, updates/selection, real input, drawing, recovery, and cleanup to existing coverage or a concrete gap. Retain useful module tests.
- The packaged late-terrain case proves destruction cancels preparation, delayed completion cannot change replacement data or recreate old DOM, and the replacement accepts real selection input without late diagnostics.
- Deliver the scenario named `Late terrain preparation cannot affect a replacement viewport` for ticket 02's nightly selection, and verify it executes there.
- The four control-lab browser journeys use a production build and preview server, with real mouse, keyboard, and wheel input and no reuse of an unknown server.
- Verify both browser suites and consumer builds on the integrated revision. Document Chromium/software-WebGL limits separately from unverified platforms and workloads.

## Evidence and remaining work

The [consumer audit](../../../docs/consumer-testing-audit.md) maps the journeys and added lifecycle case. Browser shards, control-lab browser tests, and consumer builds passed in the hosted PR run at `4fc9bfd`; module tests and the aggregate gate failed. Earlier nightly evidence is dated in the [verification record](../../../docs/ci-validation.md#verification-record-2026-09-29).

Acceptance completed at `96472fd`. Both hosted browser suites and consumer builds passed; the revised nightly reporter accepted all 40 executions, including the delivered late-terrain scenario. The coordinating agent recorded reviewed and tested revisions in the [shared closeout record](../../../docs/ci-validation.md#current-closeout-record).
