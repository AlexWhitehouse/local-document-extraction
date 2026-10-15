import type { LocalSourceObjectManifest, SourceObjectManifestEntry } from "./localSourceObjectManifest";
import type { LocalSourceStorageDestinations } from "./localSourceStorageDestinations";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";

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
 * accepted job, packet, or Saved Evaluation document) may reference: stale uploads are released only when the
 * Workspace is gone or its product data positively shows the owner does not reference the object.
 * Unreadable product data is uncertainty, not proof. Failed deletions retry with backoff
 * indefinitely; intent is never discarded after a retry limit.
 *
 * Each bucket is swept independently and concurrently. A bucket stops for the rest of a sweep at its
 * first failure, so an unreachable Workspace bucket costs one timed-out request per sweep, not a batch.
 */
export function createLocalSourceObjectCleanup({
  manifest,
  storeFor,
  destinations,
  productStoreRegistry,
  workspaceControl,
  now = Date.now,
  random = Math.random,
}: {
  manifest: LocalSourceObjectManifest;
  /** The store an entry's destination ID names; throws when that bucket cannot be reached. */
  storeFor: (destinationId: string) => Pick<SourceObjectStore, "delete">;
  /** Retired Workspace buckets are forgotten, with their credentials, once nothing depends on them. */
  destinations?: Pick<LocalSourceStorageDestinations, "pruneRetired">;
  productStoreRegistry: {
    acquire(input: { workspaceId: string; mode: "existing" }): {
      store: {
        getRetainedSourceFile(id: string): { retained_object_key: string | null } | null;
        getEvaluationDocumentSource(id: string): { retained_object_key: string | null } | null;
      };
      release(): void;
    } | null;
  };
  workspaceControl: Pick<LocalWorkspaceControl, "workspaceExists">;
  now?: () => number;
  random?: () => number;
}): LocalSourceObjectCleanup {
  let activeRun: Promise<void> | null = null;

  const snapshot: LocalSourceObjectCleanupSnapshot = {
    deleted: 0,
    failures: 0,
    linkedAfterRecovery: 0,
    lastCompletedAt: null,
  };

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
      // Packet originals have their own source_files row under the packet ID;
      // children reference separate derived sources and cannot release it.
      const referencedKey =
        entry.owner_kind === "evaluation_document"
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
      await storeFor(entry.destination_id).delete(entry.object_key);
    } catch (error) {
      snapshot.failures += 1;
      console.warn("Retained object deletion failed; it will be retried", error);
      const backoff = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** Math.min(entry.attempts, 16));
      manifest.deferDeletion({
        objectKey: entry.object_key,
        failed: true,
        nextAttemptAt: new Date(at + backoff / 2 + (random() * backoff) / 2).toISOString(),
      });

      return false;
    }

    const lateWritesPossibleUntil = Date.parse(entry.created_at) + LATE_WRITE_GRACE_MS;

    if (at < lateWritesPossibleUntil) {
      manifest.deferDeletion({
        objectKey: entry.object_key,
        failed: false,
        nextAttemptAt: new Date(lateWritesPossibleUntil).toISOString(),
      });

      return true;
    }

    manifest.remove({ objectKey: entry.object_key });
    snapshot.deleted += 1;

    return true;
  };

  const sweepDestination = async (entries: SourceObjectManifestEntry[]) => {
    for (const entry of entries) {
      if (!(await deleteObject(entry))) return;
    }
  };

  const sweep = async () => {
    for (const entry of manifest.listStalePreparing({
      before: new Date(now() - PREPARING_GRACE_MS).toISOString(),
      limit: BATCH_SIZE,
    })) {
      settlePreparing(entry);
    }

    const byDestination = new Map<string, SourceObjectManifestEntry[]>();

    for (const entry of manifest.listDueDeletions({ now: new Date(now()).toISOString(), limit: BATCH_SIZE })) {
      const entries = byDestination.get(entry.destination_id);

      if (entries) entries.push(entry);
      else byDestination.set(entry.destination_id, [entry]);
    }

    await Promise.all([...byDestination.values()].map(sweepDestination));
    // Uploads resolve their destination just before recording it, so wait out that window before forgetting one.
    destinations?.pruneRetired({
      pending: manifest.countsByDestination(),
      retiredBefore: new Date(now() - PREPARING_GRACE_MS).toISOString(),
    });
    snapshot.lastCompletedAt = new Date(now()).toISOString();
  };

  return {
    run: () => {
      activeRun ??= sweep().finally(() => {
        activeRun = null;
      });

      return activeRun;
    },
    snapshot: () => ({ ...snapshot, ...manifest.counts() }),
  };
}
