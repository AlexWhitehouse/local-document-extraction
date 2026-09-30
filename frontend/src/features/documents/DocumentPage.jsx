import React, { useEffect, useRef, useState } from "react";
import {
  ExtractionJobStatusDisplay,
  ExtractionResultDisplay,
} from "./ExtractionResultDisplay.jsx";
import { SourceFilePreview } from "./SourceFilePreview.jsx";
import "./DocumentViewing.css";

const NARROW_SPLIT_WIDTH = 600;

export function DocumentPage({
  selectedDocument,
  loadingDocumentDetailsId,
  viewingLayout = "results",
  onViewingLayoutChange,
  loadOriginal,
  sourceStorageConfigured = false,
}) {
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
  // A Document without a retained original shows results only; the Account preference is kept.
  const canViewOriginal = selectedDocument.source_retained === true && Boolean(loadOriginal);
  const layout = canViewOriginal ? viewingLayout : "results";
  const resultDisplay = (
    <>
      {status !== "completed" ? (
        <ExtractionJobStatusDisplay job={selectedDocument} />
      ) : null}
      <ExtractionResultDisplay
        job={selectedDocument}
        isLoading={
          loadingDocumentDetailsId === String(selectedDocument.job_id || "")
        }
      />
    </>
  );
  return (
    <section
      className={`studio-document-page document-layout-${layout}`}
      aria-label="Document results"
    >
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
        {canViewOriginal ? (
          <DocumentLayoutToggle layout={layout} onChange={onViewingLayoutChange} />
        ) : sourceStorageConfigured ? (
          <span className="document-original-note">Original not retained</span>
        ) : null}
      </div>
      {layout === "side-by-side" ? (
        <SideBySide key={selectedDocument.job_id} document={selectedDocument} loadOriginal={loadOriginal}>
          {resultDisplay}
        </SideBySide>
      ) : (
        resultDisplay
      )}
    </section>
  );
}

function DocumentLayoutToggle({ layout, onChange }) {
  return (
    <span className="document-layout-toggle" role="radiogroup" aria-label="Document view">
      {[["results", "Results"], ["side-by-side", "Side by side"]].map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={layout === value}
          onClick={() => onChange?.(value)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function SideBySide({ document, loadOriginal, children }) {
  const host = useRef(null);
  const [split, setSplit] = useState(50);
  const [isNarrow, setIsNarrow] = useState(false);
  // Narrow screens open on Results; the tab resets per Document and is never stored.
  const [narrowTab, setNarrowTab] = useState("results");

  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < NARROW_SPLIT_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  // The PDF preview is an iframe, which swallows pointer events once the cursor crosses it.
  // Capturing the pointer on the divider and disabling pointer events on the preview while
  // dragging keeps the split following the cursor in both directions.
  const startDrag = (event) => {
    event.preventDefault();
    const divider = event.currentTarget;
    const { pointerId } = event;
    divider.setPointerCapture?.(pointerId);
    setIsDragging(true);
    const move = (moveEvent) => {
      const box = host.current?.getBoundingClientRect();
      if (!box?.width) return;
      setSplit(Math.min(70, Math.max(30, ((moveEvent.clientX - box.left) / box.width) * 100)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (divider.hasPointerCapture?.(pointerId)) divider.releasePointerCapture(pointerId);
      setIsDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const nudge = (event) => {
    const step = { ArrowLeft: -5, ArrowRight: 5 }[event.key];
    if (!step) return;
    event.preventDefault();
    setSplit((value) => Math.min(70, Math.max(30, value + step)));
  };

  const showDocument = !isNarrow || narrowTab === "document";
  const showResults = !isNarrow || narrowTab === "results";
  return (
    <div
      ref={host}
      className={`document-split${isNarrow ? " is-narrow" : ""}${isDragging ? " is-dragging" : ""}`}
      style={{ "--document-split": `${split}%` }}
    >
      {isNarrow ? (
        <div className="document-split-tabs" role="tablist" aria-label="Document view">
          {[["results", "Results"], ["document", "Document"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={narrowTab === value}
              onClick={() => setNarrowTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {showDocument ? (
        <section className="document-split-source" aria-label="Original document">
          <SourceFilePreview document={document} loadOriginal={loadOriginal} />
        </section>
      ) : null}
      {!isNarrow ? (
        <div
          className="document-split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize original and results"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={Math.round(split)}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={nudge}
        />
      ) : null}
      {showResults ? <div className="document-split-results">{children}</div> : null}
    </div>
  );
}
