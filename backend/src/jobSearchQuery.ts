import type { Database, SQLQueryBindings } from "bun:sqlite";

import {
  conditionLeaves,
  findCatalogField,
  groupMembers,
  isConditionGroup,
  isCostTerm,
  isFieldCondition,
  normalizeSearchText,
  type CostCondition,
  searchValueType,
  type DocumentSearchFilter,
  type FieldCondition,
  type SearchCatalog,
  type SearchCondition,
  type SearchJobStatus,
  type SearchValueState,
  type SearchValueType,
} from "../../shared/documentSearch";

/** The value of a field a condition or the plain words used. */
export type FieldSearchMatch = {
  template_id: string;
  field_id: string;
  field_name: string;
  type: SearchValueType;
  value_state: SearchValueState;
  display: string | null;
};

/**
 * The document's processing cost, listed when the filter uses `cost`. `amount` is null when calls
 * occurred but none reported a cost; `complete` is false when some calls didn't report one.
 */
export type CostSearchMatch = {
  kind: "cost";
  amount: number | null;
  currency: "USD";
  complete: boolean;
  /** As the Costs page shows it, with "+" for a known subtotal; null when no amount was reported. */
  display: string | null;
};

export type SearchMatch = FieldSearchMatch | CostSearchMatch;

export type JobSearchCursor = { createdAt: string; jobId: string };

export type JobSearchInput = {
  /** A filter already checked against `catalog`, so every condition names a current, scalar field. */
  filter: DocumentSearchFilter;
  catalog: Pick<SearchCatalog, "templates">;
  cursor: JobSearchCursor | null;
  limit: number;
  countCap: number;
  /** Per-job matched fields and Template names; ID-only reads skip them. */
  withMatches: boolean;
};

export type JobSearchHit = {
  job_id: string;
  status: SearchJobStatus;
  created_at: string;
  template_id: string | null;
  template_name: string | null;
  matches: FieldSearchMatch[];
};

export type JobSearchResult = { jobs: JobSearchHit[]; total: number; total_capped: boolean; has_more: boolean };

type Clause = { sql: string; parameters: SQLQueryBindings[] };

type ResolvedCondition = FieldCondition & { data_type: string; field_name: string; type: SearchValueType };

const VALUE = "v.value_state = 'value'";

/** Above every valid UTF-8 continuation, so `[prefix, prefix + MAX)` bounds every string starting with prefix. */
const MAX_CHARACTER = "\u{10FFFF}";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function ftsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Trigram matching needs three characters; shorter terms use the literal check alone. */
function usesTrigrams(term: string): boolean {
  return [...term].length >= 3;
}

function resolveCondition(condition: FieldCondition, catalog: JobSearchInput["catalog"]): ResolvedCondition {
  const match = findCatalogField(catalog, condition.template_id, condition.field_id);
  const type = match && searchValueType(match.field.data_type);

  if (!match || !type) throw new Error("Search conditions must be checked against the catalogue first");

  return { ...condition, data_type: match.field.data_type, field_name: match.field.name, type };
}

/** The predicate on one `job_field_values v` row of a compatible field. */
function valuePredicate(condition: ResolvedCondition): Clause {
  const { op } = condition;

  switch (op) {
    case "has_value":
      return { sql: VALUE, parameters: [] };
    case "not_found":
      return { sql: "v.value_state = 'missing'", parameters: [] };
    case "invalid":
      return { sql: "v.value_state = 'invalid'", parameters: [] };
    case "empty":
      return { sql: "v.value_state = 'empty'", parameters: [] };
    case "is_true":
    case "is_false":
      return { sql: `${VALUE} AND v.bool_value = ?`, parameters: [op === "is_true" ? 1 : 0] };
    default:
      break;
  }

  if (condition.type === "text") {
    const text = normalizeSearchText(String(condition.value));

    switch (op) {
      case "contains":
        return { sql: `${VALUE} AND v.text_norm LIKE ? ESCAPE '\\'`, parameters: [`%${escapeLike(text)}%`] };
      case "starts_with":
        return {
          sql: `${VALUE} AND v.text_norm >= ? AND v.text_norm < ? AND v.text_norm LIKE ? ESCAPE '\\'`,
          parameters: [text, `${text}${MAX_CHARACTER}`, `${escapeLike(text)}%`],
        };
      case "ends_with":
        return { sql: `${VALUE} AND v.text_norm LIKE ? ESCAPE '\\'`, parameters: [`%${escapeLike(text)}`] };
      case "is":
        return { sql: `${VALUE} AND v.text_norm = ?`, parameters: [text] };
      case "is_not":
        return { sql: `${VALUE} AND v.text_norm <> ?`, parameters: [text] };
      default:
        throw new Error(`Unsupported text operator ${op}`);
    }
  }

  const column = condition.type === "number" ? "v.num_value" : "v.date_value";
  const value = condition.value ?? null;

  switch (op) {
    case "eq":
      return { sql: `${VALUE} AND ${column} = ?`, parameters: [value] };
    case "gt":
      return { sql: `${VALUE} AND ${column} > ?`, parameters: [value] };
    case "gte":
      return { sql: `${VALUE} AND ${column} >= ?`, parameters: [value] };
    case "lt":
      return { sql: `${VALUE} AND ${column} < ?`, parameters: [value] };
    case "lte":
      return { sql: `${VALUE} AND ${column} <= ?`, parameters: [value] };
    case "between":
      return { sql: `${VALUE} AND ${column} >= ? AND ${column} <= ?`, parameters: [value, condition.value2 ?? null] };
    default:
      throw new Error(`Unsupported ${condition.type} operator ${op}`);
  }
}

/**
 * A condition matches only jobs of its Template whose stored value has the field's current data
 * type. `not_found` also matches completed jobs that have no value for the field, unless their
 * Template version defined the field with another type.
 */
function conditionClause(condition: ResolvedCondition): Clause {
  const predicate = valuePredicate(condition);

  const stored: Clause = {
    sql: `j.id IN (SELECT v.job_id FROM job_field_values v
      WHERE v.template_id = ? AND v.field_id = ? AND v.data_type = ? AND ${predicate.sql})`,
    parameters: [condition.template_id, condition.field_id, condition.data_type, ...predicate.parameters],
  };

  if (condition.op !== "not_found") {
    return { sql: `j.template_id = ? AND ${stored.sql}`, parameters: [condition.template_id, ...stored.parameters] };
  }

  return {
    sql: `j.template_id = ? AND (${stored.sql} OR (j.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM job_field_values v WHERE v.job_id = j.id AND v.field_id = ?)
      AND NOT EXISTS (SELECT 1 FROM template_fields f
        WHERE f.template_id = j.template_id AND f.version = j.template_version AND f.field_id = ? AND f.data_type <> ?)))`,
    parameters: [
      condition.template_id,
      ...stored.parameters,
      condition.field_id,
      condition.field_id,
      condition.data_type,
    ],
  };
}

/**
 * Plain words match the document name, the job ID or any extracted text value, literally. Terms of
 * one or two characters match only the name and ID: the trigram index can't narrow them, and a
 * literal scan of every stored value would grow with the whole Workspace.
 * Name matching folds ASCII case only (SQLite `LOWER`), as `GET /v1/jobs` does.
 */
function textClause(term: string): Clause {
  const pattern = `%${escapeLike(term)}%`;
  const literal = "(LOWER(COALESCE(j.source_name, '')) LIKE ? ESCAPE '\\' OR LOWER(j.id) LIKE ? ESCAPE '\\')";

  if (!usesTrigrams(term)) return { sql: literal, parameters: [pattern, pattern] };

  return {
    sql: `((j.rowid IN (SELECT rowid FROM job_search WHERE job_search MATCH ?) AND ${literal})
      OR j.id IN (SELECT v.job_id FROM job_field_values v WHERE v.rowid IN
        (SELECT rowid FROM job_field_value_search WHERE job_field_value_search MATCH ?) AND v.text_norm LIKE ? ESCAPE '\\'))`,
    parameters: [ftsPhrase(term), pattern, pattern, ftsPhrase(term), pattern],
  };
}

/**
 * A share of the packet's split, by the rule in `documentCosts` (localModelCosts.ts) and `allocateCost`:
 * split × (document pages / packet pages), unrounded. Only a document with a packet lineage has one.
 */
const SPLIT_SHARE = `(SELECT COALESCE((SELECT SUM(c.amount) FROM model_call_costs c WHERE c.owner_id = p.id AND c.stage = 'split'), 0)
    * (CAST(json_array_length(r.source_pages) AS REAL) / json_array_length(p.selected_pages))
  FROM document_routing r JOIN document_packets p ON p.id = r.parent_packet_id WHERE r.job_id = j.id)`;

const HAS_LINEAGE = `EXISTS (SELECT 1 FROM document_routing r JOIN document_packets p ON p.id = r.parent_packet_id
  WHERE r.job_id = j.id)`;

const ownedStage = (stage: string) =>
  `COALESCE((SELECT SUM(c.amount) FROM model_call_costs c WHERE c.owner_id = j.id AND c.stage = '${stage}'), 0)`;

/**
 * The document's total reported cost in USD, as `documentCosts` and the Costs page compute it: per-stage
 * sums of reported amounts (unreported calls add nothing), the split replaced by the packet share when
 * the document came from a packet, then added in stage order. It is rounded to 10 decimal places so
 * floating-point noise from summing (0.01 + 0.02) can't decide a comparison with a typed amount.
 */
const DOCUMENT_COST = `ROUND(0.0
  + CASE WHEN ${HAS_LINEAGE} THEN COALESCE(${SPLIT_SHARE}, 0) ELSE ${ownedStage("split")} END
  + ${ownedStage("auto_template")}
  + ${ownedStage("extraction")}, 10)`;

function costClause(cost: CostCondition): Clause {
  switch (cost.op) {
    case "eq":
      return { sql: `${DOCUMENT_COST} = ?`, parameters: [cost.value] };
    case "gt":
      return { sql: `${DOCUMENT_COST} > ?`, parameters: [cost.value] };
    case "gte":
      return { sql: `${DOCUMENT_COST} >= ?`, parameters: [cost.value] };
    case "lt":
      return { sql: `${DOCUMENT_COST} < ?`, parameters: [cost.value] };
    case "lte":
      return { sql: `${DOCUMENT_COST} <= ?`, parameters: [cost.value] };
    case "between":
      return { sql: `${DOCUMENT_COST} BETWEEN ? AND ?`, parameters: [cost.value, cost.value2 ?? cost.value] };
  }
}

/** One member of the filter's conditions; groups become a bracketed AND or OR of their members. */
function searchConditionClause(condition: SearchCondition, catalog: JobSearchInput["catalog"]): Clause {
  if (isCostTerm(condition)) return costClause(condition.cost);

  if (!isConditionGroup(condition)) return conditionClause(resolveCondition(condition, catalog));
  const { any, members } = groupMembers(condition);
  const clauses = members.map((member) => searchConditionClause(member, catalog));

  return {
    sql: clauses.map((clause) => `(${clause.sql})`).join(any ? " OR " : " AND "),
    parameters: clauses.flatMap((clause) => clause.parameters),
  };
}

/** Whether a condition computes the per-document cost, which is the slowest predicate. */
function computesCost(condition: SearchCondition): boolean {
  return conditionLeaves([condition]).some(isCostTerm);
}

function filterClauses(filter: DocumentSearchFilter, catalog: JobSearchInput["catalog"]): Clause[] {
  const clauses: Clause[] = [];

  if (filter.text) clauses.push(textClause(normalizeSearchText(filter.text)));

  if (filter.statuses?.length)
    clauses.push({ sql: "j.status IN (SELECT value FROM json_each(?))", parameters: [JSON.stringify(filter.statuses)] });

  if (filter.template_ids?.length)
    clauses.push({
      sql: "j.template_id IN (SELECT value FROM json_each(?))",
      parameters: [JSON.stringify(filter.template_ids)],
    });

  if (filter.uploaded_from)
    clauses.push({ sql: "j.created_at >= ?", parameters: [`${filter.uploaded_from}T00:00:00.000Z`] });

  if (filter.uploaded_to) clauses.push({ sql: "j.created_at <= ?", parameters: [`${filter.uploaded_to}T23:59:59.999Z`] });

  if (filter.model) clauses.push({ sql: "j.model_name = ?", parameters: [filter.model] });

  // Conditions that compute the cost go last, so the cheaper members narrow the rows first.
  const conditions = filter.conditions ?? [];

  for (const condition of conditions.filter((member) => !computesCost(member)))
    clauses.push(searchConditionClause(condition, catalog));

  for (const condition of conditions.filter(computesCost)) clauses.push(searchConditionClause(condition, catalog));

  return clauses;
}

function combine(clauses: Clause[]): Clause {
  return {
    sql: clauses.length ? ` WHERE ${clauses.map((clause) => `(${clause.sql})`).join(" AND ")}` : "",
    parameters: clauses.flatMap((clause) => clause.parameters),
  };
}

type PageRow = { job_id: string; status: SearchJobStatus; created_at: string; template_id: string | null };

type StoredMatchRow = {
  job_id: string;
  template_id: string;
  field_id: string;
  field_name: string;
  data_type: string;
  value_state: SearchValueState;
  text_value: string | null;
  num_value: number | null;
  date_value: string | null;
  bool_value: number | null;
};

function display(row: StoredMatchRow): string | null {
  if (row.value_state !== "value") return null;

  if (row.text_value !== null) return row.text_value;

  if (row.num_value !== null) return String(row.num_value);

  if (row.date_value !== null) return row.date_value;

  return row.bool_value === null ? null : String(row.bool_value === 1);
}

const MATCH_COLUMNS = `v.job_id, v.template_id, v.field_id, v.field_name, v.data_type, v.value_state,
  v.text_value, v.num_value, v.date_value, v.bool_value`;

function readMatches(
  database: Database,
  page: PageRow[],
  conditions: ResolvedCondition[],
  term: string | null,
): Map<string, FieldSearchMatch[]> {
  const jobIds = JSON.stringify(page.map((job) => job.job_id));
  const matches = new Map<string, FieldSearchMatch[]>(page.map((job) => [job.job_id, []]));
  const fields = new Map<string, ResolvedCondition>();

  for (const condition of conditions) fields.set(`${condition.template_id}\u0000${condition.field_id}`, condition);

  if (fields.size) {
    const stored = new Map<string, StoredMatchRow>();

    const rows = database
      .query<StoredMatchRow, SQLQueryBindings[]>(
        `SELECT ${MATCH_COLUMNS} FROM job_field_values v
         WHERE v.job_id IN (SELECT value FROM json_each(?)) AND v.field_id IN (SELECT value FROM json_each(?))`,
      )
      .all(jobIds, JSON.stringify([...new Set(conditions.map((condition) => condition.field_id))]));

    for (const row of rows) stored.set(`${row.job_id}\u0000${row.field_id}`, row);

    for (const job of page) {
      for (const field of fields.values()) {
        if (job.template_id !== field.template_id) continue;
        const row = stored.get(`${job.job_id}\u0000${field.field_id}`);
        const compatible = row && row.template_id === field.template_id && row.data_type === field.data_type;

        matches.get(job.job_id)!.push({
          template_id: field.template_id,
          field_id: field.field_id,
          field_name: field.field_name,
          type: field.type,
          value_state: compatible ? row.value_state : "missing",
          display: compatible ? display(row) : null,
        });
      }
    }
  }

  if (term) {
    const rows = database
      .query<StoredMatchRow, SQLQueryBindings[]>(
        `SELECT ${MATCH_COLUMNS} FROM job_field_values v
         LEFT JOIN template_fields f ON f.template_id = v.template_id AND f.version = v.template_version AND f.field_id = v.field_id
         WHERE v.job_id IN (SELECT value FROM json_each(?)) AND v.text_norm LIKE ? ESCAPE '\\'
         ORDER BY v.job_id, f.position, v.field_id`,
      )
      .all(jobIds, `%${escapeLike(term)}%`);

    const matched = new Set<string>();

    // Rows arrive in field order, so the first row per job is its first matching text field.
    for (const row of rows) {
      if (matched.has(row.job_id)) continue;
      matched.add(row.job_id);
      const list = matches.get(row.job_id)!;

      if (list.some((match) => match.template_id === row.template_id && match.field_id === row.field_id)) continue;
      list.push({
        template_id: row.template_id,
        field_id: row.field_id,
        field_name: row.field_name,
        type: "text",
        value_state: row.value_state,
        display: display(row),
      });
    }
  }

  return matches;
}

/**
 * One page of jobs matching every member of the filter, newest first, with a capped total.
 * Conditions and plain words are answered from the field value index; result payloads are never read.
 */
export function searchJobs(database: Database, input: JobSearchInput): JobSearchResult {
  const conditions = conditionLeaves(input.filter.conditions)
    .filter(isFieldCondition)
    .map((condition) => resolveCondition(condition, input.catalog));

  const clauses = filterClauses(input.filter, input.catalog);
  const filtered = combine(clauses);

  const { count } = database
    .query<{ count: number }, SQLQueryBindings[]>(
      `SELECT COUNT(*) AS count FROM (SELECT 1 FROM jobs j${filtered.sql} LIMIT ?)`,
    )
    .get(...filtered.parameters, input.countCap + 1)!;

  const paged = combine([
    ...clauses,
    ...(input.cursor
      ? [{ sql: "(j.created_at, j.id) < (?, ?)", parameters: [input.cursor.createdAt, input.cursor.jobId] }]
      : []),
  ]);

  const rows = database
    .query<PageRow, SQLQueryBindings[]>(
      `SELECT j.id AS job_id, j.status, j.created_at, j.template_id FROM jobs j${paged.sql}
       ORDER BY j.created_at DESC, j.id DESC LIMIT ?`,
    )
    .all(...paged.parameters, input.limit + 1);

  const page = rows.slice(0, input.limit);
  const text = input.filter.text ? normalizeSearchText(input.filter.text) : null;
  // Short terms never match values, so there is no matching field to report.
  const term = text && usesTrigrams(text) ? text : null;
  const matches = input.withMatches ? readMatches(database, page, conditions, term) : new Map<string, FieldSearchMatch[]>();
  const names = new Map<string, string>();

  if (input.withMatches) {
    const templateIds = [...new Set(page.flatMap((job) => (job.template_id ? [job.template_id] : [])))];

    for (const template of database
      .query<{ id: string; name: string }, SQLQueryBindings[]>(
        "SELECT id, name FROM templates WHERE id IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(templateIds)))
      names.set(template.id, template.name);
  }

  return {
    jobs: page.map((job) => ({
      ...job,
      template_name: job.template_id ? (names.get(job.template_id) ?? null) : null,
      matches: matches.get(job.job_id) ?? [],
    })),
    total: Math.min(count, input.countCap),
    total_capped: count > input.countCap,
    has_more: rows.length > input.limit,
  };
}
