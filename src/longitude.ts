/** Bounded longitude for geographic sampling; rendered world copies remain unwrapped. */
export const wrapLongitude = (lng: number) => ((lng + 180) % 360 + 360) % 360 - 180;

/** Render-only longitude on the world copy nearest the current view or target. */
export const nearbyLongitude = (lng: number, reference: number) => reference + wrapLongitude(lng - reference);
