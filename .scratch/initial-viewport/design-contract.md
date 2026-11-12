# Playground visual review

Status: User selected Field desk's surrounding UI and Map bench's UI within the map. That hybrid is implemented in the playground. The review boundary below records the earlier mock phase; runtime checks are documented in `docs/performance.md`.

## Screen purpose

Let a consumer developing a map experience switch test scenarios, inspect named features, and compare selection behavior while the map remains the main content. The primary action is choosing a test scenario, then interacting with its features.

## Required content

- Sidebar scenario dropdown.
- Overlapping groups of 2, 3, 8, 10, and 20 named sample features.
- Radial choices show an icon when present and the feature name. Eight candidates per page, stable placement, hover preview, and explicit selection.
- Compact selected-feature detail, independent projection/terrain/hillshade controls, and clear diagnostic state.
- Static states for terrain, moving features, unavailable elevation, loading, and empty data. The preview must not imply measured performance or live terrain rendering.

## Alternatives

- A, Field desk: persistent full-height sidebar for scenarios, capabilities, and selection. Radial choices use separated compact rectangular targets around the selected location.
- B, Map bench: narrow scenario sidebar; selection and event detail sit in a horizontal bottom strip. Radial choices use a continuous segmented wheel with icon and name inside each sector.
- C, Map focus: compact scenario/control sidebar; selected-feature detail floats near the map edge. Radial choices use icon targets with adjacent names and minimal connecting lines.

## Constraints

Selected direction: retain A's full-height scenario/settings/selection sidebar and surrounding chrome; use B's segmented radial wheel with icons and names. Do not add B's bottom selection strip, since the user chose A for the surrounding UI.

Information-dense; no decorative cards or pills, no subtitle lines above sections, no em dashes, no continuous animation. Structural dividers are allowed. Picker surfaces are functional opaque overlays. Application typography and menus share the same theme.

Desktop is the product target. The review adapts to narrower conversation widths by stacking the sidebar, not by shrinking text. Picker layouts retain usable targets and names. No claim of mobile product support.

## Review boundary

This is an inline static-data design mock with local state switching. It is not MapLibre, live terrain, a performance benchmark, or a production implementation. No application dependencies are added. Use a real OpenStreetMap geometry backdrop with attribution and clearly identified sample features.

The user chooses a visual direction before real components are implemented, as required by the workspace instructions.

## Reference observations

- [DailyArt location screen](https://uizze.com/screens/2ee52bbe80c35a262b1e0d59736db2fb): map and selected-place detail remain distinct; the place name leads the detail. Apply that hierarchy to feature names and the bottom selection strip, without copying the mobile sheet or adding travel actions.
- [Google Maps discovery screen](https://uizze.com/screens/03b2d314f9b22694750f3a6a4cd9db70): named places and actions have clear labels, but its content-heavy discovery layout would obscure a testing viewport. Keep the names and explicit actions; reject the cards and discovery feed for Ridgeline.
- The map backdrop uses a simplified subset of the [OpenStreetMap API extract](https://www.openstreetmap.org/api/0.6/map?bbox=6.855,45.914,6.88,45.935) around Chamonix. The preview includes OpenStreetMap attribution. Sample feature positions are invented demonstration data, not real operational records.

## Review artifact

The inline comparison is `ridgeline-designs.html` under the task's authorized visualization directory. It contains all three layout alternatives, group sizes, hover and selection, page navigation, scenario switching, and example context menus. Optional design controls exercise a long name and missing icons.

No Ridgeline runtime package or production components were created in this phase.

## Verification

Inspected all three layouts at desktop review width and checked narrow review widths down to 320 pixels. Checked 20-item pagination through the last four candidates, keyboard selection, feature name/ID display, and empty, loading, and elevation-error states. Fixed page-click propagation and cramped narrow-layout picker spacing during review. The mock script passes a JavaScript syntax check; no browser console errors were reported in the inspected runs. This verifies the design preview only, not MapLibre behavior or runtime performance.
