# Templates

Templates define what the extractor should return for submitted Documents. A Template has a name, optional description, and 1 to 50 fields.

## Field Types

Supported field data types:

| Type | Use For |
| --- | --- |
| `string` | Names, addresses, IDs, labels, free text. |
| `number` | Amounts, quantities, counts, prices. |
| `boolean` | Yes/no findings. |
| `date` | Dates found in the source Document. |
| `object` | One structured record. |
| `array` | A list of scalar values. |
| `array<object>` | A table-shaped list of records. |

Field names are normalized into field IDs by lowercasing and replacing spaces with underscores. Field names must contain letters or numbers, and duplicate names or IDs are rejected.

## Basic Template JSON

```json
{
  "name": "Prescription Template",
  "description": "Extract medication and prescription fields from a Document",
  "fields": [
    {
      "name": "Patient Name",
      "description": "Full name of the patient on the prescription",
      "data_type": "string"
    },
    {
      "name": "Medication Name",
      "description": "Name of the prescribed medication",
      "data_type": "string"
    }
  ]
}
```

## Table-Shaped Fields

Use `array<object>` when a Document can contain repeated rows, such as invoice lines, prescription lines, or statement transactions.

```json
{
  "name": "Invoice Template",
  "description": "Extract invoice header and line items",
  "fields": [
    {
      "name": "Invoice Number",
      "description": "The supplier invoice number",
      "data_type": "string"
    },
    {
      "name": "Line Items",
      "description": "Every invoice line item in source order",
      "data_type": "array<object>",
      "object_schema": {
        "mode": "table",
        "columns": [
          {
            "heading": "Description",
            "data_type": "string",
            "description": "Line item description"
          },
          {
            "heading": "Quantity",
            "data_type": "number",
            "description": "Quantity billed"
          },
          {
            "heading": "Amount",
            "data_type": "number",
            "description": "Line total before tax"
          }
        ]
      }
    }
  ]
}
```

Object column data types are limited to `string`, `number`, `boolean`, and `date`. Column headings are normalized to keys in the same way Template field names are normalized.

## Plan Limits

Template count, top-level field count, table-shaped field count, and table column count are enforced by the active Workspace plan. See [Plans And Limits](../reference/plans-and-limits.md).

