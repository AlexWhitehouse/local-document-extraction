import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalEvaluations } from "./localEvaluations";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { RetryableError } from "./consumer/modelGateway";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const fields = [{ id: "total", name: "Total", description: "Invoice total", data_type: "number" as const }];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate: () => boolean) { for (let i = 0; i < 500; i++) { if (predicate()) return; await Bun.sleep(2); } throw new Error("Timed out"); }
function fixture(options: Partial<Parameters<typeof createLocalEvaluations>[0]> = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "evaluation-test-"));
  const productStoreRegistry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  const lease = productStoreRegistry.acquire({ workspaceId: "workspace", mode: "create" })!;
  const configuration = { model_name: "model", gateway_url: "http://localhost:1234", sequential_calls: false, supports_pdf_input: false, supports_structured_output: false, credential_ciphertext: createWorkspaceCredentialVault(stateDirectory).encrypt("workspace", "private-credential") };
  lease.store.putModelConfiguration({ configuration, expectedRevision: null, updatedAt: new Date().toISOString() });
  let active = true;
  const queue = options.queue || createLocalExtractionQueue({ maxConcurrent: 2 });
  const service = createLocalEvaluations({ stateDirectory, productStoreRegistry, queue, maxSourceFileBytes: 10000,
    auth: { getSession: async () => ({ id: "user", email: "user@example.test", name: "User", isActive: () => active }), handler: async () => new Response() },
    workspaceControl: { getAcceptedWorkspaceContext: ({ workspaceId }) => workspaceId === "workspace" ? { id: "workspace" } : null } as LocalWorkspaceControl,
    extract: async () => [{ field_id: "total", status: "ok", answer: 12 }], retryDelayMs: 0, ...options });
  cleanups.push(async () => { service.close(); await queue.close(); lease.release(); await productStoreRegistry.closeAll(); rmSync(stateDirectory, { force: true, recursive: true }); });
  const submit = (overrides: Record<string, unknown> = {}, extraHeaders = {}, signal?: AbortSignal) => {
    const body = { id: crypto.randomUUID(), evaluationId: "evaluation", revision: 1, mode: "models", candidates: [0, 1].map(index => ({ id: "candidate" + index, revision: 0, model: "model", pdf: false, structured: false, fields })), ...overrides };
    const form = new FormData(); form.append("document", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "sample.png"); form.append("evaluation", JSON.stringify(body));
    return service.handle(new Request("http://localhost/v1/evaluations/run", { method: "POST", body: form, headers: { "x-workspace-id": "workspace", "x-evaluation-submission": body.id as string, ...extraHeaders }, signal }));
  };
  return { service, submit, lease, queue, configuration, stateDirectory, revoke: () => { active = false; }, files: () => readdirSync(join(stateDirectory, "temporary", "evaluations")) };
}
const events = async (response: Response) => (await response.text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));

test("eight candidates share one Source and scheduler with Documents without persisted jobs", async () => {
  let calls = 0, peak = 0, active = 0;
  const gate = deferred();
  const f = fixture({ extract: async (_env, _fields, source) => {
    calls++; active++; peak = Math.max(peak, active); expect(source instanceof Blob).toBe(true);
    await gate.promise; active--; return [{ field_id: "total", status: "ok", answer: 12 }];
  } });
  let documents = 0;
  f.queue.subscribe(async () => { documents++; });
  const response = await f.submit({ candidates: Array.from({ length: 8 }, (_, index) => ({ id: "c" + index, revision: 0, model: "model", pdf: false, structured: false, fields })) });
  const result = events(response);
  await until(() => calls === 2);
  expect(f.files()).toHaveLength(1);
  await f.queue.schedule({ job_id: "document", workspace_id: "other", template_id: "template", template_version: 1, enqueued_at: new Date().toISOString() });
  gate.resolve();
  const updates = await result;
  await f.queue.waitForIdle();
  expect(updates.filter(e => e.type === "success")).toHaveLength(8);
  expect(updates.at(-2)).toMatchObject({ type: "cleanup", status: "complete" });
  expect(calls).toBe(8); expect(peak).toBe(2); expect(documents).toBe(1); expect(f.files()).toEqual([]);
  expect(f.lease.store.listExtractionJobs({ limit: 10 })).toEqual([]);
});

test("session-only setup hides secrets and rejects keys, foreign origins and Workspaces", async () => {
  const f = fixture();
  const setup = await f.service.handle(new Request("http://localhost/v1/evaluations/setup", { headers: { "x-workspace-id": "workspace" } }));
  expect(await setup.json()).toEqual({ configured: true, model: "model", revision: 1, pdf: false, structured: false, sequential: false });
  for (const headers of [{ authorization: "Bearer key", cookie: "session=present" }, { origin: "http://evil.test" }, { "x-workspace-id": "foreign" }]) expect((await f.submit({}, headers)).status).toBe(403);
});

test("queue overflow rejects individual candidates and retry readmission settles without durable deferrals", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1, maxBuffered: 1 }); queue.setMaxConcurrent(0);
  const f = fixture({ queue });
  const response = await f.submit(); const result = events(response);
  expect(queue.snapshot()).toMatchObject({ pending: 1, durableDeferrals: 0 });
  queue.setMaxConcurrent(1);
  const updates = await result;
  expect(updates.some(e => e.admission === "full")).toBe(true);
  expect(updates.filter(e => e.type === "success")).toHaveLength(1);
  expect(f.files()).toEqual([]);
});

test("configuration snapshots survive retry; changed revision blocks future submissions", async () => {
  const gate = deferred(); const seen: string[] = [];
  const f = fixture({ extract: async env => { seen.push(env.AI_MODEL!); if (seen.length === 1) { await gate.promise; throw new RetryableError("transient"); } return [{ field_id: "total", status: "ok", answer: 12 }]; } });
  const response = await f.submit({ candidates: [{ id: "c", revision: 0, model: "captured-model", pdf: false, structured: false, fields }] });
  const result = events(response); await until(() => seen.length === 1);
  f.lease.store.putModelConfiguration({ configuration: { ...f.configuration, model_name: "replacement" }, expectedRevision: 1, updatedAt: new Date().toISOString() });
  gate.resolve(); const updates = await result;
  expect(seen).toEqual(["captured-model", "captured-model"]);
  expect(updates.find(e => e.type === "success").attempt).toBe(2);
  expect((await f.submit()).status).toBe(409); expect(f.files()).toEqual([]);
});

test("revoked queued work never reaches the gateway or sends results", async () => {
  let calls = 0;
  const queue = createLocalExtractionQueue(); queue.setMaxConcurrent(0);
  const f = fixture({ queue, extract: async () => { calls++; return []; } });
  const response = await f.submit(); const result = events(response);
  f.revoke(); queue.setMaxConcurrent(2);
  const updates = await result;
  expect(calls).toBe(0); expect(updates.some(e => e.type === "success")).toBe(false); expect(f.files()).toEqual([]);
});

test("failed deletion preserves success and recovery removes only orphan uploads", async () => {
  let allowRemoval = false;
  const f = fixture({ remove: async path => { if (!allowRemoval) throw new Error("busy"); await rm(path, { force: true }); } });
  const updates = await events(await f.submit());
  expect(updates.filter(e => e.type === "success")).toHaveLength(2);
  expect(updates.find(e => e.type === "cleanup").status).toBe("pending");
  expect(f.files()).toHaveLength(1);
  writeFileSync(join(f.stateDirectory, "temporary", "evaluations", "keep.txt"), "other");
  allowRemoval = true; await f.service.sweep(); expect(f.files()).toEqual(["keep.txt"]);
});

test("duplicate submission is rejected before a second upload and does not release the original reservation", async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ extract: async () => { calls++; await gate.promise; return []; } });
  const first = await f.submit({ id: "same" }); const result = events(first);
  expect((await f.submit({ id: "same" })).status).toBe(409);
  expect((await f.submit({ id: "same" })).status).toBe(409);
  expect(f.files()).toHaveLength(1);
  gate.resolve(); await result; expect(calls).toBe(2);
});

test("real Bun streamed fetch disconnect discards queued candidates and cleans after active work", async () => {
  const gate = deferred(); let calls = 0;
  const queue = createLocalExtractionQueue({ maxConcurrent: 1 });
  const f = fixture({ queue, extract: async () => { calls++; await gate.promise; return []; } });
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: request => f.service.handle(request) });
  try {
    const controller = new AbortController();
    const form = new FormData(); form.append("document", new Blob(["image"], { type: "image/png" }), "sample.png");
    form.append("evaluation", JSON.stringify({ id: "stream", evaluationId: "evaluation", revision: 1, mode: "models", candidates: [0, 1].map(i => ({ id: "c" + i, revision: 0, model: "model", pdf: false, structured: false, fields })) }));
    const response = await fetch(new URL("/v1/evaluations/run", server.url), { method: "POST", body: form, signal: controller.signal, headers: { "x-workspace-id": "workspace", "x-evaluation-submission": "stream" } });
    await response.body!.getReader().read(); await until(() => calls === 1);
    controller.abort(); await until(() => queue.snapshot().pending === 0);
    gate.resolve(); await queue.waitForIdle(); await until(() => f.files().length === 0);
    expect(calls).toBe(1);
  } finally { gate.resolve(); await server.stop(true); }
});

test("retry readmission failure is terminal and does not leak the shared Source", async () => {
  const queue = createLocalExtractionQueue({ maxConcurrent: 1, maxBuffered: 1 });
  const gate = deferred(); let calls = 0;
  const f = fixture({ queue, extract: async () => { calls++; await gate.promise; throw new RetryableError("temporary"); } });
  const response = await f.submit({ candidates: [{ id: "first", revision: 0, model: "model", pdf: false, structured: false, fields }] });
  const result = events(response); await until(() => calls === 1);
  queue.subscribe(() => {});
  await queue.schedule({ job_id: "waiting", workspace_id: "workspace", template_id: "t", template_version: 1, enqueued_at: new Date().toISOString() });
  gate.resolve(); const updates = await result;
  expect(updates.some(e => e.admission === "full" && e.attempt === 2)).toBe(true);
  expect(calls).toBe(1); expect(f.files()).toEqual([]); expect(queue.snapshot().durableDeferrals).toBe(0);
});

test("historical reads preserve field versions and expose current descriptive metadata", async () => {
  const f = fixture();
  f.lease.store.createTemplate({ templateId: "invoice", name: "Old name", description: "Old description", fields, createdAt: new Date().toISOString() });
  f.lease.store.updateTemplate({ templateId: "invoice", name: "Current name", description: "Current description", fields: [{ ...fields[0], description: "New extraction guidance" }], updatedAt: new Date().toISOString() });
  const response = await f.service.handle(new Request("http://localhost/v1/evaluations/templates/invoice?version=1", { headers: { "x-workspace-id": "workspace" } }));
  expect(await response.json()).toMatchObject({ name: "Current name", description: "Current description", current_version: 2, fields: [{ description: "Invoice total" }] });
  const missing = await f.service.handle(new Request("http://localhost/v1/evaluations/templates/invoice?version=9", { headers: { "x-workspace-id": "workspace" } }));
  expect(missing.status).toBe(404);
});

test("candidate inputs cannot change the controlled comparison or send arbitrary gateway destinations", async () => {
  let calls = 0;
  const f = fixture({ extract: async env => { calls++; expect(env.MODEL_GATEWAY_URL).toBe("http://localhost:1234"); expect(env.LITELLM_KEY).toBe("private-credential"); return []; } });
  const a = { id: "a", revision: 0, model: "model", pdf: false, structured: false, fields };
  expect((await f.submit({ mode: "templates", candidates: [a, { ...a, id: "b", model: "different" }] })).status).toBe(400);
  expect((await f.submit({ mode: "models", candidates: [a, { ...a, id: "b", fields: [{ ...fields[0], name: "Other" }] }] })).status).toBe(400);
  const updates = await events(await f.submit({ gateway_url: "http://evil.test", credential: "client-secret", candidates: [a] }));
  expect(updates.some(e => e.type === "success")).toBe(true); expect(calls).toBe(1); expect(f.files()).toEqual([]);
});
