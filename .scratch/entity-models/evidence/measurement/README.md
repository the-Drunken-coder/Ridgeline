# Measurement workflow evidence, 2026-10-05

These are software Chromium observations of the installed production package. They verify the measurement workflow and visible workload, not hardware performance or browser support. Root owns integration verification and the shared #90 closeout. Hardware #80/#91 remains pending.

The [index](index.json) identifies all eight current off/on reports and their clean exercised revisions. Every report has a matching PNG and its pair has an overhead JSON. Reports retain package/archive hashes, source state, complete asset manifest, settings, raw RAF/upsert/native/timing/GPU data and explicit missing/coalesced outcomes. CSS canvas is1280×720; the genuine globe case uses physical2560×1440 at map pixel ratio2.

- Icon baseline, mixed original vehicles on flat projection, and material fixtures were exercised at `7ca9649811ca52da28edc88e485e4016b96f60f6`.
- Corrected genuine globe/DPR2 visibility was exercised at `c295a872407c19b58a7e051823ca3f147076b980`. Its alpha-aware predicate rejects transparent background. Both snapshots contain100 foreground regions, with minima48 and82 qualifying pixels.
- Every current report passes final visibility/selection/diagnostic checks and the full five-second zero-map-render idle observation. Model scenes have100 model bodies and1000 native icons; baseline has1100 icons. Submitted/clipped model counts, native rendered pose evidence and foreground-region counts are separate facts.
- [Old globe reports](historical/globe-rgb-only/) are explicitly superseded. Their RGB-only patch counter could count transparent black as foreground. Their automated patch validation must not be treated as valid visibility evidence.

The original four-case command was intentionally interrupted during material setup, after six complete reports had been saved. Only the unfinished material pair was repeated. Root then found the transparent-pixel validation flaw; the pixel regression went RED/GREEN and only the affected globe pair repeated. No incomplete run was presented as a completed matrix.

[Packaged ownership check](checks/measurement-final-ownership.log) passed at `7e7fbcc2ba3e9e4c9312b291e872bd76f8810b00`; production instrumentation is unchanged in the later smoke pins. It executes actual parser/image decode/upload/draw through the installed tarball, verifies disjoint synchronous CPU phases, disabled/cleared timing entries, native worker publication and opacity gating, and nested accepted-update ownership. [Type/ticket check](checks/measurement-final-check.log) and [32 focused checks](checks/measurement-final-focused.log) passed at7ca9649. [Pixel regression](checks/measurement-transparent-pixel-green.log) and [six tooling checks](checks/measurement-pixel-focused.log) passed atc295a87.

GPU samples in this environment are sparse, and empty/one-sample distributions remain unavailable/insufficient. The software intervals are slow. Do not derive a60Hz acceptance claim or triangle guideline from them. The full72-case matrix, native Safari, target Chrome/Firefox/Edge machines and their performance thresholds remain unverified.
