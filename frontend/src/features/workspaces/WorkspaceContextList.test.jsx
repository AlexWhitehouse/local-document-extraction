import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceContextList } from "./WorkspaceContextList.jsx";

describe("WorkspaceContextList", () => {
  it("lets users search and select accepted or invited Workspace entries", () => {
    const onSearchChange = vi.fn();
    const onSelectAcceptedWorkspace = vi.fn();
    const onSelectInvitedWorkspace = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <WorkspaceContextList
        search="clinical"
        workspaces={[
          { id: "ws_1", name: "Research Workspace", connected: true },
          {
            type: "invitation",
            id: "ws_invited",
            invitation_id: "inv_1",
            name: "Clinical Workspace",
            role: "member",
          },
        ]}
        selectedWorkspaceId="ws_1"
        selectedWorkspaceInvitationId=""
        isLoading={false}
        hasResolutionError={false}
        onSearchChange={onSearchChange}
        onSelectAcceptedWorkspace={onSelectAcceptedWorkspace}
        onSelectInvitedWorkspace={onSelectInvitedWorkspace}
        onRetryResolution={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Workspaces"), {
      target: { value: "research" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Research Workspacews_1Connected/ }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Clinical Workspacews_invitedInvited as Member/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy workspace ID ws_1" }));

    expect(onSearchChange).toHaveBeenCalledWith("research");
    expect(onSelectAcceptedWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ws_1" }),
    );
    expect(onSelectInvitedWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ invitation_id: "inv_1" }),
    );
    expect(
      screen.getByRole("button", { name: /Research Workspacews_1Connected/ })
        .className,
    ).toContain("active");
    expect(writeText).toHaveBeenCalledWith("ws_1");
  });

  it("shows Loading workspace context and retryable Workspace resolution errors", () => {
    const onRetryResolution = vi.fn();
    const { rerender } = render(
      <WorkspaceContextList
        search=""
        workspaces={[]}
        selectedWorkspaceId=""
        selectedWorkspaceInvitationId=""
        isLoading={true}
        hasResolutionError={false}
        onSearchChange={vi.fn()}
        onSelectAcceptedWorkspace={vi.fn()}
        onSelectInvitedWorkspace={vi.fn()}
        onRetryResolution={onRetryResolution}
      />,
    );

    expect(screen.getByText("Loading workspace context")).toBeTruthy();

    rerender(
      <WorkspaceContextList
        search=""
        workspaces={[]}
        selectedWorkspaceId=""
        selectedWorkspaceInvitationId=""
        isLoading={false}
        hasResolutionError={true}
        onSearchChange={vi.fn()}
        onSelectAcceptedWorkspace={vi.fn()}
        onSelectInvitedWorkspace={vi.fn()}
        onRetryResolution={onRetryResolution}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry Workspaces" }));

    expect(screen.getByText("Workspace resolution error")).toBeTruthy();
    expect(onRetryResolution).toHaveBeenCalledOnce();
  });
});
