# Keep sensor-camera coverage clear during updates

Status: ready-for-agent

## Problem Statement

A moving sensor camera's coverage must remain easy to follow while replacement coverage is calculated. If its camera overlay advances before its outline or wireframe, the display tells two different stories about the same sensor. Removing otherwise usable coverage during every update also makes movement harder to follow.

The user prioritizes clarity and a stable display over showing the newest sensor position immediately. A slow sensor should not hold up other sensors. A confirmed failure should remove the affected coverage while leaving the entity visible under its existing placement rules.

These requirements are currently coordinated across entity preparation and GPU publication. Existing tests and recent fixes already protect important parts of the behavior. The work is to give sensor-camera completion one owner and preserve those protections, with explicit handling of the agreed delay and failure behavior.

## Solution

Keep each sensor camera's previous completed coverage visible while its replacement is being calculated. Publish the replacement camera overlay together with the outline, volume, and wireframe that belong to that same result. Each sensor camera may advance independently; a slower sensor retains its previous result while others update.

Distinguish an ordinary delay from confirmed unavailability. During a delay, keep the previous result. When required elevation data cannot be obtained or calculation fails, remove the affected camera output and report the existing unavailable state. Preserve the entity and unrelated attachments according to their existing placement and visibility rules. Before a camera has any completed result, show no fabricated coverage.

The existing controls, visual styling, terrain visibility calculation, selection behavior, and retry operation remain in place. Consumers do not need a new API. Internally, one sensor-camera coverage module will coordinate preparation, publication, matching geometry, completion, and recovery.

## User Stories

1. As a map user, I want the previous completed camera overlay to remain visible during movement updates, so that I can follow the sensor without repeated gaps.
2. As a map user, I want coverage and its outline to update together, so that the boundary describes the coverage I am seeing.
3. As a map user, I want the camera volume and wireframe to match the displayed coverage, so that its direction and extent remain understandable.
4. As a map user, I want a completed update to appear even while further movement continues, so that a continuously moving sensor does not leave the display permanently frozen.
5. As a map user, I want each sensor camera to update when its result is ready, so that a slower sensor does not delay the rest.
6. As a map user, I want multiple cameras attached to one entity to follow the same update rules, so that their behavior is predictable.
7. As a consumer, I want coverage readiness to wait for every currently required camera on an entity, so that one completed camera does not falsely imply all cameras are current.
8. As a consumer, I want an older completed result to remain distinguishable from the latest requested result, so that visible historical coverage is not reported as current.
9. As a map user, I want an initial camera calculation to leave coverage absent until it has a result, so that the viewport does not display invented coverage.
10. As a map user, I want a slow calculation to retain its previous result without an arbitrary expiry, so that ordinary delays do not cause flicker.
11. As a map user, I want affected coverage removed after a confirmed calculation failure, so that a failed sensor does not leave an indefinitely frozen overlay.
12. As a map user, I want my entity to remain visible when its camera coverage fails, so that I can still locate it whenever its placement is valid.
13. As a map user, I want unrelated entities and non-camera attachments to remain usable during a camera-rendering failure, so that a coverage problem does not erase other map information.
14. As a map user, I want missing elevation to remain unknown, so that unavailable terrain is not drawn as visible or blocked ground.
15. As a consumer, I want pending elevation preparation and confirmed elevation unavailability to produce the existing loading and unavailable states, so that my application can distinguish waiting from failure.
16. As a map user, I want retry to recover coverage using the sensor's current position and settings, so that recovery does not bring back an obsolete result.
17. As a map user, I want removing a sensor camera to remove all of its displayed coverage and geometry, so that removed attachments do not linger.
18. As a map user, I want removing an entity to remove its camera attachments, so that the viewport continues to reflect the data I supplied.
19. As a map user, I want hiding camera coverage to hide its overlay, volume, and wireframe together, so that the visibility control has a consistent effect.
20. As a map user, I want showing coverage again to restore results for the current sensor state, so that hidden work does not restore outdated geometry.
21. As a map user, I want a late calculation to respect removal and visibility changes, so that old work cannot make an unwanted camera reappear.
22. As a map user, I want switching between plain overlays and terrain visibility to preserve the existing controls and appearance options, so that I do not need a different interaction model.
23. As a map user, I want colors, fill opacity, borders, volumes, and wireframes to keep their existing meanings, so that saved sensor settings remain familiar.
24. As a map user, I want changes to sensor direction, field of view, and range to produce matching coverage and geometry, so that the whole camera display describes one result.
25. As a map user, I want a basemap replacement to restore current camera output, so that changing map context does not permanently lose sensor coverage.
26. As a map user, I want projection and terrain exaggeration to preserve the physical meaning of coverage, so that presentation settings do not change which terrain the sensor can see.
27. As a map user, I want clicking a visible camera overlay, volume, or wireframe to identify its owning attachment, so that I can continue selecting the intended sensor.
28. As a map user, I want existing ground, airborne, below-terrain, and missing-altitude behavior to remain intact, so that improving camera updates does not change entity placement.
29. As a consumer, I want existing entity state, change events, diagnostics, and retry operations to remain compatible, so that adopting this change does not require rewriting my application.
30. As a consumer, I want movement timing and application workflows to remain my responsibility, so that Ridgeline remains usable in different applications.
31. As a consumer, I want camera resources and pending work released on removal or destruction, so that repeated use does not retain obsolete rendering work.
32. As a maintainer, I want completion behavior tested through observable results and real packaged browser checks, so that future internal changes cannot silently break the agreed display behavior.

## Implementation Decisions

- Introduce one internal sensor-camera coverage owner for both plain overlays and terrain-visibility cameras, including their volumes and wireframes. The entity module retains entity placement, markers, non-camera attachments, and composition of the existing public entity state.
- The entity scene supplies resolved placement and current camera/display inputs. The camera owner coordinates camera-specific terrain preparation, requested values, displayed results, matching geometry, readiness, and recovery. Expose only the operations and results its caller needs; do not make the caller coordinate GPU equality and publication again.
- Keep elevation access shared. Entity placement and ground areas also use elevation data. Camera-specific preparation requirements and cached terrain patches belong to the camera owner, without moving unrelated elevation consumers into it or creating duplicate elevation sources.
- Preserve both supported elevation sources: raw raster elevation and the consumer-supplied sampler with optional asynchronous preparation. A still-pending preparation is loading; missing required samples after preparation has settled are unavailable. Never substitute known-visible terrain for unknown samples.
- Identify a camera by its entity identity and attachment identity. Removal and replacement must affect only the active camera lifecycle; reusing an identity must not allow an old completion to restore prior output.
- Retain GpuCameras as a private WebGL adapter with its existing rendering and resource-management work. One owner should make the camera completion decisions, while the adapter remains responsible for GPU submission, readback, and resource handling. Keep the useful existing separation rather than merging files solely to reduce file count.
- EntityScene must no longer import GPU equality rules or keep its own requested-versus-displayed camera bookkeeping. The camera owner reports completed geometry and camera status. EntityScene may combine camera status with other entity state but must not reimplement camera completion.
- Publish each completed camera overlay with geometry derived from that same submitted input. While a replacement is pending, retain the previous completed output as a unit. A coherent intermediate result may appear during continuous movement; it must not make a newer outstanding request ready. Preserve suppression of obsolete appearance results.
- Camera publication is independent. For an entity with required terrain-visibility cameras, the camera contribution to readiness remains loading until every required current camera has a matching completed result. Cases that require no GPU result must continue to settle without waiting for one. Do not redesign unrelated aggregate entity readiness semantics in this work.
- A confirmed failure or confirmed missing required data clears the affected camera's displayed output and reports unavailability. A slow operation alone does not establish failure. Preserve current diagnostic and explicit retry behavior.
- Preserve the existing scope of failures. A shared WebGL failure may invalidate all terrain-visibility cameras using that renderer. Independent publication does not promise per-camera recovery from a shared renderer failure. Plain entity placement and unrelated attachments remain outside that failure scope.
- Retry uses current accepted inputs and resets the necessary failed work. Removal, hiding, invalidating configuration changes, and destruction prevent obsolete completions from restoring output. Basemap replacement can republish current results through the existing attachment lifecycle.
- Keep existing terrain caching, reuse of visibility calculations for appearance-only changes, and shared GPU targets. A camera publication must not resubmit unchanged ground geometry. These are existing protections, not a new performance claim.
- Preserve public feature, attachment, entity state, event, diagnostic, picking, visibility, and retry contracts. No new exported types, renderer API, schema, application control, or loading animation is required.
- Preserve finite range, sensor bearing and elevation angle, fields of view, terrain visibility, and display exaggeration semantics. The user's preference for clarity permits a brief display delay; it does not authorize a less correct visibility calculation.
- Follow ADR-0001, Keep application workflows with consumers. Follow ADR-0002, Allow explicit MapLibre access for advanced integrations. Keep direct MapLibre access explicit in rendering code and do not introduce a universal rendering-engine abstraction.

## Testing Decisions

- A good test starts with supported inputs and checks the resulting display, attachment identity, readiness, diagnostics, recovery, or cleanup. Avoid assertions about private maps, helper call order, or module layout. Use controlled completion to expose ordering errors rather than timing-dependent sleeps.
- Prefer the existing packaged-consumer viewport boundary as the highest integration seam. The suite builds and packs Ridgeline, installs the package into a separate consumer, and runs it in a real browser without source aliases. Exercise updates, removal, configuration, state reads, picking, and retry through that boundary.
- Add at most one focused private lifecycle seam at the sensor-camera owner's input/output boundary. A controlled-completion implementation of the private rendering adapter can hold, complete, or fail camera work. Observe the owner's completed display outputs and status; do not reproduce the GPU algorithm in a fake or expose test hooks in the public API.
- The behavioral checks are the user's agreed scenarios: continuity while waiting, matching replacement geometry, independent sensor updates, and removal after confirmed failure. The private mechanism used to control completion is an engineering choice, not an additional product decision.
- Test a camera moving after a completed result: its previous output remains paired while replacement work is pending, then the replacement overlay and geometry appear together. Include continuous updates so an intermediate completion cannot falsely mark the newest request ready.
- Test two cameras completing in different orders, including cameras on the same entity. The first may publish while the second retains its prior result or remains absent on initial load. Entity camera readiness must not become ready until all required current results match.
- Test superseded input and obsolete completion after removal, hiding, identity reuse, retry, and configuration invalidation. Verify no removed output returns and recovery uses current inputs. Group cases where they share the same contract rather than adding repetitive tests for every helper.
- Test a previously displayed camera failing, not only failure on first allocation. Its overlay and matching geometry disappear, its entity retains valid placement, the existing diagnostic is reported, and explicit retry restores current output. Retain a ground-area entity in the scenario to verify that unrelated coverage survives a shared GPU failure.
- Test incomplete elevation while preparation is pending, then both outcomes: preparation supplies the missing terrain and coverage recovers, or required samples remain unknown and coverage becomes unavailable. Preserve the existing raster/custom-sampler recovery checks.
- Retain real packaged WebGL checks for terrain visibility pixels, terrain placement, finite range, wireframe matching, GPU fences and readback, appearance-only analysis reuse, shared targets, allocation-failure cleanup, style rebuilds, removal, and visibility toggles. A controlled adapter cannot establish shader correctness, actual image placement, or GPU resource cleanup.
- Existing prior art includes the browser tests for every-camera readiness with a held fence, failed GPU target allocation and explicit recovery, unchanged-ground resubmission, moving flat-ground coverage, appearance changes, wireframe synchronization, and style replacement. Extend or relocate their relevant assertions without losing their actual WebGL coverage. Keep existing pure camera geometry and terrain tests for their established responsibilities.
- During implementation, run repository type checks and unit tests, production package and playground builds, and the packaged browser suite. Report actual results and unavailable checks. Spec publication itself changes documentation and does not establish that implementation tests pass.

## Out of Scope

- Changing the visibility algorithm, terrain resolution, finite-range model, or accuracy guarantees; building occlusion and survey-grade analysis remain outside scope.
- Adding CPU visibility fallback, alternate rendering engines, or a public adapter/plugin system.
- Guaranteeing per-camera fault isolation when cameras share a failed renderer, or making every camera wait for a synchronized global update.
- Adding status badges, spinners, loading animations, stale-age indicators, automatic retries, or an arbitrary timeout for retaining coverage.
- Redesigning the map interface, inspector, controls, entity placement, non-camera attachments, or drawing tools.
- Moving application networking, movement timing, route playback, persistence, or other consumer workflows into Ridgeline.
- Redefining unrelated entity-state semantics, reorganizing the entire elevation subsystem, or performing broad cleanup outside the camera ownership change.
- Claiming performance gains, device capacity, or new browser support without separate measurements and verification.

## Further Notes

The design was investigated against commit `cc1b4070643aef8e088d14e891daf5e06cbfc8a6`, including the recent camera-readiness, ground-submission, shared-target, and failure-cleanup fixes. The checkout used to publish this spec was still at `7698e957a38bfd2330f648358455082d692c1295`. Implementation must start from a revision containing the reviewed fixes and verify any intervening changes rather than rebuilding from the older checkout by accident.

The user explicitly accepted retaining completed coverage during updates, publishing sensors independently, and removing affected coverage after confirmed failure. The guiding preference is clarity over immediate freshness. Existing physical coverage semantics remain unchanged.

The user delegates internal technology and module choices to the agent and prefers questions about meaningful visible behavior. The behavior discussion is complete; this spec synthesizes it without another interview. No new glossary term or architectural exception is needed.

Completion requires one owner for sensor-camera lifecycle decisions, no duplicate completion reconciliation in the entity scene, preservation of the agreed display behavior, and passing relevant lifecycle and packaged rendering checks. This specification is ready for implementation planning; publication of the spec does not mean the code has been implemented or validated.

## Comments

- The user accepted keeping previous completed coverage visible during ordinary updates and stated that clarity matters more than complete accuracy. This spec records that choice narrowly as display continuity while an update is pending.
- The user accepted independent sensor updates and removing coverage after a confirmed failure while retaining the sensor's entity.
- The user invoked matt-to-spec to synthesize the discussion and publish this document with the ready-for-agent triage status.
