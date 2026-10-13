# Curated evidence

[Revision/check record and hashes](manifest.json)

- [review.md](review.md)
- [summary.md](summary.md)
- [environment.json](environment.json)
- [replay-starter.png](replay-starter.png)
- [replay-narrow.png](replay-narrow.png)
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
pnpm test:browser
```

```sh
pnpm test:support
```

```sh
pnpm test:playground:browser && pnpm test:controls:browser
```

```sh
pnpm build:playground && pnpm build:controls && pnpm test:measurement
```

```sh
pnpm measure
```

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=.artifacts/viewport-upgrades/support-report.json pnpm test:support --grep 'Workflow controls|Adoption starter|Inspector label editing' --reporter=list,json
```

Extract the raw archive into a separate directory with `tar -xzf raw-reports.tar.gz -C <directory>`. Promotion verifies retained bytes; it does not rerun the recorded checks.
