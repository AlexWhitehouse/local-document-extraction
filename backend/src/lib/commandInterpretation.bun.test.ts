import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../../../shared/json";
import {
  parseDocumentSearchFilter,
  SearchContractError,
  validateCommandInterpretation,
  type CostCondition,
  type SearchCatalog,
} from "../../../shared/documentSearch";

const catalog: Pick<SearchCatalog, "templates"> = {
  templates: [
    {
      id: "tpl_invoice",
      name: "Invoice",
      current_version: 3,
      fields: [
        { field_id: "invoice_number", name: "Invoice number", data_type: "string", type: "text" },
        { field_id: "total", name: "Total", data_type: "number", type: "number" },
        { field_id: "issued", name: "Issue date", data_type: "date", type: "date" },
        { field_id: "paid", name: "Paid", data_type: "boolean", type: "boolean" },
        { field_id: "lines", name: "Lines", data_type: "array<object>", type: null },
      ],
    },
    {
      id: "tpl_receipt",
      name: "Receipt",
      current_version: 1,
      fields: [{ field_id: "total", name: "Total", data_type: "number", type: "number" }],
    },
  ],
};

const base: JsonObject = { action: "find_documents", args: {}, filter: null, unrecognised: [], notes: [] };

const valid = (overrides: JsonObject) => validateCommandInterpretation({ ...base, ...overrides }, catalog);

const rejects = (overrides: JsonObject) => {
  expect(() => valid(overrides)).toThrow(SearchContractError);
};

const condition = (fields: JsonObject): JsonValue => ({ template_id: "tpl_invoice", field_id: "total", ...fields });

describe("validateCommandInterpretation", () => {
  test("accepts a complete interpretation and normalises values", () => {
    expect(
      valid({
        args: { limit: 5, format: "csv" },
        filter: {
          text: "  acme ",
          statuses: ["failed", "failed"],
          template_ids: ["tpl_invoice"],
          uploaded_from: "2026-10-05",
          uploaded_to: "2026-10-11",
          conditions: [
            condition({ op: "gt", value: "£1,200" }),
            { template_id: "tpl_invoice", field_id: "invoice_number", op: "starts_with", value: " hnh " },
            { template_id: "tpl_invoice", field_id: "paid", op: "is_false" },
            { template_id: "tpl_invoice", field_id: "issued", op: "between", value: "2026-03-01", value2: "2026-03-31" },
          ],
        },
        unrecognised: [" billed "],
        notes: [
          {
            kind: "ambiguous_field",
            text: "Total is on Invoice and Receipt.",
            alternatives: [{ template_id: "tpl_receipt", field_id: "total" }],
          },
          { kind: "matched", text: "Leeds matched Billing address." },
        ],
      }),
    ).toEqual({
      action: "find_documents",
      args: { limit: 5, format: "csv" },
      filter: {
        text: "acme",
        statuses: ["failed"],
        template_ids: ["tpl_invoice"],
        uploaded_from: "2026-10-05",
        uploaded_to: "2026-10-11",
        conditions: [
          { template_id: "tpl_invoice", field_id: "total", op: "gt", value: 1200 },
          { template_id: "tpl_invoice", field_id: "invoice_number", op: "starts_with", value: "hnh" },
          { template_id: "tpl_invoice", field_id: "paid", op: "is_false" },
          { template_id: "tpl_invoice", field_id: "issued", op: "between", value: "2026-03-01", value2: "2026-03-31" },
        ],
      },
      unrecognised: ["billed"],
      notes: [
        {
          kind: "ambiguous_field",
          text: "Total is on Invoice and Receipt.",
          alternatives: [{ template_id: "tpl_receipt", field_id: "total" }],
        },
        { kind: "matched", text: "Leeds matched Billing address." },
      ],
    });
  });

  test("omitted args, unrecognised words and notes default to empty", () => {
    expect(validateCommandInterpretation({ action: "go_to", filter: null }, catalog)).toEqual({
      action: "go_to",
      args: {},
      filter: null,
      unrecognised: [],
      notes: [],
    });
  });

  test("rejects actions and properties outside the contract", () => {
    rejects({ action: "run_sql" });
    rejects({ extra: true });
    rejects({ args: { template: "tpl_invoice" } });
    rejects({ filter: { owner: "me" } });
  });

  test("rejects Templates and fields that aren't in the catalogue", () => {
    rejects({ args: { template_id: "tpl_other" } });
    rejects({ filter: { template_ids: ["tpl_other"] } });
    rejects({ filter: { conditions: [condition({ template_id: "tpl_other", op: "has_value" })] } });
    rejects({ filter: { conditions: [condition({ field_id: "missing", op: "has_value" })] } });
    // Same field ID, but on a Template that doesn't have it.
    rejects({ filter: { conditions: [condition({ template_id: "tpl_receipt", field_id: "issued", op: "has_value" })] } });
    rejects({
      notes: [{ kind: "ambiguous_field", text: "Total", alternatives: [{ template_id: "tpl_receipt", field_id: "issued" }] }],
    });
  });

  test("rejects operators and values that don't suit the field", () => {
    rejects({ filter: { conditions: [condition({ op: "contains", value: "12" })] } });
    rejects({ filter: { conditions: [{ template_id: "tpl_invoice", field_id: "invoice_number", op: "gt", value: 1 }] } });
    rejects({ filter: { conditions: [{ template_id: "tpl_invoice", field_id: "lines", op: "has_value" }] } });
    rejects({ filter: { conditions: [condition({ op: "has_value", value: 1 })] } });
    rejects({ filter: { conditions: [condition({ op: "gt" })] } });
    rejects({ filter: { conditions: [condition({ op: "gt", value: "lots" })] } });
    rejects({ filter: { conditions: [condition({ op: "gt", value: 1, value2: 2 })] } });
    rejects({ filter: { conditions: [condition({ op: "between", value: 10, value2: 2 })] } });
    rejects({ filter: { conditions: [{ template_id: "tpl_invoice", field_id: "issued", op: "eq", value: "2026-02-31" }] } });
    rejects({ filter: { conditions: [{ template_id: "tpl_invoice", field_id: "paid", op: "is_true", value: true }] } });
    rejects({ filter: { conditions: Array.from({ length: 11 }, () => condition({ op: "has_value" })) } });
  });

  test("rejects invalid filter members", () => {
    rejects({ filter: { statuses: ["archived"] } });
    rejects({ filter: { uploaded_from: "2026-10-12", uploaded_to: "2026-10-11" } });
    rejects({ filter: { uploaded_from: "last week" } });
    rejects({ filter: { text: "x".repeat(201) } });
    rejects({ filter: [] });
  });

  test("a cost filter is accepted only when the catalogue says the caller may read costs", () => {
    const cost: CostCondition = { op: "between", value: 0.01, value2: 0.05 };
    const filter = { cost, statuses: ["completed"] };

    // A catalogue without capabilities, or with cost off, can't use cost.
    expect(() => valid({ filter })).toThrow("Only workspace owners and admins can search by cost.");
    expect(() =>
      validateCommandInterpretation({ ...base, filter }, { ...catalog, capabilities: { cost: false } }),
    ).toThrow("Only workspace owners and admins can search by cost.");
    expect(
      validateCommandInterpretation({ ...base, filter }, { ...catalog, capabilities: { cost: true } }).filter,
    ).toEqual({ statuses: ["completed"], cost });
  });

  test("cost filters are USD amounts of 0 or more with comparison operators", () => {
    const read = (cost: JsonValue) => parseDocumentSearchFilter({ cost });
    const invalid = (cost: JsonValue) => expect(() => read(cost)).toThrow(SearchContractError);

    expect(read({ op: "gt", value: 0.03 })).toEqual({ cost: { op: "gt", value: 0.03 } });
    expect(read({ op: "eq", value: 0 })).toEqual({ cost: { op: "eq", value: 0 } });
    expect(read({ op: "between", value: 0.01, value2: 0.01 })).toEqual({ cost: { op: "between", value: 0.01, value2: 0.01 } });

    invalid({ op: "contains", value: 1 });
    invalid({ op: "has_value" });
    invalid({ op: "gt" });
    invalid({ op: "gt", value: "0.03" });
    invalid({ op: "gt", value: -0.01 });
    invalid({ op: "gt", value: 0.01, value2: 0.02 });
    invalid({ op: "between", value: 0.01 });
    invalid({ op: "between", value: 0.05, value2: 0.01 });
    invalid({ op: "gt", value: 1, currency: "GBP" });
    invalid([]);
  });

  test("rejects invalid arguments", () => {
    rejects({ args: { role: "editor" } });
    rejects({ args: { format: "pdf" } });
    rejects({ args: { page: "settings" } });
    rejects({ args: { email: "not an email" } });
    rejects({ args: { limit: 0 } });
    rejects({ args: { limit: 501 } });
    rejects({ args: { limit: 1.5 } });
    rejects({ args: { instruction: " " } });
    rejects({ args: { instruction: "x".repeat(4001) } });
  });

  test("bounds unrecognised words and notes", () => {
    rejects({ unrecognised: Array.from({ length: 21 }, (_, index) => `word${index}`) });
    rejects({ unrecognised: [""] });
    rejects({ unrecognised: [3] });
    rejects({ unrecognised: "billed" });
    rejects({ notes: Array.from({ length: 11 }, () => ({ kind: "matched", text: "x" })) });
    rejects({ notes: [{ kind: "guess", text: "x" }] });
    rejects({ notes: [{ kind: "matched", text: "" }] });
    rejects({ notes: [{ kind: "matched", text: "x".repeat(301) }] });
    rejects({ notes: [{ kind: "matched", text: "x", alternatives: [] }] });
    rejects({
      notes: [
        {
          kind: "ambiguous_field",
          text: "Total",
          alternatives: Array.from({ length: 6 }, () => ({ template_id: "tpl_receipt", field_id: "total" })),
        },
      ],
    });
  });
});
