// Explicit support inventory. Renaming a required workflow must update this
// list deliberately instead of silently dropping it through a prefix regexp.
export const supportCases = [
  "Viewport destruction attempts independent cleanup and preserves its first failure",
  "Drawing upgrades native zoom transfers a handle gesture while programmatic zoom preserves it",
  "Workflow controls expose coordinates preserve native ownership and release on teardown",
  "Basemap selector follows accepted external and failed style configuration",
  "Basemap selector native keyboard retains equivalent choices and follows external styles",
  "Basemap selector drawing preview reentry publishes current style after patch and replacement",
  "Basemap selector drawing preview destruction leaves replacement controls usable",
  "Workflow controls clean partial native initialization and preserve consumer controls",
  "Native geolocation waits for activation and releases its active watch",
  "Native fullscreen options retain viewport container as default target",
  "Native fullscreen retirement restores owned layout and cooperative gestures",
  "Native fullscreen late completion leaves retired viewport and replacement isolated",
  "Drawing upgrades edge snapping chooses the nearest edge while retaining vertex preference",
  "Drawing upgrades holes and exact segments save reload and retain draft history",
  "Drawing upgrades edge snapping is opt in respects Alt filters and callback scene changes",
  "Feature presentation unrelated callback updates preserve current publication",
  "Feature presentation refresh inside a native click preserves later observers and selection intent",
  "Optional selection refuses completed-empty requests while renderer unavailable",
  "Optional selection query failures retain renderer context and recover",
  "Feature presentation basemap changes survive elevation preparation abort callbacks",
  "Feature presentation refreshes styles and controls native airborne and model feedback",
  "Feature presentation prioritizes selected labels without overlap or consumer replacement",
  "Feature presentation rejects invalid callback roots and retains the working display",
  "Feature presentation keeps saved solid lines thick feedback and map aligned icons visible",
  "Feature presentation preserves CSS alpha in airborne feedback",
  "Feature presentation refresh discards callback replacements and removals",
  "Optional selection point and rectangle queries agree on hidden native representations",
  "Optional selection released Shift before mouseup performs one ordinary click",
  "Optional selection remains request only until the consumer applies a filtered proposal",
  "Rectangle interruptions preserve selection through real renderer loss and restoration",
  "Feature presentation preserves saved solids thick lines airborne highlights and map aligned icons",
  "Optional selection rejects rectangles during ongoing camera movement",
  "Optional selection Shift clicks tolerate small pointer jitter",
  "Optional selection Shift presses survive unrelated live updates",
  "Optional selection Shift release repicks display and retires lost gesture owners",
  "Optional selection toggles Shift candidates and retains radial intent",
  "Rectangle interruptions recover and stale selection callbacks retire",
  "Feature presentation validates, preserves failures, and restores configurable native styles",
  "Optional selection preserves a usable keyboard focus after picker dismissal",
  "Optional selection model rectangle queries retain the completed displayed frame until replacement draws",
  "Optional selection rejects a lease round trip during rectangle release",
  "Queued features render with stable string IDs and click events",
  "Style replacement preserves data and selection",
  "Keyboard picker activation selects the chosen overlapping feature",
  "Inspector label editing preserves Tab and the first real Finish click"
];

export function selectSupportCases(registered: readonly string[]) {
  const missing = supportCases.filter(name => !registered.includes(name));
  if (missing.length) throw new Error('Required support workflows are not registered: ' + missing.join(', '));
  return supportCases;
}

export const starterCases = {
  save: 'Adoption starter saves numeric drawing edits through installed declarations and disposes controls',
  restore: 'Adoption starter retains a rejected draft and restores saved shape metadata after reload',
  protect: 'Adoption starter protects failed restoration through saves and Reset until explicit clearing',
};
