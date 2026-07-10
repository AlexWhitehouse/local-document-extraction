export function createWorkspaceRequestAdapter({ request }) {
  function normalizedWorkspaceId(workspaceId) {
    const value = String(workspaceId || "").trim();
    if (!value) {
      throw new Error("Workspace ID is required");
    }
    return value;
  }

  return {
    async deleteWorkspace(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);

      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}`,
        { method: "DELETE" },
        true,
        false,
      );
      if (result?.ok !== true || result.workspace_id !== normalizedId) {
        throw new Error("Workspace deletion returned an invalid response");
      }
      return result;
    },
    async listWorkspaceUsers(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);
      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}/users`,
        { method: "GET" },
        true,
        false,
      );
      return Array.isArray(result?.users) ? result.users : [];
    },
    async applyWorkspaceMemberAction({ workspaceId, targetUserId, action }) {
      const normalizedId = normalizedWorkspaceId(workspaceId);
      const normalizedTargetUserId = String(targetUserId || "").trim();
      if (!normalizedTargetUserId) {
        throw new Error("Workspace user ID is required");
      }
      const normalizedAction = String(action || "").trim();
      if (!normalizedAction) {
        throw new Error("Workspace member action is required");
      }
      return request(
        `/workspaces/${encodeURIComponent(normalizedId)}/users/${encodeURIComponent(normalizedTargetUserId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: normalizedAction }),
        },
        true,
        false,
      );
    },
    async listWorkspaceInvitations(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);
      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}/invitations`,
        { method: "GET" },
        true,
        false,
      );
      return Array.isArray(result?.invitations) ? result.invitations : [];
    },
    leaveWorkspace(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);
      return request(
        `/workspaces/${encodeURIComponent(normalizedId)}/leave`,
        { method: "POST" },
        true,
        false,
      );
    },
  };
}
