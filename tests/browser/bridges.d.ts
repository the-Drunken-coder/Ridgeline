export {};

declare global {
  interface Window {
    drawingPointer?: (action: 'move' | 'click', x: number, y: number) => Promise<void>;
    browserKey?: (key: string) => Promise<void>;
    browserKeyDown?: (key: string) => Promise<void>;
    browserKeyUp?: (key: string) => Promise<void>;
    browserStationaryClick?: () => Promise<void>;
    browserDrag?: (fromX: number, fromY: number, toX: number, toY: number, button?: 'left' | 'right') => Promise<void>;
    browserClick?: (selector: string) => Promise<void>;
    cleanupBrowserCase?: () => void;
    browserMouse?: (action: 'down' | 'move' | 'up' | 'click', x: number, y: number) => Promise<void>;
    browserReleaseMouseElsewhere?: () => Promise<void>;
    drawingDirectionObservation?: { image: string; wings: number[]; handle: string | null };
    browserCaptureMap?: () => Promise<string>;
    browserWheel?: (deltaY: number) => Promise<void>;
    browserTouch?: (action: 'start' | 'move' | 'end' | 'cancel', points: { id: number; x: number; y: number }[]) => Promise<void>;
    browserFill?: (selector: string, value: string) => Promise<void>;
  }
}
