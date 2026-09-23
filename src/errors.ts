export type ErrorCode =
  | 'INVALID_FEATURE' | 'INVALID_CONFIGURATION' | 'INITIALIZATION_FAILED' | 'INITIALIZATION_TIMEOUT'
  | 'STYLE_FAILED' | 'ELEVATION_UNAVAILABLE' | 'ASSET_FAILED' | 'UPDATE_FAILED'
  | 'ICON_FAILED' | 'DESTROYED' | 'CALLBACK_FAILED' | 'ALTITUDE_MISSING' | 'BELOW_TERRAIN';

export class RidgelineError extends Error {
  override readonly name = 'RidgelineError';
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly context: { operation: string; recoverable: boolean; featureId?: string; sourceId?: string },
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

export type Logger = (error: RidgelineError) => void;

/** Bounds repeated resource logs while still notifying consumers of each error. */
export function createReporter(logger: Logger = error => console.error(`[Ridgeline:${error.code}]`, error)) {
  const seen = new Map<string, number>();
  return (error: RidgelineError) => {
    const key = `${error.code}:${error.context.operation}:${error.context.sourceId ?? ''}`;
    const now = Date.now();
    if (now - (seen.get(key) ?? -Infinity) < 10_000) return;
    seen.set(key, now);
    if (seen.size > 100) seen.delete(seen.keys().next().value ?? '');
    try { logger(error); } catch { /* A logger must not interrupt rendering or disposal. */ }
  };
}
