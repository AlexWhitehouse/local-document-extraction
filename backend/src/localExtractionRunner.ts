import { extractionRetryDelay, EXTRACTION_MAX_ATTEMPTS, EXTRACTION_MAX_RETRY_DELAY_MS } from "./extractionRetryPolicy";
import {
  getExtractionModelName,
  getModelGatewayRouteLabel,
  runExtraction,
  type ModelGatewayConfiguration,
  RetryableError,
} from "./consumer/modelGateway";
import { normalizeModelResults, type ModelFieldResult } from "./consumer/modelResultNormalizer";
import { HttpError } from "./lib/http";
import { configurationMissing, createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import { createLocalDocumentProcessingRunner, type DocumentProcessingFunctions } from "./localDocumentProcessingRunner";
import type { LocalRetainedSourceObjects } from "./localApplication";
import { nowIso } from "./lib/ids";
import type { FieldDefinition } from "./lib/types";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import type { LocalWorkspaceExtractionJobSummary, LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import {
  createEphemeralLocalWorkspaceProductStoreRegistry,
  createLocalWorkspaceProductStoreRegistry,
  LocalWorkspaceProductStoreRegistryError,
  type LocalWorkspaceProductStoreHandle,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import {
  createLocalWorkspaceProductOperations,
  type LocalWorkspaceProductOperations,
} from "./localWorkspaceProductOperations";
import {
  createLocalWorkspaceProductDataAccess,
  LocalWorkspaceProductDataAccessError,
} from "./localWorkspaceProductDataAccess";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_STALE_PROCESSING_AFTER_MS = 5 * 60 * 1000;

const DEFAULT_RECOVERY_BATCH_SIZE = 1_000;

export type LocalExtractionRunner = {
  recover(workspaceId?: string): Promise<void>;
  run(job: LocalQueuedExtractionJob): Promise<void>;
};

type ExtractionFunction = (input: {
  fields: FieldDefinition[];
  signal: AbortSignal;
  sourceBytes: ArrayBuffer;
  sourceMimeType: string;
}) => Promise<ModelFieldResult[]>;

export function createLocalExtractionRunner({
  extract,
  classify,
  splitDocument,
  materializePages,
  sourceObjects,
  modelGatewayRequestTimeoutMs,
  maxAttempts = EXTRACTION_MAX_ATTEMPTS,
  maxRetryDelayMs = EXTRACTION_MAX_RETRY_DELAY_MS,
  now = nowIso,
  onGatewayOutcome,
  onJobLifecycleChange,
  productAnalytics,
  productStoreOpener,
  productStoreRegistry,
  recoveryBatchSize = DEFAULT_RECOVERY_BATCH_SIZE,
  random = Math.random,
  retryDelayMs = 0,
  scheduleJob = async () => {},
  sourceFileStore,
  staleProcessingAfterMs = DEFAULT_STALE_PROCESSING_AFTER_MS,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
}: DocumentProcessingFunctions & {
  extract?: ExtractionFunction;
  sourceObjects?: LocalRetainedSourceObjects;
  modelGatewayRequestTimeoutMs?: string;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  now?: () => string;
  onGatewayOutcome?: (outcome: "failed" | "success" | "throttled" | "timeout") => void;
  onJobLifecycleChange?: (workspaceId: string, job: LocalWorkspaceExtractionJobSummary) => void;
  productAnalytics?: LocalProductAnalytics;
  productStoreOpener?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore | null;
  productStoreRegistry?: LocalWorkspaceProductStoreRegistry;
  recoveryBatchSize?: number;
  random?: () => number;
  retryDelayMs?: number;
  scheduleJob?: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  sourceFileStore?: LocalSourceFileStore;
  staleProcessingAfterMs?: number;
  stateDirectory: string;
  workspaceControl?: Pick<LocalWorkspaceControl, "workspaceExists">;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
}): LocalExtractionRunner {
  const normalizedRetryDelayMs = Number.isFinite(retryDelayMs) ? Math.max(0, Math.trunc(retryDelayMs)) : 0;

  const normalizedMaxRetryDelayMs = Number.isFinite(maxRetryDelayMs)
    ? Math.max(normalizedRetryDelayMs, Math.trunc(maxRetryDelayMs))
    : EXTRACTION_MAX_RETRY_DELAY_MS;

  const localSourceFileStore = sourceFileStore ?? createLocalSourceFileStore({ stateDirectory });

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

  const credentialVault = createWorkspaceCredentialVault(stateDirectory);

  const normalizedRecoveryBatchSize =
    Number.isSafeInteger(recoveryBatchSize) && recoveryBatchSize > 0 ? recoveryBatchSize : DEFAULT_RECOVERY_BATCH_SIZE;

  const recoveries = new Map<string, Promise<void>>();
  const activeJobs = new Map<string, Set<string>>();

  const documentProcessing = createLocalDocumentProcessingRunner({
    classify,
    splitDocument,
    materializePages,
    stateDirectory,
    sourceFiles: localSourceFileStore,
    sourceObjects,
    now,
    modelGatewayRequestTimeoutMs,
    scheduleJob,
    onGatewayOutcome,
    notifyJob: (workspaceId, store, jobId) => notifyJobLifecycle(onJobLifecycleChange, workspaceId, store, jobId),
  });

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
    run: async (job) => {
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

            const processingContext = {
              store: productStore,
              workspaceId: job.workspace_id,
              ownerId: job.job_id,
              signal,
            };

            if (job.kind === "packet") {
              await documentProcessing.processPacket(processingContext);

              return;
            }

            const summary = productStore.getExtractionJobSummary(job.job_id);

            if (summary && summary.template_id === null && !(await documentProcessing.route(processingContext))) return;

            if (signal.aborted) return;
            const attempt = job.attempt ?? 1;

            const claimed = productStore.claimExtractionJobForProcessing({
              jobId: job.job_id,
              attempt,
              claimedAt: now(),
            });

            if (!claimed) return;

            if (signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
              return;
            }

            notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);

            let recordedModel: { modelName: string; route: string } | null = null;
            let gatewayStarted = false;

            try {
              const configuration = productStore.getModelConfiguration();

              if (!configuration) throw configurationMissing();

              const gatewayConfiguration: ModelGatewayConfiguration = {
                AI_MODEL: configuration.model_name,
                MODEL_GATEWAY_URL: configuration.gateway_url,
                LITELLM_KEY: credentialVault.decrypt(job.workspace_id, configuration.credential_ciphertext),
                MODEL_GATEWAY_SEQUENTIAL_CALLS: String(configuration.sequential_calls),
                MODEL_SUPPORTS_PDF_INPUT: String(configuration.supports_pdf_input),
                MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(configuration.supports_structured_output),
                MODEL_GATEWAY_REQUEST_TIMEOUT_MS: modelGatewayRequestTimeoutMs,
                MODEL_GATEWAY_WORKSPACE_ID: job.workspace_id,
                modelCallObserver: productStore.modelCallObserver({
                  ownerId: claimed.job_id,
                  stage: "extraction",
                  model: configuration.model_name,
                  configurationRevision: configuration.revision,
                  now,
                }),
              };

              const sourceBytes = await localSourceFileStore.read(claimed.source_file_key);

              if (!sourceBytes) throw new MissingSourceFileError();
              const sourceByteSize = sourceBytes.byteLength;

              const model = {
                modelName: getExtractionModelName(gatewayConfiguration),
                route: getModelGatewayRouteLabel(gatewayConfiguration),
              };

              if (
                !productStore.recordExtractionJobModel({
                  jobId: claimed.job_id,
                  attempt,
                  configurationRevision: configuration.revision,
                  ...model,
                })
              )
                return;
              recordedModel = model;

              if (!extract) gatewayStarted = true;

              const rawResults = extract
                ? await extract({
                    fields: claimed.fields,
                    signal,
                    sourceBytes: toArrayBuffer(sourceBytes),
                    sourceMimeType: claimed.source_mime_type,
                  })
                : await runExtraction(
                    gatewayConfiguration,
                    claimed.fields,
                    toArrayBuffer(sourceBytes),
                    claimed.source_mime_type,
                    signal,
                  );

              if (gatewayStarted) {
                notifyGatewayOutcome(onGatewayOutcome, "success");
                gatewayStarted = false;
              }

              const results = normalizeModelResults(claimed.fields, rawResults);

              if (signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) return;

              const completed = productStore.completeExtractionJob({
                jobId: claimed.job_id,
                attempt,
                completedAt: now(),
                ...model,
                results,
              });

              if (completed) {
                notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);
                recordLocalProductAnalytics(productAnalytics, {
                  type: "extraction_completed",
                  workspaceId: job.workspace_id,
                  templateId: claimed.template_id,
                  templateVersion: claimed.template_version,
                  extractionJobId: claimed.job_id,
                  status: "completed",
                  attempt,
                  sourceMimeType: claimed.source_mime_type,
                  sourceByteSize,
                  modelName: model.modelName,
                  fieldCount: claimed.fields.length,
                });

                // A locally retained original outlives processing; working copies of remote originals do not.
                if (!claimed.source_retained || claimed.source_retained_remotely)
                  await cleanupCompletedSourceFile({
                    jobId: claimed.job_id,
                    productStore,
                    sourceFileKey: claimed.source_file_key,
                    sourceFileStore: localSourceFileStore,
                  });
              }
            } catch (error) {
              if (gatewayStarted) {
                notifyGatewayOutcome(onGatewayOutcome, gatewayOutcomeForError(error));
              }

              if (signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) return;

              if (error instanceof RetryableError && attempt < maxAttempts) {
                const requeuedAt = now();

                const retryDelayForAttemptMs = extractionRetryDelay(
                  attempt,
                  normalizedRetryDelayMs,
                  error.retryAfterMs,
                  normalizedMaxRetryDelayMs,
                  random,
                );

                const nextRetryAt = new Date(Date.parse(requeuedAt) + retryDelayForAttemptMs).toISOString();

                const requeued = productStore.requeueExtractionJob({
                  jobId: claimed.job_id,
                  attempt,
                  requeuedAt,
                  errorCode: "model_gateway_retry",
                  errorMessage: processingErrorMessage(error),
                  modelName: recordedModel?.modelName ?? null,
                  route: recordedModel?.route ?? null,
                  nextRetryAt,
                });

                if (requeued) {
                  notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);
                  await scheduleJob({
                    job_id: claimed.job_id,
                    workspace_id: job.workspace_id,
                    template_id: claimed.template_id,
                    template_version: claimed.template_version,
                    enqueued_at: requeuedAt,
                    attempt: attempt + 1,
                    not_before: nextRetryAt,
                  });
                }

                return;
              }

              const errorCode = processingErrorCode(error, attempt, maxAttempts);

              const failed = productStore.failExtractionJob({
                jobId: claimed.job_id,
                attempt,
                failedAt: now(),
                errorCode,
                errorMessage: processingErrorMessage(error),
                modelName: recordedModel?.modelName ?? null,
                route: recordedModel?.route ?? null,
              });

              if (failed) {
                notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);
                recordLocalProductAnalytics(productAnalytics, {
                  type: "extraction_failed",
                  workspaceId: job.workspace_id,
                  templateId: claimed.template_id,
                  templateVersion: claimed.template_version,
                  extractionJobId: claimed.job_id,
                  status: "failed",
                  attempt,
                  sourceMimeType: claimed.source_mime_type,
                  errorCode,
                  fieldCount: claimed.fields.length,
                });
              }
            }
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

async function cleanupCompletedSourceFile({
  jobId,
  productStore,
  sourceFileKey,
  sourceFileStore,
}: {
  jobId: string;
  productStore: LocalWorkspaceProductStoreHandle;
  sourceFileKey: string;
  sourceFileStore: LocalSourceFileStore;
}): Promise<void> {
  try {
    await sourceFileStore.delete(sourceFileKey);
    productStore.markSourceFileCleaned({
      jobId,
      sourceFileKey,
      cleanedAt: nowIso(),
    });
  } catch (error) {
    console.error("Local Source file cleanup failed", error);
  }
}

class MissingSourceFileError extends Error {
  constructor() {
    super("Source file is missing from local storage");
  }
}

function processingErrorCode(cause: unknown, attempt: number, maxAttempts: number): string {
  if (cause instanceof HttpError) return cause.code;

  if (cause instanceof MissingSourceFileError) return "missing_source_file";

  if (cause instanceof RetryableError) return attempt >= maxAttempts ? "retry_exhausted" : "model_gateway_failed";

  return "processing_error";
}

function processingErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unknown processing failure";
}

function gatewayOutcomeForError(cause: unknown): "failed" | "throttled" | "timeout" {
  if (cause instanceof RetryableError && cause.status === 429) return "throttled";
  const message = processingErrorMessage(cause).toLowerCase();

  return message.includes("timed out") || message.includes("timeout") ? "timeout" : "failed";
}

function notifyGatewayOutcome(
  observer: ((outcome: "failed" | "success" | "throttled" | "timeout") => void) | undefined,
  outcome: "failed" | "success" | "throttled" | "timeout",
): void {
  try {
    observer?.(outcome);
  } catch (error) {
    console.warn("Local gateway outcome observer failed", error);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}

function notifyJobLifecycle(
  onJobLifecycleChange: ((workspaceId: string, job: LocalWorkspaceExtractionJobSummary) => void) | undefined,
  workspaceId: string,
  productStore: LocalWorkspaceProductStoreHandle,
  jobId: string,
): void {
  if (!onJobLifecycleChange) return;
  const job = productStore.getExtractionJobSummary(jobId);

  if (!job) return;

  try {
    onJobLifecycleChange(workspaceId, job);
  } catch (error) {
    console.error("Local live update broadcast failed", error);
  }
}

function recordLocalProductAnalytics(
  productAnalytics: LocalProductAnalytics | undefined,
  event: LocalWorkspaceProductAnalyticsEvent,
): void {
  try {
    productAnalytics?.record(event);
  } catch (error) {
    console.warn("Local product analytics emission failed", error);
  }
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
