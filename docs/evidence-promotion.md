# Promoting evidence at closeout

Development output belongs in ignored `.artifacts/` directories. At closeout, the integration owner selects a compact final set for `.scratch/<feature>/evidence/`. Useful research or decision artifacts can be versioned deliberately before closeout. Existing tracked historical evidence stays intact.

The [tracker closeout record](agents/issue-tracker.md#closeout-record) owns the verification claims. Keep final Standards/Spec review reports, a compact record of reviewed and exercised revisions, readable summaries, selected visuals, and compressed original producer reports. Keep unsuccessful attempts and historical results dated; curation does not turn them into current successes.

## Protect the selected inputs

Finish or stop the producer before taking a snapshot. Browser-run retention uses `.artifacts/browser-runs/<suite>-<ISO>-<uuid>/` and measurement retention uses `.artifacts/model-measurement/run-<ISO>-<uuid>/`. A `.pin` file protects selected output from pruning, including automatically pinned failures. Add a pin before promoting a completed run you need to retain. Running, interrupted, and unknown ownership, tracked/nonignored files, and symlink paths stay protected under the runner policy. `.artifacts/validation/` is outside automatic cleanup.

Promotion never edits producer files or removes a pin. Leave the pin in place during a dry run, after failed verification, and until successful promotion has been reviewed. The run owner may then explicitly remove that run's `.pin` to release retention. Promotion into `.scratch/` remains protected even after the transient source is released. Do not remove an ownership record or lock to release evidence.

## Select and verify the final set

Write a plan in `.artifacts/`. Each selected source must be an ignored, untracked regular file inside that directory, without a symlink in its path. Curated Markdown links are relative to their final location. Use simple unique output names. The generated `README.md`, `manifest.json`, and `raw-reports.tar.gz` names are reserved.

```json
{
  "destination": ".scratch/my-feature/evidence/final",
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
    { "source": ".artifacts/closeout/standards-review.md", "name": "standards-review.md" },
    { "source": ".artifacts/closeout/spec-review.md", "name": "spec-review.md" },
    { "source": ".artifacts/closeout/summary.md", "name": "summary.md" },
    { "source": ".artifacts/closeout/selected.png", "name": "selected.png" }
  ],
  "rawReports": [
    { "source": ".artifacts/closeout/producer.json", "name": "producer.json" },
    { "source": ".artifacts/closeout/verification.log", "name": "verification.log" }
  ]
}
```

```sh
node scripts/promote-evidence.mjs .artifacts/promotion-plan.json --dry-run
node scripts/promote-evidence.mjs .artifacts/promotion-plan.json
```

The [promotion command](../scripts/promote-evidence.mjs) stages the explicit selections in ignored output, copies curated files, archives raw reports, and compares extracted members with producer bytes. It records each file/member's byte count and SHA-256, plus the archive hash. It checks relative Markdown file links and heading fragments before publication. The destination must be new; existing evidence is never overwritten. The dry run performs the same verification and removes its own staging directory without creating the destination. Neither mode runs the recorded runtime checks.

Read `manifest.json` for the provenance and hashes. Extract the archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`; compare `sha256sum` for the archive and members with the record. Relative links must point to the retained files or repository documents; check remote and non-Markdown references separately. The command validates the retained files, not whether a reported outcome or revision claim is true.

Review the promoted diff and check `git check-ignore` still identifies intermediate output while the curated destination remains versionable. Add the curated directory only after checking its record and links. Report the promotion command, source/check pins, verified hashes, and remaining limits in closeout. The [subprocess regressions](../scripts/promote-evidence.test.mjs) exercise real files and archives, pin preservation, dry-run cleanup, and rejected source/destination paths.
