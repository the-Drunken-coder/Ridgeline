# Browser, input and accessibility checks

Ridgeline requires WebGL2. The support suite tests the packed production package in Playwright Chromium, Firefox and WebKit. Engine checks do not certify installed Chrome, Edge, Safari, mobile devices or physical GPUs. Verification evidence is linked below; working records are not included in the installed package.

## Revision-specific evidence

The five integration PRs merged on October 14 and 15, 2026. Their descriptions retain the reviewed bases, heads, commands, hosted results, and historical provider-gate records: [controls #114](https://github.com/the-Drunken-coder/Ridgeline/pull/114), [appearance #115](https://github.com/the-Drunken-coder/Ridgeline/pull/115), [selection #116](https://github.com/the-Drunken-coder/Ridgeline/pull/116), [drawing #117](https://github.com/the-Drunken-coder/Ridgeline/pull/117), and [starter #118](https://github.com/the-Drunken-coder/Ridgeline/pull/118). Historical digest-based results from October 11 and 12 remain in the [versioned closeout](https://github.com/the-Drunken-coder/Ridgeline/blob/a646c3a67bbf9dc1344e03a24fc55c3674616d4c/.scratch/viewport-upgrades/closeout.md). They do not verify a later revision.

On 2026-10-18, all local validation stages passed at [89a6885](https://github.com/the-Drunken-coder/Ridgeline/commit/89a68852e890a1f859302dc8ff69ec3935afe890) on Linux x64 with Node 24.21.0, pnpm 11.0.9, and Playwright 1.63.0. The aggregate command received SIGTERM during the playground suite. Completed checks were retained, and the entire playground suite and later stages passed in a sequential rerun at that unchanged revision. This is software-rendering evidence from completed stages, not a completed post-change aggregate run.

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

On 2026-10-21, the user waived further Mac and desktop-GPU acceptance as disproportionate to this project. The remaining target-hardware and installed-browser matrix is **WAIVED / NOT PERFORMED** and no longer blocks consolidation or model readiness. It is never a passed check. No hardware collection or user testing is required by this waiver.

Earlier partial Mac attempts and their reported failures remain historical evidence. The waiver does not repair those failures or certify installed Safari, release Firefox, physical GPUs, frame-rate targets, or a model-capacity limit. No measured triangle guideline or cost advisory was produced. Required hosted module tests and available software browser/measurement verification remain in place.

The repository's `tools/model-measurement/README.md` retains the optional measurement tooling. Separate manual accessibility and physical-touch coverage remain unverified and are not established by software checks or this waiver.

On actual Android and iOS devices, also perform drawing tap/drag, two-finger pan/zoom, cancellation, numeric hole editing and keyboard navigation. Keep failure traces and screenshots together with the source/archive hashes. Do not replace a failed device result with a passing engine-emulation result.
