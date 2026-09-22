import React, { useState } from "react";
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
    isAcceptingWorkspaceInvitation ||
    isDecliningWorkspaceInvitation ||
    !isPending;

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
                <span className="role-badge">
                  {formatRoleLabel(invitation.role)}
                </span>
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
              Templates, documents, API keys, uploads, rename, deletion, and
              user management stay locked until this invitation is accepted.
            </p>
          </div>

          <div className="actions invitation-actions">
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={onAcceptInvitation}
            >
              {isAcceptingWorkspaceInvitation
                ? "Accepting..."
                : "Accept Invitation"}
            </button>
            <button
              type="button"
              className="danger"
              disabled={actionsDisabled}
              onClick={onDeclineInvitation}
            >
              {isDecliningWorkspaceInvitation
                ? "Declining..."
                : "Decline Invitation"}
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
  workspaceId,
  workspaceRole,
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
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <div className="studio-workspace-page">
      <div className="studio-workspace-settings">
        <section className="studio-workspace-details">
          <div className="studio-section-heading">
            <div>
              <h2>Workspace details</h2>
              <p>The basics for this environment.</p>
            </div>
          </div>
          <form
            className="studio-name-form"
            data-tour="workspace-name"
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveWorkspaceChanges();
            }}
          >
            <label htmlFor="workspace-name">Workspace name</label>
            <div className="studio-name-input">
              <input
                id="workspace-name"
                value={workspaceName}
                disabled={busy || isSavingWorkspace || !hasApiAccess}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
              />
              <button
                type="submit"
                className="secondary"
                disabled={
                  busy ||
                  isSavingWorkspace ||
                  !hasApiAccess ||
                  !isWorkspaceNameDirty
                }
              >
                {isSavingWorkspace ? "Saving..." : "Save name"}
              </button>
            </div>
          </form>
          <dl className="studio-workspace-facts">
            <div>
              <dt>Workspace ID</dt>
              <dd>
                <code>{workspaceId || "—"}</code>
              </dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd>{formatRoleLabel(workspaceRole)}</dd>
            </div>
          </dl>
          <section className="studio-api-access">
            <div className="studio-section-heading">
              <div>
                <h2>API access</h2>
                <p>Connect your applications to Studio.</p>
              </div>
            </div>
            <label>
              Workspace API key
              <div className="workspace-key-field">
                <input
                  aria-label="Workspace API key"
                  value={apiKey}
                  readOnly
                  placeholder={workspaceApiKeyPlaceholder}
                />
                {apiKey ? (
                  <button
                    type="button"
                    className="icon-action-button workspace-key-copy-button"
                    aria-label="Copy API key"
                    onClick={onCopyVisibleWorkspaceApiKey}
                  >
                    ⧉
                  </button>
                ) : null}
              </div>
            </label>
            <div className="studio-api-footer">
              <span>For inbound requests to this workspace.</span>
              <button
                type="button"
                className="studio-text-button"
                disabled={busy || !canRotateWorkspaceApiKey}
                onClick={onRefreshApiKey}
              >
                {workspaceApiKeyActionLabel}
              </button>
            </div>
          </section>
        </section>
        {modelConfiguration ? (
          <WorkspaceModelConfiguration
            key={modelConfigurationKey}
            controller={modelConfiguration}
            inline
          />
        ) : null}
      </div>
      <section className="studio-workspace-users">
        <div className="studio-section-heading">
          <div>
            <h2>Workspace users</h2>
            <p>The people who can access this workspace.</p>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={busy || !hasApiAccess || !canManageWorkspaceInvitations}
            aria-expanded={inviteOpen}
            aria-controls="workspace-invite-form"
            onClick={() => setInviteOpen(!inviteOpen)}
          >
            {inviteOpen ? "Cancel invitation" : "+ Invite user"}
          </button>
        </div>
        {inviteOpen ? (
          <form
            noValidate
            id="workspace-invite-form"
            className="studio-invite-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onInviteUser();
            }}
          >
            <label>
              Invite email
              <input
                type="email"
                required
                disabled={busy}
                value={inviteEmail}
                onChange={(event) => onInviteEmailChange(event.target.value)}
                placeholder="teammate@example.com"
              />
            </label>
            <label>
              Invite role
              <select
                disabled={busy}
                value={inviteRole}
                onChange={(event) => onInviteRoleChange(event.target.value)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              type="submit"
              className="secondary"
              disabled={busy || !hasApiAccess || !canManageWorkspaceInvitations}
            >
              Invite User
            </button>
          </form>
        ) : null}
        {isLoadingWorkspaceUsers ? (
          <p className="muted" role="status">
            Loading workspace users…
          </p>
        ) : workspaceUsers.length ? (
          <div
            className="studio-user-list"
            role="region"
            aria-label="Workspace user list"
            tabIndex={0}
          >
            <div role="list">
              {workspaceUsers.map((user) => (
                <div
                  className="studio-user-row"
                  role="listitem"
                  key={String(user.user_id || user.email || "")}
                >
                  <span className="studio-initials" aria-hidden="true">
                    {String(user.name || user.email || "?")
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="studio-user-name">
                    <strong>{String(user.name || "—")}</strong>
                    <span>{String(user.email || "—")}</span>
                  </div>
                  <div className="studio-user-role">
                    <span>{formatRoleLabel(user.role)}</span>
                    <small>Joined {formatJoinedAt(user.created_at)}</small>
                  </div>
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
                    <span />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">No workspace users found.</p>
        )}
        <p className="studio-users-note">
          {workspaceUsers.length} users · Access is managed by owners and
          admins.
        </p>
      </section>
      {canManageWorkspaceInvitations && workspaceInvitations.length > 0 ? (
        <section className="studio-pending-invitations">
          <div className="studio-section-heading">
            <div>
              <h2>Pending Invitations</h2>
              <p>Workspace invitations that have not been accepted.</p>
            </div>
          </div>
          <div
            className="table-scroll studio-invitation-list"
            role="region"
            aria-label="Pending invitations"
            tabIndex={0}
          >
            <table className="studio-table">
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
                    <td>{String(invitation.email || "—")}</td>
                    <td>{formatRoleLabel(invitation.role)}</td>
                    <td>{formatRoleLabel(invitation.status)}</td>
                    <td>
                      {String(
                        invitation.inviter_display ||
                          invitation.inviter_name ||
                          invitation.inviter_email ||
                          "—",
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
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
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
