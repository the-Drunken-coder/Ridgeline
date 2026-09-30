# Issue tracker: GitHub Issues

Use [Ridgeline's GitHub Issues](https://github.com/the-Drunken-coder/Ridgeline/issues) as the authoritative tracker for spec publication, implementation tickets, status, discussion, and dependencies. Approved requirements remain in versioned specs as described below.

## Conventions

- Publish one GitHub issue per ticket. Apply the labels in [triage-labels.md](triage-labels.md); approved implementation tickets use `ready-for-agent`.
- Keep approved requirements versioned at `.scratch/<feature-slug>/spec.md`. Publish new specs as GitHub issues labelled `spec`, or reference an existing published spec issue, and link the canonical versioned source.
- Attach each implementation ticket to its source spec by a named link. Include its complete acceptance criteria and context, with GitHub URLs rather than relative filesystem links in issue bodies.
- Use native GitHub blocking dependencies. A readable "Blocked by" section supplements those relationships; it does not replace them.
- GitHub issue state, labels, assignees, and comments are authoritative. Local `.scratch` tickets are historical planning artifacts or working drafts, not a second live tracker. Migrated files link to their canonical GitHub issue.
- Keep research, prototypes, screenshots, and other supporting artifacts versioned in `.scratch/`. Prefer commit-pinned links when preserving the evidence behind a decision.

## Canonical requirements

Approved feature requirements are canonical in `.scratch/<feature-slug>/spec.md`, versioned with the feature branch. Import a GitHub-originated spec there with its source URL and import date. GitHub issues may track discussion and status; surface conflicting edits for resolution before implementing the disputed requirement. Record approved requirement changes in the local spec and pass its exact path to workers and reviewers.

Nightly GitHub failure issues are a separate operational workflow in the same tracker. Canonical feature requirements remain in versioned specs.

## Implementation tickets

Before delegation, each ticket must contain:

- `Spec:` linking the canonical spec, and the scope or files it owns.
- Observable acceptance criteria, including relevant failure paths and how to verify them. Keep rationale in the spec.
- `Blocked by:` listing prerequisites needed to start implementation, or `none`.
- `Acceptance depends on:` listing deliveries needed for final verification, or `none`. Parallel development does not imply independent acceptance.
- `Integration owner:` identifying the coordinating agent or person responsible for reviewing and checking the combined deliveries. Name the integration ticket or record shared by the workers.

For tickets that change interactions or asynchronous state, add a short transition table to the acceptance criteria: what changes, who owns the result, what the user or consumer observes, and how to verify it. Include relevant changes that occur without new input, such as a camera move beneath a stationary pointer, and callbacks that cancel or replace active work. Assign each transition to a ticket when several tickets share the workflow.

When parallel tickets change shared state, the integration owner reviews their combined behavior as soon as the slices first run together. Record the combined revision, tested transitions, and gaps in the shared closeout record before reporting an integrated slice as verified. Repeat the review for later changes that affect those transitions.

For local historical tickets and working drafts, place metadata before the first `##` section. Use `Spec: [Feature name](../spec.md)` and a `## Acceptance criteria` section with nonempty list items. `pnpm check:tickets`, included in `pnpm check` and CI, checks these local files under `.scratch/*/issues/`; it does not validate GitHub issue bodies or state. Migrated snapshots instead supply a `Canonical issue:` Markdown link to an issue in this repository and are exempt from local metadata requirements. Local wayfinding tickets are exempt when their `Type:` is `research`, `prototype`, `grilling`, or `task` and a sibling `map.md` exists. Reviewers still judge scope, dependency completeness, and whether the criteria prove the required behavior. Published GitHub tickets use the absolute links and native dependencies described above.

At closeout, map each acceptance criterion to evidence or an explicit remaining gap. Use `Status: resolved` only when those criteria and acceptance dependencies are satisfied; otherwise retain a triage status and state what is implemented and what remains. The wayfinding statuses below apply to its separate research workflow.

## Closeout record

Keep one shared record for integrated work and link it from each participating ticket:

```text
Spec: <canonical path>
Integration owner: <coordinating agent or person>
Reviewed: <base SHA>...<head SHA>, <review result>
Local verification: <revision, commands, results>
Hosted verification: <PR head SHA, tested checkout/merge SHA, run URL, required-check results>
Remaining limits: <pending acceptance, unverified behavior, or access limits>
```

Mark uncommitted changes explicitly instead of attributing them to `HEAD`. If a tested checkout SHA cannot be established, record it as unknown. Separate historical runs from evidence for the current revision. A clean review is review evidence; successful execution is check evidence. Update the record after post-review changes and inspect current required checks before claiming merge readiness.

## When a skill says "publish to the issue tracker"

Create or update the GitHub issue in `the-Drunken-coder/Ridgeline`. Check for an existing matching issue before creating a duplicate. Writing or pushing a Markdown file alone does not publish a tracker issue.

For multiline bodies, use a structured API payload or a temporary file with `gh issue create --body-file`. Create tickets first, then wire native dependencies once their GitHub identities exist. Verify the published body, labels, and relationships.

## When a skill says "fetch the relevant ticket"

Fetch the GitHub issue body, comments, labels, state, and relevant blocking relationships. If given an older local ticket, follow its canonical GitHub link when present. Read linked spec and supporting context before implementation or review.

## Wayfinding operations

- **Map**: a GitHub issue labelled `wayfinder:map`.
- **Child ticket**: a native sub-issue of the map, labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Create missing labels when first needed.
- **Blocking**: native GitHub issue dependencies. Keep named blocker links in the body for readability.
- **Frontier**: list the map's open sub-issues, exclude assigned issues and those with open blocking dependencies, and take the lowest issue number first.
- **Claim**: assign the ticket to the developer driving the work before starting it.
- **Resolve**: post a resolution comment, close the issue, and add a named link with a one-line gist to the map's Decisions so far.
- **Historical maps**: existing local maps and resolved decision tickets remain historical records; migrate them only when requested or resumed. New implementation work uses GitHub Issues.

## Native relationship APIs

GitHub's [issue dependency API](https://docs.github.com/en/rest/issues/issue-dependencies) manages blocking relationships; its [sub-issue API](https://docs.github.com/en/rest/issues/sub-issues) manages map membership. Create relationships with issue IDs, not issue numbers. Read them back after writing. If permissions or platform support prevent a native relationship, report the limitation and retain explicit named links rather than claiming the relationship exists.
