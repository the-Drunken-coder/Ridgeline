# Curated evidence

[Revision/check record and hashes](manifest.json)

- [summary.md](summary.md)
- [review.md](review.md)
- [Byte-exact raw producer reports](raw-reports.tar.gz)

## Reproduction

```sh
git fetch origin t3/assess-project-alignment
```

```sh
mkdir -p .artifacts/reconciliation-recheck
tar -xzf .scratch/project-consolidation/evidence/reconciliation-2026-10-21/raw-reports.tar.gz -C .artifacts/reconciliation-recheck
python3 .artifacts/reconciliation-recheck/verify-reconciliation.py --evidence-dir .artifacts/reconciliation-recheck
```

```sh
pnpm check
pnpm test
```

```sh
pnpm test:browser -- --grep 'Viewport destruction|Model frame callbacks|Model style failures|models rebuild current presentation|model frames recover|Attachment picking follows|Models cull'
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
