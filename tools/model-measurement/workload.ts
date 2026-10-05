import type { FeatureStyle, MapFeature, ModelAppearance } from '@ridgeline/map';

export const variants = ['icons', 'original', 'normalized', '4x', '16x', 'materials'] as const;
export const appearances = ['original', 'assigned', 'mixed'] as const;
export type Case = { variant: typeof variants[number]; appearance: typeof appearances[number]; projection: 'flat' | 'globe'; pixelRatio: 1 | 2 };
export type Settings = Case & { mode: 'smoke' | 'hardware'; instrumentation: boolean; gpu: boolean; warmupMs: number; durationMs: number; repeats: number };
export type Machine = { device: string; os: string; gpu: string; driver: string; browser: string; displayHz: number };
export type WorkloadProperties = { index: number; sequence: number; model: boolean };
export const names = ['drone', 'tank', 'plane', 'boat'] as const;
export const materialNames = ['opaque', 'mask', 'double-sided', 'blend'] as const;
export const camera = { center: [6.87, 46] as [number, number], zoom: 15.2, pitch: 25, bearing: 0 };
export const modelSettings = { switchDistanceMeters: 1e8, deadZoneMeters: 0, minimumSizePixels: 20 };
const palette = ['#cf442a', '#2351c0', '#16865c', '#b07813'];

export function caseId(value: Case) { return `${value.variant}-${value.appearance}-${value.projection}-dpr${value.pixelRatio}`; }
export function matrix(): Case[] {
  return variants.flatMap(variant => appearances.flatMap(appearance => (['flat', 'globe'] as const).flatMap(projection =>
    ([1, 2] as const).map(pixelRatio => ({ variant, appearance, projection, pixelRatio })))));
}
export function validateSettings(settings: Settings, machine?: Machine) {
  if (!variants.includes(settings.variant) || !appearances.includes(settings.appearance) || !['flat', 'globe'].includes(settings.projection) || ![1, 2].includes(settings.pixelRatio)) throw new Error('Invalid workload case.');
  if (![settings.warmupMs, settings.durationMs, settings.repeats].every(Number.isFinite) || settings.warmupMs < 0 || settings.durationMs < 100 || !Number.isInteger(settings.repeats) || settings.repeats < 1) throw new Error('Invalid sampling settings.');
  if (settings.mode === 'hardware' && (settings.warmupMs < 10_000 || settings.durationMs < 30_000 || settings.repeats < 3)) throw new Error('Hardware runs require 10 s warmup and three 30 s runs per camera segment.');
  if (settings.mode === 'hardware' && (!machine || !['device', 'os', 'gpu', 'driver', 'browser'].every(key => typeof machine[key as keyof Machine] === 'string' && String(machine[key as keyof Machine]).trim().length >= 3 && !/^(unknown|pending|n\/a|tbd|placeholder)$/i.test(String(machine[key as keyof Machine]).trim())) || !Number.isFinite(machine.displayHz) || machine.displayHz <= 0)) throw new Error('Hardware runs require device, OS, GPU, driver/backend, browser version and display refresh metadata.');
  if (!['smoke', 'hardware'].includes(settings.mode)) throw new Error('Invalid measurement mode.');
}
export function features(sequence: number, variant: Case['variant']): MapFeature<WorkloadProperties>[] {
  const time = sequence / 10;
  return Array.from({ length: 1100 }, (_, index) => {
    const model = index < 100, slot = model ? index : index - 100;
    const east = (model ? 100 + slot % 10 * 63 : -700 + slot % 32 * 19) + Math.sin(time + index * 1.618) * 3;
    const north = (model ? -260 + Math.floor(slot / 10) * 57 : -300 + Math.floor(slot / 32) * 19) + Math.cos(time * .7 + index * 2.414) * 3;
    return { type: 'Feature', id: `${model ? 'model' : 'icon'}-${slot}`, properties: { index, sequence, model },
      geometry: { type: 'Point', coordinates: [camera.center[0] + east / (111_320 * Math.cos(camera.center[1] * Math.PI / 180)), camera.center[1] + north / 111_320] },
      entity: { heading: (sequence * 2 + index * 17) % 360,
        ...(model && variant !== 'icons' ? { model: { id: (variant === 'materials' ? materialNames : names)[slot % 4]! } } : {}) } };
  });
}
export function style(feature: MapFeature<WorkloadProperties>, appearance: Case['appearance']): FeatureStyle {
  const index = feature.properties.index;
  let modelAppearance: ModelAppearance | undefined;
  if (appearance === 'original' || appearance === 'mixed' && index % 3 === 0) modelAppearance = { mode: 'original' };
  else if (appearance === 'assigned' || index % 3 === 1) modelAppearance = { mode: 'color', color: palette[index % palette.length]! };
  return { icon: 'measurement-icon', color: '#236ca0', radius: 0, modelAppearance };
}
