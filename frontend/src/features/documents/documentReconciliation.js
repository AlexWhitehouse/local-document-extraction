import { createCompletedDocumentCache } from "../../lib/completedDocumentCache";
import { describeError } from "../../lib/describeError";

const LIVE_STATUSES = new Set(["queued", "processing"]);

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

const EMPTY_FILTERS = { dateFrom: "", dateTo: "", model: "" };

const normalizeId = (value) => String(value || "").trim();

const sortDocuments = (a, b) =>
  Date.parse(b.created_at || b.queued_at || "") - Date.parse(a.created_at || a.queued_at || "");

const normalizeModels = (models) => [
  ...new Set(
    (models || []).flatMap((model) => {
      const id = normalizeId(model);

      return id ? [id] : [];
    }),
  ),
];

export function documentScopeKey(sessionId, workspaceId, enabled) {
  return enabled && sessionId && workspaceId ? `${sessionId}\0${workspaceId}` : "";
}

function emptySnapshot(scopeKey = "") {
  return {
    scopeKey,
    documents: [],
    packets: [],
    selectedDocument: null,
    selectedDocumentId: "",
    selectedDocumentIds: [],
    search: "",
    debouncedSearch: "",
    filters: { ...EMPTY_FILTERS },
    availableModels: [],
    totalDocuments: 0,
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    // "loading" until the first Document list read settles; errors keep their cause for Try again.
    listStatus: "loading",
    listError: null,
    loadMoreError: null,
    statusCounts: { queued: 0, processing: 0, completed: 0, failed: 0 },
    loadingDocumentId: "",
    selectedDocumentError: "",
    uploading: false,
    deleting: false,
    exporting: false,
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
  uploadConcurrency = 2,
  createPreview = (file) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
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

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const emit = (ctx, name, ...args) => {
    if (isCurrent(ctx)) ctx.callbacks[name]?.(...args);
  };

  // Browser persistence is an optimization; quota/permission failures must not
  // turn a successful server mutation into a failed Document action.
  const cached = (method, ...args) => {
    try {
      return cache[method](...args);
    } catch {
      return undefined;
    }
  };

  function publish(ctx, patch = {}) {
    if (!isCurrent(ctx)) return;
    const next = { ...snapshot, ...patch };
    next.packets = [...ctx.packets.values()].sort(sortDocuments);

    if (ctx.rowsDirty || next.debouncedSearch !== snapshot.debouncedSearch || next.filters !== snapshot.filters) {
      next.documents = [...ctx.rows.values()]
        .filter((job) => matchesQuery(job, next.debouncedSearch, next.filters))
        .sort(sortDocuments);
      ctx.visible = new Set(next.documents.map((job) => job.job_id));
      ctx.rowsDirty = false;
    }

    next.selectedDocument = ctx.routeDocumentId
      ? ctx.rows.get(ctx.routeDocumentId) || null
      : next.documents.find((job) => job.job_id === next.selectedDocumentId) || next.documents[0] || null;
    next.selectedDocumentId = ctx.routeDocumentId || next.selectedDocument?.job_id || "";
    next.selectedDocumentError = ctx.detailErrors.get(next.selectedDocumentId) || "";
    const selected = next.selectedDocumentIds.filter((id) => ctx.visible.has(id));

    if (selected.length !== next.selectedDocumentIds.length) next.selectedDocumentIds = selected;
    snapshot = next;
    notify();
  }

  function retire() {
    if (!context) return;
    context.active = false;
    clearTimeout(context.refreshTimer);
    clearTimeout(context.countsTimer);
    clearTimeout(context.searchTimer);

    for (const url of context.previews.values()) revokePreview(url);
    context.previews.clear();
    context = null;
  }

  function configure({ sessionId, workspaceId, enabled, requests, callbacks = {}, routeDocumentId = "" }) {
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

      if (context.routeDocumentId !== routeDocumentId) {
        context.routeDocumentId = routeDocumentId;
        publish(context);
      }

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
      key,
      workspaceId,
      requests,
      callbacks,
      session,
      active: true,
      rows: new Map(),
      known: new Set(),
      deleted: new Set(),
      revisions: new Map(),
      previews: new Map(),
      packets: new Map(),
      deletedPackets: new Set(),
      listBoundary: null,
      rowsDirty: true,
      visible: new Set(),
      routeDocumentId,
      detailErrors: new Map(),
      revision: 0,
      countRevision: 0,
      queryRevision: 0,
      listRequest: 0,
      details: new Map(),
      detailAttempts: new Map(),
      hydrated: new Map(),
      modelsRequest: null,
      refreshTimer: null,
      searchTimer: null,
      countsTimer: null,
      countsRequest: 0,
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
    if (!name || snapshot.availableModels.includes(name)) return;
    const models = normalizeModels([name, ...snapshot.availableModels]);
    modelOptions.set(ctx.workspaceId, models);
    snapshot = { ...snapshot, availableModels: models };
  }

  function scheduleCountsRefresh(ctx) {
    if (!isCurrent(ctx) || !ctx.requests.getDocumentCounts || ctx.countsTimer) return;
    ctx.countsTimer = setTimeout(async () => {
      ctx.countsTimer = null;
      const requestId = ++ctx.countsRequest;
      const revision = ctx.revision;

      try {
        const data = await ctx.requests.getDocumentCounts();

        if (!isCurrent(ctx) || requestId !== ctx.countsRequest) return;

        if (ctx.revision !== revision) {
          scheduleCountsRefresh(ctx);

          return;
        }

        publish(ctx, { totalDocuments: data.total, statusCounts: data.status_counts });
      } catch (error) {
        if (error.status === 403) emit(ctx, "onAccessDenied");
      }
    }, 150);
  }

  function merge(ctx, incoming, { details = false, countNew = false, observe = true } = {}) {
    const id = normalizeId(incoming?.job_id);

    if (!id || ctx.deleted.has(id)) return null;
    const existing = ctx.rows.get(id);

    if (isOlder(incoming, existing)) return existing;
    const next = { ...existing, ...incoming, job_id: id };

    if (observe && existing?.status !== next.status) {
      scheduleCountsRefresh(ctx);
    }

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
    ctx.rowsDirty = true;
    rememberModel(ctx, next.model_name);

    return next;
  }

  async function refresh({ append = false } = {}) {
    const ctx = context;

    if (!ctx || !isCurrent(ctx)) return;

    if (append && (!snapshot.hasMore || !snapshot.nextCursor || snapshot.loadingMore)) return;
    const queryRevision = ctx.queryRevision;
    const requestId = ++ctx.listRequest;
    const countsRequestId = ++ctx.countsRequest;
    const revision = ctx.revision;
    const { debouncedSearch: search, filters, nextCursor } = snapshot;
    publish(ctx, append ? { loadingMore: true, loadMoreError: null } : { loadingMore: false });

    try {
      const jobs = [],
        packets = [],
        visited = new Set();

      const boundary = append ? null : ctx.listBoundary;
      let cursor = append ? nextCursor : null;
      let data;
      let last;

      do {
        visited.add(cursor);
        data = ctx.requests.listDocumentEntries
          ? await ctx.requests.listDocumentEntries({ search, filters, cursor })
          : await ctx.requests.listDocuments({ search, filters, cursor });

        if (!isCurrent(ctx) || queryRevision !== ctx.queryRevision || requestId !== ctx.listRequest) return;
        const pageJobs = Array.isArray(data?.jobs) ? data.jobs : [];
        const pagePackets = Array.isArray(data?.packets) ? data.packets : [];
        jobs.push(...pageJobs);
        packets.push(...pagePackets);

        const entries = [
          ...pageJobs.map((job) => ({ createdAt: job.created_at, id: `document:${job.job_id}` })),
          ...pagePackets.map((packet) => ({ createdAt: packet.created_at, id: `packet:${packet.packet_id}` })),
        ].sort(compareEntries);

        last = entries.at(-1);
        cursor = data?.next_cursor;

        if (!ctx.requests.listDocumentEntries || append || !boundary || !last || compareEntries(last, boundary) >= 0)
          break;
      } while (data?.has_more && cursor && !visited.has(cursor));

      if (!isCurrent(ctx) || queryRevision !== ctx.queryRevision || requestId !== ctx.listRequest) return;

      if (ctx.requests.listDocumentEntries) ctx.listBoundary = last || null;
      const listedPackets = new Set(packets.map((packet) => packet.packet_id));

      for (const packet of packets) {
        if (
          !ctx.deletedPackets.has(packet.packet_id) &&
          (ctx.revisions.get(`packet:${packet.packet_id}`) || 0) <= revision
        )
          ctx.packets.set(packet.packet_id, packet);
      }

      if (!append) {
        for (const id of ctx.packets.keys()) {
          if (!listedPackets.has(id) && (ctx.revisions.get(`packet:${id}`) || 0) <= revision) ctx.packets.delete(id);
        }
      }

      // Packet children remain available for selection, live reconciliation and
      // exports, but their membership is represented by the single parent entry.
      jobs.push(...packets.flatMap((packet) => packet.children || []));
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
          if (id !== ctx.routeDocumentId && !listed.has(id) && (ctx.revisions.get(id) || 0) <= revision) {
            ctx.rows.delete(id);
            ctx.rowsDirty = true;
          }
        }
      }

      if (!append && !data?.has_more && !overlap) {
        cached("pruneFromJobList", ctx.workspaceId, jobs, {
          filtered: Boolean(search || Object.values(filters).some(Boolean)),
        });
      }

      const total = Number.isFinite(data?.total) ? data.total : jobs.length;
      publish(ctx, {
        totalDocuments:
          ctx.countRevision > revision || countsRequestId !== ctx.countsRequest ? snapshot.totalDocuments : total,
        statusCounts:
          !overlap && countsRequestId === ctx.countsRequest && data?.status_counts
            ? data.status_counts
            : snapshot.statusCounts,
        nextCursor: data?.next_cursor || null,
        hasMore: Boolean(data?.has_more),
        // A settled first page clears the list error; a load-more page leaves the list state alone.
        listStatus: append ? snapshot.listStatus : "ready",
        listError: append ? snapshot.listError : null,
      });

      // Partial/filtered lists cannot disprove a deep link. A complete list
      // missing it warrants an authoritative detail read (for remote deletion).
      if (
        !append &&
        !data?.has_more &&
        !search &&
        !Object.values(filters).some(Boolean) &&
        ctx.routeDocumentId &&
        !listed.has(ctx.routeDocumentId)
      )
        await loadDetails(ctx.routeDocumentId);

      if (overlap) {
        scheduleRefresh(ctx);
        scheduleCountsRefresh(ctx);
      }
    } catch (error) {
      if (isCurrent(ctx) && queryRevision === ctx.queryRevision && requestId === ctx.listRequest) {
        publish(ctx, append ? { loadMoreError: error } : { listStatus: "error", listError: error });

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
    ctx.listBoundary = null;
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
    setQuery({
      filters: Object.fromEntries(Object.keys(EMPTY_FILTERS).map((key) => [key, normalizeId(filters?.[key])])),
    });
  }

  function receiveLiveUpdates(jobs, scopeKey = snapshot.scopeKey) {
    const ctx = context;

    if (!ctx || ctx.key !== scopeKey || !isCurrent(ctx)) return;

    for (const job of jobs) merge(ctx, job, { countNew: true });
    publish(ctx);
  }

  function receivePackets(packets) {
    const ctx = context;

    if (!ctx || !isCurrent(ctx)) return;

    for (const packet of packets) {
      if (ctx.deletedPackets.has(packet.packet_id)) continue;
      changed(ctx, `packet:${packet.packet_id}`);
      ctx.packets.set(packet.packet_id, packet);
    }

    publish(ctx);
  }

  function removePackets(ids) {
    const ctx = context;

    if (!ctx || !isCurrent(ctx)) return;

    for (const id of ids) {
      changed(ctx, `packet:${id}`);
      ctx.deletedPackets.add(id);
      ctx.packets.delete(id);

      for (const job of ctx.rows.values()) if (job.parent_packet_id === id) remove(ctx, job.job_id);
    }

    publish(ctx);
  }

  function remove(ctx, id) {
    if (ctx.deleted.has(id)) return;
    changed(ctx, id);
    ctx.deleted.add(id);
    ctx.detailErrors.set(id, "missing");
    scheduleCountsRefresh(ctx);
    ctx.rows.delete(id);
    ctx.rowsDirty = true;

    if (ctx.known.delete(id)) {
      snapshot = { ...snapshot, totalDocuments: Math.max(0, snapshot.totalDocuments - 1) };
      ctx.countRevision = ctx.revision;
    }

    if (ctx.previews.has(id)) revokePreview(ctx.previews.get(id));
    ctx.previews.delete(id);
    cached("remove", ctx.workspaceId, id);
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
        ctx.detailErrors.delete(id);
        ctx.hydrated.set(id, version(next));

        if (next.status === "completed") cached("store", ctx.workspaceId, next);
        publish(ctx);

        if (wasLive && TERMINAL_STATUSES.has(next.status)) emit(ctx, "onCapacityChange");

        return next;
      } catch (error) {
        if (!isCurrent(ctx) || ctx.deleted.has(id)) return;

        if (error.status === 404) {
          if ((ctx.revisions.get(id) || 0) > revision) {
            scheduleRefresh(ctx);

            return;
          }

          remove(ctx, id);
          publish(ctx);

          return;
        }

        if (error.status === 403) emit(ctx, "onAccessDenied");
        ctx.detailErrors.set(id, "error");
        publish(ctx);

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

        const models = normalizeModels([
          ...(data?.available_models || []),
          ...(ctx.revision > revision ? snapshot.availableModels : []),
        ]);

        modelOptions.set(ctx.workspaceId, models);
        publish(ctx, { availableModels: models });

        return models;
      } catch (error) {
        if (error.status === 403) emit(ctx, "onAccessDenied");

        return [];
      }
    })().finally(() => {
      ctx.modelsRequest = null;
    });

    return ctx.modelsRequest;
  }

  async function submitBatch({ templateId, templateTags, entries, onProgress, onComplete, onPacket, onDocument }) {
    const ctx = context;

    if (!ctx || !isCurrent(ctx) || snapshot.uploading) return;
    const requests = ctx.requests;
    const batchSession = ctx.session;
    const batchRevision = submissionRevision;
    const acceptsBatch = () => isCurrent(ctx) && batchRevision === submissionRevision;
    publish(ctx, { uploading: true });
    let queued = 0;
    let failed = 0;
    let nextEntry = 0;

    const worker = async () => {
      while (nextEntry < entries.length) {
        if (!batchSession.active || batchRevision !== submissionRevision) break;
        const entry = entries[nextEntry++];

        if (acceptsBatch()) onProgress?.(entry.id, "processing", "");
        let preview = null;

        try {
          const form = new FormData();

          if (templateId) form.append("template_id", templateId);

          if (templateTags?.length) form.append("template_tags", JSON.stringify(templateTags));

          if (entry.pages?.length) form.append("pages", JSON.stringify(entry.pages));
          form.append("document", entry.file);
          form.append("options", JSON.stringify({ include_confidence: true, include_evidence: true }));
          let result;

          for (let attempt = 0; ; attempt++) {
            try {
              result = await requests.submitDocument(form);
              break;
            } catch (error) {
              if (error.code !== "local_submission_capacity_unavailable" || attempt >= 2) throw error;
              await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));

              if (!batchSession.active || batchRevision !== submissionRevision) return;
            }
          }

          queued += 1;

          if (!acceptsBatch()) continue;

          if (result.packet_id && !result.job_id) {
            onPacket?.({ ...result, source_name: entry.file.name, source_mime_type: entry.file.type });
            emit(ctx, "onCapacityChange");
            onProgress?.(entry.id, "success", "");
            continue;
          }

          preview = createPreview(entry.file);

          if (preview) ctx.previews.set(result.job_id, preview);
          merge(
            ctx,
            {
              ...result,
              status: result.status || "queued",
              template_id: result.template_id || templateId || null,
              source_name: entry.file.name,
              source_mime_type: entry.file.type,
              source_preview_url: preview,
              queued_at: new Date().toISOString(),
            },
            { countNew: true },
          );
          publish(ctx, { selectedDocumentId: result.job_id });
          onDocument?.(result.job_id);
          emit(ctx, "onCapacityChange");
          onProgress?.(entry.id, "success", "");
        } catch (error) {
          failed += 1;

          if (!acceptsBatch()) continue;

          if (preview) revokePreview(preview);
          onProgress?.(entry.id, "failed", describeError(error, "Couldn't queue this document. Try again."));

          if (error.status === 403) emit(ctx, "onAccessDenied");
        }
      }
    };

    try {
      const concurrency = Math.max(1, Math.min(4, Math.trunc(uploadConcurrency) || 2));
      await Promise.all(Array.from({ length: Math.min(entries.length, concurrency) }, worker));

      if (acceptsBatch()) onComplete?.({ queued, failed });
    } finally {
      publish(ctx, { uploading: false });
    }
  }

  async function deleteDocuments(ids, { onComplete } = {}) {
    const ctx = context;

    if (!ctx || !isCurrent(ctx) || snapshot.deleting) return;
    const requests = ctx.requests;
    publish(ctx, { deleting: true });

    try {
      const results = await Promise.all(
        [...new Set(ids.map(normalizeId))].map(async (id) => {
          let alreadyRemoved = false;

          try {
            await requests.deleteDocument(id);
          } catch (error) {
            if (error.status !== 404) {
              if (error.status === 403) emit(ctx, "onAccessDenied");

              return { documentId: id, removed: false, alreadyRemoved: false };
            }

            alreadyRemoved = true;
          }

          if (isCurrent(ctx)) remove(ctx, id);

          return { documentId: id, removed: true, alreadyRemoved };
        }),
      );

      if (!isCurrent(ctx)) return;
      publish(ctx);

      if (results.some((result) => result.removed)) void loadModels({ force: true });
      onComplete?.(results);
    } finally {
      publish(ctx, { deleting: false });
    }
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
    } finally {
      publish(ctx, { exporting: false });
    }
  }

  return {
    cancelPendingSubmissions: () => {
      submissionRevision += 1;
    },
    configure,
    clear,
    refresh,
    loadDetails,
    loadModels,
    ensureSelectedDetails,
    setSearch,
    setFilters,
    receiveLiveUpdates,
    receivePackets,
    removePackets,
    submitBatch,
    deleteDocuments,
    exportDocuments,
    selectDocument: (id, { clearFilters = false } = {}) => {
      if (!context) return;

      if (clearFilters) {
        clearTimeout(context.searchTimer);
        context.queryRevision += 1;
        context.listBoundary = null;
        publish(context, {
          selectedDocumentId: normalizeId(id),
          search: "",
          debouncedSearch: "",
          filters: { ...EMPTY_FILTERS },
        });
        scheduleRefresh(context);
      } else publish(context, { selectedDocumentId: normalizeId(id) });
    },
    toggleSelection: (ids, selected) => {
      if (!context) return;
      const selection = new Set(snapshot.selectedDocumentIds);

      for (const id of ids.map(normalizeId)) {
        if (selected) selection.add(id);
        else selection.delete(id);
      }

      publish(context, { selectedDocumentIds: [...selection] });
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (session) session.active = false;
      session = null;
      retire();
    },
  };
}

function compareEntries(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;

  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

function version(job) {
  return JSON.stringify([
    job?.status,
    job?.updated_at,
    job?.current_attempt,
    job?.completed_attempt,
    job?.template_version,
    job?.costs,
  ]);
}

function sameVersion(a, b) {
  return a?.status === b?.status && !isOlder(a, b) && !isOlder(b, a);
}

function isOlder(incoming, existing) {
  if (!existing) return false;

  if (
    Number.isFinite(incoming?.current_attempt) &&
    Number.isFinite(existing.current_attempt) &&
    incoming.current_attempt !== existing.current_attempt
  ) {
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

  if (
    query &&
    ![job.job_id, job.source_name, job.template_id, job.status].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(query),
    )
  )
    return false;
  const date = String(job.created_at || job.queued_at || "").slice(0, 10);

  if (filters.dateFrom && (!date || date < filters.dateFrom)) return false;

  if (filters.dateTo && (!date || date > filters.dateTo)) return false;

  return !filters.model || job.model_name === filters.model;
}
