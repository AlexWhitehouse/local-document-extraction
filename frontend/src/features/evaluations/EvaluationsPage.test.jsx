import React from "react";
import { fireEvent, render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EvaluationsPage } from "./EvaluationsPage.jsx";
const template = { name: "Invoice", description: "Description", fields: [{ id: "total", name: "Total", description: "Original instruction", data_type: "number" }] };
afterEach(() => cleanup());
function setup(overrides = {}, templates = []) {
  const state = { id: "evaluation", setup: { configured: true }, document: null, candidates: [{ id: "a", revision: 2, model: "model", pdf: false, structured: false, status: "running", template, result: { revision: 1, fields: template.fields, raw: [{ field_id: "total", status: "ok", answer: 10 }], model: "model", queueMs: 5, processingMs: 10, attempts: 1 } }], mode: "templates", references: {}, definitions: {}, alignments: {}, columns: {}, ...overrides };
  const evaluation = { state, patch: vi.fn(), edit: vi.fn(), run: vi.fn(), api: vi.fn(async () => Response.json({ template_id: "copy" })), clear: vi.fn(), start: vi.fn(), changeMode: vi.fn(), duplicate: vi.fn() };
  render(<EvaluationsPage evaluation={evaluation} templates={templates} workspaceLabel="Test Workspace" enabled maxSourceFileBytes={1000} />);
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

it("offers only saved Templates and loads the selected historical field version", async () => {
  const evaluation = setup({ candidates: [] }, [{ id: "saved", name: "Saved Invoice", current_version: 3 }]);
  expect(screen.queryByText("Current Template draft")).toBeNull();
  expect(screen.queryByText("Temporary comparisons")).toBeNull();
  expect(screen.getByText("Test Workspace / Evaluations")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start comparison" }).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Starting Template" }), { target: { value: "saved" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Field version" }), { target: { value: "2" } });
  evaluation.api.mockResolvedValueOnce(Response.json({ ...template, current_version: 3 }));
  fireEvent.click(screen.getByRole("button", { name: "Start comparison" }));
  await waitFor(() => expect(evaluation.start).toHaveBeenCalledWith(expect.objectContaining({ source: { id: "saved", version: 2 } })));
  expect(evaluation.api).toHaveBeenCalledWith("/evaluations/templates/saved?version=2");
});
it("uses the shared single document uploader and keeps invalid uploads in the dialog", () => {
  const evaluation = setup({ candidates: [] });
  fireEvent.click(screen.getByRole("button", { name: /Upload document/ }));
  const dialog = screen.getByRole("dialog", { name: "Upload evaluation document" });
  expect(within(dialog).getByRole("button", { name: /Drag and drop a sample document/ })).toBeTruthy();
  const input = within(dialog).getByLabelText("Document");
  expect(input.multiple).toBe(false);
  fireEvent.change(input, { target: { files: [new File(["x".repeat(1001)], "large.pdf", { type: "application/pdf" })] } });
  expect(within(dialog).getByRole("alert").textContent).toMatch(/file limit/);
  expect(evaluation.patch).not.toHaveBeenCalled();
  const file = new File(["sample"], "invoice.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(evaluation.patch).toHaveBeenCalledWith({ document: file });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("adds a candidate from the explicitly selected candidate", () => {
  const candidate = { id: "a", revision: 0, model: "alpha", status: "idle", template };
  const evaluation = setup({ candidates: [candidate, { ...candidate, id: "b", model: "beta" }] });
  fireEvent.click(screen.getByRole("button", { name: "Select Candidate 2" }));
  expect(screen.getByRole("button", { name: "Select Candidate 2" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Add candidate (2/8)" }));
  expect(evaluation.duplicate).toHaveBeenCalledWith("b");
});
it("disables adding candidates at the eight candidate limit", () => {
  setup({ candidates: Array.from({ length: 8 }, (_, i) => ({ id: String(i), model: "alpha", status: "idle", template })) });
  expect(screen.getByRole("button", { name: "Add candidate (8/8)" }).disabled).toBe(true);
});
it("uses explicit Yes/No answers and preserves false when verifying", () => {
  const fields = [{ id: "repeat", name: "Repeat prescription", data_type: "boolean" }];
  const evaluation = setup({ candidates: [{ id: "a", model: "model", status: "idle", template: { ...template, fields } }] });
  fireEvent.click(screen.getByRole("button", { name: "Add expected answer" }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(within(dialog).getByRole("alert")).toBeTruthy();
  expect(evaluation.patch).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Expected value" }), { target: { value: "false" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(evaluation.patch.mock.calls[0][0].references["repeat prescription:boolean"].value).toBe(false);
});
it("edits table records against ordered schema columns with typed cells", () => {
  const fields = [{ id: "lines", name: "Prescription lines", data_type: "array<object>", object_schema: { columns: [
    { key: "drug", heading: "Drug name", data_type: "string", description: "Medicine as printed" },
    { key: "repeat", heading: "Repeat", data_type: "boolean" },
  ] } }];
  const evaluation = setup({ candidates: [{ id: "a", model: "model", status: "idle", template: { ...template, fields } }] });
  fireEvent.click(screen.getByRole("button", { name: "Add expected answer" }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).getByRole("button", { name: "Select row 1" })).toBeTruthy();
  const table = within(dialog).getByRole("table", { name: "Expected row schema values" });
  expect(within(table).getByRole("columnheader", { name: "Column name" })).toBeTruthy();
  expect(within(table).getByText("Medicine as printed")).toBeTruthy();
  fireEvent.change(within(table).getByRole("textbox", { name: "Expected row 1 Drug name" }), { target: { value: "Example A" } });
  fireEvent.change(within(table).getByRole("combobox", { name: "Expected row 1 Repeat" }), { target: { value: "false" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add row" }));
  fireEvent.change(within(table).getByRole("textbox", { name: "Expected row 2 Drug name" }), { target: { value: "Example B" } });
  fireEvent.change(within(table).getByRole("combobox", { name: "Expected row 2 Repeat" }), { target: { value: "true" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Select row 1" }));
  expect(within(table).getByRole("textbox", { name: "Expected row 1 Drug name" }).value).toBe("Example A");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Compare rows" }), { target: { value: "position" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(evaluation.patch.mock.calls[0][0].references["prescription lines:array<object>"].value).toEqual([{ drug: "Example A", repeat: false }, { drug: "Example B", repeat: true }]);
});

it.each(["array", "table object"])("reviews returned %s table rows without losing values or changing the result", shape => {
  const fields = [{ id: "items", name: "Items", data_type: "array<object>", object_schema: { columns: [
    { key: "sku", heading: "SKU", data_type: "string" }, { key: "quantity", heading: "Quantity", data_type: "number" },
  ] } }];
  const records = [{ sku: "A", quantity: 0 }, { sku: "B", quantity: 2 }];
  const answer = shape === "array" ? records : { columns: ["sku", "quantity"], rows: records };
  const evaluation = setup({ candidates: [{ id: "a", revision: 0, model: "model", status: "success", template: { ...template, fields }, result: { revision: 0, fields, raw: [{ field_id: "items", status: "ok", answer }], queueMs: 0, processingMs: 1, attempts: 1 } }] });
  fireEvent.click(screen.getByRole("button", { name: "Review as expected answer" }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).getByRole("textbox", { name: "Expected row 1 SKU" }).value).toBe("A");
  expect(within(dialog).getByRole("textbox", { name: "Expected row 1 Quantity" }).value).toBe("0");
  fireEvent.click(within(dialog).getByRole("button", { name: "Select row 2" }));
  expect(within(dialog).getByRole("textbox", { name: "Expected row 2 SKU" }).value).toBe("B");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Expected row 2 SKU" }), { target: { value: "Corrected B" } });
  expect(records[1].sku).toBe("B");
  expect(evaluation.patch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(within(dialog).getByRole("alert").textContent).toMatch(/Choose how to match rows/);
  expect(evaluation.patch).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Compare rows" }), { target: { value: "position" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(evaluation.patch.mock.calls[0][0].references["items:array<object>"].value).toEqual([{ sku: "A", quantity: 0 }, { sku: "Corrected B", quantity: 2 }]);
});
it("preserves row matching when reviewing another result for an existing expected table", () => {
  const fields = [{ id: "items", name: "Items", data_type: "array<object>", object_schema: { columns: [{ key: "sku", heading: "SKU", data_type: "string" }] } }];
  const evaluation = setup({ references: { "items:array<object>": { verified: true, value: [{ sku: "A" }], rows: { mode: "key", key: "sku" } } }, candidates: [{ id: "a", model: "model", status: "success", template: { ...template, fields }, result: { fields, raw: [{ field_id: "items", status: "ok", answer: { rows: [{ sku: "B" }] } }], queueMs: 0, processingMs: 1, attempts: 1 } }] });
  fireEvent.click(screen.getByRole("button", { name: "Review as expected answer" }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).getByRole("combobox", { name: "Compare rows" }).value).toBe("sku");
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(evaluation.patch.mock.calls[0][0].references["items:array<object>"].rows).toEqual({ mode: "key", key: "sku" });
});
