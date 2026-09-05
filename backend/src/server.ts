import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getModelPreparationSnapshot } from "./consumer/modelGateway";
import { DEFAULT_MAX_SOURCE_FILE_BYTES, createLocalApplication } from "./localApplication";
import { createLocalAuthRuntime } from "./localAuthRuntime";
import { localDocumentRequestBodyLimit, localDocumentServerBodyLimit } from "./localDocumentBodyLimit";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY } from "./localLiveUpdatePolicy";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";
import { registerLocalMemoryPressureListener } from "./localMemoryPressure";
import { localMemoryLimits } from "./localMemoryLimits";
import { retireGlobalModelConfiguration } from "./retireGlobalModelConfiguration";
import { createLocalProductAnalytics } from "./localProductAnalytics";
import { createLocalResourceController } from "./localResourceController";
import { createLocalRuntimeFetchHandler, ensureLocalStateDirectories } from "./localRuntime";
import { createLocalRuntimeRequestDrain } from "./localRuntimeRequestDrain";
import { readLocalRuntimePort } from "./localRuntimePort";
import { createLocalRuntimeShutdown } from "./localRuntimeShutdown";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSubmissionAdmission } from "./localSubmissionAdmission";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetsDirectory = process.env.DOCUMENT_EXTRACTION_ASSETS_DIR || resolve(repositoryRoot, "frontend", "dist");
const stateDirectory = process.env.DOCUMENT_EXTRACTION_STATE_DIR || resolve(repositoryRoot, ".local");
const port = readLocalRuntimePort(process.env.PORT);
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
  60_000,
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
const memoryPressureLargeSubmissionBytes = readPositiveInteger(
  process.env.MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES,
  "MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES",
  4 * 1024 * 1024,
);
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
const shutdownTimeoutMs = readPositiveInteger(
  process.env.LOCAL_SHUTDOWN_TIMEOUT_MS,
  "LOCAL_SHUTDOWN_TIMEOUT_MS",
  10_000,
);
const bun = (globalThis as typeof globalThis & { Bun?: typeof Bun }).Bun;

if (!bun) {
  throw new Error("The local server must run with Bun.");
}

await ensureLocalStateDirectories(stateDirectory);

let runtimeReady = false;
const server = bun.serve<{ workspaceId: string }>({
  fetch: async (request, bunServer) => {
    if (!runtimeReady) {
      return Response.json(
        { error: { code: "runtime_starting", message: "Local Bun Runtime is starting" } },
        { status: 503, headers: { "retry-after": "1" } },
      );
    }
    if (request.method === "POST" && new URL(request.url).pathname === "/v1/extract") {
      return localSubmissionAdmission.run(request, () => runtimeFetch(request));
    }
    return localRuntimeRequestDrain.run(() => {
      if (isWorkspaceLiveUpdatePath(request)) {
        return upgradeLocalLiveUpdate({
          auth: localAuth.auth,
          request,
          server: bunServer,
          workspaceControl: localAuth.workspaceControl,
        });
      }
      return runtimeFetch(request);
    });
  },
  hostname: "127.0.0.1",
  maxRequestBodySize: localDocumentServerBodyLimit(maxSourceFileBytes),
  port,
  websocket: {
    ...LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY,
    close: (socket) => {
      if (!runtimeReady) return;
      const workspaceId = socket.data?.workspaceId;
      if (workspaceId) {
        localLiveUpdateHub.unsubscribe({ workspaceId, socket });
      }
    },
    drain: (socket) => {
      localLiveUpdateHub.drain(socket);
    },
    open: (socket) => {
      if (!runtimeReady) return;
      const workspaceId = socket.data?.workspaceId;
      if (workspaceId) {
        localLiveUpdateHub.subscribe({ workspaceId, socket });
      }
    },
    message: (socket) => {
      socket.close(1008, "Workspace live updates are receive-only");
    },
  },
});
const serverOrigin = `http://127.0.0.1:${server.port}`;

const localAuth = await createLocalAuthRuntime({
  adminEmails: (process.env.DOCUMENT_EXTRACTION_ADMIN_EMAILS || "").split(","),
  baseURL: process.env.BETTER_AUTH_URL || serverOrigin,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  stateDirectory,
});
const localExtractionQueue = createLocalExtractionQueue({
  maxBuffered: extractionMaxBuffered,
  maxConcurrent: extractionMaxConcurrency,
  getWorkspaceMaxConcurrent: (workspaceId) => {
    try {
      const lease = localProductStoreRegistry.acquire({ workspaceId, mode: "existing" });
      if (!lease) return 1;
      try { return lease.store.getModelConfiguration()?.sequential_calls ? 1 : Number.MAX_SAFE_INTEGER; }
      finally { lease.release(); }
    } catch { return 1; }
  },
  onWorkspaceIdle: (workspaceId) => refillExtraction(workspaceId),
  onCapacityAvailable: () => refillExtraction(),
});
const localLiveUpdateHub = createLocalLiveUpdateHub();
const localProductAnalytics = createLocalProductAnalytics({ stateDirectory });
const localWorkspaceProductOperations = createLocalWorkspaceProductOperations();
const localProductStoreRegistry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
const localSourceFiles = createLocalSourceFileStore({ stateDirectory });
const localResourceController = createLocalResourceController({
  adaptive: extractionAdaptiveConcurrency,
  cpuLimitRatio: localCpuLimitRatio,
  diskReserveBytes: localDiskReserveBytes,
  evictIdleStores: localProductStoreRegistry.evictIdleStores,
  getQueueSnapshot: localExtractionQueue.snapshot,
  initialPermits: extractionMaxConcurrency,
  maximumPermits: extractionMaximumConcurrency,
  memoryLimitRatio: localMemoryLimits.memoryLimitRatio,
  memoryPressureLargeSubmissionBytes,
  setPermits: localExtractionQueue.setMaxConcurrent,
  stateDirectory,
});
const removeMemoryPressureListener = registerLocalMemoryPressureListener({
  onPressure: localResourceController.handleMemoryPressure,
});
const localSubmissionAdmission = createLocalSubmissionAdmission({
  canReserve: localResourceController.canReserveSubmission,
  maxConcurrent: submissionMaxConcurrency,
  maxReservedBytes: submissionMaxReservedBytes,
  unknownRequestBytes: localDocumentRequestBodyLimit(maxSourceFileBytes),
});
const localRuntimeRequestDrain = createLocalRuntimeRequestDrain();
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
  modelGatewayRequestTimeoutMs: process.env.MODEL_GATEWAY_REQUEST_TIMEOUT_MS,
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
const extractionRefills = new Set<Promise<void>>();
function refillExtraction(workspaceId?: string): Promise<void> {
  if (!localExtractionQueue.snapshot().accepting) return Promise.resolve();
  const refill = localExtractionRunner.recover(workspaceId).finally(() => extractionRefills.delete(refill));
  extractionRefills.add(refill);
  return refill;
}
await retireGlobalModelConfiguration(stateDirectory);
await localExtractionRunner.recover();
localResourceController.start();
const recurringWork = new Set<Promise<void>>();
const runRecurringWork = (description: string, work: () => Promise<void>) => {
  const tracked = work()
    .catch((error) => {
      console.error(`${description} failed`, error);
    })
    .finally(() => {
      recurringWork.delete(tracked);
    });
  recurringWork.add(tracked);
};
runRecurringWork("Local Source retention sweep", localSourceFileRetention.run);
const extractionReconcileTimer = setInterval(() => {
  runRecurringWork("Local extraction reconciliation", localExtractionRunner.recover);
}, extractionReconcileIntervalMs);
const sourceRetentionTimer = setInterval(() => {
  runRecurringWork("Local Source retention sweep", localSourceFileRetention.run);
}, sourceRetentionSweepIntervalMs);
const application = createLocalApplication({
  auth: localAuth.auth,
  diagnostics: () => ({
    admission: localSubmissionAdmission.snapshot(),
    extractionQueue: localExtractionQueue.snapshot(),
    modelPreparation: getModelPreparationSnapshot(),
    liveUpdates: {
      ...localLiveUpdateHub.diagnostics(),
      runtimePendingWebSockets: server.pendingWebSockets,
    },
    productStores: localProductStoreRegistry.diagnostics(),
    resources: localResourceController.snapshot(),
    runtime: {
      bunRevision: bun.revision,
      bunVersion: bun.version,
      nodeVersion: process.versions.node,
    },
    sourceRetention: localSourceFileRetention.snapshot(),
  }),
  liveUpdateHub: localLiveUpdateHub,
  maxSourceFileBytes,
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

runtimeReady = true;
console.log(`LOCAL_RUNTIME_READY ${JSON.stringify({ origin: serverOrigin })}`);

const runtimeShutdown = createLocalRuntimeShutdown({
  closeAdmission: async () => {
    const admissionClosed = localSubmissionAdmission.close();
    const requestsClosed = localRuntimeRequestDrain.close();
    await Promise.all([admissionClosed, requestsClosed]);
  },
  closeAuth: localAuth.close,
  closeProductStores: localProductStoreRegistry.closeAll,
  closeQueue: localExtractionQueue.close,
  flushAnalytics: localProductAnalytics.flush,
  forceAfterMs: shutdownTimeoutMs,
  stopRecurringWork: async () => {
    clearInterval(extractionReconcileTimer);
    clearInterval(sourceRetentionTimer);
    removeMemoryPressureListener();
    localResourceController.stop();
    await Promise.all([...recurringWork, ...extractionRefills]);
  },
  stopServer: (force) => {
    if (force) localLiveUpdateHub.closeAll();
    return server.stop(force);
  },
});
let shutdownObserved = false;
const requestShutdown = () => {
  const completion = runtimeShutdown.request();
  if (shutdownObserved) return;
  shutdownObserved = true;
  console.log("Stopping Local Bun Runtime; finishing active work (Ctrl+C again to force).");
  void completion.then(
    () => {
      console.log("Local Bun Runtime stopped.");
      // Bun's --watch keeps the event loop alive after the server and stores close.
      process.exit(process.exitCode ?? 0);
    },
    (error) => {
      console.error("Local Bun Runtime shutdown failed", error);
      process.exit(1);
    },
  );
};
process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);
process.once("beforeExit", requestShutdown);

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
