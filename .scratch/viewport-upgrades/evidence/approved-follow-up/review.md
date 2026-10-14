# Independent review of the approved follow-up

Recorded 2026-10-12. Checkout: `/home/ubuntu/.t3/worktrees/Ridgeline/t3-11b20903`. Comparison base and HEAD are both `cbef055b14fe218aa24611031c4ba1a9aa0ed540`; all follow-up inputs are uncommitted. This review covers the approved October 12 mechanisms and their relevant owners. It does not claim a new full review of the earlier competitor-upgrade diff.

No open confirmed implementation finding remains in the reviewed snapshot. One callback-order finding was identified by inspection and corrected by root during this review. Browser acceptance, production builds, package preparation, the tooling gate's positive/negative executions, and final integration verification remain with root.

## Finding and disposition

### F1. Elevation preparation abort callbacks could skip the requested basemap

Classification: medium, supported by inspection. No browser reproduction was executed by this reviewer.

The initial `src/viewport.ts` SHA-256 was `7e445ed5596acb0e066d907262063a30788650a34ab0a4ef5c4c7688cc6dbc19`. Its configure path accepted the requested configuration, retired native publication, and called `entities.configure` before `map.setStyle`. The concrete public history was:

1. Mount a ready viewport on style First with a consumer `elevationSampler.prepare` operation still pending.
2. Register an AbortSignal listener on that preparation which calls `viewport.configure` with an unrelated visibility patch.
3. Call `viewport.configure` with style Second and an explicit elevation provider.
4. `EntityScene.configure` calls `Elevation.reset`; its consumer-sampler branch calls `restart`, which synchronously aborts retired preparation.
5. The abort listener accepts a new configuration identity containing style Second. Its unrelated patch sees native preparation already retired and starts no style change.
6. The outer configuration identity guard returns before initiating style Second. Accepted configuration can therefore report Second while the native map remains on First.

This violates the callback/currentness rules in [Lifecycle](../../../../docs/conventions/lifecycle.md#ownership-and-callbacks) and the accepted/native coherence requirement in the approved controls spec at `.scratch/map-controls-coordinates/spec.md`, Implementation Decisions. It is part of the approved correctness follow-up, not a proposed new API.

Root first moved entity configuration after native work. Review of intermediate viewport SHA `a58beb1251eacc3f5f3d37f77678a58ea3b38b412cc5daaa18a4106d1e3b6687` found a related ownership gap. MapLibre 6.11.0 synchronously emits style loading from `Style.loadJSON`. An unrelated patch from that native observer could change configuration identity and skip the outer required elevation reset. A simple move with the old overall identity guard was therefore incomplete.

Final reviewed viewport SHA `6dd5096f157bb91a7ad625e5041073fe76a5d31e9e2ff275699be5ea94aec43c` starts native work first and retains required elevation reset in viewport-owned pending state. It consumes that state before invoking entity callbacks, uses current configuration, keeps destruction checks, and guards outer configuration notifications by current identity. Scene listeners retire current screen-derived work, so an unrelated nested patch no longer skips that retirement. This closes both inspected sequences.

The registered packed case `Feature presentation basemap changes survive elevation preparation abort callbacks` unconditionally reaches a real pending prepare call and loops over abort-listener and native-style-loading reentry. It requires the held signal to abort, the unrelated patch to survive, style Second's identifying native layer and Ridgeline layers to load, and later camera input to remain usable. This is appropriate coverage on inspection. Its execution result was unknown when this report was written.

Disposition: addressed by inspection in the final reviewed snapshot. Runtime verification remains with root.

## Other histories traced

| Approved behavior | Review result |
| --- | --- |
| Renderer loss during an acquired rectangle | Context loss notifies scene listeners, invalidates the rectangle, clears feedback/capture/ownership and preserves accepted selection. The packed case uses real loss/restoration and physical release. Request-only selection has a separate applying-filter history. |
| Explicit style refresh | Uses current store snapshots and re-resolves native inputs after entity work. Publication and entity revision checks discard callback replacements/removals. No datachange or drawing-conflict event is emitted. Existing failure handling retains working presentation and permits unrelated updates. |
| Disabled selected/hover appearance and zero model brightness | Validation snapshots the new values. Native expressions and custom-model/airborne resolution agree on disabled selected state suppressing hover. Nullish precedence retains explicit zero brightness. Label priority uses selected identity independently. |
| Visible selected labels | Packed native/model histories require collision-query identities and distinguishable glyph pixels for selection, continued suppression, reload and deselection. This review does not claim their browser execution passed. |
| Invalid polygon area | Controls validate measured preview topology and withhold area while the session retains raw calculations. Session checks preserve negative area, blocked acceptance, editability and undo recovery. Composed direction evidence keeps the real endpoint handle and includes a deliberate hidden-head control. |
| Partial native controls and equivalent choices | The currently adding control is removed through public native removal even before registration. Independent cleanup continues and the initiating failure is preserved. Selected equivalent-style identity is local state retained while accepted style remains equivalent. |
| Failed starter restore, Reset and clearing | Complete batch validation precedes acceptance. Failed restore blocks writes, Reset/remount repeats restore, and explicit clearing alone releases protection while retaining the active draft. Clear failure leaves protection active. |
| Mandatory consumer stages | The existing browser owner now requires generated-consumer install/build, standalone starter install/build using its own configuration, and final archive inventory/file/heading-link checking. Negative tooling histories exercise actual isolated TypeScript/Vite and archive boundaries. No shared builds were started by this reviewer. |

No conflict with ADR-0001, ADR-0002 or ADR-0003 was found in these mechanisms. Mouse-only rectangle creation, conservative query approximations, raw invalid measurement APIs, selected-label collision suppression, general shape holes, and consumer-owned storage remain within their approved boundaries.

## Executed checks and limits

Executed by this reviewer:

```sh
node --import tsx --test tests/feature-style.test.ts tests/entity-scene.test.ts tests/drawing.test.ts tests/drawing-shapes.test.ts
```

Result: 121 passed, zero failed, skipped or cancelled. The tested module files and their relevant styling/entity/drawing dependencies retained their recorded hashes through the review. This execution establishes the module behaviors reached by those tests. It does not establish native input, final pixels, browser cleanup, package installation or archive validation.

No browser, build, pack, hosted check, publishing, Git mutation or outward message was performed by this reviewer. Root owns all shared browser/package artifacts. Physical devices, installed-browser acceptance, target hardware performance, screen readers and long-session memory remain outside this review's execution evidence. No merge-readiness claim is made.

## Changes during review

The following initially pinned inputs changed while root diagnosed fixtures and applied the finding. Their relevant deltas were reread:

```text
6dd5096f157bb91a7ad625e5041073fe76a5d31e9e2ff275699be5ea94aec43c  src/viewport.ts
6dff8866d9f4f3f0e6986412d8aa924bd9fd3c268a73f303a3677e24e1882ea3  tests/workflow-selection.browser.ts
66fb901a2f35005de166d8cd8b33dec55e5ffe1ab2f348bf173f79154421a9f0  tests/workflow-drawing.browser.ts
7546d3e097414dd4d10a7089965ed04753bb4f29ca859f240060ce54d45e4f14  tests/packaged/starter.spec.ts
```

The browser-case manifest was also read after addition of the new elevation reentry case. The source pins below define the reviewed snapshot. Any later change needs review and checks appropriate to its behavior. Root records final integrated pins and browser outcomes separately.

## Reviewed file SHA-256 pins

These pins cover the relevant source/test files, owners followed outside the patch, standards/spec/public contracts explicitly read, and installed native implementation followed for synchronous style/control behavior. They do not imply exhaustive line-by-line review of unrelated behavior in each file.

```text
6dd5096f157bb91a7ad625e5041073fe76a5d31e9e2ff275699be5ea94aec43c  src/viewport.ts
de8b67a0df9e47612932c9459a96478695909bce97279a473142e33642b58ea5  src/types.ts
7a603cc7a1421c53b3967b4518b27550710dbd7eb90d244d34819b10c044c6ca  src/feature-style.ts
a18156b31779aaf2c8013a00d1151802733885772de53c7bfd6d949df8542525  src/entities.ts
71eec00383fdf9d85e7c402602241e5aeaab15d531537e939e36d24b73e16206  src/model-renderer.ts
6d1ff5913c55d1d2c6fa180d83a4ecad0376f27ebf7646ebb80b67596c9a3748  src/model-presentation.ts
f7d7bc90ba8bf266eb84b2b3efe48ea129f08f706b872de654b2ad46261a1ac5  src/model-feedback-layer.ts
b87aa61e657a419a9eeda938529daaf3bf66534b9a2091edfe6ce045b0490874  src/entity-layer.ts
7d8175b79b2ce62185a4228fb65e9bd309c86992db6fe0f6144aee0fd6261f7a  src/model-labels.ts
cc48f66d8a473b1a1ebf7fb12f3130326c49ffa8a382267a00c81acf5a0e9032  src/controls.ts
c1adbdb36da4981ff531ba8f5d1149493fea5040e55809b30882827ae0d4d517  src/drawing-controls.ts
80598a41126a2f0b5bb6f7e2a8e58b3cf9aa823eff546c150b6a60bc08563b41  src/box-selection.ts
99eef0a215e5a7150515d4eecbdac1256dabb8d8c6f9594d2521bd7f079be66a  src/interactions.ts
01386dc6efef889988aa05c818ec1df06fc001d945437fad24a565f112bd8e8f  src/drawing.ts
467b0d4d639f9187d954a09694b239d1a27797485f07ef294255ec50ec60fbfc  examples/starter/drawing.ts
48ef116bffea4e1189443bf7966ae0477816da6f772852491c22ed0cae60d7b7  examples/starter/main.ts
e4546bcca415eed3dc436e196720a320303d58408e692b16322c3546e4e97010  scripts/prepare-consumer.mjs
f6fb38e92c6a3ff85b25df1eb0d9f631c4eb562221f25a6c5086e8d85329342f  scripts/validate-consumer.mjs
f383acf7c4183aecb40348b4356edab24b27c8ce758f62f37a6bca2effd550c2  scripts/check-package.mjs
53b60c8a97700f04ed439e75999a4b0aae083ab4c3f8a030658b766d205dc1d2  scripts/consumer-validation.test.mjs
d74ceda22652a58173f8e24761ad062b0fb7addf0370ba6dcc52c172c98fbd52  scripts/test-browser.mjs
93143cf34270edb9456d8366f001ba6fae7d6ec69efe7c81f9454f1c0fc0d708  tests/workflow-controls.browser.ts
6dff8866d9f4f3f0e6986412d8aa924bd9fd3c268a73f303a3677e24e1882ea3  tests/workflow-selection.browser.ts
66fb901a2f35005de166d8cd8b33dec55e5ffe1ab2f348bf173f79154421a9f0  tests/workflow-drawing.browser.ts
6796dfe3d43a5119afaca998fa32bc50c577468dd37f1142a7756e3c5b318353  tests/model-presentation.browser.ts
a652959ccadf211cb2cad37d9b6b5d41c477096a1bdc60be92b95c34ee8eb6e4  tests/feature-style.test.ts
7c3f375df8853173e8d08ef0678e4db4e351a0b5e0636a14c405f5d2c0d87227  tests/entity-scene.test.ts
98543255c9e1f4f849ded06bee324b45cad4c57bed07ca56a6c2a1cd92063df6  tests/drawing.test.ts
7546d3e097414dd4d10a7089965ed04753bb4f29ca859f240060ce54d45e4f14  tests/packaged/starter.spec.ts
2b64022d76e8e421ed50ec1ec49155f93659aef0a195a402b49c68adb59edd68  tests/packaged/browser.spec.ts
982bbaa42b6c8c3c124962a9ad992a676e2fce80f9afafbe740a9c4bf3285d3d  tests/browser-cases.ts
44da85ba4e01bbdcb33eab4bcd055245dc750b5e00f275d13ef76d485063c81c  tests/browser-observation.ts
548bbc5efed9bfbe0b781ae0724cf190013d1d0ad0db9a4a714e8f692e0ff6ac  src/features.ts
e47117f4f3d667e74e3fe7dc97436f0daf4ca63b0166af6d3ee9d150216f5854  src/feature-publication.ts
e3b57ae74c07d6246de1e321ec139e949ee7b6fc4079f8881fc0838d260a5ae4  src/elevation.ts
ff548f2b01cc2c81dc34866949e0d0df4020a83233f5fd3b6433d1548a5eec0c  src/sensor-camera-coverage.ts
198cb08fcfab379b7b5f636987ece719a867562469a366b4649da531501d258f  src/entity-computation.ts
a129987fd9a3382ac0fba0e21c8bf2b18a70c39f92a7cc2299bde2dd0aef80b2  src/drawing-shapes.ts
d1fd46d82783b77c0c5a06b0253a2575e15fea00ba65b10770053fdc3a58820c  tests/drawing-shapes.test.ts
d4fdc66c895dfe7cde805fdbe09ab1bb8a0ca9389201a85c9becb995d2764f71  CODE_CONVENTIONS.md
7aff36d4c58d8632ebc301d115d538293931870e4c95d0e61895c8f40ee410a7  docs/conventions/lifecycle.md
024d39ef6d7c0dad267fbe6d155706752243cbb38ba538cc55e69e986a414af9  docs/conventions/rendering.md
c43c4c1d017eedd11ff1a57a947aa01c03a7d23a43587329f0a9d19412b69ff5  docs/conventions/interactions.md
849451de57716b2c002771aafdd47511b40863ac4adb8fb04d8f51b3cd260a40  docs/conventions/testing.md
a31442bae383efbc230384faef590d902e47ebcca4be785c9e94d5903c52ff3d  docs/agents/entity-review.md
dfcc8aab9dc0bd6d40b3583b5f66b574f851de205cc10035b81a9bb835312f77  docs/agents/review.md
86a66ce5108935a9170a644b5b6d70243a0e80756899ce0a62a6f1b37b69579e  docs/agents/issue-tracker.md
f0bc6abc0f0a04e343f14fc2563a6cc4a24976f1c0a34f69c8a4061e1f4a6e9d  GLOSSARY.md
5935ccbf3198f30e72e3a1780cf4e3413124e152ee5e86468fc7a9e1e958751a  docs/adr/0001-consumer-owned-workflows.md
22bbf3f2ccb0ad353a4c4de9672d8f9392bc6178f03e1886c362a3dddc112837  docs/adr/0002-maplibre-extension-access.md
45d244c4e83dfd85cbabaf6b02d19584af7d1740d08c3899ac1f082262f8b882  docs/adr/0003-preserve-drawing-shape-definitions.md
a8dd68b5918f384ec77f3f0c24eef63680de41087e1ae3c2d41701622c6ec466  README.md
c4b409b72aea2d9a061138740ebab9fdffb1069227c6ecdc5fa5516861233c0c  docs/viewport-tools.md
1f7b9175054b3a5b8df5c8e4bdf7dc1121b3425732ae3293f89913c74470d9ba  docs/support.md
0e77d302cb218bcc80c53505df447abd30c5576a7d674e5f9ad3dbad3aeaea33  examples/starter/README.md
ef642fb0190daf9789601f7031596321182ae24d4724145c057b5667153b7860  examples/starter/package.json
32b730a7f01a17f81bb07065efaf4cd3ebd310de008e5e58fcc6c2b1f4957649  examples/starter/tsconfig.json
279c6e199cd89c24677dc39c616ce0b68627cc387b77ca136b7eecb3cdbb9429  .scratch/viewport-upgrades/spec.md
ca03f99d9fa1ad0e350c6880eb0367495da09b78cb12d6e05a339dd6140d5ade  .scratch/viewport-upgrades/multi-selection-spec.md
e1d753374adf9ff96cfe74d3c333fd9b1887c2cfc72415b3d61d7bf547834522  .scratch/viewport-upgrades/drawing-spec.md
e37a1288cd57b1563895fb13344f0e730e1b922f72b058983b5bfa85e2ca5c00  .scratch/viewport-upgrades/feature-presentation-spec.md
ea9412222187237420a9e5da241f3db948e0bb1f8a9da739db2aeb011c62faa9  .scratch/map-controls-coordinates/spec.md
1b320cd2fcdb63c504ece1d2fef7cfb464acb52f7b13416baba5147c9d01b2cc  .scratch/viewport-upgrades/issues/07-approved-follow-up.md
eebc1246f75c1d2b81cd73db8885f53e8dc4b9b611d64d5127b412b0a4b2f1ac  package.json
7cc63519c8a939d317e8d9ed92058b7db565f44fc2bc890d95ba6ce9400e58b5  playwright.support.config.mjs
3715d49fb9d00a708ceadc70e00eee737c70ce746f5b2d432c8c1776cd36de5e  playwright.packaged.config.mjs
b80c973597670acc953faa1b2d902c1127ad9b530d542f576ee47a370db63057  node_modules/maplibre-gl/src/ui/map.ts
76f1579674e0953851a0a872bf18961737bdff4f00c4b822cc7238d5baf608f8  node_modules/maplibre-gl/src/style/style.ts
58ace914d7f7fd6e4d09293fe084f1f16cb39741d6821e06159c08f382a15bb4  node_modules/maplibre-gl/src/ui/control/fullscreen_control.ts
```

## Final feedback and runner delta rereview

Recorded 2026-10-12 after root's final delta request. No new confirmed finding was identified. Viewport SHA `6dd5096f157bb91a7ad625e5041073fe76a5d31e9e2ff275699be5ea94aec43c` is unchanged, so F1's inspected disposition above still applies.

The active directed-segment arrow now uses the existing shared image at size 1.5 with offset [0, 6]. Its image's logical size is 16 CSS pixels, so the displayed head is 24 CSS pixels and its scaled offset is nine CSS pixels. Only the active-segment attachment passes these internal presentation options. Saved arrows and the ordinary draft arrow still use their existing defaults. The change is a small correction to the approved visible direction feedback, with no new tool, public option, stored geometry or rendering owner.

The composed direction observation now captures the same scene with the head shown and hidden, with opacity transitions disabled. It compares RGB change against the green foreground, weights antialiased coverage, normalizes area to CSS pixels and requires six CSS square pixels in each off-shaft wing. Unchanged shaft/handle pixels contribute no change. Its negative control enlarges the actual endpoint handle, requires both wing areas below 0.1, restores the original size and requires visible wings again. Both visibility and real coverage are therefore prerequisites rather than optional observations. Failure capture retains the actual composed PNG and measured wing areas. These criteria address the recorded short-edge visibility problem without relying on nearly exact raster colors or layer presence alone.

The revised airborne fixture places the elevated point at map center and moves the native point away. At the fixed zero-pitch camera, that samples the airborne point rather than its displaced off-center ground projection. Removal now waits for published pixels to disappear before testing later usable publication. Reload checks tolerate the native style temporarily being unavailable. Native/model label-priority histories now set selected appearance disabled, so their identity and glyph assertions also exercise priority independent of feedback suppression.

The runner strips the residual leading package-manager separator after removing its injected support flag. This preserves project and grep options passed through either documented invocation shape. The focused producer test keeps the real runner, process owner and command boundary and asserts the exact received Playwright arguments; it substitutes expensive build/browser commands. Its result establishes forwarding, not successful Playwright execution or consumer builds.

Executed by this reviewer:

```sh
node --test --test-name-pattern='support runner forwards project and grep options' scripts/test-browser.test.mjs
```

Result: 3 passed, zero failed, skipped or cancelled. No shared package/build/browser work was started. The earlier 121-module run remains evidence for its earlier reached module histories; it does not verify the new arrow's visible pixels. Root's active browser run was not observed or classified as passing by this reviewer. Browser acceptance of these final inputs, actual package/tooling stages and final integration checks remain root-owned.

The following hashes supersede their earlier entries for this delta. They were unchanged between the reread and report append. Later fixture or source changes require appropriate rereview and current integration pins.

```text
1f2a96d2d9182b2729c049c82a8e43eeb1e111e302e574349a95627bc4fef9d2  src/drawing.ts
3f8c0536c52f0d7f5c5b643f5e37b56c058c6fd429e57050a2674f8d8d2a58e0  src/arrowheads.ts
6dd5096f157bb91a7ad625e5041073fe76a5d31e9e2ff275699be5ea94aec43c  src/viewport.ts
9e776563009368a8116a8960bf953de0d9c3d179968eddb0a694f34beea9f1b1  tests/workflow-drawing.browser.ts
c0be483ac81838dc4e7a570ce4ad3c824f7774eb670ed722b27c91450e3f8744  tests/workflow-selection.browser.ts
f162bb9c3b4c42716f54ddb1183b5967ee9a635a706278860b29b3d337065d18  tests/packaged/browser.spec.ts
e97503c44fd19b00c79ba9fafdcd5d4de65a1c71a6b63cd5e0b437cce4e47e8e  scripts/test-browser.mjs
3e14df32f95a575f1c78659540c86af225bae53b433ca1a8064a9dcccb72709a  scripts/test-browser.test.mjs
44da85ba4e01bbdcb33eab4bcd055245dc750b5e00f275d13ef76d485063c81c  tests/browser-observation.ts
1e74d806804d9bb7fc7933408eb564116ef31a72a0e8057bc2bf17cc04e67ca8  .scratch/viewport-upgrades/drawing-spec.md
```

