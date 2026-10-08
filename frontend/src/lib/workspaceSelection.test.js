import { describe, expect, it } from "vitest";

import {
  canShowWorkspaceUserAction,
  getWorkspaceContextDisplay,
  getWorkspaceMemberPermissions,
  getWorkspacePrimaryAction,
  getWorkspaceUserActions,
  resolveAcceptedWorkspace,
  selectAcceptedWorkspaceContext,
} from "./workspaceSelection.js";

function display(overrides = {}) {
  return getWorkspaceContextDisplay({
    hasApiAccess: true,
    workspaceId: "",
    workspaceName: "",
    selectedWorkspaceInvitationId: "",
    userWorkspaces: [],
    userWorkspaceInvitations: [],
    ...overrides,
  });
}

describe("workspace context display", () => {
  it("lists accepted Workspaces before pending Workspace invitations, newest invitation first", () => {
    const { availableWorkspaces } = display({
      workspaceId: "workspace_beta",
      workspaceName: "Beta Workspace",
      userWorkspaces: [
        { id: "workspace_beta", name: "Beta Workspace", role: "owner" },
        { id: "workspace_alpha", role: "member" },
      ],
      userWorkspaceInvitations: [
        {
          id: "invitation_older",
          workspace_id: "workspace_invited_old",
          workspace_name: "Older Invitation",
          role: "admin",
          updated_at: "2026-05-01T12:00:00.000Z",
        },
        {
          id: "invitation_newer",
          workspace_id: "workspace_invited_new",
          workspace_name: "Newer Invitation",
          role: "member",
          updated_at: "2026-05-03T12:00:00.000Z",
        },
      ],
    });

    expect(availableWorkspaces).toEqual([
      { id: "workspace_beta", name: "Beta Workspace", connected: true, type: "workspace", role: "owner" },
      { id: "workspace_alpha", name: "Untitled workspace", connected: false, type: "workspace", role: "member" },
      {
        id: "workspace_invited_new",
        invitation_id: "invitation_newer",
        name: "Newer Invitation",
        connected: false,
        type: "invitation",
        role: "member",
        email: "",
        inviter_name: "",
        inviter_email: "",
        inviter_display: "",
        updated_at: "2026-05-03T12:00:00.000Z",
      },
      {
        id: "workspace_invited_old",
        invitation_id: "invitation_older",
        name: "Older Invitation",
        connected: false,
        type: "invitation",
        role: "admin",
        email: "",
        inviter_name: "",
        inviter_email: "",
        inviter_display: "",
        updated_at: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("aligns the Workspace name with the selected accepted Workspace", () => {
    const result = display({
      workspaceId: "workspace_selected",
      workspaceName: "Persisted Stale Name",
      userWorkspaces: [
        { id: "workspace_other", name: "Other Workspace" },
        { id: "workspace_selected", name: "Selected Workspace" },
      ],
    });

    expect(result.selectedWorkspaceName).toBe("Selected Workspace");
    expect(result.workspaceSelectionView.workspaceName).toBe("Selected Workspace");
  });

  it("does not invent an accepted Workspace entry when no accepted Workspaces or invitations exist", () => {
    expect(display({ hasApiAccess: false })).toEqual({
      availableWorkspaces: [],
      selectedWorkspaceName: "",
      selectedWorkspaceInvitationId: "",
      workspaceSelectionView: {
        type: "workspace",
        workspaceName: "Local workspace",
        hasWorkspaceApiAccess: false,
        invitation: null,
      },
    });
  });

  it("selects a pending Workspace invitation as a locked Workspace context", () => {
    const result = display({
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      selectedWorkspaceInvitationId: "invitation_123",
      userWorkspaces: [{ id: "workspace_accepted", name: "Accepted Workspace" }],
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

    expect(result.workspaceSelectionView).toEqual({
      type: "invitation",
      workspaceName: "Invited Workspace",
      hasWorkspaceApiAccess: false,
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

  it("selects the latest pending Workspace invitation when no accepted Workspaces are available", () => {
    const result = display({
      hasApiAccess: false,
      userWorkspaceInvitations: [
        { id: "invitation_older", workspace_id: "workspace_old", workspace_name: "Older Invitation", updated_at: "2026-05-01T12:00:00.000Z" },
        { id: "invitation_newer", workspace_id: "workspace_new", workspace_name: "Newer Invitation", updated_at: "2026-05-03T12:00:00.000Z" },
      ],
    });

    expect(result.selectedWorkspaceInvitationId).toBe("invitation_newer");
    expect(result.workspaceSelectionView).toMatchObject({
      type: "invitation",
      workspaceName: "Newer Invitation",
      hasWorkspaceApiAccess: false,
      invitation: { id: "invitation_newer", workspaceId: "workspace_new", workspaceName: "Newer Invitation" },
    });
  });

  it("falls back to accepted Workspace context for a stale pending Workspace invitation selection", () => {
    const result = display({
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      selectedWorkspaceInvitationId: "missing_invitation",
      userWorkspaces: [{ id: "workspace_accepted", name: "Accepted Workspace" }],
      userWorkspaceInvitations: [
        { id: "other_invitation", workspace_id: "workspace_other", workspace_name: "Other Workspace" },
      ],
    });

    expect(result.workspaceSelectionView).toEqual({
      type: "workspace",
      workspaceName: "Accepted Workspace",
      hasWorkspaceApiAccess: true,
      invitation: null,
    });
  });
});

describe("Workspace roles", () => {
  it("uses Delete Workspace for owners and Leave Workspace for non-owner accepted Workspaces", () => {
    expect(getWorkspacePrimaryAction("owner")).toEqual({ type: "delete", label: "Delete workspace" });
    expect(getWorkspacePrimaryAction("admin")).toEqual({ type: "leave", label: "Leave workspace" });
    expect(getWorkspacePrimaryAction("member")).toEqual({ type: "leave", label: "Leave workspace" });
    expect(getWorkspacePrimaryAction("")).toEqual({ type: "none", label: "" });
  });

  it.each([
    ["owner", { canListUsers: true, canManage: true, isOwner: true }],
    ["admin", { canListUsers: true, canManage: true, isOwner: false }],
    ["member", { canListUsers: true, canManage: false, isOwner: false }],
    ["", { canListUsers: false, canManage: false, isOwner: false }],
  ])("derives Workspace user-management permissions for %j", (role, permissions) => {
    expect(getWorkspaceMemberPermissions(role)).toEqual(permissions);
  });

  it.each([
    ["owner", "owner", ["make_admin"]],
    ["owner", "admin", ["remove_user", "make_owner"]],
    ["owner", "member", ["remove_user", "make_admin", "make_owner"]],
    ["admin", "owner", []],
    ["admin", "admin", ["remove_user", "make_owner"]],
    ["admin", "member", ["remove_user"]],
    ["member", "member", []],
  ])("offers a %s these actions for a %s", (viewerRole, targetRole, actions) => {
    const permissions = getWorkspaceMemberPermissions(viewerRole);
    expect(getWorkspaceUserActions(permissions, targetRole)).toEqual(actions);
    expect(canShowWorkspaceUserAction(permissions, targetRole)).toBe(actions.length > 0);
  });
});

describe("accepted Workspace resolution", () => {
  const userWorkspaces = [
    { id: "workspace_first", name: "First Workspace" },
    { id: "workspace_stored", name: "Backend Workspace" },
  ];

  it("clears pending invitation selection and API key material for an accepted Workspace", () => {
    expect(selectAcceptedWorkspaceContext({ id: "workspace_alpha", name: "Alpha Workspace" })).toEqual({
      workspaceId: "workspace_alpha",
      workspaceName: "Alpha Workspace",
      selectedWorkspaceInvitationId: "",
      apiKey: "",
    });
  });

  it("restores a stored workspace preference only when backend lists that accepted Workspace", () => {
    expect(resolveAcceptedWorkspace({
      storedWorkspacePreference: { workspaceId: "workspace_stored", workspaceName: "Stored Workspace" },
      userWorkspaces,
    })).toEqual({ id: "workspace_stored", name: "Backend Workspace" });
  });

  it("selects the first accepted Workspace when stored preference is stale or missing", () => {
    expect(resolveAcceptedWorkspace({
      storedWorkspacePreference: { workspaceId: "workspace_stale" },
      userWorkspaces,
    })).toEqual({ id: "workspace_first", name: "First Workspace" });
    expect(resolveAcceptedWorkspace({ storedWorkspacePreference: null, userWorkspaces })).toEqual({
      id: "workspace_first",
      name: "First Workspace",
    });
  });

  it("resolves nothing when the backend lists no accepted Workspaces", () => {
    expect(resolveAcceptedWorkspace({ storedWorkspacePreference: null, userWorkspaces: [] })).toBeNull();
  });
});
