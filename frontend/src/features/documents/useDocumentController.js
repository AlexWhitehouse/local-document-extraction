import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCompletedDocumentCache } from "../../lib/completedDocumentCache";

const DEFAULT_OPTIONS = {
  include_confidence: true,
  include_evidence: true,
};

const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_DELAY_MS = 150;
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_MIN_INTERVAL_MS = 3000;

export function useDocumentController({
  apiBase = "/v1",
  initialWorkspace = {},
  templates,
  selectedUploadTemplateId,
  onSelectedUploadTemplateChange,
  request,
  addLog,
  showActionToast,
  showDocumentUploadToast,
  hasApiAccess,
  hasWorkspaceApiAccess,
  canSubmitDocuments = hasWorkspaceApiAccess,
  submissionBlockingReasons = [],
  isAppBusy,
  workspaceId,
  latestResponse,
  setLatestResponse,
  onActivePageChange,
  onWorkspaceCapacityRefresh,
}) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
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
  const [isLoadingMoreJobs, setIsLoadingMoreJobs] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    initialWorkspace.selectedDocumentId || "",
  );
  const [documentSearch, setDocumentSearch] = useState("");
  const [debouncedDocumentSearch, setDebouncedDocumentSearch] = useState("");
  const [liveUpdatesUnavailable, setLiveUpdatesUnavailable] = useState(false);

  const previewUrlsRef = useRef(new Set());
  const completedDocumentCacheRef = useRef(createCompletedDocumentCache());
  const liveUpdateSocketRef = useRef(null);
  const liveUpdateReconnectTimerRef = useRef(null);
  const liveUpdateAccessRevalidationPendingRef = useRef(false);
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
  const queuedJobsRef = useRef(queuedJobs);
  const requestRef = useRef(request);
  const workspaceIdRef = useRef(workspaceId);
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  const normalizedSubmissionBlockingReasons = Array.isArray(
    submissionBlockingReasons,
  )
    ? submissionBlockingReasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    : [];
  const canOpenLiveUpdates =
    hasApiAccess && Boolean(normalizedWorkspaceId) && typeof WebSocket === "function";
  const shouldUseLiveUpdates = canOpenLiveUpdates && !liveUpdatesUnavailable;

  useEffect(() => {
    addLogRef.current = addLog;
    onWorkspaceCapacityRefreshRef.current = onWorkspaceCapacityRefresh;
    requestRef.current = request;
  }, [addLog, onWorkspaceCapacityRefresh, request]);

  useEffect(() => {
    jobHistoryRef.current = jobHistory;
    jobsNextCursorRef.current = jobsNextCursor;
    latestResponseRef.current = latestResponse;
    queuedJobsRef.current = queuedJobs;
    workspaceIdRef.current = workspaceId;
  }, [jobHistory, jobsNextCursor, latestResponse, queuedJobs, workspaceId]);

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
      }))
      .filter((job) => {
        if (!query) {
          return true;
        }

        return [job.job_id, job.source_name, job.template_id, job.status]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(query));
      });

    return [...jobHistory, ...queuedOnly].sort((a, b) => {
      const left = getDocumentSortTimestamp(b);
      const right = getDocumentSortTimestamp(a);
      return left - right;
    });
  }, [debouncedDocumentSearch, jobHistory, queuedJobs, selectedUploadTemplateId]);

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
    const refreshWorkspaceCapacity = onWorkspaceCapacityRefreshRef.current;
    if (typeof refreshWorkspaceCapacity !== "function") {
      return;
    }

    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = Date.now();
    liveUpdateAccessRevalidationPendingRef.current = true;
    Promise.resolve(refreshWorkspaceCapacity())
      .then(() => {
        liveUpdateAccessRevalidationPendingRef.current = false;
      })
      .catch((error) => {
        addLogRef.current?.(`Refresh workspace access failed: ${error.message}`);
      });
  }, [clearWorkspaceCapacityRefreshTimer]);

  const clearWorkspaceScopedDocuments = useCallback(() => {
    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = 0;
    setJobHistory([]);
    setQueuedJobs({});
    setJobsNextCursor(null);
    setJobsHasMore(false);
    setSelectedDocumentId("");
    setLatestResponse(null);
    liveCompletedDetailLoadsRef.current.clear();
  }, [clearWorkspaceCapacityRefreshTimer, setLatestResponse]);

  const upsertJobHistory = useCallback((job) => {
    if (!job?.job_id) {
      return;
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
  }, []);

  const listJobs = useCallback(async ({ append = false } = {}) => {
    try {
      const params = new URLSearchParams();
      const search = debouncedDocumentSearch.trim();
      if (search) {
        params.set("search", search);
      }
      const nextCursor = jobsNextCursorRef.current;
      if (append && nextCursor) {
        params.set("cursor", nextCursor);
      }

      const query = params.toString();
      const data = await requestRef.current(query ? `/jobs?${query}` : "/jobs", {
        method: "GET",
      });
      const list = Array.isArray(data?.jobs) ? data.jobs : [];
      const isFilteredList = Boolean(search);
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
      setSelectedDocumentId((currentSelectedDocumentId) =>
        currentSelectedDocumentId || !hydratedList[0]?.job_id
          ? currentSelectedDocumentId
          : String(hydratedList[0].job_id),
      );
      addLogRef.current(
        `${append ? "Loaded" : "Loaded"} ${list.length} document${list.length === 1 ? "" : "s"}${search ? ` matching "${search}"` : ""}`,
      );
    } catch (error) {
      addLogRef.current(`List documents failed: ${error.message}`);
    }
  }, [debouncedDocumentSearch, workspaceId]);

  useEffect(() => {
    listJobsRef.current = listJobs;
  }, [listJobs]);

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
    if (latestResponseRef.current?.job_id === targetDocumentId) {
      setLatestResponse(null);
    }
  }, [setLatestResponse]);

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
        const data = await requestRef.current(
          `/jobs/${encodeURIComponent(normalizedJobId)}`,
          {
            method: "GET",
          },
        );
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
    if (!canSubmitDocuments) {
      if (normalizedSubmissionBlockingReasons.length) {
        addLog(
          `Upload blocked: ${normalizedSubmissionBlockingReasons.join(", ")}`,
        );
        showActionToast("document.upload", "validation", {
          reason: "billing",
          blockingReasons: normalizedSubmissionBlockingReasons,
        });
      }
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
      let billingFailedCount = 0;

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
          if (isBillingQueueError(error)) {
            billingFailedCount += 1;
          }
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
        billingFailed: billingFailedCount,
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

    const queued = await request("/extract", {
      method: "POST",
      body: formData,
    });

    const jobId = queued.job_id;
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
    if (!selectedDocument?.job_id) {
      addLog("Delete document failed: select a document first");
      return;
    }
    if (isDeletingDocument) {
      return;
    }

    const targetDocumentId = String(selectedDocument.job_id);
    const targetDocumentName = selectedDocument.source_name || targetDocumentId;
    if (
      !window.confirm(
        `Delete document ${targetDocumentId}? This will permanently remove it from the workspace.`,
      )
    ) {
      return;
    }

    setIsDeletingDocument(true);
    try {
      await request(`/jobs/${encodeURIComponent(targetDocumentId)}`, {
        method: "DELETE",
      });
      removeDocumentFromState(
        targetDocumentId,
        selectedDocument.source_preview_url,
      );
      const nextDocumentId =
        documents.find((job) => String(job.job_id || "") !== targetDocumentId)
          ?.job_id || "";
      setSelectedDocumentId(nextDocumentId);
      if (nextDocumentId) {
        void loadJobDetails(nextDocumentId, { silent: true });
      }
      addLog(`Deleted document ${targetDocumentId}`);
      showActionToast("document.delete", "success", {
        targetName: targetDocumentName,
      });
    } catch (error) {
      if (Number(error?.status) === 404) {
        removeDocumentFromState(
          targetDocumentId,
          selectedDocument.source_preview_url,
        );
        const nextDocumentId =
          documents.find((job) => String(job.job_id || "") !== targetDocumentId)
            ?.job_id || "";
        setSelectedDocumentId(nextDocumentId);
        if (nextDocumentId) {
          void loadJobDetails(nextDocumentId, { silent: true });
        }
        addLog(`Document ${targetDocumentId} was already removed`);
        showActionToast("document.delete", "alreadyRemoved", {
          targetName: targetDocumentName,
        });
        return;
      }
      addLog(`Delete document failed: ${error.message}`);
      showActionToast("document.delete", "failure");
    } finally {
      setIsDeletingDocument(false);
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
          revalidateWorkspaceAccessNow();
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
        upsertJobHistory(job);
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

    const intervalId = window.setInterval(() => {
      void loadJobDetails(selectedDocumentId, { silent: true });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
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
      debouncedSearch: debouncedDocumentSearch,
      hasMoreDocuments: jobsHasMore,
      isLoadingMoreDocuments: isLoadingMoreJobs,
      onSearchChange: setDocumentSearch,
      onSelectDocument: setSelectedDocumentId,
      onLoadMoreDocuments: loadMoreJobs,
    },
    uploadModal: {
      isOpen: showUploadModal,
      templates,
      selectedTemplateId: uploadTemplateId,
      sourceFiles: uploadFiles,
      isDragActive: isUploadDragActive,
      isUploadingDocuments,
      hasApiAccess: canSubmitDocuments,
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
      documentCount: documents.length,
      isDeletingDocument,
      selectedDocumentId: selectedDocument?.job_id || "",
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
      listJobs,
      openUploadModal,
    },
  };
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

function fileDedupKey(name, size, lastModified) {
  return `${name}::${size}::${lastModified}`;
}

function isBillingQueueError(error) {
  const code = String(error?.code || "").toLowerCase();
  return Number(error?.status) === 402 || code.startsWith("billing_");
}
