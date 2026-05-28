import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { nowIso } from "../lib/ids";
import type { DocumentProcessingWorkflowParams } from "../lib/types";
import { emitWorkspaceProductAnalytics } from "../lib/workspaceProductAnalytics";
import {
  getWorkspaceProductStore,
  type ClaimedWorkspaceExtractionJob,
  type WorkspaceProductStoreRpc,
} from "../lib/workspaceProductStoreClient";
import {
  type NormalizedModelField,
  normalizeModelResults,
} from "./modelResultNormalizer";
import {
  getAiGatewayId,
  getExtractionModelName,
  RetryableError,
  runExtraction,
} from "./aiGateway";

const DB_STEP_CONFIG = {
  retries: {
    limit: 3,
    delay: "2 seconds",
    backoff: "linear",
  },
  timeout: "40 seconds",
} as const;

const EXTRACT_PERSIST_STEP_CONFIG = {
  retries: {
    limit: 10,
    delay: "10 seconds",
    backoff: "exponential",
  },
  timeout: "30 minutes",
} as const;

const CLEANUP_STEP_CONFIG = {
  retries: {
    limit: 5,
    delay: "10 seconds",
    backoff: "constant",
  },
  timeout: "2 minutes",
} as const;

export class DocumentProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  DocumentProcessingWorkflowParams
> {
  async run(
    event: WorkflowEvent<DocumentProcessingWorkflowParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const params = event.payload;
    const productStore = getWorkspaceProductStore(this.env, params.workspace_id);

    const claimed = await step.do("claim job", DB_STEP_CONFIG, async () =>
      productStore.claimExtractionJobForProcessing({
        jobId: params.job_id,
        attempt: params.attempt,
        claimedAt: nowIso(),
      }),
    );
    if (!claimed) {
      return;
    }

    try {
      await step.do(
        "extract and persist",
        EXTRACT_PERSIST_STEP_CONFIG,
        async () => {
          const object = await this.env.SOURCE_FILES_BUCKET.get(
            claimed.source_file_key,
          );
          if (!object) {
            throw new Error("missing_source_file");
          }
          const source = await object.arrayBuffer();
          const modelResults = await runExtraction(
            this.env,
            claimed.fields,
            source,
            claimed.source_mime_type,
          );
          const normalized = normalizeModelResults(claimed.fields, modelResults);
          await this.completeJob(
            productStore,
            params.workspace_id,
            params.job_id,
            params.attempt,
            claimed,
            normalized,
            source.byteLength,
          );
          return { ok: true };
        },
      );
      await step.do("cleanup source file", CLEANUP_STEP_CONFIG, async () => {
        await this.cleanupSource(productStore, params.job_id, claimed.source_file_key);
        return { ok: true };
      });
    } catch (error) {
      if (error instanceof RetryableError) {
        throw error;
      }

      const code = errorCode(error);
      const message = failureMessage(code, error);
      await step.do("mark failed", DB_STEP_CONFIG, async () =>
        this.markFailed(
          productStore,
          params.workspace_id,
          params.job_id,
          params.attempt,
          claimed,
          code,
          message,
        ),
      );
    }
  }

  private async completeJob(
    productStore: WorkspaceProductStoreRpc,
    workspaceId: string,
    jobId: string,
    attempt: number,
    claimed: ClaimedWorkspaceExtractionJob,
    normalized: NormalizedModelField[],
    sourceByteSize: number,
  ): Promise<void> {
    const completed = await productStore.completeExtractionJob({
      jobId,
      attempt,
      completedAt: nowIso(),
      modelName: getExtractionModelName(this.env),
      route: getAiGatewayId(this.env),
      results: normalized,
    });
    if (!completed) {
      return;
    }

    emitWorkspaceProductAnalytics(this.env, {
      type: "extraction_completed",
      workspaceId,
      templateId: claimed.template_id,
      templateVersion: claimed.template_version,
      extractionJobId: jobId,
      status: "completed",
      attempt,
      sourceMimeType: claimed.source_mime_type,
      sourceByteSize,
      modelName: getExtractionModelName(this.env),
      fieldCount: claimed.fields.length,
    });
  }

  private async cleanupSource(
    productStore: WorkspaceProductStoreRpc,
    jobId: string,
    sourceFileKey: string,
  ): Promise<void> {
    try {
      await this.env.SOURCE_FILES_BUCKET.delete(sourceFileKey);
      await productStore.markSourceFileCleaned({
        jobId,
        sourceFileKey,
        cleanedAt: nowIso(),
      });
    } catch (cleanupError) {
      console.error("R2 cleanup failed", cleanupError);
    }
  }

  private async markFailed(
    productStore: WorkspaceProductStoreRpc,
    workspaceId: string,
    jobId: string,
    attempt: number,
    claimed: ClaimedWorkspaceExtractionJob,
    code: string,
    message: string,
  ): Promise<void> {
    const failed = await productStore.failExtractionJob({
      jobId,
      attempt,
      failedAt: nowIso(),
      errorCode: code,
      errorMessage: message,
    });
    if (!failed) {
      return;
    }

    emitWorkspaceProductAnalytics(this.env, {
      type: "extraction_failed",
      workspaceId,
      templateId: claimed.template_id,
      templateVersion: claimed.template_version,
      extractionJobId: jobId,
      status: "failed",
      attempt,
      sourceMimeType: claimed.source_mime_type,
      errorCode: code,
      fieldCount: claimed.fields.length,
    });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function errorCode(error: unknown): string {
  if (errorMessage(error) === "missing_source_file") {
    return "missing_source_file";
  }
  return "processing_error";
}

function failureMessage(code: string, error: unknown): string {
  if (code === "missing_source_file") {
    return "Source file is missing from storage";
  }
  return errorMessage(error);
}
