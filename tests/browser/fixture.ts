type OwnedResource = { destroy(): void };

export function createCaseFixture<Resource extends OwnedResource>(onOwn?: (resource: Resource) => void) {
  const owned = new Set<Resource>();
  let phase: 'active' | 'cleaning' | 'retired' = 'active';
  return {
    own<T extends Resource>(resource: T): T {
      if (phase === 'retired') {
        resource.destroy();
        throw new Error('Browser case already cleaned up.');
      }
      if (!owned.has(resource)) {
        owned.add(resource);
        onOwn?.(resource);
      }
      return resource;
    },
    cleanup() {
      if (phase !== 'active') return;
      phase = 'cleaning';
      const failures: unknown[] = [];
      for (const resource of owned) {
        try { resource.destroy(); }
        catch (error) { failures.push(error); }
      }
      owned.clear();
      phase = 'retired';
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Browser case cleanup failed.');
    },
  };
}
