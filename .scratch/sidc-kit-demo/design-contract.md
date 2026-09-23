# SIDC scenario layout review

Status: User selected A, Sidebar. Implemented in the playground. The static review evidence below records the design phase.

## Screen job

Demonstrate SIDC Kit as a consumer integration. Search for a symbol, preview it, place it once, and inspect a placed feature. Keep the boundary statement visible: "Playground integration with SIDC Kit. SIDC features belong to this demo."

## Existing visual language

Preserve the playground's green and neutral palette, compact system typography, scenario selector, full-height settings and selection sidebar, and map-dominant layout. No decorative cards, pills, subtitle lines above sections, em dashes, or continuous animations. Existing scenarios retain their layout and behavior.

## Alternatives

- A, Sidebar: search, results, and preview appear in the scenario sidebar, followed by selected-symbol details. It keeps the map unobstructed and requires the least new layout machinery. Recommended.
- B, Search panel: a compact opaque search and preview panel overlays the upper-left map area. The existing sidebar holds selected-symbol details and map settings. It provides more width for results but covers map content.
- C, Search tray: search, results, and preview occupy a horizontal tray above the map. The existing sidebar holds selected-symbol details and settings. It exposes more results at once but reduces map height.

## Required states

Show search results, a preview, selected-symbol details, one-shot placement with Cancel, an empty result, loading, render failure, no selected feature, and an empty map after all symbols are removed. Reset restores three samples. Escape cancels placement. In the eventual implementation, leaving the scenario also clears transient state.

Preview and selected feature are separate concepts: searching for a new symbol does not change the selected map feature. Adding a symbol selects the new feature. Loading and render failure disable placement.

## Responsive behavior

Desktop remains the product target. At narrow review widths, stack the search controls, selected-feature details, and map without shrinking the labels. Do not treat these mocks as a claim of mobile product support.

## References and evidence

The existing `.scratch/initial-viewport/design-contract.md` records the user's selected shell and observations from DailyArt and Google Maps screens. This review reuses those settled choices. Attempts to reopen the two UIZZE reference pages through the web reader failed; no new visual-reference assessment is claimed.

Map geometry comes from the public OpenStreetMap extract around Chamonix used by the earlier review. Sample symbol locations are invented. Symbol artwork is generated with milsymbol 3.0.4 from SIDCs in SIDC Kit's public curated catalog. The mock uses fixed sample data and does not run SIDC Kit or MapLibre.

## Review artifact

`sidc-demo-layouts.html` in the task's visualization directory. The layout and example-state selectors are review controls supplied by the host, outside the depicted application.

## Verification

Inspected all three desktop layouts in the browser and confirmed each fits a 320px review viewport without horizontal overflow. Checked the mock's one-shot placement, Escape cancellation, removal, reset, empty search, loading, render failure, retry recovery, and empty-map states. Fixed a floating-panel collision with the placement instructions. The generated symbol images loaded, the mock script passed a syntax check, and the inspected browser reported no warnings or errors.

Those checks cover the static-data mock only. Live implementation evidence follows.

## Implementation verification

- `pnpm check` passed. All five existing tests passed. `pnpm build:playground` passed, including the library build and declarations.
- The library source has no changes. Its production source map contains only `src/errors.ts`, `src/features.ts`, `src/viewport.ts`, and `src/interactions.ts`; the library JavaScript contains no SIDC Kit or milsymbol imports. SIDC Kit is a pinned development dependency and a separate lazy-loaded playground chunk.
- In the live MapLibre playground, the three seed symbols rendered. Searching for armor produced the matching preview. Placing armor on an existing symbol added one feature, selected the new feature, and did not open the picker. The next click opened the ordinary two-feature overlap picker.
- Checked removal, reset, empty search, Escape cancellation, and leaving while placement was armed. Clicking in the next, empty scenario added nothing. Reopening SIDC restored three samples, the initial search, and the initial selection.
- The live SIDC layout fit a 320px viewport without horizontal overflow; all symbol images loaded. No browser errors or warnings were observed during these checks.
- The production build warns about large chunks. The SIDC demo chunk is approximately 203 kB gzip and loads only when requested. After rebasing onto main at `f70552f`, the library is approximately 7.51 kB gzip with no changes from this demo. TypeScript, the five tests, both builds, and the library boundary check passed again after the rebase.

The published package's six-symbol curated catalog bounds this demo. The live tests did not inject renderer or chunk-download failures; recovery UI exists for those paths, and their visual states were reviewed in the static mock.

PR review media uses the existing `docs/images/terrain.jpg` as the pre-integration view and `docs/images/sidc-demo.jpg` for the implemented SIDC scenario after the rebase.
