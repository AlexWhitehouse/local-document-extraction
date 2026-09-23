import { describe, expect, it } from "bun:test";

import type { FieldDefinition } from "../lib/types";
import { normalizeModelResults } from "./modelResultNormalizer";

describe("normalizeModelResults", () => {
  const numericField: FieldDefinition = { id: "total", name: "Total", description: "Invoice total", data_type: "number" };
  it.each(["N/A", "", "   ", "(123.45)", "12 apples", "1,23", "1.2.3", "Infinity", "1.234,56", "12£50"])("preserves unsupported numeric answer %j as invalid", (answer) => {
    expect(normalizeModelResults([numericField], [{ field_id: "total", status: "ok", answer }])[0])
      .toMatchObject({ status: "invalid_type", answer, normalized_value: null });
  });
  it.each([["1e3", 1000], ["-12.50", -12.5], [" 0 ", 0], [".25", 0.25], [12, 12], ["£12.50", 12.5], ["-$1,234.50", -1234.5], ["€1,000", 1000]])("normalizes the complete numeric value %j", (answer, expected) => {
    expect(normalizeModelResults([numericField], [{ field_id: "total", status: "ok", answer }])[0])
      .toMatchObject({ status: "ok", answer: expected, normalized_value: String(expected) });
  });
  it("normalizes date field answers to dd/mm/yyyy before persistence", () => {
    const fields: FieldDefinition[] = [
      {
        id: "invoice_date",
        name: "Invoice Date",
        description: "The invoice date",
        data_type: "date",
      },
    ];

    expect(
      normalizeModelResults(fields, [
        {
          field_id: "invoice_date",
          status: "ok",
          answer: "2023-09-01",
        },
      ]),
    ).toEqual([
      {
        field_id: "invoice_date",
        status: "ok",
        answer: "01/09/2023",
        normalized_value: "01/09/2023",
        confidence: null,
        evidence: null,
      },
    ]);
  });

  it("normalizes ISO date-time field answers to dd/mm/yyyy before persistence", () => {
    const fields: FieldDefinition[] = [
      {
        id: "invoice_date",
        name: "Invoice Date",
        description: "The invoice date",
        data_type: "date",
      },
    ];

    expect(
      normalizeModelResults(fields, [
        {
          field_id: "invoice_date",
          status: "ok",
          answer: "2023-09-01T00:00:00.000Z",
        },
      ])[0]?.answer,
    ).toBe("01/09/2023");
  });

  it("preserves date field answers that are already dd/mm/yyyy", () => {
    const fields: FieldDefinition[] = [
      {
        id: "invoice_date",
        name: "Invoice Date",
        description: "The invoice date",
        data_type: "date",
      },
    ];

    expect(
      normalizeModelResults(fields, [
        {
          field_id: "invoice_date",
          status: "ok",
          answer: "01/09/2023",
        },
      ])[0]?.answer,
    ).toBe("01/09/2023");
  });
});
