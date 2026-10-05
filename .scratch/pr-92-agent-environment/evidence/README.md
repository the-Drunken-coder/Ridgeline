# Curated evidence

[Revision/check record and hashes](manifest.json)

- [standards.md](standards.md)
- [spec-review.md](spec-review.md)
- [parser-review.md](parser-review.md)
- [entity-review.md](entity-review.md)
- [summary.md](summary.md)
- [integration-review.md](integration-review.md)
- [verification.json](verification.json)
- [models.png](models.png)
- [Byte-exact raw producer reports](raw-reports.tar.gz)

## Reproduction

```sh
git checkout 361af95d341c441e6d7598626d7bc5c51a62fcb7
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm validate
```

```sh
# From the pinned checkout, extract a separately retained archive.
task_evidence_dir=$(mktemp -d)
tar -xzf /absolute/path/to/raw-reports.tar.gz -C "$task_evidence_dir"
node --import tsx "$task_evidence_dir/safe-parser-replay.mts"
node "$task_evidence_dir/standards-malformed-retention-probe.mjs"
node "$task_evidence_dir/standards-empty-argument-probe.mjs"
node "$task_evidence_dir/standards-snapshot-recovery-probe.mjs"
```

```sh
node --test scripts/test-browser.test.mjs scripts/promote-evidence.test.mjs scripts/test-measurement.test.mjs scripts/validation.test.mjs
```

```sh
# From a checkout retaining the curated evidence.
sha256sum .scratch/pr-92-agent-environment/evidence/raw-reports.tar.gz
# Compare the result and each extracted member hash with manifest.json.
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
