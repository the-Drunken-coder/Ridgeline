# Parser allocation review, issue #96

Date: 2026-10-05 UTC. Spec: `.scratch/pr-92-agent-environment/spec.md`, acceptance criterion 4. Root owns integrated verification in #101.

Reviewed `d63908d66c848137df7f62ba02add10d3b314dd3...049c6bfad689055e8d26f14c0f479add924846cd` in `/tmp/ridgeline-93-parser-review`. The change contains only two review-guidance bullets in `CODE_CONVENTIONS.md`. The implementation branch is `implement/93-parser-review`; it already includes the integration tip at `d63908d`.

Runtime source and existing tests are unchanged. `src/model-glb.ts` has Git blob `c4ef86a556ffafcde6537d68a12917593a8c59bf`; `tests/model-glb.test.ts` has blob `a726c58f5986bfb0b84e8be93b79b344df59bce8`. Both match the merged allocation correction at `60dd1b545afda985a95acf27600f82556b34b632`.

## Count-to-allocation reasoning from inspection

Let `B` be the supplied GLB byte length, `V` the decoded POSITION count, and `I` the accepted index count for one primitive visit. These are bounds on accepted allocations, not target-hardware memory measurements.

- Container chunk lengths must fit `B` before decoding JSON or constructing binary views. The parser requires exactly one embedded buffer and bounds each buffer view by its accepted binary buffer length. Metadata list copies, tree edges, and traversal state follow actual entries in the JSON payload, rather than an unbacked declared array count.
- Every accessor count must be a positive safe integer. Supported scalar widths are 1 through 4. The parser rejects `count * width > 0xffffffff` before either allocation path. Large count multiplication therefore cannot pass merely because JavaScript would round a value beyond its safe integer range.
- Implicit zero-filled accessors have no stored-byte bound. Before `new Array(count * width).fill(0)`, the merged guard independently requires `count * width <= B`. This limits scalar entries, not allocation bytes or triangle count. JavaScript array overhead is not measured here.
- Stored accessors require `stride >= width * componentSize` and `start + (count - 1) * stride + width * componentSize <= view.byteLength` before `Array.from`. Offsets, alignment, component type, and legal stride are validated. Accepted scalar counts consequently fit the backing view at the component width; declared counts alone cannot expand a small view.
- Optional normal, texture-coordinate, and color counts must match `V`. Implicit generated indices have length `V`; explicit indices have the bounds of their own accessor. Index values must identify an existing vertex. The transformed-position array has `V` three-component vectors. Generated flat normals append at most one output vertex per index, while authored normals reuse at most `min(V, I)` distinct vertices. Each appended vertex contributes 3 position, 3 normal, 2 UV, and 4 color scalars. The batch index list contributes `I` entries. Final upload arrays copy these existing lists into Float32/Uint32 arrays.
- Tree validation rejects duplicate ownership and cycles before the selected scene is visited. Each selected node is visited once, but different nodes may reference the same mesh. Accessors are decoded again for each primitive visit. Output lists accumulate across those visits, so total geometry follows the sum of accepted `V` and `I` over node/primitive occurrences. A per-accessor payload bound does not establish a global linear bound in `B`.
- Referenced embedded images copy a bounded buffer view once per image index, using `imageIndices` to reuse a copied image. Distinct image records can reference the same underlying bytes; cumulative copied bytes depend on those records. Native image decoding and GPU upload belong to the registry and renderer, outside this pure-parser execution.

The review guidance now requires this trace, pinned sources, attempted histories, and separately stated executed, inspected, and untested evidence. It links the existing executable regression and supported contract. It does not change the public API, accepted GLB subset, merged guard, or pending measured triangle guideline.

## Executed failure history and supported cases

The original parser source at `d32e359e7fe4c7305d8793469e77151873eb8c49` was extracted with `git show` into `/tmp/ridgeline-93-context/parser-pre-fix.ts`. A transient probe called its real `parseGlb` interface with the original 272-byte fixture and a billion-count implicit VEC3 accessor. A Proxy intercepted array construction above 100,000 entries before invoking the real constructor. The pre-fix parser requested 3,000,000,000 scalar entries; none were allocated. The same fixture through the current parser rejected with `GLB_INVALID_ACCESSOR_COUNT` and made zero intercepted requests. This repeats the named historical failure safely; it does not infer allocation safety from a source-text assertion.

`node --import tsx --test tests/model-glb.test.ts` passed all 21 existing cases at `049c6bfad689055e8d26f14c0f479add924846cd`, with no failures, cancellations, or skips. The unchanged suite covers:

| Attempted history | Observed result |
| --- | --- |
| An implicit POSITION accessor declares 3,000 vertices without backing bytes | Rejected with `GLB_INVALID_ACCESSOR_COUNT`; the fixture is moderate even without the guard |
| Billion-count implicit POSITION, NORMAL, TEXCOORD_0, COLOR_0, and unsigned indices | All five rejected with `GLB_INVALID_ACCESSOR_COUNT` |
| Small implicit zero geometry | One triangle and zero bounds accepted |
| 3,000 stored positions with implicit VEC4 colors and VEC2 UVs | 1,000 triangles accepted; all color and UV values remain zero |
| Solid, nested/mirrored, quantized/interleaved, indexed, and material/image assets | Existing supported geometry, normals, bounds, copied images, and material assertions passed |
| Invalid container ranges, stride/alignment, indices, unsupported features, duplicate/cyclic tree ownership | Existing named rejection assertions passed |

No newly demonstrated gap warrants another permanent test. No production or test file was edited.

## Checks and limits

- All 10 relative Markdown links in `CODE_CONVENTIONS.md` resolve, including the `README.md#shared-models` heading. `git diff --check` passes. The final diff was reviewed for unintended changes.
- Raw suite output is `/tmp/ridgeline-93-context/parser-tests.log`; probe source and output are `/tmp/ridgeline-93-context/parser-allocation-probe.ts` and `parser-allocation-probe.log`. These are transient handoff artifacts for root's explicit evidence promotion.
- Dependencies came from a temporary, untracked `node_modules` symlink to the integration checkout. It was not committed and was removed after execution.
- Repeated mesh decoding and overlapping image records have no separate aggregate quota. This is an inspected property of the existing supported subset. The review did not execute an exhaustion workload or establish a target-hardware limit, and it does not introduce an arbitrary total-output or triangle restriction.
- Public registration diagnostics, recovery, browser pixels, native image-decoder allocations, hosted checks, and target-hardware acceptance were not exercised by this documentation-only slice. Root's combined checks and closeout remain separate.
