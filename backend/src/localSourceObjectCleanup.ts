import type { LocalSourceObjectManifest, SourceObjectManifestEntry } from "./localSourceObjectManifest";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import type { SourceObjectStore } from "./s3SourceObjectStore";

const BATCH_SIZE = 100;
/** Longer than any admission can take, so an in-flight upload is never treated as abandoned. */
const PREPARING_GRACE_MS = 15 * 60_000;
/** A timed-out write may land after a delete; keep the entry until such a write can no longer arrive. */
const LATE_WRITE_GRACE_MS = 10 * 60_000;
const MIN_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;

export type LocalSourceObjectCleanupSnapshot = {
  deleted: number;
  failures: number;
  linkedAfterRecovery: number;
  lastCompletedAt: string | null;
};

export type LocalSourceObjectCleanup = {
  run(): Promise<void>;
  snapshot(): LocalSourceObjectCleanupSnapshot & ReturnType<LocalSourceObjectManifest["counts"]>;
};

/**
 * Background cleanup for remote retained originals. It never deletes an object a committed owner (an
 * accepted job or a Saved Evaluation document) may reference: stale uploads are released only when the
 * Workspace is gone or its product data positively shows the owner does not reference the object.
 * Unreadable product data is uncertainty, not proof. Failed deletions retry with backoff
 * indefinitely; intent is never discarded after a retry limit.
 */
export function createLocalSourceObjectCleanup({
  manifest,
  objectStore,
  productStoreRegistry,
  workspaceControl,
  now = Date.now,
  random = Math.random,
}: {
  manifest: LocalSourceObjectManifest;
  objectStore: Pick<SourceObjectStore, "delete">;
  productStoreRegistry: LocalWorkspaceProductStoreRegistry;
  workspaceControl: Pick<LocalWorkspaceControl, "workspaceExists">;
  now?: () => number;
  random?: () => number;
}): LocalSourceObjectCleanup {
  let activeRun: Promise<void> | null = null;
  const snapshot: LocalSourceObjectCleanupSnapshot = { deleted: 0, failures: 0, linkedAfterRecovery: 0, lastCompletedAt: null };

  const settlePreparing = (entry: SourceObjectManifestEntry) => {
    if (!workspaceControl.workspaceExists({ workspaceId: entry.workspace_id })) {
      manifest.markDeleting({ objectKey: entry.object_key });
      return;
    }
    let lease;
    try {
      lease = productStoreRegistry.acquire({ workspaceId: entry.workspace_id, mode: "existing" });
    } catch (error) {
      console.warn("Retained object recovery could not read Workspace product data", error);
      return;
    }
    if (!lease) {
      // A Workspace with no product database has no owners, so nothing can reference the object.
      manifest.markDeleting({ objectKey: entry.object_key });
      return;
    }
    try {
      const referencedKey = entry.owner_kind === "evaluation_document"
        ? lease.store.getEvaluationDocumentSource(entry.owner_id)?.retained_object_key
        : lease.store.getRetainedSourceFile(entry.owner_id)?.retained_object_key;
      if (referencedKey === entry.object_key) {
        if (manifest.link({ objectKey: entry.object_key })) snapshot.linkedAfterRecovery += 1;
      } else {
        // The owner is absent or references a different attempt's object: nothing committed uses this one.
        manifest.markDeleting({ objectKey: entry.object_key });
      }
    } catch (error) {
      console.warn("Retained object recovery could not read Workspace product data", error);
    } finally {
      lease.release();
    }
  };

  const deleteObject = async (entry: SourceObjectManifestEntry) => {
    const at = now();
    try {
      await objectStore.delete(entry.object_key);
    } catch (error) {
      snapshot.failures += 1;
      console.warn("Retained object deletion failed; it will be retried", error);
      const backoff = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** Math.min(entry.attempts, 16));
      manifest.deferDeletion({ objectKey: entry.object_key, failed: true, nextAttemptAt: new Date(at + backoff / 2 + random() * backoff / 2).toISOString() });
      return;
    }
    const lateWritesPossibleUntil = Date.parse(entry.created_at) + LATE_WRITE_GRACE_MS;
    if (at < lateWritesPossibleUntil) {
      manifest.deferDeletion({ objectKey: entry.object_key, failed: false, nextAttemptAt: new Date(lateWritesPossibleUntil).toISOString() });
      return;
    }
    manifest.remove({ objectKey: entry.object_key });
    snapshot.deleted += 1;
  };

  const sweep = async () => {
    for (const entry of manifest.listStalePreparing({ before: new Date(now() - PREPARING_GRACE_MS).toISOString(), limit: BATCH_SIZE })) {
      settlePreparing(entry);
    }
    for (const entry of manifest.listDueDeletions({ now: new Date(now()).toISOString(), limit: BATCH_SIZE })) {
      await deleteObject(entry);
    }
    snapshot.lastCompletedAt = new Date(now()).toISOString();
  };

  return {
    run: () => {
      activeRun ??= sweep().finally(() => { activeRun = null; });
      return activeRun;
    },
    snapshot: () => ({ ...snapshot, ...manifest.counts() }),
  };
}
