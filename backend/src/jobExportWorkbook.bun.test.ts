import { describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";

import { buildJobExportWorkbook } from "./jobExportWorkbook";
import type { LocalWorkspaceExtractionJobExport } from "./localWorkspaceProductStore";

describe("job export workbook", () => {
  it("creates typed header and table sheets grouped by template version", async () => {
    const v1Fields = [
      field("invoice_number", "Invoice Number", "string", 0),
      field("invoice_date", "Invoice Date", "date", 1),
      field("amount", "Amount", "number", 2),
      field("approved", "Approved", "boolean", 3),
      field("supplier", "Supplier", "object", 4),
      field("references", "References", "array", 5),
      field("line_items", "Line Items", "array<object>", 6, tableDescription([
        { key: "description", heading: "Description", data_type: "string" },
        { key: "quantity", heading: "Quantity", data_type: "number" },
      ])),
    ];
    const v2Fields = [
      field("invoice_number", "Invoice Number", "string", 0),
      field("line_items", "Line Items", "array<object>", 1, tableDescription([
        { key: "description", heading: "Description", data_type: "string" },
      ])),
    ];
    const jobs: LocalWorkspaceExtractionJobExport[] = [
      job({
        fields: v1Fields,
        job_id: "job_completed",
        results: [
          result("invoice_number", "Invoice Number", "string", "ok", "INV-001"),
          result("invoice_date", "Invoice Date", "date", "ok", "16/08/2026"),
          result("amount", "Amount", "number", "ok", 42.5),
          result("approved", "Approved", "boolean", "ok", true),
          result("supplier", "Supplier", "object", "ok", {
            address: { city: "London" },
            name: "Acme Ltd",
            tags: [],
          }),
          result("references", "References", "array", "ok", ["PO-12", "PO-19"]),
          result("line_items", "Line Items", "array<object>", "ok", {
            columns: [
              { key: "description", heading: "Description" },
              { key: "quantity", heading: "Quantity" },
            ],
            rows: [
              { description: "Consulting", quantity: 2 },
              { description: "Support", quantity: 1 },
            ],
          }),
        ],
        source_name: "invoice.pdf",
        template_version: 1,
      }),
      job({
        completed_at: null,
        created_at: "2026-08-15T10:00:00.000Z",
        error_code: "extract_failed",
        error_message: "OCR failed",
        fields: v1Fields,
        job_id: "job_failed",
        results: [],
        source_name: "damaged.pdf",
        status: "failed",
        model_name: "provider/failure-model",
        template_version: 1,
      }),
      job({
        fields: v2Fields,
        job_id: "job_v2",
        results: [
          result("invoice_number", "Invoice Number", "string", "not_found", null),
          result("line_items", "Line Items", "array<object>", "not_found", null),
        ],
        source_name: "new-invoice.pdf",
        template_version: 2,
      }),
    ];

    const generatedAt = new Date("2026-08-16T14:30:00.000Z");
    const exported = await buildJobExportWorkbook({
      generatedAt,
      jobs,
      workspaceName: "Clinical Workspace",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.bytes as never);

    expect(exported.filename).toBe(
      "clinical-workspace-job-export-2026-08-16-1430.xlsx",
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Invoice v1 — Headers",
      "Invoice v1 — Line Items",
      "Invoice v2 — Headers",
      "Invoice v2 — Line Items",
    ]);

    const v1Headers = records(workbook.getWorksheet("Invoice v1 — Headers")!);
    expect(v1Headers).toHaveLength(2);
    expect(v1Headers[0]).toMatchObject({
      "Job ID": "job_completed",
      "Source Filename": "invoice.pdf",
      "Source Page Count": 3,
      "Job Status": "completed",
      "Template Name": "Invoice",
      "Template ID": "tpl_invoice",
      "Template Version": 1,
      "Model Name": "provider/extraction-model",
      "Invoice Number": "INV-001",
      "Invoice Date": "2026-08-16",
      Amount: 42.5,
      Approved: true,
      "Supplier — Address — City": "London",
      "Supplier — Name": "Acme Ltd",
      "Supplier — Tags": "[]",
      References: '["PO-12","PO-19"]',
    });
    expect(v1Headers[1]).toMatchObject({
      "Job ID": "job_failed",
      "Job Status": "failed",
      "Error Code": "extract_failed",
      "Error Message": "OCR failed",
      "Model Name": "provider/failure-model",
    });
    expect(v1Headers[1]["Invoice Number"]).toBeNull();

    const v1Table = records(workbook.getWorksheet("Invoice v1 — Line Items")!);
    expect(v1Table).toEqual([
      expect.objectContaining({
        "Job ID": "job_completed",
        "Source Filename": "invoice.pdf",
        "Row Number": 1,
        "Table Status": null,
        Description: "Consulting",
        Quantity: 2,
      }),
      expect.objectContaining({
        "Job ID": "job_completed",
        "Row Number": 2,
        Description: "Support",
        Quantity: 1,
      }),
    ]);

    const v2Headers = records(workbook.getWorksheet("Invoice v2 — Headers")!);
    expect(v2Headers[0]["Invoice Number"]).toBe("[not_found]");
    const v2Table = records(workbook.getWorksheet("Invoice v2 — Line Items")!);
    expect(v2Table).toEqual([
      expect.objectContaining({
        "Job ID": "job_v2",
        "Row Number": null,
        "Table Status": "[not_found]",
        Description: null,
      }),
    ]);

    for (const worksheet of workbook.worksheets) {
      expect(worksheet.getRow(1).font.bold).toBe(true);
      expect(worksheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(worksheet.autoFilter).toBeTruthy();
    }
  });

  it("preserves empty objects and shortens duplicate worksheet names safely", async () => {
    const longName = "A very long template name that exceeds Excel limits";
    const objectField = field("details", "Details", "object", 0);
    const jobs = [
      job({
        fields: objectField ? [objectField] : [],
        job_id: "job_one",
        results: [result("details", "Details", "object", "ok", {})],
        template_id: "tpl_one",
        template_name: longName,
      }),
      job({
        fields: objectField ? [objectField] : [],
        job_id: "job_two",
        results: [result("details", "Details", "object", "ok", {})],
        template_id: "tpl_two",
        template_name: longName,
      }),
    ];

    const exported = await buildJobExportWorkbook({
      generatedAt: new Date("2026-08-16T00:00:00.000Z"),
      jobs,
      workspaceName: "Åccounts / Europe",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.bytes as never);

    expect(exported.filename).toBe("accounts-europe-job-export-2026-08-16-0000.xlsx");
    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31);
    expect(workbook.worksheets[1].name).not.toBe(workbook.worksheets[0].name);
    expect(records(workbook.worksheets[0])[0].Details).toBe("{}");
  });

  it("round-trips formula-like, Unicode, oversized, and malformed values safely", async () => {
    const formulaText = '=HYPERLINK("https://attacker.invalid","open")';
    const oversizedText = `Résumé 東京 🙂 ${"x".repeat(40_000)}`;
    const exported = await buildJobExportWorkbook({
      jobs: [job({
        fields: [
          field("formula", "Formula Text", "string", 0),
          field("large", "Large Unicode", "string", 1),
          field("malformed", "Malformed Object", "object", 2),
          field("malformed_array", "Malformed Array", "array", 3),
        ],
        results: [
          result("formula", "Formula Text", "string", "ok", formulaText),
          result("large", "Large Unicode", "string", "ok", oversizedText),
          result("malformed", "Malformed Object", "object", "ok", { count: 1n }),
          result("malformed_array", "Malformed Array", "array", "ok", [1n]),
        ],
      })],
      workspaceName: "Unicode Workspace",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.bytes as never);
    const worksheet = workbook.worksheets[0];
    const values = records(worksheet)[0];
    const formulaCell = worksheet.getCell(2, 13);

    expect(values["Formula Text"]).toBe(formulaText);
    expect(formulaCell.formula).toBeUndefined();
    expect(String(values["Large Unicode"]).startsWith("Résumé 東京 🙂 ")).toBe(true);
    expect(String(values["Large Unicode"]).endsWith("… [truncated]")).toBe(true);
    expect(String(values["Large Unicode"]).length).toBeLessThanOrEqual(32_767);
    expect(values["Malformed Object — Count"]).toBe("1");
    expect(values["Malformed Array"]).toBe('["1"]');
  });
});

function field(
  id: string,
  name: string,
  dataType: LocalWorkspaceExtractionJobExport["fields"][number]["data_type"],
  position: number,
  description = `${name} value.`,
): LocalWorkspaceExtractionJobExport["fields"][number] {
  return { id, name, data_type: dataType, description, position };
}

function result(
  fieldId: string,
  name: string,
  dataType: LocalWorkspaceExtractionJobExport["results"][number]["data_type"],
  status: string,
  answer: unknown,
): LocalWorkspaceExtractionJobExport["results"][number] {
  return {
    field_id: fieldId,
    name,
    data_type: dataType,
    status,
    answer,
    confidence: 0.97,
    evidence: "Not exported",
  };
}

function job(
  overrides: Partial<LocalWorkspaceExtractionJobExport>,
): LocalWorkspaceExtractionJobExport {
  return {
    job_id: "job_default",
    status: "completed",
    source_name: "document.pdf",
    source_mime_type: "application/pdf",
    source_file_page_count: 3,
    template_id: "tpl_invoice",
    template_name: "Invoice",
    template_version: 1,
    model_name: "provider/extraction-model",
    fields: [],
    results: [],
    error_code: null,
    error_message: null,
    created_at: "2026-08-16T10:00:00.000Z",
    updated_at: "2026-08-16T10:01:00.000Z",
    completed_at: "2026-08-16T10:01:00.000Z",
    current_attempt: 0,
    completed_attempt: 1,
    last_failed_attempt: 0,
    ...overrides,
  };
}

function tableDescription(columns: Array<Record<string, unknown>>): string {
  return [
    "Extract line items.",
    "[[OBJECT_SCHEMA]]",
    JSON.stringify({ mode: "table", data_type: "array<object>", columns }),
    "[[/OBJECT_SCHEMA]]",
  ].join("\n");
}

function records(worksheet: ExcelJS.Worksheet): Array<Record<string, unknown>> {
  const headings = (worksheet.getRow(1).values as unknown[]).slice(1).map(String);
  const rows: Array<Record<string, unknown>> = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = (worksheet.getRow(rowNumber).values as unknown[]).slice(1);
    rows.push(Object.fromEntries(headings.map((heading, index) => [
      heading,
      values[index] ?? null,
    ])));
  }
  return rows;
}
