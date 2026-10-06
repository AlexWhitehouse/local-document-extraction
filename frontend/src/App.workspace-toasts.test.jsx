import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const authClientMock = {
  refetchSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
};

const toastMock = {
  error: vi.fn(),
  success: vi.fn(),
};

const createAuthClient = () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
    },
    isPending: false,
    refetch: authClientMock.refetchSession,
  }),
  signIn: {
    email: vi.fn(),
    social: vi.fn(),
  },
  signUp: {
    email: vi.fn(),
  },
  signOut: authClientMock.signOut,
  updateUser: authClientMock.updateUser,
});

import { App } from "./App.jsx";
import { COMPLETED_DOCUMENT_CACHE_STORAGE_KEY } from "./lib/completedDocumentCache";

describe("Workspace action toast feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage({ workspaceId: "ws_1", workspaceName: "Research Workspace" });
    globalThis.fetch = vi.fn(mockWorkspaceFetch);
  });

  it("stores only accepted Workspace ID and display name in Stored workspace preference", async () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiBase: "/v1",
      authName: "Ada Lovelace",
      authEmail: "ada@example.com",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: { ws_1: "imgx_live_existing_key" },
      templates: [{ id: "tpl_1", name: "Prescription Template" }],
      extractTemplateId: "tpl_1",
      lastJobId: "job_1",
      jobHistory: [failedDocument({ job_id: "job_1" })],
      selectedDocumentId: "job_1",
      userWorkspaces: [{ id: "ws_1", name: "Research Workspace", role: "owner" }],
      userWorkspaceInvitations: [],
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Research Workspace/ })).toBeTruthy();
    });

    expect(lastStoredWorkspacePreference()).toEqual({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
    });
  });

  it("shows Loading workspace context without stored Workspace details while startup resolution is pending", async () => {
    installLocalStorage({ workspaceId: "ws_stored", workspaceName: "Stored Workspace" });
    routeFetch((url) => {
      if (url.endsWith("/workspaces") || url.endsWith("/invitations")) {
        return new Promise(() => {});
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    expect(screen.getByRole("heading", { name: "Loading workspace context" })).toBeTruthy();
    expect(screen.queryByText(/Stored Workspace/)).toBeNull();
    expect(screen.getByRole("button", { name: "Generate API key" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "+ Invite user" }).disabled).toBe(true);
  });

  it("shows a retryable Workspace resolution error when backend workspace listing fails", async () => {
    installLocalStorage({ workspaceId: "ws_stored", workspaceName: "Stored Workspace" });
    routeFetch((url) => {
      if (url.endsWith("/workspaces")) {
        return jsonResponse({ error: "unavailable" }, { status: 500 });
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    expect(await screen.findByRole("heading", { name: "Workspace resolution error" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/Stored Workspace/)).toBeNull();
    expect(screen.getByRole("button", { name: "Generate API key" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "+ Invite user" }).disabled).toBe(true);
  });

  it("refreshes Workspaces and keeps an explicit inaccessible Workspace on a recovery screen", async () => {
    installLocalStorage({ workspaceId: "ws_removed", workspaceName: "Removed Workspace" });
    let workspaceListCalls = 0;
    routeFetch((url, method, options) => {
      if (url.endsWith("/workspaces")) {
        workspaceListCalls += 1;

        return workspaceList(
          workspaceListCalls === 1
            ? workspace({ id: "ws_removed", name: "Removed Workspace" })
            : workspace({ id: "ws_remaining", name: "Remaining Workspace" }),
        );
      }

      if (
        url.endsWith("/templates") &&
        method === "GET" &&
        new Headers(options.headers).get("x-workspace-id") === "ws_removed"
      ) {
        return jsonResponse({ error: "forbidden" }, { status: 403 });
      }
    });

    // Flush the immediate mocked startup and 403 recovery responses before the
    // expensive accessibility query, which can exhaust waitFor on slower CI.
    await act(async () => {
      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
    });

    expect(screen.getByRole("link", { name: /Remaining Workspace/ })).toBeTruthy();
    expect(screen.getByText(/Workspace or invitation is unavailable/)).toBeTruthy();
    expect(window.location.pathname).toBe("/workspaces/ws_removed");
    expect(toastMock.success).not.toHaveBeenCalledWith("Workspace access changed. Switched to Remaining Workspace.");
  });

  it("revalidates a second browser's explicit Workspace route after a live access invalidation", async () => {
    const sockets = [];

    class WebSocketStub {
      close = vi.fn();
      onclose = null;
      onerror = null;
      onmessage = null;
      onopen = null;

      constructor(url) {
        this.url = url;
        sockets.push(this);
      }
    }

    globalThis.WebSocket = WebSocketStub;
    let workspaceListCalls = 0;
    routeFetch((url, method) => {
      if (url.endsWith("/workspaces") && method === "GET") {
        workspaceListCalls += 1;

        return workspaceList(
          workspaceListCalls === 1 ? workspace() : workspace({ id: "ws_2", name: "Remaining Workspace" }),
        );
      }
    });

    window.history.replaceState(null, "", "/workspaces/ws_1");
    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    await act(async () => {
      sockets[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "workspace_context_invalidated",
              reason: "workspace_access",
              occurred_at: "2026-07-10T12:00:00.000Z",
            },
          ],
        }),
      });
      await Promise.resolve();
    });

    expect(await screen.findByRole("link", { name: /Remaining Workspace/ })).toBeTruthy();
    expect(screen.getByText(/Workspace or invitation is unavailable/)).toBeTruthy();
    expect(window.location.pathname).toBe("/workspaces/ws_1");
    expect(toastMock.success).not.toHaveBeenCalledWith("Workspace access changed. Switched to Remaining Workspace.");
  });

  it("generates a one-time visible Workspace API key for owners without persisting the secret", async () => {
    const user = userEvent.setup();
    const generatedKey = "generated-secret-key";
    const writeText = installClipboard();
    const confirmSpy = vi.spyOn(window, "confirm");
    routeApiKeyGeneration({ hasApiKey: false, apiKey: generatedKey });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(await screen.findByRole("button", { name: "Generate API key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace API key generated and copied");
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(generatedKey);
    expect(screen.getByDisplayValue(generatedKey)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss API key" })).toBeNull();
    expect(lastStoredWorkspacePreference()).toEqual({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
    });
    expect(toastMock.success).not.toHaveBeenCalledWith(expect.stringContaining(generatedKey));
    expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringContaining(generatedKey));
  });

  it("confirms and rotates an existing Workspace API key for owners", async () => {
    const user = userEvent.setup();
    const rotatedKey = "rotated-secret-key";
    const writeText = installClipboard();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    routeApiKeyGeneration({ hasApiKey: true, apiKey: rotatedKey });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(await screen.findByRole("button", { name: "Rotate API key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace API key rotated and copied");
    });
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(rotatedKey);
    expect(screen.getByDisplayValue(rotatedKey)).toBeTruthy();
    expect(toastMock.success).not.toHaveBeenCalledWith(expect.stringContaining(rotatedKey));
  });

  it("keeps generated Workspace API key visible when clipboard copy needs manual retry", async () => {
    const user = userEvent.setup();
    const generatedKey = "manual-copy-secret-key";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    routeApiKeyGeneration({ hasApiKey: false, apiKey: generatedKey });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(await screen.findByRole("button", { name: "Generate API key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace API key generated. Copy it before leaving this page.");
    });
    expect(screen.getByDisplayValue(generatedKey)).toBeTruthy();

    const writeText = installClipboard();
    await user.click(screen.getByRole("button", { name: "Copy API key" }));

    expect(writeText).toHaveBeenCalledWith(generatedKey);
  });

  it("shows Workspace API key display to members without an actionable generate control", async () => {
    routeFetch((url) => {
      if (url.endsWith("/workspaces")) return workspaceList(workspace({ role: "member" }));
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    expect(await screen.findByLabelText("Workspace API key")).toBeTruthy();
    expect(screen.getByPlaceholderText("Generate an API key to view")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate API key" }).disabled).toBe(true);
  });

  it("confirms explicit Workspace creation", async () => {
    const user = userEvent.setup();
    let created = false;
    routeFetch((url, method) => {
      if (url.endsWith("/workspaces") && method === "POST") {
        created = true;

        return jsonResponse({
          workspace_id: "ws_2",
          name: "New Workspace",
          api_key: "imgx_live_new_workspace_key",
        });
      }

      if (url.endsWith("/workspaces")) {
        return workspaceList(
          workspace(),
          ...(created
            ? [workspace({ id: "ws_2", name: "New Workspace", created_at: "2026-01-02T00:00:00.000Z" })]
            : []),
        );
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("button", { name: "Create Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace created: New Workspace");
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /New Workspace/ }).className).toContain("active");
    });
  });

  it("confirms Workspace rename while preserving visible Document data", async () => {
    const user = userEvent.setup();
    let renamed = false;
    routeFetch((url, method) => {
      if (url.endsWith("/jobs?group_packets=true") && method === "GET") return jobList(failedDocument());

      if (url.endsWith("/workspaces/ws_1") && method === "PATCH") {
        renamed = true;

        return jsonResponse({ id: "ws_1", name: "Clinical Workspace" });
      }

      if (url.endsWith("/workspaces")) {
        return workspaceList(workspace({ name: renamed ? "Clinical Workspace" : "Research Workspace" }));
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "invoice.pdf" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: /Workspaces/ }));
    await user.clear(screen.getByLabelText("Workspace name"));
    await user.type(screen.getByLabelText("Workspace name"), "Clinical Workspace");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace renamed: Clinical Workspace");
    });
    expect(screen.getByRole("link", { name: "Documents1" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: /Documents/ }));
    expect(screen.getByRole("heading", { name: "invoice.pdf" })).toBeTruthy();
  });

  it("confirms Leave Workspace with replacement personal Workspace wording", async () => {
    const user = userEvent.setup();
    let leaveRequested = false;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    routeFetch((url, method) => {
      if (url.endsWith("/workspaces/ws_1/leave") && method === "POST") {
        leaveRequested = true;

        return jsonResponse({ replacement_workspace: { workspace_id: "ws_personal" } });
      }

      if (url.endsWith("/workspaces")) {
        return workspaceList(
          leaveRequested
            ? workspace({ id: "ws_personal", name: "Personal Workspace", created_at: "2026-01-02T00:00:00.000Z" })
            : workspace({ role: "member" }),
        );
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await screen.findByRole("link", { name: /Research Workspace/ });

    await user.click(screen.getByRole("button", { name: "Leave Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace left. Replacement personal Workspace created.");
    });
  });

  it("confirms Workspace deletion and selects a remaining Workspace", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const remaining = workspace({ id: "ws_2", name: "Remaining Workspace", created_at: "2026-01-02T00:00:00.000Z" });
    let workspaceListCalls = 0;
    routeFetch((url, method) => {
      if (url.endsWith("/workspaces") && method === "GET") {
        workspaceListCalls += 1;

        return workspaceListCalls === 1 ? workspaceList(workspace(), remaining) : workspaceList(remaining);
      }

      if (url.endsWith("/workspaces/ws_1") && method === "DELETE") {
        return jsonResponse({ ok: true, workspace_id: "ws_1" });
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await screen.findByRole("link", { name: /Research Workspace/ });

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace deleted");
    });
    expect(await screen.findByRole("link", { name: /Remaining Workspace/ })).toBeTruthy();
  });

  it("stays quiet when Workspace deletion confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await screen.findByRole("link", { name: /Research Workspace/ });

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    expectNoToasts();
  });

  it("does not toast for background Workspace listing and refresh", async () => {
    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/v1/workspaces", expect.objectContaining({ method: "GET" }));
    });
    expectNoToasts();
  });

  it("uses the signed-in session and accepted Workspace context for product requests", async () => {
    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/v1/templates", expect.objectContaining({ method: "GET" }));
    });

    const templatesRequest = globalThis.fetch.mock.calls.find(
      ([url, options]) => String(url).endsWith("/templates") && options?.method === "GET",
    );

    const headers = templatesRequest?.[1]?.headers;

    expect(headers.get("x-workspace-id")).toBe("ws_1");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("clears visible Document data immediately when switching accepted Workspaces", async () => {
    const user = userEvent.setup();
    const secondWorkspaceJobs = deferred();
    routeFetch((url, method, options) => {
      if (url.endsWith("/workspaces")) return twoWorkspaceList();

      if (url.endsWith("/jobs?group_packets=true") && method === "GET") {
        if (new Headers(options.headers).get("x-workspace-id") === "ws_2") {
          return secondWorkspaceJobs.promise;
        }

        return jobList(failedDocument({ job_id: "job_ws_1", source_name: "research.pdf" }));
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "research.pdf" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: /Workspaces/ }));
    await user.click(screen.getByRole("link", { name: /Clinical Workspace/ }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "research.pdf" })).toBeNull();
      expect(screen.getByRole("link", { name: "Documents0" })).toBeTruthy();
    });

    secondWorkspaceJobs.resolve(jobList(failedDocument({ job_id: "job_ws_2", source_name: "clinical.pdf" })));
    await user.click(screen.getByRole("link", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "clinical.pdf" })).toBeTruthy();
  });

  it("hides Workspace users placeholder while switching accepted Workspaces", async () => {
    const user = userEvent.setup();
    const secondWorkspaceUsers = deferred();
    routeFetch((url, method) => {
      if (url.endsWith("/workspaces")) return twoWorkspaceList();

      if (url.endsWith("/workspaces/ws_1/users") && method === "GET") {
        return jsonResponse({ users: [workspaceMember()] });
      }

      if (url.endsWith("/workspaces/ws_2/users") && method === "GET") {
        return secondWorkspaceUsers.promise;
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    expect(await screen.findByText("Grace Hopper")).toBeTruthy();
    await user.click(await screen.findByRole("link", { name: /Clinical Workspace/ }));

    await waitFor(() => {
      expect(screen.queryByText("Grace Hopper")).toBeNull();
      expect(screen.queryByText("No workspace users found.")).toBeNull();
      expect(screen.queryByText("Loading workspace users…")).toBeNull();
    });

    secondWorkspaceUsers.resolve(
      jsonResponse({
        users: [workspaceMember({ user_id: "user_3", name: "Katherine Johnson", email: "katherine@example.com" })],
      }),
    );

    expect(await screen.findByText("Katherine Johnson")).toBeTruthy();
  });

  it("does not send product requests with a synthetic fallback Workspace ID", async () => {
    installLocalStorage({ apiKey: "imgx_live_legacy_key" });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/v1/workspaces", expect.objectContaining({ method: "GET" }));
    });

    const productRequests = globalThis.fetch.mock.calls.filter(([url]) =>
      ["/v1/templates", "/v1/jobs"].some((path) => String(url).startsWith(path)),
    );

    expect(productRequests).not.toEqual([]);

    for (const [, options] of productRequests) {
      expect(options.headers.get("x-workspace-id")).not.toBe("workspace_local_default");
    }
  });

  describe("Workspace invitations", () => {
    async function inviteTeammate(email) {
      const user = userEvent.setup();
      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
      await user.click(screen.getByRole("button", { name: "+ Invite user" }));

      if (email) await user.type(screen.getByLabelText("Invite email"), email);
      await user.click(screen.getByRole("button", { name: "Invite user" }));
    }

    function routeInvitationCreate(response) {
      routeFetch((url, method) => {
        if (url.endsWith("/workspaces/ws_1/invitations") && method === "POST") return response;
      });
    }

    it("confirms creating a Workspace invitation", async () => {
      routeInvitationCreate(
        jsonResponse({
          invitation_id: "inv_1",
          email: "grace@example.com",
          role: "member",
          status: "pending",
        }),
      );

      await inviteTeammate("grace@example.com");

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith("Successfully invited grace@example.com");
      });
    });

    it("shows a validation toast when creating a Workspace invitation without an email", async () => {
      await inviteTeammate("");

      expect(toastMock.error).toHaveBeenCalledWith("Enter an email address before inviting a teammate.");
      expect(globalThis.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/workspaces/ws_1/invitations"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("shows friendly failure copy when creating a Workspace invitation fails", async () => {
      routeInvitationCreate(jsonResponse({ error: "Database internal detail" }, { status: 500 }));

      await inviteTeammate("grace@example.com");

      await waitFor(() => {
        expect(toastMock.error).toHaveBeenCalledWith("Workspace invitation could not be created. Please try again.");
      });
      expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringContaining("Database"));
    });

    function routeInvitationCancel(response) {
      routeFetch((url, method) => {
        if (url.endsWith("/workspaces/ws_1/invitations") && method === "GET") {
          return jsonResponse({ invitations: [pendingInvitation()] });
        }

        if (url.endsWith("/workspaces/ws_1/invitations/inv_1") && method === "DELETE") return response;
      });
    }

    async function cancelInvitation() {
      const user = userEvent.setup();
      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
      await user.click(await screen.findByRole("button", { name: "Cancel invitation for grace@example.com" }));
    }

    it("confirms cancelling a pending Workspace invitation", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      routeInvitationCancel(jsonResponse({ cancelled: true }));

      await cancelInvitation();

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith("Invitation cancelled for grace@example.com");
      });
    });

    it("stays quiet when cancelling a Workspace invitation confirmation is cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      routeInvitationCancel();

      await cancelInvitation();

      expectNoToasts();
      expect(globalThis.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/workspaces/ws_1/invitations/inv_1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("shows friendly failure copy when cancelling a Workspace invitation fails", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      routeInvitationCancel(jsonResponse({ error: "permission trace" }, { status: 403 }));

      await cancelInvitation();

      await waitFor(() => {
        expect(toastMock.error).toHaveBeenCalledWith("Workspace invitation could not be cancelled. Please try again.");
      });
    });

    it("confirms accepting a Workspace invitation", async () => {
      const user = userEvent.setup();
      let accepted = false;
      routeFetch((url, method) => {
        if (url.endsWith("/invitations/inv_1/accept") && method === "POST") {
          accepted = true;

          return jsonResponse({ workspace_id: "ws_invited" });
        }

        if (url.endsWith("/invitations") && method === "GET") {
          return jsonResponse({ invitations: accepted ? [] : [pendingUserWorkspaceInvitation()] });
        }

        if (url.endsWith("/workspaces")) {
          return workspaceList(
            accepted
              ? workspace({
                  id: "ws_invited",
                  name: "Clinical Workspace",
                  role: "member",
                  created_at: "2026-01-02T00:00:00.000Z",
                })
              : workspace(),
          );
        }
      });

      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

      await user.click(await screen.findByRole("link", { name: /Clinical Workspace/ }));
      await user.click(await screen.findByRole("button", { name: "Accept invitation" }));

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith("Workspace invitation accepted");
      });
    });

    it("confirms declining a Workspace invitation", async () => {
      const user = userEvent.setup();
      let declined = false;
      routeFetch((url, method) => {
        if (url.endsWith("/invitations/inv_1/decline") && method === "POST") {
          declined = true;

          return jsonResponse({ declined: true });
        }

        if (url.endsWith("/invitations") && method === "GET") {
          return jsonResponse({ invitations: declined ? [] : [pendingUserWorkspaceInvitation()] });
        }
      });

      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

      await user.click(await screen.findByRole("link", { name: /Clinical Workspace/ }));
      await user.click(await screen.findByRole("button", { name: "Decline invitation" }));

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith("Invitation declined");
      });
    });

    it.each([
      ["accept", "Accept invitation", 409, "Workspace invitation could not be accepted. Please try again."],
      ["decline", "Decline invitation", 403, "Workspace invitation could not be declined. Please try again."],
    ])(
      "shows friendly failure copy when a Workspace invitation %s fails",
      async (action, buttonName, status, message) => {
        const user = userEvent.setup();
        routeFetch((url, method) => {
          if (url.endsWith(`/invitations/inv_1/${action}`) && method === "POST") {
            return jsonResponse({ error: "policy detail" }, { status });
          }

          if (url.endsWith("/invitations") && method === "GET") {
            return jsonResponse({ invitations: [pendingUserWorkspaceInvitation()] });
          }
        });

        render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

        await user.click(await screen.findByRole("link", { name: /Clinical Workspace/ }));
        await user.click(await screen.findByRole("button", { name: buttonName }));

        await waitFor(() => {
          expect(toastMock.error).toHaveBeenCalledWith(message);
        });
      },
    );
  });

  describe("Workspace member actions", () => {
    function routeMemberAction(response) {
      routeFetch((url, method) => {
        if (url.endsWith("/workspaces/ws_1/users") && method === "GET") {
          return jsonResponse({ users: [workspaceMember()] });
        }

        if (url.endsWith("/workspaces/ws_1/users/user_2") && method === "POST") return response;
      });
    }

    async function applyMemberAction(actionName) {
      const user = userEvent.setup();
      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
      await user.click(await screen.findByRole("button", { name: "Edit user" }));
      await user.click(await screen.findByRole("button", { name: actionName }));
    }

    it.each([
      ["Remove user", "Removed Grace Hopper from workspace"],
      ["Make admin", "Made Grace Hopper an admin"],
      ["Make owner", "Workspace ownership transferred to Grace Hopper"],
    ])("confirms the %s member action with membership wording", async (actionName, message) => {
      routeMemberAction(jsonResponse({ updated: true }));

      await applyMemberAction(actionName);

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith(message);
      });
    });

    it("shows friendly failure copy when a Workspace member action fails", async () => {
      routeMemberAction(jsonResponse({ error: "policy detail" }, { status: 403 }));

      await applyMemberAction("Make admin");

      await waitFor(() => {
        expect(toastMock.error).toHaveBeenCalledWith("Workspace member action failed. Please try again.");
      });
    });
  });

  it("confirms creating a template through the Template Builder", async () => {
    const user = userEvent.setup();
    routeFetch((url, method) => {
      if (url.endsWith("/templates") && method === "POST") {
        return jsonResponse({ template_id: "tpl_created", name: "Invoice Template" });
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "Save new template" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template saved: Invoice Template");
    });
  });

  it("keeps existing template save disabled until the loaded template changes", async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockImplementation(
      mockTemplateFetch({
        id: "tpl_existing",
        name: "Discharge Summary",
        description: "Extract discharge details",
      }),
    );

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));

    const saveButton = await screen.findByRole("button", { name: "Save changes" });
    expect(saveButton.disabled).toBe(true);

    await user.clear(screen.getByLabelText("Template name"));
    await user.type(screen.getByLabelText("Template name"), "Updated Discharge Summary");

    expect(saveButton.disabled).toBe(false);

    await user.click(saveButton);

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template saved: Updated Discharge Summary");
    });
  });

  it("shows a validation toast for invalid template drafts without toasting draft-only edits", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "+ Add field" }));

    expectNoToasts();

    await user.click(screen.getByRole("button", { name: "Save new template" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Template draft is incomplete. Fix required fields before saving.");
    });
  });

  it("confirms deleting a template and stays quiet when deletion is cancelled", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    globalThis.fetch.mockImplementation(
      mockTemplateFetch({
        id: "tpl_delete",
        name: "Delete Me",
        description: "Template to delete",
      }),
    );

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));
    await screen.findByRole("button", { name: "Save changes" });

    await user.click(screen.getByRole("button", { name: "Delete Template" }));

    expect(confirmSpy).toHaveBeenCalledWith("Delete template tpl_delete? This action cannot be undone.");
    expect(toastMock.success).not.toHaveBeenCalledWith("Template deleted: Delete Me");
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Template" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template deleted: Delete Me");
    });
  });

  it("toasts template JSON validation blockers while preserving inline detail", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "View JSON" }));
    fireEvent.change(screen.getByLabelText("Template JSON"), { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "Save Template JSON" }));

    expect(await screen.findByText(/^Request body must be valid JSON: .+/)).not.toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith("Template JSON is invalid. Fix it before saving.");
  });

  it("confirms successful template JSON saves", async () => {
    const user = userEvent.setup();
    routeFetch((url, method) => {
      if (url.endsWith("/templates") && method === "POST") {
        return jsonResponse({ template_id: "tpl_json", name: "Imported Template" });
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "View JSON" }));
    fireEvent.change(screen.getByLabelText("Template JSON"), {
      target: { value: JSON.stringify(validTemplatePayload("Imported Template")) },
    });
    await user.click(screen.getByRole("button", { name: "Save Template JSON" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template saved: Imported Template");
    });
  });

  it("toasts template JSON clipboard copy success and failure", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "View JSON" }));
    await user.click(screen.getByRole("button", { name: "Copy template JSON" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template JSON copied");
    });

    await user.click(screen.getByRole("button", { name: "Copy template JSON" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Template JSON could not be copied. Please try again.");
    });
  });

  it("confirms a single document upload was queued", async () => {
    const user = userEvent.setup();
    let extractFormData = null;
    let workspaceContextRefreshes = 0;
    routeFetch((url, method, options) => {
      if (url.endsWith("/templates")) return jsonResponse({ templates: [invoiceTemplate()] });

      if (url.endsWith("/extract") && method === "POST") {
        extractFormData = options.body;

        return jsonResponse({ job_id: "job_upload_1" });
      }

      if (url.endsWith("/workspaces/ws_1/context")) {
        workspaceContextRefreshes += 1;

        return jsonResponse({ workspace: workspace() });
      }
    });

    const { container } = render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await uploadFiles(user, container, [new File(["invoice"], "invoice.pdf", { type: "application/pdf" })]);

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("1 document queued");
    });
    expect(extractFormData.get("document")).toBeInstanceOf(File);
    expect(extractFormData.has("image")).toBe(false);
    expect(extractFormData.has("file")).toBe(false);
    expect(screen.getByText("Success")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Documents1" })).toBeTruthy();
    await waitFor(() => {
      expect(workspaceContextRefreshes).toBe(1);
    });
    expect(toastMock.success).not.toHaveBeenCalledWith(expect.stringContaining("Workspace access changed"));
  });

  it("uses Source file language in document upload controls", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getAllByRole("button", { name: "Upload Document" })[0]);

    expect(
      screen.getByText("Choose a template or tags for automatic selection, then add your source files."),
    ).toBeTruthy();
    expect(screen.getByText("Source files")).toBeTruthy();
    expect(screen.getByText("Drag and drop source files here")).toBeTruthy();
    expect(screen.getByText("No Source files selected")).toBeTruthy();
    expect(screen.queryByText("Document file")).toBeNull();
    expect(screen.queryByText("Drag and drop files here")).toBeNull();
    expect(screen.queryByText("No files selected")).toBeNull();
  });

  it("summarizes a mixed multi-file upload with one aggregate toast", async () => {
    const user = userEvent.setup();
    let queueAttempts = 0;
    routeFetch((url, method) => {
      if (url.endsWith("/templates")) return jsonResponse({ templates: [invoiceTemplate()] });

      if (url.endsWith("/extract") && method === "POST") {
        queueAttempts += 1;

        return queueAttempts === 1
          ? jsonResponse({ job_id: "job_upload_1" })
          : jsonResponse({ error: "queue detail" }, { status: 500 });
      }
    });

    const { container } = render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await uploadFiles(user, container, [
      new File(["invoice"], "invoice.pdf", { type: "application/pdf" }),
      new File(["receipt"], "receipt.pdf", { type: "application/pdf" }),
    ]);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("1 document queued, 1 failed");
    });
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(screen.getByText("receipt.pdf")).toBeTruthy();
    expect(screen.getByText(/queue detail/)).toBeTruthy();
  });

  it("keeps polling while a selected document is processing when live updates are unavailable", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    routeFetch((url, method) => {
      if (url.endsWith("/jobs?group_packets=true") && method === "GET") {
        return jobList({
          job_id: "job_processing_1",
          status: "processing",
          source_name: "invoice.pdf",
          template_id: "tpl_document",
          updated_at: "2026-01-03T00:00:01.000Z",
        });
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(timeoutSpy.mock.calls.some(([, delay]) => delay >= 5000 && delay <= 6000)).toBe(true);
    });
  });

  it("does not poll obsolete lifecycle metadata as an Extraction job lifecycle state", async () => {
    const legacyJob = {
      job_id: "job_legacy_unknown_1",
      status: "legacy_unknown",
      source_name: "invoice.pdf",
      template_id: "tpl_document",
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:01.000Z",
    };

    const intervalSpy = vi.spyOn(window, "setInterval").mockReturnValue(123);
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    routeFetch((url) => {
      if (url.endsWith("/jobs?group_packets=true")) return jobList(legacyJob);

      if (url.endsWith("/jobs/job_legacy_unknown_1")) return jsonResponse(legacyJob);
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/jobs/job_legacy_unknown_1"),
        expect.any(Object),
      );
    });
    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it("stores completed Extraction job details after the Document details load", async () => {
    routeFetch((url, method) => {
      if (url.endsWith("/jobs?group_packets=true") && method === "GET")
        return jobList(completedDocument({ results: [] }));

      if (url.endsWith("/jobs/job_completed_1")) {
        return jsonResponse(
          completedDocument({
            source_preview_url: "blob:http://localhost/source-preview",
            results: [totalResult()],
          }),
        );
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await waitFor(() => {
      const cacheWrite = window.localStorage.setItem.mock.calls.find(
        ([key]) => key === COMPLETED_DOCUMENT_CACHE_STORAGE_KEY,
      );

      expect(cacheWrite).toBeTruthy();
      expect(cacheWrite[1]).toContain("job_completed_1");
      expect(cacheWrite[1]).toContain("$42.00");
      expect(cacheWrite[1]).not.toContain("source_preview_url");
      expect(cacheWrite[1]).not.toContain("blob:http://localhost/source-preview");
    });
  });

  it("renders cached completed Extraction results after refresh for the same accepted Workspace", async () => {
    installLocalStorage(
      { workspaceId: "ws_1", workspaceName: "Research Workspace" },
      {
        [COMPLETED_DOCUMENT_CACHE_STORAGE_KEY]: JSON.stringify({
          ws_1: [completedDocument({ results: [totalResult()] })],
        }),
      },
    );
    routeFetch((url, method) => {
      if (url.endsWith("/jobs?group_packets=true") && method === "GET")
        return jobList(completedDocument({ results: [] }));

      if (url.endsWith("/jobs/job_completed_1")) return new Promise(() => {});
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await userEvent.click(await screen.findByRole("link", { name: /Documents/ }));

    expect(await screen.findByText("$42.00")).toBeTruthy();
  });

  it.each([
    ["invoice.pdf", "application/pdf", "%PDF"],
    ["invoice.png", "image/png", "image"],
  ])(
    "keeps the completed Document preview for %s loaded through unrelated interactions",
    async (sourceName, mimeType, contents) => {
      const { createObjectURL, revokeObjectURL } = stubObjectUrls("blob:document-preview");

      const document = completedDocument({
        source_name: sourceName,
        source_retained: true,
        source_mime_type: mimeType,
        results: [totalResult()],
      });

      let originalRequests = 0;
      routeFetch((url) => {
        if (url.endsWith("/jobs?group_packets=true")) return jobList(document);

        if (url.endsWith("/jobs/job_completed_1")) return jsonResponse(document);

        if (url.endsWith("/jobs/job_completed_1/source")) {
          originalRequests += 1;

          return new Response(contents, { headers: { "content-type": mimeType } });
        }
      });

      await act(async () => {
        render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("link", { name: /Documents/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
      });

      const getPreview = () =>
        mimeType === "application/pdf"
          ? screen.getByTitle(`Preview of ${sourceName}`)
          : screen.getByAltText(`Original ${sourceName}`);

      const preview = getPreview();
      const previewUrl = preview.getAttribute("src");
      expect(originalRequests).toBe(1);

      await act(async () => {
        fireEvent.click(screen.getAllByRole("button", { name: "Upload Document" })[0]);
      });
      expect(screen.getByRole("dialog", { name: "Upload document" })).toBeTruthy();
      expect(getPreview()).toBe(preview);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
      });
      expect(screen.queryByRole("dialog", { name: "Upload document" })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "Select document job_completed_1" }));
      });
      expect(screen.getByRole("checkbox", { name: "Select document job_completed_1" }).checked).toBe(true);

      expect(originalRequests).toBe(1);
      expect(getPreview()).toBe(preview);
      expect(preview.getAttribute("src")).toBe(previewUrl);
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    },
  );

  describe("document deletion", () => {
    async function deleteOpenDocument(deleteResponse) {
      const user = userEvent.setup();
      routeFetch((url, method) => {
        if (url.endsWith("/jobs?group_packets=true") && method === "GET") return jobList(failedDocument());

        if (url.endsWith("/jobs/job_failed_1") && method === "DELETE") return deleteResponse;
      });

      render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

      await user.click(screen.getByRole("link", { name: /Documents/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));
    }

    it("confirms deleting a document", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);

      await deleteOpenDocument(jsonResponse({ deleted: true, job_id: "job_failed_1" }));

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith("Document deleted: invoice.pdf");
      });
      expect(screen.queryByText("job_failed_1")).toBeNull();
    });

    it("treats delete 404 cleanup as already removed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);

      await deleteOpenDocument(jsonResponse({ error: "already gone" }, { status: 404 }));

      await waitFor(() => {
        expect(toastMock.success).toHaveBeenCalledWith("Document already removed: invoice.pdf");
      });
      expect(screen.queryByText("job_failed_1")).toBeNull();
    });

    it("stays quiet when document deletion confirmation is cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);

      await deleteOpenDocument();

      expectNoToasts();
    });
  });

  it("deletes all ticked documents as one bulk action", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const deletedDocumentIds = [];
    routeFetch((url, method) => {
      if (url.endsWith("/jobs?group_packets=true") && method === "GET") {
        return jobList(failedDocument(), failedDocument({ job_id: "job_failed_2", source_name: "receipt.pdf" }));
      }

      const deletedDocumentId = ["job_failed_1", "job_failed_2"].find(
        (documentId) => url.endsWith(`/jobs/${documentId}`) && method === "DELETE",
      );

      if (deletedDocumentId) {
        deletedDocumentIds.push(deletedDocumentId);

        return jsonResponse({ deleted: true, job_id: deletedDocumentId });
      }
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Documents/ }));
    await user.click(screen.getByRole("checkbox", { name: "Select all available documents" }));
    await user.click(screen.getByRole("button", { name: "Delete 2" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("2 documents deleted");
    });
    expect(confirm).toHaveBeenCalledWith(
      "Delete 2 selected documents? This will permanently remove them from the workspace.",
    );
    expect(deletedDocumentIds.sort()).toEqual(["job_failed_1", "job_failed_2"]);
    expect(screen.queryByRole("checkbox", { name: "Select document job_failed_1" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Select document job_failed_2" })).toBeNull();
  });

  it("exports the open document when no document checkboxes are selected", async () => {
    const user = userEvent.setup();
    const { createObjectURL, revokeObjectURL } = stubObjectUrls("blob:single-export");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const requestedIds = [];
    routeFetch((url, method, options) => {
      if (url.endsWith("/jobs/export") && method === "POST") {
        requestedIds.push(...JSON.parse(options.body).job_ids);

        return new Response("xlsx", { headers: { "x-exported-job-count": "1" } });
      }

      if (url.endsWith("/jobs?group_packets=true")) return jobList(completedDocument());

      if (url.endsWith("/jobs/job_completed_1")) return jsonResponse(completedDocument());
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
    await user.click(screen.getByRole("link", { name: /Documents/ }));
    await screen.findByRole("checkbox", { name: "Select document job_completed_1" });
    await user.click(screen.getByRole("button", { name: "Export", exact: true }));
    await waitFor(() => expect(requestedIds).toEqual(["job_completed_1"]));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:single-export");
  });

  it("exports checked terminal jobs while skipping and locking in-progress selections", async () => {
    const user = userEvent.setup();
    const { createObjectURL, revokeObjectURL } = stubObjectUrls("blob:job-export");
    let downloaded = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
      downloaded = { href: this.href, filename: this.download };
    });
    const exportResponse = deferred();
    const requestedExportIds = [];
    routeFetch((url, method, options) => {
      if (url.endsWith("/jobs/export") && method === "POST") {
        requestedExportIds.push(...JSON.parse(options.body).job_ids);

        return exportResponse.promise;
      }

      if (url.endsWith("/jobs?group_packets=true") && method === "GET") {
        return jobList(
          completedDocument(),
          completedDocument({
            job_id: "job_processing_1",
            source_name: "processing.pdf",
            status: "processing",
            completed_at: null,
          }),
          failedDocument({ job_id: "job_failed_1" }),
        );
      }

      if (url.endsWith("/jobs/job_completed_1") && method === "GET") {
        return jsonResponse(completedDocument());
      }
    });
    const checkbox = (id) => screen.getByRole("checkbox", { name: `Select document ${id}` });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Documents/ }));
    await user.click(await screen.findByRole("checkbox", { name: "Select all available documents" }));
    const exportButton = screen.getByRole("button", { name: "Export 3" });
    expect(exportButton.title).toContain("2 of 3 selected documents are ready");
    expect(screen.getByRole("button", { name: "Delete 3" }).disabled).toBe(false);

    await user.click(exportButton);

    expect(requestedExportIds).toEqual(["job_completed_1", "job_processing_1", "job_failed_1"]);
    expect(screen.getByRole("button", { name: "Exporting…" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Delete 3" }).disabled).toBe(true);
    expect(checkbox("job_completed_1").disabled).toBe(true);

    await act(async () => {
      exportResponse.resolve(
        new Response("xlsx-bytes", {
          status: 200,
          headers: {
            "content-disposition": 'attachment; filename="research-workspace-job-export-2026-08-16-1430.xlsx"',
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "x-exported-job-count": "2",
            "x-skipped-job-count": "1",
          },
        }),
      );
      await exportResponse.promise;
    });

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Exported 2 documents; skipped 1 unavailable or in-progress document",
      );
    });
    expect(downloaded).toEqual({
      href: "blob:job-export",
      filename: "research-workspace-job-export-2026-08-16-1430.xlsx",
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const [downloadBlob] = createObjectURL.mock.calls[0];
    expect(downloadBlob.size).toBe(10);
    expect(downloadBlob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:job-export");
    expect(screen.getByRole("button", { name: "Export 3" }).disabled).toBe(false);

    for (const id of ["job_completed_1", "job_processing_1", "job_failed_1"]) {
      expect(checkbox(id).checked).toBe(true);
    }
  });

  it("does not toast for background document listing", async () => {
    const user = userEvent.setup();
    routeFetch((url, method) => {
      if (url.endsWith("/jobs?group_packets=true") && method === "GET") return jobList(failedDocument());
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);

    await user.click(screen.getByRole("link", { name: /Documents/ }));
    await waitFor(() => {
      expect(screen.getByText("job_failed_1")).toBeTruthy();
    });
    expectNoToasts();
  });
});

function installLocalStorage(initialValue, extraEntries = {}) {
  const storage = new Map([
    ["documentextraction.workspace.v1", JSON.stringify(initialValue)],
    ...Object.entries(extraEntries),
  ]);

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key) => storage.get(key) ?? null),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
      removeItem: vi.fn((key) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    },
  });
}

function lastStoredWorkspacePreference() {
  return JSON.parse(window.localStorage.setItem.mock.calls.at(-1)[1]);
}

function installClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

  return writeText;
}

function stubObjectUrls(url) {
  const createObjectURL = vi.fn(() => url);
  const revokeObjectURL = vi.fn();

  class ExportURL extends globalThis.URL {}

  ExportURL.createObjectURL = createObjectURL;
  ExportURL.revokeObjectURL = revokeObjectURL;
  vi.stubGlobal("URL", ExportURL);

  return { createObjectURL, revokeObjectURL };
}

function expectNoToasts() {
  expect(toastMock.success).not.toHaveBeenCalled();
  expect(toastMock.error).not.toHaveBeenCalled();
}

async function uploadFiles(user, container, files) {
  await user.click(screen.getAllByRole("button", { name: "Upload Document" })[0]);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files } });
  await user.click(screen.getByRole("button", { name: "Upload Documents" }));
}

function deferred() {
  let resolve;

  const promise = new Promise((next) => {
    resolve = next;
  });

  return { promise, resolve };
}

// Handles the routes a test cares about; anything the handler leaves
// unanswered falls through to the default signed-in Workspace backend.
function routeFetch(handler) {
  globalThis.fetch.mockImplementation((input, options = {}) => {
    const response = handler(String(input), options.method || "GET", options);

    return response === undefined ? mockWorkspaceFetch(input, options) : Promise.resolve(response);
  });
}

function routeApiKeyGeneration({ hasApiKey, apiKey }) {
  routeFetch((url, method) => {
    if (url.endsWith("/workspaces")) return workspaceList(workspace({ has_api_key: hasApiKey }));

    if (url.endsWith("/workspaces/ws_1/api-key") && method === "POST") {
      return jsonResponse({ workspace_id: "ws_1", api_key: apiKey, has_api_key: true });
    }
  });
}

function mockWorkspaceFetch(input) {
  const url = String(input);

  if (url.endsWith("/model-configuration")) {
    return Promise.resolve(
      jsonResponse({
        configured: true,
        credential_status: "configured",
        gateway_url: "http://localhost:1/v1",
        model_name: "test/model",
        revision: 1,
      }),
    );
  }

  if (url.endsWith("/workspaces")) return Promise.resolve(workspaceList(workspace()));

  if (url.endsWith("/invitations")) return Promise.resolve(jsonResponse({ invitations: [] }));

  if (url.endsWith("/templates")) return Promise.resolve(jsonResponse({ templates: [] }));

  if (url.includes("/jobs")) return Promise.resolve(jobList());

  if (url.includes("/users")) return Promise.resolve(jsonResponse({ users: [] }));

  return Promise.resolve(jsonResponse({}));
}

function mockTemplateFetch(template) {
  return (input, options = {}) => {
    const url = String(input);

    if (url.endsWith("/templates") && (!options.method || options.method === "GET")) {
      return Promise.resolve(jsonResponse({ templates: [template] }));
    }

    if (url.endsWith(`/templates/${template.id}`) && options.method === "GET") {
      return Promise.resolve(jsonResponse(validTemplatePayload(template.name, template.description)));
    }

    if (url.endsWith(`/templates/${template.id}`) && options.method === "PATCH") {
      const body = JSON.parse(options.body || "{}");

      return Promise.resolve(jsonResponse({ id: template.id, ...body }));
    }

    if (url.endsWith(`/templates/${template.id}`) && options.method === "DELETE") {
      return Promise.resolve(jsonResponse({ deleted: true }));
    }

    return mockWorkspaceFetch(input, options);
  };
}

function validTemplatePayload(name = "Prescription Template", description = "Extract prescription details") {
  return {
    name,
    description,
    fields: [
      {
        name: "Patient Name",
        description: "Extract the patient name",
        data_type: "string",
      },
    ],
  };
}

function workspace(overrides = {}) {
  return {
    id: "ws_1",
    name: "Research Workspace",
    role: "owner",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function workspaceList(...workspaces) {
  return jsonResponse({ workspaces });
}

function twoWorkspaceList() {
  return workspaceList(
    workspace(),
    workspace({ id: "ws_2", name: "Clinical Workspace", role: "admin", created_at: "2026-01-02T00:00:00.000Z" }),
  );
}

function jobList(...jobs) {
  return jsonResponse({ jobs, next_cursor: null });
}

function invoiceTemplate() {
  return { id: "tpl_document", name: "Invoice Template" };
}

function totalResult() {
  return { field_id: "total", name: "Total", status: "found", answer: "$42.00" };
}

function pendingInvitation(overrides = {}) {
  return {
    id: "inv_1",
    email: "grace@example.com",
    role: "member",
    status: "pending",
    inviter_display: "Ada Lovelace",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-08T00:00:00.000Z",
    ...overrides,
  };
}

function pendingUserWorkspaceInvitation(overrides = {}) {
  return {
    id: "inv_1",
    workspace_id: "ws_invited",
    workspace_name: "Clinical Workspace",
    email: "ada@example.com",
    role: "member",
    status: "pending",
    inviter_display: "Grace Hopper",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-08T00:00:00.000Z",
    ...overrides,
  };
}

function workspaceMember(overrides = {}) {
  return {
    user_id: "user_2",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "member",
    created_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function failedDocument(overrides = {}) {
  return {
    job_id: "job_failed_1",
    status: "failed",
    source_name: "invoice.pdf",
    template_id: "tpl_document",
    current_attempt: 1,
    error_code: "extract_failed",
    error_message: "OCR failed",
    queued_at: "2026-01-03T00:00:00.000Z",
    ...overrides,
  };
}

function completedDocument(overrides = {}) {
  return {
    job_id: "job_completed_1",
    status: "completed",
    source_name: "invoice.pdf",
    template_id: "tpl_document",
    queued_at: "2026-01-03T00:00:00.000Z",
    completed_at: "2026-01-03T00:00:03.000Z",
    results: [],
    ...overrides,
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
