import { describe, expect, it } from "vitest";
import { fieldIdentity, scalarValue, scoreCandidate, scoreField, validateReference } from "./evaluationScoring.js";
const field = (name = "Value", type = "string") => ({ id: name.toLowerCase(), name, data_type: type, description: "Extract value" });
const ref = value => ({ verified: true, value });
const raw = answer => ({ status: "ok", answer });
const table = { ...field("Items", "array<object>"), object_schema: { mode: "table", columns: [{ key: "sku", heading: "SKU", data_type: "string", description: "SKU" }, { key: "quantity", heading: "Quantity", data_type: "number", description: "Quantity" }] } };
const expectedTable = [{ sku: "A", quantity: 1 }, { sku: "B", quantity: 2 }];
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
  it("distinguishes absence, unknown, zero, false and errors", () => {
    const absence = { verified: true, absent: true };
    expect(scoreField(field(), { status: "not_found", answer: null }, absence).state).toBe("Match");
    for (const status of ["error", "unreadable", "invalid_type", "ok"]) expect(scoreField(field(), { status, answer: null }, absence).state).toBe("Mismatch");
    expect(scoreField(field("n", "number"), raw(0), ref(0)).state).toBe("Match");
    expect(scoreField(field("b", "boolean"), raw(false), ref(false)).state).toBe("Match");
    expect(scoreField(field(), raw("x"), { value: "x" }).state).toBe("Unscored");
  });
  it("keeps correctness separate from coverage and counts missing requested values", () => {
    const fields = Array.from({ length: 10 }, (_, i) => field("Field" + i));
    const definitions = Object.fromEntries(fields.map(f => [fieldIdentity(f), f]));
    const references = Object.fromEntries(fields.map(f => [fieldIdentity(f), ref("yes")]));
    const candidate = { result: { fields: fields.slice(0, 8), raw: fields.slice(0, 8).map(f => ({ field_id: f.id, ...raw("yes") })) } };
    const score = scoreCandidate(candidate, references, definitions);
    expect(score.fields).toEqual({ matched: 8, total: 8 }); expect(score.coverage).toEqual({ requested: 8, total: 10 });
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
