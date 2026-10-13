import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceContextList } from "./WorkspaceContextList.jsx";

function listProps(overrides = {}) {
  return {
    routed: false,
    workspaces: [{ id: "workspace_a", name: "Intake" }],
    selectedWorkspaceId: "",
    selectedWorkspaceInvitationId: "",
    isLoading: false,
    hasResolutionError: false,
    onSelectAcceptedWorkspace: vi.fn(),
    onSelectInvitedWorkspace: vi.fn(),
    onRetryResolution: vi.fn(),
    ...overrides,
  };
}

describe("WorkspaceContextList", () => {
  it("shows a skeleton while Workspaces load", () => {
    render(<WorkspaceContextList {...listProps({ isLoading: true, workspaces: [] })} />);

    expect(screen.getByRole("status", { name: "Loading…" })).toBeTruthy();
    expect(screen.queryByText("No workspaces yet.")).toBeNull();
  });

  it("shows a resolution error with Try again instead of the empty message", async () => {
    const user = userEvent.setup();
    const onRetryResolution = vi.fn();
    render(<WorkspaceContextList {...listProps({ hasResolutionError: true, workspaces: [], onRetryResolution })} />);

    expect(screen.getByRole("alert").textContent).toContain("Workspaces couldn't be loaded.");
    expect(screen.queryByText("No workspaces yet.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryResolution).toHaveBeenCalledTimes(1);
  });

  it("has no search field; search lives in the command palette", () => {
    render(<WorkspaceContextList {...listProps()} />);

    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
