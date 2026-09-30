import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EvaluationsPage } from "./EvaluationsPage.jsx";
import { useEvaluations } from "./useEvaluations.js";
import { createResultCache } from "./resultCache.js";
import { FakeKeyRange, createFakeIndexedDB } from "../../test/fakeIndexedDB.js";

const fields = [{ id: "total", name: "Total", description: "Amount payable", data_type: "number" }, { id: "supplier", name: "Supplier", description: "Issuer", data_type: "string" }];
const summary = (id, name, revision = 1) => ({ id, name, source_name: `${id}.pdf`, mime_type: "application/pdf", byte_size: 2048, page_count: 1, revision, updated_at: "2026-09-30T10:00:00Z", updated_by_name: "Priya S.", fields: [{ identity: "total:number", name: "Total", data_type: "number", verified: true }] });
const reference = value => ({ version: 1, definitions: { "total:number": fields[0] }, references: { "total:number": { verified: true, absent: false, exact: false, value } } });
let database, streams, overrides, library;
async function server(url, options = {}) {
  const path = url.replace(/^\/v1/, ""), method = options.method || "GET";
  if (path === "/evaluations/setup") return Response.json({ configured: true, revision: 1, model: "model", pdf: false, structured: false, staging: { document_concurrency: 4 } });
  if (path === "/evaluations/documents/status") return Response.json({ save_available: true, reason: null });
  if (path.startsWith("/evaluations/documents?")) return Response.json({ documents: Object.values(library).map(e => e.document), next_cursor: null });
  const entry = path.match(/^\/evaluations\/documents\/([^/]+)$/)?.[1];
  if (method === "GET" && entry) return Response.json(library[entry]);
  if (path.startsWith("/evaluations/templates/")) return Response.json({ name: "Invoice", current_version: 1, fields });
  if (method === "POST" && path === "/evaluations/actions") return Response.json({ action_id: "action" }, { status: 201 });
  if (method === "DELETE") return new Response(null, { status: 204 });
  if (path === "/evaluations/run") {
    const evaluation = options.body instanceof FormData ? JSON.parse(options.body.get("evaluation")) : JSON.parse(options.body);
    return new Response(new ReadableStream({ start(controller) { streams.push({ evaluation, controller }); } }));
  }
  throw new Error(`Unexpected ${method} ${path}`);
}
beforeEach(() => {
  database = createFakeIndexedDB(); streams = []; overrides = {};
  library = { evd_a: { document: summary("evd_a", "Harbour invoice"), reference: reference("3420") }, evd_b: { document: summary("evd_b", "Northwind invoice"), reference: reference("880") } };
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const custom = overrides[`${options.method || "GET"} ${url.replace(/^\/v1/, "")}`];
    return custom ? custom(options) : server(url, options);
  }));
});
const createCache = () => createResultCache({ indexedDB: database, keyRange: FakeKeyRange });
function Harness() {
  const evaluation = useEvaluations({ workspaceId: "workspace", sessionId: "session", enabled: true, active: true, createCache });
  return <EvaluationsPage evaluation={evaluation} templates={[{ id: "invoice", name: "Invoice", current_version: 1 }]} enabled maxSourceFileBytes={10000} />;
}
const upload = name => new File(["sample"], name, { type: "application/pdf" });
async function chooseFromLibrary(names) {
  fireEvent.click(screen.getByRole("button", { name: "Choose from library" }));
  const picker = await screen.findByRole("dialog", { name: "Choose from library" });
  for (const name of names) fireEvent.click(await within(picker).findByRole("checkbox", { name: `Select ${name}` }));
  fireEvent.click(within(picker).getByRole("button", { name: new RegExp(`^Add ${names.length}`) }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose from library" })).toBeNull());
}
async function startModels() {
  fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "invoice" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Candidate 2 model" }), { target: { value: "other" } });
  await screen.findByText(/2 fields/);
}
const success = (stream, index, total) => stream.controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "success", submissionId: stream.evaluation.id, document_instance_id: stream.evaluation.document_instance_id, candidateId: stream.evaluation.candidates[index].id, revision: 0, attempt: 1,
  result: { raw: [{ field_id: "total", status: "ok", answer: total }, { field_id: "supplier", status: "ok", answer: "Harbour" }], fields, model: stream.evaluation.candidates[index].model, attempts: 1, processingMs: 1000 + index, queueMs: 0 } }) + "\n"));

it("mixes saved entries with a fresh upload, runs a Batch Evaluation and summarizes each document equally", async () => {
  render(<Harness />);
  await chooseFromLibrary(["Harbour invoice", "Northwind invoice"]);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("fresh.pdf")] } });
  expect(screen.getByText("fresh.pdf", { selector: "strong" })).toBeTruthy();
  expect(screen.getAllByText("Not saved · this tab only")).toHaveLength(1);
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams).toHaveLength(3));
  // Saved entries are sent by identity as JSON; the fresh upload streams its file.
  expect(streams.map(s => s.evaluation.document?.id || "upload").sort()).toEqual(["evd_a", "evd_b", "upload"]);
  const tabs = screen.getByRole("tablist", { name: "Documents" });
  expect(within(tabs).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Batch summary", "Harbour invoice", "Northwind invoice", "fresh.pdf"]);
  await act(async () => {
    for (const stream of streams) { success(stream, 0, { evd_a: 3420, evd_b: 880 }[stream.evaluation.document?.id] ?? 1); success(stream, 1, 1); stream.controller.close(); }
  });
  // The fresh upload has no verified answers, so it is unscored rather than 0%.
  expect(await screen.findByText(/^Best: model — same documents and verified fields/)).toBeTruthy();
  expect(screen.getAllByText("2 of 3 docs").length).toBeGreaterThan(0);
  expect(screen.getAllByText("3/3 done · 1 unscored")).toHaveLength(2);
  fireEvent.click(within(tabs).getByRole("tab", { name: "Harbour invoice" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Inspect Total for Candidate 1" })).toBeTruthy());
  expect(screen.getByRole("button", { name: "Edit expected Total" })).toBeTruthy();
});
it("keeps the single-document Evaluation unchanged: no tabs or summary", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("one.pdf")] } });
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Start and run" }));
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.getByRole("button", { name: "Run all 2" }).disabled).toBe(true);
  await act(async () => { success(streams[0], 0, 5); success(streams[0], 1, 6); streams[0].controller.close(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Inspect Total for Candidate 2" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add expected Total" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Expected Total" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() => expect(screen.getByText("Best")).toBeTruthy());
  expect(screen.getByText("100%")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => url === "/v1/evaluations/run")).toHaveLength(1);
});
it("saves an upload explicitly, retries a lost response with the same operation, and the Clear guard lists unsaved work", async () => {
  const operations = [];
  overrides["POST /evaluations/documents"] = options => {
    const metadata = JSON.parse(options.body.get("metadata"));
    operations.push(metadata.operation_id);
    if (operations.length === 1) return Promise.reject(new TypeError("Failed to fetch"));
    library.evd_new = { document: summary("evd_new", metadata.name), reference: metadata.reference };
    return Response.json(library.evd_new, { status: 201 });
  };
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Evaluation document"), { target: { files: [upload("fresh.pdf"), upload("other.pdf")] } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save to library…" })[0]);
  const dialog = screen.getByRole("dialog", { name: "Save to Evaluation library" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Fenwick print" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(screen.getAllByText("Save failed · still in this tab")).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save to Evaluation library" })).toBeNull());
  expect(operations).toEqual([operations[0], operations[0]]);
  expect(screen.getByText("Fenwick print", { selector: "strong" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Clear Evaluation/ }));
  const guard = screen.getByRole("dialog", { name: "Clear Evaluation" });
  expect(within(guard).getByText("other.pdf")).toBeTruthy();
  expect(within(guard).queryByText("Fenwick print")).toBeNull();
  fireEvent.click(within(guard).getByRole("button", { name: "Clear Evaluation" }));
  await waitFor(() => expect(screen.queryByText("other.pdf", { selector: "strong" })).toBeNull());
});
it("reviews an update of shared answers and resolves a conflict with Replace with mine against the reviewed revision", async () => {
  const patches = [];
  overrides["PATCH /evaluations/documents/evd_a"] = options => {
    const body = JSON.parse(options.body); patches.push(body.expected_revision);
    if (body.expected_revision === 1) return Response.json({ error: { code: "revision_conflict", message: "Changed" }, current: { document: summary("evd_a", "Harbour invoice", 2), reference: reference("3402") } }, { status: 409 });
    return Response.json({ document: summary("evd_a", "Harbour invoice", 3), reference: body.reference });
  };
  render(<Harness />);
  await chooseFromLibrary(["Harbour invoice"]);
  await startModels();
  fireEvent.click(screen.getByRole("button", { name: "Expected answers" }));
  const answers = screen.getByRole("dialog", { name: "Expected answers" });
  fireEvent.click(within(answers).getByRole("button", { name: "Edit expected Total" }));
  fireEvent.change(within(answers).getByRole("textbox", { name: "Expected Total" }), { target: { value: "3500" } });
  fireEvent.click(within(answers).getByRole("button", { name: "Verify" }));
  fireEvent.click(await within(answers).findByRole("button", { name: "Update saved answers…" }));
  const review = screen.getByRole("dialog", { name: "Review saved answer update" });
  expect(within(review).getByText("3420 ✓")).toBeTruthy(); expect(within(review).getByText("3500 ✓")).toBeTruthy();
  fireEvent.click(within(review).getByRole("button", { name: "Update saved answers" }));
  expect(await within(review).findByText("The saved answers changed since you loaded them")).toBeTruthy();
  expect(within(review).getByText("3402 ✓")).toBeTruthy();
  expect(within(review).getByRole("button", { name: "Use saved version" })).toBeTruthy();
  fireEvent.click(within(review).getByRole("button", { name: "Replace with mine" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review saved answer update" })).toBeNull());
  expect(patches).toEqual([1, 2]);
  expect(screen.getByText("Saved", { selector: ".status-chip" })).toBeTruthy();
});
