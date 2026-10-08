import type { SQLQueryBindings, Database } from "bun:sqlite";

export type DocumentListQuery = {
  cursor?: { createdAt: string; jobId: string } | null;
  dateFrom?: string;
  dateTo?: string;
  model?: string;
  search?: string;
  limit: number;
};

const JOB_STATUSES = ["queued", "processing", "completed", "failed", "awaiting_template"];

const PACKET_STATUSES = [
  "queued",
  "processing",
  "awaiting_review",
  "materializing",
  "processing_children",
  "completed",
  "failed",
];

/** A trigram prefilter for a literal search. The literal LIKE remains authoritative. */
export type SearchCandidates =
  | { kind: "none" }
  | { kind: "rows"; rowids: number[] }
  // The index cannot narrow this search; read in date order with the literal match only.
  | { kind: "unbounded" };

const MAX_SEARCH_CANDIDATES = 1000;

/**
 * Narrow a literal substring search with a trigram index of stable metadata. Status terms
 * use the literal path so lifecycle transitions do not rewrite the index. Searches too short
 * for trigrams, or containing NUL, use only the literal path, as do broad terms, which should
 * read a page in date order rather than materialize and sort a huge list of row IDs.
 */
export function searchCandidates(
  database: Database,
  index: "job_search" | "packet_search",
  search: string,
): SearchCandidates {
  const statuses = index === "job_search" ? JOB_STATUSES : PACKET_STATUSES;

  if ([...search].length < 3 || search.includes("\u0000") || statuses.some((status) => status.includes(search)))
    return { kind: "unbounded" };

  const rowids = database
    .query<{ rowid: number }, SQLQueryBindings[]>(
      `SELECT rowid FROM ${index} WHERE ${index} MATCH ? LIMIT ${MAX_SEARCH_CANDIDATES + 1}`,
    )
    .all(`"${search.replaceAll('"', '""')}"`)
    .map((row) => row.rowid);

  if (!rowids.length) return { kind: "none" };

  return rowids.length <= MAX_SEARCH_CANDIDATES ? { kind: "rows", rowids } : { kind: "unbounded" };
}

type Condition = { sql: string; parameters: Array<string | number> };

/** Page upload entries before hydrating them; packet children never consume a slot. */
export function listDocumentEntries(database: Database, input: DocumentListQuery) {
  const search = (input.search || "").trim().toLowerCase();
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;

  const conditions = (alias: "j" | "p", candidates: SearchCandidates | null): Condition => {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (search && candidates) {
      if (candidates.kind === "none") clauses.push("0");
      else if (candidates.kind === "rows") {
        clauses.push(`${alias}.rowid IN (SELECT value FROM json_each(?))`);
        parameters.push(JSON.stringify(candidates.rowids));
      }

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

  const jobs = conditions("j", search ? searchCandidates(database, "job_search", search) : null),
    packets = conditions("p", search ? searchCandidates(database, "packet_search", search) : null);

  const jobBoundary = boundary("j", "document:", input.cursor),
    packetBoundary = boundary("p", "packet:", input.cursor);

  const filtered = Boolean(search || input.dateFrom || input.dateTo || input.model);

  // A packet matches by its own metadata or through any child Document. Collect matching
  // packet IDs first so indexed candidate lookups drive the query, not a scan of every packet.
  const packetMatch: Condition = filtered
    ? {
        sql: `p.id IN (SELECT p.id FROM document_packets p WHERE ${packets.sql}
          UNION SELECT r.parent_packet_id FROM jobs j JOIN document_routing r ON r.job_id = j.id
          WHERE r.parent_packet_id IS NOT NULL AND ${jobs.sql})`,
        parameters: [...packets.parameters, ...jobs.parameters],
      }
    : { sql: "1", parameters: [] };

  // Bound each ordered source before combining them, including for workspaces
  // with a long history of packets that have no children yet.
  return database
    .query<{ kind: "document" | "packet"; id: string; created_at: string; entry_id: string }, SQLQueryBindings[]>(
      `WITH standalone AS (
      SELECT 'document' AS kind, j.id, j.created_at, 'document:' || j.id AS entry_id
      FROM jobs j LEFT JOIN document_routing r ON r.job_id = j.id
      WHERE r.parent_packet_id IS NULL AND ${jobs.sql} AND ${jobBoundary.sql}
      ORDER BY j.created_at DESC, j.id DESC LIMIT ?
    ), packets AS (
      SELECT 'packet' AS kind, p.id, p.created_at, 'packet:' || p.id AS entry_id
      FROM document_packets p WHERE ${packetMatch.sql} AND ${packetBoundary.sql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?
    ) SELECT * FROM standalone UNION ALL SELECT * FROM packets
    ORDER BY created_at DESC, entry_id DESC LIMIT ?`,
    )
    .all(
      ...jobs.parameters,
      ...jobBoundary.parameters,
      input.limit,
      ...packetMatch.parameters,
      ...packetBoundary.parameters,
      input.limit,
      input.limit,
    );
}

/**
 * Entries are ordered by (created_at, entry_id) where entry_id is `<kind>:<id>`. Resolve the
 * cursor's entry_id against one kind's prefix so the boundary compares the indexed columns
 * directly: `created_at < ? OR (created_at = ? AND id < ?)`, with a leading `created_at <= ?`
 * range term that lets the (created_at, id) index start at the cursor.
 */
function boundary(
  alias: "j" | "p",
  prefix: "document:" | "packet:",
  cursor: DocumentListQuery["cursor"],
): Condition {
  if (!cursor) return { sql: "1", parameters: [] };

  if (cursor.jobId.startsWith(prefix)) {
    return {
      sql: `${alias}.created_at <= ? AND (${alias}.created_at < ? OR ${alias}.id < ?)`,
      parameters: [cursor.createdAt, cursor.createdAt, cursor.jobId.slice(prefix.length)],
    };
  }

  // Every entry of this kind sorts after a smaller cursor key and before a larger one at the
  // same timestamp. Both strings are compared from an ASCII prefix, where UTF-16 and SQLite's
  // binary UTF-8 ordering agree.
  return cursor.jobId < prefix
    ? { sql: `${alias}.created_at < ?`, parameters: [cursor.createdAt] }
    : { sql: `${alias}.created_at <= ?`, parameters: [cursor.createdAt] };
}
