import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EvaluationsPage } from "./EvaluationsPage.jsx";
import { useEvaluations } from "./useEvaluations.js";
import { createResultCache } from "./resultCache.js";
import { FakeKeyRange, createFakeIndexedDB } from "../../test/fakeIndexedDB.js";

const fields = [
  { id: "total", name: "Total", description: "Amount payable", data_type: "number" },
  { id: "supplier", name: "Supplier", description: "Issuer", data_type: "string" },
];

const summary = (id, name, revision = 1) => ({
  id,
  name,
  source_name: `${id}.pdf`,
  mime_type: "application/pdf",
  byte_size: 2048,
  page_count: 1,
  revision,
  updated_at: "2026-09-30T10:00:00Z",
  updated_by_name: "Priya S.",
  fields: [{ identity: "total:number", name: "Total", data_type: "number", verified: true }],
});

const reference = (value) => ({
  version: 1,
  definitions: { "total:number": fields[0] },
  references: { "total:number": { verified: true, absent: false, exact: false, value } },
});

let database, streams, overrides, library;

const toast = { success: vi.fn(), error: vi.fn() };

async function server(url, options = {}) {
  const path = url.replace(/^\/v1/, ""),
    method = options.method || "GET";

  if (path === "/evaluations/setup")
    return Response.json({
      configured: true,
      revision: 1,
      model: "model",
      pdf: false,
      structured: false,
      staging: { document_concurrency: 4 },
    });

  if (path === "/evaluations/documents/status") return Response.json({ save_available: true, reason: null });

  if (path.startsWith("/evaluations/documents?"))
    return Response.json({ documents: Object.values(library).map((e) => e.document), next_cursor: null });
  const entry = path.match(/^\/evaluations\/documents\/([^/]+)$/)?.[1];

  if (method === "GET" && entry) return Response.json(library[entry]);

  if (path.startsWith("/evaluations/templates/")) return Response.json({ name: "Invoice", current_version: 1, fields });

  if (method === "POST" && path === "/evaluations/actions")
    return Response.json({ action_id: "action" }, { status: 201 });

  if (method === "DELETE") return new Response(null, { status: 204 });

  if (path === "/evaluations/run") {
    const evaluation =
      options.body instanceof FormData ? JSON.parse(options.body.get("evaluation")) : JSON.parse(options.body);

    return new Response(
      new ReadableStream({
        start(controller) {
          streams.push({ evaluation, controller });
        },
      }),
    );
  }

  throw new Error(`Unexpected ${method} ${path}`);
}

beforeEach(() => {
  database = createFakeIndexedDB();
  streams = [];
  overrides = {};
  library = {
    evd_a: { document: summary("evd_a", "Harbour invoice"), reference: reference("3420") },
    evd_b: { document: summary("evd_b", "Northwind invoice"), reference: reference("880") },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const custom = overrides[`${options.method || "GET"} ${url.replace(/^\/v1/, "")}`];

      return custom ? custom(options) : server(url, options);
    }),
  );
});

const createCache = () => createResultCache({ indexedDB: database, keyRange: FakeKeyRange });

function Harness({ templates = [{ id: "invoice", name: "Invoice", current_version: 1 }], onTemplateSaved }) {
  const evaluation = useEvaluations({
    workspaceId: "workspace",
    sessionId: "session",
    enabled: true,
    active: true,
    createCache,
  });

  return (
    <EvaluationsPage
      evaluation={evaluation}
      toast={toast}
      templates={templates}
      onTemplateSaved={onTemplateSaved}
      enabled
      maxSourceFileBytes={10000}
    />
  );
}

const upload = (name) => new File(["sample"], name, { type: "application/pdf" });

async function chooseFromLibrary(names) {
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  const picker = await screen.findByRole("dialog", { name: "Evaluation library" });

  for (const name of names) fireEvent.click(await within(picker).findByRole("checkbox", { name: `Select ${name}` }));
  fireEvent.click(within(picker).getByRole("button", { name: new RegExp(`^Add ${names.length}`) }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Evaluation library" })).toBeNull());
}

async function startModels() {
  fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "invoice" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Candidate 2 model" }), { target: { value: "other" } });
  await screen.findByText(/2 fields/);
  // Candidate 1 defaults to the Workspace model once setup loads.
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Candidate 1 model" }).value).toBe("model"));
}

const success = (stream, index, total) =>
  stream.controller.enqueue(
    new TextEncoder().encode(
      JSON.stringify({
        type: "success",
        submissionId: stream.evaluation.id,
        document_instance_id: stream.evaluation.document_instance_id,
        candidateId: stream.evaluation.candidates[index].id,
        revision: 0,
        attempt: 1,
        result: {
          raw: [
            { field_id: "total", status: "ok", answer: total },
            { field_id: "supplier", status: "ok", answer: "Harbour" },
          ],
          fields,
          model: stream.evaluation.candidates[index].model,
          attempts: 1,
          processingMs: 1000 + index,
          queueMs: 0,
        },
      }) + "\n",
    ),
  );

it("edits saved answers from Manage library without configuring or running a model, then saves and reopens them", async () => {
  overrides["GET /evaluations/setup"] = () => Response.json({ configured: false });
  overrides["PATCH /evaluations/documents/evd_a"] = (options) => {
    const body = JSON.parse(options.body);
    library.evd_a = { document: summary("evd_a", "Harbour invoice", 2), reference: body.reference };

    return Response.json(library.evd_a);
  };

  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("keep.pdf")] } });
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  const manager = await screen.findByRole("dialog", { name: "Manage library" });
  fireEvent.click(await within(manager).findByRole("button", { name: "Edit Harbour invoice" }));
  const matrix = await screen.findByRole("region", { name: "Comparison matrix" });
  expect(within(matrix).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Field", "Expected answer"]);
  expect(screen.queryByRole("textbox", { name: /model/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Run all/ })).toBeNull();
  expect(screen.queryByText(/Configure a model/)).toBeNull();
  expect(screen.queryByText(/not requested/)).toBeNull();
  fireEvent.click(within(matrix).getByRole("button", { name: "Edit expected Total" }));
  fireEvent.change(within(matrix).getByRole("textbox", { name: "Expected Total" }), { target: { value: "3500" } });
  fireEvent.click(within(matrix).getByRole("button", { name: "Verify" }));
  expect(library.evd_a.reference.references["total:number"].value).toBe("3420");

  // Leaving and reopening keeps the private working copy and unrelated uploads.
  fireEvent.click(screen.getByRole("button", { name: "Back to evaluation" }));
  expect(screen.getByText("keep.pdf", { selector: "strong" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  await screen.findByRole("region", { name: "Comparison matrix" });
  fireEvent.click(screen.getByRole("button", { name: "Update saved answers…" }));
  const review = screen.getByRole("dialog", { name: "Review saved answer update" });
  expect(within(review).getByText("3500 ✓")).toBeTruthy();
  fireEvent.click(within(review).getByRole("button", { name: "Update saved answers" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved answers updated: Harbour invoice", expect.anything()));
  expect(library.evd_a.reference.references["total:number"].value).toBe("3500");
  expect(streams).toHaveLength(0);
  expect(fetch.mock.calls.some(([url]) => url === "/v1/evaluations/actions")).toBe(false);
});

it("edits the saved field Template before reviewing an answer without any candidate", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit template" }));
  const editor = screen.getByRole("dialog", { name: "Edit template" });
  fireEvent.change(within(editor).getByRole("combobox", { name: "Type" }), { target: { value: "string" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Review as Text" }));
  const answer = screen.getByRole("dialog", { name: "Verify expected answer" });
  expect(within(answer).getByRole("textbox", { name: "Expected value" }).value).toBe("3420");
  fireEvent.click(within(answer).getByRole("button", { name: "Use as expected answer" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Verify expected answer" })).toBeNull());
  expect(screen.getByRole("button", { name: "Update saved answers…" })).toBeTruthy();
  expect(library.evd_a.reference.definitions["total:number"]).toBeTruthy();
  expect(streams).toHaveLength(0);
});

it("keeps Manage library open with a retryable error if the saved entry cannot load", async () => {
  overrides["GET /evaluations/documents/evd_a"] = () => Response.json({ error: { message: "Try opening again." } }, { status: 503 });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  await screen.findByText("This document couldn’t be opened. Try again.");
  expect(screen.getByRole("button", { name: "Edit Harbour invoice" }).disabled).toBe(false);
  expect(screen.queryByRole("region", { name: "Comparison matrix" })).toBeNull();
});

it("loads the latest Template into the library editor and saves reviewed changes without a model", async () => {
  const table = (type) => ({
    id: "items", name: "Items", data_type: "array<object>",
    object_schema: { mode: "table", columns: [{ key: "quantity", heading: "Quantity", data_type: type, description: "Item count" }] },
  });

  library.evd_a.reference.definitions["items:array<object>"] = table("string");
  library.evd_a.reference.references["items:array<object>"] = {
    verified: true, value: [{ quantity: "7" }], rows: { mode: "position" },
  };
  library.evd_a.reference.definitions["old code:string"] = { id: "old", name: "Old code", data_type: "string" };
  library.evd_a.reference.references["old code:string"] = { verified: true, value: "Keep until reviewed" };
  const saved = structuredClone(library.evd_a.reference);
  overrides["GET /evaluations/setup"] = () => Response.json({ configured: false });
  overrides["GET /evaluations/templates/invoice"] = () => Response.json({
    name: "Invoice", current_version: 3, fields: [fields[0], table("number"), fields[1]],
  });
  overrides["PATCH /evaluations/documents/evd_a"] = (options) => {
    library.evd_a = { document: summary("evd_a", "Harbour invoice", 2), reference: JSON.parse(options.body).reference };

    return Response.json(library.evd_a);
  };

  render(<Harness templates={[{ id: "invoice", name: "Invoice", current_version: 3 }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose template version" }));
  const picker = within(await screen.findByRole("dialog", { name: "Choose template version" }));
  fireEvent.change(picker.getByRole("combobox", { name: "Template", exact: true }), { target: { value: "invoice" } });
  expect(picker.getByRole("option", { name: "Current · v3" }).selected).toBe(true);
  fireEvent.click(picker.getByRole("button", { name: "Use template version" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose template version" })).toBeNull());
  expect(screen.getByTitle("Invoice · v3")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit expected Total" }).textContent).toContain("3420");
  expect(screen.getByRole("button", { name: "Add expected Supplier" })).toBeTruthy();
  expect(screen.getByText("Removed from the template draft · saved answer kept")).toBeTruthy();
  expect(library.evd_a.reference).toEqual(saved);

  fireEvent.click(screen.getByRole("button", { name: "Review updated table" }));
  const answer = within(screen.getByRole("dialog", { name: "Verify expected answer" }));
  expect(answer.getByRole("textbox", { name: "Expected row 1 Quantity" }).value).toBe("7");
  fireEvent.click(answer.getByRole("button", { name: "Use as expected answer" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete expected answer for Old code" }));
  fireEvent.click(screen.getByRole("button", { name: "Add expected Supplier" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Supplier" }), { target: { value: "Harbour" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(library.evd_a.reference).toEqual(saved);
  fireEvent.click(screen.getByRole("button", { name: "Update saved answers…" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Review saved answer update" })).getByRole("button", { name: "Update saved answers" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved answers updated: Harbour invoice", expect.anything()));
  expect(library.evd_a.reference.references["total:number"]).toEqual(saved.references["total:number"]);
  expect(library.evd_a.reference.references["items:array<object>"].value).toEqual([{ quantity: 7 }]);
  expect(library.evd_a.reference.definitions["items:array<object>"].object_schema.columns[0].data_type).toBe("number");
  expect(library.evd_a.reference.references["supplier:string"].value).toBe("Harbour");
  expect(library.evd_a.reference.definitions["old code:string"]).toBeUndefined();
  expect(streams).toHaveLength(0);
  expect(fetch.mock.calls.some(([url]) => url === "/v1/evaluations/actions")).toBe(false);
});

it("chooses a historical library Template version and ignores a later load after Cancel", async () => {
  overrides["GET /evaluations/templates/invoice?version=1"] = () => Response.json({ name: "Invoice", current_version: 3, fields: [fields[0]] });
  render(<Harness templates={[{ id: "invoice", name: "Invoice", current_version: 3 }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose template version" }));
  let picker = within(await screen.findByRole("dialog", { name: "Choose template version" }));
  fireEvent.change(picker.getByRole("combobox", { name: "Template", exact: true }), { target: { value: "invoice" } });
  fireEvent.change(picker.getByRole("combobox", { name: "Version" }), { target: { value: "1" } });
  fireEvent.click(picker.getByRole("button", { name: "Use template version" }));
  await screen.findByTitle("Invoice · v1");
  expect(screen.queryByRole("button", { name: "Add expected Supplier" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose template version" }));
  picker = within(await screen.findByRole("dialog", { name: "Choose template version" }));
  expect(picker.getByRole("combobox", { name: "Template", exact: true }).value).toBe("invoice");
  expect(picker.getByRole("option", { name: "Current · v3" }).selected).toBe(true);
  let finish;
  overrides["GET /evaluations/templates/invoice"] = () => new Promise((resolve) => { finish = resolve; });
  fireEvent.click(picker.getByRole("button", { name: "Use template version" }));
  fireEvent.click(picker.getByRole("button", { name: "Cancel" }));
  await act(async () => finish(Response.json({ name: "Invoice", current_version: 3, fields })));
  expect(screen.getByTitle("Invoice · v1")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add expected Supplier" })).toBeNull();
  expect(streams).toHaveLength(0);
});

it.each(["", "1"])("saves edits to the selected library Template version '%s', with cancellation and retry", async (version) => {
  const savedAnswers = structuredClone(library.evd_a.reference);
  const onTemplateSaved = vi.fn();
  const updates = [];
  const selected = { name: "Invoice", description: "Invoice fields", tags: ["Finance"], current_version: 3, fields };
  overrides[`GET /evaluations/templates/invoice${version ? `?version=${version}` : ""}`] = () => Response.json(selected);
  overrides["PATCH /templates/invoice"] = (options) => {
    updates.push(JSON.parse(options.body));

    return updates.length === 1
      ? Response.json({ error: { message: "Could not save Template. Try again." } }, { status: 503 })
      : Response.json({ template_id: "invoice", version: 4, status: "active" });
  };

  render(<Harness templates={[{ id: "invoice", name: "Invoice", current_version: 3 }]} onTemplateSaved={onTemplateSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose template version" }));
  const picker = within(await screen.findByRole("dialog", { name: "Choose template version" }));
  fireEvent.change(picker.getByRole("combobox", { name: "Template", exact: true }), { target: { value: "invoice" } });
  fireEvent.change(picker.getByRole("combobox", { name: "Version" }), { target: { value: version } });
  fireEvent.click(picker.getByRole("button", { name: "Use template version" }));
  await screen.findByTitle(`Invoice · v${version || 3}`);

  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  let editor = within(screen.getByRole("dialog", { name: "Edit template" }));
  expect(editor.getByRole("textbox", { name: "Template name" }).value).toBe("Invoice");
  fireEvent.change(editor.getByRole("combobox", { name: "Type" }), { target: { value: "string" } });
  fireEvent.click(editor.getByRole("button", { name: "Cancel" }));
  expect(updates).toEqual([]);
  expect(screen.getByRole("button", { name: "Edit expected Total" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  editor = within(screen.getByRole("dialog", { name: "Edit template" }));
  fireEvent.change(editor.getByRole("combobox", { name: "Type" }), { target: { value: "string" } });
  fireEvent.click(editor.getByRole("button", { name: "Save template" }));
  await editor.findByText("Couldn't save the template. Try again.");
  expect(screen.getByTitle(`Invoice · v${version || 3}`)).toBeTruthy();
  expect(library.evd_a.reference).toEqual(savedAnswers);
  fireEvent.click(editor.getByRole("button", { name: "Save template" }));
  await screen.findByTitle("Invoice · v4");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull());
  expect(updates).toEqual([
    { fields: [{ name: "Total", description: "Amount payable", data_type: "string" }, { name: "Supplier", description: "Issuer", data_type: "string" }] },
    { fields: [{ name: "Total", description: "Amount payable", data_type: "string" }, { name: "Supplier", description: "Issuer", data_type: "string" }] },
  ]);
  expect(onTemplateSaved).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith("Template saved: Invoice", expect.anything());
  expect(screen.getAllByRole("rowheader", { name: /^Total/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Review as Text" })).toBeTruthy();
  expect(library.evd_a.reference).toEqual(savedAnswers);
  expect(screen.queryByRole("button", { name: "Update saved answers…" })).toBeNull();

  // An unchanged save creates no version; a name edit updates metadata only.
  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  editor = within(screen.getByRole("dialog", { name: "Edit template" }));
  expect(editor.getByRole("textbox", { name: "Template name" }).value).toBe("Invoice");
  fireEvent.click(editor.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull());
  expect(updates).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  editor = within(screen.getByRole("dialog", { name: "Edit template" }));
  fireEvent.change(editor.getByRole("textbox", { name: "Template name" }), { target: { value: "Updated invoice" } });
  fireEvent.click(editor.getByRole("button", { name: "Save template" }));
  await screen.findByTitle("Updated invoice · v4");
  expect(updates[2]).toEqual({ name: "Updated invoice" });
  expect(onTemplateSaved).toHaveBeenCalledTimes(2);
  expect(library.evd_a.reference).toEqual(savedAnswers);
  expect(streams).toHaveLength(0);
  expect(fetch.mock.calls.some(([url]) => url === "/v1/evaluations/actions")).toBe(false);
});

it("keeps the library draft after a Template load failure and allows retry", async () => {
  overrides["GET /evaluations/templates/invoice"] = () => Response.json({ error: { message: "Template field version not found." } }, { status: 404 });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Harbour invoice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose template version" }));
  const picker = within(await screen.findByRole("dialog", { name: "Choose template version" }));
  fireEvent.change(picker.getByRole("combobox", { name: "Template", exact: true }), { target: { value: "invoice" } });
  fireEvent.click(picker.getByRole("button", { name: "Use template version" }));
  expect(await picker.findByRole("alert")).toHaveProperty("textContent", "This item no longer exists.");
  expect(screen.getByRole("button", { name: "Edit expected Total" }).textContent).toContain("3420");
  delete overrides["GET /evaluations/templates/invoice"];
  fireEvent.click(picker.getByRole("button", { name: "Use template version" }));
  await screen.findByTitle("Invoice · v1");
  expect(screen.queryByRole("dialog", { name: "Choose template version" })).toBeNull();
});

it("mixes saved entries with a fresh upload and moves between documents with Previous and Next", async () => {
  render(<Harness />);
  await chooseFromLibrary(["Harbour invoice", "Northwind invoice"]);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("fresh.pdf")] } });
  expect(screen.getByText("fresh.pdf", { selector: "strong" })).toBeTruthy();
  // Setup only chooses documents: answers are verified, and uploads saved, after running.
  expect(screen.queryByRole("button", { name: "Expected answers" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save to library…" })).toBeNull();
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams).toHaveLength(3));
  // Saved entries are sent by identity as JSON; the fresh upload streams its file.
  expect(streams.map((s) => s.evaluation.document?.id || "upload").sort()).toEqual(["evd_a", "evd_b", "upload"]);
  await act(async () => {
    for (const stream of streams) {
      success(stream, 0, { evd_a: 3420, evd_b: 880 }[stream.evaluation.document?.id] ?? 1);
      success(stream, 1, 1);
      stream.controller.close();
    }
  });
  // The matrix shows one document at a time, with no batch summary.
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByText(/Batch summary/)).toBeNull();
  const nav = screen.getByRole("navigation", { name: "Documents in this evaluation" });
  expect(within(nav).getByText("Document 1 of 3")).toBeTruthy();
  expect(await screen.findByTitle("Harbour invoice")).toBeTruthy();
  await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
  fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
  expect(within(nav).getByText("Document 2 of 3")).toBeTruthy();
  expect(screen.getByTitle("Northwind invoice")).toBeTruthy();
  fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
  expect(screen.getByTitle("fresh.pdf")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save to library…" })).toBeTruthy();
  // Previous wraps around from the first document to the last.
  fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
  fireEvent.click(within(nav).getByRole("button", { name: "Previous" }));
  expect(within(nav).getByText("Document 3 of 3")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Inspect Total for Candidate 1" })).toBeTruthy());
});

it("keeps the single-document Evaluation unchanged: no tabs or summary", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("one.pdf")] } });
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(screen.queryByRole("navigation", { name: "Documents in this evaluation" })).toBeNull();
  expect(screen.getByRole("button", { name: "Run all (2 candidates)" }).disabled).toBe(true);
  await act(async () => {
    success(streams[0], 0, 5);
    success(streams[0], 1, 6);
    streams[0].controller.close();
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Inspect Total for Candidate 2" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add expected Total" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Total" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() => expect(screen.getByText("Best")).toBeTruthy());
  expect(screen.getByText("100%")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => url === "/v1/evaluations/run")).toHaveLength(1);
});

it("saves an upload from the results after running, retries a lost response with the same operation, and the Clear guard lists unsaved work", async () => {
  const operations = [];
  overrides["POST /evaluations/documents"] = (options) => {
    const metadata = JSON.parse(options.body.get("metadata"));
    operations.push(metadata);

    if (operations.length === 1) return Promise.reject(new TypeError("Failed to fetch"));
    library.evd_new = { document: summary("evd_new", metadata.name), reference: metadata.reference };

    return Response.json(library.evd_new, { status: 201 });
  };

  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Evaluation document"), {
    target: { files: [upload("fresh.pdf"), upload("other.pdf")] },
  });
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams.length).toBeGreaterThan(0));
  await act(async () => {
    for (const stream of streams) {
      success(stream, 0, 3420);
      success(stream, 1, 1);
      stream.controller.close();
    }
  });
  // Verify an answer in the matrix, then save this document with it.
  fireEvent.click(await screen.findByRole("button", { name: "Add expected Total" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Total" }), { target: { value: "3420" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  // Saving is blocked until every field has a verified answer.
  expect(screen.queryByText("No saved answer · verify this field")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save to library…" }));
  expect(screen.queryByRole("dialog", { name: "Save to evaluation library" })).toBeNull();
  expect(screen.getByText("No saved answer · verify this field")).toBeTruthy();
  expect(toast.error).toHaveBeenCalledWith("Verify every field before saving to the library.", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Add expected Supplier" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Supplier" }), { target: { value: "Fenwick" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(screen.queryByText("No saved answer · verify this field")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save to library…" }));
  const dialog = screen.getByRole("dialog", { name: "Save to evaluation library" });
  expect(within(dialog).getByText(/2 of 2 answers verified/)).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name in library" }), { target: { value: "Fenwick print" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save to evaluation library" })).toBeNull());
  expect(operations.map((o) => o.operation_id)).toEqual([operations[0].operation_id, operations[0].operation_id]);
  expect(operations[1].reference.references["total:number"]).toMatchObject({ verified: true, value: "3420" });
  expect(screen.getByTitle("Fenwick print")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save to library…" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Clear evaluation/ }));
  const guard = screen.getByRole("dialog", { name: "Clear evaluation" });
  expect(within(guard).getByText("other.pdf")).toBeTruthy();
  expect(within(guard).queryByText("Fenwick print")).toBeNull();
  fireEvent.click(within(guard).getByRole("button", { name: "Clear evaluation" }));
  await waitFor(() => expect(screen.queryByText("other.pdf", { selector: "strong" })).toBeNull());
});

it("reviews an update of shared answers from the results and resolves a conflict with Replace with mine against the reviewed revision", async () => {
  const patches = [];
  overrides["PATCH /evaluations/documents/evd_a"] = (options) => {
    const body = JSON.parse(options.body);
    patches.push(body.expected_revision);

    if (body.expected_revision === 1)
      return Response.json(
        {
          error: { code: "revision_conflict", message: "Changed" },
          current: { document: summary("evd_a", "Harbour invoice", 2), reference: reference("3402") },
        },
        { status: 409 },
      );

    return Response.json({ document: summary("evd_a", "Harbour invoice", 3), reference: body.reference });
  };

  render(<Harness />);
  await chooseFromLibrary(["Harbour invoice"]);
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams.length).toBeGreaterThan(0));
  await act(async () => {
    for (const stream of streams) {
      success(stream, 0, 3420);
      success(stream, 1, 1);
      stream.controller.close();
    }
  });
  fireEvent.click(await screen.findByRole("button", { name: "Edit expected Total" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Total" }), { target: { value: "3500" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(screen.getByTitle("Harbour invoice").textContent).toContain("answer changes not saved");
  fireEvent.click(screen.getByRole("button", { name: "Add expected Supplier" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Supplier" }), { target: { value: "Harbour" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  fireEvent.click(await screen.findByRole("button", { name: "Update saved answers…" }));
  const review = screen.getByRole("dialog", { name: "Review saved answer update" });
  expect(within(review).getByText("3420 ✓")).toBeTruthy();
  expect(within(review).getByText("3500 ✓")).toBeTruthy();
  fireEvent.click(within(review).getByRole("button", { name: "Update saved answers" }));
  expect(await within(review).findByText("The saved answers changed since you loaded them")).toBeTruthy();
  expect(within(review).getByText("3402 ✓")).toBeTruthy();
  expect(within(review).getByRole("button", { name: "Use saved version" })).toBeTruthy();
  fireEvent.click(within(review).getByRole("button", { name: "Replace with mine" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review saved answer update" })).toBeNull());
  expect(patches).toEqual([1, 2]);
  expect(screen.getByTitle("Harbour invoice").textContent).not.toContain("answer changes not saved");
  expect(screen.queryByRole("button", { name: "Update saved answers…" })).toBeNull();
});

it("links a renamed field to its saved answer for this Evaluation only, without changing the saved set", async () => {
  const amountDue = { id: "amount_due", name: "Amount due", description: "Old name for Total", data_type: "number" };
  library = {
    evd_r: {
      document: summary("evd_r", "Renamed invoice"),
      reference: {
        version: 1,
        definitions: { "amount due:number": amountDue },
        references: { "amount due:number": { verified: true, absent: false, exact: false, value: "3420" } },
      },
    },
  };
  render(<Harness />);
  await chooseFromLibrary(["Renamed invoice"]);
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams).toHaveLength(1));
  await act(async () => {
    success(streams[0], 0, 3420);
    success(streams[0], 1, 1);
    streams[0].controller.close();
  });
  const matrix = await screen.findByRole("region", { name: "Comparison matrix" });
  await within(matrix).findByRole("button", { name: "Inspect Total for Candidate 1" });
  // Nothing is inferred from the rename: Total stays unscored until the user links it.
  expect(within(matrix).getByText("Not requested by any candidate · saved answer kept")).toBeTruthy();
  expect(within(matrix).queryByText("100%")).toBeNull();
  fireEvent.change(within(matrix).getByRole("combobox", { name: "Link saved Amount due to a field" }), {
    target: { value: "total:number" },
  });
  expect(await within(matrix).findByText(/Linked to saved “Amount due”/)).toBeTruthy();
  await waitFor(() => expect(within(matrix).getByText("100%")).toBeTruthy());
  expect(within(matrix).getByText("0%")).toBeTruthy();
  expect(within(matrix).queryByText("Not requested by any candidate · saved answer kept")).toBeNull();
  // A link is a temporary comparison setting, not a change to the saved answers.
  expect(screen.queryByText("Working copy.")).toBeNull();
  fireEvent.click(within(matrix).getByRole("button", { name: "Unlink Total from saved Amount due" }));
  await waitFor(() => expect(within(matrix).queryByText("100%")).toBeNull());
  expect(within(matrix).getByRole("combobox", { name: "Link saved Amount due to a field" })).toBeTruthy();
});

it("confirms a library rename and reports a failed rename with a toast", async () => {
  overrides["PATCH /evaluations/documents/evd_a"] = (options) => {
    const body = JSON.parse(options.body);

    if (body.name === "Broken name") return Response.json({ error: { message: "Unexpected" } }, { status: 500 });

    library.evd_a = { ...library.evd_a, document: summary("evd_a", body.name, 2) };

    return Response.json({ document: library.evd_a.document });
  };

  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("keep.pdf")] } });
  fireEvent.click(screen.getByRole("button", { name: "Manage library" }));
  const manager = await screen.findByRole("dialog", { name: "Manage library" });

  fireEvent.click(await within(manager).findByRole("button", { name: "Rename Harbour invoice" }));
  let input = within(manager).getByRole("textbox", { name: "New name for Harbour invoice" });
  fireEvent.change(input, { target: { value: "Renamed invoice" } });
  fireEvent.submit(input.closest("form"));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Library item renamed: Renamed invoice", expect.anything()));

  fireEvent.click(within(manager).getByRole("button", { name: "Rename Renamed invoice" }));
  input = within(manager).getByRole("textbox", { name: "New name for Renamed invoice" });
  fireEvent.change(input, { target: { value: "Broken name" } });
  fireEvent.submit(input.closest("form"));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn't rename Renamed invoice.", expect.anything()),
  );
});
