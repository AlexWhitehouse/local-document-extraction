import {
  LocalWorkspaceOperationError,
  type LocalWorkspaceProductOperation,
  type LocalWorkspaceProductOperations,
} from "./localWorkspaceProductOperations";
import {
  LocalWorkspaceProductStoreRegistryError,
  type LocalWorkspaceProductStoreHandle,
  type LocalWorkspaceProductStoreLease,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";

type AccessFailure =
  | "workspace_deleting"
  | "job_deleting"
  | "capacity_exhausted"
  | "workspace_invalidated"
  | "store_unavailable"
  | "unexpected";

/** Only failures to acquire access are translated; callback errors pass through. */
export class LocalWorkspaceProductDataAccessError extends Error {
  constructor(public readonly code: AccessFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalWorkspaceProductDataAccessError";
  }
}

type AccessScope = { workspaceId: string; jobId?: string; mode: "create" | "existing" };
type AccessContext<Store> = { store: Store; signal: AbortSignal };

export type LocalWorkspaceProductDataAccess = {
  run<T>(
    scope: AccessScope & { mode: "create" },
    work: (context: AccessContext<LocalWorkspaceProductStoreHandle>) => T | Promise<T>,
  ): Promise<T>;
  run<T>(
    scope: AccessScope,
    work: (context: AccessContext<LocalWorkspaceProductStoreHandle | null>) => T | Promise<T>,
  ): Promise<T>;
};

/**
 * The store and signal belong to the callback's lifetime. Await all work using
 * them before returning; cancellation does not release a still-running callback.
 * Existing-only access admits the callback even when no product store exists.
 */
export function createLocalWorkspaceProductDataAccess({
  operations,
  registry,
}: {
  operations: LocalWorkspaceProductOperations;
  registry: LocalWorkspaceProductStoreRegistry;
}): LocalWorkspaceProductDataAccess {
  async function run<T>(
    scope: AccessScope,
    work: (context: AccessContext<LocalWorkspaceProductStoreHandle | null>) => T | Promise<T>,
  ): Promise<T> {
    let operation: LocalWorkspaceProductOperation | undefined;
    let lease: LocalWorkspaceProductStoreLease | null = null;
    let failed = false;
    try {
      try {
        operation = operations.acquire({ workspaceId: scope.workspaceId, jobId: scope.jobId });
        lease = registry.acquire({ workspaceId: scope.workspaceId, mode: scope.mode });
      } catch (cause) {
        if (cause instanceof LocalWorkspaceOperationError || cause instanceof LocalWorkspaceProductStoreRegistryError) {
          throw new LocalWorkspaceProductDataAccessError(cause.code, cause.message, { cause });
        }
        throw new LocalWorkspaceProductDataAccessError("unexpected", "Workspace product data access failed", { cause });
      }
      if (!lease && scope.mode === "create") {
        throw new LocalWorkspaceProductDataAccessError("store_unavailable", "Local Workspace product storage is unavailable.");
      }
      return await work({ store: lease?.store ?? null, signal: operation.signal });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      releaseAccess(lease, operation, failed);
    }
  }

  // The create-mode guard above supplies the stronger store type of that overload.
  return { run } as LocalWorkspaceProductDataAccess;
}

function releaseAccess(
  lease: LocalWorkspaceProductStoreLease | null,
  operation: LocalWorkspaceProductOperation | undefined,
  failed: boolean,
): void {
  try {
    try {
      lease?.release();
    } finally {
      operation?.release();
    }
  } catch (error) {
    // Preserve the original acquisition/callback failure if cleanup also fails.
    if (!failed) throw error;
  }
}
