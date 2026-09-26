# Working in Ridgeline

## Before code work

- Before designing, changing, or reviewing code, read [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md). Use it as the project's standards source, including for Matt Pocock's Standards review.
- Before exploring a feature, read [CONTEXT.md](CONTEXT.md) and the relevant decisions in [docs/adr/](docs/adr/). Follow [docs/agents/domain.md](docs/agents/domain.md) for domain documentation. Surface conflicts with an accepted decision before changing that decision.
- For implementation or Spec review, read the referenced spec or ticket and its linked context. Feature specs live under `.scratch/<feature>/spec.md`. Pass the exact spec or ticket path to delegated workers and reviewers.
- For public API changes, read the relevant contract in [README.md](README.md) and update it with the implementation.

## Tracking work

When creating, fetching, or updating specs and tickets, follow [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md). Use [docs/agents/triage-labels.md](docs/agents/triage-labels.md) when assigning triage roles.

## Validation and completion

Choose checks using the testing guidance in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md). Read the relevant `package.json` for current commands; [README.md](README.md) explains package and playground validation, and [control-lab/README.md](control-lab/README.md) covers the separate control lab.

Before finishing, review the diff for unintended changes and report what changed, which checks ran, and any remaining limits. Documentation-only changes need link and diff checks, not the runtime test suite.
