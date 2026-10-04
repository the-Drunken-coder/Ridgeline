# Ticket 85 placement handoff

Date: 2026-10-04. Owner: `/root/projection`; integrated owner remains root. Worktree `/tmp/ridgeline-model-placement`, branch `implement/entity-model-placement`.

## Changes

- `model-placement.ts` owns rigid authored-to-local orientation, physical centering, slope fitting, displayed contact, exact terrain probes and pure scale prediction. Proper glTF turn is `[-x,z,y]` in ENU, determinant +1. Authored -X is physical right for a +Z-forward asset. Registered headingOffset applies before body roll/pitch and geographic heading. Ground slope uses the physical footprint; enlarged contact checks the displayed corners. Exaggeration affects placement and slope, never dimensions.
- Ready output contains an ENU basis, displayed geographic center, eight centered box corner offsets, displayScale and the fitted displayed terrain plane. Unknown output identifies exact missing/required geographic positions. It does not emit zero-height geometry. `scaleModelPlacement` retains uneven support residual and has no consumer sampler callbacks; the scene must validate final actual terrain contacts.
- `EntityProjection` now accepts the exact affine Mercator/height/meter-unit vertex tuple used by the GPU, plus shared meter-offset and inverse geographic helpers. Model corners, terrain probes and rendering use one coordinate path.
- `Elevation` snapshots exact required positions and includes them in area identity, restart, preparation and pending-work deduplication. A pending preparation is reusable only when its sent positions include the new exact probes. Added model area identity and reentrant-provider cancellation guard. Caller ownership remains with EntityScene.
- Public packed browser cases exercise authored axes, headingOffset+pitch, slope/contact, projection, globe hiding, physical ground-zone separation, and delayed terrain/provider recovery and cancellation.

Commits: `bd16cd9` geometry/projection seam; `17aa807` exact elevation probes; `c2c8b63` uneven support residual and more behavior checks; `cb4680d` public fixtures/cases; `1b65405` projection/contact/attachment coverage; `1170f28` globe hiding. Root resolved shared harness integration merges `47876b4` and `666c6c8`. Root integration `525ed1d` merged as `f5f441c`. Final shared batching/contact/visibility refinements merged from `eb6d487` through combined tip `f895069`; placement branch fast-forwarded to that exact tip.

## Executed evidence

| Source | Check | Result |
| --- | --- | --- |
| cb4680d, earlier core renderer | Original 3 placement browser cases | 2 fail, 1 pass. AuthoredOffset+pitch nose displaced 7.9 CSS px; original geometric edge oracle found plane top error 1.68 px. Recovery already passed. |
| 1b65405 exact source, committed after run without edits | All 3 new placement public packed cases | Pass, 1.1 min. Logs `placement-browser-integrated-2.log`. |
| f895069 | Existing flat/globe entity precision public packed regressions | 2 pass, 56.4 s. Log `placement-browser-final-projection.log`. |
| 1170f28 | `pnpm check` | Pass. Log `placement-check-final.log`. |
| 1170f28 exact source, committed after run without edits | Model orientation/precision/planet case + existing flat/globe entity projection cases | 3 pass, 54.8 s. Logs `placement-browser-projection.log`. |
| f5f441c + later browser-only planet test | Placement, Elevation, EntityProjection, EntityLayer and switching focused tests | 39 pass. Log `placement-focused-integrated.log`. |
| 666c6c8 + exact browser additions later pinned in 1b65405 | `pnpm check` | Pass (tracker validation, library TS, control-lab TS). Log `placement-check.log`. |
| f5f441c production geometry | 768 independent planar cases | Pass; raw results and executable script `placement-geometry-verification.json` / `.mts`. |

The model precision case checks 33 views: flat zooms 18/19/20 and globe zooms 11/11.25/11.5/11.75/12/18/19/20, each at longitude 6.87 and both sides of the date line on adjacent world copies, latitude 46. RGB nose/right/up marker centroids stay within one CSS pixel of an independent double-precision calculation using captured MapLibre matrices. It asserts an actual intermediate blend was reached. The same case tests visible front and hidden rear planetary models. MetersPerUnit changes keep marker raster sizes measurable.

The ground browser case covers physical size and a 40 CSS px projected-box floor, DPR 1/2 and exaggeration 1/2. It independently fits the specified plane and projects corners. Geometric corner extrema are converted to an independent 2D convex-hull raster at equivalent opacity threshold before comparison (within one CSS pixel): a pointed silhouette corner need not cover its extreme pixel. This fixed an oracle mismatch, not a runtime geometry discrepancy. A separate visible blue physical ground polygon retains all four pixel bounds within 0.5 CSS px while the red body grows more than 1.5x.

The 768-case numerical sweep spans latitudes -65/0/46/78, longitudes 0/179.99999, four planes, two exaggerations, three headings, true/enlarged 20x size and two metersPerUnit values. Base clearance is 0.0199999908–0.0200001875 m; maximum normal error is 0.000001479 degrees; maximum basis length error is 1.42e-14 m. Geographic anchors remain unchanged.

Recovery uses a real public consumer sampler that knows only prepared exact positions. Unknown terrain shows green fallback and no red model. Preparation completions recover a stationary entity; invalid below-terrain altitude hides the model; valid altitude restores it. Provider reset requests current work. Removal aborts pending preparation, late completions cannot resurrect geometry, and five seconds after idle have zero renders.

## Uneven terrain observation

`placement-uneven-observation.mjs` serves `/tmp/ridgeline-model-context/placement-observation/index.html`, imports the packed consumer's installed library, and uses only the public viewport API. It captures the same rigid 20x10x20 m box first on a plane and then on a local 6 m ridge between sampled support corners. Viewed screenshots `placement-uneven-plane.png` and `placement-uneven-ridge.png`: the plane base is flush; the ridge cuts a visible notch into the front base. This is the accepted approximation from sampled rigid contact. There is no mesh deformation or wheel/track contact solve. The observation also shows native terrain depth hiding the intersecting model region.

Recorded browser 153.0.8010.12; ANGLE Vulkan SwiftShader (Subzero), from `placement-uneven-observation.json`. No target hardware evidence. T3 desktop preview remains unavailable.

## Remaining integration limits

- Final #86 runtime fixes and terrain/scene ownership guards are merged and reviewed; see the final integration record below. Root still owns exact integrated checks and the full packaged suite before marking tickets resolved. Read-through confirms exact final terrain probes, current feature/configuration revision guards and a shared frame origin for batched draws.
- New model+ground-zone preservation is exercised. Full ground-marker/line, airborne-volume and sensor-origin/depth relationships belong to #88 and combined #90 evidence; do not claim those from this one polygon test.
- Shared CPU near-plane clipping regressions pass. A separate public model-specific near-plane crossing history is not yet recorded here.
- Uneven terrain may visibly intersect or float between sampled support locations, as observed above. The planar tolerance does not promise exact contact on arbitrary terrain.
- #80/#91 hardware and measured budget guidelines remain pending by user direction. No production-readiness claim.

Additional geometry-only uneven-floor probe: `placement-floor-uneven.mts` / `.json` exercise the actual final four-step scale/contact algorithm against eight concave quadratic terrains and a captured zoom-18 frame. Final projected size for a 40 px target was 39.99314–40.00003 px. This is a numerical smoke check, not a replacement for public browser acceptance.

## Abort-callback ownership follow-up

Before integration, a real reentrant cancellation failure was found. Replacing a pending model area aborted its old signal; a consumer abort listener removed the requester; the outer requestBatch then recreated a deferred area. A later provider reset prepared this removed area. The standalone `placement-abort-reentry.mts` reproduced retained revision 2 and preparation count 1→2 after reset. The #86 owner also reproduced it through the public packed viewport (`switching-abort-reentry-red.log`). Root independently reproduced an abort listener's newer [3,3] request being overwritten by obsolete [1,1].

Commit `6d3ba6d` fixes Elevation ownership without changing its scene API. A module-local operation revision stops obsolete batches at abort boundaries and removes only their still-owned partial areas. Public release, reset, retry, destroy and new requests invalidate older batches. Provider restart snapshots and detaches old work before abort callbacks, then restores only old areas that still have the same identity; newly requested areas and unrelated requesters survive.

New focused behavior checks cover abort→release, replacement, destruction, partial batch cleanup, and reset→abort→new request alongside an unaffected requester. All 21 Elevation tests pass; 41 combined placement/elevation/projection/layer/switching tests and `pnpm check` pass at `6d3ba6d`. Logs: `placement-abort-unit-red.log`, `placement-abort-unit-green.log`, `placement-abort-focused.log`, `placement-abort-check.log`. Standalone green output `placement-abort-reentry-green.json` shows revision 0 and no additional preparation after reset. Root reviewed the fix and re-executed the direct replacement reproduction successfully.

The #86 owner has separately added scene guards at synchronous terrain cancellation boundaries (`2a2c0f3`). Final combined public checks and source pin are still being completed; preserve the earlier revision-specific evidence above.


## Final integration record

Root authorized the final no-ff merge after reviewing runtime `f14db3db4b56c8156423e04bf1d9242e18436c6d` and test-only `882b15c72e67a9cbcab24b433f4b78e93f1e4f82`.

- Delivered worker tip: `882b15c72e67a9cbcab24b433f4b78e93f1e4f82`.
- Integration merge: `647458e6f7d4ff3b86a72d6fb86f474457dbf4be`.
- Tree: `263f92a429ad301684cf03ef4898dadd2b76eb11`.
- First parent: `525ed1d8283014c98d12c3c9f7b8c0a26bf1bcc4`; second parent: delivered worker tip.
- Exact tree diff between merged integration and delivered worker tip is empty. Root worktree and diff whitespace checks are clean. No root files were edited outside the authorized merge.
- Placement branch fast-forwarded to the delivered worker tip and is clean.

The #86 owner reports 98 focused model/registry/placement/elevation/entity/store/publication tests plus 19 combined model/publication browser cases passing at f14db3d, including all three placement cases and the new public abort-callback histories. One symbol eligibility setup was corrected in the last test-only commit, with three repeated successful runs and all four switching/floor cases passing at exact882b15c; `pnpm check` also passed at exact882b15c. Detailed logs and the preserved earlier failure are linked in `switching-implementation.md`. Runtime did not change between f14db3d and882b15c.

Implementation and affected local verification are complete. Root will run exact integrated checks and the full packaged regression suite before resolving #85/#86. No hosted PR checks, push, or tracker mutations were performed by this worker. Hardware gates remain pending.
