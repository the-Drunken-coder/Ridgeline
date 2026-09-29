# PR #35 retrospective fixes

Recorded 2026-09-29.

- Spec: the user-approved four improvements from the PR #35 retrospective in this session; no separate feature spec.
- Integration owner: coordinating Codex agent, integrating the delegated ticket checker with the browser lock and review configuration.
- Reviewed: base `c4bf43f4f16e347a673ab56436b5fe1660141639` plus the uncommitted changes in this checkout. The coordinator reviewed the combined diff; an independent review found no actionable issues.
- Local verification: the same uncommitted implementation passed `pnpm check`, `pnpm test` with 185 Node tests and five control-lab tests, and the packaged browser command below. The CodeRabbit YAML validated against its official schema retrieved on 2026-09-29. Diff and local documentation link checks passed.
- Hosted verification: not run at local closeout, before committing and opening the PR. Current hosted results belong to the PR checks; local acceptance does not establish merge readiness.
- Remaining limits: only the targeted packaged browser case was rerun. CodeRabbit's hosted use of the new configuration remains unverified. Abruptly interrupted browser runs require manual lock recovery after their child processes stop, as documented in [CI validation](../../docs/ci-validation.md).

## Acceptance evidence

- Review guidance requires actual producer output for external reports. The existing real-Playwright regression remains included in `pnpm test` and passed.
- Ticket validation runs through `pnpm check`, which the existing hosted typecheck job executes. CLI regressions cover missing fields, invalid spec links, empty criteria, and wayfinding exemptions; all six repository implementation tickets pass. Three historical tickets now meet the required structure without changing their status or presenting old evidence as current verification.
- Browser lock regressions exercise competing runner processes, failed setup, subsequent reuse, and abandoned-lock recovery. The real packaged workflow passed with `pnpm test:browser -- --grep 'Late terrain preparation cannot affect a replacement viewport'` and released its lock.
- `.coderabbit.yaml` disables the docstring percentage check and explicitly loads `CODE_CONVENTIONS.md` as review guidance. Configuration validation used [CodeRabbit's official schema](https://coderabbit.ai/integrations/schema.v2.json).
