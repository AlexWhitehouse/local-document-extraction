import { useEffect, useState } from "react";

export function useBillingController({
  request,
  workspaceId,
  isActive,
  hasWorkspaceBillingAuthority,
  addLog,
}) {
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [startingCreditPackSize, setStartingCreditPackSize] = useState(null);
  const [startingSubscriptionPlan, setStartingSubscriptionPlan] = useState(null);
  const [startingSubscriptionChangePlan, setStartingSubscriptionChangePlan] = useState(null);
  const [isCancelingScheduledChange, setIsCancelingScheduledChange] = useState(false);
  const [isLoadingMoreBillingActivity, setIsLoadingMoreBillingActivity] = useState(false);
  const [isLoadingCreditUsage, setIsLoadingCreditUsage] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [activityErrorMessage, setActivityErrorMessage] = useState("");
  const [usageErrorMessage, setUsageErrorMessage] = useState("");

  async function loadBillingSummary() {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority) {
      setSummary(null);
      return null;
    }

    setIsLoading(true);
    setLoadErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/summary`,
        { method: "GET" },
        true,
        false,
      );
      setSummary(data || null);
      setActivityErrorMessage("");
      setUsageErrorMessage("");
      addLog?.(`Loaded billing summary for workspace ${normalizedWorkspaceId}`);
      return data;
    } catch (error) {
      setSummary(null);
      setLoadErrorMessage(error.message || "Billing summary could not be loaded");
      addLog?.(`Load billing summary failed: ${error.message}`);
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadBillingSummary();
  }, [hasWorkspaceBillingAuthority, isActive, workspaceId]);

  async function startCreditPackCheckout(packSize) {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const normalizedPackSize = Number(packSize);
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority) {
      return null;
    }

    setStartingCreditPackSize(normalizedPackSize);
    setActionErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/credit-packs/checkout`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pack_size: normalizedPackSize,
            return_origin: getBillingReturnOrigin(),
          }),
        },
        true,
        false,
      );
      if (!data?.url) {
        throw new Error("Stripe Checkout could not be started");
      }
      addLog?.(`Started ${normalizedPackSize} Credit pack Checkout for workspace ${normalizedWorkspaceId}`);
      try {
        window.sessionStorage.setItem("documentextraction.billing.return", "1");
      } catch {}
      window.location.assign(data.url);
      return data;
    } catch (error) {
      setActionErrorMessage(error.message || "Credit pack Checkout could not be started");
      addLog?.(`Start Credit pack Checkout failed: ${error.message}`);
      return null;
    } finally {
      setStartingCreditPackSize(null);
    }
  }

  async function startSubscriptionCheckout(plan) {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const normalizedPlan = String(plan || "").trim().toLowerCase();
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority) {
      return null;
    }

    setStartingSubscriptionPlan(normalizedPlan);
    setActionErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/subscriptions/checkout`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan: normalizedPlan,
            return_origin: getBillingReturnOrigin(),
          }),
        },
        true,
        false,
      );
      if (!data?.url) {
        throw new Error("Stripe Checkout could not be started");
      }
      addLog?.(`Started ${normalizedPlan} subscription Checkout for workspace ${normalizedWorkspaceId}`);
      try {
        window.sessionStorage.setItem("documentextraction.billing.return", "1");
      } catch {}
      window.location.assign(data.url);
      return data;
    } catch (error) {
      setActionErrorMessage(error.message || "Subscription Checkout could not be started");
      addLog?.(`Start subscription Checkout failed: ${error.message}`);
      return null;
    } finally {
      setStartingSubscriptionPlan(null);
    }
  }

  async function startSubscriptionChange(plan) {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const normalizedPlan = String(plan || "").trim().toLowerCase();
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority) {
      return null;
    }

    setStartingSubscriptionChangePlan(normalizedPlan);
    setActionErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/subscriptions/change`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan: normalizedPlan }),
        },
        true,
        false,
      );
      addLog?.(`Started ${normalizedPlan} subscription change for workspace ${normalizedWorkspaceId}`);
      if (data?.payment_url) {
        try {
          window.sessionStorage.setItem("documentextraction.billing.return", "1");
        } catch {}
        window.location.assign(data.payment_url);
        return data;
      }
      await loadBillingSummary();
      return data;
    } catch (error) {
      setActionErrorMessage(error.message || "Subscription change could not be started");
      addLog?.(`Start subscription change failed: ${error.message}`);
      return null;
    } finally {
      setStartingSubscriptionChangePlan(null);
    }
  }

  async function cancelScheduledSubscriptionChange() {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority) {
      return null;
    }

    setIsCancelingScheduledChange(true);
    setActionErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/subscriptions/scheduled-change/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
        true,
        false,
      );
      addLog?.(`Canceled scheduled subscription change for workspace ${normalizedWorkspaceId}`);
      await loadBillingSummary();
      return data;
    } catch (error) {
      setActionErrorMessage(error.message || "Scheduled subscription change could not be canceled");
      addLog?.(`Cancel scheduled subscription change failed: ${error.message}`);
      return null;
    } finally {
      setIsCancelingScheduledChange(false);
    }
  }

  async function loadMoreBillingActivity() {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const cursor = String(summary?.owner_billing_activity_next_cursor || "").trim();
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority || !cursor || isLoadingMoreBillingActivity) {
      return null;
    }

    setIsLoadingMoreBillingActivity(true);
    setActivityErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/activity?cursor=${encodeURIComponent(cursor)}`,
        { method: "GET" },
        true,
        false,
      );
      setSummary((current) => {
        if (!current) {
          return current;
        }
        const existingActivity = Array.isArray(current.owner_billing_activity)
          ? current.owner_billing_activity
          : [];
        const existingIds = new Set(existingActivity.map((activity) => activity.id));
        const nextActivity = Array.isArray(data?.owner_billing_activity)
          ? data.owner_billing_activity.filter((activity) => !existingIds.has(activity.id))
          : [];
        return {
          ...current,
          owner_billing_activity: [...existingActivity, ...nextActivity],
          owner_billing_activity_next_cursor: data?.owner_billing_activity_next_cursor || null,
        };
      });
      addLog?.(`Loaded more billing activity for workspace ${normalizedWorkspaceId}`);
      return data;
    } catch (error) {
      setActivityErrorMessage(error.message || "Billing activity could not be loaded");
      addLog?.(`Load billing activity failed: ${error.message}`);
      return null;
    } finally {
      setIsLoadingMoreBillingActivity(false);
    }
  }

  async function loadCreditUsage(range) {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const normalizedRange = normalizeCreditUsageRange(range);
    if (!normalizedWorkspaceId || !hasWorkspaceBillingAuthority || isLoadingCreditUsage) {
      return null;
    }

    setIsLoadingCreditUsage(true);
    setUsageErrorMessage("");
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/billing/usage?range=${encodeURIComponent(normalizedRange)}`,
        { method: "GET" },
        true,
        false,
      );
      setSummary((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          credit_usage: data?.credit_usage || current.credit_usage,
        };
      });
      addLog?.(`Loaded ${normalizedRange} billing usage for workspace ${normalizedWorkspaceId}`);
      return data;
    } catch (error) {
      setUsageErrorMessage(error.message || "Credit usage could not be loaded");
      addLog?.(`Load billing usage failed: ${error.message}`);
      return null;
    } finally {
      setIsLoadingCreditUsage(false);
    }
  }

  return {
    summary,
    isLoading,
    isLoadingMoreBillingActivity,
    isLoadingCreditUsage,
    startingCreditPackSize,
    startingSubscriptionPlan,
    startingSubscriptionChangePlan,
    isCancelingScheduledChange,
    errorMessage: loadErrorMessage,
    actionErrorMessage,
    activityErrorMessage,
    usageErrorMessage,
    onClearActionError: () => setActionErrorMessage(""),
    onRefresh: loadBillingSummary,
    onLoadMoreBillingActivity: loadMoreBillingActivity,
    onLoadCreditUsage: loadCreditUsage,
    onStartCreditPackCheckout: startCreditPackCheckout,
    onStartSubscriptionCheckout: startSubscriptionCheckout,
    onStartSubscriptionChange: startSubscriptionChange,
    onCancelScheduledSubscriptionChange: cancelScheduledSubscriptionChange,
  };
}

function normalizeCreditUsageRange(value) {
  const range = String(value || "").trim().toLowerCase();
  if (["daily", "weekly", "monthly", "yearly"].includes(range)) {
    return range;
  }
  return "daily";
}

function getBillingReturnOrigin() {
  try {
    return window.location.origin || "";
  } catch {
    return "";
  }
}
