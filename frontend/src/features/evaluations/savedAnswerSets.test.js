import { describe, expect, it } from "vitest";
import {
  documentCompatibility,
  fieldIdentity,
  linkAlignments,
  referenceCompatibility,
  scoreCandidate,
} from "./evaluationScoring.js";
import { documentDirty, parseReferenceSet, serializeReferenceSet } from "./evaluationLibrary.js";

const field = (name, type = "string") => ({ id: name.toLowerCase(), name, data_type: type, description: "" });

const table = {
  id: "items",
  name: "Items",
  data_type: "array<object>",
  description: "",
  object_schema: {
    mode: "table",
    columns: [
      { key: "sku", heading: "SKU", data_type: "string" },
      { key: "qty", heading: "Qty", data_type: "number" },
    ],
  },
};

const verified = (value) => ({ verified: true, absent: false, exact: false, value });

const set = (entries) => ({
  definitions: Object.fromEntries(entries.map(([f]) => [fieldIdentity(f), f])),
  references: Object.fromEntries(
    entries.flatMap(([field, reference]) => (reference ? [[fieldIdentity(field), reference]] : [])),
  ),
});

const names = [field("Name"), field("Code"), field("Date"), field("City"), field("Ref")];

describe("Saved Expected answer sets", () => {
  it("keeps table cell statuses through library serialization and detects status-only edits", () => {
    const reference = {
      ...verified([{ sku: "A" }, { sku: "B", qty: "" }]),
      rows: { mode: "key", key: "sku" },
      cellStates: [{ qty: "absent" }, { qty: "ignored" }],
    };

    const original = set([[table, reference]]);
    const serialized = serializeReferenceSet(original);
    expect(serialized.references["items:array<object>"].cellStates).toEqual(reference.cellStates);
    expect(serializeReferenceSet(parseReferenceSet(serialized))).toEqual(serialized);
    const changed = structuredClone(original);
    changed.references["items:array<object>"].cellStates[0].qty = "ignored";
    expect(documentDirty({ kind: "saved", base: original, reference: changed })).toBe(true);
  });
  it("reuses same-name answers, flags type changes for review and keeps omitted answers visible", () => {
    const saved = set([
      [field("Total", "string"), verified("1,020.00 GBP")],
      [names[0], verified("x")],
      [field("Amount due", "number"), verified("1020")],
    ]);

    const compatibility = referenceCompatibility(saved, [field("Total", "number"), names[0], field("New")]);
    expect(compatibility.rows.map((r) => r.state)).toEqual(["review", "verified", "unverified"]);
    expect(compatibility.rows[0].from).toBe("total:string");
    expect(compatibility.omitted).toEqual(["amount due:number"]);
    expect(compatibility).toMatchObject({ verified: 1, review: 1, total: 3 });
  });
  it("serializes only reference inputs, losslessly, and never verifies anything", () => {
    const embedded = {
      id: "lines",
      name: "Lines",
      data_type: "array<object>",
      description:
        'Every line\n[[OBJECT_SCHEMA]]{"mode":"table","columns":[{"key":"sku","heading":"SKU","data_type":"string"}]}[[/OBJECT_SCHEMA]]',
    };

    const working = {
      definitions: {
        "total:number": { ...field("Total", "number"), extra: "ignored" },
        "flag:boolean": field("Flag", "boolean"),
        "items:array<object>": table,
        "stray:string": field("Other"),
      },
      references: {
        "total:number": { verified: true, absent: false, exact: false, value: 0 },
        "flag:boolean": { verified: false, value: false, rows: { mode: "", key: "" } },
        "items:array<object>": { verified: true, absent: true, exact: false, value: "" },
        "missing:string": verified("x"),
      },
    };

    const serialized = serializeReferenceSet(working);
    expect(Object.keys(serialized)).toEqual(["version", "definitions", "references"]);
    expect(Object.keys(serialized.definitions)).toEqual(["total:number", "flag:boolean", "items:array<object>"]);
    expect(serialized.definitions["total:number"]).toEqual({
      id: "total",
      name: "Total",
      data_type: "number",
      description: "",
    });
    expect(serialized.definitions["items:array<object>"].object_schema.mode).toBe("table");
    expect(serialized.references).toEqual({
      "total:number": { verified: true, absent: false, exact: false, value: 0 },
      "flag:boolean": { verified: false, absent: false, exact: false, value: false },
      "items:array<object>": { verified: true, absent: true, exact: false },
    });
    const round = parseReferenceSet(serialized);
    expect(serializeReferenceSet(round)).toEqual(serialized);
    expect(documentDirty({ kind: "saved", base: round, reference: parseReferenceSet(serialized) })).toBe(false);

    // A table schema embedded in a Template description becomes an explicit object_schema.
    const hydrated = serializeReferenceSet({ definitions: { "lines:array<object>": embedded }, references: {} })
      .definitions["lines:array<object>"];

    expect(hydrated).toMatchObject({
      description: "Every line",
      object_schema: { mode: "table", columns: [{ key: "sku", heading: "SKU", data_type: "string" }] },
    });
  });
});

describe("Links from renamed fields to saved answers", () => {
  it("scores a linked field against the saved answer, and leaves it unscored and omitted without the link", () => {
    const old = field("Amount due", "number"),
      total = field("Total", "number");

    const document = {
      key: "d",
      reference: set([[old, verified("3420")]]),
      links: { [fieldIdentity(total)]: fieldIdentity(old) },
    };

    const result = (fields) => ({ result: { fields, raw: [{ field_id: "total", status: "ok", answer: 3420 }] } });

    const linked = scoreCandidate(
      result([total]),
      document.reference.references,
      document.reference.definitions,
      linkAlignments(document.links, [total]),
    );

    expect(linked.byField.total.state).toBe("Match");
    expect(documentCompatibility(document, [total])).toMatchObject({ verified: 1, omitted: [] });
    const unlinked = scoreCandidate(result([total]), document.reference.references, document.reference.definitions, {});
    expect(unlinked.byField.total.state).toBe("Unscored");
    expect(documentCompatibility({ ...document, links: {} }, [total]).omitted).toEqual([fieldIdentity(old)]);
  });
});
