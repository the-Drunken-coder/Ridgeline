# Matt Pocock skills update

Recorded 2026-10-04. Implementation complete and locally verified; no PR requested.

- Spec: the user's request to update Ridgeline and this machine's shared Matt installations; no feature spec or tracker ticket.
- Integration owner: the Ridgeline coordinating Codex agent, sole writer for shared Matt installations. Atlas Core and Meshtastic own their project changes separately.
- Reviewed: base and head `61616e4819d5501d14ea157905b97808e4899866` plus the uncommitted changes listed below. The coordinator reviewed the project diff and shared installation registrations.
- Local verification: the same uncommitted project changes, snapshot SHA-256 `cf0053a10f1fc6259433221d46c78847f4e89d13b6756c11e66ac6aa3f389533`, passed discovery, metadata, content-preservation, local-link, and diff checks. The snapshot hashes sorted relative filenames, a null byte, file bytes, and a null byte for the six resulting project files below; this evidence record is excluded.
- Hosted verification: not run; no PR or runtime changes. This is not a merge-readiness claim.
- Remaining limits: discovery and configuration were verified, not full agent implementation workflows. Existing sessions may retain loaded skills and project instructions; reload or restart as described below.

## Upstream and active installations

[Matt's latest release](https://github.com/mattpocock/skills/releases/tag/v1.3.1) was rechecked through GitHub's latest-release API and git refs before updating and again at closeout. Version `1.3.1` resolves to commit `24fe0ef7737efae15c87225755e9f6f5965e4888`; the annotated tag object is `0b6cee10f260a2e048279cf737bfd3e37b1fce0b`.

| Harness | Active installation | Final version and revision | Action |
| --- | --- | --- | --- |
| Claude | `/home/ubuntu/.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1` | Official `1.3.1`, upstream `24fe0ef7737efae15c87225755e9f6f5965e4888` | Replaced the stale user registration through Claude's CLI |
| Codex | `/home/ubuntu/.codex/plugins/cache/mattpocock-skills-community/mattpocock-skills-community/0.3.0+upstream.24fe0ef7` | Community `0.3.0+upstream.24fe0ef7`, revision `bcc9c7029d3d90013cbe9007adb4ad5053b018ba`, same upstream commit | Already current; preserved |
| OpenCode | `/home/ubuntu/.config/opencode/skills-repos/mattpocock-skills-community` | Community `0.3.0+upstream.24fe0ef7`, revision `bcc9c7029d3d90013cbe9007adb4ad5053b018ba`, same upstream commit | Already current; preserved |

The worktree and its ancestors contain no project-local Matt skill copies, vendored skills, skill symlinks, lockfiles, or harness overrides. Shared skill roots, plugin registrations, Codex marketplace configuration, and OpenCode's resolved configuration were inspected. Codex enables the community plugin in `/home/ubuntu/.codex/config.toml`; OpenCode discovers its community skills through `/home/ubuntu/.config/opencode/opencode.jsonc`. Claude's synced standalone skills contain no Matt installation. Historical caches and trash are not active registrations. DCS installations were left unchanged.

## Claude update route

`claude plugin marketplace update claude-plugins-official` succeeded, but `claude plugin update mattpocock-skills@claude-plugins-official --scope user --json` reported `1.2.3` as current. The refreshed official catalog still pins `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`; the previously registered installation recorded `959a8e9f1edc3adbe2f7e3054bb6fbefa6696260`.

To reach the release through supported mechanisms:

1. Added Matt's own marketplace with `claude plugin marketplace add mattpocock/skills`.
2. Installed `mattpocock-skills@mattpocock --scope user --json` and verified version, commit, and component discovery.
3. Compared the old installation against its registered upstream archive. It had no modified or missing upstream files or extra user files, excluding runtime directories.
4. Uninstalled `mattpocock-skills@claude-plugins-official --scope user --keep-data --json`. The official marketplace remains registered; plugin data was retained.
5. Ran `claude plugin update mattpocock-skills@mattpocock --scope user --json`, which confirmed `1.3.1` is current.

The CLI updated `/home/ubuntu/.claude/settings.json`, `/home/ubuntu/.claude/plugins/known_marketplaces.json`, and `/home/ubuntu/.claude/plugins/installed_plugins.json`, and installed the new marketplace and plugin cache. No registry or upstream skill files were hand-edited. The active plugin ID is now `mattpocock-skills@mattpocock`; its skill namespace remains `mattpocock-skills:<name>`. Future updates use the `mattpocock` marketplace.

## Ridgeline compatibility migration

- Renamed the actual root domain glossary to [GLOSSARY.md](../../GLOSSARY.md), preserving every byte.
- Updated [AGENTS.md](../../AGENTS.md), [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md), and the [domain adapter](../../docs/agents/domain.md) to the new glossary names. The adapter preserves community prefixes, explains Claude's namespace, and makes project domain paths authoritative for skills with older defaults.
- Updated the relative glossary links in the [terrain-pointer spec](../terrain-pointer/spec.md) and [map](../terrain-pointer/map.md).

No glossary map or other domain glossary exists in this checkout. The only remaining older filename reference outside this closeout is a commit-pinned historical URL in the [reliability spec](../codebase-reliability-repairs/spec.md); it deliberately names the file at that historical revision. The tracker and triage adapters are byte-for-byte unchanged. The three accepted ADRs impose no domain filename constraint and remain unchanged.

## Verification and session refresh

- `claude plugin list --json` shows only the enabled Matt `1.3.1` user install. `claude plugin details mattpocock-skills@mattpocock` discovers 27 promoted skills. The plugin manifest validates without errors; its bundled root `CLAUDE.md` produces a warning that plugin-root instructions are not loaded as project context.
- All 159 upstream regular files and symlinks in the new official installation match the release commit's archive.
- Codex's `skills/list` app-server request with this worktree and `forceReload: true` discovers 33 Matt skills with no discovery errors. `codex plugin list --marketplace mattpocock-skills-community --json` confirms the enabled version; `codex debug prompt-input` includes the migrated project instructions.
- `opencode debug skill` discovers 33 Matt skills. `opencode debug config` confirms the configured community path and shared instruction file.
- YAML metadata parses with unique names and descriptions for all 27 official and both sets of 33 community skills. All three active sets include `implement-spec`, `pr`, and `retro`, and exclude `resolving-merge-conflicts` and the old domain filenames.
- Both community copies pass `python3 scripts/sync_upstream.py --check`. Their 92 skill files are identical; namespace, artifact-kind adaptation, and explicit-invocation policies remain intact.
- The glossary is byte-for-byte identical to the former file. Forty local documentation link targets resolve, excluding illustrative paths in code examples. `git diff --check` passes. No runtime suite was needed for this documentation-only project change.

Restart existing Claude sessions to load the new plugin, or use `/reload-plugins` when supported. New sessions load it automatically. Existing Codex and OpenCode sessions already have current skill files, but restart them to refresh any cached project instructions that still name the former glossary. This active session's injected instructions can also retain the old name; the files on disk and fresh discovery use the migrated paths.
