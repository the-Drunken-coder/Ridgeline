# Browser, input and accessibility checks

Ridgeline requires WebGL2. The support suite tests the packed production package in Playwright Chromium, Firefox and WebKit. Engine checks do not certify installed Chrome, Edge, Safari, mobile devices or physical GPUs. Repository verification records live in `.scratch/viewport-upgrades/closeout.md`; these local working records are not part of the installed package.

## Current approved follow-up results, 2026-10-12

All 81 support workflows passed, 27 each in Chromium, Firefox and WebKit, without failures, skips or retries. Current cases exercise real renderer-loss selection cancellation and recovery, request-only application selection, visible native/model label glyphs with selected feedback disabled, explicit style refresh and model brightening, basemap callback reentry, partial native control cleanup, keyboard basemap selection, invalid-area controls and composed direction-head visibility, and failed starter restoration followed by protected saves, Reset and explicit clearing.

The current uncommitted input digest is `91abf5465d9d319c5af473975da1321dcf626a7e7a8a670f531c610bb92c27b1` across 185 runtime, test and configuration inputs. Another 41 packaged Chromium regression cases passed for model publication/feedback/recovery, browser DPR 2, arrows, touch and drawing lifecycle. All 435 library/tooling tests and five control-lab tests passed. The independent review's callback-order finding was corrected and rereviewed. Both browser entry points now require the starter's own fresh installation/build and final archive inventory/file/heading links, with producer tests proving their failure paths. Hardware, installed-browser and manual screen-reader limits remain below.

## Historical handoff results, 2026-10-11

All 51 focused support cases passed, 17 each in Chromium, Firefox and WebKit, without failures, skips or retries. They verify selected native/model label priority with collision suppression, saved drawing appearance, per-field feedback, map-aligned icons, directed segment and snap feedback, native control lifecycle, external/failed basemap synchronization, and starter storage restore and rejected-save recovery. Their uncommitted input digest is `1305996ef45c4058170fd5543fb2e93576c2c5c17cca1d81b21e623b6b9cd310`.

A final adjustment moved the active segment arrow behind its endpoint handle. Only the two drawing-arrow implementation files changed; all nine relevant drawing/inspector support cases then passed across the three engines at handoff digest `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`. Fifty additional packaged Chromium rendering cases passed at that digest, covering models, airborne features, physical attachments, touch input, moving selection and existing arrows. The starter also passed a fresh install and its own TypeScript/Vite production build using the final runtime archive. These checks retain the environment and hardware limits below.

## Historical local results, 2026-10-11

These results predate the starter storage/rejection follow-up and do not verify that change. Recorded on Ubuntu 24.04.5 with Node 24.21.0, pnpm 11.0.9 and Playwright 1.63.0. After removal of the motion/replay scope, all 33 focused support cases passed, 11 per engine. The starter saved and reopened exact segment edits, retained native keyboard focus and fit at 390 CSS px. Three additional packaged Chromium cases passed for consumer-driven incremental updates, moving picker stability and native touch dispatch. Input digest: `50853a463fee75ff3edc4a75d7332ba42388a588c263b0893256a7253977d46e`. Earlier 42-case support and nine-case replay captures remain historical evidence for their own inputs; their replay journeys describe the withdrawn implementation.

| Engine | Reported version | Reported WebGL renderer |
| --- | --- | --- |
| Chromium | 153.0.8010.12 | ANGLE Vulkan SwiftShader Device, software rendering |
| Firefox | 155.0 | Mesa `llvmpipe, or similar` |
| WebKit | 26.6 | `Apple GPU`, a reported string from the Linux Playwright build |

The WebKit renderer string and Safari-like user agent do not establish Apple hardware or installed Safari support. The host has no `/dev/dri` device. Exact environment output and the producing JSON report are retained in the closeout evidence.

The earlier broad Chromium run passed 198 of 199 cases. Its old inspector test expected Stroke immediately after Label; the new segment fields changed that order. The corrected native keyboard and first Finish-click case then passed in Chromium, Firefox and WebKit. Native Chromium touch dispatch passed placement, handle movement, cancellation, permission loss and two-finger navigation. No physical phone or pen was tested.

## Repeat the browser checks

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:support
```

The focused suite exercises current selection, configured presentation, drawing holes and exact segments, edge snapping, controls, lifecycle cleanup and the starter's keyboard, storage restore and save rejection journeys. Full rendering and regression coverage remains in `pnpm test:browser`. Both commands build and install a fresh local archive before running. They share an artifact lock, so run them sequentially.

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
