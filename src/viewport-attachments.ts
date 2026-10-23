import type { MapMovementEvent } from 'maplibre-gl';
import type { MapFeature, Properties, Viewport } from './types';

export type ViewInvalidation =
  | { kind: 'camera'; phase: 'start' | 'move' | 'end'; event: MapMovementEvent }
  | { kind: 'resize' | 'style' | 'configuration' | 'context-lost' };

export type ViewportAttachmentInternals = {
  getDisplayedFeature(id: string): MapFeature | undefined;
  isQueryReady(): boolean;
  dispatchClick(point: { x: number; y: number }, originalEvent: MouseEvent): void;
  setEditing(id: string | null): void;
  onPrepared(listener: () => void): () => void;
  onViewInvalidation(listener: (reason: ViewInvalidation) => void): () => void;
  reportTargetError(cause?: unknown): void;
};

export const viewportAttachmentInternals = new WeakMap<object, ViewportAttachmentInternals>();

/** Forwarding wrappers share attachment state through their native map. */
export function getViewportAttachmentInternals<P extends Properties>(viewport: Viewport<P>): ViewportAttachmentInternals | undefined {
  return viewportAttachmentInternals.get(viewport.map);
}
