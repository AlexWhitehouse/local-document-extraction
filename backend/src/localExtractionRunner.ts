import {
  getExtractionModelName,
  getModelGatewayRouteLabel,
  runExtraction,
  type ModelGatewayConfiguration,
  RetryableError,
} from "./consumer/modelGateway";
import {
  normalizeModelResults,
  type ModelFieldResult,
} from "./consumer/modelResultNormalizer";
import { HttpError } from "./lib/http";
import { configurationMissing, createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import { nowIso } from "./lib/ids";
import type { FieldDefinition } from "./lib/types";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import {
  type LocalWorkspaceExtractionJob,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";
import {
  createEphemeralLocalWorkspaceProductStoreRegistry,
  createLocalWorkspaceProductStoreRegistry,
  LocalWorkspaceProductStoreRegistryError,
  type LocalWorkspaceProductStoreHandle,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import {
  LocalWorkspaceOperationError,
  type LocalWorkspaceProductOperation,
  type LocalWorkspaceProductOperations,
} from "./localWorkspaceProductOperations";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_STALE_PROCESSING_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_RECOVERY_BATCH_SIZE = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

export type LocalExtractionRunner = {
  recover(): Promise<void>;
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
  modelGatewayRequestTimeoutMs,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
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
}: {
  extract?: ExtractionFunction;
  modelGatewayRequestTimeoutMs?: string;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  now?: () => string;
  onGatewayOutcome?: (outcome: "failed" | "success" | "throttled" | "timeout") => void;
  onJobLifecycleChange?: (workspaceId: string, job: LocalWorkspaceExtractionJob) => void;
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
  const normalizedRetryDelayMs = Number.isFinite(retryDelayMs)
    ? Math.max(0, Math.trunc(retryDelayMs))
    : 0;
  const normalizedMaxRetryDelayMs = Number.isFinite(maxRetryDelayMs)
    ? Math.max(normalizedRetryDelayMs, Math.trunc(maxRetryDelayMs))
    : DEFAULT_MAX_RETRY_DELAY_MS;
  const localSourceFileStore = sourceFileStore ?? createLocalSourceFileStore({ stateDirectory });
  const localProductStoreRegistry = productStoreRegistry ?? (productStoreOpener
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
  const credentialVault = createWorkspaceCredentialVault(stateDirectory);
  const normalizedRecoveryBatchSize = Number.isSafeInteger(recoveryBatchSize) && recoveryBatchSize > 0
    ? recoveryBatchSize
    : DEFAULT_RECOVERY_BATCH_SIZE;
  let activeRecovery: Promise<void> | null = null;

  const recover = async () => {
    const workspaceIds = await listLocalWorkspaceIds(stateDirectory);
    const recoveredAt = now();
    const staleProcessingBefore = new Date(
      Date.now() - Math.max(0, staleProcessingAfterMs),
    ).toISOString();
    for (const workspaceId of workspaceIds) {
      if (!workspaceExists(workspaceControl, workspaceId)) {
        continue;
      }
      let productStoreLease;
      try {
        productStoreLease = localProductStoreRegistry.acquire({ workspaceId, mode: "existing" });
      } catch (error) {
        if (error instanceof LocalWorkspaceProductStoreRegistryError) {
          continue;
        }
        throw error;
      }
      if (!productStoreLease) {
        continue;
      }
      const productStore = productStoreLease.store;
      try {
        const recovered = productStore.recoverExtractionJobs({
          limit: normalizedRecoveryBatchSize,
          maxAttempts,
          recoveredAt,
          staleProcessingBefore,
        });
        for (const job of recovered) {
          if (!workspaceExists(workspaceControl, workspaceId)) {
            break;
          }
          await scheduleJob({
            job_id: job.job_id,
            workspace_id: workspaceId,
            template_id: job.template_id,
            template_version: job.template_version,
            enqueued_at: recoveredAt,
            attempt: job.attempt,
            not_before: job.not_before,
          });
        }
      } finally {
        productStoreLease.release();
      }
    }
  };

  return {
    recover: async () => {
      if (activeRecovery) return activeRecovery;
      activeRecovery = recover().finally(() => {
        activeRecovery = null;
      });
      return activeRecovery;
    },
    run: async (job) => {
      if (!workspaceExists(workspaceControl, job.workspace_id)) {
        return;
      }
      let productOperation: LocalWorkspaceProductOperation | undefined;
      try {
        productOperation = workspaceProductOperations?.acquire({
          workspaceId: job.workspace_id,
          jobId: job.job_id,
        });
      } catch (error) {
        if (error instanceof LocalWorkspaceOperationError) {
          return;
        }
        throw error;
      }
      let productStoreLease;
      try {
        productStoreLease = localProductStoreRegistry.acquire({ workspaceId: job.workspace_id, mode: "existing" });
      } catch (error) {
        productOperation?.release();
        if (error instanceof LocalWorkspaceProductStoreRegistryError) {
          return;
        }
        throw error;
      }
      if (!productStoreLease) {
        productOperation?.release();
        return;
      }
      const productStore = productStoreLease.store;
      const attempt = job.attempt ?? 1;
      try {
        const claimed = productStore.claimExtractionJobForProcessing({
          jobId: job.job_id,
          attempt,
          claimedAt: now(),
        });
        if (!claimed) {
          return;
        }
        if (productOperation?.signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
          return;
        }
        notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);

        let activeModelGatewayConfiguration: ModelGatewayConfiguration | null = null;
        let gatewayStarted = false;
        let modelRecorded = false;
        try {
          const configuration = productStore.getModelConfiguration();
          if (!configuration) throw configurationMissing();
          activeModelGatewayConfiguration = {
            AI_MODEL: configuration.model_name,
            MODEL_GATEWAY_URL: configuration.gateway_url,
            LITELLM_KEY: credentialVault.decrypt(job.workspace_id, configuration.credential_ciphertext),
            MODEL_GATEWAY_SEQUENTIAL_CALLS: String(configuration.sequential_calls),
            MODEL_SUPPORTS_PDF_INPUT: String(configuration.supports_pdf_input),
            MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(configuration.supports_structured_output),
            MODEL_GATEWAY_REQUEST_TIMEOUT_MS: modelGatewayRequestTimeoutMs,
            MODEL_GATEWAY_WORKSPACE_ID: job.workspace_id,
          };
          const sourceBytes = await localSourceFileStore.read(claimed.source_file_key);
          if (!sourceBytes) throw new MissingSourceFileError();
          const sourceByteSize = sourceBytes.byteLength;
          const recordedModel = productStore.recordExtractionJobModel({
            jobId: claimed.job_id,
            attempt,
            modelName: getExtractionModelName(activeModelGatewayConfiguration),
            configurationRevision: configuration.revision,
            route: getModelGatewayRouteLabel(activeModelGatewayConfiguration),
          });
          if (!recordedModel) {
            return;
          }
          modelRecorded = true;
          const extractionSignal = productOperation?.signal ?? new AbortController().signal;
          if (!extract) gatewayStarted = true;
          const rawResults = extract
            ? await extract({
                fields: claimed.fields,
                signal: extractionSignal,
                sourceBytes: toArrayBuffer(sourceBytes!),
                sourceMimeType: claimed.source_mime_type,
              })
            : await runExtraction(
                activeModelGatewayConfiguration,
                claimed.fields,
                toArrayBuffer(sourceBytes),
                claimed.source_mime_type,
                extractionSignal,
              );
          if (gatewayStarted) {
            notifyGatewayOutcome(onGatewayOutcome, "success");
            gatewayStarted = false;
          }
          const results = normalizeModelResults(claimed.fields, rawResults);
          if (productOperation?.signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
            return;
          }
          const completed = productStore.completeExtractionJob({
            jobId: claimed.job_id,
            attempt,
            completedAt: now(),
            modelName: getExtractionModelName(activeModelGatewayConfiguration),
            route: getModelGatewayRouteLabel(activeModelGatewayConfiguration),
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
              modelName: getExtractionModelName(activeModelGatewayConfiguration),
              fieldCount: claimed.fields.length,
            });
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
          if (productOperation?.signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
            return;
          }
          if (error instanceof RetryableError && attempt < maxAttempts) {
            const requeuedAt = now();
            const exponentialCeilingMs = Math.min(
              normalizedMaxRetryDelayMs,
              normalizedRetryDelayMs * 2 ** Math.max(0, attempt - 1),
            );
            const jitteredDelayMs = Math.floor(
              Math.max(0, Math.min(1, random())) * exponentialCeilingMs,
            );
            const retryDelayForAttemptMs = Math.max(
              jitteredDelayMs,
              error.retryAfterMs ?? 0,
            );
            const nextRetryAt = new Date(
              Date.parse(requeuedAt) + retryDelayForAttemptMs,
            ).toISOString();
            const requeued = productStore.requeueExtractionJob({
              jobId: claimed.job_id,
              attempt,
              requeuedAt,
              errorCode: "model_gateway_retry",
              errorMessage: processingErrorMessage(error),
              modelName: modelRecorded && activeModelGatewayConfiguration
                ? getExtractionModelName(activeModelGatewayConfiguration)
                : null,
              route: modelRecorded && activeModelGatewayConfiguration
                ? getModelGatewayRouteLabel(activeModelGatewayConfiguration)
                : null,
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
            modelName: modelRecorded && activeModelGatewayConfiguration
              ? getExtractionModelName(activeModelGatewayConfiguration)
              : null,
            route: modelRecorded && activeModelGatewayConfiguration
              ? getModelGatewayRouteLabel(activeModelGatewayConfiguration)
              : null,
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
      } finally {
        productStoreLease.release();
        productOperation?.release();
      }
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

function processingErrorCode(error: unknown, attempt: number, maxAttempts: number): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof MissingSourceFileError) {
    return "missing_source_file";
  }
  if (error instanceof RetryableError) {
    return attempt >= maxAttempts ? "retry_exhausted" : "model_gateway_failed";
  }
  return "processing_error";
}

function processingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing failure";
}

function gatewayOutcomeForError(error: unknown): "failed" | "throttled" | "timeout" {
  if (error instanceof RetryableError && error.status === 429) return "throttled";
  const message = processingErrorMessage(error).toLowerCase();
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
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function notifyJobLifecycle(
  onJobLifecycleChange: ((workspaceId: string, job: LocalWorkspaceExtractionJob) => void) | undefined,
  workspaceId: string,
  productStore: LocalWorkspaceProductStoreHandle,
  jobId: string,
): void {
  if (!onJobLifecycleChange) {
    return;
  }
  const job = productStore.getExtractionJob(jobId);
  if (!job) {
    return;
  }
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
  if (!productAnalytics) {
    return;
  }
  try {
    productAnalytics.record(event);
  } catch (error) {
    console.warn("Local product analytics emission failed", error);
  }
}

async function listLocalWorkspaceIds(stateDirectory: string): Promise<string[]> {
  const workspaceDirectory = join(stateDirectory, "data", "workspaces");
  const entries = await readdir(workspaceDirectory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => entry.name.slice(0, -".sqlite".length))
    .filter((workspaceId) => /^[a-zA-Z0-9_-]+$/.test(workspaceId));
}
