import React from "react";

export function WorkspaceContextList({
  search,
  workspaces,
  selectedWorkspaceId,
  selectedWorkspaceInvitationId,
  isLoading,
  hasResolutionError,
  onSearchChange,
  onSelectAcceptedWorkspace,
  onSelectInvitedWorkspace,
  onRetryResolution,
}) {
  return (
    <>
      <label>
        Search Workspaces
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Workspace name or ID"
        />
      </label>
      <div className="context-list">
        {isLoading ? (
          <p className="muted">Loading workspace context</p>
        ) : hasResolutionError ? (
          <>
            <p className="muted">Workspace resolution error</p>
            <button type="button" className="secondary" onClick={onRetryResolution}>
              Retry Workspaces
            </button>
          </>
        ) : (
          workspaces.map((workspace) => (
            <button
              type="button"
              key={
                workspace.type === "invitation"
                  ? `workspace-invitation-${workspace.invitation_id}`
                  : `workspace-${workspace.id}`
              }
              className={getWorkspaceItemClassName({
                workspace,
                selectedWorkspaceId,
                selectedWorkspaceInvitationId,
              })}
              onClick={() => {
                if (workspace.type === "invitation") {
                  onSelectInvitedWorkspace(workspace);
                  return;
                }
                onSelectAcceptedWorkspace(workspace);
              }}
            >
              <strong>{workspace.name}</strong>
              <span>{workspace.id}</span>
              {workspace.type === "invitation" ? (
                <span className="workspace-invited-meta">
                  Invited as {formatRoleLabel(workspace.role)}
                </span>
              ) : null}
              {workspace.connected ? <span>Connected</span> : null}
            </button>
          ))
        )}
      </div>
    </>
  );
}

function getWorkspaceItemClassName({
  workspace,
  selectedWorkspaceId,
  selectedWorkspaceInvitationId,
}) {
  return [
    "context-item context-item-workspace",
    workspace.type === "invitation" ? "invited" : "",
    workspace.type === "invitation"
      ? workspace.invitation_id === selectedWorkspaceInvitationId
        ? "active"
        : ""
      : workspace.id === selectedWorkspaceId && !selectedWorkspaceInvitationId
        ? "active"
        : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatRoleLabel(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  if (!role) {
    return "-";
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}
