import { HttpError, json } from "../lib/http";
import type { Tenant } from "../lib/types";

export async function getJob(db: D1Database, tenant: Tenant, id: string): Promise<Response> {
  const job = await db
    .prepare(
      `SELECT id, status, template_id, template_version, image_name, error_code, error_message,
              created_at, updated_at, completed_at
       FROM jobs
       WHERE id = ? AND tenant_id = ?`
    )
    .bind(id, tenant.id)
    .first<{
      id: string;
      status: string;
      template_id: string;
      template_version: number;
      image_name: string | null;
      error_code: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    }>();

  if (!job) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  if (job.status !== "completed") {
    return json({
      job_id: job.id,
      status: job.status,
      image_name: job.image_name,
      template_id: job.template_id,
      template_version: job.template_version,
      error_code: job.error_code,
      error_message: job.error_message
    });
  }

  const resultRows = await db
    .prepare(
      `SELECT
         r.field_id,
         f.name,
         f.data_type,
         r.status,
         r.answer_json,
         r.confidence,
         r.evidence_text
       FROM job_results r
       JOIN template_fields f
         ON f.template_id = ?
        AND f.version = ?
        AND f.field_id = r.field_id
       WHERE r.job_id = ?
       ORDER BY f.position ASC`
    )
    .bind(job.template_id, job.template_version, id)
    .all<{
      field_id: string;
      name: string;
      data_type: string;
      status: string;
      answer_json: string | null;
      confidence: number | null;
      evidence_text: string | null;
    }>();

  return json({
    job_id: job.id,
    status: job.status,
    image_name: job.image_name,
    template_id: job.template_id,
    template_version: job.template_version,
    results: resultRows.results.map((row) => ({
      field_id: row.field_id,
      name: row.name,
      data_type: row.data_type,
      status: row.status,
      answer: row.answer_json ? safeJsonParse(row.answer_json) : null,
      confidence: row.confidence,
      evidence: row.evidence_text
    }))
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
