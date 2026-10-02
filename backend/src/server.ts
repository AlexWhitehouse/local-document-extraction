import { createLocalEvaluations, EVALUATION_METADATA_BYTES } from "./localEvaluations";
import { createLocalEvaluationDocuments } from "./localEvaluationDocuments";
import { getModelPreparationSnapshot } from "./consumer/modelGateway";
import { createLocalSourceObjectCleanup } from "./localSourceObjectCleanup";
import { createS3SourceObjectStore, evaluationDocumentObjectKey, retainedObjectKey, sourceObjectDestination } from "./s3SourceObjectStore";
import { createLocalApplication } from "./localApplication";
import { localBrowserOrigin, readLocalConfiguration, publicLocalConfiguration } from "./localConfiguration";
import { createLocalAuthRuntime } from "./localAuthRuntime";
import { setLocalAuthRequestPeerAddress } from "./localAuthClientAddress";
import { localDocumentRequestBodyLimit, localDocumentServerBodyLimit } from "./localDocumentBodyLimit";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY } from "./localLiveUpdatePolicy";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";
import { registerLocalMemoryPressureListener } from "./localMemoryPressure";
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
  extractionAdaptiveConcurrency, extractionMaximumConcurrency, localCpuLimitRatio, localMemoryLimitRatio,
  memoryPressureLargeSubmissionBytes, localDiskReserveBytes,
  sourceRetentionSweepIntervalMs, failedSourceRetentionMs, shutdownTimeoutMs,
} = configuration;
const LONG_RUNNING_SUBMISSION_PATHS = ["/v1/templates/generate", "/v1/templates/assist", "/v1/evaluations/run"];
// Library saves stream one original, so they share upload admission with other submissions.
const SUBMISSION_PATHS = ["/v1/extract", "/v1/evaluations/documents", ...LONG_RUNNING_SUBMISSION_PATHS];

await ensureLocalStateDirectories(stateDirectory);

let runtimeReady = false;
const server = Bun.serve<{ workspaceId: string }>({
  fetch: async (request, bunServer) => {
    if (!runtimeReady) {
      return Response.json(
        { error: { code: "runtime_starting", message: "Local Bun Runtime is starting" } },
        { status: 503, headers: { "retry-after": "1" } },
      );
    }
    setLocalAuthRequestPeerAddress(request, bunServer.requestIP(request)?.address);
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/v1/config") {
      return Response.json(publicLocalConfiguration(configuration), { headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST" && SUBMISSION_PATHS.includes(pathname)) {
      // Model-backed generation and evaluation can outlast Bun's idle timeout.
      if (LONG_RUNNING_SUBMISSION_PATHS.includes(pathname)) bunServer.timeout(request, 0);
      return localSubmissionAdmission.run(request, () => runtimeFetch(request));
    }
    return localRuntimeRequestDrain.run(() => {
      if (/^\/v1\/workspaces\/[^/]+\/live$/.test(pathname)) {
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
  maxRequestBodySize: Math.max(localDocumentServerBodyLimit(maxSourceFileBytes), maxSourceFileBytes + EVALUATION_METADATA_BYTES, maxJsonRequestBytes),
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
const serverOrigin = localBrowserOrigin(configuration.host, server.port!);

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
  memoryLimitRatio: localMemoryLimitRatio,
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
  unknownRequestBytes: Math.max(localDocumentRequestBodyLimit(maxSourceFileBytes), maxSourceFileBytes + EVALUATION_METADATA_BYTES),
});
const localRuntimeRequestDrain = createLocalRuntimeRequestDrain();
const sourceObjectManifest = localAuth.sourceObjectManifest;
const s3SourceStorage = configuration.sourceStorage.s3;
// An illegal destination change is a configuration error, unlike a storage outage: refuse to start.
sourceObjectManifest.assertDestination(s3SourceStorage ? sourceObjectDestination(s3SourceStorage) : null);
const sourceObjectStore = s3SourceStorage ? createS3SourceObjectStore(s3SourceStorage) : null;
const retainedSourceObjects = s3SourceStorage && sourceObjectStore ? (() => {
  const namespace = sourceObjectManifest.namespace();
  return {
    store: sourceObjectStore,
    manifest: sourceObjectManifest,
    keyFor: (input: { workspaceId: string; jobId: string; mimeType: string; ownerKind?: "job" | "packet" }) =>
      retainedObjectKey({ prefix: s3SourceStorage.prefix, namespace, ...input }),
    documentKeyFor: (input: { workspaceId: string; documentId: string; mimeType: string }) =>
      evaluationDocumentObjectKey({ prefix: s3SourceStorage.prefix, namespace, ...input }),
  };
})() : undefined;
const sourceObjectCleanup = sourceObjectStore ? createLocalSourceObjectCleanup({
  manifest: sourceObjectManifest,
  objectStore: sourceObjectStore,
  productStoreRegistry: localProductStoreRegistry,
  workspaceControl: localAuth.workspaceControl,
}) : null;
const localSourceFileRetention = createLocalSourceFileRetention({
  failedSourceRetentionMs,
  productStoreRegistry: localProductStoreRegistry,
  releaseRetainedObject: ({ workspaceId, jobId }) => sourceObjectManifest.markJobDeleting({ workspaceId, jobId }),
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
  sourceObjectManifest,
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
  sourceObjects: retainedSourceObjects,
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
const localEvaluationDocuments = createLocalEvaluationDocuments({
  auth: localAuth.auth,
  workspaceControl: localAuth.workspaceControl,
  productStoreRegistry: localProductStoreRegistry,
  operations: localWorkspaceProductOperations,
  sourceFileStore: localSourceFiles,
  sourceStorage: configuration.sourceStorage,
  sourceObjects: retainedSourceObjects && { ...retainedSourceObjects, keyFor: retainedSourceObjects.documentKeyFor },
  stateDirectory,
  liveUpdateHub: localLiveUpdateHub,
  maxSourceFileBytes,
});
runRecurringWork("Local Source retention sweep", localSourceFileRetention.run);
runRecurringWork("Evaluation library cleanup", localEvaluationDocuments.sweep);
const extractionReconcileTimer = setInterval(() => {
  runRecurringWork("Local extraction reconciliation", localExtractionRunner.recover);
}, extractionReconcileIntervalMs);
const sourceRetentionTimer = setInterval(() => {
  runRecurringWork("Local Source retention sweep", localSourceFileRetention.run);
  runRecurringWork("Evaluation library cleanup", localEvaluationDocuments.sweep);
}, sourceRetentionSweepIntervalMs);
// Remote cleanup runs in the background and never blocks startup, uploads or deletion responses.
if (sourceObjectCleanup) runRecurringWork("Retained object cleanup", sourceObjectCleanup.run);
const sourceObjectCleanupTimer = sourceObjectCleanup ? setInterval(() => {
  runRecurringWork("Retained object cleanup", sourceObjectCleanup.run);
}, 60_000) : null;
const localEvaluations = createLocalEvaluations({
  auth: localAuth.auth, workspaceControl: localAuth.workspaceControl, productStoreRegistry: localProductStoreRegistry,
  stateDirectory, queue: localExtractionQueue, maxSourceFileBytes, requestTimeoutMs: configuration.modelGatewayRequestTimeoutMs,
  retryDelayMs: extractionRetryDelayMs, onGatewayOutcome: localResourceController.recordGatewayOutcome,
  libraryDocuments: localEvaluationDocuments.sources,
});
const application = createLocalApplication({
  evaluationDocuments: localEvaluationDocuments,
  evaluations: localEvaluations,
  modelGatewayRequestTimeoutMs: String(configuration.modelGatewayRequestTimeoutMs),
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
      bunRevision: Bun.revision,
      bunVersion: Bun.version,
      nodeVersion: process.versions.node,
    },
    sourceRetention: localSourceFileRetention.snapshot(),
    evaluationDocuments: localEvaluationDocuments.snapshot(),
    ...(sourceObjectCleanup ? { retainedObjects: sourceObjectCleanup.snapshot() } : {}),
  }),
  liveUpdateHub: localLiveUpdateHub,
  maxSourceFileBytes,
  maxJsonRequestBytes,
  productAnalytics: localProductAnalytics,
  scheduleQueuedJob: localExtractionQueue.schedule,
  sourceFileStore: localSourceFiles,
  sourceStorage: configuration.sourceStorage,
  sourceObjects: retainedSourceObjects,
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
    localEvaluations.close();
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
    if (sourceObjectCleanupTimer) clearInterval(sourceObjectCleanupTimer);
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
