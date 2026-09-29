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
  const pairs = tableColumnPairs(referenceField, field, mappings);
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
  if (!candidate.result) return { fields: null, tables: null, tablesNeedingReview: 0, byField: {} };
  const byField = {};
  const identities = candidate.result.fields.map(f => alignments[f.id] || fieldIdentity(f));
  for (const field of candidate.result.fields) {
    const identity = alignments[field.id] || fieldIdentity(field);
    if (identities.filter(id => id === identity).length > 1) {
      byField[field.id] = { state: "Needs review", reason: "Link each expected field to only one candidate field." };
      continue;
    }
    byField[field.id] = scoreField(field, candidate.result.raw.find(r => r.field_id === field.id), references[identity], definitions[identity] || field, { columns: columns[field.id] });
  }
  const sum = kind => {
    const scored = Object.values(byField).filter(score => score.kind === kind);
    return scored.length ? { matched: scored.reduce((s, r) => s + r.matched, 0), total: scored.reduce((s, r) => s + r.total, 0) } : null;
  };
  const tablesNeedingReview = candidate.result.fields.filter(field => field.data_type === "array<object>" && byField[field.id]?.state === "Needs review").length;
  return { fields: sum("field"), tables: sum("table"), tablesNeedingReview, byField };
}

// Share of scored fields (scalars and tables) that match; null until something is scored.
export function candidateAccuracy(score) {
  const states = Object.values(score?.byField || {}).map(field => field.state);
  const scored = states.filter(state => state === "Match" || state === "Mismatch").length;
  return scored ? { matched: states.filter(state => state === "Match").length, total: scored, ratio: states.filter(state => state === "Match").length / scored } : null;
}

// Accuracy first, then table cells, then processing time, so ties still produce one leader.
export function rankCandidates(candidates, scores) {
  const accuracy = candidate => candidateAccuracy(scores[candidate.id])?.ratio ?? -1;
  const cells = candidate => scores[candidate.id]?.tables ? scores[candidate.id].tables.matched / scores[candidate.id].tables.total : -1;
  return [...candidates].sort((a, b) => (!!b.result - !!a.result) || (accuracy(b) - accuracy(a)) || (cells(b) - cells(a)) || ((a.result?.processingMs ?? 0) - (b.result?.processingMs ?? 0)));
}
export function bestCandidateId(candidates, scores) {
  const scored = candidates.filter(candidate => candidate.result && candidateAccuracy(scores[candidate.id]));
  return scored.length > 1 ? rankCandidates(scored, scores)[0].id : null;
}

// A comparable form of one answer, used to tell whether candidates disagree.
export function answerSignature(field, raw) {
  if (!raw || raw.status === "not_found" || raw.answer === null || raw.answer === undefined || raw.answer === "") return "absent";
  if (field.data_type === "array<object>") return JSON.stringify(tableAnswerRows(raw.answer) ?? raw.answer);
  const normalized = scalarValue(raw.answer, field.data_type);
  return JSON.stringify(normalized.valid ? normalized.value : raw.answer);
}

// Expected columns paired with a candidate's columns, using the same rules as table scoring.
function tableColumnPairs(expectedField, actualField, mappings = {}) {
  const actualColumns = tableColumns(actualField);
  return tableColumns(expectedField).map(expected => [expected, actualColumns.find(c => c.data_type === expected.data_type && (mappings[expected.key] ? c.key === mappings[expected.key] : c.key === expected.key || c.heading.toLowerCase() === expected.heading.toLowerCase()))]);
}

export function tableCellsEqual(column, a, b, exact = false) {
  const blank = value => value === undefined || value === null || (typeof value === "string" && !value.trim());
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  const left = scalarValue(a, column.data_type, exact), right = scalarValue(b, column.data_type, exact);
  return left.valid && right.valid ? left.value === right.value : String(a) === String(b);
}

// Lines up expected rows and every candidate's rows on the expected columns, matching rows the
// way scoring does: by row position, or by the chosen key column.
export function alignTableRows(definition, reference, sources) {
  const columns = tableColumns(definition);
  const keyColumn = reference?.rows?.mode === "key" ? columns.find(c => c.key === reference.rows.key) : null;
  const order = [], lines = new Map(), expectedKeys = new Set();
  const projected = sources.map(source => {
    const pairs = source.expected ? columns.map(column => [column, column]) : tableColumnPairs(definition, source.field, source.mappings);
    const rows = (tableAnswerRows(source.rows) || []).map(row => Object.fromEntries(pairs.map(([expected, actual]) => [expected.key, actual ? row?.[actual.key] : undefined])));
    return { unaligned: pairs.filter(([, actual]) => !actual).map(([expected]) => expected.heading), rows };
  });
  projected.forEach((source, sourceIndex) => {
    const used = new Set();
    source.rows.forEach((row, index) => {
      const value = keyColumn && scalarValue(row[keyColumn.key], keyColumn.data_type);
      let key = keyColumn ? (value.valid ? `key:${JSON.stringify(value.value)}` : `row:${index}`) : `position:${index}`;
      if (used.has(key)) key = `${key}:duplicate:${index}`;
      used.add(key);
      if (sources[sourceIndex].expected) expectedKeys.add(key);
      if (!lines.has(key)) { lines.set(key, sources.map(() => null)); order.push(key); }
      lines.get(key)[sourceIndex] = row;
    });
  });
  const hasExpected = sources.some(source => source.expected);
  return {
    columns,
    unaligned: projected.map(source => source.unaligned),
    lines: order.map((key, index) => ({ key, number: index + 1, extra: hasExpected && !expectedKeys.has(key), rows: lines.get(key) })),
  };
}
