import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { accountFlags, displayName, isApplicationAdmin, safeText, userIdOf } from "./adminAccounts.js";

export function AdminContextList({ admin }) {
  const rowMotion = useRowMotion(admin.users, userKey);
  const selectedId = userIdOf(admin.selectedUser);
  const isSearching = Boolean(admin.submittedSearch.value.trim());

  return (
    <>
      <form className="context-search-field" role="search" onSubmit={admin.onSubmitSearch}>
        <label htmlFor="admin-user-search">Search users</label>
        <div className="context-search-shell admin-search-shell">
          <input
            id="admin-user-search"
            value={admin.searchInput}
            placeholder={admin.searchField === "name" ? "Name" : "Email address"}
            onChange={(event) => admin.onSearchInputChange(event.target.value)}
          />
          <select
            aria-label="Search field"
            value={admin.searchField}
            onChange={(event) => admin.onSearchFieldChange(event.target.value)}
          >
            <option value="email">Email</option>
            <option value="name">Name</option>
          </select>
        </div>
      </form>
      {admin.listError ? (
        <p className="processing-error context-list-error" role="alert">
          {admin.listError}{" "}
          <button type="button" className="studio-text-button" onClick={admin.onRetry}>
            Retry
          </button>
        </p>
      ) : null}
      <ScrollArea className="context-list admin-account-list" role="region" aria-label="Account list" tabIndex={0}>
        {admin.users.map((user) => {
          const isActive = userIdOf(user) === selectedId;
          const email = safeText(user.email);

          return (
            <div
              key={userKey(user)}
              className={
                [
                  "context-item-card context-item-account",
                  user.banned ? "is-banned" : isApplicationAdmin(user) ? "is-admin" : "",
                  isActive ? "active" : "",
                ]
                  .filter(Boolean)
                  .join(" ") + rowMotion(userKey(user))
              }
            >
              <button
                type="button"
                className={isActive ? "context-item-main active" : "context-item-main"}
                aria-current={isActive ? "true" : undefined}
                onClick={() => admin.onSelectUser(user)}
              >
                <strong>{displayName(user)}</strong>
                <span>{email}</span>
                <AccountFlags user={user} />
              </button>
              <ContextCopyButton ariaLabel={`Copy email ${email}`} label="Email" value={user.email || ""} />
            </div>
          );
        })}
        {!admin.users.length ? (
          <p className="muted">
            {admin.isLoading ? (
              <span role="status">Loading users…</span>
            ) : isSearching ? (
              "No users match this search."
            ) : (
              "No users found."
            )}
          </p>
        ) : null}
      </ScrollArea>
    </>
  );
}

export function AdminContextFooter({ admin }) {
  const pageCount = Math.max(1, Math.ceil(admin.total / admin.pageSize));

  return (
    <>
      <span className="status-chip">Total users {admin.total}</span>
      {pageCount > 1 ? (
        <div className="admin-context-pager">
          <button
            type="button"
            className="secondary"
            aria-label="Previous page"
            disabled={admin.isLoading || !admin.hasPreviousPage}
            onClick={admin.onPreviousPage}
          >
            ‹
          </button>
          <span>
            Page {admin.currentPage} of {pageCount}
          </span>
          <button
            type="button"
            className="secondary"
            aria-label="Next page"
            disabled={admin.isLoading || !admin.hasNextPage}
            onClick={admin.onNextPage}
          >
            ›
          </button>
        </div>
      ) : null}
    </>
  );
}

function AccountFlags({ user }) {
  const flags = accountFlags(user);

  return flags.length ? (
    <span className="admin-account-flags">
      {flags.map((flag) => (
        <em key={flag.label} className={flag.tone}>
          {flag.label}
        </em>
      ))}
    </span>
  ) : null;
}

function userKey(user) {
  return `account-${userIdOf(user) || user.email}`;
}
