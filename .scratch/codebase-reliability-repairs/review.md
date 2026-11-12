# Independent reliability repair review

Date: 2026-10-02. Canonical requirements: [spec.md](spec.md).
Base: `7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5`.
Initial reviewed head: `cb50c52508ee457b5193bc7bca0dd69c21791077`.
Final reviewed and independently exercised head: `873f514e480c5e6ffddac1e08a88a9d78114b8ca`.
Full comparison: `git diff 7b817c6411e53b6e3c5a9c61ac995ddadc2b51a5...873f514e480c5e6ffddac1e08a88a9d78114b8ca`.
Correction comparison: `git diff cb50c52508ee457b5193bc7bca0dd69c21791077...873f514e480c5e6ffddac1e08a88a9d78114b8ca`.

The two reviewers worked independently in clean detached checkouts. They read CODE_CONVENTIONS.md, domain context, accepted ADRs, the spec and linked tickets. Each traced owners and callers beyond the changed hunks before reporting results. Full integrated validation is recorded separately in [closeout.md](closeout.md).

## Standards

Zero documented violations and zero actionable smell findings at the final revision. The original full investigation remains applicable to unchanged code. Changes stay with existing drawing, publication, content, elevation, scene, geometry, and GPU owners. Public exports and consumer ownership remain intact.

The initial review independently passed 158 focused module tests and 27 installed-package cases at `cb50c52`. Concrete histories included draft replacement during permission, interrupted acquisition/remount, pending-observer invalidation, basemap replacement during styling, cross-ID icon removal, held-update retry, reentrant content disposal, exact date-line storage and feedback, keyboard exclusions, camera failure/late completion, repaired raster cache, GPU retry/cleanup, and atomic mixed-batch rejection. The production consumer and CI paths were inspected; the integration owner executed them.

After the Spec finding, the reviewer traced viewport hits through EntityScene to EntityLayer and compared coherent GPU origin placement with CPU triangle/segment clipping. The correction retains the GPU's entity origin in picking, including the flat part of globe blending. Independent terrain probes retain their point reference. Raw altitude, clipping planes, retry, disposal, and scheduling are unchanged.

At `873f514`, six layer tests and three freshly packaged native cases passed without retries. These execute triangle/segment seam cases in flat and globe fallback, empty-space rejection and actual visible attachment selection, date-line render/picking, and null-buffer recovery. The whole-range diff check passed; the review checkout remained clean. The optional origin serves existing point and grouped-geometry callers without a new public abstraction. Tests assert results and pixels.

## Spec

One P2 finding at the initial head: R13 remained partial. The spec requires “Geometry must use the same visible world-copy rule as picking.” Rendering kept an attachment coherent around its entity origin, while CPU picking chose a separate copy for each vertex.

The reviewer reproduced this with a fresh installed package and native input: flat center `[179.9,0]`, zoom 0, entity `[0,0]`, ground altitude 200,000 meters, and sphere radius 100,000 meters. The sphere rendered on the left, but clicking the white center pixel selected that entity and sphere. A larger accepted sphere independently showed the same failure. Triangle and segment clipping had to share the rendered origin.

One implementer corrected the finding in `e884492`, merged as `873f514`. The reviewer then compared CPU placement with GPU offsets and traced triangle, segment, public point, and terrain-probe callers. Grouped vertices now use the same coherent offset as rendering; point probes keep their own reference. No new API, schema, UI direction, retry policy, or missing-elevation fallback was introduced.

Final independent execution at `873f514` passed 176 focused modules, four freshly packaged rendering/picking cases, and two investigative controls. The exact previously failing smaller public sequence now rejects the empty-center click and preserves visible geometry. The retained cases also cover the larger seam, old date-line behavior, airborne/globe placement, and exaggerated-terrain picking. The exploratory circle-copy concern passed at the normal two-pixel input/marker tolerance and was explicitly resolved as rounding, without a product patch.

All 17 requirements were accounted for through executed or inspected owner histories and the integration owner's full checks. No other missing requirement or scope creep was found. Zero outstanding Spec findings remain.

Standards: 0 findings, no worst issue. Spec: 1 historical P2 finding resolved; 0 outstanding findings.
