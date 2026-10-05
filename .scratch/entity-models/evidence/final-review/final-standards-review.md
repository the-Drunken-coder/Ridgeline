# Final independent Standards review

Date: 2026-10-05 UTC.
Reviewer: independent Matt Code Review Standards worker.
Integration owner: root coordinator. This is a read-only review, not an integration closeout or merge-readiness claim.

## Revisions and execution

Base: `2733cee9fe9440237a36e90d9efa2fc4239b87c3`.
Reviewed head: `1e4c2c589902ecf9c6509acff725d31912d90de7`.
Production `src` tree: `b948ba66a835753b8e63c22d161a2e31686a2893`.
Diff: `git diff 2733cee9fe9440237a36e90d9efa2fc4239b87c3...1e4c2c589902ecf9c6509acff725d31912d90de7`.
Complete commit list: `/tmp/ridgeline-model-context/final-review-commits.txt`.
Execution checkout: `/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4`.
Initial and final tracked/untracked status were clean. No repository/source files were edited. Tests and reproductions exercised the exact reviewed head. Additional scripts and results are outside the repository in `/tmp/ridgeline-model-context/`.

Read `AGENTS.md`, authoritative `CODE_CONVENTIONS.md`, `GLOSSARY.md`, all three accepted ADRs, `docs/agents/domain.md`, `docs/agents/issue-tracker.md`, package commands and public README contracts. Canonical context: `.scratch/entity-models/spec.md` and `/tmp/ridgeline-model-context/issue-90.md`; acceptance coverage belongs to the separate Spec axis. Read the measurement and example handoffs. Historical RED/interrupted logs, images, GLBs and exploration scripts under `.scratch` are retained evidence, not current product failures.

## Documented-standard finding

### P2: model preparation adopts a newer revision before recomputing its placement

File/hunk: `src/entities.ts:412`, especially lines 414-421 and subsequent consumption of state/style at 433 and resolved altitude at 451.
Relevant additions:

```ts
if (this.dirty.size || this.geometryDirty) this.flush();
...
const revision = this.revision, registry = this.options.models, configuration = this.options.configuration();
```

Documented rules: `CODE_CONVENTIONS.md:40` requires stale render results to be guarded against replacement/newer state; `CODE_CONVENTIONS.md:41` requires checking that the owner and operation are current after consumer callbacks.

Concrete history: the accepted entity initially has altitude 100 m. Model preparation calls `flush()`, which computes that placement and then calls `options.changed`. In the real viewport, this emits `entitychange`. A consumer callback accepts an upsert of the same entity at 300 m. `EntityScene.set()` installs the newer feature and makes it dirty. Returning from `flush()`, model preparation captures the newer revision, but `states` and `modelStyles` still belong to the 100 m computation. It prepares/draws an instance at 100 m and publishes `representation: 'model'`. A later queued flush repairs the altitude to 300 m. Location/orientation from the new feature can also combine with resolved placement and appearance from the old computation.

Executed module-interface reproduction, without accessing private fields: real `EntityScene`, `ModelRegistry`, `ModelLayer`, `ModelRenderer`, parser and production `ModelMeasurement`; a WebGL double records actual uploaded instance arrays and a controlled RAF queue preserves this synchronous callback ordering. The double changes GPU execution only, not callback, revision or scene ownership. Original probe: `standards-frame-callback.mts` / `.json`. Production-instrumented probe: `standards-frame-callback-measured.mts` / `.json`.

Observed first upload anchor Z = 100; accepted altitude = 300; first returned state altitude = 100 and representation = model. Second preparation uploads Z = 300. Both assertions pass.

Valid control accepts 100 then 300 before the frame starts. `standards-frame-valid.mts` / `.json` and `standards-frame-valid-measured.mts` / `.json` upload 300 in their first frame and have no pending repair frame.

The valid and invalid instrumented histories emit identical first-frame facts:

```json
{"viewport":1,"sequence":7,"frame":1,"sceneRevision":5,"updateRevision":2,"drawnModels":1,"clippedBoxes":1,"batches":1,"triangles":12}
```

This establishes false attribution to the newer accepted update, as well as stale placement, without relying on a missing-count heuristic. A count-only model latency consumer can classify the obsolete placement as revision 2 becoming visible.

Fix direction: do not capture a frame as current while the callback-created dirty data remains uncomputed. Reject/reprepare that attempt or drain a bounded current preparation; tie the cached placement/style to the accepted feature snapshot. Retain a public packaged-browser regression that mutates altitude and appearance through `entitychange` and inspects the first completed frame. Root has accepted ownership of that public reproduction after its full suite releases the GPU. No browser pixels or hardware consequence are claimed by this CPU probe.

## Separate heuristic observation

Possible Duplicated Code, non-blocking judgement call: `src/model-renderer.ts:251` and `src/model-feedback-layer.ts:52` repeat the same compile/attach/link and shader-release shape, beginning with:

```ts
for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const)
```

A small compile/link helper could consolidate partial shader/program cleanup while leaving asset and feedback resources with their existing owners. This is an optional maintenance observation, not a demonstrated defect or hard standards violation. The repeated shape also occurs in pre-existing custom-rendering code; unrelated consolidation should stay out of this patch. No other actionable Fowler-baseline observation survived the repository's explicit module/ownership priorities. Internal mathematical names, domain-specific tuples and narrow MapLibre access were not treated as hard violations.

## Ownership and history audit

- Registration/decode/recovery: traced `viewport` diagnostic/changed adapters, `ModelRegistry`, `ModelLayer`, `ModelRenderer` and context/style events. Constructed replacement during decode, remove/destroy during upload, late bitmap delivery, failed replacement during accepted restoration, callback cancellation during resource allocation, context loss with a newer accepted basemap, retry after partial restore failure. Focused registry tests execute the CPU histories. Retained packaged tests use actual decoder/GPU and scoped handle tracking. No extra finding from inspection.
- Terrain requests: traced callers in `EntityScene`, `SensorCameraCoverage`, `Elevation`, `RasterElevationSampler` and its provider callbacks outside the diff. Constructed same-center changed-probe requests, pending covering work missing a new exact probe, release of one/all shared requesters, abort listeners replacing/removing a requester, provider reset with reentrant new requests and late completion. Executed the elevation tests and scene cancellation tests. Their observed ownership and exact-probe invariants pass.
- Native destination invalidation: traced `ModelVisibility`, `ModelLabels`, marker-key caches, `FeaturePublication`, `maplibre-feature-publication`, viewport source/style creation, removal and context retirement. Constructed same input after source/manager replacement, removed-and-reintroduced ID, interrupted stamp writes and retained versus replaced native sources. Inspected destination identity, invalidation and retry retention; executed publication and scene tests. Existing browser cases explicitly hold native worker layout and verify stamp-gated glyph pixels/hits. No additional confirmed finding.
- Frame completeness/deduplication: traced actual registry-ready resources, proposed choices, frame commit/publish, `EntityLayer.suppressPoints`, renderer generation/disposal, clipped boxes and measurement correlation. Constructed updates before model prerender, between prerender/main render and during the flush callback. The last history is the reproduced finding above; the two summary-identical histories are recorded explicitly.
- Interaction/callback cleanup: traced `attachInteractions`, `FeatureContent` refresh/disposal callers and viewport listener delivery outside the diff. Constructed callback remove/destroy/acquire-lease, same-ID hover replacement, close/dispose before a selection request, retained picker choices during switching and actual pointer loss. Changed follow-ups check operation identity; existing public tests use real mouse/keyboard input and separate source-delayed observation. This reviewer did not rerun them while root owns the GPU.
- Example/tools: inspected lifetime abort and operation revision in `playground/model-example.ts`, consumer-owned palette/fetch ownership, package setup, generator, provenance, report correlation, pixel predicate, GPU-query consumption and observer teardown. Constructed sibling fetch finishing after a failed reset/new replacement, superseded update records, mixed/partial native revisions, missing or single GPU sample, disabled instrumentation and repeated teardown. Focused tooling tests pass. Actual installed package/reporter browser evidence is retained in the measurement handoff and root-owned integrated run; it is not substituted by synthetic report fixtures.

## Executed checks and limits

Command, at exact clean reviewed head:

```sh
node --import tsx --test tests/models.test.ts tests/model-glb.test.ts tests/model-placement.test.ts tests/model-switching.test.ts tests/model-picking.test.ts tests/model-presentation.test.ts tests/entity-projection.test.ts tests/elevation.test.ts tests/entity-scene.test.ts tests/feature-publication.test.ts tests/model-workloads.test.ts tools/model-measurement/report.test.ts tools/model-measurement/workload.test.ts tools/model-measurement/pixels.test.ts
```

Result: 113 passed, 0 failed/cancelled/skipped. Log: `final-standards-tests.log`. Four external callback/control scripts execute successfully; the two measured variants record production-generated timing facts. Source/product/spec diff whitespace check passes when excluding raw historical evidence. The full raw diff whitespace checker reports retained tool-log whitespace, which is tooling-enforced and not a Standards finding.

No GPU/browser job, build or mutation competed with root. Root reports current type/ticket/control checks passed and the 182-case packaged suite remains in progress at this pin; this reviewer does not claim its completion. This review is not clean until the confirmed callback/frame finding is resolved and affected review/checks repeat on the resulting revision. No PR or hosted evidence exists. Hardware #80/#91 remains pending by user direction; parent #81 stays unchanged. Software Node/WebGL evidence does not establish target-device performance or Safari support.
