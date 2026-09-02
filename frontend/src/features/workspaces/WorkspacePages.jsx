import React from "react";
import { WorkspaceModelConfiguration } from "./WorkspaceModelConfiguration.jsx";

export function WorkspaceInvitationPage({
  invitation,
  isAcceptingWorkspaceInvitation,
  isDecliningWorkspaceInvitation,
  onAcceptInvitation,
  onDeclineInvitation,
}) {
  const isPending = String(invitation.status || "").toLowerCase() === "pending";
  const actionsDisabled =
    isAcceptingWorkspaceInvitation || isDecliningWorkspaceInvitation || !isPending;

  return (
    <>
      <section className="content-grid invitation-detail-grid">
        <article className="workspace-card invitation-detail-card">
          <div className="workspace-head">
            <h2>Pending Invitation</h2>
            <p>
              Review who invited you and what role you will receive before
              accepting or declining.
            </p>
          </div>

          <dl className="invitation-detail-list">
            <div>
              <dt>Workspace</dt>
              <dd>{invitation.workspaceName}</dd>
            </div>
            <div>
              <dt>Invited email</dt>
              <dd>{invitation.email || "-"}</dd>
            </div>
            <div>
              <dt>Offered role</dt>
              <dd>
                <span className="role-badge">{formatRoleLabel(invitation.role)}</span>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{formatRoleLabel(invitation.status)}</dd>
            </div>
            <div>
              <dt>Inviter</dt>
              <dd>{invitation.inviter || "-"}</dd>
            </div>
            <div>
              <dt>Invited</dt>
              <dd>{formatTimestamp(invitation.invitedAt)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{formatTimestamp(invitation.expiresAt)}</dd>
            </div>
          </dl>

          <div className="invitation-locked-panel">
            <strong>No workspace access yet</strong>
            <p>
              Templates, documents, jobs, API keys, uploads, rename, deletion,
              and user management stay locked until this invitation is accepted.
            </p>
          </div>

          <div className="actions invitation-actions">
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={onAcceptInvitation}
            >
              {isAcceptingWorkspaceInvitation ? "Accepting..." : "Accept Invitation"}
            </button>
            <button
              type="button"
              className="danger"
              disabled={actionsDisabled}
              onClick={onDeclineInvitation}
            >
              {isDecliningWorkspaceInvitation ? "Declining..." : "Decline Invitation"}
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

export function AcceptedWorkspacePage({
  modelConfiguration,
  modelConfigurationKey,
  workspaceName,
  onWorkspaceNameChange,
  isSavingWorkspace,
  isWorkspaceNameDirty,
  onSaveWorkspaceChanges,
  apiKey,
  workspaceApiKeyPlaceholder,
  onCopyVisibleWorkspaceApiKey,
  busy,
  canRotateWorkspaceApiKey,
  workspaceApiKeyActionLabel,
  onRefreshApiKey,
  inviteEmail,
  onInviteEmailChange,
  inviteRole,
  onInviteRoleChange,
  hasApiAccess,
  onInviteUser,
  isLoadingWorkspaceUsers,
  workspaceUsers,
  canShowWorkspaceUserAction,
  sessionUserId,
  onSelectWorkspaceUserActionTarget,
  canManageWorkspaceInvitations,
  workspaceInvitations,
  onCancelWorkspaceInvitation,
}) {
  return (
    <>
      {modelConfiguration ? <WorkspaceModelConfiguration key={modelConfigurationKey} controller={modelConfiguration} /> : null}
      <section className="content-grid workspace-page-grid">
        <article className="workspace-card">
          <div className="workspace-head">
            <h2>Workspace details &amp; API access</h2>
            <p>Manage the Workspace name and inbound API access. Gateway credentials are configured separately above.</p>
          </div>
          <div className="row two-up workspace-name-row">
            <label>
              Workspace name
              <input
                value={workspaceName}
                disabled={busy || isSavingWorkspace}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary workspace-inline-action"
              disabled={busy || isSavingWorkspace || !isWorkspaceNameDirty}
              onClick={onSaveWorkspaceChanges}
            >
              {isSavingWorkspace ? "Saving..." : "Save Changes"}
            </button>
          </div>
          <label>
            API key
            <div className="row two-up workspace-key-row">
              <div className="workspace-key-field">
                <input value={apiKey} readOnly placeholder={workspaceApiKeyPlaceholder} />
                {apiKey ? (
                  <button
                    type="button"
                    className="icon-action-button workspace-key-copy-button"
                    aria-label="Copy API key"
                    onClick={onCopyVisibleWorkspaceApiKey}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="workspace-inline-action"
                disabled={busy || !canRotateWorkspaceApiKey}
                onClick={onRefreshApiKey}
              >
                {workspaceApiKeyActionLabel}
              </button>
            </div>
          </label>
        </article>

        <article className="workspace-card">
          <div className="workspace-head">
            <h2>Invite Users</h2>
            <p>Invite teammates to join this workspace.</p>
          </div>
          <div className="row two-up">
            <label>
              Invite email
              <input
                value={inviteEmail}
                onChange={(event) => onInviteEmailChange(event.target.value)}
                placeholder="teammate@example.com"
              />
            </label>
            <label>
              Invite role
              <select
                value={inviteRole}
                onChange={(event) => onInviteRoleChange(event.target.value)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || !hasApiAccess}
              onClick={onInviteUser}
            >
              Invite User
            </button>
          </div>
        </article>
      </section>

      <section className="content-grid workspace-users-grid">
        <article className="workspace-card">
          <div className="workspace-head">
            <h2>Workspace Users</h2>
            <p>Current members and their roles.</p>
          </div>
          {isLoadingWorkspaceUsers ? null : workspaceUsers.length ? (
            <div className="table-scroll workspace-users-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {workspaceUsers.map((user) => (
                    <tr key={String(user.user_id || user.email || "")}>
                      <td>{String(user.name || "-")}</td>
                      <td>{String(user.email || "-")}</td>
                      <td>
                        <span className="role-badge">{formatRoleLabel(user.role)}</span>
                      </td>
                      <td>{formatJoinedAt(user.created_at)}</td>
                      <td>
                        {canShowWorkspaceUserAction(user) &&
                        String(user.user_id || "").trim() !== sessionUserId ? (
                          <button
                            type="button"
                            className="icon-action-button"
                            aria-label="Edit user"
                            onClick={() => onSelectWorkspaceUserActionTarget(user)}
                          >
                            ✎
                          </button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No workspace users found.</p>
          )}
        </article>

        {canManageWorkspaceInvitations && workspaceInvitations.length > 0 ? (
          <article className="workspace-card">
            <div className="workspace-head">
              <h2>Pending Invitations</h2>
              <p>Actionable workspace invitations that have not been accepted.</p>
            </div>
            {workspaceInvitations.length ? (
              <div className="table-scroll workspace-users-table">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Inviter</th>
                      <th>Invited</th>
                      <th>Expires</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceInvitations.map((invitation) => (
                      <tr key={String(invitation.id || invitation.email || "")}>
                        <td>{String(invitation.email || "-")}</td>
                        <td>
                          <span className="role-badge">
                            {formatRoleLabel(invitation.role)}
                          </span>
                        </td>
                        <td>{formatRoleLabel(invitation.status)}</td>
                        <td>
                          {String(
                            invitation.inviter_display ||
                              invitation.inviter_name ||
                              invitation.inviter_email ||
                              "-",
                          )}
                        </td>
                        <td>{formatJoinedAt(invitation.created_at)}</td>
                        <td>{formatJoinedAt(invitation.expires_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="icon-action-button"
                            aria-label={`Cancel invitation for ${String(invitation.email || "invitee")}`}
                            disabled={busy}
                            onClick={() => onCancelWorkspaceInvitation(invitation)}
                          >
                            x
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No pending invitations found.</p>
            )}
          </article>
        ) : null}
      </section>
    </>
  );
}

function formatJoinedAt(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString();
}

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function formatRoleLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
