# Drawing callback failures closeout

Spec: [Map drawing and editing](spec.md)
Integration owner: Codex in the #48 thread, coordinating [#47](https://github.com/the-Drunken-coder/Ridgeline/issues/47) and [#48](https://github.com/the-Drunken-coder/Ridgeline/issues/48).

Status: implementation complete and locally verified. Both acceptance deliveries are integrated on `triage/issue-48`; both issues remain open pending integration into main. The user authorized one combined ready-for-review PR and monitoring on 2026-10-03. Merge remains unauthorized.

## Reviewed revision

Reviewed on 2026-10-03: `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5...a5f3c0f6efa8c29fe7b949ebdd99c744ecf86850` in `/home/ubuntu/.t3/worktrees/Ridgeline/triage-issue-48`, clean source checkout.

The integration owner reviewed the combined diff, session permission/state/preview/history/submission callers, attachment input handlers, marker restoration, target invalidation, callback diagnostics, and public documentation. Diagnostic timestamps precede observer dispatch, are constant-memory, and survive recovery and replacement. Pending failure aborts before observers, preserves the lock through repair, and prevents late acceptance. Observer-driven reads and notifications preserve operation-specific permission behavior and current draft identity.

The #47 owner independently inspected the session and executed two concrete failures during integration: delete-only exceptions incorrectly cached a denied update through `onChange(getState)`, and an unread replacement draft inherited an old permission denial. Both were repaired and reproduced successfully on the repaired source before this final revision was committed. They now have focused regressions, including the symmetric permitted-delete case. A final review also reproduced a permission callback replacing its own draft and then throwing without a diagnostic. `994c408` now reports the original owner/cause through the same cooldown while leaving replacement state untouched and destruction silent. That original sequence was re-executed successfully by the #47 owner. Independent scoped review and integration-owner review extend through `4a51398`, including its native stale-owner regression, with no remaining actionable finding.

## Local verification

Executed latest repaired source revision: `a5f3c0f6efa8c29fe7b949ebdd99c744ecf86850`, clean source checkout, Linux, Node `24.21.0`, pnpm `11.0.9`.

- `pnpm check`: passed ticket checks, package TypeScript, and control-lab type checking.
- `pnpm test`: passed 232 module/script tests and 5 control-lab state tests. The module run includes all 73 drawing-session tests.
- `pnpm build:playground`: passed the package/declaration and playground production builds.
- `pnpm test:browser -- --grep 'Permission|permission|Throwing snap|Snap observers|A snap diagnostic|Snap callback replacement|Ground feedback respects|Rejected drawing remains|Ordinary edits|Stationary target resumes'`: passed all 17 affected installed-package Chromium cases in 1.5 minutes, including all ten newly added workflows. The command rebuilt, packed, independently installed, typechecked, and built the consumer from the final source revision. No uncaught browser errors were observed by the suite.
- `git diff --check 7b817c6..a5f3c0f`: passed. Local Markdown links in README, canonical drawing spec, and this record resolve.

Earlier clean `4a51398` passed type checking, 223 module/script plus five control tests, playground build and 15 affected packaged cases. Those results predate the PR review repairs below.

Broader earlier integrated verification: `e0b0d7e7514d3c2e204e0ecfd1e9f9f13e9d127e` passed `pnpm check`, 221 module/script tests, five control state tests, and the full `pnpm test:browser` suite of 122 cases in 8.1 minutes. Its package and consumer artifacts were built from a clean `e0b0d7e` tree before the reporting follow-up; later checkout changes did not alter the already built external consumer. The full suite was not repeated after the narrow stale-owner reporting fix and added regression. The final module and affected browser runs above cover those changes. The earlier PR source registered 123 browser cases; the repaired source now registers 125.

Earlier integration runs exercised uncommitted source and are investigation evidence, not final-revision verification. They exposed fixture focus/coordinate corrections and two real session cache defects. Interrupted attempts encountered a full disk and an occupied preview port; neither establishes a runtime failure. A regenerable compiler cache was cleared, and the active preview finished before the next run. Vite retains the existing consumer/playground large-chunk warning.

## Acceptance evidence

| Ticket criteria | Evidence at existing interfaces | Final status |
| --- | --- | --- |
| #48 exception versus denial; original cause, operation and feature ID | `Permission exceptions retain geometry and history and differ from explicit denial`; native permission workflow checks `onError` and diagnostic events | Passed on final revision |
| #48 retained draft, appearance, history and last permitted gesture geometry | Focused gesture undo/redo; native drag fails without explicit refresh, then real keyboard undo/redo | Passed on final revision |
| #48 pending create/update/delete abort, repaired lock and ignored late acceptance | Three deferred session cases plus three abort-aware rejection cases; native pending-save workflow checks both late acceptance and abort rejection, including Escape before and after settlement | Passed on final revision |
| #48 recursive observer reads/refresh, cancel/destroy/replacement/repair/conflict | Focused action matrix; final-check replacement submission; unread replacement and independent permission cache regressions; public attachment observer workflow | Passed on final revision |
| #48 bounded reporting and same-draft recovery | Controlled-clock session bound across permission kinds, success and replacement; native repair/recurrence checks | Passed on final revision |
| #47 failed candidate excluded, healthy candidate or valid ground usable | `Throwing snap filters exclude candidates bound all diagnostics and recover with stationary input` checks preview, placement, all diagnostic channels, Alt, repair, recurrence and quiet interval | Passed on final revision |
| #47 real handle and keyboard behavior, cancellation and accepted-data preservation | `Throwing snap filters preserve real keyboard and handle edits and recover targets` | Passed on final revision |
| #47 successful and throwing callback/observer invalidation | `Snap observers invalidate obsolete candidate iteration and placement across owner and scene changes`, 20 combinations of cancel/destroy/replacement/remove/update/immediate-camera/animated-camera/fitBounds/settings/terrain with synchronous obsolete-candidate counting | Passed on final revision |
| Both tickets: native permission rejection isolated; surviving marker restored after obsolete snap resolution | Native placement/keyboard and real drag permission failures; recursive settings/diagnostic marker-restoration workflow | Passed on final revision |

## Verified PR review repairs

Codex review of `0dfcfdb` and documentation-only `c48fad6` reported five findings. They were verified before edits:

- Permission callbacks reentered themselves before the original failure guard was installed. Four public session sequences with callback reads/refreshes, with and without observers, failed before repair, including a stack overflow. The guard now precedes consumer invocation and nested checks reuse at most three operation results. One deferred refresh is completed without replaying an unconditional refresh chain. Existing callback-driven draft changes retain their accepted behavior.
- Delete permission recovery left a snapshot and controls displaying a failure after one refresh. The state-before-button sequence failed before repair; successful recovery now invalidates and republishes its feedback. A real controls workflow checks the rendered message, recursive reads/refreshes and subsequent keyboard input.
- A delete failure overwrote an existing consumer rejection. The rejected-submit/delete-failure/repair sequence failed before repair. Failure feedback now overlays the underlying rejection; recovery reveals the rejection until the user corrects the draft.
- Animated camera changes invalidated old snap work only at completion. The extended real-click matrix failed on `animated-camera/false` before repair. Map movement start and move events invalidate work immediately and detach at destruction. Twenty successful/throwing snap variants now include animated `setCamera` and `fitBounds`, then verify recovery after settlement.
- A successful permission callback could change unrelated data or the camera before a native screen-derived mutation. Real placement failed before the scoped guard. Six camera/data variants now exercise placement, keyboard and dragging, capture state in a microtask before another animation frame, and use the next healthy input without an explicit permission refresh.

The first scoped adapter guard also rejected ordinary notifications and blocked gesture redo; the existing native workflow reproduced it. Callback-local revision comparison repairs that regression. A later drag probe demonstrated a following native movement after rejected `beginGesture`, changing longitude from `0.009999999999990905` to `0.012187957761113921` before the next animation frame. A failed start now leaves the drag inactive and restores only the surviving same-owner marker; replacement markers remain untouched. The final 17-case run exercises both repairs and passes.

The integration owner re-reviewed `c48fad6...96743e6`, including session callers, controls read order, gesture lifecycle, marker identity, callback guards and the changed tests. No remaining actionable finding was identified. #47’s file-only deliveries `3cbffab`, `75830e4` and `75a4806` are integrated as `70630fb`, `d91f65a` and `96743e6`. New hosted checks and review are required for the pushed repaired head; earlier green PR runs do not establish its readiness.

## Abort-rejection follow-up

Codex review of `af854b7` reported [discussion 4171819183](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171819183): an abort-aware consumer rejection overwrote permission-check feedback after permissions were repaired while submission remained pending. Three public-session create/update/delete cases reproduced the loss. A catch-only repair still lost the message during healthy observer reads at settlement; the expanded native pending-save workflow reproduced that second path. `fbfd4a6` and `a5f3c0f` retain the failure reason through abort rejection and settlement. Explicit nonpending permission refresh or a draft correction clears it after recovery; repairing an unsettled request still retains the lock. All 73 session tests and the 17 affected packaged cases pass on clean `a5f3c0f`.

The integration owner reviewed `af854b7...a5f3c0f` and the combined diff against main. The #47 owner independently traced the catch, recovery, pending lock, owner guards and coalesced refresh paths through `a5f3c0f`, with no actionable source finding. That is source review, separate from the integration owner's executions above. Adapter code is unchanged. Earlier clean `96743e6` passed 229 module/script tests, five control tests, 70 session tests, playground build and the same 17 affected browser cases; these are prior-revision results.

[Hosted Validation run 37099132878](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37099132878) passed for earlier PR head `af854b725e77831037b9767dbfa718500eb8c7ee`, exercised merge `b72f2ae7328aaecfdca2b9c52d4a455d1d388360`, on 2026-10-03. All jobs, strict required `validate`, and the full 125-case browser audit passed. CodeRabbit was clean; Codex completed and produced the verified abort-rejection finding above. Optional Macroscope remained unavailable because credits were exhausted. These results do not establish readiness for the follow-up head. Latest-head hosted and review results will be pinned in PR #69 and both tickets, linked to this shared record, without a documentation-only push after those results.

## PR preparation on 2026-10-03

Latest `origin/main` remains `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`; fetch and rebase were a no-op. The integration owner re-reviewed the combined production, tests, registration, spec and drawing README diff against that base. No runtime source or tests changed after exercised `4a51398`. Documentation-only `141bb32` removes the unrelated #50 runtime-policy README paragraph; isolated commit `d54aa00589b3ddd46ec321d3f014675011659e92` transfers that paragraph to the #50 owner. Drawing contract documentation remains. Diff checks passed; already passing runtime checks were not repeated for this documentation separation.

The #47 owner independently rechecked unchanged main and open PR #68 head `396b0a0`. Keyboard snapping remains covered by the combined adapter guards. Its longitude changes remain separate; no additional adapter repair was needed. This is source comparison evidence, not a fresh runtime run.

## Historical hosted verification and current integration limits

[Combined PR #69](https://github.com/the-Drunken-coder/Ridgeline/pull/69) is ready for review and registered with the integration and #47 support threads. No merge is authorized. The earlier pre-PR combined review extended through `0dfcfdb1bc484676561d1aa943beb6900c0b8052` against base `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`; runtime source/tests are identical to locally exercised `4a51398`.

[Hosted Validation run 37097691688](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/37097691688) passed on 2026-10-03 for PR head `0dfcfdb1bc484676561d1aa943beb6900c0b8052`, checked out as merge `c781e4b7ac46e29ea85f189bec7d78121b831e10`. Type checking, module tests, consumer builds, control-browser, all four packaged-browser shards, browser report merging/completeness and `validate` succeeded. The report audit verified all 123 current packaged cases exactly once. This is complete earlier-source hosted evidence, separate from the earlier 122-case local artifacts. Main protection was read back as strict required `validate`.

CodeRabbit completed for `0dfcfdb` with no actionable comments. Codex subsequently completed and reported the five verified findings described above. Optional Macroscope skipped because its credit balance is exhausted; the repository’s optional-bot policy does not block completion on that unavailable service. Vercel deployment and preview feedback checks passed. The documentation-only commit recording this evidence requires inspection of its own current-head CI/review before monitoring ends. Final-head results are retained in the PR and both issues, without attributing this earlier run to that later head.

The former absence of hosted checks for locally tested `4a51398` remains historical evidence; it is superseded for hosted coverage by this PR run.

Historical baseline evidence, inspected on 2026-10-03: [main Validation run](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/36969816638) succeeded on 2026-10-02 for main `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`, including `validate`, typecheck, module, control-browser, consumer-build and four packaged-browser jobs. This predates the callback repairs.

Main was still `7b817c6` at the final review. Open [PR #68](https://github.com/the-Drunken-coder/Ridgeline/pull/68), head `396b0a0`, remains separate. Its current-owner/pre-submit permission guards and keyboard snap call overlap this delivery; the equivalent required guards were reconciled locally. Its unrelated geographic, rendering, interaction-acquisition and CI changes were not imported. Reconcile the overlap again if the target changes before merge.

Preintegration #47 evidence on 2026-10-03: `6d2481e` passed type checking, build, 45 existing drawing-session tests, and five existing packaged cases; `af7c44a` passed type checking and seven existing packaged input cases. They are integrated as `a5a410b` and `68f6eaf`. Those runs did not exercise the combined permission implementation or new throwing-callback regressions.

Remaining limits: changes are published on `triage/issue-48` but are not integrated into main; current-head checks and available reviews must be inspected after these source repairs; desktop Chromium with software WebGL only. No new macOS, Node 25.9, Firefox/WebKit, physical-GPU, touch/pen or complete accessibility evidence. [#50](https://github.com/the-Drunken-coder/Ridgeline/issues/50) still tracks manual macOS evidence; the runtime-policy README paragraph was handed off as `d54aa00` and is published separately with the #50 spec on `triage/issue-50` at `ce6c7b4`; this drawing branch claims no macOS execution. Immediate local cancellation of an unsettled submission remains a separate contract decision.
