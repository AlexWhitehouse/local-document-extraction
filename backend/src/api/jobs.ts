import { HttpError, json } from "../lib/http";
import type { Env, Workspace } from "../lib/types";

export async function listJobs(db: D1Database, workspace: Workspace): Promise<Response> {
  const rows = await db
    .prepare(
      `SELECT id, status, template_id, template_version, image_name, error_code, error_message,
              created_at, updated_at, completed_at
       FROM jobs
       WHERE workspace_id = ?
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 200`
    )
    .bind(workspace.id)
    .all<{
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

  return json({
    jobs: rows.results.map((row) => ({
      job_id: row.id,
      status: row.status,
      image_name: row.image_name,
      template_id: row.template_id,
      template_version: row.template_version,
      error_code: row.error_code,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      results: []
    }))
  });
}

export async function getJob(db: D1Database, workspace: Workspace, id: string): Promise<Response> {
  const job = await db
    .prepare(
      `SELECT id, status, template_id, template_version, image_name, error_code, error_message,
              created_at, updated_at, completed_at
       FROM jobs
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(id, workspace.id)
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
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at
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
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
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

export async function deleteJob(env: Env, workspace: Workspace, id: string): Promise<Response> {
  const existing = await env.DB
    .prepare(
      `SELECT id, image_r2_key
       FROM jobs
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(id, workspace.id)
    .first<{ id: string; image_r2_key: string | null }>();

  if (!existing) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_results WHERE job_id = ?").bind(id),
    env.DB.prepare("DELETE FROM jobs WHERE id = ? AND workspace_id = ?").bind(id, workspace.id)
  ]);

  const imageKey = String(existing.image_r2_key || "").trim();
  if (imageKey) {
    await env.IMAGES_BUCKET.delete(imageKey);
  }

  return new Response(null, { status: 204 });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
