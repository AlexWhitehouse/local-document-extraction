import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { parseJson, type JsonObject } from "../../../shared/json";
import type { LocalMailMessage } from "../localMailSink";
import { createMcpOperationStore } from "./operations";
import { actorFor } from "./grants";
import { createLocalWorkspaceProductStore } from "../localWorkspaceProductStore";
import { createLocalAuth } from "../localAuth";
import { createLocalApplication } from "../localApplication";
import { createLocalWorkspaceControl } from "../localWorkspaceControl";
import { ensureLocalStateDirectories } from "../localRuntime";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "mcp-auth-test-"));
  await ensureLocalStateDirectories(stateDirectory);
  const database = new Database(":memory:");
  let fetchApplication: (request: Request) => Promise<Response> | Response = () => new Response(null, { status: 503 });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => fetchApplication(request) });
  const origin = server.url.origin;
  const callback = "https://client.example/callback";

  const messages: LocalMailMessage[] = [];

  const auth = await createLocalAuth({ database, baseURL: origin,
    secret: randomBytes(32).toString("hex"), mailSink: { capture: async (message) => { messages.push(message); } },
    mcp: { enabled: true, sensitiveActions: true },
  });

  const control = createLocalWorkspaceControl(database);
  fetchApplication = createLocalApplication({ auth, workspaceControl: control, stateDirectory });
  cleanups.push(async () => { await server.stop(true); database.close(); await rm(stateDirectory, { recursive: true, force: true }); });

  async function request(path: string, body?: JsonObject, cookie?: string, method = body ? "POST" : "GET") {
    const headers = new Headers({ origin });

    const isTokenRequest = path === "/api/auth/oauth2/token";

    if (body) headers.set("content-type", isTokenRequest ? "application/x-www-form-urlencoded" : "application/json");

    if (cookie) headers.set("cookie", cookie);

    const options: RequestInit = { method, headers, redirect: "manual" };

    if (body) options.body = isTokenRequest ? new URLSearchParams(Object.entries(body).map(([name, value]) => [name, String(value)])) : JSON.stringify(body);

    return fetch(`${origin}${path}`, options);
  }

  const signup = await request("/api/auth/sign-up/email", { name: "Owner", email: "owner@example.com", password: "StrongPass1!" });
  expect(signup.status).toBe(200);
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const signedUp = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json());
  const workspace = control.listAcceptedWorkspaces({ userId: signedUp.user.id })[0]!;

  const registered = await request("/api/auth/oauth2/register", { client_name: "Test client", client_uri: "https://declared.example", redirect_uris: [callback],
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });

  expect(registered.status).toBe(201);
  const client = z.object({ client_id: z.string() }).parse(await registered.json());

  async function authorize(scopes: string, acceptedScopes = scopes) {
    const verifier = randomBytes(32).toString("base64url");

    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code",
      scope: scopes, state: "test-state", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256", resource: `${origin}/mcp` });

    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, undefined, cookie);
    expect(authorize.status).toBe(302);
    const consentLocation = new URL(authorize.headers.get("location")!, origin);
    expect(consentLocation.pathname).toBe("/mcp/connect");
    const oauthQuery = consentLocation.search.slice(1);
    const info = await request(`/v1/mcp/consent?oauth_query=${encodeURIComponent(oauthQuery)}`, undefined, cookie);
    expect(info.status, await info.clone().text()).toBe(200);
    const accepted = await request("/v1/mcp/consent", { oauth_query: oauthQuery, accept: true, workspace_id: workspace.id, scopes: acceptedScopes.split(" ") }, cookie);
    expect(accepted.status).toBe(200);
    const redirect = z.object({ redirect_uri: z.string() }).parse(await accepted.json());
    const code = new URL(redirect.redirect_uri).searchParams.get("code");
    expect(code).not.toBeNull();

    return { code, verifier, oauthQuery, info: await info.json() };
  }

  async function connect(scopes = "workspace:read documents:read offline_access", acceptedScopes = scopes) {
    const { code, verifier } = await authorize(scopes, acceptedScopes);

    const token = await request("/api/auth/oauth2/token", { grant_type: "authorization_code", client_id: client.client_id,
      code, code_verifier: verifier, redirect_uri: callback, resource: `${origin}/mcp` });

    expect(token.status).toBe(200);

    return z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number(), scope: z.string() }).parse(await token.json());
  }

  async function mcp(token?: string, name = "workspace_context", args: JsonObject = {}) {
    const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" });

    if (token) headers.set("authorization", `Bearer ${token}`);

    return fetch(`${origin}/mcp`, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  }

  return { auth, control, database, messages, request, authorize, connect, mcp, cookie, origin, client, callback, workspace, stateDirectory, userId: signedUp.user.id };
}

test("real OAuth PKCE flow grants one workspace, rotates refresh, and revokes issued tokens immediately", async () => {
  const app = await fixture();
  const token = await app.connect();
  const read = await app.mcp(token.access_token);
  expect(read.status).toBe(200);
  expect(await read.text()).toContain(app.workspace.id);

  const refreshed = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: token.refresh_token, resource: `${app.origin}/mcp` });

  expect(refreshed.status).toBe(200);
  const next = z.object({ access_token: z.string(), refresh_token: z.string() }).parse(await refreshed.json());
  const grants = app.auth.mcp!.grants.list(app.userId);
  expect(grants).toHaveLength(1);
  const revoked = await app.request(`/v1/mcp/connections/${grants[0]!.id}`, undefined, app.cookie, "DELETE");
  expect(revoked.status).toBe(200);
  expect((await app.mcp(token.access_token)).status).toBe(403);
  expect((await app.mcp(next.access_token)).status).toBe(403);

  const failedRefresh = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: next.refresh_token, resource: `${app.origin}/mcp` });

  expect(failedRefresh.ok).toBe(false);
  expect((await app.request("/v1/workspaces", undefined, app.cookie)).status).toBe(200);
});

test("MCP discovery challenges have no workspace data and bearer tokens cannot become browser sessions", async () => {
  const app = await fixture();
  const probe = await app.mcp();
  expect(probe.status).toBe(401);
  expect(probe.headers.get("www-authenticate")).toContain("resource_metadata");
  const metadata = await app.request("/.well-known/oauth-protected-resource/mcp");
  expect(metadata.status).toBe(200);
  expect(metadata.headers.get("content-type")).toContain("application/json");
  expect(await metadata.text()).not.toContain(app.workspace.id);
  const token = await app.connect();
  const session = await app.auth.getSession(new Request(app.origin, { headers: { cookie: app.cookie, authorization: `Bearer ${token.access_token}` } }));
  expect(session).toBeNull();
  const other = await app.connect();
  app.auth.mcp!.grants.revoke(app.auth.mcp!.grants.list(app.userId).find((grant) => grant.id !== app.auth.mcp!.grants.list(app.userId)[0]!.id)!.id, app.userId);
  expect((await app.mcp(other.access_token)).status).toBe(200);
});

const toolResponse = z.object({ result: z.object({ structuredContent: z.record(z.string(), z.json()).optional(), isError: z.boolean().optional() }) });

async function output(response: Response) {
  expect(response.status).toBe(200);
  const text = await response.text();

  const payload = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").filter((line) => line.startsWith("data: ")).at(-1)!.slice(6)
    : text;

  const parsed = toolResponse.parse(parseJson(payload));
  expect(parsed.result.isError, payload).not.toBe(true);

  return parsed.result.structuredContent!;
}

test("scopes are enforced on direct calls and a reduced grant cannot replay prior results", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read templates:write templates:read");
  const args = { operation_id: "create-template-once", template: { name: "Invoice", fields: [{ name: "number", data_type: "string", description: "Invoice number" }] } };
  const first = await output(await app.mcp(token.access_token, "create_template", args));
  const again = await output(await app.mcp(token.access_token, "create_template", args));
  expect(z.string().parse(again.template_id)).toBe(z.string().parse(first.template_id));
  const conflict = await app.mcp(token.access_token, "create_template", { ...args, template: { ...args.template, name: "Changed" } });
  expect(await conflict.text()).toContain("mcp_idempotency_conflict");
  const denied = await app.mcp(token.access_token, "list_documents");
  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="documents:read"');
  app.database.query("UPDATE mcp_grants SET scopes_json = ? WHERE user_id = ?").run('["workspace:read"]', app.userId);
  expect((await app.mcp(token.access_token, "create_template", args)).status).toBe(403);
  expect((await app.mcp(token.access_token, "workspace_context", { workspace_id: "forged" })).status).toBe(200);
  const forged = await app.mcp(token.access_token, "workspace_context", { workspace_id: "forged" });
  expect(await forged.text()).toContain("Unrecognized key");
});

test("logout ends session-bound grants while explicitly offline grants survive", async () => {
  const app = await fixture();
  const online = await app.connect("workspace:read");
  const offline = await app.connect();
  expect((await app.request("/api/auth/sign-out", {}, app.cookie)).status).toBe(200);
  expect((await app.mcp(online.access_token)).status).toBe(403);
  expect((await app.mcp(offline.access_token)).status).toBe(200);

  const refreshed = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: offline.refresh_token!, resource: `${app.origin}/mcp` });

  expect(refreshed.status).toBe(200);
});

test("declining offline access issues only a five-minute token without widening consent", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read offline_access", "workspace:read");
  expect(token.refresh_token).toBeUndefined();
  expect(token.expires_in).toBeLessThanOrEqual(300);
  expect(token.expires_in).toBeGreaterThan(0);
  expect(token.scope).toBe("workspace:read");
  expect(app.auth.mcp!.grants.list(app.userId)[0]!.scopes).toEqual(["workspace:read"]);
});

test("expired persisted browser sessions stop session-bound tokens and captured browser authority", async () => {
  const app = await fixture();
  const online = await app.connect("workspace:read");
  const offline = await app.connect();
  const session = await app.auth.getSession(new Request(app.origin, { headers: { cookie: app.cookie } }));
  expect(session?.isActive?.()).toBe(true);
  expect((await app.mcp(online.access_token)).status).toBe(200);
  expect(app.database.query<{ storage: string }, []>("SELECT typeof(expiresAt) AS storage FROM session LIMIT 1").get()!.storage).toBe("text");
  app.database.query("UPDATE session SET expiresAt = ? WHERE userId = ?").run(new Date(Date.now() - 1000).toISOString(), app.userId);
  expect(session?.isActive?.()).toBe(false);
  expect((await app.mcp(online.access_token)).status).toBe(403);
  expect((await app.mcp(offline.access_token)).status).toBe(200);
});

test("timed bans block offline tokens, refresh and captured browser authority until the ban expires", async () => {
  const app = await fixture();
  const token = await app.connect();
  const session = await app.auth.getSession(new Request(app.origin, { headers: { cookie: app.cookie } }));
  expect(session?.isActive?.()).toBe(true);
  app.database.query("UPDATE user SET banned = 1, banExpires = ? WHERE id = ?").run(new Date(Date.now() + 60_000).toISOString(), app.userId);
  expect(session?.isActive?.()).toBe(false);
  expect((await app.mcp(token.access_token)).status).toBe(403);

  const refresh = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: token.refresh_token!, resource: `${app.origin}/mcp` });

  expect(refresh.ok).toBe(false);
  app.database.query("UPDATE user SET banExpires = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), app.userId);
  expect(session?.isActive?.()).toBe(true);
  expect((await app.mcp(token.access_token)).status).toBe(200);
});

test("consent exposes the signed callback separately from unverified client website metadata", async () => {
  const app = await fixture();
  const authorization = await app.authorize("workspace:read");
  expect(authorization.info).toMatchObject({ redirect_uri: app.callback, client: { uri: "https://declared.example" } });
  const tampered = new URLSearchParams(authorization.oauthQuery);
  tampered.set("redirect_uri", "https://forged.example/callback");
  const response = await app.request(`/v1/mcp/consent?oauth_query=${encodeURIComponent(tampered.toString())}`, undefined, app.cookie);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("mcp_authorization_expired");
});

test("impersonated sessions cannot deny consent, approve or deny actions, or upload files", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read workspace:api-key documents:submit");

  const proposal = await output(await app.mcp(token.access_token, "request_action_approval", {
    operation_id: "impersonated-action", request: { action: "workspace.rotate_api_key" },
  }));

  const upload = await output(await app.mcp(token.access_token, "request_document_upload"));
  const authorization = await app.authorize("workspace:read");
  app.database.query("UPDATE session SET impersonatedBy = ? WHERE userId = ?").run("admin-reviewer", app.userId);

  for (const decision of ["approve", "deny"]) {
    const response = await app.request(`/v1/mcp/approvals/${z.string().parse(proposal.request_id)}`, { decision }, app.cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("mcp_impersonation_not_allowed");
  }

  const deniedConsent = await app.request("/v1/mcp/consent", { oauth_query: authorization.oauthQuery, accept: false }, app.cookie);
  expect(deniedConsent.status).toBe(403);
  const uploadResponse = await app.request(`/v1/mcp/uploads/${z.string().parse(upload.source_ref)}`, {}, app.cookie);
  expect(uploadResponse.status).toBe(403);
  expect(await uploadResponse.text()).toContain("mcp_impersonation_not_allowed");
});

test("live bans, membership loss and the off switch reject already-issued tokens", async () => {
  const app = await fixture();
  const token = await app.connect();
  app.database.query("UPDATE user SET banned = 1 WHERE id = ?").run(app.userId);
  expect((await app.mcp(token.access_token)).status).toBe(403);
  app.database.query("UPDATE user SET banned = 0 WHERE id = ?").run(app.userId);
  expect((await app.mcp(token.access_token)).status).toBe(200);
  app.database.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?").run(app.workspace.id, app.userId);
  expect((await app.mcp(token.access_token)).status).toBe(403);
  app.auth.mcp!.configuration.enabled = false;
  expect((await app.mcp(token.access_token)).status).toBe(404);
  expect((await app.request("/api/auth/oauth2/register", { redirect_uris: [app.callback] })).status).toBe(404);
  const connections = await app.request("/v1/mcp/connections", undefined, app.cookie);
  expect(connections.status).toBe(200);
  expect(z.object({ enabled: z.boolean() }).parse(await connections.json()).enabled).toBe(false);
  const grant = app.auth.mcp!.grants.list(app.userId)[0]!;
  expect((await app.request(`/v1/mcp/connections/${grant.id}`, undefined, app.cookie, "DELETE")).status).toBe(200);
});

test("exact-action approval executes once, rejects stale inputs, and never persists a rotated key", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read workspace:api-key workspace:settings");
  const args = { operation_id: "rotate-api-key-once", request: { action: "workspace.rotate_api_key" } };
  const proposal = await output(await app.mcp(token.access_token, "request_action_approval", args));
  const approvalId = z.string().parse(proposal.request_id);
  const path = `/v1/mcp/approvals/${approvalId}`;
  const [a, b] = await Promise.all([app.request(path, { decision: "approve" }, app.cookie), app.request(path, { decision: "approve" }, app.cookie)]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  const results = z.array(z.object({ status: z.string(), result: z.object({ api_key: z.string().optional() }).nullable() })).parse([await a.json(), await b.json()]);
  expect(results.filter((item) => item.result?.api_key)).toHaveLength(1);
  const secret = results.find((item) => item.result?.api_key)!.result!.api_key!;
  const status = await app.mcp(token.access_token, "get_operation", { request_id: approvalId });
  const statusText = await status.text();
  expect(statusText).toContain("completed");
  expect(statusText).not.toContain(secret);
  expect(await (await app.request(path, undefined, app.cookie)).text()).not.toContain(secret);
  const retry = await output(await app.mcp(token.access_token, "request_action_approval", args));
  expect(retry.request_id).toBe(approvalId);
  expect(retry.status).toBe("completed");
  const changed = await app.mcp(token.access_token, "request_action_approval", { operation_id: "rename-exact-input", request: { action: "workspace.rename", name: "Approved name" } });
  const staleId = z.string().parse((await output(changed)).request_id);
  app.control.renameWorkspace({ workspaceId: app.workspace.id, userId: app.userId, name: "Someone else's edit" });
  expect((await app.request(`/v1/mcp/approvals/${staleId}`, { decision: "approve" }, app.cookie)).status).toBe(409);
  const audit = JSON.stringify(app.database.query("SELECT * FROM mcp_security_activity").all());
  expect(audit).not.toContain(secret);
  expect(audit).not.toContain(token.access_token);
});

test("approval details and repeated decisions require current grant, scope and workspace authority", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read workspace:settings");

  const approval = await output(await app.mcp(token.access_token, "request_action_approval", {
    operation_id: "approval-read-authority", request: { action: "workspace.rename", name: "Confidential project" },
  }));

  const path = `/v1/mcp/approvals/${approval.request_id}`;
  expect((await app.request(path, undefined, app.cookie)).status).toBe(200);
  expect((await app.request(path, { decision: "approve" }, app.cookie)).status).toBe(200);
  const grant = app.auth.mcp!.grants.list(app.userId)[0]!;

  async function assertDenied() {
    for (const body of [undefined, { decision: "approve" }]) {
      const response = await app.request(path, body, app.cookie);

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("Confidential project");
    }
  }

  app.database.query("UPDATE workspace_memberships SET role = 'member' WHERE workspace_id = ? AND user_id = ?").run(app.workspace.id, app.userId);
  await assertDenied();
  app.database.query("UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?").run(app.workspace.id, app.userId);
  app.database.query("UPDATE mcp_grants SET scopes_json = ? WHERE id = ?").run(JSON.stringify(["workspace:read"]), grant.id);
  await assertDenied();
  app.database.query("UPDATE mcp_grants SET scopes_json = ? WHERE id = ?").run(JSON.stringify(grant.scopes), grant.id);
  app.auth.mcp!.grants.revoke(grant.id, app.userId);
  await assertDenied();
});

test("pending approval details are unavailable after workspace membership ends", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read workspace:settings");

  const approval = await output(await app.mcp(token.access_token, "request_action_approval", {
    operation_id: "approval-removed-member", request: { action: "workspace.rename", name: "Confidential project" },
  }));

  app.database.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?").run(app.workspace.id, app.userId);
  const response = await app.request(`/v1/mcp/approvals/${approval.request_id}`, undefined, app.cookie);
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("Confidential project");
});

test("clients register HTTPS and loopback callbacks without an operator allowlist", async () => {
  const app = await fixture();

  for (const callback of ["https://new-client.example/oauth/callback", "http://localhost:54321/callback", "http://127.0.0.1:54321/callback", "http://[::1]:54321/callback"]) {
    const response = await fetch(`${app.origin}/api/auth/oauth2/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "New client", redirect_uris: [callback], token_endpoint_auth_method: "none",
        application_type: callback.startsWith("http:") ? "native" : "web", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(z.object({ redirect_uris: z.array(z.string()) }).parse(await response.json()).redirect_uris).toEqual([callback]);
  }

  const rateLimited = await app.request("/api/auth/oauth2/register", { redirect_uris: ["https://another-client.example/callback"] });
  expect(rateLimited.status).toBe(429);
});

test("registration rejects unsafe callback URLs and invalid callback lists", async () => {
  const app = await fixture();

  const callbacks = [
    "http://client.example/callback", "http://localhost.evil.example/callback", "https://client.example/callback#fragment",
    "https://client.example/callback#", "https://user:password@client.example/callback", "https://*.example/callback",
    "https://client.example/*", "javascript:alert(1)", "file:///callback", "/callback", "https:client.example/callback",
    " https://client.example/callback", "https://client.example/call\nback", "https://client.example/call\u0001back", "https://client.example/call\\back",
  ];

  const invalidLists = [...callbacks.map((callback) => [callback]), [], Array(9).fill("https://client.example/callback"),
    ["https://client.example/callback", "http://client.example/callback"]];

  for (const redirectUris of invalidLists) {
    const response = await app.request("/api/auth/oauth2/register", { redirect_uris: redirectUris });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_redirect_uri" });
  }

  expect(app.database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM oauthClient").get()!.count).toBe(1);
});

test("OAuth requires the client's exact registered callback and PKCE after open registration", async () => {
  const app = await fixture();
  const verifier = randomBytes(32).toString("base64url");

  for (const redirectUri of ["https://other-client.example/callback", `${app.callback}/`, `${app.callback}?extra=1`]) {
    const query = new URLSearchParams({ client_id: app.client.client_id, redirect_uri: redirectUri, response_type: "code",
      scope: "workspace:read", state: "test-state", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256", resource: `${app.origin}/mcp` });

    const response = await app.request(`/api/auth/oauth2/authorize?${query}`, undefined, app.cookie);

    expect(response.status).toBe(302);
    const errorLocation = new URL(response.headers.get("location")!);
    expect(errorLocation.origin).toBe(app.origin);
    expect(errorLocation.searchParams.get("error")).toBe("invalid_redirect");
  }

  for (const invalidField of ["redirect_uri", "code_verifier"]) {
    const authorization = await app.authorize("workspace:read");

    const response = await app.request("/api/auth/oauth2/token", {
      grant_type: "authorization_code", client_id: app.client.client_id, code: authorization.code,
      code_verifier: authorization.verifier, redirect_uri: app.callback, resource: `${app.origin}/mcp`,
      [invalidField]: invalidField === "redirect_uri" ? "https://other-client.example/callback" : verifier,
    });

    expect(response.status).toBe(invalidField === "redirect_uri" ? 400 : 401);
    const error = await response.json();
    expect(error).toMatchObject({ error: invalidField === "redirect_uri" ? "invalid_grant" : "invalid_request" });
    expect(error).not.toHaveProperty("access_token");
  }

  const token = await app.connect();
  expect((await app.mcp(token.access_token)).status).toBe(200);
});

test("forged tokens, unknown OAuth resources and hostile origins are rejected", async () => {
  const app = await fixture();
  expect((await app.mcp("not-a-token")).status).toBe(401);
  const token = await app.connect();
  const parts = token.access_token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ sub: app.userId, aud: "https://elsewhere/mcp", exp: 1 })).toString("base64url");
  expect((await app.mcp(parts.join("."))).status).toBe(401);
  const origin = await fetch(`${app.origin}/mcp`, { method: "POST", headers: { origin: "https://evil.example", authorization: `Bearer ${token.access_token}`, "content-type": "application/json" }, body: "{}" });
  expect(origin.status).toBe(403);
  const clientInfo = z.object({ connections: z.array(z.object({ client: z.object({ provenance: z.string() }) })) }).parse(await (await app.request("/v1/mcp/connections", undefined, app.cookie)).json());
  expect(clientInfo.connections[0]!.client.provenance).toBe("dynamic");
});

test("password recovery revokes offline grants and refresh replay cannot mint more tokens", async () => {
  const app = await fixture();
  const token = await app.connect();

  const refreshed = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: token.refresh_token!, resource: `${app.origin}/mcp` });

  expect(refreshed.status).toBe(200);
  const rotated = z.object({ refresh_token: z.string() }).parse(await refreshed.json());

  const replay = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: token.refresh_token!, resource: `${app.origin}/mcp` });

  expect(replay.ok).toBe(false);
  const fresh = await app.connect();
  await app.request("/api/auth/request-password-reset", { email: "owner@example.com", redirectTo: "/reset-password" });
  const link = app.messages.find((message) => message.type === "account_password_reset")!.text.match(/https?:\/\/\S+/)![0];
  const reset = await app.request("/api/auth/reset-password", { token: new URL(link).pathname.split("/").at(-1)!, newPassword: "ChangedStrongPass1!" });
  expect(reset.status).toBe(200);
  expect((await app.mcp(fresh.access_token)).status).toBe(403);

  const rejected = await app.request("/api/auth/oauth2/token", { grant_type: "refresh_token", client_id: app.client.client_id,
    refresh_token: rotated.refresh_token, resource: `${app.origin}/mcp` });

  expect(rejected.ok).toBe(false);
});

test("two users and two workspaces cannot substitute grants, objects or approval authority", async () => {
  const app = await fixture();
  const owner = await app.connect("workspace:read templates:read workspace:api-key");
  const signup = await app.request("/api/auth/sign-up/email", { name: "Other", email: "other@example.com", password: "StrongPass1!" });
  const otherCookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const otherUser = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user;
  const otherWorkspace = app.control.listAcceptedWorkspaces({ userId: otherUser.id })[0]!;

  const created = await fetch(`${app.origin}/v1/templates`, { method: "POST", headers: { cookie: otherCookie, origin: app.origin,
    "x-workspace-id": otherWorkspace.id, "content-type": "application/json" }, body: JSON.stringify({ name: "Private template", fields: [{ name: "amount", data_type: "number", description: "Amount" }] }) });

  expect(created.status).toBe(201);
  const template = z.object({ template_id: z.string() }).parse(await created.json());
  expect(await (await app.mcp(owner.access_token, "get_template", { template_id: template.template_id })).text()).toContain("not_found");
  const proposal = await output(await app.mcp(owner.access_token, "request_action_approval", { operation_id: "owner-key-only", request: { action: "workspace.rotate_api_key" } }));
  const approval = `/v1/mcp/approvals/${z.string().parse(proposal.request_id)}`;
  expect((await app.request(approval, { decision: "approve" }, otherCookie)).status).toBe(404);
  const grant = app.auth.mcp!.grants.list(app.userId)[0]!;
  expect((await app.request(`/v1/mcp/connections/${grant.id}`, undefined, otherCookie, "DELETE")).status).toBe(404);
  app.database.query("UPDATE workspace_memberships SET role = 'member' WHERE workspace_id = ? AND user_id = ?").run(app.workspace.id, app.userId);
  expect((await app.request(approval, { decision: "approve" }, app.cookie)).status).toBe(403);
  app.database.query("UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?").run(app.workspace.id, app.userId);
  app.database.query("UPDATE mcp_operations SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", z.string().parse(proposal.request_id));
  expect(await (await app.request(approval, { decision: "approve" }, app.cookie)).text()).toContain("expired");
});

test("a product commit survives a lost control completion and a restarted operation store", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read templates:read templates:write");
  const args = { operation_id: "restart-template-once", template: { name: "Receipt", fields: [{ name: "total", data_type: "number", description: "Total" }] } };
  const created = await output(await app.mcp(token.access_token, "create_template", args));
  app.database.query("UPDATE mcp_operations SET status = 'executing', result_json = NULL WHERE action = 'template.create'").run();
  createMcpOperationStore(app.database);
  const recovered = await output(await app.mcp(token.access_token, "create_template", args));
  expect(z.string().parse(recovered.template_id)).toBe(z.string().parse(created.template_id));
  const templates = await output(await app.mcp(token.access_token, "list_templates"));
  expect(z.array(z.object({ id: z.string() })).parse(templates.templates)).toHaveLength(1);
  expect(app.database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mcp_security_activity WHERE outcome = 'recovered_commit'").get()!.count).toBe(1);
});

test("operation status recovers an accepted submission after restart without submitting again", async () => {
  const app = await fixture();
  const token = await app.connect("workspace:read documents:submit");
  const grant = app.auth.mcp!.grants.list(app.userId)[0]!;
  const operations = createMcpOperationStore(app.database);
  const operation = operations.prepare(actorFor(grant), "document.submit", "accepted-before-restart", { source_ref: "uploaded-source" }, false);
  expect(operations.claim(operation.id)).toBe(true);
  const store = createLocalWorkspaceProductStore({ stateDirectory: app.stateDirectory, workspaceId: app.workspace.id });

  try {
    store.createQueuedExtractionJob({ jobId: operation.id, templateId: null, templateVersion: null,
      sourceFileKey: "private-source-key", sourceMimeType: "image/png", sourceName: "private-name.png",
      sourceFilePageCount: 1, submittedAt: new Date().toISOString() });
  } finally { store.close(); }

  createMcpOperationStore(app.database);
  const recovered = await output(await app.mcp(token.access_token, "get_operation", { request_id: operation.id }));
  expect(recovered.status).toBe("completed");
  expect(recovered.result).toEqual({ job_id: operation.id, status: "queued" });
  expect(JSON.stringify(recovered)).not.toContain("private-");
  expect(app.database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mcp_security_activity WHERE outcome = 'recovered_commit'").get()!.count).toBe(1);
  app.database.query("UPDATE mcp_grants SET scopes_json = ? WHERE id = ?").run(JSON.stringify(["workspace:read"]), grant.id);
  expect(await (await app.mcp(token.access_token, "get_operation", { request_id: operation.id })).text()).toContain("mcp_scope_required");
});

test("discovery, modern protocol and request limits use protocol responses", async () => {
  const app = await fixture();
  const discovery = await app.request("/.well-known/oauth-authorization-server/api/auth");
  expect(discovery.status).toBe(200);
  const metadata = z.object({ issuer: z.string(), authorization_endpoint: z.string(), token_endpoint: z.string(), registration_endpoint: z.string() }).parse(await discovery.json());
  expect(metadata.issuer).toBe(`${app.origin}/api/auth`);
  expect(metadata.authorization_endpoint).toBe(`${app.origin}/api/auth/oauth2/authorize`);
  expect(metadata.token_endpoint).toBe(`${app.origin}/api/auth/oauth2/token`);
  expect(metadata.registration_endpoint).toBe(`${app.origin}/api/auth/oauth2/register`);
  const token = await app.connect();
  const headers = { authorization: `Bearer ${token.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "workspace_context" };

  const modern = await fetch(`${app.origin}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "workspace_context", arguments: {}, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} },
  } }) });

  expect(modern.headers.get("content-type")).toContain("application/json");
  expect(modern.status, await modern.clone().text()).toBe(200);
  const read = await output(modern);
  expect(z.object({ id: z.string() }).parse(read.workspace).id).toBe(app.workspace.id);
  const large = await fetch(`${app.origin}/mcp`, { method: "POST", headers, body: JSON.stringify({ padding: "x".repeat(270_000) }) });
  expect(large.status).toBe(413);
  expect((await app.request("/mcp")).status).toBe(405);
});
