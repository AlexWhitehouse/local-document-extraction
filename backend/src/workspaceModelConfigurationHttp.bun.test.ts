import { fetchFixture } from "./testing/fetchFixture";
import { fixtureRequestInit, textRequestBody } from "./testing/requestFixture";
import type { JsonValue } from "../../shared/json";
import { workspaceControlFixture, workspaceFixture, isWorkspaceRole } from "./testing/workspaceControlFixture";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalAuth } from "./localAuth";

import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { testWorkspaceModelConnection } from "./workspaceModelConfigurationHttp";
import { createLocalWorkspaceConcurrencyLimits } from "./localWorkspaceConcurrency";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const draft = {
  gateway_url: "http://localhost:1234/v1",
  model_name: "example/model",
  credential: "dummy-outbound-secret",
  sequential_calls: false,
  supports_pdf_input: false,
  supports_structured_output: false,
};

function fixture(options: { onWorkspaceModelConfigurationChanged?: (workspaceId: string) => void } = {}) {
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

  const workspace = workspaceFixture({
    id: "workspace_a",
    name: "A",
    created_at: "now",
    has_api_key: true,
    max_source_file_bytes: null,
  });

  const workspaceControl = workspaceControlFixture({
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
      workspaceId === workspace.id && isWorkspaceRole(userId) ? { ...workspace, role: userId } : null,
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => (apiKey === "inbound-key" ? workspace : null),
    hasPendingStarterTemplateBootstrap: () => false,
  });

  const liveUpdateHub = createLocalLiveUpdateHub();
  const events: string[] = [];
  liveUpdateHub.subscribe({
    workspaceId: workspace.id,
    socket: {
      send: (message) => {
        events.push(message);

        return 1;
      },
    },
  });

  const application = createLocalApplication({
    auth,
    stateDirectory,
    workspaceControl,
    productStoreRegistry: registry,
    liveUpdateHub,
    ...options,
  });

  const request =(method = "GET", body?: JsonValue, headers: Record<string, string> = {}, suffix = "") =>
    application(
      new Request(
        `http://localhost/v1/workspaces/workspace_a/model-configuration${suffix}`,
        fixtureRequestInit(method, body, { cookie: "owner", "content-type": "application/json", ...headers }),
      ),
    );

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
  expect(
    (
      await application(
        new Request("http://localhost/v1/workspaces/workspace_a/model-configuration", {
          headers: { authorization: "Bearer inbound-key" },
        }),
      )
    ).status,
  ).toBe(401);
  expect((await request("GET", undefined, { cookie: "outsider" })).status).toBe(403);

  for (const method of ["PUT", "DELETE"])
    expect((await request(method, method === "PUT" ? draft : undefined, { cookie: "member" })).status).toBe(403);
  expect((await request("PUT", draft)).status).toBe(428);
  expect((await request("PUT", draft, { "if-match": '"stale"' })).status).toBe(412);
  const created = await request("PUT", draft, { "if-none-match": "*" });
  expect(created.status).toBe(201);
  const firstTag = created.headers.get("etag")!;
  const representation = await created.json();
  expect(representation).toMatchObject({
    configured: true,
    gateway_url: draft.gateway_url,
    credential_status: "configured",
    revision: 1,
  });
  expect(JSON.stringify(representation)).not.toContain(draft.credential);
  expect(representation).not.toHaveProperty("credential_ciphertext");
  expect((await request("PUT", draft, { "if-none-match": "*" })).status).toBe(412);
  const member = await request("GET", undefined, { cookie: "member" });
  expect(await member.json()).toEqual({ configured: true });
  expect(member.headers.get("etag")).toBeNull();
  const { credential: _credential, ...preserve } = draft;

  const updated = await request(
    "PUT",
    { ...preserve, model_name: "changed/model" },
    { "if-match": firstTag, cookie: "admin" },
  );

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

  for (const method of ["GET", "PATCH"])
    expect((await application(new Request("http://localhost/v1/settings/model", { method }))).status).toBe(404);
});

test("cached Workspace concurrency follows committed saves and clears without rereading per pass", async () => {
  let reads = 0;
  // Invoked only after `limits` is initialized below, once a change commits.
  const harness = fixture({ onWorkspaceModelConfigurationChanged: (workspaceId) => limits.invalidate(workspaceId) });

  const limits = createLocalWorkspaceConcurrencyLimits({
    read: (workspaceId) => {
      reads += 1;
      const lease = harness.registry.acquire({ workspaceId, mode: "existing" });

      if (!lease) return null;

      try {
        return lease.store.getModelConfiguration()?.sequential_calls ? 1 : Number.MAX_SAFE_INTEGER;
      } finally {
        lease.release();
      }
    },
  });

  // Missing product data is not cached.
  expect(limits.get("workspace_a")).toBe(1);
  expect(limits.get("workspace_a")).toBe(1);
  expect(reads).toBe(2);

  const created = await harness.request("PUT", { ...draft, sequential_calls: true }, { "if-none-match": "*" });
  expect(created.status).toBe(201);
  expect(limits.get("workspace_a")).toBe(1);
  expect(limits.get("workspace_a")).toBe(1);
  expect(reads).toBe(3);

  const { credential: _credential, ...preserve } = draft;

  const updated = await harness.request(
    "PUT",
    { ...preserve, sequential_calls: false },
    { "if-match": created.headers.get("etag")! },
  );

  expect(updated.status).toBe(200);
  expect(limits.get("workspace_a")).toBe(Number.MAX_SAFE_INTEGER);
  expect(reads).toBe(4);
  // A rejected change commits nothing and keeps the cached value.
  expect((await harness.request("DELETE", undefined, { "if-match": '"stale"' })).status).toBe(412);
  expect(limits.get("workspace_a")).toBe(Number.MAX_SAFE_INTEGER);
  expect(reads).toBe(4);
  expect((await harness.request("DELETE", undefined, { "if-match": updated.headers.get("etag")! })).status).toBe(204);
  expect(limits.get("workspace_a")).toBe(Number.MAX_SAFE_INTEGER);
  expect(reads).toBe(5);
});

test("reloading over HTTP supplies a usable version for changing the model", async () => {
  const { application, request } = fixture();
  expect((await request("PUT", draft, { "if-none-match": "*" })).status).toBe(201);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: application });
  cleanups.push(() => {
    void server.stop(true);
  });
  const url = new URL("/v1/workspaces/workspace_a/model-configuration", server.url);

  for (const model_name of ["changed/model", "reloaded/model"]) {
    const loaded = await fetch(url, { headers: { cookie: "owner" }, cache: "no-store" });
    expect(loaded.status).toBe(200);
    const record = await loaded.json();
    const etag = `"workspace-model-${record.revision}"`;
    expect(loaded.headers.get("etag")).toBe(etag);
    const { credential: _credential, ...fields } = draft;

    const saved = await fetch(url, {
      method: "PUT",
      cache: "no-store",
      headers: { cookie: "owner", "content-type": "application/json", "if-match": etag },
      body: JSON.stringify({ ...fields, model_name }),
    });

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ model_name });
  }
});

test("changing only the extraction model from a loaded record keeps the stored API key and task models", async () => {
  const { request, registry, events } = fixture();
  const assistant_model = { model_name: "assistant/model", supports_pdf_input: true, supports_structured_output: false };
  const created = await request("PUT", { ...draft, assistant_model }, { "if-none-match": "*" });
  expect(created.status).toBe(201);

  const stored = () => {
    const lease = registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;

    try {
      return lease.store.getModelConfiguration()!;
    } finally {
      lease.release();
    }
  };

  const before = stored();
  const loaded = await request("GET");
  const etag = loaded.headers.get("etag")!;
  const record = await loaded.json();

  // The client rebuilds the body from the loaded record: no API key, and the task models as loaded.
  const body = {
    gateway_url: record.gateway_url,
    sequential_calls: record.sequential_calls,
    assistant_model: record.assistant_model,
    classification_model: record.classification_model,
    model_name: "best/model",
    supports_pdf_input: true,
    supports_structured_output: true,
  };

  for (const role of ["member", "outsider"])
    expect((await request("PUT", body, { "if-match": etag, cookie: role })).status).toBe(403);
  expect(stored().revision).toBe(before.revision);

  const saved = await request("PUT", body, { "if-match": etag, cookie: "admin" });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    model_name: "best/model",
    supports_pdf_input: true,
    supports_structured_output: true,
    assistant_model,
    classification_model: null,
    credential_status: "configured",
  });
  const after = stored();
  expect(after.credential_ciphertext).toBe(before.credential_ciphertext);
  expect(after.gateway_url).toBe(draft.gateway_url);
  expect(events.at(-1)).toContain("model_configuration_changed");

  // A second change from the same, now stale, version is refused.
  expect((await request("PUT", { ...body, model_name: "other/model" }, { "if-match": etag })).status).toBe(412);
});

test("blank and unreadable configurations fail admission before parsing or creating a Source/job, and remain repairable", async () => {
  const { stateDirectory, application, request, registry } = fixture();

  const submit = () =>
    application(
      new Request("http://localhost/v1/extract", {
        method: "POST",
        headers: { authorization: "Bearer inbound-key", "content-type": "not-multipart" },
        body: "unparsed",
      }),
    );

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

  const spy = spyOn(globalThis, "fetch").mockImplementation(
    fetchFixture(async (url, init) => {
      calls.push({ url: String(url), init });

      return Response.json({ choices: [{ message: { content: "anything readable" } }] });
    }),
  );

  cleanups.push(() => spy.mockRestore());
  expect((await request("POST", draft, {}, "/test")).status).toBe(200);
  expect(readdirSync(stateDirectory)).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("http://localhost:1234/v1/chat/completions");
  expect(calls[0]!.init).toMatchObject({
    method: "POST",
    redirect: "manual",
    headers: { authorization: `Bearer ${draft.credential}`, "content-type": "application/json" },
  });
  expect(JSON.parse(textRequestBody(calls[0]!.init!.body))).toEqual({
    model: draft.model_name,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  const created = await request("PUT", draft, { "if-none-match": "*" });
  expect(calls).toHaveLength(1);
  const { credential: _credential, ...reuse } = draft;
  expect((await request("POST", reuse, {}, "/test")).status).toBe(428);
  expect((await request("POST", reuse, { "if-match": '"stale"' }, "/test")).status).toBe(412);
  expect((await request("POST", reuse, { "if-match": created.headers.get("etag")! }, "/test")).status).toBe(200);
  expect(calls).toHaveLength(2);
  expect((await request("POST", draft, { cookie: "member" }, "/test")).status).toBe(403);
});

test("connection test checks a distinct assistant model and names the failing role", async () => {
  const models: string[] = [];
  let failModel = "";

  const spy = spyOn(globalThis, "fetch").mockImplementation(
    fetchFixture(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const { model } = JSON.parse(textRequestBody(init?.body));
      models.push(model);

      return model === failModel
        ? new Response("upstream-secret", { status: 404 })
        : Response.json({ choices: [{ message: { content: "OK" } }] });
    }),
  );

  cleanups.push(() => spy.mockRestore());

  const withAssistant = {
    ...draft,
    assistant_model: { model_name: "assistant/model", supports_pdf_input: false, supports_structured_output: true },
  };

  const passed = await testWorkspaceModelConnection(withAssistant, draft.credential);
  expect(passed.status).toBe(200);
  expect(await passed.json()).toEqual({
    status: "passed",
    tested_models: [
      { model_role: "extraction", model_name: draft.model_name },
      { model_role: "assistant", model_name: "assistant/model" },
    ],
  });
  expect(models).toEqual([draft.model_name, "assistant/model"]);
  failModel = "assistant/model";
  const failed = await testWorkspaceModelConnection(withAssistant, draft.credential);
  expect(failed.status).toBe(422);
  expect((await failed.json()).error).toMatchObject({
    code: "model_gateway_test_rejected",
    model_role: "assistant",
    gateway_status: 404,
  });
  models.length = 0;
  await testWorkspaceModelConnection(
    { ...withAssistant, assistant_model: { ...withAssistant.assistant_model, model_name: draft.model_name } },
    draft.credential,
  );
  expect(models).toEqual([draft.model_name]);
});

test("connection test classifies gateway failures without exposing upstream messages or retrying", async () => {
  let response = new Response("upstream-secret", { status: 400 });
  const spy = spyOn(globalThis, "fetch").mockImplementation(fetchFixture(async () => response));
  cleanups.push(() => spy.mockRestore());

  for (const [upstream, expected] of [
    [301, 422],
    [400, 422],
    [401, 422],
    [408, 503],
    [429, 503],
    [500, 503],
  ]) {
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

  spy.mockImplementation(
    fetchFixture(async () => {
      throw new Error("network-secret");
    }),
  );
  expect((await testWorkspaceModelConnection(draft, draft.credential)).status).toBe(503);
  expect(spy).toHaveBeenCalledTimes(10);
});

test("connection test checks classification role and deduplicates models shared between task roles", async () => {
  const models: string[] = [];
  let failClassification = false;

  const spy = spyOn(globalThis, "fetch").mockImplementation(
    fetchFixture(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const { model } = JSON.parse(textRequestBody(init?.body));
      models.push(model);

      return failClassification && model === "classification/model"
        ? new Response("private-upstream", { status: 404 })
        : Response.json({ choices: [{ message: { content: "OK" } }] });
    }),
  );

  cleanups.push(() => spy.mockRestore());

  const configuration = {
    ...draft,
    assistant_model: { model_name: "assistant/model", supports_pdf_input: false, supports_structured_output: true },
    classification_model: {
      model_name: "classification/model",
      supports_pdf_input: true,
      supports_structured_output: false,
    },
  };

  expect((await testWorkspaceModelConnection(configuration, draft.credential)).status).toBe(200);
  expect(models).toEqual([draft.model_name, "assistant/model", "classification/model"]);
  failClassification = true;
  const failed = await testWorkspaceModelConnection(configuration, draft.credential);
  expect(failed.status).toBe(422);
  expect((await failed.json()).error).toMatchObject({ model_role: "classification", gateway_status: 404 });
  models.length = 0;
  await testWorkspaceModelConnection(
    { ...configuration, classification_model: configuration.assistant_model },
    draft.credential,
  );
  expect(models).toEqual([draft.model_name, "assistant/model"]);
});
