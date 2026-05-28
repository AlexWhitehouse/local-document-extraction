import { HttpError, json } from "../lib/http";
import { nowIso } from "../lib/ids";
import type { Workspace } from "../lib/types";
import { getWorkspaceProductStore } from "../lib/workspaceProductStoreClient";

const DEFAULT_JOBS_LIMIT = 200;
const MAX_JOBS_LIMIT = 200;

type JobListCursor = {
  sort: string;
  id: string;
};

export async function listJobs(request: Request, env: Env, workspace: Workspace): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const search = normalizeSearch(url.searchParams.get("search"));
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const productStore = getWorkspaceProductStore(env, workspace.id);

  const page = await productStore.listExtractionJobs({ limit, search, cursor });

  return json({
    jobs: page.jobs,
    next_cursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    has_more: page.has_more
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

export async function getJob(env: Env, workspace: Workspace, id: string): Promise<Response> {
  const productStore = getWorkspaceProductStore(env, workspace.id);
  const job = await productStore.getExtractionJob(id);

  if (!job) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  return json(job);
}

export async function deleteJob(env: Env, workspace: Workspace, id: string): Promise<Response> {
  const productStore = getWorkspaceProductStore(env, workspace.id);
  const deletionCandidate = await productStore.getExtractionJobDeletionCandidate(id);
  if (!deletionCandidate) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  if (deletionCandidate.source_file_key) {
    await env.SOURCE_FILES_BUCKET.delete(deletionCandidate.source_file_key);
  }

  await productStore.deleteExtractionJob({
    jobId: id,
    deletedAt: nowIso(),
  });

  return new Response(null, { status: 204 });
}
