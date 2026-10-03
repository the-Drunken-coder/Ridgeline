# Drawing callback failures closeout

Spec: [Map drawing and editing](spec.md)
Integration owner: Codex in the #48 thread, coordinating [#47](https://github.com/the-Drunken-coder/Ridgeline/issues/47) and [#48](https://github.com/the-Drunken-coder/Ridgeline/issues/48).

Status: implementation complete and locally verified. Both acceptance deliveries are integrated on `triage/issue-48`; both issues remain open pending integration into main. No PR creation or merge is authorized.

## Reviewed revision

Reviewed on 2026-10-03: `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5...4a51398aecf809b68fb01a078dcb5e431afda480` in `/home/ubuntu/.t3/worktrees/Ridgeline/triage-issue-48`, clean source checkout.

The integration owner reviewed the combined diff, session permission/state/preview/history/submission callers, attachment input handlers, marker restoration, target invalidation, callback diagnostics, and public documentation. Diagnostic timestamps precede observer dispatch, are constant-memory, and survive recovery and replacement. Pending failure aborts before observers, preserves the lock through repair, and prevents late acceptance. Observer-driven reads and notifications preserve operation-specific permission behavior and current draft identity.

The #47 owner independently inspected the session and executed two concrete failures during integration: delete-only exceptions incorrectly cached a denied update through `onChange(getState)`, and an unread replacement draft inherited an old permission denial. Both were repaired and reproduced successfully on the repaired source before this final revision was committed. They now have focused regressions, including the symmetric permitted-delete case. A final review also reproduced a permission callback replacing its own draft and then throwing without a diagnostic. `994c408` now reports the original owner/cause through the same cooldown while leaving replacement state untouched and destruction silent. That original sequence was re-executed successfully by the #47 owner. Independent scoped review and integration-owner review extend through `4a51398`, including its native stale-owner regression, with no remaining actionable finding.

## Local verification

Executed final revision: `4a51398aecf809b68fb01a078dcb5e431afda480`, clean source checkout, Linux, Node `24.21.0`, pnpm `11.0.9`.

- `pnpm check`: passed ticket checks, package TypeScript, and control-lab type checking.
- `pnpm test`: passed 223 module/script tests and 5 control-lab state tests. The module run includes all 64 drawing-session tests.
- `pnpm build:playground`: passed the package/declaration and playground production builds.
- `pnpm test:browser -- --grep 'Permission|permission|Throwing snap|Snap observers|A snap diagnostic|Snap callback replacement|Ground feedback respects|Rejected drawing remains|Ordinary edits|Stationary target resumes'`: passed all 15 affected installed-package Chromium cases in 54.9 seconds, including all eight newly added workflows. The command rebuilt, packed, independently installed, typechecked, and built the consumer from the final source revision. No uncaught browser errors were observed by the suite.
- `git diff --check 7b817c6..4a51398`: passed. Local Markdown links in README, canonical drawing spec, and this record resolve.

Broader earlier integrated verification: `e0b0d7e7514d3c2e204e0ecfd1e9f9f13e9d127e` passed `pnpm check`, 221 module/script tests, five control state tests, and the full `pnpm test:browser` suite of 122 cases in 8.1 minutes. Its package and consumer artifacts were built from a clean `e0b0d7e` tree before the reporting follow-up; later checkout changes did not alter the already built external consumer. The full suite was not repeated after the narrow stale-owner reporting fix and added regression. The final module and affected browser runs above cover those changes. The final source registers 123 browser cases.

Earlier integration runs exercised uncommitted source and are investigation evidence, not final-revision verification. They exposed fixture focus/coordinate corrections and two real session cache defects. Interrupted attempts encountered a full disk and an occupied preview port; neither establishes a runtime failure. A regenerable compiler cache was cleared, and the active preview finished before the next run. Vite retains the existing consumer/playground large-chunk warning.

## Acceptance evidence

| Ticket criteria | Evidence at existing interfaces | Final status |
| --- | --- | --- |
| #48 exception versus denial; original cause, operation and feature ID | `Permission exceptions retain geometry and history and differ from explicit denial`; native permission workflow checks `onError` and diagnostic events | Passed on final revision |
| #48 retained draft, appearance, history and last permitted gesture geometry | Focused gesture undo/redo; native drag fails without explicit refresh, then real keyboard undo/redo | Passed on final revision |
| #48 pending create/update/delete abort, repaired lock and ignored late acceptance | Three deferred session cases; native pending-save workflow, including Escape before and after settlement | Passed on final revision |
| #48 recursive observer reads/refresh, cancel/destroy/replacement/repair/conflict | Focused action matrix; final-check replacement submission; unread replacement and independent permission cache regressions; public attachment observer workflow | Passed on final revision |
| #48 bounded reporting and same-draft recovery | Controlled-clock session bound across permission kinds, success and replacement; native repair/recurrence checks | Passed on final revision |
| #47 failed candidate excluded, healthy candidate or valid ground usable | `Throwing snap filters exclude candidates bound all diagnostics and recover with stationary input` checks preview, placement, all diagnostic channels, Alt, repair, recurrence and quiet interval | Passed on final revision |
| #47 real handle and keyboard behavior, cancellation and accepted-data preservation | `Throwing snap filters preserve real keyboard and handle edits and recover targets` | Passed on final revision |
| #47 successful and throwing callback/observer invalidation | `Snap observers invalidate obsolete candidate iteration and placement across owner and scene changes`, 16 combinations of cancel/destroy/replacement/remove/update/camera/settings/terrain with synchronous obsolete-candidate counting | Passed on final revision |
| Both tickets: native permission rejection isolated; surviving marker restored after obsolete snap resolution | Native placement/keyboard and real drag permission failures; recursive settings/diagnostic marker-restoration workflow | Passed on final revision |

## Hosted verification and integration limits

No PR exists for this delivery. The GitHub check-runs API returned zero checks for published `4a51398` on 2026-10-03. Hosted required-check evidence is unavailable for this delivery; local verification does not establish merge readiness.

Historical baseline evidence, inspected on 2026-10-03: [main Validation run](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36969816638) succeeded on 2026-10-02 for main `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`, including `validate`, typecheck, module, control-browser, consumer-build and four packaged-browser jobs. This predates the callback repairs.

Main was still `7b817c6` at the final review. Open [PR #68](https://github.com/the-Drunken-coder/Ridgeline/pull/68), head `396b0a0`, remains separate. Its current-owner/pre-submit permission guards and keyboard snap call overlap this delivery; the equivalent required guards were reconciled locally. Its unrelated geographic, rendering, interaction-acquisition and CI changes were not imported. Reconcile the overlap again against the chosen target before a future PR.

Preintegration #47 evidence on 2026-10-03: `6d2481e` passed type checking, build, 45 existing drawing-session tests, and five existing packaged cases; `af7c44a` passed type checking and seven existing packaged input cases. They are integrated as `a5a410b` and `68f6eaf`. Those runs did not exercise the combined permission implementation or new throwing-callback regressions.

Remaining limits: changes are published on `triage/issue-48` but are not integrated into main; hosted checks unavailable for this branch; desktop Chromium with software WebGL only. No new macOS, Node 25.9, Firefox/WebKit, physical-GPU, touch/pen or complete accessibility evidence. [#50](https://github.com/the-Drunken-coder/Ridgeline/issues/50) still tracks manual macOS evidence; README records its approved policy without claiming execution. Immediate local cancellation of an unsettled submission remains a separate contract decision.
