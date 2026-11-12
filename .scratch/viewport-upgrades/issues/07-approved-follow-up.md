# Complete approved spec follow-up

Kind: implementation
Status: resolved locally, uncommitted and unpublished
Spec: [Viewport workflow upgrades](../spec.md)
Blocked by: none
Acceptance depends on: drawing, controls, adoption and root deliveries below
Integration owner: root; [shared closeout](../closeout.md)

User approval: coordinating conversation, 2026-10-12. All work remains local, uncommitted and unpublished.

## Ownership

- Root owns the canonical spec, this ticket, shared README/guides, selection/presentation focused specs, viewport changes, selection and appearance modules/tests, browser registration and integrated verification.
- Drawing worker owns the focused drawing spec, drawing controls and drawing-specific tests, including the packed drawing workflow. It does not edit shared viewport, docs or registration files.
- Controls worker owns the focused map-controls/coordinates spec, controls module and packed controls workflow. It supplies the proposed viewport configuration correction to root without editing the viewport.
- Adoption worker owns starter files, packed starter tests, consumer preparation/validation tooling and relevant tooling tests. It does not edit shared specs, README, registration or viewport files.

## Acceptance criteria

- Real renderer context loss during an acquired box gesture cancels feedback, capture and ownership with no selection request. Release while lost preserves the selected IDs. Restoration permits a later gesture. A request-only consumer retains selection until explicitly applying a filtered proposal.
- Invalid polygon topology preserves raw session measurements and the editable/undoable draft, blocks submission, and shows area as unavailable in drawing controls. Undo restores meaningful displayed area. Composed rendered evidence proves the direction arrow remains visible beside its edit handle.
- Consumers can disable selected or hover appearance per feature and set model brightening explicitly, including zero. Defaults remain compatible. Selection identity and selected-label priority remain independent of feedback suppression. Explicit style refresh uses current stored features without emitting a data replacement, preserves camera/selection/drawing drafts, isolates failures and discards obsolete callback work. Native and model labels have visible-glyph evidence for selection, suppression, reload and deselection.
- Basemap switching from a real drawing-preview callback preserves an unrelated nested patch and publishes the requested native style. Explicit replacement publishes the newest style; callback destruction leaves a usable replacement viewport. Partial native control initialization is cleaned up before rejection, preserving independent consumer controls and later camera/control usability. Native keyboard basemap selection loads the selected style. Selecting an equivalent-style entry retains its own label while unchanged accepted style remains equivalent; a real external style change follows current configuration.
- Failed starter restoration preserves original bytes and rejects submissions with accepted data unchanged and draft retained. Ordinary remount/Reset cannot bypass protection. Explicit recovery or clearing permits saving. Existing consumer validation requires the starter's own fresh install/build and validates final package file/heading links. Broken starter configuration and broken archive links fail the gate independently of the generated consumer.
- Root reviews the combined diff, runs applicable checks and records exact reviewed/exercised uncommitted input pins. Historical evidence remains unchanged; unavailable physical-device/hardware/screen-reader checks remain explicit.

| Transition | Owner | Observable result | Verification |
| --- | --- | --- | --- |
| Context lost, released and restored during selection | Root | Gesture cancels, selection survives, next gesture works | Real packed consumer context/input history |
| Hole invalidated and undone | Drawing worker | Raw measurement retained, UI area unavailable, valid undo restores area | Session and packed control history |
| Feedback disabled or palette refreshed | Root | Current pixels update without source-data/draft changes | Packed native/model consumer histories |
| Basemap callback reenters or control setup fails | Controls worker; root viewport integration | Current style publishes; partial owned resources retire | Real native control/drawing callback histories |
| Restore fails then save/remount/recovery occurs | Adoption worker | Original storage stays intact until explicit recovery | Packed starter journey |
| Starter build or packaged link fails | Adoption worker | Consumer validation fails | Actual isolated build/archive boundary |

## Closeout evidence, 2026-10-12

All acceptance criteria above are implemented and locally verified at uncommitted digest `91abf5465d9d319c5af473975da1321dcf626a7e7a8a670f531c610bb92c27b1`. The [current closeout](../closeout.md#approved-follow-up-2026-10-12) maps each criterion to execution and review evidence, including 81 three-engine support workflows, 41 additional packed Chromium regressions, 435 library/tooling and five control-lab tests, own-starter build and package checks. Physical-device/hardware/screen-reader limits remain explicit. No hosted or merge-ready claim is made.


## Integration regression transitions, 2026-10-13

Historical completed ticket state does not certify the five integration candidates. The canonical [drawing transition table](../drawing-spec.md#integration-transition-coverage-2026-10-13), [selection transition table](../multi-selection-spec.md#integration-transition-coverage-2026-10-13), and [controls lifecycle table](../../map-controls-coordinates/spec.md#integration-lifecycle-coverage-2026-10-13) assign current outcomes and executable evidence. Tests and independent reviewer reports remain separate. The approved manual merge order is controls/coordinates, appearance, selection, drawing, then adoption/starter; each draft PR identifies its exact base and reviewed/exercised head.
