import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCompletedDocumentCache } from "../../lib/completedDocumentCache";

const DEFAULT_OPTIONS = {
  include_confidence: true,
  include_evidence: true,
};

const EMPTY_DOCUMENT_FILTERS = Object.freeze({
  dateFrom: "",
  dateTo: "",
  model: "",
});

const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);
const EXPORTABLE_DOCUMENT_STATUSES = new Set(["completed", "failed"]);
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_DELAY_MS = 150;
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_MIN_INTERVAL_MS = 3000;

export function useDocumentController({
  apiBase = "/v1",
  initialWorkspace = {},
  templates,
  selectedUploadTemplateId,
  onSelectedUploadTemplateChange,
  documentRequests,
  addLog,
  showActionToast,
  showDocumentUploadToast,
  hasApiAccess,
  hasWorkspaceApiAccess,
  isAppBusy,
  isWorkspaceDeletionInProgress = false,
  workspaceId,
  latestResponse,
  setLatestResponse,
  onActivePageChange,
  onWorkspaceCapacityRefresh,
  onWorkspaceAccessRevalidation,
}) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [isExportingDocuments, setIsExportingDocuments] = useState(false);
  const [loadingDocumentDetailsId, setLoadingDocumentDetailsId] = useState("");
  const [uploadTemplateId, setUploadTemplateId] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [queuedJobs, setQueuedJobs] = useState({});
  const [jobHistory, setJobHistory] = useState(
    Array.isArray(initialWorkspace.jobHistory) ? initialWorkspace.jobHistory : [],
  );
  const [jobsNextCursor, setJobsNextCursor] = useState(null);
  const [jobsHasMore, setJobsHasMore] = useState(false);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [isLoadingMoreJobs, setIsLoadingMoreJobs] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    initialWorkspace.selectedDocumentId || "",
  );
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [documentSearch, setDocumentSearch] = useState("");
  const [debouncedDocumentSearch, setDebouncedDocumentSearch] = useState("");
  const [documentFilters, setDocumentFilters] = useState(EMPTY_DOCUMENT_FILTERS);
  const [availableDocumentModels, setAvailableDocumentModels] = useState([]);
  const [liveUpdatesUnavailable, setLiveUpdatesUnavailable] = useState(false);

  const previewUrlsRef = useRef(new Set());
  const completedDocumentCacheRef = useRef(createCompletedDocumentCache());
  const deletedDocumentIdsRef = useRef(new Set());
  const filterOptionsCacheRef = useRef(new Map());
  const filterOptionsInFlightRef = useRef(new Map());
  const knownDocumentIdsRef = useRef(new Set(
    (Array.isArray(initialWorkspace.jobHistory) ? initialWorkspace.jobHistory : [])
      .map((job) => String(job?.job_id || "").trim())
      .filter(Boolean),
  ));
  const liveUpdateSocketRef = useRef(null);
  const liveUpdateReconnectTimerRef = useRef(null);
  const liveUpdateAccessRevalidationPendingRef = useRef(false);
  const workspaceDeletionInProgressRef = useRef(isWorkspaceDeletionInProgress);
  const workspaceCapacityRefreshTimerRef = useRef(null);
  const lastWorkspaceCapacityRefreshAtRef = useRef(0);
  const jobDetailsInFlightRef = useRef(new Map());
  const liveCompletedDetailLoadsRef = useRef(new Set());
  const addLogRef = useRef(addLog);
  const jobHistoryRef = useRef(jobHistory);
  const jobsNextCursorRef = useRef(jobsNextCursor);
  const latestResponseRef = useRef(latestResponse);
  const listJobsRef = useRef(null);
  const onWorkspaceCapacityRefreshRef = useRef(onWorkspaceCapacityRefresh);
  const onWorkspaceAccessRevalidationRef = useRef(
    onWorkspaceAccessRevalidation || onWorkspaceCapacityRefresh,
  );
  const queuedJobsRef = useRef(queuedJobs);
  const documentRequestsRef = useRef(documentRequests);
  const hasApiAccessRef = useRef(hasApiAccess);
  const workspaceIdRef = useRef(workspaceId);
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  const canOpenLiveUpdates =
    hasApiAccess && Boolean(normalizedWorkspaceId) && typeof WebSocket === "function";
  const shouldUseLiveUpdates = canOpenLiveUpdates && !liveUpdatesUnavailable;

  useEffect(() => {
    addLogRef.current = addLog;
    onWorkspaceCapacityRefreshRef.current = onWorkspaceCapacityRefresh;
    onWorkspaceAccessRevalidationRef.current =
      onWorkspaceAccessRevalidation || onWorkspaceCapacityRefresh;
    documentRequestsRef.current = documentRequests;
  }, [
    addLog,
    documentRequests,
    onWorkspaceAccessRevalidation,
    onWorkspaceCapacityRefresh,
  ]);

  useEffect(() => {
    jobHistoryRef.current = jobHistory;
    jobsNextCursorRef.current = jobsNextCursor;
    latestResponseRef.current = latestResponse;
    queuedJobsRef.current = queuedJobs;
    hasApiAccessRef.current = hasApiAccess;
    workspaceIdRef.current = workspaceId;
    workspaceDeletionInProgressRef.current = isWorkspaceDeletionInProgress;
  }, [hasApiAccess, isWorkspaceDeletionInProgress, jobHistory, jobsNextCursor, latestResponse, queuedJobs, workspaceId]);

  const documents = useMemo(() => {
    const query = debouncedDocumentSearch.trim().toLowerCase();
    const historyIds = new Set(jobHistory.map((job) => job.job_id));
    const queuedOnly = Object.entries(queuedJobs)
      .filter(([jobId]) => !historyIds.has(jobId))
      .map(([jobId, meta]) => ({
        job_id: jobId,
        status: "queued",
        template_id: meta.template_id || selectedUploadTemplateId || "",
        source_name:
          meta.source_name || defaultUploadedName(meta.source_mime_type),
        source_preview_url: meta.source_preview_url || null,
        source_mime_type: meta.source_mime_type || null,
        queued_at: meta.queued_at || null,
        updated_at: meta.queued_at || null,
        results: [],
      }));

    return [...jobHistory, ...queuedOnly]
      .filter((job) => documentMatchesFilters(job, query, documentFilters))
      .sort((a, b) => {
        const left = getDocumentSortTimestamp(b);
        const right = getDocumentSortTimestamp(a);
        return left - right;
      });
  }, [
    debouncedDocumentSearch,
    documentFilters,
    jobHistory,
    queuedJobs,
    selectedUploadTemplateId,
  ]);

  const hasActiveDocumentFilters = Boolean(
    documentFilters.dateFrom || documentFilters.dateTo || documentFilters.model,
  );

  const selectedDocument = useMemo(() => {
    if (!documents.length) {
      return null;
    }
    if (!selectedDocumentId) {
      return documents[0];
    }
    return (
      documents.find((document) => document.job_id === selectedDocumentId) ||
      documents[0]
    );
  }, [documents, selectedDocumentId]);

  const exportableSelectedDocumentIds = useMemo(() => {
    const selectedIds = new Set(selectedDocumentIds);
    return documents
      .filter(
        (document) =>
          selectedIds.has(String(document.job_id || "")) &&
          EXPORTABLE_DOCUMENT_STATUSES.has(String(document.status || "")),
      )
      .map((document) => String(document.job_id));
  }, [documents, selectedDocumentIds]);

  useEffect(() => {
    const availableDocumentIds = new Set(
      documents.map((document) => String(document.job_id || "")),
    );
    setSelectedDocumentIds((currentDocumentIds) => {
      const nextDocumentIds = currentDocumentIds.filter((documentId) =>
        availableDocumentIds.has(documentId),
      );
      return nextDocumentIds.length === currentDocumentIds.length
        ? currentDocumentIds
        : nextDocumentIds;
    });
  }, [documents]);

  const selectedDocumentTemplateName = useMemo(() => {
    if (!selectedDocument?.template_id) {
      return "Unknown template";
    }

    const templateId = String(selectedDocument.template_id || "").trim();
    const match = templates.find(
      (template) => String(template.id || "").trim() === templateId,
    );
    const templateName = String(match?.name || "").trim();
    return templateName || templateId;
  }, [selectedDocument, templates]);

  const documentStatusMetrics = useMemo(() => {
    const metrics = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const job of documents) {
      if (Object.prototype.hasOwnProperty.call(metrics, job.status)) {
        metrics[job.status] += 1;
      }
    }

    return metrics;
  }, [documents]);

  const completionRate = useMemo(() => {
    if (!documents.length) {
      return 0;
    }

    const completedDocuments = documents.filter(
      (document) => !LIVE_DOCUMENT_STATUSES.has(document.status),
    ).length;

    return Math.round(
      (completedDocuments / documents.length) * 100,
    );
  }, [documents]);

  const clearCompletedDocumentCache = useCallback(() => {
    completedDocumentCacheRef.current.clearAll();
  }, []);

  const clearLiveUpdateReconnectTimer = useCallback(() => {
    if (!liveUpdateReconnectTimerRef.current) {
      return;
    }

    window.clearTimeout(liveUpdateReconnectTimerRef.current);
    liveUpdateReconnectTimerRef.current = null;
  }, []);

  const clearWorkspaceCapacityRefreshTimer = useCallback(() => {
    if (!workspaceCapacityRefreshTimerRef.current) {
      return;
    }

    window.clearTimeout(workspaceCapacityRefreshTimerRef.current);
    workspaceCapacityRefreshTimerRef.current = null;
  }, []);

  const scheduleWorkspaceCapacityRefresh = useCallback(() => {
    const refreshWorkspaceCapacity = onWorkspaceCapacityRefreshRef.current;
    if (typeof refreshWorkspaceCapacity !== "function") {
      return;
    }
    if (workspaceCapacityRefreshTimerRef.current) {
      return;
    }

    const now = Date.now();
    const lastRefreshAt = lastWorkspaceCapacityRefreshAtRef.current;
    const refreshDelay = lastRefreshAt
      ? Math.max(
          WORKSPACE_CONTEXT_INVALIDATION_REFRESH_MIN_INTERVAL_MS - (now - lastRefreshAt),
          0,
        )
      : WORKSPACE_CONTEXT_INVALIDATION_REFRESH_DELAY_MS;

    workspaceCapacityRefreshTimerRef.current = window.setTimeout(() => {
      workspaceCapacityRefreshTimerRef.current = null;
      lastWorkspaceCapacityRefreshAtRef.current = Date.now();
      Promise.resolve(refreshWorkspaceCapacity()).catch((error) => {
        addLogRef.current?.(`Refresh workspace capacity failed: ${error.message}`);
      });
    }, refreshDelay);
  }, []);

  const revalidateWorkspaceAccessNow = useCallback(() => {
    const revalidateWorkspaceAccess = onWorkspaceAccessRevalidationRef.current;
    if (typeof revalidateWorkspaceAccess !== "function") {
      return;
    }

    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = Date.now();
    liveUpdateAccessRevalidationPendingRef.current = true;
    Promise.resolve(revalidateWorkspaceAccess())
      .then(() => {
        liveUpdateAccessRevalidationPendingRef.current = false;
      })
      .catch((error) => {
        addLogRef.current?.(`Refresh workspace access failed: ${error.message}`);
      });
  }, [clearWorkspaceCapacityRefreshTimer]);

  const rememberDocumentModel = useCallback((modelName) => {
    const normalizedModelName = String(modelName || "").trim();
    const currentWorkspaceId = String(workspaceIdRef.current || "").trim();
    if (!normalizedModelName || !currentWorkspaceId) {
      return;
    }

    setAvailableDocumentModels((currentModels) => {
      if (currentModels.includes(normalizedModelName)) {
        return currentModels;
      }
      const nextModels = normalizeAvailableDocumentModels([
        ...currentModels,
        normalizedModelName,
      ]);
      if (filterOptionsCacheRef.current.has(currentWorkspaceId)) {
        filterOptionsCacheRef.current.set(currentWorkspaceId, nextModels);
      }
      return nextModels;
    });
  }, []);

  const loadDocumentFilterOptions = useCallback(async ({ force = false } = {}) => {
    const targetWorkspaceId = normalizedWorkspaceId;
    if (!hasApiAccessRef.current || !targetWorkspaceId) {
      return [];
    }

    if (!force && filterOptionsCacheRef.current.has(targetWorkspaceId)) {
      const cachedModels = filterOptionsCacheRef.current.get(targetWorkspaceId);
      if (String(workspaceIdRef.current || "").trim() === targetWorkspaceId) {
        setAvailableDocumentModels(cachedModels);
      }
      return cachedModels;
    }

    const existingRequest = filterOptionsInFlightRef.current.get(targetWorkspaceId);
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = (async () => {
      try {
        const data = await documentRequestsRef.current.getFilterOptions();
        const models = normalizeAvailableDocumentModels(data?.available_models);
        if (!hasApiAccessRef.current) {
          return [];
        }
        filterOptionsCacheRef.current.set(targetWorkspaceId, models);
        if (
          hasApiAccessRef.current &&
          String(workspaceIdRef.current || "").trim() === targetWorkspaceId
        ) {
          setAvailableDocumentModels(models);
        }
        return models;
      } catch (error) {
        addLogRef.current(`Load job filter options failed: ${error.message}`);
        return [];
      } finally {
        filterOptionsInFlightRef.current.delete(targetWorkspaceId);
      }
    })();
    filterOptionsInFlightRef.current.set(targetWorkspaceId, requestPromise);
    return requestPromise;
  }, [normalizedWorkspaceId]);

  const clearWorkspaceScopedDocuments = useCallback(() => {
    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = 0;
    setJobHistory([]);
    setQueuedJobs({});
    setJobsNextCursor(null);
    setJobsHasMore(false);
    setTotalDocuments(0);
    setAvailableDocumentModels([]);
    setSelectedDocumentId("");
    setSelectedDocumentIds([]);
    setLatestResponse(null);
    liveCompletedDetailLoadsRef.current.clear();
    deletedDocumentIdsRef.current.clear();
    knownDocumentIdsRef.current.clear();
  }, [clearWorkspaceCapacityRefreshTimer, setLatestResponse]);

  const registerNewDocument = useCallback((documentId) => {
    const normalizedDocumentId = String(documentId || "").trim();
    if (!normalizedDocumentId || knownDocumentIdsRef.current.has(normalizedDocumentId)) {
      return false;
    }
    knownDocumentIdsRef.current.add(normalizedDocumentId);
    setTotalDocuments((currentTotal) => currentTotal + 1);
    return true;
  }, []);

  const upsertJobHistory = useCallback((job, { countIfNew = false } = {}) => {
    if (!job?.job_id) {
      return;
    }
    const jobId = String(job.job_id);
    if (deletedDocumentIdsRef.current.has(jobId)) {
      return;
    }
    rememberDocumentModel(job.model_name);
    if (countIfNew && String(job.status || "").toLowerCase() === "queued") {
      registerNewDocument(jobId);
    } else if (!countIfNew) {
      knownDocumentIdsRef.current.add(jobId);
    }

    const queuedMeta = queuedJobsRef.current[job.job_id] || null;
    setJobHistory((prev) => {
      const existing =
        prev.find((entry) => entry.job_id === job.job_id) || null;
      const normalized = {
        ...existing,
        ...job,
        source_name:
          queuedMeta?.source_name ||
          existing?.source_name ||
          job.source_name ||
          null,
        source_preview_url:
          queuedMeta?.source_preview_url ||
          existing?.source_preview_url ||
          job.source_preview_url ||
          null,
        source_mime_type:
          queuedMeta?.source_mime_type ||
          existing?.source_mime_type ||
          job.source_mime_type ||
          null,
        created_at:
          job.created_at ||
          existing?.created_at ||
          queuedMeta?.queued_at ||
          null,
        queued_at:
          job.queued_at || existing?.queued_at || queuedMeta?.queued_at || null,
        updated_at:
          job.updated_at ||
          existing?.updated_at ||
          queuedMeta?.queued_at ||
          null,
        current_attempt:
          typeof job.current_attempt === "number"
            ? job.current_attempt
            : typeof existing?.current_attempt === "number"
              ? existing.current_attempt
              : 0,
        completed_attempt:
          typeof job.completed_attempt === "number"
            ? job.completed_attempt
            : typeof existing?.completed_attempt === "number"
              ? existing.completed_attempt
              : 0,
        last_failed_attempt:
          typeof job.last_failed_attempt === "number"
            ? job.last_failed_attempt
            : typeof existing?.last_failed_attempt === "number"
              ? existing.last_failed_attempt
              : 0,
      };
      const next = existing
        ? prev.map((entry) =>
            entry.job_id === job.job_id ? normalized : entry,
          )
        : [normalized, ...prev];
      next.sort((a, b) => {
        const left = getDocumentSortTimestamp(b);
        const right = getDocumentSortTimestamp(a);
        return left - right;
      });
      return next;
    });

    if (["completed", "failed"].includes(job.status)) {
      setQueuedJobs((prev) => {
        if (!prev[job.job_id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[job.job_id];
        return next;
      });
    }
  }, [registerNewDocument, rememberDocumentModel]);

  const listJobs = useCallback(async ({ append = false } = {}) => {
    try {
      const search = debouncedDocumentSearch.trim();
      const nextCursor = jobsNextCursorRef.current;
      const data = await documentRequestsRef.current.listDocuments({
        search,
        filters: documentFilters,
        cursor: append ? nextCursor : null,
      });
      const list = Array.isArray(data?.jobs) ? data.jobs : [];
      const isFilteredList = Boolean(search || hasActiveDocumentFilters);
      const hydratedList = list.map((job) => {
        if (String(job?.status || "") !== "completed") {
          return job;
        }
        const cached = completedDocumentCacheRef.current.get(workspaceId, job.job_id);
        return cached ? { ...job, ...cached } : job;
      });
      if (!append && !data?.has_more) {
        completedDocumentCacheRef.current.pruneFromJobList(workspaceId, list, {
          filtered: isFilteredList,
        });
      }
      setJobHistory((prev) => {
        if (!append) {
          return hydratedList;
        }

        const seen = new Set(prev.map((job) => String(job.job_id || "")));
        const additions = hydratedList.filter((job) => {
          const jobId = String(job.job_id || "");
          if (!jobId || seen.has(jobId)) {
            return false;
          }
          seen.add(jobId);
          return true;
        });
        return [...prev, ...additions];
      });
      setJobsNextCursor(data?.next_cursor || null);
      setJobsHasMore(Boolean(data?.has_more));
      if (append) {
        for (const job of hydratedList) {
          const jobId = String(job?.job_id || "").trim();
          if (jobId) {
            knownDocumentIdsRef.current.add(jobId);
          }
        }
      } else {
        knownDocumentIdsRef.current = new Set([
          ...hydratedList
            .map((job) => String(job?.job_id || "").trim())
            .filter(Boolean),
          ...Object.keys(queuedJobsRef.current),
        ]);
      }
      setTotalDocuments(Number.isFinite(data?.total) ? data.total : list.length);
      setSelectedDocumentId((currentSelectedDocumentId) =>
        currentSelectedDocumentId || !hydratedList[0]?.job_id
          ? currentSelectedDocumentId
          : String(hydratedList[0].job_id),
      );
      addLogRef.current(
        `${append ? "Loaded" : "Loaded"} ${list.length} document${list.length === 1 ? "" : "s"}${search ? ` matching "${search}"` : ""}${hasActiveDocumentFilters ? " with advanced filters" : ""}`,
      );
    } catch (error) {
      addLogRef.current(`List documents failed: ${error.message}`);
    }
  }, [
    debouncedDocumentSearch,
    documentFilters,
    hasActiveDocumentFilters,
    workspaceId,
  ]);

  const applyDocumentFilters = useCallback((nextFilters) => {
    setDocumentFilters(normalizeDocumentFilters(nextFilters));
  }, []);

  useEffect(() => {
    listJobsRef.current = listJobs;
  }, [listJobs]);

  useEffect(() => {
    if (!hasApiAccess || !normalizedWorkspaceId) {
      setAvailableDocumentModels([]);
      if (!hasApiAccess) {
        filterOptionsCacheRef.current.clear();
        filterOptionsInFlightRef.current.clear();
      }
      return;
    }

    if (filterOptionsCacheRef.current.has(normalizedWorkspaceId)) {
      setAvailableDocumentModels(
        filterOptionsCacheRef.current.get(normalizedWorkspaceId),
      );
      return;
    }

    setAvailableDocumentModels([]);
    void loadDocumentFilterOptions();
  }, [hasApiAccess, loadDocumentFilterOptions, normalizedWorkspaceId]);

  async function loadMoreJobs() {
    if (!jobsHasMore || !jobsNextCursor || isLoadingMoreJobs) {
      return;
    }

    setIsLoadingMoreJobs(true);
    try {
      await listJobs({ append: true });
    } finally {
      setIsLoadingMoreJobs(false);
    }
  }

  const removeDocumentFromState = useCallback((targetDocumentId, sourcePreviewUrl) => {
    const normalizedTargetDocumentId = String(targetDocumentId);
    deletedDocumentIdsRef.current.add(normalizedTargetDocumentId);
    if (knownDocumentIdsRef.current.delete(normalizedTargetDocumentId)) {
      setTotalDocuments((currentTotal) => Math.max(0, currentTotal - 1));
    }
    if (sourcePreviewUrl) {
      URL.revokeObjectURL(sourcePreviewUrl);
      previewUrlsRef.current.delete(sourcePreviewUrl);
    }
    completedDocumentCacheRef.current.remove(workspaceIdRef.current, targetDocumentId);

    setJobHistory((prev) =>
      prev.filter((job) => String(job.job_id || "") !== targetDocumentId),
    );
    setQueuedJobs((prev) => {
      const next = { ...prev };
      delete next[targetDocumentId];
      return next;
    });

    setSelectedDocumentId((currentSelectedDocumentId) =>
      currentSelectedDocumentId === targetDocumentId ? "" : currentSelectedDocumentId,
    );
    setSelectedDocumentIds((currentDocumentIds) =>
      currentDocumentIds.filter((documentId) => documentId !== targetDocumentId),
    );
    if (latestResponseRef.current?.job_id === targetDocumentId) {
      setLatestResponse(null);
    }
  }, [setLatestResponse]);

  const toggleDocumentSelection = useCallback((documentId, isSelected) => {
    const normalizedDocumentId = String(documentId || "").trim();
    if (!normalizedDocumentId) {
      return;
    }

    setSelectedDocumentIds((currentDocumentIds) => {
      if (isSelected) {
        return currentDocumentIds.includes(normalizedDocumentId)
          ? currentDocumentIds
          : [...currentDocumentIds, normalizedDocumentId];
      }
      return currentDocumentIds.filter(
        (currentDocumentId) => currentDocumentId !== normalizedDocumentId,
      );
    });
  }, []);

  const toggleAllDocumentSelections = useCallback((documentIds, isSelected) => {
    const availableDocumentIds = new Set(
      documentIds
        .map((documentId) => String(documentId || "").trim())
        .filter(Boolean),
    );
    if (!availableDocumentIds.size) {
      return;
    }

    setSelectedDocumentIds((currentDocumentIds) => {
      if (isSelected) {
        return [...new Set([...currentDocumentIds, ...availableDocumentIds])];
      }
      return currentDocumentIds.filter(
        (documentId) => !availableDocumentIds.has(documentId),
      );
    });
  }, []);

  const loadJobDetails = useCallback(async (
    jobId,
    { silent = true, showLoading = false } = {},
  ) => {
    const normalizedJobId = String(jobId || "").trim();
    if (!normalizedJobId) {
      return;
    }

    if (showLoading) {
      setLoadingDocumentDetailsId(normalizedJobId);
    }

    const requestKey = `${String(workspaceId || "").trim()}::${normalizedJobId}`;
    const inFlightLoad = jobDetailsInFlightRef.current.get(requestKey);
    if (inFlightLoad) {
      try {
        return await inFlightLoad;
      } finally {
        if (showLoading) {
          setLoadingDocumentDetailsId((currentId) =>
            currentId === normalizedJobId ? "" : currentId,
          );
        }
      }
    }

    const loadPromise = (async () => {
      try {
        const data = await documentRequestsRef.current.getDocument(normalizedJobId);
        const shouldRefreshWorkspaceCapacity =
          hasDocumentStatusChanged(jobHistoryRef.current, queuedJobsRef.current, data);
        upsertJobHistory(data);
        if (shouldRefreshWorkspaceCapacity) {
          scheduleWorkspaceCapacityRefresh();
        }
        completedDocumentCacheRef.current.store(workspaceId, data);
        return data;
      } catch (error) {
        if (Number(error?.status) === 404) {
          completedDocumentCacheRef.current.remove(workspaceId, normalizedJobId);
          removeDocumentFromState(normalizedJobId);
        }
        if (!silent) {
          addLogRef.current(`Load job details failed: ${error.message}`);
        }
        return null;
      }
    })();
    jobDetailsInFlightRef.current.set(requestKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      if (jobDetailsInFlightRef.current.get(requestKey) === loadPromise) {
        jobDetailsInFlightRef.current.delete(requestKey);
      }
      if (showLoading) {
        setLoadingDocumentDetailsId((currentId) =>
          currentId === normalizedJobId ? "" : currentId,
        );
      }
    }
  }, [removeDocumentFromState, scheduleWorkspaceCapacityRefresh, upsertJobHistory, workspaceId]);

  function openUploadModal() {
    if (isAppBusy) {
      return;
    }
    setUploadTemplateId(selectedUploadTemplateId || templates[0]?.id || "");
    setUploadFiles([]);
    setIsUploadDragActive(false);
    setShowUploadModal(true);
  }

  function closeUploadModal() {
    if (isUploadingDocuments) {
      return;
    }
    setIsUploadDragActive(false);
    setShowUploadModal(false);
  }

  function handleUploadDragOver(event) {
    event.preventDefault();
    setIsUploadDragActive(true);
  }

  function handleUploadDragLeave(event) {
    event.preventDefault();
    setIsUploadDragActive(false);
  }

  function handleUploadDrop(event) {
    event.preventDefault();
    setIsUploadDragActive(false);
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    appendUploadFiles(droppedFiles);
  }

  function appendUploadFiles(nextFiles) {
    const filtered = nextFiles.filter(Boolean);
    if (!filtered.length) {
      return;
    }

    setUploadFiles((prev) => {
      const existingKeys = new Set(
        prev.map((entry) =>
          fileDedupKey(
            entry.file.name,
            entry.file.size,
            entry.file.lastModified,
          ),
        ),
      );
      const additions = [];

      for (const file of filtered) {
        const key = fileDedupKey(file.name, file.size, file.lastModified);
        if (existingKeys.has(key)) {
          continue;
        }
        existingKeys.add(key);
        additions.push({
          id: `${key}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          file,
          queueStatus: "pending",
          queueError: "",
        });
      }

      return [...prev, ...additions];
    });
  }

  function removeUploadFile(uploadId) {
    setUploadFiles((prev) => prev.filter((entry) => entry.id !== uploadId));
  }

  async function uploadFromModal() {
    if (!uploadTemplateId.trim()) {
      addLog("Upload failed: select a template");
      showActionToast("document.upload", "validation", { reason: "template" });
      return;
    }
    if (isUploadingDocuments) {
      return;
    }
    if (!uploadFiles.length) {
      addLog("Upload failed: choose one or more document files");
      showActionToast("document.upload", "validation", { reason: "files" });
      return;
    }

    onSelectedUploadTemplateChange(uploadTemplateId.trim());
    setIsUploadingDocuments(true);
    try {
      let queuedCount = 0;
      let failedCount = 0;

      for (const entry of uploadFiles) {
        setUploadFiles((prev) =>
          prev.map((row) =>
            row.id === entry.id
              ? { ...row, queueStatus: "processing", queueError: "" }
              : row,
          ),
        );

        try {
          await queueDocument(uploadTemplateId.trim(), entry.file);
          queuedCount += 1;
          setUploadFiles((prev) =>
            prev.map((row) =>
              row.id === entry.id ? { ...row, queueStatus: "success" } : row,
            ),
          );
        } catch (error) {
          failedCount += 1;
          setUploadFiles((prev) =>
            prev.map((row) =>
              row.id === entry.id
                ? {
                    ...row,
                    queueStatus: "failed",
                    queueError: error.message || "Queue failed",
                  }
                : row,
            ),
          );
          addLog(`Queue failed for ${entry.file.name}: ${error.message}`);
        }
      }
      showDocumentUploadToast({
        queued: queuedCount,
        failed: failedCount,
      });
      onActivePageChange("documents");
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  async function queueDocument(templateId, file) {
    const sourcePreviewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : null;
    if (sourcePreviewUrl) {
      previewUrlsRef.current.add(sourcePreviewUrl);
    }

    const formData = new FormData();
    formData.append("template_id", templateId.trim());
    formData.append("document", file);
    formData.append("options", JSON.stringify(DEFAULT_OPTIONS));

    let queued;
    try {
      queued = await documentRequestsRef.current.submitDocument(formData);
    } catch (error) {
      if (sourcePreviewUrl) {
        URL.revokeObjectURL(sourcePreviewUrl);
        previewUrlsRef.current.delete(sourcePreviewUrl);
      }
      throw error;
    }

    const jobId = queued.job_id;
    deletedDocumentIdsRef.current.delete(String(jobId));
    registerNewDocument(jobId);
    setQueuedJobs((prev) => ({
      ...prev,
      [jobId]: {
        queued_at: new Date().toISOString(),
        source_name: file.name,
        source_preview_url: sourcePreviewUrl,
        source_mime_type: file.type || null,
        template_id: templateId.trim(),
      },
    }));
    setSelectedDocumentId(jobId);
    scheduleWorkspaceCapacityRefresh();
    addLog(`Job queued: ${jobId} (${file.name})`);
    return jobId;
  }

  async function deleteSelectedDocument() {
    const isBulkDelete = selectedDocumentIds.length > 0;
    const targetDocuments = isBulkDelete
      ? selectedDocumentIds
          .map((documentId) =>
            documents.find(
              (document) => String(document.job_id || "") === documentId,
            ),
          )
          .filter(Boolean)
      : selectedDocument
        ? [selectedDocument]
        : [];

    if (!targetDocuments.length) {
      addLog("Delete document failed: select a document first");
      return;
    }
    if (isDeletingDocument || isExportingDocuments) {
      return;
    }

    const targetDocument = targetDocuments[0];
    const targetDocumentId = String(targetDocument.job_id);
    const targetDocumentName = targetDocument.source_name || targetDocumentId;
    const confirmationMessage = isBulkDelete
      ? `Delete ${targetDocuments.length} selected document${
          targetDocuments.length === 1 ? "" : "s"
        }? This will permanently remove ${
          targetDocuments.length === 1 ? "it" : "them"
        } from the workspace.`
      : `Delete document ${targetDocumentId}? This will permanently remove it from the workspace.`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setIsDeletingDocument(true);
    try {
      const deletionResults = await Promise.all(
        targetDocuments.map(async (document) => {
          const documentId = String(document.job_id);
          try {
            await documentRequestsRef.current.deleteDocument(documentId);
            removeDocumentFromState(documentId, document.source_preview_url);
            addLog(`Deleted document ${documentId}`);
            return { documentId, removed: true, alreadyRemoved: false };
          } catch (error) {
            if (Number(error?.status) === 404) {
              removeDocumentFromState(documentId, document.source_preview_url);
              addLog(`Document ${documentId} was already removed`);
              return { documentId, removed: true, alreadyRemoved: true };
            }

            addLog(`Delete document ${documentId} failed: ${error.message}`);
            return { documentId, removed: false, alreadyRemoved: false };
          }
        }),
      );

      const removedDocumentIds = new Set(
        deletionResults
          .filter((result) => result.removed)
          .map((result) => result.documentId),
      );
      const failedCount = deletionResults.length - removedDocumentIds.size;
      const removedDocumentUsedModel = targetDocuments.some(
        (document) =>
          removedDocumentIds.has(String(document.job_id || "")) &&
          String(document.model_name || "").trim(),
      );
      const activeDocumentWasRemoved = removedDocumentIds.has(
        String(selectedDocument?.job_id || ""),
      );

      if (removedDocumentUsedModel && normalizedWorkspaceId) {
        filterOptionsCacheRef.current.delete(normalizedWorkspaceId);
        void loadDocumentFilterOptions({ force: true });
      }

      if (activeDocumentWasRemoved) {
        const nextDocumentId =
          documents.find(
            (document) => !removedDocumentIds.has(String(document.job_id || "")),
          )?.job_id || "";
        setSelectedDocumentId(nextDocumentId);
        if (nextDocumentId) {
          void loadJobDetails(nextDocumentId, { silent: true });
        }
      }

      if (isBulkDelete) {
        if (failedCount) {
          showActionToast("document.bulkDelete", "failure");
        } else {
          showActionToast("document.bulkDelete", "success", {
            targetName: `${removedDocumentIds.size} document${
              removedDocumentIds.size === 1 ? "" : "s"
            }`,
          });
        }
      } else if (deletionResults[0]?.removed) {
        showActionToast(
          "document.delete",
          deletionResults[0].alreadyRemoved ? "alreadyRemoved" : "success",
          {
            targetName: targetDocumentName,
          },
        );
      } else {
        showActionToast("document.delete", "failure");
      }
    } finally {
      setIsDeletingDocument(false);
    }
  }

  async function exportSelectedDocuments() {
    if (!exportableSelectedDocumentIds.length || isExportingDocuments) {
      return;
    }

    const selectedIdsSnapshot = [...selectedDocumentIds];
    setIsExportingDocuments(true);
    try {
      const exported = await documentRequestsRef.current.exportDocuments(
        selectedIdsSnapshot,
      );
      downloadBlob(exported.blob, exported.filename);
      addLog(
        `Exported ${exported.exportedCount} selected job${
          exported.exportedCount === 1 ? "" : "s"
        }${
          exported.skippedCount
            ? `; skipped ${exported.skippedCount} unavailable or in-progress job${
                exported.skippedCount === 1 ? "" : "s"
              }`
            : ""
        }`,
      );
      showActionToast("document.export", "success", {
        exportedCount: exported.exportedCount,
        skippedCount: exported.skippedCount,
      });
    } catch (error) {
      addLog(`Export selected jobs failed: ${error.message}`);
      showActionToast("document.export", "failure");
    } finally {
      setIsExportingDocuments(false);
    }
  }

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      clearWorkspaceCapacityRefreshTimer();
      for (const url of previewUrls) {
        URL.revokeObjectURL(url);
      }
      previewUrls.clear();
    };
  }, [clearWorkspaceCapacityRefreshTimer]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDocumentSearch(documentSearch.trim());
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [documentSearch]);

  useEffect(() => {
    if (!hasApiAccess) {
      clearLiveUpdateReconnectTimer();
      liveUpdateSocketRef.current?.close();
      liveUpdateSocketRef.current = null;
      setLiveUpdatesUnavailable(false);
      clearWorkspaceScopedDocuments();
      return;
    }

    void listJobs();
  }, [
    clearLiveUpdateReconnectTimer,
    clearWorkspaceScopedDocuments,
    debouncedDocumentSearch,
    hasApiAccess,
    listJobs,
    workspaceId,
  ]);

  useEffect(() => {
    if (!canOpenLiveUpdates || liveUpdatesUnavailable) {
      if (!canOpenLiveUpdates) {
        clearLiveUpdateReconnectTimer();
        clearWorkspaceCapacityRefreshTimer();
        lastWorkspaceCapacityRefreshAtRef.current = 0;
      }
      liveUpdateSocketRef.current?.close();
      liveUpdateSocketRef.current = null;
      if (!canOpenLiveUpdates) {
        setLiveUpdatesUnavailable(false);
      }
      return;
    }

    clearLiveUpdateReconnectTimer();
    const socket = new WebSocket(createWorkspaceLiveUpdateUrl(apiBase, normalizedWorkspaceId));
    liveUpdateSocketRef.current = socket;
    setLiveUpdatesUnavailable(false);
    socket.onopen = () => {
      if (liveUpdateSocketRef.current === socket) {
        setLiveUpdatesUnavailable(false);
      }
    };
    const scheduleReconnect = () => {
      if (liveUpdateSocketRef.current === socket) {
        liveUpdateSocketRef.current = null;
        setLiveUpdatesUnavailable(true);
        clearLiveUpdateReconnectTimer();
        liveUpdateReconnectTimerRef.current = window.setTimeout(() => {
          liveUpdateReconnectTimerRef.current = null;
          setLiveUpdatesUnavailable(false);
          void listJobsRef.current?.();
        }, 1000);
      }
    };
    socket.onclose = scheduleReconnect;
    socket.onerror = () => {
      scheduleReconnect();
    };
    socket.onmessage = (event) => {
      if (liveUpdateSocketRef.current !== socket) {
        return;
      }
      const { jobs, workspaceContextInvalidations } = parseWorkspaceLiveUpdateMessage(event?.data);
      if (workspaceContextInvalidations.length) {
        if (
          workspaceContextInvalidations.some(
            (invalidation) => invalidation.reason === "workspace_access",
          )
        ) {
          if (!workspaceDeletionInProgressRef.current) {
            revalidateWorkspaceAccessNow();
          }
          return;
        }
        if (liveUpdateAccessRevalidationPendingRef.current) {
          return;
        }
        scheduleWorkspaceCapacityRefresh();
      }
      if (liveUpdateAccessRevalidationPendingRef.current) {
        return;
      }
      for (const job of jobs) {
        upsertJobHistory(job, { countIfNew: true });
      }
    };

    return () => {
      if (liveUpdateSocketRef.current === socket) {
        liveUpdateSocketRef.current = null;
        clearLiveUpdateReconnectTimer();
        clearWorkspaceCapacityRefreshTimer();
        lastWorkspaceCapacityRefreshAtRef.current = 0;
        liveUpdateAccessRevalidationPendingRef.current = false;
      }
      socket.close();
    };
  }, [
    apiBase,
    canOpenLiveUpdates,
    clearLiveUpdateReconnectTimer,
    clearWorkspaceCapacityRefreshTimer,
    liveUpdatesUnavailable,
    normalizedWorkspaceId,
    revalidateWorkspaceAccessNow,
    scheduleWorkspaceCapacityRefresh,
    upsertJobHistory,
  ]);

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim()) {
      return;
    }

    void loadJobDetails(selectedDocumentId, {
      silent: true,
      showLoading: true,
    });
  }, [hasApiAccess, loadJobDetails, selectedDocumentId]);

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim() || shouldUseLiveUpdates) {
      return;
    }

    const liveStatus = String(selectedDocument?.status || "").toLowerCase();
    if (!LIVE_DOCUMENT_STATUSES.has(liveStatus)) {
      return;
    }

    let cancelled = false;
    let timeoutId = null;
    let nextDelayMs = 5000;

    const schedulePoll = () => {
      const jitteredDelayMs = Math.ceil(nextDelayMs * (1 + Math.random() * 0.2));
      timeoutId = window.setTimeout(async () => {
        const job = await loadJobDetails(selectedDocumentId, { silent: true });
        if (cancelled || !LIVE_DOCUMENT_STATUSES.has(String(job?.status || "").toLowerCase())) {
          return;
        }
        nextDelayMs = 8000;
        schedulePoll();
      }, jitteredDelayMs);
    };
    schedulePoll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    hasApiAccess,
    loadJobDetails,
    selectedDocumentId,
    selectedDocument?.status,
    shouldUseLiveUpdates,
  ]);

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim() || !shouldUseLiveUpdates) {
      return;
    }

    const selectedId = String(selectedDocument?.job_id || selectedDocumentId).trim();
    if (!selectedId || selectedDocument?.status !== "completed") {
      return;
    }

    if (liveCompletedDetailLoadsRef.current.has(selectedId)) {
      return;
    }

    if (Array.isArray(selectedDocument.results) && selectedDocument.results.length > 0) {
      liveCompletedDetailLoadsRef.current.add(selectedId);
      return;
    }

    liveCompletedDetailLoadsRef.current.add(selectedId);
    void loadJobDetails(selectedId, {
      silent: true,
      showLoading: true,
    }).then((data) => {
      if (!data) {
        liveCompletedDetailLoadsRef.current.delete(selectedId);
      }
    });
  }, [
    hasApiAccess,
    selectedDocumentId,
    selectedDocument?.job_id,
    selectedDocument?.results,
    selectedDocument?.status,
    loadJobDetails,
    shouldUseLiveUpdates,
  ]);

  return {
    contextList: {
      search: documentSearch,
      documents,
      selectedDocumentId: selectedDocument?.job_id || "",
      selectedDocumentIds,
      debouncedSearch: debouncedDocumentSearch,
      filters: documentFilters,
      availableModels: availableDocumentModels,
      hasActiveFilters: hasActiveDocumentFilters,
      hasMoreDocuments: jobsHasMore,
      isLoadingMoreDocuments: isLoadingMoreJobs,
      isDeletingDocuments: isDeletingDocument,
      isExportingDocuments,
      onSearchChange: setDocumentSearch,
      onFiltersChange: applyDocumentFilters,
      onSelectDocument: setSelectedDocumentId,
      onToggleAllDocumentSelections: toggleAllDocumentSelections,
      onToggleDocumentSelection: toggleDocumentSelection,
      onLoadMoreDocuments: loadMoreJobs,
    },
    uploadModal: {
      isOpen: showUploadModal,
      templates,
      selectedTemplateId: uploadTemplateId,
      sourceFiles: uploadFiles,
      isDragActive: isUploadDragActive,
      isUploadingDocuments,
      hasApiAccess: hasWorkspaceApiAccess,
      onClose: closeUploadModal,
      onSelectTemplate: setUploadTemplateId,
      onSelectSourceFiles: appendUploadFiles,
      onDragOver: handleUploadDragOver,
      onDragLeave: handleUploadDragLeave,
      onDrop: handleUploadDrop,
      onRemoveSourceFile: removeUploadFile,
      onSubmit: uploadFromModal,
    },
    toolbar: {
      documentCount: totalDocuments,
      isDeletingDocument,
      isExportingDocuments,
      selectedDocumentId: selectedDocument?.job_id || "",
      selectedDocumentCount: selectedDocumentIds.length,
      exportableDocumentCount: exportableSelectedDocumentIds.length,
      onExportDocuments: exportSelectedDocuments,
      onUploadDocument: openUploadModal,
      onDeleteDocument: deleteSelectedDocument,
    },
    documentPage: {
      selectedDocument,
      selectedDocumentTemplateName,
      loadingDocumentDetailsId,
    },
    metrics: {
      documentStatusMetrics,
      completionRate,
    },
    actions: {
      clearCompletedDocumentCache,
      clearWorkspaceScopedDocuments,
      deleteSelectedDocument,
      exportSelectedDocuments,
      listJobs,
      openUploadModal,
    },
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

function defaultUploadedName(sourceMimeType) {
  if (
    typeof sourceMimeType === "string" &&
    sourceMimeType.startsWith("image/")
  ) {
    return "Uploaded Document";
  }
  if (sourceMimeType === "application/pdf") {
    return "Uploaded Document";
  }
  return "Uploaded Source file";
}

function createWorkspaceLiveUpdateUrl(apiBase, workspaceId) {
  const basePath = String(apiBase || "/v1").replace(/\/+$/, "") || "/v1";
  const url = new URL(
    `${basePath}/workspaces/${encodeURIComponent(workspaceId)}/live`,
    window.location.origin,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseWorkspaceLiveUpdateMessage(message) {
  if (typeof message !== "string") {
    return { jobs: [], workspaceContextInvalidations: [] };
  }

  let envelope;
  try {
    envelope = JSON.parse(message);
  } catch {
    return { jobs: [], workspaceContextInvalidations: [] };
  }

  if (Number(envelope?.version) !== 1 || !Array.isArray(envelope?.events)) {
    return { jobs: [], workspaceContextInvalidations: [] };
  }

  const jobs = [];
  const workspaceContextInvalidations = [];

  for (const event of envelope.events) {
    if (event?.type === "extraction_job_lifecycle" && event?.job?.job_id) {
      jobs.push(event.job);
      continue;
    }

    const invalidationReason =
      typeof event?.reason === "string" ? event.reason.trim() : "";
    const invalidationOccurredAt =
      typeof event?.occurred_at === "string" ? event.occurred_at.trim() : "";
    if (
      event?.type === "workspace_context_invalidated" &&
      invalidationReason &&
      invalidationOccurredAt
    ) {
      workspaceContextInvalidations.push({
        reason: invalidationReason,
        occurred_at: invalidationOccurredAt,
      });
    }
  }

  return { jobs, workspaceContextInvalidations };
}

function hasDocumentStatusChanged(jobHistory, queuedJobs, nextJob) {
  const jobId = String(nextJob?.job_id || "").trim();
  const nextStatus = String(nextJob?.status || "").trim().toLowerCase();
  if (!jobId || !nextStatus || LIVE_DOCUMENT_STATUSES.has(nextStatus)) {
    return false;
  }

  const previousJob = Array.isArray(jobHistory)
    ? jobHistory.find((job) => String(job?.job_id || "").trim() === jobId)
    : null;
  const previousStatus = String(
    previousJob?.status || (queuedJobs?.[jobId] ? "queued" : ""),
  ).trim().toLowerCase();

  return Boolean(previousStatus) && previousStatus !== nextStatus;
}

function getDocumentSortTimestamp(job) {
  if (!job || typeof job !== "object") {
    return 0;
  }

  return Date.parse(job.created_at || job.queued_at || "") || 0;
}

function normalizeDocumentFilters(filters) {
  return {
    dateFrom: String(filters?.dateFrom || "").trim(),
    dateTo: String(filters?.dateTo || "").trim(),
    model: String(filters?.model || "").trim(),
  };
}

function normalizeAvailableDocumentModels(models) {
  return [...new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => String(model || "").trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function documentMatchesFilters(job, query, filters) {
  if (query) {
    const matchesQuery = [job.job_id, job.source_name, job.template_id, job.status]
      .map((value) => String(value || "").toLowerCase())
      .some((value) => value.includes(query));
    if (!matchesQuery) {
      return false;
    }
  }

  const createdDate = String(job.created_at || job.queued_at || "").slice(0, 10);
  if (filters.dateFrom && (!createdDate || createdDate < filters.dateFrom)) {
    return false;
  }
  if (filters.dateTo && (!createdDate || createdDate > filters.dateTo)) {
    return false;
  }
  if (filters.model && String(job.model_name || "") !== filters.model) {
    return false;
  }
  return true;
}

function fileDedupKey(name, size, lastModified) {
  return `${name}::${size}::${lastModified}`;
}
