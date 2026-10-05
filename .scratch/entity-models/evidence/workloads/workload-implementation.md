# Offline model workloads and repackaging proof

Date: 2026-10-04. Task #90, canonical requirements `/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/.scratch/entity-models/spec.md`. Root owns combined integration verification; model_research owns the packaged measurement consumer.

## Delivery

- Worktree `/tmp/ridgeline-model-workloads`, branch `implement/entity-model-workloads`.
- Base `13bab3f25165b279499dcf74c1a5a97ad18f126f`; reviewed generator revision `a6f00cc1d7cbce1b29e2458018cd4de4d84d946f`; initial tree `6bec083a3fc95dfd65891d119500304df7e45e9d`.
- Final aligned delivery `9d1f717b0a1a3e439c6f70399c4dd11e722e4cf5`, tree `83815368aeb8d69c945026438e4cc62a3bca7ca7`, includes latest authorized root `7bfb02484a6dee6a22f1866fff0cbec088f34e4a`. Generator and focused test files are unchanged from the reviewed generator revision. Worktree clean; `git diff --check` passed.
- Owned additions: `scripts/model-workloads.ts`, `tests/model-workloads.test.ts`. Licensed assets imported from projection's `ac74cde` without modification. No package.json, production runtime, consumer, public exports or dependency edits.
- Viable commit `1cf0024`; final format correction `a6f00cc`. Consumer must regenerate after the final correction because derived hashes changed.

## Generator contract

```sh
node --import tsx scripts/model-workloads.ts
# Optional positional arguments:
node --import tsx scripts/model-workloads.ts playground/public/entity-models .artifacts/model-measurement/assets
```

Exports `createModelWorkloads(bytes: ArrayBuffer)` and `writeModelWorkloads(sourceDir?, outputDir?)`. The first returns actual independently parsable GLB bytes and metadata; the second writes those files and `manifest.json`. Private parser access occurs only in offline tooling. Outputs stay under ignored `.artifacts`, outside package files.

`manifest.assets[]` contains `id`, source author/page/download/license/license URL/hash/byte count and original modification metadata, plus four `variants[]`: `original`, `normalized`, `4x`, `16x`. Each variant has factor, relative path, SHA-256, bytes, triangles, vertices, material count/details, bounds, image MIME/hash/byte counts and count of distinct effective sampler settings. `provenanceFiles[]` hashes copied `sources.json`, `Kenney-License.txt` and `credits.html`. `transformation` records exact normalization/subdivision choices and limitations. Source `sources.json`, including acquired date, is copied unchanged.

`manifest.fixtures[]` provides IDs `opaque`, `mask`, `double-sided`, `blend`, each with relative path and the same geometry/material/image metadata. All four use identical project-authored two-triangle geometry and the same real embedded alpha PNG, so the material flag is the variable. MASK cutoff is 0.6. Synthetic provenance identifies the existing material fixture helper. No third-party license is invented: `license: null` and a note state the absence of a separate declared license for repository-authored fixtures.

| Vehicle | Original / normalized triangles | 4x | 16x | Parsed material batches | Embedded images |
| --- | ---: | ---: | ---: | ---: | ---: |
| Drone | 4,564 | 18,256 | 73,024 | 1 | 1 PNG |
| Tank | 760 | 3,040 | 12,160 | 5 | 0 |
| Plane | 1,434 | 5,736 | 22,944 | 4 | 0 |
| Boat | 156 | 624 | 2,496 | 1 | 1 PNG |

Original files remain byte-for-byte unchanged. Normalized 1x serializes production-parsed, baked attributes with identity nodes in authored glTF axes, float32 attributes, uint32 indices and explicit bounds. Four-way midpoint subdivision preserves winding and surface coverage; it shares edge midpoints within each material batch and interpolates UV/RGBA values. Material parameters, independent sampler settings, UV transforms, image bytes and alpha modes survive every variant. No overlapping duplicate faces are used. Maximum observed bounds rounding over all supplied assets/variants was `1.1183993997576636e-7` authored units.

Interpolated normals are normalized at each subdivision pass, matching production loading. This preserves original corner directions but can change smooth shading at new vertices. Drone and boat contain varying-normal triangles. The manifest states this explicitly; use normalized 1x to separate packing changes from added triangles. These fixtures set no production triangle limit.

## Executed checks

- `node --import tsx --test tests/model-workloads.test.ts`: 4 passed at `a6f00cc` and repeated at final aligned `9d1f717`. Coverage includes a known mirrored/transformed triangle's exact area and winding, original-byte retention, UV interpolation, original corner attributes, materials/alpha/UV transforms, shared images with independent samplers, deterministic output, malformed input rejection, and full on-disk output/provenance for all four real sources plus the four material cases.
- `pnpm exec tsc --noEmit`: passed at both revisions.
- CLI default generation: 16 vehicle GLBs plus 4 material fixtures.
- Independent pinned `@gltf-transform/cli@4.5.0 validate`: all 12 derived vehicle GLBs and 4 material fixtures, zero errors and zero warnings. Raw logs and summary: `/tmp/ridgeline-model-context/workload-validation/`. Solid assets have informational unused TEXCOORD_0 messages because the common packing control retains the parser's default UVs.
- Executed RED history: independent validator rejected empty optional arrays in solid derived GLBs at `1cf0024`; a focused regression test then failed before omission was implemented. Final validation also confirms explicit bounds for normalized synthetic fixtures.
- Local diff reviewed against base, including midpoint winding, attribute interpolation, material/image references, source metadata and CLI paths. No uncommitted changes.

Evidence: `workload-focused.log`, `workload-tsc.log`, `workload-summary.json`, `workload-manifest.json` under `/tmp/ridgeline-model-context`. Generated files remain at `/tmp/ridgeline-model-workloads/.artifacts/model-measurement/assets`. Final manifest SHA-256: `eb35134dddf6c2f43b7847db66cd3ceb5fe2df896ca9235cbf627727b1884daa`.

## README repackaging evidence

The [official glTF Transform CLI documentation](https://gltf-transform.dev/cli) documents `copy` as a minimal-change conversion. Executed with Node v24.21.0 and CLI version 4.5.0, outside the project dependencies:

```sh
npx --yes @gltf-transform/cli@4.5.0 --version
# 4.5.0
npx --yes @gltf-transform/cli@4.5.0 copy input.gltf output.glb
npx --yes @gltf-transform/cli@4.5.0 validate output.glb
```

Working directory `/tmp/ridgeline-model-context/repackaging-proof` contains the real external `input.gltf`, `mesh.bin` and `texture.png`, resulting `output.glb`, command logs and `report.json`. Keep external files at the URI-relative paths declared by the input. Copy embedded both the buffer and PNG, leaving no external resource URI. The 126-byte PNG remained byte-for-byte identical. The production parser accepted the resulting 1,212-byte GLB and preserved the one-triangle bounds, base RGBA, MASK cutoff 0.6, unlit flag, double-sided flag and independent sampler settings. Validator reported no errors, warnings, infos or hints.

Output SHA-256: `e90b5204aaa36d27a3a19c1b90b54baef57e906b80c919ee80fc11ac58827761`. Exact hashes of every input and output are in `repackaging-proof/report.json`. The parse proof ran at `1cf0024`, whose production parser is identical to the final generator revision.

This conversion example establishes embedding, not support for skins, morphs, compressed geometry, unsupported required extensions or new material models. Do not use broad optimization presets that introduce Draco or WebP outside the accepted subset. Consumers still supply the resulting embedded bytes through registration; Ridgeline gains no network resolver or runtime dependency.

## Remaining scope

This delivery verifies offline bytes and metadata. The primary measurement worker owns packaged registration, rendering and measurement use of these files; root owns integrated checks and README/versioned closeout. Hardware #80/#91, actual supported-browser acceptance, performance thresholds and a triangle/material guideline remain pending. No PR, push or tracker updates were performed.

## Separate authorized merger phase

After generator delivery, root approved only focused fix `de3b0aad2189667c39cee244baf8f29e03163f49`. It was merged with `--no-ff` into clean root `b3576bcf5b7c110dd960788d582f747326d628e9`, producing `7bfb02484a6dee6a22f1866fff0cbec088f34e4a`, tree `71efa607be57166ac2c268531d65066626a56462`. Verified the exact two approved hunks: synchronous hover refresh on entity removal, and removal of a redundant camera display geometry-dirty mark. Diff was one insertion/two deletions, clean status and whitespace; root owns the affected regression checks. No generator code was merged into root. Then root explicitly authorized the final workload branch alignment recorded above.
