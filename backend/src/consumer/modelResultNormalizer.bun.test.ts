import { describe, expect, it } from "bun:test";

import type { FieldDefinition } from "../lib/types";
import { normalizeModelResults } from "./modelResultNormalizer";

describe("normalizeModelResults", () => {
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
