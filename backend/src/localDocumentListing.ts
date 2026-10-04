import type { SQLQueryBindings, Database } from "bun:sqlite";

export type DocumentListQuery = {
  cursor?: { createdAt: string; jobId: string } | null;
  dateFrom?: string;
  dateTo?: string;
  model?: string;
  search?: string;
  limit: number;
};

/** Page upload entries before hydrating them; packet children never consume a slot. */
export function listDocumentEntries(database: Database, input: DocumentListQuery) {
  const pattern = `%${(input.search || "")
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/g, "\\$&")}%`;

  const conditions = (alias: "j" | "p") => {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (input.search) {
      const fields = alias === "j" ? ["id", "source_name", "template_id", "status"] : ["id", "source_name", "status"];
      clauses.push(
        `(${fields.map((field) => `LOWER(COALESCE(${alias}.${field}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`,
      );
      parameters.push(...fields.map(() => pattern));
    }

    if (input.dateFrom) {
      clauses.push(`${alias}.created_at >= ?`);
      parameters.push(`${input.dateFrom}T00:00:00.000Z`);
    }

    if (input.dateTo) {
      clauses.push(`${alias}.created_at <= ?`);
      parameters.push(`${input.dateTo}T23:59:59.999Z`);
    }

    if (input.model) {
      clauses.push(alias === "j" ? "j.model_name = ?" : "0");

      if (alias === "j") parameters.push(input.model);
    }

    return { sql: clauses.join(" AND ") || "1", parameters };
  };

  const jobs = conditions("j"),
    packets = conditions("p");

  const boundary = (alias: "j" | "p", kind: string) =>
    input.cursor
      ? {
          sql: ` AND (${alias}.created_at, '${kind}:' || ${alias}.id) < (?, ?)`,
          parameters: [input.cursor.createdAt, input.cursor.jobId],
        }
      : { sql: "", parameters: [] };

  const jobBoundary = boundary("j", "document"),
    packetBoundary = boundary("p", "packet");

  const filtered = Boolean(input.search || input.dateFrom || input.dateTo || input.model);

  const packetMatch = filtered
    ? `(${packets.sql}) OR EXISTS (SELECT 1 FROM document_routing r JOIN jobs j ON j.id = r.job_id
        WHERE r.parent_packet_id = p.id AND ${jobs.sql})`
    : "1";

  // Bound each ordered source before combining them, including for workspaces
  // with a long history of packets that have no children yet.
  return database
    .query<{ kind: "document" | "packet"; id: string; created_at: string; entry_id: string }, SQLQueryBindings[]>(
      `WITH standalone AS (
      SELECT 'document' AS kind, j.id, j.created_at, 'document:' || j.id AS entry_id
      FROM jobs j LEFT JOIN document_routing r ON r.job_id = j.id
      WHERE r.parent_packet_id IS NULL AND ${jobs.sql}${jobBoundary.sql}
      ORDER BY j.created_at DESC, j.id DESC LIMIT ?
    ), packets AS (
      SELECT 'packet' AS kind, p.id, p.created_at, 'packet:' || p.id AS entry_id
      FROM document_packets p WHERE (${packetMatch})${packetBoundary.sql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?
    ) SELECT * FROM standalone UNION ALL SELECT * FROM packets
    ORDER BY created_at DESC, entry_id DESC LIMIT ?`,
    )
    .all(
      ...jobs.parameters,
      ...jobBoundary.parameters,
      input.limit,
      ...(filtered ? [...packets.parameters, ...jobs.parameters] : []),
      ...packetBoundary.parameters,
      input.limit,
      input.limit,
    );
}
