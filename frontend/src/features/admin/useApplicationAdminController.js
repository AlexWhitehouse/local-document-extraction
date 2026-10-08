import { useEffect, useState } from "react";
import { describeError } from "../../lib/describeError";
import { confirmDialog } from "../ui/confirm.jsx";

const ADMIN_USERS_PAGE_SIZE = 25;

const INITIAL_SEARCH = { field: "email", value: "" };

// Matches the other context sidebars: typing searches without a separate submit step.
const SEARCH_DEBOUNCE_MS = 300;

export function useApplicationAdminController({
  authClient,
  isActive,
  sessionUserId,
  showActionToast,
  onImpersonationStarted,
  onImpersonationStarting,
}) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchField, setSearchField] = useState(INITIAL_SEARCH.field);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState(INITIAL_SEARCH);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [mutatingUserId, setMutatingUserId] = useState("");
  const [banDialogUser, setBanDialogUser] = useState(null);
  const [unbanDialogUser, setUnbanDialogUser] = useState(null);
  const [banReason, setBanReason] = useState("");
  const [banReasonError, setBanReasonError] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");

  useEffect(() => {
    const next = { field: searchField, value: searchInput.trim() };
    const current = submittedSearch.value.trim();

    if (next.value === current && (next.field === submittedSearch.field || !current)) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setOffset(0);
      setSubmittedSearch(next);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchField, searchInput, submittedSearch.field, submittedSearch.value]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let isCurrent = true;

    async function loadUsers() {
      setIsLoading(true);
      setListError("");

      try {
        const query = {
          limit: ADMIN_USERS_PAGE_SIZE,
          offset,
          sortBy: "createdAt",
          sortDirection: "desc",
        };

        if (submittedSearch.value.trim()) {
          query.searchValue = submittedSearch.value.trim();
          query.searchField = submittedSearch.field;
          query.searchOperator = "contains";
        }

        const result = await authClient.admin.listUsers({ query });

        if (!isCurrent) {
          return;
        }

        if (result?.error) {
          throw new Error(result.error.message || "Couldn't load users.");
        }

        const data = result?.data || {};
        setUsers(Array.isArray(data.users) ? data.users : []);
        setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setUsers([]);
        setTotal(0);
        setListError(describeError(error, "Couldn't load users."));
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      isCurrent = false;
    };
  }, [authClient, isActive, offset, reloadToken, submittedSearch.field, submittedSearch.value]);

  function submitSearch(event) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch({ field: searchField, value: searchInput.trim() });
  }

  // Runs a Better Auth admin mutation for one user, then reloads the list. With `inline`,
  // failures throw so a confirmation dialog can show them instead of a toast.
  async function mutateUser(user, toastAction, mutate, fallbackMessage, { inline = false } = {}) {
    const userId = userIdOf(user);

    if (!userId) {
      return false;
    }

    setMutatingUserId(userId);

    try {
      const result = await mutate(userId);

      if (result?.error) {
        throw new Error(result.error.message || fallbackMessage);
      }

      showActionToast(toastAction, "success", { targetEmail: userLabel(user) });
      setReloadToken((current) => current + 1);

      return true;
    } catch (error) {
      if (inline) throw error;

      showActionToast(toastAction, "failure");

      return false;
    } finally {
      setMutatingUserId("");
    }
  }

  async function changeRole(user, role) {
    if (!userIdOf(user)) {
      return;
    }

    const email = userLabel(user);
    const removing = role === "user";

    await confirmDialog({
      title: removing
        ? `Remove application admin access from ${email}?`
        : `Make ${email} an application admin?`,
      body: removing
        ? "This revokes application-wide account management access."
        : "This grants application-wide account management access.",
      confirmLabel: "Change role",
      pendingLabel: "Changing role…",
      tone: "default",
      action: () =>
        mutateUser(
          user,
          "applicationRole.change",
          (userId) => authClient.admin.setRole({ userId, role }),
          "Couldn't update application role.",
          { inline: true },
        ),
    });
  }

  function openBanDialog(user) {
    setBanDialogUser(user);
    setBanReason("");
    setBanReasonError("");
  }

  function closeBanDialog() {
    setBanDialogUser(null);
    setBanReason("");
    setBanReasonError("");
  }

  async function confirmBan(event) {
    event.preventDefault();
    const reason = banReason.trim();

    if (!reason) {
      setBanReasonError("Enter a ban reason before banning this user.");

      return;
    }

    const banned = await mutateUser(
      banDialogUser,
      "applicationUser.ban",
      (userId) => authClient.admin.banUser({ userId, banReason: reason }),
      "Couldn't ban user.",
    );

    if (banned) closeBanDialog();
  }

  async function confirmUnban() {
    const unbanned = await mutateUser(
      unbanDialogUser,
      "applicationUser.unban",
      (userId) => authClient.admin.unbanUser({ userId }),
      "Couldn't unban user.",
    );

    if (unbanned) setUnbanDialogUser(null);
  }

  async function startImpersonation(user) {
    const userId = userIdOf(user);

    if (!userId) {
      return;
    }

    const name = userLabel(user);

    const confirmed = await confirmDialog({
      title: `Impersonate ${name}?`,
      body: "You'll leave the Admin page and enter this user's normal app experience.",
      confirmLabel: `Impersonate ${name}`,
      tone: "default",
    });

    if (!confirmed) {
      return;
    }

    setMutatingUserId(userId);

    try {
      onImpersonationStarting?.();
      const result = await authClient.admin.impersonateUser({ userId });

      if (result?.error) {
        throw new Error(result.error.message || "Couldn't start impersonation.");
      }

      onImpersonationStarted?.();
    } catch {
      showActionToast("applicationUser.impersonate", "failure");
    } finally {
      setMutatingUserId("");
    }
  }

  // The selection falls back to the first listed account so the detail pane is never blank.
  const selectedUser = users.find((user) => userIdOf(user) === selectedUserId) || users[0] || null;

  return {
    users,
    selectedUser,
    total,
    pageSize: ADMIN_USERS_PAGE_SIZE,
    currentPage: Math.floor(offset / ADMIN_USERS_PAGE_SIZE) + 1,
    hasPreviousPage: offset > 0,
    hasNextPage: offset + ADMIN_USERS_PAGE_SIZE < total,
    searchField,
    searchInput,
    submittedSearch,
    isLoading,
    listError,
    mutatingUserId,
    banDialogUser,
    unbanDialogUser,
    banReason,
    banReasonError,
    sessionUserId,
    onSearchFieldChange: setSearchField,
    onSearchInputChange: setSearchInput,
    onSubmitSearch: submitSearch,
    onSelectUser: (user) => setSelectedUserId(userIdOf(user)),
    onPreviousPage: () => setOffset((current) => Math.max(0, current - ADMIN_USERS_PAGE_SIZE)),
    onNextPage: () => setOffset((current) => current + ADMIN_USERS_PAGE_SIZE),
    onRetry: () => setReloadToken((current) => current + 1),
    onMakeAdmin: (user) => changeRole(user, "admin"),
    onRemoveAdmin: (user) => changeRole(user, "user"),
    onOpenBanDialog: openBanDialog,
    onCloseBanDialog: closeBanDialog,
    onBanReasonChange: (value) => {
      setBanReason(value);
      setBanReasonError("");
    },
    onConfirmBan: confirmBan,
    onOpenUnbanDialog: setUnbanDialogUser,
    onCloseUnbanDialog: () => setUnbanDialogUser(null),
    onConfirmUnban: confirmUnban,
    onStartImpersonation: startImpersonation,
  };
}

function userIdOf(user) {
  return String(user?.id || "").trim();
}

function userLabel(user) {
  return String(user?.email || "this user").trim() || "this user";
}
