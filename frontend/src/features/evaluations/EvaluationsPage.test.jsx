import React from "react";
import { fireEvent, render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EvaluationsPage } from "./EvaluationsPage.jsx";
const template = { name: "Invoice", description: "Description", fields: [{ id: "total", name: "Total", description: "Original instruction", data_type: "number" }] };
afterEach(() => cleanup());
function setup(overrides = {}) {
  const state = { id: "evaluation", setup: { configured: true }, document: null, candidates: [{ id: "a", revision: 2, model: "model", pdf: false, structured: false, status: "running", template, result: { revision: 1, fields: template.fields, raw: [{ field_id: "total", status: "ok", answer: 10 }], model: "model", queueMs: 5, processingMs: 10, attempts: 1 } }], mode: "templates", references: {}, definitions: {}, alignments: {}, columns: {}, ...overrides };
  const evaluation = { state, patch: vi.fn(), edit: vi.fn(), run: vi.fn(), api: vi.fn(async () => Response.json({ template_id: "copy" })), clear: vi.fn(), start: vi.fn(), changeMode: vi.fn(), duplicate: vi.fn() };
  render(<EvaluationsPage evaluation={evaluation} templates={[]} draft={template} enabled maxSourceFileBytes={1000} />);
  return evaluation;
}
it("keeps editing available during processing and applies full editor changes only to the candidate", async () => {
  const evaluation = setup();
  expect(screen.getByRole("button", { name: "Run all" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit Template", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Edit Template" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Extraction instructions" }), { target: { value: "Revised instruction" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(evaluation.edit).toHaveBeenCalled());
  expect(evaluation.edit.mock.calls[0][1].template.fields[0].description).toBe("Revised instruction");
  expect(template.fields[0].description).toBe("Original instruction"); expect(evaluation.api).not.toHaveBeenCalled();
});
it("Save as new Template warns for untested edits and saves an independent current draft", async () => {
  const evaluation = setup();
  fireEvent.click(screen.getByRole("button", { name: "Save as new Template" }));
  const dialog = screen.getByRole("dialog", { name: "Save as new Template" });
  expect(within(dialog).getByText(/current edits have not been tested/)).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Template name" }), { target: { value: "New Invoice" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save new Template" }));
  await waitFor(() => expect(evaluation.api).toHaveBeenCalled());
  expect(evaluation.api.mock.calls[0][0]).toBe("/templates");
  expect(JSON.parse(evaluation.api.mock.calls[0][1].body)).toMatchObject({ name: "New Invoice", fields: [{ name: "Total", description: "Original instruction", data_type: "number" }] });
  expect(evaluation.edit).not.toHaveBeenCalled(); expect(template.name).toBe("Invoice");
});
it("candidate values stay unverified until an explicit reference confirmation", () => {
  const evaluation = setup();
  fireEvent.click(screen.getByRole("button", { name: "Review as expected answer" }));
  expect(evaluation.patch).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Expected value" }), { target: { value: "12" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(evaluation.patch.mock.calls[0][0].references["total:number"]).toMatchObject({ verified: true, value: "12" });
  expect(evaluation.run).not.toHaveBeenCalled();
});
