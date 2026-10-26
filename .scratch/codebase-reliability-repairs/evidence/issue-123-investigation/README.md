# Curated evidence

[Revision/check record and hashes](manifest.json)

- [summary.md](summary.md)
- [Byte-exact raw producer reports](raw-reports.tar.gz)

## Reproduction

```sh
task_evidence_dir=$(mktemp -d)
tar -xzf raw-reports.tar.gz -C "$task_evidence_dir"
cat "$task_evidence_dir/report.txt"
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
