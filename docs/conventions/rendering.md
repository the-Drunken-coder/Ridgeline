# Rendering standards

Read when changing publication, picking, terrain sampling, coordinate conversion, or geographic storage. Apply the common standards in [CODE_CONVENTIONS.md](../../CODE_CONVENTIONS.md) and the public contracts in [README.md](../../README.md).

## Accepted publication

- Check whether a result is accepted before mutating objects retained by rendering or hit testing. Publish displayed geometry, pixels, and picking metadata from the same accepted result.
- Hit testing must honor the documented visibility and picking approximation rules. Preserve supported approximations such as model bounding-box picking; they do not promise exact visible-pixel hits.
- A fresh lifecycle token must not make requests valid if their inputs have already been discarded. Retry uses current inputs as required by the owning contract.

For changes to publication or rejection, observe visible output and picking after the relevant late completion, retry, or renderer recreation. Verify complete representations, including separately rendered parts such as an arrow's shaft and head. Use [lifecycle](lifecycle.md) for ownership and [testing](testing.md) for evidence selection.

## Coordinate agreement

- Distinguish stored geographic coordinates, the currently displayed world copy, CSS pixels, and drawing-buffer pixels. Make conversions and WebGL orientation explicit at their boundaries.
- Derive display restoration from current renderer state. Saved display coordinates can become stale after camera movement or wrapping.
- Verify that sampling, rendering, and picking agree on projection, coordinate wrapping, tile encoding, and sampled extent where those systems share geography.
- Choose inputs that distinguish the interpretations being tested, such as high-latitude segments, date-line crossings, camera movement between world copies, or pixel ratios above one.

Tests for physical pixel buffers should verify conversion back to the CSS coordinates used by input and projection. A passing pixel-ratio-one test does not establish that conversion.

## Storage precision

Validate regenerated geographic geometry with a documented tolerance appropriate to its units and storage contract, while preserving exact checks for identity, geometry type, and coordinate structure. A universal numeric tolerance is not implied.

[ADR-0003](../adr/0003-preserve-drawing-shape-definitions.md) owns shape-definition preservation. Verify supported storage round trips without weakening rejection of materially different geometry.
