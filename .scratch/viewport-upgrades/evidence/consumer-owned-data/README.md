# Curated evidence

[Revision/check record and hashes](manifest.json)

- [review.md](review.md)
- [summary.md](summary.md)
- [environment.json](environment.json)
- [drawing-starter.png](drawing-starter.png)
- [drawing-narrow.png](drawing-narrow.png)
- [Byte-exact raw producer reports](raw-reports.tar.gz)

## Reproduction

```sh
pnpm install --frozen-lockfile
```

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
```

```sh
pnpm check && pnpm test
```

```sh
pnpm test:support
```

```sh
pnpm test:browser --grep 'Incremental updates replace data without moving the camera|Picker candidates stay stable during movement|Drawing upgrades touch'
```

```sh
pnpm build:playground && pnpm measure
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
