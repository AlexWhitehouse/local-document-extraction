import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { documentScopeKey } from "./documentReconciliation";
import { usePacketController } from "./usePacketController.js";
import { isPacketListed, isSingleDocumentPacket, singlePacketDocument } from "./packetListing.js";
import { useDocumentReconciliation } from "./useDocumentReconciliation";

const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);
const EXPORTABLE_DOCUMENT_STATUSES = new Set(["completed", "failed"]);
const FALLBACK_POLL_INITIAL_DELAY_MS = 5000;
const FALLBACK_POLL_ACTIVE_DELAY_MS = 8000;
const FALLBACK_POLL_MAX_FAILURE_DELAY_MS = 30000;
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_DELAY_MS = 150;
const WORKSPACE_CONTEXT_INVALIDATION_REFRESH_MIN_INTERVAL_MS = 3000;

export function useDocumentController({
  apiBase = "/v1", initialWorkspace, templates, workspaceTags = [], onProcessingPolicyRefresh, onTagsRefresh, selectedUploadTemplateId,
  onSelectedUploadTemplateChange, documentRequests, showActionToast,
  showDocumentUploadToast, hasApiAccess, hasWorkspaceApiAccess, isAppBusy,
  isWorkspaceDeletionInProgress = false, sessionId, workspaceId,
  onActivePageChange, onWorkspaceCapacityRefresh, onWorkspaceAccessRevalidation,
  onModelConfigurationInvalidation, onEvaluationDocumentChanged, modelReady = true, maxSourceFileBytes,
}) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTemplateId, setUploadTemplateId] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadTags, setUploadTags] = useState([]);
  const [isResolvingTemplate, setIsResolvingTemplate] = useState(false);
  const [templateResolutionError, setTemplateResolutionError] = useState("");
  const actionScopeRef = useRef(null);
  const actionScope = useMemo(() => ({ sessionId, workspaceId, hasApiAccess }), [sessionId, workspaceId, hasApiAccess]);
  actionScopeRef.current = actionScope;
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [liveUpdatesUnavailable, setLiveUpdatesUnavailable] = useState(false);
  const [isDownloadingOriginal, setIsDownloadingOriginal] = useState(false);
  // The packet tab showing a child document; empty shows the packet overview.
  const [packetChildId, setPacketChildId] = useState("");
  // The tab being opened: it highlights at once, but its panel replaces the current one only when loaded.
  const [pendingPacketTab, setPendingPacketTab] = useState(null);
  const [packetChildError, setPacketChildError] = useState(null);
  const packetTabRequestRef = useRef(0);
  const automaticSingleDocumentRef = useRef("");
  // Ticked packet rows; bulk actions apply to a packet and all of its documents.
  const [selectedPacketIds, setSelectedPacketIds] = useState([]);
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
  const packetController = usePacketController({
    requests: documentRequests, sessionId, workspaceId: normalizedWorkspaceId, enabled: hasApiAccess,
    onAccessDenied: revalidateWorkspaceAccessNow, onJobsChanged: () => reconciliation.refresh(),
  });
  const packetControllerRef = useRef(packetController);
  packetControllerRef.current = packetController;
  const clearWorkspaceScopedDocuments = useCallback((options) => {
    reconciliation.clear(options);
    packetControllerRef.current.clear();
    setSelectedPacketIds([]);
    packetTabRequestRef.current += 1;
    setPacketChildId("");
    setPendingPacketTab(null);
    setPacketChildError(null);
    actionScopeRef.current = null;
    clearWorkspaceCapacityRefreshTimer();
    lastWorkspaceCapacityRefreshAtRef.current = 0;
  }, [reconciliation, clearWorkspaceCapacityRefreshTimer]);

  useEffect(() => {
    setShowUploadModal(false);
    setUploadFiles([]);
    setUploadTags([]);
    setIsResolvingTemplate(false);
    setTemplateResolutionError("");
    setIsUploadDragActive(false);
    packetTabRequestRef.current += 1;
    setPacketChildId("");
    setPendingPacketTab(null);
    setPacketChildError(null);
    setSelectedPacketIds([]);
    if (hasApiAccess) {
      void reconciliation.refresh();
      void reconciliation.loadModels();
    }
  }, [reconciliation, sessionId, normalizedWorkspaceId, hasApiAccess]);
  useEffect(() => {
    if (hasApiAccess && selectedDocumentId) void reconciliation.ensureSelectedDetails();
  }, [reconciliation, hasApiAccess, selectedDocumentId, selectedDocument?.status, selectedDocument?.updated_at, selectedDocument?.current_attempt, loadingDocumentDetailsId]);
  useEffect(() => () => clearWorkspaceCapacityRefreshTimer(), [clearWorkspaceCapacityRefreshTimer]);
  useEffect(() => setTemplateResolutionError(""), [selectedDocumentId]);

  function openUploadModal() {
    if (!modelReady || isAppBusy) {
      return;
    }
    void onProcessingPolicyRefresh?.();
    void onTagsRefresh?.();
    setUploadTags([]);
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
    if (!uploadTemplateId.trim() || (uploadTemplateId === "automatic" && !uploadTags.length)) {
      showActionToast("document.upload", "validation", { reason: "template" });
      return;
    }
    if (!uploadFiles.length) {
      showActionToast("document.upload", "validation", { reason: "files" });
      return;
    }
    onSelectedUploadTemplateChange(uploadTemplateId.trim());
    await reconciliation.submitBatch({
      templateId: uploadTemplateId === "automatic" ? "" : uploadTemplateId.trim(),
      templateTags: uploadTemplateId === "automatic" ? uploadTags : undefined, entries: uploadFiles,
      onPacket: packetController.admitted,
      onProgress: (id, queueStatus, queueError) => setUploadFiles((rows) => rows.map((row) => row.id === id ? { ...row, queueStatus, queueError } : row)),
      onComplete: (outcome) => {
        showDocumentUploadToast(outcome);
        onActivePageChange("documents");
      },
    });
  }

  async function resolveTemplate(documentId, templateId) {
    if (isResolvingTemplate) return;
    const scope = actionScopeRef.current;
    setIsResolvingTemplate(true);
    setTemplateResolutionError("");
    try {
      const result = await documentRequests.resolveTemplate(documentId, templateId);
      if (scope !== actionScopeRef.current) return;
      reconciliation.receiveLiveUpdates([result], documentScopeKey(sessionId, normalizedWorkspaceId, hasApiAccess));
      await reconciliation.loadDetails(documentId);
      void reconciliation.refresh();
    } catch (error) {
      if (scope !== actionScopeRef.current) return;
      setTemplateResolutionError(error.message || "Template selection could not be saved.");
      if (error.status === 403) revalidateWorkspaceAccessNow();
      if (error.status === 409) await reconciliation.loadDetails(documentId);
    } finally { if (scope === actionScopeRef.current) setIsResolvingTemplate(false); }
  }

  function selectPacket(id) {
    packetController.select(id);
    // Packets that have split open on their first document; the rest open on the overview.
    const packet = packetController.packets.find((row) => row.packet_id === id);
    const firstChild = packet?.status !== "awaiting_review" ? packet?.children?.[0]?.job_id : "";
    setPacketChildId("");
    if (firstChild) void selectPacketChild(firstChild, { isOpening: true });
    else cancelPacketTab();
  }

  function cancelPacketTab() {
    packetTabRequestRef.current += 1;
    setPendingPacketTab(null);
    setPacketChildError(null);
  }

  const selectPacketChild = useCallback(async (id, { isOpening = false } = {}) => {
    const request = ++packetTabRequestRef.current;
    setPacketChildError(null);
    if (!id) { setPendingPacketTab(null); setPacketChildId(""); return; }
    setPendingPacketTab({ id, isOpening });
    const scope = actionScopeRef.current;
    const job = await reconciliation.loadDetails(id);
    if (request !== packetTabRequestRef.current || scope !== actionScopeRef.current) return;
    setPendingPacketTab(null);
    if (!job) { setPacketChildError({ id, message: "Document details could not be loaded. Try again." }); return; }
    // A child hidden by the list filters can only become the selection once the filters clear.
    reconciliation.selectDocument(id, { clearFilters: !documents.some((row) => row.job_id === id) });
    setPacketChildId(id);
  }, [reconciliation, documents]);

  function selectDocument(id) {
    packetController.select("");
    cancelPacketTab();
    setPacketChildId("");
    reconciliation.selectDocument(id);
  }

  const openPacket = packetController.selectedId ? packetController.selectedPacket : null;
  const soleChild = singlePacketDocument(openPacket);
  const singleDocument = soleChild && (documents.find((document) => document.job_id === soleChild.job_id) || soleChild);
  const isSingleDocument = isSingleDocumentPacket(openPacket);
  const activePacketChild = openPacket?.children?.some((child) => child.job_id === packetChildId) && selectedDocument?.job_id === packetChildId
    ? selectedDocument : null;
  const actionDocument = packetController.selectedId ? activePacketChild || singleDocument : selectedDocument;
  const selectedDocumentTemplateName = documentTemplateName(actionDocument, templates);
  const automaticSingleDocumentKey = singleDocument ? `${sessionId}\0${normalizedWorkspaceId}\0${openPacket.packet_id}\0${singleDocument.job_id}` : "";
  const singleDocumentId = singleDocument?.job_id || "";
  useEffect(() => {
    if (automaticSingleDocumentRef.current === automaticSingleDocumentKey) return;
    automaticSingleDocumentRef.current = automaticSingleDocumentKey;
    if (singleDocumentId && packetChildId !== singleDocumentId && pendingPacketTab?.id !== singleDocumentId) {
      void selectPacketChild(singleDocumentId, { isOpening: true });
    }
  }, [automaticSingleDocumentKey, singleDocumentId, packetChildId, pendingPacketTab?.id, selectPacketChild]);
  // Selection is limited to rows the list currently shows, like document selection.
  const checkedPackets = packetController.packets.filter((packet) => selectedPacketIds.includes(packet.packet_id)
    && isPacketListed(packet, documents, snapshot.debouncedSearch, snapshot.filters, Object.values(snapshot.filters).some(Boolean)));
  const checkedDocumentIds = selectedDocumentIds;
  const checkedRowCount = checkedDocumentIds.length + checkedPackets.length;
  const packetChildren = (packet) => (Array.isArray(packet?.children) ? packet.children : [])
    .map((child) => documents.find((document) => document.job_id === child.job_id) || child);
  // Export covers ticked rows; otherwise the open document, or every document in the open packet.
  const exportCandidates = checkedRowCount
    ? [...documents.filter((job) => checkedDocumentIds.includes(job.job_id)), ...checkedPackets.flatMap(packetChildren)]
    : actionDocument ? [actionDocument] : packetChildren(openPacket);
  const exportableSelectedDocumentIds = [...new Set(exportCandidates
    .filter((job) => EXPORTABLE_DOCUMENT_STATUSES.has(job.status)).map((job) => job.job_id))];

  function togglePacketSelection(id, selected) {
    setSelectedPacketIds((current) => selected ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  }

  function deleteSelectedPacket() {
    const id = packetController.selectedId;
    const scope = actionScopeRef.current;
    if (!id || packetController.busy) return;
    if (!window.confirm(`Delete packet ${id} and all its child documents? This permanently removes their results and available originals.`)) return;
    setPacketChildId("");
    void packetController.removeMany([id]).then((removed) => {
      if (scope !== actionScopeRef.current) return;
      setSelectedPacketIds((current) => current.filter((value) => !removed.includes(value)));
      showActionToast("document.delete", removed.length ? "success" : "failure", { targetName: openPacket?.source_name || id });
    });
  }

  async function deleteSelectedDocument() {
    if (isDeletingDocument || isExportingDocuments || packetController.busy) return;
    if (!checkedRowCount) {
      // A normal-looking single document owns a hidden packet and its original too.
      if (isSingleDocument && openPacket) await deleteDocuments([], [openPacket]);
      else if (actionDocument) await deleteDocuments([actionDocument], []);
      else if (openPacket) deleteSelectedPacket();
      return;
    }
    await deleteDocuments(documents.filter((job) => checkedDocumentIds.includes(job.job_id)), checkedPackets);
  }

  async function deleteDocuments(targetDocuments, targetPackets) {
    const scope = actionScopeRef.current;
    const packetId = packetController.selectedId;
    const singlePackets = targetPackets.filter(isSingleDocumentPacket);
    const visiblePackets = targetPackets.filter((packet) => !isSingleDocumentPacket(packet));
    const documentCount = targetDocuments.length + singlePackets.length;
    const isBulkDelete = targetDocuments.length + targetPackets.length > 1 || visiblePackets.length > 0;
    const target = targetDocuments[0] || targetPackets[0];
    if (!target) return;
    const childCount = visiblePackets.reduce((total, packet) => total + packetChildren(packet).length, 0);
    const parts = [
      documentCount ? `${documentCount} document${documentCount === 1 ? "" : "s"}` : "",
      visiblePackets.length ? `${visiblePackets.length} packet${visiblePackets.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" and ");
    const message = isBulkDelete
      ? `Delete ${parts.replace(/^(\d+) /, "$1 selected ")}${childCount ? `, including ${childCount} document${childCount === 1 ? "" : "s"} split from ${visiblePackets.length === 1 ? "the packet" : "the packets"}` : ""}? This will permanently remove ${targetDocuments.length + targetPackets.length === 1 ? "it" : "them"} from the workspace.`
      : `Delete document ${target.job_id || singlePacketDocument(target)?.job_id || target.packet_id}? This will permanently remove it from the workspace.`;
    if (!window.confirm(message)) return;
    let removedPackets = [];
    if (targetPackets.length) {
      removedPackets = await packetController.removeMany(targetPackets.map((packet) => packet.packet_id));
      if (scope !== actionScopeRef.current) return;
      setSelectedPacketIds((current) => current.filter((value) => !removedPackets.includes(value)));
      if (removedPackets.includes(packetId)) setPacketChildId("");
    }
    const report = (removedDocuments, documentTotal) => {
      if (isBulkDelete) {
        const removedTotal = removedDocuments + removedPackets.length;
        showActionToast("document.bulkDelete", removedTotal === documentTotal + targetPackets.length ? "success" : "failure", {
          targetName: parts,
        });
      }
    };
    if (!targetDocuments.length) {
      if (isBulkDelete) report(0, 0);
      else showActionToast("document.delete", removedPackets.length ? "success" : "failure", { targetName: target.source_name || target.packet_id });
      return;
    }
    await reconciliation.deleteDocuments(targetDocuments.map((job) => job.job_id), {
      onComplete: (results) => {
        if (scope !== actionScopeRef.current) return;
        if (packetId && !removedPackets.includes(packetId)) { setPacketChildId(""); packetController.select(packetId); }
        const removed = results.filter((result) => result.removed);
        if (isBulkDelete) report(removed.length, results.length);
        else {
          showActionToast("document.delete", results[0].removed ? results[0].alreadyRemoved ? "alreadyRemoved" : "success" : "failure", {
            targetName: target.source_name || target.job_id,
          });
        }
      },
    });
  }

  async function exportSelectedDocuments() {
    if (!exportableSelectedDocumentIds.length || isExportingDocuments) return;
    // Ticked rows send every id so the export can report skipped in-progress documents.
    const ids = checkedRowCount ? [...new Set(exportCandidates.map((job) => job.job_id))] : exportableSelectedDocumentIds;
    await reconciliation.exportDocuments(ids, {
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
    const packetOriginal = !actionDocument && openPacket?.source_retained === true;
    const documentId = packetOriginal ? openPacket.packet_id : actionDocument?.job_id;
    if (!documentId || (!packetOriginal && actionDocument.source_retained !== true) || isDownloadingOriginal) return;
    setIsDownloadingOriginal(true);
    try {
      const original = packetOriginal ? await packetController.loadOriginal(documentId) : await loadOriginal(documentId);
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
      selectedDocumentId: packetController.selectedId ? "" : selectedDocument?.job_id || "",
      packets: packetController.packets,
      selectedPacketId: packetController.selectedId,
      packetError: packetController.error,
      onSelectPacket: selectPacket,
      selectedPacketIds: checkedPackets.map((packet) => packet.packet_id),
      onTogglePacketSelection: togglePacketSelection,
      hasMorePackets: packetController.hasMore,
      loadingPackets: packetController.loading,
      onLoadMorePackets: () => packetController.refresh({ append: true }),
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
      onSelectDocument: selectDocument,
      onToggleAllDocumentSelections: reconciliation.toggleSelection,
      onToggleDocumentSelection: (id, selected) => reconciliation.toggleSelection([id], selected),
      onLoadMoreDocuments: () => reconciliation.refresh({ append: true }),
    },
    uploadModal: {
      maxSourceFileBytes,
      isOpen: showUploadModal,
      templates,
      selectedTemplateId: uploadTemplateId,
      selectedTags: uploadTags,
      availableTags: [...new Set([...workspaceTags.map((tag) => typeof tag === "string" ? tag : tag.name), ...templates.flatMap((template) => template.tags || [])])].sort(),
      onSelectTags: setUploadTags,
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
      isDeletingDocument: isDeletingDocument || packetController.busy,
      isExportingDocuments,
      selectedDocumentId: actionDocument?.job_id || openPacket?.packet_id || "",
      selectedDocumentCount: checkedRowCount,
      exportableDocumentCount: exportableSelectedDocumentIds.length,
      onExportDocuments: exportSelectedDocuments,
      onUploadDocument: openUploadModal,
      onDeleteDocument: deleteSelectedDocument,
      canDownloadOriginal: actionDocument ? actionDocument.source_retained === true : openPacket?.source_retained === true,
      isDownloadingOriginal,
      onDownloadOriginal: downloadSelectedOriginal,
    },
    documentPage: {
      selectedDocument,
      selectedPacketId: packetController.selectedId,
      isSingleDocument,
      templates, onResolveTemplate: resolveTemplate, isResolvingTemplate, templateResolutionError,
      onSelectPacket: selectPacket,
      packetPage: {
        packet: packetController.selectedPacket, busy: packetController.busy, error: packetController.error,
        documentError: packetChildError?.message || "", documentErrorId: packetChildError?.id || "",
        activeDocumentId: packetChildId, activeDocument: activePacketChild, templates,
        pendingDocumentId: pendingPacketTab?.id || "", isOpeningDocument: Boolean(pendingPacketTab?.isOpening),
        onConfirmPlan: packetController.confirmPlan, onSelectDocument: selectPacketChild,
        loadPagePreview: packetController.loadPagePreview,
      },
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
function documentTemplateName(document, templates) {
  if (!document) return "";
  if (!document.template_id) return document.selection_mode === "automatic" ? "Automatic template selection" : "Unknown template";
  const templateId = String(document.template_id).trim();
  const match = templates.find((template) => String(template.id || "").trim() === templateId);
  return [String(match?.name || "").trim() || templateId,
    document.template_version ? `version ${document.template_version}` : "",
    document.selection_mode === "automatic" ? "selected automatically" : "",
  ].filter(Boolean).join(" · ");
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
