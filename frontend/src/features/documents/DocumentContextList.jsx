import React from "react";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";

export function DocumentContextList({
  search,
  documents,
  selectedDocumentId,
  debouncedSearch,
  hasMoreDocuments,
  isLoadingMoreDocuments,
  onSearchChange,
  onSelectDocument,
  onLoadMoreDocuments,
}) {
  return (
    <>
      <label>
        Search Jobs
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Job ID or Source file"
        />
      </label>
      <div className="context-list">
        {documents.map((job) => (
          <div
            key={`context-${job.job_id}`}
            className={
              selectedDocumentId === job.job_id
                ? "context-item-card active"
                : "context-item-card"
            }
          >
            <button
              type="button"
              className={
                selectedDocumentId === job.job_id
                  ? "context-item-main active"
                  : "context-item-main"
              }
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
        ))}
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
