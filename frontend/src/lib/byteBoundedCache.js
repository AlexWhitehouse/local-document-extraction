// A conservative UTF-16 serialized-size budget, including keys and metadata.
export function createByteBoundedCache({ maxBytes = 4 * 1024 * 1024, maxEntries = 50 } = {}) {
  const entries = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      const size = (JSON.stringify(value).length + String(key).length) * 2;
      remove(key);
      if (size > maxBytes) return false;
      while (entries.size && (bytes + size > maxBytes || entries.size >= maxEntries)) remove(entries.keys().next().value);
      entries.set(key, { value, bytes: size });
      bytes += size;
      return true;
    },
    delete: remove,
    clear() { entries.clear(); bytes = 0; },
    values: () => [...entries.values()].map((entry) => entry.value),
  };
}
