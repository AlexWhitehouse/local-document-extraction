import React, { useEffect, useState } from "react";
import { formatPages, parsePageSelection, validateSplitPlan } from "./documentProcessing.js";
import "./DocumentProcessing.css";

const STATUS_LABELS = {
  queued: "Queued for splitting", processing: "Assessing document boundaries", awaiting_review: "Review needed",
  materializing: "Preparing documents", processing_children: "Extracting documents", completed: "Completed", failed: "Failed",
};

export function PacketPage({ packet, busy, error, onConfirmPlan, onDelete, onSelectDocument, loadPagePreview, loadOriginal }) {
  if (!packet) return <p role="status">Loading document packet…</p>;
  return <LoadedPacketPage key={packet.packet_id} {...{ packet, busy, error, onConfirmPlan, onDelete, onSelectDocument, loadPagePreview, loadOriginal }} />;
}

function LoadedPacketPage({ packet, busy, error, onConfirmPlan, onDelete, onSelectDocument, loadPagePreview, loadOriginal }) {
  const children = Array.isArray(packet.children) ? packet.children : [];
  const exclusions = packet.plan?.exclusions || [];
  const completed = children.filter((child) => child.status === "completed").length;
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const { blob, filename } = await loadOriginal(packet.packet_id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (problem) { setDownloadError(problem.message || "Original is unavailable."); }
    finally { setDownloading(false); }
  }
  return (
    <section className="packet-page" aria-label="Document packet">
      <div className="packet-heading">
        <div><h2>{packet.source_name || "Document packet"}</h2><p>{STATUS_LABELS[packet.status] || packet.status}</p></div>
        <div className="actions">
          {packet.source_retained && loadOriginal ? <button type="button" className="secondary" disabled={downloading} onClick={download}>Download packet original</button> : null}
          <button type="button" className="secondary danger" disabled={busy} onClick={onDelete}>Delete packet and all children</button>
        </div>
      </div>
      <p className="hint">Packet {packet.packet_id} · Original pages: {formatPages(packet.selected_pages)}</p>
      {error || downloadError ? <p role="alert" className="processing-error">{error || downloadError}</p> : null}
      {packet.error_message || packet.reason || packet.error ? <p role="status">{packet.error_message || packet.reason || (typeof packet.error === "string" ? packet.error : packet.error.message)}</p> : null}
      {packet.outcome === "no_documents" ? (
        <div className="packet-empty-completion" role="status"><h3>No documents to extract</h3><p>Every selected page was verified blank. No extraction jobs were created.</p></div>
      ) : children.length ? <p>{completed} of {children.length} documents completed{children.some((child) => child.status === "failed") ? " · Some documents failed" : ""}.</p> : <p>No child documents have been created yet.</p>}
      {packet.status === "awaiting_review" ? (
        <SplitPlanEditor key={`${packet.packet_id}:${packet.plan_revision}`} packet={packet} busy={busy} onConfirm={onConfirmPlan} loadPagePreview={loadPagePreview} />
      ) : null}
      {exclusions.length ? <section className="packet-exclusions"><h3>Excluded pages</h3><ul>{exclusions.map(({ page, reason }) => <li key={page}>Page {page}: {reason}</li>)}</ul></section> : null}
      {children.length ? <section><h3>Documents in this packet</h3><ol className="packet-children">{children.map((child, index) => (
        <li key={child.job_id}>
          <button type="button" className="secondary packet-child" onClick={() => onSelectDocument(child.job_id)}>
            <strong>Document {index + 1} · Pages {formatPages(child.source_pages)}</strong>
            <span>{child.source_name || child.job_id}</span><span>{String(child.status || "queued").replaceAll("_", " ")}{child.template_name ? ` · ${child.template_name}` : ""}</span>
          </button>
        </li>
      ))}</ol></section> : null}
      <p className="hint">Deleting a child document leaves its siblings and this packet intact. The packet original contains the complete uploaded file, including pages excluded from extraction.</p>
    </section>
  );
}

function SplitPlanEditor({ packet, busy, onConfirm, loadPagePreview }) {
  const pages = packet.selected_pages || [];
  const [groups, setGroups] = useState(() => (packet.plan?.groups?.length ? packet.plan.groups : [{ pages }]).map((group) => formatPages(group.pages)));
  const [exclusions, setExclusions] = useState(() => (packet.plan?.exclusions || []).map((entry) => ({ ...entry })));
  const [error, setError] = useState("");
  const [page, setPage] = useState(pages[0] || 1);
  async function confirm(event) {
    event.preventDefault();
    setError("");
    try {
      const plan = validateSplitPlan(groups.map((value) => ({ pages: parsePageSelection(value) || [] })), exclusions.map((entry) => ({ page: Number(entry.page), reason: entry.reason.trim() })), pages);
      await onConfirm(packet.packet_id, { revision: packet.plan_revision, ...plan });
    } catch (problem) { setError(problem.message); }
  }
  return (
    <section className="split-review" aria-label="Review split plan">
      <h3>Review document boundaries</h3>
      <p>Automatic assessment could not resolve the plan. Assign every selected page to one document or give a reason to exclude it. Pages stay in their original order.</p>
      <div className="split-review-columns">
        <form onSubmit={confirm}>
          <fieldset disabled={busy}><legend>Document page groups</legend>
            {groups.map((value, index) => <div className="split-plan-row" key={index}>
              <label>Document {index + 1} pages<input value={value} placeholder="1-3, 5" onChange={(event) => setGroups((current) => current.map((item, position) => position === index ? event.target.value : item))} /></label>
              <button type="button" className="ghost" aria-label={`Remove document group ${index + 1}`} onClick={() => setGroups((current) => current.filter((_, position) => position !== index))}>Remove</button>
            </div>)}
            <button type="button" className="secondary" onClick={() => setGroups((current) => [...current, ""])}>Add document group</button>
          </fieldset>
          <fieldset disabled={busy}><legend>Explicit exclusions</legend>
            {exclusions.map((entry, index) => <div className="split-plan-row" key={index}>
              <label>Excluded page {index + 1}<select value={entry.page} onChange={(event) => setExclusions((current) => current.map((item, position) => position === index ? { ...item, page: Number(event.target.value) } : item))}>{pages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Reason for exclusion {index + 1}<input value={entry.reason} onChange={(event) => setExclusions((current) => current.map((item, position) => position === index ? { ...item, reason: event.target.value } : item))} /></label>
              <button type="button" className="ghost" aria-label={`Remove exclusion ${index + 1}`} onClick={() => setExclusions((current) => current.filter((_, position) => position !== index))}>Remove</button>
            </div>)}
            <button type="button" className="secondary" onClick={() => setExclusions((current) => [...current, { page: pages[0], reason: "" }])}>Exclude a page</button>
          </fieldset>
          {error ? <p className="processing-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>{busy ? "Confirming…" : "Confirm plan and extract"}</button>
        </form>
        {loadPagePreview ? <div className="split-page-preview"><label>Original page<select value={page} onChange={(event) => setPage(Number(event.target.value))}>{pages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><PacketPagePreview packetId={packet.packet_id} page={page} loadPreview={loadPagePreview} /></div> : null}
      </div>
    </section>
  );
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
  return state.error ? <div role="status"><p>{state.error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button></div>
    : state.url ? <img src={state.url} alt={`Original page ${page}`} /> : <p role="status">Loading page…</p>;
}
