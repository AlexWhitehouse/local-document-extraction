// Minimal IndexedDB stand-in for the Evaluation result cache tests: one object store with an array
// keyPath, asynchronous transaction completion, range deletion and injectable failures.
const compare = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compare(a[i], b[i]);

      if (c) return c;
    }

    return a.length - b.length;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return Array.isArray(a) ? 1 : -1;

  return a < b ? -1 : a > b ? 1 : 0;
};

export const FakeKeyRange = {
  bound: (lower, upper) => ({ lower, upper, includes: (key) => compare(key, lower) >= 0 && compare(key, upper) <= 0 }),
};

export function createFakeIndexedDB() {
  const stores = new Map();
  const fake = { stores, failWrites: null, failReads: null, writes: [], closed: 0 };
  const serialize = (key) => JSON.stringify(key);
  const later = (callback) => setTimeout(callback, 0);
  fake.open = () => {
    const request = {};
    later(() => {
      const database = {
        objectStoreNames: { contains: (name) => stores.has(name) },
        createObjectStore: (name, options) => {
          stores.set(name, { keyPath: options.keyPath, records: new Map() });
        },
        close: () => {
          fake.closed++;
        },
        transaction: (name, mode) => {
          const store = stores.get(name);
          const tx = { error: null };

          let failed = null,
            outstanding = 0,
            ready = false,
            done = false;

          // Like IndexedDB, finish only after every request has run, even when timers fire late.
          const finish = () => {
            if (done || !ready || outstanding) return;
            done = true;

            if (failed) {
              tx.error = failed;
              tx.onabort?.();
            } else tx.oncomplete?.();
          };

          const run = (work) => {
            const request = {};
            outstanding++;
            later(() => {
              try {
                request.result = work();
                request.onsuccess?.();
              } catch (error) {
                failed = error;
              }

              outstanding--;
              finish();
            });

            return request;
          };

          tx.objectStore = () => ({
            put: (record) =>
              run(() => {
                if (mode !== "readwrite") throw new Error("ReadOnlyError");

                if (fake.failWrites) throw Object.assign(new Error("Quota exceeded"), { name: fake.failWrites });
                const key = store.keyPath.map((path) => record[path]);
                store.records.set(serialize(key), { key, value: structuredClone(record) });
                fake.writes.push(structuredClone(record));
              }),
            get: (key) =>
              run(() => {
                if (fake.failReads) throw Object.assign(new Error("Read failed"), { name: fake.failReads });

                return structuredClone(store.records.get(serialize(key))?.value);
              }),
            delete: (key) =>
              run(() => {
                if (key && !Array.isArray(key) && key.includes) {
                  for (const [id, entry] of store.records) if (key.includes(entry.key)) store.records.delete(id);
                } else store.records.delete(serialize(key));
              }),
          });
          setTimeout(() => {
            ready = true;
            finish();
          }, 5);

          return tx;
        },
      };

      request.result = database;

      if (!stores.size) request.onupgradeneeded?.();
      request.onsuccess?.();
    });

    return request;
  };

  fake.records = (name = "records") => [...(stores.get(name)?.records.values() || [])].map((entry) => entry.value);

  return fake;
}
