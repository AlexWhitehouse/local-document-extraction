export const COMPLETED_DOCUMENT_CACHE_STORAGE_KEY =
  "documentextraction.completedDocuments.v1";

const MAX_COMPLETED_DOCUMENTS_PER_WORKSPACE = 50;

export function createCompletedDocumentCache({ storage } = {}) {
  const backingStorage = storage || getBrowserStorage();
  let cache = loadCache(backingStorage);

  function persist() {
    if (!backingStorage) {
      return;
    }
    backingStorage.setItem(
      COMPLETED_DOCUMENT_CACHE_STORAGE_KEY,
      JSON.stringify(cache),
    );
  }

  return {
    get(workspaceId, jobId) {
      const workspaceCache = cache[normalizeId(workspaceId)] || [];
      const entry = workspaceCache.find(
        (document) => document.job_id === normalizeId(jobId),
      );
      return entry ? clone(entry) : null;
    },
    store(workspaceId, document) {
      const normalizedWorkspaceId = normalizeId(workspaceId);
      const sanitized = sanitizeCompletedDocument(document);
      if (!normalizedWorkspaceId || !sanitized) {
        return null;
      }

      const withoutCurrent = (cache[normalizedWorkspaceId] || []).filter(
        (entry) => entry.job_id !== sanitized.job_id,
      );
      cache = {
        ...cache,
        [normalizedWorkspaceId]: [sanitized, ...withoutCurrent].slice(
          0,
          MAX_COMPLETED_DOCUMENTS_PER_WORKSPACE,
        ),
      };
      persist();
      return clone(sanitized);
    },
    remove(workspaceId, jobId) {
      const normalizedWorkspaceId = normalizeId(workspaceId);
      const normalizedJobId = normalizeId(jobId);
      if (!normalizedWorkspaceId || !normalizedJobId) {
        return;
      }

      const workspaceCache = cache[normalizedWorkspaceId] || [];
      const nextWorkspaceCache = workspaceCache.filter(
        (entry) => entry.job_id !== normalizedJobId,
      );
      if (nextWorkspaceCache.length === workspaceCache.length) {
        return;
      }
      cache = { ...cache, [normalizedWorkspaceId]: nextWorkspaceCache };
      persist();
    },
    clearWorkspace(workspaceId) {
      const normalizedWorkspaceId = normalizeId(workspaceId);
      if (!normalizedWorkspaceId || !cache[normalizedWorkspaceId]) {
        return;
      }

      const next = { ...cache };
      delete next[normalizedWorkspaceId];
      cache = next;
      persist();
    },
    clearAll() {
      cache = {};
      persist();
    },
    pruneFromJobList(workspaceId, jobs, { filtered = false } = {}) {
      const normalizedWorkspaceId = normalizeId(workspaceId);
      if (filtered || !normalizedWorkspaceId) {
        return;
      }

      const workspaceCache = cache[normalizedWorkspaceId] || [];
      const listedJobIds = new Set(
        (Array.isArray(jobs) ? jobs : [])
          .map((job) => normalizeId(job?.job_id))
          .filter(Boolean),
      );
      const nextWorkspaceCache = workspaceCache.filter((entry) =>
        listedJobIds.has(entry.job_id),
      );
      if (nextWorkspaceCache.length === workspaceCache.length) {
        return;
      }
      cache = { ...cache, [normalizedWorkspaceId]: nextWorkspaceCache };
      persist();
    },
  };
}

function sanitizeCompletedDocument(document) {
  if (!document || String(document.status || "") !== "completed") {
    return null;
  }

  const jobId = normalizeId(document.job_id);
  if (!jobId) {
    return null;
  }

  const sanitized = {
    job_id: jobId,
    status: "completed",
    source_name: document.source_name || null,
    results: Array.isArray(document.results) ? clone(document.results) : [],
  };

  for (const key of [
    "template_id",
    "source_mime_type",
    "queued_at",
    "created_at",
    "updated_at",
    "completed_at",
    "current_attempt",
    "completed_attempt",
  ]) {
    if (document[key] !== undefined) {
      sanitized[key] = document[key];
    }
  }

  return sanitized;
}

function loadCache(storage) {
  if (!storage) {
    return {};
  }

  try {
    const parsed = JSON.parse(
      storage.getItem(COMPLETED_DOCUMENT_CACHE_STORAGE_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function normalizeId(value) {
  return String(value || "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
