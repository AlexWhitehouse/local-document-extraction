import { describe, expect, it } from "vitest";

import { getWorkspaceSelectionView } from "./workspaceSelection.js";

describe("workspace selection view", () => {
  it("resolves a selected workspace invitation to a locked pending detail view", () => {
    const view = getWorkspaceSelectionView({
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      hasApiAccess: true,
      canManageWorkspaceUsers: true,
      selectedWorkspaceInvitationId: "invitation_123",
      userWorkspaceInvitations: [
        {
          id: "invitation_123",
          workspace_id: "workspace_invited",
          workspace_name: "Invited Workspace",
          email: "invitee@example.com",
          role: "admin",
          status: "pending",
          inviter_display: "Pat Inviter",
          created_at: "2026-05-01T12:30:00.000Z",
          expires_at: "2026-05-08T12:30:00.000Z",
        },
      ],
    });

    expect(view).toEqual({
      type: "invitation",
      workspaceName: "Invited Workspace",
      hasWorkspaceApiAccess: false,
      canManageWorkspace: false,
      invitation: {
        id: "invitation_123",
        workspaceId: "workspace_invited",
        workspaceName: "Invited Workspace",
        email: "invitee@example.com",
        role: "admin",
        status: "pending",
        inviter: "Pat Inviter",
        invitedAt: "2026-05-01T12:30:00.000Z",
        expiresAt: "2026-05-08T12:30:00.000Z",
      },
    });
  });

  it("keeps workspace API and management state for an accepted workspace selection", () => {
    const view = getWorkspaceSelectionView({
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      hasApiAccess: true,
      canManageWorkspaceUsers: true,
      selectedWorkspaceInvitationId: "",
      userWorkspaceInvitations: [],
    });

    expect(view).toEqual({
      type: "workspace",
      workspaceName: "Accepted Workspace",
      hasWorkspaceApiAccess: true,
      canManageWorkspace: true,
      invitation: null,
    });
  });

  it("falls back to accepted workspace state for a stale selected invitation", () => {
    const view = getWorkspaceSelectionView({
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      hasApiAccess: true,
      canManageWorkspaceUsers: false,
      selectedWorkspaceInvitationId: "missing_invitation",
      userWorkspaceInvitations: [
        {
          id: "other_invitation",
          workspace_id: "workspace_other",
          workspace_name: "Other Workspace",
        },
      ],
    });

    expect(view).toEqual({
      type: "workspace",
      workspaceName: "Accepted Workspace",
      hasWorkspaceApiAccess: true,
      canManageWorkspace: false,
      invitation: null,
    });
  });
});
