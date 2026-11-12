# PR review retrospective

This directory retains the 2026-10-05 retrospective and its original proposals. The integrated standards now live in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md) and its linked topic files. The proposal files below are historical rationale, not additional active standards.

Reviewed Ridgeline's entire visible PR history on 2026-10-05: 37 PRs, 137 inline comments, 107 review submissions, and 89 PR conversation comments. Of the review submissions, 33 have bodies and 74 are empty. That gives 259 nonempty bodies, including replies, repeated summaries, status messages, and deployment notices. The [source inventory](sources.md) records coverage and exclusions.

The strongest opportunity is to require tests to reach the condition they claim to verify. Two summary-only review findings still describe gaps in the current test bodies. Existing guidance already covers general callback ownership, stale completions, real browser input, idle work, and revision-specific verification. The proposals below sharpen those rules where the history shows a missing distinction.

## Proposals, in priority order

| Priority | Proposal | Proposed change |
| --- | --- | --- |
| High | [Regression evidence](regression-evidence.md) | Require preconditions, release delayed work before asserting its effects, and check every output needed to establish the contract. |
| High | [Failure and recovery](failure-and-recovery.md) | Preserve independently owned failure state, invalidate recovered snapshots, and verify progress under shared-cache pressure. |
| High | [Automated checks](automated-checks.md) | Enforce unsafe-finally detection and durable evidence validation through executable checks. |
| High | [Spatial and rendering consistency](spatial-and-rendering.md) | Accept results before shared mutation and keep display, picking, and coordinate conversions consistent. |
| Medium | [Input ownership](input-ownership.md) | Specify interrupted gestures, keyboard focus, and one action per handled input. |
| Medium | [Review feedback and navigation](review-feedback.md) | Read summary-only findings, verify proposed fixes, and record dispositions without adding duplicate policy. |

Each proposal includes wording, supporting comments, existing coverage, and a suggested home. Judgment guidance is integrated into the active topic standards. Mechanical-check proposals remain follow-up recommendations; this documentation change does not implement those checks or repair the historical test gaps.

## Work already covered

At collection, [PR #102](https://github.com/the-Drunken-coder/Ridgeline/pull/102) was open at revision `dfe0e5266f2b8285679b71605605a9147f43425c`. It proposed required measurement validation, browser disk preflight and retention, coordinate/readiness helpers, parser-allocation guidance, and an entity review reference. Its four then-unanswered findings inform the historical automated-check proposals; they were supported by inspection, without an executed reproduction in this retrospective.

PR #102 subsequently merged, including fixes for those four findings. The integration preserves its entity-review reference in the applicability table and its parser-allocation instructions in [testing standards](../../docs/conventions/testing.md#parser-allocation-bounds). The original proposal files retain the collection snapshot rather than claim that those tooling gaps remain current.

`CODE_CONVENTIONS.md` remains the standards entrypoint. The integration preserves its common rules and discloses lifecycle, rendering, interactions, and testing behind an applicability table. `AGENTS.md` directs coordinators to pass the selected references explicitly, and CodeRabbit's configuration names those sources. There is no competing `CODING_STANDARDS.md`.

## Evidence and verification

The research baseline was clean checkout `bf4cfca0ccaa7b781f7e3671d4982000bc9c3c50`, which matched `main` at collection. Historical author reports are dated evidence, not checks rerun here. Test and pending-tool observations in the proposals are inspection at that baseline. They establish test or validation gaps, not newly reproduced production defects.

The coordinating agent owned the combined proposal review and documentation validation. That research phase changed no active policy, source code, ticket, or PR. The later integration changes active documentation and reviewer configuration; its verification record belongs to the integration PR.

Research closeout, 2026-10-05, before integration:

- Reviewed revision: `bf4cfca0ccaa7b781f7e3671d4982000bc9c3c50` plus the uncommitted proposal files in this directory, including an independent read-only review and the coordinating agent's combined review.
- Local verification: the same revision and uncommitted proposals. Local links, collected GitHub references, commit-pinned source paths, coverage totals, and whitespace/diff checks passed.
- Hosted verification: not run for these documentation proposals. Runtime suites were not run. Behavioral findings retain the inspection and historical-evidence limits stated above.
