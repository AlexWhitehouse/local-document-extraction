import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const authClientMock = vi.hoisted(() => ({
  refetchSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
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
    signOut: authClientMock.signOut,
    updateUser: authClientMock.updateUser,
  }),
}));

vi.mock("sonner", () => ({
  Toaster: (props) => (
    <div data-rich-colors={String(props.richColors)} data-testid="sonner-toaster" />
  ),
  toast: toastMock,
}));

import { App } from "./App.jsx";
import { COMPLETED_DOCUMENT_CACHE_STORAGE_KEY } from "./lib/completedDocumentCache";

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

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Research Workspace/ })).toBeTruthy();
    });

    const storedPayload = JSON.parse(
      window.localStorage.setItem.mock.calls.at(-1)[1],
    );
    expect(storedPayload).toEqual({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
    });
  });

  it("shows Loading workspace context without stored Workspace details while startup resolution is pending", async () => {
    installLocalStorage({
      workspaceId: "ws_stored",
      workspaceName: "Stored Workspace",
    });
    globalThis.fetch = vi.fn((input) => {
      const url = String(input);
      if (url.endsWith("/workspaces") || url.endsWith("/invitations")) {
        return new Promise(() => {});
      }
      return mockWorkspaceFetch(input);
    });

    render(<App />);

    expect(screen.getByRole("heading", { name: "Loading workspace context" })).toBeTruthy();
    expect(screen.queryByText(/Stored Workspace/)).toBeNull();
    expect(screen.getByRole("button", { name: "Generate API Key" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "+ Invite user" }).disabled).toBe(
      true,
    );
  });

  it("shows a retryable Workspace resolution error when backend workspace listing fails", async () => {
    installLocalStorage({
      workspaceId: "ws_stored",
      workspaceName: "Stored Workspace",
    });
    globalThis.fetch = vi.fn((input) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(jsonResponse({ error: "unavailable" }, { status: 500 }));
      }
      return mockWorkspaceFetch(input);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Workspace resolution error" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry Workspaces" })).toBeTruthy();
    expect(screen.queryByText(/Stored Workspace/)).toBeNull();
    expect(screen.getByRole("button", { name: "Generate API Key" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "+ Invite user" }).disabled).toBe(
      true,
    );
  });

  it("refreshes Workspaces and shows an Action toast when selected Workspace access is forbidden", async () => {
    installLocalStorage({
      workspaceId: "ws_removed",
      workspaceName: "Removed Workspace",
    });
    let workspaceListCalls = 0;
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        workspaceListCalls += 1;
        return Promise.resolve(
          jsonResponse({
            workspaces:
              workspaceListCalls === 1
                ? [{ id: "ws_removed", name: "Removed Workspace", role: "owner" }]
                : [{ id: "ws_remaining", name: "Remaining Workspace", role: "owner" }],
          }),
        );
      }
      if (url.endsWith("/templates") && (!options.method || options.method === "GET")) {
        const headers = new Headers(options.headers || {});
        if (headers.get("x-workspace-id") === "ws_removed") {
          return Promise.resolve(jsonResponse({ error: "forbidden" }, { status: 403 }));
        }
      }
      return mockWorkspaceFetch(input, options);
    });

    // Flush the immediate mocked startup and 403 recovery responses before the
    // expensive accessibility query, which can exhaust waitFor on slower CI.
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByRole("button", { name: /Remaining Workspace/ })).toBeTruthy();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Workspace access changed. Switched to Remaining Workspace.",
    );
  });

  it("revalidates a second browser's Workspace context after a live access invalidation", async () => {
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
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces") && options.method === "GET") {
        workspaceListCalls += 1;
        return Promise.resolve(
          jsonResponse({
            workspaces:
              workspaceListCalls === 1
                ? [{ id: "ws_1", name: "Research Workspace", role: "owner" }]
                : [{ id: "ws_2", name: "Remaining Workspace", role: "owner" }],
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    await act(async () => {
      sockets[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [{
            type: "workspace_context_invalidated",
            reason: "workspace_access",
            occurred_at: "2026-07-10T12:00:00.000Z",
          }],
        }),
      });
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: /Remaining Workspace/ })).toBeTruthy();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Workspace access changed. Switched to Remaining Workspace.",
    );
  });

  it("generates a one-time visible Workspace API key for owners without persisting the secret", async () => {
    const user = userEvent.setup();
    const generatedKey = "generated-secret-key";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const confirmSpy = vi.spyOn(window, "confirm");

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: [
              {
                id: "ws_1",
                name: "Research Workspace",
                role: "owner",
                has_api_key: false,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (
        url.endsWith("/workspaces/ws_1/api-key") &&
        options.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({ workspace_id: "ws_1", api_key: generatedKey, has_api_key: true }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Generate API Key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace API key generated and copied",
      );
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(generatedKey);
    expect(screen.getByDisplayValue(generatedKey)).toBeTruthy();
    const storedPayload = JSON.parse(window.localStorage.setItem.mock.calls.at(-1)[1]);
    expect(storedPayload).toEqual({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
    });
    expect(toastMock.success).not.toHaveBeenCalledWith(
      expect.stringContaining(generatedKey),
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      expect.stringContaining(generatedKey),
    );
  });

  it("confirms and rotates an existing Workspace API key for owners", async () => {
    const user = userEvent.setup();
    const rotatedKey = "rotated-secret-key";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: [
              {
                id: "ws_1",
                name: "Research Workspace",
                role: "owner",
                has_api_key: true,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (
        url.endsWith("/workspaces/ws_1/api-key") &&
        options.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({ workspace_id: "ws_1", api_key: rotatedKey, has_api_key: true }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Rotate API Key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace API key rotated and copied",
      );
    });
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(rotatedKey);
    expect(screen.getByDisplayValue(rotatedKey)).toBeTruthy();
    expect(toastMock.success).not.toHaveBeenCalledWith(
      expect.stringContaining(rotatedKey),
    );
  });

  it("keeps generated Workspace API key visible when clipboard copy needs manual retry", async () => {
    const user = userEvent.setup();
    const generatedKey = "manual-copy-secret-key";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
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
                role: "owner",
                has_api_key: false,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (
        url.endsWith("/workspaces/ws_1/api-key") &&
        options.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({ workspace_id: "ws_1", api_key: generatedKey, has_api_key: true }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Generate API Key" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace API key generated. Copy it before leaving this page.",
      );
    });
    expect(screen.getByDisplayValue(generatedKey)).toBeTruthy();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByRole("button", { name: "Copy API key" }));

    expect(writeText).toHaveBeenCalledWith(generatedKey);
  });

  it("keeps one-time visible Workspace API key material without a dismiss control", async () => {
    const user = userEvent.setup();
    const generatedKey = "dismiss-secret-key";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
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
                role: "owner",
                has_api_key: false,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (
        url.endsWith("/workspaces/ws_1/api-key") &&
        options.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({ workspace_id: "ws_1", api_key: generatedKey, has_api_key: true }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Generate API Key" }));
    expect(await screen.findByDisplayValue(generatedKey)).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Dismiss API key" })).toBeNull();
    expect(screen.getByDisplayValue(generatedKey)).toBeTruthy();
  });

  it("shows Workspace API key display to members without an actionable generate control", async () => {
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

    expect(await screen.findByLabelText("Workspace API key")).toBeTruthy();
    expect(screen.getByPlaceholderText("Generate an API key to view")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate API Key" }).disabled).toBe(
      true,
    );
  });

  it("confirms explicit Workspace creation", async () => {
    const user = userEvent.setup();
    let created = false;

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces") && options.method === "POST") {
        created = true;
        return Promise.resolve(
          jsonResponse({
            workspace_id: "ws_2",
            name: "New Workspace",
            api_key: "imgx_live_new_workspace_key",
          }),
        );
      }
      if (url.endsWith("/workspaces") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: [
              {
                id: "ws_1",
                name: "Research Workspace",
                role: "owner",
                created_at: "2026-01-01T00:00:00.000Z",
              },
              ...(created
                ? [
                    {
                      id: "ws_2",
                      name: "New Workspace",
                      role: "owner",
                      created_at: "2026-01-02T00:00:00.000Z",
                    },
                  ]
                : []),
            ],
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
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /New Workspace/ }).className).toContain(
        "active",
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

    await screen.findByRole("button", { name: /Research Workspace/ });

    await user.clear(screen.getByLabelText("Workspace name"));
    await user.type(screen.getByLabelText("Workspace name"), "Clinical Workspace");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace renamed: Clinical Workspace",
      );
    });
  });

  it("preserves visible Document data when renaming the current Workspace", async () => {
    const user = userEvent.setup();
    let renamed = false;

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({ jobs: [failedDocument()], next_cursor: null }),
        );
      }
      if (url.endsWith("/workspaces/ws_1") && options.method === "PATCH") {
        renamed = true;
        return Promise.resolve(jsonResponse({ id: "ws_1", name: "Clinical Workspace" }));
      }
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(
          jsonResponse({
            workspaces: [
              {
                id: "ws_1",
                name: renamed ? "Clinical Workspace" : "Research Workspace",
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

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "invoice.pdf" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Workspaces/ }));
    await user.clear(screen.getByLabelText("Workspace name"));
    await user.type(screen.getByLabelText("Workspace name"), "Clinical Workspace");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace renamed: Clinical Workspace",
      );
    });
    expect(screen.getByRole("button", { name: "Documents1" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    expect(screen.getByRole("heading", { name: "invoice.pdf" })).toBeTruthy();
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

    await screen.findByRole("button", { name: /Research Workspace/ });

    await user.click(screen.getByRole("button", { name: "Leave Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Workspace left. Replacement personal Workspace created.",
      );
    });
  });

  it("confirms Workspace deletion and selects a remaining Workspace", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let workspaceListCalls = 0;

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces") && options.method === "GET") {
        workspaceListCalls += 1;
        return Promise.resolve(
          jsonResponse({
            workspaces:
              workspaceListCalls === 1
                ? [
                    {
                      id: "ws_1",
                      name: "Research Workspace",
                      role: "owner",
                      created_at: "2026-01-01T00:00:00.000Z",
                    },
                    {
                      id: "ws_2",
                      name: "Remaining Workspace",
                      role: "owner",
                      created_at: "2026-01-02T00:00:00.000Z",
                    },
                  ]
                : [
                    {
                      id: "ws_2",
                      name: "Remaining Workspace",
                      role: "owner",
                      created_at: "2026-01-02T00:00:00.000Z",
                    },
                  ],
          }),
        );
      }
      if (url.endsWith("/workspaces/ws_1") && options.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ok: true, workspace_id: "ws_1" }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await screen.findByRole("button", { name: /Research Workspace/ });

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Workspace deleted");
    });
    expect(await screen.findByRole("button", { name: /Remaining Workspace/ })).toBeTruthy();
  });

  it("stays quiet when Workspace deletion confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<App />);

    await screen.findByRole("button", { name: /Research Workspace/ });

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

  it("uses the signed-in session and accepted Workspace context for product requests", async () => {
    render(<App />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/templates",
        expect.objectContaining({ method: "GET" }),
      );
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
    let resolveSecondWorkspaceJobs;
    const secondWorkspaceJobs = new Promise((resolve) => {
      resolveSecondWorkspaceJobs = resolve;
    });

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "ws_2",
          name: "Clinical Workspace",
          role: "admin",
          created_at: "2026-01-02T00:00:00.000Z",
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
                role: "owner",
                created_at: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "ws_2",
                name: "Clinical Workspace",
                role: "admin",
                created_at: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        const headers = new Headers(options.headers || {});
        if (headers.get("x-workspace-id") === "ws_2") {
          return secondWorkspaceJobs;
        }
        return Promise.resolve(
          jsonResponse({
            jobs: [failedDocument({ job_id: "job_ws_1", source_name: "research.pdf" })],
            next_cursor: null,
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "research.pdf" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Workspaces/ }));
    await user.click(screen.getByRole("button", { name: /Clinical Workspace/ }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "research.pdf" })).toBeNull();
      expect(screen.getByRole("button", { name: "Documents0" })).toBeTruthy();
    });

    resolveSecondWorkspaceJobs(
      jsonResponse({
        jobs: [failedDocument({ job_id: "job_ws_2", source_name: "clinical.pdf" })],
        next_cursor: null,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "clinical.pdf" })).toBeTruthy();
  });

  it("hides Workspace users placeholder while switching accepted Workspaces", async () => {
    const user = userEvent.setup();
    let resolveSecondWorkspaceUsers;
    const secondWorkspaceUsers = new Promise((resolve) => {
      resolveSecondWorkspaceUsers = resolve;
    });

    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      userWorkspaces: [
        {
          id: "ws_1",
          name: "Research Workspace",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "ws_2",
          name: "Clinical Workspace",
          role: "admin",
          created_at: "2026-01-02T00:00:00.000Z",
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
                role: "owner",
                created_at: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "ws_2",
                name: "Clinical Workspace",
                role: "admin",
                created_at: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/workspaces/ws_1/users") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ users: [workspaceMember()] }));
      }
      if (url.endsWith("/workspaces/ws_2/users") && (!options.method || options.method === "GET")) {
        return secondWorkspaceUsers;
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    expect(await screen.findByText("Grace Hopper")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /Clinical Workspace/ }));

    await waitFor(() => {
      expect(screen.queryByText("Grace Hopper")).toBeNull();
      expect(screen.queryByText("No workspace users found.")).toBeNull();
      expect(screen.queryByText("Loading workspace users...")).toBeNull();
    });

    resolveSecondWorkspaceUsers(
      jsonResponse({
        users: [
          workspaceMember({
            user_id: "user_3",
            name: "Katherine Johnson",
            email: "katherine@example.com",
          }),
        ],
      }),
    );

    expect(await screen.findByText("Katherine Johnson")).toBeTruthy();
  });

  it("does not send product requests with a synthetic fallback Workspace ID", async () => {
    installLocalStorage({ apiKey: "imgx_live_legacy_key" });

    render(<App />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces",
        expect.objectContaining({ method: "GET" }),
      );
    });

    const productRequests = globalThis.fetch.mock.calls.filter(([url]) =>
      ["/v1/templates", "/v1/jobs"].some((path) => String(url).startsWith(path)),
    );

    expect(productRequests).not.toEqual([]);
    for (const [, options] of productRequests) {
      expect(options.headers.get("x-workspace-id")).not.toBe("workspace_local_default");
    }
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

    await user.click(screen.getByRole("button", { name: "+ Invite user" }));
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

    await user.click(screen.getByRole("button", { name: "+ Invite user" }));
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
        return Promise.resolve(jsonResponse({ error: "Database internal detail" }, { status: 500 }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "+ Invite user" }));
    await user.type(screen.getByLabelText("Invite email"), "grace@example.com");
    await user.click(screen.getByRole("button", { name: "Invite User" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Workspace invitation could not be created. Please try again.",
      );
    });
    expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringContaining("Database"));
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

    await user.click(await screen.findByRole("button", { name: /Clinical Workspace/ }));
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

    await user.click(await screen.findByRole("button", { name: /Clinical Workspace/ }));
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

    await user.click(await screen.findByRole("button", { name: /Clinical Workspace/ }));
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

    await user.click(await screen.findByRole("button", { name: /Clinical Workspace/ }));
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
    await user.click(screen.getByRole("button", { name: "Save new template" }));

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

    const saveButton = await screen.findByRole("button", { name: "Save changes" });
    expect(saveButton.disabled).toBe(true);

    await user.clear(screen.getByLabelText("Template name"));
    await user.type(screen.getByLabelText("Template name"), "Updated Discharge Summary");

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
    await user.click(screen.getByRole("button", { name: "+ Add field" }));

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save new template" }));

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
    await screen.findByRole("button", { name: "Save changes" });

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
    await user.click(screen.getByRole("button", { name: "View JSON" }));
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
    await user.click(screen.getByRole("button", { name: "View JSON" }));
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
    await user.click(screen.getByRole("button", { name: "View JSON" }));
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
    let workspaceContextRefreshes = 0;

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/templates")) {
        return Promise.resolve(jsonResponse({ templates: [template] }));
      }
      if (url.endsWith("/extract") && options.method === "POST") {
        extractFormData = options.body;
        return Promise.resolve(jsonResponse({ job_id: "job_upload_1" }));
      }
      if (url.endsWith("/workspaces/ws_1/context")) {
        workspaceContextRefreshes += 1;
        return Promise.resolve(jsonResponse({
          workspace: {
            id: "ws_1",
            name: "Research Workspace",
            role: "owner",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        }));
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
    expect(screen.getByText("Success")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Documents1" })).toBeTruthy();
    await waitFor(() => {
      expect(workspaceContextRefreshes).toBe(1);
    });
    expect(toastMock.success).not.toHaveBeenCalledWith(
      expect.stringContaining("Workspace access changed"),
    );
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

  it("keeps polling while a selected document is processing when live updates are unavailable", async () => {
    vi.stubGlobal("WebSocket", undefined);
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
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [
              {
                job_id: "job_processing_1",
                status: "processing",
                source_name: "invoice.pdf",
                template_id: "tpl_document",
                updated_at: "2026-01-03T00:00:01.000Z",
              },
            ],
            next_cursor: null,
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await waitFor(() => {
      expect(timeoutSpy.mock.calls.some(([, delay]) => delay >= 5000 && delay <= 6000)).toBe(true);
    });
  });

  it("does not poll obsolete lifecycle metadata as an Extraction job lifecycle state", async () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      apiKey: "imgx_live_existing_key",
      apiKeysByWorkspace: {
        ws_1: "imgx_live_existing_key",
      },
      selectedDocumentId: "job_legacy_unknown_1",
      jobHistory: [
        {
          job_id: "job_legacy_unknown_1",
          status: "legacy_unknown",
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
                job_id: "job_legacy_unknown_1",
                status: "legacy_unknown",
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
      if (url.endsWith("/jobs/job_legacy_unknown_1")) {
        return Promise.resolve(
          jsonResponse({
            job_id: "job_legacy_unknown_1",
            status: "legacy_unknown",
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
        expect.stringContaining("/jobs/job_legacy_unknown_1"),
        expect.any(Object),
      );
    });
    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it("stores completed Extraction job details after the Document details load", async () => {
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [completedDocument({ results: [] })],
            next_cursor: null,
          }),
        );
      }
      if (url.endsWith("/jobs/job_completed_1")) {
        return Promise.resolve(
          jsonResponse(
            completedDocument({
              source_preview_url: "blob:http://localhost/source-preview",
              results: [
                {
                  field_id: "total",
                  name: "Total",
                  status: "found",
                  answer: "$42.00",
                },
              ],
            }),
          ),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

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
      {
        workspaceId: "ws_1",
        workspaceName: "Research Workspace",
      },
      {
        [COMPLETED_DOCUMENT_CACHE_STORAGE_KEY]: JSON.stringify({
          ws_1: [
            completedDocument({
              results: [
                {
                  field_id: "total",
                  name: "Total",
                  status: "found",
                  answer: "$42.00",
                },
              ],
            }),
          ],
        }),
      },
    );
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [completedDocument({ results: [] })],
            next_cursor: null,
          }),
        );
      }
      if (url.endsWith("/jobs/job_completed_1")) {
        return new Promise(() => {});
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /Documents/ }));

    expect(await screen.findByText("$42.00")).toBeTruthy();
  });

  it("clears selected Document when backend refresh no longer lists it", async () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      selectedDocumentId: "job_missing",
      jobHistory: [failedDocument({ job_id: "job_missing", source_name: "missing.pdf" })],
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
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(jsonResponse({ jobs: [], next_cursor: null }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Documents0" })).toBeTruthy();
    });
    await userEvent.click(screen.getByRole("button", { name: /Documents/ }));
    expect(screen.getByText("No documents uploaded yet.")).toBeTruthy();
  });

  it("selects the first available Document when the previous selection disappears", async () => {
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
      selectedDocumentId: "job_missing",
      jobHistory: [failedDocument({ job_id: "job_missing", source_name: "missing.pdf" })],
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
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [failedDocument({ job_id: "job_available", source_name: "available.pdf" })],
            next_cursor: null,
          }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Documents1" })).toBeTruthy();
    });
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
        return Promise.resolve(jsonResponse({ deleted: true, job_id: "job_failed_1" }));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Document deleted: invoice.pdf");
    });
    expect(screen.queryByText("job_failed_1")).toBeNull();
  });

  it("deletes all ticked documents as one bulk action", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const deletedDocumentIds = [];

    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [
              failedDocument(),
              failedDocument({ job_id: "job_failed_2", source_name: "receipt.pdf" }),
            ],
            next_cursor: null,
          }),
        );
      }
      const deletedDocumentId = ["job_failed_1", "job_failed_2"].find(
        (documentId) =>
          url.endsWith(`/jobs/${documentId}`) && options.method === "DELETE",
      );
      if (deletedDocumentId) {
        deletedDocumentIds.push(deletedDocumentId);
        return Promise.resolve(
          jsonResponse({ deleted: true, job_id: deletedDocumentId }),
        );
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await user.click(
      screen.getByRole("checkbox", { name: "Select all available documents" }),
    );
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
    const createObjectURL = vi.fn(() => "blob:single-export");
    const revokeObjectURL = vi.fn();
    const NativeURL = globalThis.URL;
    class ExportURL extends NativeURL {}
    ExportURL.createObjectURL = createObjectURL;
    ExportURL.revokeObjectURL = revokeObjectURL;
    vi.stubGlobal("URL", ExportURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const requestedIds = [];
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs/export") && options.method === "POST") {
        requestedIds.push(...JSON.parse(options.body).job_ids);
        return Promise.resolve(new Response("xlsx", { headers: { "x-exported-job-count": "1" } }));
      }
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse({ jobs: [completedDocument()], next_cursor: null }));
      if (url.endsWith("/jobs/job_completed_1")) return Promise.resolve(jsonResponse(completedDocument()));
      return mockWorkspaceFetch(input, options);
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await screen.findByRole("checkbox", { name: "Select document job_completed_1" });
    await user.click(screen.getByRole("button", { name: "Export", exact: true }));
    await waitFor(() => expect(requestedIds).toEqual(["job_completed_1"]));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:single-export");
  });

  it("exports checked terminal jobs while skipping and locking in-progress selections", async () => {
    const user = userEvent.setup();
    const NativeURL = globalThis.URL;
    const createObjectURL = vi.fn(() => "blob:job-export");
    const revokeObjectURL = vi.fn();
    class ExportURL extends NativeURL {}
    ExportURL.createObjectURL = createObjectURL;
    ExportURL.revokeObjectURL = revokeObjectURL;
    vi.stubGlobal("URL", ExportURL);
    let downloaded = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
      downloaded = { href: this.href, filename: this.download };
    });

    let resolveExport;
    const exportResponse = new Promise((resolve) => {
      resolveExport = resolve;
    });
    const requestedExportIds = [];
    globalThis.fetch.mockImplementation((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/jobs/export") && options.method === "POST") {
        requestedExportIds.push(...JSON.parse(options.body).job_ids);
        return exportResponse;
      }
      if (url.endsWith("/jobs") && (!options.method || options.method === "GET")) {
        return Promise.resolve(
          jsonResponse({
            jobs: [
              completedDocument(),
              completedDocument({
                job_id: "job_processing_1",
                source_name: "processing.pdf",
                status: "processing",
                completed_at: null,
              }),
              failedDocument({ job_id: "job_failed_1" }),
            ],
            next_cursor: null,
          }),
        );
      }
      if (url.endsWith("/jobs/job_completed_1") && options.method === "GET") {
        return Promise.resolve(jsonResponse(completedDocument()));
      }
      return mockWorkspaceFetch(input, options);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /Documents/ }));
    await user.click(
      await screen.findByRole("checkbox", { name: "Select all available documents" }),
    );
    const exportButton = screen.getByRole("button", { name: "Export 3" });
    expect(exportButton.title).toContain("2 of 3 selected documents are ready");
    expect(screen.getByRole("button", { name: "Delete 3" }).disabled).toBe(
      false,
    );

    await user.click(exportButton);

    expect(requestedExportIds).toEqual([
      "job_completed_1",
      "job_processing_1",
      "job_failed_1",
    ]);
    expect(screen.getByRole("button", { name: "Exporting..." }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Delete 3" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole("checkbox", { name: "Select document job_completed_1" }).disabled).toBe(
      true,
    );

    await act(async () => {
      resolveExport(
        new Response("xlsx-bytes", {
          status: 200,
          headers: {
            "content-disposition":
              'attachment; filename="research-workspace-job-export-2026-08-16-1430.xlsx"',
            "content-type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "x-exported-job-count": "2",
            "x-skipped-job-count": "1",
          },
        }),
      );
      await exportResponse;
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
    expect(downloadBlob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:job-export");
    expect(screen.getByRole("button", { name: "Export 3" }).disabled).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Select document job_completed_1" }).checked).toBe(
      true,
    );
    expect(screen.getByRole("checkbox", { name: "Select document job_processing_1" }).checked).toBe(
      true,
    );
    expect(screen.getByRole("checkbox", { name: "Select document job_failed_1" }).checked).toBe(
      true,
    );
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
    await user.click(screen.getByRole("button", { name: "Delete" }));

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
    await user.click(screen.getByRole("button", { name: "Delete" }));

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

function mockWorkspaceFetch(input) {
  if (String(input).endsWith("/model-configuration")) return Promise.resolve(jsonResponse({ configured: true, credential_status: "configured", gateway_url: "http://localhost:1/v1", model_name: "test/model", revision: 1 }));
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
