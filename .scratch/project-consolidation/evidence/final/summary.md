# Local consolidation evidence

The [closeout](../../closeout.md) records the implementation, exact inputs, review, and remaining limits.
The [Mac handoff](../../mac-acceptance.md) covers deferred device collection.

## Verification at fixed source

- Full baseline `pnpm validate` passed at `482d16433a91f6cdf7dc67d57a3763d84d59abce`.
- The reviewed runtime is `89a68852e890a1f859302dc8ff69ec3935afe890`.
- Its aggregate command received SIGTERM with exit 143 during playground testing. The source of termination is unconfirmed.
- Completed type, module, packaged-browser, and support stages were retained. The complete playground suite and every later original stage passed sequentially at unchanged source.
- Post-change coverage is 498 Node tests, five control-lab state tests, 257 packaged cases, 144 support cases, six playground cases, five control-lab browser cases, both application builds, and seven measurement verification tests.
- No completed post-change aggregate command is claimed.
- Documentation follow-up `358bb9a172c67a17fffe97f7a94cb36a4fb35788` passed fresh consumer and starter builds, archive inventory and links, and one remount case.
- All 60 built files under `dist/` match the tested runtime archive byte for byte.

The runtime package SHA-256 is `6497e6016c4a0d1b25cc7f843a38464c0f1138045be0668e3c42f1f4912a208e`.
The documentation package SHA-256 is `2b63d5e739986a48eae8460ccbbd2417ed2c389801a961bd56fbbf55c580bb6f`.

## Interpret the retained reports

The raw archive retains original logs, command contexts, package archives, source hashes, individual reviews, the decision-trail snapshot, and the interrupted run with its partial traces.
The worker initially lacked tsx. Its failed setup attempt and successful rerun remain in the command timeline.
The model idle test deliberately detects work during delayed publication, then verifies complete settled quiet intervals with observation enabled and disabled.
Its expected negative and stopped observations are not suite failures.

| Idle observation | Result | Render count | Observed milliseconds |
| --- | --- | --- | --- |
| Controlled terrain publication during quiet interval | failed | 2 | 5001 |
| Settled stationary recovery with observation enabled | quiet | 0 | 5001 |
| Settled stationary recovery with observation disabled | quiet | 0 | 5000 |
| Observation disposed by viewport destruction | stopped | 0 | 5001 |

## Limits

- The Mac chip and installed-browser acceptance remain unverified. Only a Mac agent is available later.
- The desktop discrete-GPU fixture is unavailable. Issues #80 and #91 remain open.
- Installed Firefox evidence is separate from Playwright-managed Firefox; WebKit does not establish installed Safari acceptance.
- Physical touch and manual VoiceOver and NVDA remain unverified.
- The historical sensor approval gap remains explicit. Current public defaults were preserved.
- Nested native rendering and cleanup faults during active rendering remain inspection-only histories.
- No PR or hosted validation workflow was requested or used as evidence.
