# Entity-model measurements

This is a dedicated consumer of the packed production library. It keeps measurement controls out of the playground and adds no public library export. Root is the integration owner for #90. Target-browser support, performance acceptance and the triangle/material guideline remain #80/#91.

Run from the repository root:

```sh
pnpm test:measurement
pnpm validate
pnpm measure:models --verify
pnpm measure:models --smoke --case original-mixed-flat-dpr1
pnpm measure:models --smoke --matrix
pnpm measure:models --hardware --browser chrome --metadata machine.json --matrix
pnpm measure:models --serve
```

The command builds and packs the library, generates real GLBs, installs the tarball in an isolated consumer, typechecks and builds that consumer, then serves it on port 5178. `--port` changes the port. The checkout's existing browser-artifact lock prevents competing builds. An interrupted child process retains the lock until its remaining processes have stopped. Build assets are under `.artifacts/model-measurement/`; they are not library package files.

`pnpm test:measurement` runs the existing report, workload and pixel tests, including the 40 CSS px model-size assertion, followed by one packed-consumer instrumentation/ownership probe. `pnpm validate` includes that command exactly once. CI runs it in the required `model-measurement` job; the aggregate `validate` gate rejects a failed, cancelled, missing or skipped result. This verification uses software Chromium and does not run the hardware matrix.

Each test command retains raw stdout and stderr plus `context.json` under `.artifacts/validation/model-measurement/run-*/`. The context records the command, checkout path, tested Git revision, dirty status/diff hash, Node version and stage exit results. Hosted runs also identify the PR head, workflow revision and Actions run when available. The workflow uploads these files with the produced verification report, package provenance and asset manifest. Context is recorded before dependency/browser installation so setup failures still identify the checkout. A missing revision stays unknown; a PR head and a tested merge checkout are separate facts.

`--verify` executes the opt-in phase/ownership probe in software Chromium. Smoke uses short, explicitly unrated software runs. Neither satisfies hardware acceptance. Without `--matrix` or `--case`, automation samples four cases: icon baseline, mixed original vehicle assets, assigned-color genuine globe at pixel ratio 2, and original material fixtures. The full matrix has 72 cases. Each runs instrumentation off and on, stationary then moving camera, using identical seeded positions. All-original, all-assigned and mixed appearances are separate dimensions. The normalized 1× rewrite is a control for distinguishing repacking from increased triangle count.

A hardware metadata file requires these fields:

```json
{
  "device": "Manufacturer and exact machine / chip",
  "os": "OS and version",
  "gpu": "Exact GPU model",
  "driver": "Driver version and graphics backend",
  "browser": "Browser and exact version",
  "displayHz": 60
}
```

Hardware mode requires at least 10 seconds of warmup after assets and terrain/native sources are ready, then three 30-second runs per camera mode. It launches a headed browser without software-rendering flags and rejects known software renderers. `--browser` accepts `chromium`, installed `chrome`, installed `edge`, or `firefox`. Record the actual browser reported in the raw report; Playwright Chromium does not establish Chrome support. Missing or failed GPU timers do not invalidate CPU/frame observations and never become zero GPU cost.

For native Safari, run `--serve` on the Mac and open the printed URL in installed Safari. The same built consumer provides case selection, machine metadata, paired off/on execution and a JSON download containing raw observations and PNG snapshots. Playwright WebKit is not Safari acceptance. Keep the tab foregrounded, prevent sleep, and keep the fixed 1280 × 720 CSS canvas visible. Select pixel ratio 1 or 2 in the case; physical canvas size and actual browser DPR are recorded separately. Collect the specified M1/discrete-GPU/browser matrix in #80, rather than treating one machine or the smoke sweep as complete hardware coverage.

## Workload and evidence

There are 100 model-capable entities, 25 each of drone, tank, plane and boat, plus 1,000 native icons. Every accepted batch updates all 1,100 entities at a scheduled 100 ms cadence. Missed cadence is recorded rather than replayed as a burst. The icon baseline removes model references and retains all entities and trajectories. The scene has flat zero-meter terrain enabled, exaggeration 1, the approved 40 CSS px model-size floor, two selected instances and one previewed instance. The globe case uses MapLibre's public `vertical-perspective` projection override to retain actual globe rendering at the close camera zoom; effective projection and observed blend are recorded.

The generator in `scripts/model-workloads.ts` preserves the original source bytes and emits normalized, 4× and 16× triangle GLBs. Its manifest contains geometry/material/image/sampler counts, bounds, hashes and provenance. Stress variants subdivide baked geometry; interpolated normals are normalized, so smooth shading can differ slightly. Separate opaque, MASK, double-sided and BLEND fixtures exercise the supported material paths. Source credits and license files accompany generated assets. Generated geometry is never injected into a private runtime registry.

Each automated case writes JSON, a PNG, an off/on comparison and an index. Reports capture package archive hash, source revision/status/diff hash, asset manifest, browser/renderer/backend, settings, cold registrations, every RAF interval and synchronous upsert duration, native observations, completed model-frame facts, phase records, unique GPU results, diagnostics and a five-second idle observation. Dirty source is explicitly identified; retain clean pinned runs for acceptance. Screenshots and 100 geographic model-region pixel counts provide visual corroboration. A foreground pixel needs alpha above 16/255 and RGB contrast above 30/255 against the light background; transparent globe background does not count. Submitted model count, clipped screen-box count and public representation count are distinct facts; none alone proves that every model pixel is unoccluded.

## Timing meaning

Production instrumentation is disabled unless the dedicated consumer sets `canvas.dataset.ridgelineMeasure = 'true'`. Disabled phases do not read measurement clocks, create records or schedule work. Enabled measurements use numeric User Timing entries and asynchronous `PerformanceObserver` delivery. Entries are cleared immediately after enqueueing, so the browser timeline does not accumulate them. No consumer measurement callback runs inside rendering.

- `parse` is synchronous GLB parsing, with model and attempt identity.
- `decode-wall` spans an individual asynchronous image decode. It is wall time, not CPU time.
- `texture-upload` and `geometry-upload` are synchronous GPU-resource submission stages, separate from decode.
- `shader-compile` is cold shader compile/link setup. It is not warm draw cost.
- `scene-cpu` contains sums of disjoint placement and clipped-box projection/floor-scaling operations within a frame preparation. It excludes unrelated feature publication and preflight work.
- `instance-preparation` covers instance conversion and buffer uploads; `submit` covers actual model draw submission; `picking` covers actual model-box tests, including terrain-depth checks.
- GPU elapsed time surrounds the model custom layer's commands, including any render-time repair. Samples have unique IDs, issue/completion times and one result each. The adapter avoids an active elapsed-time query, bounds pending queries, rejects disjoint/lost/expired queries, polls without repainting and deletes handles.

CPU phase values are elapsed synchronous main-thread spans, including stalls and scheduling delays, rather than sampled processor execution time. CPU submission and GPU execution overlap. Do not add them, or add decode wall time to synchronous CPU stages. Frame intervals are independent RAF observations, including frames that contain no map render. Native full-batch queries and phase instrumentation have overhead; their raw query costs and paired off/on results are retained. Off and on run sequentially; repeat in reversed order when studying thermal or ordering effects. Do not subtract the observed difference from GPU samples or claim zero overhead.

Accepted update revisions are captured before consumer callbacks can replace data. Completed model frames retain the revision actually drawn. Native latency uses actual rendered icon marker pose keys, grouped by accepted workload sequence, rather than source submission or the latest store. A full native latency sample requires all expected native IDs at one revision; mixed, missing, coalesced and superseded revisions remain in raw coverage and outcomes. Pose matching retains the latest 150 batches; older unmatched native data is explicitly unattributed. Instrumentation-off latency is unavailable. Model latency is not applicable to the icon-only baseline.

Percentiles require at least two observations; sample counts accompany every distribution. Zero samples means unavailable and one means insufficient samples. Review failed and missing coverage alongside latency, rather than selecting only fast visible updates. The 60 Hz targets remain frame p50 ≤ 17.5 ms, p95 ≤ 20 ms, p99 ≤ 33.4 ms and visible update latency p95 ≤ 100 ms. Reports do not turn a smoke result, partial matrix, missing visibility or one successful browser into performance acceptance. Stress failures should be retained to locate limits. Baseline failures remain limitations.
