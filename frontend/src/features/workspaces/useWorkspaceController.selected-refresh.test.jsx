import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import { clearPersistedWorkspace, useWorkspaceController } from "./useWorkspaceController";

describe("useWorkspaceController selected Workspace context refresh", () => {
  afterEach(() => {
    cleanup();
    clearPersistedWorkspace();
    vi.restoreAllMocks();
  });

  it("merges selected Workspace context refresh without fetching pending Workspace invitations", async () => {
    let controller = null;
    const request = vi.fn(async (path) => {
      if (path === "/workspaces") {
        return {
          workspaces: [
            workspaceEntry({
              billing_operational_status: { status: "active", blocking_reasons: [] },
              billing_usage_summary: { remaining_credits: 10, remaining_pages: 100 },
            }),
          ],
        };
      }
      if (path === "/invitations") {
        return { invitations: [{ id: "invite_1", workspace_id: "ws_invited" }] };
      }
      if (path === "/workspaces/ws_1/users") {
        return { users: [] };
      }
      if (path === "/workspaces/ws_1/context") {
        return {
          workspace: workspaceEntry({
            billing_operational_status: {
              status: "blocked",
              blocking_reasons: ["Insufficient Credits"],
            },
            billing_usage_summary: { remaining_credits: 0, remaining_pages: 100 },
          }),
        };
      }
      throw new Error(`Unhandled request path: ${path}`);
    });

    render(
      <WorkspaceControllerHarness
        request={request}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );

    await waitFor(() => {
      expect(controller?.context.workspaceId).toBe("ws_1");
    });
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "/workspaces/ws_1/users",
        expect.objectContaining({ method: "GET" }),
      );
    });
    request.mockClear();

    await act(async () => {
      await controller.actions.refreshSelectedWorkspaceContext();
    });

    expect(controller.context.billingOperationalStatus).toEqual({
      status: "blocked",
      blocking_reasons: ["Insufficient Credits"],
    });
    expect(controller.context.billingUsageSummary).toEqual({
      remaining_credits: 0,
      remaining_pages: 100,
    });
    expect(request).toHaveBeenCalledWith(
      "/workspaces/ws_1/context",
      expect.objectContaining({ method: "GET" }),
    );
    expect(request).not.toHaveBeenCalledWith(
      "/invitations",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("falls back to full Workspace-list recovery when selected Workspace context refresh is forbidden", async () => {
    let controller = null;
    let workspaceListRequests = 0;
    const request = vi.fn(async (path) => {
      if (path === "/workspaces") {
        workspaceListRequests += 1;
        return {
          workspaces:
            workspaceListRequests === 1
              ? [workspaceEntry({ id: "ws_1", name: "Research" })]
              : [workspaceEntry({ id: "ws_2", name: "Recovered Workspace" })],
        };
      }
      if (path === "/invitations") {
        return { invitations: [] };
      }
      if (path === "/workspaces/ws_1/users" || path === "/workspaces/ws_2/users") {
        return { users: [] };
      }
      if (path === "/workspaces/ws_1/context") {
        const error = new Error("You do not have access to this workspace");
        error.status = 403;
        error.code = "forbidden";
        throw error;
      }
      throw new Error(`Unhandled request path: ${path}`);
    });

    render(
      <WorkspaceControllerHarness
        request={request}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );

    await waitFor(() => {
      expect(controller?.context.workspaceId).toBe("ws_1");
    });
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "/workspaces/ws_1/users",
        expect.objectContaining({ method: "GET" }),
      );
    });
    request.mockClear();

    await act(async () => {
      await controller.actions.refreshSelectedWorkspaceContext();
    });

    await waitFor(() => {
      expect(controller.context.workspaceId).toBe("ws_2");
    });
    expect(request).toHaveBeenCalledWith(
      "/workspaces/ws_1/context",
      expect.objectContaining({ method: "GET" }),
    );
    expect(request).toHaveBeenCalledWith(
      "/workspaces",
      expect.objectContaining({ method: "GET" }),
    );
    expect(request).toHaveBeenCalledWith(
      "/invitations",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

function WorkspaceControllerHarness({ request, onController }) {
  const controller = useWorkspaceController({
    apiBase: "/v1",
    coreRequest: request,
    addLog: vi.fn(),
    showActionToast: vi.fn(),
    hasSession: true,
    sessionUserId: "user_test",
    isAppBusy: false,
    setBusy: vi.fn(),
    onActivePageChange: vi.fn(),
    onClearWorkspaceScopedData: vi.fn(),
    onClearCompletedDocumentCache: vi.fn(),
  });
  onController?.(controller);
  return null;
}

function workspaceEntry(overrides = {}) {
  return {
    id: "ws_1",
    name: "Research",
    created_at: "2026-05-06T12:00:00.000Z",
    max_source_file_bytes: null,
    has_api_key: false,
    role: "member",
    billing_plan_limits: {
      templates: 3,
      top_level_template_fields: 5,
      table_shaped_fields: 1,
      table_columns_per_field: 5,
      members: 3,
      monthly_pages: 500,
      api_access: false,
    },
    ...overrides,
  };
}
