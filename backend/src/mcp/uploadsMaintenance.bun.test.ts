import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { parseJson, type JsonObject } from "../../../shared/json";
import { createLocalAuth } from "../localAuth";
import { createLocalApplication } from "../localApplication";
import { createLocalWorkspaceControl } from "../localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "../localWorkspaceProductStore";
import { ensureLocalStateDirectories } from "../localRuntime";
import { configureTestWorkspace } from "../testing/workspaceModelFixture";
import { pruneUnusedMcpClients } from "./maintenance";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const toolResult = z.object({ result: z.object({ structuredContent: z.record(z.string(), z.json()) }) });

const errorResult = z.object({ error: z.object({ code: z.string() }) });

async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "mcp-uploads-test-"));
  await ensureLocalStateDirectories(stateDirectory);
  const database = new Database(":memory:");
  let fetchApplication: (request: Request) => Promise<Response> | Response = () => new Response(null, { status: 503 });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => fetchApplication(request) });
  const origin = server.url.origin;
  const callback = "https://client.example/callback";

  const auth = await createLocalAuth({ database, baseURL: origin, secret: randomBytes(32).toString("hex"),
    mailSink: { capture: async () => {} }, mcp: { enabled: true, sensitiveActions: true } });

  const control = createLocalWorkspaceControl(database);
  fetchApplication = createLocalApplication({ auth, workspaceControl: control, stateDirectory });
  cleanups.push(async () => { await server.stop(true); database.close(); await rm(stateDirectory, { recursive: true, force: true }); });

  async function request(path: string, body?: JsonObject, cookie?: string) {
    const headers = new Headers({ origin });
    const form = path === "/api/auth/oauth2/token";

    if (body) headers.set("content-type", form ? "application/x-www-form-urlencoded" : "application/json");

    if (cookie) headers.set("cookie", cookie);
    const options: RequestInit = { method: body ? "POST" : "GET", headers, redirect: "manual" };

    if (body) options.body = form ? new URLSearchParams(Object.entries(body).map(([name, value]) => [name, String(value)])) : JSON.stringify(body);

    return fetch(`${origin}${path}`, options);
  }

  async function register() {
    const registered = await request("/api/auth/oauth2/register", { client_name: "Test client", redirect_uris: [callback],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });

    expect(registered.status).toBe(201);

    return z.object({ client_id: z.string() }).parse(await registered.json()).client_id;
  }

  const signup = await request("/api/auth/sign-up/email", { name: "Owner", email: "owner@example.com", password: "StrongPass1!" });
  expect(signup.status).toBe(200);
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const userId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  const workspace = control.listAcceptedWorkspaces({ userId })[0]!;

  async function connect(clientId: string, scopes = "workspace:read documents:submit documents:read offline_access") {
    const verifier = randomBytes(32).toString("base64url");

    const query = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", scope: scopes,
      state: "s", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: `${origin}/mcp` });

    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, undefined, cookie);
    const oauthQuery = new URL(authorize.headers.get("location")!, origin).search.slice(1);
    const accepted = await request("/v1/mcp/consent", { oauth_query: oauthQuery, accept: true, workspace_id: workspace.id, scopes: scopes.split(" ") }, cookie);
    const code = new URL(z.object({ redirect_uri: z.string() }).parse(await accepted.json()).redirect_uri).searchParams.get("code")!;

    const token = await request("/api/auth/oauth2/token", { grant_type: "authorization_code", client_id: clientId, code,
      code_verifier: verifier, redirect_uri: callback, resource: `${origin}/mcp` });

    expect(token.status).toBe(200);

    return z.object({ access_token: z.string() }).parse(await token.json()).access_token;
  }

  async function call(token: string, name: string, args: JsonObject = {}) {
    const response = await fetch(`${origin}/mcp`, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });

    const body = await response.text();
    const data = body.split("\n").filter((line) => line.startsWith("data: ")).at(-1)?.slice(6) ?? body;

    return toolResult.parse(parseJson(data)).result.structuredContent;
  }

  async function upload(token: string) {
    const sourceRef = z.string().parse((await call(token, "request_document_upload")).source_ref);
    const form = new FormData();
    form.append("file", new File([PNG], "one.png", { type: "image/png" }));
    const uploaded = await fetch(`${origin}/v1/mcp/uploads/${sourceRef}`, { method: "POST", headers: { origin, cookie }, body: form });
    expect(uploaded.status).toBe(200);

    return sourceRef;
  }

  function jobCount() {
    const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });

    try { return store.countExtractionJobs(); }
    finally { store.close(); }
  }

  const uploadStatus = (id: string) => database.query<{ status: string }, [string]>("SELECT status FROM mcp_uploads WHERE id = ?").get(id)?.status;
  const configure = () => configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });

  return { database, register, connect, call, upload, jobCount, uploadStatus, configure, stateDirectory };
}

test("a submission rejected before admission keeps the upload and key for a retry", async () => {
  const app = await fixture();
  const token = await app.connect(await app.register());
  const sourceRef = await app.upload(token);
  const submit = (operation_id: string) => app.call(token, "submit_document", { source_ref: sourceRef, operation_id, template_tags: ["invoice"] });

  expect(errorResult.parse(await submit("submit-key-1")).error.code).toBe("workspace_model_not_configured");
  expect(app.uploadStatus(sourceRef)).toBe("uploaded");
  expect(await Bun.file(join(app.stateDirectory, "temporary", "mcp-uploads", `${sourceRef}.source`)).exists()).toBe(true);
  expect(errorResult.parse(await submit("submit-key-1")).error.code).toBe("workspace_model_not_configured");

  app.configure();
  const accepted = await submit("submit-key-1");
  expect(accepted.job_id).toBeString();
  expect(app.uploadStatus(sourceRef)).toBe("consumed");
  expect(await Bun.file(join(app.stateDirectory, "temporary", "mcp-uploads", `${sourceRef}.source`)).exists()).toBe(false);

  expect((await submit("submit-key-1")).job_id).toBe(accepted.job_id);
  expect(errorResult.parse(await submit("submit-key-2")).error.code).toBe("mcp_upload_used");
  expect(app.jobCount()).toBe(1);
});

test("a new key can submit an upload after a rejected attempt, and the old key cannot duplicate it", async () => {
  const app = await fixture();
  const token = await app.connect(await app.register());
  const sourceRef = await app.upload(token);
  const submit = (operation_id: string, extra: JsonObject = { template_tags: ["invoice"] }) => app.call(token, "submit_document", { source_ref: sourceRef, operation_id, ...extra });

  expect(errorResult.parse(await submit("submit-key-1", { template_id: "tpl_missing" })).error.code).toBe("workspace_model_not_configured");
  app.configure();
  expect(errorResult.parse(await submit("submit-key-1", { template_id: "tpl_missing" })).error.code).toBe("template_not_found");

  expect((await submit("submit-key-2")).job_id).toBeString();
  expect(errorResult.parse(await submit("submit-key-1", { template_id: "tpl_missing" })).error.code).toBe("mcp_upload_used");
  expect(app.jobCount()).toBe(1);
});

test("concurrent submissions of one upload admit exactly one Document", async () => {
  const app = await fixture();
  const token = await app.connect(await app.register());
  const sourceRef = await app.upload(token);
  app.configure();

  const results = await Promise.all(["key-a-0001", "key-b-0001", "key-a-0001", "key-c-0001"]
    .map((operation_id) => app.call(token, "submit_document", { source_ref: sourceRef, operation_id, template_tags: ["invoice"] })));

  const jobs = new Set(results.flatMap((result) => {
    const accepted = z.object({ job_id: z.string() }).safeParse(result);

    return accepted.success ? [accepted.data.job_id] : [];
  }));

  expect(jobs.size).toBe(1);
  expect(app.jobCount()).toBe(1);
});

test("maintenance prunes only old clients that no grant, token or consent references", async () => {
  const app = await fixture();
  const connected = await app.register();
  await app.connect(connected, "workspace:read offline_access");
  const revoked = await app.register();
  await app.connect(revoked, "workspace:read");
  app.database.query("UPDATE mcp_grants SET revoked_at = ? WHERE client_id = ?").run(new Date().toISOString(), revoked);
  app.database.query("DELETE FROM oauthConsent WHERE clientId = ?").run(revoked);
  const unused = await app.register();
  const recent = await app.register();

  // Better Auth stores client dates as ISO text; keep that representation when backdating.
  const createdAt = app.database.query<{ type: string }, [string]>("SELECT typeof(createdAt) AS type FROM oauthClient WHERE clientId = ?").get(unused);
  expect(createdAt?.type).toBe("text");
  const old = new Date(Date.now() - 2 * 86400_000).toISOString();
  app.database.query("UPDATE oauthClient SET createdAt = ? WHERE clientId != ?").run(old, recent);

  pruneUnusedMcpClients(app.database);
  const remaining = app.database.query<{ clientId: string }, []>("SELECT clientId FROM oauthClient").all().map((row) => row.clientId);
  expect(remaining.sort()).toEqual([connected, revoked, recent].sort());
});

test("maintenance expires provider tokens by their stored ISO timestamps", async () => {
  const app = await fixture();
  const clientId = await app.register();
  await app.connect(clientId, "workspace:read offline_access");
  const stored = app.database.query<{ type: string; expiresAt: string }, []>("SELECT typeof(expiresAt) AS type, expiresAt FROM oauthRefreshToken").all();
  expect(stored).toHaveLength(1);
  expect(stored[0]!.type).toBe("text");
  expect(new Date(stored[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());

  const token = await app.connect(clientId, "workspace:read offline_access");
  app.database.query("UPDATE oauthRefreshToken SET expiresAt = ? WHERE rowid = (SELECT MIN(rowid) FROM oauthRefreshToken)").run(new Date(Date.now() - 1000).toISOString());
  // Maintenance runs at most once a minute and already ran during consent.
  setSystemTime(new Date(Date.now() + 61_000));

  try { await app.call(token, "workspace_context"); }
  finally { setSystemTime(); }

  const remaining = app.database.query<{ expiresAt: string }, []>("SELECT expiresAt FROM oauthRefreshToken").all();
  expect(remaining).toHaveLength(1);
  expect(new Date(remaining[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());
});
