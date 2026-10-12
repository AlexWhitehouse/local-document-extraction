import { describe, expect, it } from "vitest";
import { costAmount } from "../../../../../shared/processingCosts.ts";
import { Formatted } from "../../../lib/xlsx.js";
import { costExportFileName, costWorkbookSheets, documentRows } from "./costExport.js";

const costs = (split, extraction, unreported = 0) => ({
  currency: "USD",
  split: costAmount(split, 1),
  auto_template: costAmount(),
  extraction: costAmount(extraction, 1, unreported),
  total: costAmount(split + extraction, 2, unreported),
});

const child = (id, template, split, extraction, templateId = null) => ({
  id,
  name: `${id}.pdf`,
  template,
  templateId,
  pages: 2,
  status: "completed",
  deleted: false,
  costs: costs(split, extraction),
});

const packet = {
  id: "packet",
  name: "bundle.pdf",
  created_at: "2026-09-01T10:30:00.000Z",
  status: "completed",
  pages: 6,
  deleted: false,
  costs: costs(0.3, 0.4),
  children: [child("a", "Invoices", 0.1, 0.2), child("b", "Invoices", 0.1, 0.2)],
};

const pending = {
  id: "pending",
  name: "waiting.pdf",
  created_at: "2026-09-01T11:00:00.000Z",
  status: "splitting",
  pages: 3,
  deleted: false,
  costs: costs(0.05, 0, 1),
  children: [],
};

const metrics = {
  costs: costs(0.35, 0.4, 1),
  documents: 3,
  pages: 9,
  fullyCostedDocuments: 2,
  fullyCostedPages: 4,
  fullyCostedAmount: 0.6,
};

const range = { start: "2026-09-01T00:00:00.000Z", end: "2026-09-03T00:00:00.000Z", unit: "day" };

const overview = {
  range,
  totals: metrics,
  previous: null,
  buckets: [
    { ...metrics, key: "2026-09-01", date: "2026-09-01", hour: 0 },
    { ...metrics, costs: costs(0, 0), documents: 0, pages: 0, fullyCostedDocuments: 0, key: "2026-09-02", date: "2026-09-02", hour: 0 },
  ],
};

const exported = { updating: true, truncated: false, uploadCount: 2, generatedAt: "2026-09-03T08:00:00.000Z", uploads: [packet, pending] };

const plain = (cell) => (cell instanceof Formatted ? cell.value : cell);

describe("cost export workbook", () => {
  it("adds split overhead so document rows add up to each upload, and lists uploads without documents", () => {
    const rows = documentRows([packet, pending]);
    expect(rows.map((row) => row.name)).toEqual(["a.pdf", "b.pdf", "Pages not in a document", "waiting.pdf"]);
    expect(rows[2]).toMatchObject({ template: "Split overhead", pages: 2 });
    expect(rows[2].costs.split.amount).toBeCloseTo(0.1, 12);
    expect(rows[2].costs.extraction.amount).toBeCloseTo(0, 12);
    expect(rows.slice(0, 3).reduce((sum, row) => sum + row.costs.total.amount, 0)).toBeCloseTo(0.7, 12);
  });

  it("builds summary, daily, template and document sheets for the range", () => {
    const [summary, daily, templates, documents] = costWorkbookSheets({ overview, exported, label: "Last 2 days" });
    const value = (item) => plain(summary.rows.find((row) => row[0] === item)?.[1]);

    expect(value("Period")).toBe("Last 2 days");
    expect(value("From")).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(value("To")).toEqual(new Date("2026-09-02T00:00:00.000Z"));
    expect(value("Total spend")).toBeCloseTo(0.75, 12);
    expect(value("Uploads")).toBe(2);
    expect(value("Average per document")).toBeCloseTo(0.3, 12);
    expect(value("Change from previous period")).toBeNull();
    expect(summary.rows.filter((row) => row[0] === "Note").map((row) => row[1])).toEqual([
      "Some model calls have no reported cost, so totals are a minimum.",
      "Cost history is still updating. Figures may be incomplete.",
    ]);

    expect(daily.name).toBe("Daily");
    expect(daily.rows.map((row) => row[0])).toEqual([new Date("2026-09-01T00:00:00Z"), new Date("2026-09-02T00:00:00Z")]);
    expect(daily.rows[0].at(-1)).toBe("No");

    expect(templates.rows.map((row) => row.slice(0, 3))).toEqual([
      ["Invoices", 2, 4],
      ["Split overhead", 0, 2],
      ["No template yet", 1, 3],
    ]);
    expect(templates.rows[0][6]).toBeCloseTo(0.6, 12);
    expect(templates.rows[0][7]).toBeCloseTo(0.3, 12);
    expect(templates.rows[1][7]).toBeNull();

    expect(documents.columns.map((column) => column.header)).toEqual([
      "Uploaded (UTC)",
      "Upload",
      "Document",
      "Template",
      "Pages",
      "Status",
      "Deleted",
      "Splitting",
      "Template generation",
      "Extraction",
      "Total",
      "Costs complete",
    ]);
    expect(documents.rows[0].slice(0, 7)).toEqual([new Date(packet.created_at), "bundle.pdf", "a.pdf", "Invoices", 2, "Completed", "No"]);
  });

  it("groups templates by ID, keeping the newest name and apart from synthetic rows", () => {
    const upload = (id, created_at, children) => ({
      ...packet,
      id,
      created_at,
      costs: sumCosts(children),
      children,
    });

    const sumCosts = (children) => ({
      currency: "USD",
      ...Object.fromEntries(
        ["split", "auto_template", "extraction", "total"].map((stage) => [
          stage,
          costAmount(children.reduce((sum, item) => sum + item.costs[stage].amount, 0), 1),
        ]),
      ),
    });

    const uploads = [
      upload("old", "2026-09-01T09:00:00.000Z", [child("a", "Invoice", 0.1, 0.1, "tpl-1")]),
      upload("new", "2026-09-01T10:00:00.000Z", [
        child("b", "Supplier invoice", 0.1, 0.1, "tpl-1"),
        child("c", "Invoice", 0.2, 0.2, "tpl-2"),
        child("d", "Split overhead", 0.3, 0.3, "tpl-3"),
      ]),
    ];

    const [, , templates] = costWorkbookSheets({
      overview,
      exported: { ...exported, uploadCount: 2, uploads },
      label: "Last 2 days",
    });

    expect(templates.rows.map((row) => row.slice(0, 2))).toEqual([
      ["Split overhead", 1],
      ["Supplier invoice", 2],
      ["Invoice", 1],
    ]);
  });

  it("leaves template averages to fully costed documents", () => {
    const incomplete = { ...child("b", "Invoices", 0.1, 0.2, "tpl"), costs: costs(0.1, 0.2, 1) };
    const uploads = [{ ...packet, children: [child("a", "Invoices", 0.4, 0.6, "tpl"), incomplete] }];
    const [, , templates] = costWorkbookSheets({ overview, exported: { ...exported, uploads }, label: "Last 2 days" });
    const invoices = templates.rows.find((row) => row[0] === "Invoices");

    expect(invoices[1]).toBe(2);
    expect(invoices[7]).toBeCloseTo(1, 12);
    expect(invoices[8]).toBeCloseTo(0.5, 12);
    expect(invoices.at(-1)).toBe("No");
  });

  it("marks every sheet built from capped uploads and reports the exact upload count", () => {
    const [summary, , templates, documents] = costWorkbookSheets({
      overview,
      exported: { ...exported, truncated: true, uploadCount: 30000 },
      label: "Last 2 days",
    });

    expect(plain(summary.rows.find((row) => row[0] === "Uploads")[1])).toBe(30000);
    expect(summary.rows.filter((row) => row[0] === "Note").at(-1)[1]).toBe(
      "The By template and Documents sheets cover only the first 2 of 30,000 uploads.",
    );
    expect([templates.name, documents.name]).toEqual(["By template (partial)", "Documents (partial)"]);
  });

  it("names the file after the first and last day in range", () => {
    expect(costExportFileName(range)).toBe("costs-2026-09-01-to-2026-09-02.xlsx");
  });
});
