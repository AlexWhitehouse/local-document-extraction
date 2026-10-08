import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { ListStatus } from "../ui/States.jsx";
import { IconButton } from "../ui/Button.jsx";
import { Badge } from "../ui/Status.jsx";
import { ChevronLeftIcon, ChevronRightIcon } from "../layout/Icons.jsx";
import { accountFlags, displayName, isApplicationAdmin, safeText, userIdOf } from "./adminAccounts.js";

export function AdminContextList({ admin }) {
  const rowMotion = useRowMotion(admin.users, userKey);
  const selectedId = userIdOf(admin.selectedUser);
  const isSearching = Boolean(admin.submittedSearch.value.trim());
  // Keep rows on screen while a later page loads; only a first load or an empty result shows the skeleton.
  const status = admin.listError ? "error" : admin.isLoading && !admin.users.length ? "loading" : "ready";

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
      <ScrollArea className="context-list admin-account-list" role="region" aria-label="Account list" tabIndex={0}>
        <ListStatus
          status={status}
          errorMessage={admin.listError}
          onRetry={admin.onRetry}
          isEmpty={!admin.users.length}
          emptyMessage={isSearching ? "No users match this search." : "No users found."}
        >
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
        </ListStatus>
      </ScrollArea>
    </>
  );
}

export function AdminContextFooter({ admin }) {
  const pageCount = Math.max(1, Math.ceil(admin.total / admin.pageSize));

  return (
    <>
      <Badge>Total users {admin.total}</Badge>
      {pageCount > 1 ? (
        <div className="admin-context-pager">
          <IconButton
            label="Previous page"
            icon={ChevronLeftIcon}
            disabled={admin.isLoading || !admin.hasPreviousPage}
            onClick={admin.onPreviousPage}
          />
          <span>
            Page {admin.currentPage} of {pageCount}
          </span>
          <IconButton
            label="Next page"
            icon={ChevronRightIcon}
            disabled={admin.isLoading || !admin.hasNextPage}
            onClick={admin.onNextPage}
          />
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
        <Badge key={flag.label} tone={flag.tone}>
          {flag.label}
        </Badge>
      ))}
    </span>
  ) : null;
}

function userKey(user) {
  return `account-${userIdOf(user) || user.email}`;
}
