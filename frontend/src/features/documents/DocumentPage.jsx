import React, { useEffect, useRef, useState } from "react";
import { statusLabel } from "../../lib/status.js";
import { ExtractionJobStatusDisplay, ExtractionResultDisplay } from "./ExtractionResultDisplay.jsx";
import { SourceFilePreview } from "./SourceFilePreview.jsx";
import "./DocumentViewing.css";
import { PacketPage } from "./PacketPage.jsx";
import { formatPages } from "./documentProcessing.js";
import { isSingleDocumentPacket, singlePacketDocument } from "./packetListing.js";
import { ProcessingCost } from "./ProcessingCost.jsx";
import { Button } from "../ui/Button.jsx";

const NARROW_SPLIT_WIDTH = 600;

export function DocumentPage({ selectedDocument, selectedPacketId, packetPage, hasDocuments = false, ...detail }) {
  if (selectedPacketId) {
    if (isSingleDocumentPacket(packetPage?.packet)) {
      return <SinglePacketDocument {...detail} packetPage={packetPage} />;
    }

    return (
      <PacketPage
        {...packetPage}
        renderDocument={(document) => <DocumentDetail {...detail} selectedDocument={document} />}
      />
    );
  }

  // An empty Workspace is explained by the list's own empty state, so the body stays blank.
  if (!selectedDocument)
    return hasDocuments ? <p className="studio-empty-state">Select an uploaded document to see its results.</p> : null;

  return <DocumentDetail {...detail} selectedDocument={selectedDocument} />;
}

function SinglePacketDocument({ packetPage, ...detail }) {
  const { packet, activeDocument, error, documentError, onSelectDocument } = packetPage;
  const child = singlePacketDocument(packet);
  const hasDetails = child && activeDocument?.job_id === child.job_id;
  const exclusions = packet.plan?.exclusions || [];

  return (
    <>
      {error ? (
        <p role="alert" className="packet-message is-error">
          {error}
        </p>
      ) : null}
      {child ? (
        <DocumentDetail
          {...detail}
          selectedDocument={hasDetails ? activeDocument : child}
          loadingDocumentDetailsId={hasDetails ? detail.loadingDocumentDetailsId : child.job_id}
          documentError={hasDetails ? "" : documentError}
          onRetryDocument={() => onSelectDocument?.(child.job_id)}
        />
      ) : (
        <section className="studio-document-page document-layout-results" aria-label="Document results">
          <div className="studio-document-summary">
            <span className={`studio-document-status ${packet.status === "queued" ? "queued" : "processing"}`}>
              <i aria-hidden="true" />
              {packet.status === "queued" ? "Queued" : "Processing"}
            </span>
          </div>
          <div className="job-status-stack">
            <div className="job-status-skeleton is-processing" role="status">
              <span className="job-status-spinner" aria-hidden="true" />
              <p>Preparing document…</p>
            </div>
          </div>
        </section>
      )}
      {exclusions.length ? (
        <section className="packet-message" aria-label="Excluded pages">
          <strong>Excluded pages</strong>
          {exclusions.map(({ page, reason }) => (
            <p key={page}>
              Page {page}: {reason}
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}

function DocumentDetail({
  selectedDocument,
  templates = [],
  onResolveTemplate,
  isResolvingTemplate,
  loadingDocumentDetailsId,
  documentError,
  onRetryDocument,
  viewingLayout = "results",
  onViewingLayoutChange,
  loadOriginal,
  sourceStorageConfigured = false,
}) {
  const results = Array.isArray(selectedDocument.results) ? selectedDocument.results : [];

  const confidences = results.flatMap((result) => (Number.isFinite(result.confidence) ? [result.confidence] : []));

  const average = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null;

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
  const canViewOriginal =
    (selectedDocument.source_retained === true || status === "awaiting_template") && Boolean(loadOriginal);

  const layout = canViewOriginal ? viewingLayout : "results";
  const isHeld = status === "awaiting_template" || selectedDocument.routing_status === "awaiting_template";

  const resultDisplay = (
    <>
      {status !== "completed" ? <ExtractionJobStatusDisplay job={selectedDocument} /> : null}
      {documentError ? (
        <div className="packet-message is-error">
          <p role="alert">{documentError}</p>
          <Button variant="secondary" onClick={onRetryDocument}>
            Retry document
          </Button>
        </div>
      ) : (
        <ExtractionResultDisplay
          job={selectedDocument}
          isLoading={loadingDocumentDetailsId === String(selectedDocument.job_id || "")}
        />
      )}
    </>
  );

  return (
    <section className={`studio-document-page document-layout-${layout}`} aria-label="Document results">
      <div className="studio-document-summary">
        <span className={`studio-document-status ${status}`}>
          <i aria-hidden="true" />
          {statusLabel(status)}
        </span>
        {results.length ? (
          <span>
            {results.length} {results.length === 1 ? "field" : "fields"} extracted
          </span>
        ) : null}
        {average !== null ? (
          <span>
            <strong>{(average * 100).toFixed(1)}%</strong> average confidence
          </span>
        ) : null}
        {status === "completed" ? <ProcessingCost costs={selectedDocument.costs} /> : null}
        {selectedDocument.source_pages ? <span>Pages {formatPages(selectedDocument.source_pages)}</span> : null}
        {dateLabel ? <time dateTime={date.toISOString()}>{dateLabel}</time> : null}
        {canViewOriginal ? (
          <DocumentLayoutToggle layout={layout} onChange={onViewingLayoutChange} />
        ) : sourceStorageConfigured ? (
          <span className="document-original-note">Original not retained</span>
        ) : null}
      </div>
      {isHeld ? (
        <TemplateHold
          job={selectedDocument}
          templates={templates}
          onResolve={onResolveTemplate}
          busy={isResolvingTemplate}
        />
      ) : null}
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
      {[
        ["results", "Results"],
        ["side-by-side", "Side by side"],
      ].map(([value, label]) => (
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

    if (!element || typeof ResizeObserver === "undefined") return undefined;

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
          {[
            ["results", "Results"],
            ["document", "Document"],
          ].map(([value, label]) => (
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

function TemplateHold({ job, templates, onResolve, busy }) {
  const [templateId, setTemplateId] = useState("");
  useEffect(() => setTemplateId(""), [job.job_id]);

  return (
    <section className="routing-summary" aria-label="Template selection">
      <h3>Choose a template to continue</h3>
      <p>
        {job.selection_reason ||
          "Automatic selection could not identify a suitable template. Select a template to continue with the uploaded document."}
      </p>
      {job.template_tags?.length ? <p>Requested tags: {job.template_tags.join(", ")}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (templateId) void onResolve?.(job.job_id, templateId);
        }}
      >
        <label>
          Template for this document
          <select value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">Select template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={!templateId} pending={busy} pendingLabel="Continuing…">
          Use template and continue
        </Button>
      </form>
    </section>
  );
}
