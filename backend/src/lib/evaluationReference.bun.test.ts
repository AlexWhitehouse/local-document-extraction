import { expect, test } from "bun:test";

import { MAX_REFERENCE_DEFINITIONS, parseExpectedAnswerSet, referenceFields } from "./evaluationReference";

const scalar = (name: string, data_type: string) => ({ id: name.toLowerCase(), name, data_type, description: "" });
const lines = {
  id: "lines", name: "Lines", data_type: "array<object>", description: "",
  object_schema: { mode: "table", columns: [
    { key: "sku", heading: "SKU", data_type: "string" },
    { key: "qty", heading: "Qty", data_type: "number" },
  ] },
};
const set = (definitions: Record<string, unknown>, references: Record<string, unknown> = {}) => ({ version: 1, definitions, references });
const rejects = (input: unknown, message: RegExp) => expect(() => parseExpectedAnswerSet(input)).toThrow(message);

test("zero, false and verified absence stay distinct and round-trip losslessly", () => {
  const input = set(
    { "total:number": scalar("Total", "number"), "paid:boolean": scalar("Paid", "boolean"), "po:string": scalar("PO", "string") },
    {
      "total:number": { verified: true, absent: false, exact: false, value: 0 },
      "paid:boolean": { verified: true, absent: false, exact: false, value: false },
      "po:string": { verified: true, absent: true, exact: false, value: "" },
    },
  );
  const stored = JSON.parse(JSON.stringify(parseExpectedAnswerSet(input)));
  expect(stored).toEqual(input);
  expect(stored.references["total:number"].value).toBe(0);
  expect(stored.references["paid:boolean"].value).toBe(false);
  expect(stored.references["po:string"]).toMatchObject({ absent: true, verified: true });
});

test("unverified drafts are kept as drafts and never become verified", () => {
  const input = set(
    { "total:number": scalar("Total", "number"), "lines:array<object>": lines, "notes:string": scalar("Notes", "string") },
    {
      // Neither draft would pass verification: a non-number, and a partial table without a row choice.
      "total:number": { verified: false, value: "about twelve" },
      "lines:array<object>": { verified: false, value: [{ sku: "A" }], rows: { mode: "", key: "" } },
    },
  );
  const parsed = parseExpectedAnswerSet(input);
  expect(parsed.references["total:number"]).toEqual({ verified: false, value: "about twelve" });
  expect(referenceFields(parsed)).toEqual([
    { identity: "total:number", name: "Total", data_type: "number", verified: false },
    { identity: "lines:array<object>", name: "Lines", data_type: "array<object>", verified: false },
    { identity: "notes:string", name: "Notes", data_type: "string", verified: false },
  ]);
});

test("verified scalars follow the browser scorer's type rules", () => {
  const verify = (data_type: string, value: unknown) => parseExpectedAnswerSet(set(
    { [`field:${data_type}`]: scalar("Field", data_type) },
    { [`field:${data_type}`]: { verified: true, value } },
  ));
  for (const value of ["$1,234.50", "-3", 7.25]) expect(() => verify("number", value)).not.toThrow();
  for (const value of ["1,23", "twelve", "", null]) expect(() => verify("number", value)).toThrow(/not a valid number/);
  for (const value of ["2026-02-28", "14/03/2026", "March 3, 2026"]) expect(() => verify("date", value)).not.toThrow();
  // Ambiguous day/month order and impossible dates are rejected, exactly like the scorer.
  for (const value of ["03/04/2026", "2026-02-30"]) expect(() => verify("date", value)).toThrow(/not a valid date/);
  for (const value of ["yes", "False", true]) expect(() => verify("boolean", value)).not.toThrow();
  expect(() => verify("boolean", "maybe")).toThrow(/not a valid boolean/);
  expect(() => verify("string", "   ")).toThrow(/not a valid string/);
  expect(() => verify("object", { a: 1 })).toThrow(/not automatically scored/);
});

test("a verified table must be complete, type-valid and have a unique row identifier", () => {
  const verifyTable = (answer: Record<string, unknown>) => parseExpectedAnswerSet(set({ "lines:array<object>": lines }, { "lines:array<object>": { verified: true, ...answer } }));
  const complete = [{ sku: "A", qty: 1 }, { sku: "B", qty: "2" }];
  expect(() => verifyTable({ value: complete, rows: { mode: "key", key: "sku" } })).not.toThrow();
  expect(() => verifyTable({ value: complete, rows: { mode: "position", key: "" } })).not.toThrow();
  expect(() => verifyTable({ value: [{ sku: "A" }], rows: { mode: "position" } })).toThrow(/complete table/);
  expect(() => verifyTable({ value: [{ sku: "A", qty: "many" }], rows: { mode: "position" } })).toThrow(/complete table/);
  expect(() => verifyTable({ value: complete, rows: { mode: "", key: "" } })).toThrow(/row-matching choice/);
  expect(() => verifyTable({ value: complete })).toThrow(/row-matching choice/);
  expect(() => verifyTable({ value: complete, rows: { mode: "key", key: "colour" } })).toThrow(/one of its columns/);
  expect(() => verifyTable({ value: [{ sku: "A", qty: 1 }, { sku: "a!", qty: 2 }], rows: { mode: "key", key: "sku" } })).toThrow(/unique/);
  expect(() => verifyTable({ absent: true, value: "" })).not.toThrow();
  expect(() => parseExpectedAnswerSet(set({ "lines:array<object>": { ...lines, object_schema: undefined } }, { "lines:array<object>": { verified: true, value: complete, rows: { mode: "position" } } })))
    .toThrow(/not automatically scored/);
});

test("identity mismatches, orphan answers, unknown keys and bad table schemas are rejected", () => {
  rejects(set({ "total:string": scalar("Total", "number") }), /does not match its name and data type/);
  rejects(set({ " total :number": scalar("Total", "number") }), /does not match/);
  expect(() => parseExpectedAnswerSet(set({ "total:number": scalar("  TOTAL ", "number") }))).not.toThrow();
  rejects(set({}, { "total:number": { verified: false } }), /has no field definition/);
  rejects({ ...set({}), candidates: [] }, /unsupported property: candidates/);
  rejects(set({ "total:number": { ...scalar("Total", "number"), alignment: "x" } }), /unsupported property: alignment/);
  rejects(set({ "total:number": scalar("Total", "number") }, { "total:number": { verified: true, value: 1, score: 1 } }), /unsupported property: score/);
  rejects(set({ "total:number": scalar("Total", "number") }, { "total:number": { verified: "yes", value: 1 } }), /must be booleans/);
  rejects({ version: 2, definitions: {}, references: {} }, /version must be 1/);
  const columns = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `c${index}`, heading: `C${index}`, data_type: "string" }));
  rejects(set({ "lines:array<object>": { ...lines, object_schema: { mode: "table", columns: [] } } }), /1 to 20 columns/);
  rejects(set({ "lines:array<object>": { ...lines, object_schema: { mode: "table", columns: columns(21) } } }), /1 to 20 columns/);
  rejects(set({ "lines:array<object>": { ...lines, object_schema: { mode: "table", columns: [{ key: "a", heading: "A", data_type: "array" }] } } }), /scalar data types/);
  rejects(set({ "total:number": { ...scalar("Total", "number"), object_schema: lines.object_schema } }), /only describe a table schema/);
});

test("size and definition-count limits are enforced", () => {
  const definitions = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${index}:string`, scalar(`F${index}`, "string")]));
  expect(() => parseExpectedAnswerSet(set(definitions(MAX_REFERENCE_DEFINITIONS)))).not.toThrow();
  rejects(set(definitions(MAX_REFERENCE_DEFINITIONS + 1)), /at most 500/);
  const large = set({ "notes:string": scalar("Notes", "string") }, { "notes:string": { verified: true, value: "x".repeat(1024 * 1024) } });
  expect(() => parseExpectedAnswerSet(large)).toThrow(expect.objectContaining({ status: 413, code: "reference_too_large" }));
});
