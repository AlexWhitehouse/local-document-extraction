const DEFAULT_WORKSPACE_NAME = "Local Workspace";

export function getWorkspaceContextDisplay({
  apiBase,
  hasApiAccess,
  canManageWorkspaceUsers,
  workspaceId,
  workspaceName,
  selectedWorkspaceInvitationId,
  userWorkspaces,
  userWorkspaceInvitations,
}) {
  const normalizedApiBase = apiBase || "/v1";
  const activeWorkspaceId = String(workspaceId || "");
  const workspaces = Array.isArray(userWorkspaces) ? userWorkspaces : [];
  const invitations = Array.isArray(userWorkspaceInvitations)
    ? userWorkspaceInvitations
    : [];
  const acceptedEntries = workspaces.map((workspace) => ({
    id: String(workspace?.id || ""),
    name: String(workspace?.name || "Untitled Workspace"),
    api_base: normalizedApiBase,
    connected: String(workspace?.id || "") === activeWorkspaceId,
    type: "workspace",
    role: String(workspace?.role || ""),
  }));
  const invitedEntries = invitations
    .map((invitation) => ({
      id: String(invitation?.workspace_id || ""),
      invitation_id: String(invitation?.id || ""),
      name: String(invitation?.workspace_name || "Untitled Workspace"),
      api_base: normalizedApiBase,
      connected: false,
      type: "invitation",
      role: String(invitation?.role || ""),
      email: String(invitation?.email || ""),
      inviter_name: String(invitation?.inviter_name || ""),
      inviter_email: String(invitation?.inviter_email || ""),
      inviter_display: String(invitation?.inviter_display || ""),
      updated_at: String(invitation?.updated_at || invitation?.created_at || ""),
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const selectedInvitationId = String(selectedWorkspaceInvitationId || "").trim();

  const toDisplay = (availableWorkspaces) => {
    const selectedEntryId = activeWorkspaceId;
    const effectiveSelectedWorkspaceInvitationId =
      selectedInvitationId ||
      (acceptedEntries.length === 0
        ? String(invitedEntries[0]?.invitation_id || "")
        : "");
    const selectedWorkspaceName = String(
      availableWorkspaces.find((workspace) => workspace.id === selectedEntryId)
        ?.name || "",
    );
    const activeWorkspaceName =
      selectedWorkspaceName.trim() ||
      String(workspaceName || "").trim() ||
      DEFAULT_WORKSPACE_NAME;
    const selectedWorkspaceRole = String(
      acceptedEntries.find((workspace) => workspace.id === selectedEntryId)
        ?.role || "",
    );

    return {
      availableWorkspaces,
      selectedWorkspaceName,
      activeWorkspaceName,
      selectedWorkspaceInvitationId: effectiveSelectedWorkspaceInvitationId,
      workspaceSelectionView: getWorkspaceSelectionView({
        workspaceId,
        workspaceName: activeWorkspaceName,
        hasApiAccess,
        canManageWorkspaceUsers,
        workspaceRole: selectedWorkspaceRole,
        selectedWorkspaceInvitationId: effectiveSelectedWorkspaceInvitationId,
        userWorkspaceInvitations: invitations,
      }),
    };
  };

  if (acceptedEntries.length > 0) {
    return toDisplay([...acceptedEntries, ...invitedEntries]);
  }

  if (invitedEntries.length > 0) {
    return toDisplay(invitedEntries);
  }

  return toDisplay([]);
}

export function selectAcceptedWorkspaceContext({ workspace }) {
  const workspaceId = String(workspace?.id || "");

  return {
    workspaceId,
    workspaceName: String(workspace?.name || "Untitled Workspace"),
    selectedWorkspaceInvitationId: "",
    apiKey: "",
  };
}

export function resolveAcceptedWorkspaceContext({
  storedWorkspacePreference,
  userWorkspaces,
}) {
  const workspaces = Array.isArray(userWorkspaces) ? userWorkspaces : [];
  const storedWorkspaceId = String(
    storedWorkspacePreference?.workspaceId || "",
  ).trim();
  const matchedWorkspace = workspaces.find(
    (workspace) => String(workspace?.id || "") === storedWorkspaceId,
  );
  const resolvedWorkspace = matchedWorkspace || workspaces[0] || null;

  if (!resolvedWorkspace) {
    return {
      type: "unresolved",
      workspace: null,
      nextWorkspaceContext: null,
    };
  }

  return {
    type: "resolved",
    workspace: resolvedWorkspace,
    nextWorkspaceContext: selectAcceptedWorkspaceContext({
      workspace: resolvedWorkspace,
    }),
  };
}

export function selectPendingWorkspaceInvitationContext({ invitation }) {
  return {
    selectedWorkspaceInvitationId: String(invitation?.id || ""),
  };
}

export function getWorkspaceContextRefreshTransition({
  workspaceId,
  selectedWorkspaceInvitationId,
  userWorkspaces,
  userWorkspaceInvitations,
}) {
  const workspaces = Array.isArray(userWorkspaces) ? userWorkspaces : [];
  const invitations = Array.isArray(userWorkspaceInvitations)
    ? userWorkspaceInvitations
    : [];
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  const hasSelectedWorkspace = workspaces.some(
    (workspace) => String(workspace?.id || "") === normalizedWorkspaceId,
  );

  if ((!normalizedWorkspaceId || !hasSelectedWorkspace) && workspaces[0]?.id) {
    return {
      type: "context_update",
      nextWorkspaceContext: selectAcceptedWorkspaceContext({
        workspace: workspaces[0],
      }),
    };
  }

  const normalizedInvitationId = String(
    selectedWorkspaceInvitationId || "",
  ).trim();
  const hasSelectedInvitation = invitations.some(
    (invitation) => String(invitation?.id || "") === normalizedInvitationId,
  );

  if (!workspaces.length && invitations.length && !hasSelectedInvitation) {
    const latestInvitation = [...invitations].sort((a, b) =>
      String(b?.updated_at || b?.created_at || "").localeCompare(
        String(a?.updated_at || a?.created_at || ""),
      ),
    )[0];

    return {
      type: "context_update",
      nextWorkspaceContext: {
        workspaceId: "",
        workspaceName: DEFAULT_WORKSPACE_NAME,
        selectedWorkspaceInvitationId: String(latestInvitation?.id || ""),
        apiKey: "",
      },
    };
  }

  if (normalizedInvitationId && !hasSelectedInvitation) {
    return {
      type: "context_update",
      nextWorkspaceContext: {
        selectedWorkspaceInvitationId: "",
      },
    };
  }

  return {
    type: "unchanged",
    nextWorkspaceContext: null,
  };
}

export function getInviteWorkspaceInvitationTransition({
  workspaceId,
  email,
  role,
  inviteResult,
  inviteError,
}) {
  const targetWorkspaceId = String(workspaceId || "").trim();
  if (!targetWorkspaceId) {
    return {
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) {
    return {
      type: "validation",
      reason: "missing_invitation_email",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  if (inviteResult) {
    return {
      type: "success",
      workspaceId: targetWorkspaceId,
      email: normalizedEmail,
      request: null,
      refresh: ["pendingWorkspaceInvitations"],
      nextWorkspaceContext: null,
    };
  }

  if (inviteError) {
    return {
      type: "failure",
      workspaceId: targetWorkspaceId,
      email: normalizedEmail,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  const normalizedRole = String(role || "member").trim() || "member";
  return {
    type: "request",
    workspaceId: targetWorkspaceId,
    email: normalizedEmail,
    request: {
      path: `/workspaces/${encodeURIComponent(targetWorkspaceId)}/invitations`,
      method: "POST",
      body: {
        email: normalizedEmail,
        role: normalizedRole,
      },
    },
    refresh: [],
    nextWorkspaceContext: null,
  };
}

export function getCancelWorkspaceInvitationTransition({
  workspaceId,
  invitation,
  confirmed,
  cancelResult,
  cancelError,
}) {
  const targetWorkspaceId = String(workspaceId || "").trim();
  if (!targetWorkspaceId) {
    return {
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  const invitationId = String(invitation?.id || "").trim();
  if (!invitationId) {
    return {
      type: "guard",
      reason: "missing_pending_workspace_invitation",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  const invitationEmail = String(
    invitation?.email || "this invitation",
  ).trim();

  if (cancelResult) {
    return {
      type: "success",
      workspaceId: targetWorkspaceId,
      invitationId,
      invitationEmail,
      request: null,
      refresh: ["pendingWorkspaceInvitations"],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  if (cancelError) {
    return {
      type: "failure",
      workspaceId: targetWorkspaceId,
      invitationId,
      invitationEmail,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  if (!confirmed) {
    return {
      type: "confirmation_required",
      workspaceId: targetWorkspaceId,
      invitationId,
      invitationEmail,
      confirmationMessage: `Cancel pending invitation for ${invitationEmail}?`,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: true,
    };
  }

  return {
    type: "request",
    workspaceId: targetWorkspaceId,
    invitationId,
    invitationEmail,
    request: {
      path: `/workspaces/${encodeURIComponent(targetWorkspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      method: "DELETE",
    },
    refresh: [],
    nextWorkspaceContext: null,
    requiresConfirmation: false,
  };
}

export function getWorkspacePrimaryAction({ workspaceRole }) {
  const normalizedRole = String(workspaceRole || "").trim().toLowerCase();
  if (normalizedRole === "owner") {
    return { type: "delete", label: "Delete Workspace" };
  }
  if (normalizedRole === "admin" || normalizedRole === "member") {
    return { type: "leave", label: "Leave Workspace" };
  }
  return { type: "none", label: "" };
}

export function getLeaveWorkspaceTransition({
  workspaceId,
  confirmed,
  leaveResult,
  leaveError,
  refreshedUserWorkspaces,
}) {
  const targetWorkspaceId = String(workspaceId || "").trim();
  if (!targetWorkspaceId) {
    return {
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      removedApiKeyWorkspaceId: null,
      requiresConfirmation: false,
    };
  }

  if (leaveResult) {
    const replacementWorkspaceId = String(
      leaveResult?.replacement_workspace?.workspace_id || "",
    ).trim();
    const remainingWorkspaces = Array.isArray(refreshedUserWorkspaces)
      ? refreshedUserWorkspaces.filter(
          (workspace) => String(workspace?.id || "") !== targetWorkspaceId,
        )
      : [];
    const replacementWorkspace = replacementWorkspaceId
      ? remainingWorkspaces.find(
          (workspace) => String(workspace?.id || "") === replacementWorkspaceId,
        )
      : null;
    const nextWorkspace =
      replacementWorkspace ||
      remainingWorkspaces[0];
    return {
      type: "success",
      workspaceId: targetWorkspaceId,
      request: null,
      refresh: ["acceptedWorkspaces", "workspaceContext"],
      nextWorkspaceContext: nextWorkspace
        ? selectAcceptedWorkspaceContext({
            workspace: nextWorkspace,
          })
        : null,
      removedApiKeyWorkspaceId: targetWorkspaceId,
      requiresConfirmation: false,
    };
  }

  if (leaveError) {
    return {
      type: "failure",
      workspaceId: targetWorkspaceId,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      removedApiKeyWorkspaceId: null,
      requiresConfirmation: false,
    };
  }

  if (!confirmed) {
    return {
      type: "confirmation_required",
      workspaceId: targetWorkspaceId,
      confirmationMessage: "Leave this workspace? You will lose access unless you are invited again.",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      removedApiKeyWorkspaceId: null,
      requiresConfirmation: true,
    };
  }

  return {
    type: "request",
    workspaceId: targetWorkspaceId,
    request: {},
    refresh: [],
    nextWorkspaceContext: null,
    removedApiKeyWorkspaceId: null,
    requiresConfirmation: false,
  };
}

export function getWorkspaceMemberActionTransition({
  workspaceId,
  targetUserId,
  action,
  actionResult,
  actionError,
  refreshedUserWorkspaces,
}) {
  const targetWorkspaceId = String(workspaceId || "").trim();
  if (!targetWorkspaceId) {
    return {
      type: "guard",
      reason: "missing_accepted_workspace_context",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  const targetId = String(targetUserId || "").trim();
  if (!targetId) {
    return {
      type: "guard",
      reason: "missing_target_workspace_user",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  const normalizedAction = String(action || "").trim();

  if (actionResult) {
    const refreshedWorkspace = Array.isArray(refreshedUserWorkspaces)
      ? refreshedUserWorkspaces.find(
          (workspace) => String(workspace?.id || "") === targetWorkspaceId,
        )
      : null;

    return {
      type: "success",
      workspaceId: targetWorkspaceId,
      targetUserId: targetId,
      action: normalizedAction,
      request: null,
      refresh: ["acceptedWorkspaces", "workspaceUsers", "workspaceContext"],
      nextWorkspaceContext: refreshedWorkspace
        ? selectAcceptedWorkspaceContext({
            workspace: refreshedWorkspace,
          })
        : null,
    };
  }

  if (actionError) {
    return {
      type: "failure",
      workspaceId: targetWorkspaceId,
      targetUserId: targetId,
      action: normalizedAction,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  return {
    type: "request",
    workspaceId: targetWorkspaceId,
    targetUserId: targetId,
    action: normalizedAction,
    request: {
      action: normalizedAction,
    },
    refresh: [],
    nextWorkspaceContext: null,
  };
}

export function getAcceptWorkspaceInvitationTransition({
  selectedWorkspaceInvitation,
  acceptResult,
  acceptError,
  refreshedUserWorkspaces,
}) {
  const invitationId = String(selectedWorkspaceInvitation?.id || "").trim();
  if (!invitationId) {
    return {
      type: "guard",
      reason: "missing_selected_workspace_invitation",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  if (
    String(selectedWorkspaceInvitation?.status || "pending").toLowerCase() !==
    "pending"
  ) {
    return {
      type: "guard",
      reason: "selected_workspace_invitation_not_pending",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  const acceptedWorkspaceId = String(acceptResult?.workspace_id || "").trim();
  if (acceptedWorkspaceId) {
    const refreshedWorkspace = Array.isArray(refreshedUserWorkspaces)
      ? refreshedUserWorkspaces.find(
          (workspace) => String(workspace?.id || "") === acceptedWorkspaceId,
        )
      : null;

    return {
      type: "success",
      invitationId,
      acceptedWorkspaceId,
      request: null,
      refresh: ["acceptedWorkspaces", "pendingWorkspaceInvitations"],
      nextWorkspaceContext: selectAcceptedWorkspaceContext({
        workspace: refreshedWorkspace || {
          id: acceptedWorkspaceId,
          name: selectedWorkspaceInvitation?.workspaceName,
        },
      }),
    };
  }

  if (acceptError) {
    return {
      type: "failure",
      invitationId,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
    };
  }

  return {
    type: "request",
    invitationId,
    request: {
      path: `/invitations/${encodeURIComponent(invitationId)}/accept`,
      method: "POST",
    },
    refresh: [],
    nextWorkspaceContext: null,
  };
}

export function getDeclineWorkspaceInvitationTransition({
  selectedWorkspaceInvitation,
  declineResult,
  declineError,
}) {
  const invitationId = String(selectedWorkspaceInvitation?.id || "").trim();
  if (!invitationId) {
    return {
      type: "guard",
      reason: "missing_selected_workspace_invitation",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  if (
    String(selectedWorkspaceInvitation?.status || "pending").toLowerCase() !==
    "pending"
  ) {
    return {
      type: "guard",
      reason: "selected_workspace_invitation_not_pending",
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  if (declineResult) {
    return {
      type: "success",
      invitationId,
      declinedWorkspaceId: String(selectedWorkspaceInvitation?.workspaceId || ""),
      request: null,
      refresh: ["acceptedWorkspaces", "pendingWorkspaceInvitations"],
      nextWorkspaceContext: {
        selectedWorkspaceInvitationId: "",
      },
      requiresConfirmation: false,
    };
  }

  if (declineError) {
    return {
      type: "failure",
      invitationId,
      request: null,
      refresh: [],
      nextWorkspaceContext: null,
      requiresConfirmation: false,
    };
  }

  return {
    type: "request",
    invitationId,
    request: {
      path: `/invitations/${encodeURIComponent(invitationId)}/decline`,
      method: "POST",
    },
    refresh: [],
    nextWorkspaceContext: null,
    requiresConfirmation: false,
  };
}

export function getWorkspaceSelectionView({
  workspaceName,
  hasApiAccess,
  canManageWorkspaceUsers,
  workspaceRole,
  selectedWorkspaceInvitationId,
  userWorkspaceInvitations,
}) {
  const selectedInvitationId = String(selectedWorkspaceInvitationId || "").trim();
  const invitation = Array.isArray(userWorkspaceInvitations)
    ? userWorkspaceInvitations.find(
        (candidate) => String(candidate?.id || "").trim() === selectedInvitationId,
      )
    : null;

  if (invitation) {
    const userManagement = getWorkspaceUserManagementVisibility("");

    return {
      type: "invitation",
      workspaceName: String(invitation.workspace_name || "Untitled Workspace"),
      hasWorkspaceApiAccess: false,
      canManageWorkspace: false,
      userManagement,
      invitation: {
        id: String(invitation.id || ""),
        workspaceId: String(invitation.workspace_id || ""),
        workspaceName: String(invitation.workspace_name || "Untitled Workspace"),
        email: String(invitation.email || ""),
        role: String(invitation.role || ""),
        status: String(invitation.status || "pending"),
        inviter: String(
          invitation.inviter_display ||
            invitation.inviter_name ||
            invitation.inviter_email ||
            "",
        ),
        invitedAt: String(invitation.created_at || ""),
        expiresAt: String(invitation.expires_at || ""),
      },
    };
  }

  const userManagement = getWorkspaceUserManagementVisibility(
    workspaceRole,
    canManageWorkspaceUsers,
  );

  return {
    type: "workspace",
    workspaceName: String(workspaceName || ""),
    hasWorkspaceApiAccess: Boolean(hasApiAccess),
    canManageWorkspace: userManagement.canManageWorkspaceInvitations,
    userManagement,
    invitation: null,
  };
}

function getWorkspaceUserManagementVisibility(role, canManageWorkspaceUsers) {
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();
  const canListWorkspaceUsers =
    normalizedRole === "owner" ||
    normalizedRole === "admin" ||
    normalizedRole === "member" ||
    Boolean(canManageWorkspaceUsers);
  const canManageWorkspace =
    normalizedRole === "owner" ||
    normalizedRole === "admin" ||
    Boolean(canManageWorkspaceUsers);

  return {
    canListWorkspaceUsers,
    canManageWorkspaceInvitations: canManageWorkspace,
    canShowOwnerActions: normalizedRole === "owner",
    canShowAdminActions: canManageWorkspace,
    canShowMemberActions: canManageWorkspace,
  };
}
