import React, { useEffect, useRef, useState } from "react";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";

export function ApplicationAdminPage({ admin }) {
  return (
    <>
      <header className="studio-page-heading">
        <p className="studio-eyebrow">Admin / Accounts</p>
        <h1>Application admin</h1>
        <div className="studio-heading-actions">
          <span className="status-chip">Total users {admin.total}</span>
        </div>
        <p className="studio-page-description">
          Manage application-wide accounts separately from Workspace access.
        </p>
      </header>

      <section className="studio-admin-users">
        <div className="studio-section-heading">
          <div>
            <h2>Account management</h2>
            <p>Find Better Auth accounts without exposing Workspace data.</p>
          </div>
        </div>

        <form className="admin-user-search" onSubmit={admin.onSubmitSearch}>
          <label>
            Search field
            <select
              value={admin.searchField}
              onChange={(event) => admin.onSearchFieldChange(event.target.value)}
            >
              <option value="email">Email</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label>
            Search users
            <input
              value={admin.searchInput}
              placeholder="Search by email"
              onChange={(event) => admin.onSearchInputChange(event.target.value)}
            />
          </label>
          <div className="actions compact admin-user-search-actions">
            <button
              type="button"
              className="secondary"
              disabled={admin.isLoading || !admin.submittedSearch.value}
              onClick={admin.onClearSearch}
            >
              Clear search
            </button>
            <button type="submit" disabled={admin.isLoading}>Search</button>
          </div>
        </form>

        {admin.listError ? (
          <div className="form-error admin-list-error" role="alert">
            {admin.listError}
            <button type="button" className="studio-text-button" onClick={admin.onRetry}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="table-scroll admin-users-table" aria-label="Application admin users">
          <table className="studio-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Email status</th>
                <th>Application role</th>
                <th>Access</th>
                <th>Ban reason</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {admin.users.length ? (
                admin.users.map((user) => (
                  <tr key={String(user.id || user.email)}>
                    <td>{safeText(user.email)}</td>
                    <td>{safeText(user.name)}</td>
                    <td>
                      <span className={isEmailVerified(user) ? "status-chip good" : "status-chip warn"}>
                        {isEmailVerified(user) ? "Verified" : "Unverified"}
                      </span>
                    </td>
                    <td>
                      {isApplicationAdmin(user) ? (
                        <span className="status-chip busy">Application admin</span>
                      ) : (
                        "Regular user"
                      )}
                    </td>
                    <td>
                      <span className={user.banned ? "status-chip bad" : "status-chip"}>
                        {user.banned ? "Banned" : "Active"}
                      </span>
                    </td>
                    <td>{user.banned ? safeText(user.banReason) : "Not banned"}</td>
                    <td className="admin-user-created">{formatExactLocalDateTime(user.createdAt)}</td>
                    <td className="admin-user-actions-cell"><UserActionsMenu admin={admin} user={user} /></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="studio-table-empty">
                    {admin.isLoading ? <span role="status">Loading users…</span> : "No users found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="admin-user-pagination">
          <span className="studio-eyebrow">Page {admin.currentPage}</span>
          <div className="actions compact">
            <button
              type="button"
              className="secondary"
              disabled={admin.isLoading || !admin.hasPreviousPage}
              onClick={admin.onPreviousPage}
            >
              Previous
            </button>
            <button
              type="button"
              className="secondary"
              disabled={admin.isLoading || !admin.hasNextPage}
              onClick={admin.onNextPage}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {admin.banDialogUser ? <BanUserDialog admin={admin} user={admin.banDialogUser} /> : null}
      {admin.unbanDialogUser ? <UnbanUserDialog admin={admin} user={admin.unbanDialogUser} /> : null}
    </>
  );
}

function UserActionsMenu({ admin, user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const actions = getUserActions(admin, user, () => setIsOpen(false));
  const email = safeText(user.email);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeMenu() {
      setIsOpen(false);
    }

    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [isOpen]);

  function toggleMenu() {
    const nextIsOpen = !isOpen;
    if (nextIsOpen && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 180;
      const menuHeight = Math.max(actions.length, 1) * 42 + 12;
      const top =
        triggerRect.bottom + menuHeight > window.innerHeight - 8
          ? Math.max(8, triggerRect.top - menuHeight - 6)
          : triggerRect.bottom + 6;
      setMenuPosition({
        top,
        left: Math.max(8, triggerRect.right - menuWidth),
      });
    }
    setIsOpen(nextIsOpen);
  }

  return (
    <div className="admin-user-actions-menu">
      <button
        ref={triggerRef}
        type="button"
        className="icon-action-button admin-user-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`User actions for ${email}`}
        onClick={toggleMenu}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {isOpen ? (
        <div className="admin-user-actions-dropdown" role="menu" style={menuPosition}>
          {actions.length ? (
            actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={action.className || "ghost"}
                disabled={action.disabled}
                role="menuitem"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))
          ) : (
            <span className="muted" role="menuitem">
              No actions available
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function getUserActions(admin, user, closeMenu) {
  const userId = String(user.id || "").trim();
  const isCurrentUser = userId && userId === String(admin.sessionUserId || "").trim();
  const disabled = admin.isLoading || admin.mutatingUserId === userId;
  const action = (label, run, className) => ({
    label,
    className,
    disabled,
    onClick: () => {
      closeMenu();
      run(user);
    },
  });

  const actions = [];
  if (isApplicationAdmin(user)) {
    if (!isCurrentUser) actions.push(action("Remove admin", admin.onRemoveAdmin));
  } else {
    actions.push(action("Make admin", admin.onMakeAdmin));
  }
  if (user.banned) {
    actions.push(action("Unban user", admin.onOpenUnbanDialog));
  } else if (!isCurrentUser) {
    actions.push(action("Ban user", admin.onOpenBanDialog, "ghost danger"));
  }
  if (!isCurrentUser && !isApplicationAdmin(user) && !user.banned) {
    actions.push(action("Impersonate user", admin.onStartImpersonation));
  }
  return actions;
}

function UnbanUserDialog({ admin, user }) {
  const email = safeText(user.email);

  return (
    <ModalDialog className="admin-user-action-modal" label={`Unban ${email}`} initialFocus=".actions button" onClose={admin.onCloseUnbanDialog}>
      <ModalHeader
        title={`Unban ${email}`}
        description="Restoring access allows this Better Auth account to sign in again."
        onClose={admin.onCloseUnbanDialog}
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
        <button type="button" className="secondary" onClick={admin.onCloseUnbanDialog}>
          Cancel
        </button>
        <button
          type="button"
          disabled={admin.mutatingUserId === String(user.id || "").trim()}
          onClick={admin.onConfirmUnban}
        >
          Confirm unban
        </button>
      </div>
    </ModalDialog>
  );
}

function BanUserDialog({ admin, user }) {
  const email = safeText(user.email);

  return (
    <ModalDialog className="admin-user-action-modal" label={`Ban ${email}`} initialFocus="textarea" onClose={admin.onCloseBanDialog}>
      <ModalHeader
        title={`Ban ${email}`}
        description="This permanently blocks Better Auth account access. Workspace data is unchanged."
        onClose={admin.onCloseBanDialog}
      />
      <form className="admin-user-action-form" onSubmit={admin.onConfirmBan}>
        {isApplicationAdmin(user) ? (
          <p className="form-warning">You are banning another Application admin.</p>
        ) : null}
        <label>
          Ban reason
          <textarea
            value={admin.banReason}
            onChange={(event) => admin.onBanReasonChange(event.target.value)}
            rows={4}
          />
        </label>
        {admin.banReasonError ? (
          <p className="form-error" role="alert">{admin.banReasonError}</p>
        ) : null}
        <div className="actions">
          <button type="button" className="secondary" onClick={admin.onCloseBanDialog}>
            Cancel
          </button>
          <button type="submit" className="danger" disabled={admin.mutatingUserId === String(user.id || "").trim()}>
            Confirm ban
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

function safeText(value) {
  const text = String(value || "").trim();
  return text || "—";
}

function isEmailVerified(user) {
  return Boolean(user.emailVerified ?? user.email_verified);
}

function isApplicationAdmin(user) {
  return String(user.role || "user").trim() === "admin";
}

function formatExactLocalDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ];
  return `${parts.join("-")} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
