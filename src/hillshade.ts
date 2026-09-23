import type { HillshadeLayerSpecification } from 'maplibre-gl';
import { RidgelineError } from './errors';
import type { HillshadeOptions } from './types';

export const DEFAULT_HILLSHADE: Readonly<Required<HillshadeOptions>> = Object.freeze({
  method: 'standard', direction: 335, altitude: 45, anchor: 'viewport', intensity: 0.35,
  shadowColor: '#000000', highlightColor: '#ffffff', accentColor: '#000000',
});

/** Undefined fields preserve prior settings; arrays are copied at the configuration boundary. */
export function resolveHillshade(next: HillshadeOptions = {}, previous: HillshadeOptions = DEFAULT_HILLSHADE): Required<HillshadeOptions> {
  const result = { ...DEFAULT_HILLSHADE, ...previous, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) };
  const validNumbers = (value: number | number[], max: number) => {
    const values = Array.isArray(value) ? value : [value];
    return values.length > 0 && values.every(item => Number.isFinite(item) && item >= 0 && item <= max)
      && (values.length === 1 || result.method === 'multidirectional');
  };
  if (!['standard', 'basic', 'combined', 'igor', 'multidirectional'].includes(result.method)
    || !['map', 'viewport'].includes(result.anchor)
    || !Number.isFinite(result.intensity) || result.intensity < 0 || result.intensity > 1
    || !validNumbers(result.direction, 359) || !validNumbers(result.altitude, 90)
    || [result.shadowColor, result.highlightColor, result.accentColor].some(color => typeof color !== 'string' || !color.trim())) {
    throw new RidgelineError('INVALID_CONFIGURATION', 'Invalid hillshade settings. Check the method, light angles, intensity, and colors.', { operation: 'configure', recoverable: true });
  }
  return structuredClone(result);
}

export function hillshadePaint(options: HillshadeOptions): NonNullable<HillshadeLayerSpecification['paint']> {
  const settings = { ...DEFAULT_HILLSHADE, ...options };
  return {
    'hillshade-method': settings.method,
    'hillshade-illumination-direction': settings.direction,
    'hillshade-illumination-altitude': settings.altitude,
    'hillshade-illumination-anchor': settings.anchor,
    'hillshade-exaggeration': settings.intensity,
    'hillshade-shadow-color': settings.shadowColor,
    'hillshade-highlight-color': settings.highlightColor,
    'hillshade-accent-color': settings.accentColor,
  };
}
