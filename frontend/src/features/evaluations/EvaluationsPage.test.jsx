import React from "react";
import { act, fireEvent, render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EvaluationsPage } from "./EvaluationsPage.jsx";

// Field errors are linked through aria-describedby rather than announced with role="alert".
const described = (element) =>
  (element.getAttribute("aria-describedby") || "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent || "")
    .join(" ");

const template = {
  name: "Invoice",
  description: "Description",
  fields: [{ id: "total", name: "Total", description: "Original instruction", data_type: "number" }],
};

const itemsField = {
  id: "items",
  name: "Items",
  data_type: "array<object>",
  object_schema: {
    columns: [
      { key: "sku", heading: "SKU", data_type: "string" },
      { key: "quantity", heading: "Quantity", data_type: "number" },
    ],
  },
};

const result = (fields, raw) => ({
  revision: 0,
  fields,
  raw,
  model: "model",
  queueMs: 0,
  processingMs: 1,
  attempts: 1,
});

afterEach(() => cleanup());

const BUSY = ["staged", "submitting", "queued", "running", "retrying"];

// Builds the multi-document state from one document's candidates, answers and results. Results move
// into per-pair state and their details into the (mocked) result cache, as the controller keeps them.
function toState(
  {
    document = new File(["sample"], "invoice.pdf", { type: "application/pdf" }),
    references = {},
    definitions = {},
    candidates,
    ...rest
  },
  details,
) {
  const documents = document
    ? [
        {
          key: "doc",
          kind: "upload",
          file: document,
          name: document.name,
          reference: { references, definitions },
          save: "idle",
          availability: "ok",
        },
      ]
    : [];

  const pairs = { doc: {} };

  const plain = (candidates || []).map(({ status = "idle", result, message, attempt, ...candidate }) => {
    const record = result && { ...result, recordId: `record-${candidate.id}`, raw: undefined };

    if (result) details[record.recordId] = { raw: result.raw };
    pairs.doc[candidate.id] = {
      status,
      message,
      attempt,
      result: record && !BUSY.includes(status) ? record : null,
      previous: record && BUSY.includes(status) ? record : null,
      detail: "retained",
    };

    return candidate;
  });

  return {
    id: "evaluation",
    setup: { configured: true, model: "model" },
    library: { save_available: true },
    libraryVersion: 0,
    documents,
    pairs,
    mode: "templates",
    alignments: {},
    columns: {},
    candidates: plain,
    ...rest,
  };
}

function setup(overrides = {}, templates = [], props = {}) {
  const details = {};

  const state = toState(
    {
      candidates: [
        {
          id: "a",
          revision: 2,
          model: "model",
          pdf: false,
          structured: false,
          status: "running",
          template,
          result: {
            revision: 1,
            fields: template.fields,
            raw: [{ field_id: "total", status: "ok", answer: 10 }],
            model: "model",
            queueMs: 5,
            processingMs: 10,
            attempts: 1,
          },
        },
      ],
      ...overrides,
    },
    details,
  );

  const evaluation = {
    state,
    patch: vi.fn(),
    edit: vi.fn(),
    run: vi.fn(),
    api: vi.fn(async () => Response.json({ template_id: "copy" })),
    clear: vi.fn(),
    start: vi.fn(() => []),
    changeMode: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(async () => null),
    setReference: vi.fn(),
    removeReference: vi.fn(),
    reviewReference: vi.fn(),
    setColumns: vi.fn(),
    addUploads: vi.fn(),
    removeDocument: vi.fn(async () => null),
    discardChanges: vi.fn(() => null),
    detail: (id) => details[id] || null,
    hydrate: vi.fn(),
  };

  const page = (next) => (
    <EvaluationsPage
      evaluation={next}
      templates={templates}
      workspaceCrumb={{ label: "Test Workspace", href: "/workspaces/ws_1" }}
      enabled
      maxSourceFileBytes={1000}
      {...props}
    />
  );

  const view = render(page(evaluation));

  return Object.assign(evaluation, {
    rerender: (stateChange) => view.rerender(page({ ...evaluation, state: { ...state, ...stateChange } })),
  });
}

// The answers one setReference call verified, keyed by field identity.
const saved = (evaluation, call = 0) => {
  const [docKey, identity, value] = evaluation.setReference.mock.calls[call];
  expect(docKey).toBe("doc");

  return { [identity]: value };
};

const openMenu = (index = 1) => fireEvent.click(screen.getByRole("button", { name: `Candidate ${index} options` }));

const savedTemplate = (fields = template.fields) => ({ ...template, fields, current_version: 3 });

it("replaces a comparison candidate with a historical Template without running it", async () => {
  const evaluation = setup({ mode: "templates" }, [{ id: "saved", name: "Saved Invoice", current_version: 3 }]);
  evaluation.api.mockImplementation(async () => Response.json(savedTemplate()));
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Choose another template version" }));
  const picker = within(screen.getByRole("dialog", { name: "Choose candidate template" }));
  fireEvent.change(picker.getByRole("combobox", { name: "Template", exact: true }), { target: { value: "saved" } });
  fireEvent.change(picker.getByRole("combobox", { name: "Version" }), { target: { value: "2" } });
  fireEvent.click(picker.getByRole("button", { name: "Replace candidate template" }));
  await waitFor(() => expect(evaluation.edit).toHaveBeenCalledWith("a", {
    template: expect.objectContaining({ source: { id: "saved", version: 2 }, name: "Invoice" }),
  }));
  expect(evaluation.run).not.toHaveBeenCalled();
});

it("keeps editing available during processing and applies full editor changes only to the candidate", async () => {
  const evaluation = setup();
  expect(screen.getByRole("button", { name: "Run all (1 candidate)" }).disabled).toBe(true);
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  const dialog = screen.getByRole("dialog", { name: "Edit template" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Extraction instructions" }), {
    target: { value: "Revised instruction" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(evaluation.edit).toHaveBeenCalled());
  expect(evaluation.edit.mock.calls[0][1].template.fields[0].description).toBe("Revised instruction");
  expect(template.fields[0].description).toBe("Original instruction");
  expect(evaluation.api).not.toHaveBeenCalled();
});

it("Save as new template warns for untested edits and saves an independent current draft", async () => {
  const evaluation = setup();
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Save as new template" }));
  const dialog = screen.getByRole("dialog", { name: "Save as new template" });
  expect(within(dialog).getByText(/These edits haven’t been run yet/)).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Template name" }), {
    target: { value: "New Invoice" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save new template" }));
  await waitFor(() => expect(evaluation.api).toHaveBeenCalled());
  expect(evaluation.api.mock.calls[0][0]).toBe("/templates");
  expect(JSON.parse(evaluation.api.mock.calls[0][1].body)).toMatchObject({
    name: "New Invoice",
    fields: [{ name: "Total", description: "Original instruction", data_type: "number" }],
  });
  expect(evaluation.edit).not.toHaveBeenCalled();
  expect(template.name).toBe("Invoice");
});

it("candidate values stay unverified until an explicit reference confirmation", () => {
  const evaluation = setup();
  fireEvent.click(screen.getByRole("button", { name: "Inspect Total for Candidate 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Review before using" }));
  expect(evaluation.setReference).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Expected value" }), { target: { value: "12" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(saved(evaluation, 0)["total:number"]).toMatchObject({ verified: true, value: "12" });
  expect(evaluation.run).not.toHaveBeenCalled();
});

it("uses a candidate's scalar answer as the expected answer in one explicit step", () => {
  const evaluation = setup();
  fireEvent.click(screen.getByRole("button", { name: "Inspect Total for Candidate 1" }));
  const inspector = screen.getByRole("complementary", { name: "Answer inspector" });
  expect(within(inspector).queryByText("ok")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Use as expected answer" }));
  expect(saved(evaluation, 0)["total:number"]).toEqual({ verified: true, absent: false, exact: false, value: 10 });
});

it("verifies expected answers inline, including explicit absence", () => {
  const evaluation = setup();
  fireEvent.click(screen.getByRole("button", { name: "Add expected Total" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Total" }), { target: { value: "twelve" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(described(screen.getByRole("textbox", { name: "Expected Total" }))).toMatch(/valid number/);
  expect(evaluation.setReference).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Total" }), { target: { value: "£1,200.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(saved(evaluation, 0)["total:number"]).toMatchObject({ verified: true, absent: false, value: "£1,200.50" });
  fireEvent.click(screen.getByRole("button", { name: "Add expected Total" }));
  fireEvent.click(screen.getByRole("button", { name: "Not in document" }));
  expect(saved(evaluation, 1)["total:number"]).toMatchObject({ verified: true, absent: true });
});

it("verifies day-first dates inline and saves the unambiguous calendar day", () => {
  const field = { id: "dob", name: "Date of birth", data_type: "date" };

  const evaluation = setup({
    candidates: [
      {
        id: "a",
        revision: 0,
        model: "model",
        status: "success",
        template: { ...template, fields: [field] },
        result: result([field], [{ field_id: "dob", status: "ok", answer: "1871-09-08" }]),
      },
    ],
  });

  fireEvent.click(screen.getByRole("button", { name: "Add expected Date of birth" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Date of birth" }), {
    target: { value: "08/09/1871" },
  });
  expect(screen.getByText("Interpreted as 8 September 1871")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(saved(evaluation)["date of birth:date"]).toMatchObject({ verified: true, value: "1871-09-08" });
});

it("shows a day-first candidate date as matching its ISO expected answer", () => {
  const date = { id: "dob", name: "Date of birth", data_type: "date" };
  setup({
    references: { "date of birth:date": { verified: true, value: "1871-09-08" } },
    definitions: { "date of birth:date": date },
    candidates: [
      {
        id: "a",
        revision: 0,
        model: "model",
        status: "success",
        template: { ...template, fields: [date] },
        result: result([date], [{ field_id: "dob", status: "ok", answer: "08/09/1871" }]),
      },
    ],
  });
  expect(screen.getByText("100%", { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Inspect Date of birth for Candidate 1" }));
  const inspector = screen.getByRole("complementary", { name: "Answer inspector" });
  expect(within(inspector).getByText("Match", { exact: true })).toBeTruthy();
  expect(within(inspector).queryByText("Mismatch", { exact: true })).toBeNull();
});

it("keeps ignored table cells out of differences and highlights values in absent cells", () => {
  const candidate = (id, answer) => ({
    id,
    revision: 0,
    model: id,
    status: "success",
    template: { ...template, fields: [itemsField] },
    result: result([itemsField], [{ field_id: "items", status: "ok", answer }]),
  });

  setup({
    mode: "models",
    references: {
      "items:array<object>": {
        verified: true,
        value: [{ sku: "A" }, { sku: "B" }],
        rows: { mode: "key", key: "sku" },
        cellStates: [{ quantity: "absent" }, { quantity: "ignored" }],
      },
    },
    candidates: [
      candidate("alpha", [{ sku: "B", quantity: 999 }, { sku: "A" }]),
      candidate("beta", [
        { sku: "A", quantity: 0 },
        { sku: "B", quantity: 888 },
      ]),
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: /Compare all 2 tables/ }));
  const dialog = screen.getByRole("dialog", { name: "Items across candidates" });
  expect(within(dialog).getByText("3/3 cells")).toBeTruthy();
  expect(within(dialog).getByText("2/3 cells")).toBeTruthy();
  expect(within(dialog).getByTitle("Expected: Not in document").textContent).toBe("0");
  expect(within(dialog).getByText("999").classList.contains("evaluation-compare-differs")).toBe(false);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Only rows with differences" }));
  expect(within(dialog).queryByText("999")).toBeNull();
  expect(within(dialog).queryByText("888")).toBeNull();
});

it("starts a model comparison from a saved historical field version with the chosen models", async () => {
  const evaluation = setup(
    { candidates: [], mode: "models", document: null },
    [{ id: "saved", name: "Saved Invoice", current_version: 3 }],
    { suggestedModels: ["other-model"] },
  );

  const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
  expect(breadcrumb.getByRole("link", { name: "Test Workspace" }).getAttribute("href")).toBe("/workspaces/ws_1");
  expect(breadcrumb.getByText("Evaluations").getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "Start evaluation" }).disabled).toBe(true);
  evaluation.api.mockImplementation(async () => Response.json(savedTemplate()));
  fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "saved" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Version" }), { target: { value: "2" } });
  expect(screen.getByRole("textbox", { name: "Candidate 1 model" }).value).toBe("model");
  fireEvent.click(screen.getByRole("button", { name: "other-model" }));
  await waitFor(() => expect(screen.getByText(/1 field/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Start evaluation" }));
  await waitFor(() => expect(evaluation.start).toHaveBeenCalled());
  const [mode, entries] = evaluation.start.mock.calls[0];
  expect(mode).toBe("models");
  expect(entries.map((entry) => entry.model)).toEqual(["model", "other-model"]);
  expect(entries[0].template).toMatchObject({ source: { id: "saved", version: 2 }, name: "Invoice" });
  expect(evaluation.api).toHaveBeenCalledWith("/evaluations/templates/saved?version=2");
  expect(evaluation.run).not.toHaveBeenCalled();
});

it("shows the Workspace model only when comparing Template versions and loads each chosen version", async () => {
  const evaluation = setup({ candidates: [], mode: "models", document: null }, [
    { id: "saved", name: "Saved Invoice", current_version: 3 },
  ]);

  evaluation.api.mockImplementation(async () => Response.json(savedTemplate()));
  expect(screen.queryByText("Workspace model")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: /Template versions/ }));
  expect(screen.getByText("Workspace model")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "saved" } });
  expect(screen.getByRole("checkbox", { name: /^v3/ }).checked).toBe(true);
  expect(screen.getByRole("checkbox", { name: /^v2/ }).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /^v1/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start evaluation" }));
  await waitFor(() => expect(evaluation.start).toHaveBeenCalled());
  const [mode, entries] = evaluation.start.mock.calls[0];
  expect(mode).toBe("templates");
  expect(entries.map((entry) => entry.template.source.version)).toEqual([3, 2, 1]);
  expect(entries.every((entry) => entry.model === undefined)).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /Models/ }));
  expect(screen.queryByText("Workspace model")).toBeNull();
});

it("starts two copies of a single Template version so one can be edited as a draft", async () => {
  const evaluation = setup({ candidates: [], mode: "templates", document: null }, [
    { id: "saved", name: "Saved Invoice", current_version: 1 },
  ]);

  evaluation.api.mockImplementation(async () => Response.json({ ...template, current_version: 1 }));
  fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "saved" } });
  expect(screen.getByText(/Starts two copies of v1/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start evaluation" }));
  await waitFor(() => expect(evaluation.start).toHaveBeenCalled());
  expect(evaluation.start.mock.calls[0][1].map((entry) => entry.template.source.version)).toEqual([1, 1]);
  expect(evaluation.api).toHaveBeenCalledTimes(2);
});

it("starts and runs the new candidates in one step when a document is present", async () => {
  const document = new File(["sample"], "invoice.pdf", { type: "application/pdf" });

  const evaluation = setup({ candidates: [], mode: "models", document }, [
    { id: "saved", name: "Saved Invoice", current_version: 1 },
  ]);

  evaluation.api.mockImplementation(async () => Response.json({ ...template, current_version: 1 }));
  evaluation.start.mockReturnValue(["x", "y"]);
  fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "saved" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Candidate 2 model" }), { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(evaluation.start).toHaveBeenCalled());
  expect(evaluation.run).not.toHaveBeenCalled();
  evaluation.rerender({
    candidates: ["x", "y"].map((id) => ({ id, revision: 0, model: id, status: "idle", template, result: null })),
  });
  await waitFor(() => expect(evaluation.run).toHaveBeenCalledWith(["x", "y"]));
});

it("validates setup documents before keeping them", () => {
  const evaluation = setup({ candidates: [], document: null });
  const input = screen.getByLabelText("Evaluation document");
  expect(input.multiple).toBe(true);
  fireEvent.change(input, {
    target: { files: [new File(["x".repeat(1001)], "large.pdf", { type: "application/pdf" })] },
  });
  expect(screen.getByRole("alert").textContent).toMatch(/larger than/);
  fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert").textContent).toMatch(/PDF, PNG, JPG or WEBP/);
  expect(evaluation.addUploads).not.toHaveBeenCalled();
  const file = new File(["sample"], "invoice.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(evaluation.addUploads).toHaveBeenCalledWith([file]);
});

it("uses the shared uploader to add documents and keeps invalid uploads in the dialog", () => {
  const evaluation = setup({ document: null });
  fireEvent.click(screen.getByRole("button", { name: "Upload document" }));
  const dialog = screen.getByRole("dialog", { name: "Upload evaluation document" });
  expect(within(dialog).getByRole("button", { name: /Drop files or click to browse/ })).toBeTruthy();
  const input = within(dialog).getByLabelText("Document");
  expect(input.multiple).toBe(true);
  fireEvent.change(input, {
    target: { files: [new File(["x".repeat(1001)], "large.pdf", { type: "application/pdf" })] },
  });
  expect(within(dialog).getByRole("alert").textContent).toMatch(/larger than/);
  expect(evaluation.addUploads).not.toHaveBeenCalled();
  const file = new File(["sample"], "invoice.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(evaluation.addUploads).toHaveBeenCalledWith([file]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("adds a candidate from the last candidate, or duplicates a chosen one", () => {
  const candidate = { id: "a", revision: 0, model: "alpha", status: "idle", template };
  const evaluation = setup({ mode: "models", candidates: [candidate, { ...candidate, id: "b", model: "beta" }] });
  fireEvent.click(screen.getByRole("button", { name: "Add candidate" }));
  expect(evaluation.duplicate).toHaveBeenCalledWith("b");
  openMenu(1);
  fireEvent.click(screen.getByRole("button", { name: "Duplicate candidate" }));
  expect(evaluation.duplicate).toHaveBeenLastCalledWith("a");
});

it("removes a candidate at once and offers undo that restores it", async () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  const undo = vi.fn();
  const candidate = { id: "a", revision: 0, model: "alpha", status: "idle", template };

  const evaluation = setup(
    { mode: "models", candidates: [candidate, { ...candidate, id: "b", model: "beta" }] },
    [],
    { toast },
  );

  evaluation.remove.mockResolvedValue(undo);

  openMenu(2);
  fireEvent.click(screen.getByRole("button", { name: "Remove candidate" }));
  expect(evaluation.remove).toHaveBeenCalledWith("b");
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Candidate removed: beta",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();

  toast.success.mock.calls[0][1].action.onClick();
  expect(undo).toHaveBeenCalledTimes(1);
});

it("removes a setup candidate row at once, and undo puts the model back in its row", async () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  setup({ mode: "models", candidates: [] }, [], { toast });

  fireEvent.change(screen.getByLabelText("Candidate 2 model"), { target: { value: "beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove candidate 1" }));
  expect(screen.getByLabelText("Candidate 1 model").value).toBe("beta");
  expect(screen.queryByLabelText("Candidate 2 model")).toBeNull();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Candidate removed: model",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    ),
  );

  act(() => toast.success.mock.calls[0][1].action.onClick());
  expect(screen.getByLabelText("Candidate 1 model").value).toBe("model");
  expect(screen.getByLabelText("Candidate 2 model").value).toBe("beta");
});

it("removes a setup document at once and offers undo", async () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  const undo = vi.fn();
  const evaluation = setup({ mode: "models", candidates: [] }, [], { toast });
  evaluation.removeDocument.mockResolvedValue(undo);

  fireEvent.click(screen.getByRole("button", { name: "Remove invoice.pdf" }));
  expect(evaluation.removeDocument).toHaveBeenCalledWith("doc");
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Document removed: invoice.pdf",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    ),
  );

  toast.success.mock.calls[0][1].action.onClick();
  expect(undo).toHaveBeenCalledTimes(1);
});

it("discards answer edits at once and offers undo", () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  const undo = vi.fn();

  const reference = {
    definitions: { "total:number": template.fields[0] },
    references: { "total:number": { verified: true, value: 10 } },
  };

  const edited = { definitions: reference.definitions, references: { "total:number": { verified: true, value: 12 } } };

  const evaluation = setup(
    {
      documents: [
        { key: "doc", kind: "saved", savedId: "saved-doc", name: "Saved invoice", loadedRevision: 1, reference: edited, base: reference, availability: "ok" },
      ],
    },
    [],
    { toast },
  );

  evaluation.discardChanges.mockReturnValue(undo);

  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(evaluation.discardChanges).toHaveBeenCalledWith("doc");
  expect(toast.success).toHaveBeenCalledWith(
    "Changes discarded",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );

  toast.success.mock.calls[0][1].action.onClick();
  expect(undo).toHaveBeenCalledTimes(1);
});

it("disables adding candidates at the eight candidate limit", () => {
  setup({
    candidates: Array.from({ length: 8 }, (_, i) => ({ id: String(i), model: "alpha", status: "idle", template })),
  });
  expect(screen.getByRole("button", { name: "Add candidate" }).disabled).toBe(true);
  expect(screen.getByText("8/8")).toBeTruthy();
});

it("scores candidates, marks the leader and filters fields by disagreement and mismatch", () => {
  const fields = [
    { id: "total", name: "Total", data_type: "number" },
    { id: "ref", name: "Reference", data_type: "string" },
  ];

  const candidate = (id, total) => ({
    id,
    revision: 0,
    model: id,
    status: "success",
    template: { ...template, fields },
    result: result(fields, [
      { field_id: "total", status: "ok", answer: total },
      { field_id: "ref", status: "ok", answer: "INV-1" },
    ]),
  });

  setup({
    mode: "models",
    references: { "total:number": { verified: true, value: "10" } },
    candidates: [candidate("alpha", 10), candidate("beta", 12)],
  });
  expect(screen.getByText("100%")).toBeTruthy();
  expect(screen.getByText("0%")).toBeTruthy();
  expect(screen.getAllByText("Best")).toHaveLength(1);
  const matrix = screen.getByRole("region", { name: "Comparison matrix" });
  fireEvent.click(screen.getByRole("radio", { name: "Candidates differ" }));
  expect(within(matrix).getByText("Total")).toBeTruthy();
  expect(within(matrix).queryByText("Reference")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Unverified" }));
  expect(within(matrix).queryByText("Total")).toBeNull();
  expect(within(matrix).getByText("Reference")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Mismatches" }));
  expect(within(matrix).getByText("Total")).toBeTruthy();
  expect(within(matrix).queryByText("Reference")).toBeNull();
});

it("compares every candidate's table rows against the expected rows in one view", () => {
  const candidate = (id, answer) => ({
    id,
    revision: 0,
    model: id,
    status: "success",
    template: { ...template, fields: [itemsField] },
    result: result([itemsField], [{ field_id: "items", status: "ok", answer }]),
  });

  const expected = [
    { sku: "A", quantity: 1 },
    { sku: "B", quantity: 2 },
  ];

  setup({
    mode: "models",
    references: { "items:array<object>": { verified: true, value: expected, rows: { mode: "key", key: "sku" } } },
    candidates: [candidate("alpha", expected), candidate("beta", { rows: [{ sku: "B", quantity: 3 }] })],
  });
  fireEvent.click(screen.getByRole("button", { name: /Compare all 2 tables/ }));
  const dialog = screen.getByRole("dialog", { name: "Items across candidates" });
  expect(within(dialog).getByText(/Rows matched by SKU/)).toBeTruthy();
  expect(within(dialog).getByText("1/4 cells · 1 missing")).toBeTruthy();
  const rows = within(dialog).getByRole("table", { name: "Rows by candidate" });
  expect(within(rows).getByText("Row missing")).toBeTruthy();
  expect(within(rows).getByTitle("Expected: 2").textContent).toBe("3");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Only rows with differences" }));
  expect(within(rows).getAllByText("alpha")).toHaveLength(2);
  expect(within(dialog).queryByRole("button", { name: /Review as expected/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Stacked" }));
  const betaTable = within(dialog).getByRole("table", { name: "beta table" });
  expect(within(dialog).getAllByRole("table", { name: /table$/ })).toHaveLength(3);
  expect(within(betaTable).getByText("Row missing")).toBeTruthy();
  expect(within(betaTable).getByTitle("Expected: 2").textContent).toBe("3");
  expect(within(within(dialog).getByRole("table", { name: "alpha table" })).queryByText("Row missing")).toBeNull();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Side by side" }));
  const side = within(dialog).getByRole("table", { name: "Candidates side by side" });
  expect(within(side).getAllByRole("columnheader", { name: "SKU" })).toHaveLength(3);
});

it("compares candidates' tables with the most common value before rows are verified", () => {
  const candidate = (id, quantity) => ({
    id,
    revision: 0,
    model: id,
    status: "success",
    template: { ...template, fields: [itemsField] },
    result: result([itemsField], [{ field_id: "items", status: "ok", answer: [{ sku: "A", quantity }] }]),
  });

  setup({ mode: "models", candidates: [candidate("alpha", 1), candidate("beta", 1), candidate("gamma", 5)] });
  fireEvent.click(screen.getByRole("button", { name: /Compare all 3 tables/ }));
  const dialog = screen.getByRole("dialog", { name: "Items across candidates" });
  expect(within(dialog).getByText(/most common candidate value/)).toBeTruthy();
  expect(within(dialog).getByTitle("Most common: 1").textContent).toBe("5");
});

it("uses explicit Yes/No answers and preserves false when verifying", () => {
  const fields = [{ id: "repeat", name: "Repeat prescription", data_type: "boolean" }];

  const evaluation = setup({
    candidates: [{ id: "a", model: "model", status: "idle", template: { ...template, fields } }],
  });

  fireEvent.click(screen.getByRole("button", { name: "Add expected Repeat prescription" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Expected Repeat prescription" }), {
    target: { value: "false" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(saved(evaluation, 0)["repeat prescription:boolean"].value).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Add expected Repeat prescription" }));
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(within(dialog).getByRole("combobox", { name: "Expected value" }).getAttribute("aria-invalid")).toBe("true");
  expect(evaluation.setReference).toHaveBeenCalledTimes(1);
});

it("edits table records against ordered schema columns with typed cells", () => {
  const fields = [
    {
      id: "lines",
      name: "Prescription lines",
      data_type: "array<object>",
      object_schema: {
        columns: [
          { key: "drug", heading: "Drug name", data_type: "string", description: "Medicine as printed" },
          { key: "repeat", heading: "Repeat", data_type: "boolean" },
        ],
      },
    },
  ];

  const evaluation = setup({
    candidates: [{ id: "a", model: "model", status: "idle", template: { ...template, fields } }],
  });

  fireEvent.click(screen.getByRole("button", { name: /Add expected rows/ }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).getByRole("button", { name: "Select row 1" })).toBeTruthy();
  const table = within(dialog).getByRole("table", { name: "Expected row values" });
  expect(within(table).getByRole("columnheader", { name: "Column name" })).toBeTruthy();
  expect(within(table).getByText("Medicine as printed")).toBeTruthy();
  fireEvent.change(within(table).getByRole("textbox", { name: "Expected row 1 Drug name" }), {
    target: { value: "Example A" },
  });
  fireEvent.change(within(table).getByRole("combobox", { name: "Expected row 1 Repeat" }), {
    target: { value: "false" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add row" }));
  fireEvent.change(within(table).getByRole("textbox", { name: "Expected row 2 Drug name" }), {
    target: { value: "Example B" },
  });
  fireEvent.change(within(table).getByRole("combobox", { name: "Expected row 2 Repeat" }), {
    target: { value: "true" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Select row 1" }));
  expect(within(table).getByRole("textbox", { name: "Expected row 1 Drug name" }).value).toBe("Example A");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Compare rows" }), { target: { value: "position" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(saved(evaluation, 0)["prescription lines:array<object>"].value).toEqual([
    { drug: "Example A", repeat: false },
    { drug: "Example B", repeat: true },
  ]);
});

it.each(["array", "table object"])(
  "reviews returned %s table rows without losing values or changing the result",
  (representation) => {
    const records = [
      { sku: "A", quantity: 0 },
      { sku: "B", quantity: 2 },
    ];

    const answer = representation === "array" ? records : { columns: ["sku", "quantity"], rows: records };

    const evaluation = setup({
      candidates: [
        {
          id: "a",
          revision: 0,
          model: "model",
          status: "success",
          template: { ...template, fields: [itemsField] },
          result: result([itemsField], [{ field_id: "items", status: "ok", answer }]),
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspect Items for Candidate 1" }));
    expect(screen.queryByRole("button", { name: "Use as expected answer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review before using" }));
    const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
    expect(within(dialog).getByRole("textbox", { name: "Expected row 1 SKU" }).value).toBe("A");
    expect(within(dialog).getByRole("textbox", { name: "Expected row 1 Quantity" }).value).toBe("0");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select row 2" }));
    expect(within(dialog).getByRole("textbox", { name: "Expected row 2 SKU" }).value).toBe("B");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Expected row 2 SKU" }), {
      target: { value: "Corrected B" },
    });
    expect(records[1].sku).toBe("B");
    expect(evaluation.setReference).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
    const compareRows = within(dialog).getByRole("combobox", { name: "Compare rows" });
  expect(compareRows.getAttribute("aria-invalid")).toBe("true");
  expect(described(compareRows)).toMatch(/Choose how to match rows/);
    expect(evaluation.setReference).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Compare rows" }), { target: { value: "position" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
    expect(saved(evaluation, 0)["items:array<object>"].value).toEqual([
      { sku: "A", quantity: 0 },
      { sku: "Corrected B", quantity: 2 },
    ]);
  },
);

it("preserves row matching when reviewing another result for an existing expected table", () => {
  const fields = [
    {
      id: "items",
      name: "Items",
      data_type: "array<object>",
      object_schema: { columns: [{ key: "sku", heading: "SKU", data_type: "string" }] },
    },
  ];

  const evaluation = setup({
    references: { "items:array<object>": { verified: true, value: [{ sku: "A" }], rows: { mode: "key", key: "sku" } } },
    candidates: [
      {
        id: "a",
        model: "model",
        status: "success",
        template: { ...template, fields },
        result: {
          fields,
          raw: [{ field_id: "items", status: "ok", answer: { rows: [{ sku: "B" }] } }],
          queueMs: 0,
          processingMs: 1,
          attempts: 1,
        },
      },
    ],
  });

  fireEvent.click(screen.getByRole("button", { name: "Inspect Items for Candidate 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Review before using" }));
  const dialog = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(dialog).getByRole("combobox", { name: "Compare rows" }).value).toBe("sku");
  fireEvent.click(within(dialog).getByRole("button", { name: "Use as expected answer" }));
  expect(saved(evaluation, 0)["items:array<object>"].rows).toEqual({ mode: "key", key: "sku" });
});

it.each(["explicit", "embedded"])("reuses saved answers after instruction-only edits with %s table schemas", (schema) => {
  const before = [template.fields[0], { ...itemsField, description: "Extract every item" }];

  const after = before.map((field) => {
    const updated = { ...field, description: "Revised extraction instructions" };

    if (field.object_schema) {
      const objectSchema = {
        mode: "table",
        columns: field.object_schema.columns.map((column) => ({ ...column, description: "Revised column instructions" })),
      };

      if (schema === "embedded") {
        updated.description += `\n[[OBJECT_SCHEMA]]\n${JSON.stringify(objectSchema)}\n[[/OBJECT_SCHEMA]]`;
        delete updated.object_schema;
      } else updated.object_schema = objectSchema;
    }

    return updated;
  });

  const reference = {
    definitions: { "total:number": before[0], "items:array<object>": before[1] },
    references: {
      "total:number": { verified: true, value: 10 },
      "items:array<object>": {
        verified: true,
        value: [{ sku: "A", quantity: "" }, { sku: "B", quantity: "" }],
        cellStates: [{ quantity: "absent" }, { quantity: "ignored" }],
        rows: { mode: "key", key: "sku" },
      },
    },
  };

  const document = {
    key: "doc", kind: "saved", savedId: "saved-doc", name: "Saved invoice", loadedRevision: 1,
    reference, base: structuredClone(reference), availability: "ok",
  };

  const evaluation = setup({
    documents: [document],
    candidates: [before, after].map((fields, index) => ({
      id: String(index), model: "model", status: "success", revision: 0,
      template: { ...template, fields },
      result: result(fields, [
        { field_id: "total", status: "ok", answer: 10 },
        { field_id: "items", status: "ok", answer: [{ sku: "A", quantity: null }, { sku: "B", quantity: 5 }] },
      ]),
    })),
  });

  expect(screen.getAllByText("Match")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: "Review template changes" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review field changes" })).toBeNull();
  expect(screen.queryByText(/Needs review/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit expected Total" }));
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  let editor = within(screen.getByRole("dialog", { name: "Verify expected answer" }));
  expect(editor.queryByRole("combobox", { name: "Expected answer template" })).toBeNull();
  expect(editor.queryByText("Field instructions changed")).toBeNull();
  expect(editor.getByRole("textbox", { name: "Expected value" }).value).toBe("10");
  fireEvent.click(editor.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect Items for Candidate 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Review before using" }));
  editor = within(screen.getByRole("dialog", { name: "Verify expected answer" }));
  expect(editor.queryByRole("combobox", { name: "Expected answer template" })).toBeNull();
  expect(editor.queryByText("Field instructions changed")).toBeNull();
  expect(editor.queryByText("Template columns changed")).toBeNull();
  expect(editor.getAllByText("Revised column instructions")).toHaveLength(2);
  fireEvent.click(editor.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "2 rows verified" }));
  editor = within(screen.getByRole("dialog", { name: "Verify expected answer" }));
  expect(editor.getByRole("combobox", { name: "Expected row 1 Quantity status" }).value).toBe("absent");
  fireEvent.click(editor.getByRole("button", { name: "Select row 2" }));
  expect(editor.getByRole("combobox", { name: "Expected row 2 Quantity status" }).value).toBe("ignored");
  expect(editor.getByRole("combobox", { name: "Compare rows" }).value).toBe("sku");
  fireEvent.click(editor.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("radio", { name: "Template changes", exact: true }));
  expect(screen.getByText("No fields match this filter.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Update saved answers…" })).toBeNull();
  expect(evaluation.setReference).not.toHaveBeenCalled();
  expect(evaluation.reviewReference).not.toHaveBeenCalled();
  expect(document.reference).toEqual(document.base);
});

it.each(["saved answer", "candidate result"])(
  "reviews a %s using updated boolean columns instead of the saved text schema",
  (source) => {
    const oldField = {
      ...itemsField,
      object_schema: {
        columns: [
          { key: "sku", heading: "SKU", data_type: "string" },
          { key: "initiation", heading: "Initiation Dose", data_type: "string" },
          { key: "maintenance", heading: "Maintenance Dose", data_type: "string" },
        ],
      },
    };

    const newField = {
      ...oldField,
      object_schema: {
        columns: oldField.object_schema.columns.map((c) => (c.key === "sku" ? c : { ...c, data_type: "boolean" })),
      },
    };

    const reference = {
      verified: true,
      value: [{ sku: "A", initiation: "true", maintenance: "false" }],
      rows: { mode: "key", key: "sku" },
    };

    const answer = [{ sku: "A", initiation: true, maintenance: false }];

    const evaluation = setup({
      definitions: { "items:array<object>": oldField },
      references: { "items:array<object>": reference },
      candidates: [
        {
          id: "a",
          model: "model",
          status: "success",
          template: { ...template, fields: [newField] },
          result: result([newField], [{ field_id: "items", status: "ok", answer }]),
        },
      ],
    });

    expect(screen.getByText("Needs review · template columns changed")).toBeTruthy();

    if (source === "candidate result") {
      fireEvent.click(screen.getByRole("button", { name: "Inspect Items for Candidate 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Review before using" }));
    } else fireEvent.click(screen.getByRole("button", { name: "Review updated table" }));
    const dialog = within(screen.getByRole("dialog", { name: "Verify expected answer" }));
    expect(dialog.getByText("Initiation Dose: Text → Yes / No")).toBeTruthy();
    expect(dialog.getByRole("combobox", { name: "Expected row 1 Initiation Dose", exact: true }).value).toBe("true");
    expect(dialog.getByRole("combobox", { name: "Expected row 1 Maintenance Dose", exact: true }).value).toBe("false");
    expect(dialog.getByRole("combobox", { name: "Compare rows" }).value).toBe("sku");
    fireEvent.click(dialog.getByRole("button", { name: "Use as expected answer" }));
    expect(screen.queryByRole("dialog", { name: "Verify expected answer" })).toBeNull();
    expect(evaluation.reviewReference).toHaveBeenCalledWith(
      "doc",
      "items:array<object>",
      "items:array<object>",
      expect.objectContaining({ verified: true, value: answer }),
      newField,
    );
    expect(reference.value[0].maintenance).toBe("false");
  },
);

it("finds added, removed and retyped fields together and preserves unchanged answers", () => {
  const before = { id: "total", name: "Total", data_type: "string" };
  const removed = { id: "code", name: "Old code", data_type: "string" };
  const unchanged = { id: "name", name: "Name", data_type: "string" };
  const added = { id: "date", name: "Invoice date", data_type: "date" };
  const next = { ...before, data_type: "number" };
  const definitions = { "total:string": before, "old code:string": removed, "name:string": unchanged };

  const references = {
    "total:string": { verified: true, value: "123" },
    "old code:string": { verified: true, value: "A" },
    "name:string": { verified: true, value: "Example" },
  };

  const evaluation = setup({
    definitions,
    references,
    candidates: [
      { id: "a", model: "model", status: "idle", template: { ...template, fields: [next, unchanged, added] } },
    ],
  });

  expect(screen.getAllByRole("rowheader", { name: /^Total/ })).toHaveLength(1);
  expect(screen.getByText('Previously saved as Text: “123”')).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit expected Total" })).toBeNull();
  const removedRow = screen.getByRole("rowheader", { name: /^Old code/ }).closest("tr");
  expect(removedRow.classList.contains("evaluation-omitted-row")).toBe(true);
  expect(within(removedRow).getByText("A")).toBeTruthy();
  expect(within(removedRow).queryByRole("button", { name: "Edit expected Old code" })).toBeNull();
  expect(screen.getByRole("button", { name: "Edit expected Name" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review template changes" }));
  const matrix = within(screen.getByRole("region", { name: "Comparison matrix" }));
  expect(matrix.queryByRole("button", { name: "Edit expected Name" })).toBeNull();
  expect(matrix.getByText("Text → Number")).toBeTruthy();
  // A new field is listed as a change, flagged by its outline rather than a note until a save is blocked.
  expect(matrix.getByRole("rowheader", { name: /^Invoice date/ })).toBeTruthy();
  expect(matrix.queryByText("No saved answer · verify this field")).toBeNull();
  expect(matrix.getByRole("button", { name: "Add expected Invoice date" }).classList.contains("unverified")).toBe(true);
  expect(matrix.getByText("Not requested by any candidate · saved answer kept")).toBeTruthy();
  fireEvent.click(matrix.getByRole("button", { name: "Delete expected answer for Old code" }));
  expect(evaluation.removeReference).toHaveBeenCalledWith("doc", "old code:string");
  fireEvent.click(matrix.getByRole("button", { name: "Review as Number" }));
  expect(screen.getByRole("textbox", { name: "Expected value" }).value).toBe("123");
  fireEvent.click(screen.getByRole("button", { name: "Use as expected answer" }));
  expect(evaluation.reviewReference).toHaveBeenCalledWith(
    "doc",
    "total:string",
    "total:number",
    expect.objectContaining({ value: 123, verified: true }),
    next,
  );
  expect(references["name:string"].value).toBe("Example");
});

it("shows each candidate's run cost in its column head and marks partial or missing costs", () => {
  const cost = (amount, unreported = 0) => ({
    amount,
    complete: unreported === 0,
    reported_calls: amount === null ? 0 : 1,
    unreported_calls: unreported,
  });

  const candidate = (id, runCost) => ({
    id,
    revision: 0,
    model: "model",
    pdf: false,
    structured: false,
    status: "success",
    template,
    result: { ...result(template.fields, [{ field_id: "total", status: "ok", answer: 10 }]), cost: runCost },
  });

  setup({
    candidates: [
      candidate("a", cost(0.00369663)),
      candidate("b", cost(0.0012, 1)),
      candidate("c", cost(null, 1)),
    ],
  });

  expect(screen.getByLabelText("Run cost: $0.0037").title).toBe("$0.00369663 for the successful run");
  expect(screen.getByLabelText("Run cost: $0.0012+")).toBeTruthy();
  expect(screen.getByLabelText("Run cost: Cost not reported").classList.contains("evaluation-muted")).toBe(true);
});

it("shows a missing Model gateway as one info callout that opens the Workspace page", () => {
  const onOpenWorkspace = vi.fn();
  setup({ candidates: [], document: null, setup: { configured: false, model: "" } }, [], { onOpenWorkspace });

  const callout = screen.getByText("Evaluations need a Model gateway").closest(".ui-callout");
  expect(callout.className).toContain("ui-tone-info");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Configure a model/)).toBeNull();
  expect(screen.getByRole("button", { name: "Start evaluation" }).disabled).toBe(true);

  fireEvent.click(within(callout).getByRole("button", { name: "Set up Model gateway" }));
  expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
});
