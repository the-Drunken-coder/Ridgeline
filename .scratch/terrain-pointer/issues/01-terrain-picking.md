# Establish reliable terrain targeting with MapLibre

Type: research
Status: resolved
Assignee: terrain-picking research agent
Parent: [Terrain-aware pointer feedback](../map.md)

## Question

Which supported MapLibre capabilities can give Ridgeline a terrain target that agrees with the displayed terrain and the committed drawing point? Investigate the pinned dependency, distinguishing available source evidence from current online documentation.

Cover shallow angles, ridgelines, sky or no intersection, missing elevation, terrain exaggeration, globe versus flat projection, and changes while the pointer is stationary. Identify whether existing event coordinates or unprojection can silently fall back, and how to distinguish a valid target from unavailable data. Recommend the smallest viable integration and explicit browser experiments still needed. Use official source and documentation, and record limitations without claiming unrun tests passed.

## Answer

Resolved by source research on 2026-09-29. The pinned MapLibre 6.11.0 already intersects terrain, but public coordinate queries can silently substitute a plane or globe position after a miss, and missing elevation can return zero. No complete supported public guard for hit validity and loaded elevation was found. Internal nullable intersection and coverage information expose the distinction, with version-coupling costs.

See [Terrain picking research](../research/terrain-picking.md) for exact-version citations, the proposed shared resolver, and required browser experiments. The research is preserved on branch `research/terrain-pointer-picking`, commit `4f9b39f30bbfb3400559f1014897930ae8a42cf6`, with a copy beside this map.

Source inspection resolves the API investigation, not runtime accuracy. [Choose how Ridgeline establishes terrain-target validity](04-terrain-validity-strategy.md) holds the resulting integration decision.
