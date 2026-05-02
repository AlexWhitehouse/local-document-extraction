import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { nowIso } from "../lib/ids";
import type { Env, FieldDefinition, ImageWorkflowParams } from "../lib/types";
import { normalizeModelResults, RetryableError, runExtraction } from "./aiGateway";

const DB_STEP_CONFIG = {
  retries: {
    limit: 3,
    delay: "2 seconds",
    backoff: "linear",
  },
  timeout: "30 seconds",
} as const;

const R2_READ_STEP_CONFIG = {
  retries: {
    limit: 4,
    delay: "5 seconds",
    backoff: "exponential",
  },
  timeout: "2 minutes",
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

export class ImageProcessingWorkflow extends WorkflowEntrypoint<Env, ImageWorkflowParams> {
  async run(event: WorkflowEvent<ImageWorkflowParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    const job = await step.do("load job", DB_STEP_CONFIG, async () => this.loadJob(params.job_id, params.workspace_id));
    if (!job) {
      return;
    }

    const claimed = await step.do("claim job", DB_STEP_CONFIG, async () => this.claimJob(params.job_id, params.attempt));
    if (!claimed) {
      return;
    }

    const fields = await step.do(
      "load template fields",
      DB_STEP_CONFIG,
      async () => this.loadTemplateFields(job.template_id, job.template_version),
    );
    const source = await step.do("read source from r2", R2_READ_STEP_CONFIG, async () => {
      const object = await this.env.IMAGES_BUCKET.get(job.image_r2_key);
      if (!object) {
        throw new Error("missing_image");
      }
      return await object.arrayBuffer();
    });

    try {
      await step.do(
        "extract and persist",
        EXTRACT_PERSIST_STEP_CONFIG,
        async () => {
          const modelResults = await runExtraction(this.env, fields, source, job.image_mime_type);
          const normalized = normalizeModelResults(fields, modelResults);
          await this.persistResults(params.job_id, params.attempt, normalized);
          return { ok: true };
        },
      );
      await step.do("cleanup source file", CLEANUP_STEP_CONFIG, async () => this.cleanupSource(job.image_r2_key, params.job_id));
    } catch (error) {
      if (error instanceof RetryableError) {
        await step.do("mark retryable failure", DB_STEP_CONFIG, async () =>
          this.markRetryableFailed(params.job_id, params.attempt, "ai_gateway_error", error.message),
        );
        throw error;
      }

      const code = errorMessage(error) === "missing_image" ? "missing_image" : "processing_error";
      const message = code === "missing_image" ? "Source image is missing from R2" : errorMessage(error);
      await step.do("mark failed", DB_STEP_CONFIG, async () => this.markFailed(params.job_id, params.attempt, code, message));
    }
  }

  private async loadJob(jobId: string, workspaceId: string): Promise<{
    template_id: string;
    template_version: number;
    image_r2_key: string;
    image_mime_type: string;
  } | null> {
    return (
      (await this.env.DB
        .prepare(
          `SELECT template_id, template_version, image_r2_key, image_mime_type
           FROM jobs
           WHERE id = ? AND workspace_id = ?`,
        )
        .bind(jobId, workspaceId)
        .first()) || null
    );
  }

  private async claimJob(jobId: string, attempt: number): Promise<boolean> {
    const now = nowIso();
    const result = await this.env.DB
      .prepare(
        `UPDATE jobs
         SET status = 'processing',
             updated_at = ?,
             error_code = NULL,
             error_message = NULL,
             workflow_started_at = ?,
             current_attempt = ?
         WHERE id = ? AND status IN ('queued', 'workflow_started') AND current_attempt < ?`,
      )
      .bind(now, now, attempt, jobId, attempt)
      .run();

    return (result.meta.changes || 0) > 0;
  }

  private async loadTemplateFields(templateId: string, version: number): Promise<FieldDefinition[]> {
    const fieldsRows = await this.env.DB
      .prepare(
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

  private async persistResults(
    jobId: string,
    attempt: number,
    normalized: Array<{
      field_id: string;
      status: string;
      answer: unknown;
      normalized_value: string | null;
      confidence: number | null;
      evidence: string | null;
    }>,
  ): Promise<void> {
    const now = nowIso();
    const writes: D1PreparedStatement[] = normalized.map((row) =>
      this.env.DB
        .prepare(
          `INSERT INTO job_results (
             job_id, field_id, status, answer_json, normalized_value, confidence, evidence_text, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id, field_id)
           DO UPDATE SET
             status = excluded.status,
             answer_json = excluded.answer_json,
             normalized_value = excluded.normalized_value,
             confidence = excluded.confidence,
             evidence_text = excluded.evidence_text,
             updated_at = excluded.updated_at`,
        )
        .bind(
          jobId,
          row.field_id,
          row.status,
          JSON.stringify(row.answer),
          row.normalized_value,
          row.confidence,
          row.evidence,
          now,
          now,
        ),
    );

    writes.push(
      this.env.DB
        .prepare(
          `UPDATE jobs
           SET status = 'completed',
               completed_at = ?,
               updated_at = ?,
               model_name = ?,
               ai_gateway_route = ?,
               prompt_version = 'v1',
               schema_version = 'v1',
               completed_attempt = ?
           WHERE id = ?`,
        )
        .bind(now, now, "google/gemini-3-flash", this.env.AI_GATEWAY_ROUTE || "default", attempt, jobId),
    );

    await this.env.DB.batch(writes);
  }

  private async cleanupSource(imageKey: string, jobId: string): Promise<void> {
    try {
      await this.env.IMAGES_BUCKET.delete(imageKey);
      const now = nowIso();
      await this.env.DB
        .prepare("UPDATE jobs SET image_deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, jobId)
        .run();
    } catch (cleanupError) {
      console.error("R2 cleanup failed", cleanupError);
    }
  }

  private async markFailed(jobId: string, attempt: number, code: string, message: string): Promise<void> {
    await this.env.DB
      .prepare(
        "UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = ? WHERE id = ?",
      )
      .bind(code, message.slice(0, 2000), nowIso(), attempt, jobId)
      .run();
  }

  private async markRetryableFailed(jobId: string, attempt: number, code: string, message: string): Promise<void> {
    await this.env.DB
      .prepare(
        "UPDATE jobs SET status = 'retryable_failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = ? WHERE id = ?",
      )
      .bind(code, message.slice(0, 2000), nowIso(), attempt, jobId)
      .run();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
