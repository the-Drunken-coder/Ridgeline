# Code review procedure

Use for code review and incoming PR feedback. [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md) and its applicable topic files are the standards sources. Feature requirements remain in their canonical spec, located through the [tracker adapter](issue-tracker.md). Retrospective proposals are supporting history, not additional standards sources.

## Prepare the review

1. Pin the comparison base and head commit SHAs, the merge base where relevant, and the checkout used for execution. Identify uncommitted changes separately. Confirm the requested comparison resolves and has a nonempty diff before delegating work.
2. Identify the canonical spec or ticket and read its linked context through the tracker adapter. State when no spec is available rather than treating a Standards result as a Spec result.
3. Select all applicable files from the conventions' behavior table, considering callers and owners outside the diff. Read the relevant [glossary](../../GLOSSARY.md), [ADRs](../adr/), and public contracts. Surface conflicts with accepted decisions.

For Matt Pocock's two-axis review, give the Standards reviewer the exact comparison, commit list, `CODE_CONVENTIONS.md`, and every selected topic file. Include the skill's smell baseline when required; repository standards override that heuristic baseline. Give the Spec reviewer the same comparison and the canonical spec and relevant linked context. Preserve the separate Standards and Spec reports and the skill's reporting format.

Reviewers must explicitly read the supplied source files. Naming only the root conventions does not establish that a delegated worker received its applicable references. Select references by changed behavior rather than copying the whole handbook into every implementation prompt.

## Investigate changed guarantees

For changed completeness, deduplication, cancellation, callback, cache, recovery, or ownership guarantees, trace relevant callers and state owners, including files outside the diff. Construct a concrete sequence of actions that could violate each affected guarantee. Check whether valid and invalid histories can produce the same summary.

Record the attempted sequence, outcome, and evidence. Demonstrate suspected failures through an existing interface when practical. Distinguish executed reproductions, conclusions from inspection, and untested hypotheses. Use the [testing standards](../conventions/testing.md) to select focused checks. Before declaring runtime checks unavailable because dependencies are missing, inspect matching existing worktrees or prepare an isolated checkout with the required dependencies.

Complete this investigation before reporting either review axis clean. Cite the authoritative rule for a Standards finding and the requirement for a Spec finding. Label heuristic smells as judgment calls. For deterministic violations, use configured checks; report an unwired or ineffective guardrail as a coverage gap rather than inventing a duplicate prose standard.

## Handle PR feedback

When reviewing an existing PR or responding to feedback, read inline review threads and replies, review submission bodies including outside-diff findings, and PR conversation comments. Record a disposition for substantive findings in every channel. State unavailable feedback or execution access explicitly.

Trace the claimed mechanism and the proposed fix through relevant callers, synchronous observers, and documented defaults. Classify each finding as reproduced, supported by inspection, disproved, already fixed, or still uncertain. A resolved thread alone is not verification evidence. Preserve a negative observation interval when its purpose is continued absence after delayed work, as described in the testing standards.

Fix verified findings within the authorized scope and provide the revision and evidence supporting the response. Explain narrowed or declined suggestions with the relevant contract or observed behavior. Processing notices, deployment messages, and repeated walkthroughs are not additional findings.

## Complete the review

Use the [tracker adapter's closeout record](issue-tracker.md#closeout-record) to record reviewed and exercised revisions, commands and outcomes, current hosted evidence where applicable, and remaining limits. Mark uncommitted inputs explicitly. Keep review evidence distinct from execution evidence, and historical runs distinct from verification of the current revision.

For parallel implementation, the integration owner reviews and verifies the combined deliveries. Changes after review require renewed review and checks appropriate to the changed behavior. Report implementation complete, locally verified, and merge-ready as distinct states. Before claiming merge readiness, inspect required hosted checks and actionable review findings for the current PR revision.
