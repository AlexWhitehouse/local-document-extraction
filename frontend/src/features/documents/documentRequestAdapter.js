export function createDocumentRequestAdapter({ request }) {
  function normalizedDocumentId(documentId) {
    const value = String(documentId || "").trim();
    if (!value) {
      throw new Error("Document ID is required");
    }
    return value;
  }

  return {
    getDocument(documentId) {
      const normalizedId = normalizedDocumentId(documentId);
      return request(
        `/jobs/${encodeURIComponent(normalizedId)}`,
        { method: "GET" },
      );
    },
    async listDocuments({ search = "", cursor = null } = {}) {
      const params = new URLSearchParams();
      const normalizedSearch = String(search || "").trim();
      const normalizedCursor = String(cursor || "").trim();
      if (normalizedSearch) {
        params.set("search", normalizedSearch);
      }
      if (normalizedCursor) {
        params.set("cursor", normalizedCursor);
      }
      const result = await request(
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
      const result = await request(
        `/jobs/${encodeURIComponent(normalizedId)}`,
        { method: "DELETE" },
      );
      if (result?.deleted !== true || result.job_id !== normalizedId) {
        throw new Error("Document deletion returned an invalid response");
      }
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
      const result = await request("/jobs/export", {
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
      return request("/extract", { method: "POST", body: formData });
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
