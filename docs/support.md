# Browser, input and accessibility checks

Ridgeline requires WebGL2. The support suite tests the packed production package in Playwright Chromium, Firefox and WebKit. Engine checks do not certify installed Chrome, Edge, Safari, mobile devices or physical GPUs. Verification evidence is linked below; working records are not included in the installed package.

## Revision-specific evidence

The viewport upgrades were merged through [controls #114](https://github.com/the-Drunken-coder/Ridgeline/pull/114), [appearance #115](https://github.com/the-Drunken-coder/Ridgeline/pull/115), [selection #116](https://github.com/the-Drunken-coder/Ridgeline/pull/116), [drawing #117](https://github.com/the-Drunken-coder/Ridgeline/pull/117) and [starter #118](https://github.com/the-Drunken-coder/Ridgeline/pull/118). Their descriptions retain the exact reviewed revisions and results. Historical October 11–12 digest-based results remain in the [versioned closeout](https://github.com/the-Drunken-coder/Ridgeline/blob/a646c3a67bbf9dc1344e03a24fc55c3674616d4c/.scratch/viewport-upgrades/closeout.md); they do not verify a later head.

[PR #122](https://github.com/the-Drunken-coder/Ridgeline/pull/122) records the later ownership refactor and its [14-job validation](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/40164038562) at head `0ae8df3`, exercised as merge commit `7847257`. [PR #124](https://github.com/the-Drunken-coder/Ridgeline/pull/124) records a controlled failure and passing repair for empty-model GPU error polling. That partial repair does not explain the original intermittent western-globe readiness failure. [Issue #123](https://github.com/the-Drunken-coder/Ridgeline/issues/123) is closed, but its retained investigation is **inconclusive**; closure and subsequent passing controls do not establish a causal fix.

The selected original producer reports are already versioned, so these downloads do not depend on GitHub Actions artifact retention. Each manifest records exact source revisions, member hashes, failed/incomplete classifications and omissions. These are preserved results, not fresh test runs.

| Retained evidence | Readable record | Raw reports and checksum |
| --- | --- | --- |
| Original failure and selected hosted controls | [Summary](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/issue-123-history/summary.md) | [Archive](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/issue-123-history/raw-reports.tar.gz) · [Manifest](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/issue-123-history/manifest.json) |
| Inconclusive local investigation | [Summary](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/issue-123-investigation/summary.md) | [Archive](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/issue-123-investigation/raw-reports.tar.gz) · [Manifest](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/issue-123-investigation/manifest.json) |
| Controlled empty-model query repair | [Summary and recordings](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/empty-model-query/summary.md) | [Archive](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/empty-model-query/raw-reports.tar.gz) · [Manifest](https://github.com/the-Drunken-coder/Ridgeline/blob/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch/codebase-reliability-repairs/evidence/empty-model-query/manifest.json) |

The suite uses an explicit required-workflow inventory. Renaming a required case without updating that inventory fails configuration loading, rather than silently narrowing support coverage. Environment attachments record each exercised engine and input revision. Current software rendering results do not establish physical GPU, installed Safari or mobile-device acceptance.

## Repeat the browser checks

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:support
```

The focused suite exercises current selection, configured presentation, drawing holes and exact segments, edge snapping, controls, independent cleanup failure recovery, retained-focus native camera ownership and the starter's keyboard, storage restore and save rejection journeys. Full rendering and regression coverage remains in `pnpm test:browser`. Both commands build and install a fresh local archive before running. They share an artifact lock, so run them sequentially.

On Linux, Firefox uses a display for WebGL. The runner starts `xvfb-run` when `DISPLAY` is absent. Chromium uses SwiftShader; Firefox and WebKit use the available graphics backend. Successful cases attach browser version, user agent, reported renderer and source context. Headless Firefox without a display failed to create WebGL in this Ubuntu environment; the headed virtual-display workflow passed. See [Playwright's Linux CI guidance](https://playwright.dev/docs/ci#running-headed).

| Check | Coverage | Limits |
| --- | --- | --- |
| Chromium | Full packaged rendering/regression suite and focused support workflows | Software rendering, one Linux environment |
| Firefox | Focused support workflows with Linux virtual display | Full custom model/terrain regression suite and installed-browser matrix remain pending |
| WebKit | Focused support workflows on Linux | WebKit is not installed Safari acceptance |
| Mouse and keyboard | Native pointer/key input, picker, box selection, drawing controls and focus recovery | Consumer pages must supply their own feature list and application navigation |
| Touch | Chromium native touch dispatch for taps, handle movement, cancellation and two-finger navigation | Emulation is not a physical Android/iOS device test; pen is unclaimed |
| Narrow layouts | Starter at 390 CSS px; drawing uses a tool row and full-width inspector | Inspect consumer-specific surrounding layouts |
| Screen readers | Named controls and phase status regions; continuously changing coordinates are not live announcements | Manual VoiceOver/NVDA testing remains pending |

## Accessibility review

The library provides real buttons, selects, inputs, labels and visible focus for optional UI. Drawing uses an explicit Finish action on touch, labeled ring/segment fields and larger invisible handle hit areas under coarse pointers. Consumers own their feature-list UI and routes to features that are not visually distinguishable.

For each consumer, repeat this workflow with keyboard input and a screen reader:

1. Reach map navigation, picker and drawing controls with Tab. Confirm every field has a name and units and focused elements are visible.
2. Activate one action with Enter or Space. Confirm one state change. Continue using the keyboard after finish, cancel, rejection, a disabled action and a scenario switch.
3. Confirm empty, pending, rejected, conflict, forbidden and resource-error states are announced once when their phase changes. Continuous camera frames must not flood announcements.
4. Test 200% zoom, 390 CSS px width, dark/light mode and a coarse pointer. Check clipping, scroll access, focus contrast and 44 CSS px touch targets or their spacing.
5. Use VoiceOver with installed Safari and NVDA with installed Chrome or Firefox. Record device, versions, failures and exact input sequence.

Alt-left-drag can be intercepted by Linux window managers. Some Windows/Linux Firefox menus take focus when Alt is released. Ridgeline cancels interrupted gestures; these platform limits remain consumer integration considerations.

These checks establish specific interactions. They do not claim WCAG certification or complete screen-reader support.

## Physical hardware and installed browsers

This workspace has no physical GPU or touch device. Hardware performance and installed-browser acceptance remain outstanding. Use the existing repository measurement consumer to obtain comparable evidence:

```sh
pnpm measure:models --hardware --browser chrome --metadata machine.json --matrix
pnpm measure:models --hardware --browser firefox --metadata machine.json --matrix
pnpm measure:models --serve
```

Use the last command for installed Safari on a Mac. Hardware metadata identifies exact device, OS, GPU, driver/backend, browser/version and display refresh rate. The measurement runner rejects known software renderers and requires warmup and repeated foreground runs. The repository's `tools/model-measurement/README.md` defines workloads, frame/update targets, unavailable GPU-timer handling and raw report retention. A software smoke run cannot close target-hardware acceptance.

On actual Android and iOS devices, also perform drawing tap/drag, two-finger pan/zoom, cancellation, numeric hole editing and keyboard navigation. Keep failure traces and screenshots together with the source/archive hashes. Do not replace a failed device result with a passing engine-emulation result.
