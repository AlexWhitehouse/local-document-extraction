import { createByteBoundedCache } from "./byteBoundedCache";

export const COMPLETED_DOCUMENT_CACHE_STORAGE_KEY =
  "documentextraction.completedDocuments.v1";

const MAX_COMPLETED_DOCUMENTS_PER_WORKSPACE = 50;

export function createCompletedDocumentCache({ storage, maxBytes = 2 * 1024 * 1024 } = {}) {
  const backingStorage = storage || getBrowserStorage();
  const cache = createByteBoundedCache({ maxBytes, maxEntries: 500 });
  const key = (workspaceId, jobId) => `${workspaceId}\0${jobId}`;
  const initial = loadCache(backingStorage, maxBytes);
  for (const [workspaceId, documents] of Object.entries(initial)) {
    if (!Array.isArray(documents)) continue;
    for (const document of documents.slice(0, MAX_COMPLETED_DOCUMENTS_PER_WORKSPACE).reverse()) {
      const sanitized = sanitizeCompletedDocument(document);
      if (sanitized) cache.set(key(workspaceId, sanitized.job_id), { workspaceId, document: sanitized });
    }
  }
  function persist() {
    if (!backingStorage) return;
    const serialized = Object.create(null);
    for (const { workspaceId, document } of cache.values().reverse()) {
      (serialized[workspaceId] ||= []).push(document);
    }
    backingStorage.setItem(COMPLETED_DOCUMENT_CACHE_STORAGE_KEY, JSON.stringify(serialized));
  }
  function removeMatching(predicate) {
    let changed = false;
    for (const entry of cache.values()) {
      if (!predicate(entry)) continue;
      cache.delete(key(entry.workspaceId, entry.document.job_id));
      changed = true;
    }
    if (changed) persist();
  }
  return {
    get(workspaceId, jobId) {
      const entry = cache.get(key(normalizeId(workspaceId), normalizeId(jobId)));
      return entry ? clone(entry.document) : null;
    },
    store(workspaceId, document) {
      workspaceId = normalizeId(workspaceId);
      const sanitized = sanitizeCompletedDocument(document);
      if (!workspaceId || !sanitized) return null;
      const accepted = cache.set(key(workspaceId, sanitized.job_id), { workspaceId, document: sanitized });
      const workspaceEntries = cache.values().filter((entry) => entry.workspaceId === workspaceId);
      for (const entry of workspaceEntries.slice(0, Math.max(0, workspaceEntries.length - MAX_COMPLETED_DOCUMENTS_PER_WORKSPACE))) {
        cache.delete(key(workspaceId, entry.document.job_id));
      }
      persist();
      return accepted ? clone(sanitized) : null;
    },
    remove(workspaceId, jobId) {
      removeMatching((entry) => entry.workspaceId === normalizeId(workspaceId) && entry.document.job_id === normalizeId(jobId));
    },
    clearWorkspace(workspaceId) { removeMatching((entry) => entry.workspaceId === normalizeId(workspaceId)); },
    clearAll() { cache.clear(); persist(); },
    pruneFromJobList(workspaceId, jobs, { filtered = false } = {}) {
      if (filtered) return;
      const listed = new Set((Array.isArray(jobs) ? jobs : []).map((job) => normalizeId(job?.job_id)));
      removeMatching((entry) => entry.workspaceId === normalizeId(workspaceId) && !listed.has(entry.document.job_id));
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

function loadCache(storage, maxBytes) {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(COMPLETED_DOCUMENT_CACHE_STORAGE_KEY) || "{}";
    if (raw.length * 2 > maxBytes) return {};
    const parsed = JSON.parse(raw);
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
  return structuredClone(value);
}
