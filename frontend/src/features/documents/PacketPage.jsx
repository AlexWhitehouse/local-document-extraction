import React, { useEffect, useState } from "react";
import { formatPages, parsePageSelection, validateSplitPlan } from "./documentProcessing.js";
import { PACKET_STATUS_LABELS } from "./packetListing.js";
import "./DocumentProcessing.css";
import { ProcessingCost } from "./ProcessingCost.jsx";

const LIVE_CHILD_STATUSES = new Set(["queued", "processing"]);

export function PacketPage({
  packet, activeDocumentId = "", activeDocument, pendingDocumentId = "", isOpeningDocument = false,
  documentError = "", documentErrorId = "", renderDocument, onSelectDocument, ...overview
}) {
  if (!packet) return <p role="status" className="studio-empty-state">Loading document packet…</p>;
  const children = Array.isArray(packet.children) ? packet.children : [];
  const activeChild = children.find((child) => child.job_id === activeDocumentId);
  // A tab being opened is highlighted straight away; the current panel stays until its document loads.
  const selectedTabId = children.some((child) => child.job_id === pendingDocumentId) ? pendingDocumentId : activeChild?.job_id || "";
  return (
    <section className="packet-page" aria-label="Document packet">
      {children.length ? (
        <div className="packet-tabs" role="tablist" aria-label="Documents in this packet">
          <button type="button" role="tab" aria-selected={!selectedTabId} onClick={() => onSelectDocument?.("")}>
            Overview
          </button>
          {children.map((child, index) => (
            <button key={child.job_id} type="button" role="tab" aria-selected={selectedTabId === child.job_id}
              aria-busy={pendingDocumentId === child.job_id || undefined}
              title={String(child.status || "queued").replaceAll("_", " ")}
              onClick={() => onSelectDocument?.(child.job_id)}>
              <i className={`packet-tab-status ${child.status || "queued"}`} aria-hidden="true" />
              Document {index + 1}
              <span>{pagesLabel(child.source_pages)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {documentError ? (
        <div className="packet-message is-error">
          <p role="alert">{documentError}</p>
          {children.some((child) => child.job_id === documentErrorId) ? (
            <button type="button" className="secondary" onClick={() => onSelectDocument?.(documentErrorId)}>Retry document</button>
          ) : null}
        </div>
      ) : null}
      {isOpeningDocument && !activeChild ? (
        <div role="tabpanel" aria-busy="true" className="packet-panel-pending" />
      ) : activeChild ? (
        <div role="tabpanel" aria-label={`Document ${children.indexOf(activeChild) + 1}`}>
          {activeDocument?.job_id === activeChild.job_id && renderDocument ? renderDocument(activeDocument) : <p role="status" className="studio-empty-state">Loading document…</p>}
        </div>
      ) : (
        <PacketOverview key={packet.packet_id} packet={packet} onSelectDocument={onSelectDocument} {...overview} />
      )}
    </section>
  );
}

function PacketOverview({ packet, templates = [], busy, error, onConfirmPlan, onSelectDocument, loadPagePreview }) {
  const documents = Array.isArray(packet.children) ? packet.children : [];
  const exclusions = packet.plan?.exclusions || [];
  const pages = packet.selected_pages || [];
  const date = new Date(packet.created_at);
  const failure = packet.status === "failed" ? packet.error_message || (typeof packet.error === "string" ? packet.error : packet.error?.message) : "";
  return (
    <div className="packet-overview">
      <div className="studio-document-summary">
        <span className={`studio-document-status ${packet.status}`}><i aria-hidden="true" />{PACKET_STATUS_LABELS[packet.status] || packet.status}</span>
        {pages.length ? <span><strong>{pages.length}</strong> {pages.length === 1 ? "page" : "pages"}</span> : null}
        {documents.length ? <span><strong>{documents.length}</strong> {documents.length === 1 ? "document" : "documents"}</span> : null}
        {exclusions.length ? <span><strong>{exclusions.length}</strong> excluded</span> : null}
        <ProcessingCost costs={packet.costs} kind="Packet" inProgress={!["completed", "failed"].includes(packet.status)} />
        {Number.isNaN(date.getTime()) ? null : (
          <time dateTime={date.toISOString()}>
            {date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </time>
        )}
      </div>
      <PacketProgress packet={packet} documents={documents} />
      {error ? <p role="alert" className="packet-message is-error">{error}</p> : null}
      {failure ? <p role="status" className="packet-message is-error">{failure}</p> : null}
      {packet.status === "awaiting_review" ? (
        <SplitPlanEditor key={`${packet.packet_id}:${packet.plan_revision}`} packet={packet} busy={busy} onConfirm={onConfirmPlan} loadPagePreview={loadPagePreview} />
      ) : packet.outcome === "no_documents" ? (
        <section className="packet-section" role="status">
          <h3 className="packet-section-title">No documents to extract</h3>
          <p className="studio-empty-state">Every page was verified blank, so no documents were created.</p>
        </section>
      ) : documents.length ? (
        <PacketDocuments documents={documents} templates={templates} onSelectDocument={onSelectDocument} />
      ) : packet.status !== "failed" ? (
        <section className="packet-section">
          <h3 className="packet-section-title">Documents</h3>
          <p className="studio-empty-state">
            {packet.status === "materializing"
              ? "Preparing documents from the split…"
              : `Finding where each document starts across ${pages.length || "all"} ${pages.length === 1 ? "page" : "pages"}. Documents appear here once the split is decided.`}
          </p>
        </section>
      ) : null}
      {exclusions.length ? (
        <section className="packet-section" aria-label="Excluded pages">
          <h3 className="packet-section-title">Excluded pages</h3>
          <div className="packet-table-scroll">
            <table className="studio-table packet-table">
              <thead><tr><th scope="col">Page</th><th scope="col">Reason</th></tr></thead>
              <tbody>{exclusions.map(({ page, reason }) => (
                <tr key={page}><th scope="row">{page}</th><td>{reason}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Three stages: the split, extraction of each document, and completion. */
function PacketProgress({ packet, documents }) {
  const done = documents.filter((child) => child.status === "completed").length;
  const failed = documents.filter((child) => child.status === "failed" || child.status === "error").length;
  const splitDone = packet.plan_accepted || documents.length > 0 || packet.outcome === "no_documents";
  const stage = packet.status === "completed" ? 3 : splitDone ? 1 : 0;
  const steps = [
    {
      label: "Split",
      detail: splitDone
        ? packet.outcome === "no_documents" ? "No documents found" : `${documents.length} ${documents.length === 1 ? "document" : "documents"} found`
        : packet.status === "awaiting_review" ? "Needs your review" : packet.status === "failed" ? "Failed" : packet.status === "queued" ? "Queued" : "Finding documents",
      attention: packet.status === "awaiting_review" || (packet.status === "failed" && !splitDone),
    },
    {
      label: "Extract",
      detail: !splitDone ? "Waits for the split" : packet.outcome === "no_documents" ? "Nothing to extract"
        : `${done} of ${documents.length} complete${failed ? ` · ${failed} failed` : ""}`,
      attention: failed > 0 || (packet.status === "failed" && splitDone),
    },
    {
      label: "Done",
      detail: packet.status !== "completed" ? "—" : packet.outcome === "no_documents" ? "Nothing extracted" : failed ? "Finished with failures" : "All documents extracted",
      attention: false,
    },
  ];
  return (
    <ol className="packet-progress" aria-label="Packet progress">
      {steps.map((step, index) => {
        const state = index < stage || stage === 3 ? "done" : index === stage ? "current" : "pending";
        return (
          <li key={step.label} className={`is-${state}${step.attention ? " is-attention" : ""}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="packet-progress-index">{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PacketDocuments({ documents, templates, onSelectDocument }) {
  return (
    <section className="packet-section" aria-label="Documents in this packet">
      <h3 className="packet-section-title">Documents</h3>
      <div className="packet-table-scroll">
        <table className="studio-table packet-table packet-documents">
          <thead><tr><th scope="col">Document</th><th scope="col">Pages</th><th scope="col">Template</th><th scope="col">Status</th></tr></thead>
          <tbody>{documents.map((child, index) => {
            const template = templates.find((entry) => entry.id === child.template_id);
            const status = String(child.status || "queued");
            return (
              <tr key={child.job_id}>
                <th scope="row">
                  <button type="button" className="studio-text-button" aria-label={`Open document ${index + 1} · ${pagesLabel(child.source_pages)}`}
                    onClick={() => onSelectDocument?.(child.job_id)}>
                    Document {index + 1}
                  </button>
                </th>
                <td>{formatPages(child.source_pages)}</td>
                <td>{template?.name || child.template_name || child.template_id || (LIVE_CHILD_STATUSES.has(status) ? "Choosing template…" : "—")}</td>
                <td><span className={`studio-document-status ${status}`}><i aria-hidden="true" />{status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ")}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function SplitPlanEditor({ packet, busy, onConfirm, loadPagePreview }) {
  const pages = packet.selected_pages || [];
  const [groups, setGroups] = useState(() => (packet.plan?.groups?.length ? packet.plan.groups : [{ pages }]).map((group) => formatPages(group.pages)));
  const [exclusions, setExclusions] = useState(() => (packet.plan?.exclusions || []).map((entry) => ({ ...entry })));
  const [error, setError] = useState("");
  const [page, setPage] = useState(pages[0] || 1);
  const unassigned = unassignedPages(pages, groups, exclusions);
  const pageIndex = pages.indexOf(page);
  async function confirm(event) {
    event.preventDefault();
    setError("");
    try {
      const plan = validateSplitPlan(groups.map((value) => ({ pages: parsePageSelection(value) || [] })), exclusions.map((entry) => ({ page: Number(entry.page), reason: entry.reason.trim() })), pages);
      await onConfirm(packet.packet_id, { revision: packet.plan_revision, ...plan });
    } catch (problem) { setError(problem.message); }
  }
  return (
    <section className="packet-section split-review" aria-label="Review split plan">
      <div className="studio-section-heading">
        <div>
          <h2>Review document boundaries</h2>
          <p>Automatic splitting couldn&apos;t settle where each document starts. Assign every page to a document, or exclude it with a reason. Pages keep their original order.</p>
        </div>
      </div>
      <div className="split-review-columns">
        <form onSubmit={confirm} className="split-plan-form">
          <fieldset disabled={busy}>
            <legend className="packet-section-title">Documents</legend>
            {groups.map((value, index) => (
              <div className="split-plan-row" key={index}>
                <span className="split-plan-label">Document {index + 1}</span>
                <input aria-label={`Document ${index + 1} pages`} value={value} placeholder="1-3, 5"
                  onChange={(event) => setGroups((current) => current.map((item, position) => position === index ? event.target.value : item))} />
                <button type="button" className="studio-text-button studio-destructive" aria-label={`Remove document group ${index + 1}`}
                  onClick={() => setGroups((current) => current.filter((_, position) => position !== index))}>Remove</button>
              </div>
            ))}
            <button type="button" className="split-plan-add" onClick={() => setGroups((current) => [...current, ""])}>
              <span aria-hidden="true">+ </span>Add document group
            </button>
          </fieldset>
          <fieldset disabled={busy}>
            <legend className="packet-section-title">Excluded pages</legend>
            {exclusions.map((entry, index) => (
              <div className="split-plan-row is-exclusion" key={index}>
                <select aria-label={`Excluded page ${index + 1}`} value={entry.page}
                  onChange={(event) => setExclusions((current) => current.map((item, position) => position === index ? { ...item, page: Number(event.target.value) } : item))}>
                  {pages.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <input aria-label={`Reason for exclusion ${index + 1}`} value={entry.reason} placeholder="Reason, e.g. blank cover"
                  onChange={(event) => setExclusions((current) => current.map((item, position) => position === index ? { ...item, reason: event.target.value } : item))} />
                <button type="button" className="studio-text-button studio-destructive" aria-label={`Remove exclusion ${index + 1}`}
                  onClick={() => setExclusions((current) => current.filter((_, position) => position !== index))}>Remove</button>
              </div>
            ))}
            <button type="button" className="split-plan-add" onClick={() => setExclusions((current) => [...current, { page: pages[0], reason: "" }])}>
              <span aria-hidden="true">+ </span>Exclude a page
            </button>
          </fieldset>
          {error ? <p className="packet-message is-error" role="alert">{error}</p> : null}
          <div className="split-plan-footer">
            <span className={unassigned?.length === 0 ? "is-complete" : ""}>
              {unassigned === null ? "Check the page ranges" : unassigned.length ? `Unassigned pages: ${formatPages(unassigned)}` : "Every page is assigned"}
            </span>
            <button type="submit" disabled={busy}>{busy ? "Confirming…" : "Confirm plan and extract"}</button>
          </div>
        </form>
        {loadPagePreview ? (
          <div className="split-page-preview">
            <div className="split-page-preview-bar">
              <button type="button" className="studio-text-button" aria-label="Previous page" disabled={pageIndex <= 0} onClick={() => setPage(pages[pageIndex - 1])}>‹</button>
              <label>Original page
                <select value={page} onChange={(event) => setPage(Number(event.target.value))}>
                  {pages.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <span>of {pages.length}</span>
              <button type="button" className="studio-text-button" aria-label="Next page" disabled={pageIndex >= pages.length - 1} onClick={() => setPage(pages[pageIndex + 1])}>›</button>
            </div>
            <div className="split-page-preview-body">
              <PacketPagePreview packetId={packet.packet_id} page={page} loadPreview={loadPagePreview} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function unassignedPages(pages, groups, exclusions) {
  const covered = new Set(exclusions.map((entry) => Number(entry.page)));
  try {
    for (const value of groups) for (const page of parsePageSelection(value) || []) covered.add(page);
  } catch { return null; }
  return pages.filter((page) => !covered.has(page));
}

function pagesLabel(pages) {
  return `${pages?.length === 1 ? "Page" : "Pages"} ${formatPages(pages)}`;
}

function PacketPagePreview({ packetId, page, loadPreview }) {
  const [state, setState] = useState({ url: "", error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    setState({ url: "", error: "" });
    loadPreview(packetId, page, { signal: controller.signal }).then((blob) => {
      if (controller.signal.aborted) return;
      if (blob.type !== "image/png") throw new Error("Page preview is unavailable.");
      url = URL.createObjectURL(blob);
      setState({ url, error: "" });
    }).catch((error) => { if (!controller.signal.aborted) setState({ url: "", error: error.message || "Page preview is unavailable." }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [packetId, page, loadPreview, retry]);
  return state.error ? (
    <div role="status" className="source-preview-state">
      <p>{state.error}</p>
      <button type="button" className="studio-text-button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button>
    </div>
  ) : state.url ? <img src={state.url} alt={`Original page ${page}`} /> : <p role="status" className="source-preview-state">Loading page…</p>;
}
