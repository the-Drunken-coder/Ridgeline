# Western-globe readiness evidence

This record preserves the failure and selected control evidence for [issue #123](https://github.com/the-Drunken-coder/Ridgeline/issues/123). Preservation does not diagnose or repair the failure.

## Original failure

[Run 40036469253, attempt 1](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/40036469253) exercised runtime `c747d780d2dcf73efed2a2857d4cb1cb48cd6121`. The retained original failure ZIP includes the Playwright trace, screenshot and error context. Its SHA-256 is `b17d187872f3ed2c2c405ac75115bfef87cd861f539c3bc5d165ab1a5a8b9239`.

The readiness failure observed one timer callback. That counter increments before `upsert`, so it cannot prove publication completion. The catch-time terrain and camera values do not establish their state when the readiness predicate short-circuited. The original capture has no CPU, timer or frame timing that identifies the cause.

## Incomplete diagnostic experiment

[Run 40168970252, attempt 1](https://github.com/the-Drunken-coder/Ridgeline/actions/runs/40168970252) used diagnostic revision `35722efd912b2924a6e546661f7bd9c35439da12` with unchanged production runtime from `c747d78`. Six focused samples and the affected shard passed. Four planned focused samples never ran. The manifest records failure; the green badge resulted from a logging pipeline masking its exit status.

The selection retains all seven target timelines and provenance records, the manifest, executed and unexecuted discovery records, actual results, diagnostic patch, job log, package and consumer lockfile. One real-shard passing-control Chrome profile is retained. Six redundant focused passing-control profiles remain in the pinned local original archive. The full source archive SHA-256 is `1a9ef5dcc11e56d1e3a3e129b3a4d89be02d047dba88e29ace773dc88e656ed1`.

The diagnostic artifact expires on 2026-11-08 at 06:34:24 UTC. Both original source archives were downloaded and integrity-checked on 2026-10-26. GitHub metadata is retained with them. The original failure artifact has a later expiration of 2027-01-21.

## Verify the retained bytes

Extract `raw-reports.tar.gz` into an empty directory. Run `python3 verify.py /path/to/extracted-directory`. The script checks every selected producer member against `selection.json`. The promotion manifest separately hashes the archive, selection record and curated files.

These records preserve historical outcomes. They do not establish current test success, causation, a timing repair, hardware performance or browser certification. Keep the eight-second readiness condition, real pointer input, ongoing live updates and zero retries while investigating.
