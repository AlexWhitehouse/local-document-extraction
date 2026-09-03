import React, { useEffect, useId, useRef, useState } from "react";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";

const EMPTY_FILTERS = { dateFrom: "", dateTo: "", model: "" };

export function DocumentContextList({
  search,
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
  documentLabels = false,
}) {
  const itemLabel = documentLabels ? "document" : "job";
  const availableDocumentIds = documents.map((job) => String(job.job_id));
  const selectedAvailableCount = availableDocumentIds.filter((documentId) =>
    selectedDocumentIds.includes(documentId),
  ).length;
  const areAllAvailableDocumentsSelected =
    availableDocumentIds.length > 0 &&
    selectedAvailableCount === availableDocumentIds.length;
  const areSomeAvailableDocumentsSelected =
    selectedAvailableCount > 0 && !areAllAvailableDocumentsSelected;
  const selectAllLabel = areAllAvailableDocumentsSelected
    ? `Deselect all available ${itemLabel}s`
    : `Select all available ${itemLabel}s`;
  const isSelectionLocked = isDeletingDocuments || isExportingDocuments;

  return (
    <>
      <div className="context-search-field">
        <label htmlFor="document-job-search">Search {documentLabels ? "Documents" : "Jobs"}</label>
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
              placeholder={`${documentLabels ? "Document" : "Job"} ID or Source file`}
            />
            <AdvancedJobFilters
              filters={filters}
              availableModels={availableModels}
              onFiltersChange={onFiltersChange}
              itemLabel={itemLabel}
            />
          </div>
        </div>
      </div>
      <div className="context-list">
        {documents.map((job) => {
          const isActive = selectedDocumentId === job.job_id;
          const isChecked = selectedDocumentIds.includes(job.job_id);
          const statusTone = documentStatusTone(job.status);

          return (
            <div
              key={`context-${job.job_id}`}
              className={`context-item-card context-item-document${statusTone ? ` status-${statusTone}` : ""}${isActive ? " active" : ""}${
                isChecked ? " checked" : ""
              }`}
            >
              <label
                className="context-select-control"
                title={`Select ${itemLabel} ${job.job_id}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${itemLabel} ${job.job_id}`}
                  checked={isChecked}
                  disabled={isSelectionLocked}
                  onChange={(event) =>
                    onToggleDocumentSelection(job.job_id, event.target.checked)
                  }
                />
              </label>
              <button
                type="button"
                className={isActive ? "context-item-main active" : "context-item-main"}
                onClick={() => onSelectDocument(job.job_id)}
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
              {isLoadingMoreDocuments ? "Loading..." : "Load More Documents"}
            </strong>
            <span>
              {debouncedSearch || hasActiveFilters
                ? `Continue searching older ${itemLabel}s`
                : `Show older ${itemLabel}s`}
            </span>
          </button>
        ) : null}
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
    case "error":
    case "failed":
      return "failed";
    default:
      return "";
  }
}

function AdvancedJobFilters({ filters, availableModels, onFiltersChange, itemLabel }) {
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
    setDraftFilters({
      dateFrom: String(filters.dateFrom || ""),
      dateTo: String(filters.dateTo || ""),
      model: String(filters.model || ""),
    });
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
      setDraftFilters({
        dateFrom: String(filters.dateFrom || ""),
        dateTo: String(filters.dateTo || ""),
        model: String(filters.model || ""),
      });
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
        aria-label={`Advanced ${itemLabel} filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
        title={`Advanced ${itemLabel} filters`}
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
