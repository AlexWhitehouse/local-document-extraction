import { getModelPreparationSnapshot } from "./consumer/modelGateway";
import { createLocalApplication } from "./localApplication";
import { readLocalConfiguration, publicLocalConfiguration } from "./localConfiguration";
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
import { createLocalRuntimeShutdown } from "./localRuntimeShutdown";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSubmissionAdmission } from "./localSubmissionAdmission";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

const configuration = readLocalConfiguration();
const {
  assetsDirectory, stateDirectory, port, maxSourceFileBytes, maxJsonRequestBytes,
  extractionRetryDelayMs, extractionMaxConcurrency, extractionMaxBuffered,
  extractionReconcileIntervalMs, submissionMaxConcurrency, submissionMaxReservedBytes,
  extractionAdaptiveConcurrency, extractionMaximumConcurrency, localCpuLimitRatio,
  memoryPressureLargeSubmissionBytes, localDiskReserveBytes,
  sourceRetentionSweepIntervalMs, failedSourceRetentionMs, shutdownTimeoutMs,
} = configuration;
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
    if (request.method === "GET" && new URL(request.url).pathname === "/v1/config") {
      return Response.json(publicLocalConfiguration(configuration), { headers: { "cache-control": "no-store" } });
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
  hostname: configuration.host,
  maxRequestBodySize: Math.max(localDocumentServerBodyLimit(maxSourceFileBytes), maxJsonRequestBytes),
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
const browserHost = configuration.host === "0.0.0.0" ? "127.0.0.1" : configuration.host === "::" ? "[::1]" : configuration.host.includes(":") ? `[${configuration.host}]` : configuration.host;
const serverOrigin = `http://${browserHost}:${server.port}`;

const localAuth = await createLocalAuthRuntime({
  ...configuration.auth,
  baseURL: configuration.auth.baseURL || serverOrigin,
  email: configuration.email,
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
const localProductAnalytics = configuration.analyticsEnabled ? createLocalProductAnalytics({ stateDirectory }) : undefined;
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
  modelGatewayRequestTimeoutMs: String(configuration.modelGatewayRequestTimeoutMs),
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
  maxJsonRequestBytes,
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
  flushAnalytics: () => localProductAnalytics?.flush() ?? Promise.resolve(),
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

function isWorkspaceLiveUpdatePath(request: Request): boolean {
  return /^\/v1\/workspaces\/[^/]+\/live$/.test(new URL(request.url).pathname);
}
