import React, { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App.jsx";
import { DEFAULT_RUNTIME_CONFIGURATION } from "./lib/runtimeConfiguration";

const auth = {
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signUpEmail: vi.fn(),
  signOut: vi.fn(),
  refetch: vi.fn(),
};

const toastMock = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), dismiss: vi.fn() };

// useSession reads a store, so a test can start or end the session the way the server would.
const sessionStore = { session: null, listeners: new Set() };

function setSession(session) {
  sessionStore.session = session;

  for (const listener of sessionStore.listeners) listener();
}

const createAuthClient = () => ({
  useSession: () => ({
    data: useSyncExternalStore(
      (listener) => {
        sessionStore.listeners.add(listener);

        return () => sessionStore.listeners.delete(listener);
      },
      () => sessionStore.session,
    ),
    isPending: false,
    refetch: auth.refetch,
  }),
  signIn: { email: auth.signInEmail, social: auth.signInSocial },
  signUp: { email: auth.signUpEmail },
  signOut: auth.signOut,
});

const configuration = {
  ...DEFAULT_RUNTIME_CONFIGURATION,
  auth: { ...DEFAULT_RUNTIME_CONFIGURATION.auth, googleEnabled: true, requireEmailVerification: true, mailDelivery: "cloudflare" },
};

const ADA = { user: { id: "user_ada", name: "Ada Lovelace", email: "ada@example.com" }, session: { id: "s_ada" } };

const INVITATION_PATH = "/invitations/inv_1";

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The signed-in user's workspaces and own pending invitations; everything else is empty.
function routeWorkspaces({ workspaces, invitations = [], canCreateWorkspaces = true }) {
  globalThis.fetch = vi.fn(async (input) => {
    const path = new URL(String(input), window.location.origin).pathname;

    if (path === "/v1/workspaces") return response({ workspaces, can_create_workspaces: canCreateWorkspaces });

    if (path === "/v1/invitations") return response({ invitations });

    return response({ invitations: [], users: [], templates: [], jobs: [], models: [], packets: [], tags: [] });
  });
}

function open(path, options = {}) {
  window.history.replaceState(null, "", path);

  return render(
    <App createAuthClient={createAuthClient} notifications={toastMock} configuration={options.configuration || configuration} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.session = null;
  vi.stubGlobal("WebSocket", undefined);
  globalThis.fetch = vi.fn(() => new Promise(() => {}));
});

describe("opening an invite link while signed out", () => {
  it("opens the sign-in the emailed link asks for, with the invited address filled in", () => {
    open(`${INVITATION_PATH}?email=grace%40example.com&auth=signin`);

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email").value).toBe("grace@example.com");
    expect(screen.getByText("You're invited to a workspace")).toBeTruthy();
    expect(screen.getByText("Sign in with grace@example.com to accept it.")).toBeTruthy();
  });

  it("opens sign-up when the link doesn't say whether the address has an account", () => {
    open(`${INVITATION_PATH}?email=grace%40example.com`);

    expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();
    expect(screen.getByLabelText("Email").value).toBe("grace@example.com");
    expect(screen.getByText("Create an account with grace@example.com to accept it.")).toBeTruthy();
  });

  it("opens sign-in when only an identity provider is available", () => {
    open(`${INVITATION_PATH}?email=grace%40example.com&auth=signup`, {
      configuration: { ...configuration, auth: { ...configuration.auth, emailPasswordEnabled: false } },
    });

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
    expect(screen.getByText("Sign in with the Google account for grace@example.com to accept it.")).toBeTruthy();
  });

  it("returns sign-in and its verification link to the invitation", async () => {
    const user = userEvent.setup();
    auth.signInEmail.mockResolvedValue({ error: null });
    open(`${INVITATION_PATH}?email=grace%40example.com&auth=signin`);

    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(auth.signInEmail).toHaveBeenCalledWith({
      email: "grace@example.com",
      password: "Password1!",
      callbackURL: `${window.location.origin}${INVITATION_PATH}?email=grace%40example.com`,
    });
    expect(window.location.pathname).toBe(INVITATION_PATH);
  });

  it("returns Google sign-in to the invitation", async () => {
    auth.signInSocial.mockResolvedValue({ error: null });
    open(`${INVITATION_PATH}?email=grace%40example.com&auth=signin`);

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    const continuation = `${window.location.origin}${INVITATION_PATH}?email=grace%40example.com`;
    expect(auth.signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: continuation, errorCallbackURL: continuation }),
    );
  });

  it("ends sign-up on checking email, with the verification link returning to the invitation", async () => {
    const user = userEvent.setup();
    auth.signUpEmail.mockResolvedValue({ data: { user: { email: "grace@example.com" } } });
    open(`${INVITATION_PATH}?email=grace%40example.com&auth=signup`);

    await user.type(screen.getByLabelText("Name"), "Grace Hopper");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(auth.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "grace@example.com",
        callbackURL: `${window.location.origin}${INVITATION_PATH}?email=grace%40example.com`,
      }),
    );
    expect(await screen.findByText("Check your email")).toBeTruthy();
    expect(
      screen.getByText("Open the verification link we sent to grace@example.com. It brings you back to your invitation."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email").value).toBe("grace@example.com");
    expect(window.location.pathname + window.location.search).toBe(
      `${INVITATION_PATH}?email=grace%40example.com&auth=signup`,
    );

    // Signing up again for another address starts over.
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.queryByText("Check your email")).toBeNull();
  });

  it("names the local mail command for verification when email isn't delivered", async () => {
    const user = userEvent.setup();
    auth.signUpEmail.mockResolvedValue({ data: { user: { email: "grace@example.com" } } });
    open(`${INVITATION_PATH}?email=grace%40example.com`, {
      configuration: { ...configuration, auth: { ...configuration.auth, mailDelivery: "local" } },
    });

    await user.type(screen.getByLabelText("Name"), "Grace Hopper");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        "Run `document-extraction mail` to open the verification link for grace@example.com. It brings you back to your invitation.",
      ),
    ).toBeTruthy();
  });

  it("shows no invitation context on other pages", () => {
    open("/");

    expect(screen.queryByText("You're invited to a workspace")).toBeNull();
    expect(screen.getByLabelText("Email").value).toBe("");
  });
});

describe("opening an invite link while signed in", () => {
  const invited = { id: "ws_invited", name: "Clinical Workspace", role: "member" };

  it("opens the workspace an invitation joined when it was accepted at first sign-in", async () => {
    sessionStore.session = ADA;
    routeWorkspaces({ workspaces: [invited], canCreateWorkspaces: false });

    open(`${INVITATION_PATH}?email=ada%40example.com`);

    await waitFor(() => expect(window.location.pathname).toBe("/workspaces/ws_invited"));
    expect(await screen.findByRole("heading", { name: "Workspace details" })).toBeTruthy();
    expect(screen.queryByText(/unavailable/)).toBeNull();
  });

  it("says an invitation is no longer available when it can't have been accepted at sign-in", async () => {
    sessionStore.session = ADA;
    routeWorkspaces({ workspaces: [{ id: "ws_own", name: "Own Workspace", role: "owner" }] });

    open(`${INVITATION_PATH}?email=ada%40example.com`);

    expect(await screen.findByRole("heading", { name: "Invitation unavailable" })).toBeTruthy();
    expect(screen.getByText("This invitation has expired, was cancelled or was already used. Ask whoever invited you to send it again.")).toBeTruthy();
    expect(window.location.pathname).toBe(INVITATION_PATH);
  });

  it("explains an invitation for another address and signs out back to it", async () => {
    const user = userEvent.setup();
    sessionStore.session = ADA;
    routeWorkspaces({ workspaces: [invited], canCreateWorkspaces: false });
    auth.signOut.mockImplementation(async () => setSession(null));

    open(`${INVITATION_PATH}?email=grace%40example.com&auth=signin`);

    expect(await screen.findByRole("heading", { name: "Invitation for another email" })).toBeTruthy();
    expect(
      screen.getByText(
        "This invitation was sent to grace@example.com, but you're signed in as ada@example.com. Sign out, then use grace@example.com to accept it.",
      ),
    ).toBeTruthy();
    expect(window.location.pathname).toBe(INVITATION_PATH);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email").value).toBe("grace@example.com");
    expect(screen.getByText("Sign in with grace@example.com to accept it.")).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe(
      `${INVITATION_PATH}?email=grace%40example.com&auth=signin`,
    );
  });

  it("shows a pending invitation for the signed-in address", async () => {
    sessionStore.session = ADA;
    routeWorkspaces({
      workspaces: [{ id: "ws_own", name: "Own Workspace", role: "owner" }],
      invitations: [
        {
          id: "inv_1",
          workspace_id: "ws_invited",
          workspace_name: "Clinical Workspace",
          email: "ada@example.com",
          role: "member",
          status: "pending",
          inviter_display: "Grace Hopper",
          created_at: "2026-01-01T00:00:00.000Z",
          expires_at: "2026-01-08T00:00:00.000Z",
        },
      ],
    });

    open(`${INVITATION_PATH}?email=ADA%40example.com`);

    expect(await screen.findByRole("heading", { name: "Pending invitation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
  });
});
