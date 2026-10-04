import type { EntityModelSettings, EntityModelState } from './types';

export type ModelChoice = { modelId: string; model: boolean };
type ChoiceInput = { modelId?: string; heading?: number; status: EntityModelState['status'];
  eligible: boolean; distance: number; settings: EntityModelSettings };

/** A proposed choice. The scene accepts it only with the frame that uses it. */
export function modelChoice(previous: ModelChoice | undefined, input: ChoiceInput): ModelChoice | undefined {
  const { modelId, heading, status, eligible, distance, settings } = input;
  if (!modelId) return undefined;
  let model = previous?.modelId === modelId && previous.model;
  if (heading === undefined || status === 'unavailable') model = false;
  else if (eligible && status === 'ready') {
    if (distance < settings.switchDistanceMeters - settings.deadZoneMeters / 2) model = true;
    else if (distance > settings.switchDistanceMeters + settings.deadZoneMeters / 2) model = false;
  }
  return { modelId, model: Boolean(model) };
}
