# Entity model design closeout

Spec: [Entity models and representation switching](spec.md).

Status: Design decisions approved for implementation. Production implementation and hardware verification are pending. The user asked to settle all remaining questions in this chat and accepted all seven recommendations together.

Resolution records:

- [Consumer model and color API](https://github.com/the-Drunken-coder/Ridgeline/issues/77#issuecomment-5983846918).
- [Picking, labels and attachment placement](https://github.com/the-Drunken-coder/Ridgeline/issues/78#issuecomment-5983847186).
- [Browser and verification targets](https://github.com/the-Drunken-coder/Ridgeline/issues/79#issuecomment-5983847512).

Integration owner: root Codex agent. All edits had one owner. A read-only reviewer checked the contract against the existing public API, ADRs, drawing/loading decision and approved appearance. Root corrected ambiguous readiness, inspection, hysteresis recovery, missing-terrain eligibility, label collision and stress-sweep acceptance rules.

Reviewed: documentation changes based on `bd44f3214e0e4746340ca45e3bb06897ef5dcccf`, uncommitted during review and link/whitespace checks. No runtime implementation changed. Exact API spelling and numeric pass criteria are engineering specifications translating the approved behavior, not measured results.

Local verification: relative links and whitespace checked; published issue bodies, resolution comments, states and native dependencies read back. Runtime tests were not run for documentation-only changes. The earlier [prototype closeout](prototype/closeout.md) remains historical evidence for its separately recorded runtime revisions.

Hosted verification: none. No PR or merge. `prototype/entity-models` remains a throwaway evidence branch. Production starts from main and carries only the approved spec/glossary plus deliberately selected implementation work.

Remaining limits: [target-browser hardware measurements](https://github.com/the-Drunken-coder/Ridgeline/issues/80), browser support verification, the measured triangle/material guideline, and all production implementation/acceptance work. Implementation and spec publication may proceed before hardware access; production readiness cannot.

Model: gpt-6.1-sol. Harness: Codex in T3 Code.
