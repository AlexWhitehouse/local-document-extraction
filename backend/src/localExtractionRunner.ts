import type { LocalProcessingCapacity, LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { GoProcessingContext } from "./goProcessingSession";
import { EXTRACTION_MAX_ATTEMPTS } from "./extractionRetryPolicy";
import { nowIso } from "./lib/ids";
import type { LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import {
  createEphemeralLocalWorkspaceProductStoreRegistry,
  createLocalWorkspaceProductStoreRegistry,
  LocalWorkspaceProductStoreRegistryError,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductOperations, type LocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalWorkspaceProductDataAccess, LocalWorkspaceProductDataAccessError } from "./localWorkspaceProductDataAccess";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type LocalExtractionRunner = {
  recover(workspaceId?: string): Promise<void>;
  run(job: LocalQueuedExtractionJob, capacity?: LocalProcessingCapacity): Promise<void>;
};

/** Owns Workspace leases and recovery. The Go processor owns stage execution. */
export function createLocalExtractionRunner({
  execute,
  maxAttempts = EXTRACTION_MAX_ATTEMPTS,
  now = nowIso,
  productStoreOpener,
  productStoreRegistry,
  recoveryBatchSize = 1000,
  scheduleJob = async () => {},
  staleProcessingAfterMs = 5 * 60 * 1000,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
}: {
  execute: (context: GoProcessingContext) => Promise<void>;
  maxAttempts?: number;
  now?: () => string;
  productStoreOpener?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore | null;
  productStoreRegistry?: LocalWorkspaceProductStoreRegistry;
  recoveryBatchSize?: number;
  scheduleJob?: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  staleProcessingAfterMs?: number;
  stateDirectory: string;
  workspaceControl?: Pick<LocalWorkspaceControl, "workspaceExists">;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
}): LocalExtractionRunner {
  const localProductStoreRegistry =
    productStoreRegistry ??
    (productStoreOpener
      ? createEphemeralLocalWorkspaceProductStoreRegistry({
          stateDirectory,
          createStore: (input) => {
            const store = productStoreOpener(input);

            if (!store) throw new Error("Workspace product store does not exist");

            return store;
          },
          openStore: productStoreOpener,
        })
      : createLocalWorkspaceProductStoreRegistry({ stateDirectory }));

  const productDataAccess = createLocalWorkspaceProductDataAccess({
    registry: localProductStoreRegistry,
    operations: workspaceProductOperations ?? createLocalWorkspaceProductOperations(),
  });

  const normalizedRecoveryBatchSize =
    Number.isSafeInteger(recoveryBatchSize) && recoveryBatchSize > 0 ? recoveryBatchSize : 1000;

  const recoveries = new Map<string, Promise<void>>();
  const activeJobs = new Map<string, Set<string>>();

  const recover = async (targetWorkspaceId?: string) => {
    const workspaceIds = targetWorkspaceId ? [targetWorkspaceId] : await listLocalWorkspaceIds(stateDirectory);
    const recoveredAt = now();

    const staleProcessingBefore = new Date(Date.parse(recoveredAt) - Math.max(0, staleProcessingAfterMs)).toISOString();

    for (const workspaceId of workspaceIds) {
      if (!workspaceExists(workspaceControl, workspaceId)) continue;
      let productStoreLease;

      try {
        productStoreLease = localProductStoreRegistry.acquire({ workspaceId, mode: "existing" });
      } catch (error) {
        if (error instanceof LocalWorkspaceProductStoreRegistryError) continue;
        throw error;
      }

      if (!productStoreLease) continue;
      let recovered;
      let packets;

      try {
        recovered = productStoreLease.store.recoverExtractionJobs({
          limit: normalizedRecoveryBatchSize,
          maxAttempts,
          recoveredAt,
          staleProcessingBefore,
          isJobActive: (jobId) => activeJobs.get(workspaceId)?.has(jobId) ?? false,
        });
        packets = productStoreLease.store.recoverDocumentPackets({
          limit: normalizedRecoveryBatchSize,
          staleProcessingBefore,
          isJobActive: (packetId) => activeJobs.get(workspaceId)?.has(packetId) ?? false,
        });
      } finally {
        productStoreLease.release();
      }

      for (const job of [...recovered, ...packets]) {
        if (!workspaceExists(workspaceControl, workspaceId)) break;

        const scheduled: LocalQueuedExtractionJob = {
          job_id: job.job_id,
          workspace_id: workspaceId,
          template_id: job.template_id,
          template_version: job.template_version,
          enqueued_at: recoveredAt,
          attempt: job.attempt,
        };

        if ("not_before" in job) scheduled.not_before = job.not_before;

        if ("kind" in job) scheduled.kind = job.kind;
        await scheduleJob(scheduled);
      }
    }
  };

  return {
    recover: (workspaceId) => {
      const key = workspaceId ?? "*";
      const existing = recoveries.get(key);

      if (existing) return existing;

      const recovery = recover(workspaceId).finally(() => {
        recoveries.delete(key);
      });

      recoveries.set(key, recovery);

      return recovery;
    },
    run: async (job, capacity) => {
      if (!workspaceExists(workspaceControl, job.workspace_id)) return;
      const owned = activeJobs.get(job.workspace_id) ?? new Set<string>();

      if (owned.has(job.job_id)) return;
      owned.add(job.job_id);
      activeJobs.set(job.workspace_id, owned);

      return productDataAccess
        .run(
          { workspaceId: job.workspace_id, jobId: job.job_id, mode: "existing" },
          async ({ store: productStore, signal }) => {
            if (!productStore) return;

            const context: GoProcessingContext = { job, store: productStore, signal };

            if (capacity) context.capacity = capacity;

            await execute(context);
          },
        )
        .catch((error) => {
          if (error instanceof LocalWorkspaceProductDataAccessError) {
            if (error.code === "unexpected") throw error.cause;

            return;
          }

          throw error;
        })
        .finally(() => {
          owned.delete(job.job_id);

          if (owned.size === 0) activeJobs.delete(job.workspace_id);
        });
    },
  };
}

function workspaceExists(
  workspaceControl: Pick<LocalWorkspaceControl, "workspaceExists"> | undefined,
  workspaceId: string,
): boolean {
  return workspaceControl?.workspaceExists({ workspaceId }) ?? true;
}

async function listLocalWorkspaceIds(stateDirectory: string): Promise<string[]> {
  const workspaceDirectory = join(stateDirectory, "data", "workspaces");
  const entries = await readdir(workspaceDirectory, { withFileTypes: true }).catch(() => []);

  return entries.flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".sqlite")) return [];
    const workspaceId = entry.name.slice(0, -".sqlite".length);

    return /^[a-zA-Z0-9_-]+$/.test(workspaceId) ? [workspaceId] : [];
  });
}
