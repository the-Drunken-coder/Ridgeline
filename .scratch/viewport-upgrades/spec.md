# Viewport workflow upgrades

Integration authorization, 2026-10-13: the user subsequently authorized five GitHub draft PRs and issue publication. That supersedes the original publication exclusion below. Package release, hosted deployment, merges and ready promotion remain excluded. See PRs #114–118 for exact current revisions and pending gates. Earlier local status paragraphs retain historical context.

**Kind:** spec

Published spec issue: [Viewport workflow upgrades, #105](https://github.com/the-Drunken-coder/Ridgeline/issues/105)

Publication, 2026-10-12: the user authorized approved spec issues and later approved implementation tickets only, superseding the earlier tracker-publication exclusions below for that scope. Issue #105 is open with `kind:spec` and `spec`. Approved local requirements remain canonical until versioned publication; the current source and evidence remain local/uncommitted with no published blob URL. Code commits/pushes, package/website publication, pull requests, deployment and merging remain unauthorized by this publication. No implementation tickets were created here.

Approved follow-up, 2026-10-12: the user accepted the five summaries and recommendations in the coordinating conversation. Renderer loss cancels box selection without changing accepted selection. Invalid drawing area stays available as a raw calculation but is unavailable in the controls while topology is invalid. Holes remain a general shape-editing capability; a future disc or ring workflow does not commission a dedicated tool now. Consumers can disable built-in selection/hover appearance and control model brightening. A small explicit style refresh uses current stored features without replacing application data. The basemap selector retains a chosen equivalent-style entry as local control state. Failed starter restoration blocks overwriting the original storage until explicit recovery or clearing. The standalone starter and packaged documentation checks become required consumer-validation stages. The red-team correctness fixes and additional acceptance histories are approved. Root owns integrated verification. See [approved follow-up ticket](issues/07-approved-follow-up.md) for ownership and observable acceptance.

Status: the approved selection, drawing, controls and adoption delivery is implemented locally; its dated verification is recorded in [closeout](closeout.md). The user approved the 2026-10-12 corrections and recommendations. Follow-up implementation is local; the current local evidence is recorded in the shared closeout. Motion and replay were withdrawn by the user on 2026-10-11.

Cross-topic review note, 2026-10-12: red-team acceptance corrections and the coordinating recommendations are approved. Implementation and current evidence are tracked separately from historical verification. Other focused proposal documents retain their separate owners and scope. Existing guarantees remain requirements when implementation violates them. Reproduced defects, inspection-supported risks and evidence gaps must be distinguished; historical verification pins do not prove newly proposed acceptance histories.

Source: the user's 2026-10-11 instruction to implement the four recommendations from the competitor gap review, except publishing. Baseline: `cbef055b14fe218aa24611031c4ba1a9aa0ed540`. This work remains local. Package publication, hosted documentation, tracker publication, and a pull request are excluded by the user's publishing constraint.

## Problem Statement

Applications adopting Ridgeline need to establish that the installed package works without the playground, understand which state their application owns, and complete common selection and drawing workflows. Source aliases, incomplete setup instructions, storage examples that never restore data, and links to files absent from the package make that assessment harder.

Consumers also need evidence they can interpret accurately. A passing browser-engine workflow, a native keyboard journey, a synthetic touch gesture and a payload measurement establish different facts. None alone establishes installed-browser, physical-device, screen-reader or hardware-performance acceptance.

## Solution

Provide a runnable plain TypeScript/Vite starter, focused workflow and support guides, and repeatable installed-package checks. The starter demonstrates application selection policy and complete drawing acceptance, storage, restore and rejected-save recovery. Preserve Ridgeline's applicability to applications generally, including existing desktop workflows and touch drawing.

1. Dependable adoption: runnable starter recipes, an API guide, a browser and input support matrix, repeatable accessibility and hardware checks, and dated evidence distinguishing tested support from outstanding hardware acceptance.
2. Everyday workflows: optional additive and rectangle selection, configurable label/icon/line/highlight presentation, coordinate helpers, and a standard map control attachment.
3. Drawing: edge snapping, exact individual segment length/bearing, creation and editing of polygon holes, and touch placement/editing with usable map navigation.

The user narrowed the original four recommendations on 2026-10-11: timeline/data management stays outside Ridgeline. Existing feature and camera APIs remain the display boundary. The later coordinating review completed these workflows and corrected demonstrated defects without expanding library ownership.

## User Stories

1. As a consumer developer, I want fresh-checkout prerequisites and exact installation commands, so that I can run the starter without discovering missing setup steps.
2. As a consumer developer, I want the starter to install the packed package without source aliases or playground imports, so that it demonstrates the integration my application will use.
3. As a consumer developer, I want the starter's own TypeScript configuration and production build verified, so that a generated test application cannot hide starter setup failures.
4. As a consumer developer, I want explicit instructions for copying the starter and changing its archive dependency path, so that I can use it outside the Ridgeline checkout.
5. As a consumer developer, I want MapLibre worker setup, required styles and map-container sizing demonstrated, so that the first viewport renders in Vite.
6. As a consumer developer, I want the starter's online asset requirements and blank offline mode explained, so that I can distinguish tile-service failures from package integration failures.
7. As a consumer developer, I want a small selection/styling recipe, so that I can display my features and apply application selection policy.
8. As a map user, I want optional additive and rectangle selection, so that I can choose several displayed features while retaining ordinary camera navigation.
9. As a map user, I want selection gestures to cancel safely when interrupted, so that later map input remains usable and no abandoned selection is applied.
10. As a map user, I want rectangle selection to resolve current displayed features when I release the gesture, so that moving features remain selectable.
11. As a consumer developer, I want configurable labels, icons, dashes and selection/hover appearance, so that features fit my application without a library fork.
12. As a map user, I want selected labels to receive placement priority while retaining collision suppression, so that selection helps me find a feature without promising every label will fit.
13. As a consumer developer, I want rendering and query approximations documented, so that I understand what a selection result establishes.
14. As a map user, I want optional native navigation, scale, fullscreen and geolocation controls, so that common map actions remain familiar.
15. As a consumer developer, I want longitude-first coordinate formatting, parsing and spherical direction helpers with explicit limits, so that my application can exchange geographic positions consistently.
16. As a drawing user, I want visible vertex and edge snapping feedback, so that I can understand which target an edit will use.
17. As a drawing user, I want exact directed segment distance and bearing edits with draft undo, so that I can adjust geometry numerically and reverse an unwanted change.
18. As a drawing user, I want polygon holes that remain editable and survive storage, so that excluded areas retain their meaning after reload.
19. As a drawing user, I want invalid drafts to remain editable while submission is blocked, so that I can correct geometry without losing my work.
20. As a touch drawing user, I want tap placement, handle editing, explicit Finish/Cancel and two-finger navigation, so that drawing and map movement remain available in the same workflow.
21. As a keyboard user, I want named controls, visible focus and one action per keypress, so that I can continue after edits and control-state changes.
22. As a map user, I want readable narrow and dark-mode interfaces with usable touch targets, so that optional controls remain usable in those conditions.
23. As a consumer developer, I want a complete drawing acceptance recipe, so that my application saves the change while Ridgeline applies accepted display data.
24. As a starter user, I want accepted drawings restored from application-owned browser storage after reload or remount, so that I can verify a real save/restore boundary.
25. As a starter user, I want rejected saves to retain my draft and permit retry, so that a storage failure does not become a lost edit or false acceptance.
26. As a consumer developer, I want shape definitions saved alongside ordinary geometry and properties, so that circles, rectangles, arrows and polygon holes retain their editing behavior.
27. As a consumer developer, I want the storage recipe's concurrency and history limits stated, so that I supply my own version checks, networking and accepted-change undo.
28. As a consumer developer, I want attachments and example listeners disposed on mode changes and teardown, so that remounting does not duplicate controls or retain obsolete work.
29. As a consumer developer, I want README contracts and focused workflow guides with usable installed-package links, so that I can find integration behavior without navigating internal working records.
30. As a maintainer, I want repeatable packaged Chromium/Firefox/WebKit workflows and CI configuration, so that I can detect regressions at the consumer boundary.
31. As a consumer developer, I want workflow-specific results tied to source inputs and environment, so that I can distinguish current verification from historical results.
32. As a consumer developer, I want physical-device, installed-browser, screen-reader, GPU and long-session limits stated, so that I can plan acceptance for my actual deployment.
33. As a consumer developer, I want to supply complete current geometry, pose and chosen camera state, so that my application retains control of data, time, history and camera-follow policy.

## Implementation Decisions

### Ownership and compatibility

- Consumers retain authentication, networking, persistence, permissions, historical storage, and accepted-change undo. Existing viewport and drawing APIs remain usable without the new attachments.
- All new attachments have explicit destroy methods, release their own listeners and scheduled work, and automatically retire with their viewport. They tolerate repeated destruction and partial setup.
- Use direct MapLibre integration for its standard controls. Do not duplicate its camera engine or introduce a renderer abstraction.
- Consumers own source data, history, time selection, interpolation, retention, playback and camera-follow policy. Ridgeline accepts complete current features and camera state; it does not require a timeline or trajectory format. Viewport snapshots and drawing drafts remain display and interaction state.
- Polygon holes extend the version 1 drawing shape metadata additively. Old single-ring drawings retain their meaning. Geometry and shape definitions continue to round trip together under ADR-0003.
- APIs validate and snapshot inputs before accepting mutations. Reads return snapshots. Invalid input does not partly replace accepted state. Use existing diagnostics for callback failures, with bounded bookkeeping.

### Selection and presentation

The [focused feature presentation spec](feature-presentation-spec.md) synthesizes the settled appearance decisions and existing test boundary without expanding this canonical scope.

- Keep existing selection behavior by default. An explicit multi-selection option enables Shift-click toggling and an explicit box-selection gesture. Consumers still receive selection requests and decide whether to apply them.
- Box selection must not interfere with default MapLibre box zoom, active drawing, controls, or ordinary camera navigation. A documented modifier chooses its ownership. Escape, blur, pointer cancellation, and ownership replacement clear transient rectangle feedback.
- Rectangle results use displayed selectable features and deduplicate entity/attachment hits to feature IDs. Results preserve stable order. Recheck data and ownership before requesting selection.
- Custom 3D rectangle queries conservatively intersect accepted projected geometry and model boxes. They can include geometry occluded by terrain and empty model-box space; GPU coverage approximates terrain draping with published nonzero-alpha texel spans. Document these limits. Ordinary and additive point picking share the existing terrain-depth rejection and ordering.
- Ordinary feature updates during a box drag keep the gesture active. Resolve current displayed representations on release so moving entities remain group-selectable. Camera, projection/style, resize and ownership changes still cancel the screen-space gesture.
- Add label font, size, color, halo and anchor/offset configuration; icon size, rotation and anchor; line dash arrays; and optional selection/hover appearance. Document units and renderer/font availability.
- Styles preserve the existing failure isolation and last accepted display behavior. New fields work for native markers and model labels where applicable. Selection/hover changes require no feature replacement.
- On 2026-10-11 the user approved prioritizing selected labels while retaining collision suppression. Selection and deselection refresh placement without replacing consumer features; multiple selected labels may still collide and be hidden. The same rule survives basemap reload and applies to model labels.

### Thread review corrections

The user accepted the coordinating review recommendations on 2026-10-11. Fix demonstrated conformance defects and complete the existing workflows without adding speculative APIs or expanding feature ownership.

- Saved drawing dash settings override accessor dash arrays. Default selection feedback must not shrink an already thick line. Airborne fallback dots honor applicable highlight color/radius settings, and map-aligned icons retain their requested alignment.
- Drawing controls and map feedback share the active directed segment. Snap feedback identifies vertex or edge targets. Keep the existing rail/inspector, editable invalid drafts and two-finger touch navigation.
- Geographic direction helpers reject mathematically undefined bearings through existing error conventions; verify and document pole behavior. Standard controls stay native and optional. Fix owned-control synchronization and cleanup where the public native API permits it; record upstream limits rather than depending on private fields.
- Verify the starter using its own documented dependency installation and production build. Complete the small application-owned storage restore/rejection workflow. Packaged documentation links resolve within shipped content.
- Investigate selection cancellation and rectangle-bound consistency before changing behavior. Distinguish reproduced failures from hypotheses.
- Root owns selection/presentation, shared docs, browser registration, package configuration and integrated verification. Drawing, coordinates/controls and starter workers have separate file ownership in the local follow-up tickets. All work remains unpublished.

### Adoption and documentation

- Keep two plain TypeScript/Vite recipes: selection/styling and drawing/storage. Import public package exports and styles; do not depend on playground source or a UI framework.
- Document fresh root dependency installation, package build/pack, starter dependency installation, the starter's own production build and development startup. Document copying the recipe and updating the local archive dependency path. The starter uses its own dependency and TypeScript configuration.
- Configure the MapLibre worker before mounting and give the map an explicit sized container. The normal example loads the public basemap and glyph resources. The optional blank offline mode avoids tile-service requests and glyph-dependent labels. Neither starter mode enables terrain or requests location permission.
- The selection recipe applies application-owned selection requests and clears its selection display when changing examples. It demonstrates configured appearance through the public viewport API.
- The drawing recipe uses application-owned localStorage for complete accepted features, including geometry, properties and versioned drawing shape/style metadata. Restore through the validated viewport feature API after reload or remount. Generate IDs that do not collide with restored drawings.
- Compare an edit's accepted baseline against the application's saved feature. Save the next complete storage snapshot before returning acceptance; do not perform a second viewport mutation inside submission. Rejection or a storage write failure retains the draft and leaves accepted data unchanged. Provide an explicit rejected-save example followed by successful retry.
- **Approved follow-up, 2026-10-12:** A failed restore preserves the original stored bytes and causes the starter application to reject later submissions until the application explicitly recovers that data or the user explicitly clears it. Ordinary remount/Reset remains non-erasing and cannot bypass this protection while the stored data still fails restoration. Keep the protection in the starter application, without a Ridgeline storage policy, storage framework or concurrency feature.
- **Inspection-supported risk, not a reproduced defect:** The pre-follow-up restore error path reported failure but left later saves available. A subsequent accepted save can replace the failed stored dataset with the application's incomplete working map. The protection and failed-restore/attempted-save history are now implemented locally. Root verified all 81 support workflows across Chromium, Firefox and WebKit on 2026-10-12.
- Explain that the recipe is for one page. Server or multi-tab consumers supply atomic version checks, permissions, networking and persistence policy. Reset/remount restores saved drawings; clearing site storage removes them. Accepted-change history is outside the recipe.
- Keep public behavior in README and use focused guides for workflow explanations and support evidence. Link authoritative contracts instead of duplicating them. Explicit package inclusion ships the starter, relevant guides and ADRs; exclude generated/private working content. Relative links in packaged Markdown must resolve against shipped files and headings. Repository closeout/evidence references must not appear as locally usable links in the installed package when those records are excluded.
- Retain native keyboard/focus journeys, larger drawing touch hit areas and dark-mode styling within the approved layout. These improvements do not imply complete accessibility or physical-device acceptance.
- Describe results by workflow, browser engine, environment and input revision. Keep withdrawn motion/replay evidence historical. CI configuration is distinct from a successful hosted run; payload measurements are distinct from hardware performance.

### Coordinates and map controls

- Provide typed decimal-degree, degrees/minutes, and degrees/minutes/seconds formatting and parsing. Coordinate order is longitude then latitude. Reject malformed, nonfinite, and out-of-range values; handle hemisphere signs, rounding carry, negative zero and the date line deliberately.
- Provide geographic distance/bearing/destination helpers or document reuse of the existing spherical model. Do not imply survey-grade accuracy or silently convert coordinate reference systems.
- A standard optional attachment installs MapLibre navigation, scale, fullscreen and opt-in geolocation controls with configurable positions. Consumers can select a subset and use the original MapLibre options. No geolocation request occurs until the user triggers it.
- Coordinate readout and basemap choices may be included as optional controls, use accessible labels, and refresh from current map/configuration state. Dispose only controls owned by the attachment.

### Drawing behavior

The [focused drawing specification](drawing-spec.md) records the settled user stories, implementation decisions and existing testing boundaries. It synthesizes this canonical scope and the approved feedback corrections without commissioning additional behavior.

- Existing vertex snapping remains available. Edge snapping is opt-in, uses a CSS-pixel tolerance and visible eligible feature segments, and honors `canSnap` and Alt bypass. Vertex hits win over edge hits at equal practical distance. Resolution validates terrain and the current scene after callbacks.
- Exact segment controls hold the start vertex fixed and move the end vertex to the supplied horizontal spherical distance and clockwise-from-north bearing. They work for line, arrow, polygon exterior and hole edges. Each committed field change is one draft undo step.
- Polygon shapes may have interior rings. Imported hole geometry is preserved on edit. Users can add, select, reshape and delete holes, with each operation inside the same draft and submission boundary.
- Holes must lie strictly inside the exterior, cannot intersect/touch the exterior or another hole, and cannot overlap/nest. Invalid drafts remain editable but cannot be submitted. Measurements subtract hole areas and include ring boundaries in perimeter. Translation moves every ring. No ring is silently dropped on reload.
- Touch uses explicit Finish/Cancel rather than double-tap completion. Tapping adds a point, dragging a handle changes it, and map gestures remain available with two fingers. Multi-touch, pointer cancel, capture loss, permission loss and camera movement settle a partial gesture without stale placement or movement. Mouse and keyboard behavior remains intact.
- Touch hit targets are usable without making the visible geometry handles obscure the map. Pending, rejected, conflict and forbidden states retain their existing contract and accessible feedback.

### Consumer-owned movement

- Remove the new motion modules, public exports, controls, replay demo and sample-history tests. Do not retain temporal data policy behind another library API.
- Preserve existing `upsert`, `remove`, `clear` and `setCamera` behavior, including stable selection and camera independence during feature updates. Consumers decide what to display and when; ordinary LineString features can display consumer-generated paths.
- Document this ownership in the public guide, glossary and ADR-0001. Keep existing consumer-owned moving-feature and airborne examples.
- The starter contains selection/styling and drawing/storage recipes. No replay layout choice or timeline UI is pending. Preserve prior verification as historical evidence for its original inputs.

### UI contract

Keep the approved Field desk surrounding UI, Map bench picker, and labeled drawing rail/fixed inspector. Add dense labeled fields and useful state text using existing green/neutral tokens. No decorative cards, pills, idle animation, or application-specific workflows in the library. The user withdrew replay, so its static layout choice is closed. Drawing keeps the approved rail and fixed inspector.

At narrow widths, controls reflow into readable rows rather than shrink text. All visible controls have a real outcome. Keyboard focus survives ordinary updates; state transitions use enabled fallbacks. Empty, pending, rejection, conflict, permission failure and unavailable resource states remain reachable.

## Testing Decisions

### Existing seams

- Prefer the existing packed-package consumer as the highest behavioral boundary. Build and pack Ridgeline, install the archive in a separate application, check installed declarations/styles, build the application and drive real browser input. Source aliases must not substitute for package installation.
- Verify the starter's own fresh install and production build separately. The generated consumer's dependency, TypeScript and Vite configuration cannot establish the starter's exact documented path. Compare installed runtime/declaration bytes with the tested archive where evidence depends on package identity.
- **Approved follow-up, 2026-10-12:** Make the starter's own fresh dependency installation and production build, plus final archive file-inventory and Markdown file/heading-link validation, required stages in the existing repeatable consumer-validation path. A failed stage must fail validation. A generated consumer build alone cannot satisfy these stages.
- Use existing starter browser journeys for storage restoration, shape metadata, rejected-save retention/retry, native Tab/Enter focus, narrow layout and example teardown. Extend these public workflows when a demonstrated gap needs coverage; do not introduce a testing-only API or storage framework.
- Validate the final package file inventory and relative Markdown file/heading links against the archive. Documentation-only changes need link, ticket and diff checks, not runtime suite reruns.
- Use focused geometry/state tests where the browser boundary would obscure invalid inputs or state transitions. Assert externally observable behavior and invariants rather than source text, private call sequences or mocked-away integration failures. Existing selection, drawing, lifecycle and packaged rendering cases provide prior art.

### Acceptance and verification

- A separate packed-package consumer uses every new export and completes selection, styling, numeric drawing, hole save/reload, touch editing and teardown workflows.
- Focused geometry/state tests cover invalid inputs, date-line snapping, hole validity/measurements, exact segment edits and snapshot ownership.
- Native browser input verifies additive/box selection, touch placement/drag/cancellation and two-finger navigation, keyboard controls, focus continuity and one action per shortcut.
- Starter recipes build against the packed package. Their scope and storage ownership are explicit. README documents every public addition and links focused guides.
- The starter's own fresh install/build passes with its documented configuration. A real reload restores saved drawing metadata and editable numeric values. Rejected submission preserves accepted storage and the draft; a later retry succeeds.
- All relative file/heading links in shipped Markdown resolve within the final package. Repeatable support checks retain actual producing reports and failure artifacts, and CI requires the configured support job without implying hosted success before it runs.
- Browser results and accessibility observations are dated and revision-pinned. Chromium, Firefox and WebKit runs establish only the exercised environment. Hardware/GPU performance requires its repeatable target-hardware run; do not infer it from software rendering.
- Root is the integration owner. It reviews the combined diff and records reviewed/exercised inputs in `closeout.md`. Uncommitted changes are identified explicitly. No merge-ready or hosted-check claim without hosted verification.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Gesture gains/loses ownership or camera/scene changes | Selection and drawing attachments | Transient targets retire; later valid input works | Real pointer/keyboard/touch workflows |
| Callback changes owner, draft or data | Current attachment | No obsolete publication or later mutation | Reentrant public-interface histories |
| Hole or numeric segment edit is accepted/rejected/undone | Drawing session; consumer on acceptance | Complete rings retained; draft history and submission coherent | Geometry tests and packed save/reload workflow |
| Destroy/remount, including inside an observer | Each attachment, root integrates | Old resources/work disappear; replacement usable | Packed consumer lifecycle workflow |
| Save rejection followed by retry | Starter application owns storage; drawing session owns draft | Accepted storage stays unchanged until a successful retry; draft remains usable | Starter packaged browser workflow |
| Page reload or drawing remount | Starter application owns restoration | Complete saved drawings return with shape-specific editing behavior | Starter packaged reload and metadata workflow |

### Approved adoption acceptance additions, 2026-10-12

The user approved these additions. They are implemented locally, with current local evidence is recorded in the shared closeout. The existing save-rejection, draft-retention, standalone-build and packaged-link guarantees above remain requirements.

- Exercise failed restore followed by an attempted save. Require byte-identical original stored data, unchanged accepted viewport data and a retained, usable rejected draft. Repeat ordinary remount/Reset while restoration still fails and require the original bytes to remain intact. This is new acceptance evidence, not established by the earlier successful restore or deliberate rejected-save cases.
- After explicit application recovery or explicit user clearing, verify that a later submission can succeed. Recovery must not be inferred merely from an ordinary remount/Reset. No additional library API or storage/concurrency system is proposed.
- Exercise the existing repeatable consumer-validation entry point and retain results for the starter's own fresh install/build and final archive file/heading links. Demonstrate that a broken starter configuration or unresolved archive file/heading link causes that validation path to fail, even when the generated consumer builds successfully. Gate wiring and positive/negative tooling histories are implemented; root records the isolated and combined results in the shared closeout.

**Evidence gap:** Before this follow-up, regular validation built the generated consumer without requiring these standalone/archive checks. Both required stages are now wired into the consumer-validation path. The 2026-10-11 manual standalone install/build and final archive link passes remain valid for their recorded inputs. They do not establish a repeatable gate or any newly proposed failed-restore history. No runtime checks were rerun for this proposal amendment.

| Proposed transition | Owner | Required observable result | Evidence status |
| --- | --- | --- | --- |
| Restore fails, then submission is attempted | Starter application | Original storage bytes and accepted viewport data stay unchanged; the rejected draft remains usable | Implemented; verified in the current 2026-10-12 support run |
| Ordinary remount/Reset while restore still fails | Starter application | Failed stored data remains intact and subsequent submissions remain rejected | Implemented; non-erasing Reset remains an existing requirement |
| Application explicitly recovers data or user explicitly clears it | Starter application | A later submission can succeed without an implicit destructive reset | Implemented; verified in the current 2026-10-12 support run |
| Consumer validation encounters a broken standalone starter or archive link | Existing consumer-validation tooling | Validation fails even if the generated consumer build passes | Implemented; producer histories and current support run passed |

## Out of Scope

- Library-owned authoritative data, application networking, persistence, authentication, permissions or accepted-change history.
- Library-managed motion/history controllers, timestamps or trajectory schemas, retained samples, clocks, interpolation, retention, trails, replay, timeline scrubbing and camera-follow policy. Applications may display their own generated paths through ordinary features.
- A production storage service, concurrent multi-tab editing, server synchronization or accepted-change undo in the starter. Its localStorage recipe demonstrates the existing application boundary.
- New plugin/configuration systems, renderer replacement abstractions, public APIs added only for tests, or application-specific workflows.
- Full GIS reprojection, multipart/collection geometry, tiled cities/BIM, new model formats, analysis engines and database/network services.
- A new physical-device, installed-browser, screen-reader, hardware-performance or long-session acceptance campaign. Those limits remain explicit; the documented procedures do not commission their execution or imply certification.
- A new visual direction or reopening the approved drawing rail/fixed inspector.
- Publishing packages, hosted documentation, tracker issues or pull requests, pushing, committing, deploying or merging under the current local-only constraint.

## Further Notes

This synthesis records settled requirements and implemented behavior; it does not start another interview or reopen scope. The local spec remains the canonical requirements source. Tracker publication is withheld under the explicit user constraint. If publication is later authorized, follow the tracker adapter and use `kind:spec` and `ready-for-agent`; no tracker labels or issue state have been changed here.

The [shared closeout](closeout.md) owns execution and review evidence. Recorded 2026-10-11, baseline/HEAD is `cbef055b14fe218aa24611031c4ba1a9aa0ed540` plus uncommitted handoff runtime/test/config digest `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`. Documentation is excluded from that digest. The 51 three-engine support passes preceded the final two-file arrow adjustment; nine relevant drawing support cases and 50 broader packaged rendering cases passed afterward. The handoff also passed 426 library/tooling and five control-lab tests, typechecks, the standalone starter build, library/playground builds and final packaged links. These are retained producer results, not checks rerun by this spec synthesis. No successful full follow-up regression run, single-command validation, hosted verification or merge readiness is claimed.

Physical devices, installed browsers, target GPU performance, manual screen readers and long-session memory remain verification limits. Choosing an additional acceptance campaign would require a new priority decision only when that work is commissioned. The original adoption scope remains settled. The user approved the 2026-10-12 adoption/storage/testing corrections; current execution evidence is recorded separately in the shared closeout.

### Work ownership

- Selection/presentation worker owns `src/types.ts`, `src/viewport.ts`, `src/interactions.ts`, `src/model-labels.ts`, related presentation modules if required, and a focused new browser helper. It must coordinate any cross-owner need before editing.
- Drawing worker owns `src/drawing*.ts`, `src/drawing-geometry.ts`, `src/drawing-shapes.ts`, drawing-specific tests and a focused new browser helper. It can read viewport internals but requests changes from the selection/presentation owner.
- Root owns the consumer-data boundary correction, coordinates, standard controls, exports, CSS, playground integration, recipes, docs, support checks, browser registration/configuration and combined validation.

Local working tickets intentionally remain unpublished under the user's constraint. They contain the tracker adapter's metadata and share one integration closeout record.
