export const PACKET_STATUS_LABELS = {
  queued: "Queued for splitting", processing: "Finding documents", awaiting_review: "Review needed",
  materializing: "Preparing documents", processing_children: "Extracting", completed: "Completed", failed: "Failed",
};

function hasSingleDocumentPlan(packet) {
  return packet?.plan?.groups?.length === 1 &&
    (packet.plan_accepted === true || ["processing_children", "completed"].includes(packet.status));
}

/** Presentation follows the accepted split, never the number of children left after deletion. */
export function isSingleDocumentPacket(packet) {
  if (!packet || packet.status === "awaiting_review" || packet.outcome === "no_documents") return false;
  const childCount = Array.isArray(packet.children) ? packet.children.length : 0;
  if (childCount > 1 || (["completed", "failed"].includes(packet.status) && childCount === 0)) return false;
  if (hasSingleDocumentPlan(packet)) return true;
  return packet.selected_pages?.length === 1 && ["queued", "processing", "materializing"].includes(packet.status);
}

/** A single child is usable once its one-document plan is committed. */
export function singlePacketDocument(packet) {
  return isSingleDocumentPacket(packet) && hasSingleDocumentPlan(packet) && packet.children?.length === 1
    ? packet.children[0]
    : null;
}

/** A packet is listed when no query is active, it matches the query itself, or one of its documents does. */
export function isPacketListed(packet, documents, search, filters, hasActiveFilters) {
  if (!search && !hasActiveFilters) return true;
  const childIds = new Set((Array.isArray(packet.children) ? packet.children : []).map((child) => child.job_id));
  if (documents.some((job) => job.parent_packet_id === packet.packet_id || childIds.has(job.job_id))) return true;
  if (filters.model) return false;
  const query = String(search || "").trim().toLowerCase();
  if (query && ![packet.packet_id, packet.source_name, packet.status].some((value) => String(value || "").toLowerCase().includes(query))) return false;
  const date = String(packet.created_at || "").slice(0, 10);
  if (filters.dateFrom && (!date || date < filters.dateFrom)) return false;
  return !filters.dateTo || Boolean(date && date <= filters.dateTo);
}
