import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceController } from "./useWorkspaceController";

const workspaces = [
  { id: "workspace_a", name: "Workspace A", role: "owner" },
  { id: "workspace_b", name: "Workspace B", role: "owner" },
];

function deferred() {
  let resolve, reject;

  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

function setup(contextRequest) {
  const coreRequest = vi.fn(async (path) => {
    if (path.endsWith("/context")) return contextRequest.promise;

    if (path === "/workspaces") return { workspaces };

    return { invitations: [], users: [] };
  });

  const props = {
    coreRequest,
    hasSession: true,
    sessionUserId: "user_1",
    sessionId: "session_1",
    showActionToast: vi.fn(),
    onActivePageChange: vi.fn(),
    onClearWorkspaceScopedData: vi.fn(),
  };

  return { ...renderHook((value) => useWorkspaceController(value), { initialProps: props }), props, coreRequest };
}

describe("workspace refresh scope", () => {
  beforeEach(() => window.localStorage.clear());

  it.each(["success", "forbidden"])("ignores a delayed %s after switching away and back", async (outcome) => {
    const pending = deferred();
    const { result, coreRequest } = setup(pending);
    await waitFor(() => expect(result.current.context.workspaceId).toBe("workspace_a"));
    let refresh;
    act(() => {
      refresh = result.current.actions.refreshSelectedWorkspaceContext();
    });
    act(() => result.current.sidebar.onSelectAcceptedWorkspace(workspaces[1]));
    act(() => result.current.sidebar.onSelectAcceptedWorkspace(workspaces[0]));
    const callsBeforeResponse = coreRequest.mock.calls.length;
    await act(async () => {
      if (outcome === "success") pending.resolve({ workspace: { ...workspaces[0], name: "Stale name" } });
      else pending.reject(Object.assign(new Error("Removed"), { status: 403 }));
      await refresh;
    });
    expect(result.current.context.workspaceName).toBe("Workspace A");
    expect(coreRequest.mock.calls.length).toBe(callsBeforeResponse);
  });

  it("does not restore context after logout", async () => {
    const pending = deferred();
    const { result, rerender, props } = setup(pending);
    await waitFor(() => expect(result.current.context.workspaceId).toBe("workspace_a"));
    let refresh;
    act(() => {
      refresh = result.current.actions.refreshSelectedWorkspaceContext();
    });
    act(() => result.current.actions.clearSessionWorkspaceData());
    rerender({ ...props, hasSession: false, sessionId: "", sessionUserId: "" });
    await act(async () => {
      pending.resolve({ workspace: workspaces[0] });
      await refresh;
    });
    expect(result.current.context.workspaceId).toBe("");
    expect(result.current.context.availableWorkspaces).toEqual([]);
  });

  it("discards a refresh from a previous session even for the same user and workspace", async () => {
    const pending = deferred();
    const { result, rerender, props } = setup(pending);
    await waitFor(() => expect(result.current.context.workspaceId).toBe("workspace_a"));
    let refresh;
    act(() => {
      refresh = result.current.actions.refreshSelectedWorkspaceContext();
    });
    rerender({ ...props, sessionId: "session_2" });
    await waitFor(() => expect(result.current.context.isWorkspaceContextLoading).toBe(false));
    await act(async () => {
      pending.resolve({ workspace: { ...workspaces[0], name: "Old session" } });
      await refresh;
    });
    expect(result.current.context.workspaceName).toBe("Workspace A");
  });
});

describe("workspace creation permission", () => {
  beforeEach(() => window.localStorage.clear());

  function renderWith(workspaceList) {
    const coreRequest = vi.fn(async (path) => (path === "/workspaces" ? workspaceList : { invitations: [], users: [] }));

    const props = {
      coreRequest,
      hasSession: true,
      sessionUserId: "user_1",
      sessionId: "session_1",
      showActionToast: vi.fn(),
      onActivePageChange: vi.fn(),
      onClearWorkspaceScopedData: vi.fn(),
    };

    return renderHook((value) => useWorkspaceController(value), { initialProps: props });
  }

  it("allows creation when an older server doesn't say", async () => {
    const { result } = renderWith({ workspaces });

    await waitFor(() => expect(result.current.context.workspaceId).toBe("workspace_a"));
    expect(result.current.toolbar.canCreateWorkspace).toBe(true);
  });

  it("follows the server and resets on sign-out", async () => {
    const { result } = renderWith({ workspaces: [{ ...workspaces[0], role: "member" }], can_create_workspaces: false });

    await waitFor(() => expect(result.current.toolbar.canCreateWorkspace).toBe(false));
    expect(result.current.toolbar.workspacePrimaryAction.unavailableReason).toBe("You can't leave your only workspace.");

    act(() => result.current.actions.clearSessionWorkspaceData());
    expect(result.current.toolbar.canCreateWorkspace).toBe(true);
  });
});

describe("invite links", () => {
  beforeEach(() => window.localStorage.clear());

  function renderInvitationRoute({ email, sessionUserEmail = "ada@example.com", canCreateWorkspaces }) {
    const onWorkspaceNavigation = vi.fn();

    const coreRequest = vi.fn(async (path) =>
      path === "/workspaces"
        ? { workspaces: [{ id: "ws_invited", name: "Invited", role: "member" }], can_create_workspaces: canCreateWorkspaces }
        : { invitations: [], users: [] },
    );

    const { result } = renderHook(() =>
      useWorkspaceController({
        coreRequest,
        hasSession: true,
        sessionUserId: "user_1",
        sessionId: "session_1",
        sessionUserEmail,
        requestedInvitationId: "inv_1",
        requestedInvitationEmail: email,
        onWorkspaceNavigation,
        showActionToast: vi.fn(),
        onActivePageChange: vi.fn(),
        onClearWorkspaceScopedData: vi.fn(),
      }),
    );

    return { result, onWorkspaceNavigation };
  }

  it("opens the joined workspace when the invitation was accepted at first sign-in", async () => {
    const { result, onWorkspaceNavigation } = renderInvitationRoute({ email: "ADA@example.com", canCreateWorkspaces: false });

    await waitFor(() =>
      expect(onWorkspaceNavigation).toHaveBeenCalledWith("ws_invited", { force: true, replace: true }),
    );
    expect(result.current.context.unavailableRoute).toBe(false);
  });

  it.each([
    ["someone who can create workspaces", { email: "ada@example.com", canCreateWorkspaces: true }],
    ["a link for another address", { email: "grace@example.com", canCreateWorkspaces: false }],
  ])("reports the invitation unavailable for %s", async (_, route) => {
    const { result, onWorkspaceNavigation } = renderInvitationRoute(route);

    await waitFor(() => expect(result.current.context.unavailableRoute).toBe(true));
    expect(onWorkspaceNavigation).not.toHaveBeenCalled();
  });
});

describe("invitation emails", () => {
  beforeEach(() => window.localStorage.clear());

  const pending = {
    id: "inv_1",
    email: "grace@example.com",
    role: "member",
    status: "pending",
    invite_url: "https://studio.example.com/invitations/inv_1?email=grace%40example.com",
    expired: true,
    email_last_sent_at: "2026-01-01T00:00:00.000Z",
    email_resends_remaining: 3,
    email_resend_available_at: null,
    expires_at: "2026-01-08T00:00:00.000Z",
  };

  function renderOwner(handle) {
    const showActionToast = vi.fn();

    const coreRequest = vi.fn(async (path, options = {}) => {
      const handled = await handle?.(path, options);

      if (handled !== undefined) return handled;

      if (path === "/workspaces") return { workspaces: [workspaces[0]] };

      if (path === "/workspaces/workspace_a/invitations") return { invitations: [pending] };

      return { invitations: [], users: [] };
    });

    const view = renderHook(() =>
      useWorkspaceController({
        coreRequest,
        hasSession: true,
        sessionUserId: "user_1",
        sessionId: "session_1",
        showActionToast,
        onActivePageChange: vi.fn(),
        onClearWorkspaceScopedData: vi.fn(),
      }),
    );

    return { ...view, coreRequest, showActionToast };
  }

  it("keeps a new invitation's link and its email outcome until dismissed", async () => {
    const { result, showActionToast } = renderOwner((path, options) =>
      path === "/workspaces/workspace_a/invitations" && options.method === "POST"
        ? { ...pending, expired: false, email_delivery: { status: "failed" } }
        : undefined,
    );

    await waitFor(() => expect(result.current.acceptedPage.workspaceInvitations).toHaveLength(1));
    act(() => result.current.acceptedPage.onInviteEmailChange("grace@example.com"));
    await act(() => result.current.acceptedPage.onInviteUser());

    expect(showActionToast).toHaveBeenCalledWith("workspaceInvitation.create", "warning", {
      targetEmail: "grace@example.com",
      delivery: "failed",
    });
    expect(result.current.acceptedPage.createdInvitation).toEqual({
      email: "grace@example.com",
      inviteUrl: pending.invite_url,
      delivery: "failed",
    });

    act(() => result.current.actions.dismissCreatedInvitation());
    expect(result.current.acceptedPage.createdInvitation).toBeNull();
  });

  it("renews a resent invitation in place without reloading the list", async () => {
    const renewed = { ...pending, expired: false, expires_at: "2026-12-30T00:00:00.000Z", email_resends_remaining: 2 };

    const { result, coreRequest, showActionToast } = renderOwner((path, options) =>
      path === "/workspaces/workspace_a/invitations/inv_1" && options.method === "POST"
        ? { ...renewed, email_delivery: { status: "sent" } }
        : undefined,
    );

    await waitFor(() => expect(result.current.acceptedPage.workspaceInvitations).toHaveLength(1));
    const listCalls = coreRequest.mock.calls.filter(([path]) => path === "/workspaces/workspace_a/invitations").length;

    await act(() => result.current.acceptedPage.onResendWorkspaceInvitation(pending));

    expect(result.current.acceptedPage.workspaceInvitations).toEqual([renewed]);
    expect(showActionToast).toHaveBeenCalledWith("workspaceInvitation.resend", "success", {
      targetEmail: "grace@example.com",
      delivery: "sent",
    });
    expect(coreRequest.mock.calls.filter(([path]) => path === "/workspaces/workspace_a/invitations")).toHaveLength(
      listCalls,
    );
    expect(result.current.acceptedPage.resendingInvitationId).toBe("");
  });

  it("reloads the list when the invitation changed elsewhere", async () => {
    const { result, coreRequest, showActionToast } = renderOwner((path, options) =>
      path === "/workspaces/workspace_a/invitations/inv_1" && options.method === "POST"
        ? Promise.reject(Object.assign(new Error("gone"), { status: 404, code: "not_found" }))
        : undefined,
    );

    await waitFor(() => expect(result.current.acceptedPage.workspaceInvitations).toHaveLength(1));
    const listCalls = coreRequest.mock.calls.filter(([path]) => path === "/workspaces/workspace_a/invitations").length;

    await act(() => result.current.acceptedPage.onResendWorkspaceInvitation(pending));

    expect(showActionToast).toHaveBeenCalledWith(
      "workspaceInvitation.resend",
      "failure",
      expect.objectContaining({ targetEmail: "grace@example.com", error: expect.any(Error) }),
    );
    await waitFor(() =>
      expect(coreRequest.mock.calls.filter(([path]) => path === "/workspaces/workspace_a/invitations")).toHaveLength(
        listCalls + 1,
      ),
    );
  });
});
