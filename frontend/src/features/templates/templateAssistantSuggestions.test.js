import { describe, expect, it } from "vitest";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { suggestTemplateRequests } from "./templateAssistantSuggestions.js";

const invoice = {
  name: "Invoice",
  description: "",
  fields: [
    { id: "invoice_date", name: "Invoice Date", data_type: "date", description: "Date the invoice was issued" },
    { id: "line_items", name: "Line Items", data_type: "array<object>", description: "Each line", object_schema: { mode: "table", columns: [
      { key: "quantity", heading: "Quantity", data_type: "number", description: "Units" },
      { key: "unit_price", heading: "Unit Price", data_type: "number", description: "Price per unit" },
    ] } },
  ],
};
const suggest = (draft, action, evidence = {}) => suggestTemplateRequests({ draft, issues: diagnoseTemplateDraft(draft), action, ...evidence });

describe("suggestTemplateRequests", () => {
  it("suggests edits from the open Template's fields and columns", () => {
    const labels = suggest(invoice, "edit").map(suggestion => suggestion.label);
    expect(labels).toEqual(expect.arrayContaining(["Add VAT rate to each line item", "Dates are day-first", "Add a Description column to Line Items"]));
  });

  it("differs between tabs and puts the draft's problems first", () => {
    const broken = { ...invoice, fields: [...invoice.fields, { id: "", name: "Total", data_type: "number", description: "" }] };
    const explain = suggest(broken, "explain");
    const edit = suggest(broken, "edit");
    expect(explain[0].label).toBe("Why won’t this Template save?");
    expect(edit[0].label).toBe("Add instructions for “Total”");
    expect(explain.map(suggestion => suggestion.label)).not.toEqual(edit.map(suggestion => suggestion.label));
  });

  it("offers starting points for an empty draft and reflects chosen evidence", () => {
    const empty = { name: "", description: "", fields: [{ id: "", name: "", data_type: "string", description: "" }] };
    expect(suggest(empty, "edit").map(suggestion => suggestion.label)).toContain("Add a Document Number field");
    const job = { job_id: "job_1", original_filename: "march.pdf", template_version: 2, source_available: false };
    expect(suggest(invoice, "explain", { job }).map(suggestion => suggestion.label)).toEqual(expect.arrayContaining(["Why did march.pdf come out this way?", "What can you tell from the stored result alone?"]));
  });
});
