import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { isBoolean, isJsonArray, isJsonObject, isNumber, isString, parseJson, type JsonValue } from "../../shared/json";
import {
  checkFilterAgainstCatalog,
  normalizeSearchText,
  parseDocumentSearchFilter,
  SEARCH_LIMITS,
  SearchContractError,
  type DocumentSearchFilter,
  type SearchCatalog,
} from "../../shared/documentSearch";
import { HttpError } from "./lib/http";
import { nowIso } from "./lib/ids";
import { parseJsonBody } from "./lib/validation";
import { errorResponse, withAuthorizedProductStore, type ProductServices } from "./localApplication";
import type { JobSearchCursor } from "./jobSearchQuery";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import type { LocalWorkspaceProductStoreHandle } from "./localWorkspaceProductStoreRegistry";

const noStore = { "cache-control": "private, no-store" };

const RETRY_LIMIT = 500;

/** The Workspace's search catalogue, with whether a model can interpret requests. */
export function buildSearchCatalog(store: Pick<LocalWorkspaceProductStoreHandle, "getSearchCatalog" | "getModelConfiguration">): SearchCatalog {
  return {
    ...store.getSearchCatalog(),
    interpretation: store.getModelConfiguration()
      ? { available: true }
      : { available: false, reason: "model_not_configured" },
  };
}

export function handleSearchCatalog({ product, request }: { product: ProductServices; request: Request }) {
  return withAuthorizedProductStore(product, request, ({ store }) =>
    Response.json(buildSearchCatalog(store), { headers: noStore }),
  );
}

type SearchRequest = { filter: DocumentSearchFilter; cursor: string | null; limit: number; idsOnly: boolean };

function readSearchRequest(body: JsonValue): SearchRequest {
  if (!isJsonObject(body)) throw new SearchContractError("Search request must be an object.");
  const extra = Object.keys(body).find((key) => !["filter", "cursor", "limit", "ids_only"].includes(key));

  if (extra) throw new SearchContractError(`Search request has an unknown property "${extra}".`);

  if (body.ids_only !== undefined && !isBoolean(body.ids_only))
    throw new SearchContractError("ids_only must be true or false.");
  const idsOnly = body.ids_only === true;
  const maximum = idsOnly ? SEARCH_LIMITS.idsPageSize : SEARCH_LIMITS.pageSize;
  const limit = body.limit ?? SEARCH_LIMITS.defaultPageSize;

  if (!isNumber(limit) || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum)
    throw new SearchContractError(`limit must be a whole number from 1 to ${maximum}.`);

  const cursor = body.cursor ?? null;

  if (cursor !== null && (!isString(cursor) || !cursor || cursor.length > 2048))
    throw new HttpError(400, "invalid_cursor", "Search cursor is invalid or does not match this filter");

  return { filter: parseDocumentSearchFilter(body.filter), cursor, limit, idsOnly };
}

/** A stable digest of the normalised filter; cursors are only valid for the filter they were issued for. */
function filterFingerprint(filter: DocumentSearchFilter): string {
  const canonical = [
    filter.text ? normalizeSearchText(filter.text) : null,
    [...(filter.statuses ?? [])].sort(),
    [...(filter.template_ids ?? [])].sort(),
    filter.uploaded_from ?? null,
    filter.uploaded_to ?? null,
    filter.model ?? null,
    (filter.conditions ?? []).map((condition) => [
      condition.template_id,
      condition.field_id,
      condition.op,
      isString(condition.value) ? normalizeSearchText(condition.value) : (condition.value ?? null),
      isString(condition.value2) ? normalizeSearchText(condition.value2) : (condition.value2 ?? null),
    ]),
  ];

  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url");
}

function encodeSearchCursor(cursor: JobSearchCursor, fingerprint: string, secret: Uint8Array): string {
  const payload = Buffer.from(
    JSON.stringify({ kind: "document_search", created_at: cursor.createdAt, job_id: cursor.jobId, filter: fingerprint }),
    "utf8",
  ).toString("base64url");

  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function decodeSearchCursor(cursor: string | null, fingerprint: string, secret: Uint8Array): JobSearchCursor | null {
  if (cursor === null) return null;
  const invalid = new HttpError(400, "invalid_cursor", "Search cursor is invalid or does not match this filter");
  const [payload, signature, ...extra] = cursor.split(".");

  if (!payload || !signature || extra.length) throw invalid;
  const signatureBytes = Buffer.from(signature, "base64url");
  const expectedBytes = createHmac("sha256", secret).update(payload).digest();

  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) throw invalid;
  let parsed: JsonValue;

  try {
    parsed = parseJson(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }

  if (
    !isJsonObject(parsed) ||
    parsed.kind !== "document_search" ||
    parsed.filter !== fingerprint ||
    !isString(parsed.created_at) ||
    !isString(parsed.job_id)
  )
    throw invalid;

  return { createdAt: parsed.created_at, jobId: parsed.job_id };
}

export function handleJobSearch({
  product,
  request,
  jobCursorSecret,
}: {
  product: ProductServices;
  request: Request;
  jobCursorSecret: Uint8Array;
}): Promise<Response> {
  return withAuthorizedProductStore(product, request, async ({ store }) => {
    try {
      const search = readSearchRequest(parseJsonBody(await request.text()));
      // Checking a filter needs Templates and fields only; known values are for the palette and interpreter.
      const catalog = store.getSearchFields();
      const filter = checkFilterAgainstCatalog(search.filter, catalog);

      if (filter.template_ids?.some((id) => !catalog.templates.some((template) => template.id === id)))
        throw new SearchContractError("Filter names a template that isn't in this workspace.");

      const fingerprint = filterFingerprint(filter);

      const page = store.searchExtractionJobs({
        filter,
        catalog,
        cursor: decodeSearchCursor(search.cursor, fingerprint, jobCursorSecret),
        limit: search.limit,
        countCap: SEARCH_LIMITS.countCap,
        withMatches: !search.idsOnly,
      });

      const last = page.jobs.at(-1);

      const next_cursor =
        page.has_more && last
          ? encodeSearchCursor({ createdAt: last.created_at, jobId: last.job_id }, fingerprint, jobCursorSecret)
          : null;

      const counts = { total: page.total, total_capped: page.total_capped };

      if (search.idsOnly) {
        return Response.json(
          {
            job_ids: page.jobs.map((job) => job.job_id),
            statuses: Object.fromEntries(page.jobs.map((job) => [job.job_id, job.status])),
            ...counts,
            next_cursor,
            has_more: page.has_more,
          },
          { headers: noStore },
        );
      }

      const summaries = store.getExtractionJobSummaries(page.jobs.map((job) => job.job_id));

      return Response.json(
        {
          jobs: page.jobs.flatMap((job) => {
            const summary = summaries.get(job.job_id);

            return summary ? [{ ...summary, template_name: job.template_name, matches: job.matches }] : [];
          }),
          ...counts,
          next_cursor,
          has_more: page.has_more,
        },
        { headers: noStore },
      );
    } catch (error) {
      if (error instanceof SearchContractError)
        return errorResponse(400, "invalid_search_filter", error.message, noStore);

      if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, noStore);
      throw error;
    }
  });
}

function readRetryJobIds(body: JsonValue): string[] {
  const jobIds = isJsonObject(body) ? body.job_ids : undefined;

  if (!isJsonArray(jobIds) || jobIds.length < 1 || jobIds.length > RETRY_LIMIT)
    throw new HttpError(400, "invalid_job_retry", `job_ids must list 1 to ${RETRY_LIMIT} documents`);
  const normalized = jobIds.map((jobId) => (isString(jobId) ? jobId.trim() : ""));

  if (normalized.some((jobId) => !jobId))
    throw new HttpError(400, "invalid_job_retry", "Every job ID must be a non-empty string");

  return [...new Set(normalized)];
}

/** Moves failed documents back to the queue on their Template's current version. */
export function handleJobRetry({
  product,
  request,
  scheduleQueuedJob,
  liveUpdateHub,
}: {
  product: ProductServices;
  request: Request;
  scheduleQueuedJob: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  liveUpdateHub?: LocalLiveUpdateHub;
}): Promise<Response> {
  return withAuthorizedProductStore(product, request, async ({ store, workspace, assertAuthorized }) => {
    try {
      const jobIds = readRetryJobIds(parseJsonBody(await request.text()));
      assertAuthorized();
      const retriedAt = nowIso();
      const { retried, skipped } = store.retryFailedExtractionJobs({ jobIds, retriedAt });

      for (const job of retried) {
        const summary = liveUpdateHub?.observes(workspace.id) ? store.getExtractionJobSummary(job.job_id) : null;

        if (summary) liveUpdateHub?.broadcastJob(workspace.id, summary);

        try {
          await scheduleQueuedJob({
            job_id: job.job_id,
            workspace_id: workspace.id,
            template_id: job.template_id,
            template_version: job.template_version,
            enqueued_at: retriedAt,
            attempt: job.attempt,
          });
        } catch {
          /* Durable queued job recovery owns dispatch. */
        }
      }

      return Response.json({ retried: retried.map((job) => job.job_id), skipped }, { headers: noStore });
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, noStore);
      throw error;
    }
  });
}
