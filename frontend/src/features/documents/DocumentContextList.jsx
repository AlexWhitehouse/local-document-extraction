import React from "react";

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
          <button
            type="button"
            key={`context-${job.job_id}`}
            className={
              selectedDocumentId === job.job_id
                ? "context-item active"
                : "context-item"
            }
            onClick={() => onSelectDocument(job.job_id)}
          >
            <strong>
              {job.source_name || defaultUploadedName(job.source_mime_type)}
            </strong>
            <span>{job.job_id}</span>
          </button>
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
