import { describe, expect, it } from "vitest";
import { fieldIdentity, scalarValue, scoreCandidate, scoreField, validateReference, alignTableRows, tableCellsEqual, candidateAccuracy, rankCandidates, bestCandidateId, answerSignature } from "./evaluationScoring.js";
const field = (name = "Value", type = "string") => ({ id: name.toLowerCase(), name, data_type: type, description: "Extract value" });
const ref = value => ({ verified: true, value });
const raw = answer => ({ status: "ok", answer });
const table = { ...field("Items", "array<object>"), object_schema: { mode: "table", columns: [{ key: "sku", heading: "SKU", data_type: "string", description: "SKU" }, { key: "quantity", heading: "Quantity", data_type: "number", description: "Quantity" }] } };
const expectedTable = [{ sku: "A", quantity: 1 }, { sku: "B", quantity: 2 }];
it("scores absent table cells and excludes only explicitly ignored cells", () => {
  const reference = { ...ref([{ sku: "A", quantity: "" }, { sku: "B", quantity: "" }]), rows: { mode: "position" }, cellStates: [{ quantity: "absent" }, { quantity: "ignored" }] };
  expect(validateReference(table, reference)).toBe("");
  for (const quantity of [undefined, null, "", "  "]) {
    expect(scoreField(table, raw([{ sku: "A", quantity }, { sku: "B", quantity: 999 }]), reference)).toMatchObject({ state: "Match", matched: 3, total: 3 });
  }
  for (const quantity of [0, false, "unknown", {}]) {
    expect(scoreField(table, raw([{ sku: "A", quantity }, { sku: "B" }]), reference)).toMatchObject({ state: "Mismatch", matched: 2, total: 3 });
  }
  expect(scoreField(table, raw([{ sku: "A" }]), reference)).toMatchObject({ state: "Mismatch", missing: [2], matched: 2, total: 3 });
});
it("requires a real value for row identifiers even if a cell is marked absent or ignored", () => {
  for (const state of ["absent", "ignored"]) expect(validateReference(table, { ...ref(expectedTable), rows: { mode: "key", key: "sku" }, cellStates: [{ sku: state }, {}] })).toMatch(/identifier.*value/i);
});
it("does not count a table with every cell ignored as a perfect match", () => {
  const reference = { ...ref([{ sku: "", quantity: "" }]), rows: { mode: "position" }, cellStates: [{ sku: "ignored", quantity: "ignored" }] };
  expect(scoreField(table, raw([{ sku: "anything", quantity: 10 }]), reference)).toMatchObject({ state: "Unscored" });
});
describe("Evaluation matching", () => {
  it.each([["ACME, Inc.", "acme inc"], ["INV-123", "INV123"], ["A  B", "a b"]])("ignores case, punctuation and repeated whitespace: %s", (actual, expected) => {
    expect(scoreField(field(), raw(actual), ref(expected)).state).toBe("Match");
    expect(scoreField(field(), raw(actual), { ...ref(expected), exact: true }).state).toBe("Mismatch");
  });
  it("does not merge changed words, numbers or invalid types", () => {
    for (const value of ["acme inc 2", "ac me inc", 123, {}, null]) expect(scoreField(field(), raw(value), ref("acme inc")).state).toBe("Mismatch");
    expect(scoreField(field("Total", "number"), raw("$1,234.50"), ref(1234.5)).state).toBe("Match");
    expect(scoreField(field("Total", "number"), raw(1234.5001), ref(1234.5)).state).toBe("Mismatch");
    expect(scalarValue("1,23", "number").valid).toBe(false);
    expect(scalarValue(true, "number").valid).toBe(false);
    expect(scoreField(field("Paid", "boolean"), raw("No"), ref(false)).state).toBe("Match");
  });
  it("compares only unambiguous valid calendar days", () => {
    const date = field("Date", "date");
    for (const answer of ["2026-09-27", "27/09/2026", "09/27/2026", "27 September 2026", "Sep 27, 2026"]) expect(scoreField(date, raw(answer), ref("2026-09-27")).state).toBe("Match");
    for (const answer of ["02/03/2026", "2026-02-30", "yesterday", 20260927]) expect(scalarValue(answer, "date").valid).toBe(false);
    expect(scalarValue("2024-02-29", "date").valid).toBe(true);
  });
  it("matches day-first candidate dates against ISO expected dates without swapping the day and month", () => {
    const date = field("Date of birth", "date");
    expect(scoreField(date, raw("08/09/1871"), ref("1871-09-08"))).toMatchObject({ state: "Match", matched: 1, total: 1 });
    expect(scoreField(date, raw("08/09/1871"), ref("1871-08-09")).state).toBe("Mismatch");
    for (const answer of ["09/08/1871", "08/09/1872", "31/02/1871"]) expect(scoreField(date, raw(answer), ref("1871-09-08")).state).toBe("Mismatch");
    expect(scoreField(date, raw("1871-09-08"), ref("08/09/1871")).state).toBe("Needs review");
  });
  it("treats equivalent candidate date formats as the same answer", () => {
    const date = field("Date of birth", "date"), column = { key: "date", data_type: "date" };
    expect(answerSignature(date, raw("08/09/1871"))).toBe(answerSignature(date, raw("1871-09-08")));
    expect(answerSignature(date, raw("09/08/1871"))).not.toBe(answerSignature(date, raw("1871-09-08")));
    expect(tableCellsEqual(column, "08/09/1871", "1871-09-08")).toBe(true);
    expect(tableCellsEqual(column, "09/08/1871", "1871-09-08")).toBe(false);
  });
  it("matches and aligns day-first dates in table cells and row identifiers", () => {
    const dated = { ...table, object_schema: { mode: "table", columns: [{ key: "date", heading: "Date", data_type: "date" }, table.object_schema.columns[0]] } };
    const expected = [{ date: "1871-09-08", sku: "A" }, { date: "1871-09-09", sku: "B" }];
    const actual = [{ date: "09/09/1871", sku: "B" }, { date: "08/09/1871", sku: "A" }];
    const reference = { ...ref(expected), rows: { mode: "key", key: "date" } };
    expect(scoreField(dated, raw(actual), reference)).toMatchObject({ state: "Match", matched: 4, total: 4, missing: [], extra: [] });
    expect(scoreField(dated, raw([...actual].reverse()), { ...reference, rows: { mode: "position" } })).toMatchObject({ state: "Match", matched: 4, total: 4 });
    const aligned = alignTableRows(dated, reference, [{ expected: true, field: dated, rows: expected }, { field: dated, rows: actual }]);
    expect(aligned.lines).toHaveLength(2);
    expect(aligned.lines.every(line => !line.extra && line.rows.every(Boolean))).toBe(true);
  });
  it("distinguishes absence, unknown, zero, false and errors", () => {
    const absence = { verified: true, absent: true };
    expect(scoreField(field(), { status: "not_found", answer: null }, absence).state).toBe("Match");
    for (const status of ["error", "unreadable", "invalid_type", "ok"]) expect(scoreField(field(), { status, answer: null }, absence).state).toBe("Mismatch");
    expect(scoreField(field("n", "number"), raw(0), ref(0)).state).toBe("Match");
    expect(scoreField(field("b", "boolean"), raw(false), ref(false)).state).toBe("Match");
    expect(scoreField(field(), raw("x"), { value: "x" }).state).toBe("Unscored");
  });
  it("scores only returned fields and counts missing requested values", () => {
    const fields = Array.from({ length: 10 }, (_, i) => field("Field" + i));
    const definitions = Object.fromEntries(fields.map(f => [fieldIdentity(f), f]));
    const references = Object.fromEntries(fields.map(f => [fieldIdentity(f), ref("yes")]));
    const candidate = { result: { fields: fields.slice(0, 8), raw: fields.slice(0, 8).map(f => ({ field_id: f.id, ...raw("yes") })) } };
    const score = scoreCandidate(candidate, references, definitions);
    expect(score.fields).toEqual({ matched: 8, total: 8 });
    candidate.result.raw.pop(); expect(scoreCandidate(candidate, references, definitions).fields).toEqual({ matched: 7, total: 8 });
    expect(scoreCandidate({}, references, definitions).fields).toBeNull();
  });
  it("requires explicit compatible renamed-field alignment", () => {
    const f = field("Invoice total", "number"), original = field("Total", "number");
    const references = { [fieldIdentity(original)]: ref(12) }, definitions = { [fieldIdentity(original)]: original };
    const candidate = { result: { fields: [f], raw: [{ field_id: f.id, ...raw(12) }] } };
    expect(scoreCandidate(candidate, references, definitions).fields).toBeNull();
    expect(scoreCandidate(candidate, references, definitions, { [f.id]: fieldIdentity(original) }).fields).toEqual({ matched: 1, total: 1 });
  });
  it("aligns unique table keys and flags missing, extra and invalid cells", () => {
    const reference = { ...ref(expectedTable), rows: { mode: "key", key: "sku" } };
    expect(scoreField(table, raw([...expectedTable].reverse()), reference)).toMatchObject({ matched: 4, total: 4, missing: [], extra: [], state: "Match" });
    expect(scoreField(table, raw([{ sku: "A", quantity: "wrong" }, { sku: "C", quantity: 3 }]), reference)).toMatchObject({ matched: 1, total: 4, missing: [2], extra: [2], state: "Mismatch" });
    for (const rows of [[{ sku: "A", quantity: 1 }, { sku: "A", quantity: 2 }], [{ quantity: 1 }]]) expect(scoreField(table, raw(rows), reference)).toMatchObject({ state: "Needs review" });
    expect(scoreField(table, raw(expectedTable), { ...reference, rows: {} }).state).toBe("Needs review");
    expect(scoreField(table, raw(expectedTable), { ...reference, rows: { mode: "position" } }).matched).toBe(4);
  });
  it("requires compatible column mapping and complete valid expected tables", () => {
    const changed = { ...table, object_schema: { ...table.object_schema, columns: table.object_schema.columns.map(c => c.key === "quantity" ? { ...c, key: "count", heading: "Count" } : c) } };
    const value = expectedTable.map(r => ({ sku: r.sku, count: r.quantity }));
    const reference = { ...ref(expectedTable), rows: { mode: "key", key: "sku" } };
    expect(scoreField(changed, raw(value), reference, table).state).toBe("Needs review");
    expect(scoreField(changed, raw(value), reference, table, { columns: { quantity: "count" } }).matched).toBe(4);
    expect(validateReference(table, ref([{ sku: "A" }]))).not.toBe("");
    expect(validateReference(table, reference)).toBe("");
    expect(scoreField(field("List", "array"), raw([1]), ref([1])).state).toBe("Not automatically scored");
  });
});

it("labels unsupported output without verification and never matches an invalid empty table", () => {
  expect(scoreField(field("Freeform", "array"), raw([1]), undefined).state).toBe("Not automatically scored");
  expect(scoreField(table, { status: "error", answer: null }, { ...ref([]), rows: { mode: "position" } }).state).toBe("Mismatch");
});

it("withholds duplicated field links instead of double-counting a reference", () => {
  const a = field("Total", "number"), b = field("Amount", "number");
  const identity = fieldIdentity(a);
  const score = scoreCandidate({ result: { fields: [a, b], raw: [a, b].map(f => ({ field_id: f.id, ...raw(1) })) } }, { [identity]: ref(1) }, { [identity]: a }, { [b.id]: identity });
  expect(score.fields).toBeNull(); expect(score.byField[a.id].state).toBe("Needs review");
});

it("scores table-object results by their rows, preserving empty versus invalid output", () => {
  const reference = { ...ref(expectedTable), rows: { mode: "position" } };
  expect(scoreField(table, raw({ columns: ["sku", "quantity"], rows: expectedTable }), reference)).toMatchObject({ state: "Match", matched: 4, total: 4 });
  expect(scoreField(table, raw({ columns: ["sku", "quantity"], rows: [] }), reference)).toMatchObject({ state: "Mismatch", missing: [1, 2] });
  const empty = { ...ref([]), rows: { mode: "position" } };
  expect(scoreField(table, raw({ columns: ["sku", "quantity"], rows: [] }), empty).state).toBe("Match");
  expect(scoreField(table, raw({ columns: ["sku", "quantity"], rows: null }), empty).state).toBe("Mismatch");
});
it("requires a valid row matching choice before verifying table answers", () => {
  expect(validateReference(table, ref(expectedTable))).toMatch(/Choose how to match rows/);
  expect(validateReference(table, { ...ref(expectedTable), rows: { mode: "key", key: "missing" } })).toMatch(/Choose a column/);
  expect(validateReference(table, { ...ref([{ sku: "A", quantity: 1 }, { sku: "A", quantity: 2 }]), rows: { mode: "key", key: "sku" } })).toMatch(/unique/);
  expect(validateReference(table, { ...ref(expectedTable), rows: { mode: "position" } })).toBe("");
  expect(validateReference(table, { ...ref(expectedTable), rows: { mode: "key", key: "sku" } })).toBe("");
  expect(validateReference(table, { verified: true, absent: true })).toBe("");
});
it("reports tables needing review separately from unscored tables", () => {
  const candidate = { result: { fields: [table], raw: [{ field_id: table.id, ...raw(expectedTable) }] } };
  const identity = fieldIdentity(table);
  expect(scoreCandidate(candidate, { [identity]: ref(expectedTable) }, { [identity]: table }).tablesNeedingReview).toBe(1);
  expect(scoreCandidate(candidate, {}, { [identity]: table }).tablesNeedingReview).toBe(0);
});
it("leaves zero-cell accuracy unscored and ranks measured table cells ahead of it", () => {
  const emptyTable = { ...table, id: "empty_items", name: "Empty items" };
  const identity = fieldIdentity(table);
  const emptyIdentity = fieldIdentity(emptyTable);
  const references = { [identity]: { ...ref(expectedTable), rows: { mode: "position" } }, [emptyIdentity]: { ...ref([]), rows: { mode: "position" } } };
  const definitions = { [identity]: table, [emptyIdentity]: emptyTable };
  const candidate = (id, definition, answer, processingMs) => ({ id, result: { fields: [definition], raw: [{ field_id: definition.id, ...raw(answer) }], processingMs } });
  const empty = candidate("empty", emptyTable, [], 10);
  const populated = candidate("populated", table, expectedTable, 100);
  const scores = Object.fromEntries([empty, populated].map(value => [value.id, scoreCandidate(value, references, definitions)]));
  expect(scores.empty.byField[emptyTable.id].state).toBe("Match");
  expect(candidateAccuracy(scores.empty)).toEqual({ matched: 1, total: 1, ratio: 1 });
  expect(scores.empty.tables).toBeNull();
  expect(scores.populated.tables).toEqual({ matched: 4, total: 4 });
  expect(rankCandidates([empty, populated], scores).map(value => value.id)).toEqual(["populated", "empty"]);
  expect(bestCandidateId([empty, populated], scores)).toBe("populated");
  const mixed = { result: { fields: [emptyTable, table], raw: [...empty.result.raw, ...populated.result.raw] } };
  expect(scoreCandidate(mixed, references, definitions).tables).toEqual({ matched: 4, total: 4 });
});

const itemsTable = { name: "Items", data_type: "array<object>", object_schema: { columns: [{ key: "sku", heading: "SKU", data_type: "string" }, { key: "qty", heading: "Quantity", data_type: "number" }] } };
it("aligns expected and candidate rows by key, projecting renamed candidate columns", () => {
  const renamed = { ...itemsTable, object_schema: { columns: [{ key: "code", heading: "SKU", data_type: "string" }, { key: "count", heading: "Count", data_type: "number" }] } };
  const { columns, lines, unaligned } = alignTableRows(itemsTable, { rows: { mode: "key", key: "sku" } }, [
    { expected: true, rows: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }] },
    { field: renamed, rows: { rows: [{ code: "b", count: 2 }, { code: "C", count: 9 }] }, mappings: { qty: "count" } },
  ]);
  expect(columns.map(c => c.key)).toEqual(["sku", "qty"]);
  expect(unaligned).toEqual([[], []]);
  expect(lines.map(line => [line.extra, line.rows.map(row => row && row.qty)])).toEqual([[false, [1, null]], [false, [2, 2]], [true, [null, 9]]]);
});
it("aligns by position without an expected answer and keeps duplicate keys apart", () => {
  const { lines } = alignTableRows(itemsTable, { rows: { mode: "key", key: "sku" } }, [
    { expected: true, rows: [{ sku: "A", qty: 1 }] }, { field: itemsTable, rows: [{ sku: "A", qty: 1 }, { sku: "A", qty: 3 }] },
  ]);
  expect(lines).toHaveLength(2); expect(lines[1].extra).toBe(true);
  expect(alignTableRows(itemsTable, null, [{ field: itemsTable, rows: [{ sku: "A" }] }, { field: itemsTable, rows: [] }]).lines[0]).toMatchObject({ extra: false, rows: [{ sku: "A" }, null] });
});
it("compares table cells with scoring normalization and treats blanks as equal", () => {
  expect(tableCellsEqual({ data_type: "number" }, "1,200", 1200)).toBe(true);
  expect(tableCellsEqual({ data_type: "string" }, "Widget.", "widget")).toBe(true);
  expect(tableCellsEqual({ data_type: "string" }, "Widget.", "widget", true)).toBe(false);
  expect(tableCellsEqual({ data_type: "string" }, "", null)).toBe(true);
  expect(tableCellsEqual({ data_type: "string" }, "", "A")).toBe(false);
});
it("ranks candidates by accuracy, then table cells, then time, and names one leader", () => {
  const score = (states, tables) => ({ byField: Object.fromEntries(states.map((state, i) => [i, { state }])), tables });
  const candidates = ["slow", "fast", "worse", "idle"].map((id, i) => ({ id, result: id === "idle" ? null : { processingMs: [900, 100, 50][i] } }));
  const scores = { slow: score(["Match", "Mismatch"], { matched: 4, total: 4 }), fast: score(["Match", "Mismatch", "Unscored"], { matched: 4, total: 4 }), worse: score(["Mismatch"]), idle: score([]) };
  expect(candidateAccuracy(scores.fast)).toEqual({ matched: 1, total: 2, ratio: 0.5 });
  expect(candidateAccuracy(scores.idle)).toBeNull();
  expect(rankCandidates(candidates, scores).map(c => c.id)).toEqual(["fast", "slow", "worse", "idle"]);
  expect(bestCandidateId(candidates, scores)).toBe("fast");
  expect(bestCandidateId(candidates.slice(0, 1), scores)).toBeNull();
});
it("normalizes answers before deciding whether candidates disagree", () => {
  const number = { data_type: "number" };
  expect(answerSignature(number, { status: "ok", answer: "1,200" })).toBe(answerSignature(number, { status: "ok", answer: 1200 }));
  expect(answerSignature(number, { status: "not_found", answer: 5 })).toBe("absent");
  expect(answerSignature(itemsTable, { status: "ok", answer: { rows: [{ sku: "A" }] } })).toBe(answerSignature(itemsTable, { status: "ok", answer: [{ sku: "A" }] }));
});
