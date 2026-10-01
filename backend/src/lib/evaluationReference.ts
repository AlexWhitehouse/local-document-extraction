import { HttpError } from "./http";

/** The Expected answer set of a Saved Evaluation document, stored exactly as validated. */
export type ExpectedAnswerSet = {
  version: 1;
  definitions: Record<string, ReferenceDefinition>;
  references: Record<string, ExpectedAnswer>;
};

type ScalarType = "string" | "number" | "boolean" | "date";
type TableColumn = { key: string; heading: string; data_type: ScalarType; description?: string };

export type ReferenceDefinition = {
  id?: string;
  name: string;
  data_type: ScalarType | "array<object>" | "object" | "array";
  description?: string;
  object_schema?: { mode: "table"; columns: TableColumn[] };
};

export type ExpectedAnswer = {
  verified: boolean;
  absent?: boolean;
  exact?: boolean;
  value?: unknown;
  rows?: { mode: string; key?: string } | null;
  cellStates?: Array<Record<string, "absent" | "ignored">>;
};

export type ReferenceFieldSummary = { identity: string; name: string; data_type: ReferenceDefinition["data_type"]; verified: boolean };

export const MAX_REFERENCE_BYTES = 1024 * 1024;
export const MAX_REFERENCE_DEFINITIONS = 500;
const MAX_TABLE_COLUMNS = 20;
const SCALAR_TYPES: readonly string[] = ["string", "number", "boolean", "date"];
const DATA_TYPES: readonly string[] = [...SCALAR_TYPES, "array<object>", "object", "array"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export const fieldIdentity = (field: { name: string; data_type: string }) => `${field.name.trim().toLocaleLowerCase()}:${field.data_type}`;

const text = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
type Scalar = { valid: false } | { valid: true; value: string | number | boolean };
const invalidScalar: Scalar = { valid: false };

/** A port of the browser scorer's `scalarValue`; both sides must accept exactly the same values. */
export function scalarValue(value: unknown, type: string, exact = false): Scalar {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return invalidScalar;
  if (type === "string") return typeof value === "string" ? { valid: true, value: exact ? value : text(value) } : invalidScalar;
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? { valid: true, value } : invalidScalar;
    if (typeof value !== "string") return invalidScalar;
    const cleaned = value.trim().replace(/^[£$€]\s*/, "");
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned)) return invalidScalar;
    const number = Number(cleaned.replaceAll(",", ""));
    return Number.isFinite(number) ? { valid: true, value: number } : invalidScalar;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return { valid: true, value };
    if (typeof value === "string" && /^(true|false|yes|no)$/i.test(value.trim())) return { valid: true, value: /^(true|yes)$/i.test(value.trim()) };
    return invalidScalar;
  }
  if (type === "date" && typeof value === "string") {
    const source = value.trim();
    let year: number, month: number, day: number;
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    else {
      match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (match) {
        const a = Number(match[1]), b = Number(match[2]);
        if (a <= 12 && b <= 12 && a !== b) return invalidScalar;
        year = Number(match[3]); month = a > 12 ? b : a; day = a > 12 ? a : b;
      } else {
        match = source.toLowerCase().match(/^(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2})),?\s+(\d{4})$/);
        if (!match) return invalidScalar;
        day = Number(match[1] || match[4]); year = Number(match[5]);
        const name = match[2] || match[3];
        month = MONTHS.findIndex((m) => m === name || m.slice(0, 3) === name) + 1;
      }
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? { valid: true, value: date.toISOString().slice(0, 10) } : invalidScalar;
  }
  return invalidScalar;
}

const invalid = (message: string) => new HttpError(400, "invalid_reference", message);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw invalid(`${label} has an unsupported property: ${unknown}`);
}
const optionalString = (value: unknown) => value === undefined || typeof value === "string";
const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";

/**
 * Validates an Expected answer set without changing it. Verification is only ever carried over from
 * the input: nothing becomes verified here, and draft values of unverified answers are kept as drafts.
 */
export function parseExpectedAnswerSet(input: unknown): ExpectedAnswerSet {
  if (!isObject(input)) throw invalid("reference must be an object");
  onlyKeys(input, ["version", "definitions", "references"], "reference");
  if (input.version !== 1) throw invalid("reference version must be 1");
  const { definitions, references } = input;
  if (!isObject(definitions) || !isObject(references)) throw invalid("reference definitions and references must be objects");
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_REFERENCE_BYTES) {
    throw new HttpError(413, "reference_too_large", `Expected answers exceed ${MAX_REFERENCE_BYTES} bytes`);
  }
  const identities = Object.keys(definitions);
  if (identities.length > MAX_REFERENCE_DEFINITIONS) throw invalid(`reference may define at most ${MAX_REFERENCE_DEFINITIONS} fields`);
  for (const identity of identities) validateDefinition(identity, definitions[identity]);
  for (const [identity, answer] of Object.entries(references)) {
    const definition = definitions[identity] as ReferenceDefinition | undefined;
    if (!Object.hasOwn(definitions, identity) || !definition) throw invalid(`Expected answer ${identity} has no field definition`);
    validateAnswer(identity, definition, answer);
  }
  return input as ExpectedAnswerSet;
}

function validateDefinition(identity: string, value: unknown): void {
  const label = `Field ${identity}`;
  if (!isObject(value)) throw invalid(`${label} must be an object`);
  onlyKeys(value, ["id", "name", "data_type", "description", "object_schema"], label);
  if (typeof value.name !== "string" || !value.name.trim()) throw invalid(`${label} needs a name`);
  if (typeof value.data_type !== "string" || !DATA_TYPES.includes(value.data_type)) throw invalid(`${label} has an unsupported data type`);
  if (!optionalString(value.id) || !optionalString(value.description)) throw invalid(`${label} id and description must be strings`);
  if (fieldIdentity(value as ReferenceDefinition) !== identity) throw invalid(`${label} does not match its name and data type`);
  if (value.object_schema === undefined) return;
  const schema = value.object_schema;
  if (value.data_type !== "array<object>" || !isObject(schema)) throw invalid(`${label} may only describe a table schema for a table field`);
  onlyKeys(schema, ["mode", "columns"], `${label} table schema`);
  if (schema.mode !== "table" || !Array.isArray(schema.columns) || schema.columns.length < 1 || schema.columns.length > MAX_TABLE_COLUMNS) {
    throw invalid(`${label} tables need 1 to ${MAX_TABLE_COLUMNS} columns`);
  }
  const keys = new Set<string>();
  for (const column of schema.columns as unknown[]) {
    if (!isObject(column)) throw invalid(`${label} has an invalid column`);
    onlyKeys(column, ["key", "heading", "data_type", "description"], `${label} column`);
    if (typeof column.key !== "string" || !column.key || keys.has(column.key) || typeof column.heading !== "string"
      || typeof column.data_type !== "string" || !SCALAR_TYPES.includes(column.data_type) || !optionalString(column.description)) {
      throw invalid(`${label} columns need unique keys, headings and scalar data types`);
    }
    keys.add(column.key);
  }
}

function validateAnswer(identity: string, definition: ReferenceDefinition, value: unknown): void {
  const label = `Expected answer ${identity}`;
  if (!isObject(value)) throw invalid(`${label} must be an object`);
  onlyKeys(value, ["verified", "absent", "exact", "value", "rows", "cellStates"], label);
  if (typeof value.verified !== "boolean" || !optionalBoolean(value.absent) || !optionalBoolean(value.exact)) {
    throw invalid(`${label} verified, absent and exact must be booleans`);
  }
  // The browser keeps an unchosen `{ mode: "", key: "" }` draft; a verified table needs a real choice.
  const rows = value.rows;
  if (rows !== undefined && rows !== null && (!isObject(rows) || typeof rows.mode !== "string" || !optionalString(rows.key)
    || Object.keys(rows).some((key) => key !== "mode" && key !== "key"))) {
    throw invalid(`${label} has an invalid row-matching choice`);
  }
  const columns = definition.data_type === "array<object>" ? definition.object_schema?.columns ?? [] : [];
  if (value.cellStates !== undefined) {
    const states = value.cellStates;
    if (!columns.length || !Array.isArray(value.value) || !Array.isArray(states) || states.length !== value.value.length
      || states.some((record) => !isObject(record) || Object.entries(record).some(([key, state]) => !columns.some((column) => column.key === key) || !["absent", "ignored"].includes(state as string)))) {
      throw invalid(`${label} has invalid table cell statuses`);
    }
  }
  // Unverified answers are drafts: kept as entered, never scored and never promoted.
  if (!value.verified || value.absent) return;
  const answer = value as ExpectedAnswer;
  if (SCALAR_TYPES.includes(definition.data_type)) {
    if (!scalarValue(answer.value, definition.data_type, answer.exact).valid) throw invalid(`${label} is not a valid ${definition.data_type} value`);
    return;
  }
  if (!columns.length) throw invalid(`${label} cannot be verified: this field is not automatically scored`);
  if (!Array.isArray(answer.value) || answer.value.some((row, index) => !isObject(row) || columns.some((column) => !answer.cellStates?.[index]?.[column.key] && !scalarValue(row[column.key], column.data_type).valid))) {
    throw invalid(`${label} must be the complete table with valid values for every declared column`);
  }
  if (!answer.rows || !["position", "key"].includes(answer.rows.mode)) throw invalid(`${label} needs a row-matching choice before it can be verified`);
  if (answer.rows.mode === "key") {
    const key = answer.rows.key;
    const column = columns.find((candidate) => candidate.key === key);
    if (!column) throw invalid(`${label} must identify rows with one of its columns`);
    if (answer.cellStates?.some((states) => states[column.key])) throw invalid(`${label} row identifiers must have an expected value`);
    const keys = (answer.value as Array<Record<string, unknown>>).map((row) => {
      const parsed = scalarValue(row[column.key], column.data_type);
      return parsed.valid ? parsed.value : null;
    });
    if (new Set(keys).size !== keys.length) throw invalid(`${label} row identifiers must be unique`);
  }
}

/** Field progress shown in library listings, without any values. */
export function referenceFields(set: ExpectedAnswerSet): ReferenceFieldSummary[] {
  return Object.entries(set.definitions).map(([identity, definition]) => ({
    identity,
    name: definition.name,
    data_type: definition.data_type,
    verified: set.references[identity]?.verified === true,
  }));
}
