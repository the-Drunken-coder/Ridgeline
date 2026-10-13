import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { EntityModel, EntityModelSettings, ModelAppearance, ModelDefinition } from './types';

export const DEFAULT_ENTITY_MODELS: Readonly<EntityModelSettings> = Object.freeze({ switchDistanceMeters: 2000, deadZoneMeters: 200, minimumSizePixels: 40 });
export function modelSettings(defaults: EntityModelSettings, overrides?: Partial<EntityModelSettings>): EntityModelSettings {
  const next = { ...defaults };
  for (const key of ['switchDistanceMeters', 'deadZoneMeters', 'minimumSizePixels'] as const)
    if (overrides?.[key] !== undefined) next[key] = overrides[key];
  if (!Number.isFinite(next.switchDistanceMeters) || next.switchDistanceMeters <= 0 ||
    !Number.isFinite(next.deadZoneMeters) || next.deadZoneMeters < 0 || next.deadZoneMeters >= 2 * next.switchDistanceMeters ||
    !Number.isFinite(next.minimumSizePixels) || next.minimumSizePixels < 0)
    throw new Error('Model distance must be positive, dead zone nonnegative and smaller than twice the distance, and minimum size nonnegative.');
  return { switchDistanceMeters: next.switchDistanceMeters, deadZoneMeters: next.deadZoneMeters, minimumSizePixels: next.minimumSizePixels };
}
export function validateModelReference(model: EntityModel, fail: (message: string) => never) {
  if (!model || typeof model.id !== 'string' || !model.id.trim()) fail('An entity model needs a nonempty ID.');
  if (model.followSlope !== undefined && typeof model.followSlope !== 'boolean') fail('Model followSlope must be a boolean.');
  for (const key of ['switchDistanceMeters', 'deadZoneMeters', 'minimumSizePixels'] as const) {
    const value = model[key];
    if (value !== undefined && (!Number.isFinite(value) || (key === 'switchDistanceMeters' ? value <= 0 : value < 0))) fail('Model settings must have finite valid values.');
  }
}
export function modelAppearance(appearance?: ModelAppearance): ModelAppearance | undefined {
  if (appearance === undefined) return undefined;
  appearance = appearance && { ...appearance };
  if (appearance?.mode === 'original') return { mode: 'original' };
  if (appearance?.mode !== 'color' || typeof appearance.color !== 'string' || !Color.parse(appearance.color)) throw new Error('A model appearance needs a supported CSS color or original mode.');
  return { mode: 'color', color: appearance.color };
}
export function modelDefinition(definition: ModelDefinition) {
  if (!(definition?.bytes instanceof ArrayBuffer)) throw new Error('Model bytes must be an ArrayBuffer.');
  const metersPerUnit = definition.metersPerUnit ?? 1, headingOffset = definition.headingOffset ?? 0;
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0 || !Number.isFinite(headingOffset)) throw new Error('Model scale must be positive and finite; headingOffset must be finite.');
  return { bytes: definition.bytes.slice(0), metersPerUnit, headingOffset, appearance: modelAppearance(definition.appearance) };
}
