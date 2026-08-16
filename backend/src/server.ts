import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_MAX_SOURCE_FILE_BYTES, createLocalApplication } from "./localApplication";
import { createLocalAuthRuntime } from "./localAuthRuntime";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";
import { createLocalModelSettings } from "./localModelSettings";
import { createLocalProductAnalytics } from "./localProductAnalytics";
import { createLocalResourceController } from "./localResourceController";
import { createLocalRuntimeFetchHandler, ensureLocalStateDirectories } from "./localRuntime";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSubmissionAdmission } from "./localSubmissionAdmission";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

type BunServer = {
  port: number;
  stop(closeActiveConnections?: boolean): void;
  upgrade(request: Request, options: { data: { workspaceId: string } }): boolean;
};

type BunLiveSocket = {
  data: { workspaceId: string };
  send(message: string): void;
};

type BunRuntime = {
  serve(options: {
    fetch(request: Request, server: BunServer): Response | Promise<Response | undefined> | undefined;
    hostname: string;
    port: number;
    websocket: {
      close(socket: BunLiveSocket): void;
      message(socket: BunLiveSocket, message: string | Buffer): void;
      open(socket: BunLiveSocket): void;
    };
  }): BunServer;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetsDirectory = process.env.DOCUMENT_EXTRACTION_ASSETS_DIR || resolve(repositoryRoot, "frontend", "dist");
const stateDirectory = process.env.DOCUMENT_EXTRACTION_STATE_DIR || resolve(repositoryRoot, ".local");
const port = readPort(process.env.PORT);
const maxSourceFileBytes = readPositiveInteger(
  process.env.MAX_SOURCE_FILE_BYTES,
  "MAX_SOURCE_FILE_BYTES",
  DEFAULT_MAX_SOURCE_FILE_BYTES,
);
const extractionRetryDelayMs = readPositiveInteger(
  process.env.EXTRACTION_RETRY_DELAY_MS,
  "EXTRACTION_RETRY_DELAY_MS",
  1_000,
);
const extractionMaxConcurrency = readPositiveInteger(
  process.env.EXTRACTION_MAX_CONCURRENCY,
  "EXTRACTION_MAX_CONCURRENCY",
  8,
);
const extractionMaxBuffered = readPositiveInteger(
  process.env.EXTRACTION_MAX_BUFFERED,
  "EXTRACTION_MAX_BUFFERED",
  10_000,
);
const extractionReconcileIntervalMs = readPositiveInteger(
  process.env.EXTRACTION_RECONCILE_INTERVAL_MS,
  "EXTRACTION_RECONCILE_INTERVAL_MS",
  5_000,
);
const submissionMaxConcurrency = readPositiveInteger(
  process.env.SUBMISSION_MAX_CONCURRENCY,
  "SUBMISSION_MAX_CONCURRENCY",
  8,
);
const submissionMaxReservedBytes = readPositiveInteger(
  process.env.SUBMISSION_MAX_RESERVED_BYTES,
  "SUBMISSION_MAX_RESERVED_BYTES",
  128 * 1024 * 1024,
);
const extractionAdaptiveConcurrency = readBoolean(
  process.env.EXTRACTION_ADAPTIVE_CONCURRENCY,
  true,
);
const extractionMaximumConcurrency = readPositiveInteger(
  process.env.EXTRACTION_MAX_CONCURRENCY_LIMIT,
  "EXTRACTION_MAX_CONCURRENCY_LIMIT",
  32,
);
const localCpuLimitRatio = readRatio(process.env.LOCAL_CPU_LIMIT_RATIO, "LOCAL_CPU_LIMIT_RATIO", 0.85);
const localMemoryLimitRatio = readRatio(process.env.LOCAL_MEMORY_LIMIT_RATIO, "LOCAL_MEMORY_LIMIT_RATIO", 0.8);
const localDiskReserveBytes = readNonNegativeInteger(
  process.env.LOCAL_DISK_RESERVE_BYTES,
  "LOCAL_DISK_RESERVE_BYTES",
  1024 * 1024 * 1024,
);
const sourceRetentionSweepIntervalMs = readPositiveInteger(
  process.env.SOURCE_RETENTION_SWEEP_INTERVAL_MS,
  "SOURCE_RETENTION_SWEEP_INTERVAL_MS",
  60 * 60 * 1_000,
);
const failedSourceRetentionMs = readNonNegativeInteger(
  process.env.FAILED_SOURCE_RETENTION_MS,
  "FAILED_SOURCE_RETENTION_MS",
  7 * 24 * 60 * 60 * 1_000,
);

await ensureLocalStateDirectories(stateDirectory);

const localAuth = await createLocalAuthRuntime({
  adminEmails: (process.env.DOCUMENT_EXTRACTION_ADMIN_EMAILS || "").split(","),
  baseURL: process.env.BETTER_AUTH_URL || `http://127.0.0.1:${port}`,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  stateDirectory,
});
const localExtractionQueue = createLocalExtractionQueue({
  maxBuffered: extractionMaxBuffered,
  maxConcurrent: extractionMaxConcurrency,
});
const localLiveUpdateHub = createLocalLiveUpdateHub();
const localModelSettings = await createLocalModelSettings({ stateDirectory });
const localProductAnalytics = createLocalProductAnalytics({ stateDirectory });
const localWorkspaceProductOperations = createLocalWorkspaceProductOperations();
const localProductStoreRegistry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
const localSourceFiles = createLocalSourceFileStore({ stateDirectory });
const localResourceController = createLocalResourceController({
  adaptive: extractionAdaptiveConcurrency,
  cpuLimitRatio: localCpuLimitRatio,
  diskReserveBytes: localDiskReserveBytes,
  getQueueSnapshot: localExtractionQueue.snapshot,
  initialPermits: extractionMaxConcurrency,
  maximumPermits: extractionMaximumConcurrency,
  memoryLimitRatio: localMemoryLimitRatio,
  setPermits: localExtractionQueue.setMaxConcurrent,
  stateDirectory,
});
const localSubmissionAdmission = createLocalSubmissionAdmission({
  canReserve: localResourceController.canReserveSubmission,
  maxConcurrent: submissionMaxConcurrency,
  maxReservedBytes: submissionMaxReservedBytes,
  unknownRequestBytes: maxSourceFileBytes + 1024 * 1024,
});
const localSourceFileRetention = createLocalSourceFileRetention({
  failedSourceRetentionMs,
  productStoreRegistry: localProductStoreRegistry,
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
});
const localWorkspaceDeletion = createLocalWorkspaceDeletion({
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
  workspaceProductOperations: localWorkspaceProductOperations,
  productStoreRegistry: localProductStoreRegistry,
  onWorkspaceAccessRevoked: localLiveUpdateHub.broadcastWorkspaceContextInvalidation,
});
await localWorkspaceDeletion.reconcileInterruptedDeletions();
const localExtractionRunner = createLocalExtractionRunner({
  modelGatewayConfigurationProvider: localModelSettings.getConfiguration,
  onGatewayOutcome: localResourceController.recordGatewayOutcome,
  onJobLifecycleChange: (workspaceId, job) => {
    localLiveUpdateHub.broadcastJob(workspaceId, job);
    if (job.status === "completed") localResourceController.recordCompletedJob();
  },
  productAnalytics: localProductAnalytics,
  retryDelayMs: extractionRetryDelayMs,
  scheduleJob: localExtractionQueue.schedule,
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
  workspaceProductOperations: localWorkspaceProductOperations,
  productStoreRegistry: localProductStoreRegistry,
});
localExtractionQueue.subscribe((job) => localExtractionRunner.run(job));
await localExtractionRunner.recover();
localResourceController.start();
void localSourceFileRetention.run().catch((error) => {
  console.error("Local Source retention sweep failed", error);
});
const extractionReconcileTimer = setInterval(() => {
  void localExtractionRunner.recover().catch((error) => {
    console.error("Local extraction reconciliation failed", error);
  });
}, extractionReconcileIntervalMs);
const sourceRetentionTimer = setInterval(() => {
  void localSourceFileRetention.run().catch((error) => {
    console.error("Local Source retention sweep failed", error);
  });
}, sourceRetentionSweepIntervalMs);
const application = createLocalApplication({
  auth: localAuth.auth,
  diagnostics: () => ({
    admission: localSubmissionAdmission.snapshot(),
    extractionQueue: localExtractionQueue.snapshot(),
    productStores: localProductStoreRegistry.diagnostics(),
    resources: localResourceController.snapshot(),
    sourceRetention: localSourceFileRetention.snapshot(),
  }),
  liveUpdateHub: localLiveUpdateHub,
  maxSourceFileBytes,
  modelSettings: localModelSettings,
  productAnalytics: localProductAnalytics,
  scheduleQueuedJob: localExtractionQueue.schedule,
  sourceFileStore: localSourceFiles,
  stateDirectory,
  workspaceControl: localAuth.workspaceControl,
  workspaceDeletion: localWorkspaceDeletion,
  workspaceProductOperations: localWorkspaceProductOperations,
  productStoreRegistry: localProductStoreRegistry,
});
const runtimeFetch = createLocalRuntimeFetchHandler({
  api: application,
  assetsDirectory,
});
const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;

if (!bun) {
  throw new Error("The local server must run with Bun.");
}

const server = bun.serve({
  fetch: async (request, bunServer) => {
    if (isWorkspaceLiveUpdatePath(request)) {
      return upgradeLocalLiveUpdate({
        auth: localAuth.auth,
        request,
        server: bunServer as never,
        workspaceControl: localAuth.workspaceControl,
      });
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/v1/extract") {
      return localSubmissionAdmission.run(request, () => runtimeFetch(request));
    }
    return runtimeFetch(request);
  },
  hostname: "127.0.0.1",
  port,
  websocket: {
    close: (socket) => {
      const workspaceId = (socket.data as unknown as { workspaceId?: string } | undefined)?.workspaceId;
      if (workspaceId) {
        localLiveUpdateHub.unsubscribe({ workspaceId, socket });
      }
    },
    open: (socket) => {
      const workspaceId = (socket.data as unknown as { workspaceId?: string } | undefined)?.workspaceId;
      if (workspaceId) {
        localLiveUpdateHub.subscribe({ workspaceId, socket });
      }
    },
    message: () => {},
  },
});
console.log(`Document Extraction local server listening on http://127.0.0.1:${server.port}`);

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(extractionReconcileTimer);
  clearInterval(sourceRetentionTimer);
  localResourceController.stop();
  server.stop(false);
  localProductStoreRegistry.closeAll();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("beforeExit", shutdown);

function readPort(value: string | undefined): number {
  if (!value) {
    return 8787;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return parsed;
}

function readPositiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readNonNegativeInteger(value: string | undefined, name: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function readRatio(value: string | undefined, name: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`${name} must be greater than zero and no greater than one.`);
  }
  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isWorkspaceLiveUpdatePath(request: Request): boolean {
  return /^\/v1\/workspaces\/[^/]+\/live$/.test(new URL(request.url).pathname);
}
