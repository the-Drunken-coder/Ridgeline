type CaseRun<Context> = (context: Context) => Promise<void>;

export function createCaseRegistry<Context>(
  titles: readonly string[],
  modules: readonly Readonly<Partial<Record<string, CaseRun<Context>>>>[],
) {
  const expected = new Set(titles);
  if (expected.size !== titles.length) throw new Error('Duplicate browser case catalog title.');
  const bindings = new Map<string, CaseRun<Context>>();
  for (const module of modules) for (const [title, run] of Object.entries(module)) {
    if (!expected.has(title)) throw new Error(`Unknown browser case binding: ${title}`);
    if (bindings.has(title)) throw new Error(`Duplicate browser case binding: ${title}`);
    if (typeof run !== 'function') throw new Error(`Missing browser case binding: ${title}`);
    bindings.set(title, run);
  }
  const missing = titles.filter(title => !bindings.has(title));
  if (missing.length) throw new Error('Missing browser case bindings: ' + missing.join(', '));
  const registered = [...bindings.keys()];
  if (registered.some((title, index) => title !== titles[index]))
    throw new Error('Browser case catalog differs from registered check order.');
  return {
    async run(title: string, context: () => Context) {
      const run = bindings.get(title);
      if (!run) throw new Error(`Unknown browser case: ${title}`);
      await run(context());
    },
  };
}
