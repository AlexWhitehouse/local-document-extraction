import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
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
  const rowMotion = useRowMotion(workspaces, workspaceKey);
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
          <p className="muted" role="status">Loading Workspaces…</p>
        ) : hasResolutionError ? (
          <>
            <p className="muted form-error" role="alert">Workspace resolution error</p>
            <button type="button" className="secondary" onClick={onRetryResolution}>
              Retry
            </button>
          </>
        ) : !workspaces.length ? (
          <p className="muted">{String(search || "").trim() ? "No Workspaces match this search." : "No Workspaces yet."}</p>
        ) : (
          workspaces.map((workspace) => {
            const itemClassName = getWorkspaceItemClassName({
              workspace,
              selectedWorkspaceId,
              selectedWorkspaceInvitationId,
            });
            return (
              <div
                key={workspaceKey(workspace)}
                className={itemClassName + rowMotion(workspaceKey(workspace))}
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

function workspaceKey(workspace) {
  return workspace.type === "invitation"
    ? `workspace-invitation-${workspace.invitation_id}`
    : `workspace-${workspace.id}`;
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
