# Drawing control mock review

Status: ready-for-human

The behavior spec is approved through question 21. The user selected layout A and authorized implementation. B and C remain unselected alternatives.

## Design contract

The user edits one geographic feature while keeping the map legible. Finish is the primary action; measurements, shape parameters, and style controls support it. Use the existing Ridgeline green and neutral palette, compact labeled controls, flat rows, and clear boundaries between map content and controls. Avoid decorative cards, pills, subtitle lines, animated pending indicators, and application-specific route or tactical semantics.

Three alternatives explore control placement, not different product scope:

- A: a labeled tool rail and fixed inspector. Best discoverability and stable field positions, at the cost of map width.
- B: a bottom drafting strip. Keeps full map width and puts tools, fields, and submission in a compact lower work area, at the cost of map height.
- C: a compact top tool menu and contextual editor over the map. Retains the largest map area, but can obscure geography near the editor.

A is the initial recommendation because precision and styling controls remain predictable as shape types change. The final choice must coordinate with the separate control-scheme design.

## Reference decisions

- Ridgeline's existing terrain screenshot supplies the palette, density, and map context. The mock uses the existing screenshot as a clipped background, not invented geographic outlines. Screenshot source: docs/images/terrain.jpg.
- [ORBAT Mapper map editing](https://docs.orbat-mapper.app/guide/map-edit-mode) separates map tools from feature details. Borrow that separation while omitting its scenario timeline and unit hierarchy.
- [UIZZE](https://uizze.com) was searched for map-editor references. The available search results did not expose relevant individual screens; no UIZZE reference pack or automated audit was used.

## Mock boundary

These are static layout proposals with local presentation controls. The underlying map is a screenshot. Overlay geometry, labels, and measurements are sample data, not a geographic calculation or implemented drawing engine. Finishing, undoing, deleting, and selecting tools illustrate UI states only; no requests leave the mock or change consumer data.

Preview states cover editing, pending acceptance, rejection, changed source feature, lost permission, invalid geometry, accepted change, and no selection. Review controls expose these states. Desktop layouts reflow into stacked fields on narrow widths so the proposals remain readable; touch drawing remains deferred.

## Proposed keyboard behavior for review

Map clicks add vertices; dragging a handle moves a vertex, and dragging empty map space pans. Finish and Cancel are explicit controls. Keyboard-focused handles use arrow keys to move, Shift plus arrows for a larger step, and Delete to remove a vertex. Alt temporarily bypasses snapping. Cmd/Ctrl+Z applies to draft history while editing and consumer history otherwise. These are proposals to reconcile with the control-scheme work, not approved bindings or implemented interactions.

## Review boundary

A was selected. Its rail and fixed inspector are implemented as optional controls; the approved behavior scope is unchanged.

## Deliverables and verification

The three static previews were presented in the design task as drawing-a.html, drawing-b.html, and drawing-c.html. They are review artifacts outside the repository; the selected implementation is available in the playground's Drawing & editing scenario.

Browser review covered the normal layouts, the rectangle inspector in C, and pending, rejected, conflicting-source, permission-loss, invalid, accepted, and no-selection states. All three layouts fit a 320-pixel content width with no horizontally overflowing controls. These checks validate the mock presentation only. Geographic calculations, map navigation, keyboard geometry manipulation, persistence, and consumer integration are not implemented or tested by these mocks.
