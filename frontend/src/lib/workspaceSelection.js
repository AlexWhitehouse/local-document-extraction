const UNTITLED_WORKSPACE_NAME = "Untitled workspace";

export function getWorkspaceContextDisplay({
  hasApiAccess,
  workspaceId,
  workspaceName,
  selectedWorkspaceInvitationId,
  userWorkspaces,
  userWorkspaceInvitations,
}) {
  const acceptedEntries = userWorkspaces.map((workspace) => ({
    id: String(workspace.id || ""),
    name: String(workspace.name || UNTITLED_WORKSPACE_NAME),
    connected: String(workspace.id || "") === workspaceId,
    type: "workspace",
    role: String(workspace.role || ""),
  }));

  const invitedEntries = userWorkspaceInvitations
    .map((invitation) => ({
      id: String(invitation.workspace_id || ""),
      invitation_id: String(invitation.id || ""),
      name: String(invitation.workspace_name || UNTITLED_WORKSPACE_NAME),
      connected: false,
      type: "invitation",
      role: String(invitation.role || ""),
      email: String(invitation.email || ""),
      inviter_name: String(invitation.inviter_name || ""),
      inviter_email: String(invitation.inviter_email || ""),
      inviter_display: String(invitation.inviter_display || ""),
      updated_at: String(invitation.updated_at || invitation.created_at || ""),
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const availableWorkspaces = [...acceptedEntries, ...invitedEntries];

  // Without any accepted Workspace, the newest invitation is the only thing to show.
  const effectiveInvitationId =
    selectedWorkspaceInvitationId.trim() ||
    (acceptedEntries.length === 0 ? invitedEntries[0]?.invitation_id || "" : "");

  const selectedWorkspaceName = availableWorkspaces.find((workspace) => workspace.id === workspaceId)?.name || "";

  const invitation = userWorkspaceInvitations.find(
    (candidate) => String(candidate.id || "").trim() === effectiveInvitationId,
  );

  return {
    availableWorkspaces,
    selectedWorkspaceName,
    selectedWorkspaceInvitationId: effectiveInvitationId,
    workspaceSelectionView: invitation
      ? {
          type: "invitation",
          workspaceName: String(invitation.workspace_name || UNTITLED_WORKSPACE_NAME),
          hasWorkspaceApiAccess: false,
          invitation: {
            id: String(invitation.id || ""),
            workspaceId: String(invitation.workspace_id || ""),
            workspaceName: String(invitation.workspace_name || UNTITLED_WORKSPACE_NAME),
            email: String(invitation.email || ""),
            role: String(invitation.role || ""),
            status: String(invitation.status || "pending"),
            inviter: String(invitation.inviter_display || invitation.inviter_name || invitation.inviter_email || ""),
            invitedAt: String(invitation.created_at || ""),
            expiresAt: String(invitation.expires_at || ""),
          },
        }
      : {
          type: "workspace",
          workspaceName: selectedWorkspaceName.trim() || workspaceName.trim() || "Local workspace",
          hasWorkspaceApiAccess: hasApiAccess,
          invitation: null,
        },
  };
}

export function selectAcceptedWorkspaceContext(workspace) {
  return {
    workspaceId: String(workspace.id || ""),
    workspaceName: String(workspace.name || UNTITLED_WORKSPACE_NAME),
    selectedWorkspaceInvitationId: "",
    apiKey: "",
  };
}

export function resolveAcceptedWorkspace({ storedWorkspacePreference, userWorkspaces }) {
  const storedWorkspaceId = String(storedWorkspacePreference?.workspaceId || "").trim();

  return (
    userWorkspaces.find((workspace) => String(workspace.id || "") === storedWorkspaceId) || userWorkspaces[0] || null
  );
}

export function getWorkspacePrimaryAction(workspaceRole) {
  const role = workspaceRole.trim().toLowerCase();

  if (role === "owner") {
    return { type: "delete", label: "Delete workspace" };
  }

  if (role === "admin" || role === "member") {
    return { type: "leave", label: "Leave workspace" };
  }

  return { type: "none", label: "" };
}

export function getWorkspaceMemberPermissions(role) {
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();

  const canManage = normalizedRole === "owner" || normalizedRole === "admin";

  return {
    canListUsers: canManage || normalizedRole === "member",
    canManage,
    isOwner: normalizedRole === "owner",
  };
}

export function canShowWorkspaceUserAction(permissions, targetRole) {
  const role = String(targetRole || "")
    .trim()
    .toLowerCase();

  return role === "owner" ? permissions.isOwner : permissions.canManage;
}

export function getWorkspaceUserActions(permissions, targetRole) {
  const role = String(targetRole || "")
    .trim()
    .toLowerCase();

  if (role === "owner") {
    return permissions.isOwner ? ["make_admin"] : [];
  }

  if (role === "admin") {
    if (permissions.isOwner) return ["remove_user", "make_member", "make_owner"];

    return permissions.canManage ? ["remove_user", "make_owner"] : [];
  }

  if (role === "member") {
    if (permissions.isOwner) return ["remove_user", "make_admin", "make_owner"];

    if (permissions.canManage) return ["remove_user"];
  }

  return [];
}

export function formatRoleLabel(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "—";
  }

  return normalized
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
