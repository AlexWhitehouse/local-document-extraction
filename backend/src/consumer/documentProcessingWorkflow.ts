import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  claimExtractionJobForProcessing,
  completeExtractionJob,
  failExtractionJob,
} from "../lib/extractionJobLifecycle";
import { nowIso } from "../lib/ids";
import type { Env, FieldDefinition, DocumentProcessingWorkflowParams } from "../lib/types";
import {
  type NormalizedModelField,
  normalizeModelResults,
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
    const job = await step.do("load job", DB_STEP_CONFIG, async () =>
      this.loadJob(params.job_id, params.workspace_id),
    );
    if (!job) {
      return;
    }

    const claimed = await step.do("claim job", DB_STEP_CONFIG, async () =>
      this.claimJob(params.job_id, params.attempt),
    );
    if (!claimed) {
      return;
    }

    try {
      await step.do(
        "extract and persist",
        EXTRACT_PERSIST_STEP_CONFIG,
        async () => {
          const freshJob = await this.loadJob(
            params.job_id,
            params.workspace_id,
          );
          if (!freshJob) {
            throw new Error("missing_job");
          }
          const fields = await this.loadTemplateFields(
            freshJob.template_id,
            freshJob.template_version,
          );
          const object = await this.env.SOURCE_FILES_BUCKET.get(
            freshJob.source_file_key,
          );
          if (!object) {
            throw new Error("missing_source_file");
          }
          const source = await object.arrayBuffer();
          const modelResults = await runExtraction(
            this.env,
            fields,
            source,
            freshJob.source_mime_type,
          );
          const normalized = normalizeModelResults(fields, modelResults);
          await this.completeJob(params.job_id, params.attempt, normalized);
          return { ok: true };
        },
      );
      await step.do("cleanup source file", CLEANUP_STEP_CONFIG, async () => {
        const freshJob = await this.loadJob(params.job_id, params.workspace_id);
        if (!freshJob) {
          return { skipped: true };
        }
        await this.cleanupSource(freshJob.source_file_key, params.job_id);
        return { ok: true };
      });
    } catch (error) {
      if (error instanceof RetryableError) {
        throw error;
      }

      const code = errorCode(error);
      const message = failureMessage(code, error);
      await step.do("mark failed", DB_STEP_CONFIG, async () =>
        this.markFailed(params.job_id, params.attempt, code, message),
      );
    }
  }

  private async loadJob(
    jobId: string,
    workspaceId: string,
  ): Promise<{
    template_id: string;
    template_version: number;
    source_file_key: string;
    source_mime_type: string;
  } | null> {
    return (
      (await this.env.DB.prepare(
        `SELECT template_id, template_version, source_file_key, source_mime_type
           FROM jobs
           WHERE id = ? AND workspace_id = ?`,
      )
        .bind(jobId, workspaceId)
        .first()) || null
    );
  }

  private async claimJob(jobId: string, attempt: number): Promise<boolean> {
    return claimExtractionJobForProcessing(this.env.DB, {
      jobId,
      attempt,
      claimedAt: nowIso(),
    });
  }

  private async loadTemplateFields(
    templateId: string,
    version: number,
  ): Promise<FieldDefinition[]> {
    const fieldsRows = await this.env.DB.prepare(
      `SELECT field_id, name, description, data_type, required
         FROM template_fields
         WHERE template_id = ? AND version = ?
         ORDER BY position ASC`,
    )
      .bind(templateId, version)
      .all<{
        field_id: string;
        name: string;
        description: string;
        data_type: FieldDefinition["data_type"];
        required: number;
      }>();

    return fieldsRows.results.map((row) => ({
      id: row.field_id,
      name: row.name,
      description: row.description,
      data_type: row.data_type,
      required: Boolean(row.required),
    }));
  }

  private async completeJob(
    jobId: string,
    attempt: number,
    normalized: NormalizedModelField[],
  ): Promise<void> {
    await completeExtractionJob(this.env.DB, {
      jobId,
      attempt,
      completedAt: nowIso(),
      modelName: "google/gemini-3-flash",
      route: this.env.AI_GATEWAY_ROUTE || "default",
      results: normalized,
    });
  }

  private async cleanupSource(sourceFileKey: string, jobId: string): Promise<void> {
    try {
      await this.env.SOURCE_FILES_BUCKET.delete(sourceFileKey);
      const now = nowIso();
      await this.env.DB.prepare(
        "UPDATE jobs SET image_deleted_at = ?, updated_at = ? WHERE id = ?",
      )
        .bind(now, now, jobId)
        .run();
    } catch (cleanupError) {
      console.error("R2 cleanup failed", cleanupError);
    }
  }

  private async markFailed(
    jobId: string,
    attempt: number,
    code: string,
    message: string,
  ): Promise<void> {
    await failExtractionJob(this.env.DB, {
      jobId,
      attempt,
      failedAt: nowIso(),
      errorCode: code,
      errorMessage: message,
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
  if (errorMessage(error) === "missing_job") {
    return "missing_job";
  }
  return "processing_error";
}

function failureMessage(code: string, error: unknown): string {
  if (code === "missing_source_file") {
    return "Source file is missing from storage";
  }
  if (code === "missing_job") {
    return "Job is missing or no longer belongs to the workspace";
  }
  return errorMessage(error);
}
