# Collect the Mac acceptance evidence

Use this handoff when the user's Mac agent starts the deferred device checks.
The user has a Mac available and no desktop discrete-GPU fixture.
The Mac's chip and operating system remain unverified.
Return evidence for the checks you can execute and identify every unavailable requirement.

## Read the contracts and obtain the tested code

1. Read the repository `AGENTS.md`, `README.md`, `CODE_CONVENTIONS.md`, and applicable lifecycle, rendering, interaction, and testing standards.
2. Read the [consolidation closeout](closeout.md) for the delivered branch, tested runtime revision, local results, and remaining limits.
3. Fetch that branch and check out the exact tested runtime revision in a separate worktree. Record the actual exercised SHA and working-tree state.
4. Read the [approved model matrix](../entity-models/spec.md#acceptance-matrix), [measurement consumer](../../tools/model-measurement/README.md), and [support guide](../../docs/support.md).
5. Use the installed PStack benchmark-checklist skill before collecting or reporting performance measurements.

Keep requirements and runtime code unchanged during collection.
Preserve raw failures rather than fixing a defect inside an acceptance run.
Record any required repair separately and repeat affected checks at its actual new revision.
Keep the handoff and closeout from the delivered branch available after checkout.
Those execution documents were added after the tested runtime commit.

## Confirm the Mac fixture

Record the exact chip, GPU, macOS version, graphics backend, browser versions, and display refresh rate.
The approved fixture is an Apple M1 Pro.
If the Mac differs, collect clearly labeled supplemental evidence and leave the M1 Pro requirement open.

```sh
sw_vers
sysctl -n hw.model
sysctl -n machdep.cpu.brand_string
```

Use Node 24 and pnpm 11 for the reference run.
Install dependencies using `pnpm install --frozen-lockfile`.
Install the test engines using `pnpm exec playwright install chromium firefox webkit`.
Run `pnpm validate` before hardware collection.
Retain their outputs and setup failures with the exercised revision.
These repository checks remain separate from installed-browser and physical-GPU acceptance.
If a command is interrupted, preserve its output and follow the [CI validation recovery policy](../../docs/ci-validation.md) before another shared-output run.
Record an interrupted aggregate separately from any subsequently completed stages.

Write the actual machine and browser metadata using the schema in the measurement consumer's README.
Use one metadata file per installed browser and verify its browser field against the raw report.
Keep the browser foregrounded and the required canvas visible throughout each measurement.
Run one hardware collection command at a time.

## Measure Chrome and Firefox through automation

Run the existing consumer with the actual metadata files.

```sh
pnpm measure:models --hardware --browser chrome --metadata machine-chrome.json --matrix
pnpm measure:models --hardware --browser firefox --metadata machine-firefox.json --matrix
```

The Chrome command selects the installed Chrome channel.
The Firefox command launches Playwright-managed Firefox.
Identify that build explicitly in its metadata and retain its results separately from installed Firefox acceptance.
For separately installed Firefox, use `--serve` and the case-selection and JSON-download workflow described below.
Mark installed Firefox unavailable if the agent cannot collect that evidence.

Retain the full approved geometry, material, projection, pixel-ratio, and camera-motion matrix.
Use the configured warmup, repeated runs, and instrumentation comparisons.
Report original workloads, the icon baseline, and failed stress cases together.
Record unavailable GPU timing as unavailable.
Use the approved acceptance thresholds rather than choosing new limits from a convenient run.

## Measure installed Safari and other manual browsers

```sh
pnpm measure:models --serve
```

Open the printed URL in installed Safari.
Use the consumer's case selector, actual machine metadata, paired runs, and JSON download workflow.
Collect the required matrix through that workflow and retain its raw JSON and PNG snapshots.
Record actual Safari and macOS versions.
Playwright WebKit results remain separate engine evidence.
Repeat that workflow in separately installed Firefox when collecting its release-browser acceptance evidence.

If the agent cannot operate Safari or retain the required results, report that limitation.
Do not replace an unavailable Safari run with a different browser.

## Exercise model correctness in each installed browser

Follow the spec's [correctness checks](../entity-models/spec.md#correctness-checks) in installed Chrome, Firefox, and Safari.
Cover placement and precision, world copies, flat and globe views, representation switching, actual pointer and keyboard picking, resource lifetime, context recovery, and the full five-second settled observation.
Reuse the existing packaged consumer and model browser histories rather than creating another acceptance framework.
Record the browser selection, test configuration, input sequence, and observed output with each result.
The focused support suite does not cover the full model histories.
If the existing runner cannot reach a required installed-browser history, record that history as INCONCLUSIVE.

## Check Mac interactions and accessibility

Run `pnpm test:support` for the existing engine and input workflows.
Use the support guide's manual keyboard, focus, zoom, and VoiceOver sequence in installed Safari.
Record the actual input sequence, observed focus, announcements, failures, screenshots, and short recordings.
If VoiceOver output cannot be observed, mark that check unavailable.
The accessibility tree or named controls alone do not establish a VoiceOver pass.

The Mac run does not establish NVDA, physical touch-device, or desktop discrete-GPU acceptance.

## Return the results without closing the whole matrix

Report the following facts together.

- Exercised Git SHA, working-tree state, archive hash, and workload asset manifest.
- Actual machine, operating system, browser, renderer, canvas, and display settings.
- Commands, exit results, raw samples, missing observations, failure traces, screenshots, and recordings.
- Each approved requirement marked VERIFIED, NOT VERIFIED, or INCONCLUSIVE.
- Any code change needed before the evidence can establish acceptance.

Use the existing [evidence promotion workflow](../../docs/evidence-promotion.md) to retain selected durable findings.
The existing [#80](https://github.com/the-Drunken-coder/Ridgeline/issues/80) owns hardware measurements.
The existing [#91](https://github.com/the-Drunken-coder/Ridgeline/issues/91) owns the measured guideline, advisory, and production acceptance after #80.
Keep the desktop discrete-GPU requirements and any unavailable Mac requirements open.
This handoff authorizes test collection, not an implementation change, pull request, merge, or deployment.
