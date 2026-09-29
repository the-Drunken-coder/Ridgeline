# Choose how Ridgeline establishes terrain-target validity

Type: grilling
Status: open
Blocked by: 01
Parent: [Terrain-aware pointer feedback](../map.md)

## Question

How should Ridgeline distinguish a valid terrain target from MapLibre's coordinate and elevation fallbacks? Use the exact-version research to compare a narrow, version-coupled integration with renderer internals, a supported upstream capability, or an independently owned terrain query. Explain maintenance cost, agreement with displayed terrain, and which cases must withhold placement.

Recommend the smallest approach that preserves the agreed rule that unknown terrain must not become a fabricated ground placement. The user decides the dependency and maintenance tradeoff before target behavior and visual design are finalized. Explicit MapLibre access is allowed by [the integration decision](../../../docs/adr/0002-maplibre-extension-access.md); private renderer access would still be a new coupling decision.

## Comments

2026-09-29: The user delegated the technical recommendation and asked to see visual choices. Do not require a separate technical permission exchange before presenting mocks. Independent source review recommends a narrow version-bound adapter around the renderer's existing strict intersection plus loaded-elevation check. There is no existing terrain coverage adapter to reuse; the raw elevation sampler cannot prove agreement with displayed terrain. Share one result across preview and commit. The [prototype design contract](../prototype/design-contract.md) records this recommendation and pending real-browser validation. No production implementation or final API contract is established here.
