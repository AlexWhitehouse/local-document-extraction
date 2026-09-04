import { createByteBoundedCache } from "../../lib/byteBoundedCache";

export function createDocumentRequestAdapter({ request, cacheMaxBytes } ) {
  // Reconciliation owns publication and access-recovery effects, after checking
  // the session and Workspace that originated the request.
  const documentRequest = (path, options) => request(path, {
    ...options, publishResponse: false, recoverForbiddenAccess: false,
  });
  const documentValidators = createByteBoundedCache({ maxBytes: cacheMaxBytes });
  function normalizedDocumentId(documentId) {
    const value = String(documentId || "").trim();
    if (!value) {
      throw new Error("Document ID is required");
    }
    return value;
  }

  return {
    async getFilterOptions() {
      const result = await documentRequest("/jobs/filter-options", { method: "GET" });
      return {
        available_models: Array.isArray(result?.available_models)
          ? result.available_models.map((model) => String(model)).filter(Boolean)
          : [],
      };
    },
    async getDocument(documentId) {
      const normalizedId = normalizedDocumentId(documentId);
      const cached = documentValidators.get(normalizedId) || null;
      const headers = new Headers();
      if (cached?.etag) {
        headers.set("if-none-match", cached.etag);
      }
      const result = await documentRequest(
        `/jobs/${encodeURIComponent(normalizedId)}`,
        { method: "GET", headers, responseType: "conditional-json" },
      );
      if (result?.notModified) {
        if (!cached?.data) {
          throw new Error("Conditional Document response has no cached representation");
        }
        return cached.data;
      }
      const data = result?.data ?? result;
      const etag = result?.headers?.get?.("etag") || "";
      if (data && etag) {
        documentValidators.set(normalizedId, { data, etag });
      }
      return data;
    },
    async listDocuments({ search = "", cursor = null, filters = {} } = {}) {
      const params = new URLSearchParams();
      const normalizedSearch = String(search || "").trim();
      const normalizedCursor = String(cursor || "").trim();
      const normalizedDateFrom = String(filters?.dateFrom || "").trim();
      const normalizedDateTo = String(filters?.dateTo || "").trim();
      const normalizedModel = String(filters?.model || "").trim();
      if (normalizedSearch) {
        params.set("search", normalizedSearch);
      }
      if (normalizedDateFrom) {
        params.set("date_from", normalizedDateFrom);
      }
      if (normalizedDateTo) {
        params.set("date_to", normalizedDateTo);
      }
      if (normalizedModel) {
        params.set("model", normalizedModel);
      }
      if (normalizedCursor) {
        params.set("cursor", normalizedCursor);
      }
      const result = await documentRequest(
        `/jobs${params.size ? `?${params.toString()}` : ""}`,
        { method: "GET" },
      );
      const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
      const total = Number(result?.total);
      return {
        jobs,
        total: Number.isFinite(total) && total >= 0 ? total : jobs.length,
        next_cursor: result?.next_cursor || null,
        has_more: Boolean(result?.has_more),
      };
    },
    async deleteDocument(documentId) {
      const normalizedId = normalizedDocumentId(documentId);
      const result = await documentRequest(
        `/jobs/${encodeURIComponent(normalizedId)}`,
        { method: "DELETE" },
      );
      if (result?.deleted !== true || result.job_id !== normalizedId) {
        throw new Error("Document deletion returned an invalid response");
      }
      documentValidators.delete(normalizedId);
      return { deleted: true, job_id: normalizedId };
    },
    async exportDocuments(documentIds) {
      const jobIds = Array.from(new Set(
        (Array.isArray(documentIds) ? documentIds : [])
          .map((documentId) => String(documentId || "").trim())
          .filter(Boolean),
      ));
      if (!jobIds.length) {
        throw new Error("Select at least one job to export");
      }
      const result = await documentRequest("/jobs/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_ids: jobIds }),
        responseType: "blob",
      });
      if (!result?.blob) {
        throw new Error("Job export returned an invalid response");
      }
      return {
        blob: result.blob,
        filename: responseFilename(result.headers) || "job-export.xlsx",
        exportedCount: responseCount(result.headers, "x-exported-job-count"),
        skippedCount: responseCount(result.headers, "x-skipped-job-count"),
      };
    },
    submitDocument(formData) {
      return documentRequest("/extract", { method: "POST", body: formData });
    },
  };
}

function responseFilename(headers) {
  const contentDisposition = headers?.get?.("content-disposition") || "";
  const quoted = contentDisposition.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const unquoted = contentDisposition.match(/filename=([^;]+)/i);
  return unquoted?.[1]?.trim() || "";
}

function responseCount(headers, name) {
  const value = Number(headers?.get?.(name));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
