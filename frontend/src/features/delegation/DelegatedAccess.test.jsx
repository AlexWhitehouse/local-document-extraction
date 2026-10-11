import React, { useSyncExternalStore } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";
import { DEFAULT_RUNTIME_CONFIGURATION } from "../../lib/runtimeConfiguration";

const SIGNED_QUERY = "client_id=client_1&scope=workspace%3Aread+documents%3Aread+offline_access&exp=9999999999&ba_param=client_id&sig=abc";

const CONSENT = {
  client: { id: "client_1", name: "Claude", uri: "https://claude.ai", provenance: "registered" },
  workspaces: [
    { id: "ws_a", name: "Workspace A", role: "owner" },
    { id: "ws_b", name: "Workspace B", role: "member" },
  ],
  scopes: [
    { id: "workspace:read", label: "Workspace context", description: "Read the workspace.", requires_approval: false },
    { id: "documents:read", label: "Read documents", description: "Read document details.", requires_approval: false },
    { id: "offline_access", label: "Stay connected", description: "Keep access after you sign out.", requires_approval: false },
  ],
  requested_scopes: ["workspace:read", "documents:read", "offline_access"],
  expires_at: "2099-01-01T00:00:00.000Z",
};

// A session store the fake auth clients share, so a session change re-renders like Better Auth does.
const sessionStore = {
  value: null,
  listeners: new Set(),
  set(value) {
    this.value = value;

    for (const listener of this.listeners) listener();
  },
};

const authCalls = { signInEmail: vi.fn(), signUpEmail: vi.fn(), signInSocial: vi.fn(), signOut: vi.fn(), refetch: vi.fn() };

function createFakeAuthClient(kind) {
  return () => ({
    kind,
    useSession: () => ({
      data: useSyncExternalStore(
        (listener) => {
          sessionStore.listeners.add(listener);

          return () => sessionStore.listeners.delete(listener);
        },
        () => sessionStore.value,
      ),
      isPending: false,
      refetch: authCalls.refetch,
    }),
    signIn: {
      email: (body) => authCalls.signInEmail(kind, body),
      social: (body) => authCalls.signInSocial(kind, body),
    },
    signUp: { email: (body) => authCalls.signUpEmail(kind, body) },
    signOut: () => authCalls.signOut(kind),
    admin: { listUsers: vi.fn(), stopImpersonating: vi.fn() },
  });
}

const session = (id = "user_1", sessionId = "session_1", extra = {}) => ({
  user: { id, name: "Ada Lovelace", email: `${id}@example.com`, role: "user" },
  session: { id: sessionId, ...extra },
});

let routes;

let toast;

let navigateTo;

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function failure(code, status) {
  return respond({ error: { code, message: "Server message that must not be shown" } }, status);
}

// Routes are "METHOD path" keys; values are a Response factory or a function of the request.
function installFetch() {
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input), window.location.origin);
    const method = init.method || "GET";
    const key = `${method} ${url.pathname}`;
    const handler = routes[key];

    if (handler) return handler({ url, init });

    if (url.pathname === "/v1/workspaces")
      return respond({ workspaces: [{ id: "ws_a", name: "Workspace A", role: "owner", created_at: "2026-01-01T00:00:00Z" }] });

    if (url.pathname === "/v1/invitations") return respond({ invitations: [] });

    if (url.pathname === "/v1/templates") return respond({ templates: [] });

    if (url.pathname.includes("/jobs")) return respond({ jobs: [], next_cursor: null });

    return respond({});
  });
}

function renderAt(path, configuration = DEFAULT_RUNTIME_CONFIGURATION) {
  window.history.replaceState({}, "", path);

  return render(
    <App
      configuration={configuration}
      createAuthClient={createFakeAuthClient("plain")}
      createDelegatedAuthClient={createFakeAuthClient("delegated")}
      notifications={toast}
      navigateTo={navigateTo}
    />,
  );
}

function requestsTo(method, pathname) {
  return globalThis.fetch.mock.calls.filter(([input, init = {}]) => {
    const url = new URL(String(input), window.location.origin);

    return (init.method || "GET") === method && url.pathname === pathname;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routes = {};
  toast = { success: vi.fn(), error: vi.fn() };
  navigateTo = vi.fn();
  sessionStore.value = session();
  sessionStore.listeners.clear();
  authCalls.signInEmail.mockResolvedValue({ data: {}, error: null });
  authCalls.signUpEmail.mockResolvedValue({ data: {}, error: null });
  authCalls.signInSocial.mockResolvedValue({ data: {}, error: null });
  authCalls.signOut.mockResolvedValue({ data: {}, error: null });
  installFetch();
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("MCP connect: sign-in continuation", () => {
  it("signs in through the delegated client and returns to the same signed request", async () => {
    sessionStore.value = null;
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Strong1!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authCalls.signInEmail).toHaveBeenCalled());
    const [kind, body] = authCalls.signInEmail.mock.calls[0];
    expect(kind).toBe("delegated");
    expect(body.callbackURL).toBe(`${window.location.origin}/mcp/connect?${SIGNED_QUERY}`);
    // Signed out, nothing about the request is loaded and no Workspace is resolved.
    expect(requestsTo("GET", "/v1/mcp/consent")).toHaveLength(0);
    expect(requestsTo("GET", "/v1/workspaces")).toHaveLength(0);
  });

  it("keeps the signed request through sign-up verification and Google", async () => {
    sessionStore.value = null;
    const user = userEvent.setup();

    const configuration = {
      ...DEFAULT_RUNTIME_CONFIGURATION,
      auth: { ...DEFAULT_RUNTIME_CONFIGURATION.auth, googleEnabled: true, signupEnabled: true },
    };

    const { unmount } = renderAt(`/mcp/connect?${SIGNED_QUERY}`, configuration);

    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(authCalls.signInSocial).toHaveBeenCalled());
    expect(authCalls.signInSocial.mock.calls[0]).toEqual([
      "delegated",
      { provider: "google", callbackURL: `${window.location.origin}/mcp/connect?${SIGNED_QUERY}` },
    ]);
    // Google sign-in leaves the page; start again for sign-up.
    unmount();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`, configuration);

    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Strong1!");
    await user.type(screen.getByLabelText("Confirm password"), "Strong1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(authCalls.signUpEmail).toHaveBeenCalled());
    expect(authCalls.signUpEmail.mock.calls[0][1].callbackURL).toBe(`${window.location.origin}/mcp/connect?${SIGNED_QUERY}`);
  });

  it("returns to the sign-in form when the request needs a fresh sign-in", async () => {
    routes["GET /v1/mcp/consent"] = () => respond({ ...CONSENT, login_required: true });
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow access" })).toBeNull();
  });
});

describe("MCP connect: consent", () => {
  it("sends the signed query unchanged, requires a workspace and grants only the chosen access", async () => {
    routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
    routes["POST /v1/mcp/consent"] = () => respond({ redirect_uri: "https://claude.ai/callback?code=abc&state=xyz" });
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    expect(await screen.findByRole("heading", { name: "Connect Claude" })).toBeTruthy();
    expect(requestsTo("GET", "/v1/mcp/consent")[0][0]).toContain(`oauth_query=${encodeURIComponent(SIGNED_QUERY)}`);
    // Consent is account-level: it never resolves or selects a Workspace.
    expect(requestsTo("GET", "/v1/workspaces")).toHaveLength(0);

    const workspace = screen.getByLabelText("Workspace");
    expect(workspace.value).toBe("");
    expect(screen.getByRole("checkbox", { name: /Workspace context/ }).disabled).toBe(true);
    expect(screen.getByRole("checkbox", { name: /Read documents/ }).checked).toBe(true);
    // Continued access after sign-out is opt-in and says so.
    const offline = screen.getByRole("checkbox", { name: /Stay connected/ });
    expect(offline.checked).toBe(false);
    expect(document.getElementById(offline.getAttribute("aria-describedby")).textContent).toBe("Keep access after you sign out.");

    await user.click(screen.getByRole("button", { name: "Allow access" }));
    expect(await screen.findByText("Choose a workspace.")).toBeTruthy();
    expect(document.activeElement).toBe(workspace);
    expect(requestsTo("POST", "/v1/mcp/consent")).toHaveLength(0);

    await user.selectOptions(workspace, "ws_b");
    await user.click(screen.getByRole("checkbox", { name: /Read documents/ }));
    await user.click(screen.getByRole("button", { name: "Allow access" }));

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("https://claude.ai/callback?code=abc&state=xyz"));
    expect(JSON.parse(requestsTo("POST", "/v1/mcp/consent")[0][1].body)).toEqual({
      oauth_query: SIGNED_QUERY,
      accept: true,
      workspace_id: "ws_b",
      scopes: ["workspace:read"],
    });
  });

  it("denies without creating a grant and follows the client's error redirect", async () => {
    routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
    routes["POST /v1/mcp/consent"] = () => respond({ redirect_uri: "https://claude.ai/callback?error=access_denied" });
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("https://claude.ai/callback?error=access_denied"));
    expect(JSON.parse(requestsTo("POST", "/v1/mcp/consent")[0][1].body)).toEqual({ oauth_query: SIGNED_QUERY, accept: false });
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", `${window.location.origin}/workspaces/ws_a`, "http://evil.example/cb"])(
    "refuses an unsafe redirect %s",
    async (redirect) => {
      routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
      routes["POST /v1/mcp/consent"] = () => respond({ redirect_uri: redirect });
      const user = userEvent.setup();
      renderAt(`/mcp/connect?${SIGNED_QUERY}&returnTo=${encodeURIComponent("https://evil.example")}`);

      await user.click(await screen.findByRole("button", { name: "Deny" }));

      expect(await screen.findByRole("heading", { name: "Request not valid" })).toBeTruthy();
      expect(navigateTo).not.toHaveBeenCalled();
    },
  );

  it("shows an expired request as a dead end, not a retry loop", async () => {
    routes["GET /v1/mcp/consent"] = () => failure("mcp_authorization_expired", 400);
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    expect(await screen.findByRole("heading", { name: "Request expired" })).toBeTruthy();
    expect(screen.getByText("Go back to your app and connect again.")).toBeTruthy();
    expect(screen.queryByText(/Server message/)).toBeNull();
  });

  it("switches to the expired state when the request expires before the decision", async () => {
    routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
    routes["POST /v1/mcp/consent"] = () => failure("mcp_authorization_expired", 400);
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.selectOptions(await screen.findByLabelText("Workspace"), "ws_a");
    await user.click(screen.getByRole("button", { name: "Allow access" }));

    expect(await screen.findByRole("heading", { name: "Request expired" })).toBeTruthy();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("offers a retry when the request couldn't load", async () => {
    let attempts = 0;
    routes["GET /v1/mcp/consent"] = () => (attempts++ === 0 ? failure("internal", 500) : respond(CONSENT));
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Connect Claude" })).toBeTruthy();
  });

  it("blocks granting from an impersonated session but still allows denial", async () => {
    sessionStore.value = session("user_1", "session_1", { impersonatedBy: "admin_1" });
    routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.selectOptions(await screen.findByLabelText("Workspace"), "ws_a");

    expect(screen.getByText("You're impersonating this user")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow access" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).disabled).toBe(false);
  });

  it("drops a decision that finishes after the account changed", async () => {
    let finish;
    routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
    routes["POST /v1/mcp/consent"] = () => new Promise((resolve) => (finish = resolve));
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.selectOptions(await screen.findByLabelText("Workspace"), "ws_a");
    await user.click(screen.getByRole("button", { name: "Allow access" }));
    await waitFor(() => expect(requestsTo("POST", "/v1/mcp/consent")).toHaveLength(1));

    act(() => sessionStore.set(session("user_2", "session_2")));
    await waitFor(() => expect(requestsTo("GET", "/v1/mcp/consent")).toHaveLength(2));
    await act(async () => finish(respond({ redirect_uri: "https://claude.ai/callback?code=stale" })));

    expect(navigateTo).not.toHaveBeenCalled();
    expect(await screen.findByText(/user_2@example.com/)).toBeTruthy();
    expect(screen.getByLabelText("Workspace").value).toBe("");
  });

  it("signs out without sending the signed request", async () => {
    routes["GET /v1/mcp/consent"] = () => respond(CONSENT);
    const user = userEvent.setup();
    renderAt(`/mcp/connect?${SIGNED_QUERY}`);

    await user.click(await screen.findByRole("button", { name: "Use another account" }));

    await waitFor(() => expect(authCalls.signOut).toHaveBeenCalledWith("plain"));
    expect(authCalls.refetch).toHaveBeenCalled();
  });
});

describe("Connected apps", () => {
  const CONNECTIONS = {
    enabled: true,
    mcp_url: "https://studio.example/mcp",
    scopes: CONSENT.scopes,
    connections: [
      {
        id: "grant_1",
        client: CONSENT.client,
        workspace: { id: "ws_a", name: "Workspace A", accessible: true },
        scopes: ["workspace:read", "documents:read"],
        created_at: "2026-10-01T10:00:00.000Z",
        last_used_at: null,
        revoked_at: null,
      },
      {
        id: "grant_2",
        client: { id: "client_2", name: "Cursor", uri: null, provenance: "dynamic" },
        workspace: { id: "ws_gone", name: "Old workspace", accessible: false },
        scopes: ["workspace:read"],
        created_at: "2026-10-02T10:00:00.000Z",
        last_used_at: "2026-10-03T10:00:00.000Z",
        revoked_at: null,
      },
      {
        id: "grant_3",
        client: { id: "client_3", name: "Revoked app", uri: null, provenance: "registered" },
        workspace: { id: "ws_a", name: "Workspace A", accessible: true },
        scopes: [],
        created_at: "2026-10-02T10:00:00.000Z",
        last_used_at: null,
        revoked_at: "2026-10-04T10:00:00.000Z",
      },
    ],
  };

  it("opens from the profile menu without leaving the session", async () => {
    routes["GET /v1/mcp/connections"] = () => respond(CONNECTIONS);
    const user = userEvent.setup();
    renderAt("/workspaces/ws_a");

    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Settings" })).getByRole("link", { name: "Manage connected apps" }));

    expect(window.location.pathname).toBe("/connected-apps");
    expect(await screen.findByRole("heading", { level: 1, name: "Connected apps" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });

  it("lists active connections with identity, workspace access and capabilities", async () => {
    routes["GET /v1/mcp/connections"] = () => respond(CONNECTIONS);
    renderAt("/connected-apps");

    const table = await screen.findByRole("table", { name: "Connected apps" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Claude")).toBeTruthy();
    expect(within(rows[1]).getByText("claude.ai")).toBeTruthy();
    expect(within(rows[1]).getByText("Read documents")).toBeTruthy();
    expect(within(rows[1]).getByText("Never")).toBeTruthy();
    expect(within(rows[2]).getByText("Unverified app")).toBeTruthy();
    expect(within(rows[2]).getByText("No access")).toBeTruthy();
    expect(screen.queryByText("Revoked app")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Connection address" }).value).toBe("https://studio.example/mcp");
    // The page stays where it is: no redirect into a Workspace.
    expect(window.location.pathname).toBe("/connected-apps");
  });

  it("disconnects one app after confirmation and reloads the list", async () => {
    let listed = 0;
    routes["GET /v1/mcp/connections"] = () =>
      respond(listed++ === 0 ? CONNECTIONS : { ...CONNECTIONS, connections: CONNECTIONS.connections.slice(1) });
    routes["DELETE /v1/mcp/connections/grant_1"] = () => respond({ ok: true });
    const user = userEvent.setup();
    renderAt("/connected-apps");

    await user.click(await screen.findByRole("button", { name: "Disconnect Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Disconnect "Claude"?')).toBeTruthy();
    expect(within(dialog).getByText(/Documents it already submitted keep processing/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Disconnect app" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("App disconnected: Claude", expect.anything()));
    await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
    expect(requestsTo("DELETE", "/v1/mcp/connections/grant_1")).toHaveLength(1);
    expect(screen.getByText("Cursor")).toBeTruthy();
    expect(authCalls.signOut).not.toHaveBeenCalled();
  });

  it("treats an already disconnected app as disconnected", async () => {
    routes["GET /v1/mcp/connections"] = () => respond(CONNECTIONS);
    routes["DELETE /v1/mcp/connections/grant_1"] = () => failure("mcp_connection_not_found", 404);
    const user = userEvent.setup();
    renderAt("/connected-apps");

    await user.click(await screen.findByRole("button", { name: "Disconnect Claude" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Disconnect app" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("App disconnected: Claude", expect.anything()));
  });

  it("keeps a failed disconnect inside the dialog", async () => {
    routes["GET /v1/mcp/connections"] = () => respond(CONNECTIONS);
    routes["DELETE /v1/mcp/connections/grant_1"] = () => failure("internal", 500);
    const user = userEvent.setup();
    renderAt("/connected-apps");

    await user.click(await screen.findByRole("button", { name: "Disconnect Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect app" }));

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps existing connections revocable but hides the address when the installation turns them off", async () => {
    routes["GET /v1/mcp/connections"] = () => respond({ ...CONNECTIONS, enabled: false });
    renderAt("/connected-apps");

    expect(await screen.findByText(/Connected apps are turned off for this installation/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect Claude" })).toBeTruthy();
    expect(screen.queryByLabelText("Connection address")).toBeNull();
  });

  it("explains an empty list without suggesting a new connection when turned off", async () => {
    routes["GET /v1/mcp/connections"] = () => respond({ ...CONNECTIONS, enabled: false, connections: [] });
    renderAt("/connected-apps");

    expect(await screen.findByText("No apps are connected.")).toBeTruthy();
    expect(screen.queryByText(/Add the connection address/)).toBeNull();
  });

  it("shows a load failure with a retry instead of an empty list", async () => {
    let attempts = 0;
    routes["GET /v1/mcp/connections"] = () => (attempts++ === 0 ? failure("internal", 500) : respond(CONNECTIONS));
    const user = userEvent.setup();
    renderAt("/connected-apps");

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Claude")).toBeTruthy();
    expect(screen.queryByText(/No apps are connected/)).toBeNull();
  });
});

describe("Approval requests", () => {
  const APPROVAL = {
    id: "ap_1",
    client: CONSENT.client,
    workspace: { id: "ws_a", name: "Workspace A" },
    action: "workspace.api_key.rotate",
    title: "Rotate API key",
    description: "Apps using the current key stop working.",
    targets: [{ id: "ws_a", label: "Workspace A" }],
    parameters: { reason: "scheduled", api_key: "should-not-show" },
    expires_at: "2099-01-01T00:00:00.000Z",
    status: "pending",
  };

  it("shows the exact action and approves it once, revealing a rotated key only here", async () => {
    routes["GET /v1/mcp/approvals/ap_1"] = () => respond(APPROVAL);
    routes["POST /v1/mcp/approvals/ap_1"] = () =>
      respond({ ...APPROVAL, status: "completed", result: { api_key: "wk_new_secret" } });
    const user = userEvent.setup();
    renderAt("/mcp/approvals/ap_1");

    expect(await screen.findByRole("heading", { name: "Rotate API key" })).toBeTruthy();
    expect(screen.getByText("Apps using the current key stop working.")).toBeTruthy();
    expect(screen.getByText("scheduled")).toBeTruthy();
    expect(screen.queryByText("should-not-show")).toBeNull();
    expect(requestsTo("GET", "/v1/workspaces")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByLabelText("New workspace API key")).toHaveProperty("value", "wk_new_secret");
    expect(screen.getByText("This key won't be shown again. Copy it now.")).toBeTruthy();
    expect(JSON.parse(requestsTo("POST", "/v1/mcp/approvals/ap_1")[0][1].body)).toEqual({ decision: "approve" });
    expect(toast.success).toHaveBeenCalledWith("Action approved: Rotate API key", expect.anything());
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("denies a request", async () => {
    routes["GET /v1/mcp/approvals/ap_1"] = () => respond(APPROVAL);
    routes["POST /v1/mcp/approvals/ap_1"] = () => respond({ ...APPROVAL, status: "denied" });
    const user = userEvent.setup();
    renderAt("/mcp/approvals/ap_1");

    await user.click(await screen.findByRole("button", { name: "Deny" }));

    expect(await screen.findByText("You denied this action. Nothing changed.")).toBeTruthy();
    expect(JSON.parse(requestsTo("POST", "/v1/mcp/approvals/ap_1")[0][1].body)).toEqual({ decision: "deny" });
  });

  it("asks for a secret in the app when the action needs one", async () => {
    routes["GET /v1/mcp/approvals/ap_1"] = () =>
      respond({ ...APPROVAL, title: "Change Model gateway", requires_secret: { field: "api_key", label: "Gateway API key" } });
    routes["POST /v1/mcp/approvals/ap_1"] = () => respond({ ...APPROVAL, status: "completed" });
    const user = userEvent.setup();
    renderAt("/mcp/approvals/ap_1");

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Enter the Gateway API key.")).toBeTruthy();
    expect(requestsTo("POST", "/v1/mcp/approvals/ap_1")).toHaveLength(0);

    await user.type(screen.getByLabelText("Gateway API key"), "sk-local");
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(requestsTo("POST", "/v1/mcp/approvals/ap_1")).toHaveLength(1));
    expect(JSON.parse(requestsTo("POST", "/v1/mcp/approvals/ap_1")[0][1].body)).toEqual({ decision: "approve", secret: "sk-local" });
  });

  it("reloads a request that changed since it was shown", async () => {
    let loads = 0;
    routes["GET /v1/mcp/approvals/ap_1"] = () => respond(loads++ === 0 ? APPROVAL : { ...APPROVAL, status: "expired" });
    routes["POST /v1/mcp/approvals/ap_1"] = () => failure("mcp_approval_stale", 409);
    const user = userEvent.setup();
    renderAt("/mcp/approvals/ap_1");

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/This request expired before it was approved/)).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't approve the action."), expect.anything());
  });

  it("blocks approval from an impersonated session", async () => {
    sessionStore.value = session("user_1", "session_1", { impersonatedBy: "admin_1" });
    routes["GET /v1/mcp/approvals/ap_1"] = () => respond(APPROVAL);
    renderAt("/mcp/approvals/ap_1");

    expect((await screen.findByRole("button", { name: "Approve" })).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).disabled).toBe(false);
  });

  it("explains a request that belongs to someone else or no longer exists", async () => {
    routes["GET /v1/mcp/approvals/ap_1"] = () => failure("mcp_approval_not_found", 404);
    renderAt("/mcp/approvals/ap_1");

    expect(await screen.findByRole("heading", { name: "Request unavailable" })).toBeTruthy();
  });

  it("asks a signed-out visitor to sign in and returns to the approval", async () => {
    sessionStore.value = null;
    const user = userEvent.setup();
    renderAt("/mcp/approvals/ap_1");

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Strong1!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authCalls.signInEmail).toHaveBeenCalled());
    expect(authCalls.signInEmail.mock.calls[0][0]).toBe("plain");
    expect(authCalls.signInEmail.mock.calls[0][1].callbackURL).toBe(`${window.location.origin}/mcp/approvals/ap_1`);
  });
});

describe("Upload links", () => {
  const UPLOAD = {
    id: "up_1",
    client: CONSENT.client,
    workspace: { id: "ws_a", name: "Workspace A" },
    expires_at: "2099-01-01T00:00:00.000Z",
    status: "pending",
    max_source_file_bytes: 1024,
  };

  function fileInput() {
    return screen.getByLabelText("Choose a document");
  }

  it("rejects an unsupported or oversized file before uploading", async () => {
    routes["GET /v1/mcp/uploads/up_1"] = () => respond(UPLOAD);
    const user = userEvent.setup({ applyAccept: false });
    renderAt("/mcp/uploads/up_1");

    await screen.findByRole("heading", { name: "Upload a document" });
    await user.upload(fileInput(), new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText("notes.txt isn't a PDF, PNG, JPG or WEBP file.")).toBeTruthy();

    await user.upload(fileInput(), new File([new Uint8Array(2048)], "big.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/big.pdf is larger than/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Choose a file to upload.")).toBeTruthy();
    expect(requestsTo("POST", "/v1/mcp/uploads/up_1")).toHaveLength(0);
  });

  it("uploads one document as multipart and shows the next step", async () => {
    routes["GET /v1/mcp/uploads/up_1"] = () => respond(UPLOAD);
    routes["POST /v1/mcp/uploads/up_1"] = () => respond({ id: "up_1", status: "uploaded", source_ref: "src_1" });
    const user = userEvent.setup();
    renderAt("/mcp/uploads/up_1");

    await screen.findByRole("heading", { name: "Upload a document" });
    const file = new File(["%PDF"], "invoice.pdf", { type: "application/pdf" });
    await user.upload(fileInput(), file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/Return to Claude to continue/)).toBeTruthy();
    const body = requestsTo("POST", "/v1/mcp/uploads/up_1")[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file").name).toBe("invoice.pdf");
    expect(toast.success).toHaveBeenCalledWith("Document uploaded: invoice.pdf", expect.anything());
    expect(screen.queryByText("src_1")).toBeNull();
  });

  it("shows why a link closed while the file was being chosen", async () => {
    let loads = 0;
    routes["GET /v1/mcp/uploads/up_1"] = () => respond(loads++ === 0 ? UPLOAD : { ...UPLOAD, status: "expired" });
    routes["POST /v1/mcp/uploads/up_1"] = () => failure("mcp_upload_expired", 410);
    const user = userEvent.setup();
    renderAt("/mcp/uploads/up_1");

    await screen.findByRole("heading", { name: "Upload a document" });
    await user.upload(fileInput(), new File(["%PDF"], "invoice.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("This upload link has expired. Ask Claude for a new one.")).toBeTruthy();
  });

  it("shows an expired link that the server refuses to load", async () => {
    let loads = 0;
    routes["GET /v1/mcp/uploads/up_1"] = () => (loads++ === 0 ? respond(UPLOAD) : failure("mcp_upload_expired", 410));
    routes["POST /v1/mcp/uploads/up_1"] = () => failure("mcp_upload_expired", 410);
    const user = userEvent.setup();
    renderAt("/mcp/uploads/up_1");

    await screen.findByRole("heading", { name: "Upload a document" });
    await user.upload(fileInput(), new File(["%PDF"], "invoice.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByRole("heading", { name: "Upload link expired" })).toBeTruthy();
    expect(screen.getByText("This upload link has expired. Ask the app for a new one.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("explains a link for a disconnected app", async () => {
    routes["GET /v1/mcp/uploads/up_1"] = () => failure("mcp_connection_revoked", 403);
    renderAt("/mcp/uploads/up_1");

    expect(await screen.findByRole("heading", { name: "Upload link unavailable" })).toBeTruthy();
  });
});
