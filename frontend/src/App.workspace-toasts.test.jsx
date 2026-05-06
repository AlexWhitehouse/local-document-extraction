import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const authClientMock = vi.hoisted(() => ({
  refetchSession: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("./lib/authClient", () => ({
  createRuntimeAuthClient: () => ({
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
    signOut: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  Toaster: (props) => (
    <div data-rich-colors={String(props.richColors)} data-testid="sonner-toaster" />
  ),
  toast: toastMock,
}));

import { App } from "./App.jsx";

describe("Workspace action toast feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [],
    });
    globalThis.fetch = vi.fn(mockWorkspaceFetch);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("confirms Workspace API key rotation without exposing key material", async () => {
    const user = userEvent.setup();
    const rotatedKey = "imgx_live_rotated_secret_key";

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (
        url.endsWith("/workspaces/ws_1/api-key") &&
        options.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({ workspace_id: "ws_1", api_key: rotatedKey }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Refresh API Key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace API key rotated");
    });
    expect(toastMock.success).not.toHaveBeenCalledWith(
      expect.stringContaining(rotatedKey),
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      expect.stringContaining(rotatedKey),
    );
  });

  it("disables Workspace API key rotation for workspace members", () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "member",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [],
    });
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: [
              {
                id: "ws_1",
                name: "Research Workspace",
                role: "member",
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    expect(screen.getByRole("button", { name: "Refresh API Key" }).disabled).toBe(
      true,
    );
  });

  it("confirms explicit Workspace creation", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces") && options.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            workspace_id: "ws_2",
            name: "New Workspace",
            api_key: "imgx_live_new_workspace_key",
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Create Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace created: New Workspace",
      );
    });
  });

  it("confirms Workspace rename after saving a changed name", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1") && options.method === "PATCH") {
        return Promise.resolve(jsonResponse({ id: "ws_1", name: "Clinical Workspace" }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.clear(screen.getByLabelText("Workspace name"));
    await user.type(screen.getByLabelText("Workspace name"), "Clinical Workspace");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace renamed: Clinical Workspace",
      );
    });
  });

  it("confirms Leave Workspace with replacement personal Workspace wording", async () => {
    const user = userEvent.setup();
    let leaveRequested = false;

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "member",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/leave") && options.method === "POST") {
        leaveRequested = true;
        return Promise.resolve(
          jsonResponse({
            replacement_workspace: {
              workspace_id: "ws_personal",
              api_key: "imgx_live_replacement_key",
            },
          }),
        );
      }
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: leaveRequested
              ? [
                  {
                    id: "ws_personal",
                    name: "Personal Workspace",
                    role: "owner",
                    created_at: "2026-01-02T00:00:00.000Z",
                  },
                ]
              : [
                  {
                    id: "ws_1",
                    name: "Research Workspace",
                    role: "member",
                    created_at: "2026-01-01T00:00:00.000Z",
                  },
                ],
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Leave Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace left. Replacement personal Workspace created.",
      );
    });
  });

  it("confirms Workspace deletion", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1") && options.method === "DELETE") {
        return Promise.resolve(jsonResponse({ deleted: true }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace deleted");
    });
  });

  it("stays quiet when Workspace deletion confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("does not toast for background Workspace listing and refresh", async () => {
    render(<App />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces",
        expect.objectContaining({ method: "GET" }),
      );
    });
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("confirms creating a Workspace invitation", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/invitations") && options.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            invitation_id: "inv_1",
            email: "grace@example.com",
            role: "member",
            status: "pending",
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.type(screen.getByLabelText("Invite email"), "grace@example.com");
    await user.click(screen.getByRole("button", { name: "Invite User" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Successfully invited grace@example.com",
      );
    });
  });

  it("shows a validation toast when creating a Workspace invitation without an email", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Invite User" }));

    expect(toastMock.error).toHaveBeenCalledWith(
      "Enter an email address before inviting a teammate.",
    );
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/workspaces/ws_1/invitations"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows friendly failure copy when creating a Workspace invitation fails", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/invitations") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ error: "D1 internal detail" }, { status: 500 }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.type(screen.getByLabelText("Invite email"), "grace@example.com");
    await user.click(screen.getByRole("button", { name: "Invite User" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Workspace invitation could not be created. Please try again.",
      );
    });
    expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringContaining("D1"));
  });

  it("confirms cancelling a pending Workspace invitation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ invitations: [pendingInvitation()] }));
      }
      if (url.endsWith("/workspaces/ws_1/invitations/inv_1") && options.method === "DELETE") {
        return Promise.resolve(jsonResponse({ cancelled: true }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    const cancelButton = await screen.findByRole("button", {
      name: "Cancel invitation for grace@example.com",
    });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Invitation cancelled for grace@example.com",
      );
    });
  });

  it("stays quiet when cancelling a Workspace invitation confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ invitations: [pendingInvitation()] }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Cancel invitation for grace@example.com",
      }),
    );

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/workspaces/ws_1/invitations/inv_1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("shows friendly failure copy when cancelling a Workspace invitation fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ invitations: [pendingInvitation()] }));
      }
      if (url.endsWith("/workspaces/ws_1/invitations/inv_1") && options.method === "DELETE") {
        return Promise.resolve(jsonResponse({ error: "permission trace" }, { status: 403 }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Cancel invitation for grace@example.com",
      }),
    );

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Workspace invitation could not be cancelled. Please try again.",
      );
    });
  });

  it("confirms accepting a Workspace invitation", async () => {
    const user = userEvent.setup();
    let accepted = false;

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [pendingUserWorkspaceInvitation()],
    });
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/invitations/inv_1/accept") && options.method === "POST") {
        accepted = true;
        return Promise.resolve(jsonResponse({ workspace_id: "ws_invited" }));
      }
      if (url.endsWith("/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            invitations: accepted ? [] : [pendingUserWorkspaceInvitation()],
          }),
        );
      }
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: accepted
              ? [
                  {
                    id: "ws_invited",
                    name: "Clinical Workspace",
                    role: "member",
                    created_at: "2026-01-02T00:00:00.000Z",
                  },
                ]
              : [
                  {
                    id: "ws_1",
                    name: "Research Workspace",
                    role: "owner",
                    created_at: "2026-01-01T00:00:00.000Z",
                  },
                ],
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Clinical Workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Accept Invitation" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace invitation accepted");
    });
  });

  it("shows friendly failure copy when accepting a Workspace invitation fails", async () => {
    const user = userEvent.setup();

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: { ws_1: "imgx_live_existing_key" },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [pendingUserWorkspaceInvitation()],
    });
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/invitations/inv_1/accept") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ error: "expired detail" }, { status: 409 }));
      }
      if (url.endsWith("/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ invitations: [pendingUserWorkspaceInvitation()] }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Clinical Workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Accept Invitation" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Workspace invitation could not be accepted. Please try again.",
      );
    });
  });

  it("confirms declining a Workspace invitation", async () => {
    const user = userEvent.setup();
    let declined = false;

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: { ws_1: "imgx_live_existing_key" },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [pendingUserWorkspaceInvitation()],
    });
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/invitations/inv_1/decline") && options.method === "POST") {
        declined = true;
        return Promise.resolve(jsonResponse({ declined: true }));
      }
      if (url.endsWith("/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({ invitations: declined ? [] : [pendingUserWorkspaceInvitation()] }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Clinical Workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Decline Invitation" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Invitation declined");
    });
  });

  it("shows friendly failure copy when declining a Workspace invitation fails", async () => {
    const user = userEvent.setup();

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: { ws_1: "imgx_live_existing_key" },
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [pendingUserWorkspaceInvitation()],
    });
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/invitations/inv_1/decline") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ error: "policy detail" }, { status: 403 }));
      }
      if (url.endsWith("/invitations") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ invitations: [pendingUserWorkspaceInvitation()] }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Clinical Workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Decline Invitation" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Workspace invitation could not be declined. Please try again.",
      );
    });
  });

  it("confirms removing a Workspace member with membership wording", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/users") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ users: [workspaceMember()] }));
      }
      if (url.endsWith("/workspaces/ws_1/users/user_2") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ updated: true }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Edit user" }));
    await user.click(await screen.findByRole("button", { name: "Remove User" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Removed Grace Hopper from workspace",
      );
    });
  });

  it("confirms making a Workspace member an admin", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/users") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ users: [workspaceMember()] }));
      }
      if (url.endsWith("/workspaces/ws_1/users/user_2") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ updated: true }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Edit user" }));
    await user.click(await screen.findByRole("button", { name: "Make Admin" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Made Grace Hopper an admin");
    });
  });

  it("confirms transferring Workspace ownership to a member", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/users") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ users: [workspaceMember()] }));
      }
      if (url.endsWith("/workspaces/ws_1/users/user_2") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ updated: true }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Edit user" }));
    await user.click(await screen.findByRole("button", { name: "Make Owner" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace ownership transferred to Grace Hopper",
      );
    });
  });

  it("shows friendly failure copy when a Workspace member action fails", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/users") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ users: [workspaceMember()] }));
      }
      if (url.endsWith("/workspaces/ws_1/users/user_2") && options.method === "POST") {
        return Promise.resolve(jsonResponse({ error: "policy detail" }, { status: 403 }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Edit user" }));
    await user.click(await screen.findByRole("button", { name: "Make Admin" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Workspace member action failed. Please try again.",
      );
    });
  });

  it("confirms creating a template through the Template Builder", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/templates") && options.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            template_id: "tpl_created",
            name: "Prescription Template",
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "Save New Template" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Template saved: Prescription Template",
      );
    });
  });

  it("keeps existing template save disabled until the loaded template changes", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation(mockTemplateFetch({
      id: "tpl_existing",
      name: "Discharge Summary",
      description: "Extract discharge details",
    }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));

    const saveButton = await screen.findByRole("button", { name: "Save Changes" });
    expect(saveButton.disabled).toBe(true);

    await user.clear(screen.getAllByLabelText("Name")[0]);
    await user.type(screen.getAllByLabelText("Name")[0], "Updated Discharge Summary");

    expect(saveButton.disabled).toBe(false);

    await user.click(saveButton);

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Template saved: Updated Discharge Summary",
      );
    });
  });

  it("shows a validation toast for invalid template drafts without toasting draft-only edits", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "Add Field" }));

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save New Template" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Template draft is incomplete. Fix required fields before saving.",
      );
    });
  });

  it("confirms deleting a template and stays quiet when deletion is cancelled", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    globalThis.fetch.mockImplementation(mockTemplateFetch({
      id: "tpl_delete",
      name: "Delete Me",
      description: "Template to delete",
    }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));
    await screen.findByRole("button", { name: "Save Changes" });

    await user.click(screen.getByRole("button", { name: "Delete Template" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete template tpl_delete? This action cannot be undone.",
    );
    expect(toastMock.success).not.toHaveBeenCalledWith("Template deleted: Delete Me");
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Template" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template deleted: Delete Me");
    });
  });

  it("toasts template JSON validation blockers while preserving inline detail", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "Export / Import" }));
    fireEvent.change(screen.getByLabelText("Template JSON"), {
      target: { value: "{" },
    });
    await user.click(screen.getByRole("button", { name: "Save Template JSON" }));

    expect(await screen.findByText("Request body must be valid JSON")).not.toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Template JSON is invalid. Fix it before saving.",
    );
  });

  it("confirms successful template JSON saves", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/templates") && options.method === "POST") {
        return Promise.resolve(
          jsonResponse({ template_id: "tpl_json", name: "Imported Template" }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "Export / Import" }));
    fireEvent.change(screen.getByLabelText("Template JSON"), {
      target: { value: JSON.stringify(validTemplatePayload("Imported Template")) },
    });
    await user.click(screen.getByRole("button", { name: "Save Template JSON" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Template saved: Imported Template",
      );
    });
  });

  it("toasts template JSON clipboard copy success and failure", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Templates/i }));
    await user.click(screen.getByRole("button", { name: "Export / Import" }));
    await user.click(screen.getByRole("button", { name: "Copy template JSON" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Template JSON copied");
    });

    await user.click(screen.getByRole("button", { name: "Copy template JSON" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Template JSON could not be copied. Please try again.",
      );
    });
  });

  it("confirms a single document upload was queued", async () => {
    const user = userEvent.setup();
    const template = { id: "tpl_document", name: "Invoice Template" };
    let extractFormData = null;

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/templates")) {
        return Promise.resolve(jsonResponse({ templates: [template] }));
      }
      if (url.endsWith("/extract") && options.method === "POST") {
        extractFormData = options.body;
        return Promise.resolve(jsonResponse({ job_id: "job_upload_1" }));
      }
      return mockWorkspaceFetch(input, options);
    });

    const { container } = render(<App />);

    await user.click(screen.getAllByRole("button", { name: "Upload Document" })[0]);
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(["invoice"], "invoice.pdf", { type: "application/pdf" })],
      },
    });
    await user.click(screen.getByRole("button", { name: "Upload Documents" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("1 document queued");
    });
    expect(extractFormData.get("document")).toBeInstanceOf(File);
    expect(extractFormData.has("image")).toBe(false);
    expect(extractFormData.has("file")).toBe(false);
    expect(screen.getByText("success")).toBeTruthy();
  });

  it("uses Source file language in document upload controls", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getAllByRole("button", { name: "Upload Document" })[0]);

    expect(
      screen.getByText(
        "Select a template and source files, then queue Document extraction.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Source files")).toBeTruthy();
    expect(screen.getByText("Drag and drop source files here")).toBeTruthy();
    expect(screen.getByText("No Source files selected")).toBeTruthy();
    expect(screen.queryByText("Document file")).toBeNull();
    expect(screen.queryByText("Drag and drop files here")).toBeNull();
    expect(screen.queryByText("No files selected")).toBeNull();
  });

  it("keeps polling while a selected document is processing", async () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      selectedDocumentId: "job_processing_1",
      jobHistory: [
        {
          job_id: "job_processing_1",
          status: "processing",
          source_name: "invoice.pdf",
          template_id: "tpl_document",
          created_at: "2026-01-03T00:00:00.000Z",
          updated_at: "2026-01-03T00:00:01.000Z",
        },
      ],
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [],
    });
    const intervalSpy = vi.spyOn(window, "setInterval").mockReturnValue(123);
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});

    render(<App />);

    await waitFor(() => {
      expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    });
  });

  it("does not poll obsolete workflow metadata as an Extraction job lifecycle state", async () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      selectedDocumentId: "job_workflow_started_1",
      jobHistory: [
        {
          job_id: "job_workflow_started_1",
          status: "workflow_started",
          source_name: "invoice.pdf",
          template_id: "tpl_document",
          created_at: "2026-01-03T00:00:00.000Z",
          updated_at: "2026-01-03T00:00:01.000Z",
        },
      ],
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      userWorkspaceInvitations: [],
    });
    const intervalSpy = vi.spyOn(window, "setInterval").mockReturnValue(123);
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [
              {
                job_id: "job_workflow_started_1",
                status: "workflow_started",
                source_name: "invoice.pdf",
                template_id: "tpl_document",
                created_at: "2026-01-03T00:00:00.000Z",
                updated_at: "2026-01-03T00:00:01.000Z",
              },
            ],
            next_cursor: null,
          }),
        );
      }
      if (url.endsWith("/jobs/job_workflow_started_1")) {
        return Promise.resolve(
          jsonResponse({
            job_id: "job_workflow_started_1",
            status: "workflow_started",
            source_name: "invoice.pdf",
            template_id: "tpl_document",
            created_at: "2026-01-03T00:00:00.000Z",
            updated_at: "2026-01-03T00:00:01.000Z",
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/jobs/job_workflow_started_1"),
        expect.any(Object),
      );
    });
    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it("summarizes a mixed multi-file upload with one aggregate toast", async () => {
    const user = userEvent.setup();
    const template = { id: "tpl_document", name: "Invoice Template" };
    let queueAttempts = 0;

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/templates")) {
        return Promise.resolve(jsonResponse({ templates: [template] }));
      }
      if (url.endsWith("/extract") && options.method === "POST") {
        queueAttempts += 1;
        if (queueAttempts === 1) {
          return Promise.resolve(jsonResponse({ job_id: "job_upload_1" }));
        }
        return Promise.resolve(
          jsonResponse({ error: "queue detail" }, { status: 500 }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    const { container } = render(<App />);

    await user.click(screen.getAllByRole("button", { name: "Upload Document" })[0]);
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [
          new File(["invoice"], "invoice.pdf", { type: "application/pdf" }),
          new File(["receipt"], "receipt.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Upload Documents" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("1 document queued, 1 failed");
    });
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(screen.getByText("receipt.pdf")).toBeTruthy();
    expect(screen.getByText(/queue detail/)).toBeTruthy();
  });

  it("confirms deleting a document", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({ jobs: [failedDocument()], next_cursor: null }),
        );
      }
      if (url.endsWith("/jobs/job_failed_1") && options.method === "DELETE") {
        return Promise.resolve(jsonResponse({ deleted: true }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await user.click(screen.getByRole("button", { name: "Delete Document" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Document deleted: invoice.pdf");
    });
    expect(screen.queryByText("job_failed_1")).toBeNull();
  });

  it("treats delete 404 cleanup as already removed", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({ jobs: [failedDocument()], next_cursor: null }),
        );
      }
      if (url.endsWith("/jobs/job_failed_1") && options.method === "DELETE") {
        return Promise.resolve(
          jsonResponse({ error: "already gone" }, { status: 404 }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await user.click(screen.getByRole("button", { name: "Delete Document" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Document already removed: invoice.pdf",
      );
    });
    expect(screen.queryByText("job_failed_1")).toBeNull();
  });

  it("stays quiet when document deletion confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({ jobs: [failedDocument()], next_cursor: null }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await user.click(screen.getByRole("button", { name: "Delete Document" }));

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("does not toast for background document listing", async () => {
    const user = userEvent.setup();

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({ jobs: [failedDocument()], next_cursor: null }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await waitFor(() => {
      expect(screen.getByText("job_failed_1")).toBeTruthy();
    });
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

function installLocalStorage(initialValue) {
  const storage = new Map([
    ["imageextraction.workspace.v1", JSON.stringify(initialValue)],
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

function mockWorkspaceFetch(input) {
  const url = String(input);

  if (url.endsWith("/workspaces")) {
    return Promise.resolve(
      jsonResponse({
        workspaces: [
          {
            id: "ws_1",
            name: "Research Workspace",
            role: "owner",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
  }
  if (url.endsWith("/invitations")) {
    return Promise.resolve(jsonResponse({ invitations: [] }));
  }
  if (url.endsWith("/profile")) {
    return Promise.resolve(
      jsonResponse({ name: "Ada Lovelace", email: "ada@example.com" }),
    );
  }
  if (url.endsWith("/templates")) {
    return Promise.resolve(jsonResponse({ templates: [] }));
  }
  if (url.includes("/jobs")) {
    return Promise.resolve(jsonResponse({ jobs: [], next_cursor: null }));
  }
  if (url.includes("/users")) {
    return Promise.resolve(jsonResponse({ users: [] }));
  }
  if (url.includes("/workspaces/ws_1/invitations")) {
    return Promise.resolve(jsonResponse({ invitations: [] }));
  }

  return Promise.resolve(jsonResponse({}));
}

function mockTemplateFetch(template) {
  return (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("/templates") && (!options.method || options.method === "GET")) {
      return Promise.resolve(
        jsonResponse({
          templates: [template],
        }),
      );
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
        required: true,
      },
    ],
  };
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

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
