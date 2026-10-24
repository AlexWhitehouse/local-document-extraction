import React, { useEffect, useId, useState } from "react";
import { formatRoleLabel } from "../../lib/workspaceSelection";
import { pluralize } from "../../lib/text";
import { getInvitationEmailState, nextResendOpening } from "./invitationEmail";
import { WorkspaceModelConfiguration } from "./WorkspaceModelConfiguration.jsx";
import { WorkspaceDocumentProcessingSettings } from "./WorkspaceDocumentProcessingSettings.jsx";
import { WorkspaceSourceStorage } from "./WorkspaceSourceStorage.jsx";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";
import { confirmDialog } from "../ui/confirm.jsx";
import { ErrorState, ListStatus, Skeleton } from "../ui/States.jsx";
import { CloseIcon, CopyIcon, EditIcon, LinkIcon, MailIcon, PlusIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { CopyField } from "../ui/CopyField.jsx";
import { Badge } from "../ui/Status.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { CheckboxField, Field, Select, TextInput } from "../ui/Field.jsx";
import { Callout } from "../ui/Callout.jsx";
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
                <Badge tone="info">{formatRoleLabel(invitation.role)}</Badge>
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

          <Callout tone="warning" className="invitation-locked-panel" title="No workspace access yet">
            Accept the invitation to access this workspace.
          </Callout>

          <div className="actions invitation-actions">
            <Button
              pending={isAcceptingWorkspaceInvitation}
              pendingLabel="Accepting…"
              disabled={actionsDisabled}
              onClick={onAcceptInvitation}
            >
              Accept invitation
            </Button>
            <Button
              variant="secondary"
              pending={isDecliningWorkspaceInvitation}
              pendingLabel="Declining…"
              disabled={actionsDisabled}
              onClick={onDeclineInvitation}
            >
              Decline invitation
            </Button>
          </div>
        </article>
      </section>
    </>
  );
}

// `canAddBucket`: the viewer can give this workspace its own bucket, which makes retention possible.
function WorkspaceSourceRetention({ controller, canAddBucket }) {
  const { settings, loading, saving, error, canManage } = controller;
  const configured = settings?.storage_configured === true;
  const retaining = settings?.source_retention_disabled === false && configured;
  const ownBucket = settings?.storage_location === "workspace";

  const explanation = !settings
    ? ""
    : !configured
      ? canAddBucket
        ? "Add a bucket for this workspace below to keep originals."
        : "Originals can't be kept in this setup."
      : !settings.installation_retains_originals
        ? "Your administrator has turned this off, so new uploads keep only extraction results."
        : retaining
          ? ownBucket
            ? "New uploads keep their original in this workspace's own bucket until it is deleted."
            : "New uploads keep their original for viewing and download until it is deleted."
          : "New uploads keep only extraction results. Existing originals stay available.";

  return (
    <section className="studio-api-access studio-source-retention" aria-label="Original documents">
      <div className="studio-section-heading">
        <div>
          <h2>Original documents</h2>
        </div>
      </div>
      {!settings && loading ? <Skeleton rows={1} height={56} label="Loading document retention…" /> : null}
      {!settings && error ? <ErrorState message={error} onRetry={controller.reload} /> : null}
      {settings ? (
        <>
          <div className="studio-setting-toggles">
            <CheckboxField
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
          <Button variant="text" onClick={controller.reload}>
            Try again
          </Button>
        </p>
      ) : null}
    </section>
  );
}

export function AcceptedWorkspacePage({
  processingSettings,
  sourceRetention,
  sourceStorage,
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
  workspaceApiKeyHint,
  onCopyVisibleWorkspaceApiKey,
  canRotateWorkspaceApiKey,
  isIssuingApiKey,
  workspaceApiKeyActionLabel,
  workspaceApiKeyPendingLabel,
  onRefreshApiKey,
  inviteEmail,
  onInviteEmailChange,
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
  createdInvitation,
  onDismissCreatedInvitation,
  onCopyInvitationLink,
  resendingInvitationId,
  onResendWorkspaceInvitation,
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  // Remembers which key was copied, so the one-time callout hides for that key only.
  const [copiedApiKey, setCopiedApiKey] = useState("");
  const showApiKeyCallout = Boolean(apiKey) && copiedApiKey !== apiKey;
  const apiKeyInputId = useId();
  const apiKeyHintId = useId();

  return (
    <div className="studio-workspace-page">
      <div className="studio-workspace-settings">
        <section className="studio-workspace-details">
          <div className="studio-section-heading">
            <div>
              <h2>Workspace details</h2>
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
            <Field label="Workspace name" className="studio-name-field">
              <TextInput
                value={workspaceName}
                disabled={isSavingWorkspace || !hasApiAccess}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              pending={isSavingWorkspace}
              pendingLabel="Saving…"
              disabled={!hasApiAccess || !isWorkspaceNameDirty}
            >
              Save name
            </Button>
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
              </div>
            </div>
            {/* Hand-built Field: the key button sits beside the input, so the hint must not sit beside it. */}
            <div className="ui-field workspace-key-field">
              <label htmlFor={apiKeyInputId} className="ui-field-label">
                Workspace API key
              </label>
              <div className="workspace-key-row">
                <div className="workspace-key-input">
                  <TextInput
                    id={apiKeyInputId}
                    value={apiKey}
                    readOnly
                    aria-describedby={!apiKey && workspaceApiKeyHint ? apiKeyHintId : undefined}
                  />
                  {apiKey ? (
                    <IconButton
                      size="sm"
                      label="Copy API key"
                      icon={CopyIcon}
                      className="workspace-key-copy-button"
                      onClick={async () => {
                        if (await onCopyVisibleWorkspaceApiKey()) setCopiedApiKey(apiKey);
                      }}
                    />
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  pending={isIssuingApiKey}
                  pendingLabel={workspaceApiKeyPendingLabel}
                  disabled={!canRotateWorkspaceApiKey}
                  onClick={onRefreshApiKey}
                >
                  {workspaceApiKeyActionLabel}
                </Button>
              </div>
              {!apiKey && workspaceApiKeyHint ? (
                <p id={apiKeyHintId} className="ui-field-hint">
                  {workspaceApiKeyHint}
                </p>
              ) : null}
            </div>
            {showApiKeyCallout ? (
              <Callout tone="warning" role="status">
                This key won't be shown again. Copy it now.
              </Callout>
            ) : null}
          </section>
          {sourceRetention ? (
            <WorkspaceSourceRetention
              controller={sourceRetention}
              canAddBucket={sourceStorage?.canManage === true && sourceStorage.record?.overrides_enabled === true}
            />
          ) : null}
          {sourceStorage?.canManage ? (
            <WorkspaceSourceStorage key={modelConfigurationKey} controller={sourceStorage} />
          ) : null}
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
            <h2>Members</h2>
          </div>
          <Button
            variant="secondary"
            disabled={!hasApiAccess || !canManageWorkspaceInvitations}
            aria-expanded={inviteOpen}
            aria-controls="workspace-invite-form"
            onClick={() => setInviteOpen(!inviteOpen)}
          >
            {inviteOpen ? (
              "Cancel"
            ) : (
              <>
                <PlusIcon size={13} /> Invite user
              </>
            )}
          </Button>
        </div>
        {inviteOpen ? (
          <WorkspaceInviteForm
            disabled={!hasApiAccess || !canManageWorkspaceInvitations}
            email={inviteEmail}
            isInviting={isInvitingUser}
            role={inviteRole}
            onEmailChange={onInviteEmailChange}
            onRoleChange={onInviteRoleChange}
            onSubmit={onInviteUser}
          />
        ) : null}
        {createdInvitation ? (
          <CreatedInvitationLink
            invitation={createdInvitation}
            onCopy={onCopyInvitationLink}
            onDismiss={onDismissCreatedInvitation}
          />
        ) : null}
        <ListStatus
          status={workspaceUsersStatus}
          error={workspaceUsersError}
          onRetry={onRetryWorkspaceUsers}
          isEmpty={workspaceUsers.length === 0}
          emptyMessage="No members found."
        >
          <div className="studio-user-list" role="region" aria-label="Members list" tabIndex={0}>
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
                    <IconButton
                      size="sm"
                      label={`Edit ${String(user.name || user.email || "user")}`}
                      icon={EditIcon}
                      onClick={() => onSelectWorkspaceUserActionTarget(user)}
                    />
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
            </div>
          </div>
          <ListStatus
            status={workspaceInvitationsStatus}
            error={workspaceInvitationsError}
            onRetry={onRetryWorkspaceInvitations}
            isEmpty={workspaceInvitations.length === 0}
            emptyMessage="No pending invitations."
          >
            <PendingInvitationsTable
              invitations={workspaceInvitations}
              resendingInvitationId={resendingInvitationId}
              onCopyLink={onCopyInvitationLink}
              onResend={onResendWorkspaceInvitation}
              onCancel={onCancelWorkspaceInvitation}
            />
          </ListStatus>
        </section>
      ) : null}
    </div>
  );
}

// What the inviter does with the link depends on whether its email went out.
const INVITE_LINK_NOTES = {
  sent: { tone: "info", message: (email) => `We emailed this link to ${email}. You can also share it yourself.` },
  captured: { tone: "info", message: (email) => `This setup doesn't send email, so share this link with ${email} yourself.` },
  failed: { tone: "warning", message: (email) => `The email couldn't be sent, so share this link with ${email} yourself.` },
  rate_limited: {
    tone: "warning",
    message: (email) => `The daily limit for invitation emails is reached, so share this link with ${email} yourself.`,
  },
  unknown: { tone: "info", message: (email) => `Share this link with ${email} so they can accept.` },
};

// Stays until dismissed, the next invitation replaces it, or the page changes. Rows keep a Copy link action.
function CreatedInvitationLink({ invitation, onCopy, onDismiss }) {
  const note = INVITE_LINK_NOTES[invitation.delivery] || INVITE_LINK_NOTES.unknown;

  return (
    <Callout
      tone={note.tone}
      title="Invite link"
      className="studio-invite-link"
      action={<IconButton size="sm" label="Dismiss invite link" icon={CloseIcon} onClick={onDismiss} />}
    >
      <p>{note.message(invitation.email)}</p>
      <CopyField
        label={`Invite link for ${invitation.email}`}
        labelHidden
        value={invitation.inviteUrl}
        icon={LinkIcon}
        copyLabel="Copy link"
        hint={`Only someone signed in as ${invitation.email} can accept it.`}
        onCopy={() => onCopy(invitation.inviteUrl)}
      />
    </Callout>
  );
}

// Re-renders when the soonest resend cooldown ends, so its Resend opens without a reload.
function useClockUntil(nextAt) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (nextAt === null) return undefined;

    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextAt - Date.now()) + 250);

    return () => clearTimeout(timer);
  }, [nextAt]);

  return now;
}

function PendingInvitationsTable({ invitations, resendingInvitationId, onCopyLink, onResend, onCancel }) {
  const now = useClockUntil(nextResendOpening(invitations, Date.now()));

  return (
    <div className="table-scroll studio-invitation-list" role="region" aria-label="Pending invitations" tabIndex={0}>
      <DataTable label="Pending invitations">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Inviter</th>
            <th>Invited</th>
            <th>Expires</th>
            <th className="table-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <PendingInvitationRow
              key={String(invitation.id || invitation.email || "")}
              invitation={invitation}
              now={now}
              isResending={resendingInvitationId === invitation.id}
              resendBusy={Boolean(resendingInvitationId)}
              onCopyLink={onCopyLink}
              onResend={onResend}
              onCancel={onCancel}
            />
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

function PendingInvitationRow({ invitation, now, isResending, resendBusy, onCopyLink, onResend, onCancel }) {
  const noteId = useId();
  const target = String(invitation.email || "invitee");
  const email = getInvitationEmailState(invitation, now);
  const note = describeInvitationEmail(email, now);

  return (
    <tr>
      <td>
        <div className="studio-invitation-email">
          <span>{String(invitation.email || "—")}</span>
          {note ? <small id={noteId}>{note}</small> : null}
        </div>
      </td>
      <td>{formatRoleLabel(invitation.role)}</td>
      <td>{email.expired ? <Badge tone="warning">Expired</Badge> : <Badge>Pending</Badge>}</td>
      <td>{String(invitation.inviter_display || invitation.inviter_name || invitation.inviter_email || "—")}</td>
      <td>{formatJoinedAt(invitation.created_at)}</td>
      <td>{formatJoinedAt(invitation.expires_at)}</td>
      <td className="table-actions">
        <div className="studio-invitation-actions">
          {email.inviteUrl ? (
            <IconButton
              size="sm"
              label={`Copy link for ${target}`}
              icon={LinkIcon}
              onClick={() => onCopyLink(email.inviteUrl)}
            />
          ) : null}
          {email.supportsResend ? (
            <IconButton
              size="sm"
              label={`Resend email to ${target}`}
              icon={MailIcon}
              disabled={!email.canResend || resendBusy}
              aria-busy={isResending || undefined}
              aria-describedby={!email.canResend && note ? noteId : undefined}
              onClick={() => onResend(invitation)}
            />
          ) : null}
          <IconButton
            size="sm"
            variant="danger"
            label={`Cancel invitation for ${target}`}
            icon={CloseIcon}
            onClick={() => onCancel(invitation)}
          />
        </div>
      </td>
    </tr>
  );
}

// The line under the email: when it was last emailed, then why Resend is closed or what it does.
function describeInvitationEmail(email, now) {
  if (!email.supportsResend) return "";

  const sent = email.lastEmailedAt === null ? "Not emailed yet" : `Last emailed ${formatShortDateTime(email.lastEmailedAt, now)}`;

  const resend = email.noResendsLeft
    ? "No resends left"
    : email.resendBlockedUntil !== null
      ? `Resend from ${formatShortDateTime(email.resendBlockedUntil, now)}`
      : email.expired
        ? "Resend to renew it"
        : "";

  return resend ? `${sent} · ${resend}` : sent;
}

// "14:05" today, "21 Oct, 14:05" on other days, in the viewer's locale.
function formatShortDateTime(time, now) {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (date.toDateString() === new Date(now).toDateString()) return clock;

  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${clock}`;
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

function WorkspaceInviteForm({ disabled, email, isInviting, role, onEmailChange, onRoleChange, onSubmit }) {
  const emailInputId = useId();
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
          document.getElementById(emailInputId)?.focus();

          return;
        }

        void onSubmit();
      }}
    >
      <Field label="Invite email" error={emailError} className="studio-invite-field">
        <TextInput
          id={emailInputId}
          type="email"
          required
          disabled={disabled}
          value={email}
          onChange={(event) => {
            onEmailChange(event.target.value);
            setEmailError("");
          }}
          onBlur={checkEmail}
          placeholder="teammate@example.com"
        />
      </Field>
      <Field label="Invite role">
        <Select disabled={disabled} value={role} onChange={(event) => onRoleChange(event.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled} pending={isInviting} pendingLabel="Inviting…">
        Invite user
      </Button>
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
            <Button
              key={action}
              variant={action === "remove_user" ? "danger" : "ghost"}
              disabled={Boolean(pendingAction)}
              pending={pendingAction === action}
              pendingLabel={WORKSPACE_USER_ACTION_LABELS[action].pending}
              onClick={() =>
                WORKSPACE_USER_CONFIRMATIONS[action] ? confirmAction(action) : applyAction(action)
              }
            >
              {WORKSPACE_USER_ACTION_LABELS[action].label}
            </Button>
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
  make_member: { label: "Make member", pending: "Making member…" },
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
  make_member: {
    dialog: (name) => ({
      title: `Make ${name} a member?`,
      body: "They'll keep access but can no longer manage members or workspace settings.",
      confirmLabel: "Make member",
      pendingLabel: "Making member…",
      tone: "default",
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
