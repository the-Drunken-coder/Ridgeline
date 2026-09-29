# Issue tracker: GitHub Issues

Use [Ridgeline's GitHub Issues](https://github.com/the-Drunken-coder/Ridgeline/issues) as the authoritative tracker for new specs, implementation tickets, status, discussion, and dependencies.

## Conventions

- Publish one GitHub issue per ticket. Apply the labels in [triage-labels.md](triage-labels.md); approved implementation tickets use `ready-for-agent`.
- Specs can remain versioned at `.scratch/<feature-slug>/spec.md`. Publish new specs as GitHub issues labelled `spec`, or reference an existing published spec issue. Link the versioned source when present.
- Attach each implementation ticket to its source spec by a named link. Include its complete acceptance criteria and context, with GitHub URLs rather than relative filesystem links in issue bodies.
- Use native GitHub blocking dependencies. A readable "Blocked by" section supplements those relationships; it does not replace them.
- GitHub issue state, labels, assignees, and comments are authoritative. Local `.scratch` tickets are historical planning artifacts or working drafts, not a second live tracker. Migrated files link to their canonical GitHub issue.
- Keep research, prototypes, screenshots, and other supporting artifacts versioned in `.scratch/`. Prefer commit-pinned links when preserving the evidence behind a decision.

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
