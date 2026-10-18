# Curated evidence

[Revision/check record and hashes](manifest.json)

- [summary.md](summary.md)
- [review.md](review.md)
- [Byte-exact raw producer reports](raw-reports.tar.gz)

## Reproduction

```sh
pnpm install --frozen-lockfile
```

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
```

```sh
pnpm validate
```

```sh
pnpm test:playground:browser
pnpm test:controls:browser
pnpm build:playground
pnpm build:controls
pnpm test:measurement
```

```sh
pnpm test:browser -- --grep 'Viewport destruction preserves synchronous listener remounts'
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
