import { HttpError } from "./lib/http";
import type { S3SourceStorageLocation } from "./localConfiguration";
import { INSTALLATION_DESTINATION_ID, type LocalSourceObjectManifest } from "./localSourceObjectManifest";
import {
  SourceObjectMoveRunningError,
  type LocalSourceObjectMoves,
  type SourceObjectMove,
} from "./localSourceObjectMoves";
import type { HeldRetainedObjectDestination } from "./localRetainedSourceObjectRouting";
import type { LocalSourceStorageDestinations } from "./localSourceStorageDestinations";
import type { LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import type { SourceObjectStore } from "./s3SourceObjectStore";

const noStore = { "cache-control": "no-store" };

const LOCAL_LOCATION_ID = "local";

const FAILURE_LIMIT = 20;

const FAILURE_KINDS = { job: "document", packet: "packet", evaluation_document: "library_document" } as const;

type LocationKind = "local" | "installation_bucket" | "workspace_bucket";

type Location = {
  id: string;
  kind: LocationKind;
  is_target: boolean;
  retired: boolean;
  bucket: string | null;
  prefix: string | null;
  endpoint: string | null;
  originals: number;
  bytes: number;
  unknown_size: number;
};

export type WorkspaceSourceObjectMoveHttp = {
  handle(input: { request: Request; workspaceId: string; userId: string }): Response;
};

/**
 * Where a Workspace's retained originals are held, and the move that gathers them into its current
 * location. Callers check the owner or admin role first.
 */
export function createWorkspaceSourceObjectMoveHttp({
  moves,
  manifest,
  destinations,
  sourceObjects,
  installation,
  productStoreRegistry,
  onStarted,
}: {
  moves: LocalSourceObjectMoves;
  manifest: Pick<LocalSourceObjectManifest, "usageByDestination">;
  destinations: Pick<LocalSourceStorageDestinations, "get">;
  sourceObjects: {
    destinationFor(workspaceId: string): HeldRetainedObjectDestination | null;
    /** Throws when the destination's credentials can't be read. */
    storeFor(destinationId: string): Pick<SourceObjectStore, "open">;
  };
  /** The installation's own bucket, if it has one. */
  installation: S3SourceStorageLocation | undefined;
  productStoreRegistry: {
    acquire(input: { workspaceId: string; mode: "existing" }): {
      store: Pick<LocalWorkspaceProductStore, "countLocalRetainedOriginals">;
      release(): void;
    } | null;
  };
  /** Wakes the mover so a new move starts without waiting for the next sweep. */
  onStarted?: () => void;
}): WorkspaceSourceObjectMoveHttp {
  const localOriginals = (workspaceId: string) => {
    const lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });

    if (!lease) return 0;

    try {
      return lease.store.countLocalRetainedOriginals();
    } finally {
      lease.release();
    }
  };

  const describe = (workspaceId: string) => {
    const target = sourceObjects.destinationFor(workspaceId);

    // Only the target's ID is needed; nothing is written here, so the upload hold goes straight back.
    target?.release();
    let unavailableReason: "no_remote_storage" | "credentials_unavailable" | null = target ? null : "no_remote_storage";

    if (target) {
      try {
        sourceObjects.storeFor(target.id);
      } catch {
        unavailableReason = "credentials_unavailable";
      }
    }

    const locations: Location[] = [];

    for (const [id, usage] of manifest.usageByDestination(workspaceId)) {
      const where = describeDestination(id);

      if (where)
        locations.push({
          id,
          ...where,
          is_target: id === target?.id,
          originals: usage.originals,
          bytes: usage.bytes,
          unknown_size: usage.unknownSize,
        });
    }

    const local = localOriginals(workspaceId);

    if (local > 0)
      locations.push({
        id: LOCAL_LOCATION_ID,
        kind: "local",
        is_target: false,
        retired: false,
        bucket: null,
        prefix: null,
        endpoint: null,
        originals: local,
        bytes: 0,
        unknown_size: local,
      });

    if (target && !locations.some((location) => location.is_target)) {
      const where = describeDestination(target.id);

      if (where)
        locations.push({ id: target.id, ...where, is_target: true, originals: 0, bytes: 0, unknown_size: 0 });
    }

    locations.sort((a, b) => locationRank(a) - locationRank(b));
    const latest = moves.latest(workspaceId);

    return {
      workspace_id: workspaceId,
      target: target ? publicTarget(target.id) : null,
      unavailable_reason: unavailableReason,
      locations,
      movable: locations.reduce((sum, location) => sum + (location.is_target ? 0 : location.originals), 0),
      move: latest ? publicMove(latest) : null,
    };
  };

  const describeDestination = (id: string) => {
    if (id === INSTALLATION_DESTINATION_ID) {
      if (!installation) return null;

      return { kind: "installation_bucket" as const, retired: false, ...publicLocation(installation) };
    }

    const destination = destinations.get(id);

    return destination
      ? {
          kind: "workspace_bucket" as const,
          retired: destination.retiredAt !== null,
          ...publicLocation(destination.location),
        }
      : null;
  };

  const publicTarget = (id: string) => {
    const where = describeDestination(id);

    return where && { id, kind: where.kind, bucket: where.bucket, prefix: where.prefix, endpoint: where.endpoint };
  };

  const publicMove = (move: SourceObjectMove) => ({
    id: move.id,
    status: move.status,
    target_id: move.target_id,
    started_at: move.started_at,
    finished_at: move.finished_at,
    total: move.total,
    moved: move.moved,
    bytes_moved: move.bytes_moved,
    failed: move.failed,
    waiting: move.waiting,
    next_attempt_at: move.status === "running" && move.attempts > 0 ? move.next_attempt_at : null,
    message: move.message,
    failures: moves.failures(move.id, FAILURE_LIMIT).map((failure) => ({
      kind: FAILURE_KINDS[failure.owner_kind],
      id: failure.owner_id,
      name: failure.name,
      message: failure.message,
    })),
  });

  return {
    handle({ request, workspaceId, userId }) {
      if (request.method === "GET") return Response.json(describe(workspaceId), { headers: noStore });

      if (request.method === "POST") {
        const summary = describe(workspaceId);

        if (summary.unavailable_reason)
          throw new HttpError(
            409,
            "source_storage_move_unavailable",
            summary.unavailable_reason === "credentials_unavailable"
              ? "The saved access keys for this Workspace's bucket can't be read. Enter them again, then start the move."
              : "There's no bucket to move originals into. Moving originals into the installation's data folder isn't supported.",
          );

        if (summary.move?.status === "running") throw moveRunning();

        if (summary.movable === 0)
          throw new HttpError(
            409,
            "source_storage_move_nothing_to_move",
            "Every original is already in the current location.",
          );

        try {
          moves.start({ workspaceId, targetId: summary.target!.id, total: summary.movable, userId });
        } catch (error) {
          if (error instanceof SourceObjectMoveRunningError) throw moveRunning();
          throw error;
        }

        onStarted?.();

        return Response.json(describe(workspaceId), { status: 202, headers: noStore });
      }

      if (request.method === "DELETE") {
        if (!moves.cancel(workspaceId))
          throw new HttpError(409, "source_storage_move_not_running", "No move is running.");

        return Response.json(describe(workspaceId), { headers: noStore });
      }

      return Response.json(
        { error: { code: "method_not_allowed", message: "Method not allowed" } },
        { status: 405, headers: { ...noStore, allow: "GET, POST, DELETE" } },
      );
    },
  };
}

function moveRunning() {
  return new HttpError(409, "source_storage_move_running", "A move is already running for this Workspace.");
}

function publicLocation(location: S3SourceStorageLocation) {
  return { bucket: location.bucket, prefix: location.prefix, endpoint: location.endpoint ?? null };
}

/** The target first, then other Workspace buckets, the installation bucket, and the data folder. */
function locationRank(location: Location): number {
  if (location.is_target) return 0;

  return { workspace_bucket: 1, installation_bucket: 2, local: 3 }[location.kind];
}
