import { expect, it } from "vitest";
import { acceptedReference, planAcceptAnswers, planChanges } from "./acceptAnswers.js";

const field = (id, name, data_type, extra = {}) => ({ id, name, data_type, ...extra });

const items = field("items", "Items", "array<object>", {
  object_schema: { columns: [{ key: "sku", heading: "SKU", data_type: "string" }] },
});

const fields = [
  field("total", "Total", "number"),
  field("supplier", "Supplier", "string"),
  field("due", "Due", "date"),
  field("paid", "Paid", "boolean"),
  field("notes", "Notes", "object"),
  items,
  field("po", "PO", "string"),
  field("ref", "Reference", "string"),
];

const document = (references = {}, definitions = {}) => ({
  key: "doc",
  name: "invoice.pdf",
  reference: { references, definitions },
});

const candidate = (raw, resultFields = fields) => ({ id: "c1", result: { fields: resultFields, raw } });

const raw = [
  { field_id: "total", status: "ok", answer: "1,200" },
  { field_id: "supplier", status: "ok", answer: "Fenwick" },
  { field_id: "due", status: "ok", answer: "08/09/2026" },
  { field_id: "paid", status: "ok", answer: "yes" },
  { field_id: "notes", status: "ok", answer: { a: 1 } },
  { field_id: "items", status: "ok", answer: [{ sku: "A" }] },
  { field_id: "po", status: "not_found", answer: null },
  { field_id: "ref", status: "error", answer: null },
];

const names = (list) => list.map((item) => item.name);

it("sets every usable answer as verified and leaves tables with rows and failed answers for review", () => {
  const plan = planAcceptAnswers({ document: document(), candidate: candidate(raw) });

  expect(names(plan.set)).toEqual(["Total", "Supplier", "Due", "Paid", "PO"]);
  expect(plan.set.map((item) => item.value)).toEqual([
    { verified: true, absent: false, exact: false, value: "1,200" },
    { verified: true, absent: false, exact: false, value: "Fenwick" },
    // An ambiguous date is read day first, as candidates are scored, and saved as an ISO date.
    { verified: true, absent: false, exact: false, value: "2026-09-08" },
    { verified: true, absent: false, exact: false, value: "yes" },
    // Not found becomes the explicit "not in document" answer.
    { verified: true, absent: true, exact: false, value: "" },
  ]);
  // Objects aren't scored, so they are not part of the plan at all.
  expect(names(plan.review)).toEqual(["Items", "Reference"]);
  expect(plan.conflicts).toEqual([]);
  expect(plan.matching).toEqual([]);
});

it("keeps differing verified answers unless overwritten and counts matching ones", () => {
  const plan = planAcceptAnswers({
    document: document(
      {
        "total:number": { verified: true, value: 1200 },
        "supplier:string": { verified: true, value: "Harbour", exact: true },
        "paid:boolean": { verified: false, value: "no" },
      },
      { "supplier:string": field("supplier", "Supplier", "string") },
    ),
    candidate: candidate(raw.slice(0, 4), fields.slice(0, 4)),
  });

  expect(names(plan.matching)).toEqual(["Total"]);
  expect(names(plan.conflicts)).toEqual(["Supplier"]);
  expect(plan.conflicts[0]).toMatchObject({
    current: { verified: true, value: "Harbour" },
    value: { verified: true, value: "Fenwick", exact: true },
  });
  // An unverified draft is not protected.
  expect(names(plan.set)).toEqual(["Due", "Paid"]);
  expect(names(planChanges(plan, false))).toEqual(["Due", "Paid"]);
  expect(names(planChanges(plan, true))).toEqual(["Due", "Paid", "Supplier"]);
});

it("treats an answer verified for the field's earlier type as differing, replaced only on overwrite", () => {
  const plan = planAcceptAnswers({
    document: document({ "total:string": { verified: true, value: "ten" } }, { "total:string": field("t", "Total", "string") }),
    candidate: candidate(raw.slice(0, 1), fields.slice(0, 1)),
  });

  expect(plan.conflicts).toEqual([expect.objectContaining({ identity: "total:number", from: "total:string" })]);
  expect(plan.set).toEqual([]);
});

it("accepts not found for a table and follows links to saved answers", () => {
  const linked = field("amount", "Amount", "number");

  const plan = planAcceptAnswers({
    document: {
      ...document({ "total:number": { verified: true, value: 5 } }, { "total:number": field("total", "Total", "number") }),
      links: { "amount:number": "total:number" },
    },
    candidate: candidate(
      [
        { field_id: "amount", status: "ok", answer: 7 },
        { field_id: "items", status: "not_found", answer: null },
      ],
      [linked, items],
    ),
  });

  expect(plan.conflicts).toEqual([expect.objectContaining({ identity: "total:number", name: "Total" })]);
  expect(plan.set).toEqual([
    expect.objectContaining({ identity: "items:array<object>", value: expect.objectContaining({ absent: true }) }),
  ]);
});

it("doesn't accept a value that isn't valid for the field", () => {
  expect(acceptedReference(field("n", "N", "number"), { status: "ok", answer: "about ten" })).toBeNull();
  expect(acceptedReference(field("n", "N", "number"), undefined)).toBeNull();
  expect(planAcceptAnswers({ document: document(), candidate: { id: "c1", result: null } }).set).toEqual([]);
});
