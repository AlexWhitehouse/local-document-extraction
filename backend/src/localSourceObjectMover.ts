import { createHash } from "node:crypto";

import type { LocalSourceFileStore } from "./localSourceFileStore";
import type { LocalSourceObjectManifest } from "./localSourceObjectManifest";
import type { LocalSourceObjectMoves, SourceObjectMove, SourceObjectMoveItem } from "./localSourceObjectMoves";
import type { HeldRetainedObjectDestination, RetainedObjectDestination } from "./localRetainedSourceObjectRouting";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalRetainedOriginal, LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { SourceObjectMissingError, type SourceObjectStore } from "./s3SourceObjectStore";

/** The upload limit: every original fits one PUT, as when it was first stored. */
const MAX_OBJECT_BYTES = 32 * 1024 * 1024;

const BATCH_SIZE = 25;

/** A read that opened the old copy just before the swap can finish before cleanup deletes it. */
const READ_GRACE_MS = 10 * 60_000;

/** Bun's S3 streams take no deadline; bound a whole body read so one stalled bucket cannot hang a move. */
const BODY_DEADLINE_MS = 2 * 60_000;

const MAX_PASSES = 6;

/** Read failures in a row after which a source is treated as unreachable for the rest of a pass. */
const SOURCE_FAILURE_LIMIT = 3;

const MIN_RETRY_MS = 60_000;

const MAX_RETRY_MS = 60 * 60_000;

/** Moves share a bucket with uploads, downloads and cleanup, so each takes only a couple of requests at once. */
const PER_DESTINATION_LIMIT = 2;

const GLOBAL_LIMIT = 4;

type ProductLease = {
  store: Pick<LocalWorkspaceProductStore, "listRetainedOriginals" | "getRetainedOriginal" | "replaceRetainedOriginal">;
  release(): void;
};

export type LocalSourceObjectMover = {
  run(): Promise<void>;
};

class TargetUnavailable extends Error {}

class SourceUnavailable extends Error {}

class OriginalFailed extends Error {}

type Outcome = { kind: "moved"; bytes: number } | { kind: "skipped" } | { kind: "waiting" };

/**
 * Copies a Workspace's retained originals into its current location, one at a time per move.
 *
 * Each original follows the same protocol: record the new copy and an in-flight item together, copy it
 * through this server, read it back and compare size and SHA-256, then compare-and-swap the owner's
 * reference. Only after the owner points at the new copy is the old one handed to cleanup, after a grace
 * period for reads already in progress. The in-flight item lets a restart decide, from the owner's
 * reference, which copy survives; until then stale-upload recovery leaves the new copy alone.
 */
export function createLocalSourceObjectMover({
  manifest,
  moves,
  sourceObjects,
  sourceFileStore,
  productStoreRegistry,
  workspaceControl,
  now = Date.now,
}: {
  manifest: Pick<LocalSourceObjectManifest, "entry">;
  moves: LocalSourceObjectMoves;
  sourceObjects: {
    destinationFor(workspaceId: string): HeldRetainedObjectDestination | null;
    storeFor(destinationId: string): Pick<SourceObjectStore, "open" | "put">;
  };
  sourceFileStore: Pick<LocalSourceFileStore, "open" | "delete">;
  productStoreRegistry: { acquire(input: { workspaceId: string; mode: "existing" }): ProductLease | null };
  workspaceControl: Pick<LocalWorkspaceControl, "workspaceExists">;
  now?: () => number;
}): LocalSourceObjectMover {
  let activeRun: Promise<void> | null = null;
  const slots = createSlots();
  /**
   * Read failures in a row per source, for each move's current pass. One unreadable original costs only
   * itself; a source that keeps failing is skipped until the next pass.
   */
  const sourceFailures = new Map<string, { pass: number; counts: Map<string, number> }>();

  const sourceFailuresOf = (move: SourceObjectMove) => {
    const current = sourceFailures.get(move.id);

    if (current?.pass === move.pass) return current.counts;
    const counts = new Map<string, number>();
    sourceFailures.set(move.id, { pass: move.pass, counts });

    return counts;
  };

  const iso = (offsetMs = 0) => new Date(now() + offsetMs).toISOString();

  const backoff = (attempts: number) => Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** Math.min(attempts, 16));

  /** Reads one owner's current reference; undefined when product data can't be read right now. */
  const readOwner = (workspaceId: string, item: Pick<SourceObjectMoveItem, "owner_kind" | "owner_id">) => {
    if (!workspaceControl.workspaceExists({ workspaceId })) return null;
    let lease: ProductLease | null;

    try {
      lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });
    } catch (error) {
      console.warn("Original move could not read Workspace product data", error);

      return undefined;
    }

    if (!lease) return null;

    try {
      return lease.store.getRetainedOriginal({ ownerKind: item.owner_kind, ownerId: item.owner_id });
    } catch (error) {
      console.warn("Original move could not read Workspace product data", error);

      return undefined;
    } finally {
      lease.release();
    }
  };

  /**
   * Resolves an in-flight item from what its owner references. The new copy survives only when the owner
   * points at it; a copy nobody references, old or new, goes to cleanup. Returns false to retry later.
   */
  const settleItem = async (item: SourceObjectMoveItem): Promise<boolean> => {
    const owner = readOwner(item.workspace_id, item);

    if (owner === undefined) return false;

    // A library entry's local original has no other cleanup once the entry stops referencing it.
    const localLeftBehind =
      item.owner_kind === "evaluation_document" && item.old_local_key && owner?.source_file_key !== item.old_local_key
        ? item.old_local_key
        : null;

    if (owner?.retained_object_key === item.new_key) {
      if (localLeftBehind) {
        // Reads that opened the local file before the swap get the same grace as remote old copies.
        if (Date.parse(item.created_at) + READ_GRACE_MS > now()) {
          moves.linkItem(item.new_key);

          return true;
        }

        if (!(await deleteLocal(localLeftBehind))) return false;
      }

      moves.endItem({
        newKey: item.new_key,
        link: item.new_key,
        release: item.old_key ? [{ objectKey: item.old_key, notBefore: iso(READ_GRACE_MS) }] : [],
      });

      return true;
    }

    const release = [{ objectKey: item.new_key }];

    // Keys are unique to one owner, so an old copy its owner no longer references is unreferenced.
    if (item.old_key && owner?.retained_object_key !== item.old_key) release.push({ objectKey: item.old_key });

    if (localLeftBehind && !(await deleteLocal(localLeftBehind))) return false;
    moves.endItem({ newKey: item.new_key, release });

    return true;
  };

  const deleteLocal = async (sourceFileKey: string) => {
    try {
      await sourceFileStore.delete(sourceFileKey);

      return true;
    } catch (error) {
      console.warn("A moved library original's local copy could not be deleted; it will be retried", error);

      return false;
    }
  };

  const readOriginal = async (original: LocalRetainedOriginal, sourceDestination: string | null) => {
    if (sourceDestination === null) {
      let file: Blob | null | undefined;

      try {
        file = await sourceFileStore.open?.(original.source_file_key!);
      } catch (error) {
        throw new SourceUnavailable("The local original could not be read", { cause: error });
      }

      if (!file) throw new OriginalFailed("The original is missing from the data folder.");

      if (file.size > MAX_OBJECT_BYTES) throw new OriginalFailed("The original is larger than 32 MiB.");

      return new Uint8Array(await file.arrayBuffer());
    }

    let object;

    try {
      object = await sourceObjects.storeFor(sourceDestination).open(original.retained_object_key!);
    } catch (error) {
      if (error instanceof SourceObjectMissingError)
        throw new OriginalFailed("The original is missing from its bucket.");
      throw new SourceUnavailable("The original's bucket could not be reached", { cause: error });
    }

    if (object.size > MAX_OBJECT_BYTES) throw new OriginalFailed("The original is larger than 32 MiB.");

    try {
      return await readBody(object.stream(), { expectedSize: object.size });
    } catch (error) {
      throw new SourceUnavailable("The original could not be read", { cause: error });
    }
  };

  const moveOriginal = async (
    move: SourceObjectMove,
    target: RetainedObjectDestination,
    original: LocalRetainedOriginal,
  ): Promise<Outcome> => {
    let sourceDestination: string | null = null;

    if (original.retained_object_key) {
      const entry = manifest.entry(original.retained_object_key);

      if (!entry) throw new OriginalFailed("This original has no storage record, so it can't be moved safely.");

      if (entry.destination_id === target.id) return { kind: "skipped" };

      // An upload that recovery hasn't linked yet, or an original already being released.
      if (entry.phase !== "linked") return { kind: "waiting" };
      sourceDestination = entry.destination_id;
    } else if (!original.source_file_key) return { kind: "skipped" };

    if (!original.settled) return { kind: "waiting" };
    const source = sourceDestination ?? "local";
    const failures = sourceFailuresOf(move);

    if ((failures.get(source) ?? 0) >= SOURCE_FAILURE_LIMIT) return { kind: "waiting" };

    return slots.with([target.id, source], async () => {
      let bytes: Uint8Array;

      try {
        bytes = await readOriginal(original, sourceDestination);
        failures.delete(source);
      } catch (error) {
        if (!(error instanceof SourceUnavailable)) throw error;
        console.warn("Original move could not read an original", error);
        failures.set(source, (failures.get(source) ?? 0) + 1);

        if (move.pass >= MAX_PASSES)
          throw new OriginalFailed("The original couldn't be read where it's stored, so it stayed there.");

        return { kind: "waiting" };
      }

      const digest = sha256(bytes);

      const newKey =
        original.owner_kind === "evaluation_document"
          ? target.documentKeyFor({
              workspaceId: move.workspace_id,
              documentId: original.owner_id,
              mimeType: original.mime_type,
            })
          : target.keyFor({
              workspaceId: move.workspace_id,
              jobId: original.owner_id,
              mimeType: original.mime_type,
              ownerKind: original.owner_kind,
            });

      const item: SourceObjectMoveItem = {
        new_key: newKey,
        move_id: move.id,
        workspace_id: move.workspace_id,
        owner_kind: original.owner_kind,
        owner_id: original.owner_id,
        old_key: original.retained_object_key,
        old_local_key: original.retained_object_key ? null : original.source_file_key,
        created_at: iso(),
      };

      moves.beginItem({ ...item, destinationId: target.id, byteSize: bytes.byteLength });
      const store = sourceObjects.storeFor(target.id);

      try {
        await store.put({
          key: newKey,
          file: new Blob([Uint8Array.from(bytes)], { type: original.mime_type }),
          mimeType: original.mime_type,
        });
        const copy = await store.open(newKey);
        const mismatch = new OriginalFailed("The copy read back from the new location didn't match the original.");

        if (copy.size !== bytes.byteLength) throw mismatch;

        if (sha256(await readBody(copy.stream(), { expectedSize: copy.size })) !== digest) throw mismatch;
      } catch (error) {
        moves.endItem({ newKey, release: [{ objectKey: newKey }] });

        if (error instanceof OriginalFailed) throw error;
        throw new TargetUnavailable("The new location could not be reached", { cause: error });
      }

      let replaced: boolean;
      const lease = productStoreRegistry.acquire({ workspaceId: move.workspace_id, mode: "existing" });

      try {
        replaced =
          lease?.store.replaceRetainedOriginal({
            ownerKind: original.owner_kind,
            ownerId: original.owner_id,
            from: { objectKey: original.retained_object_key, sourceFileKey: original.source_file_key },
            objectKey: newKey,
          }) ?? false;
      } finally {
        lease?.release();
      }

      // Settling re-reads the owner, so a crash here and a restart take the same path.
      if (!(await settleItem(item))) return { kind: "waiting" };

      if (replaced) return { kind: "moved", bytes: bytes.byteLength };

      // A deleted owner has nothing left to move; one that changed or is processing again gets a later pass.
      return readOwner(move.workspace_id, item) === null ? { kind: "skipped" } : { kind: "waiting" };
    });
  };

  const stopReason = (move: SourceObjectMove, target: RetainedObjectDestination | null): string | null => {
    if (!workspaceControl.workspaceExists({ workspaceId: move.workspace_id })) return "The Workspace was deleted.";

    if (target?.id !== move.target_id)
      return "The Workspace's storage location changed during the move. Originals already moved stay readable where they are. Start a new move to continue.";

    try {
      sourceObjects.storeFor(target.id);
    } catch {
      return "The saved access keys for the new location can't be read. Enter them again, then start a new move.";
    }

    return null;
  };

  const runMove = async (move: SourceObjectMove) => {
    // Held for the whole batch, so cleanup can't forget the target before a copy there is recorded.
    const target = sourceObjects.destinationFor(move.workspace_id);

    try {
      await runBatch(move, target);
    } finally {
      target?.release();
    }
  };

  const runBatch = async (move: SourceObjectMove, target: RetainedObjectDestination | null) => {
    const reason = stopReason(move, target);

    if (reason || !target) {
      moves.finish({ moveId: move.id, status: "stopped", message: reason });

      return;
    }

    let batch: LocalRetainedOriginal[];

    try {
      const lease = productStoreRegistry.acquire({ workspaceId: move.workspace_id, mode: "existing" });

      if (!lease) {
        moves.finish({ moveId: move.id, status: "stopped", message: "The Workspace was deleted." });

        return;
      }

      try {
        batch = lease.store.listRetainedOriginals({
          after: move.cursor_kind && move.cursor_id ? { kind: move.cursor_kind, id: move.cursor_id } : null,
          limit: BATCH_SIZE,
        });
      } finally {
        lease.release();
      }
    } catch (error) {
      console.warn("Original move could not read Workspace product data", error);
      moves.pause({
        moveId: move.id,
        nextAttemptAt: iso(backoff(move.attempts)),
        message: "The Workspace's documents couldn't be read. The move will try again shortly.",
      });

      return;
    }

    for (const original of batch) {
      const current = moves.get(move.id);

      if (current?.status !== "running") return;
      const cursor = { kind: original.owner_kind, id: original.owner_id };
      const owner = { moveId: move.id, cursor, ownerKind: original.owner_kind, ownerId: original.owner_id };

      if (moves.hasFailed({ moveId: move.id, ownerKind: original.owner_kind, ownerId: original.owner_id })) {
        moves.advance({ ...owner, outcome: { kind: "skipped" } });
        continue;
      }

      try {
        const outcome = await moveOriginal(current, target, original);

        moves.advance({ ...owner, outcome });
      } catch (error) {
        if (error instanceof OriginalFailed) {
          moves.advance({ ...owner, outcome: { kind: "failed", failure: { name: original.name, message: error.message } } });
          continue;
        }

        console.warn("Original move paused", error);
        const at = iso(backoff(current.attempts));

        moves.pause({
          moveId: move.id,
          nextAttemptAt: at,
          message:
            error instanceof TargetUnavailable
              ? "The new location couldn't be reached. The move will try again automatically."
              : "The move hit an unexpected problem. It will try again automatically.",
        });

        return;
      }
    }

    if (batch.length === BATCH_SIZE) return;
    const finished = moves.get(move.id);

    if (finished?.status !== "running") return;

    if (finished.waiting > 0 && finished.pass < MAX_PASSES) {
      moves.repeat({ moveId: move.id, nextAttemptAt: iso(backoff(finished.pass - 1)) });

      return;
    }

    sourceFailures.delete(move.id);
    moves.finish({ moveId: move.id, status: "completed" });
  };

  const sweep = async () => {
    // Every item left at the start of a sweep was interrupted: items only exist while a sweep runs.
    for (const item of moves.listItems(100)) await settleItem(item);

    await Promise.all(
      moves.listDue({ now: iso(), limit: 16 }).map(async (move) => {
        try {
          await runMove(move);
        } catch (error) {
          console.warn("Original move failed", error);
        }
      }),
    );
  };

  return {
    run: () => {
      activeRun ??= sweep().finally(() => {
        activeRun = null;
      });

      return activeRun;
    },
  };
}

/**
 * Reads exactly `expectedSize` bytes. A stalled read is cancelled at the deadline, so it can't keep a
 * connection and buffer after the mover has moved on, and a short body is an error, never a smaller original.
 */
export async function readBody(
  stream: ReadableStream<Uint8Array>,
  { expectedSize, deadlineMs = BODY_DEADLINE_MS }: { expectedSize: number; deadlineMs?: number },
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const body = new Uint8Array(expectedSize);
  let received = 0;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel(new Error("Reading the original timed out")).catch(() => undefined);
  }, deadlineMs);

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (timedOut) throw new Error("Reading the original timed out");

      if (done) break;

      if (received + value.byteLength > expectedSize) throw new Error("The original is larger than its storage reported");
      body.set(value, received);
      received += value.byteLength;
    }

    if (received !== expectedSize) throw new Error("The original ended before its reported size");

    return body;
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Counting semaphores per destination plus one overall. All of an original's slots are taken at once, so moves can't deadlock. */
function createSlots() {
  const active = new Map<string, number>();
  const waiters: Array<() => void> = [];

  const free = (keys: string[]) =>
    (active.get("*") ?? 0) < GLOBAL_LIMIT && keys.every((key) => (active.get(key) ?? 0) < PER_DESTINATION_LIMIT);

  return {
    async with<T>(destinations: string[], work: () => Promise<T>): Promise<T> {
      const keys = [...new Set(destinations)].sort();

      while (!free(keys)) await new Promise<void>((resolve) => waiters.push(resolve));

      for (const key of [...keys, "*"]) active.set(key, (active.get(key) ?? 0) + 1);

      try {
        return await work();
      } finally {
        for (const key of [...keys, "*"]) active.set(key, active.get(key)! - 1);

        for (const wake of waiters.splice(0)) wake();
      }
    },
  };
}
