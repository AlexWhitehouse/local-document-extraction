import { hydrateFieldFromTemplate } from "../templates/templateFields.js";

export const fieldIdentity = field => `${field.name.trim().toLocaleLowerCase()}:${field.data_type}`;
const text = value => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
const invalid = () => ({ valid: false });
export function scalarValue(value, type, exact = false) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return invalid();
  if (type === "string") return typeof value === "string" ? { valid: true, value: exact ? value : text(value) } : invalid();
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? { valid: true, value } : invalid();
    if (typeof value !== "string") return invalid();
    const cleaned = value.trim().replace(/^[£$€]\s*/, "");
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(cleaned)) return invalid();
    const number = Number(cleaned.replaceAll(",", ""));
    return Number.isFinite(number) ? { valid: true, value: number } : invalid();
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return { valid: true, value };
    if (typeof value === "string" && /^(true|false|yes|no)$/i.test(value.trim())) return { valid: true, value: /^(true|yes)$/i.test(value.trim()) };
    return invalid();
  }
  if (type === "date" && typeof value === "string") {
    const source = value.trim();
    let year, month, day;
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (match) {
        const a = Number(match[1]), b = Number(match[2]);
        if (a <= 12 && b <= 12 && a !== b) return invalid();
        year = Number(match[3]); month = a > 12 ? b : a; day = a > 12 ? a : b;
      } else {
        const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        match = source.toLowerCase().match(/^(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2})),?\s+(\d{4})$/);
        if (!match) return invalid();
        day = Number(match[1] || match[4]); year = Number(match[5]);
        const name = match[2] || match[3];
        month = months.findIndex(m => m === name || m.slice(0, 3) === name) + 1;
      }
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? { valid: true, value: date.toISOString().slice(0, 10) } : invalid();
  }
  return invalid();
}
// The gateway supports both row arrays and structured { columns, rows } answers.
// Preserve cell values so matching still validates their original types.
export function tableAnswerRows(answer) {
  const rows = Array.isArray(answer) ? answer : answer?.rows;
  return Array.isArray(rows) && rows.every(row => row && typeof row === "object" && !Array.isArray(row)) ? rows : null;
}
export function tableColumns(field) {
  return hydrateFieldFromTemplate(field).object_schema?.columns || [];
}
export function validateReference(field, reference) {
  if (reference.absent) return "";
  if (["string", "number", "boolean", "date"].includes(field.data_type)) return scalarValue(reference.value, field.data_type, reference.exact).valid ? "" : "Enter a valid, unambiguous value for this field type.";
  if (field.data_type !== "array<object>" || !tableColumns(field).length) return "This field is not automatically scored.";
  const columns = tableColumns(field);
  if (!Array.isArray(reference.value) || reference.value.some(row => !row || typeof row !== "object" || columns.some(c => !scalarValue(row[c.key], c.data_type).valid))) return "Provide the complete table with valid values for every declared column.";
  if (!["position", "key"].includes(reference.rows?.mode)) return "Choose how to match rows before verifying: use a unique column or row position.";
  if (reference.rows.mode === "key") {
    const column = columns.find(c => c.key === reference.rows.key);
    if (!column) return "Choose a column from this table to identify rows.";
    const keys = reference.value.map(row => scalarValue(row[column.key], column.data_type).value);
    if (new Set(keys).size !== keys.length) return "Row identifiers must be unique. Choose another column or compare by row position.";
  }
  return "";
}
export function scoreField(field, raw, reference, referenceField = field, options = {}) {
  if (["object", "array"].includes(field.data_type) || (field.data_type === "array<object>" && !tableColumns(field).length)) return { state: "Not automatically scored" };
  if (!reference?.verified || field.data_type !== referenceField.data_type) return { state: "Unscored" };
  const found = raw && ["ok", "found"].includes(raw.status);
  if (reference.absent) return { state: raw?.status === "not_found" ? "Match" : "Mismatch", matched: raw?.status === "not_found" ? 1 : 0, total: 1, kind: "field" };
  if (field.data_type === "array<object>") return scoreTable(field, found ? raw.answer : null, reference, referenceField, options.columns || {});
  const expected = scalarValue(reference.value, field.data_type, reference.exact);
  if (!expected.valid) return { state: "Needs review" };
  const actual = found ? scalarValue(raw.answer, field.data_type, reference.exact) : invalid();
  const matches = actual.valid && actual.value === expected.value;
  return { state: matches ? "Match" : "Mismatch", matched: matches ? 1 : 0, total: 1, kind: "field" };
}
function scoreTable(field, value, reference, referenceField, mappings) {
  const expectedColumns = tableColumns(referenceField), actualColumns = tableColumns(field);
  const pairs = expectedColumns.map(expected => [expected, actualColumns.find(c => c.data_type === expected.data_type && (mappings[expected.key] ? c.key === mappings[expected.key] : c.key === expected.key || c.heading.toLowerCase() === expected.heading.toLowerCase()))]);
  if (pairs.some(([, actual]) => !actual) || new Set(pairs.map(([, actual]) => actual.key)).size !== pairs.length) return { state: "Needs review", reason: "Align the table columns." };
  if (!reference.rows || !["position", "key"].includes(reference.rows.mode)) return { state: "Needs review", reason: "Choose a row identifier or row-position comparison." };
  const expectedRows = reference.value;
  if (!Array.isArray(expectedRows)) return { state: "Needs review", reason: "Verify the complete expected table." };
  const parsedRows = tableAnswerRows(value);
  const rows = parsedRows || [];
  const keyPair = pairs.find(([c]) => c.key === reference.rows.key);
  if (reference.rows.mode === "key" && !keyPair) return { state: "Needs review", reason: "Choose a compatible row identifier." };
  const keys = (list, actual) => list.map((row, index) => {
    if (reference.rows.mode === "position") return index;
    const column = keyPair[actual ? 1 : 0];
    const normalized = scalarValue(row?.[column.key], column.data_type);
    return normalized.valid ? normalized.value : null;
  });
  const expectedKeys = keys(expectedRows, false), actualKeys = keys(rows, true);
  if ([expectedKeys, actualKeys].some(list => list.includes(null) || new Set(list).size !== list.length)) return { state: "Needs review", reason: "Missing or duplicate row identifiers. Select another identifier or compare by position." };
  let matched = 0;
  const cells = [], missing = [], extra = [];
  expectedRows.forEach((row, index) => {
    const actualIndex = actualKeys.indexOf(expectedKeys[index]);
    if (actualIndex < 0) missing.push(index + 1);
    for (const [expected, actual] of pairs) {
      const a = scalarValue(rows[actualIndex]?.[actual.key], actual.data_type, reference.exact);
      const e = scalarValue(row[expected.key], expected.data_type, reference.exact);
      const match = a.valid && e.valid && a.value === e.value;
      if (match) matched++;
      cells.push({ row: index + 1, column: expected.heading, match, expected: row[expected.key], actual: rows[actualIndex]?.[actual.key] });
    }
  });
  actualKeys.forEach((key, index) => { if (!expectedKeys.includes(key)) extra.push(index + 1); });
  const total = expectedRows.length * pairs.length;
  return { state: parsedRows !== null && matched === total && !extra.length ? "Match" : "Mismatch", kind: "table", matched, total, missing, extra, cells };
}
export function scoreCandidate(candidate, references, definitions, alignments = {}, columns = {}) {
  if (!candidate.result) return { fields: null, tables: null, tablesNeedingReview: 0, coverage: null, byField: {} };
  const byField = {};
  const requested = new Set();
  const identities = candidate.result.fields.map(f => alignments[f.id] || fieldIdentity(f));
  for (const field of candidate.result.fields) {
    const identity = alignments[field.id] || fieldIdentity(field);
    const reference = references[identity];
    const definition = definitions[identity] || field;
    if (reference?.verified && definition.data_type === field.data_type) requested.add(identity);
    if (identities.filter(id => id === identity).length > 1) {
      byField[field.id] = { state: "Needs review", reason: "Link each expected field to only one candidate field." };
      continue;
    }
    byField[field.id] = scoreField(field, candidate.result.raw.find(r => r.field_id === field.id), reference, definition, { columns: columns[field.id] });
  }
  const sum = kind => {
    const scored = Object.values(byField).filter(score => score.kind === kind);
    return scored.length ? { matched: scored.reduce((s, r) => s + r.matched, 0), total: scored.reduce((s, r) => s + r.total, 0) } : null;
  };
  const tablesNeedingReview = candidate.result.fields.filter(field => field.data_type === "array<object>" && byField[field.id]?.state === "Needs review").length;
  return { fields: sum("field"), tables: sum("table"), tablesNeedingReview, coverage: { requested: requested.size, total: Object.values(references).filter(r => r.verified).length }, byField };
}
