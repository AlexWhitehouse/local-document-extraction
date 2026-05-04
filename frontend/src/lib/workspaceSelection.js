export function getWorkspaceSelectionView({
  workspaceId,
  workspaceName,
  hasApiAccess,
  canManageWorkspaceUsers,
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
    return {
      type: "invitation",
      workspaceName: String(invitation.workspace_name || "Untitled Workspace"),
      hasWorkspaceApiAccess: false,
      canManageWorkspace: false,
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

  return {
    type: "workspace",
    workspaceName: String(workspaceName || ""),
    hasWorkspaceApiAccess: Boolean(hasApiAccess),
    canManageWorkspace: Boolean(canManageWorkspaceUsers),
    invitation: null,
  };
}
