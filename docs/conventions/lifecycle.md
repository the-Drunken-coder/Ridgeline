# Lifecycle standards

Read when changing ownership, callbacks, asynchronous work, deduplication, failure recovery, or shared caches. These rules apply to library behavior and development tooling. [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md) owns the common standards and topic selection.

## Ownership and callbacks

- Give listeners, observers, scheduled work, interaction leases, and GPU resources a clear owner and disposal path. Teardown must tolerate partial initialization and repeated calls.
- Guard asynchronous completion against destruction, replacement, and newer state. A stale render or terrain result must not overwrite current data.
- Establish reentrancy protection before invoking consumer callbacks that can reenter the operation. After successful returns and exceptions, verify that the owner and the state used to resolve the action are still current before continuing side effects.
- Isolate consumer callback failures so they cannot prevent cleanup or unrelated updates. Explain intentional error suppression where it occurs.

When reviewing changed callback behavior, attempt relevant histories through the existing interface: a callback reads state or refreshes permissions, replaces or destroys the owner, changes data, or starts camera movement before returning successfully. Verify both the abandoned action and the replacement's ability to proceed. Apply the [interaction standards](interactions.md) to actions derived from screen input.

## Failures and recovery

- Use the existing `RidgelineError` and diagnostic mechanisms for library failures, preserving operation context and causes. Honor documented recovery behavior; avoid silent fallback or unbounded automatic retry.
- Give consumer rejection and temporary permission failure separate state. Recovery from one failure restores any still-current feedback owned by another operation.
- When recovery changes the public phase or reason, invalidate cached snapshots and update attached controls within the documented refresh operation.
- Attempt cleanup for each independent owner even if another cleanup fails. Preserve the initiating failure and report cleanup failures separately. Use the owning resource's teardown API.

For overlapping failures, verify the sequence rather than one error in isolation. Relevant histories include rejected submit followed by permission failure and repair, or pending submit followed by permission failure, abort rejection, and repair. Public state and attached controls must agree after the documented recovery operation.

Shared-output tools must retain ownership while their writers can still be active. Follow the interruption and recovery contract in [CI validation](../ci-validation.md); uncertain descendant termination is not evidence that output can safely be replaced.

## Scheduling and shared caches

- Schedule rendering when data or the view changes. Keep idle interfaces idle and bound caches and repeated work.
- When skipping duplicate updates, account for other code that clears or replaces the destination state. Unchanged input alone does not prove that the destination is current.
- Verify that concurrent workflows can finish when their aggregate working set exceeds a shared cache's capacity. Retain useful progress without making the cache unbounded.
- Keep missing data distinct from a failed request so one local gap cannot disable valid recovery elsewhere.

For changed preparation or cache behavior, exercise competing workloads, completion, eviction, and valid recovery. Then apply the quiet-period guidance in [testing](testing.md). Cache size alone does not establish forward progress.
