import { bearing, destination, distance } from './drawing-geometry';
import { RidgelineError } from './errors';

/** Longitude first, latitude second, in geographic decimal degrees. */
export type GeographicPosition = readonly [longitude: number, latitude: number];
export type CoordinateFormat = 'dd' | 'ddm' | 'dms';
export type CoordinateFormatOptions = { format?: CoordinateFormat; precision?: number };

function invalid(message: string, operation: string): never {
  throw new RidgelineError('INVALID_CONFIGURATION', message, { operation, recoverable: true });
}
function checked(position: GeographicPosition): [number, number] {
  if (!Array.isArray(position) || position.length !== 2 ||
    !Number.isFinite(position[0]) || !Number.isFinite(position[1]) ||
    Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90)
    invalid('Coordinates must be longitude [-180, 180] and latitude [-90, 90].', 'coordinates');
  return [position[0], position[1]];
}

/** Format a longitude-first pair with explicit hemispheres. precision applies to the last unit. */
export function formatCoordinate(position: GeographicPosition, options: CoordinateFormatOptions = {}): string {
  const [longitude, latitude] = checked(position);
  const format = options.format ?? 'dd';
  if (!['dd', 'ddm', 'dms'].includes(format)) invalid('Unknown coordinate format.', 'coordinates.format');
  const precision = options.precision ?? (format === 'dd' ? 5 : format === 'ddm' ? 3 : 1);
  if (!Number.isInteger(precision) || precision < 0 || precision > 8)
    invalid('Coordinate precision must be an integer from 0 to 8.', 'coordinates.format');
  const scale = 10 ** precision;
  function axis(value: number, positive: string, negative: string) {
    const absolute = Math.abs(value);
    if (format === 'dd') {
      const rounded = absolute.toFixed(precision);
      return `${rounded}° ${value < 0 && Number(rounded) !== 0 ? negative : positive}`;
    }
    // Round before splitting units so 59.999... minutes/seconds carry into degrees.
    const ticks = Math.round(absolute * (format === 'ddm' ? 60 : 3600) * scale);
    const hemisphere = value < 0 && ticks !== 0 ? negative : positive;
    const ticksPerDegree = (format === 'ddm' ? 60 : 3600) * scale;
    const degrees = Math.floor(ticks / ticksPerDegree);
    const remainder = ticks % ticksPerDegree;
    if (format === 'ddm') return `${degrees}° ${(remainder / scale).toFixed(precision)}' ${hemisphere}`;
    const minutes = Math.floor(remainder / (60 * scale));
    return `${degrees}° ${minutes}' ${((remainder % (60 * scale)) / scale).toFixed(precision)}" ${hemisphere}`;
  }
  return `${axis(longitude, 'E', 'W')}, ${axis(latitude, 'N', 'S')}`;
}

/** Parse two comma-separated DD, DDM or DMS coordinates, longitude first. */
export function parseCoordinate(input: string): [number, number] {
  if (typeof input !== 'string' || input.length > 256) invalid('Supply a longitude, latitude pair.', 'coordinates.parse');
  const parts = input.trim().split(',');
  if (parts.length !== 2) invalid('Separate longitude and latitude with a comma.', 'coordinates.parse');
  function axis(text: string, longitude: boolean): number {
    const normalized = text.trim().toUpperCase().replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
    const match = /^([+-]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"\s*)?)?([NSEW])?$/.exec(normalized);
    if (!match) invalid('Use decimal degrees, degrees/minutes, or degrees/minutes/seconds.', 'coordinates.parse');
    const degreesText = match[1]!;
    const degrees = Number(degreesText), minutes = Number(match[2] ?? 0), seconds = Number(match[3] ?? 0);
    const hemisphere = match[4];
    if ((match[2] !== undefined && !Number.isInteger(degrees)) ||
      (match[3] !== undefined && !Number.isInteger(minutes)) || minutes >= 60 || seconds >= 60)
      invalid('Minutes and seconds must be less than 60; preceding units must be whole numbers.', 'coordinates.parse');
    if (hemisphere && !(longitude ? ['E', 'W'] : ['N', 'S']).includes(hemisphere))
      invalid('Use E/W for longitude and N/S for latitude.', 'coordinates.parse');
    if (hemisphere && /^[+-]/.test(degreesText))
      invalid('Use a sign or a hemisphere, not both.', 'coordinates.parse');
    const negative = hemisphere === 'W' || hemisphere === 'S' || degreesText.startsWith('-');
    const value = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    return negative && value !== 0 ? -value : value;
  }
  return checked([axis(parts[0]!, true), axis(parts[1]!, false)]);
}

/** Horizontal spherical distance in meters, using Ridgeline's 6,371,008.8 m Earth radius. */
export function geographicDistance(from: GeographicPosition, to: GeographicPosition): number {
  return distance(checked(from), checked(to));
}

/** Initial bearing clockwise from geographic north, normalized to [0, 360). */
export function geographicBearing(from: GeographicPosition, to: GeographicPosition): number {
  const origin = checked(from), target = checked(to);
  const longitudeDifference = Math.abs(origin[0] - target[0]);
  const sameMeridian = longitudeDifference === 0 || longitudeDifference === 360;
  const coincident = origin[1] === target[1] && (sameMeridian || Math.abs(origin[1]) === 90);
  const antipodal = origin[1] === -target[1] && (longitudeDifference === 180 || Math.abs(origin[1]) === 90);
  if (Math.abs(origin[1]) === 90 || coincident || antipodal)
    invalid('Bearing is undefined at a pole origin or between coincident or antipodal positions.', 'coordinates.bearing');
  return ((bearing(origin, target) % 360) + 360) % 360;
}

/** Geographic destination in meters and degrees, using the same horizontal spherical model. */
export function geographicDestination(from: GeographicPosition, meters: number, degrees: number): [number, number] {
  const origin = checked(from);
  if (!Number.isFinite(meters) || meters < 0 || !Number.isFinite(degrees))
    invalid('Distance must be finite and nonnegative; bearing must be finite.', 'coordinates.destination');
  if (meters === 0) return origin;
  if (Math.abs(origin[1]) === 90)
    invalid('A north-based destination direction is undefined at a pole origin.', 'coordinates.destination');
  return destination(origin, meters, degrees);
}
