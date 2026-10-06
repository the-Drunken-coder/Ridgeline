# Review feedback and navigation

Priority: medium. Classification: review workflow and navigation.

Suggested home: a triggered `docs/agents/review.md` reference if adopted. Keep [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md) authoritative for both implementation and Standards review.

## Read every feedback channel

Proposed review step:

> Read inline review threads and their replies, review submission bodies including outside-diff findings, and PR conversation comments. Follow the links needed to establish each finding's context. Record a disposition for substantive findings in every channel.

Several useful findings appear only in review summaries: [PR #23's untriggered late-completion check](https://github.com/the-Drunken-coder/Ridgeline/pull/23#pullrequestreview-5343126799), [PR #24's missing arrowhead assertion](https://github.com/the-Drunken-coder/Ridgeline/pull/24#pullrequestreview-5343186913), and [PR #44's pitch-specific coverage concern](https://github.com/the-Drunken-coder/Ridgeline/pull/44#pullrequestreview-5359146569). Fetching only inline comments would miss them. The pitch finding has no direct author disposition in this corpus; it is not evidence of a current production defect.

For a history-wide retrospective, collect repository inline comments and issue conversations with pagination, filter conversations by the complete PR list, and fetch review bodies/thread state in a bounded GraphQL query. The [source inventory](sources.md) records that approach. Reuse the collected snapshot for analysis instead of repeatedly fetching each PR's same bodies.

## Verify the mechanism before adopting the proposed fix

Proposed review step:

> Trace the claimed failure and the proposed fix through relevant callers, synchronous observers, and documented defaults. Record whether the finding was reproduced, supported by inspection, disproved, already fixed, or still uncertain. A resolved thread alone is not verification evidence.

Existing review-completion rules already require caller tracing and evidence categories. This addition applies that discipline explicitly to incoming agent feedback.

| Proposed change | Why it was declined or narrowed |
| --- | --- |
| Replace a drawing `render` listener with `move` | [PR #42's real delayed-terrain regression](https://github.com/the-Drunken-coder/Ridgeline/pull/42#discussion_r4130574713) showed the substitution broke stationary recovery; [the reviewer withdrew it](https://github.com/the-Drunken-coder/Ridgeline/pull/42#discussion_r4130646528). |
| Add more outer drag-cleanup logic | [PR #43's response](https://github.com/the-Drunken-coder/Ridgeline/pull/43#discussion_r4139977853) traced synchronous subscriber cleanup and tested native input; [the reviewer withdrew it](https://github.com/the-Drunken-coder/Ridgeline/pull/43#discussion_r4139980433). |
| Change the required validation gate to `!cancelled()` | [PR #35's response](https://github.com/the-Drunken-coder/Ridgeline/pull/35#discussion_r4129728970) preserved a gate that evaluates cancelled/skipped prerequisites; [the reviewer accepted the distinction](https://github.com/the-Drunken-coder/Ridgeline/pull/35#discussion_r4129751411). |
| Require an application icon in the model example | [PR #92's response](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4181213317) established the default dot fallback; [the reviewer withdrew the requirement](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4181259662). |
| Add an independent rendering-engine fallback | [PR #24's reviewer response](https://github.com/the-Drunken-coder/Ridgeline/pull/24#discussion_r4127731818) accepted forwarding wrappers around the actual map, consistent with [ADR-0002](../../docs/adr/0002-maplibre-extension-access.md). |

The [regression proposal](regression-evidence.md) separately explains why a negative observation interval cannot be replaced by early success. These examples support investigation, not a general rule to accept or reject bot suggestions.

## Keep guidance in one place

The current conventions and repository instructions are short. Add the narrow proposed clauses to their existing sections. If detailed review histories grow, disclose them behind a trigger naming the behavior under review; the conventions remain the entrypoint. PR #102 already takes this approach for entity histories, so reuse that pending reference once adopted.

Do not create a competing standards file, move every standard to the implementation prompt, or rewrite the short `AGENTS.md` merely to satisfy the skill's generic file examples. This repository intentionally uses `CODE_CONVENTIONS.md` during both implementation and review.

Repeated CodeRabbit docstring-percentage warnings are historical noise. [The current reviewer configuration](../../.coderabbit.yaml) already turns that pre-merge check off and points CodeRabbit at `CODE_CONVENTIONS.md`. No additional docstring policy or configuration change is proposed. Type checking, package declaration validation, real tool-reporter tests, and revision-specific closeout already have checks or rules; keep those sources rather than repeating them.
