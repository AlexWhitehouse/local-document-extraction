import { statusLabel, statusTone } from "../../lib/status.js";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { appPath } from "../../lib/appRoutes";
import { isPacketListed, isSingleDocumentPacket, singlePacketDocument, PACKET_STATUS_LABELS } from "./packetListing.js";
import { EmptyState, ErrorState, Skeleton } from "../ui/States.jsx";
import { Button } from "../ui/Button.jsx";
import { Field, Select, TextInput } from "../ui/Field.jsx";
import { FilterIcon, PacketIcon } from "../layout/Icons.jsx";

const EMPTY_FILTERS = { dateFrom: "", dateTo: "", model: "" };

const MODEL_SETUP_MESSAGE = "Set up a Model gateway on the Workspace page to upload";

export function DocumentContextList({
  workspaceId,
  search,
  packets = [],
  selectedPacketId = "",
  packetError = "",
  onSelectPacket,
  onLoadMorePackets,
  hasMorePackets = false,
  loadingPackets = false,
  selectedPacketIds = [],
  onTogglePacketSelection = () => {},
  documents,
  selectedDocumentId,
  selectedDocumentIds = [],
  debouncedSearch,
  filters = EMPTY_FILTERS,
  availableModels = [],
  hasActiveFilters = false,
  hasMoreDocuments,
  isLoadingMoreDocuments,
  listStatus = "ready",
  listError = null,
  loadMoreError = null,
  onRetryDocumentList,
  canUploadDocuments = false,
  onUploadDocument,
  isDeletingDocuments = false,
  isExportingDocuments = false,
  onSearchChange,
  onFiltersChange = () => {},
  onSelectDocument,
  onToggleAllDocumentSelections = () => {},
  onToggleDocumentSelection = () => {},
  onLoadMoreDocuments,
}) {
  // Keep packet ownership for actions even when its sole document is displayed as a normal row.
  const items = useMemo(
    () => buildListItems(packets, documents, debouncedSearch, filters, hasActiveFilters),
    [packets, documents, debouncedSearch, filters, hasActiveFilters],
  );

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
  const selectedAvailableCount = items.filter(isItemChecked).length;

  const areAllAvailableDocumentsSelected = items.length > 0 && selectedAvailableCount === items.length;

  const areSomeAvailableDocumentsSelected = selectedAvailableCount > 0 && !areAllAvailableDocumentsSelected;

  const selectAllLabel = areAllAvailableDocumentsSelected
    ? "Deselect all available documents"
    : "Select all available documents";

  const isSelectionLocked = isDeletingDocuments || isExportingDocuments;

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

  return (
    <>
      <div className="context-search-field">
        <div className="context-search-row">
          <label className="context-select-all-control" title={selectAllLabel}>
            <input
              ref={(checkbox) => {
                if (checkbox) {
                  checkbox.indeterminate = areSomeAvailableDocumentsSelected;
                }
              }}
              type="checkbox"
              aria-label={selectAllLabel}
              checked={areAllAvailableDocumentsSelected}
              disabled={!items.length || isSelectionLocked}
              onChange={(event) => {
                onToggleAllDocumentSelections(availableDocumentIds, event.target.checked);

                for (const id of availablePacketIds) onTogglePacketSelection(id, event.target.checked);
              }}
            />
          </label>
          <div className="context-search-shell">
            <Field label="Search documents" labelHidden>
              <TextInput
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="e.g. invoice.pdf"
              />
            </Field>
            <AdvancedJobFilters filters={filters} availableModels={availableModels} onFiltersChange={onFiltersChange} />
          </div>
        </div>
      </div>
      {packetError ? (
        <p role="status" className="processing-error context-list-error">
          {packetError}
        </p>
      ) : null}
      <ScrollArea
        className="context-list"
        ref={listRef}
        role="region"
        aria-label="Document list"
        tabIndex={0}
        style={virtual ? { display: "block" } : undefined}
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
          <ErrorState variant="inline" error={listError} onRetry={onRetryDocumentList} />
        ) : null}
        {!items.length && listStatus === "loading" ? <Skeleton rows={4} height={44} /> : null}
        {!items.length && listStatus === "ready" && (debouncedSearch || hasActiveFilters) ? (
          <p className="muted">No documents match these filters.</p>
        ) : null}
        {!items.length && listStatus === "ready" && !(debouncedSearch || hasActiveFilters) ? (
          <EmptyState
            variant="inline"
            message="No documents yet"
            action={
              <Button
                variant="secondary"
                disabled={!canUploadDocuments}
                title={canUploadDocuments ? undefined : MODEL_SETUP_MESSAGE}
                onClick={onUploadDocument}
              >
                Upload documents
              </Button>
            }
          />
        ) : null}
        {hasMoreDocuments || hasMorePackets ? (
          <button
            type="button"
            className="context-item"
            disabled={isLoadingMoreDocuments || loadingPackets}
            onClick={() => {
              if (hasMoreDocuments) onLoadMoreDocuments();

              if (hasMorePackets) onLoadMorePackets?.();
            }}
          >
            <strong>{isLoadingMoreDocuments || loadingPackets ? "Loading…" : "Load more Documents"}</strong>
            <span>
              {debouncedSearch || hasActiveFilters ? "Continue searching older documents" : "Show older documents"}
            </span>
          </button>
        ) : null}
        {loadMoreError ? <ErrorState variant="inline" error={loadMoreError} onRetry={onLoadMoreDocuments} /> : null}
      </ScrollArea>
    </>
  );
}

function buildListItems(packets, documents, search, filters, hasActiveFilters) {
  // The packet's child list also identifies children in older cached summaries.
  const childIds = new Set(
    packets.flatMap((packet) => (Array.isArray(packet.children) ? packet.children : []).map((child) => child.job_id)),
  );

  const documentsById = new Map(documents.map((job) => [job.job_id, job]));
  const items = [];

  for (const packet of packets) {
    if (!isPacketListed(packet, documents, search, filters, hasActiveFilters)) continue;
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
          ? "Template needed"
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
    if (job.parent_packet_id || childIds.has(job.job_id)) continue;
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

function AdvancedJobFilters({ filters, availableModels, onFiltersChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(() => ({ ...filters }));
  const containerRef = useRef(null);
  const popoverId = useId();
  const headingId = useId();

  const activeFilterCount = [filters.dateFrom, filters.dateTo, filters.model].filter(Boolean).length;

  const hasInvalidDateRange = Boolean(
    draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateFrom > draftFilters.dateTo,
  );

  const modelOptions = [
    ...new Set(
      [...availableModels.map((model) => String(model || "").trim()), String(draftFilters.model || "").trim()].filter(
        Boolean,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    setDraftFilters(toDraftFilters(filters));
  }, [filters]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeOnOutsidePointer(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function updateDraftFilter(name, value) {
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();

    if (hasInvalidDateRange) {
      return;
    }

    onFiltersChange(draftFilters);
    setIsOpen(false);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    onFiltersChange(EMPTY_FILTERS);
    setIsOpen(false);
  }

  function toggleFilters() {
    if (!isOpen) {
      setDraftFilters(toDraftFilters(filters));
    }

    setIsOpen((current) => !current);
  }

  return (
    <div className="context-filter-control" ref={containerRef}>
      <button
        type="button"
        className={`context-filter-trigger${activeFilterCount ? " active" : ""}`}
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Advanced document filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
        title="Advanced document filters"
        onClick={toggleFilters}
      >
        <FilterIcon />
        {activeFilterCount ? (
          <span className="context-filter-count" aria-hidden="true">
            {activeFilterCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <form
          id={popoverId}
          className="context-filter-popover"
          role="dialog"
          aria-labelledby={headingId}
          onSubmit={applyFilters}
        >
          <div className="context-filter-popover-head">
            <div>
              <span className="eyebrow">Narrow the queue</span>
              <strong id={headingId}>Advanced filters</strong>
            </div>
            {activeFilterCount ? <span className="context-filter-active-label">{activeFilterCount} active</span> : null}
          </div>

          <div className="context-filter-date-grid">
            <Field label="Date from">
              <TextInput
                type="date"
                value={draftFilters.dateFrom}
                max={draftFilters.dateTo || undefined}
                onChange={(event) => updateDraftFilter("dateFrom", event.target.value)}
              />
            </Field>
            <Field label="Date to" error={hasInvalidDateRange ? "Date from must be on or before date to." : ""}>
              <TextInput
                type="date"
                value={draftFilters.dateTo}
                min={draftFilters.dateFrom || undefined}
                onChange={(event) => updateDraftFilter("dateTo", event.target.value)}
              />
            </Field>
          </div>

          <Field label="Model used">
            <Select value={draftFilters.model} onChange={(event) => updateDraftFilter("model", event.target.value)}>
              <option value="">Any model</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          </Field>

          <div className="context-filter-actions">
            <Button
              variant="secondary"
              disabled={!activeFilterCount && !draftFilters.dateFrom && !draftFilters.dateTo && !draftFilters.model}
              onClick={clearFilters}
            >
              Clear
            </Button>
            <Button type="submit" disabled={hasInvalidDateRange}>
              Apply filters
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function toDraftFilters(filters) {
  return {
    dateFrom: String(filters.dateFrom || ""),
    dateTo: String(filters.dateTo || ""),
    model: String(filters.model || ""),
  };
}

function defaultUploadedName(sourceMimeType) {
  const mimeType = String(sourceMimeType || "");

  return mimeType.startsWith("image/") || mimeType === "application/pdf" ? "Uploaded Document" : "Uploaded Source file";
}
