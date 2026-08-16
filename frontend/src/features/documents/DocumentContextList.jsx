import React from "react";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";

export function DocumentContextList({
  search,
  documents,
  selectedDocumentId,
  selectedDocumentIds = [],
  debouncedSearch,
  hasMoreDocuments,
  isLoadingMoreDocuments,
  isDeletingDocuments = false,
  isExportingDocuments = false,
  onSearchChange,
  onSelectDocument,
  onToggleAllDocumentSelections = () => {},
  onToggleDocumentSelection = () => {},
  onLoadMoreDocuments,
}) {
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
    ? "Deselect all available jobs"
    : "Select all available jobs";
  const isSelectionLocked = isDeletingDocuments || isExportingDocuments;

  return (
    <>
      <div className="context-search-field">
        <label htmlFor="document-job-search">Search Jobs</label>
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
          <input
            id="document-job-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Job ID or Source file"
          />
        </div>
      </div>
      <div className="context-list">
        {documents.map((job) => {
          const isActive = selectedDocumentId === job.job_id;
          const isChecked = selectedDocumentIds.includes(job.job_id);

          return (
            <div
              key={`context-${job.job_id}`}
              className={`context-item-card context-item-document${isActive ? " active" : ""}${
                isChecked ? " checked" : ""
              }`}
            >
              <label
                className="context-select-control"
                title={`Select job ${job.job_id}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select job ${job.job_id}`}
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
            {debouncedSearch
              ? "No documents match this search."
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
              {debouncedSearch
                ? "Continue searching older jobs"
                : "Show older jobs"}
            </span>
          </button>
        ) : null}
      </div>
    </>
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
