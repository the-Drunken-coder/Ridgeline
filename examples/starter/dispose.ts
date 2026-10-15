/** Release every independent owner and retain all teardown failures. */
export function disposeAll(actions: readonly (() => void)[]) {
  const failures: unknown[] = [];
  for (const action of actions) {
    try { action(); } catch (cause) { failures.push(cause); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Starter cleanup failed.');
}
