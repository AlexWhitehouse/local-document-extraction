import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { LocalSourceFileStore } from "./localSourceFileStore";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

const DEFAULT_FAILED_SOURCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type LocalSourceFileRetentionSnapshot = {
  deleted: number;
  failures: number;
  lastCompletedAt: string | null;
  lastStartedAt: string | null;
  runs: number;
};

export type LocalSourceFileRetention = {
  run(): Promise<void>;
  snapshot(): LocalSourceFileRetentionSnapshot;
};

export function createLocalSourceFileRetention({
  batchSize = 500,
  failedSourceRetentionMs = DEFAULT_FAILED_SOURCE_RETENTION_MS,
  maxFilesPerRun = 5_000,
  now = Date.now,
  productStoreRegistry,
  sourceFileStore,
  stateDirectory,
  workspaceControl,
}: {
  batchSize?: number;
  failedSourceRetentionMs?: number;
  maxFilesPerRun?: number;
  now?: () => number;
  productStoreRegistry: LocalWorkspaceProductStoreRegistry;
  sourceFileStore: Pick<LocalSourceFileStore, "delete">;
  stateDirectory: string;
  workspaceControl?: Pick<LocalWorkspaceControl, "workspaceExists">;
}): LocalSourceFileRetention {
  const normalizedBatchSize = positiveInteger(batchSize, 500);
  const normalizedMaxFilesPerRun = positiveInteger(maxFilesPerRun, 5_000);
  const normalizedRetentionMs = Math.max(0, Math.trunc(failedSourceRetentionMs));
  let activeRun: Promise<void> | null = null;
  const snapshot: LocalSourceFileRetentionSnapshot = {
    deleted: 0,
    failures: 0,
    lastCompletedAt: null,
    lastStartedAt: null,
    runs: 0,
  };

  const sweep = async () => {
    const startedAt = now();
    snapshot.lastStartedAt = new Date(startedAt).toISOString();
    snapshot.runs += 1;
    const failedBefore = new Date(startedAt - normalizedRetentionMs).toISOString();
    const workspaceIds = await listLocalWorkspaceIds(stateDirectory);
    let visited = 0;

    for (const workspaceId of workspaceIds) {
      if (visited >= normalizedMaxFilesPerRun) break;
      if (workspaceControl && !workspaceControl.workspaceExists({ workspaceId })) continue;

      let lease;
      try {
        lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });
      } catch (error) {
        snapshot.failures += 1;
        console.warn("Local Source retention could not acquire Workspace storage", error);
        continue;
      }
      if (!lease) continue;

      try {
        while (visited < normalizedMaxFilesPerRun) {
          const due = lease.store.listRetainedTerminalSourceFiles({
            failedBefore,
            limit: Math.min(normalizedBatchSize, normalizedMaxFilesPerRun - visited),
          });
          if (due.length === 0) break;

          for (const source of due) {
            visited += 1;
            try {
              await sourceFileStore.delete(source.source_file_key);
              if (lease.store.markSourceFileCleaned({
                jobId: source.job_id,
                sourceFileKey: source.source_file_key,
                cleanedAt: new Date(now()).toISOString(),
              })) {
                snapshot.deleted += 1;
              }
            } catch (error) {
              snapshot.failures += 1;
              console.warn("Local retained Source file cleanup failed", error);
            }
          }

          if (due.length < normalizedBatchSize) break;
        }
      } finally {
        lease.release();
      }
    }
    snapshot.lastCompletedAt = new Date(now()).toISOString();
  };

  return {
    run: () => {
      if (activeRun) return activeRun;
      activeRun = sweep().finally(() => {
        activeRun = null;
      });
      return activeRun;
    },
    snapshot: () => ({ ...snapshot }),
  };
}

async function listLocalWorkspaceIds(stateDirectory: string): Promise<string[]> {
  const workspaceDirectory = join(stateDirectory, "data", "workspaces");
  const entries = await readdir(workspaceDirectory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => entry.name.slice(0, -".sqlite".length))
    .filter((workspaceId) => /^[a-zA-Z0-9_-]+$/.test(workspaceId));
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
