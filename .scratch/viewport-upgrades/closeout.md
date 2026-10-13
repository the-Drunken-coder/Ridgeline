# Viewport upgrade closeout

The approved 2026-10-12 follow-up is implemented and locally verified. Its current record is [below](#approved-follow-up-2026-10-12); preceding sections retain the historical 2026-10-11 handoff evidence.

Recorded 2026-10-11. All delivery changes are uncommitted local work on `t3/research-project-competitors`. Nothing was published, committed, pushed, deployed or opened as a pull request.

Spec: [Viewport workflow upgrades](spec.md)
Integration owner: root
Reviewed: baseline and HEAD `cbef055b14fe218aa24611031c4ba1a9aa0ed540`, plus the uncommitted inputs recorded below; root combined review and independent follow-up review have no outstanding concrete findings
Local verification: current results below, pinned separately from historical runs
Hosted verification: excluded by the user's publishing constraint; no hosted or merge-readiness claim
Remaining limits: physical devices, installed browsers, target GPU performance, manual screen-reader and long-session memory acceptance remain unverified

## Scope and ownership

The delivered scope includes optional additive/rectangle selection and rectangle queries, configurable labels/icons/dashes and selected/hover appearance, native optional controls, coordinate helpers, polygon holes, exact segment editing, edge snapping, touch drawing and an installed-package starter. It retains the approved drawing rail and fixed inspector.

After the five grilling threads, the user approved selected-label placement priority while retaining collision suppression. Selected native and model labels now get first opportunity at space; selected labels may still collide with one another. Selection, deselection and basemap reload update placement without replacing consumer data.

The follow-up also corrects saved solid drawing appearance, thick-line selection, per-field highlight inheritance, airborne fallback feedback, map-aligned icons and opacity-aware rectangle queries. Drawing identifies the active directed segment and distinguishes vertex/edge snap rings. Geographic helpers reject undefined directions. Native basemap controls follow accepted configuration, including failed loading, and configuration observers cannot skip native style changes. The starter saves complete drawings in consumer-owned localStorage, restores them after reload and demonstrates recoverable rejected submission. Its own installation/build instructions and packaged guide links were corrected.

The user withdrew motion/replay on 2026-10-11. Application data, networking, storage, history, clocks, interpolation, retention, replay and camera-follow policy belong to consumers. Ridgeline accepts complete current features through `upsert`, retires displayed features through `remove`/`clear`, and receives chosen camera changes through `setCamera`. No replay layout choice remains. The [withdrawn motion ticket](issues/03-motion.md) is historical, not an implementation dependency.

## Reviewed and exercised inputs

A commit SHA alone does not identify these uncommitted changes. Each manifest hashes 182 runtime, test and configuration inputs. Before/after handoff manifests are identical.

| Input set | SHA-256 digest | Verification |
| --- | --- | --- |
| Support follow-up | `1305996ef45c4058170fd5543fb2e93576c2c5c17cca1d81b21e623b6b9cd310` | 51 support cases, 17 per engine; independent review verified every hash |
| Handoff | `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3` | Final typechecks, 426 library/tooling plus 5 control-lab tests, 50 rendering cases, 9 drawing support cases, standalone starter build and playground build |

Only `src/arrowheads.ts` and `src/drawing.ts` changed between these input sets. Manual inspection found the active-segment head was covered by its edit handle; a 12 CSS-pixel offset moves it back along the edge. Other drawing arrow callers retain their defaults. The independent reviewer checked this exact delta, installed MapLibre semantics and all 182 handoff hashes. Root inspected the final desktop/narrow captures. No change followed runtime verification.

## Current checks

| Command | Input set | Result |
| --- | --- | --- |
| `pnpm check` | Handoff | Ticket validation, root TypeScript and control-lab TypeScript passed |
| `pnpm test` | Handoff | 426 library/tooling and 5 control-lab state tests passed |
| `pnpm test:support --reporter=list,json` | Support follow-up | 51/51 passed in Chromium, Firefox and WebKit, no skips/retries |
| `pnpm test:browser --grep '[Mm]odel\|Reliability entity\|Drawing upgrades touch\|Incremental updates\|Picker candidates stay stable\|Airborne\|airborne\|Arrowheads\|Arrow editing' --reporter=list,json` | Handoff | 50/50 passed; custom models, airborne feedback/attachments, movement, native touch and existing arrows |
| `pnpm test:support --grep 'Drawing upgrades holes\|Drawing upgrades edge\|Inspector label' --reporter=list,json` | Handoff | 9/9 passed, three per engine, after the final arrow adjustment |
| `node --import tsx --test tests/drawing.test.ts` | Handoff | 96/96 passed |
| Fresh `pnpm --dir examples/starter install`, then `pnpm --dir examples/starter build` | Handoff runtime archive | Passed with the starter's own configuration; installed JS and declarations match archive bytes |
| `pnpm build:playground` | Handoff | Library, declarations and playground production build passed |
| `pnpm measure` | Handoff | Library plus CSS adds 44,568 raw and 12,304 gzip bytes over clean baseline; no added library dependency |

The standalone-tested package archive has SHA-256 `696a1a7d528a7f01b01e08c15e8b20acffa3c2943d8286e53ac821706325bfb3`; its JS has SHA-256 `be52b6fdf4c67baceeb39749a28f170d504e370b7f7bf9def9a3d3a30d62d467`. The final playground build produces the same library JS. Final documentation updates do not change runtime inputs. Packaged file/heading links are checked separately against the final archive. Vite reports its existing large-chunk warning.

The desktop drawing scene shows the selected edge and directed head beside the edit handle. At 390 CSS pixels, document width is 390 and numeric fields are 178.5 pixels wide. Automated workflows cover empty/ready state, editing, ring/segment changes, undo, submit/rejection/retry, restore, selected/hover state, failed style loading and disposal. The manual captures show the approved layout and feedback, not physical touch or screen-reader acceptance.

The full Chromium regression suite, unchanged playground/control-lab browser journeys and measurement-tool suite were not rerun in this follow-up. Their earlier dated results remain historical. No successful single-command `pnpm validate` run is claimed.

## Acceptance mapping

| Ticket or criterion | Evidence |
| --- | --- |
| Selected label priority and style corrections | Two added public packaged presentation cases pass across three engines; model rendering/feedback cases pass in the broader run; prepared-marker regression and style tests pass |
| [Drawing feedback](issues/04-drawing-polish.md) | Directed ring/segment feedback, exact edits, undo and clearing pass across three engines; vertex/edge rings and Alt bypass pass; 96 drawing tests and native touch case pass; final captures show visible direction |
| [Coordinates and controls](issues/05-coordinate-control-corrections.md) | Five coordinate tests cover undefined bearings/pole rules; public native geolocation/fullscreen/basemap workflows pass across engines; reentrant configuration case verifies the actual loaded basemap |
| [Starter and packaged guides](issues/06-starter-corrections.md) | Three-engine storage restore/rejection cases, fresh standalone install/build, archive byte comparison and packaged guide link validation |

Native geolocation teardown clears its active watch through MapLibre's public API. MapLibre 6.11.0 offers no public cancellation for its one-shot location request or ten-second fallback timer; late results are ignored after removal. This upstream limit is documented, without private-field patches. Validation messages remain text because the validator exposes no error-location model. Consumer refresh/versioning and accepted-change history remain consumer responsibilities.

## Environment and limits

Ubuntu 24.04.5, Node 24.21.0, pnpm 11.0.9, Vite 8.3.0 and Playwright 1.63.0. Chromium 153.0.8010.12 uses ANGLE/SwiftShader; Firefox 155.0 runs under Xvfb with Mesa software rendering; Linux WebKit 26.6 reports a masked `Apple GPU` string. This host has no `/dev/dri`; that string does not establish Apple hardware or installed Safari acceptance.

Physical Android/iOS, pen, installed browsers, target GPU performance, manual VoiceOver/NVDA and long-session memory acceptance remain unverified. Rectangle queries for custom 3D/model/GPU representations retain documented conservative approximations. Geographic helpers use a spherical model.

## Evidence retention and historical work

The [thread correction evidence](evidence/thread-corrections/README.md) contains the final review, summary, environment, runtime manifest, selected final screenshots and a byte-exact raw report archive. Raw reports retain final checks, the tested package and earlier unsuccessful attempts. Browser producers are pinned; promotion copies evidence without rerunning checks or advancing their input pins.

The [consumer-owned data evidence](evidence/consumer-owned-data/README.md) retains the earlier scope correction at digest `50853a463fee75ff3edc4a75d7332ba42388a588c263b0893256a7253977d46e`, with 33 support cases, consumer update/touch checks and its bundle measurement. The [original upgrade evidence](evidence/final/README.md) includes the withdrawn motion/replay implementation. Both sets remain byte-identical and historical. The previous closeout is preserved in this follow-up raw archive.

Earlier follow-up attempts remain failures at their original inputs: a browser-case registration order mismatch, an off-canvas pixel fixture, and hover defaults that obscured the fixture's intended observation. Corrected registered/native pixel cases passed; the earlier reports are not relabelled as current successes.

## Final documentation and retention checks

Final documentation verification covered 29 changed/new Markdown files and 107 relative file/heading links without failures. The final packed archive has SHA-256 `cde776b2eb7858c4a87c1427ae4617b1cd2daeb8d39c26249b9687495cf45bd6`; all 30 relative links across its nine Markdown files resolve, generated/private content is excluded, and its JS/declarations match the standalone-tested archive. Ticket and whitespace checks pass.

Promotion dry run and execution verified six curated files, 40 original raw reports and 12 retained links. The promoted raw archive has SHA-256 `352233c4eb95159cbdc65b2d0b5a32c294158aea5da195b3d289d2ee05d28899`. Root reviewed the promotion output, summaries, input pins and copied files. Selected browser producers remain pinned. Earlier evidence is unchanged.

```sh
node scripts/promote-evidence.mjs .artifacts/viewport-upgrades/thread-corrections/promotion-plan.json --dry-run
node scripts/promote-evidence.mjs .artifacts/viewport-upgrades/thread-corrections/promotion-plan.json
```

All work remains unstaged and uncommitted. The handoff runtime input digest remains unchanged after final documentation and promotion.

Retention clarification: the original registration-order failure is preserved in the separately pinned producer `.artifacts/browser-runs/packaged-2026-10-11T19-20-35.384Z-56f7ec9b-6c59-4a81-98cd-0b7ddef855ae`, including failure contexts and traces. The promoted raw archive contains the later pixel-fixture failure reports. The retained summary groups these historical failures together; this record specifies their actual storage locations.

## Approved follow-up, 2026-10-12

Spec: [Approved viewport workflow upgrades](spec.md), with [implementation ownership and acceptance](issues/07-approved-follow-up.md).
Integration owner: root.
Reviewed: base and HEAD `cbef055b14fe218aa24611031c4ba1a9aa0ed540`, plus uncommitted 185-input digest `91abf5465d9d319c5af473975da1321dcf626a7e7a8a670f531c610bb92c27b1`. Root reviewed the combined delivery and independent review found one additional callback-order risk, corrected and rereviewed. No open confirmed finding remains in this scope.
Local verification: the same digest before and after the completed checks below. Three new validation modules extend the earlier 182-input manifest; 27 inputs changed or were added relative to the October 11 handoff. Shared specs/docs are excluded, apart from the legacy starter/control-lab README inputs.
Hosted verification: excluded by the user's local-only publishing instruction; no hosted checks or merge-readiness claim.
Remaining limits: physical devices, installed browsers, target GPU performance, manual screen readers and long-session memory remain unverified. Full `pnpm validate`, full Chromium regression discovery and the measurement-tool campaign were not rerun. Existing one-shot geolocation cancellation and rectangle-query approximation limits remain documented.

| Acceptance | Current evidence |
| --- | --- |
| Renderer-loss cancellation, selected IDs retained, later input usable | Real context loss/release/restoration workflow passes in all three engines |
| Consumer can ignore and filter selection proposals | Request-only native rectangle workflow passes in all three engines |
| Invalid draft raw area remains available, UI area unavailable, save blocked and undo restores valid area | Public-session regression and packed native inspector history pass |
| Direction head distinguishable beside real editing handles | Active head enlarged to 24 CSS px with 9 CSS px offset; paired composed pixels require both wings and a controlled covered-head negative, through segment/ring/edit/undo histories in all three engines |
| Feedback suppression, model brightening and current-data style refresh | Native/airborne/model pixels, explicit zero brightness, retained selection/camera/draft/data, failure isolation and callback replacement/removal histories pass |
| Label priority independent of disabled feedback | Actual native/model glyph pixels and collision identities through selection, suppression, reload and deselection pass |
| Basemap reentry cannot skip requested native update or required elevation reset | Real drawing preview, pending preparation AbortSignal and native style-loading callbacks pass; replacement/destruction histories pass |
| Partial native control resources released; equivalent choice and keyboard behavior coherent | Real native onAdd failure, later camera/attachment recovery, preserved consumer control and keyboard selector histories pass |
| Failed restore cannot overwrite storage through save or Reset/remount | Original bytes, retained draft and accepted data remain unchanged; explicit clearing permits save in all three engines |
| Standalone starter and final archive checks are mandatory | Own fresh installs/builds and final inventory/links pass in both browser entry points; real runner producer tests reject broken configuration and file/heading links after generated consumer success |

Completed checks:

- `pnpm check`: ticket validation and library/playground/control-lab typechecks pass.
- `pnpm test`: 435 library/tooling tests and five control-lab tests pass.
- `pnpm test:support`: 81 workflows pass, 27 each Chromium/Firefox/WebKit, no skips, retries or failures.
- Additional packed Chromium model/publication/recovery/DPR 2, touch, drawing lifecycle and arrow regression selection: 41 pass.
- `pnpm build:playground`: library and playground production builds pass, with the existing large-chunk warning.
- Independent starter install/build and final package inventory: 73 files, nine Markdown files and 30 file/heading links pass.
- Independent review: 121 focused module tests, final delta rereview and three runner forwarding checks; current source/check pins are retained separately from historical evidence.

Library payload is 328,544 raw / 92,362 gzip bytes, an increase of 1,977 raw / 528 gzip bytes above the October 11 handoff. CSS remains 7,011 raw / 1,975 gzip bytes. No library dependency was added. These are payload measurements, not hardware-performance acceptance.

Final documentation archive SHA-256: `92b28abe835e82e546707f84e9edc728af241ade1826b246854ce464383c4f21`. Its JS SHA-256 is `684a6847304698390a8db67f9fd331d307411ba632bc6d0bb6f2ed000a828cd9`. Runtime, CSS and declarations match the installed exercised consumer byte for byte. Documentation was then checked against the final archive; documentation changes do not advance runtime evidence pins.

The [approved follow-up evidence](evidence/approved-follow-up/README.md) retains the final independent review, readable summary, input manifest, package identity and 23 byte-exact raw producer records. Promotion dry run and execution verified four curated files and seven links. Raw archive SHA-256: `1e3080db32f89a832f93b2e9b7c0d4c72af33dd4ab8cb9609ebdd7784cc2d5ab`. Failed attempts keep their original outcomes and producer pins. Existing historical evidence is unchanged; selected current producers remain pinned.

The user views holes as a general shape-editing capability supporting future disc/ring workflows. No dedicated disc/ring tool was commissioned. Drawing keeps its approved rail and inspector. Source data, persistence, history, time and replay remain application-owned. Nothing was committed, pushed, published, deployed, merged or opened as a pull request.
