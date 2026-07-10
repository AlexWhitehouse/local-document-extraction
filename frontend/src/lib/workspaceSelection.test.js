import { describe, expect, it } from "vitest";

import {
  getAcceptWorkspaceInvitationTransition,
  getCancelWorkspaceInvitationTransition,
  getInviteWorkspaceInvitationTransition,
  getDeclineWorkspaceInvitationTransition,
  getLeaveWorkspaceTransition,
  getWorkspacePrimaryAction,
  getWorkspaceMemberActionTransition,
  getWorkspaceContextRefreshTransition,
  getWorkspaceContextDisplay,
  getWorkspaceSelectionView,
  resolveAcceptedWorkspaceContext,
  selectPendingWorkspaceInvitationContext,
  selectAcceptedWorkspaceContext,
} from "./workspaceSelection.js";

describe("workspace context display", () => {
  it("uses Delete Workspace for owners and Leave Workspace for non-owner accepted Workspaces", () => {
    expect(getWorkspacePrimaryAction({ workspaceRole: "owner" })).toEqual({ type: "delete", label: "Delete Workspace" });
    expect(getWorkspacePrimaryAction({ workspaceRole: "admin" })).toEqual({ type: "leave", label: "Leave Workspace" });
    expect(getWorkspacePrimaryAction({ workspaceRole: "member" })).toEqual({ type: "leave", label: "Leave Workspace" });
  });

  it("exposes Workspace user-management visibility for an owner Workspace context", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      workspaceId: "workspace_owner",
      workspaceName: "Owner Workspace",
      userWorkspaces: [
        { id: "workspace_owner", name: "Owner Workspace", role: "owner" },
      ],
      userWorkspaceInvitations: [],
    });

    expect(display.workspaceSelectionView.userManagement).toEqual({
      canListWorkspaceUsers: true,
      canManageWorkspaceInvitations: true,
      canShowOwnerActions: true,
      canShowAdminActions: true,
      canShowMemberActions: true,
    });
  });

  it("exposes Workspace user-management visibility for an admin Workspace context", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      workspaceId: "workspace_admin",
      workspaceName: "Admin Workspace",
      userWorkspaces: [
        { id: "workspace_admin", name: "Admin Workspace", role: "admin" },
      ],
      userWorkspaceInvitations: [],
    });

    expect(display.workspaceSelectionView.userManagement).toEqual({
      canListWorkspaceUsers: true,
      canManageWorkspaceInvitations: true,
      canShowOwnerActions: false,
      canShowAdminActions: true,
      canShowMemberActions: true,
    });
  });

  it("exposes list-only Workspace user visibility for a member Workspace context", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      workspaceId: "workspace_member",
      workspaceName: "Member Workspace",
      userWorkspaces: [
        { id: "workspace_member", name: "Member Workspace", role: "member" },
      ],
      userWorkspaceInvitations: [],
    });

    expect(display.workspaceSelectionView.userManagement).toEqual({
      canListWorkspaceUsers: true,
      canManageWorkspaceInvitations: false,
      canShowOwnerActions: false,
      canShowAdminActions: false,
      canShowMemberActions: false,
    });
  });

  it("does not expose Workspace user-management visibility without a Workspace context", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "",
      hasApiAccess: false,
      workspaceId: "",
      workspaceName: "",
      userWorkspaces: [],
      userWorkspaceInvitations: [],
    });

    expect(display.workspaceSelectionView.userManagement).toEqual({
      canListWorkspaceUsers: false,
      canManageWorkspaceInvitations: false,
      canShowOwnerActions: false,
      canShowAdminActions: false,
      canShowMemberActions: false,
    });
  });

  it("does not expose Workspace user-management visibility for a pending Workspace invitation context", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      workspaceId: "workspace_owner",
      workspaceName: "Owner Workspace",
      selectedWorkspaceInvitationId: "invitation_123",
      userWorkspaces: [
        { id: "workspace_owner", name: "Owner Workspace", role: "owner" },
      ],
      userWorkspaceInvitations: [
        {
          id: "invitation_123",
          workspace_id: "workspace_invited",
          workspace_name: "Invited Workspace",
          role: "admin",
          status: "pending",
        },
      ],
    });

    expect(display.workspaceSelectionView.userManagement).toEqual({
      canListWorkspaceUsers: false,
      canManageWorkspaceInvitations: false,
      canShowOwnerActions: false,
      canShowAdminActions: false,
      canShowMemberActions: false,
    });
  });

  it("normalizes accepted Workspaces before pending Workspace invitations", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
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

    expect(display.availableWorkspaces).toEqual([
      {
        id: "workspace_beta",
        name: "Beta Workspace",
        api_base: "/v1",
        connected: true,
        type: "workspace",
        role: "owner",
      },
      {
        id: "workspace_alpha",
        name: "Untitled Workspace",
        api_base: "/v1",
        connected: false,
        type: "workspace",
        role: "member",
      },
      {
        id: "workspace_invited_new",
        invitation_id: "invitation_newer",
        name: "Newer Invitation",
        api_base: "/v1",
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
        api_base: "/v1",
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

  it("aligns active Workspace name with the selected accepted Workspace", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      workspaceId: "workspace_selected",
      workspaceName: "Persisted Stale Name",
      userWorkspaces: [
        { id: "workspace_other", name: "Other Workspace" },
        { id: "workspace_selected", name: "Selected Workspace" },
      ],
      userWorkspaceInvitations: [],
    });

    expect(display.selectedWorkspaceName).toBe("Selected Workspace");
    expect(display.activeWorkspaceName).toBe("Selected Workspace");
  });

  it("does not invent an accepted Workspace entry when no accepted Workspaces or invitations exist", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "",
      hasApiAccess: false,
      workspaceId: "",
      workspaceName: "",
      userWorkspaces: [],
      userWorkspaceInvitations: [],
    });

    expect(display).toEqual({
      availableWorkspaces: [],
      selectedWorkspaceName: "",
      activeWorkspaceName: "Local Workspace",
      selectedWorkspaceInvitationId: "",
      workspaceSelectionView: {
        type: "workspace",
        workspaceName: "Local Workspace",
        hasWorkspaceApiAccess: false,
        canManageWorkspace: false,
        userManagement: {
          canListWorkspaceUsers: false,
          canManageWorkspaceInvitations: false,
          canShowOwnerActions: false,
          canShowAdminActions: false,
          canShowMemberActions: false,
        },
        invitation: null,
      },
    });
  });

  it("selects a pending Workspace invitation as a locked Workspace context", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      canManageWorkspaceUsers: true,
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      selectedWorkspaceInvitationId: "invitation_123",
      userWorkspaces: [
        { id: "workspace_accepted", name: "Accepted Workspace" },
      ],
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

    expect(display.workspaceSelectionView).toEqual({
      type: "invitation",
      workspaceName: "Invited Workspace",
      hasWorkspaceApiAccess: false,
      canManageWorkspace: false,
      userManagement: {
        canListWorkspaceUsers: false,
        canManageWorkspaceInvitations: false,
        canShowOwnerActions: false,
        canShowAdminActions: false,
        canShowMemberActions: false,
      },
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
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: false,
      workspaceId: "",
      workspaceName: "",
      selectedWorkspaceInvitationId: "",
      userWorkspaces: [],
      userWorkspaceInvitations: [
        {
          id: "invitation_older",
          workspace_id: "workspace_old",
          workspace_name: "Older Invitation",
          updated_at: "2026-05-01T12:00:00.000Z",
        },
        {
          id: "invitation_newer",
          workspace_id: "workspace_new",
          workspace_name: "Newer Invitation",
          updated_at: "2026-05-03T12:00:00.000Z",
        },
      ],
    });

    expect(display.selectedWorkspaceInvitationId).toBe("invitation_newer");
    expect(display.workspaceSelectionView).toMatchObject({
      type: "invitation",
      workspaceName: "Newer Invitation",
      hasWorkspaceApiAccess: false,
      canManageWorkspace: false,
      invitation: {
        id: "invitation_newer",
        workspaceId: "workspace_new",
        workspaceName: "Newer Invitation",
      },
    });
  });

  it("falls back to accepted Workspace context for a stale pending Workspace invitation selection", () => {
    const display = getWorkspaceContextDisplay({
      apiBase: "/v1",
      hasApiAccess: true,
      canManageWorkspaceUsers: false,
      workspaceId: "workspace_accepted",
      workspaceName: "Accepted Workspace",
      selectedWorkspaceInvitationId: "missing_invitation",
      userWorkspaces: [
        { id: "workspace_accepted", name: "Accepted Workspace" },
      ],
      userWorkspaceInvitations: [
        {
          id: "other_invitation",
          workspace_id: "workspace_other",
          workspace_name: "Other Workspace",
        },
      ],
    });

    expect(display.workspaceSelectionView).toEqual({
      type: "workspace",
      workspaceName: "Accepted Workspace",
      hasWorkspaceApiAccess: true,
      canManageWorkspace: false,
      userManagement: {
        canListWorkspaceUsers: false,
        canManageWorkspaceInvitations: false,
        canShowOwnerActions: false,
        canShowAdminActions: false,
        canShowMemberActions: false,
      },
      invitation: null,
    });
  });
});

describe("accepted Workspace context selection", () => {
  it("returns the accepted Workspace context update and clears pending invitation selection", () => {
    const selection = selectAcceptedWorkspaceContext({
      workspace: {
        id: "workspace_alpha",
        name: "Alpha Workspace",
        type: "workspace",
      },
    });

    expect(selection).toEqual({
      workspaceId: "workspace_alpha",
      workspaceName: "Alpha Workspace",
      selectedWorkspaceInvitationId: "",
      apiKey: "",
    });
  });

  it("does not restore prior Workspace API key material for an accepted Workspace", () => {
    const selection = selectAcceptedWorkspaceContext({
      workspace: {
        id: "workspace_beta",
        name: "Beta Workspace",
        type: "workspace",
      },
      apiKeysByWorkspace: {
        workspace_alpha: "alpha-key",
        workspace_beta: "beta-key",
      },
    });

    expect(selection.apiKey).toBe("");
  });
});

describe("pending Workspace invitation context selection", () => {
  it("selects a pending Workspace invitation without changing accepted Workspace API context", () => {
    const selection = selectPendingWorkspaceInvitationContext({
      invitation: {
        id: "invitation_123",
        workspace_id: "workspace_invited",
      },
    });

    expect(selection).toEqual({
      selectedWorkspaceInvitationId: "invitation_123",
    });
  });
});

describe("Workspace context refresh transition", () => {
  it("restores a stored workspace preference only when backend lists that accepted Workspace", () => {
    const resolution = resolveAcceptedWorkspaceContext({
      storedWorkspacePreference: {
        workspaceId: "workspace_stored",
        workspaceName: "Stored Workspace",
      },
      userWorkspaces: [
        { id: "workspace_first", name: "First Workspace" },
        { id: "workspace_stored", name: "Backend Workspace" },
      ],
    });

    expect(resolution).toEqual({
      type: "resolved",
      workspace: {
        id: "workspace_stored",
        name: "Backend Workspace",
      },
      nextWorkspaceContext: {
        workspaceId: "workspace_stored",
        workspaceName: "Backend Workspace",
        selectedWorkspaceInvitationId: "",
        apiKey: "",
      },
    });
  });

  it("selects the first accepted Workspace when stored preference is stale", () => {
    const resolution = resolveAcceptedWorkspaceContext({
      storedWorkspacePreference: {
        workspaceId: "workspace_stale",
        workspaceName: "Stale Workspace",
      },
      userWorkspaces: [
        { id: "workspace_first", name: "First Workspace" },
        { id: "workspace_second", name: "Second Workspace" },
      ],
    });

    expect(resolution).toEqual({
      type: "resolved",
      workspace: {
        id: "workspace_first",
        name: "First Workspace",
      },
      nextWorkspaceContext: {
        workspaceId: "workspace_first",
        workspaceName: "First Workspace",
        selectedWorkspaceInvitationId: "",
        apiKey: "",
      },
    });
  });

  it("treats a legacy synthetic stored Workspace preference as stale", () => {
    const resolution = resolveAcceptedWorkspaceContext({
      storedWorkspacePreference: {
        workspaceId: "workspace_local_default",
        workspaceName: "Local Workspace",
      },
      userWorkspaces: [
        { id: "workspace_backend", name: "Backend Workspace" },
      ],
    });

    expect(resolution.nextWorkspaceContext).toEqual({
      workspaceId: "workspace_backend",
      workspaceName: "Backend Workspace",
      selectedWorkspaceInvitationId: "",
      apiKey: "",
    });
  });

  it("does not auto-select pending Workspace invitations while accepted Workspaces exist", () => {
    const resolution = resolveAcceptedWorkspaceContext({
      storedWorkspacePreference: null,
      userWorkspaces: [{ id: "workspace_first", name: "First Workspace" }],
      userWorkspaceInvitations: [
        { id: "invitation_123", workspace_name: "Invited Workspace" },
      ],
    });

    expect(resolution.nextWorkspaceContext).toEqual({
      workspaceId: "workspace_first",
      workspaceName: "First Workspace",
      selectedWorkspaceInvitationId: "",
      apiKey: "",
    });
  });

  it("selects the first accepted Workspace when the current accepted Workspace is missing", () => {
    const transition = getWorkspaceContextRefreshTransition({
      workspaceId: "workspace_missing",
      selectedWorkspaceInvitationId: "",
      userWorkspaces: [
        { id: "workspace_123", name: "Restored Workspace" },
      ],
      userWorkspaceInvitations: [],
    });

    expect(transition).toEqual({
      type: "context_update",
      nextWorkspaceContext: {
        workspaceId: "workspace_123",
        workspaceName: "Restored Workspace",
        selectedWorkspaceInvitationId: "",
        apiKey: "",
      },
    });
  });

  it("selects the latest pending Workspace invitation when no accepted Workspaces are available", () => {
    const transition = getWorkspaceContextRefreshTransition({
      workspaceId: "",
      selectedWorkspaceInvitationId: "",
      userWorkspaces: [],
      userWorkspaceInvitations: [
        {
          id: "invitation_older",
          updated_at: "2026-05-01T12:00:00.000Z",
        },
        {
          id: "invitation_newer",
          updated_at: "2026-05-03T12:00:00.000Z",
        },
      ],
    });

    expect(transition).toEqual({
      type: "context_update",
      nextWorkspaceContext: {
        workspaceId: "",
        workspaceName: "Local Workspace",
        selectedWorkspaceInvitationId: "invitation_newer",
        apiKey: "",
      },
    });
  });
});

describe("invite Workspace invitation transition", () => {
  it("guards invite when no accepted Workspace context is selected", () => {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId: "",
      email: "invitee@example.com",
      role: "member",
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("returns validation when invite email is blank", () => {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      email: "  ",
      role: "member",
    });

    expect(transition).toEqual({
      type: "validation",
      reason: "missing_invitation_email",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("returns an invite request effect for a valid invite", () => {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      email: " invitee@example.com ",
      role: "admin",
    });

    expect(transition).toEqual({
      type: "request",
      workspaceId: "workspace_123",
      email: "invitee@example.com",
      request: {
        path: "/workspaces/workspace_123/invitations",
        method: "POST",
        body: {
          email: "invitee@example.com",
          role: "admin",
        },
      },
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("returns pending Workspace invitation refresh after a successful invite", () => {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      email: "invitee@example.com",
      role: "member",
      inviteResult: {},
    });

    expect(transition).toEqual({
      type: "success",
      workspaceId: "workspace_123",
      email: "invitee@example.com",
      request: null,
      refresh: ["pendingWorkspaceInvitations"],
      nextWorkspaceContext: null,
    });
  });

  it("leaves Workspace context unchanged after failed invite", () => {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      email: "invitee@example.com",
      role: "member",
      inviteError: new Error("network failed"),
    });

    expect(transition).toEqual({
      type: "failure",
      workspaceId: "workspace_123",
      email: "invitee@example.com",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });
});

describe("cancel Workspace invitation transition", () => {
  it("guards cancel when no accepted Workspace context is selected", () => {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId: "",
      invitation: { id: "invitation_123", email: "invitee@example.com" },
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("guards cancel when no pending Workspace invitation is selected", () => {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      invitation: null,
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_pending_workspace_invitation",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("requires confirmation before cancelling someone else's pending Workspace invitation", () => {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      invitation: { id: "invitation_123", email: "invitee@example.com" },
    });

    expect(transition).toEqual({
      type: "confirmation_required",
      workspaceId: "workspace_123",
      invitationId: "invitation_123",
      invitationEmail: "invitee@example.com",
      confirmationMessage: "Cancel pending invitation for invitee@example.com?",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: true,
    });
  });

  it("returns a cancel request effect after confirmation", () => {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      invitation: { id: "invitation_123", email: "invitee@example.com" },
      confirmed: true,
    });

    expect(transition).toEqual({
      type: "request",
      workspaceId: "workspace_123",
      invitationId: "invitation_123",
      invitationEmail: "invitee@example.com",
      request: {
        path: "/workspaces/workspace_123/invitations/invitation_123",
        method: "DELETE",
      },
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("returns pending Workspace invitation refresh after successful cancel", () => {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      invitation: { id: "invitation_123", email: "invitee@example.com" },
      cancelResult: {},
    });

    expect(transition).toEqual({
      type: "success",
      workspaceId: "workspace_123",
      invitationId: "invitation_123",
      invitationEmail: "invitee@example.com",
      request: null,
      refresh: ["pendingWorkspaceInvitations"],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("leaves Workspace context unchanged after failed cancel", () => {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId: "workspace_123",
      invitation: { id: "invitation_123", email: "invitee@example.com" },
      cancelError: new Error("network failed"),
    });

    expect(transition).toEqual({
      type: "failure",
      workspaceId: "workspace_123",
      invitationId: "invitation_123",
      invitationEmail: "invitee@example.com",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });
});

describe("Workspace member action transition", () => {
  it("guards member action when no accepted Workspace context is selected", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "",
      targetUserId: "user_123",
      action: "make_admin",
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("guards member action when no target Workspace user is selected", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "",
      action: "remove_user",
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_target_workspace_user",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("returns a role change request effect for the selected Workspace context", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_admin",
    });

    expect(transition).toEqual({
      type: "request",
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_admin",
      request: {
        action: "make_admin",
      },
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("returns a removal request effect for the selected Workspace context", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "remove_user",
    });

    expect(transition).toMatchObject({
      type: "request",
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "remove_user",
      request: {
        action: "remove_user",
      },
    });
  });

  it("returns an owner-transfer request effect for the selected Workspace context", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_owner",
    });

    expect(transition).toMatchObject({
      type: "request",
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_owner",
      request: {
        action: "make_owner",
      },
    });
  });

  it("returns Workspace user and context refresh after a successful member action", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_owner",
      actionResult: {},
    });

    expect(transition).toEqual({
      type: "success",
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_owner",
      request: null,
      refresh: ["acceptedWorkspaces", "workspaceUsers", "workspaceContext"],
      nextWorkspaceContext: null,
    });
  });

  it("updates Workspace context when refreshed data changes the selected Workspace", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "make_owner",
      actionResult: {},
      refreshedUserWorkspaces: [
        { id: "workspace_123", name: "Updated Workspace", role: "admin" },
      ],
    });

    expect(transition.nextWorkspaceContext).toEqual({
      workspaceId: "workspace_123",
      workspaceName: "Updated Workspace",
      selectedWorkspaceInvitationId: "",
      apiKey: "",
    });
  });

  it("leaves Workspace context unchanged after failed member action", () => {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "remove_user",
      actionError: new Error("network failed"),
    });

    expect(transition).toEqual({
      type: "failure",
      workspaceId: "workspace_123",
      targetUserId: "user_123",
      action: "remove_user",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });
});

describe("Leave Workspace transition", () => {
  it("selects the first backend-returned remaining accepted Workspace after a successful leave", () => {
    const transition = getLeaveWorkspaceTransition({
      workspaceId: "workspace_left",
      confirmed: true,
      leaveResult: { ok: true, workspace_id: "workspace_left" },
      refreshedUserWorkspaces: [
        { id: "workspace_old", name: "Older Workspace", created_at: "2026-05-01T00:00:00.000Z", role: "member" },
        { id: "workspace_new", name: "Newer Workspace", created_at: "2026-05-03T00:00:00.000Z", role: "admin" }
      ]
    });

    expect(transition).toEqual({
      type: "success",
      workspaceId: "workspace_left",
      request: null,
      refresh: ["acceptedWorkspaces", "workspaceContext"],
      nextWorkspaceContext: {
        workspaceId: "workspace_old",
        workspaceName: "Older Workspace",
        selectedWorkspaceInvitationId: "",
        apiKey: ""
      },
      removedApiKeyWorkspaceId: "workspace_left",
      requiresConfirmation: false
    });
  });

  it("selects the replacement Workspace without retaining one-time API key material after leaving the last accepted Workspace", () => {
    const transition = getLeaveWorkspaceTransition({
      workspaceId: "workspace_left",
      confirmed: true,
      leaveResult: {
        ok: true,
        workspace_id: "workspace_left",
        replacement_workspace: {
          workspace_id: "workspace_replacement",
          name: "Mina Member Workspace",
          role: "owner",
          created_at: "2026-05-05T00:00:00.000Z"
        }
      },
      refreshedUserWorkspaces: [
        { id: "workspace_replacement", name: "Mina Member Workspace", created_at: "2026-05-05T00:00:00.000Z", role: "owner" }
      ]
    });

    expect(transition).toEqual({
      type: "success",
      workspaceId: "workspace_left",
      request: null,
      refresh: ["acceptedWorkspaces", "workspaceContext"],
      nextWorkspaceContext: {
        workspaceId: "workspace_replacement",
        workspaceName: "Mina Member Workspace",
        selectedWorkspaceInvitationId: "",
        apiKey: ""
      },
      removedApiKeyWorkspaceId: "workspace_left",
      requiresConfirmation: false
    });
  });

  it("leaves Workspace context unchanged after a failed leave", () => {
    const transition = getLeaveWorkspaceTransition({
      workspaceId: "workspace_123",
      leaveError: new Error("network failed")
    });

    expect(transition).toEqual({
      type: "failure",
      workspaceId: "workspace_123",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      removedApiKeyWorkspaceId: null,
      requiresConfirmation: false
    });
  });
});

describe("accept Workspace invitation transition", () => {
  it("guards acceptance when no pending Workspace invitation is selected", () => {
    const transition = getAcceptWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: null,
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_selected_workspace_invitation",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("guards acceptance when the selected Workspace invitation is not pending", () => {
    const transition = getAcceptWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_accepted",
        status: "accepted",
      },
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "selected_workspace_invitation_not_pending",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("returns an accept request effect for a selected pending Workspace invitation", () => {
    const transition = getAcceptWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_123",
        status: "pending",
      },
    });

    expect(transition).toEqual({
      type: "request",
      invitationId: "invitation_123",
      request: {
        path: "/invitations/invitation_123/accept",
        method: "POST",
      },
      refresh: [],
      nextWorkspaceContext: null,
    });
  });

  it("selects the accepted Workspace after success without restoring saved API key material", () => {
    const transition = getAcceptWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_123",
        workspaceName: "Invited Workspace",
        status: "pending",
      },
      acceptResult: {
        workspace_id: "workspace_invited",
      },
      refreshedUserWorkspaces: [
        { id: "workspace_invited", name: "Invited Workspace", role: "member" },
      ],
    });

    expect(transition).toEqual({
      type: "success",
      invitationId: "invitation_123",
      acceptedWorkspaceId: "workspace_invited",
      request: null,
      refresh: ["acceptedWorkspaces", "pendingWorkspaceInvitations"],
      nextWorkspaceContext: {
        workspaceId: "workspace_invited",
        workspaceName: "Invited Workspace",
        selectedWorkspaceInvitationId: "",
        apiKey: "",
      },
    });
  });

  it("leaves Workspace context unchanged after failed acceptance", () => {
    const transition = getAcceptWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_123",
        workspaceName: "Invited Workspace",
        status: "pending",
      },
      acceptError: new Error("network failed"),
    });

    expect(transition).toEqual({
      type: "failure",
      invitationId: "invitation_123",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    });
  });
});

describe("decline Workspace invitation transition", () => {
  it("guards decline when no pending Workspace invitation is selected", () => {
    const transition = getDeclineWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: null,
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "missing_selected_workspace_invitation",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("guards decline when the selected Workspace invitation is not pending", () => {
    const transition = getDeclineWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_cancelled",
        status: "cancelled",
      },
    });

    expect(transition).toEqual({
      type: "guard",
      reason: "selected_workspace_invitation_not_pending",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("returns a no-confirmation decline request effect for a selected pending Workspace invitation", () => {
    const transition = getDeclineWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_123",
        status: "pending",
      },
    });

    expect(transition).toEqual({
      type: "request",
      invitationId: "invitation_123",
      request: {
        path: "/invitations/invitation_123/decline",
        method: "POST",
      },
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });

  it("clears pending Workspace invitation context after successful decline without selecting that Workspace", () => {
    const transition = getDeclineWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_123",
        workspaceId: "workspace_invited",
        workspaceName: "Invited Workspace",
        status: "pending",
      },
      declineResult: {},
    });

    expect(transition).toEqual({
      type: "success",
      invitationId: "invitation_123",
      declinedWorkspaceId: "workspace_invited",
      request: null,
      refresh: ["acceptedWorkspaces", "pendingWorkspaceInvitations"],
      nextWorkspaceContext: {
        selectedWorkspaceInvitationId: "",
      },
      requiresConfirmation: false,
    });
  });

  it("leaves Workspace context unchanged after failed decline", () => {
    const transition = getDeclineWorkspaceInvitationTransition({
      selectedWorkspaceInvitation: {
        id: "invitation_123",
        workspaceId: "workspace_invited",
        workspaceName: "Invited Workspace",
        status: "pending",
      },
      declineError: new Error("network failed"),
    });

    expect(transition).toEqual({
      type: "failure",
      invitationId: "invitation_123",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    });
  });
});

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
      userManagement: {
        canListWorkspaceUsers: false,
        canManageWorkspaceInvitations: false,
        canShowOwnerActions: false,
        canShowAdminActions: false,
        canShowMemberActions: false,
      },
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
      userManagement: {
        canListWorkspaceUsers: true,
        canManageWorkspaceInvitations: true,
        canShowOwnerActions: false,
        canShowAdminActions: true,
        canShowMemberActions: true,
      },
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
      userManagement: {
        canListWorkspaceUsers: false,
        canManageWorkspaceInvitations: false,
        canShowOwnerActions: false,
        canShowAdminActions: false,
        canShowMemberActions: false,
      },
      invitation: null,
    });
  });
});
