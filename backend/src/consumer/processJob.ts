import { nowIso } from "../lib/ids";
import type { Env, FieldDefinition, QueueJobMessage } from "../lib/types";
import { normalizeModelResults, RetryableError, runExtraction } from "./aiGateway";

export async function processJob(message: QueueJobMessage, env: Env): Promise<void> {
  const job = await env.DB
    .prepare(
       `SELECT id, status, template_id, template_version, image_r2_key, image_mime_type
        FROM jobs
        WHERE id = ? AND workspace_id = ?`
     )
    .bind(message.job_id, message.workspace_id)
    .first<{
      id: string;
      status: string;
      template_id: string;
      template_version: number;
      image_r2_key: string;
      image_mime_type: string;
    }>();

  if (!job) {
    return;
  }

  const claim = await env.DB
    .prepare(
      `UPDATE jobs
       SET status = 'processing', updated_at = ?, error_code = NULL, error_message = NULL
       WHERE id = ? AND status IN ('queued', 'retryable_failed')`
    )
    .bind(nowIso(), message.job_id)
    .run();

  if ((claim.meta.changes || 0) === 0) {
    return;
  }

  const fieldsRows = await env.DB
    .prepare(
      `SELECT field_id, name, description, data_type, required
       FROM template_fields
       WHERE template_id = ? AND version = ?
       ORDER BY position ASC`
    )
    .bind(job.template_id, job.template_version)
    .all<{
      field_id: string;
      name: string;
      description: string;
      data_type: FieldDefinition["data_type"];
      required: number;
    }>();

  const fields: FieldDefinition[] = fieldsRows.results.map((row) => ({
    id: row.field_id,
    name: row.name,
    description: row.description,
    data_type: row.data_type,
    required: Boolean(row.required)
  }));

  const object = await env.IMAGES_BUCKET.get(job.image_r2_key);
  if (!object) {
    console.error("Job failed: source file missing from R2", {
      job_id: message.job_id,
       workspace_id: message.workspace_id,
      image_r2_key: job.image_r2_key,
    });
    await markFailed(env, message.job_id, "missing_image", "Source image is missing from R2");
    return;
  }

  try {
    const sourceBytes = await object.arrayBuffer();
    const modelResults = await runExtraction(env, fields, sourceBytes, job.image_mime_type);
    const normalized = normalizeModelResults(fields, modelResults);
    const now = nowIso();

    const writes: D1PreparedStatement[] = normalized.map((row) =>
      env.DB
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
             updated_at = excluded.updated_at`
        )
        .bind(
          message.job_id,
          row.field_id,
          row.status,
          JSON.stringify(row.answer),
          row.normalized_value,
          row.confidence,
          row.evidence,
          now,
          now
        )
    );

    writes.push(
      env.DB
        .prepare(
          `UPDATE jobs
           SET status = 'completed', completed_at = ?, updated_at = ?,
               model_name = ?, ai_gateway_route = ?, prompt_version = 'v1', schema_version = 'v1'
           WHERE id = ?`
        )
        .bind(now, now, env.AI_MODEL || "google/gemini-3-flash", env.AI_GATEWAY_ROUTE || "default", message.job_id)
    );

    await env.DB.batch(writes);

    try {
      await env.IMAGES_BUCKET.delete(job.image_r2_key);
      await env.DB
        .prepare("UPDATE jobs SET image_deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(nowIso(), nowIso(), message.job_id)
        .run();
    } catch (cleanupError) {
      console.error("R2 cleanup failed", cleanupError);
    }
  } catch (error) {
    if (error instanceof RetryableError) {
      console.error("Job retryable failure", {
        job_id: message.job_id,
        workspace_id: message.workspace_id,
        error: error.message,
      });
      await markRetryableFailed(env, message.job_id, "ai_gateway_error", error.message);
      throw error;
    }

    console.error("Job non-retryable failure", {
      job_id: message.job_id,
      workspace_id: message.workspace_id,
      error: errorMessage(error),
    });
    await markFailed(env, message.job_id, "processing_error", errorMessage(error));
  }
}

async function markFailed(env: Env, jobId: string, code: string, message: string): Promise<void> {
  await env.DB
    .prepare("UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?")
    .bind(code, message.slice(0, 2000), nowIso(), jobId)
    .run();
}

async function markRetryableFailed(env: Env, jobId: string, code: string, message: string): Promise<void> {
  await env.DB
    .prepare("UPDATE jobs SET status = 'retryable_failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?")
    .bind(code, message.slice(0, 2000), nowIso(), jobId)
    .run();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
