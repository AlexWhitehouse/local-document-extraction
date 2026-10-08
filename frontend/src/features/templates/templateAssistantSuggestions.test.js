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

const suggest = (draft, evidence = {}) =>
  suggestTemplateRequests({ draft, issues: diagnoseTemplateDraft(draft), ...evidence });

const labels = (suggestions) => suggestions.map((suggestion) => suggestion.label);

const ADDITIONS = ["Add a Description column to Line Items", "Add a Unit of Measure column to Line Items"];

describe("suggestTemplateRequests", () => {
  it("lists possible issues first, then additions with names, types and extraction instructions", () => {
    const suggestions = suggest(invoice);
    expect(labels(suggestions)).toEqual([
      "Is “Invoice Date” clear about day and month order?",
      "How will “Line Items” handle tables that continue onto another page?",
      "Is “Line Items” specific enough to extract reliably?",
      ...ADDITIONS,
    ]);

    for (const suggestion of suggestions.filter((entry) => ADDITIONS.includes(entry.label))) {
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

  it("puts confirmed problems first and drops review questions while the draft can't save", () => {
    const broken = {
      ...invoice,
      fields: [...invoice.fields, { id: "", name: "Total", data_type: "number", description: "" }],
    };

    const suggestions = suggest(broken);
    expect(suggestions[0].label).toBe("Fix the problems that stop this template saving");
    expect(labels(suggestions)).toContain("What should the “Total” instructions say?");
    expect(labels(suggestions).some((label) => label.startsWith("Is “"))).toBe(false);
    expect(labels(suggestions).slice(-2)).toEqual(ADDITIONS);
  });

  it("does not invent additions or sample observations for an empty draft", () => {
    const empty = { name: "", description: "", fields: [{ id: "", name: "", data_type: "string", description: "" }] };
    const file = { name: "invoice-with-vat.pdf" };
    expect(labels(suggest(empty, { file }))).toEqual(["Fix the problems that stop this template saving"]);
    expect(suggest(invoice, { file })).toEqual(suggest(invoice));
  });

  it("frames concerns as review questions when the Template is valid", () => {
    expect(diagnoseTemplateDraft(invoice)).toEqual([]);
    const questions = suggest(invoice).filter((suggestion) => !ADDITIONS.includes(suggestion.label));
    expect(questions.every((suggestion) => suggestion.reason.startsWith("Review"))).toBe(true);
    expect(questions.some((suggestion) => /save|invalid/i.test(suggestion.label))).toBe(false);

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

    expect(suggest(precise)).toEqual([]);
  });

  it("uses historical results as review context without claiming they are incorrect", () => {
    const job = { job_id: "job_1", original_filename: "march.pdf", template_version: 2, source_available: false };
    expect(labels(suggest(invoice, { job }))[0]).toBe("What can march.pdf tell us about existing fields?");
  });

  it("starts with the fields a document's result shows are weak", () => {
    const job = {
      job_id: "job_1",
      original_filename: "march.pdf",
      template_version: 2,
      results: [
        { field_id: "invoice_date", name: "Invoice Date", status: "not_found" },
        { field_id: "total", name: "Total", status: "extracted", confidence: 0.4 },
        { field_id: "number", name: "Number", status: "extracted", confidence: 0.95 },
      ],
    };

    const [first] = suggest(invoice, { job });
    expect(first.label).toBe("Improve the 2 weak fields");
    expect(first.reason).toBe("“Invoice Date”, “Total” were missing, unreadable or low confidence in march.pdf");
    expect(first.request).toContain("Improve the instructions for “Invoice Date”, “Total”.");
  });

  it("starts with the fields that failed verified expected answers", () => {
    const failure = (field_name) => ({ field_name });

    const evaluation = {
      evidence: {
        documents: [
          { name: "a.pdf", failures: [failure("Invoice Date")] },
          { name: "b.pdf", failures: [failure("Invoice Date")] },
        ],
      },
    };

    const [first] = suggest(invoice, { evaluation });
    expect(first.label).toBe("Improve “Invoice Date”");
    expect(first.request).toBe(
      "Improve the instructions for “Invoice Date” so they match the verified expected answers.",
    );
  });

  it("recognizes equivalent columns in their headings or instructions", () => {
    const covered = structuredClone(invoice);
    covered.fields[1].object_schema.columns.push(
      { heading: "Details", description: "The product or service description", data_type: "string" },
      { heading: "Measure", description: "The unit of measurement for the quantity", data_type: "string" },
    );
    const additions = (draft) => labels(suggest(draft)).filter((label) => label.startsWith("Add "));
    expect(additions(covered)).toEqual([]);
    covered.fields[1].object_schema.columns.at(-1).heading = "Units";
    covered.fields[1].object_schema.columns.at(-1).description = "kg or hours";
    expect(additions(covered)).toEqual([]);
  });

  it("does not add columns to a full or ambiguous table schema", () => {
    const additions = (draft) => labels(suggest(draft)).filter((label) => label.startsWith("Add "));
    const full = structuredClone(invoice);
    full.fields[1].object_schema.columns.push(
      ...Array.from({ length: 18 }, (_, index) => ({
        heading: `Value ${index}`,
        description: "A value",
        data_type: "number",
      })),
    );
    expect(additions(full)).toEqual([]);
    expect(additions({ ...invoice, fields: [...invoice.fields, invoice.fields[1]] })).toEqual([]);
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

    expect(labels(suggest(stock)).filter((label) => label.startsWith("Add "))).toEqual([]);
  });
});
