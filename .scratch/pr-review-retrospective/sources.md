# Source inventory

Collected from GitHub on 2026-10-05 between 19:35:04 and 19:36:09 UTC. Scope is Ridgeline only, as requested. Baseline checkout and collected default branch were `bf4cfca0ccaa7b781f7e3671d4982000bc9c3c50`.

## Coverage

| Channel | Retrieved | Nonempty bodies | Treatment |
| --- | ---: | ---: | --- |
| Inline review comments | 137 | 137 | Read findings and replies, retaining thread context. |
| Review submissions | 107 | 33 | Read every nonempty body, including summary-only findings. Empty submissions supply metadata. |
| PR conversations | 89 | 89 | Read substantive feedback and classify deployment/status/summary noise. |
| Total | 333 | 259 | Records overlap in meaning; these are not 333 distinct findings. |

There are 37 visible PRs: 36 merged and one open. The inline comments occupy 63 threads, 52 resolved and 11 unresolved at collection. Historical unresolved threads are not automatically outstanding defects on today's code.

| Author account | Inline | Review submissions | PR conversations |
| --- | ---: | ---: | ---: |
| `the-Drunken-coder` | 40 | 40 | 10 |
| CodeRabbit | 91 | 64 | 39 |
| Codex connector | 6 | 3 | 5 |
| Vercel | 0 | 0 | 35 |

GraphQL account names omit the `[bot]` suffix seen in REST. Comments under the repository owner's account include explicit agent-authored replies; the login alone cannot distinguish the human from a coding agent. This retrospective does not invent that attribution.

## Retrieval and analysis

- Paginated REST reads collected every PR with `state=all`, repository inline comments, and repository issue conversation comments. The issue endpoint yielded 183 comments; filtering by the complete PR-number set retained 89 PR comments and excluded 94 issue comments.
- A GraphQL read collected PR bodies, head revisions, review bodies, thread resolution/outdated state, and thread comments. Every PR, review, thread, and thread-comment pagination flag was checked; none had another page. Its inline IDs matched the REST corpus.
- Two read-only investigations divided the full history into PRs through #35 and PRs from #37 onward. The coordinating agent reviewed the combined recommendations, author replies, disputed suggestions, current test examples, existing policy/check wiring, and PR #102's pending changes.
- Analysis covered the 33 nonempty review bodies as well as inline threads. Summary-only test findings on #23, #24, and #44 were included even though the reviewer categorized them as nitpicks.
- The versioned proposals retain source links and this coverage inventory. Raw response bodies, repeated walkthroughs, and deployment notices were kept out of the proposal files.

## Exclusions and limits

Vercel's 35 deployment notices, empty review submissions, review-trigger requests, processing/rate-limit notices, repeated walkthroughs, and generic docstring warnings do not establish coding-standard defects. Substantive findings inside larger summaries were still examined.

Feedback disproved or narrowed by author evidence remains useful review-process evidence, but is not presented as a rule violation. Examples include #35's required-gate cancellation condition, #42's render listener, #43's synchronous drag cleanup, #92's default dot fallback, and #24's independent-renderer request. Cached scope warnings were compared with final PR descriptions. The suggestion to remove public `reportCallbackError` was not adopted because the current public contract deliberately retains it.

The source corpus consists of visible GitHub comments and review bodies. Deleted comments, private agent sessions, and findings available only in third-party dashboards are outside this evidence. PR status and thread disposition are the collected snapshot, not continuous monitoring.

Historical author reports of passing checks were read as dated evidence. This retrospective ran documentation validation only. Current-code observations and the four unanswered findings on #102 are supported by inspection, without executed reproductions. Current branch protection and hosted checks were not verified.

## PR inventory

Counts include replies and non-actionable bodies. Review counts include empty submissions. Each PR's discussion remains the entrypoint to its complete GitHub history.

| PR | Title | Inline | Reviews | Conversation |
| --- | --- | ---: | ---: | ---: |
| [#1](https://github.com/the-Drunken-coder/Ridgeline/pull/1) | feat: add Ridgeline map viewport and playground | 4 | 1 | 1 |
| [#2](https://github.com/the-Drunken-coder/Ridgeline/pull/2) | feat(playground): add SIDC Kit integration demo | 0 | 0 | 1 |
| [#3](https://github.com/the-Drunken-coder/Ridgeline/pull/3) | fix: keep rendered features in sync with updates | 2 | 1 | 2 |
| [#4](https://github.com/the-Drunken-coder/Ridgeline/pull/4) | feat: add configurable hillshade styling | 2 | 1 | 2 |
| [#5](https://github.com/the-Drunken-coder/Ridgeline/pull/5) | feat: add airborne entities and terrain-aware camera footprints | 6 | 2 | 2 |
| [#6](https://github.com/the-Drunken-coder/Ridgeline/pull/6) | feat(playground): add ten control scheme experiments | 3 | 4 | 2 |
| [#7](https://github.com/the-Drunken-coder/Ridgeline/pull/7) | feat: add map drawing and editing | 24 | 18 | 2 |
| [#8](https://github.com/the-Drunken-coder/Ridgeline/pull/8) | feat: render GPU camera coverage with terrain-aware wireframes | 12 | 9 | 2 |
| [#9](https://github.com/the-Drunken-coder/Ridgeline/pull/9) | fix: address drawing, camera, and control review findings | 0 | 0 | 2 |
| [#10](https://github.com/the-Drunken-coder/Ridgeline/pull/10) | refactor: centralize feature publication and retry | 3 | 3 | 2 |
| [#12](https://github.com/the-Drunken-coder/Ridgeline/pull/12) | fix: keep sensor camera coverage coherent during updates | 4 | 3 | 2 |
| [#13](https://github.com/the-Drunken-coder/Ridgeline/pull/13) | docs: define repository code conventions | 0 | 0 | 2 |
| [#14](https://github.com/the-Drunken-coder/Ridgeline/pull/14) | refactor: share drawing preview and placement sizing | 0 | 0 | 2 |
| [#21](https://github.com/the-Drunken-coder/Ridgeline/pull/21) | refactor(playground): keep only everyday map controls | 1 | 1 | 2 |
| [#23](https://github.com/the-Drunken-coder/Ridgeline/pull/23) | refactor: model sensor-camera coverage as one state | 0 | 1 | 2 |
| [#24](https://github.com/the-Drunken-coder/Ridgeline/pull/24) | refactor(drawing): integrate shape, preview and viewport ownership | 3 | 3 | 2 |
| [#26](https://github.com/the-Drunken-coder/Ridgeline/pull/26) | refactor(drawing): keep shape editing rules in one module | 0 | 0 | 2 |
| [#27](https://github.com/the-Drunken-coder/Ridgeline/pull/27) | refactor(drawing): move cursor preview into editing session | 0 | 1 | 2 |
| [#28](https://github.com/the-Drunken-coder/Ridgeline/pull/28) | refactor: keep attachment geometry in raw meters | 0 | 0 | 2 |
| [#29](https://github.com/the-Drunken-coder/Ridgeline/pull/29) | refactor(terrain): integrate elevation and camera ownership | 3 | 3 | 2 |
| [#30](https://github.com/the-Drunken-coder/Ridgeline/pull/30) | test: validate consumer workflows in browsers | 0 | 0 | 2 |
| [#31](https://github.com/the-Drunken-coder/Ridgeline/pull/31) | fix: make Ridgeline reliable for external consumers | 12 | 10 | 2 |
| [#35](https://github.com/the-Drunken-coder/Ridgeline/pull/35) | ci: parallelize consumer validation and track nightly failures | 6 | 5 | 2 |
| [#37](https://github.com/the-Drunken-coder/Ridgeline/pull/37) | chore: enforce agent workflow checks after PR retrospective | 6 | 5 | 2 |
| [#42](https://github.com/the-Drunken-coder/Ridgeline/pull/42) | feat(drawing): place ground points with reliable terrain feedback | 3 | 3 | 2 |
| [#43](https://github.com/the-Drunken-coder/Ridgeline/pull/43) | feat(drawing): snap and edit ground positions precisely | 3 | 3 | 2 |
| [#44](https://github.com/the-Drunken-coder/Ridgeline/pull/44) | feat(interactions): coordinate navigation and ground placement | 3 | 4 | 2 |
| [#45](https://github.com/the-Drunken-coder/Ridgeline/pull/45) | fix(drawing): keep ground targets current through scene changes | 0 | 0 | 2 |
| [#46](https://github.com/the-Drunken-coder/Ridgeline/pull/46) | docs: require transition coverage for shared ticket work | 0 | 0 | 2 |
| [#49](https://github.com/the-Drunken-coder/Ridgeline/pull/49) | fix(tests): make local validation portable on macOS | 0 | 0 | 2 |
| [#51](https://github.com/the-Drunken-coder/Ridgeline/pull/51) | fix(interactions): preserve current content through callbacks | 0 | 0 | 2 |
| [#53](https://github.com/the-Drunken-coder/Ridgeline/pull/53) | Guard drawing acceptance and entity rendering after consumer callbacks | 0 | 0 | 2 |
| [#68](https://github.com/the-Drunken-coder/Ridgeline/pull/68) | fix: repair viewport ownership, geometry and recovery | 3 | 3 | 9 |
| [#69](https://github.com/the-Drunken-coder/Ridgeline/pull/69) | fix(drawing): preserve drafts and recover from callback failures | 12 | 9 | 9 |
| [#70](https://github.com/the-Drunken-coder/Ridgeline/pull/70) | docs(testing): document manual macOS validation policy | 0 | 0 | 2 |
| [#92](https://github.com/the-Drunken-coder/Ridgeline/pull/92) | feat: render shared entity models and switch representations by distance | 18 | 13 | 5 |
| [#102](https://github.com/the-Drunken-coder/Ridgeline/pull/102) | chore(validation): require measurement and protect browser evidence | 4 | 1 | 2 |

## Policy and pending-work baseline

The current [conventions](../../CODE_CONVENTIONS.md), [agent instructions](../../AGENTS.md), [glossary](../../GLOSSARY.md), and [ADRs](../../docs/adr/) were read before deriving proposals. Check wiring was compared with [package.json](../../package.json), [control-lab/package.json](../../control-lab/package.json), [validation CI](../../.github/workflows/validation.yml), [nightly CI](../../.github/workflows/nightly.yml), and [CI documentation](../../docs/ci-validation.md).

PR #102 was open at `dfe0e5266f2b8285679b71605605a9147f43425c`. Its [conventions](https://github.com/the-Drunken-coder/Ridgeline/blob/dfe0e5266f2b8285679b71605605a9147f43425c/CODE_CONVENTIONS.md), [entity review reference](https://github.com/the-Drunken-coder/Ridgeline/blob/dfe0e5266f2b8285679b71605605a9147f43425c/docs/agents/entity-review.md), package scripts, workflow, measurement cleanup, and evidence-promotion code were inspected to avoid duplicate recommendations. The four unanswered comments are linked individually in [automated checks](automated-checks.md).
