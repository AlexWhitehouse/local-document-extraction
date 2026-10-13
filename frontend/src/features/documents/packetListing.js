export const PACKET_STATUS_LABELS = {
  queued: "Queued for splitting",
  processing: "Finding documents",
  awaiting_review: "Review needed",
  materializing: "Preparing documents",
  processing_children: "Extracting",
  completed: "Completed",
  failed: "Failed",
};

function hasSingleDocumentPlan(packet) {
  return (
    packet?.plan?.groups?.length === 1 &&
    (packet.plan_accepted === true || ["processing_children", "completed"].includes(packet.status))
  );
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

/**
 * The IDs behind the Documents list's rows: documents of their own and packets. A packet's
 * documents are covered by its row.
 */
export function listedEntryIds(packets, documents) {
  const childIds = new Set(
    packets.flatMap((packet) => (Array.isArray(packet.children) ? packet.children : []).map((child) => child.job_id)),
  );

  return {
    documentIds: documents.flatMap((job) => (job.parent_packet_id || childIds.has(job.job_id) ? [] : [job.job_id])),
    packetIds: packets.map((packet) => packet.packet_id),
  };
}
