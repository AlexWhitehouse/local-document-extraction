// Temporary Evaluation result cache: detailed results for one live Evaluation, encrypted in IndexedDB
// under a fresh AES-GCM key that exists only in this page's memory. Nothing here restores after refresh.
const DATABASE = "evaluation-result-cache",
  STORE = "records";

const MiB = 1024 * 1024;

const encoder = new TextEncoder(),
  decoder = new TextDecoder();

export class ResultCacheError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "ResultCacheError";
    this.code = code;
    this.cause = cause;
  }
}

const failure = (error, code = "storage_failed") =>
  error instanceof ResultCacheError
    ? error
    : new ResultCacheError(
        error?.name === "QuotaExceededError"
          ? "This browser ran out of space for Evaluation results."
          : "This browser couldn’t keep Evaluation result details.",
        error?.name === "QuotaExceededError" ? "quota" : code,
        error,
      );

export function createResultCache({
  indexedDB = globalThis.indexedDB,
  keyRange = globalThis.IDBKeyRange,
  crypto = globalThis.crypto,
  hotLimit = 24,
  hotBytes = 8 * MiB,
  pendingLimit = 16 * MiB,
} = {}) {
  // A fresh opaque namespace and key per live Evaluation; neither derives from session or Workspace.
  const namespace = crypto.randomUUID();

  let live = true,
    keyPromise = null,
    databasePromise = null,
    pending = 0,
    counter = 0;

  const hot = new Map(),
    pinned = new Set(),
    writes = new Set(),
    recordWrites = new Map(),
    loads = new Map(),
    waiters = new Set();

  let hotTotal = 0;

  const assertLive = () => {
    if (!live) throw new ResultCacheError("This Evaluation was cleared.", "invalidated");
  };

  const key = () =>
    (keyPromise ||= crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));

  // Random per encryption plus a per-key invocation counter, so an IV can never repeat under this key.
  const nextIv = () => {
    if (counter >= 0xffffffff) throw new ResultCacheError("Result storage needs a fresh Evaluation.", "iv_exhausted");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    new DataView(iv.buffer).setUint32(8, ++counter);

    return iv;
  };

  const aad = (recordId) => encoder.encode(`${namespace}\u0000${recordId}`);

  // A failed open is forgotten so an explicit retry can open again; a connection that arrives too late is closed.
  const open = () =>
    (databasePromise ||= new Promise((resolve, reject) => {
      if (!indexedDB) {
        reject(
          new ResultCacheError("Browser storage is unavailable, so Evaluation results can’t be kept.", "unavailable"),
        );

        return;
      }

      let settled = false;

      const settle = (ok, value) => {
        if (settled) return false;
        settled = true;
        (ok ? resolve : reject)(value);

        return true;
      };

      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: ["namespace", "recordId"] });
      };

      request.onsuccess = () => {
        const database = request.result;

        if (!settle(true, database)) {
          database.close();

          return;
        }

        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };

        database.onclose = () => {
          databasePromise = null;
        };
      };

      request.onerror = () => settle(false, failure(request.error, "unavailable"));
      request.onblocked = () =>
        settle(false, new ResultCacheError("Browser storage is busy. Close other tabs and try again.", "unavailable"));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    }));

  // Success only once the transaction completes, not when the request succeeds.
  const transaction = (mode, work) =>
    open().then(
      (database) =>
        new Promise((resolve, reject) => {
          let value;
          const tx = database.transaction(STORE, mode);
          tx.oncomplete = () => resolve(value);
          tx.onerror = () => reject(failure(tx.error));
          tx.onabort = () => reject(failure(tx.error));
          const request = work(tx.objectStore(STORE));

          if (request)
            request.onsuccess = () => {
              value = request.result;
            };
        }),
    );

  const settleWaiters = () => {
    for (const waiter of [...waiters])
      if (!live || pending < pendingLimit) {
        waiters.delete(waiter);
        waiter();
      }
  };

  const forget = (recordId) => {
    const entry = hot.get(recordId);

    if (entry) {
      hotTotal -= entry.bytes;
      hot.delete(recordId);
    }
  };

  const remember = (recordId, detail, bytes) => {
    forget(recordId);
    hot.set(recordId, { detail, bytes });
    hotTotal += bytes;

    for (const [id, entry] of hot) {
      if (hot.size <= hotLimit && hotTotal <= hotBytes) break;

      if (id === recordId || pinned.has(id)) continue;
      hot.delete(id);
      hotTotal -= entry.bytes;
    }
  };

  const cache = {
    namespace,
    get pendingBytes() {
      return pending;
    },
    hasCapacity: () => pending < pendingLimit,
    // Resolves when pending writes fall under their byte bound, or immediately after invalidation.
    drained: () =>
      live && pending >= pendingLimit ? new Promise((resolve) => waiters.add(resolve)) : Promise.resolve(),
    // Decrypted details for the visible document stay hot; everything else may be evicted.
    pin(recordIds) {
      pinned.clear();

      for (const id of recordIds) pinned.add(id);
    },
    peek(recordId) {
      const entry = hot.get(recordId);

      if (!entry) return null;
      hot.delete(recordId);
      hot.set(recordId, entry);

      return entry.detail;
    },
    async put(recordId, detail) {
      assertLive();
      const plaintext = encoder.encode(JSON.stringify(detail));
      remember(recordId, detail, plaintext.byteLength);
      pending += plaintext.byteLength;

      const write = (async () => {
        const cryptoKey = await key();
        assertLive();
        const iv = nextIv();

        const data = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad(recordId) },
          cryptoKey,
          plaintext,
        );

        assertLive();
        await transaction("readwrite", (store) => store.put({ namespace, recordId, iv, data }));
        assertLive();
      })();

      writes.add(write);
      recordWrites.set(recordId, write);

      try {
        await write;
      } catch (error) {
        forget(recordId);
        throw failure(error);
      } finally {
        pending -= plaintext.byteLength;
        writes.delete(write);

        if (recordWrites.get(recordId) === write) recordWrites.delete(recordId);
        settleWaiters();
      }
    },
    // Reads one cold record. `keep: false` scores it without displacing the visible details.
    load(recordId, { keep = true } = {}) {
      const cached = cache.peek(recordId);

      if (cached) return Promise.resolve(cached);

      if (loads.has(recordId)) return loads.get(recordId);

      const load = (async () => {
        assertLive();
        const record = await transaction("readonly", (store) => store.get([namespace, recordId]));
        assertLive();

        if (!record) throw new ResultCacheError("These result details are no longer in browser storage.", "missing");
        let plaintext;

        try {
          plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: record.iv, additionalData: aad(recordId) },
            await key(),
            record.data,
          );
        } catch (error) {
          throw new ResultCacheError("These result details couldn’t be read back.", "corrupt", error);
        }

        assertLive();
        const detail = JSON.parse(decoder.decode(plaintext));

        if (keep) remember(recordId, detail, plaintext.byteLength);

        return detail;
      })()
        .catch((error) => {
          throw failure(error);
        })
        .finally(() => loads.delete(recordId));

      loads.set(recordId, load);

      return load;
    },
    remove(recordId) {
      forget(recordId);
      pinned.delete(recordId);
      // Delete after any write still in flight for this record, so it cannot land afterwards.
      const writing = recordWrites.get(recordId);

      if (live)
        Promise.resolve(writing)
          .catch(() => {})
          .then(() => live && transaction("readwrite", (store) => store.delete([namespace, recordId])))
          .catch(() => {});
    },
    // Confirms storage works again before staging resumes.
    async probe() {
      const recordId = `probe-${crypto.randomUUID()}`;
      await cache.put(recordId, {});
      cache.remove(recordId);
    },
    // Synchronously detaches the key and plaintext, then deletes only this namespace's records.
    invalidate() {
      if (!live) return;
      live = false;
      keyPromise = null;
      hot.clear();
      pinned.clear();
      hotTotal = 0;
      settleWaiters();
      const opened = databasePromise;

      if (!opened) return;
      Promise.allSettled([...writes])
        .then(() => transaction("readwrite", (store) => store.delete(keyRange.bound([namespace], [namespace, []]))))
        .catch(() => {})
        .finally(() => opened.then((database) => database.close()).catch(() => {}));
    },
  };

  return cache;
}
