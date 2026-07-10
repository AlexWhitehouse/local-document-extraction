import { describe, expect, it } from "vitest";

import { validateTemplateJsonPayload } from "./templateFields.js";

const tableField = (name, columns) => ({
  name,
  description: `${name} details.`,
  data_type: "array<object>",
  object_schema: {
    mode: "table",
    columns: Array.from({ length: columns }, (_, index) => ({
      heading: `Column ${index + 1}`,
      data_type: "string",
      description: `Column ${index + 1} value.`,
    })),
  },
});

describe("Template JSON payload validation", () => {
  it("keeps the local table shape constraints aligned with the API", () => {
    expect(() => validateTemplateJsonPayload({
      name: "Two tables",
      fields: [tableField("Line Items", 1), tableField("Tax Lines", 1)],
    })).toThrow("at most one table-shaped Template field");

    expect(() => validateTemplateJsonPayload({
      name: "Wide table",
      fields: [tableField("Line Items", 21)],
    })).toThrow("at most 20 table columns");

    expect(validateTemplateJsonPayload({
      name: "Twenty columns remain valid",
      fields: [
        { name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
        tableField("Line Items", 20),
      ],
    }).fields).toHaveLength(2);
  });
});
