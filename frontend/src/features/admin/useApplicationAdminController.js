import { useEffect, useState } from "react";

export const ADMIN_USERS_PAGE_SIZE = 25;

const INITIAL_SEARCH = { field: "email", value: "" };
const ENTERPRISE_ANNUAL_PRESETS = {
  "60000:9": { monthlyMinimumAllowance: "60000", perPagePrice: "0.09" },
  "100000:8": { monthlyMinimumAllowance: "100000", perPagePrice: "0.08" },
  "200000:7": { monthlyMinimumAllowance: "200000", perPagePrice: "0.07" },
};

export function useApplicationAdminController({
  authClient,
  request,
  isActive,
  sessionUserId,
  showActionToast,
  onImpersonationStarted,
  onWorkspaceBillingMutation,
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
  const [billingWorkspaceId, setBillingWorkspaceId] = useState("");
  const [billingWorkspaceSearchField, setBillingWorkspaceSearchField] = useState("workspace_id");
  const [billingWorkspaceSearchInput, setBillingWorkspaceSearchInput] = useState("");
  const [billingWorkspaceSearchResults, setBillingWorkspaceSearchResults] = useState([]);
  const [billingSelectedWorkspace, setBillingSelectedWorkspace] = useState(null);
  const [isBillingWorkspaceSearching, setIsBillingWorkspaceSearching] = useState(false);
  const [billingWorkspaceSearchError, setBillingWorkspaceSearchError] = useState("");
  const [goodwillCredits, setGoodwillCredits] = useState("0");
  const [grantReason, setGrantReason] = useState("");
  const [revokeGrantId, setRevokeGrantId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [billingState, setBillingState] = useState(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [planOverrideTarget, setPlanOverrideTarget] = useState("pro");
  const [planOverrideStart, setPlanOverrideStart] = useState("");
  const [planOverrideDurationMonths, setPlanOverrideDurationMonths] = useState("1");
  const [planOverridePaymentRequired, setPlanOverridePaymentRequired] = useState(false);
  const [planOverrideReason, setPlanOverrideReason] = useState("");
  const [paymentRequiredOverrideAmount, setPaymentRequiredOverrideAmount] = useState("0");
  const [paymentRequiredOverrideCollection, setPaymentRequiredOverrideCollection] = useState("automatic");
  const [enterpriseRampUpIncluded, setEnterpriseRampUpIncluded] = useState(false);
  const [enterpriseRampUpCycleStart, setEnterpriseRampUpCycleStart] = useState("");
  const [enterpriseRampUpDurationMonths, setEnterpriseRampUpDurationMonths] = useState("3");
  const [enterpriseRampUpCollection, setEnterpriseRampUpCollection] = useState("manual");
  const [enterpriseRampUpInvoiceReviewEnabled, setEnterpriseRampUpInvoiceReviewEnabled] = useState(false);
  const [enterpriseAnnualIncluded, setEnterpriseAnnualIncluded] = useState(false);
  const [enterpriseAnnualPreset, setEnterpriseAnnualPreset] = useState("60000:9");
  const [enterpriseAnnualMonthlyMinimumAllowance, setEnterpriseAnnualMonthlyMinimumAllowance] = useState("60000");
  const [enterpriseAnnualPerPagePrice, setEnterpriseAnnualPerPagePrice] = useState("0.09");
  const [enterpriseAnnualCycleStart, setEnterpriseAnnualCycleStart] = useState("");
  const [enterpriseAnnualCollection, setEnterpriseAnnualCollection] = useState("manual");
  const [enterpriseAnnualInvoiceReviewEnabled, setEnterpriseAnnualInvoiceReviewEnabled] = useState(false);
  const [enterpriseAgreementReason, setEnterpriseAgreementReason] = useState("");
  const [noBillingEnabled, setNoBillingEnabled] = useState(false);
  const [noBillingReason, setNoBillingReason] = useState("");
  const [isBillingMutating, setIsBillingMutating] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [billingError, setBillingError] = useState("");

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

  async function grantGoodwillCredits(event) {
    event.preventDefault();
    const workspaceId = billingWorkspaceId.trim();
    const credits = Number(goodwillCredits);
    const reason = grantReason.trim();
    if (!workspaceId || !Number.isInteger(credits) || credits <= 0 || !reason) {
      setBillingMessage("");
      setBillingError("Enter a Workspace ID, positive Credit amount, and reason.");
      return false;
    }

    setIsBillingMutating(true);
    setBillingError("");
    setBillingMessage("");
    try {
      const result = await request(
        `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/goodwill-credits`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credits,
            reason,
            idempotency_key: createBillingIdempotencyKey("goodwill-grant"),
          }),
        },
      );
      setRevokeGrantId(String(result?.grant_id || ""));
      setBillingMessage(`Granted ${formatNumber(result?.granted_credits || credits)} Goodwill Credits.`);
      showActionToast?.("applicationBilling.goodwillGrant", "success", { targetId: workspaceId });
      notifyWorkspaceBillingMutation(workspaceId);
      return true;
    } catch (error) {
      setBillingError(error.message || "Goodwill Credits could not be granted.");
      return false;
    } finally {
      setIsBillingMutating(false);
    }
  }

  function clearBillingFeedback() {
    setBillingMessage("");
    setBillingError("");
    setBillingWorkspaceSearchError("");
  }

  function changeBillingWorkspaceId(value) {
    setBillingWorkspaceId(value);
    setBillingSelectedWorkspace(null);
  }

  async function searchBillingWorkspaces(event) {
    event?.preventDefault?.();
    const query = billingWorkspaceSearchInput.trim();
    if (!query) {
      setBillingWorkspaceSearchResults([]);
      setBillingWorkspaceSearchError("Enter a Workspace ID or owner email before searching.");
      return [];
    }

    setIsBillingWorkspaceSearching(true);
    setBillingWorkspaceSearchError("");
    setBillingError("");
    setBillingMessage("");
    try {
      const params = new URLSearchParams();
      if (billingWorkspaceSearchField === "owner_email") {
        params.set("owner_email", query);
      } else {
        params.set("workspace_id", query);
      }
      const result = await request(`/admin/billing/workspaces?${params.toString()}`, { method: "GET" });
      const workspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
      setBillingWorkspaceSearchResults(workspaces);
      if (!workspaces.length) {
        setBillingWorkspaceSearchError("No matching Workspaces found.");
      }
      return workspaces;
    } catch (error) {
      const message = error.message || "Workspace search could not be completed.";
      setBillingWorkspaceSearchResults([]);
      setBillingWorkspaceSearchError(message);
      return [];
    } finally {
      setIsBillingWorkspaceSearching(false);
    }
  }

  async function selectBillingWorkspace(workspace) {
    const workspaceId = String(workspace?.id || workspace?.workspace_id || "").trim();
    if (!workspaceId) {
      return null;
    }
    setBillingWorkspaceId(workspaceId);
    setBillingSelectedWorkspace(workspace);
    return loadBillingStateForWorkspace(workspaceId);
  }

  async function loadBillingState() {
    return loadBillingStateForWorkspace(billingWorkspaceId);
  }

  async function loadBillingStateForWorkspace(workspaceIdInput) {
    const workspaceId = String(workspaceIdInput || "").trim();
    if (!workspaceId) {
      setBillingMessage("");
      setBillingError("Enter a Workspace ID before loading billing state.");
      return null;
    }

    setBillingWorkspaceId(workspaceId);
    setIsBillingLoading(true);
    setBillingError("");
    setBillingMessage("");
    try {
      const result = await request(
        `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}`,
        { method: "GET" },
      );
      setBillingState(result || null);
      setNoBillingEnabled(Boolean(result?.no_billing_mode?.enabled));
      return result;
    } catch (error) {
      setBillingState(null);
      setBillingError(error.message || "Workspace billing state could not be loaded.");
      return null;
    } finally {
      setIsBillingLoading(false);
    }
  }

  async function createPlanOverride(event) {
    event.preventDefault();
    const workspaceId = billingWorkspaceId.trim();
    const plan = planOverrideTarget.trim().toLowerCase();
    const durationMonths = Number(planOverrideDurationMonths);
    const startAt = normalizeBillingDateToIso(planOverrideStart.trim());
    const endAt = deriveBillingEndIso(planOverrideStart.trim(), durationMonths);
    const reason = planOverrideReason.trim();
    const amountMinor = Math.round(Number(paymentRequiredOverrideAmount) * 100);
    const collectionMode = paymentRequiredOverrideCollection.trim().toLowerCase();
    if (!workspaceId || !plan || !startAt || !endAt || !Number.isInteger(durationMonths) || durationMonths <= 0 || !reason) {
      setBillingMessage("");
      setBillingError("Enter a Workspace ID, override plan, start date, duration, and reason.");
      return false;
    }
    if (
      planOverridePaymentRequired &&
      (!Number.isInteger(amountMinor) || amountMinor <= 0 || !collectionMode)
    ) {
      setBillingMessage("");
      setBillingError("Enter payment-required amount and invoice payment method.");
      return false;
    }

    setIsBillingMutating(true);
    setBillingError("");
    setBillingMessage("");
    try {
      if (planOverridePaymentRequired) {
        const result = await request(
          `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/payment-required-plan-overrides`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              plan,
              start_at: startAt,
              end_at: endAt,
              reason,
              amount_minor: amountMinor,
              collection_mode: collectionMode,
              idempotency_key: createBillingIdempotencyKey("payment-required-plan-override"),
            }),
          },
        );
        setBillingState((current) => ({
          ...(current || {}),
          workspace_id: workspaceId,
          payment_required_plan_override: result?.payment_required_plan_override || null,
        }));
        setBillingMessage(`Created payment-required ${result?.payment_required_plan_override?.display_name || formatPlanName(plan)} Plan override invoice.`);
        showActionToast?.("applicationBilling.paymentRequiredPlanOverride", "success", { targetId: workspaceId });
        notifyWorkspaceBillingMutation(workspaceId);
        return true;
      }

      const result = await request(
        `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/plan-overrides`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan,
            start_at: startAt,
            end_at: endAt,
            reason,
            idempotency_key: createBillingIdempotencyKey("plan-override"),
          }),
        },
      );
      setBillingState((current) => ({
        ...(current || {}),
        workspace_id: workspaceId,
        active_entitlement: {
          plan: result?.plan_override?.plan,
          display_name: result?.plan_override?.display_name,
        },
        plan_override: result?.plan_override || null,
      }));
      setBillingMessage(`Created ${result?.plan_override?.display_name || formatPlanName(plan)} Plan override.`);
      showActionToast?.("applicationBilling.planOverride", "success", { targetId: workspaceId });
      notifyWorkspaceBillingMutation(workspaceId);
      return true;
    } catch (error) {
      setBillingError(error.message || "Plan override could not be created.");
      return false;
    } finally {
      setIsBillingMutating(false);
    }
  }

  function changeEnterpriseAnnualPreset(value) {
    setEnterpriseAnnualPreset(value);
    const preset = ENTERPRISE_ANNUAL_PRESETS[value];
    if (preset) {
      setEnterpriseAnnualMonthlyMinimumAllowance(preset.monthlyMinimumAllowance);
      setEnterpriseAnnualPerPagePrice(preset.perPagePrice);
    }
  }

  async function createEnterpriseTerms(event) {
    event.preventDefault();
    const workspaceId = billingWorkspaceId.trim();
    const reason = enterpriseAgreementReason.trim();
    if (!workspaceId || !reason || (!enterpriseRampUpIncluded && !enterpriseAnnualIncluded)) {
      setBillingMessage("");
      setBillingError("Select at least one Enterprise term and enter an admin reason.");
      return false;
    }

    const rampUpCycleStart = normalizeBillingDateToIso(enterpriseRampUpCycleStart.trim());
    const rampUpDurationMonths = Number(enterpriseRampUpDurationMonths);
    const rampUpCollectionMode = enterpriseRampUpCollection.trim().toLowerCase();
    if (
      enterpriseRampUpIncluded &&
      (!rampUpCycleStart ||
        !Number.isInteger(rampUpDurationMonths) ||
        rampUpDurationMonths <= 0 ||
        !rampUpCollectionMode)
    ) {
      setBillingMessage("");
      setBillingError("Enter Enterprise ramp-up cycle start, duration, and collection terms.");
      return false;
    }

    const monthlyMinimumAllowance = Number(enterpriseAnnualMonthlyMinimumAllowance);
    const perPagePriceMinor = Math.round(Number(enterpriseAnnualPerPagePrice) * 100);
    const annualCycleStart = normalizeBillingDateToIso(enterpriseAnnualCycleStart.trim());
    const annualCollectionMode = enterpriseAnnualCollection.trim().toLowerCase();
    if (
      enterpriseAnnualIncluded &&
      (!Number.isInteger(monthlyMinimumAllowance) ||
        monthlyMinimumAllowance <= 0 ||
        !Number.isInteger(perPagePriceMinor) ||
        perPagePriceMinor <= 0 ||
        !annualCycleStart ||
        !annualCollectionMode)
    ) {
      setBillingMessage("");
      setBillingError("Enter Enterprise annual allowance, price, billing cycle start, and collection terms.");
      return false;
    }

    setIsBillingMutating(true);
    setBillingError("");
    setBillingMessage("");
    const completed = [];
    try {
      if (enterpriseRampUpIncluded) {
        const result = await request(
          `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/enterprise-ramp-up`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              enterprise_billing_cycle_start_date: rampUpCycleStart,
              duration_months: rampUpDurationMonths,
              collection_mode: rampUpCollectionMode,
              invoice_review_enabled: enterpriseRampUpInvoiceReviewEnabled,
              reason,
              idempotency_key: createBillingIdempotencyKey("enterprise-ramp-up"),
            }),
          },
        );
        setBillingState((current) => ({
          ...(current || {}),
          workspace_id: workspaceId,
          active_entitlement: result?.active_entitlement || current?.active_entitlement || null,
          enterprise_ramp_up: result?.enterprise_ramp_up || null,
        }));
        completed.push("Enterprise ramp-up");
      }

      if (enterpriseAnnualIncluded) {
        const result = await request(
          `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/enterprise-annual-commitments`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              monthly_minimum_allowance: monthlyMinimumAllowance,
              per_page_price_minor: perPagePriceMinor,
              enterprise_billing_cycle_start_date: annualCycleStart,
              collection_mode: annualCollectionMode,
              invoice_review_enabled: enterpriseAnnualInvoiceReviewEnabled,
              reason,
              idempotency_key: createBillingIdempotencyKey("enterprise-annual"),
            }),
          },
        );
        setBillingState((current) => ({
          ...(current || {}),
          workspace_id: workspaceId,
          active_entitlement: result?.active_entitlement || current?.active_entitlement || null,
          enterprise_annual_commitment: result?.enterprise_annual_commitment || null,
        }));
        completed.push("Enterprise annual");
      }

      setBillingMessage(`Created ${completed.join(" and ")} terms.`);
      showActionToast?.("applicationBilling.enterpriseTerms", "success", { targetId: workspaceId });
      notifyWorkspaceBillingMutation(workspaceId);
      return true;
    } catch (error) {
      setBillingError(error.message || "Enterprise terms could not be created.");
      return false;
    } finally {
      setIsBillingMutating(false);
    }
  }

  async function updateNoBillingMode(enabled) {
    const workspaceId = billingWorkspaceId.trim();
    const reason = noBillingReason.trim();
    if (!workspaceId || !reason) {
      setBillingMessage("");
      setBillingError("Enter a Workspace ID and No-billing reason.");
      return false;
    }

    setIsBillingMutating(true);
    setBillingError("");
    setBillingMessage("");
    try {
      const result = await request(
        `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/no-billing`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled,
            reason,
            idempotency_key: createBillingIdempotencyKey("no-billing"),
          }),
        },
      );
      setBillingState((current) => ({
        ...(current || {}),
        workspace_id: workspaceId,
        active_entitlement: result?.active_entitlement || current?.active_entitlement || null,
        no_billing_mode: result?.no_billing_mode || null,
      }));
      setBillingMessage(enabled ? "Enabled No-billing mode." : "Disabled No-billing mode.");
      showActionToast?.("applicationBilling.noBillingMode", "success", { targetId: workspaceId });
      notifyWorkspaceBillingMutation(workspaceId);
      return true;
    } catch (error) {
      setBillingError(error.message || "No-billing mode could not be updated.");
      return false;
    } finally {
      setIsBillingMutating(false);
    }
  }

  function editNoBillingMode(event) {
    event.preventDefault();
    return updateNoBillingMode(noBillingEnabled);
  }

  async function revokeGoodwillCreditGrant(event) {
    event.preventDefault();
    const workspaceId = billingWorkspaceId.trim();
    const grantId = revokeGrantId.trim();
    const reason = revokeReason.trim();
    if (!workspaceId || !grantId || !reason) {
      setBillingMessage("");
      setBillingError("Enter a Workspace ID, grant ID, and revocation reason.");
      return false;
    }

    setIsBillingMutating(true);
    setBillingError("");
    setBillingMessage("");
    try {
      const result = await request(
        `/admin/billing/workspaces/${encodeURIComponent(workspaceId)}/goodwill-credits/${encodeURIComponent(grantId)}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason,
            idempotency_key: createBillingIdempotencyKey("goodwill-revoke"),
          }),
        },
      );
      setBillingMessage(`Revoked ${formatNumber(result?.revoked_credits || 0)} Goodwill Credits.`);
      showActionToast?.("applicationBilling.goodwillRevoke", "success", { targetId: workspaceId });
      notifyWorkspaceBillingMutation(workspaceId);
      return true;
    } catch (error) {
      setBillingError(error.message || "Goodwill Credit grant could not be revoked.");
      return false;
    } finally {
      setIsBillingMutating(false);
    }
  }

  function notifyWorkspaceBillingMutation(workspaceId) {
    if (!onWorkspaceBillingMutation) {
      return;
    }
    void Promise.resolve(onWorkspaceBillingMutation(workspaceId)).catch(() => {});
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
    billingWorkspaceId,
    billingWorkspaceSearchField,
    billingWorkspaceSearchInput,
    billingWorkspaceSearchResults,
    billingSelectedWorkspace,
    isBillingWorkspaceSearching,
    billingWorkspaceSearchError,
    goodwillCredits,
    grantReason,
    revokeGrantId,
    revokeReason,
    billingState,
    isBillingLoading,
    planOverrideTarget,
    planOverrideStart,
    planOverrideDurationMonths,
    planOverridePaymentRequired,
    planOverrideDerivedEnd: formatBillingDateLabel(deriveBillingEndIso(planOverrideStart, Number(planOverrideDurationMonths))),
    planOverrideReason,
    paymentRequiredOverrideAmount,
    paymentRequiredOverrideCollection,
    enterpriseRampUpIncluded,
    enterpriseRampUpCycleStart,
    enterpriseRampUpDurationMonths,
    enterpriseRampUpCollection,
    enterpriseRampUpInvoiceReviewEnabled,
    enterpriseAnnualIncluded,
    enterpriseAnnualPreset,
    enterpriseAnnualMonthlyMinimumAllowance,
    enterpriseAnnualPerPagePrice,
    enterpriseAnnualDerivedYearlyCost: formatGbpMinorAmount(
      Number(enterpriseAnnualMonthlyMinimumAllowance) * 12 * Math.round(Number(enterpriseAnnualPerPagePrice) * 100),
    ),
    enterpriseAnnualCycleStart,
    enterpriseAnnualCollection,
    enterpriseAnnualInvoiceReviewEnabled,
    enterpriseAgreementReason,
    noBillingEnabled,
    noBillingReason,
    isBillingMutating,
    billingMessage,
    billingError,
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
    onBillingWorkspaceIdChange: changeBillingWorkspaceId,
    onBillingWorkspaceSearchFieldChange: setBillingWorkspaceSearchField,
    onBillingWorkspaceSearchInputChange: setBillingWorkspaceSearchInput,
    onSearchBillingWorkspaces: searchBillingWorkspaces,
    onSelectBillingWorkspace: selectBillingWorkspace,
    onClearBillingFeedback: clearBillingFeedback,
    onGoodwillCreditsChange: setGoodwillCredits,
    onGrantReasonChange: setGrantReason,
    onRevokeGrantIdChange: setRevokeGrantId,
    onRevokeReasonChange: setRevokeReason,
    onPlanOverrideTargetChange: setPlanOverrideTarget,
    onPlanOverrideStartChange: setPlanOverrideStart,
    onPlanOverrideDurationMonthsChange: setPlanOverrideDurationMonths,
    onPlanOverridePaymentRequiredChange: setPlanOverridePaymentRequired,
    onPlanOverrideReasonChange: setPlanOverrideReason,
    onPaymentRequiredOverrideAmountChange: setPaymentRequiredOverrideAmount,
    onPaymentRequiredOverrideCollectionChange: setPaymentRequiredOverrideCollection,
    onEnterpriseRampUpIncludedChange: setEnterpriseRampUpIncluded,
    onEnterpriseRampUpCycleStartChange: setEnterpriseRampUpCycleStart,
    onEnterpriseRampUpDurationMonthsChange: setEnterpriseRampUpDurationMonths,
    onEnterpriseRampUpCollectionChange: setEnterpriseRampUpCollection,
    onEnterpriseRampUpInvoiceReviewEnabledChange: setEnterpriseRampUpInvoiceReviewEnabled,
    onEnterpriseAnnualIncludedChange: setEnterpriseAnnualIncluded,
    onEnterpriseAnnualPresetChange: changeEnterpriseAnnualPreset,
    onEnterpriseAnnualMonthlyMinimumAllowanceChange: (value) => {
      setEnterpriseAnnualPreset("custom");
      setEnterpriseAnnualMonthlyMinimumAllowance(value);
    },
    onEnterpriseAnnualPerPagePriceChange: (value) => {
      setEnterpriseAnnualPreset("custom");
      setEnterpriseAnnualPerPagePrice(value);
    },
    onEnterpriseAnnualCycleStartChange: setEnterpriseAnnualCycleStart,
    onEnterpriseAnnualCollectionChange: setEnterpriseAnnualCollection,
    onEnterpriseAnnualInvoiceReviewEnabledChange: setEnterpriseAnnualInvoiceReviewEnabled,
    onEnterpriseAgreementReasonChange: setEnterpriseAgreementReason,
    onNoBillingEnabledChange: setNoBillingEnabled,
    onNoBillingReasonChange: setNoBillingReason,
    onLoadBillingState: loadBillingState,
    onGrantGoodwillCredits: grantGoodwillCredits,
    onRevokeGoodwillCreditGrant: revokeGoodwillCreditGrant,
    onCreatePlanOverride: createPlanOverride,
    onCreateEnterpriseTerms: createEnterpriseTerms,
    onEditNoBillingMode: editNoBillingMode,
  };
}

function createBillingIdempotencyKey(prefix) {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function normalizeBillingDateToIso(value) {
  const trimmed = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return `${trimmed}-01T00:00:00.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  return trimmed;
}

function deriveBillingEndIso(startValue, durationMonths) {
  const start = parseBillingDateInput(startValue);
  const months = Number(durationMonths);
  if (!start || !Number.isInteger(months) || months <= 0) {
    return "";
  }

  const targetMonthIndex = start.monthIndex + months;
  const targetYear = start.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(start.day, lastTargetDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}T00:00:00.000Z`;
}

function parseBillingDateInput(value) {
  const trimmed = String(value || "").trim();
  const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const monthMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
  const match = dateMatch || monthMatch;
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = dateMatch ? Number(dateMatch[3]) : 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) {
    return null;
  }
  return { year, monthIndex: month - 1, day };
}

function formatBillingDateLabel(isoValue) {
  const match = String(isoValue || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function formatGbpMinorAmount(amountMinor) {
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "-";
  }
  return `GBP ${(amount / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPlanName(plan) {
  if (plan === "pro") {
    return "Pro";
  }
  if (plan === "max") {
    return "Max";
  }
  return "Free";
}
