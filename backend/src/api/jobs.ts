import { HttpError, json } from "../lib/http";
import { deleteJobCascade } from "../lib/cascadeDelete";
import type { Workspace } from "../lib/types";

const DEFAULT_JOBS_LIMIT = 200;
const MAX_JOBS_LIMIT = 200;
const DURABLE_JOB_STATUS_SQL = "'queued', 'processing', 'completed', 'failed'";
const DURABLE_JOB_STATUSES = new Set(["queued", "processing", "completed", "failed"]);

type JobListCursor = {
  sort: string;
  id: string;
};

type JobListRow = {
  id: string;
  status: string;
  template_id: string;
  template_version: number;
  source_name: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  current_attempt: number | null;
  completed_attempt: number | null;
  last_failed_attempt: number | null;
  sort_at: string;
};

export async function listJobs(request: Request, db: D1Database, workspace: Workspace): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const search = normalizeSearch(url.searchParams.get("search"));
  const cursor = parseCursor(url.searchParams.get("cursor"));

  const filters = ["j.workspace_id = ?", `j.status IN (${DURABLE_JOB_STATUS_SQL})`];
  const params: Array<string | number> = [workspace.id];

  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    filters.push(
      `(j.id LIKE ? ESCAPE '\\' OR j.source_name LIKE ? ESCAPE '\\' OR j.template_id LIKE ? ESCAPE '\\' OR j.status LIKE ? ESCAPE '\\')`
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  if (cursor) {
    filters.push("(COALESCE(j.updated_at, j.created_at) < ? OR (COALESCE(j.updated_at, j.created_at) = ? AND j.id < ?))");
    params.push(cursor.sort, cursor.sort, cursor.id);
  }

  const rows = await db
    .prepare(
      `SELECT j.id, j.status, j.template_id, j.template_version, j.source_name, j.error_code, j.error_message,
              j.created_at, j.updated_at, j.completed_at, j.current_attempt, j.completed_attempt, j.last_failed_attempt,
              COALESCE(j.updated_at, j.created_at) AS sort_at
       FROM jobs j
       WHERE ${filters.join(" AND ")}
       ORDER BY COALESCE(j.updated_at, j.created_at) DESC, j.id DESC
       LIMIT ?`
    )
    .bind(...params, limit + 1)
    .all<JobListRow>();

  const durableRows = rows.results.filter((row) => DURABLE_JOB_STATUSES.has(row.status));
  const page = durableRows.slice(0, limit);
  const last = page[page.length - 1] || null;
  const hasMore = rows.results.length > limit;

  return json({
    jobs: page.map((row) => ({
      job_id: row.id,
      status: row.status,
      source_name: row.source_name,
      template_id: row.template_id,
      template_version: row.template_version,
      error_code: row.error_code,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      current_attempt: Number(row.current_attempt || 0),
      completed_attempt: Number(row.completed_attempt || 0),
      last_failed_attempt: Number(row.last_failed_attempt || 0),
      results: []
    })),
    next_cursor: hasMore && last ? encodeCursor({ sort: last.sort_at, id: last.id }) : null,
    has_more: hasMore
  });
}

function parseLimit(value: string | null): number {
  if (!value) {
    return DEFAULT_JOBS_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "invalid_limit", "limit must be a positive integer");
  }

  return Math.min(parsed, MAX_JOBS_LIMIT);
}

function normalizeSearch(value: string | null): string {
  return String(value || "").trim().slice(0, 120);
}

function parseCursor(value: string | null): JobListCursor | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(raw)) as Partial<JobListCursor>;
    if (typeof decoded.sort === "string" && typeof decoded.id === "string" && decoded.sort && decoded.id) {
      return { sort: decoded.sort, id: decoded.id };
    }
  } catch {
    // fall through to typed API error
  }

  throw new HttpError(400, "invalid_cursor", "cursor is invalid");
}

function encodeCursor(cursor: JobListCursor): string {
  return btoa(JSON.stringify(cursor));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function getJob(db: D1Database, workspace: Workspace, id: string): Promise<Response> {
  const job = await db
    .prepare(
      `SELECT id, status, template_id, template_version, source_name, error_code, error_message,
              created_at, updated_at, completed_at, current_attempt, completed_attempt, last_failed_attempt
       FROM jobs
        WHERE id = ? AND workspace_id = ? AND status IN (${DURABLE_JOB_STATUS_SQL})`
    )
    .bind(id, workspace.id)
    .first<{
      id: string;
      status: string;
      template_id: string;
      template_version: number;
      source_name: string | null;
      error_code: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
      current_attempt: number | null;
      completed_attempt: number | null;
      last_failed_attempt: number | null;
    }>();

  if (!job) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  if (!DURABLE_JOB_STATUSES.has(job.status)) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  if (job.status !== "completed") {
    return json({
      job_id: job.id,
      status: job.status,
      source_name: job.source_name,
      template_id: job.template_id,
      template_version: job.template_version,
      error_code: job.error_code,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
      current_attempt: Number(job.current_attempt || 0),
      completed_attempt: Number(job.completed_attempt || 0),
      last_failed_attempt: Number(job.last_failed_attempt || 0)
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
    source_name: job.source_name,
    template_id: job.template_id,
    template_version: job.template_version,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    current_attempt: Number(job.current_attempt || 0),
    completed_attempt: Number(job.completed_attempt || 0),
    last_failed_attempt: Number(job.last_failed_attempt || 0),
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
  await deleteJobCascade(env, workspace, id);
  return new Response(null, { status: 204 });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
