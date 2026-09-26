# Feature publication and retry

The map keeps its current behavior. This change puts update ordering and failure recovery in one internal module so future changes can be checked without recreating every failure in a browser.

## Behavior preserved

- Accepted data remains available immediately, even if its display update fails.
- Updates to the same feature are combined within a frame. One source submission runs at a time.
- A broken feature does not prevent healthy updates or removals from proceeding.
- Failed updates wait for explicit retry or a newer change. Retry uses current data and retains failed removals.
- Switching basemaps restores current features. Late results from the old source cannot change the new source's publication state.
- Selection, arrows, entity rendering, and disposal retain their existing integration behavior.

## Implementation

`src/feature-publication.ts` owns pending changes, failed IDs, frame scheduling, submission identity, source retirement, and restoration. `src/viewport.ts` passes accepted changes and lifecycle events to it and coordinates arrows, entities, and selection.

`FeatureStore` remains the authority for accepted data. Publication reads it during restoration and retry. `src/maplibre-feature-publication.ts` connects publication to the existing MapLibre GeoJSON source and preserves source identity. A controlled source in the unit tests uses the same interface to delay completions, reject updates, and emit worker errors.

This is an internal MapLibre integration consistent with ADR-0002. It adds no public API or renderer selection. The extraction is reversible and introduces no new domain vocabulary, so it does not need another ADR or glossary entry.

## Validation

Implemented from reviewed commit `cc1b4070643aef8e088d14e891daf5e06cbfc8a6`.

- `pnpm check` passed.
- `pnpm test` passed: 49 library tests and 15 control-lab tests, including seven new publication tests.
- `pnpm test:browser` passed all 36 existing checks through the built and packaged library.
