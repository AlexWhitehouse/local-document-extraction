import React from "react";
import {
  ExtractionJobStatusDisplay,
  ExtractionResultDisplay,
} from "./ExtractionResultDisplay.jsx";

export function DocumentPage({ selectedDocument, loadingDocumentDetailsId }) {
  if (!selectedDocument)
    return (
      <p className="studio-empty-state">
        Select an uploaded document, or upload one to get started.
      </p>
    );
  const results = Array.isArray(selectedDocument.results)
    ? selectedDocument.results
    : [];
  const confidences = results
    .map((result) => result.confidence)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const average = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;
  const status = String(selectedDocument.status || "queued");
  const date = new Date(selectedDocument.created_at);
  const dateLabel = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  return (
    <section className="studio-document-page" aria-label="Document results">
      <div className="studio-document-summary">
        <span className={`studio-document-status ${status}`}>
          <i aria-hidden="true" />
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
        {results.length ? (
          <span>
            {results.length} {results.length === 1 ? "field" : "fields"}{" "}
            extracted
          </span>
        ) : null}
        {average !== null ? (
          <span>
            <strong>{(average * 100).toFixed(1)}%</strong> average confidence
          </span>
        ) : null}
        {dateLabel ? (
          <time dateTime={date.toISOString()}>{dateLabel}</time>
        ) : null}
      </div>
      {status !== "completed" ? (
        <ExtractionJobStatusDisplay job={selectedDocument} />
      ) : null}
      <ExtractionResultDisplay
        job={selectedDocument}
        isLoading={
          loadingDocumentDetailsId === String(selectedDocument.job_id || "")
        }
      />
    </section>
  );
}
