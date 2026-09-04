import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { documentScopeKey } from "./documentReconciliation";
import { useDocumentReconciliation } from "./useDocumentReconciliation";

const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);
const EXPORTABLE_DOCUMENT_STATUSES = new Set(["completed", "failed"]);
const FALLBACK_POLL_INITIAL_DELAY_MS = 5000;
const FALLBACK_POLL_ACTIVE_DELAY_MS = 8000;
const FALLBACK_POLL_MAX_FAILURE_DELAY_MS = 30000;
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_DELAY_MS = 150;
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_MIN_INTERVAL_MS = 3000;

export function useDocumentController({
  apiBase = "/v1", initialWorkspace = {}, templates, selectedUploadTemplateId,
  onSelectedUploadTemplateChange, documentRequests, addLog, showActionToast,
  showDocumentUploadToast, hasApiAccess, hasWorkspaceApiAccess, isAppBusy,
  isWorkspaceDeletionInProgress = false, sessionId, workspaceId, setLatestResponse,
  onActivePageChange, onWorkspaceCapacityRefresh, onWorkspaceAccessRevalidation,
  onModelConfigurationInvalidation, modelReady = true,
}) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTemplateId, setUploadTemplateId] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [liveUpdatesUnavailable, setLiveUpdatesUnavailable] = useState(false);
  const liveUpdateSocketRef = useRef(null);
  const liveUpdateReconnectTimerRef = useRef(null);
  const liveUpdateAccessRevalidationPendingRef = useRef(false);
  const workspaceDeletionInProgressRef = useRef(isWorkspaceDeletionInProgress);
  const workspaceCapacityRefreshTimerRef = useRef(null);
  const lastWorkspaceCapacityRefreshAtRef = useRef(0);
  const addLogRef = useRef(addLog);
  const listJobsRef = useRef(null);
  const onWorkspaceCapacityRefreshRef = useRef(onWorkspaceCapacityRefresh);
  const onWorkspaceAccessRevalidationRef = useRef(onWorkspaceAccessRevalidation || onWorkspaceCapacityRefresh);
  const onModelConfigurationInvalidationRef = useRef(onModelConfigurationInvalidation);
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  const canOpenLiveUpdates = hasApiAccess && Boolean(normalizedWorkspaceId) && typeof WebSocket === "function";
  const shouldUseLiveUpdates = canOpenLiveUpdates && !liveUpdatesUnavailable;

  useEffect(() => {
    addLogRef.current = addLog;
    onWorkspaceCapacityRefreshRef.current = onWorkspaceCapacityRefresh;
    onWorkspaceAccessRevalidationRef.current = onWorkspaceAccessRevalidation || onWorkspaceCapacityRefresh;
    onModelConfigurationInvalidationRef.current = onModelConfigurationInvalidation;
    workspaceDeletionInProgressRef.current = isWorkspaceDeletionInProgress;
  }, [addLog, onWorkspaceCapacityRefresh, onWorkspaceAccessRevalidation, onModelConfigurationInvalidation, isWorkspaceDeletionInProgress]);

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

  const { reconciliation, snapshot } = useDocumentReconciliation({
    sessionId, workspaceId: normalizedWorkspaceId, enabled: hasApiAccess,
    requests: documentRequests, initialWorkspace,
    callbacks: {
      onResponse: setLatestResponse,
      onLog: addLog,
      onCapacityChange: scheduleWorkspaceCapacityRefresh,
      onAccessDenied: revalidateWorkspaceAccessNow,
    },
  });
  const {
    documents, selectedDocument, selectedDocumentId, selectedDocumentIds,
    search: documentSearch, debouncedSearch: debouncedDocumentSearch, filters: documentFilters,
    availableModels: availableDocumentModels, totalDocuments, hasMore: jobsHasMore,
    loadingMore: isLoadingMoreJobs, loadingDocumentId: loadingDocumentDetailsId,
    uploading: isUploadingDocuments, deleting: isDeletingDocument, exporting: isExportingDocuments,
  } = snapshot;
  const hasActiveDocumentFilters = Object.values(documentFilters).some(Boolean);
  const listJobs = reconciliation.refresh;
  const loadJobDetails = reconciliation.loadDetails;
  const setDocumentSearch = reconciliation.setSearch;
  const applyDocumentFilters = reconciliation.setFilters;
  const setSelectedDocumentId = reconciliation.selectDocument;
  const toggleDocumentSelection = (id, selected) => reconciliation.toggleSelection([id], selected);
  const toggleAllDocumentSelections = reconciliation.toggleSelection;
  const loadMoreJobs = () => reconciliation.refresh({ append: true });
  const clearWorkspaceScopedDocuments = useCallback((options) => {
    reconciliation.clear(options);
    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = 0;
    setLatestResponse(null);
  }, [reconciliation, clearWorkspaceCapacityRefreshTimer, setLatestResponse]);
  const exportableSelectedDocumentIds = useMemo(() => {
    const ids = new Set(selectedDocumentIds.length ? selectedDocumentIds : selectedDocument ? [selectedDocument.job_id] : []);
    return documents.filter((job) => ids.has(job.job_id) && EXPORTABLE_DOCUMENT_STATUSES.has(job.status)).map((job) => job.job_id);
  }, [documents, selectedDocumentIds, selectedDocument]);

  useEffect(() => { listJobsRef.current = listJobs; }, [listJobs]);
  useEffect(() => {
    setShowUploadModal(false);
    setUploadFiles([]);
    setIsUploadDragActive(false);
    if (hasApiAccess) {
      void reconciliation.refresh();
      void reconciliation.loadModels();
    }
  }, [reconciliation, sessionId, normalizedWorkspaceId, hasApiAccess]);
  useEffect(() => {
    if (hasApiAccess && selectedDocumentId) void reconciliation.ensureSelectedDetails();
  }, [reconciliation, hasApiAccess, selectedDocumentId, selectedDocument?.status, selectedDocument?.updated_at, selectedDocument?.current_attempt, loadingDocumentDetailsId]);
  useEffect(() => () => clearWorkspaceCapacityRefreshTimer(), [clearWorkspaceCapacityRefreshTimer]);

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

  function openUploadModal() {
    if (!modelReady) return;
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
    if (!modelReady || isUploadingDocuments) return;
    if (!uploadTemplateId.trim()) {
      showActionToast("document.upload", "validation", { reason: "template" });
      return;
    }
    if (!uploadFiles.length) {
      showActionToast("document.upload", "validation", { reason: "files" });
      return;
    }
    onSelectedUploadTemplateChange(uploadTemplateId.trim());
    await reconciliation.submitBatch({
      templateId: uploadTemplateId.trim(), entries: uploadFiles,
      onProgress: (id, queueStatus, queueError) => setUploadFiles((rows) => rows.map((row) => row.id === id ? { ...row, queueStatus, queueError } : row)),
      onComplete: (outcome) => {
        showDocumentUploadToast(outcome);
        onActivePageChange("documents");
      },
    });
  }

  async function deleteSelectedDocument() {
    const isBulkDelete = selectedDocumentIds.length > 0;
    const targetDocuments = isBulkDelete
      ? documents.filter((job) => selectedDocumentIds.includes(job.job_id))
      : selectedDocument ? [selectedDocument] : [];
    if (!targetDocuments.length || isDeletingDocument || isExportingDocuments) return;
    const target = targetDocuments[0];
    const message = isBulkDelete
      ? `Delete ${targetDocuments.length} selected document${targetDocuments.length === 1 ? "" : "s"}? This will permanently remove ${targetDocuments.length === 1 ? "it" : "them"} from the workspace.`
      : `Delete document ${target.job_id}? This will permanently remove it from the workspace.`;
    if (!window.confirm(message)) return;
    await reconciliation.deleteDocuments(targetDocuments.map((job) => job.job_id), {
      onComplete: (results) => {
        const removed = results.filter((result) => result.removed);
        if (isBulkDelete) {
          showActionToast("document.bulkDelete", removed.length === results.length ? "success" : "failure", {
            targetName: `${removed.length} document${removed.length === 1 ? "" : "s"}`,
          });
        } else {
          showActionToast("document.delete", results[0].removed ? results[0].alreadyRemoved ? "alreadyRemoved" : "success" : "failure", {
            targetName: target.source_name || target.job_id,
          });
        }
      },
    });
  }

  async function exportSelectedDocuments() {
    if (!exportableSelectedDocumentIds.length || isExportingDocuments) return;
    await reconciliation.exportDocuments(selectedDocumentIds.length ? selectedDocumentIds : exportableSelectedDocumentIds, {
      onComplete: (exported) => {
        downloadBlob(exported.blob, exported.filename);
        showActionToast("document.export", "success", { exportedCount: exported.exportedCount, skippedCount: exported.skippedCount });
      },
      onError: (error) => {
        addLog(`Export selected jobs failed: ${error.message}`);
        showActionToast("document.export", "failure");
      },
    });
  }

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
        void onModelConfigurationInvalidationRef.current?.();
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
      const parsed = parseWorkspaceLiveUpdateMessage(event?.data);
      const jobs = parsed.jobs;
      if (parsed.workspaceContextInvalidations.some((item) => item.reason === "model_configuration_changed")) {
        void onModelConfigurationInvalidationRef.current?.();
      }
      const workspaceContextInvalidations = parsed.workspaceContextInvalidations.filter((item) => item.reason !== "model_configuration_changed");
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
      reconciliation.receiveLiveUpdates(jobs, documentScopeKey(sessionId, normalizedWorkspaceId, hasApiAccess));
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
    hasApiAccess,
    clearLiveUpdateReconnectTimer,
    clearWorkspaceCapacityRefreshTimer,
    liveUpdatesUnavailable,
    normalizedWorkspaceId,
    revalidateWorkspaceAccessNow,
    scheduleWorkspaceCapacityRefresh,
    reconciliation,
    sessionId,
  ]);

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
    let nextDelayMs = FALLBACK_POLL_INITIAL_DELAY_MS;

    const schedulePoll = () => {
      const jitteredDelayMs = Math.ceil(nextDelayMs * (1 + Math.random() * 0.2));
      timeoutId = window.setTimeout(async () => {
        const job = await loadJobDetails(selectedDocumentId);
        if (cancelled) {
          return;
        }
        if (job === null) {
          nextDelayMs = Math.min(
            FALLBACK_POLL_MAX_FAILURE_DELAY_MS,
            Math.max(FALLBACK_POLL_ACTIVE_DELAY_MS, nextDelayMs * 2),
          );
          schedulePoll();
          return;
        }
        if (!LIVE_DOCUMENT_STATUSES.has(String(job?.status || "").toLowerCase())) {
          return;
        }
        nextDelayMs = FALLBACK_POLL_ACTIVE_DELAY_MS;
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
      hasApiAccess: hasWorkspaceApiAccess && modelReady,
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
      cancelPendingSubmissions: reconciliation.cancelPendingSubmissions,
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

function fileDedupKey(name, size, lastModified) {
  return `${name}::${size}::${lastModified}`;
}
