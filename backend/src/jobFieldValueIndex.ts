import type { Database, SQLQueryBindings } from "bun:sqlite";

import {
  dayMonthYearToIso,
  normalizeSearchText,
  searchValueType,
  type SearchCatalog,
  type SearchCatalogTemplate,
  type SearchValueState,
} from "../../shared/documentSearch";

/**
 * One searchable scalar result per completed job and field, typed by the field's data type in the
 * job's own Template version. Tables, objects and arrays get no row.
 */
const JOB_FIELD_VALUE_SCHEMA = `
  CREATE TABLE job_field_values (
    job_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    field_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    value_state TEXT NOT NULL CHECK (value_state IN ('value', 'missing', 'invalid', 'empty')),
    text_value TEXT,
    text_norm TEXT,
    num_value REAL,
    date_value TEXT,
    bool_value INTEGER,
    PRIMARY KEY (job_id, field_id)
  );
  CREATE INDEX idx_job_field_values_state ON job_field_values(template_id, field_id, data_type, value_state);
  CREATE INDEX idx_job_field_values_number ON job_field_values(template_id, field_id, num_value);
  CREATE INDEX idx_job_field_values_date ON job_field_values(template_id, field_id, date_value);
  CREATE INDEX idx_job_field_values_text ON job_field_values(template_id, field_id, text_norm);
  CREATE INDEX idx_job_field_values_boolean ON job_field_values(template_id, field_id, bool_value);
  CREATE VIRTUAL TABLE job_field_value_search USING fts5(text_norm,
    content='job_field_values', content_rowid='rowid', tokenize='trigram');
  CREATE TRIGGER job_field_values_search_insert AFTER INSERT ON job_field_values BEGIN
    INSERT INTO job_field_value_search(rowid, text_norm) VALUES (new.rowid, new.text_norm);
  END;
  CREATE TRIGGER job_field_values_search_delete AFTER DELETE ON job_field_values BEGIN
    INSERT INTO job_field_value_search(job_field_value_search, rowid, text_norm) VALUES ('delete', old.rowid, old.text_norm);
  END;
  CREATE TRIGGER job_field_values_search_update AFTER UPDATE OF text_norm ON job_field_values
  WHEN old.text_norm IS NOT new.text_norm BEGIN
    INSERT INTO job_field_value_search(job_field_value_search, rowid, text_norm) VALUES ('delete', old.rowid, old.text_norm);
    INSERT INTO job_field_value_search(rowid, text_norm) VALUES (new.rowid, new.text_norm);
  END;
`;

export type IndexedFieldValue = {
  value_state: SearchValueState;
  text_value: string | null;
  text_norm: string | null;
  num_value: number | null;
  date_value: string | null;
  bool_value: number | null;
};

const NO_VALUE = { text_value: null, text_norm: null, num_value: null, date_value: null, bool_value: null };

/**
 * Maps a stored result to its indexed state and typed column. Returns null for types that are not
 * indexed. A value that can't be read as its type is `invalid`, never a zero, false or empty value.
 */
export function indexedFieldValue(
  dataType: string,
  status: string,
  normalizedValue: string | null,
): IndexedFieldValue | null {
  const type = searchValueType(dataType);

  if (!type) return null;

  if (status === "invalid_type" || status === "error") return { value_state: "invalid", ...NO_VALUE };

  if (status !== "ok" || normalizedValue === null) return { value_state: "missing", ...NO_VALUE };

  if (!normalizedValue.trim()) return { value_state: "empty", ...NO_VALUE };

  const invalid: IndexedFieldValue = { value_state: "invalid", ...NO_VALUE };

  if (type === "text") {
    return { ...NO_VALUE, value_state: "value", text_value: normalizedValue, text_norm: normalizeSearchText(normalizedValue) };
  }

  if (type === "number") {
    const number = Number(normalizedValue);

    return Number.isFinite(number) ? { ...NO_VALUE, value_state: "value", num_value: number } : invalid;
  }

  if (type === "date") {
    const iso = dayMonthYearToIso(normalizedValue);

    return iso ? { ...NO_VALUE, value_state: "value", date_value: iso } : invalid;
  }

  if (normalizedValue === "true" || normalizedValue === "false")
    return { ...NO_VALUE, value_state: "value", bool_value: normalizedValue === "true" ? 1 : 0 };

  return invalid;
}

type StoredResultRow = {
  job_id: string;
  template_id: string;
  template_version: number;
  field_id: string;
  field_name: string;
  data_type: string;
  status: string;
  normalized_value: string | null;
};

const STORED_RESULTS = `SELECT r.job_id, j.template_id, j.template_version, r.field_id, f.name AS field_name,
    f.data_type, r.status, r.normalized_value
  FROM job_results r
  JOIN jobs j ON j.id = r.job_id
  JOIN template_fields f ON f.template_id = j.template_id AND f.version = j.template_version AND f.field_id = r.field_id
  WHERE j.status = 'completed'`;

function insertIndexedRows(database: Database, rows: Iterable<StoredResultRow>): void {
  const insert = database.query(
    `INSERT OR REPLACE INTO job_field_values (job_id, template_id, template_version, field_id, field_name, data_type,
       value_state, text_value, text_norm, num_value, date_value, bool_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const row of rows) {
    const indexed = indexedFieldValue(row.data_type, row.status, row.normalized_value);

    if (!indexed) continue;
    insert.run(
      row.job_id,
      row.template_id,
      row.template_version,
      row.field_id,
      row.field_name,
      row.data_type,
      indexed.value_state,
      indexed.text_value,
      indexed.text_norm,
      indexed.num_value,
      indexed.date_value,
      indexed.bool_value,
    );
  }
}

/** Schema version 17: creates the index and backfills every completed job. */
export function migrateJobFieldValueIndex(database: Database): void {
  database.exec(JOB_FIELD_VALUE_SCHEMA);
  insertIndexedRows(database, database.query<StoredResultRow, SQLQueryBindings[]>(STORED_RESULTS).iterate());
}

/** Replaces a completed job's indexed values. Call inside the transaction that completes it. */
export function replaceJobFieldValues(database: Database, jobId: string): void {
  deleteJobFieldValues(database, jobId);
  insertIndexedRows(
    database,
    database.query<StoredResultRow, SQLQueryBindings[]>(`${STORED_RESULTS} AND r.job_id = ?`).all(jobId),
  );
}

export function deleteJobFieldValues(database: Database, jobId: string): void {
  database.query("DELETE FROM job_field_values WHERE job_id = ?").run(jobId);
}

const KNOWN_VALUES_PER_FIELD = 20;

const KNOWN_VALUE_CHARACTERS = 60;

const KNOWN_VALUES_TOTAL = 1_500;

/**
 * Known values are counted over the Workspace's most recent short text values, so building the
 * catalogue reads a bounded number of rows however many fields there are, and fields without
 * values cost nothing.
 */
const KNOWN_VALUE_SAMPLE = 25_000;

/** Active Templates with their current-version fields, without known values. */
export function readSearchFields(database: Database): SearchCatalogTemplate[] {
  const rows = database
    .query<
      {
        template_id: string;
        name: string;
        current_version: number;
        field_id: string | null;
        field_name: string | null;
        data_type: string | null;
      },
      SQLQueryBindings[]
    >(
      `SELECT t.id AS template_id, t.name, t.current_version, f.field_id, f.name AS field_name, f.data_type
       FROM templates t
       LEFT JOIN template_fields f ON f.template_id = t.id AND f.version = t.current_version
       WHERE t.status = 'active' AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC, t.id, f.position`,
    )
    .all();

  const templates = new Map<string, SearchCatalogTemplate>();

  for (const row of rows) {
    let template = templates.get(row.template_id);

    if (!template) {
      template = { id: row.template_id, name: row.name, current_version: row.current_version, fields: [] };
      templates.set(row.template_id, template);
    }

    if (row.field_id === null || row.field_name === null || row.data_type === null) continue;
    template.fields.push({
      field_id: row.field_id,
      name: row.field_name,
      data_type: row.data_type,
      type: searchValueType(row.data_type),
    });
  }

  return [...templates.values()];
}

/** Up to 20 frequent values per field, most frequent first, from one grouped read. */
function readKnownValues(database: Database): Map<string, string[]> {
  const rows = database
    .query<{ template_id: string; field_id: string; value: string }, SQLQueryBindings[]>(
      `WITH recent AS (
         SELECT template_id, field_id, text_norm, text_value FROM job_field_values
         WHERE data_type = 'string' AND value_state = 'value' AND length(text_value) <= ${KNOWN_VALUE_CHARACTERS}
         ORDER BY rowid DESC LIMIT ${KNOWN_VALUE_SAMPLE}
       ), counted AS (
         SELECT template_id, field_id, MIN(text_value) AS value, COUNT(*) AS uses
         FROM recent GROUP BY template_id, field_id, text_norm
       ), ranked AS (
         SELECT template_id, field_id, value,
           ROW_NUMBER() OVER (PARTITION BY template_id, field_id ORDER BY uses DESC, value) AS position
         FROM counted
       )
       SELECT template_id, field_id, value FROM ranked
       WHERE position <= ${KNOWN_VALUES_PER_FIELD} ORDER BY template_id, field_id, position`,
    )
    .all();

  const values = new Map<string, string[]>();

  for (const row of rows) {
    const key = `${row.template_id}\u0000${row.field_id}`;
    const list = values.get(key) ?? [];

    list.push(row.value);
    values.set(key, list);
  }

  return values;
}

/** Active Templates with their current-version fields and frequent short text values. */
export function readSearchCatalog(database: Database, models: string[]): Omit<SearchCatalog, "interpretation"> {
  const templates = readSearchFields(database);
  const known = readKnownValues(database);
  let remaining = KNOWN_VALUES_TOTAL;

  for (const template of templates) {
    for (const field of template.fields) {
      if (field.type !== "text" || field.data_type !== "string") continue;
      const values = (known.get(`${template.id}\u0000${field.field_id}`) ?? []).slice(0, remaining);

      remaining -= values.length;
      field.known_values = values;
    }
  }

  return { templates, models };
}
