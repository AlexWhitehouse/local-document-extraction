import { describe, expect, it } from "vitest";
import { diagnoseTemplateDraft, validateSuggestionOutput } from "../../../../shared/templateAssistant.ts";
import { suggestTemplateRequests } from "./templateAssistantSuggestions.js";

const invoice = {
  name: "Invoice",
  description: "",
  fields: [
    { id: "invoice_date", name: "Invoice Date", data_type: "date", description: "Date the invoice was issued" },
    {
      id: "line_items",
      name: "Line Items",
      data_type: "array<object>",
      description: "Each line",
      object_schema: {
        mode: "table",
        columns: [
          { key: "quantity", heading: "Quantity", data_type: "number", description: "Units" },
          { key: "unit_price", heading: "Unit Price", data_type: "number", description: "Price per unit" },
        ],
      },
    },
  ],
};

const suggest = (draft, action, evidence = {}) =>
  suggestTemplateRequests({ draft, issues: diagnoseTemplateDraft(draft), action, ...evidence });

describe("suggestTemplateRequests", () => {
  it("suggests only additions with names, types and extraction instructions", () => {
    const suggestions = suggest(invoice, "edit");
    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      "Add a Description column to Line Items",
      "Add a Unit of Measure column to Line Items",
    ]);

    for (const suggestion of suggestions) {
      expect(suggestion.request).toContain("type string");
      expect(suggestion.request).toContain("Extract");
      expect(suggestion.request).toContain("empty when absent");
    }

    expect(() =>
      validateSuggestionOutput({
        suggestions: suggestions.map(({ label, request, reason }) => ({ label, request, reason })),
      }),
    ).not.toThrow();
  });

  it("puts confirmed problems first only on Issues and excludes repairs from additions", () => {
    const broken = {
      ...invoice,
      fields: [...invoice.fields, { id: "", name: "Total", data_type: "number", description: "" }],
    };

    const explain = suggest(broken, "explain");
    const edit = suggest(broken, "edit");
    expect(explain[0].label).toBe("Why won’t this Template save?");
    expect(explain.some((suggestion) => suggestion.label === "What should the “Total” instructions say?")).toBe(true);
    expect(explain.every((suggestion) => suggestion.label.endsWith("?"))).toBe(true);
    expect(edit).toEqual(suggest(invoice, "edit"));
  });

  it("does not invent additions or sample observations for an empty draft", () => {
    const empty = { name: "", description: "", fields: [{ id: "", name: "", data_type: "string", description: "" }] };
    const file = { name: "invoice-with-vat.pdf" };
    expect(suggest(empty, "edit", { file })).toEqual([]);
    expect(suggest(invoice, "edit", { file })).toEqual(suggest(invoice, "edit"));
    expect(suggest(invoice, "explain", { file })).toEqual(suggest(invoice, "explain"));
  });

  it("frames concerns as review questions when the Template is valid", () => {
    expect(diagnoseTemplateDraft(invoice)).toEqual([]);
    const suggestions = suggest(invoice, "explain");
    expect(suggestions.map((suggestion) => suggestion.label)).toContain(
      "Is “Invoice Date” clear about day and month order?",
    );
    expect(suggestions.every((suggestion) => suggestion.reason.startsWith("Review"))).toBe(true);
    expect(suggestions.some((suggestion) => /save|invalid/i.test(suggestion.label))).toBe(false);

    const precise = {
      name: "Dates",
      fields: [
        {
          name: "Invoice Date",
          data_type: "date",
          description: "Extract the invoice issue date in ISO 8601 YYYY-MM-DD format.",
        },
      ],
    };

    expect(suggest(precise, "explain")).toEqual([]);
  });

  it("uses historical results as review context without claiming they are incorrect", () => {
    const job = { job_id: "job_1", original_filename: "march.pdf", template_version: 2, source_available: false };
    expect(suggest(invoice, "explain", { job }).map((suggestion) => suggestion.label)).toEqual(
      expect.arrayContaining([
        "What can march.pdf tell us about existing fields?",
        "What can you tell from the stored result alone?",
      ]),
    );
    expect(suggest(invoice, "edit", { job })).toEqual(suggest(invoice, "edit"));
  });

  it("recognizes equivalent columns in their headings or instructions", () => {
    const covered = structuredClone(invoice);
    covered.fields[1].object_schema.columns.push(
      { heading: "Details", description: "The product or service description", data_type: "string" },
      { heading: "Measure", description: "The unit of measurement for the quantity", data_type: "string" },
    );
    expect(suggest(covered, "edit")).toEqual([]);
    covered.fields[1].object_schema.columns.at(-1).heading = "Units";
    covered.fields[1].object_schema.columns.at(-1).description = "kg or hours";
    expect(suggest(covered, "edit")).toEqual([]);
  });

  it("does not add columns to a full or ambiguous table schema", () => {
    const full = structuredClone(invoice);
    full.fields[1].object_schema.columns.push(
      ...Array.from({ length: 18 }, (_, index) => ({
        heading: `Value ${index}`,
        description: "A value",
        data_type: "number",
      })),
    );
    expect(suggest(full, "edit")).toEqual([]);
    expect(suggest({ ...invoice, fields: [...invoice.fields, invoice.fields[1]] }, "edit")).toEqual([]);
  });

  it("does not suggest invoice columns for an unrelated quantity table", () => {
    const stock = {
      name: "Stock count",
      fields: [
        {
          name: "Inventory",
          description: "Warehouse counts",
          data_type: "array<object>",
          object_schema: {
            columns: [{ heading: "Quantity", description: "The count and unit of measure", data_type: "string" }],
          },
        },
      ],
    };

    expect(suggest(stock, "edit")).toEqual([]);
  });
});
