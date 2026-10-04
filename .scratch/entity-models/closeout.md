# Entity models implementation closeout

Spec: [Approved entity models and representation switching](spec.md), imported unchanged from `21805ecb7543098f8c9820c476725654e20b31ec` on 2026-10-04.

Tracker: [Spec #81](https://github.com/the-Drunken-coder/Ridgeline/issues/81) and [integration #90](https://github.com/the-Drunken-coder/Ridgeline/issues/90).

Integration owner: root Codex coordinator, responsible for combined diff review, checks and revision-specific evidence.

Integration branch: `t3code/implement-spec-81`, based on main at `2733cee9fe9440237a36e90d9efa2fc4239b87c3`. The prototype remains unmerged.

## Ownership and sequence

The native tracker dependencies are authoritative. Start with #82 projection, then #83 registration and solid models. #84 materials, #85 placement and #86 switching follow. #87 picking follows #85/#86, #88 readable feedback follows #84/#86, and #89 recovery follows #86. #90 owns integrated consumer verification. #91 waits for #90 and hardware measurements in #80.

The coordinator assigns concrete file ownership before each delegated implementation. Workers use isolated branches based on the integration branch. No public exports are added solely for tests.

Approved test boundaries are the packaged public viewport workflow and focused parser, geometry and state interfaces named in the spec. Existing consumer checks guard projection extraction. Tests exercise observable behavior and failure paths.

## Verification record

Reviewed: pending implementation. Initial documentation import only.

Local verification: pending implementation checks.

Hosted verification: unavailable, no PR authorized or created.

Remaining limits: implementation is in progress. Target hardware/browser measurements, the triangle/material guideline and production acceptance remain pending in #80 and #91. Software WebGL checks cannot satisfy those gates.
