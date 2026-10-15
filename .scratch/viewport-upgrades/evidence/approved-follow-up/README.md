# Curated evidence

[Revision/check record and hashes](manifest.json)

- [review.md](review.md)
- [summary.md](summary.md)
- [inputs.json](inputs.json)
- [package-identity.json](package-identity.json)
- [Byte-exact raw producer reports](raw-reports.tar.gz)

## Reproduction

```sh
pnpm install --frozen-lockfile
```

```sh
pnpm check
```

```sh
pnpm test
```

```sh
pnpm test:support
```

```sh
pnpm test:browser -- --grep 'Model |models |model |Arrow |Arrowheads|Drawing upgrades touch|Style replacement keeps|Stationary placement follows|Snap callbacks cannot|Destroying during terrain replacement|Destroying from a restoration diagnostic|Permission diagnostic observers'
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
