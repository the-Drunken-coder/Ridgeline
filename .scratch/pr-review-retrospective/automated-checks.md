# Automated checks

Priority: high. Classification: deterministic enforcement. These are implementation suggestions, not checks added by this retrospective.

## Current coverage and pending work

[package.json](../../package.json), [the validation workflow](../../.github/workflows/validation.yml), and [the nightly workflow](../../.github/workflows/nightly.yml) already wire type checking, module tests, consumer builds, browser workflows, execution completeness, and a fail-closed aggregate gate. The repository is not unguarded. No repository lint configuration, lint script, or checked-in precommit hook was found in this checkout.

On the baseline, `test:measurement` is outside ordinary validation. [PR #102's pinned package scripts](https://github.com/the-Drunken-coder/Ridgeline/blob/dfe0e5266f2b8285679b71605605a9147f43425c/package.json) and [workflow](https://github.com/the-Drunken-coder/Ridgeline/blob/dfe0e5266f2b8285679b71605605a9147f43425c/.github/workflows/validation.yml) already repair that gap. Measurement wiring, disk preflight, evidence retention, parser-allocation review, and entity review guidance should be assessed in that existing work, not duplicated here.

The following gaps remain in its collected review. All four threads were unanswered and unresolved in the snapshot. Inspection supports the reported mechanisms; no runtime reproduction or current hosted-check verification was performed here.

## Catch unsafe cleanup control flow locally

[The PR #102 cleanup finding](https://github.com/the-Drunken-coder/Ridgeline/pull/102#discussion_r4187454710) reports that a cleanup exception can replace the initiating measurement error and prevent the other owner's close attempt. CodeRabbit also reports the deterministic `noUnsafeFinally` diagnostic. The [pinned script](https://github.com/the-Drunken-coder/Ridgeline/blob/dfe0e5266f2b8285679b71605605a9147f43425c/scripts/measure-models.mjs#L113) supports both paths by inspection.

Proposed enforcement:

- Add a focused repository correctness-lint check for unsafe control flow in `finally`, using the already reported diagnostic or an equivalent rule. Run it in ordinary CI without a formatting rewrite.
- Add failure-injection coverage that proves both independent cleanup attempts run and the initiating error remains identifiable if cleanup also fails. The lint rule covers syntax; the behavioral test covers ownership and error preservation.

Suggested convention clarification:

> Attempt cleanup for each independent owner even if another cleanup fails. Preserve the initiating failure and report cleanup failures separately. Use the owning resource's teardown API.

[PR #92's teardown finding](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4180678777) and [its response](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4181213436) explain why closing only Vite's HTTP server missed the preview owner's lifecycle. Shared-output interruption policy and descendant-process coverage already exist after [PR #37's lock fix](https://github.com/the-Drunken-coder/Ridgeline/pull/37#discussion_r4129968031); retain those checks.

## Validate durable evidence at the promotion boundary

[The pending promotion tool](https://github.com/the-Drunken-coder/Ridgeline/blob/dfe0e5266f2b8285679b71605605a9147f43425c/scripts/promote-evidence.mjs) has three distinct reported acceptance gaps:

| Gap | Proposed executable guarantee | Behavioral verification |
| --- | --- | --- |
| [An empty provenance object passes](https://github.com/the-Drunken-coder/Ridgeline/pull/102#discussion_r4187454746) | Require the revision and check fields defined by the promotion/closeout contract, with explicit shapes and representation of unknowns. | Real CLI cases for empty, missing, malformed, and valid records. Invalid input leaves no published evidence directory. |
| [Reference-style Markdown links are skipped](https://github.com/the-Drunken-coder/Ridgeline/pull/102#discussion_r4187454753) | Resolve inline and supported reference links to the same retained-target checks. Unsupported syntax must fail explicitly. | Reference links to retained files pass; missing or transient targets fail before publication. |
| [Existing untracked external targets pass](https://github.com/the-Drunken-coder/Ridgeline/pull/102#discussion_r4187454760) | External repository targets must be tracked and included in the published revision, or retained in the promoted output. | Promote from a temporary Git repository, then verify links in a fresh checkout of the published commit. |

Put these guarantees in the existing tool and its tests. [docs/agents/issue-tracker.md](../../docs/agents/issue-tracker.md) already owns the revision/check record; another prose requirement would repeat it without closing the acceptance gaps.

## Validate document structure through its real forms

[PR #37's fenced-example bypass](https://github.com/the-Drunken-coder/Ridgeline/pull/37#discussion_r4129876836) let example text satisfy ticket requirements. The [fix](https://github.com/the-Drunken-coder/Ridgeline/pull/37#discussion_r4129967931) added a fence-aware scanner and executable cases. Preserve that existing repair.

For the new promotion link scan, extend the existing validation boundary to cover the Markdown forms it accepts. A parser or a deliberately restricted, fail-closed format is a concrete design choice; a rule telling authors to avoid reference links would only hide the validator defect. Use actual CLI execution and Git state, rather than source-text tests or mocks of link ownership.
