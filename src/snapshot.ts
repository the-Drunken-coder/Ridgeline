/** Preserve native clone semantics while giving shared memory a private backing store. */
export function cloneSnapshot<T>(value: T): T {
  const snapshot = structuredClone({ value });
  const objects = new WeakMap<object, object>();
  const buffers = new WeakMap<SharedArrayBuffer, SharedArrayBuffer>();

  // Discover hidden owners before repairing a buffer or view that precedes its Memory.
  const pending: unknown[] = [snapshot];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (typeof WebAssembly !== 'undefined' && current instanceof WebAssembly.Memory) {
      const buffer: unknown = current.buffer;
      if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
        // Memory exposes no maximum. Retain the current pages as a fixed snapshot extent.
        const pages = buffer.byteLength / 65536;
        const copy = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
        const backing: unknown = copy.buffer;
        if (!(backing instanceof SharedArrayBuffer)) throw new TypeError('Invalid snapshot memory buffer.');
        new Uint8Array(backing).set(new Uint8Array(buffer));
        objects.set(current, copy);
        buffers.set(buffer, backing);
      }
    } else if (current instanceof Map) {
      for (const [key, entry] of current) pending.push(key, entry);
    } else if (current instanceof Set) {
      for (const entry of current) pending.push(entry);
    } else if (!ArrayBuffer.isView(current)) {
      for (const key of Object.getOwnPropertyNames(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor && 'value' in descriptor) pending.push(descriptor.value);
      }
    }
  }

  function copyBuffer(buffer: SharedArrayBuffer) {
    const previous = buffers.get(buffer);
    if (previous) return previous;
    const capacity = 'growable' in buffer && buffer.growable === true &&
      'maxByteLength' in buffer && typeof buffer.maxByteLength === 'number'
      ? { maxByteLength: buffer.maxByteLength } : undefined;
    const copy: unknown = Reflect.construct(SharedArrayBuffer, [buffer.byteLength, capacity]);
    if (!(copy instanceof SharedArrayBuffer)) throw new TypeError('Invalid snapshot buffer.');
    new Uint8Array(copy).set(new Uint8Array(buffer));
    buffers.set(buffer, copy);
    return copy;
  }

  function repair(current: unknown): unknown {
    if (!current || typeof current !== 'object') return current;
    const previous = objects.get(current);
    if (previous) return previous;
    if (typeof SharedArrayBuffer !== 'undefined' && current instanceof SharedArrayBuffer)
      return copyBuffer(current);
    if (ArrayBuffer.isView(current)) {
      if (typeof SharedArrayBuffer === 'undefined' || !(current.buffer instanceof SharedArrayBuffer)) return current;
      const buffer = copyBuffer(current.buffer);
      const length: unknown = current instanceof DataView ? current.byteLength : Reflect.get(current, 'length');
      if (typeof length !== 'number') throw new TypeError('Invalid snapshot view length.');
      // Native cloning has already replaced consumer prototypes with the intrinsic view constructors.
      const copy: unknown = Reflect.construct(current.constructor, [buffer, current.byteOffset, length]);
      if (!ArrayBuffer.isView(copy) || Object.getPrototypeOf(copy) !== Object.getPrototypeOf(current) ||
        copy.buffer !== buffer || copy.byteOffset !== current.byteOffset || copy.byteLength !== current.byteLength)
        throw new TypeError('Invalid snapshot view.');
      objects.set(current, copy);
      return copy;
    }
    objects.set(current, current);
    if (current instanceof Map) {
      const entries = [...current].map(([key, entry]) => [repair(key), repair(entry)] as const);
      current.clear();
      for (const [key, entry] of entries) current.set(key, entry);
    } else if (current instanceof Set) {
      const entries = [...current].map(repair);
      current.clear();
      for (const entry of entries) current.add(entry);
    } else {
      // Error.cause is non-enumerable and can participate in cycles and backing aliases.
      for (const key of Object.getOwnPropertyNames(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !('value' in descriptor)) continue;
        const replacement = repair(descriptor.value);
        if (replacement !== descriptor.value) Object.defineProperty(current, key, { ...descriptor, value: replacement });
      }
    }
    return current;
  }

  repair(snapshot);
  return snapshot.value;
}
