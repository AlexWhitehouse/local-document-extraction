import { createCompletedDocumentCache } from "../../lib/completedDocumentCache";

const LIVE_STATUSES = new Set(["queued", "processing"]);
const TERMINAL_STATUSES = new Set(["completed", "failed"]);
const EMPTY_FILTERS = { dateFrom: "", dateTo: "", model: "" };
const normalizeId = (value) => String(value || "").trim();
const sortDocuments = (a, b) => Date.parse(b.created_at || b.queued_at || "") - Date.parse(a.created_at || a.queued_at || "");
const normalizeModels = (models) => [...new Set((models || []).map(normalizeId).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function documentScopeKey(sessionId, workspaceId, enabled) {
  return enabled && sessionId && workspaceId ? `${sessionId}\0${workspaceId}` : "";
}

function emptySnapshot(scopeKey = "") {
  return {
    scopeKey, documents: [], selectedDocument: null, selectedDocumentId: "", selectedDocumentIds: [],
    search: "", debouncedSearch: "", filters: { ...EMPTY_FILTERS }, availableModels: [],
    totalDocuments: 0, nextCursor: null, hasMore: false, loadingMore: false,
    loadingDocumentId: "", uploading: false, deleting: false, exporting: false,
  };
}

export const EMPTY_DOCUMENT_SNAPSHOT = emptySnapshot();

/**
 * Owns Document request lifetimes and the state accepted from them. A Workspace
 * change retires its reads and UI effects; a session change also stops unsent
 * batch entries. Every batch captures its original request adapter once.
 */
export function createDocumentReconciliation({
  cache = createCompletedDocumentCache(),
  initialWorkspace = {},
  createPreview = (file) => file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
  revokePreview = (url) => URL.revokeObjectURL(url),
} = {}) {
  let snapshot = emptySnapshot();
  let context = null;
  let session = null;
  let endedSessionId = null;
  let blockedScopeKey = null;
  let initialized = false;
  let submissionRevision = 0;
  const listeners = new Set();
  const modelOptions = new Map();

  const isCurrent = (ctx) => context === ctx && ctx.active && ctx.session.active;
  const notify = () => { for (const listener of listeners) listener(); };
  const emit = (ctx, name, ...args) => { if (isCurrent(ctx)) ctx.callbacks[name]?.(...args); };
  // Browser persistence is an optimization; quota/permission failures must not
  // turn a successful server mutation into a failed Document action.
  const cached = (method, ...args) => { try { return cache[method](...args); } catch { return undefined; } };

  function publish(ctx, patch = {}) {
    if (!isCurrent(ctx)) return;
    const next = { ...snapshot, ...patch };
    next.documents = [...ctx.rows.values()]
      .filter((job) => matchesQuery(job, next.debouncedSearch, next.filters)).sort(sortDocuments);
    next.selectedDocument = next.documents.find((job) => job.job_id === next.selectedDocumentId) || next.documents[0] || null;
    next.selectedDocumentId = next.selectedDocument?.job_id || "";
    const visible = new Set(next.documents.map((job) => job.job_id));
    next.selectedDocumentIds = next.selectedDocumentIds.filter((id) => visible.has(id));
    snapshot = next;
    notify();
  }

  function retire() {
    if (!context) return;
    context.active = false;
    clearTimeout(context.refreshTimer);
    clearTimeout(context.searchTimer);
    for (const url of context.previews.values()) revokePreview(url);
    context.previews.clear();
    context = null;
  }

  function configure({ sessionId, workspaceId, enabled, requests, callbacks = {} }) {
    sessionId = normalizeId(sessionId);
    workspaceId = normalizeId(workspaceId);
    if (session?.id !== sessionId) {
      if (session) {
        session.active = false;
        if (session.id) cached("clearAll");
      }
      session = { id: sessionId, active: Boolean(sessionId) };
      endedSessionId = null;
      modelOptions.clear();
    }
    const key = documentScopeKey(sessionId, workspaceId, enabled);
    if (blockedScopeKey && blockedScopeKey !== key) blockedScopeKey = null;
    if (context?.key === key && session.active) {
      context.requests = requests;
      context.callbacks = callbacks;
      return;
    }
    if (!key || endedSessionId === sessionId || blockedScopeKey === key) {
      if (context || snapshot.scopeKey) {
        cached("clearAll");
        retire();
        snapshot = emptySnapshot();
        notify();
      }
      return;
    }
    if (context) cached("clearAll");
    retire();
    snapshot = emptySnapshot(key);
    context = {
      key, workspaceId, requests, callbacks, session, active: true,
      rows: new Map(), known: new Set(), deleted: new Set(), revisions: new Map(), previews: new Map(),
      revision: 0, countRevision: 0, queryRevision: 0, listRequest: 0,
      details: new Map(), detailAttempts: new Map(), hydrated: new Map(), modelsRequest: null,
      refreshTimer: null, searchTimer: null,
    };
    if (!initialized) {
      for (const job of initialWorkspace.jobHistory || []) {
        context.rows.set(job.job_id, job);
        context.known.add(job.job_id);
      }
      snapshot.selectedDocumentId = initialWorkspace.selectedDocumentId || "";
      initialized = true;
    }
    publish(context);
  }

  function clear({ sessionEnded = false } = {}) {
    blockedScopeKey = context?.key || snapshot.scopeKey;
    if (sessionEnded && session) {
      session.active = false;
      endedSessionId = session.id;
      modelOptions.clear();
    }
    if (context || sessionEnded) cached("clearAll");
    retire();
    snapshot = emptySnapshot();
    notify();
  }

  function changed(ctx, id) {
    ctx.revisions.set(id, ++ctx.revision);
  }

  function scheduleRefresh(ctx) {
    if (!isCurrent(ctx) || ctx.refreshTimer) return;
    ctx.refreshTimer = setTimeout(() => {
      ctx.refreshTimer = null;
      if (isCurrent(ctx)) void refresh();
    }, 150);
  }

  function rememberModel(ctx, name) {
    if (!name) return;
    const models = normalizeModels([...snapshot.availableModels, name]);
    modelOptions.set(ctx.workspaceId, models);
    snapshot = { ...snapshot, availableModels: models };
  }

  function merge(ctx, incoming, { details = false, countNew = false, observe = true } = {}) {
    const id = normalizeId(incoming?.job_id);
    if (!id || ctx.deleted.has(id)) return null;
    const existing = ctx.rows.get(id);
    if (isOlder(incoming, existing)) return existing;
    const next = { ...existing, ...incoming, job_id: id };
    for (const field of ["source_name", "source_mime_type", "source_preview_url", "created_at", "queued_at"]) {
      next[field] = existing?.[field] || incoming[field] || null;
    }
    if (!details) {
      // List responses deliberately contain results: []; live updates omit
      // results. Neither is evidence that hydrated Extraction results vanished.
      const completed = ctx.hydrated.get(id) === version(existing) ? existing : cached("get", ctx.workspaceId, id);
      if (next.status === "completed" && completed && !isOlder(completed, next)) {
        next.results = completed.results;
        if (Array.isArray(completed.results)) ctx.hydrated.set(id, version(next));
      } else if (!Object.hasOwn(incoming, "results") && existing?.results) {
        next.results = existing.results;
      }
    }
    if (countNew && incoming.status === "queued" && !ctx.known.has(id)) {
      snapshot = { ...snapshot, totalDocuments: snapshot.totalDocuments + 1 };
      ctx.countRevision = ctx.revision + 1;
    }
    ctx.known.add(id);
    if (observe && (!details || !sameVersion(incoming, existing))) changed(ctx, id);
    ctx.rows.set(id, next);
    rememberModel(ctx, next.model_name);
    return next;
  }

  async function refresh({ append = false } = {}) {
    const ctx = context;
    if (!ctx || !isCurrent(ctx)) return;
    if (append && (!snapshot.hasMore || !snapshot.nextCursor || snapshot.loadingMore)) return;
    const queryRevision = ctx.queryRevision;
    const requestId = ++ctx.listRequest;
    const revision = ctx.revision;
    const { debouncedSearch: search, filters, nextCursor } = snapshot;
    publish(ctx, { loadingMore: append });
    try {
      const data = await ctx.requests.listDocuments({ search, filters, cursor: append ? nextCursor : null });
      if (!isCurrent(ctx) || queryRevision !== ctx.queryRevision || requestId !== ctx.listRequest) return;
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const listed = new Set(jobs.map((job) => normalizeId(job.job_id)));
      let overlap = ctx.revision !== revision;
      for (const job of jobs) {
        const id = normalizeId(job.job_id);
        if ((ctx.revisions.get(id) || 0) > revision || ctx.deleted.has(id)) {
          if ((ctx.revisions.get(id) || 0) > revision) overlap = true;
          continue;
        }
        merge(ctx, job, { observe: false });
      }
      if (!append) {
        for (const id of ctx.rows.keys()) {
          if (!listed.has(id) && (ctx.revisions.get(id) || 0) <= revision) ctx.rows.delete(id);
        }
      }
      if (!append && !data?.has_more && !overlap) {
        cached("pruneFromJobList", ctx.workspaceId, jobs, { filtered: Boolean(search || Object.values(filters).some(Boolean)) });
      }
      const total = Number.isFinite(data?.total) ? data.total : jobs.length;
      publish(ctx, {
        totalDocuments: ctx.countRevision > revision ? snapshot.totalDocuments : total,
        nextCursor: data?.next_cursor || null, hasMore: Boolean(data?.has_more),
      });
      emit(ctx, "onResponse", data);
      if (overlap) scheduleRefresh(ctx);
    } catch (error) {
      if (isCurrent(ctx) && queryRevision === ctx.queryRevision && requestId === ctx.listRequest) {
        emit(ctx, "onLog", `List documents failed: ${error.message}`);
        if (error.status === 403) emit(ctx, "onAccessDenied");
      }
    } finally {
      if (isCurrent(ctx) && requestId === ctx.listRequest) publish(ctx, { loadingMore: false });
    }
  }

  function setQuery(patch) {
    const ctx = context;
    if (!ctx) return;
    ctx.queryRevision += 1;
    publish(ctx, { ...patch, nextCursor: null, hasMore: false, loadingMore: false });
    void refresh();
  }

  function setSearch(search) {
    const ctx = context;
    if (!ctx) return;
    ctx.queryRevision += 1;
    clearTimeout(ctx.searchTimer);
    publish(ctx, { search, nextCursor: null, hasMore: false });
    ctx.searchTimer = setTimeout(() => {
      ctx.searchTimer = null;
      if (isCurrent(ctx)) setQuery({ debouncedSearch: search.trim() });
    }, 250);
  }

  function setFilters(filters) {
    setQuery({ filters: Object.fromEntries(Object.keys(EMPTY_FILTERS).map((key) => [key, normalizeId(filters?.[key])])) });
  }

  function receiveLiveUpdates(jobs, scopeKey = snapshot.scopeKey) {
    const ctx = context;
    if (!ctx || ctx.key !== scopeKey || !isCurrent(ctx)) return;
    for (const job of jobs) merge(ctx, job, { countNew: true });
    publish(ctx);
  }

  function remove(ctx, id) {
    if (ctx.deleted.has(id)) return;
    changed(ctx, id);
    ctx.deleted.add(id);
    ctx.rows.delete(id);
    if (ctx.known.delete(id)) {
      snapshot = { ...snapshot, totalDocuments: Math.max(0, snapshot.totalDocuments - 1) };
      ctx.countRevision = ctx.revision;
    }
    if (ctx.previews.has(id)) revokePreview(ctx.previews.get(id));
    ctx.previews.delete(id);
    cached("remove", ctx.workspaceId, id);
    emit(ctx, "onResponse", null);
  }

  function ensureSelectedDetails() {
    const ctx = context;
    const job = snapshot.selectedDocument;
    if (!ctx || !job) return;
    const fingerprint = version(job);
    if (ctx.hydrated.get(job.job_id) === fingerprint || ctx.detailAttempts.get(job.job_id) === fingerprint) return;
    ctx.detailAttempts.set(job.job_id, fingerprint);
    return loadDetails(job.job_id, { showLoading: true });
  }

  async function loadDetails(id, { showLoading = false } = {}) {
    const ctx = context;
    id = normalizeId(id);
    if (!ctx || !id || ctx.deleted.has(id) || !isCurrent(ctx)) return;
    if (ctx.details.has(id)) return ctx.details.get(id);
    const revision = ctx.revision;
    if (showLoading) publish(ctx, { loadingDocumentId: id });
    const request = (async () => {
      try {
        const data = await ctx.requests.getDocument(id);
        if (!isCurrent(ctx) || ctx.deleted.has(id)) return;
        if (!data?.job_id) return null;
        const existing = ctx.rows.get(id);
        const conflict = (ctx.revisions.get(id) || 0) > revision;
        if (isOlder(data, existing) || (conflict && !sameVersion(data, existing))) {
          scheduleRefresh(ctx);
          // Once this request settles, selected-detail hydration can retry the
          // observation that arrived while it was in flight.
          if (conflict) ctx.detailAttempts.delete(id);
          return existing;
        }
        const wasLive = LIVE_STATUSES.has(existing?.status);
        const next = merge(ctx, data, { details: true });
        ctx.hydrated.set(id, version(next));
        if (next.status === "completed") cached("store", ctx.workspaceId, next);
        publish(ctx);
        emit(ctx, "onResponse", data);
        if (wasLive && TERMINAL_STATUSES.has(next.status)) emit(ctx, "onCapacityChange");
        return next;
      } catch (error) {
        if (!isCurrent(ctx) || ctx.deleted.has(id)) return;
        if (error.status === 404) {
          if ((ctx.revisions.get(id) || 0) > revision) { scheduleRefresh(ctx); return; }
          remove(ctx, id);
          publish(ctx);
          return;
        }
        if (error.status === 403) emit(ctx, "onAccessDenied");
        return null;
      }
    })().finally(() => {
      if (ctx.details.get(id) === request) ctx.details.delete(id);
      if (isCurrent(ctx) && snapshot.loadingDocumentId === id) publish(ctx, { loadingDocumentId: "" });
    });
    ctx.details.set(id, request);
    return request;
  }

  async function loadModels({ force = false } = {}) {
    const ctx = context;
    if (!ctx || !isCurrent(ctx)) return [];
    if (!force && modelOptions.has(ctx.workspaceId)) {
      const models = modelOptions.get(ctx.workspaceId);
      publish(ctx, { availableModels: models });
      return models;
    }
    if (ctx.modelsRequest) return ctx.modelsRequest;
    const revision = ctx.revision;
    ctx.modelsRequest = (async () => {
      try {
        const data = await ctx.requests.getFilterOptions();
        if (!isCurrent(ctx)) return [];
        const models = normalizeModels([...(data?.available_models || []), ...(ctx.revision > revision ? snapshot.availableModels : [])]);
        modelOptions.set(ctx.workspaceId, models);
        publish(ctx, { availableModels: models });
        return models;
      } catch (error) {
        if (error.status === 403) emit(ctx, "onAccessDenied");
        emit(ctx, "onLog", `Load job filter options failed: ${error.message}`);
        return [];
      }
    })().finally(() => { ctx.modelsRequest = null; });
    return ctx.modelsRequest;
  }

  async function submitBatch({ templateId, entries, onProgress, onComplete }) {
    const ctx = context;
    if (!ctx || !isCurrent(ctx) || snapshot.uploading) return;
    const requests = ctx.requests;
    const batchSession = ctx.session;
    const batchRevision = submissionRevision;
    const acceptsBatch = () => isCurrent(ctx) && batchRevision === submissionRevision;
    publish(ctx, { uploading: true });
    let queued = 0;
    let failed = 0;
    try {
      for (const entry of entries) {
        if (!batchSession.active || batchRevision !== submissionRevision) break;
        if (acceptsBatch()) onProgress?.(entry.id, "processing", "");
        let preview = null;
        try {
          const form = new FormData();
          form.append("template_id", templateId);
          form.append("document", entry.file);
          form.append("options", JSON.stringify({ include_confidence: true, include_evidence: true }));
          const result = await requests.submitDocument(form);
          queued += 1;
          if (!acceptsBatch()) continue;
          preview = createPreview(entry.file);
          if (preview) ctx.previews.set(result.job_id, preview);
          merge(ctx, {
            ...result, status: result.status || "queued", template_id: templateId,
            source_name: entry.file.name, source_mime_type: entry.file.type,
            source_preview_url: preview, queued_at: new Date().toISOString(),
          }, { countNew: true });
          publish(ctx, { selectedDocumentId: result.job_id });
          emit(ctx, "onResponse", result);
          emit(ctx, "onCapacityChange");
          onProgress?.(entry.id, "success", "");
        } catch (error) {
          failed += 1;
          if (!acceptsBatch()) continue;
          if (preview) revokePreview(preview);
          onProgress?.(entry.id, "failed", error.message || "Queue failed");
          emit(ctx, "onLog", `Queue failed for ${entry.file.name}: ${error.message}`);
          if (error.status === 403) emit(ctx, "onAccessDenied");
        }
      }
      if (acceptsBatch()) onComplete?.({ queued, failed });
    } finally { publish(ctx, { uploading: false }); }
  }

  async function deleteDocuments(ids, { onComplete } = {}) {
    const ctx = context;
    if (!ctx || !isCurrent(ctx) || snapshot.deleting) return;
    const requests = ctx.requests;
    publish(ctx, { deleting: true });
    try {
      const results = await Promise.all([...new Set(ids.map(normalizeId))].map(async (id) => {
        let alreadyRemoved = false;
        try { await requests.deleteDocument(id); }
        catch (error) {
          if (error.status !== 404) {
            if (error.status === 403) emit(ctx, "onAccessDenied");
            return { documentId: id, removed: false, alreadyRemoved: false };
          }
          alreadyRemoved = true;
        }
        if (isCurrent(ctx)) remove(ctx, id);
        return { documentId: id, removed: true, alreadyRemoved };
      }));
      if (!isCurrent(ctx)) return;
      publish(ctx);
      if (results.some((result) => result.removed)) void loadModels({ force: true });
      onComplete?.(results);
    } finally { publish(ctx, { deleting: false }); }
  }

  async function exportDocuments(ids, { onComplete, onError } = {}) {
    const ctx = context;
    if (!ctx || !isCurrent(ctx) || snapshot.exporting) return;
    publish(ctx, { exporting: true });
    try {
      const result = await ctx.requests.exportDocuments([...ids]);
      if (isCurrent(ctx)) onComplete?.(result);
    } catch (error) {
      if (isCurrent(ctx)) onError?.(error);
      if (error.status === 403) emit(ctx, "onAccessDenied");
    } finally { publish(ctx, { exporting: false }); }
  }

  return {
    cancelPendingSubmissions: () => { submissionRevision += 1; },
    configure, clear, refresh, loadDetails, loadModels, ensureSelectedDetails,
    setSearch, setFilters, receiveLiveUpdates, submitBatch, deleteDocuments, exportDocuments,
    selectDocument: (id) => { if (context) publish(context, { selectedDocumentId: normalizeId(id) }); },
    toggleSelection: (ids, selected) => {
      if (!context) return;
      const selection = new Set(snapshot.selectedDocumentIds);
      for (const id of ids.map(normalizeId)) { if (selected) selection.add(id); else selection.delete(id); }
      publish(context, { selectedDocumentIds: [...selection] });
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: () => { if (session) session.active = false; session = null; retire(); },
  };
}

function version(job) {
  return JSON.stringify([job?.status, job?.updated_at, job?.current_attempt, job?.completed_attempt, job?.template_version]);
}

function sameVersion(a, b) {
  return a?.status === b?.status && !isOlder(a, b) && !isOlder(b, a);
}

function isOlder(incoming, existing) {
  if (!existing) return false;
  if (Number.isFinite(incoming?.current_attempt) && Number.isFinite(existing.current_attempt) && incoming.current_attempt !== existing.current_attempt) {
    return incoming.current_attempt < existing.current_attempt;
  }
  const left = Date.parse(incoming?.updated_at);
  const right = Date.parse(existing.updated_at);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left < right;
  // Multiple lifecycle events can share a timestamp. Within the same attempt,
  // an earlier state must not replace a later state just because it arrives last.
  const rank = { queued: 0, processing: 1, completed: 2, failed: 2 };
  return rank[incoming?.status] < rank[existing.status];
}

function matchesQuery(job, search, filters) {
  const query = search.trim().toLowerCase();
  if (query && ![job.job_id, job.source_name, job.template_id, job.status].some((value) => String(value || "").toLowerCase().includes(query))) return false;
  const date = String(job.created_at || job.queued_at || "").slice(0, 10);
  if (filters.dateFrom && (!date || date < filters.dateFrom)) return false;
  if (filters.dateTo && (!date || date > filters.dateTo)) return false;
  return !filters.model || job.model_name === filters.model;
}
