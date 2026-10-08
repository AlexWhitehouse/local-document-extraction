import React from "react";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";
import { Button } from "../ui/Button.jsx";
import { PageHeader } from "../ui/PageHeader.jsx";
import { Badge } from "../ui/Status.jsx";
import { Field, Textarea } from "../ui/Field.jsx";
import { displayName, isApplicationAdmin, isEmailVerified, safeText, userIdOf } from "./adminAccounts.js";

export function ApplicationAdminPage({ admin, breadcrumbs = [] }) {
  const user = admin.selectedUser;
  const isCurrentUser = Boolean(user) && userIdOf(user) === String(admin.sessionUserId || "").trim();
  const actions = user ? getUserActions(admin, user) : [];
  const visibleActions = actions.filter((action) => !action.rare);
  const overflowActions = actions.filter((action) => action.rare);

  return (
    <>
      <PageHeader
        label="Admin"
        breadcrumbs={breadcrumbs}
        title={user ? displayName(user) : "Admin"}
        description={user ? safeText(user.email) : "Manage accounts across every workspace."}
        actions={
          <>
            {isCurrentUser ? <Badge tone="success">Your account</Badge> : null}
            {visibleActions.map((action) => (
              <Button key={action.label} variant={action.variant} disabled={action.disabled} onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </>
        }
        overflowActions={overflowActions.map((action) => ({
          key: action.label,
          label: action.label,
          danger: action.variant === "danger",
          disabled: action.disabled,
          onSelect: action.onClick,
        }))}
      />

      {user ? (
        <div className="studio-workspace-settings admin-account-settings">
          <section aria-label="Account details">
            <div className="studio-section-heading">
              <div>
                <h2>Account details</h2>
              </div>
            </div>
            <dl className="studio-workspace-facts">
              <div>
                <dt>Name</dt>
                <dd>{safeText(user.name)}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{safeText(user.email)}</dd>
              </div>
              <div>
                <dt>Email status</dt>
                <dd>
                  <Badge tone={isEmailVerified(user) ? "success" : "warning"}>
                    {isEmailVerified(user) ? "Verified" : "Unverified"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  <code>{formatExactLocalDateTime(user.createdAt)}</code>
                </dd>
              </div>
            </dl>
          </section>
          <section className="studio-workspace-model-settings" aria-label="Application access">
            <div className="studio-section-heading">
              <div>
                <h2>Application access</h2>
                <p>Role and sign-in access across every Workspace.</p>
              </div>
            </div>
            <dl className="studio-workspace-facts">
              <div>
                <dt>Application role</dt>
                <dd>
                  {isApplicationAdmin(user) ? (
                    <Badge tone="info">Application admin</Badge>
                  ) : (
                    "Regular user"
                  )}
                </dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>
                  <Badge tone={user.banned ? "danger" : "neutral"}>{user.banned ? "Banned" : "Active"}</Badge>
                </dd>
              </div>
              <div>
                <dt>Ban reason</dt>
                <dd>{user.banned ? safeText(user.banReason) : "Not banned"}</dd>
              </div>
            </dl>
            <p className="studio-users-note">
              {isCurrentUser
                ? "You can't remove your own admin access or ban your own account."
                : "Application admins manage every account. Roles inside a Workspace are set by its owners."}
            </p>
          </section>
        </div>
      ) : (
        <p className="studio-empty-state">
          {admin.isLoading ? "Loading users…" : "Choose an account from the list to see its details."}
        </p>
      )}

      {admin.banDialogUser ? <BanUserDialog admin={admin} user={admin.banDialogUser} /> : null}
      {admin.unbanDialogUser ? <UnbanUserDialog admin={admin} user={admin.unbanDialogUser} /> : null}
    </>
  );
}

function getUserActions(admin, user) {
  const userId = String(user.id || "").trim();
  const isCurrentUser = userId && userId === String(admin.sessionUserId || "").trim();
  const disabled = admin.isLoading || admin.mutatingUserId === userId;

  // Rare or destructive actions go in the overflow menu; see PageHeader.
  const action = (label, run, variant, rare = variant === "danger") => ({
    label,
    variant,
    disabled,
    rare,
    onClick: () => run(user),
  });

  const actions = [];

  if (!isCurrentUser && !isApplicationAdmin(user) && !user.banned) {
    actions.push(action("Impersonate user", admin.onStartImpersonation, "secondary"));
  }

  if (isApplicationAdmin(user)) {
    if (!isCurrentUser) actions.push(action("Remove admin", admin.onRemoveAdmin, "secondary", true));
  } else {
    actions.push(action("Make admin", admin.onMakeAdmin, "secondary"));
  }

  if (user.banned) {
    actions.push(action("Unban user", admin.onOpenUnbanDialog, "secondary"));
  } else if (!isCurrentUser) {
    actions.push(action("Ban user", admin.onOpenBanDialog, "danger"));
  }

  return actions;
}

function UnbanUserDialog({ admin, user }) {
  const email = safeText(user.email);
  const pending = admin.mutatingUserId === String(user.id || "").trim();

  return (
    <ModalDialog
      className="admin-user-action-modal"
      label={`Unban ${email}`}
      initialFocus=".actions button"
      closeDisabled={pending}
      onClose={admin.onCloseUnbanDialog}
    >
      <ModalHeader
        title={`Unban ${email}`}
        description="They'll be able to sign in again."
        onClose={admin.onCloseUnbanDialog}
        closeDisabled={pending}
      />
      <dl className="admin-user-action-details">
        <div>
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Existing ban reason</dt>
          <dd>{safeText(user.banReason)}</dd>
        </div>
      </dl>
      <div className="actions">
        <Button variant="secondary" onClick={admin.onCloseUnbanDialog}>
          Cancel
        </Button>
        <Button pending={pending} pendingLabel="Unbanning…" onClick={admin.onConfirmUnban}>
          Unban user
        </Button>
      </div>
    </ModalDialog>
  );
}

function BanUserDialog({ admin, user }) {
  const email = safeText(user.email);
  const pending = admin.mutatingUserId === String(user.id || "").trim();

  return (
    <ModalDialog
      className="admin-user-action-modal"
      label={`Ban ${email}`}
      initialFocus="textarea"
      isDirty={Boolean(admin.banReason.trim())}
      closeDisabled={pending}
      onClose={admin.onCloseBanDialog}
    >
      <ModalHeader
        title={`Ban ${email}`}
        description="They won't be able to sign in until you unban them. Their workspace data is kept."
        onClose={admin.onCloseBanDialog}
        closeDisabled={pending}
      />
      <form className="admin-user-action-form" onSubmit={admin.onConfirmBan}>
        {isApplicationAdmin(user) ? <p className="form-warning">You're banning another application admin.</p> : null}
        <Field label="Reason" error={admin.banReasonError}>
          <Textarea
            value={admin.banReason}
            onChange={(event) => admin.onBanReasonChange(event.target.value)}
            placeholder="e.g. Spam account"
            rows={4}
          />
        </Field>
        <div className="actions">
          <Button variant="secondary" onClick={admin.onCloseBanDialog}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" pending={pending} pendingLabel="Banning…">
            Ban user
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

function formatExactLocalDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const parts = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())];

  return `${parts.join("-")} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
