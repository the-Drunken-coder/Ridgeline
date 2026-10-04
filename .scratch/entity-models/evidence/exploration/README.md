# Implementation exploration, 2026-10-04

These are historical supporting artifacts for the [approved spec](../../spec.md) and [implementation closeout](../../closeout.md). They are not production benchmarks or acceptance for later implementation slices.

- [Same-frame probe](same-frame-probe.md): actual packaged viewport pixels establish that explicit preparation of the existing circle/symbol source updates opacity in the current draw. The ordinary control lags one frame. Raw frames, validation and the original script are retained. Real model switching and GPU-failure guarantees require #86's tests.
- [Placement proposal](model-placement-probe.md): independent numerical geometry, captured projection matrices, proper axis handedness and a reproduced exact-point terrain-preparation gap. The scripts are reference experiments; the production implementation and its public workflows still require verification.
- [Globe diagnosis](globe-projection-diagnosis.md): investigation behind the shared projection precision fix. GPU trigonometry and depth samples are retained separately. Final implementation/check evidence is in the closeout.
- [Parser sample results](parser-production-samples.json): the four licensed prototype GLBs parsed by the final pure parser. This does not establish image decoding or rendering.
- [Bundle baseline](bundle-baseline.json): production package baseline before model code, measured with Node gzip. Final production size must be measured again.

Original scripts and notes retain the absolute worktree/output paths used for those experiments. Replaying them requires a checkout at the recorded revision, its installed dependencies and packaged consumer, plus updating those paths for the local environment. They are archived evidence, not the supported measurement workflow. #90 owns that repeatable packaged workflow; #80 and #91 retain the pending hardware and production gates.

All browser observations here used local software Chromium/WebGL. No Apple M1 Pro, discrete GPU or Safari hardware result is implied.
