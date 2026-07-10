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
import { nowIso } from "./lib/ids";
import type { FieldDefinition } from "./lib/types";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import {
  openLocalWorkspaceProductStore,
  type LocalWorkspaceExtractionJob,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";
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
  modelGatewayConfiguration = localModelGatewayConfiguration(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  onJobLifecycleChange,
  productAnalytics,
  productStoreOpener = openLocalWorkspaceProductStore,
  scheduleJob = async () => {},
  sourceFileStore,
  staleProcessingAfterMs = DEFAULT_STALE_PROCESSING_AFTER_MS,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
}: {
  extract?: ExtractionFunction;
  modelGatewayConfiguration?: ModelGatewayConfiguration;
  maxAttempts?: number;
  onJobLifecycleChange?: (workspaceId: string, job: LocalWorkspaceExtractionJob) => void;
  productAnalytics?: LocalProductAnalytics;
  productStoreOpener?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore | null;
  scheduleJob?: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  sourceFileStore?: LocalSourceFileStore;
  staleProcessingAfterMs?: number;
  stateDirectory: string;
  workspaceControl?: Pick<LocalWorkspaceControl, "workspaceExists">;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
}): LocalExtractionRunner {
  const localSourceFileStore = sourceFileStore ?? createLocalSourceFileStore({ stateDirectory });
  const runModelExtraction = extract ?? ((input) => runExtraction(
    modelGatewayConfiguration,
    input.fields,
    input.sourceBytes,
    input.sourceMimeType,
    input.signal,
  ));

  return {
    recover: async () => {
      const workspaceIds = await listLocalWorkspaceIds(stateDirectory);
      const recoveredAt = nowIso();
      const staleProcessingBefore = new Date(
        Date.now() - Math.max(0, staleProcessingAfterMs),
      ).toISOString();
      for (const workspaceId of workspaceIds) {
        if (!workspaceExists(workspaceControl, workspaceId)) {
          continue;
        }
        const productStore = productStoreOpener({ stateDirectory, workspaceId });
        if (!productStore) {
          continue;
        }
        try {
          const recovered = productStore.recoverExtractionJobs({
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
            });
          }
        } finally {
          productStore.close();
        }
      }
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
      const productStore = productStoreOpener({ stateDirectory, workspaceId: job.workspace_id });
      if (!productStore) {
        productOperation?.release();
        return;
      }
      const attempt = job.attempt ?? 1;
      try {
        const claimed = productStore.claimExtractionJobForProcessing({
          jobId: job.job_id,
          attempt,
          claimedAt: nowIso(),
        });
        if (!claimed) {
          return;
        }
        if (productOperation?.signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
          return;
        }
        notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);

        try {
          const sourceBytes = await localSourceFileStore.read(claimed.source_file_key);
          if (!sourceBytes) {
            throw new MissingSourceFileError();
          }
          const rawResults = await runModelExtraction({
            fields: claimed.fields,
            signal: productOperation?.signal ?? new AbortController().signal,
            sourceBytes: toArrayBuffer(sourceBytes),
            sourceMimeType: claimed.source_mime_type,
          });
          const results = normalizeModelResults(claimed.fields, rawResults);
          if (productOperation?.signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
            return;
          }
          const completed = productStore.completeExtractionJob({
            jobId: claimed.job_id,
            attempt,
            completedAt: nowIso(),
            modelName: getExtractionModelName(modelGatewayConfiguration),
            route: getModelGatewayRouteLabel(modelGatewayConfiguration),
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
              sourceByteSize: sourceBytes.byteLength,
              modelName: getExtractionModelName(modelGatewayConfiguration),
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
          if (productOperation?.signal.aborted || !workspaceExists(workspaceControl, job.workspace_id)) {
            return;
          }
          if (error instanceof RetryableError && attempt < maxAttempts) {
            const requeued = productStore.requeueExtractionJob({
              jobId: claimed.job_id,
              attempt,
              requeuedAt: nowIso(),
              errorCode: "model_gateway_retry",
              errorMessage: processingErrorMessage(error),
            });
            if (requeued) {
              notifyJobLifecycle(onJobLifecycleChange, job.workspace_id, productStore, claimed.job_id);
              await scheduleJob({
                job_id: claimed.job_id,
                workspace_id: job.workspace_id,
                template_id: claimed.template_id,
                template_version: claimed.template_version,
                enqueued_at: nowIso(),
                attempt: attempt + 1,
              });
            }
            return;
          }
          const errorCode = processingErrorCode(error, attempt, maxAttempts);
          const failed = productStore.failExtractionJob({
            jobId: claimed.job_id,
            attempt,
            failedAt: nowIso(),
            errorCode,
            errorMessage: processingErrorMessage(error),
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
        productStore.close();
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
  productStore: LocalWorkspaceProductStore;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function localModelGatewayConfiguration(): ModelGatewayConfiguration {
  return {
    AI_MODEL: process.env.AI_MODEL,
    LITELLM_KEY: process.env.LITELLM_KEY,
    MODEL_GATEWAY_REQUEST_TIMEOUT_MS: process.env.MODEL_GATEWAY_REQUEST_TIMEOUT_MS,
    MODEL_GATEWAY_ROUTE_LABEL: process.env.MODEL_GATEWAY_ROUTE_LABEL,
    MODEL_GATEWAY_URL: process.env.MODEL_GATEWAY_URL,
  };
}

function notifyJobLifecycle(
  onJobLifecycleChange: ((workspaceId: string, job: LocalWorkspaceExtractionJob) => void) | undefined,
  workspaceId: string,
  productStore: LocalWorkspaceProductStore,
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
