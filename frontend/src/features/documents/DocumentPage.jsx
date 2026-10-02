import React, { useEffect, useRef, useState } from "react";
import {
  ExtractionJobStatusDisplay,
  ExtractionResultDisplay,
} from "./ExtractionResultDisplay.jsx";
import { SourceFilePreview } from "./SourceFilePreview.jsx";
import "./DocumentViewing.css";
import { PacketPage } from "./PacketPage.jsx";
import { formatPages } from "./documentProcessing.js";

const NARROW_SPLIT_WIDTH = 600;

export function DocumentPage({
  selectedDocument,
  selectedPacketId,
  packetPage,
  templates = [],
  onResolveTemplate,
  onSelectPacket,
  isResolvingTemplate,
  templateResolutionError,
  loadingDocumentDetailsId,
  viewingLayout = "results",
  onViewingLayoutChange,
  loadOriginal,
  sourceStorageConfigured = false,
}) {
  if (selectedPacketId) return <PacketPage {...packetPage} />;
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
  const canViewOriginal = (selectedDocument.source_retained === true || status === "awaiting_template") && Boolean(loadOriginal);
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
      <RoutingSummary job={selectedDocument} templates={templates} onResolve={onResolveTemplate} busy={isResolvingTemplate} error={templateResolutionError} />
      {selectedDocument.parent_packet_id ? <p className="document-lineage">
        <button type="button" className="ghost" onClick={() => onSelectPacket?.(selectedDocument.parent_packet_id)}>View parent packet</button>
        {" · Original pages: "}{formatPages(selectedDocument.source_pages)}
      </p> : selectedDocument.source_pages ? <p className="document-lineage">Original pages: {formatPages(selectedDocument.source_pages)}</p> : null}
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
    <span className="segmented document-layout-toggle" role="radiogroup" aria-label="Document view">
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

function RoutingSummary({ job, templates, onResolve, busy, error }) {
  const [templateId, setTemplateId] = useState("");
  useEffect(() => setTemplateId(""), [job.job_id]);
  const held = job.status === "awaiting_template" || job.routing_status === "awaiting_template";
  if (!held && !job.selection_mode && !job.selection_reason) return null;
  const selected = templates.find((template) => template.id === job.template_id);
  return <section className="routing-summary" aria-label="Template selection">
    {held ? <>
      <h3>Choose a template to continue</h3>
      <p>{job.selection_reason || "Automatic selection could not identify a suitable template. Select a template to continue with the uploaded document."}</p>
      {job.template_tags?.length ? <p>Requested tags: {job.template_tags.join(", ")}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); if (templateId) void onResolve?.(job.job_id, templateId); }}>
        <label>Template for this document<select value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>
          <option value="">Select template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select></label>
        <button type="submit" disabled={busy || !templateId}>{busy ? "Continuing…" : "Use template and continue"}</button>
      </form>
      {error ? <p role="alert" className="processing-error">{error}</p> : null}
    </> : <>
      <strong>{job.selection_mode === "automatic" ? "Automatically selected" : job.selection_mode === "manual" ? "Manually selected" : "Selected template"}: {selected?.name || job.template_id || "Assessing document"}{job.template_version ? ` · version ${job.template_version}` : ""}</strong>
      {job.selection_reason ? <p>{job.selection_reason}</p> : null}
    </>}
  </section>;
}
