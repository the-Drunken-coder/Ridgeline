# SIDC Kit playground demo

Status: User selected A, Sidebar. Implemented in the playground; validation recorded in design-contract.md.

## Confirmed scope

Integrate the user's [SIDC Kit](https://github.com/the-Drunken-coder/sidc-kit) into a playground demo. The integration must clearly communicate that SIDC features belong to this demo and are not being added to the main map.

The existing consumer boundary in [ADR 0001](../../docs/adr/0001-consumer-owned-workflows.md) applies. The playground owns SIDC-specific controls, sample data, and workflows. The Ridgeline library remains usable independently of SIDC Kit and the demo.

## Agreed direction

- Add a selectable **SIDC Kit integration** scenario to the existing playground. Existing scenarios retain their behavior.
- Display: "Playground integration with SIDC Kit. SIDC features belong to this demo."
- Support searching for a symbol, previewing it, placing it on the demo map, and inspecting its SIDC explanation.
- Leave structured symbol building and reverse lookup outside this demo's scope.
- Keep SIDC logic and dependencies outside the Ridgeline map library. Use its existing public feature, icon, and interaction APIs.

## Agreed behavior

- Choose a search result, inspect its preview, press **Place on map**, then click once to place it. Placement ends after that click. Escape or **Cancel** exits without placing anything.
- Start with three labeled sample symbols and search ready for adding more.
- Select a placed symbol to inspect its name, SIDC, and interpreted fields. Support **Remove selected** and **Reset demo**. Moving symbols and editing their attributes are outside this demo's scope.
- Reset to the three samples when reopening the scenario or reloading the page. Do not persist demo state.

## Selected layout

- A, Sidebar. Search, results, preview, and selected-symbol details stay in the scenario sidebar. Keep the map unobstructed and retain the existing playground's visual language.

## Design process

Settle the behavior and confirm shared understanding before implementation. Present distinct static UI mocks and wait for the user's selection before editing real components, as required by the workspace instructions.

## Source limitations

The demo pins published `sidc-kit@0.3.2`, whose search and explanation cover six curated land-unit symbols. Its renderer uses milsymbol. The upstream repository documents a larger catalog and additional capabilities that are not all in this published version. This demo exposes the installed package's curated search, rendering, and explanation only.

## Implementation boundary

`playground/sidc-demo.ts` owns SIDC imports, symbol state, image decoding, controls, and sample features. The playground imports it lazily only when entering the SIDC scenario. The dependency is a development dependency, not a library runtime dependency. Library source and public exports are unchanged.

Placement temporarily disposes the optional interaction UI and restores it after the placement event finishes, preserving ordinary selection and overlap picking. Leaving the scenario cancels placement, aborts UI listeners, and invalidates pending initialization or preview work. Registered icons reuse a SIDC-specific key, keeping the image set bounded by the installed curated catalog.
