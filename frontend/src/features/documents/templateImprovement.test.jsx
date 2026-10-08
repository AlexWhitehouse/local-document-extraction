import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentPage } from "./DocumentPage.jsx";
import { improvableTemplate, templateImprovementRequest, weakResultFields } from "./templateImprovement.js";

afterEach(cleanup);

const results = [
  { field_id: "total", name: "Total", status: "ok", answer: 10, confidence: 0.95 },
  { field_id: "vat", name: "VAT", status: "not_found", answer: null, confidence: null },
  { field_id: "date", name: "Date", status: "invalid_type", answer: "soon", confidence: 0.8 },
  { field_id: "stamp", name: "Stamp", status: "unreadable", answer: null, confidence: null },
  { field_id: "supplier", status: "ok", answer: "Acme", confidence: 0.4 },
];

const job = {
  job_id: "job_a",
  status: "completed",
  template_id: "invoice",
  template_version: 2,
  source_retained: true,
  created_at: "2026-01-01T00:00:00.000Z",
  results,
};

describe("Improve template request", () => {
  it("names not found, invalid, unreadable and low-confidence fields", () => {
    expect(weakResultFields(results)).toEqual(["VAT", "Date", "Stamp", "supplier"]);
    expect(templateImprovementRequest(results)).toBe(
      "Improve the instructions for “VAT”, “Date”, “Stamp”, “supplier”. In this document they were missing, unreadable or low confidence.",
    );
  });

  it("falls back to a general request when every field looks fine", () => {
    expect(templateImprovementRequest([results[0]])).toBe(
      "Suggest improvements to the field instructions based on this document’s results.",
    );
  });

  it("needs a completed job whose template still exists", () => {
    const templates = [{ id: "invoice", name: "Invoice" }];
    expect(improvableTemplate(job, templates)).toEqual(templates[0]);
    expect(improvableTemplate(job, [])).toBeNull();
    expect(improvableTemplate({ ...job, status: "processing" }, templates)).toBeNull();
  });
});

describe("Improve template on the document page", () => {
  it("offers the action for a completed document and hands over the job", () => {
    const onImproveTemplate = vi.fn();
    render(
      <DocumentPage selectedDocument={job} templates={[{ id: "invoice", name: "Invoice" }]} onImproveTemplate={onImproveTemplate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Improve template" }));
    expect(onImproveTemplate).toHaveBeenCalledWith(job);
  });

  it("hides the action when the template was deleted", () => {
    render(<DocumentPage selectedDocument={job} templates={[]} onImproveTemplate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Improve template" })).toBeNull();
  });
});
