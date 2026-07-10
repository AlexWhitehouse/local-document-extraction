import React, { useEffect, useRef, useState } from "react";

export function ApplicationAdminPage({ admin }) {
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Admin</p>
        <h2>Application Admin</h2>
        <p>Manage application-wide accounts separately from Workspace access.</p>
      </header>

      <section className="content-grid admin-page-grid">
          <article className="workspace-card admin-user-panel">
            <div className="workspace-head admin-user-panel-head">
              <div>
                <h2>Account Management</h2>
                <p>Find Better Auth accounts without exposing Workspace data.</p>
              </div>
              <span className="status-chip">Total users {admin.total}</span>
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
                <button type="submit" disabled={admin.isLoading}>Search</button>
                <button
                  type="button"
                  className="secondary"
                  disabled={admin.isLoading || !admin.submittedSearch.value}
                  onClick={admin.onClearSearch}
                >
                  Clear Search
                </button>
              </div>
            </form>

            {admin.listError ? (
              <div className="form-error" role="alert">
                {admin.listError}
                <button type="button" className="ghost" onClick={admin.onRetry}>
                  Retry
                </button>
              </div>
            ) : null}

            {admin.isLoading ? <p className="muted">Loading users...</p> : null}

            <div className="table-scroll admin-users-table" aria-label="Application admin users">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Email Status</th>
                    <th>Application Role</th>
                    <th>Banned</th>
                    <th>Ban Reason</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.users.length ? (
                    admin.users.map((user) => (
                      <tr key={String(user.id || user.email)}>
                        <td>{safeText(user.email)}</td>
                        <td>{safeText(user.name)}</td>
                        <td>{isEmailVerified(user) ? "Verified" : "Unverified"}</td>
                        <td>{formatApplicationRole(user.role)}</td>
                        <td>{user.banned ? "Banned" : "Active"}</td>
                        <td>{user.banned ? safeText(user.banReason) : "Not banned"}</td>
                        <td>{formatExactLocalDateTime(user.createdAt)}</td>
                        <td>{renderUserActions(admin, user)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="admin-user-pagination">
              <span className="muted">Page {admin.currentPage}</span>
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
          </article>
      </section>

      {admin.banDialogUser ? <BanUserDialog admin={admin} user={admin.banDialogUser} /> : null}
      {admin.unbanDialogUser ? <UnbanUserDialog admin={admin} user={admin.unbanDialogUser} /> : null}
    </>
  );
}

function renderUserActions(admin, user) {
  return <UserActionsMenu admin={admin} user={user} />;
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
        className="secondary admin-user-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`User actions for ${email}`}
        onClick={toggleMenu}
      >
        <span aria-hidden="true">...</span>
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
  return [
    getRoleAction(admin, user, closeMenu),
    getBanAction(admin, user, closeMenu),
    getImpersonationAction(admin, user, closeMenu),
  ].filter(Boolean);
}

function getImpersonationAction(admin, user, closeMenu) {
  const userId = String(user.id || "").trim();
  const isCurrentUser = userId && userId === String(admin.sessionUserId || "").trim();
  const isMutating = admin.mutatingUserId === userId;

  if (isCurrentUser || String(user.role || "user").trim() === "admin" || user.banned) {
    return null;
  }

  return {
    label: "Impersonate user",
    disabled: admin.isLoading || isMutating,
    onClick: () => {
      closeMenu();
      admin.onStartImpersonation(user);
    },
  };
}

function getRoleAction(admin, user, closeMenu) {
  const userId = String(user.id || "").trim();
  const isCurrentUser = userId && userId === String(admin.sessionUserId || "").trim();
  const isMutating = admin.mutatingUserId === userId;

  if (String(user.role || "user").trim() === "admin") {
    if (isCurrentUser) {
      return null;
    }

    return {
      label: "Remove admin",
      disabled: admin.isLoading || isMutating,
      onClick: () => {
        closeMenu();
        admin.onRemoveAdmin(user);
      },
    };
  }

  return {
    label: "Make admin",
    disabled: admin.isLoading || isMutating,
    onClick: () => {
      closeMenu();
      admin.onMakeAdmin(user);
    },
  };
}

function getBanAction(admin, user, closeMenu) {
  const userId = String(user.id || "").trim();
  const isCurrentUser = userId && userId === String(admin.sessionUserId || "").trim();
  const isMutating = admin.mutatingUserId === userId;

  if (user.banned) {
    return {
      label: "Unban user",
      disabled: admin.isLoading || isMutating,
      onClick: () => {
        closeMenu();
        admin.onOpenUnbanDialog(user);
      },
    };
  }

  if (isCurrentUser) {
    return null;
  }

  return {
    label: "Ban user",
    className: "ghost danger",
    disabled: admin.isLoading || isMutating,
    onClick: () => {
      closeMenu();
      admin.onOpenBanDialog(user);
    },
  };
}

function UnbanUserDialog({ admin, user }) {
  const email = safeText(user.email);

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card admin-user-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Unban ${email}`}
      >
        <div className="workspace-head">
          <div>
            <h2>Unban {email}</h2>
            <p>Restoring access allows this Better Auth account to sign in again.</p>
          </div>
        </div>
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
        <div className="actions compact">
          <button
            type="button"
            disabled={admin.mutatingUserId === String(user.id || "").trim()}
            onClick={admin.onConfirmUnban}
          >
            Confirm unban
          </button>
          <button type="button" className="secondary" onClick={admin.onCloseUnbanDialog}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BanUserDialog({ admin, user }) {
  const email = safeText(user.email);

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card admin-user-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Ban ${email}`}
        onSubmit={admin.onConfirmBan}
      >
        <div className="workspace-head">
          <div>
            <h2>Ban {email}</h2>
            <p>This permanently blocks Better Auth account access. Workspace data is unchanged.</p>
          </div>
        </div>
        {String(user.role || "user").trim() === "admin" ? (
          <p className="form-error">You are banning another Application admin.</p>
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
        <div className="actions compact">
          <button type="submit" disabled={admin.mutatingUserId === String(user.id || "").trim()}>
            Confirm ban
          </button>
          <button type="button" className="secondary" onClick={admin.onCloseBanDialog}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function safeText(value) {
  const text = String(value || "").trim();
  return text || "-";
}

function isEmailVerified(user) {
  return Boolean(user.emailVerified ?? user.email_verified);
}

function formatApplicationRole(role) {
  return String(role || "user").trim() === "admin" ? "Application Admin" : "Regular User";
}

function formatExactLocalDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
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
