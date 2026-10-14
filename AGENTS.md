# Ridgeline

P-Stack owns implementation planning and engineering execution. Use the installed `t3-pstack` skills and their bundled workflows. Let PStack choose its working artifacts for the task while preserving existing canonical documents, locations, links, and history. Do not create duplicate P-Stack versions. Report unavailable skills before running the affected workflow.

Project-specific requirements, accepted decisions, and authority boundaries override generic workflow preferences.

Read the relevant project context before planning, changing, or reviewing work:

- [README.md](README.md) for public contracts and package/playground validation.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) and its applicable topic files for coding standards.
- [GLOSSARY.md](GLOSSARY.md) and relevant [ADRs](docs/adr/) for domain terms and accepted decisions.
- Existing `.scratch/<feature>/spec.md` files and linked tickets for feature requirements and approval evidence.
- The relevant `package.json` for current commands. The separate control lab is documented in [control-lab/README.md](control-lab/README.md).

Every worker and reviewer brief must identify the applicable document paths and sections above, tracker links, protected guarantees, and required verification. Each agent must read that context before acting.

Versioned feature specs own approved requirements. Honor a ticket's explicit canonical-source provenance while versioned publication is pending. Report required documents missing from the checkout before affected implementation; preserve their originals rather than reconstructing copies.

Preserve approved requirements and accepted decisions. Distinguish them from drafts, prototypes, and provisional implementation ideas using explicit approval evidence. A spec filename, readiness label, or open issue does not establish approval or authorize new work. Report uncertain or conflicting approval status before affected implementation; do not relabel historical records by assumption.

Agents may make reversible internal design decisions within the authorized scope. Document significant decisions and rationale in the existing project documents, using [docs/adr/](docs/adr/) for architectural decisions. When an authorized change supersedes an ADR, link the old and new decisions in both directions and preserve the original rationale and history. Surface conflicts with an accepted decision before changing it. Ask the user before changing product scope, breaking public APIs, or revising explicitly protected guarantees.

[GitHub Issues](https://github.com/the-Drunken-coder/Ridgeline/issues) own ticket status, discussion, and dependencies. Reuse existing tickets; retain local ticket snapshots as history rather than a second tracker. Workflow setup does not authorize starting the backlog, coordinators, schedules, or deployments. Open a PR or merge only when explicitly requested.
