# Native lifecycle review

The reviewed baseline is `482d16433a91f6cdf7dc67d57a3763d84d59abce`.
The reviewed source was subsequently committed at `89a68852e890a1f859302dc8ff69ec3935afe890`.
The parent compared both runtime files with their reviewed SHA-256 values before starting final validation.

## Design and code judgments

| Role | Model | Result |
| --- | --- | --- |
| Design candidate | codex/gpt-6.1-sol | Selected fixed lazy callback and two-operation interface |
| Design candidate | claudeAgent/claude-opus-5-5 | Grafted the optional pending callback and omitted extra states |
| Independent design judge | grok/grok-4.7 | Selected the Codex base and rejected the short-circuit cleanup call |
| Implementation | codex/gpt-6.1-sol | Implemented only the two assigned source files |
| Comment review | codex/gpt-6.1-sol | No deletions or actionable suppressions |
| Independent correctness review | claudeAgent/claude-opus-5-5 | No actionable findings, static review only |
| Decision-trail audit, round 1 | claudeAgent/claude-opus-5-5 | Required recovery-detail and bounded-session corrections |
| Decision-trail audit, round 2 | claudeAgent/claude-opus-5-5 | Required per-case retention and coverage corrections |
| Decision-trail audit, round 3 | claudeAgent/claude-opus-5-5 | Corrections verified against the runner, no material flags |
| Integration, verification, and evidence | codex/gpt-6.1-sol | In-thread parent retained ownership of the root checkout and sequential browser output |

The selected call always requests native removal before applying first-error precedence.
The helper owns both native hooks, render depth, pending removal, and restoration.
The viewport retains logical destruction, listener order, independent owner cleanup, and reporting.
No public export, default, renderer dependency, or model and picking owner changed.

The comment reviewer verified the MapLibre 6.11.0 resource-lifetime constraint against the installed native implementation.
There were zero deleted comments, restored comments, reruns, suppression fixes, encoding offers, or open constraint flags.
The two retained comment lines explain why native removal waits for rendering to finish.

## Verification limits

The code reviewer read the actual remount, callback destruction, first-error, context-phase, initialization, and nested drawing-destruction histories.
The parent subsequently ran the existing packaged histories and the final validation command.
Only completed commands establish runtime results. The static verdict establishes no browser or hardware pass.

Nested native rendering above depth one and cleanup faults during active native rendering remain inspection-only histories.
Their code paths preserve the prior choreography.
No private-hook mock or source-text assertion was added.

The raw archive retains the original design judgment and individual review reports.
It also retains the worker's initial missing-tsx setup failure and subsequent checks.
The parent independently reran type checking, the 21 scene and layer module tests, and 19 focused packaged cases.
The later aggregate was interrupted during the playground suite after its module, 257 packaged, and 144 support cases passed.
The complete playground suite and all later original validation stages then passed sequentially at unchanged source.
The aggregate remains explicitly interrupted.
The documentation follow-up passed its fresh package and remount check, with all 60 built files identical to the tested runtime.

## Principles that changed the implementation

- Model the Domain moved native hook state into one per-map owner.
- Laziness Protocol removed redundant retirement and removal statuses and rejected a class.
- Minimize Reader Load kept viewport event and error policy visible at its existing call sites.
- Type System Discipline kept concrete MapLibre hook types and an inferred internal interface.
- Sequence Work into Verifiable Units kept the root baseline unchanged before integration and separated documentation from source commits.
- Prove It Works required real packaged consumer histories and retained unavailable hardware as unverified.

## Decision-trail audit corrections

Claude Opus 5.5 independently audited the decision trail and Mac handoff.
The first round accepted the validation-stage disposition and required a more precise recovery record and bounded Mac command sessions.
The parent retained the failed process scan and corrected scan, labeling the disappeared process's identity as an inference.
The observation window does not establish a command timeout or the source of SIGTERM.

The second round found that per-case measurement sessions would expose earlier reports to the runner's keep-three cleanup.
The handoff now requires pinning each exact printed run directory before the next invocation.
It also records full coverage across per-case indexes, each correctly marked `completeMatrix: false`.
No warmup, repetition, workload, or acceptance requirement changed.
The Mac fixture commands now inspect actual GPU and display settings without assuming a refresh rate.
The support commit link remains a publication check rather than a claimed verified remote URL.

The original reports remain in the raw archive, including corrected or superseded claims.
These documentation corrections changed no source, package input, or completed runtime result.
The third independent round verified the final pinning, coverage, and timing corrections against the runner.
It found no remaining material flags and ran no suites or Mac commands.
The optional clarification that failed cases are automatically pinned was accepted.
Hardware and installed-browser acceptance remain open independently of this static verdict.
