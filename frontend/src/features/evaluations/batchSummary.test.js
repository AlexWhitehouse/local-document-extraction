import { describe, expect, it } from "vitest";
import { batchSummary, fieldIdentity, pairMetrics, referenceCompatibility } from "./evaluationScoring.js";
import { documentDirty, parseReferenceSet, serializeReferenceSet } from "./evaluationLibrary.js";

const field = (name, type = "string") => ({ id: name.toLowerCase(), name, data_type: type, description: "" });
const table = { id: "items", name: "Items", data_type: "array<object>", description: "", object_schema: { mode: "table", columns: [{ key: "sku", heading: "SKU", data_type: "string" }, { key: "qty", heading: "Qty", data_type: "number" }] } };
const verified = value => ({ verified: true, absent: false, exact: false, value });
const set = entries => ({ definitions: Object.fromEntries(entries.map(([f]) => [fieldIdentity(f), f])), references: Object.fromEntries(entries.filter(([, r]) => r).map(([f, r]) => [fieldIdentity(f), r])) });
const candidate = (id, fields, revision = 0) => ({ id, revision, template: { fields } });
// A current successful pair whose compact metrics were computed from its output, as the controller does.
function pair(document, c, answers, { processingMs = 100, ...extra } = {}) {
  const result = { revision: c.revision, fields: c.template.fields, processingMs, raw: Object.entries(answers).map(([field_id, answer]) => ({ field_id, status: answer === undefined ? "not_found" : "ok", answer })) };
  return { status: "success", result, metrics: pairMetrics(document, c, { result }), detail: "retained", ...extra };
}
const names = [field("Name"), field("Code"), field("Date"), field("City"), field("Ref")];

describe("Batch Evaluation summaries", () => {
  it("averages each document equally rather than pooling fields or cells", () => {
    // Document one has 5 verified fields (4 match = 80%), document two has 1 (1 match = 100%).
    const one = { key: "one", reference: set(names.map(f => [f, verified("x")])) }, two = { key: "two", reference: set([[names[0], verified("x")]]) };
    const a = candidate("a", names), b = candidate("b", names);
    const pairs = {
      one: { a: pair(one, a, { name: "x", code: "x", date: "bad", city: "x", ref: "x" }), b: pair(one, b, { name: "x", code: "x", date: "bad", city: "x", ref: "x" }) },
      two: { a: pair(two, a, { name: "x" }), b: pair(two, b, { name: "y" }) },
    };
    const summary = batchSummary([one, two], [a, b], pairs);
    expect(summary.per.a.scalar).toBeCloseTo(0.9); // (80% + 100%) / 2, not the pooled 5/6
    expect(summary.per.b.scalar).toBeCloseTo(0.4);
    expect(summary.per.a).toMatchObject({ scalarDocs: 2, cellsDocs: 0, cells: null, done: 2, coverage: 1 });
    expect(summary.best).toEqual(["a"]);
  });
  it("keeps table cells separate, and exposes row issues", () => {
    const document = { key: "d", reference: set([[names[0], verified("x")], [table, { ...verified([{ sku: "A", qty: "1" }, { sku: "B", qty: "2" }]), rows: { mode: "key", key: "sku" } }]]) };
    const c = candidate("a", [names[0], table]);
    const metrics = pairMetrics(document, c, { result: { revision: 0, fields: c.template.fields, raw: [{ field_id: "name", status: "ok", answer: "x" }, { field_id: "items", status: "ok", answer: [{ sku: "A", qty: 1 }, { sku: "C", qty: 3 }] }] } });
    expect(metrics).toMatchObject({ scalar: 1, cellRatio: 0.5, cells: { matched: 2, total: 4 }, missingRows: 1, extraRows: 1, coverage: 1 });
    expect(metrics.scope).toEqual(["items:array<object>[qty,sku]", "name:string"]);
  });
  it("counts pending, failed, unscored and unavailable work without zero scores, and withholds Best while partial", () => {
    const one = { key: "one", reference: set([[names[0], verified("x")]]) }, bare = { key: "bare", reference: set([]) }, gone = { key: "gone", reference: set([[names[0], verified("x")]]), availability: "missing" };
    const a = candidate("a", [names[0]]), b = candidate("b", [names[0]]);
    const pairs = { one: { a: pair(one, a, { name: "x" }), b: { status: "failure", message: "Queue full—try again" } }, bare: { a: pair(bare, a, { name: "x" }), b: { status: "running" } } };
    let summary = batchSummary([one, bare], [a, b], pairs, d => d.availability !== "missing");
    expect(summary.per.a).toMatchObject({ scalar: 1, scalarDocs: 1, done: 2, unscored: 1, coverageDocs: 1 });
    expect(summary.per.b).toMatchObject({ scalar: null, failed: 1, pending: 1, done: 0 });
    expect(summary.best).toEqual([]); expect(summary.reason).toMatch(/Partial summary · 0 of 2/);
    summary = batchSummary([one, gone], [a, b], { one: pairs.one }, d => d.availability !== "missing");
    expect(summary.per.a.unavailable).toBe(1); expect(summary.reason).toMatch(/can’t run/);
  });
  it("excludes previous, edited, stale and details-unavailable results from the current summary", () => {
    const document = { key: "d", reference: set([[names[0], verified("x")]]) };
    const a = candidate("a", [names[0]]), edited = candidate("b", [names[0]], 1), c = candidate("c", [names[0]]), d = candidate("d", [names[0]]);
    const base = pair(document, a, { name: "x" });
    const pairs = { d: { a: { status: "failure", previous: base.result, result: null }, b: pair(document, candidate("b", [names[0]]), { name: "x" }), c: { ...base, metrics: { ...base.metrics, stale: true } }, d: { ...base, detail: "unavailable" } } };
    const summary = batchSummary([document], [a, edited, c, d], pairs);
    expect(Object.values(summary.per).map(s => s.done)).toEqual([0, 0, 0, 0]);
    expect(summary.per.a.failed).toBe(1); expect(summary.per.b.outdated).toBe(1); expect(summary.per.c.pending).toBe(1); expect(summary.per.d.detailsUnavailable).toBe(1);
    expect(summary.best).toEqual([]);
  });
  it("counts a result whose details became unreadable during rescoring as unavailable, not pending", () => {
    const document = { key: "d", reference: set([[names[0], verified("x")]]) };
    const a = candidate("a", [names[0]]);
    const base = pair(document, a, { name: "x" });
    const summary = batchSummary([document], [a], { d: { a: { ...base, detail: "unavailable", metrics: { ...base.metrics, stale: true } } } });
    expect(summary.per.a.detailsUnavailable).toBe(1);
    expect(summary.per.a.pending).toBe(0);
  });
  it("withholds Best when candidates cover different verified fields, even with equal scores", () => {
    const document = { key: "d", reference: set([[names[0], verified("x")], [names[1], verified("x")]]) };
    const a = candidate("a", [names[0]]), b = candidate("b", [names[1]]);
    const summary = batchSummary([document], [a, b], { d: { a: pair(document, a, { name: "x" }), b: pair(document, b, { code: "x" }) } });
    expect([summary.per.a.scalar, summary.per.b.scalar, summary.per.a.coverage]).toEqual([1, 1, 0.5]);
    expect(summary.best).toEqual([]); expect(summary.reason).toMatch(/different verified fields/);
  });
  it("keeps exact ties tied, ranks by fields then cells then time, and never names a timing-only winner", () => {
    const document = { key: "d", reference: set([[names[0], verified("x")]]) };
    const a = candidate("a", [names[0]]), b = candidate("b", [names[0]]), c = candidate("c", [names[0]]);
    const tied = batchSummary([document], [a, b], { d: { a: pair(document, a, { name: "x" }), b: pair(document, b, { name: "x" }) } });
    expect(tied.best).toEqual(["a", "b"]);
    const timed = batchSummary([document], [a, b, c], { d: { a: pair(document, a, { name: "x" }, { processingMs: 300 }), b: pair(document, b, { name: "x" }, { processingMs: 100 }), c: pair(document, c, { name: "y" }, { processingMs: 1 }) } });
    expect(timed.best).toEqual(["b"]);
    const unverified = { key: "u", reference: set([]) };
    const none = batchSummary([unverified], [a, b], { u: { a: pair(unverified, a, { name: "x" }, { processingMs: 1 }), b: pair(unverified, b, { name: "x" }, { processingMs: 9 }) } });
    expect(none.best).toEqual([]); expect(none.reason).toMatch(/No verified answers/);
  });
});

describe("Saved Expected answer sets", () => {
  it("reuses same-name answers, flags type changes for review and keeps omitted answers visible", () => {
    const saved = set([[field("Total", "string"), verified("1,020.00 GBP")], [names[0], verified("x")], [field("Amount due", "number"), verified("1020")]]);
    const compatibility = referenceCompatibility(saved, [field("Total", "number"), names[0], field("New")]);
    expect(compatibility.rows.map(r => r.state)).toEqual(["review", "verified", "unverified"]);
    expect(compatibility.rows[0].from).toBe("total:string");
    expect(compatibility.omitted).toEqual(["amount due:number"]);
    expect(compatibility).toMatchObject({ verified: 1, review: 1, total: 3 });
  });
  it("serializes only reference inputs, losslessly, and never verifies anything", () => {
    const embedded = { id: "lines", name: "Lines", data_type: "array<object>", description: "Every line\n[[OBJECT_SCHEMA]]{\"mode\":\"table\",\"columns\":[{\"key\":\"sku\",\"heading\":\"SKU\",\"data_type\":\"string\"}]}[[/OBJECT_SCHEMA]]" };
    const working = { definitions: { "total:number": { ...field("Total", "number"), extra: "ignored" }, "flag:boolean": field("Flag", "boolean"), "items:array<object>": table, "stray:string": field("Other") },
      references: { "total:number": { verified: true, absent: false, exact: false, value: 0 }, "flag:boolean": { verified: false, value: false, rows: { mode: "", key: "" } }, "items:array<object>": { verified: true, absent: true, exact: false, value: "" }, "missing:string": verified("x") } };
    const serialized = serializeReferenceSet(working);
    expect(Object.keys(serialized)).toEqual(["version", "definitions", "references"]);
    expect(Object.keys(serialized.definitions)).toEqual(["total:number", "flag:boolean", "items:array<object>"]);
    expect(serialized.definitions["total:number"]).toEqual({ id: "total", name: "Total", data_type: "number", description: "" });
    expect(serialized.definitions["items:array<object>"].object_schema.mode).toBe("table");
    expect(serialized.references).toEqual({ "total:number": { verified: true, absent: false, exact: false, value: 0 }, "flag:boolean": { verified: false, absent: false, exact: false, value: false }, "items:array<object>": { verified: true, absent: true, exact: false } });
    const round = parseReferenceSet(serialized);
    expect(serializeReferenceSet(round)).toEqual(serialized);
    expect(documentDirty({ kind: "saved", base: round, reference: parseReferenceSet(serialized) })).toBe(false);
    // A table schema embedded in a Template description becomes an explicit object_schema.
    const hydrated = serializeReferenceSet({ definitions: { "lines:array<object>": embedded }, references: {} }).definitions["lines:array<object>"];
    expect(hydrated).toMatchObject({ description: "Every line", object_schema: { mode: "table", columns: [{ key: "sku", heading: "SKU", data_type: "string" }] } });
  });
});
