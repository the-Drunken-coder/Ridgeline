/** Bounded longitude for geographic sampling; rendered world copies remain unwrapped. */
export const wrapLongitude = (lng: number) => ((lng + 180) % 360 + 360) % 360 - 180;
