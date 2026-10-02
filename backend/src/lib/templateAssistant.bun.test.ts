import { describe, expect, it } from "bun:test";
import { ASSISTANT_LIMITS, diagnoseTemplateDraft, evaluateSelection, identityImpacts, previewRows, validateAssistantOutput, type ProposalGroup, type ProposalOperation, type DraftRecord } from "../../../shared/templateAssistant";
import { validateTemplatePayload } from "./validation";

const field = (name = "Total", description = "Exact amount", data_type = "number") => ({ name, description, data_type });
const column = (heading = "Amount") => ({ heading, description: "Each line amount", data_type: "number" });
const table = () => ({ ...field("Lines", "Line items", "array<object>"), id: "lines", object_schema: { mode: "table", columns: [{ ...column(), key: "amount" }] } });
const draft = (): DraftRecord => ({ name: "Invoice", description: "  Raw metadata  ", fields: [{ ...field(), id: "total" }, table()] });
const group = (operations: ProposalOperation[], id = "g1", dependsOn: string[] = []): ProposalGroup => ({ id, title: "Requested change", rationale: "Apply the user's request", dependsOn, operations });
const output = (groups: ProposalGroup[]) => ({ explanation: "Review these changes", observations: [], groups });
const update = (set: Record<string, unknown>): ProposalOperation => ({ op: "update_field", fieldIndex: 0, expectName: "Total", set });
const addVAT: ProposalOperation = { op: "add_column", fieldIndex: 1, expectName: "Lines", after: null, column: column("VAT rate") };
const validates = (groups: ProposalGroup[], base = draft()) => validateAssistantOutput(output(groups), base, "edit");

describe("shared deterministic Template diagnostics", () => {
  it("accepts incomplete or malformed drafts without mutation or exceptions", () => {
    for (const value of [null, [], "draft", {}, { fields: [null, 7, []] }]) expect(diagnoseTemplateDraft(value).length).toBeGreaterThan(0);
    const base = { name: "", fields: [{ name: "Total", description: "", data_type: "money" }, field("total")] };
    const captured = JSON.stringify(base);
    const issues = diagnoseTemplateDraft(base);
    expect(issues.map((issue) => issue.code)).toEqual(["template.name_required", "field.description_required", "field.type_unsupported", "field.duplicate_identity"]);
    expect(issues[3]?.location).toEqual({ scope: "field", fieldIndex: 1, property: "name", relatedFieldIndex: 0 });
    expect(JSON.stringify(base)).toBe(captured);
  });
  it("diagnoses columns, duplicate normalized identities and table/field counts by position", () => {
    const base = draft();
    base.fields.push(table());
    const columns = base.fields[1]!.object_schema!.columns;
    columns.push({ heading: "amount", key: "", description: "", data_type: "array" }, { heading: "Bad%", key: "", description: "x", data_type: "number" });
    const issues = diagnoseTemplateDraft(base);
    expect(issues.map((issue) => issue.code)).toContain("column.duplicate_key");
    expect(issues.map((issue) => issue.code)).toContain("column.description_required");
    expect(issues.map((issue) => issue.code)).toContain("column.type_unsupported");
    expect(issues.map((issue) => issue.code)).toContain("column.heading_characters");
    expect(issues.map((issue) => issue.code)).toContain("template.multiple_tables");
    expect(diagnoseTemplateDraft({ name: "X", fields: Array.from({ length: 51 }, (_, i) => field(`Field ${i}`)) })[0]?.code).toBe("template.too_many_fields");
  });
  it("uses the same rules in backend saves including missing column descriptions and encoded metadata", () => {
    const valid = draft();
    expect(diagnoseTemplateDraft(valid)).toEqual([]);
    expect(() => validateTemplatePayload(valid)).not.toThrow();
    const stored = validateTemplatePayload(valid);
    expect(diagnoseTemplateDraft(stored)).toEqual([]);
    const malformed = { ...draft(), fields: [{ ...table(), object_schema: { columns: [{ ...column(), description: "" }] } }] };
    expect(() => validateTemplatePayload(malformed)).toThrow("description is required");
    try { validateTemplatePayload(malformed); } catch (error) { expect((error as { diagnostics: unknown }).diagnostics).toEqual(diagnoseTemplateDraft(malformed)); }
    expect(diagnoseTemplateDraft({ name: "Old", fields: [field("Legacy", "Read line items", "object")] })).toEqual([]);
  });
  it("does not normalize away unsupported types or corrupt embedded metadata", () => {
    expect(diagnoseTemplateDraft({ name: "X", fields: [field("X", "Read X", "NUMBER")] })[0]?.code).toBe("field.type_unsupported");
    expect(diagnoseTemplateDraft({ name: "X", fields: [field("X", "Read\n[[OBJECT_SCHEMA]]oops[[/OBJECT_SCHEMA]]", "object")] })[0]?.code).toBe("table.schema_invalid");
  });
});

describe("strict focused proposal contract and application", () => {
  it("adds VAT while preserving every unrelated raw value, identity, record and order", () => {
    const base = draft();
    base.fields[0]!.name = " Total ";
    base.fields[0]!.id = "raw_existing_id";
    base.fields[1]!.object_schema!.columns[0]!.key = "raw_existing_key";
    const before = JSON.stringify(base), groups = [group([addVAT])];
    validates(groups, base);
    const selected = evaluateSelection(base, groups, ["g1"]);
    expect(selected.canApply).toBe(true);
    expect(selected.result?.description).toBe(base.description);
    expect(selected.result?.fields[0]).toBe(base.fields[0]);
    expect(selected.result?.fields[1].object_schema.columns[0]).toBe(base.fields[1]!.object_schema!.columns[0]);
    expect(selected.result?.fields[1].object_schema.columns[1]).toEqual({ ...column("VAT rate"), key: "vat_rate" });
    expect(JSON.stringify(base)).toBe(before);
  });
  it("changes guidance without re-deriving unrelated field identities or losing a stored schema", () => {
    const base = draft();
    base.fields[0]!.id = "kept_raw_identity";
    const result = evaluateSelection(base, [group([update({ description: "Extract amount due" })])], ["g1"]);
    expect(result.result?.fields[0].id).toBe("kept_raw_identity");
    const stored = validateTemplatePayload(draft());
    const groups = [group([{ op: "update_field", fieldIndex: 1, expectName: "Lines", set: { description: "Only taxable line items" } }])];
    const evaluated = evaluateSelection(stored, groups, ["g1"]);
    expect(evaluated.canApply).toBe(true);
    expect(evaluated.result?.fields[1].object_schema.columns[0].heading).toBe("Amount");
    const resaved = validateTemplatePayload(evaluated.result!);
    expect(resaved.fields?.[1]?.description).toContain('"heading":"Amount"');
  });
  it("insertion anchors refer to the base even when the anchor is removed", () => {
    const base = draft(), groups = [group([{ op: "remove_field", fieldIndex: 0, expectName: "Total" }, { op: "add_field", after: 0, field: field("Subtotal") }])];
    const result = evaluateSelection(base, groups, ["g1"]);
    expect(result.canApply).toBe(true);
    expect(result.result?.fields.map((item: any) => item.name)).toEqual(["Subtotal", "Lines"]);
  });
  it("requires exact expected names and headings even when the positions exist", () => {
    const bad: unknown[] = [
      { op: "update_field", fieldIndex: 0, set: { name: "Tax" } },
      { ...update({ name: "Tax" }), expectName: "total" },
      { ...update({ name: "Tax" }), fieldIndex: -1 },
      { ...update({ name: "Tax" }), fieldIndex: 0.5 },
      { op: "remove_column", fieldIndex: 1, expectName: "Lines", columnIndex: 0, expectHeading: "amount" },
      { op: "remove_column", fieldIndex: 1, columnIndex: 0, expectHeading: "Amount" },
      { ...addVAT, after: 9 },
    ];
    for (const operation of bad) expect(() => validates([group([operation as ProposalOperation])])).toThrow();
  });
  it("repairs a missing name using an explicit null target and disambiguates duplicates by position", () => {
    const base = { name: "X", fields: [{ description: "Read value", data_type: "number" }, field("Same"), field("Same")] };
    const groups = [group([{ op: "update_field", fieldIndex: 0, expectName: null, set: { name: "Value" } }, { op: "update_field", fieldIndex: 2, expectName: "Same", set: { name: "Other" } }])];
    expect(evaluateSelection(base, groups, ["g1"]).canApply).toBe(true);
  });
  it("rejects unsupported properties at every nested boundary and values normalization would discard", () => {
    const bad = [
      { ...update({ description: "x" }), extra: true }, update({ id: "invented" }), update({ name: "VAT%" }), update({ object_schema: { columns: [column()] } }), update({ object_schema: null }),
      { ...addVAT, column: { ...column("Tax"), key: "invented" } },
      { ...addVAT, column: column("VAT%") },
      update({ description: "Instructions [[OBJECT_SCHEMA]]{}[[/OBJECT_SCHEMA]]" }),
      { op: "add_field", after: null, field: { ...field("Tax"), object_schema: { columns: [column()] } } },
      { op: "add_field", after: null, field: { ...field("Tax"), object_schema: null } },
    ];
    for (const operation of bad) expect(() => validates([group([operation as ProposalOperation])])).toThrow();
    expect(() => validateAssistantOutput({ ...output([]), template: {} }, draft(), "edit")).toThrow("unsupported property");
    expect(() => validates([group([update({ name: "Tax" })], "__proto__")])).not.toThrow();
  });
  it("rejects oversized responses, groups and operations without truncation", () => {
    expect(() => validateAssistantOutput({ ...output([]), explanation: "x".repeat(ASSISTANT_LIMITS.responseBytes) }, draft(), "edit")).toThrow("64 KiB");
    expect(() => validates(Array.from({ length: 21 }, (_, i) => group([update({ name: "X" })], `g${i}`)))).toThrow("at most 20");
    expect(() => validates([group(Array.from({ length: 26 }, () => update({ name: "X" })))] )).toThrow("1 to 25");
  });
  it("rejects overlaps, deletion conflicts, schema/column conflicts and overlapping writes inside a group", () => {
    const bad: ProposalGroup[][] = [
      [group([update({ name: "Tax" })]), group([update({ name: "Amount" })], "g2")],
      [group([update({ name: "Tax" }), update({ name: "Amount" })])],
      [group([{ op: "remove_field", fieldIndex: 1, expectName: "Lines" }, addVAT])],
      [group([{ op: "update_field", fieldIndex: 1, expectName: "Lines", set: { object_schema: { columns: [column()] } } }, addVAT])],
      [group([{ op: "remove_column", fieldIndex: 1, expectName: "Lines", columnIndex: 0, expectHeading: "Amount" }, { op: "update_column", fieldIndex: 1, expectName: "Lines", columnIndex: 0, expectHeading: "Amount", set: { description: "New instruction" } }])],
    ];
    for (const groups of bad) { expect(() => validates(groups)).toThrow("Conflicting"); expect(evaluateSelection(draft(), groups, groups.map((g) => g.id)).canApply).toBe(false); }
  });
  it("rejects cyclic and unknown dependencies; requires selected dependencies", () => {
    expect(() => validates([group([update({ name: "Tax" })], "g1", ["missing"])])).toThrow("Unknown dependency");
    expect(() => validates([group([update({ name: "Tax" })], "g1", ["g2"]), group([addVAT], "g2", ["g1"])])).toThrow("cycle");
    const groups = [group([update({ name: "Tax" })]), group([addVAT], "g2", ["g1"])];
    validates(groups);
    expect(evaluateSelection(draft(), groups, ["g2"]).canApply).toBe(false);
    expect(evaluateSelection(draft(), groups, ["g1", "g2"]).canApply).toBe(true);
  });
  it("requires atomic table type/schema conversion and a valid final selection", () => {
    const base = { name: "X", fields: [field()] };
    expect(() => validateAssistantOutput(output([group([update({ data_type: "object" })])]), base, "edit")).toThrow("same atomic group");
    const groups = [group([update({ data_type: "object", object_schema: { columns: [column()] } })])];
    expect(evaluateSelection(base, groups, ["g1"]).canApply).toBe(true);
    const splitInGroup = [group([update({ data_type: "object" }), update({ object_schema: { columns: [column()] } })])];
    expect(evaluateSelection(base, splitInGroup, ["g1"]).canApply).toBe(true);
    const invalid = { name: "", fields: [field("Total", "")] };
    const repair = [group([{ op: "set_template", set: { name: "Invoice" } }]), group([update({ description: "Read total" })], "g2")];
    expect(evaluateSelection(invalid, repair, ["g1"]).errors[0]?.code).toBe("field.description_required");
    expect(evaluateSelection(invalid, repair, ["g1", "g2"]).canApply).toBe(true);
  });
  it("discloses complete values, identity removals/renames and type impacts", () => {
    const groups = group([update({ name: "Amount", data_type: "string" }), { op: "remove_column", fieldIndex: 1, expectName: "Lines", columnIndex: 0, expectHeading: "Amount" }]);
    expect(identityImpacts(draft(), groups)).toEqual([{ kind: "renamed", before: "total", after: "amount" }, { kind: "retyped", before: "total", from: "number", to: "string" }, { kind: "removed", before: "lines.amount" }]);
    expect(previewRows(draft(), group([addVAT])).map(({ property, before, after }) => ({ property, before, after }))).toEqual([{ property: "Column name", before: null, after: "VAT rate" }, { property: "Instructions", before: null, after: "Each line amount" }, { property: "Type", before: null, after: "number" }]);
  });
  it("explain-only output cannot stage groups and references must identify supplied evidence", () => {
    expect(() => validateAssistantOutput(output([group([addVAT])]), draft(), "explain")).toThrow("Explain-only");
    const explanation = (reference: unknown) => ({ explanation: "Read the evidence", groups: [], observations: [{ kind: "observation", text: "This result is absent", references: [reference] }] });
    expect(() => validateAssistantOutput(explanation({ scope: "sample" }), draft(), "explain")).toThrow("supplied binary");
    expect(() => validateAssistantOutput(explanation({ scope: "field", fieldIndex: 8 }), draft(), "explain")).toThrow();
    expect(() => validateAssistantOutput(explanation({ scope: "sample", page: 12 }), draft(), "explain", { sampleSupplied: true })).toThrow("unsupported property");
    const historic = validateTemplatePayload(draft());
    const context = { resultFields: historic.fields, result: { lines: { columns: ["Amount"], rows: [{ amount: null }] } } };
    expect(() => validateAssistantOutput(explanation({ scope: "result", fieldId: "lines", columnKey: "amount" }), draft(), "explain", context)).not.toThrow();
    expect(() => validateAssistantOutput(explanation({ scope: "result", fieldId: "lines", columnKey: "imaginary" }), draft(), "explain", context)).toThrow("historical column");
    expect(() => validateAssistantOutput(explanation({ scope: "result", fieldId: "total" }), draft(), "explain", context)).toThrow("supplied historical");
  });
});
