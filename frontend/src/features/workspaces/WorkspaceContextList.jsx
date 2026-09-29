import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { formatRoleLabel } from "../../lib/workspaceSelection";

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
      <ScrollArea className="context-list" role="region" aria-label="Workspace list" tabIndex={0}>
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
          workspaces.map((workspace) => {
            const itemClassName = getWorkspaceItemClassName({
              workspace,
              selectedWorkspaceId,
              selectedWorkspaceInvitationId,
            });
            return (
              <div
                key={
                  workspace.type === "invitation"
                    ? `workspace-invitation-${workspace.invitation_id}`
                    : `workspace-${workspace.id}`
                }
                className={itemClassName}
              >
                <button
                  type="button"
                  className={itemClassName.replace("context-item-card", "context-item-main")}
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
                <ContextCopyButton
                  ariaLabel={`Copy workspace ID ${workspace.id}`}
                  value={workspace.id}
                />
              </div>
            );
          })
        )}
      </ScrollArea>
    </>
  );
}

function getWorkspaceItemClassName({
  workspace,
  selectedWorkspaceId,
  selectedWorkspaceInvitationId,
}) {
  const isActive =
    workspace.type === "invitation"
      ? workspace.invitation_id === selectedWorkspaceInvitationId
      : workspace.id === selectedWorkspaceId && !selectedWorkspaceInvitationId;
  return [
    "context-item-card context-item-workspace",
    workspace.type === "invitation" ? "invited" : "",
    isActive ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
