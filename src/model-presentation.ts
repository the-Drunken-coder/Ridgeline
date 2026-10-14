import type { ScreenPoint } from './entity-projection';
import type { LabelStyle } from './types';

export type ModelFeedback = 'hover' | 'selected';
export type ModelPresentation = {
  id: string;
  anchor: ScreenPoint;
  labelAnchor: ScreenPoint;
  hasLabel: boolean;
  labelStyle?: LabelStyle;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  feedback?: ModelFeedback;
  feedbackColor?: string;
  feedbackWidth?: number;
  /** Reserve both feedback states, so activation does not move the label. */
  labelClearance?: number;
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
  const style = frame.labelStyle, size = style?.size ?? 12, placement = style?.anchor ?? 'top';
  const labelOffset: [number, number] = style?.offset ? [...style.offset] : placement === 'top' ? [0, 1.8] : [0, 0];
  const dx = placement.includes('left') ? 1 : placement.includes('right') ? -1 : 0;
  const dy = placement.includes('top') ? 1 : placement.includes('bottom') ? -1 : 0;
  const length = Math.hypot(dx, dy);
  if (length) {
    const x = dx / length, y = dy / length;
    const clearance = Math.max(frame.labelClearance ?? 10, (frame.feedbackWidth ?? 0) / 2 + 4);
    const required = Math.ceil((anchor.x - labelAnchor.x) * x + (anchor.y - labelAnchor.y) * y + radius + clearance) / size;
    const extra = Math.max(0, required - labelOffset[0] * x - labelOffset[1] * y);
    labelOffset[0] += x * extra; labelOffset[1] += y * extra;
  }
  const center: [number, number] = [anchor.x, anchor.y];
  return { center, radius, labelOffset };
}
