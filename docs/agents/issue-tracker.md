# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Canonical requirements

Approved feature requirements are canonical in `.scratch/<feature-slug>/spec.md`, versioned with the feature branch. Import a GitHub-originated spec there with its source URL and import date. GitHub issues may track discussion and status; surface conflicting edits for resolution before implementing the disputed requirement. Record approved requirement changes in the local spec and pass its exact path to workers and reviewers.

Nightly GitHub failure issues are a separate operational channel. They do not change where feature specs and implementation tickets live.

## Implementation tickets

Before delegation, each ticket must contain:

- `Spec:` linking the canonical spec, and the scope or files it owns.
- Observable acceptance criteria, including relevant failure paths and how to verify them. Keep rationale in the spec.
- `Blocked by:` listing prerequisites needed to start implementation, or `none`.
- `Acceptance depends on:` listing deliveries needed for final verification, or `none`. Parallel development does not imply independent acceptance.
- `Integration owner:` identifying the coordinating agent or person responsible for reviewing and checking the combined deliveries. Name the integration ticket or record shared by the workers.

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

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/matt-wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
