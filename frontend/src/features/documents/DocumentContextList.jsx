import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";

const EMPTY_FILTERS = { dateFrom: "", dateTo: "", model: "" };

export function DocumentContextList({
  search,
  packets = [], selectedPacketId = "", packetError = "", onSelectPacket, onLoadMorePackets, hasMorePackets = false, loadingPackets = false,
  documents,
  selectedDocumentId,
  selectedDocumentIds = [],
  debouncedSearch,
  filters = EMPTY_FILTERS,
  availableModels = [],
  hasActiveFilters = false,
  hasMoreDocuments,
  isLoadingMoreDocuments,
  isDeletingDocuments = false,
  isExportingDocuments = false,
  onSearchChange,
  onFiltersChange = () => {},
  onSelectDocument,
  onToggleAllDocumentSelections = () => {},
  onToggleDocumentSelection = () => {},
  onLoadMoreDocuments,
}) {
  const availableDocumentIds = useMemo(() => documents.map((job) => String(job.job_id)), [documents]);
  const selectedIds = useMemo(() => new Set(selectedDocumentIds), [selectedDocumentIds]);
  const selectedAvailableCount = availableDocumentIds.filter((documentId) =>
    selectedIds.has(documentId),
  ).length;
  const areAllAvailableDocumentsSelected =
    availableDocumentIds.length > 0 &&
    selectedAvailableCount === availableDocumentIds.length;
  const areSomeAvailableDocumentsSelected =
    selectedAvailableCount > 0 && !areAllAvailableDocumentsSelected;
  const selectAllLabel = areAllAvailableDocumentsSelected
    ? "Deselect all available documents"
    : "Select all available documents";
  const isSelectionLocked = isDeletingDocuments || isExportingDocuments;
  const rowMotion = useRowMotion(documents, (job) => job.job_id, (job) => documentStatusTone(job.status));
  const listRef = useRef(null);
  const lastScrolledSelection = useRef(null);
  const focusSelection = useRef(false);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const virtual = documents.length > 100;
  const rowStride = 60;
  const start = virtual ? Math.max(0, Math.min(documents.length - 1, Math.floor(viewport.top / rowStride) - 5)) : 0;
  const end = virtual ? Math.min(documents.length, start + Math.ceil(viewport.height / rowStride) + 10) : documents.length;
  useEffect(() => {
    const list = listRef.current;
    const resize = () => setViewport({ top: list.scrollTop, height: list.clientHeight || 600 });
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(resize);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!virtual || lastScrolledSelection.current === selectedDocumentId) return;
    lastScrolledSelection.current = selectedDocumentId;
    const list = listRef.current;
    const index = documents.findIndex((job) => job.job_id === selectedDocumentId);
    if (index < 0) return;
    const top = index * rowStride;
    const height = list.clientHeight || 600;
    if (top < list.scrollTop || top + rowStride > list.scrollTop + height) {
      list.scrollTop = top;
      setViewport({ top: list.scrollTop, height });
    }
  }, [selectedDocumentId, documents, virtual]);
  useEffect(() => {
    if (!focusSelection.current) return;
    const selected = listRef.current.querySelector('[data-selected-document="true"]');
    if (selected) { focusSelection.current = false; selected.focus({ preventScroll: true }); }
  }, [selectedDocumentId, start, end]);

  return (
    <>
      <div className="context-search-field">
        <label htmlFor="document-job-search">Search Documents</label>
        <div className="context-search-row">
          <label className="context-select-all-control" title={selectAllLabel}>
            <input
              ref={(checkbox) => {
                if (checkbox) {
                  checkbox.indeterminate = areSomeAvailableDocumentsSelected;
                }
              }}
              type="checkbox"
              aria-label={selectAllLabel}
              checked={areAllAvailableDocumentsSelected}
              disabled={!availableDocumentIds.length || isSelectionLocked}
              onChange={(event) =>
                onToggleAllDocumentSelections(
                  availableDocumentIds,
                  event.target.checked,
                )
              }
            />
          </label>
          <div className="context-search-shell">
            <input
              id="document-job-search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Document ID or Source file"
            />
            <AdvancedJobFilters
              filters={filters}
              availableModels={availableModels}
              onFiltersChange={onFiltersChange}
            />
          </div>
        </div>
      </div>
      <div className="document-context-groups">
      {packets.length || packetError ? <section className="packet-context-list" aria-label="Document packets">
        <h3>Packets</h3>
        {packetError ? <p role="status" className="processing-error">{packetError}</p> : null}
        {packets.map((packet) => <button type="button" key={packet.packet_id} className={`context-item${selectedPacketId === packet.packet_id ? " active" : ""}`} onClick={() => onSelectPacket?.(packet.packet_id)}>
          <strong>{packet.source_name || packet.packet_id}</strong><span>{packet.outcome === "no_documents" ? "No documents to extract" : String(packet.status || "queued").replaceAll("_", " ")}</span>
        </button>)}
        {hasMorePackets ? <button type="button" className="context-item" disabled={loadingPackets} onClick={onLoadMorePackets}>Load more packets</button> : null}
      </section> : null}
      <ScrollArea className="context-list" ref={listRef}
        role="region" aria-label="Document list" tabIndex={0}
        style={virtual ? { display: "block" } : undefined}
        onScroll={virtual ? (event) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight || 600 }) : undefined}>
        <div role="list" aria-label="Documents"
          style={virtual ? { position: "relative", height: documents.length * rowStride } : { display: "contents" }}>
        {documents.slice(start, end).map((job, offset) => {
          const isActive = selectedDocumentId === job.job_id;
          const isChecked = selectedIds.has(job.job_id);
          const statusTone = documentStatusTone(job.status);

          return (
            <div
              key={`context-${job.job_id}`}
              role="listitem"
              aria-posinset={start + offset + 1}
              aria-setsize={documents.length}
              style={virtual ? { position: "absolute", top: (start + offset) * rowStride, height: 54 } : undefined}
              className={`context-item-card context-item-document${statusTone ? ` status-${statusTone}` : ""}${isActive ? " active" : ""}${
                isChecked ? " checked" : ""
              }${rowMotion(job.job_id)}`}
            >
              <label
                className="context-select-control"
                title={`Select document ${job.job_id}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select document ${job.job_id}`}
                  checked={isChecked}
                  disabled={isSelectionLocked}
                  onChange={(event) =>
                    onToggleDocumentSelection(job.job_id, event.target.checked)
                  }
                />
              </label>
              <button
                type="button"
                data-selected-document={isActive ? "true" : undefined}
                className={isActive ? "context-item-main active" : "context-item-main"}
                onClick={() => onSelectDocument(job.job_id)}
                onKeyDown={(event) => {
                  const positions = { ArrowDown: start + offset + 1, ArrowUp: start + offset - 1, Home: 0, End: documents.length - 1 };
                  if (!(event.key in positions)) return;
                  event.preventDefault();
                  focusSelection.current = true;
                  onSelectDocument(documents[Math.max(0, Math.min(documents.length - 1, positions[event.key]))].job_id);
                }}
              >
                <strong>
                  {job.source_name || defaultUploadedName(job.source_mime_type)}
                </strong>
                <span>{job.job_id}</span>
              </button>
              <ContextCopyButton
                ariaLabel={`Copy document ID ${job.job_id}`}
                value={job.job_id}
              />
            </div>
          );
        })}
        </div>
        {!documents.length ? (
          <p className="muted">
            {debouncedSearch || hasActiveFilters
              ? "No documents match these filters."
              : "No documents uploaded yet."}
          </p>
        ) : null}
        {hasMoreDocuments ? (
          <button
            type="button"
            className="context-item"
            disabled={isLoadingMoreDocuments}
            onClick={onLoadMoreDocuments}
          >
            <strong>
              {isLoadingMoreDocuments ? "Loading…" : "Load more Documents"}
            </strong>
            <span>
              {debouncedSearch || hasActiveFilters
                ? "Continue searching older documents"
                : "Show older documents"}
            </span>
          </button>
        ) : null}
      </ScrollArea>
      </div>
    </>
  );
}

function documentStatusTone(status) {
  switch (String(status || "").toLowerCase()) {
    case "completed":
      return "completed";
    case "queued":
    case "processing":
      return "progress";
    case "awaiting_template":
      return "failed";
    case "error":
    case "failed":
      return "failed";
    default:
      return "";
  }
}

function AdvancedJobFilters({ filters, availableModels, onFiltersChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(() => ({ ...filters }));
  const containerRef = useRef(null);
  const popoverId = useId();
  const headingId = useId();
  const activeFilterCount = [filters.dateFrom, filters.dateTo, filters.model]
    .filter(Boolean).length;
  const hasInvalidDateRange = Boolean(
    draftFilters.dateFrom &&
      draftFilters.dateTo &&
      draftFilters.dateFrom > draftFilters.dateTo,
  );
  const modelOptions = [...new Set([
    ...availableModels.map((model) => String(model || "").trim()),
    String(draftFilters.model || "").trim(),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    setDraftFilters(toDraftFilters(filters));
  }, [filters]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeOnOutsidePointer(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function updateDraftFilter(name, value) {
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    if (hasInvalidDateRange) {
      return;
    }
    onFiltersChange(draftFilters);
    setIsOpen(false);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    onFiltersChange(EMPTY_FILTERS);
    setIsOpen(false);
  }

  function toggleFilters() {
    if (!isOpen) {
      setDraftFilters(toDraftFilters(filters));
    }
    setIsOpen((current) => !current);
  }

  return (
    <div className="context-filter-control" ref={containerRef}>
      <button
        type="button"
        className={`context-filter-trigger${activeFilterCount ? " active" : ""}`}
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Advanced document filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
        title="Advanced document filters"
        onClick={toggleFilters}
      >
        <FilterIcon />
        {activeFilterCount ? (
          <span className="context-filter-count" aria-hidden="true">
            {activeFilterCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <form
          id={popoverId}
          className="context-filter-popover"
          role="dialog"
          aria-labelledby={headingId}
          onSubmit={applyFilters}
        >
          <div className="context-filter-popover-head">
            <div>
              <span className="eyebrow">Narrow the queue</span>
              <strong id={headingId}>Advanced filters</strong>
            </div>
            {activeFilterCount ? (
              <span className="context-filter-active-label">
                {activeFilterCount} active
              </span>
            ) : null}
          </div>

          <div className="context-filter-date-grid">
            <label>
              Date from
              <input
                type="date"
                value={draftFilters.dateFrom}
                max={draftFilters.dateTo || undefined}
                aria-invalid={hasInvalidDateRange || undefined}
                onChange={(event) => updateDraftFilter("dateFrom", event.target.value)}
              />
            </label>
            <label>
              Date to
              <input
                type="date"
                value={draftFilters.dateTo}
                min={draftFilters.dateFrom || undefined}
                aria-invalid={hasInvalidDateRange || undefined}
                onChange={(event) => updateDraftFilter("dateTo", event.target.value)}
              />
            </label>
          </div>

          <label>
            Model used
            <select
              value={draftFilters.model}
              onChange={(event) => updateDraftFilter("model", event.target.value)}
            >
              <option value="">Any model</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>

          {hasInvalidDateRange ? (
            <p className="context-filter-error" role="alert">
              Date from must be on or before date to.
            </p>
          ) : null}

          <div className="context-filter-actions">
            <button
              type="button"
              className="secondary"
              disabled={!activeFilterCount && !draftFilters.dateFrom && !draftFilters.dateTo && !draftFilters.model}
              onClick={clearFilters}
            >
              Clear
            </button>
            <button type="submit" disabled={hasInvalidDateRange}>
              Apply filters
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function toDraftFilters(filters) {
  return {
    dateFrom: String(filters.dateFrom || ""),
    dateTo: String(filters.dateTo || ""),
    model: String(filters.model || ""),
  };
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </svg>
  );
}

function defaultUploadedName(sourceMimeType) {
  const mimeType = String(sourceMimeType || "");
  return mimeType.startsWith("image/") || mimeType === "application/pdf"
    ? "Uploaded Document"
    : "Uploaded Source file";
}
