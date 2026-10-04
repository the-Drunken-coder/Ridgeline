import { modelPlacement } from '/tmp/ridgeline-model-placement/src/model-placement.ts';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const radians = Math.PI / 180, radius = 6371008.8;
const mercY = (latitude: number) => (1 - Math.log(Math.tan(Math.PI / 4 + latitude * radians / 2)) / Math.PI) / 2;
let cases = 0, minClearance = Infinity, maxClearance = -Infinity, maxNormalErrorDegrees = 0, maxDimensionError = 0;
for (const latitude of [-65, 0, 46, 78]) for (const longitude of [0, 179.99999])
for (const [eastSlope, northSlope] of [[0, 0], [.2, .3], [-.35, .1], [.6, -.45]])
for (const exaggeration of [1, 2]) for (const heading of [0, 37, 179])
for (const displayScale of [1, 20]) for (const metersPerUnit of [.5, 2]) {
  const units = 1 / (2 * Math.PI * radius * Math.cos(latitude * radians));
  const height = (lng: number, lat: number) => 100 + eastSlope! * ((((lng - longitude + 540) % 360) - 180) / 360) / units + northSlope! * (mercY(latitude) - mercY(lat)) / units;
  const placed = modelPlacement({ bounds: { min: [3, -4, 9], max: [5, -2, 15] }, location: [longitude, latitude], placement: 'ground', heading,
    metersPerUnit, headingOffset: -19, terrain: true, exaggeration, displayScale }, height);
  if (placed.status !== 'ready') throw new Error('Known plane did not produce a model');
  const a = eastSlope! * exaggeration, b = northSlope! * exaggeration, n = Math.hypot(a, b, 1);
  const up = placed.basis[1], length = Math.hypot(...up), cosine = (-a * up[0] - b * up[1] + up[2]) / (n * length);
  maxNormalErrorDegrees = Math.max(maxNormalErrorDegrees, Math.acos(Math.min(1, Math.max(-1, cosine))) / radians);
  for (const corner of placed.corners.slice(0, 4)) {
    const clearance = placed.position[2] + corner[2] - (100 * exaggeration + a * corner[0] + b * corner[1]);
    minClearance = Math.min(minClearance, clearance); maxClearance = Math.max(maxClearance, clearance);
  }
  for (const basis of placed.basis) maxDimensionError = Math.max(maxDimensionError, Math.abs(Math.hypot(...basis) - displayScale * metersPerUnit));
  if (placed.position[0] !== longitude || placed.position[1] !== latitude) throw new Error('Anchor moved');
  cases++;
}
const result = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: '/tmp/ridgeline-model-placement', encoding: 'utf8' }).trim(), cases,
  minClearance, maxClearance, maxNormalErrorDegrees, maxDimensionError };
if (minClearance < 0 || maxClearance > .1 || maxNormalErrorDegrees > 1) throw new Error(JSON.stringify(result));
writeFileSync('/tmp/ridgeline-model-context/placement-geometry-verification.json', JSON.stringify(result, null, 2));
console.log(result);
