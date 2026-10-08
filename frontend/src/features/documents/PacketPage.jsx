import { describeError } from "../../lib/describeError";
import { isBusyStatus, statusLabel, statusTone } from "../../lib/status.js";
import { isString } from "../../../../shared/json.ts";
import React, { useEffect, useId, useState } from "react";
import { formatPages, parsePageSelection, validateSplitPlan } from "./documentProcessing.js";
import { PACKET_STATUS_LABELS } from "./packetListing.js";
import "./DocumentProcessing.css";
import { ProcessingCost } from "./ProcessingCost.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { StatusDot } from "../ui/Status.jsx";
import { Tabs } from "../ui/Tabs.jsx";
import { ListAddButton } from "../ui/ListAddButton.jsx";
import { ChevronLeftIcon, ChevronRightIcon } from "../layout/Icons.jsx";

const LIVE_CHILD_STATUSES = new Set(["queued", "processing"]);

const OVERVIEW_TAB = "overview";

export function PacketPage({
  packet,
  activeDocumentId = "",
  activeDocument,
  pendingDocumentId = "",
  isOpeningDocument = false,
  documentError = "",
  documentErrorId = "",
  renderDocument,
  onSelectDocument,
  ...overview
}) {
  const tabsId = useId();

  if (!packet)
    return (
      <p role="status" className="studio-empty-state">
        Loading document packet…
      </p>
    );
  const children = Array.isArray(packet.children) ? packet.children : [];
  const activeChild = children.find((child) => child.job_id === activeDocumentId);

  // A tab being opened is highlighted straight away; the current panel stays until its document loads.
  const selectedTabId = children.some((child) => child.job_id === pendingDocumentId)
    ? pendingDocumentId
    : activeChild?.job_id || "";

  const stage = packetStage(packet, children);
  const selectedValue = selectedTabId || OVERVIEW_TAB;
  // The panel is labelled by the tab that owns it: the opening document, the active document, or the Overview.
  const panelValue = activeChild ? activeChild.job_id : isOpeningDocument ? selectedValue : OVERVIEW_TAB;

  const tabItems = [
    { value: OVERVIEW_TAB, label: "Overview", meta: stage.text, tone: stage.tone, busy: stage.busy },
    ...children.map((child, index) => {
      const status = String(child.status || "queued");

      return {
        value: child.job_id,
        label: `Document ${index + 1}`,
        meta: `${pagesLabel(child.source_pages)} · ${statusLabel(status)}`,
        tone: statusTone(status),
        busy: isBusyStatus(status),
        loading: pendingDocumentId === child.job_id,
      };
    }),
  ];

  const panelId = `${tabsId}-panel-${panelValue}`;
  const panelLabelledBy = `${tabsId}-tab-${panelValue}`;

  return (
    <section className="packet-page" aria-label="Document packet">
      <Tabs
        label="Documents in this packet"
        variant="progress"
        idPrefix={tabsId}
        items={tabItems}
        value={selectedValue}
        onChange={(value) => onSelectDocument?.(value === OVERVIEW_TAB ? "" : value)}
      />
      {documentError ? (
        <div className="packet-message is-error">
          <p role="alert">{documentError}</p>
          {children.some((child) => child.job_id === documentErrorId) ? (
            <Button variant="secondary" onClick={() => onSelectDocument?.(documentErrorId)}>
              Retry document
            </Button>
          ) : null}
        </div>
      ) : null}
      {isOpeningDocument && !activeChild ? (
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={panelLabelledBy}
          aria-busy="true"
          className="packet-panel-pending"
        />
      ) : activeChild ? (
        <div id={panelId} role="tabpanel" aria-labelledby={panelLabelledBy}>
          {activeDocument?.job_id === activeChild.job_id && renderDocument ? (
            renderDocument(activeDocument)
          ) : (
            <p role="status" className="studio-empty-state">
              Loading document…
            </p>
          )}
        </div>
      ) : (
        <div id={panelId} role="tabpanel" aria-labelledby={panelLabelledBy}>
          <PacketOverview key={packet.packet_id} packet={packet} onSelectDocument={onSelectDocument} {...overview} />
        </div>
      )}
    </section>
  );
}

/** Packet-wide status, counts, and cost, in the same place a document tab shows its own summary. */
function PacketSummary({ packet, documents }) {
  const exclusions = packet.plan?.exclusions || [];
  const pages = packet.selected_pages || [];
  const date = new Date(packet.created_at);

  return (
    <div className="studio-document-summary">
      <StatusDot
        tone={statusTone(packet.status)}
        pulse={isBusyStatus(packet.status)}
        label={PACKET_STATUS_LABELS[packet.status] || statusLabel(packet.status)}
      />
      {pages.length ? (
        <span>
          <strong>{pages.length}</strong> {pages.length === 1 ? "page" : "pages"}
        </span>
      ) : null}
      {documents.length ? (
        <span>
          <strong>{documents.length}</strong> {documents.length === 1 ? "document" : "documents"}
        </span>
      ) : null}
      {exclusions.length ? (
        <span>
          <strong>{exclusions.length}</strong> excluded
        </span>
      ) : null}
      {packet.status === "completed" ? <ProcessingCost costs={packet.costs} kind="Packet" /> : null}
      {Number.isNaN(date.getTime()) ? null : (
        <time dateTime={date.toISOString()}>
          {date.toLocaleString(undefined, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      )}
    </div>
  );
}

// The Overview tab's stage: its meta line and tone, shared with the other status displays.
function packetStage(packet, documents) {
  const done = documents.filter((child) => child.status === "completed").length;
  const failed = documents.filter((child) => child.status === "failed" || child.status === "error").length;
  const splitDone = packet.plan_accepted || documents.length > 0 || packet.outcome === "no_documents";

  if (packet.status === "awaiting_review") return { text: "Split needs your review", tone: "warning" };

  if (!splitDone) {
    if (packet.status === "failed") return { text: "Split failed", tone: "danger" };

    return packet.status === "queued"
      ? { text: "Queued", tone: "neutral" }
      : { text: "Finding documents", tone: "info", busy: true };
  }

  if (packet.outcome === "no_documents") return { text: "No documents found", tone: "success" };

  if (packet.status === "materializing" || !documents.length)
    return { text: "Preparing documents", tone: "info", busy: true };

  if (packet.status === "completed")
    return failed
      ? { text: `Finished · ${failed} failed`, tone: "danger" }
      : { text: "All documents extracted", tone: "success" };

  if (packet.status === "failed")
    return { text: `Failed · ${done} of ${documents.length} extracted`, tone: "danger" };

  return {
    text: `Split into ${documents.length} · ${done} of ${documents.length} extracted${failed ? ` · ${failed} failed` : ""}`,
    tone: failed ? "danger" : "info",
    busy: !failed,
  };
}

function PacketOverview({ packet, templates = [], busy, error, onConfirmPlan, onSelectDocument, loadPagePreview }) {
  const documents = Array.isArray(packet.children) ? packet.children : [];
  const exclusions = packet.plan?.exclusions || [];
  const pages = packet.selected_pages || [];

  const failure =
    packet.status === "failed"
      ? describeError(
          {
            code: packet.error_code || packet.error?.code,
            message: packet.error_message || (isString(packet.error) ? packet.error : packet.error?.message),
          },
          "This packet couldn't be processed. Try again.",
        )
      : "";

  return (
    <div className="packet-overview">
      <PacketSummary packet={packet} documents={documents} />
      {error ? (
        <p role="alert" className="packet-message is-error">
          {error}
        </p>
      ) : null}
      {failure ? (
        <p className="packet-message is-error">
          {failure}
        </p>
      ) : null}
      {packet.status === "awaiting_review" ? (
        <SplitPlanEditor
          key={`${packet.packet_id}:${packet.plan_revision}`}
          packet={packet}
          busy={busy}
          onConfirm={onConfirmPlan}
          loadPagePreview={loadPagePreview}
        />
      ) : packet.outcome === "no_documents" ? (
        <section className="packet-section">
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
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {exclusions.map(({ page, reason }) => (
                  <tr key={page}>
                    <th scope="row">{page}</th>
                    <td>{reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PacketDocuments({ documents, templates, onSelectDocument }) {
  return (
    <section className="packet-section" aria-label="Documents in this packet">
      <h3 className="packet-section-title">Documents</h3>
      <div className="packet-table-scroll">
        <table className="studio-table packet-table packet-documents">
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Pages</th>
              <th scope="col">Template</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((child, index) => {
              const template = templates.find((entry) => entry.id === child.template_id);
              const status = String(child.status || "queued");

              return (
                <tr key={child.job_id}>
                  <th scope="row">
                    <Button
                      variant="text"
                      aria-label={`Open document ${index + 1} · ${pagesLabel(child.source_pages)}`}
                      onClick={() => onSelectDocument?.(child.job_id)}
                    >
                      Document {index + 1}
                    </Button>
                  </th>
                  <td>{formatPages(child.source_pages)}</td>
                  <td>
                    {template?.name ||
                      child.template_name ||
                      child.template_id ||
                      (LIVE_CHILD_STATUSES.has(status) ? "Choosing template…" : "—")}
                  </td>
                  <td>
                    <StatusDot tone={statusTone(status)} pulse={isBusyStatus(status)} label={statusLabel(status)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SplitPlanEditor({ packet, busy, onConfirm, loadPagePreview }) {
  const pages = packet.selected_pages || [];

  const [groups, setGroups] = useState(() =>
    (packet.plan?.groups?.length ? packet.plan.groups : [{ pages }]).map((group) => formatPages(group.pages)),
  );

  const [exclusions, setExclusions] = useState(() => (packet.plan?.exclusions || []).map((entry) => ({ ...entry })));
  const [error, setError] = useState("");
  const [page, setPage] = useState(pages[0] || 1);
  const unassigned = unassignedPages(pages, groups, exclusions);
  const pageIndex = pages.indexOf(page);

  async function confirm(event) {
    event.preventDefault();
    setError("");

    try {
      const plan = validateSplitPlan(
        groups.map((value) => ({ pages: parsePageSelection(value) || [] })),
        exclusions.map((entry) => ({ page: Number(entry.page), reason: entry.reason.trim() })),
        pages,
      );

      await onConfirm(packet.packet_id, { revision: packet.plan_revision, ...plan });
    } catch (problem) {
      setError(problem.message);
    }
  }

  return (
    <section className="packet-section split-review" aria-label="Review split plan">
      <div className="studio-section-heading">
        <div>
          <h2>Review document boundaries</h2>
          <p>
            Automatic splitting couldn&apos;t settle where each document starts. Assign every page to a document, or
            exclude it with a reason. Pages keep their original order.
          </p>
        </div>
      </div>
      <div className="split-review-columns">
        <form onSubmit={confirm} className="split-plan-form">
          <fieldset disabled={busy}>
            <legend className="packet-section-title">Documents</legend>
            {groups.map((value, index) => (
              <div className="split-plan-row" key={index}>
                <span className="split-plan-label">Document {index + 1}</span>
                <input
                  aria-label={`Document ${index + 1} pages`}
                  value={value}
                  placeholder="1-3, 5"
                  onChange={(event) =>
                    setGroups((current) =>
                      current.map((item, position) => (position === index ? event.target.value : item)),
                    )
                  }
                />
                <Button
                  variant="danger-text"
                  aria-label={`Remove document group ${index + 1}`}
                  onClick={() => setGroups((current) => current.filter((_, position) => position !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <ListAddButton onClick={() => setGroups((current) => [...current, ""])}>Add document group</ListAddButton>
          </fieldset>
          <fieldset disabled={busy}>
            <legend className="packet-section-title">Excluded pages</legend>
            {exclusions.map((entry, index) => (
              <div className="split-plan-row is-exclusion" key={index}>
                <select
                  aria-label={`Excluded page ${index + 1}`}
                  value={entry.page}
                  onChange={(event) =>
                    setExclusions((current) =>
                      current.map((item, position) =>
                        position === index ? { ...item, page: Number(event.target.value) } : item,
                      ),
                    )
                  }
                >
                  {pages.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Reason for exclusion ${index + 1}`}
                  value={entry.reason}
                  placeholder="Reason, e.g. blank cover"
                  onChange={(event) =>
                    setExclusions((current) =>
                      current.map((item, position) =>
                        position === index ? { ...item, reason: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  variant="danger-text"
                  aria-label={`Remove exclusion ${index + 1}`}
                  onClick={() => setExclusions((current) => current.filter((_, position) => position !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <ListAddButton onClick={() => setExclusions((current) => [...current, { page: pages[0], reason: "" }])}>
              Exclude a page
            </ListAddButton>
          </fieldset>
          {error ? (
            <p className="packet-message is-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="split-plan-footer">
            <span className={unassigned?.length === 0 ? "is-complete" : ""}>
              {unassigned === null
                ? "Check the page ranges"
                : unassigned.length
                  ? `Unassigned pages: ${formatPages(unassigned)}`
                  : "Every page is assigned"}
            </span>
            <Button type="submit" pending={busy} pendingLabel="Confirming…">
              Confirm plan and extract
            </Button>
          </div>
        </form>
        {loadPagePreview ? (
          <div className="split-page-preview">
            <div className="split-page-preview-bar">
              <IconButton
                label="Previous page"
                icon={ChevronLeftIcon}
                size="sm"
                disabled={pageIndex <= 0}
                onClick={() => setPage(pages[pageIndex - 1])}
              />
              <label>
                Original page
                <select value={page} onChange={(event) => setPage(Number(event.target.value))}>
                  {pages.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <span>of {pages.length}</span>
              <IconButton
                label="Next page"
                icon={ChevronRightIcon}
                size="sm"
                disabled={pageIndex >= pages.length - 1}
                onClick={() => setPage(pages[pageIndex + 1])}
              />
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
  } catch {
    return null;
  }

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
    loadPreview(packetId, page, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;

        if (blob.type !== "image/png") throw new Error("Page preview is unavailable.");
        url = URL.createObjectURL(blob);
        setState({ url, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ url: "", error: describeError(error, "Page preview is unavailable.") });
      });

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [packetId, page, loadPreview, retry]);

  return state.error ? (
    <div role="status" className="source-preview-state">
      <p>{state.error}</p>
      <Button variant="text" onClick={() => setRetry((value) => value + 1)}>
        Retry preview
      </Button>
    </div>
  ) : state.url ? (
    <img src={state.url} alt={`Original page ${page}`} />
  ) : (
    <p role="status" className="source-preview-state">
      Loading page…
    </p>
  );
}
