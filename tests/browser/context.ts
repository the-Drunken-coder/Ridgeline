import type { Viewport } from '@ridgeline/map';
import type { BrowserCaseTitle } from './catalog';
import type { until } from './helpers';

export type BrowserViewport = Pick<Viewport, 'ready' | 'map' | 'destroy'>;
export type BrowserCaseContext = {
  container: HTMLDivElement;
  until: typeof until;
  own<T extends BrowserViewport>(viewport: T): T;
};
export type BrowserCaseRun = (context: BrowserCaseContext) => Promise<void>;
export type BrowserCaseModule = Partial<Record<BrowserCaseTitle, BrowserCaseRun>>;
