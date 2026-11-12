# Starter and packaged guide corrections

Spec: [Viewport upgrades](../spec.md)
Status: resolved, local working ticket
Blocked by: none
Acceptance depends on: satisfied by root integrated verification and package inclusion
Integration owner: root, [closeout](../closeout.md)
Scope: `examples/starter/**`, `tests/packaged/starter.spec.ts`, `docs/support.md`. Request package/harness/shared guide edits from root.

## Acceptance criteria

- Starter instructions cover fresh installation, prerequisites, its own build and copied-outside-repository dependency path.
- A small consumer-owned storage flow saves and restores complete drawing metadata and demonstrates a recoverable rejected submission.
- The starter's actual installation and production build pass using its own configuration, not the generated consumer harness configuration.
- Packaged guide links and support claims accurately reflect shipped content and tested environments.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Storage is restored | Starter application | Complete features and drawing shapes are restored through viewport APIs | Starter packaged workflow |
| Save is rejected then retried | Starter application | Accepted state stays unchanged; draft is retained and retry succeeds | Starter packaged workflow |

## Closeout evidence, 2026-10-11

All changes remain uncommitted and unpublished. Root reviewed and verified handoff digest `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`; the [shared closeout](../closeout.md) records exact commands, prior pins and environment limits.

| Acceptance criterion | Evidence |
| --- | --- |
| Fresh prerequisites, own build and copied recipe | Updated starter instructions and fresh standalone install/build |
| Consumer storage restore and rejection/retry | Three-engine starter storage/metadata workflow |
| Actual standalone build | Own TypeScript/Vite configuration passes, installed JS/declarations byte-identical to tested tarball |
| Shipped guides/support claims | Explicit package inclusion and final archive link checks; current/historical claims separated |
