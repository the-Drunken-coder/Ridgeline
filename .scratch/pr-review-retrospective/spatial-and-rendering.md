# Spatial and rendering consistency

Priority: high for accepted-result publication; medium for coordinate and persistence clarifications. Classification: judgment rules with public rendering tests.

Suggested home: the existing ownership and data-boundary sections in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md). Keep numeric contracts in [README.md](../../README.md) and terminology in [GLOSSARY.md](../../GLOSSARY.md).

## Accept a result before changing shared renderer state

Proposed addition:

> Check whether a result is accepted before mutating objects retained by rendering or hit testing. Publish displayed geometry, pixels, and picking metadata from the same accepted result. Hit testing must honor the documented visibility and picking approximation rules.

[PR #12's GPU finding](https://github.com/the-Drunken-coder/Ridgeline/pull/12#discussion_r4112901428) showed rejected pixels being copied into a retained image before the owner accepted completion. Picking could then use pixels different from the visible texture. [Another finding](https://github.com/the-Drunken-coder/Ridgeline/pull/12#discussion_r4112901436) showed fresh request tokens retaining terrain that retry had discarded. Both threads are resolved in the collected history.

[PR #8's finding](https://github.com/the-Drunken-coder/Ridgeline/pull/8#discussion_r4110132752) showed transparent camera faces intercepting clicks. The [author's browser reproduction and fix](https://github.com/the-Drunken-coder/Ridgeline/pull/8#discussion_r4110226515) verified that wireframe-only interiors stopped blocking input while visible faces remained selectable.

The existing stale-completion rule covers the obligation. This addition states where acceptance must happen and which outputs must agree. Verify visible output and picking after a rejected completion, retry, and renderer recreation when those paths change.

## Name coordinate spaces at conversion boundaries

Proposed addition:

> Distinguish stored geographic coordinates, the currently displayed world copy, CSS pixels, and drawing-buffer pixels. Derive display restoration from current renderer state. Verify projection and pixel conversions with inputs that distinguish the coordinate spaces, including a pixel ratio above one and camera movement between world copies.

- [PR #7's arrow finding](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4087672464) used great-circle bearing for a straight Mercator segment. The [response](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4110130067) reports high-latitude and date-line checks.
- [PR #68's restoration finding](https://github.com/the-Drunken-coder/Ridgeline/pull/68#discussion_r4172298342) produced a handle jump between visible world copies. The [response](https://github.com/the-Drunken-coder/Ridgeline/pull/68#discussion_r4172525657) reports that even a saved display coordinate became stale after camera reversal. The final fix uses the live marker to choose the nearby copy.
- [PR #92's pixel finding](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4180678804) mixed CSS input with physical pixel buffers. The [response](https://github.com/the-Drunken-coder/Ridgeline/pull/92#discussion_r4181213694) reports corrected scale and WebGL Y conversions, tested at pixel ratio 2.

Current conventions specify geographic units and order, but not these cross-system distinctions. PR #102 already proposes shared browser helpers, so this proposal adds the review obligation rather than another conversion utility or a blanket coordinate-type abstraction.

## Preserve geographic meaning through storage precision changes

Proposed addition:

> Validate regenerated geographic geometry with a documented tolerance appropriate to its units and storage contract, while preserving exact checks for identity, geometry type, and coordinate structure.

[PR #7's persistence finding](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4087672488) showed exact serialized equality rejecting ordinary coordinate rounding. The [response](https://github.com/the-Drunken-coder/Ridgeline/pull/7#discussion_r4110130224) reports accepting small rounding differences while rejecting larger changes. [ADR-0003](../../docs/adr/0003-preserve-drawing-shape-definitions.md) remains authoritative for preserving shape definitions. This proposal does not introduce one universal numeric tolerance.
