import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceController } from "./useWorkspaceController";

const workspaces = [
  { id: "workspace_a", name: "Workspace A", role: "owner" },
  { id: "workspace_b", name: "Workspace B", role: "owner" },
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(contextRequest) {
  const coreRequest = vi.fn(async (path) => {
    if (path.endsWith("/context")) return contextRequest.promise;
    if (path === "/workspaces") return { workspaces };
    return { invitations: [], users: [] };
  });
  const props = {
    apiBase: "/v1", coreRequest, hasSession: true, sessionUserId: "user_1", sessionId: "session_1",
    addLog: vi.fn(), showActionToast: vi.fn(), setBusy: vi.fn(),
    onActivePageChange: vi.fn(), onClearWorkspaceScopedData: vi.fn(),
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
    act(() => { refresh = result.current.actions.refreshSelectedWorkspaceContext(); });
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
    act(() => { refresh = result.current.actions.refreshSelectedWorkspaceContext(); });
    act(() => result.current.actions.clearSessionWorkspaceData());
    rerender({ ...props, hasSession: false, sessionId: "", sessionUserId: "" });
    await act(async () => { pending.resolve({ workspace: workspaces[0] }); await refresh; });
    expect(result.current.context.workspaceId).toBe("");
    expect(result.current.context.availableWorkspaces).toEqual([]);
  });

  it("discards a refresh from a previous session even for the same user and workspace", async () => {
    const pending = deferred();
    const { result, rerender, props } = setup(pending);
    await waitFor(() => expect(result.current.context.workspaceId).toBe("workspace_a"));
    let refresh;
    act(() => { refresh = result.current.actions.refreshSelectedWorkspaceContext(); });
    rerender({ ...props, sessionId: "session_2" });
    await waitFor(() => expect(result.current.context.isWorkspaceContextLoading).toBe(false));
    await act(async () => { pending.resolve({ workspace: { ...workspaces[0], name: "Old session" } }); await refresh; });
    expect(result.current.context.workspaceName).toBe("Workspace A");
  });
});
