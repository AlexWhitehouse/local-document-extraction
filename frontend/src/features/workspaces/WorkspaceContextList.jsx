import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { formatRoleLabel } from "../../lib/workspaceSelection";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { ListStatus } from "../ui/States.jsx";
import { appPath } from "../../lib/appRoutes";

export function WorkspaceContextList({
  routed = false,
  workspaces,
  selectedWorkspaceId,
  selectedWorkspaceInvitationId,
  isLoading,
  hasResolutionError,
  onSelectAcceptedWorkspace,
  onSelectInvitedWorkspace,
  onRetryResolution,
}) {
  const rowMotion = useRowMotion(workspaces, workspaceKey);
  const status = isLoading ? "loading" : hasResolutionError ? "error" : "ready";

  return (
    <ScrollArea className="context-list" role="region" aria-label="Workspace list" tabIndex={0}>
      <ListStatus
        status={status}
        errorMessage="Workspaces couldn't be loaded."
        onRetry={onRetryResolution}
        isEmpty={!workspaces.length}
        emptyMessage="No workspaces yet."
      >
        {workspaces.map((workspace) => {
          const isActive = isWorkspaceActive({
            workspace,
            selectedWorkspaceId,
            selectedWorkspaceInvitationId,
          });

          const itemClassName = getWorkspaceItemClassName({ workspace, isActive });

          return (
            <div key={workspaceKey(workspace)} className={itemClassName + rowMotion(workspaceKey(workspace))}>
              <NavigationLink
                href={
                  routed
                    ? appPath({
                        workspaceId: workspace.id,
                        invitationId: workspace.type === "invitation" ? workspace.invitation_id : undefined,
                      })
                    : undefined
                }
                className={itemClassName.replace("context-item-card", "context-item-main")}
                data-context-select aria-current={isActive ? "true" : undefined}
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
                  <span className="workspace-invited-meta">Invited as {formatRoleLabel(workspace.role)}</span>
                ) : null}
                {workspace.connected ? <span>Connected</span> : null}
              </NavigationLink>
              <ContextCopyButton ariaLabel={`Copy workspace ID ${workspace.id}`} label="Workspace ID" value={workspace.id} />
            </div>
          );
        })}
      </ListStatus>
    </ScrollArea>
  );
}

function workspaceKey(workspace) {
  return workspace.type === "invitation"
    ? `workspace-invitation-${workspace.invitation_id}`
    : `workspace-${workspace.id}`;
}

function isWorkspaceActive({ workspace, selectedWorkspaceId, selectedWorkspaceInvitationId }) {
  return workspace.type === "invitation"
    ? workspace.invitation_id === selectedWorkspaceInvitationId
    : workspace.id === selectedWorkspaceId && !selectedWorkspaceInvitationId;
}

function getWorkspaceItemClassName({ workspace, isActive }) {
  return [
    "context-item-card context-item-workspace",
    workspace.type === "invitation" ? "invited" : "",
    isActive ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
