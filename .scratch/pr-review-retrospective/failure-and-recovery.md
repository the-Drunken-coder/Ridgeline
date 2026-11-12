# Failure and recovery

Priority: high. Classification: narrow clarifications to existing ownership and recovery rules.

Suggested home: Ownership, asynchronous work, and errors in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md). Drawing-specific histories can be disclosed through a drawing review reference if adopted.

## Preserve independently owned failure state

Proposed addition:

> Give consumer rejection and temporary permission failure separate state. Recovery from one failure restores any still-current feedback owned by another operation. When recovery changes the public phase or reason, invalidate cached snapshots and update attached controls within the documented refresh operation.

Three accepted findings on PR #69 distinguish these cases:

| Sequence | Failure found | Historical response |
| --- | --- | --- |
| Read state, then repair delete permission | [Cached public state kept the old rejection](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171752603) | [One-refresh recovery and controls checks](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171805276) |
| Rejected submit, then throwing delete check, then repair | [Repair lost the original consumer rejection](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171775676) | [Separate feedback state and regression](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171805304) |
| Pending submit, then permission failure, then abort rejection | [Abort error replaced permission-failure feedback](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171819183) | [Abort-aware create/update/delete coverage](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171852127) |

The current convention preserves causes and recovery behavior. This addition addresses overlapping failures and public snapshot invalidation. These findings were fixed historically; the proposed wording prevents the same bookkeeping mistake in another workflow.

## Protect successful callback returns as well as exceptions

Suggested replacement for the existing callback-ownership bullet:

> Establish reentrancy protection before invoking consumer callbacks that can reenter the operation. After successful returns and exceptions, verify that the owner and the state used to resolve the action are still current before continuing side effects. Invalidate screen-derived work when relevant camera movement begins.

PR #69 found [a guard installed after callback invocation](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171752594), [camera animation invalidating a resolved target too late](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171752599), and [a successful permission callback changing candidate data before mutation](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171775677). The [guard response](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171805194) and [successful-callback response](https://github.com/the-Drunken-coder/Ridgeline/pull/69#discussion_r4171805382) report reproductions and fixes.

This sharpens an existing rule rather than adding a second general callback rule. PR #102 already proposes an entity review reference. Keep drawing examples separate from that pending entity-specific guidance.

## Require progress under shared-cache pressure

Proposed addition:

> Verify that concurrent workflows can finish when their aggregate working set exceeds a shared cache's capacity. Retain useful progress without making the cache unbounded. Keep missing data distinct from a failed request so one local gap cannot disable valid recovery elsewhere.

[PR #31's cache finding](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127424447) showed several cameras evicting each other's partial work. The [fix response](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127647657) reports retaining sampled progress while keeping the tile cache bounded. A [second finding](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127424456) treated a nodata pixel as a failed tile request; the [response](https://github.com/the-Drunken-coder/Ridgeline/pull/31#discussion_r4127647793) verifies valid data reload after eviction.

Current rules bound caches and require eventual quiet. The missing condition is forward progress across competing consumers. Verification should exercise multiple separated workloads whose combined demand exceeds the cache, assert that all finish, and then use the existing quiet-period rule.
