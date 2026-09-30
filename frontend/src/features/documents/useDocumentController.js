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
  apiBase = "/v1", initialWorkspace, templates, selectedUploadTemplateId,
  onSelectedUploadTemplateChange, documentRequests, showActionToast,
  showDocumentUploadToast, hasApiAccess, hasWorkspaceApiAccess, isAppBusy,
  isWorkspaceDeletionInProgress = false, sessionId, workspaceId,
  onActivePageChange, onWorkspaceCapacityRefresh, onWorkspaceAccessRevalidation,
  onModelConfigurationInvalidation, onEvaluationDocumentChanged, modelReady = true, maxSourceFileBytes,
}) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTemplateId, setUploadTemplateId] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [liveUpdatesUnavailable, setLiveUpdatesUnavailable] = useState(false);
  const [isDownloadingOriginal, setIsDownloadingOriginal] = useState(false);
  const liveUpdateSocketRef = useRef(null);
  const liveUpdateReconnectTimerRef = useRef(null);
  const liveUpdateAccessRevalidationPendingRef = useRef(false);
  const workspaceDeletionInProgressRef = useRef(isWorkspaceDeletionInProgress);
  const workspaceCapacityRefreshTimerRef = useRef(null);
  const lastWorkspaceCapacityRefreshAtRef = useRef(0);
  const onWorkspaceCapacityRefreshRef = useRef(onWorkspaceCapacityRefresh);
  const onWorkspaceAccessRevalidationRef = useRef(onWorkspaceAccessRevalidation);
  const onModelConfigurationInvalidationRef = useRef(onModelConfigurationInvalidation);
  const onEvaluationDocumentChangedRef = useRef(onEvaluationDocumentChanged);
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  const canOpenLiveUpdates = hasApiAccess && Boolean(normalizedWorkspaceId) && typeof WebSocket === "function";
  const shouldUseLiveUpdates = canOpenLiveUpdates && !liveUpdatesUnavailable;

  useEffect(() => {
    onWorkspaceCapacityRefreshRef.current = onWorkspaceCapacityRefresh;
    onWorkspaceAccessRevalidationRef.current = onWorkspaceAccessRevalidation;
    onModelConfigurationInvalidationRef.current = onModelConfigurationInvalidation;
    onEvaluationDocumentChangedRef.current = onEvaluationDocumentChanged;
    workspaceDeletionInProgressRef.current = isWorkspaceDeletionInProgress;
  }, [onWorkspaceCapacityRefresh, onWorkspaceAccessRevalidation, onModelConfigurationInvalidation, onEvaluationDocumentChanged, isWorkspaceDeletionInProgress]);

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
      Promise.resolve(refreshWorkspaceCapacity()).catch(() => {});
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
      .catch(() => {});
  }, [clearWorkspaceCapacityRefreshTimer]);

  const { reconciliation, snapshot } = useDocumentReconciliation({
    sessionId, workspaceId: normalizedWorkspaceId, enabled: hasApiAccess,
    requests: documentRequests, initialWorkspace,
    callbacks: {
      onCapacityChange: scheduleWorkspaceCapacityRefresh,
      onAccessDenied: revalidateWorkspaceAccessNow,
    },
  });
  const {
    documents, selectedDocument, selectedDocumentId, selectedDocumentIds, totalDocuments,
    loadingDocumentId: loadingDocumentDetailsId,
    uploading: isUploadingDocuments, deleting: isDeletingDocument, exporting: isExportingDocuments,
  } = snapshot;
  const clearWorkspaceScopedDocuments = useCallback((options) => {
    reconciliation.clear(options);
    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = 0;
  }, [reconciliation, clearWorkspaceCapacityRefreshTimer]);
  const exportableSelectedDocumentIds = useMemo(() => {
    const ids = new Set(selectedDocumentIds.length ? selectedDocumentIds : selectedDocument ? [selectedDocument.job_id] : []);
    return documents.filter((job) => ids.has(job.job_id) && EXPORTABLE_DOCUMENT_STATUSES.has(job.status)).map((job) => job.job_id);
  }, [documents, selectedDocumentIds, selectedDocument]);

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

  function openUploadModal() {
    if (!modelReady || isAppBusy) {
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

  function handleUploadDrop(event) {
    setIsUploadDragActive(false);
    appendUploadFiles(Array.from(event.dataTransfer?.files || []));
  }

  function appendUploadFiles(nextFiles) {
    if (!nextFiles.length) {
      return;
    }

    setUploadFiles((prev) => {
      const existingKeys = new Set(prev.map((entry) => fileDedupKey(entry.file)));
      const additions = [];

      for (const file of nextFiles) {
        const key = fileDedupKey(file);
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
      onError: () => showActionToast("document.export", "failure"),
    });
  }

  const loadOriginal = useCallback(
    (documentId, options) => documentRequests.getOriginal(documentId, options),
    [documentRequests],
  );

  async function downloadSelectedOriginal() {
    const documentId = selectedDocument?.job_id;
    if (!documentId || selectedDocument.source_retained !== true || isDownloadingOriginal) return;
    setIsDownloadingOriginal(true);
    try {
      const original = await loadOriginal(documentId);
      downloadBlob(original.blob, original.filename);
    } catch (error) {
      showActionToast(error?.code === "source_missing" ? "document.downloadOriginalMissing" : "document.downloadOriginal", "failure");
    } finally {
      setIsDownloadingOriginal(false);
    }
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
          void reconciliation.refresh();
        }, 1000);
      }
    };
    socket.onclose = scheduleReconnect;
    socket.onerror = scheduleReconnect;
    socket.onmessage = (event) => {
      if (liveUpdateSocketRef.current !== socket) {
        return;
      }
      const { jobs, invalidationReasons, evaluationDocuments } = parseWorkspaceLiveUpdateMessage(event?.data);
      // Library changes are freshness hints for an open Evaluation; they never carry content.
      for (const change of evaluationDocuments) onEvaluationDocumentChangedRef.current?.(change);
      if (invalidationReasons.includes("model_configuration_changed")) {
        void onModelConfigurationInvalidationRef.current?.();
      }
      const contextInvalidationReasons = invalidationReasons.filter((reason) => reason !== "model_configuration_changed");
      if (contextInvalidationReasons.length) {
        if (contextInvalidationReasons.includes("workspace_access")) {
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
        const job = await reconciliation.loadDetails(selectedDocumentId);
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
    reconciliation,
    selectedDocumentId,
    selectedDocument?.status,
    shouldUseLiveUpdates,
  ]);

  return {
    contextList: {
      search: snapshot.search,
      documents,
      selectedDocumentId: selectedDocument?.job_id || "",
      selectedDocumentIds,
      debouncedSearch: snapshot.debouncedSearch,
      filters: snapshot.filters,
      availableModels: snapshot.availableModels,
      hasActiveFilters: Object.values(snapshot.filters).some(Boolean),
      hasMoreDocuments: snapshot.hasMore,
      isLoadingMoreDocuments: snapshot.loadingMore,
      isDeletingDocuments: isDeletingDocument,
      isExportingDocuments,
      onSearchChange: reconciliation.setSearch,
      onFiltersChange: reconciliation.setFilters,
      onSelectDocument: reconciliation.selectDocument,
      onToggleAllDocumentSelections: reconciliation.toggleSelection,
      onToggleDocumentSelection: (id, selected) => reconciliation.toggleSelection([id], selected),
      onLoadMoreDocuments: () => reconciliation.refresh({ append: true }),
    },
    uploadModal: {
      maxSourceFileBytes,
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
      onDragOver: () => setIsUploadDragActive(true),
      onDragLeave: () => setIsUploadDragActive(false),
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
      canDownloadOriginal: selectedDocument?.source_retained === true,
      isDownloadingOriginal,
      onDownloadOriginal: downloadSelectedOriginal,
    },
    documentPage: {
      selectedDocument,
      selectedDocumentTemplateName,
      loadingDocumentDetailsId,
      loadOriginal,
    },
    statusCounts: snapshot.statusCounts,
    actions: {
      cancelPendingSubmissions: reconciliation.cancelPendingSubmissions,
      clearWorkspaceScopedDocuments,
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
  const basePath = apiBase.replace(/\/+$/, "");
  const url = new URL(
    `${basePath}/workspaces/${encodeURIComponent(workspaceId)}/live`,
    window.location.origin,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseWorkspaceLiveUpdateMessage(message) {
  const jobs = [];
  const invalidationReasons = [];
  const evaluationDocuments = [];
  let envelope = null;
  try {
    envelope = JSON.parse(message);
  } catch {
    // Malformed messages carry nothing to apply.
  }
  if (Number(envelope?.version) !== 1 || !Array.isArray(envelope.events)) {
    return { jobs, invalidationReasons, evaluationDocuments };
  }

  for (const event of envelope.events) {
    if (event?.type === "extraction_job_lifecycle" && event.job?.job_id) {
      jobs.push(event.job);
    } else if (
      event?.type === "workspace_context_invalidated" &&
      typeof event.reason === "string" && event.reason.trim() &&
      typeof event.occurred_at === "string" && event.occurred_at.trim()
    ) {
      invalidationReasons.push(event.reason.trim());
    } else if (event?.type === "evaluation_document_changed" && typeof event.document_id === "string" && event.document_id) {
      evaluationDocuments.push({ document_id: event.document_id, revision: event.revision ?? null, deleted: event.deleted === true });
    }
  }
  return { jobs, invalidationReasons, evaluationDocuments };
}

function fileDedupKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}
