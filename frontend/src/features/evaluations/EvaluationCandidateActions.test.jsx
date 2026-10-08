import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EvaluationsPage } from "./EvaluationsPage.jsx";

afterEach(() => cleanup());

const fields = [
  { id: "total", name: "Total", data_type: "number" },
  { id: "supplier", name: "Supplier", data_type: "string" },
  { id: "po", name: "PO", data_type: "string" },
];

const template = { name: "Invoice", description: "Invoice", fields };

const raw = (total, supplier = "Fenwick") => [
  { field_id: "total", status: "ok", answer: total },
  { field_id: "supplier", status: "ok", answer: supplier },
  { field_id: "po", status: "not_found", answer: null },
];

const record = (id, model, extra = {}) => ({
  recordId: id,
  revision: 0,
  fields,
  model,
  pdf: false,
  structured: false,
  queueMs: 0,
  processingMs: 100,
  attempts: 1,
  ...extra,
});

const candidate = (id, model = id) => ({ id, revision: 0, model, pdf: false, structured: false, template });

const evaluationDocument = (key, name, references = {}) => ({
  key,
  kind: "upload",
  file: new File(["x"], name, { type: "application/pdf" }),
  name,
  reference: { references, definitions: {} },
  save: "idle",
  availability: "ok",
});

const pair = (result) => ({ status: "success", result, previous: null, detail: "retained" });

const gateway = (overrides = {}) => ({
  canManage: true,
  loading: false,
  conflict: false,
  record: {
    configured: true,
    credential_status: "configured",
    gateway_url: "http://gateway.test/v1",
    model_name: "beta",
    sequential_calls: false,
    supports_pdf_input: false,
    supports_structured_output: false,
    assistant_model: null,
    classification_model: { model_name: "sorter", supports_pdf_input: false, supports_structured_output: true },
  },
  setExtractionModel: vi.fn(async () => true),
  ...overrides,
});

// Two model candidates on one or two documents. Alpha answers Total 10, beta answers Total 12.
function setup({
  documents = [evaluationDocument("doc", "invoice.pdf", { "total:number": { verified: true, value: 10 } })],
  candidates = [candidate("a", "alpha"), candidate("b", "beta")],
  props = {},
} = {}) {
  const details = {};
  const pairs = {};

  for (const [index, d] of documents.entries()) {
    pairs[d.key] = {
      a: pair(record(`a-${index}`, "alpha")),
      b: pair(record(`b-${index}`, "beta")),
    };
    details[`a-${index}`] = { raw: raw(10) };
    details[`b-${index}`] = { raw: raw(12, "Harbour") };
  }

  const toast = { success: vi.fn(), error: vi.fn() };
  const undo = vi.fn();

  const evaluation = {
    state: {
      id: "evaluation",
      setup: { configured: true, model: "beta", revision: 1 },
      library: { save_available: true },
      libraryVersion: 0,
      documents,
      pairs,
      mode: "models",
      alignments: {},
      columns: {},
      candidates,
    },
    patch: vi.fn(),
    edit: vi.fn(),
    run: vi.fn(),
    api: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(async () => null),
    setReference: vi.fn(),
    acceptReferences: vi.fn(() => undo),
    loadDetail: vi.fn(async (id) => details[id] || null),
    detail: (id) => details[id] || null,
    hydrate: vi.fn(),
  };

  render(
    <EvaluationsPage
      evaluation={evaluation}
      templates={[]}
      enabled
      maxSourceFileBytes={1000}
      toast={toast}
      {...props}
    />,
  );

  return { evaluation, toast, undo };
}

const openMenu = (index) => fireEvent.click(screen.getByRole("button", { name: `Candidate ${index} options` }));

it("accepts all answers from a candidate, keeps a differing verified answer unless overwritten, and offers undo", () => {
  const { evaluation, toast, undo } = setup();
  openMenu(2);
  fireEvent.click(screen.getByRole("button", { name: "Accept all answers…" }));

  const dialog = screen.getByRole("dialog", { name: "Accept answers from “beta”?" });
  expect(within(dialog).getByText(/for “invoice.pdf”/)).toBeTruthy();
  expect(within(dialog).getByText("2 answers").parentElement.textContent).toBe("2 answers to set");
  expect(within(dialog).getByText("1 verified answer").parentElement.textContent).toBe("1 verified answer differs · kept");
  expect(within(dialog).getByText("10 → 12")).toBeTruthy();
  const accept = within(dialog).getByRole("button", { name: "Accept 2 answers" });

  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Overwrite this answer too" }));
  expect(within(dialog).getByText("1 verified answer").parentElement.textContent).toContain("overwritten");
  expect(accept.textContent).toBe("Accept 3 answers");
  fireEvent.click(accept);

  const [changes] = evaluation.acceptReferences.mock.calls[0];
  expect(changes.map((change) => [change.docKey, change.identity, change.value])).toEqual([
    ["doc", "supplier:string", { verified: true, absent: false, exact: false, value: "Harbour" }],
    ["doc", "po:string", { verified: true, absent: true, exact: false, value: "" }],
    ["doc", "total:number", { verified: true, absent: false, exact: false, value: 12 }],
  ]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(toast.success).toHaveBeenCalledWith(
    "3 expected answers accepted from beta",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  toast.success.mock.calls[0][1].action.onClick();
  expect(undo).toHaveBeenCalledTimes(1);
});

it("counts matching verified answers and writes nothing when cancelled", () => {
  const { evaluation } = setup();
  openMenu(1);
  fireEvent.click(screen.getByRole("button", { name: "Accept all answers…" }));
  const dialog = screen.getByRole("dialog", { name: "Accept answers from “alpha”?" });
  expect(within(dialog).getByText("1 verified answer").parentElement.textContent).toBe("1 verified answer already matches");
  expect(within(dialog).queryByRole("checkbox")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(evaluation.acceptReferences).not.toHaveBeenCalled();
});

it("accepts a candidate's answers for every document in one update", async () => {
  const { evaluation, toast } = setup({
    documents: [
      evaluationDocument("doc", "invoice.pdf", { "total:number": { verified: true, value: 10 } }),
      evaluationDocument("doc2", "receipt.pdf"),
    ],
  });

  openMenu(2);
  fireEvent.click(screen.getByRole("button", { name: "Accept answers for every document…" }));
  const dialog = await screen.findByRole("dialog", { name: "Accept answers from “beta”?" });
  expect(evaluation.loadDetail).toHaveBeenCalledWith("b-1");
  expect(within(dialog).getByText(/for 2 documents from/)).toBeTruthy();
  expect(within(dialog).getByText("invoice.pdf · Total")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept 5 answers" }));

  const [changes] = evaluation.acceptReferences.mock.calls[0];
  expect(changes.map((change) => `${change.docKey} ${change.identity}`)).toEqual([
    "doc supplier:string",
    "doc po:string",
    "doc2 total:number",
    "doc2 supplier:string",
    "doc2 po:string",
  ]);
  expect(toast.success).toHaveBeenCalledWith("5 expected answers accepted from beta", expect.anything());
});

it("offers the best model for extraction and saves only the extraction model with its tested settings", async () => {
  const onOpenWorkspace = vi.fn();
  const modelConfiguration = gateway();
  const { toast } = setup({ props: { modelConfiguration, onOpenWorkspace } });

  // Alpha is the only accurate candidate, so it leads and offers its model.
  const head = screen.getByRole("textbox", { name: "Candidate 1 model" }).closest("th");
  expect(within(head).getByText("Best")).toBeTruthy();
  fireEvent.click(within(head).getByRole("button", { name: "Use for extraction…" }));

  const dialog = await screen.findByRole("alertdialog", { name: "Use “alpha” for extraction?" });
  expect(dialog.textContent).toContain("Extraction model: beta → alpha");
  expect(dialog.textContent).toContain("Direct PDF input off and Structured output off");
  expect(dialog.textContent).toContain("The Template assistant uses it too.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Change extraction model" }));

  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(modelConfiguration.setExtractionModel).toHaveBeenCalledWith({
    model_name: "alpha",
    supports_pdf_input: false,
    supports_structured_output: false,
  });
  const [message, options] = toast.success.mock.calls[0];
  expect(message).toBe("Extraction model changed: alpha");
  expect(options.action.label).toBe("Open model settings");
  options.action.onClick();
  expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
});

it("explains why a model can't be used for extraction", () => {
  setup({ props: { modelConfiguration: gateway() } });
  openMenu(2);
  const menu = within(screen.getByRole("group", { name: "Candidate 2 options" }));
  const action = menu.getByRole("button", { name: "Use for extraction…" });
  expect(action.disabled).toBe(true);
  expect(document.getElementById(action.getAttribute("aria-describedby")).textContent).toBe(
    "This is already the extraction model.",
  );
});

it("explains an untested or unreadable model", () => {
  const hint = () => {
    const action = screen.getByRole("button", { name: "Use for extraction…" });
    expect(action.disabled).toBe(true);

    return document.getElementById(action.getAttribute("aria-describedby")).textContent;
  };

  const unreadable = gateway();
  unreadable.record = { ...unreadable.record, credential_status: "unavailable" };
  setup({ props: { modelConfiguration: unreadable } });
  openMenu(1);
  expect(hint()).toBe("The saved API key can’t be read. Fix the Model gateway first.");
  cleanup();

  // Edited after its run: the new model hasn't been tested, so it isn't offered either.
  setup({ candidates: [candidate("a", "gamma"), candidate("b", "beta")], props: { modelConfiguration: gateway() } });
  expect(screen.queryByRole("button", { name: "Use for extraction…" })).toBeNull();
  openMenu(1);
  expect(hint()).toBe("Run this candidate with these settings first.");
});

it("hides Use for extraction from members who can't edit model settings", () => {
  setup({ props: { modelConfiguration: gateway({ canManage: false }) } });
  expect(screen.queryByRole("button", { name: "Use for extraction…" })).toBeNull();
  openMenu(1);
  expect(screen.queryByRole("button", { name: "Use for extraction…" })).toBeNull();
});

it("keeps a failed model change inline in the confirmation", async () => {
  const modelConfiguration = gateway({
    setExtractionModel: vi.fn(async () => {
      throw Object.assign(new Error("precondition_failed"), { status: 412, code: "precondition_failed" });
    }),
  });

  const { toast } = setup({ props: { modelConfiguration } });
  fireEvent.click(screen.getByRole("button", { name: "Use for extraction…" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Use “alpha” for extraction?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Change extraction model" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "This changed elsewhere. Check the latest settings and try again.",
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
});
