# Feature presentation

**Kind:** spec

Published spec issue: [Feature presentation #104](https://github.com/the-Drunken-coder/Ridgeline/issues/104).

Status: approved follow-up implemented locally on 2026-10-12, with current three-engine support execution recorded in the shared closeout. The user accepted retention wording, visible-glyph acceptance, per-feature feedback control and explicit style refresh. The [integration ticket](issues/07-approved-follow-up.md) assigns root implementation and verification ownership.

Canonical scope: [Viewport workflow upgrades](spec.md#selection-and-presentation), including its [accepted corrections](spec.md#thread-review-corrections).

Verification record: [Viewport upgrade closeout](closeout.md).

## Problem Statement

Consumers need geographic features to communicate identity, meaning and interaction state clearly. The existing style accessor should cover common label, icon, line and highlight customization without requiring applications to modify Ridgeline's rendering layers.

Appearance must remain predictable when a feature is selected, hovered, drawn, airborne or represented by a model. A saved solid drawing must stay solid. Selecting a thick line must preserve its thickness. Map-relative icons must retain their orientation as the camera turns. In crowded views, selecting a feature should give its label first opportunity at space while preserving collision suppression.

Approved retention clarification, 2026-10-12. Rejected styling updates must preserve the affected feature's last accepted display when a working publication/source remains available, while unrelated updates continue. Resource loss and source recreation follow the existing recovery contract: context loss can withhold output, and a replacement source reconstructs successfully prepared current features. Failed reconstruction remains diagnosable and retryable without promising preserved old pixels.

## Solution

Extend the existing style accessor with label presentation, registered-icon presentation, explicit line dash arrays and the documented selected/hover overrides. Validate and snapshot callback output before publication. Apply the same applicable presentation rules to native markers, airborne fallback markers and model labels.

Keep appearance configuration separate from authoritative application data and physical model settings. Consumers supply icons, glyph availability, current feature geometry and entity pose. They refresh external style changes through an explicit style refresh using current stored features, without replacing application data. Ridgeline displays the accepted presentation, applies interaction feedback and gives selected labels placement priority without enabling overlap.

## User Stories

1. As a consumer developer, I want to use the existing style accessor for feature appearance, so that common customization stays within one supported integration.
2. As a consumer developer, I want styling callbacks to retain my application property types, so that I can derive appearance from feature data without losing type information.
3. As a consumer developer, I want stroke, dot and fill settings with useful defaults, so that ordinary points, lines and polygons are readable without a complete style definition.
4. As a consumer developer, I want configurable label text, so that map annotations express application meaning independently of stable feature identity.
5. As a consumer developer, I want configurable label fonts and size, so that annotations fit the application's available glyphs and visual language.
6. As a consumer developer, I want configurable label color and halo, so that text remains readable against the chosen basemap.
7. As a consumer developer, I want label anchor and offset controls, so that text can occupy the intended position relative to a feature.
8. As a consumer developer, I want documented text-relative label offsets, so that spacing changes predictably with text size.
9. As a map user, I want colliding labels suppressed, so that crowded views remain readable.
10. As a map user, I want selected labels prioritized over unselected labels, so that my current selection receives the first opportunity at available space.
11. As a map user, I want collision suppression retained between selected labels, so that selecting several nearby features does not force overlapping text.
12. As a map user, I want deselection to restore ordinary label placement, so that temporary selection priority ends with the selection.
13. As a consumer developer, I want label priority changes without replacing feature data or moving the camera, so that interaction feedback stays within the viewport's responsibility.
14. As a consumer developer, I want to use application-registered icons, so that asset choice and fetching remain under application control.
15. As a consumer developer, I want icon size expressed as a multiplier of the registered image's logical size, so that image pixel ratio and display scaling remain predictable.
16. As a consumer developer, I want icon rotation and map-relative or viewport-relative alignment, so that a symbol's orientation follows its intended frame of reference.
17. As a consumer developer, I want configurable icon anchors, so that the intended part of an image attaches to the feature position.
18. As a consumer developer, I want explicit dash arrays alongside the existing dashed shorthand, so that lines can express distinct application meanings.
19. As a consumer developer, I want documented stroke-relative dash lengths, so that pattern proportions follow line width consistently.
20. As a consumer developer, I want saved drawing appearance to override the accessor's corresponding settings, so that stored drawing choices survive reload and application styling changes.
21. As a map user, I want a saved solid drawing to stay solid even when the accessor supplies a dash array, so that its accepted appearance remains trustworthy.
22. As a consumer developer, I want the documented selected and hover fields to override appearance independently, so that changing one field preserves the other fields' behavior.
23. As a consumer developer, I want explicit selected values to take precedence over hover values for the same field, so that simultaneous interaction states resolve predictably.
24. As a consumer developer, I want explicit hover values retained when selection omits that field, so that partial selected overrides do not erase unrelated hover appearance.
25. As a map user, I want default selection feedback to preserve an already thick line, so that selection does not weaken its visible outline.
26. As a consumer developer, I want applicable highlight color and radius settings honored by airborne fallback dots, so that moving between ground and airborne presentation preserves interaction meaning.
27. As a consumer developer, I want model labels to share label settings and selected-label priority with ordinary features, so that representation changes preserve annotation behavior.
28. As a map user, I want directional model labels placed clear of the displayed model bounds, so that the model and its annotation remain distinguishable.
29. As a consumer developer, I want icon size, rotation, anchor and opacity independent of physical model dimensions and pose, so that presentation changes cannot alter the supplied entity's physical meaning.
30. As a consumer developer, I want invalid styling rejected before publication, so that a malformed field cannot partly replace a working presentation.
31. As a consumer developer, I want copied callback inputs and nested style values, so that later mutation cannot alter accepted feature data or displayed appearance implicitly.
32. As a map user, I want a rejected styling update to retain the previous display while its working publication/source remains available and unrelated updates continue, so that one rejected update does not disrupt the viewport. This clarification was approved on 2026-10-12.
33. As a consumer developer, I want contextual diagnostics and explicit recovery using current stored data, so that I can repair failures without stale work overwriting newer updates.
34. As a consumer developer, I want to refresh appearance independently of feature replacement, so that palette changes do not replace application data or interrupt drawing.
35. As a consumer developer, I want successfully prepared current features and selected-label priority reconstructed after a basemap reload, with failures diagnosable and retryable, so that configuration changes preserve feature identity and interaction state. This clarification was approved on 2026-10-12.
36. As a consumer developer, I want rectangle queries to respect the effective opacity of native icons and fills, so that invisible representations do not create unexpected selection hits.

## Implementation Decisions

- Keep the existing viewport style accessor as the public entry point. Extend its typed presentation values rather than introduce a separate styling controller or renderer configuration system.
- Support base color, radius, line width, fill color/opacity, dashed shorthand, explicit dash arrays, registered icon identity, icon presentation, label text, label presentation and existing model appearance.
- Label presentation supports font names, size, color, halo color/width, anchor and a two-component offset. Sizes and halo widths use CSS pixels; offsets use text-size units. Anchors name the attached edge of the text, rather than the desired side of the feature.
- Preserve label defaults of Noto Sans Regular, 12 CSS pixels, color #203b32, white halo of 1.5 CSS pixels, top anchor and offset [0, 1.8]. An explicit non-top anchor with no offset uses [0, 0]. Font availability remains a consumer responsibility through the basemap glyph source or local font configuration.
- Icon presentation supports size multiplier, clockwise rotation in degrees, map-relative or viewport-relative alignment and anchor. Defaults remain size multiplier 1, rotation 0, viewport alignment and center anchor. Image pixel ratio determines logical image size; Ridgeline does not fetch application icons.
- Use the native renderer's supported constant alignment settings to preserve the requested icon orientation. Both alignment choices remain available through the existing per-feature accessor.
- Dash arrays alternate dash and gap lengths in line-width units. An explicit array overrides the dashed shorthand for ordinary features. The legacy dashed pattern remains [3, 2], and omitted dash settings remain solid.
- Saved drawing appearance owns its stroke, fill, width, opacity, dash choice and label. A saved solid choice suppresses an accessor dash array. Saved shape definitions and geographic geometry retain their existing storage contract.
- Retain the documented highlight fields: color, radius, line width, fill color, fill opacity, label color and icon opacity. Resolve each field independently. An explicit selected value wins over an explicit hover value; absent selected values retain applicable hover values before state defaults. Empty highlight objects retain existing feedback.
- Preserve default selection emphasis without shrinking an already thick line. Explicit highlight widths remain authoritative, including intentionally smaller values. State color does not implicitly recolor every fill, label or model body; those retain their own settings.
- Apply highlight feedback without requiring consumers to replace features. Ground and airborne dots honor applicable color/radius overrides. Model feedback rings use highlight color and line width; per-state model brightening is configurable from zero to one.
- Give selected native and model labels placement priority over unselected labels. Retain collision suppression, including between selected labels. Selection, deselection and basemap reload update placement without replacing consumer features or changing the camera.
- Reuse native label layout and collision handling for model labels. Directional anchors receive additional offset to clear projected model bounds. A center anchor retains the consumer's requested offset. Retire outdated label layouts and their picking metadata together while current placement catches up.
- Keep model appearance, entity pose and physical scale with their established settings. Icon styling cannot resize, rotate or hide a model or change physical attachment dimensions. Attachments retain their existing appearance contracts.
- Validate and snapshot callback output before renderer-owned state changes. Font lists contain 1 to 16 nonempty names. Offsets contain two finite numbers. Dash arrays contain 1 to 32 nonnegative finite lengths and at least one positive length. Sizes that require positive values remain positive; opacity stays between 0 and 1. Reject malformed or sparse arrays and unsupported colors or anchors.
- Approved retention clarification, 2026-10-12. Rejected styling updates retain the affected feature's last rendered version when a working publication/source remains available and report contextual diagnostics, while unrelated updates and removals proceed. Accepted store data may differ from displayed data until recovery. Preserve the existing recovery policy: failed updates do not retry automatically; retry is explicit through retryUpdates or a newer upsert, uses current stored inputs and cannot overwrite newer queued work. Context loss can withhold output while retaining accepted data and selection. A replacement source reconstructs successfully prepared current features; failed reconstruction remains diagnosable and retryable, without promising old pixels survive resource loss or source replacement. These descriptions clarify the accepted contract and propose no new recovery behavior. Existing guarantees remain requirements if implementation violates them.
- Consumers call refreshStyles for all current stored features or a supplied ID subset after external appearance changes. Unknown IDs are ignored. It does not replace accepted feature data, emit datachange, change selection/camera or interrupt drawing drafts. Callback failures retain working publication and unrelated appearance can update; obsolete callback results are discarded. Selection and hover feedback remain independent of feature replacement.
- Each selected/hover appearance can set enabled to false. Disabled selection suppresses hover appearance while selected, retaining base appearance without changing selection identity or label priority. Model brightening accepts a finite zero-to-one value, defaulting to 0.18 selected and 0.08 hovered. Explicit zero disables brightening independently of the feedback ring; ring width zero hides only that ring.
- Rectangle queries use effective selected/hover opacity for native icons and fills. Their existing conservative limits for custom geometry and model boxes remain unchanged.
- Keep presentation work driven by data, interaction or view changes. Accepted callbacks, rendering and picking must belong to the current viewport and feature state, including after reentrant callbacks. Destruction retires owned work and resources; idle views remain idle.

## Testing Decisions

- Use the existing packed-package viewport consumer as the main test boundary. It imports the public library without development source aliases and exercises styling, registration, selection, preview, updates, recovery and basemap changes through their existing interfaces. This is the already agreed acceptance boundary; no new public testing API is needed.
- Test externally visible behavior: rendered pixels, collision-placed label identities, query results, feature snapshots, camera state and contextual diagnostics. Publishing a renderer property alone does not establish correct orientation or visible feedback.
- Reuse the existing presentation workflow cases for selected-label priority and conformance corrections. For both ordinary and model representations, select a previously hidden colliding label, select both labels, reload the basemap and deselect. Retain assertions for collision-query identity, continued suppression and unchanged consumer data and camera. The approved visible-glyph acceptance below adds proof of the actual drawn result to these histories; existing query-only passes do not supply that evidence.
- Reuse packaged presentation coverage for saved solid drawings, thick selected lines, simultaneous selected/hover overrides, airborne highlight pixels and map-aligned icon rotation under camera bearing changes. Verify zero-opacity native icon/fill representations are excluded from rectangle results while independently visible parts retain their normal behavior.
- Reuse the existing configurable-presentation workflow for valid label/icon settings, nested output mutation, invalid output, retention of prior display, explicit retry and basemap restoration. Observe unaffected features and current stored inputs as well as the failed feature.
- Retain focused style-validation and expression tests for malformed values, sparse arrays, nested snapshots, dash/font patterns and per-field precedence. These support the public workflows rather than substitute for rendering evidence.
- Reuse model presentation and entity lifecycle coverage for directional label clearance, collision suppression, representation changes, retained pose during styling failure and recovery after callbacks replace current work. Preserve drawing storage and reload coverage for saved appearance authority.
- Favor real browser input when testing hover and selection workflows. Do not add source-text assertions, export internal helpers solely for tests, or mock away asset loading, native placement or publication failures.
- Keep evidence tied to the exact exercised inputs and environment. The combined closeout records review and execution separately. Browser-engine checks do not certify physical devices, installed browsers, hardware performance, screen readers or long-session memory.

### Approved visible-glyph acceptance

Selected-label placement priority and collision suppression remain settled requirements. The approved acceptance additions require actual visible glyphs alongside collision-query identities at the existing packed-package consumer boundary. These automated assertions are implemented, with current three-engine support execution recorded in the shared closeout; a rendering defect has not been reproduced.

- Exercise both native point labels and model labels with known available local glyphs and distinguishable label colors or pixel signatures. Establish a visible baseline for the one collision-placed label. A query result alone or an optional branch that skips glyph observation cannot satisfy a visible-label assertion.
- Select the previously hidden feature without replacing consumer data. Require its identity in the collision query and its identifiable glyph pixels on screen. Verify that the previously visible, now suppressed label does not remain drawn.
- Select both colliding features and require continued suppression, with visible glyph evidence for the placed query identity. Deselect and verify ordinary collision placement and its corresponding visible glyphs. Preserve the existing feature-snapshot and camera assertions.
- Reload the basemap with a selected feature, observe the replacement source and current layout, then require the selected query identity and its visible glyph pixels again. Deselect after reload and observe ordinary placement with visible glyph evidence. Both native and model histories must reach every required observation after publication settles.

## Out of Scope

- Full parity between highlight fields and every base appearance field, including state-specific font, label size/halo, icon scale/rotation and model appearance.
- Automatic observation of external palette changes or a separate styling controller.
- Always-show selected labels, collision bypass, a configurable label priority system, alternative-anchor search or automatic font installation and availability probing.
- Automatic icon rotation from entity heading, changing physical model dimensions through icon settings, or extending attachment appearance controls.
- Authoritative data storage, networking, historical samples, clocks, interpolation, retention, replay, timeline scrubbing and camera-follow policy.
- Changes to the approved drawing rail/fixed inspector, decorative interface elements or continuous idle animation.
- Package or tracker publication, commits, pushes, deployment, pull requests and merge operations under the standing publishing restriction.

## Further Notes

The interview has no remaining material product question. The user accepted selected-label placement priority with collision suppression in the coordinating conversation. Full highlight parity remains outside this scope. The user approved feedback suppression, configurable model brightening and a small explicit style refresh on 2026-10-12.

### Red-team disposition, 2026-10-12

- Confirmed specification conflict: the blanket retained-display promise for resource failures exceeded the accepted retained-source/resource-recreation contract. The proposed wording corrections narrow that promise and preserve existing recovery requirements.
- Inspection-supported risk: collision-query identities can be returned for labels whose paint opacity prevents visible glyphs. This does not establish that selected-label rendering is broken.
- Outstanding automated evidence: identifiable visible-glyph assertions alongside query identities for native and model selection, deselection, continued collision suppression and basemap reload. The acceptance additions are approved and implemented, with verified in the current 2026-10-12 support run.
- Reproduced implementation defects: none newly reproduced in this review or document amendment. Prior conformance fixes and their dated evidence remain recorded in the shared closeout.

This focused synthesis supplements the canonical viewport-upgrades scope; it does not replace that scope, the public API guide or the shared closeout. Use [Feature presentation](../../docs/viewport-tools.md#feature-presentation), [Features and updates](../../README.md#features-and-updates), [Shared models](../../README.md#shared-models) and the [selection/presentation ticket](issues/01-selection-presentation.md) as linked context. The [consumer ownership decision](../../docs/adr/0001-consumer-owned-workflows.md), [MapLibre extension decision](../../docs/adr/0002-maplibre-extension-access.md) and [drawing storage decision](../../docs/adr/0003-preserve-drawing-shape-definitions.md) remain in force.

The 2026-10-11 closeout records handoff runtime digest d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3 above baseline cbef055b14fe218aa24611031c4ba1a9aa0ed540. It reports 426 library/tooling and 5 control-lab tests, 51 support cases across Chromium/Firefox/WebKit before the final two-file drawing-arrow adjustment, 9 drawing support cases after it, 50 broader packaged rendering cases, typechecks and production builds. Presentation inputs were unchanged by that final drawing adjustment. These are dated delivery results, not checks newly executed while writing this spec.

Those historical query-only priority passes remain evidence for their original assertions. They do not satisfy the additional visible-glyph acceptance histories. The approved follow-up changes runtime inputs; it preserves the historical verification pins and records current evidence separately.

Physical devices, pen input, installed browsers, target GPU performance, manual screen readers and long-session memory remain verification limits. They are separate from settled presentation behavior. The broader full regression suite and single-command validation were not claimed as newly completed by the follow-up. All delivery changes remain unpublished and uncommitted.
