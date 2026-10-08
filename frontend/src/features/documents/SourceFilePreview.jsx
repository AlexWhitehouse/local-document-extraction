import React, { useState } from "react";
import { Button } from "../ui/Button.jsx";
import { useDocumentOriginal } from "./documentViewing";

// Only these types reach the viewer. A PDF iframe must never receive another type, because an
// object URL is same-origin and would otherwise render arbitrary content inside the app.
const PDF_TYPE = "application/pdf";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const PDF_VIEW_FRAGMENT = "#pagemode=none&navpanes=0&view=FitH";

const AVAILABILITY_COPY = {
  unavailable: [
    "Original unavailable",
    "The original file can't be opened right now. Your results aren't affected.",
  ],
  missing: [
    "Original file not found",
    "The original file is no longer available. Your results aren't affected.",
  ],
  not_retained: ["Original not retained", "Only the results are available for this document."],
};

export function SourceFilePreview({ document: job, loadOriginal }) {
  const original = useDocumentOriginal({ documentId: job.job_id, enabled: true, loadOriginal });
  const pages = Number(job.source_file_page_count);

  const typeLabel =
    job.source_mime_type === PDF_TYPE
      ? `PDF${Number.isSafeInteger(pages) && pages > 0 ? ` · ${pages} ${pages === 1 ? "page" : "pages"}` : ""}`
      : "Image";

  return (
    <div className="source-preview">
      <div className="source-preview-bar">
        <strong title={job.source_name || ""}>{job.source_name || "Original document"}</strong>
        <span>{typeLabel}</span>
      </div>
      <div className="source-preview-body">
        {original.status === "ready" ? (
          <PreviewContent url={original.url} mimeType={original.mimeType} name={job.source_name} />
        ) : original.status === "loading" || original.status === "idle" ? (
          <p className="source-preview-state" role="status">
            Loading original…
          </p>
        ) : (
          <AvailabilityNotice status={original.status} onRetry={original.retry} />
        )}
      </div>
    </div>
  );
}

function PreviewContent({ url, mimeType, name }) {
  if (mimeType === PDF_TYPE) {
    return (
      <iframe
        className="source-preview-pdf"
        title={`Preview of ${name || "original document"}`}
        src={`${url}${PDF_VIEW_FRAGMENT}`}
      />
    );
  }

  if (IMAGE_TYPES.has(mimeType)) return <ImagePreview url={url} name={name} />;

  return <AvailabilityNotice status="unavailable" />;
}

function ImagePreview({ url, name }) {
  const [zoom, setZoom] = useState("fit");

  return (
    <div className="source-image">
      <div className="source-image-tools">
        <div className="segmented" role="group" aria-label="Image zoom">
          {[
            ["fit", "Fit"],
            ["100", "100%"],
            ["200", "200%"],
          ].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={zoom === value} onClick={() => setZoom(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={`source-image-canvas zoom-${zoom}`} tabIndex={0} aria-label="Original image">
        <img src={url} alt={`Original ${name || "document"}`} />
      </div>
    </div>
  );
}

function AvailabilityNotice({ status, onRetry }) {
  const [title, message] = AVAILABILITY_COPY[status] ?? AVAILABILITY_COPY.unavailable;

  return (
    <div className={`source-availability ${status}`} role="status">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {status === "unavailable" && onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
