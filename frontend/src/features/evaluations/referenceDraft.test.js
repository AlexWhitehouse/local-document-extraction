import { expect, it } from "vitest";
import { adaptReferenceDraft } from "./referenceDraft.js";
import { referenceCompatibility, scoreField, validateReference } from "./evaluationScoring.js";
import { parseReferenceSet, serializeReferenceSet, summaryCompatibility } from "./evaluationLibrary.js";
import { parseExpectedAnswerSet } from "../../../../backend/src/lib/evaluationReference.ts";

const column = (key, data_type = "string") => ({ key, heading: key, data_type });

const table = (columns) => ({
  id: "items",
  name: "Items",
  data_type: "array<object>",
  object_schema: { mode: "table", columns },
});

const identity = "items:array<object>";

const set = (field, reference) => ({
  definitions: { [identity]: field },
  references: { [identity]: reference },
});

it("does not infer schema changes from library summaries that omit column definitions", () => {
  const field = table([column("sku")]);
  const summary = { fields: [{ identity, name: "Items", data_type: "array<object>", verified: true }] };

  expect(summaryCompatibility(summary, [field])).toMatchObject({ verified: 1, review: 0 });
});

it("carries both true and false into the new type without mutating or verifying the saved answer", () => {
  const before = table([column("drug"), column("initiation"), column("maintenance")]);
  const after = table([column("drug"), column("initiation", "boolean"), column("maintenance", "boolean")]);

  const reference = {
    verified: true,
    value: [{ drug: "A", initiation: "true", maintenance: "false" }],
    rows: { mode: "position" },
  };

  const original = structuredClone(reference);
  const draft = adaptReferenceDraft(reference, before, after);
  expect(draft).toMatchObject({
    verified: false,
    value: [{ drug: "A", initiation: true, maintenance: false }],
  });
  expect(reference).toEqual(original);
  expect(validateReference(after, draft)).toBe("");
  const verified = { ...draft, verified: true };
  const roundTrip = parseReferenceSet(parseExpectedAnswerSet(serializeReferenceSet(set(after, verified))));
  expect(roundTrip.references[identity].value).toEqual(draft.value);
  expect(scoreField(after, { status: "ok", answer: draft.value }, verified).state).toBe("Match");
});

it("keeps compatible values and statuses, adds empty columns and asks for a removed row identifier", () => {
  const before = table([column("id"), column("quantity", "number"), column("note")]);
  const after = table([column("note"), column("quantity", "number"), column("active", "boolean")]);

  const reference = {
    verified: true,
    value: [{ id: "A", quantity: 0, note: "" }],
    cellStates: [{ note: "ignored", id: "absent" }],
    rows: { mode: "key", key: "id" },
  };

  const draft = adaptReferenceDraft(reference, before, after);
  expect(draft).toMatchObject({
    value: [{ note: "", quantity: 0, active: "" }],
    cellStates: [{ note: "ignored" }],
    rows: { mode: "key", key: "" },
  });
  expect(validateReference(after, draft)).toMatch(/active/);
  draft.cellStates[0].active = "ignored";
  expect(validateReference(after, draft)).toMatch(/identify rows/);
  draft.rows = { mode: "position" };
  expect(validateReference(after, draft)).toBe("");
  expect(() => parseExpectedAnswerSet(serializeReferenceSet(set(after, { ...draft, verified: true })))).not.toThrow();
  expect(reference.value[0].id).toBe("A");
});

it("carries values, cell states and row matching across a unique unchanged column heading", () => {
  const before = table([column("sku"), column("note")]);

  const after = table([
    { ...column("code"), heading: "sku" },
    { ...column("notes"), heading: "note" },
  ]);

  const draft = adaptReferenceDraft(
    { value: [{ sku: "A", note: "" }], rows: { mode: "key", key: "sku" }, cellStates: [{ note: "absent" }] },
    before,
    after,
  );

  expect(draft).toMatchObject({
    value: [{ code: "A", notes: "" }],
    rows: { mode: "key", key: "code" },
    cellStates: [{ notes: "absent" }],
  });
  expect(validateReference(after, draft)).toBe("");
});

it("preserves explicit absence and false when scalar field types change", () => {
  const before = { name: "Active", data_type: "boolean" };
  const after = { ...before, data_type: "string" };
  expect(adaptReferenceDraft({ value: false, verified: true }, before, after)).toMatchObject({
    value: "false",
    verified: false,
  });
  expect(adaptReferenceDraft({ absent: true, verified: true }, before, after)).toMatchObject({
    absent: true,
    verified: false,
  });
});

it.each(["added", "removed", "changed"])(
  "marks %s table columns for review until the adapted answer is verified",
  (change) => {
    const before = table([column("sku"), column("active")]);

    const after = table(
      change === "added"
        ? [...before.object_schema.columns, column("note")]
        : change === "removed"
          ? [column("sku")]
          : [column("sku"), column("active", "boolean")],
    );

    const reference = { verified: true, value: [{ sku: "A", active: "true" }], rows: { mode: "position" } };
    expect(referenceCompatibility(set(before, reference), [after])).toMatchObject({ verified: 0, review: 1 });
    expect(
      scoreField(after, { status: "ok", answer: [{ sku: "A", active: true, note: "x" }] }, reference, before).state,
    ).toBe("Needs review");
  },
);

it("does not require review for column order, instructions or heading changes with stable keys", () => {
  const before = table([column("sku"), column("active", "boolean")]);
  const after = table([{ ...column("active", "boolean"), heading: "Active?", description: "Revised" }, column("sku")]);
  const reference = { verified: true, value: [{ sku: "A", active: false }], rows: { mode: "position" } };
  expect(referenceCompatibility(set(before, reference), [after])).toMatchObject({ verified: 1, review: 0 });
});

it.each([
  ["string", "number", "1,200.50", 1200.5],
  ["number", "string", 0, "0"],
  ["boolean", "string", false, "false"],
  ["string", "boolean", "No", false],
  ["string", "date", "2026-10-04", "2026-10-04"],
  ["date", "string", "2026-10-04", "2026-10-04"],
])("adapts %s to %s for both fields and table cells without automatic verification", (from, to, value, expected) => {
  const before = { name: "Value", data_type: from };
  const after = { ...before, data_type: to };
  const scalar = adaptReferenceDraft({ verified: true, value }, before, after);
  expect(scalar).toMatchObject({ value: expected, verified: false });
  expect(validateReference(after, scalar)).toBe("");

  const cell = adaptReferenceDraft(
    { verified: true, value: [{ value }], rows: { mode: "position" } },
    table([column("value", from)]),
    table([column("value", to)]),
  );

  expect(cell).toMatchObject({ value: [{ value: expected }], verified: false });
  expect(validateReference(table([column("value", to)]), cell)).toBe("");
});

it.each([
  ["boolean", 1],
  ["number", "as required"],
  ["date", "last week"],
])("keeps incompatible %s values visible for correction", (type, value) => {
  const before = { name: "Value", data_type: "string" };
  const after = { ...before, data_type: type };
  const draft = adaptReferenceDraft({ value }, before, after);
  expect(draft.value).toBe(value);
  expect(validateReference(after, draft)).not.toBe("");
});
