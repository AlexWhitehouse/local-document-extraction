import { useEffect, useState } from "react";

export const ADMIN_USERS_PAGE_SIZE = 25;

const INITIAL_SEARCH = { field: "email", value: "" };

export function useApplicationAdminController({
  authClient,
  isActive,
  sessionUserId,
  showActionToast,
  onImpersonationStarted,
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
          throw new Error(result.error.message || "Unable to load users.");
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
        setListError(error?.message || "Unable to load users.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    loadUsers();

    return () => {
      isCurrent = false;
    };
  }, [authClient, isActive, offset, reloadToken, submittedSearch.field, submittedSearch.value]);

  function submitSearch(event) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch({ field: searchField, value: searchInput });
  }

  function clearSearch() {
    setSearchField(INITIAL_SEARCH.field);
    setSearchInput("");
    setSubmittedSearch(INITIAL_SEARCH);
    setOffset(0);
  }

  async function changeRole(user, role) {
    const userId = String(user?.id || "").trim();
    if (!userId) {
      return;
    }

    const email = String(user?.email || "this user").trim() || "this user";
    const isRemovingAdmin = role === "user";
    const message = isRemovingAdmin
      ? `Remove Application admin access from ${email}? This revokes application-wide account management access.`
      : `Make ${email} an Application admin? This grants application-wide account management access.`;

    if (!window.confirm(message)) {
      return;
    }

    setMutatingUserId(userId);
    try {
      const result = await authClient.admin.setRole({ userId, role });
      if (result?.error) {
        throw new Error(result.error.message || "Unable to update application role.");
      }
      showActionToast?.("applicationRole.change", "success", { targetEmail: email });
      setReloadToken((current) => current + 1);
    } catch (error) {
      showActionToast?.("applicationRole.change", "failure");
    } finally {
      setMutatingUserId("");
    }
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

  function openUnbanDialog(user) {
    setUnbanDialogUser(user);
  }

  function closeUnbanDialog() {
    setUnbanDialogUser(null);
  }

  async function confirmBan(event) {
    event.preventDefault();
    const userId = String(banDialogUser?.id || "").trim();
    const reason = banReason.trim();
    if (!reason) {
      setBanReasonError("Enter a ban reason before banning this user.");
      return;
    }
    if (!userId) {
      return;
    }

    const email = String(banDialogUser?.email || "this user").trim() || "this user";
    setMutatingUserId(userId);
    try {
      const result = await authClient.admin.banUser({ userId, banReason: reason });
      if (result?.error) {
        throw new Error(result.error.message || "Unable to ban user.");
      }
      showActionToast?.("applicationUser.ban", "success", { targetEmail: email });
      closeBanDialog();
      setReloadToken((current) => current + 1);
    } catch (error) {
      showActionToast?.("applicationUser.ban", "failure");
    } finally {
      setMutatingUserId("");
    }
  }

  async function confirmUnban() {
    const userId = String(unbanDialogUser?.id || "").trim();
    if (!userId) {
      return;
    }

    const email = String(unbanDialogUser?.email || "this user").trim() || "this user";
    setMutatingUserId(userId);
    try {
      const result = await authClient.admin.unbanUser({ userId });
      if (result?.error) {
        throw new Error(result.error.message || "Unable to unban user.");
      }
      showActionToast?.("applicationUser.unban", "success", { targetEmail: email });
      closeUnbanDialog();
      setReloadToken((current) => current + 1);
    } catch (error) {
      showActionToast?.("applicationUser.unban", "failure");
    } finally {
      setMutatingUserId("");
    }
  }

  async function startImpersonation(user) {
    const userId = String(user?.id || "").trim();
    if (!userId) {
      return;
    }

    const email = String(user?.email || "this user").trim() || "this user";
    const message = `Start impersonating ${email}? You will leave the Admin page and enter this user's normal app experience.`;
    if (!window.confirm(message)) {
      return;
    }

    setMutatingUserId(userId);
    try {
      const result = await authClient.admin.impersonateUser({ userId });
      if (result?.error) {
        throw new Error(result.error.message || "Unable to start impersonation.");
      }
      onImpersonationStarted?.();
    } catch (error) {
      showActionToast?.("applicationUser.impersonate", "failure");
    } finally {
      setMutatingUserId("");
    }
  }

  return {
    users,
    total,
    pageSize: ADMIN_USERS_PAGE_SIZE,
    offset,
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
    onClearSearch: clearSearch,
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
    onOpenUnbanDialog: openUnbanDialog,
    onCloseUnbanDialog: closeUnbanDialog,
    onConfirmUnban: confirmUnban,
    onStartImpersonation: startImpersonation,
  };
}
