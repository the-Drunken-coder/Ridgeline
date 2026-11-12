# Map controls and coordinates

**Kind:** spec

Published spec: [GitHub #108](https://github.com/the-Drunken-coder/Ridgeline/issues/108), verified open with `kind:spec` and `spec` on 2026-10-12.

Status: approved follow-up implemented locally in controls and packed workflows; root owns the viewport correction and integrated verification. All 81 support workflows passed across Chromium, Firefox and WebKit on 2026-10-12; the shared closeout records exact inputs and limits.
Recorded: 2026-10-11.
Amended: 2026-10-12 after the red-team review and user approval in the coordinating conversation.
Canonical integration requirements: [Viewport workflow upgrades](https://github.com/the-Drunken-coder/Ridgeline/issues/105).
Approved implementation: [Follow-up ticket](https://github.com/the-Drunken-coder/Ridgeline/issues/112). Root is the integration owner.
Delivery and review: [draft PR #114](https://github.com/the-Drunken-coder/Ridgeline/pull/114). Closed ticket state and historical passing cases do not establish verification of the current requirements.
Publication: user-authorized spec issue published on 2026-10-12. Local approved requirements remain canonical until versioned publication. Authorization covers spec issues and later approved implementation tickets, superseding the earlier tracker-publication restriction below for those artifacts only. Package/website publication, runtime changes, commits, pushes, pull requests, deployment and merging remain outside this authorization.

Existing ownership, options and coordinate requirements remain settled. Implementation failures do not weaken those requirements. The approved follow-up fixes the two reproduced failures and retains the user's chosen equivalent-style entry as local control state. This focused spec follows the canonical integration requirements.

## Problem Statement

Consumers need familiar map navigation, scale, fullscreen and location controls without repeating setup and cleanup in every application. Optional coordinate readouts and basemap choices must remain useful alongside application-owned controls and workspace layouts.

Consumers also need small coordinate utilities that make order, units and precision explicit. Ambiguous input or a mathematically undefined direction must produce an error rather than a plausible but misleading result. These utilities must work independently of a mounted viewport and must not imply coordinate reference system conversion or survey accuracy.

## Solution

Provide an optional attachment that installs native MapLibre controls, accepts their native options and places each control in a chosen map corner. Include opt-in map-center coordinates and a selector for consumer-supplied basemap choices. The attachment owns its controls and subscriptions and retires them when explicitly destroyed or when its viewport is destroyed.

Provide longitude-first decimal-degree, degrees/minutes and degrees/minutes/seconds formatting and parsing, plus horizontal spherical distance, initial bearing and destination helpers. Applications decide what an entered coordinate means and own the surrounding forms, storage, networking and workflows.

## User Stories

1. As a consumer developer, I want controls to be optional, so that I can build a viewport with my own application UI.
2. As a consumer developer, I want a default navigation, scale and fullscreen attachment, so that a common map setup requires little integration work.
3. As a consumer developer, I want to disable individual default controls, so that I can install only the subset my application needs.
4. As a consumer developer, I want native MapLibre options, so that standard control customization does not require a separate Ridgeline configuration system.
5. As a consumer developer, I want to choose each control's map corner, so that controls fit my workspace.
6. As a map user, I want familiar native navigation controls, so that I can change zoom and orientation.
7. As a map user, I want a scale in the application's chosen native units, so that I can judge distances in the current view.
8. As a consumer developer, I want fullscreen to target the viewport by default and accept a different supplied container, so that my application can choose which workspace elements remain visible.
9. As a map user, I want location access to begin when I activate the location control, so that mounting a map does not request my position.
10. As a consumer developer, I want geolocation to be opt-in with a single lookup by default, so that location behavior is an explicit application choice.
11. As a consumer developer, I want to enable native device tracking explicitly, so that I can use MapLibre's supported behavior without adding a Ridgeline follow controller.
12. As a map user, I want native location-unavailable feedback, so that denied permission or unavailable location does not appear to be a successful lookup.
13. As a map user, I want an optional map-center coordinate readout, so that I can identify the geographic center of the current view.
14. As a consumer developer, I want to choose the readout's format and precision, so that it matches the coordinate notation used in my application.
15. As a screen reader user, I want a named coordinate readout without repeated camera-motion announcements, so that I can read it without navigation interrupting other content.
16. As a keyboard user, I want named native buttons and a labeled basemap select, so that I can operate the controls using ordinary browser interaction.
17. As a consumer developer, I want to supply basemap choices and their names, so that Ridgeline does not choose providers or manage a catalog for my application.
18. As a map user, I want a supplied basemap choice to change the viewport immediately, so that choosing a background has a direct result.
19. As a consumer developer, I want the selector to follow external configuration changes, so that application-owned settings and attached UI agree.
20. As a map user, I want the selector to retain the accepted choice when loading fails, so that it does not silently show a different requested configuration.
21. As a map user, I want an unmatched current style to appear as Custom, so that the selector does not falsely identify it as a supplied choice.
22. As a consumer developer, I want basemap changes to preserve viewport features, camera and selection under the existing configuration contract, so that a display change does not replace application data.
23. As a consumer developer, I want supplied basemap choices to be copied on attachment, so that later mutations to my input objects do not silently change attached behavior.
24. As a consumer developer, I want destruction to remove only the attachment's controls, so that my independently installed controls remain available.
25. As a consumer developer, I want repeated destruction and viewport destruction to be safe, so that application teardown does not require coordinating duplicate cleanup calls.
26. As a consumer developer, I want an active native location watch retired and late location results ignored after removal, so that a retired attachment cannot keep moving the map.
27. As a consumer developer, I want documented upstream cancellation limits, so that I can distinguish resources Ridgeline can release from a native one-shot request it cannot cancel.
28. As a consumer developer, I want coordinate helpers without a viewport, so that application-owned forms and calculations can reuse the same geographic conventions.
29. As a consumer developer, I want longitude-first formatting with explicit hemispheres and bounded precision, so that displayed coordinates have a predictable meaning.
30. As a consumer developer, I want parsing to reject malformed, ambiguous, nonfinite and out-of-range input, so that invalid coordinates cannot reach a camera, feature or drawing operation unnoticed.
31. As a consumer developer, I want horizontal distance in meters and initial bearing clockwise from north, so that coordinate calculations use the same units as the existing drawing measurements.
32. As a consumer developer, I want undefined bearings and unsupported pole-origin directions rejected through existing errors, so that a numerical result never invents a valid direction.
33. As a consumer developer, I want destinations to handle date-line wrapping and return a detached origin for zero distance, so that valid calculations respect geographic bounds and ownership.
34. As a consumer developer, I want the limitations of the spherical model stated clearly, so that I do not treat display calculations as terrain-distance or ellipsoidal survey measurements.
35. As a consumer developer, I want packaged examples, public contracts and revision-specific verification, so that I can assess the supported integration without relying on development-only imports or unverified device claims.
36. As a map user, I want my chosen entry's label to remain selected when multiple supplied choices share a style, so that the control respects my choice.

## Implementation Decisions

- Use an optional `attachMapControls` attachment and separate pure coordinate helpers. Keep native camera and location behavior in MapLibre. Do not introduce a toolbar framework or renderer abstraction.
- Calling the attachment without options enables navigation, scale and fullscreen. Geolocation, coordinates and basemap choices require opt-in. Default scale units are native metric units. Each default control can be disabled; native control options pass through.
- Navigation, fullscreen and geolocation default to top-right; scale to bottom-left; coordinates to bottom-right; basemaps to top-left. Placement uses the four native MapLibre control corners. Fullscreen defaults to the viewport container, including when supplied native options omit a container.
- A geolocation attachment does not trigger a position request during setup. The application can explicitly enable native tracking, and the user activates it. Native tracking is consumer-chosen behavior and does not add library-managed feature-follow, clocks, history or replay.
- The coordinate readout displays the map's geographic center, not the pointer, a selected feature or a terrain placement target. It refreshes after camera movement completes and on resize. Displayed longitude is normalized to [-180, 180). The readout has an accessible name and disables live announcements.
- Use native buttons and selects with accessible names and ordinary keyboard operation. Retain the existing dense UI direction, readable narrow layouts and idle behavior. Native controls and the surrounding application retain their respective layout responsibilities.
- Basemap choices contain unique nonempty IDs, names and supplied style URLs or objects. Copy the choices at attachment. Selecting one calls the existing viewport `configure` operation directly. Applications needing approval, persistence or coordinated provider changes own their selector through the public viewport or MapLibre API.
- The selector follows accepted configuration, including external changes and failed asynchronous loading. Unmatched configuration appears as Custom. Matching uses the supplied URL or serialized style-object value; it does not infer provider identity. Loading failure follows the existing diagnostic and recovery contract without automatic rollback.
- `configurationchange` reports a detached snapshot after configuration initiates its renderer update. Acceptance does not imply that a style has loaded or the renderer is ready. Reentrant configuration observers must not skip the requested native style update or overwrite newer accepted configuration.
- Destruction is idempotent, removes only owned control instances, releases owned subscriptions and attempts independent cleanup even if another cleanup fails. The attachment automatically retires with its viewport and handles partial setup. Cleanup and callback failures use existing diagnostic conventions.
- Use public native removal APIs. An active geolocation watch is cleared, and late location results are ignored after removal. MapLibre 6.11.0 exposes no public cancellation for a one-shot request or its ten-second fallback timer. Document this limit rather than modifying private native fields.
- Geographic positions are exactly two finite numbers, longitude then latitude, with longitude in [-180, 180] and latitude in [-90, 90]. Geographic helpers neither accept an altitude nor transform coordinate reference systems. Readout longitude wrapping is a display operation, not general acceptance of unwrapped helper input.
- `formatCoordinate` emits longitude E/W followed by comma-separated latitude N/S. Supported formats are `dd`, `ddm` and `dms`. Defaults are five fractional degrees, three fractional minutes and one fractional second respectively. An explicit precision is an integer from zero through eight in the final unit. Round before splitting minutes and seconds so carry reaches the next unit. Numeric negative zero uses E/N. Precision controls display resolution, not geographic accuracy or stored coordinates.
- `parseCoordinate` accepts two comma-separated longitude-first components in the documented decimal, degrees/minutes or degrees/minutes/seconds notation. A component uses a sign or its appropriate hemisphere suffix, never both. Minutes and seconds must be below sixty; preceding units must be whole. Normalize supported Unicode prime marks and reject malformed or out-of-range values and text longer than 256 characters. Do not guess coordinate order or interpret projected coordinates.
- Distance is shortest horizontal spherical distance in meters. Bearing is the initial clockwise-from-geographic-north direction in [0, 360). Destination accepts a finite nonnegative distance and a finite bearing. Reuse the existing 6,371,008.8-meter spherical Earth model so helpers and drawing measurements agree. Exclude terrain slope, altitude, exaggeration and ellipsoidal calculations.
- Bearing rejects coincident positions, antipodes and exact pole origins through recoverable `RidgelineError` errors with the existing `INVALID_CONFIGURATION` code and operation context. Equivalent date-line endpoints count as coincident. Nearby valid routes remain valid. A non-polar origin may have a valid pole destination.
- Destination rejects positive distance from an exact pole because a north-based direction is undefined there. Zero distance returns a detached copy of the validated origin, including at a pole. Positive-distance output longitude is wrapped. Do not add configurable numerical fallbacks for undefined directions.
- Applications own coordinate entry and its outcome, including camera changes, feature placement and drawing edits. The helper APIs do not install an input workflow, persist preferences, fetch provider catalogs or take ownership of authoritative application data.

### Approved equivalent-style selection

The user rejected the proposed first-equivalent-style rule on 2026-10-12. Selecting a later entry keeps that entry's ID and label while the accepted style remains equivalent. The attachment holds this choice as local UI state. An unrelated configuration patch or an equivalent accepted style does not reset it. A real external style change follows current accepted configuration; an unmatched style displays Custom. With no retained equivalent choice, matching uses the first equivalent entry in supplied order. URL or serialized style-object equality remains the matching boundary. No provider catalog, persistent preference store or public API is added.

## Testing Decisions

- Use the existing packed-package consumer as the highest integration boundary. Exercise exported controls with real native mouse and keyboard input and observe DOM state, accepted viewport configuration and actual renderer output. Do not add production exports or new test-only interfaces.
- Use focused coordinate tests for pure formatting, parsing, validation and spherical calculations. Assert externally observable results and error contracts. Avoid tests that read implementation source or repeat private call sequences.
- Follow the existing control workflow prior art: mount the packed package, install an independent consumer control, activate native navigation, change the camera, destroy repeatedly and verify that owned UI disappears while the consumer control remains. Also verify automatic retirement with viewport destruction.
- Use the existing basemap workflow as prior art for accepted external configuration, native style publication, an unrelated patch from a `configurationchange` observer, failed loading, Custom and recovery. That case changes configuration programmatically. It does not establish user selection or reentry from a real drawing `onPreview` callback.
- Follow the existing native activation workflows: confirm no location request before activation, activate tracking through browser input, verify that removal clears the watch once and that a late result cannot move the camera. A controlled geolocation boundary records request/watch lifecycle without replacing the native control. Exercise fullscreen entry and exit and verify the default target when native options omit a container.
- Cover coordinate boundaries, malformed input, hemisphere/sign ambiguity, rounding carry, negative zero, valid pole destinations, undefined bearings, equivalent date-line endpoints, nearby valid directions and a high-latitude route crossing the date line. Compare parse/format results within format-appropriate tolerances and preserve exact checks for error codes, operation context and coordinate structure.
- For lifecycle and callback changes, test the complete transition rather than only a returned snapshot. The accepted basemap and the native renderer must agree after reentrant callbacks. Preserve an observation interval when verifying the absence of stale work.
- Typecheck public contracts and affected consumers. Run focused module checks, packaged support workflows in Chromium/Firefox/WebKit and library/playground builds as appropriate to implementation changes. Document synthesis requires Markdown link and diff checks, not another runtime-suite run.
- Keep dated execution evidence separate from inspection and review. Current engine tests do not establish installed-browser, physical-device, hardware-GPU, manual screen-reader or long-session memory acceptance.

| Transition | Owner | Observable result | Existing verification boundary |
| --- | --- | --- | --- |
| Camera movement completes or map resizes | Coordinate control | Named output shows the current center in the chosen format | Packed consumer control workflow |
| Basemap changes through the selector or application | Viewport and control attachment | Selector follows accepted configuration; native update starts | Packed consumer configuration workflow |
| Style loading fails or configuration callback reenters | Viewport; selector follows acceptance | Diagnostic remains observable and accepted configuration stays coherent with the requested native update | Failed-style and reentrant browser histories |
| User activates location, then removes attachment | Native geolocation control and attachment | One requested action; watch retired; late result cannot move the camera | Native browser activation with controlled geolocation responses |
| User enters and exits fullscreen | Native fullscreen control | Chosen container enters and exits native or native fallback fullscreen | Native browser activation |
| Attachment or viewport is destroyed repeatedly | Each attachment owns its resources | Owned UI/subscriptions retire; consumer controls remain independently owned | Packed consumer teardown workflow |
| Coordinate input or requested direction is invalid | Pure helper | Existing contextual error; no invented coordinate or direction | Focused public-helper tests |

### Approved acceptance additions

The user approved these histories on 2026-10-12. Packed workflow tests now exercise them through existing public interfaces. They require execution and review by root before acceptance is verified. Prior passing cases do not satisfy these histories.

1. **Drawing-preview reentry, evidence open.** Mount a real viewport, a drawing attachment and the basemap selector with two distinct valid styles. Establish the first native style, an active drawing draft and a nonempty preview cursor. Register a real drawing `onPreview` callback that, once during the requested basemap switch, applies an unrelated configuration patch such as enabling ground lines. Trigger the second basemap through the public configuration API. Require the callback to run; observe that the accepted requested basemap and unrelated patch both survive. Wait for the requested native style and its identifying layer to publish alongside the Ridgeline layers, and verify that the selector agrees. Invoking the callback directly or checking only accepted configuration does not establish this history.
2. **Explicit replacement and destruction, evidence open.** Repeat the drawing-preview callback history with explicit replacement of the requested basemap by a third style. Require the latest accepted style to publish, preserve its configuration, and observe that obsolete requested work does not replace it. In a separate history, destroy the viewport from the callback and mount a replacement in the same container. Require the old canvas and owned UI to retire and the replacement to accept camera movement and a valid control attachment. Observe the absence of obsolete publication for a bounded interval after the relevant work has settled. These are inspection-supported regression risks for the correction; no failure of these two variants was reproduced.
3. **Partial native initialization, evidence open.** Start with a usable viewport and an independently installed consumer control. Cause a real native control's `onAdd` to fail after installing DOM or subscriptions but before native registration makes `map.hasControl` true. Require the test to reach that partial-installation condition; rejection before `onAdd` is not equivalent evidence. Attachment failure must retire all partially installed owned resources and preserve the independent consumer control. Subsequent ordinary camera movement must succeed without leaked listener failures. A subsequent valid attachment must install, respond to native input and retire cleanly, with the consumer control still present. Use supported cleanup interfaces and a controlled native failure boundary without adding production test APIs.
4. **Keyboard basemap selection, evidence open.** Reach the basemap select with real Tab input, choose a different supplied style with native keyboard interaction and commit it as needed by the engine. Observe the selected value, accepted configuration and actual loaded native style with an identifying layer. Keep keyboard operation usable after the update. Calling `configure`, assigning the select value or dispatching a synthetic change event does not satisfy the input requirement.
5. **Equivalent style choices, evidence open.** Supply different choice IDs and labels with identical styles. Choose the later entry with native keyboard input and verify that its own ID and label remain selected while accepted and rendered style remain correct. An unrelated patch preserves that label. A native keyboard choice of a distinct style publishes that style and remains keyboard usable. A real external style change follows accepted configuration. Unmatched configuration displays Custom and can recover to a supplied style. The red-team observation records the rejected previous behavior, not passing evidence for this approved history.

## Out of Scope

- Library-owned coordinate entry, go-to-coordinate, feature placement or drawing-input workflows.
- Coordinate copy buttons, format pickers, pointer-coordinate modes and center-marker UI. These remain uncommissioned optional extensions.
- A basemap catalog, provider credentials, authentication, network services, preference storage, approval callbacks or a configurable style-failure recovery system.
- A custom replacement for native controls, a toolbar framework, automatic control deduplication or a general control registry.
- Coordinate reference system transformations, projected coordinate parsing, altitude conversion, terrain-distance calculations and survey-grade ellipsoidal geodesy.
- Application source data, clocks, history, interpolation, retention, replay and feature-follow policy. The withdrawn motion/replay implementation is historical evidence only.
- Changes to the approved drawing rail and fixed inspector or a new visual direction.
- Tracker publication, commits, pushes, deployment, package publication, pull requests and merging under the existing publishing restriction.

## Further Notes

The original interview's scope and ownership decisions remain settled. The earlier correctness follow-up was implemented and independently reviewed. The later red-team review reproduced two violations of existing guarantees. The user approved their correction and the additional acceptance histories on 2026-10-12, and chose retention of the selected equivalent-style entry. Controls and their workflows are implemented locally; the integrated correction and its execution evidence remain with root. This focused document does not create another live tracker or supersede the canonical integration requirements.

The [public controls and coordinates guide](../../docs/viewport-tools.md#map-controls-and-coordinates) describes the shipped contracts. [ADR-0001](../../docs/adr/0001-consumer-owned-workflows.md) establishes consumer workflow ownership, and [ADR-0002](../../docs/adr/0002-maplibre-extension-access.md) permits direct native integration. Use the [domain glossary](../../GLOSSARY.md) for terminology.

The historical local integration closeout preserved by the integration owner recorded baseline `cbef055b14fe218aa24611031c4ba1a9aa0ed540`, uncommitted handoff runtime digest `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`, review and executed checks. Its support follow-up digest is `1305996ef45c4058170fd5543fb2e93576c2c5c17cca1d81b21e623b6b9cd310`. Coordinate tests and native control workflows have recorded passing evidence for their exercised histories. Those pins remain historical evidence and do not establish the new acceptance histories. Root records the current reviewed and exercised uncommitted inputs separately.

### Findings and evidence status

| Finding | Classification | Evidence and consequence | Status |
| --- | --- | --- | --- |
| Requested basemap skipped after drawing-preview reentry | Medium, reproduced defect and inspection-supported mechanism | Early scene callbacks previously changed configuration identity before native style initiation. Root has moved native work before those callbacks and retained ownership guards. A packed real-preview history requires the requested native style and unrelated patch to survive. | Correction and workflow implemented; verified in the current 2026-10-12 support run |
| Failed native initialization leaves a control and listener | Medium, reproduced defect and inspection-supported mechanism | Cleanup now calls public native removal for the control currently being added even before registration. The packed history observes native partial installation, identical original error, later camera movement, valid attachment and preserved consumer control. | Controls correction and workflow implemented; verified in the current 2026-10-12 support run |
| Basemap selector keyboard action not exercised | Medium, inspection-supported evidence gap | The new journey reaches the selector with Tab and changes styles with native keyboard input, observing accepted configuration and identifying native layers. | Workflow implemented; verified in the current 2026-10-12 support run |
| Equivalent choices resolve to the first label | Low, reproduced behavior now rejected by the user | The attachment now retains the selected ID as local UI state while the style remains equivalent and follows actual external style changes. | Approved policy, correction and keyboard workflow implemented; verified in the current 2026-10-12 support run |
| Replacement/destruction while correcting callback ordering | Inspection-supported regression risk, not a reproduced failure | Packed histories explicitly replace the requested style or destroy the viewport in a real preview callback. They require newest publication, usable replacement controls and bounded absence of obsolete work. | Approved histories implemented; verified in the current 2026-10-12 support run |

### Red-team reproduction provenance, 2026-10-12

The two runtime failures were reproduced through public APIs in the T3 collaborative Chromium preview using a temporary loopback-served page and the existing built library. The library JS SHA-256 was `be52b6fdf4c67baceeb39749a28f170d504e370b7f7bf9def9a3d3a30d62d467`, matching the JS hash recorded in the historical handoff. The installed native dependency was MapLibre 6.11.0. This was one collaborative-browser reproduction, not a new three-engine support run or a revalidation of all 182 source inputs. Results were retained inline in the red-team tool outputs; no new archived producer report was created. The temporary browser fixtures, preview tab and server were retired.

- **Basemap failure.** A real drawing attachment started a line draft, added a point and received a preview cursor through the public API. Clearing that cursor during a switch from First to Second invoked `onPreview` once. The callback enabled ground lines through an unrelated configuration patch. Immediately afterward and after a 600-millisecond observation, accepted style was Second, selector value was `second` and native style was First. The ground-lines change survived. This reproduces skipped publication; it does not demonstrate successful correction or the replacement/destruction variants.
- **Initialization failure.** Attaching controls with `scale: { maxWidth: Infinity }` and fullscreen disabled threw `Invalid LngLat object: (NaN, NaN)` during native setup. One scale element remained while the attachment's navigation buttons had been removed. A subsequent ordinary camera change to `[1, 1]` threw the same error. The viewport was destroyed afterward. This establishes incomplete cleanup; successful subsequent attachment and preservation of an independent consumer control still require the proposed acceptance history.
- **Equivalent-style observation.** Two choice IDs, `first` and `second`, referenced the same style with different labels. Native select automation chose `second`; the resulting selector value was `first` and its displayed label was First label. Accepted style remained Same style. This is evidence of current first-equivalent-style matching, not evidence of user approval or real keyboard acceptance.

The [support matrix](https://github.com/the-Drunken-coder/Ridgeline/issues/105) distinguishes exercised engines from physical devices, installed browsers, hardware performance, manual screen readers and long-session memory acceptance. These verification limits and the native one-shot cancellation limit are not unresolved product decisions. That 2026-10-12 handoff described local uncommitted inputs; current integration evidence is recorded in draft PR114.

### Controls follow-up handoff, 2026-10-12

The controls worker reviewed its local additions against the approved ticket and lifecycle, rendering, interaction and testing standards. Controls-only strict TypeScript passed. The five existing coordinate tests passed, and the focused spec's relative file and heading links and the three owned files' whitespace passed. These checks do not execute the new packed browser histories. Root owns combined review, packaged browser execution and the final revision pins in the shared closeout.

The reviewed controls input SHA-256 is `cc48f66d8a473b1a1ebf7fb12f3130326c49ffa8a382267a00c81acf5a0e9032`; the reviewed workflow input is `93143cf34270edb9456d8366f001ba6fae7d6ec69efe7c81f9454f1c0fc0d708`. The worker did not rebuild or replace shared package/browser outputs. An intermediate whole-repository typecheck had no controls-slice errors but encountered concurrent root edits, so it is not a passing integrated result.


## Integration lifecycle coverage, 2026-10-13

| Transition | Result owner | Required outcome | Executable coverage |
| --- | --- | --- | --- |
| Select a serialized-equivalent basemap label | Viewport configuration and optional selector | Keep native source/layers and the selected label; do not reload identical styles | Native keyboard equivalent-choice case |
| Retire an attachment or viewport while its fullscreen is active | Fullscreen adapter | Remove owned fullscreen layout, exit owned native fullscreen and restore the previous cooperative-gesture state | Native fullscreen retirement case |
| Retire a pending native fullscreen entry | Entry promise owner | Late owned entry exits, with no replacement-owner cleanup | Independent lifecycle review; late browser-request histories remain explicit review targets |
| Consumer-owned fullscreen or independent controls coexist | Consumer remains their owner | Attachment cleanup leaves them intact | Control partial-initialization/ownership cases; same-target pending fullscreen takeover is a browser coordination limit |
