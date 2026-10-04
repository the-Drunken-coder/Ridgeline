import type { ScreenPoint } from './entity-projection';

export type ModelFeedback = 'hover' | 'selected';
export type ModelPresentation = {
  id: string;
  anchor: ScreenPoint;
  labelAnchor: ScreenPoint;
  hasLabel: boolean;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  feedback?: ModelFeedback;
};

export function modelFeedback(selected: boolean, previewed: boolean): ModelFeedback | undefined {
  return selected ? 'selected' : previewed ? 'hover' : undefined;
}

/** Decoration stays at the displayed model; text retains the native symbol's own altitude. */
export function modelPresentationGeometry(frame: ModelPresentation) {
  const { anchor, labelAnchor, box } = frame;
  const halfX = Math.max(Math.abs(box.minX - anchor.x), Math.abs(box.maxX - anchor.x));
  const halfY = Math.max(Math.abs(box.minY - anchor.y), Math.abs(box.maxY - anchor.y));
  const radius = Math.hypot(halfX, halfY) + 6;
  // Reserve the strongest ring even when idle, avoiding a label relayout on hover or selection.
  const offset = Math.max(1.8, Math.ceil(anchor.y + radius + 10 - labelAnchor.y) / 12);
  const center: [number, number] = [anchor.x, anchor.y], labelOffset: [number, number] = [0, offset];
  return { center, radius, labelOffset };
}
