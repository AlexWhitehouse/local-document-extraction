import type { LocalWorkspaceProductStoreHandle } from "./localWorkspaceProductStoreRegistry";

type PendingWrite = { run(): () => void; reject(error: Error): void };

const pending = new Map<LocalWorkspaceProductStoreHandle, PendingWrite[]>();

/** Share an fsync among concurrent mutations without acknowledging any before
 * commit. A four-millisecond window amortizes commits under concurrent API load;
 * a full 64-operation batch flushes immediately. Nested transactions are savepoints, so one invalid operation rolls
 * back only itself. Callbacks must be synchronous and have no external effects.
 */
export function commitProductWrite<T>(store: LocalWorkspaceProductStoreHandle, signal: AbortSignal, operation: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let batch = pending.get(store);

    if (!batch) {
      const created: PendingWrite[] = [];
      batch = created;
      pending.set(store, created);
      // A full batch may already have flushed; this timer must not cut its successor short.
      setTimeout(() => { if (pending.get(store) === created) flush(store); }, 4);
    }

    batch.push({
      reject,
      run: () => {
        signal.throwIfAborted();
        const result = store.batch ? store.batch(operation) : operation();

        return () => resolve(result);
      },
    });

    if (batch.length >= 64) flush(store);
  });
}

function flush(store: LocalWorkspaceProductStoreHandle) {
  const batch = pending.get(store);

  if (!batch) return;
  pending.delete(store);
  const completions: Array<() => void> = [];

  const apply = () => {
    for (const operation of batch) {
      try { completions.push(operation.run()); }
      catch (error) { completions.push(() => operation.reject(error instanceof Error ? error : new Error("Product mutation failed"))); }
    }
  };

  try {
    if (store.batch) store.batch(apply);
    else apply();
  } catch (error) {
    for (const operation of batch) operation.reject(error instanceof Error ? error : new Error("Product mutation failed"));

    return;
  }

  for (const complete of completions) complete();
}
