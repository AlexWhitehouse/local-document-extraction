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
    expect(() =>
      validateTemplateJsonPayload({
        name: "Two tables",
        fields: [tableField("Line Items", 1), tableField("Tax Lines", 1)],
      }),
    ).toThrow("at most one table-shaped Template field");

    expect(() =>
      validateTemplateJsonPayload({
        name: "Wide table",
        fields: [tableField("Line Items", 21)],
      }),
    ).toThrow("at most 20 table columns");

    expect(
      validateTemplateJsonPayload({
        name: "Twenty columns remain valid",
        fields: [
          { name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
          tableField("Line Items", 20),
        ],
      }).fields,
    ).toHaveLength(2);
  });
});

it("validates raw JSON before column normalization and returns addressable diagnostics", () => {
  const payload = { name: "Invoice", fields: [tableField("Lines", 1)] };
  payload.fields[0].object_schema.columns[0] = { heading: "Tax%", description: "", data_type: "object" };
  const original = JSON.stringify(payload);

  try {
    validateTemplateJsonPayload(payload);
    throw new Error("Expected invalid columns to fail");
  } catch (error) {
    expect(error.diagnostics.map((issue) => issue.code)).toEqual([
      "column.heading_characters",
      "column.type_unsupported",
      "column.description_required",
    ]);
    expect(error.diagnostics[0].location).toEqual({
      scope: "column",
      fieldIndex: 0,
      columnIndex: 0,
      property: "heading",
    });
  }

  expect(JSON.stringify(payload)).toBe(original);
});

it("rejects too many fields and unsupported raw types instead of normalizing them", () => {
  expect(() =>
    validateTemplateJsonPayload({
      name: "X",
      fields: Array.from({ length: 51 }, (_, i) => ({
        name: `Value ${i}`,
        data_type: "number",
        description: "Read value",
      })),
    }),
  ).toThrow("1 to 50");
  expect(() =>
    validateTemplateJsonPayload({
      name: "X",
      fields: [{ name: "Value", data_type: "NUMBER", description: "Read value" }],
    }),
  ).toThrow("unsupported data_type");
});
