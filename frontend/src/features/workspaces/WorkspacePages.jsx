import React, { useId, useRef, useState } from "react";
import { formatRoleLabel } from "../../lib/workspaceSelection";
import { pluralize } from "../../lib/text";
import { WorkspaceModelConfiguration } from "./WorkspaceModelConfiguration.jsx";
import { WorkspaceDocumentProcessingSettings } from "./WorkspaceDocumentProcessingSettings.jsx";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";
import { confirmDialog } from "../ui/confirm.jsx";
import { ErrorState, ListStatus, Skeleton } from "../ui/States.jsx";
import { CopyIcon, EditIcon } from "../layout/Icons.jsx";
import { SettingToggle } from "./SettingToggle.jsx";
import "./WorkspacePages.css";

const INVITE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns the message for the first problem with an invite email, or "" when it is usable.
function validateInviteEmail(value) {
  const email = String(value || "").trim();

  if (!email) return "Enter an email address.";

  return INVITE_EMAIL_PATTERN.test(email) ? "" : "Enter an email address like name@example.com.";
}

export function WorkspaceInvitationPage({
  invitation,
  isAcceptingWorkspaceInvitation,
  isDecliningWorkspaceInvitation,
  onAcceptInvitation,
  onDeclineInvitation,
}) {
  const isPending = String(invitation.status || "").toLowerCase() === "pending";

  const actionsDisabled = isAcceptingWorkspaceInvitation || isDecliningWorkspaceInvitation || !isPending;

  return (
    <>
      <section className="content-grid invitation-detail-grid">
        <article className="workspace-card invitation-detail-card">
          <div className="workspace-head">
            <h2>Pending invitation</h2>
            <p>Review who invited you and what role you will receive before accepting or declining.</p>
          </div>

          <dl className="invitation-detail-list">
            <div>
              <dt>Workspace</dt>
              <dd>{invitation.workspaceName}</dd>
            </div>
            <div>
              <dt>Invited email</dt>
              <dd>{invitation.email || "—"}</dd>
            </div>
            <div>
              <dt>Offered role</dt>
              <dd>
                <span className="status-chip busy">{formatRoleLabel(invitation.role)}</span>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{formatRoleLabel(invitation.status)}</dd>
            </div>
            <div>
              <dt>Inviter</dt>
              <dd>{invitation.inviter || "—"}</dd>
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
              Templates, documents, API keys, uploads, rename, deletion, and user management stay locked until this
              invitation is accepted.
            </p>
          </div>

          <div className="actions invitation-actions">
            <button type="button" disabled={actionsDisabled} onClick={onAcceptInvitation}>
              {isAcceptingWorkspaceInvitation ? "Accepting…" : "Accept invitation"}
            </button>
            <button type="button" className="danger" disabled={actionsDisabled} onClick={onDeclineInvitation}>
              {isDecliningWorkspaceInvitation ? "Declining…" : "Decline invitation"}
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

function WorkspaceSourceRetention({ controller }) {
  const { settings, loading, saving, error, canManage } = controller;
  const configured = settings?.storage_configured === true;
  const retaining = settings?.source_retention_disabled === false && configured;

  const explanation = !settings
    ? ""
    : !configured
      ? "This installation has no storage for original documents, so only extraction results are kept."
      : !settings.installation_retains_originals
        ? "Retention is turned off for this installation, so new uploads keep only their extraction results."
        : retaining
          ? "New uploads keep their original document for viewing and download until it is deleted."
          : "New uploads keep only their extraction results. Originals already retained stay available.";

  return (
    <section className="studio-api-access studio-source-retention" aria-label="Original documents">
      <div className="studio-section-heading">
        <div>
          <h2>Original documents</h2>
          <p>Whether new uploads keep their original file.</p>
        </div>
      </div>
      {!settings && loading ? <Skeleton rows={1} height={56} label="Loading document retention…" /> : null}
      {!settings && error ? <ErrorState message={error} onRetry={controller.reload} /> : null}
      {settings ? (
        <>
          <div className="studio-setting-toggles">
            <SettingToggle
              label="Retain original documents"
              description={explanation}
              checked={retaining}
              disabled={!settings || !configured || !canManage || saving}
              onChange={(checked) => void controller.setRetainOriginals(checked)}
            />
          </div>
          {configured && !canManage ? <p className="studio-users-note">An owner or admin manages this setting.</p> : null}
        </>
      ) : null}
      {settings && error ? (
        <p role="alert" className="form-error">
          {error}{" "}
          <button type="button" className="studio-text-button" onClick={controller.reload}>
            Try again
          </button>
        </p>
      ) : null}
    </section>
  );
}

export function AcceptedWorkspacePage({
  processingSettings,
  sourceRetention,
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
  canRotateWorkspaceApiKey,
  isIssuingApiKey,
  workspaceApiKeyActionLabel,
  workspaceApiKeyPendingLabel,
  onRefreshApiKey,
  inviteEmail,
  onInviteEmailChange,
  inviteError,
  isInvitingUser,
  inviteRole,
  onInviteRoleChange,
  hasApiAccess,
  onInviteUser,
  workspaceUsersStatus,
  workspaceUsersError,
  onRetryWorkspaceUsers,
  workspaceUsers,
  canShowWorkspaceUserAction,
  sessionUserId,
  onSelectWorkspaceUserActionTarget,
  canManageWorkspaceInvitations,
  workspaceInvitations,
  workspaceInvitationsStatus,
  workspaceInvitationsError,
  onRetryWorkspaceInvitations,
  onCancelWorkspaceInvitation,
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  // Remembers which key was copied, so the one-time callout hides for that key only.
  const [copiedApiKey, setCopiedApiKey] = useState("");
  const showApiKeyCallout = Boolean(apiKey) && copiedApiKey !== apiKey;

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
                disabled={isSavingWorkspace || !hasApiAccess}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
              />
              <button
                type="submit"
                className="secondary"
                disabled={isSavingWorkspace || !hasApiAccess || !isWorkspaceNameDirty}
              >
                {isSavingWorkspace ? "Saving…" : "Save name"}
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
                    onClick={async () => {
                      if (await onCopyVisibleWorkspaceApiKey()) setCopiedApiKey(apiKey);
                    }}
                  >
                    <CopyIcon size={14} />
                  </button>
                ) : null}
              </div>
            </label>
            {showApiKeyCallout ? (
              <p role="status" className="workspace-key-callout">
                This key won't be shown again. Copy it now.
              </p>
            ) : null}
            <div className="studio-api-footer">
              <span>For inbound requests to this workspace.</span>
              <button
                type="button"
                className="studio-text-button"
                disabled={isIssuingApiKey || !canRotateWorkspaceApiKey}
                onClick={onRefreshApiKey}
              >
                {isIssuingApiKey ? workspaceApiKeyPendingLabel : workspaceApiKeyActionLabel}
              </button>
            </div>
          </section>
          {sourceRetention ? <WorkspaceSourceRetention controller={sourceRetention} /> : null}
        </section>
        {modelConfiguration || processingSettings ? (
          <div className="studio-workspace-model-settings">
            {modelConfiguration ? (
              <WorkspaceModelConfiguration key={modelConfigurationKey} controller={modelConfiguration} />
            ) : null}
            {processingSettings ? <WorkspaceDocumentProcessingSettings controller={processingSettings} /> : null}
          </div>
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
            disabled={!hasApiAccess || !canManageWorkspaceInvitations}
            aria-expanded={inviteOpen}
            aria-controls="workspace-invite-form"
            onClick={() => setInviteOpen(!inviteOpen)}
          >
            {inviteOpen ? "Cancel" : "+ Invite user"}
          </button>
        </div>
        {inviteOpen ? (
          <WorkspaceInviteForm
            disabled={!hasApiAccess || !canManageWorkspaceInvitations}
            email={inviteEmail}
            error={inviteError}
            isInviting={isInvitingUser}
            role={inviteRole}
            onEmailChange={onInviteEmailChange}
            onRoleChange={onInviteRoleChange}
            onSubmit={onInviteUser}
          />
        ) : null}
        <ListStatus
          status={workspaceUsersStatus}
          error={workspaceUsersError}
          onRetry={onRetryWorkspaceUsers}
          isEmpty={workspaceUsers.length === 0}
          emptyMessage="No workspace users found."
        >
          <div className="studio-user-list" role="region" aria-label="Workspace user list" tabIndex={0}>
            <div role="list">
              {workspaceUsers.map((user) => (
                <div className="studio-user-row" role="listitem" key={String(user.user_id || user.email || "")}>
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
                    {user.created_at ? <small>Joined {formatJoinedAt(user.created_at)}</small> : null}
                  </div>
                  {canShowWorkspaceUserAction(user) && String(user.user_id || "").trim() !== sessionUserId ? (
                    <button
                      type="button"
                      className="icon-action-button"
                      aria-label="Edit user"
                      onClick={() => onSelectWorkspaceUserActionTarget(user)}
                    >
                      <EditIcon size={13} />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </div>
        </ListStatus>
        {workspaceUsersStatus === "ready" ? (
          <p className="studio-users-note">{pluralize(workspaceUsers.length, "member")}</p>
        ) : null}
      </section>
      {canManageWorkspaceInvitations &&
      (workspaceInvitationsStatus !== "ready" || workspaceInvitations.length > 0) ? (
        <section className="studio-pending-invitations">
          <div className="studio-section-heading">
            <div>
              <h2>Pending invitations</h2>
              <p>Workspace invitations that have not been accepted.</p>
            </div>
          </div>
          <ListStatus
            status={workspaceInvitationsStatus}
            error={workspaceInvitationsError}
            onRetry={onRetryWorkspaceInvitations}
            isEmpty={workspaceInvitations.length === 0}
            emptyMessage="No pending invitations."
          >
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
                        {String(invitation.inviter_display || invitation.inviter_name || invitation.inviter_email || "—")}
                      </td>
                      <td>{formatJoinedAt(invitation.created_at)}</td>
                      <td>{formatJoinedAt(invitation.expires_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-action-button"
                          aria-label={`Cancel invitation for ${String(invitation.email || "invitee")}`}
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
          </ListStatus>
        </section>
      ) : null}
    </div>
  );
}

function formatJoinedAt(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString();
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function WorkspaceInviteForm({ disabled, email, error, isInviting, role, onEmailChange, onRoleChange, onSubmit }) {
  const emailId = useId();
  const emailErrorId = `${emailId}-error`;
  const emailRef = useRef(null);
  const [emailError, setEmailError] = useState("");

  // Validates on blur and on submit. The message clears as soon as the user edits the address.
  function checkEmail() {
    const message = validateInviteEmail(email);

    setEmailError(message);

    return message;
  }

  return (
    <form
      noValidate
      id="workspace-invite-form"
      className="studio-invite-form"
      onSubmit={(event) => {
        event.preventDefault();

        if (checkEmail()) {
          emailRef.current?.focus();

          return;
        }

        void onSubmit();
      }}
    >
      <div className="studio-invite-field">
        <label>
          Invite email
          <input
            ref={emailRef}
            type="email"
            required
            disabled={disabled}
            value={email}
            aria-invalid={emailError ? "true" : undefined}
            aria-describedby={emailError ? emailErrorId : undefined}
            onChange={(event) => {
              onEmailChange(event.target.value);
              setEmailError("");
            }}
            onBlur={checkEmail}
            placeholder="teammate@example.com"
          />
        </label>
        {emailError ? (
          <span id={emailErrorId} className="form-error studio-invite-field-error">
            {emailError}
          </span>
        ) : null}
      </div>
      <label>
        Invite role
        <select disabled={disabled} value={role} onChange={(event) => onRoleChange(event.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <div className="studio-invite-submit">
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <button type="submit" className="secondary" disabled={disabled || isInviting}>
          {isInviting ? "Inviting…" : "Invite user"}
        </button>
      </div>
    </form>
  );
}

export function WorkspaceUserActionModal({ target, options, onClose, onApplyAction }) {
  if (!target) {
    return null;
  }

  return (
    <WorkspaceUserActionDialog
      target={target}
      options={options}
      onClose={onClose}
      onApplyAction={onApplyAction}
    />
  );
}

// Mounted only while a target is selected, so pending state resets each time the modal opens.
function WorkspaceUserActionDialog({ target, options, onClose, onApplyAction }) {
  const titleId = useId();
  const [pendingAction, setPendingAction] = useState("");
  const displayName = String(target.name || "").trim() || String(target.email || "").trim() || "this user";

  // Destructive actions go last.
  const orderedOptions = [...options.filter((action) => action !== "remove_user"), ...options.filter((action) => action === "remove_user")];

  async function applyAction(action) {
    setPendingAction(action);

    const succeeded = await onApplyAction(action);

    if (succeeded) {
      onClose();

      return;
    }

    setPendingAction("");
  }

  async function confirmAction(action) {
    const confirmation = WORKSPACE_USER_CONFIRMATIONS[action];

    // The request runs inside the confirmation, so failures stay inline there.
    const applied = await confirmDialog({
      ...confirmation.dialog(displayName),
      action: () => onApplyAction(action, { inline: true }),
    });

    if (applied) {
      onClose();
    }
  }

  return (
    <ModalDialog
      labelledBy={titleId}
      className="workspace-user-action-modal"
      onClose={onClose}
      closeDisabled={Boolean(pendingAction)}
    >
      <ModalHeader
        title="Manage user"
        titleId={titleId}
        description={`${String(target.name || "Unknown user")} · ${formatRoleLabel(target.role)}`}
        onClose={onClose}
        closeDisabled={Boolean(pendingAction)}
      />
      {orderedOptions.length ? (
        <div className="workspace-user-action-list">
          {orderedOptions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === "remove_user" ? "danger" : "ghost"}
              disabled={Boolean(pendingAction)}
              onClick={() =>
                WORKSPACE_USER_CONFIRMATIONS[action] ? confirmAction(action) : applyAction(action)
              }
            >
              {pendingAction === action
                ? WORKSPACE_USER_ACTION_LABELS[action].pending
                : WORKSPACE_USER_ACTION_LABELS[action].label}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">No actions available for this user.</p>
      )}
    </ModalDialog>
  );
}

const WORKSPACE_USER_ACTION_LABELS = {
  remove_user: { label: "Remove user", pending: "Removing…" },
  make_admin: { label: "Make admin", pending: "Making admin…" },
  make_owner: { label: "Make owner", pending: "Transferring…" },
};

const WORKSPACE_USER_CONFIRMATIONS = {
  remove_user: {
    dialog: (name) => ({
      title: `Remove ${name} from this workspace?`,
      confirmLabel: `Remove ${name}`,
      pendingLabel: "Removing…",
      tone: "danger",
    }),
  },
  make_owner: {
    dialog: (name) => ({
      title: `Make ${name} the owner?`,
      body: "You'll become an admin and can't undo this yourself.",
      confirmLabel: "Make owner",
      pendingLabel: "Transferring…",
      tone: "danger",
    }),
  },
};
