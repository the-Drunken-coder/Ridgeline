# Regression evidence

Priority: high. Classification: judgment rule and behavioral coverage.

Suggested home: the existing Tests and verification section in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md).

## Require the test to reach its claimed condition

Proposed addition:

> Make required test preconditions explicit and unconditional. Deliver controlled late results after the lifecycle transition being tested and before asserting their effects. Keep the observation target available for the required interval. Assert the outputs needed to establish the changed contract, including each independently rendered part. A passing branch that never reached the trigger is incomplete evidence.

Three different reviews exposed this problem:

- [PR #23's review summary](https://github.com/the-Drunken-coder/Ridgeline/pull/23#pullrequestreview-5343126799) found that a late-completion test resolved preparation only during final cleanup. The assertion ran before the claimed completion.
- [PR #24's review summary](https://github.com/the-Drunken-coder/Ridgeline/pull/24#pullrequestreview-5343186913) found that an arrow-cancellation test checked the draft shaft but could miss a retained arrowhead.
- [PR #31's inline finding](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127675574) found a renderer assertion guarded by a feature lookup that never succeeded. The [author's response](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127706155) reports moving the camera, waiting for the source feature, and making the assertion unconditional.

Inspection at the baseline confirms the first two gaps in the current bodies of [tests/browser.ts](../../tests/browser.ts). The plain-camera test still releases held preparation in `finally`, after its late-restoration assertion. The arrow journey verifies removal of the draft shaft after cancellation without a corresponding assertion that the draft head is absent. These are test gaps; this retrospective did not reproduce a production failure.

Existing rules already require observable results and faithful doubles. This addition tells the reviewer to establish that the supposedly observed event actually occurred. It does not require tests to inspect private implementation sequences.

## Separate readiness from continued absence

Proposed addition:

> A readiness check may finish when its required result appears. A guarantee that stale output or unwanted work stays absent must observe the complete bounded interval after the relevant trigger. Choose the trigger and interval from the failure mechanism being tested.

[PR #92's review summary](https://github.com/the-Drunken-coder/Ridgeline/pull/92#pullrequestreview-5409957544) suggested replacing a delay in a repeated negative pixel assertion. The [author's response](https://github.com/the-Drunken-coder/Ridgeline/pull/92#issuecomment-5989200156) explains that the test observes a cancelled result for five seconds, including its delayed delivery. Exiting on the first acceptable frame would miss a later overwrite.

The existing idle/recovery convention covers quiet periods. This clarification also covers stale output that appears after an initially correct frame. PR #102 already proposes observation helpers, so reuse those once adopted rather than introducing another helper.

## What would count as adoption

Reviewers can describe the setup, trigger, and observed result for each changed regression. For the identified tests, a follow-up should release the deferred preparation before its late-effect assertion and verify both draft shaft and head removal through renderer output. A demonstrated failure should fail before its fix when practical. Existing packaged-consumer tests remain the verification boundary.
