# Curated evidence

[Revision/check record and hashes](manifest.json)

- [review.md](review.md)
- [summary.md](summary.md)
- [environment.json](environment.json)
- [inputs-handoff.json](inputs-handoff.json)
- [drawing-desktop.png](drawing-desktop.png)
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
pnpm check
```

```sh
pnpm test
```

```sh
pnpm test:support
```

```sh
pnpm test:browser --grep '[Mm]odel|Reliability entity|Drawing upgrades touch|Incremental updates|Picker candidates stay stable|Airborne|airborne|Arrowheads|Arrow editing'
```

```sh
pnpm test:support --grep 'Drawing upgrades holes|Drawing upgrades edge|Inspector label'
```

```sh
pnpm --dir examples/starter install
```

```sh
pnpm --dir examples/starter build
```

```sh
pnpm build:playground
```

```sh
pnpm measure
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
