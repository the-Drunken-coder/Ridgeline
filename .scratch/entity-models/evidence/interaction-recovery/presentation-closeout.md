# Model presentation implementation evidence

2026-10-04. Ticket: issue-88.md; exact approved spec is the root checkout's `.scratch/entity-models/spec.md`. Root owns integrated review, verification, tracker closeout, and final acceptance. Hardware acceptance remains pending by the user's direction.

## Delivered state

- Presentation worktree `/tmp/ridgeline-model-presentation`, branch `implement/entity-model-presentation`.
- Final aligned head: `22e6078cde82a54d2396e8054b22e2b5bc2de667`.
- Final tree: `cff33b665dad9b65eac0eb3a4160b56af20febf7`, exactly equal to the combined worker revision `2ea02ce67a55db3d8a915cc02a6e9c3fa8158217`.
- Clean checkout and `git diff --check` passed after alignment. The #87 worker is executing the final combined model suite at 2ea02ce; those results are not claimed here until delivered.
- Last own implementation/test revision before alignment: `bb202f9`. Own runtime is unchanged by the later alignment; alignment brings the final #87 near-plane test and #89 shared viewport restoration fixes.

## Behavior and ownership

- `src/model-presentation.ts`: shared committed frame record and pure screen geometry. The ring follows the projected model center; the existing below-anchor native label clears the full box and strongest ring. Selection takes precedence. Required `hasLabel` is supplied from the scene's copied style.
- `src/model-feedback-layer.ts`: static high-contrast white hover/orange selection circles with a dark outline, drawn above physical geometry and before labels. Owns and releases its GPU resources. Reuses valid same-context resources because MapLibre live style replacement reattaches without onRemove. No repaint or animation scheduling.
- `src/model-renderer.ts`: per-instance gentle/strong linear RGB brightening after normal appearance evaluation. Source RGB/texture/material/GLB and alpha mode/cutoff stay unchanged. Adds one float to each instance, changing the buffer stride from 17 to 18 floats. This adds upload/shader work; hardware cost is unmeasured.
- `src/model-labels.ts`: desired feature-state stamp versus installed source-property stamp hides stale native symbol layouts. Existing FeaturePublication remains the sole source writer. Same-frame native preparation uses the pinned MapLibre integration. Current-operation checks follow callbacks. Stale native label hits are rejected by the same desired stamp. Removed/cleared records restore default offset/stamp. Models without text do not generate camera-driven native layout updates.
- #87 owns the scene/viewport bridges, selection/preview state, frame boxes, actual pointer picking, and native label hit ordering. It fixed native stamp invalidation on remove/reintroduce after our public reproduction.
- Root owns shared harness edits and the robust model upload fault observer. The observer now targets the actual model instance buffer and ARRAY_BUFFER destination instead of a hardcoded stride.

## Executed checks

| Revision | Check | Result |
| --- | --- | --- |
| 17cdf42 + baseline renderer | Public feedback regression | RED: hover fallback brightness remained 510/510 |
| 1743252 runtime | Public label remove/reintroduce regression | RED: body 4691 pixels, glyphs zero after same-ID state reset |
| 4391a06 bridge integrated | Same public label history | GREEN: invalidating native stamp destination restores glyphs |
| Before 39a360c/f55be11 | Unlabeled model camera update | RED: one unnecessary native source layout upload |
| 39a360c + f55be11 integrated | Same public no-label history | GREEN: zero native layout uploads; adding/clearing/readding text works |
| 5f5b94d | Feedback and label packaged cases | Both passed; physical case also passed all geometry checks, then found 2 already-queued frames immediately after the first idle |
| bb202f9 | Physical/idle packaged case | Passed in 10.7s (13.7s runner); 300ms settle plus another idle precedes 5 full seconds of zero renders |
| bb202f9 | pnpm check | Passed, including ticket validation, package/playground types and control-lab types |
| bb202f9 | Focused presentation, shared projection, placement and picking tests | 16 passed |

Logs are `presentation-feedback-red.log`, `presentation-second-combined.log`, `presentation-empty-label-red.log`, `presentation-fifth-combined.log`, `presentation-physical-green.log`, `presentation-pinned-check.log`, and `presentation-pinned-unit.log` in this directory. Intermediate failed fixture attempts are not acceptance evidence.

The public presentation cases execute the packed consumer package, not a development source alias. Browser: Chromium 153.0.8010.12, ANGLE SwiftShader with `--use-angle=swiftshader --enable-unsafe-swiftshader`. These are software WebGL results, not target-hardware results.

### What the permanent cases prove

1. Public preview/selection and actual pointer hover, with stronger selection taking precedence and clearing restoring exact appearance. Grounded and airborne entities at physical/enlarged size use pitched/bearing views; orange ring bounds enclose the real body and track its altitude. Fallback magenta, arbitrary CSS (`rebeccapurple`), original materials, original cutout/BLEND alpha and double-sided faces are exercised. Clearing feedback restores the exact original material frame; source bytes remain unchanged.
2. Actual Noto Sans Regular glyphs, delayed native publication, same-frame stale layout hiding, fresh beyond-edge clearance, unchanged font contract and real native collision suppression. Pitched/bearing ground/airborne views, style/source generation replacement, same-ID removal/reintroduction, no-label/add/clear/readd, native glyph clicks, and opacity-zero stale native hit rejection are executed. The stale bucket is asserted still natively queryable while the public click outside the body returns no hit.
3. Real/enlarged ground polygon, airborne sphere volume and camera/sensor geometry retain every classified visible physical pixel outside the union of actual body bounds. The enlarged opaque body can correctly obscure the sensor apex; this is expected physical depth occlusion, not displacement. Required visible pixel counts and unchanged outer bounds remain asserted. The actual entity ground-line endpoint matches independent `map.project([0,0])` within raster tolerance. The current entity API has no distinct airborne ground marker; its eligible grounded fallback marker is instead compared pixel-for-pixel across size-floor settings. After re-registration and selection, the settled view schedules zero renders over five seconds.

The initial MapLibre idle can precede an already queued scene RAF followed by FeaturePublication RAF/worker completion. The quiet check waits for this finite publication chain, then observes the full quiet interval. Neither feedback layer nor label helper schedules a periodic loop.

## Visual and native-layout evidence

- `presentation-gallery.mjs`, `presentation-gallery/index.html`, `presentation-gallery.json`, `presentation-1.png` through `presentation-6.png`.
- Gallery capture was at **clean 5f5b94d**, from its packed installed consumer. Metadata records the full SHA, timestamp, camera, canvas and software renderer; do not attribute it to a later pin. Later bb202f9 only changes test settling, not source.
- Six images cover custom ground physical-hover and enlarged-selection, magenta airborne physical-hover and enlarged-selection, and original textured airborne enlarged hover versus selection. Agent viewed images 1,4,5,6; root viewed image4. Labels clear rings and bodies, and hover/selection remain visually distinct.
- `label-stamp-probe.{mjs,json,png,log}` and `label-stamp-probe/index.html` record the initial independent packed-native proof: stale layout hidden in every recorded enlarged/loading frame, fresh layout clears body, overlapping second label suppressed, zero renders over 5s. The later permanent case verifies full FeaturePublication integration and source lifetime behavior.
- Permanent glyph fixture: `tests/fixtures/noto-sans/{0-255.pbf,LICENSE,README.md}`. Unchanged MapLibre demotiles Noto Sans Regular 0–255 range, with OpenMapTiles provenance and pinned SIL OFL license; tests have no network dependency and product font contract is unchanged.

## Remaining gates and limits

- Root still must review the final combined tree and own exact integrated checks/closeout. No hosted PR checks were run because no PR is authorized or created.
- #87's actual partial near-plane model crossing is in combined 2ea02ce via 5b045fb; its owner reports visible exterior pixels and an actual pointer hit with independent clip-sign confirmation. Our presentation cases do not independently repeat that scenario.
- Target browsers/hardware, performance guideline, and production readiness remain pending under #80/#91. Ring/brightening and labeled-camera updates have real per-frame cost; no hardware performance claim is made.
- Physical geometry retains normal occlusion. Tests do not claim hidden sensor-apex pixels remain visible, or every crowded label stays visible.
