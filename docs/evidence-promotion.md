# Promoting evidence at closeout

Development output belongs in ignored `.artifacts/` directories. Authored specs, approval records, design contracts, reviews, closeouts, and ticket snapshots remain at their existing `.scratch/` paths with their authority unchanged. Generated evidence and prototype directories are ignored. Do not commit investigation archives, screenshots, tarballs, or curated closeout sets. Historical evidence collected before this policy remains reachable in git history under [`.scratch` at 2856656](https://github.com/the-Drunken-coder/Ridgeline/tree/2856656a885f8b53e0600953a4698c446a3ea68f/.scratch).

If a compact final set is worth keeping after a run, package it under `.artifacts/evidence/<feature>/` and attach it to the pull request or a workflow artifact. Findings that belong in the repository should be written into ordinary docs, ADRs, or GitHub issues, not into a parallel evidence tree.

## Protect the selected inputs

Finish or stop the producer before taking a snapshot. Browser-run retention uses `.artifacts/browser-runs/<suite>-<ISO>-<uuid>/` and measurement retention uses `.artifacts/model-measurement/run-<ISO>-<uuid>/`. A `.pin` file protects selected output from pruning, including automatically pinned failures. Add a pin before promoting a completed run you need to retain. Running, interrupted, and unknown ownership, tracked/nonignored files, and symlink paths stay protected under the runner policy. `.artifacts/validation/` is outside automatic cleanup.

Promotion never edits producer files or removes a pin. Leave the pin in place during a dry run, after failed verification, and until the packaged set has been reviewed. The run owner may then explicitly remove that run's `.pin` to release retention. Promotion into `.artifacts/evidence/` stays ignored even after the transient source is released. Do not remove an ownership record or lock to release evidence.

## Select and verify the final set

Write a plan in `.artifacts/`. Each selected source must be an ignored, untracked regular file inside that directory, without a symlink in its path. Curated Markdown links are relative to their final location. Use simple unique output names. The generated `README.md`, `manifest.json`, and `raw-reports.tar.gz` names are reserved.

```json
{
  "destination": ".artifacts/evidence/my-feature/final",
  "provenance": {
    "spec": ".scratch/my-feature/spec.md",
    "integrationOwner": "root",
    "reviewed": { "base": "<base SHA>", "head": "<head SHA>", "result": "<review outcome>" },
    "localVerification": [{ "revision": "<exercised SHA and any uncommitted input>", "command": "<command>", "result": "<outcome>" }],
    "hostedVerification": "<PR head, tested checkout, run URL and results, or unavailable>",
    "historical": [],
    "remainingLimits": ["<unverified behavior or pending acceptance>"]
  },
  "reproduction": ["pnpm install --frozen-lockfile", "<original verification command>"],
  "files": [
    { "source": ".artifacts/closeout/review.md", "name": "review.md" },
    { "source": ".artifacts/closeout/summary.md", "name": "summary.md" },
    { "source": ".artifacts/closeout/selected.png", "name": "selected.png" }
  ],
  "rawReports": [
    { "source": ".artifacts/closeout/producer.json", "name": "producer.json" },
    { "source": ".artifacts/closeout/verification.log", "name": "verification.log" }
  ]
}
```

New plans must include the spec, integration owner, reviewed base/head commit SHAs and review outcome, at least one local verification record with its exercised commit SHA, command and outcome, hosted verification or an explicit unavailable record, and a remaining-limits array (empty when there are none). Reviewed pins must be full 40-character commit SHAs. A local revision starts with its full commit SHA and may append the uncommitted inputs and their patch hash. Failed checks are valid evidence when their outcomes are recorded honestly. Existing historical manifests in git history retain their original format and bytes.

```sh
node scripts/promote-evidence.mjs .artifacts/promotion-plan.json --dry-run
node scripts/promote-evidence.mjs .artifacts/promotion-plan.json
```

The [promotion command](../scripts/promote-evidence.mjs) validates the provenance before staging the explicit selections in ignored output, copying curated files, archiving raw reports, and comparing extracted members with producer bytes. It records each file/member's byte count and SHA-256, plus the archive hash. It parses inline and reference-style Markdown links and images, then checks relative file targets and heading fragments. Examples inside code spans or code blocks are not links. The destination must be a new directory under ignored `.artifacts/evidence/`; existing evidence is never overwritten. The dry run performs the same verification and removes its own staging directory without creating the destination. Neither mode commits files or runs the recorded runtime checks.

Read `manifest.json` for the provenance and hashes. Extract the archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`; compare `sha256sum` for the archive and members with the record. Relative links must point to retained files or Git-tracked repository documents. Stage a new repository document with `git add` before referring to it from curated evidence. Missing, ignored and untracked external targets fail verification; check remote and non-Markdown references separately. The command validates the record's shape and retained files, not whether a reported outcome or revision claim is true.

Confirm `git check-ignore` identifies the destination. Do not `git add` it. Attach the directory or a compressed copy to the pull request or a workflow artifact if reviewers need it. Report the promotion command, source/check pins, verified hashes, and remaining limits in closeout. The [subprocess regressions](../scripts/promote-evidence.test.mjs) exercise real files and archives, pin preservation, dry-run cleanup, and rejected source/destination paths.
