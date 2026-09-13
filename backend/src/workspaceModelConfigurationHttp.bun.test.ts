import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { testWorkspaceModelConnection } from "./workspaceModelConfigurationHttp";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const draft = { gateway_url: "http://localhost:1234/v1", model_name: "example/model", credential: "dummy-outbound-secret", sequential_calls: false, supports_pdf_input: false, supports_structured_output: false };

function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), "workspace-model-http-"));
  cleanups.push(() => rmSync(stateDirectory, { recursive: true, force: true }));
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  const auth: LocalAuth = {
    handler: async () => new Response(null),
    getSession: async (request) => {
      const id = request.headers.get("cookie");
      return id ? { id, email: `${id}@example.com`, name: id } : null;
    },
  };
  const workspace = { id: "workspace_a", name: "A", created_at: "now", has_api_key: true, max_source_file_bytes: null };
  const workspaceControl = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => workspaceId === workspace.id && ["owner", "admin", "member"].includes(userId) ? { ...workspace, role: userId } : null,
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => apiKey === "inbound-key" ? workspace : null,
    hasPendingStarterTemplateBootstrap: () => false,
  } as unknown as LocalWorkspaceControl;
  const liveUpdateHub = createLocalLiveUpdateHub();
  const events: string[] = [];
  liveUpdateHub.subscribe({ workspaceId: workspace.id, socket: { send: (message) => { events.push(message); return 1; } } });
  const application = createLocalApplication({ auth, stateDirectory, workspaceControl, productStoreRegistry: registry, liveUpdateHub });
  const request = (method = "GET", body?: unknown, headers: Record<string, string> = {}, suffix = "") => application(new Request(`http://localhost/v1/workspaces/workspace_a/model-configuration${suffix}`, { method, headers: { cookie: "owner", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { stateDirectory, application, request, registry, events };
}

test("session-only, role-redacted configuration CRUD uses conditional, write-only, no-store responses", async () => {
  const { stateDirectory, application, request, events } = fixture();
  for (const role of ["owner", "admin", "member"]) {
    const blank = await request("GET", undefined, { cookie: role });
    expect(blank.status).toBe(200);
    expect(await blank.json()).toEqual({ configured: false });
    expect(blank.headers.get("etag")).toBeNull();
    expect(blank.headers.get("cache-control")).toBe("no-store");
  }
  expect(readdirSync(stateDirectory)).toEqual([]);
  expect((await application(new Request("http://localhost/v1/workspaces/workspace_a/model-configuration", { headers: { authorization: "Bearer inbound-key" } }))).status).toBe(401);
  expect((await request("GET", undefined, { cookie: "outsider" })).status).toBe(403);
  for (const method of ["PUT", "DELETE"]) expect((await request(method, method === "PUT" ? draft : undefined, { cookie: "member" })).status).toBe(403);
  expect((await request("PUT", draft)).status).toBe(428);
  expect((await request("PUT", draft, { "if-match": '"stale"' })).status).toBe(412);
  const created = await request("PUT", draft, { "if-none-match": "*" });
  expect(created.status).toBe(201);
  const firstTag = created.headers.get("etag")!;
  const representation = await created.json();
  expect(representation).toMatchObject({ configured: true, gateway_url: draft.gateway_url, credential_status: "configured", revision: 1 });
  expect(JSON.stringify(representation)).not.toContain(draft.credential);
  expect(representation).not.toHaveProperty("credential_ciphertext");
  expect((await request("PUT", draft, { "if-none-match": "*" })).status).toBe(412);
  const member = await request("GET", undefined, { cookie: "member" });
  expect(await member.json()).toEqual({ configured: true });
  expect(member.headers.get("etag")).toBeNull();
  const { credential: _credential, ...preserve } = draft;
  const updated = await request("PUT", { ...preserve, model_name: "changed/model" }, { "if-match": firstTag, cookie: "admin" });
  expect(updated.status).toBe(200);
  const nextTag = updated.headers.get("etag")!;
  expect(nextTag).not.toBe(firstTag);
  expect((await request("GET", undefined, { "if-none-match": nextTag })).status).toBe(200);
  expect((await request("DELETE", undefined, { "if-match": firstTag })).status).toBe(412);
  expect((await request("DELETE")).status).toBe(428);
  expect((await request("DELETE", undefined, { "if-match": nextTag })).status).toBe(204);
  expect((await request("DELETE", undefined, { "if-match": nextTag })).status).toBe(412);
  const recreated = await request("PUT", draft, { "if-none-match": "*" });
  expect(recreated.headers.get("etag")).not.toBe(firstTag);
  expect((await request("PUT", draft, { "if-match": firstTag })).status).toBe(412);
  expect(events).toHaveLength(4);
  for (const event of events) {
    expect(JSON.parse(event).events[0].reason).toBe("model_configuration_changed");
    expect(event).not.toContain("gateway_url");
    expect(event).not.toContain(draft.credential);
  }
  for (const method of ["GET", "PATCH"]) expect((await application(new Request("http://localhost/v1/settings/model", { method }))).status).toBe(404);
});

test("reloading over HTTP supplies a usable version for changing the model", async () => {
  const { application, request } = fixture();
  expect((await request("PUT", draft, { "if-none-match": "*" })).status).toBe(201);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: application });
  cleanups.push(() => { void server.stop(true); });
  const url = new URL("/v1/workspaces/workspace_a/model-configuration", server.url);
  for (const model_name of ["changed/model", "reloaded/model"]) {
    const loaded = await fetch(url, { headers: { cookie: "owner" }, cache: "no-store" });
    expect(loaded.status).toBe(200);
    const record = await loaded.json();
    const etag = `"workspace-model-${record.revision}"`;
    expect(loaded.headers.get("etag")).toBe(etag);
    const { credential: _credential, ...fields } = draft;
    const saved = await fetch(url, {
      method: "PUT", cache: "no-store",
      headers: { cookie: "owner", "content-type": "application/json", "if-match": etag },
      body: JSON.stringify({ ...fields, model_name }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ model_name });
  }
});

test("blank and unreadable configurations fail admission before parsing or creating a Source/job, and remain repairable", async () => {
  const { stateDirectory, application, request, registry } = fixture();
  const submit = () => application(new Request("http://localhost/v1/extract", { method: "POST", headers: { authorization: "Bearer inbound-key", "content-type": "not-multipart" }, body: "unparsed" }));
  const missing = await submit();
  expect(missing.status).toBe(409);
  expect(await missing.json()).toMatchObject({ error: { code: "workspace_model_not_configured" } });
  const created = await request("PUT", draft, { "if-none-match": "*" });
  const etag = created.headers.get("etag")!;
  rmSync(join(stateDirectory, "secrets", "model-gateway.key"));
  const failed = await submit();
  expect(failed.status).toBe(503);
  expect(failed.headers.get("retry-after")).toBeNull();
  expect(await failed.json()).toMatchObject({ error: { code: "workspace_model_configuration_unavailable" } });
  expect(await (await request("GET")).json()).toMatchObject({ configured: true, credential_status: "unavailable" });
  expect(await (await request("GET", undefined, { cookie: "member" })).json()).toEqual({ configured: true });
  const lease = registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;
  expect(lease.store.countExtractionJobs()).toBe(0);
  lease.release();
  expect(readdirSync(stateDirectory)).not.toContain("source-files");
  const { credential: _credential, ...preserve } = draft;
  expect((await request("PUT", preserve, { "if-match": etag })).status).toBe(503);
  const repaired = await request("PUT", { ...draft, credential: "new-key" }, { "if-match": etag });
  expect(repaired.status).toBe(200);
  rmSync(join(stateDirectory, "secrets", "model-gateway.key"));
  expect((await request("DELETE", undefined, { "if-match": repaired.headers.get("etag")! })).status).toBe(204);
});

test("connection testing sends one minimal POST, never persists, and can conditionally reuse a saved credential", async () => {
  const { request, stateDirectory } = fixture();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ choices: [{ message: { content: "anything readable" } }] }); }) as typeof fetch);
  cleanups.push(() => spy.mockRestore());
  expect((await request("POST", draft, {}, "/test")).status).toBe(200);
  expect(readdirSync(stateDirectory)).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("http://localhost:1234/v1/chat/completions");
  expect(calls[0]!.init).toMatchObject({ method: "POST", redirect: "manual", headers: { authorization: `Bearer ${draft.credential}`, "content-type": "application/json" } });
  expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ model: draft.model_name, messages: [{ role: "user", content: "Reply with OK." }] });
  const created = await request("PUT", draft, { "if-none-match": "*" });
  expect(calls).toHaveLength(1);
  const { credential: _credential, ...reuse } = draft;
  expect((await request("POST", reuse, {}, "/test")).status).toBe(428);
  expect((await request("POST", reuse, { "if-match": '"stale"' }, "/test")).status).toBe(412);
  expect((await request("POST", reuse, { "if-match": created.headers.get("etag")! }, "/test")).status).toBe(200);
  expect(calls).toHaveLength(2);
  expect((await request("POST", draft, { cookie: "member" }, "/test")).status).toBe(403);
});

test("connection test classifies gateway failures without exposing upstream messages or retrying", async () => {
  let response = new Response("upstream-secret", { status: 400 });
  const spy = spyOn(globalThis, "fetch").mockImplementation((async () => response) as unknown as typeof fetch);
  cleanups.push(() => spy.mockRestore());
  for (const [upstream, expected] of [[301, 422], [400, 422], [401, 422], [408, 503], [429, 503], [500, 503]]) {
    response = new Response("upstream-secret", { status: upstream });
    const result = await testWorkspaceModelConnection(draft, draft.credential);
    expect(result.status).toBe(expected!);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).not.toContain("upstream-secret");
  }
  for (const content of ["invalid-json", "{}", '{"choices":[{"message":{"content":" "}}]}']) {
    response = new Response(content);
    expect((await testWorkspaceModelConnection(draft, draft.credential)).status).toBe(502);
  }
  spy.mockImplementation((async () => { throw new Error("network-secret"); }) as unknown as typeof fetch);
  expect((await testWorkspaceModelConnection(draft, draft.credential)).status).toBe(503);
  expect(spy).toHaveBeenCalledTimes(10);
});
