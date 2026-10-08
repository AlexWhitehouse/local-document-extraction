/** The lifecycle outcome of one packet child, as seen by packet completion. */
export type PacketChildOutcome = {
  status: string;
  /** A deleted child, or one whose Extraction job no longer exists, never blocks or fails its packet. */
  deleted: boolean;
};

/**
 * The single rule for finishing a Document packet whose children are being extracted.
 * Returns null while any remaining child is unfinished; otherwise the packet fails when a
 * remaining child failed and completes when none did, including when every child was deleted.
 */
export function finishedPacketStatus(children: Iterable<PacketChildOutcome>): "completed" | "failed" | null {
  let failed = false;

  for (const child of children) {
    if (child.deleted) continue;

    if (child.status === "failed") failed = true;
    else if (child.status !== "completed") return null;
  }

  return failed ? "failed" : "completed";
}
