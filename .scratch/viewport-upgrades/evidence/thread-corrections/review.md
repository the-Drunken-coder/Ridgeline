# Thread correction review, 2026-10-11

Integration owner: root. Baseline and HEAD: `cbef055b14fe218aa24611031c4ba1a9aa0ed540`; all delivery changes are uncommitted.

The independent reviewer read the applicable standards, review guidance, canonical viewport-upgrades spec and public contracts. Root reviewed the combined delivery and confirmed four reported defects: configuration observers could prevent an accepted basemap from reaching MapLibre; airborne selection recalled a failing style accessor; the new map-aligned icon layer was missing query guards; and rectangle opacity checks did not match per-field selected/hover rendering. All four were corrected with observable regression coverage. No concrete Standards or Spec findings remain in this follow-up scope.

The initial final review pin was runtime/test/config digest `1305996ef45c4058170fd5543fb2e93576c2c5c17cca1d81b21e623b6b9cd310`. The reviewer independently verified all 182 hashes. It ran 116 focused coordinate, feature-style, entity-scene and drawing tests successfully and checked 30 relative packaged file/heading links across nine Markdown files.

After manual inspection, root added an optional internal arrowhead offset and applied `[0, 12]` only to active-segment feedback. This moves its head back along the direction so the endpoint edit handle does not cover it. Other arrow callers retain their defaults. The reviewer found no new concern, checked the installed MapLibre offset semantics, and verified all 182 handoff hashes. Only `src/arrowheads.ts` and `src/drawing.ts` differ between those two input sets.

Final reviewed handoff digest: `d1d09ba1353f0b2ac5d31b10f5e0f1a88cf442519cbd258a415a1048105279a3`. Root's desktop and narrow native-preview captures show the visible direction head and unchanged approved rail/inspector. At 390 CSS pixels, document width equals viewport width and numeric fields are 178.5 pixels wide.

This review does not establish browser execution, physical device acceptance, hosted checks or merge readiness. Those claims belong to the retained producer results and closeout. Prior independent reviews and scope corrections remain historical evidence.
