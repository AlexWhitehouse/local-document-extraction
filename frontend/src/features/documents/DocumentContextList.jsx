import { statusLabel, statusTone } from "../../lib/status.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextSidebar } from "../context/ContextSidebar.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { appPath } from "../../lib/appRoutes";
import { isSingleDocumentPacket, singlePacketDocument, PACKET_STATUS_LABELS } from "./packetListing.js";
import { EmptyState, ErrorState, Skeleton } from "../ui/States.jsx";
import { Button } from "../ui/Button.jsx";
import { LoadMore } from "../ui/Pager.jsx";
import { describeError } from "../../lib/describeError";
import { DocumentIcon, PacketIcon } from "../layout/Icons.jsx";

const NOT_TEXT_ENTRY = new Set(["checkbox", "radio", "button", "submit", "reset"]);

export function DocumentContextList({
  title = "Documents",
  workspaceId,
  packets = [],
  selectedPacketId = "",
  packetError = "",
  onRetryPackets,
  onSelectPacket,
  onLoadMorePackets,
  hasMorePackets = false,
  loadingPackets = false,
  selectedPacketIds = [],
  onTogglePacketSelection = () => {},
  documents,
  selectedDocumentId,
  selectedDocumentIds = [],
  selectedDocumentCount,
  totalDocuments = 0,
  searchFilter = null,
  matchTotal = 0,
  matchTotalCapped = false,
  onClearSearchFilter = () => {},
  isSelectingAll = false,
  onSelectAllDocuments = () => {},
  onClearSelection = () => {},
  hasMoreDocuments,
  isLoadingMoreDocuments,
  listStatus = "ready",
  listError = null,
  loadMoreError = null,
  onRetryDocumentList,
  isDeletingDocuments = false,
  isExportingDocuments = false,
  onSelectDocument,
  onToggleAllDocumentSelections = () => {},
  onToggleDocumentSelection = () => {},
  onLoadMoreDocuments,
}) {
  // Keep packet ownership for actions even when its sole document is displayed as a normal row.
  // A search lists its matching documents on their own, packet documents included.
  const isSearching = Boolean(searchFilter);
  const items = useMemo(() => buildListItems(packets, documents, !isSearching), [packets, documents, isSearching]);

  const availableDocumentIds = useMemo(
    () => items.flatMap((item) => (item.kind === "document" ? [String(item.id)] : [])),
    [items],
  );

  const availablePacketIds = useMemo(
    () => items.flatMap((item) => (item.kind === "packet" ? [String(item.id)] : [])),
    [items],
  );

  const selectedIds = useMemo(
    () => new Set([...selectedDocumentIds, ...selectedPacketIds.map((id) => `packet:${id}`)]),
    [selectedDocumentIds, selectedPacketIds],
  );

  const isItemChecked = (item) => selectedIds.has(item.kind === "packet" ? item.key : item.id);
  const checkedItemCount = items.filter(isItemChecked).length;
  const hasSelection = selectedIds.size > 0;
  const selectedCount = selectedDocumentCount ?? selectedIds.size;
  const areAllLoadedChecked = items.length > 0 && checkedItemCount === items.length;
  const hasMore = Boolean(hasMoreDocuments || hasMorePackets);

  // Everything is selected once every row is ticked and nothing is left to load, or every match is picked by ID.
  const isEverythingSelected = areAllLoadedChecked && (!hasMore || (isSearching && selectedCount >= matchTotal));

  const selectAllTotal = isSearching ? matchTotal : totalDocuments;
  const isSelectionLocked = isDeletingDocuments || isExportingDocuments;
  // An empty workspace has nothing to select; the page body offers the upload.
  const isWorkspaceEmpty = !items.length && listStatus === "ready" && !isSearching;

  const rowMotion = useRowMotion(
    items,
    (item) => item.key,
    (item) => item.tone,
  );

  const selectedKey = selectedPacketId
    ? `packet:${selectedPacketId}`
    : selectedDocumentId
      ? `document:${selectedDocumentId}`
      : "";

  const listRef = useRef(null);
  const barRef = useRef(null);
  const selectAllRef = useRef(null);
  const refocusAfterSelectAll = useRef(false);
  const lastScrolledSelection = useRef(null);
  const focusSelection = useRef(false);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const virtual = items.length > 100;
  // Matches the natural .context-item-card height so rows keep their size past the virtual threshold.
  const rowStride = 40;
  const start = virtual ? Math.max(0, Math.min(items.length - 1, Math.floor(viewport.top / rowStride) - 5)) : 0;
  const end = virtual ? Math.min(items.length, start + Math.ceil(viewport.height / rowStride) + 10) : items.length;
  useEffect(() => {
    const list = listRef.current;
    const resize = () => setViewport({ top: list.scrollTop, height: list.clientHeight || 600 });

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(list);

    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!virtual || lastScrolledSelection.current === selectedKey) return;
    lastScrolledSelection.current = selectedKey;
    const list = listRef.current;
    const index = items.findIndex((item) => item.key === selectedKey);

    if (index < 0) return;
    const top = index * rowStride;
    const height = list.clientHeight || 600;

    if (top < list.scrollTop || top + rowStride > list.scrollTop + height) {
      list.scrollTop = top;
      setViewport({ top: list.scrollTop, height });
    }
  }, [selectedKey, items, virtual]);
  useEffect(() => {
    if (!focusSelection.current) return;
    const selected = listRef.current.querySelector('[data-selected-document="true"]');

    if (selected) {
      focusSelection.current = false;
      selected.focus({ preventScroll: true });
    }
  }, [selectedKey, start, end]);

  // "Select all N" goes away once everything is selected; focus moves to the bar's checkbox unless it moved on.
  useEffect(() => {
    if (!refocusAfterSelectAll.current || isSelectingAll) return;
    refocusAfterSelectAll.current = false;

    if (!document.activeElement || document.activeElement === document.body) selectAllRef.current?.focus();
  });

  function selectAllLoaded() {
    onToggleAllDocumentSelections(availableDocumentIds, true);

    for (const id of availablePacketIds) onTogglePacketSelection(id, true);
  }

  // The bar that held focus goes away with the selection or search, so focus moves to the list.
  function clearSelection({ refocus = true } = {}) {
    onClearSelection();

    if (refocus) listRef.current?.focus();
  }

  function selectEverything() {
    refocusAfterSelectAll.current = true;
    onSelectAllDocuments();
  }

  // ⌘A / Ctrl+A selects every loaded row and Esc clears the selection, unless focus is in a text field.
  function handleSelectionKeys(event) {
    if (isTextEntry(event.target) || event.nativeEvent?.isComposing) return;

    const isSelectAll =
      (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a";

    if (isSelectAll && items.length && !isSelectionLocked) {
      event.preventDefault();
      selectAllLoaded();
    } else if (event.key === "Escape" && hasSelection && !isSelectionLocked) {
      event.preventDefault();
      event.stopPropagation();
      clearSelection({ refocus: Boolean(barRef.current?.contains(event.target)) });
    }
  }

  let head = null;

  if (hasSelection) {
    head = (
      <div ref={barRef} className="context-head-bar" role="group" aria-label="Selection" onKeyDown={handleSelectionKeys}>
        <label className="context-head-check">
          <input
            ref={(checkbox) => {
              selectAllRef.current = checkbox;

              if (checkbox) checkbox.indeterminate = !areAllLoadedChecked;
            }}
            type="checkbox"
            aria-label="Select all documents"
            checked={areAllLoadedChecked}
            disabled={!items.length || isSelectionLocked}
            onChange={() => (areAllLoadedChecked ? clearSelection() : selectAllLoaded())}
          />
        </label>
        <span className="context-head-count" role="status">
          {formatCount(selectedCount)} selected
        </span>
        <span className="context-head-actions">
          {!isEverythingSelected && selectAllTotal > 0 ? (
            <>
              <Button
                variant="text"
                size="sm"
                pending={isSelectingAll}
                pendingLabel="Selecting…"
                disabled={isSelectionLocked}
                onClick={selectEverything}
              >
                Select all {formatCount(selectAllTotal)}
                {isSearching && matchTotalCapped ? "+" : ""}
              </Button>
              <span className="context-head-separator" aria-hidden="true">
                ·
              </span>
            </>
          ) : null}
          <Button
            variant="text"
            size="sm"
            aria-label="Clear selection"
            disabled={isSelectionLocked}
            onClick={() => clearSelection()}
          >
            Clear
          </Button>
        </span>
      </div>
    );
  } else if (isSearching) {
    const summary = searchFilter.summary;

    head = (
      <div className="context-head-bar" role="group" aria-label="Search filter">
        <span className="context-head-count" role="status">
          {listStatus === "loading" ? "Searching…" : matchLabel(matchTotal, matchTotalCapped)}
        </span>
        {summary ? (
          <>
            <span className="context-head-separator" aria-hidden="true">
              ·
            </span>
            <span className="context-head-summary" title={summary}>
              {summary}
            </span>
          </>
        ) : null}
        <span className="context-head-actions">
          <Button
            variant="text"
            size="sm"
            aria-label="Clear search"
            onClick={() => {
              onClearSearchFilter();
              listRef.current?.focus();
            }}
          >
            Clear
          </Button>
        </span>
      </div>
    );
  }

  return (
    <ContextSidebar title={title} head={head}>
      {packetError ? <ErrorState variant="inline" message={packetError} onRetry={onRetryPackets} /> : null}
      <ScrollArea
        className="context-list"
        ref={listRef}
        role="region"
        aria-label="Document list"
        tabIndex={0}
        style={virtual ? { display: "block" } : undefined}
        onKeyDown={handleSelectionKeys}
        onScroll={
          virtual
            ? (event) =>
                setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight || 600 })
            : undefined
        }
      >
        <div
          role="list"
          aria-label="Documents"
          style={virtual ? { position: "relative", height: items.length * rowStride } : { display: "contents" }}
        >
          {items.slice(start, end).map((item, offset) => {
            const isActive = selectedKey === item.key;
            const isChecked = isItemChecked(item);

            const select = (target) =>
              target.kind === "packet" ? onSelectPacket?.(target.id) : onSelectDocument(target.id);

            return (
              <div
                key={`context-${item.key}`}
                role="listitem"
                aria-posinset={start + offset + 1}
                aria-setsize={items.length}
                style={virtual ? { position: "absolute", top: (start + offset) * rowStride, height: rowStride } : undefined}
                className={`context-item-card context-item-document${item.displayKind === "packet" ? " context-item-packet" : ""}${item.tone ? ` status-${item.tone}` : ""}${isActive ? " active" : ""}${
                  isChecked ? " checked" : ""
                }${rowMotion(item.key)}`}
              >
                <label
                  className={`context-select-control${item.displayKind === "packet" ? " context-packet-select" : ""}`}
                  title={`Select ${item.displayKind} ${item.displayId}`}
                >
                  {item.displayKind === "packet" ? (
                    <span className="context-packet-mark" aria-hidden="true">
                      <PacketIcon size={13} />
                    </span>
                  ) : null}
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.displayKind} ${item.displayId}`}
                    checked={isChecked}
                    disabled={isSelectionLocked}
                    onChange={(event) =>
                      item.kind === "packet"
                        ? onTogglePacketSelection(item.id, event.target.checked)
                        : onToggleDocumentSelection(item.id, event.target.checked)
                    }
                  />
                </label>
                <NavigationLink
                  href={
                    workspaceId
                      ? appPath({
                          workspaceId,
                          page: "documents",
                          ...(item.kind === "packet" ? { packetId: item.id } : { documentId: item.id }),
                        })
                      : undefined
                  }
                  data-selected-document={isActive ? "true" : undefined}
                  data-context-select aria-current={isActive ? "true" : undefined}
                  className={isActive ? "context-item-main active" : "context-item-main"}
                  onClick={() => select(item)}
                  onKeyDown={(event) => {
                    const positions = {
                      ArrowDown: start + offset + 1,
                      ArrowUp: start + offset - 1,
                      Home: 0,
                      End: items.length - 1,
                    };

                    if (!(event.key in positions)) return;
                    event.preventDefault();
                    focusSelection.current = true;
                    select(items[Math.max(0, Math.min(items.length - 1, positions[event.key]))]);
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </NavigationLink>
                <ContextCopyButton ariaLabel={`Copy ${item.displayKind} ID ${item.displayId}`} value={item.displayId} />
              </div>
            );
          })}
        </div>
        {listStatus === "error" ? (
          <ErrorState
            variant="inline"
            error={listError}
            message={
              isSearching && listError?.code === "invalid_search_filter"
                ? "This search uses a template or field that's no longer available. Clear it to see every document."
                : undefined
            }
            onRetry={onRetryDocumentList}
          />
        ) : null}
        {!items.length && listStatus === "loading" ? <Skeleton rows={4} height={44} /> : null}
        {!items.length && listStatus === "ready" && isSearching ? (
          <EmptyState variant="inline" message="No documents match this search." />
        ) : null}
        {isWorkspaceEmpty ? <EmptyDocumentList /> : null}
        {hasMoreDocuments || hasMorePackets || loadMoreError ? (
          <LoadMore
            label="Load more documents"
            pending={isLoadingMoreDocuments || loadingPackets}
            error={loadMoreError ? describeError(loadMoreError, "This couldn't be loaded.") : ""}
            onLoadMore={() => {
              if (hasMoreDocuments) onLoadMoreDocuments();

              if (hasMorePackets) onLoadMorePackets?.();
            }}
          />
        ) : null}
      </ScrollArea>
    </ContextSidebar>
  );
}

function isTextEntry(target) {
  if (target?.isContentEditable || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return true;

  return target?.tagName === "INPUT" && !NOT_TEXT_ENTRY.has(target.type);
}

function formatCount(count) {
  return count.toLocaleString("en-GB");
}

function matchLabel(total, capped) {
  return `${formatCount(total)}${capped ? "+" : ""} ${total === 1 && !capped ? "match" : "matches"}`;
}

// Shaped like the list it stands in for: one row that explains, then faded rows where documents will land.
function EmptyDocumentList() {
  return (
    <div className="context-list-empty">
      <div className="context-item-card context-item-document context-empty-row">
        <span className="context-empty-icon" aria-hidden="true">
          <DocumentIcon size={14} />
        </span>
        <div className="context-item-main">
          <strong>No documents yet</strong>
          <span>Uploads appear here</span>
        </div>
      </div>
      {[0, 1, 2].map((row) => (
        <div key={row} className="context-item-card context-item-document context-ghost-row" aria-hidden="true">
          <span className="context-ghost-check" />
          <div className="context-item-main">
            <span className="context-ghost-line" />
            <span className="context-ghost-line is-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Grouped lists show a packet's documents in its row; ungrouped ones list every document on its own.
function buildListItems(packets, documents, grouped) {
  // The packet's child list also identifies children in older cached summaries.
  const childIds = new Set(
    packets.flatMap((packet) => (Array.isArray(packet.children) ? packet.children : []).map((child) => child.job_id)),
  );

  const documentsById = new Map(documents.map((job) => [job.job_id, job]));
  const items = [];

  for (const packet of packets) {
    const childCount = Array.isArray(packet.children) ? packet.children.length : 0;
    const single = isSingleDocumentPacket(packet);
    const child = singlePacketDocument(packet);
    const document = child && (documentsById.get(child.job_id) || child);

    // A loaded document row is fresher than the packet's cached child summary.
    const childStatuses = (Array.isArray(packet.children) ? packet.children : []).map(
      (entry) => documentsById.get(entry.job_id)?.status || entry.status,
    );

    const isAwaitingTemplate = childStatuses.includes("awaiting_template");

    const status =
      packet.outcome === "no_documents"
        ? "No documents to extract"
        : isAwaitingTemplate
          ? "Needs template"
          : PACKET_STATUS_LABELS[packet.status] || statusLabel(packet.status || "queued");

    items.push({
      kind: "packet",
      id: packet.packet_id,
      key: `packet:${packet.packet_id}`,
      createdAt: packet.created_at,
      displayKind: single ? "document" : "packet",
      displayId: child?.job_id || packet.packet_id,
      title: packet.source_name || packet.packet_id,
      detail: single
        ? [child?.job_id, document ? statusLabel(document.status) : packet.status === "queued" ? "Queued" : "Processing"]
            .filter(Boolean)
            .join(" · ")
        : childCount
          ? `${childCount} ${childCount === 1 ? "document" : "documents"} · ${status}`
          : status,
      tone: document ? statusTone(document.status) : packetTone(packet.status, childStatuses),
    });
  }

  for (const job of documents) {
    if (grouped && (job.parent_packet_id || childIds.has(job.job_id))) continue;
    items.push({
      kind: "document",
      id: job.job_id,
      key: `document:${job.job_id}`,
      createdAt: job.created_at || job.queued_at,
      displayKind: "document",
      displayId: job.job_id,
      title: job.source_name || defaultUploadedName(job.source_mime_type),
      detail: `${job.job_id} · ${statusLabel(job.status || "queued")}`,
      tone: statusTone(job.status),
    });
  }

  return items.sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
}

// A packet's row takes the most urgent tone among its documents, then its own status.
function packetTone(status, childStatuses) {
  const childTones = childStatuses.map(statusTone);

  if (childTones.includes("danger")) return "danger";

  if (childTones.includes("warning")) return "warning";

  return statusTone(status);
}

function defaultUploadedName(sourceMimeType) {
  const mimeType = String(sourceMimeType || "");

  return mimeType.startsWith("image/") || mimeType === "application/pdf" ? "Uploaded document" : "Uploaded file";
}
