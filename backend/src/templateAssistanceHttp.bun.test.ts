import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApplication } from "./localApplication";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { getModelPreparationSnapshot } from "./consumer/modelGateway";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const draft = { name: "Invoice", description: "", fields: [{ name: "Total", description: "Total due", data_type: "number" }] };
const base = { editorId: "editor_1", revision: 1, requestId: 1, scopeGeneration: 1, templateId: "draft" };
const output = { explanation: "The Total field requests the total due.", observations: [], groups: [] };
function fixture(options: { configured?: boolean; sequential?: boolean; timeout?: string; assistantModel?: string } = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "template-assistance-"));
  cleanups.push(() => rmSync(stateDirectory, { force: true, recursive: true }));
  if (options.configured !== false) configureTestWorkspace({ stateDirectory, workspaceId: "workspace_a", modelName: "workspace-model",
    ...(options.assistantModel ? { assistantModel: { model_name: options.assistantModel, supports_pdf_input: false, supports_structured_output: false } } : {}) });
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  const operations = createLocalWorkspaceProductOperations();
  const workspace = { id: "workspace_a", name: "A", max_source_file_bytes: 100 };
  const workspaceControl = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => [workspace.id, "workspace_b"].includes(workspaceId) && userId === "member" ? { ...workspace, id: workspaceId, role: "member" } : null,
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => apiKey === "inbound" ? workspace : null,
  } as unknown as LocalWorkspaceControl;
  const auth = { handler: async () => new Response(null), getSession: async (request: Request) => request.headers.get("cookie") ? { id: request.headers.get("cookie"), email: "test@example.com" } : null } as LocalAuth;
  const application = createLocalApplication({ stateDirectory, auth, workspaceControl, productStoreRegistry: registry, workspaceProductOperations: operations, modelGatewayRequestTimeoutMs: options.timeout });
  const store = registry.acquire({ workspaceId: workspace.id, mode: "create" })!;
  cleanups.push(store.release);
  if (options.sequential) {
    const configuration = store.store.getModelConfiguration()!;
    store.store.putModelConfiguration({ expectedRevision: configuration.revision, configuration: { ...configuration, sequential_calls: true }, updatedAt: new Date().toISOString() });
  }
  const headers = { cookie: "member", "x-workspace-id": workspace.id };
  const submit = (payload: Record<string, unknown> = {}, opts: { headers?: Record<string, string>; size?: number; mime?: string; signal?: AbortSignal } = {}) => {
    const body = new FormData();
    body.set("payload", JSON.stringify({ draft, base, action: "explain", instructions: "Explain this draft", ...payload }));
    if (opts.size !== undefined) body.set("document", new File([new Uint8Array(opts.size)], "sample.png", { type: opts.mime ?? "image/png" }));
    return application(new Request("http://localhost/v1/templates/assist", { method: "POST", body, signal: opts.signal, headers: { ...headers, ...opts.headers } }));
  };
  const get = (path: string, customHeaders = {}) => application(new Request(`http://localhost/v1/templates/assist/evidence${path}`, { headers: { ...headers, ...customHeaders } }));
  const files = () => { try { return readdirSync(join(stateDirectory, "temporary", "submissions")); } catch { return []; } };
  const mockGateway = (impl: typeof fetch = Object.assign(async () => Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] }), { preconnect: globalThis.fetch.preconnect })) => {
    const mock = spyOn(globalThis, "fetch").mockImplementation(impl);
    cleanups.push(() => mock.mockRestore());
    return mock;
  };
  const seedJob = (jobId = "job_a", answer: unknown = 12, retained = false, complete = true, targetStore = store.store) => {
    if (!targetStore.getTemplate("template_a")) targetStore.createTemplate({ templateId: "template_a", name: "Historical", description: "", fields: [{ id: "total", name: "Total", description: "Historical total guidance", data_type: "number" }], createdAt: "2026-01-01T00:00:00.000Z" });
    targetStore.createQueuedExtractionJob({ jobId, templateId: "template_a", templateVersion: 1, sourceFileKey: `workspaces/workspace_a/jobs/${jobId}/source.png`, sourceMimeType: "image/png", sourceName: `${jobId}.png`, sourceFilePageCount: null, sourceRetained: retained, submittedAt: "2026-01-01T00:00:00.000Z" });
    if (complete) {
      targetStore.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: "2026-01-01T00:01:00.000Z" });
      targetStore.completeExtractionJob({ jobId, attempt: 1, completedAt: "2026-01-01T00:02:00.000Z", modelName: "historical-model", route: "test", results: [{ field_id: "total", status: "ok", answer, normalized_value: String(answer), confidence: null, evidence: null }] });
    }
  };
  const suggest = (payload: Record<string, unknown> = {}, customHeaders: Record<string, string> = {}) => application(new Request("http://localhost/v1/templates/assist/suggestions", {
    method: "POST", body: JSON.stringify({ draft, action: "edit", ...payload }), headers: { ...headers, "content-type": "application/json", ...customHeaders } }));
  return { application, submit, suggest, get, registry, store: store.store, seedJob, files, mockGateway, stateDirectory, operations };
}
const responder = (value: unknown): typeof fetch => Object.assign(async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }), { preconnect: globalThis.fetch.preconnect });

test("text-only explanation accepts an invalid draft, echoes identity, reserves memory, and makes no product writes", async () => {
  const f = fixture();
  let memory = 0;
  const fetch = f.mockGateway(Object.assign(async () => { memory = getModelPreparationSnapshot().reservedBytes; return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] }); }, { preconnect: globalThis.fetch.preconnect }));
  const response = await f.submit({ draft: { ...draft, name: "", fields: [] } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.base).toEqual(base);
  expect(body.diagnostics.length).toBeGreaterThan(0);
  expect(body.groups).toEqual([]);
  expect(memory).toBeGreaterThan(0);
  expect(getModelPreparationSnapshot().reservedBytes).toBe(0);
  expect(f.store.listTemplates()).toEqual([]);
  expect(f.store.listExtractionJobs()).toEqual([]);
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).model).toBe("workspace-model");
});

test("authorization and configuration are checked before reading samples and errors are no-store", async () => {
  const f = fixture({ configured: false });
  const gateway = f.mockGateway();
  for (const [headers, status] of [[{}, 409], [{ cookie: "outsider" }, 403], [{ "x-workspace-id": "other" }, 403]] as const) {
    const response = await f.submit({}, { headers, size: 4 });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(gateway).not.toHaveBeenCalled();
  expect(f.files()).toEqual([]);
});

test.each([
  ["POST", "/v1/templates/assist"],
  ["POST", "/v1/templates/assist/suggestions"],
  ["GET", "/v1/templates/assist/evidence"],
  ["GET", "/v1/templates/assist/evidence/job_a"],
])("%s %s requires a Workspace member's browser session", async (method, path) => {
  const f = fixture();
  f.seedJob();
  const gateway = f.mockGateway();
  for (const authorization of ["Bearer inbound", "Bearer invalid", "Basic ignored", ""]) {
    for (const cookie of [undefined, "member"]) {
      const response = await f.application(new Request(`http://localhost${path}`, {
        method, headers: { authorization, "x-workspace-id": "workspace_a", ...(cookie ? { cookie } : {}) },
        // The session boundary must reject API-key calls before parsing or dispatching model work.
        ...(method === "POST" ? { body: "unparsed" } : {}),
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "session_required" } });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }
  for (const [headers, status] of [
    [{ "x-workspace-id": "workspace_a" }, 401],
    [{ cookie: "outsider", "x-workspace-id": "workspace_a" }, 403],
    [{ cookie: "member", "x-workspace-id": "foreign" }, 403],
    [{ cookie: "member" }, 403],
  ] as const) {
    const response = await f.application(new Request(`http://localhost${path}`, { method, headers }));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(gateway).not.toHaveBeenCalled();
  expect(f.files()).toEqual([]);
  expect(f.store.getExtractionJobSummary("job_a")?.status).toBe("completed");
});

test("unsupported evidence and assistance request properties are rejected for frontend sessions", async () => {
  const f = fixture();
  f.mockGateway();
  for (const payload of [{ result: {} }, { instructions: "x".repeat(4097) }, { useRetainedSource: true }, { draft: { name: "x".repeat(65537) } }, { draft: { ...draft, fields: Array(101).fill(null) } }, { base: { ...base, revision: -1 } }]) expect((await f.submit(payload)).status).toBe(400);
});

test("sample limits and strict malformed output leave no temporary files", async () => {
  const f = fixture();
  const gateway = f.mockGateway(responder({ ...output, unsupported: true }));
  for (const opts of [{ size: 101 }, { size: 0 }, { size: 4, mime: "text/plain" }, { size: 4, mime: "application/pdf" }]) {
    expect((await f.submit({}, opts)).status).toBe(400);
    expect(f.files()).toEqual([]);
  }
  expect(gateway).not.toHaveBeenCalled();
  expect((await f.submit({}, { size: 4 })).status).toBe(422);
  expect(gateway).toHaveBeenCalledTimes(3);
  expect(f.files()).toEqual([]);
});

test("paginated picker is completed-only and returns historical fields after Template deletion", async () => {
  const f = fixture();
  f.seedJob("job_a"); f.seedJob("job_b"); f.seedJob("job_pending", null, false, false);
  f.store.updateTemplate({ templateId: "template_a", fields: [{ id: "new", name: "New", description: "Current", data_type: "string" }], updatedAt: "2026-02-01T00:00:00.000Z" });
  f.store.deleteTemplate({ templateId: "template_a", deletedAt: "2026-03-01T00:00:00.000Z" });
  const page = await (await f.get("?limit=1")).json();
  expect(page.jobs.map((job: { job_id: string }) => job.job_id)).toEqual(["job_b"]);
  const second = await (await f.get(`?limit=1&cursor=${page.next_cursor}`)).json();
  expect(second.jobs.map((job: { job_id: string }) => job.job_id)).toEqual(["job_a"]);
  expect(second.next_cursor).toBeNull();
  const detail = await (await f.get("/job_a")).json();
  expect(detail.template_version).toBe(1);
  expect(detail.fields[0]).toMatchObject({ id: "total", description: "Historical total guidance" });
  expect(detail.results[0].answer).toBe(12);
  expect(detail.source_available).toBe(false);
  expect(detail.source_limitation).toContain("not retained");
  expect((await f.get("/job_a", { "x-workspace-id": "other" })).status).toBe(403);
});

test("result-only evidence is labeled and historical, missing selected jobs and oversized results fail", async () => {
  const f = fixture();
  f.seedJob();
  const gateway = f.mockGateway();
  const response = await f.submit({ jobId: "job_a" });
  expect(response.status).toBe(200);
  expect((await response.json()).evidence).toMatchObject({ source: "no_binary_source_supplied", job: { template_version: 1 } });
  expect(JSON.parse(gateway.mock.calls[0][1]!.body as string).messages[1].content[0].text).toContain("Historical total guidance");
  expect((await f.submit({ jobId: "missing" })).status).toBe(404);
  f.seedJob("job_huge", "x".repeat(128 * 1024));
  expect((await f.submit({ jobId: "job_huge" })).status).toBe(413);
  expect(gateway).toHaveBeenCalledTimes(1);
});

test("chosen retained sources are explicit and unavailable sources never silently reduce evidence", async () => {
  const f = fixture();
  f.seedJob("job_a", 12, true);
  const gateway = f.mockGateway();
  expect((await f.submit({ jobId: "job_a", useRetainedSource: true })).status).toBe(404);
  expect((await f.submit({ jobId: "job_a", useRetainedSource: true }, { size: 4 })).status).toBe(400);
  expect(gateway).not.toHaveBeenCalled();
  const files = createLocalSourceFileStore({ stateDirectory: f.stateDirectory });
  await files.write({ workspaceId: "workspace_a", jobId: "job_a", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) });
  expect((await f.get("/job_a")).status).toBe(200);
  const response = await f.submit({ jobId: "job_a", useRetainedSource: true });
  expect(response.status).toBe(200);
  expect((await response.json()).evidence.source).toBe("retained_source_of_selected_job");
  expect(await files.open!("workspaces/workspace_a/jobs/job_a/source.png")).not.toBeNull();
  expect(f.files()).toEqual([]);
});

test("false model evidence references are rejected with bounded retries", async () => {
  const f = fixture();
  const gateway = f.mockGateway(responder({ ...output, observations: [{ kind: "observation", text: "Seen", references: [{ scope: "sample" }] }] }));
  expect((await f.submit()).status).toBe(422);
  expect(gateway).toHaveBeenCalledTimes(3);
});

test("gateway transport response bounds cancel the stream without exposing content", async () => {
  const f = fixture();
  let cancelled = false;
  f.mockGateway(Object.assign(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(600 * 1024)); }, cancel() { cancelled = true; } })), { preconnect: globalThis.fetch.preconnect }));
  expect((await f.submit()).status).toBe(502);
  expect(cancelled).toBe(true);
});

test("cancellation and job deletion cancel pending work and cleanup the sample", async () => {
  const f = fixture();
  f.seedJob();
  let deletion: Promise<void> | undefined;
  f.mockGateway(Object.assign(async () => {
    deletion = f.operations.beginDocumentDeletion({ workspaceId: "workspace_a", jobId: "job_a" });
    return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
  }, { preconnect: globalThis.fetch.preconnect }));
  expect((await f.submit({ jobId: "job_a" }, { size: 4 })).status).toBe(499);
  await deletion;
  f.operations.completeDocumentDeletion({ workspaceId: "workspace_a", jobId: "job_a" });
  expect(f.files()).toEqual([]);
});

test("text-only requests obey Workspace sequential calls and cancelled waiters release admission", async () => {
  const f = fixture({ sequential: true });
  let resolveFirst!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { resolveFirst = resolve; });
  const gateway = f.mockGateway(Object.assign(async () => { entered(); await pending; return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] }); }, { preconnect: globalThis.fetch.preconnect }));
  const first = f.submit();
  await started;
  const controller = new AbortController();
  const second = f.submit({}, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(gateway).toHaveBeenCalledTimes(1);
  controller.abort();
  expect((await second).status).toBe(499);
  resolveFirst();
  expect((await first).status).toBe(200);
  expect(getModelPreparationSnapshot().reservedBytes).toBe(0);
});

test("uploaded samples work alone or alongside result evidence with distinct provenance and validated references", async () => {
  const f = fixture();
  f.seedJob();
  const gateway = f.mockGateway(responder({ ...output, observations: [{ kind: "hypothesis", text: "This supplied sample can help explain the current guidance.", references: [{ scope: "sample" }] }] }));
  const sampleOnly = await f.submit({}, { size: 4 });
  expect(sampleOnly.status).toBe(200);
  expect((await sampleOnly.json()).evidence).toMatchObject({ job: null, source: "separate_uploaded_sample", sample_name: "sample.png" });
  gateway.mockImplementation(responder({ ...output, observations: [{ kind: "hypothesis", text: "Compare the output and separate sample; they are not established to share a source.", references: [{ scope: "sample" }, { scope: "result", fieldId: "total" }] }] }));
  const combined = await f.submit({ jobId: "job_a" }, { size: 4 });
  expect(combined.status).toBe(200);
  expect((await combined.json()).evidence).toMatchObject({ job: { job_id: "job_a" }, source: "separate_uploaded_sample", sample_name: "sample.png" });
  for (const call of gateway.mock.calls) {
    const modelRequest = JSON.parse(call[1]!.body as string);
    expect(modelRequest.messages[1].content[1].type).toBe("image_url");
    expect(modelRequest.messages[1].content[1].image_url.url).toContain("data:image/png;base64,");
  }
  expect(f.files()).toEqual([]);
});

test("a job in another authorized Workspace cannot be used or enumerated by guessed ID", async () => {
  const f = fixture();
  const other = f.registry.acquire({ workspaceId: "workspace_b", mode: "create" })!;
  try { f.seedJob("private_b", 99, false, true, other.store); } finally { other.release(); }
  const gateway = f.mockGateway();
  expect((await f.get("/private_b", { "x-workspace-id": "workspace_b" })).status).toBe(200);
  expect((await f.get("/private_b")).status).toBe(404);
  expect((await (await f.get("")).json()).jobs).toEqual([]);
  expect((await f.submit({ jobId: "private_b" })).status).toBe(404);
  expect(gateway).not.toHaveBeenCalled();
});

test("the configured whole-request deadline aborts model IO and releases sample and admission", async () => {
  const f = fixture({ timeout: "50" });
  let aborted = false;
  f.mockGateway(Object.assign(async (_url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    return new Promise<Response>((_resolve, reject) => {
      const cancel = () => { aborted = true; reject(new DOMException("Cancelled", "AbortError")); };
      if (options?.signal?.aborted) cancel();
      else options?.signal?.addEventListener("abort", cancel, { once: true });
    });
  }, { preconnect: globalThis.fetch.preconnect }));
  const response = await f.submit({}, { size: 4 });
  expect(response.status).toBe(499);
  expect(aborted).toBe(true);
  expect(f.files()).toEqual([]);
  expect(getModelPreparationSnapshot().reservedBytes).toBe(0);
});

const suggestionOutput = { suggestions: [{ label: "Say which currency Total uses", request: "Clarify the currency in the Total instructions", reason: "“Total” has no currency guidance" }] };

test("suggestions use one text-only call with the draft, its diagnostics and job evidence, and never write", async () => {
  const f = fixture();
  f.seedJob("job_a", 12, true);
  const gateway = f.mockGateway(responder(suggestionOutput));
  const response = await f.suggest({ action: "explain", jobId: "job_a", sampleName: "march.pdf", draft: { ...draft, name: "" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ source: "model", suggestions: [{ id: "model-0", ...suggestionOutput.suggestions[0] }] });
  expect(gateway).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(gateway.mock.calls[0][1]!.body as string);
  expect(sent.model).toBe("workspace-model");
  const context = JSON.parse(sent.messages[1].content);
  expect(context.action).toBe("explain");
  expect(context.untrustedContext.deterministicDiagnostics.length).toBeGreaterThan(0);
  expect(context.untrustedContext.evidence.job.job_id).toBe("job_a");
  expect(context.untrustedContext.evidence.attachedSampleName).toBe("march.pdf");
  expect(JSON.stringify(sent.messages)).not.toContain("image_url");
  expect(getModelPreparationSnapshot().reservedBytes).toBe(0);
  expect(f.store.listTemplates()).toHaveLength(1);
  expect(f.store.listExtractionJobs()).toHaveLength(1);
});

test("suggestions reject malformed requests and unsupported output, and report a missing model configuration", async () => {
  const f = fixture();
  const gateway = f.mockGateway(responder({ suggestions: [{ ...suggestionOutput.suggestions[0], extra: true }] }));
  for (const payload of [{ instructions: "x" }, { action: "save" }, { draft: null }, { jobId: "../x" }, { sampleName: "x".repeat(256) }]) expect((await f.suggest(payload)).status).toBe(400);
  expect(gateway).not.toHaveBeenCalled();
  const invalidOutput = await f.suggest();
  expect(invalidOutput.status).toBe(422);
  expect((await invalidOutput.json()).error.code).toBe("template_suggestions_invalid");
  expect(gateway).toHaveBeenCalledTimes(2);
  const unconfigured = fixture({ configured: false });
  const response = await unconfigured.suggest();
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).error.code).toBe("workspace_model_not_configured");
  expect((await unconfigured.suggest({}, { cookie: "outsider" })).status).toBe(403);
});

test("assistance and suggestions call the Workspace's Template assistant model with its capabilities", async () => {
  const f = fixture({ assistantModel: "assistant-model" });
  const gateway = f.mockGateway(responder(output));
  expect((await f.submit()).status).toBe(200);
  const assisted = JSON.parse(gateway.mock.calls[0][1]!.body as string);
  expect(assisted.model).toBe("assistant-model");
  expect(assisted).not.toHaveProperty("response_format");
  gateway.mockImplementation(responder(suggestionOutput));
  expect((await f.suggest()).status).toBe(200);
  expect(JSON.parse(gateway.mock.calls[1][1]!.body as string).model).toBe("assistant-model");
});
