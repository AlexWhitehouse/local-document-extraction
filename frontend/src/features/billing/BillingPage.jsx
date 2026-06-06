import React, { useRef, useState } from "react";

const SELF_SERVICE_PLAN_OPTIONS = [
  {
    plan: "free",
    displayName: "Free",
    monthlyPrice: "GBP 0",
    includedCredits: 0,
    perPagePrice: "GBP 0.22",
    limits: {
      templates: 3,
      topLevelFields: 5,
      tableColumns: 5,
      members: 3,
      monthlyPages: 500,
      apiAccess: false,
    },
  },
  {
    plan: "pro",
    displayName: "Pro",
    monthlyPrice: "GBP 50",
    includedCredits: 200,
    perPagePrice: "GBP 0.20",
    limits: {
      templates: 10,
      topLevelFields: 15,
      tableColumns: 10,
      members: 50,
      monthlyPages: 1500,
      apiAccess: true,
    },
  },
  {
    plan: "max",
    displayName: "Max",
    monthlyPrice: "GBP 200",
    includedCredits: 1000,
    perPagePrice: "GBP 0.18",
    limits: {
      templates: 50,
      topLevelFields: 20,
      tableColumns: 15,
      members: null,
      monthlyPages: 5000,
      apiAccess: true,
    },
  },
];

const CREDIT_PACK_OPTIONS = [100, 500, 1000, 5000];
const CREDIT_USAGE_RANGE_OPTIONS = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
  { value: "yearly", label: "Year" },
];

export function BillingPage({ billing, isEmbedded = false }) {
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [isCreditBreakdownOpen, setIsCreditBreakdownOpen] = useState(false);
  const summary = billing.summary;
  const entitlement = summary?.active_entitlement || {};
  const credits = summary?.credits || {};
  const period = summary?.current_period || {};
  const subscription = summary?.self_service_subscription || null;
  const nextScheduledEntitlement = summary?.next_scheduled_entitlement || null;
  const paymentRequiredOverride =
    summary?.payment_required_plan_override || null;
  const enterpriseRampUp = summary?.enterprise_ramp_up || null;
  const enterpriseAnnual = summary?.enterprise_annual_commitment || null;
  const billingBlockingReasons = getBillingBlockingReasons(
    summary?.billing_operational_status,
  );
  const isUnpaid = summary?.billing_state === "unpaid";
  const pagesRemainingLabel = formatLimitValue(period.pages_remaining);
  const monthlyPageLimitLabel = formatLimitValue(period.monthly_page_limit);
  const includedCreditRenewalDate = formatDate(period.end);
  const availableCreditsTotal = Number(credits.total_available || 0);
  const catalogPriceLabel =
    entitlement.per_page_catalog_price?.display ||
    (entitlement.plan === "no_billing"
      ? "No charge"
      : entitlement.plan === "enterprise_ramp_up" ||
          entitlement.plan === "enterprise_annual"
        ? "Usage invoiced"
        : "Not available");
  const supportsCreditPacks = ["free", "pro", "max"].includes(entitlement.plan);
  const creditsUsedThisPeriod = supportsCreditPacks
    ? Number(period.pages_used || 0)
    : 0;
  const ownerBillingActivity = Array.isArray(summary?.owner_billing_activity)
    ? summary.owner_billing_activity.map(normalizeOwnerBillingActivity)
    : [];
  const invoiceBillingActivity = buildInvoiceBillingActivityRows({
    subscription,
    paymentRequiredOverride,
    enterpriseRampUp,
    enterpriseAnnual,
  });
  const hasInvoiceBillingActivity =
    invoiceBillingActivity.length > 0 ||
    ownerBillingActivity.some((activity) => activity.invoice_action?.url);
  const billingActivity = [
    ...invoiceBillingActivity,
    ...ownerBillingActivity,
  ];
  const availableCreditBreakdown = buildAvailableCreditBreakdown(credits);
  const hasMoreBillingActivity = Boolean(
    summary?.owner_billing_activity_next_cursor,
  );
  const creditUsage = normalizeCreditUsage(summary?.credit_usage);
  const isBillingModalOpen =
    isPlanModalOpen || isCreditModalOpen || isCreditBreakdownOpen;

  function openPlanModal() {
    billing.onClearActionError?.();
    setIsPlanModalOpen(true);
  }

  function closePlanModal() {
    billing.onClearActionError?.();
    setIsPlanModalOpen(false);
  }

  function openCreditModal() {
    billing.onClearActionError?.();
    setIsCreditModalOpen(true);
  }

  function closeCreditModal() {
    billing.onClearActionError?.();
    setIsCreditModalOpen(false);
  }

  return (
    <>
      <header
        id={isEmbedded ? "workspace-billing" : undefined}
        className={
          isEmbedded ? "page-header workspace-billing-header" : "page-header"
        }
      >
        <p className="eyebrow">Workspace Billing</p>
        <h2>Billing</h2>
        <div className="billing-header-copy">
          <p>
            Review the current Workspace entitlement, Credits, and monthly page
            capacity.
          </p>
          {summary ? (
            <div
              className="billing-header-status"
              aria-label="Billing operational status"
            >
              {billingBlockingReasons.length ? (
                billingBlockingReasons.map((reason) => (
                  <span key={reason} className="status-chip warn">
                    {reason}
                  </span>
                ))
              ) : (
                <span className="status-chip good">Ready for submissions</span>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {billing.isLoading && !summary ? (
        <section className="content-grid billing-page-grid">
          <article className="workspace-card">
            <p className="muted">Loading billing summary.</p>
          </article>
        </section>
      ) : billing.errorMessage ? (
        <section className="content-grid billing-page-grid">
          <article className="workspace-card">
            <div className="workspace-head">
              <h2>Billing unavailable</h2>
              <p>{billing.errorMessage}</p>
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={billing.onRefresh}
              >
                Retry
              </button>
            </div>
          </article>
        </section>
      ) : summary ? (
        <>
          {billing.actionErrorMessage && !isBillingModalOpen ? (
            <section className="content-grid billing-page-grid">
              <article
                className="workspace-card billing-action-error"
                role="alert"
              >
                <div className="workspace-head">
                  <h2>Billing action failed</h2>
                  <p>{billing.actionErrorMessage}</p>
                </div>
              </article>
            </section>
          ) : null}

          <section className="content-grid billing-page-grid">
            <article className="workspace-card billing-entitlement-card">
              <div className="workspace-head billing-entitlement-head">
                <div>
                  <h2>
                    {isUnpaid ? "Unpaid billing state" : "Current Active Plan"}
                  </h2>
                  <p>{entitlement.display_name || "Free"}</p>
                </div>
                <div className="billing-entitlement-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={openPlanModal}
                  >
                    View/Edit Plan
                  </button>
                  {supportsCreditPacks ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={openCreditModal}
                    >
                      Buy Credits
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className="billing-capacity-bar"
                aria-label={`${formatNumber(availableCreditsTotal)} Credits available, ${formatNumber(creditsUsedThisPeriod)} Credits used`}
              >
                <span
                  style={{
                    width: `${creditBalanceAvailablePercent(
                      availableCreditsTotal,
                      creditsUsedThisPeriod,
                    )}%`,
                  }}
                />
              </div>
              <dl className="billing-detail-list billing-plan-detail-list">
                <div>
                  <dt>
                    <span>Available Credits</span>
                    <button
                      type="button"
                      className="billing-detail-info-button"
                      aria-label="View available Credits breakdown"
                      title="View available Credits breakdown"
                      onClick={() => setIsCreditBreakdownOpen(true)}
                    >
                      i
                    </button>
                  </dt>
                  <dd>{formatNumber(availableCreditsTotal)}</dd>
                </div>
                <div>
                  <dt>Credits used</dt>
                  <dd>{formatNumber(creditsUsedThisPeriod)}</dd>
                </div>
                <div>
                  <dt>Plan Included Credits</dt>
                  <dd>{formatNumber(entitlement.included_credits || 0)}</dd>
                </div>
                <div>
                  <dt>Per Page Price</dt>
                  <dd>{catalogPriceLabel}</dd>
                </div>
              </dl>
            </article>

            <article className="workspace-card">
              <div className="workspace-head">
                <h2>Current Period</h2>
                <p>{formatDateRange(period.start, period.end)}</p>
              </div>
              <div
                className="billing-capacity-bar"
                aria-label={`${pagesRemainingLabel} pages remaining`}
              >
                <span style={{ width: `${capacityPercent(period)}%` }} />
              </div>
              <dl className="billing-detail-list">
                <div>
                  <dt>Monthly page limit</dt>
                  <dd>{monthlyPageLimitLabel}</dd>
                </div>
                <div>
                  <dt>Pages used</dt>
                  <dd>{formatNumber(period.pages_used || 0)}</dd>
                </div>
                <div>
                  <dt>Billing period start</dt>
                  <dd>{formatDate(period.start || period.anchor)}</dd>
                </div>
                <div>
                  <dt>Billing period renewal</dt>
                  <dd>{includedCreditRenewalDate}</dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="content-grid billing-page-grid">
            <article className="workspace-card billing-activity-card">
              <div className="workspace-head">
                <h2>Billing Activity</h2>
                <p>
                  {hasInvoiceBillingActivity
                    ? "Invoices and Credit additions for this Workspace."
                    : "Credit additions for this Workspace."}
                </p>
              </div>
              {billingActivity.length ? (
                <div
                  className={
                    billingActivity.length > 5
                      ? "billing-activity-list scrollable"
                      : "billing-activity-list"
                  }
                >
                  {billingActivity.map((activity) => (
                    <div key={activity.id} className="billing-activity-row">
                      <div>
                        <strong>{activity.description}</strong>
                        <span>{formatBillingActivityMeta(activity)}</span>
                      </div>
                      <span className={getBillingActivityValueClass(activity)}>
                        {formatBillingActivityValue(activity)}
                      </span>
                      <div className="billing-activity-invoice-action">
                        {activity.invoice_action?.url ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              payHostedInvoice(activity.invoice_action.url)
                            }
                          >
                            {activity.invoice_action.label}
                          </button>
                        ) : (
                          <span>-</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No billing activity yet.</p>
              )}
              {billing.activityErrorMessage ? (
                <p className="billing-activity-error" role="alert">
                  {billing.activityErrorMessage}
                </p>
              ) : null}
              {hasMoreBillingActivity ? (
                <div className="billing-activity-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={billing.isLoadingMoreBillingActivity}
                    onClick={billing.onLoadMoreBillingActivity}
                  >
                    {billing.isLoadingMoreBillingActivity
                      ? "Loading activity..."
                      : "Load more"}
                  </button>
                </div>
              ) : null}
            </article>

            <BillingCreditUsageCard
              billing={billing}
              creditUsage={creditUsage}
            />
          </section>

          {isPlanModalOpen ? (
            <BillingPlanModal
              billing={billing}
              entitlement={entitlement}
              subscription={subscription}
              nextScheduledEntitlement={nextScheduledEntitlement}
              actionErrorMessage={billing.actionErrorMessage}
              onClose={closePlanModal}
            />
          ) : null}

          {isCreditModalOpen ? (
            <BillingCreditModal
              billing={billing}
              catalogPriceLabel={catalogPriceLabel}
              actionErrorMessage={billing.actionErrorMessage}
              onClose={closeCreditModal}
            />
          ) : null}

          {isCreditBreakdownOpen ? (
            <CreditBreakdownModal
              credits={availableCreditBreakdown}
              totalCredits={Number(credits.total_available || 0)}
              onClose={() => setIsCreditBreakdownOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CreditBreakdownModal({ credits, totalCredits, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card billing-credit-breakdown-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Available Credits breakdown"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="billing-plan-modal-head">
          <div className="workspace-head">
            <h2>Available Credits</h2>
            <p>
              {formatNumber(totalCredits)} Credits available for this Workspace.
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {credits.length ? (
          <dl className="billing-credit-breakdown-list">
            {credits.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{formatNumber(item.value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">No available Credits.</p>
        )}
      </div>
    </div>
  );
}

function BillingCreditUsageCard({ billing, creditUsage }) {
  const chartFrameRef = useRef(null);
  const [activeUsageTooltip, setActiveUsageTooltip] = useState(null);
  const buckets = Array.isArray(creditUsage.buckets) ? creditUsage.buckets : [];
  const maxCredits = buckets.reduce(
    (max, bucket) => Math.max(max, Number(bucket.credits || 0)),
    0,
  );
  const totalCredits = Number(creditUsage.total_credits || 0);
  const chartContentMinWidth =
    buckets.length * 32 + Math.max(0, buckets.length - 1) * 7 + 20;

  function showUsageTooltip(event, tooltipText) {
    const frameRect = chartFrameRef.current?.getBoundingClientRect();
    const itemRect = event.currentTarget.getBoundingClientRect();

    if (!frameRect?.width) {
      setActiveUsageTooltip({ text: tooltipText, left: "50%" });
      return;
    }

    const edgePadding = 58;
    const centeredLeft = itemRect.left + itemRect.width / 2 - frameRect.left;
    const maxLeft = Math.max(edgePadding, frameRect.width - edgePadding);
    const clampedLeft = Math.min(
      Math.max(centeredLeft, edgePadding),
      maxLeft,
    );
    const scrollAdjustedLeft = clampedLeft + chartFrameRef.current.scrollLeft;

    setActiveUsageTooltip({
      text: tooltipText,
      left: `${scrollAdjustedLeft}px`,
    });
  }

  function hideUsageTooltip() {
    setActiveUsageTooltip(null);
  }

  return (
    <article className="workspace-card billing-usage-card">
      <div className="billing-usage-head">
        <div className="workspace-head">
          <h2>Credit Usage</h2>
          <p>Credit deductions over time.</p>
        </div>
        <div
          className="billing-usage-range-control"
          role="group"
          aria-label="Credit usage range"
        >
          {CREDIT_USAGE_RANGE_OPTIONS.map((option) => {
            const isSelected = option.value === creditUsage.range;
            return (
              <button
                key={option.value}
                type="button"
                className={isSelected ? "active" : ""}
                aria-pressed={isSelected ? "true" : "false"}
                disabled={billing.isLoadingCreditUsage}
                onClick={() => {
                  if (!isSelected) {
                    billing.onLoadCreditUsage?.(option.value);
                  }
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="billing-usage-total">
        <div>
          <strong>{formatNumber(totalCredits)}</strong>
          <span>Credits used</span>
        </div>
        <small>{formatCreditUsageWindow(creditUsage)}</small>
      </div>

      {billing.usageErrorMessage ? (
        <p className="billing-activity-error" role="alert">
          {billing.usageErrorMessage}
        </p>
      ) : null}

      {buckets.length ? (
        <div
          className="billing-usage-chart-frame"
          ref={chartFrameRef}
        >
          {activeUsageTooltip ? (
            <div
              className="billing-usage-tooltip"
              role="tooltip"
              style={{ "--tooltip-left": activeUsageTooltip.left }}
            >
              {activeUsageTooltip.text}
            </div>
          ) : null}
          <div
            className={`billing-usage-chart range-${creditUsage.range}`}
            role="img"
            aria-label={`${formatNumber(totalCredits)} Credits used for ${formatCreditUsageRangeName(creditUsage.range)}`}
            style={{ "--chart-content-min-width": `${chartContentMinWidth}px` }}
          >
            {buckets.map((bucket) => {
              const credits = Number(bucket.credits || 0);
              const height = calculateUsageBarHeight(credits, maxCredits);
              const tooltipText = formatUsageBarTooltip(credits);
              return (
                <div
                  key={`${bucket.start_at}-${bucket.end_at}`}
                  className="billing-usage-bar-item"
                  aria-label={`${bucket.label}: ${tooltipText}`}
                  tabIndex={0}
                  onMouseEnter={(event) => showUsageTooltip(event, tooltipText)}
                  onMouseLeave={hideUsageTooltip}
                  onFocus={(event) => showUsageTooltip(event, tooltipText)}
                  onBlur={hideUsageTooltip}
                >
                  <div className="billing-usage-bar-track">
                    <span style={{ "--bar-height": `${height}%` }} />
                  </div>
                  <span>{bucket.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="muted">No Credit usage in this range.</p>
      )}
    </article>
  );
}

function BillingCreditModal({
  billing,
  catalogPriceLabel,
  actionErrorMessage,
  onClose,
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card billing-credit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Buy credits"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="billing-plan-modal-head">
          <div className="workspace-head">
            <h2>Buy Credits</h2>
            <p>Choose a credit pack to purchase for this workspace.</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <BillingModalActionError message={actionErrorMessage} />

        <div className="billing-credit-grid">
          {CREDIT_PACK_OPTIONS.map((packSize) => (
            <article className="billing-credit-card" key={packSize}>
              <div>
                <strong>{formatNumber(packSize)}</strong>
                <span>Purchased Credits</span>
              </div>
              <p>{catalogPriceLabel} per Billable Document page</p>
              <button
                type="button"
                className="secondary billing-plan-action"
                disabled={Boolean(billing.startingCreditPackSize)}
                onClick={() => billing.onStartCreditPackCheckout(packSize)}
              >
                {billing.startingCreditPackSize === packSize
                  ? "Starting..."
                  : `Buy ${formatNumber(packSize)} Credits`}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function BillingPlanModal({
  billing,
  entitlement,
  subscription,
  nextScheduledEntitlement,
  actionErrorMessage,
  onClose,
}) {
  const activePlan = normalizePlan(entitlement.plan) || "free";
  const subscriptionPlan = normalizePlan(subscription?.plan);
  const subscriptionStatus = String(subscription?.status || "").trim();
  const nextScheduledPlan = normalizePlan(nextScheduledEntitlement?.plan);
  const isFreeOverridePlanSelection =
    activePlan === "free" &&
    subscriptionStatus === "active" &&
    Boolean(subscriptionPlan);
  const hasBlockingScheduledChange =
    Boolean(nextScheduledEntitlement) &&
    !(
      activePlan === "free" &&
      subscriptionStatus === "active" &&
      subscriptionPlan &&
      nextScheduledPlan === subscriptionPlan
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card billing-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-label="View/edit plan"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="billing-plan-modal-head">
          <div className="workspace-head">
            <h2>View/Edit Plan</h2>
            <p>
              Compare available Workspace subscriptions and choose the plan that
              matches this Workspace.
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <BillingModalActionError message={actionErrorMessage} />

        {hasBlockingScheduledChange ? (
          <ScheduledPlanChangeNotice
            activePlan={activePlan}
            nextScheduledEntitlement={nextScheduledEntitlement}
            isCanceling={billing.isCancelingScheduledChange}
            onCancel={billing.onCancelScheduledSubscriptionChange}
          />
        ) : null}

        <div className="billing-plan-grid">
          {SELF_SERVICE_PLAN_OPTIONS.map((plan) => (
            <BillingPlanCard
              key={plan.plan}
              plan={plan}
              action={getPlanAction({
                billing,
                plan: plan.plan,
                activePlan,
                subscriptionPlan,
                subscriptionStatus,
                isFreeOverridePlanSelection,
                hasScheduledChange: hasBlockingScheduledChange,
              })}
              isActive={plan.plan === activePlan}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ScheduledPlanChangeNotice({
  activePlan,
  nextScheduledEntitlement,
  isCanceling,
  onCancel,
}) {
  if (!nextScheduledEntitlement) {
    return null;
  }

  return (
    <section className="billing-scheduled-change" aria-label="Scheduled plan change">
      <div>
        <strong>Plan change scheduled</strong>
        <p>
          {formatPlanName(activePlan)} now, {formatPlanName(nextScheduledEntitlement.plan)} on{" "}
          {formatDate(nextScheduledEntitlement.effective_at)}.
        </p>
      </div>
      <button
        type="button"
        className="secondary"
        disabled={isCanceling || !onCancel}
        aria-busy={isCanceling ? "true" : undefined}
        onClick={onCancel}
      >
        {isCanceling ? "Canceling..." : "Cancel scheduled change"}
      </button>
    </section>
  );
}

function BillingModalActionError({ message }) {
  if (!message) {
    return null;
  }

  return (
    <article className="billing-modal-action-error" role="alert">
      <strong>Billing action failed</strong>
      <p>{message}</p>
    </article>
  );
}

function BillingPlanCard({ plan, action, isActive }) {
  const actionClassName = [
    "secondary",
    "billing-plan-action",
    action.isPending ? "is-pending" : "",
    action.isPassivelyDisabled ? "is-passively-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={isActive ? "billing-plan-card active" : "billing-plan-card"}
    >
      <div className="billing-plan-card-head">
        <div>
          <h3>{plan.displayName}</h3>
          <p>
            {isActive ? "Current Active entitlement" : "Available subscription"}
          </p>
        </div>
        {isActive ? <span className="status-chip good">Current</span> : null}
      </div>
      <div className="billing-plan-price">
        <strong>{plan.monthlyPrice}</strong>
        <span>per month</span>
      </div>
      <ul className="billing-plan-feature-list">
        <li>{formatNumber(plan.includedCredits)} Included Credits</li>
        <li>{formatLimitValue(plan.limits.monthlyPages)} pages monthly</li>
        <li>{formatLimitValue(plan.limits.templates)} Templates</li>
        <li>{formatLimitValue(plan.limits.topLevelFields)} top-level fields</li>
        <li>{formatLimitValue(plan.limits.members)} members</li>
        <li>
          {plan.limits.apiAccess ? "API access included" : "No API access"}
        </li>
        <li>{plan.perPagePrice} per Billable Document page</li>
      </ul>
      <button
        type="button"
        className={actionClassName}
        disabled={action.disabled}
        aria-busy={action.isPending ? "true" : undefined}
        onClick={action.onClick}
      >
        {action.label}
      </button>
    </article>
  );
}

function getPlanAction({
  billing,
  plan,
  activePlan,
  subscriptionPlan,
  subscriptionStatus,
  isFreeOverridePlanSelection,
  hasScheduledChange,
}) {
  if (isFreeOverridePlanSelection) {
    if (plan === "free") {
      return {
        label: "Current plan",
        disabled: true,
        onClick: undefined,
      };
    }

    const isStartingThisChange =
      billing.startingSubscriptionChangePlan === plan;
    const isAnySubscriptionChangeStarting = Boolean(
      billing.startingSubscriptionChangePlan,
    );

    return {
      label: isStartingThisChange
        ? "Starting..."
        : `Upgrade to ${formatPlanName(plan)}`,
      disabled: isAnySubscriptionChangeStarting,
      isPending: isStartingThisChange,
      isPassivelyDisabled:
        isAnySubscriptionChangeStarting && !isStartingThisChange,
      onClick: () => billing.onStartSubscriptionChange(plan),
    };
  }

  if (hasScheduledChange) {
    return {
      label: "Scheduled",
      disabled: true,
      onClick: undefined,
    };
  }

  if (subscriptionPlan) {
    if (subscriptionStatus !== "active") {
      return {
        label:
          plan === subscriptionPlan
            ? `Subscription ${subscriptionStatus}`
            : "Unavailable",
        disabled: true,
        onClick: undefined,
      };
    }

    if (plan === subscriptionPlan) {
      return {
        label: "Current plan",
        disabled: true,
        onClick: undefined,
      };
    }

    if (plan === "free") {
      const isStartingFreeChange =
        billing.startingSubscriptionChangePlan === "free";
      const isAnySubscriptionChangeStarting = Boolean(
        billing.startingSubscriptionChangePlan,
      );
      return {
        label: isStartingFreeChange ? "Starting..." : "Switch to Free",
        disabled: isAnySubscriptionChangeStarting,
        isPending: isStartingFreeChange,
        isPassivelyDisabled:
          isAnySubscriptionChangeStarting && !isStartingFreeChange,
        onClick: () => billing.onStartSubscriptionChange("free"),
      };
    }

    const changeLabel =
      subscriptionPlan === "pro" && plan === "max"
        ? "Upgrade to Max"
        : subscriptionPlan === "max" && plan === "pro"
          ? "Downgrade to Pro"
          : `Switch to ${formatPlanName(plan)}`;

    const isStartingThisChange =
      billing.startingSubscriptionChangePlan === plan;
    const isAnySubscriptionChangeStarting = Boolean(
      billing.startingSubscriptionChangePlan,
    );

    return {
      label: isStartingThisChange ? "Starting..." : changeLabel,
      disabled: isAnySubscriptionChangeStarting,
      isPending: isStartingThisChange,
      isPassivelyDisabled:
        isAnySubscriptionChangeStarting && !isStartingThisChange,
      onClick: () => billing.onStartSubscriptionChange(plan),
    };
  }

  if (plan === activePlan) {
    return {
      label: "Current plan",
      disabled: true,
      onClick: undefined,
    };
  }

  if (plan === "free") {
    return {
      label: "Free plan",
      disabled: true,
      onClick: undefined,
    };
  }

  const isStartingThisPlan = billing.startingSubscriptionPlan === plan;
  const isAnySubscriptionStarting = Boolean(billing.startingSubscriptionPlan);

  return {
    label: isStartingThisPlan ? "Starting..." : `Start ${formatPlanName(plan)}`,
    disabled: isAnySubscriptionStarting,
    isPending: isStartingThisPlan,
    isPassivelyDisabled: isAnySubscriptionStarting && !isStartingThisPlan,
    onClick: () => billing.onStartSubscriptionCheckout(plan),
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function buildAvailableCreditBreakdown(credits) {
  return [
    {
      label: "Purchased Credits",
      value: Number(credits?.purchased_available || 0),
    },
    {
      label: "Goodwill Credits",
      value: Number(credits?.goodwill_available || 0),
    },
    {
      label: "Plan Included Credits",
      value: Number(credits?.included_available || 0),
    },
  ].filter((item) => item.value > 0);
}

function getBillingBlockingReasons(status) {
  if (!Array.isArray(status?.blocking_reasons)) {
    return [];
  }
  return status.blocking_reasons
    .map((reason) => String(reason || "").trim())
    .filter(Boolean);
}

function formatLimitValue(value) {
  if (value === null || value === undefined) {
    return "Unlimited";
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  return String(value);
}

function formatPlanName(value) {
  const plan = normalizePlan(value);
  if (plan === "pro") {
    return "Pro";
  }
  if (plan === "max") {
    return "Max";
  }
  if (plan === "free") {
    return "Free";
  }
  return "-";
}

function normalizePlan(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildInvoiceBillingActivityRows({
  subscription,
  paymentRequiredOverride,
  enterpriseRampUp,
  enterpriseAnnual,
}) {
  const rows = [];
  const subscriptionInvoice = subscription?.invoice || null;
  const subscriptionUrl = subscriptionInvoice?.hosted_invoice_url || "";
  const subscriptionFailureMeta = formatSubscriptionInvoiceFailureMeta(
    subscriptionInvoice?.finalization_failure,
  );
  if (subscriptionUrl || subscriptionInvoice?.status || subscriptionFailureMeta.length) {
    const invoiceStatus = normalizeInvoiceStatus(subscriptionInvoice?.status);
    rows.push({
      id: "invoice_self_service_subscription",
      type: "invoice",
      occurred_at:
        subscription?.current_period_start ||
        subscription?.current_period_end ||
        "",
      description: formatSubscriptionInvoiceStatus(subscription),
      invoice_status: invoiceStatus,
      invoice_meta: [
        "Subscription",
        formatDateRange(
          subscription?.current_period_start,
          subscription?.current_period_end,
        ),
        ...subscriptionFailureMeta,
      ],
      invoice_action: buildHostedInvoiceAction(subscriptionUrl, invoiceStatus),
    });
  }

  const paymentRequiredUrl =
    paymentRequiredOverride?.invoice?.hosted_invoice_url || "";
  if (paymentRequiredUrl) {
    const invoiceStatus = normalizeInvoiceStatus(
      paymentRequiredOverride?.invoice?.status,
    );
    rows.push({
      id: "invoice_payment_required_override",
      type: "invoice",
      occurred_at:
        paymentRequiredOverride?.created_at ||
        paymentRequiredOverride?.start_at ||
        "",
      description: formatPaymentRequiredOverrideStatus(paymentRequiredOverride),
      amount: paymentRequiredOverride?.amount || null,
      invoice_status: invoiceStatus,
      invoice_meta: [
        formatCollectionMode(paymentRequiredOverride?.collection_mode),
        formatDateRange(
          paymentRequiredOverride?.start_at,
          paymentRequiredOverride?.end_at,
        ),
      ],
      invoice_action: buildHostedInvoiceAction(
        paymentRequiredUrl,
        invoiceStatus,
      ),
    });
  }

  const rampUpUrl = enterpriseRampUp?.latest_invoice?.hosted_invoice_url || "";
  if (rampUpUrl) {
    const invoiceStatus = normalizeInvoiceStatus(
      enterpriseRampUp?.latest_invoice?.status,
    );
    rows.push({
      id: "invoice_enterprise_ramp_up",
      type: "invoice",
      occurred_at:
        enterpriseRampUp?.latest_invoice?.period_end ||
        enterpriseRampUp?.created_at ||
        enterpriseRampUp?.starts_at ||
        "",
      description: formatEnterpriseRampUpInvoiceStatus(enterpriseRampUp),
      invoice_status: invoiceStatus,
      invoice_meta: [
        formatCollectionMode(enterpriseRampUp?.collection_mode),
        formatDateRange(
          enterpriseRampUp?.latest_invoice?.period_start,
          enterpriseRampUp?.latest_invoice?.period_end,
        ),
      ],
      invoice_action: buildHostedInvoiceAction(rampUpUrl, invoiceStatus),
    });
  }

  const annualOverageUrl =
    enterpriseAnnual?.latest_overage_invoice?.hosted_invoice_url || "";
  if (annualOverageUrl) {
    const invoiceStatus = normalizeInvoiceStatus(
      enterpriseAnnual?.latest_overage_invoice?.status,
    );
    rows.push({
      id: "invoice_enterprise_annual_overage",
      type: "invoice",
      occurred_at:
        enterpriseAnnual?.latest_overage_invoice?.period_end ||
        enterpriseAnnual?.created_at ||
        enterpriseAnnual?.starts_at ||
        "",
      description: formatEnterpriseAnnualOverageInvoiceStatus(enterpriseAnnual),
      invoice_status: invoiceStatus,
      invoice_meta: [
        formatCollectionMode(enterpriseAnnual?.collection_mode),
        formatDateRange(
          enterpriseAnnual?.latest_overage_invoice?.period_start,
          enterpriseAnnual?.latest_overage_invoice?.period_end,
        ),
      ],
      invoice_action: buildHostedInvoiceAction(
        annualOverageUrl,
        invoiceStatus,
      ),
    });
  }

  const annualUpfrontUrl =
    enterpriseAnnual?.upfront_invoice?.hosted_invoice_url || "";
  if (annualUpfrontUrl) {
    const invoiceStatus = normalizeInvoiceStatus(
      enterpriseAnnual?.upfront_invoice?.status,
    );
    rows.push({
      id: "invoice_enterprise_annual_upfront",
      type: "invoice",
      occurred_at:
        enterpriseAnnual?.upfront_invoice?.paid_at ||
        enterpriseAnnual?.created_at ||
        enterpriseAnnual?.starts_at ||
        "",
      description: formatEnterpriseAnnualUpfrontInvoiceStatus(enterpriseAnnual),
      amount: enterpriseAnnual?.yearly_amount || null,
      invoice_status: invoiceStatus,
      invoice_meta: [
        formatCollectionMode(enterpriseAnnual?.collection_mode),
        formatDateRange(enterpriseAnnual?.starts_at, enterpriseAnnual?.ends_at),
      ],
      invoice_action: buildHostedInvoiceAction(
        annualUpfrontUrl,
        invoiceStatus,
      ),
    });
  }

  return rows;
}

function buildHostedInvoiceAction(url, invoiceStatus) {
  if (!url) {
    return null;
  }
  return {
    label: isPayableInvoiceStatus(invoiceStatus) ? "Pay invoice" : "View invoice",
    url,
  };
}

function normalizeOwnerBillingActivity(activity) {
  if (activity?.type === "credit_pack_payment_failed") {
    const invoiceStatus = normalizeInvoiceStatus(
      activity?.invoice?.status ||
        activity?.invoice_status ||
        "payment_failed",
    );
    const invoiceUrl =
      activity?.invoice?.hosted_invoice_url ||
      activity?.invoice_action?.url ||
      "";
    return {
      ...activity,
      invoice_status: invoiceStatus,
      invoice_action:
        activity.invoice_action || buildHostedInvoiceAction(invoiceUrl, invoiceStatus),
    };
  }
  if (activity?.type === "included_credit_grant") {
    return activity;
  }
  const invoiceUrl =
    activity?.invoice?.hosted_invoice_url ||
    activity?.invoice_action?.url ||
    "";
  if (!invoiceUrl) {
    return activity;
  }
  const invoiceStatus = normalizeInvoiceStatus(
    activity?.invoice?.status ||
      activity?.invoice_status ||
      "paid",
  );
  return {
    ...activity,
    invoice_action:
      activity.invoice_action || buildHostedInvoiceAction(invoiceUrl, invoiceStatus),
  };
}

function formatSubscriptionInvoiceStatus(subscription) {
  const planName = formatPlanName(subscription?.plan);
  const status = String(subscription?.invoice?.status || "pending").replaceAll(
    "_",
    " ",
  );
  return `${planName} subscription invoice ${status}`;
}

function formatSubscriptionInvoiceFailureMeta(finalizationFailure) {
  if (!finalizationFailure) {
    return [];
  }
  return [
    finalizationFailure.automatic_tax_status
      ? `Automatic tax ${formatDiagnosticValue(finalizationFailure.automatic_tax_status)}`
      : "",
    finalizationFailure.automatic_tax_reason
      ? `Tax location ${formatDiagnosticValue(finalizationFailure.automatic_tax_reason)}`
      : "",
    finalizationFailure.last_finalization_error_code
      ? `Finalization error ${formatDiagnosticValue(finalizationFailure.last_finalization_error_code)}`
      : "",
  ].filter(Boolean);
}

function formatDiagnosticValue(value) {
  return String(value || "")
    .trim()
    .replaceAll("_", " ");
}

function formatPaymentRequiredOverrideStatus(override) {
  const planName = override?.display_name || formatPlanName(override?.plan);
  const status = String(override?.invoice?.status || "pending").replaceAll(
    "_",
    " ",
  );
  return `Payment-required ${planName} invoice ${status}`;
}

function formatEnterpriseRampUpInvoiceStatus(enterpriseRampUp) {
  const status = String(
    enterpriseRampUp?.latest_invoice?.status || "",
  ).replaceAll("_", " ");
  if (status) {
    return `Enterprise ramp-up invoice ${status}`;
  }
  return `Enterprise ramp-up ${String(enterpriseRampUp?.status || "active").replaceAll("_", " ")}`;
}

function formatEnterpriseAnnualOverageInvoiceStatus(enterpriseAnnual) {
  const status = String(
    enterpriseAnnual?.latest_overage_invoice?.status || "pending",
  ).replaceAll("_", " ");
  return `Enterprise annual overage invoice ${status}`;
}

function formatEnterpriseAnnualUpfrontInvoiceStatus(enterpriseAnnual) {
  const status = String(
    enterpriseAnnual?.upfront_invoice?.status || "pending",
  ).replaceAll("_", " ");
  return `Enterprise annual upfront invoice ${status}`;
}

function formatCollectionMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "automatic") {
    return "Automatic collection";
  }
  if (mode === "manual") {
    return "Manual collection";
  }
  return "-";
}

function formatBillingActivityMeta(activity) {
  if (Array.isArray(activity.invoice_meta)) {
    const meta = activity.invoice_meta
      .map((item) => String(item || "").trim())
      .filter((item) => item && item !== "-");
    if (meta.length) {
      return meta.join(" · ");
    }
  }
  return formatDate(activity.occurred_at);
}

function formatBillingActivityValue(activity) {
  if (activity.amount?.display) {
    return activity.amount.display;
  }
  if (activity.invoice_status) {
    return formatInvoiceStatusLabel(activity.invoice_status);
  }
  return formatSignedCredits(activity.credits);
}

function getBillingActivityValueClass(activity) {
  if (activity.invoice_status) {
    return isPayableInvoiceStatus(activity.invoice_status)
      ? "status-chip warn"
      : "status-chip good";
  }
  return Number(activity.credits || 0) < 0
    ? "status-chip warn"
    : "status-chip good";
}

function normalizeInvoiceStatus(value) {
  return String(value || "pending")
    .trim()
    .toLowerCase();
}

function formatInvoiceStatusLabel(value) {
  const status = normalizeInvoiceStatus(value).replaceAll("_", " ");
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isPayableInvoiceStatus(value) {
  const status = normalizeInvoiceStatus(value);
  return [
    "open",
    "finalization_failed",
    "payment_action_required",
    "payment failed",
    "payment_failed",
    "past_due",
    "unpaid",
  ].includes(status);
}

function payHostedInvoice(url) {
  try {
    window.sessionStorage.setItem("documentextraction.billing.return", "1");
  } catch {}
  window.location.assign(url);
}

function formatSignedCredits(value) {
  const credits = Number(value || 0);
  const prefix = credits > 0 ? "+" : "";
  return `${prefix}${formatNumber(credits)} Credits`;
}

function normalizeCreditUsage(value) {
  const range = normalizeCreditUsageRange(value?.range);
  return {
    range,
    total_credits: Number(value?.total_credits || 0),
    total_billable_document_pages: Number(
      value?.total_billable_document_pages || 0,
    ),
    buckets: Array.isArray(value?.buckets)
      ? value.buckets.map((bucket) => ({
          label: String(bucket?.label || ""),
          start_at: String(bucket?.start_at || ""),
          end_at: String(bucket?.end_at || ""),
          credits: Number(bucket?.credits || 0),
          billable_document_pages: Number(bucket?.billable_document_pages || 0),
        }))
      : [],
  };
}

function normalizeCreditUsageRange(value) {
  const range = String(value || "")
    .trim()
    .toLowerCase();
  if (["daily", "weekly", "monthly", "yearly"].includes(range)) {
    return range;
  }
  return "daily";
}

function calculateUsageBarHeight(value, maxValue) {
  const amount = Number(value || 0);
  const max = Number(maxValue || 0);
  if (amount <= 0 || max <= 0) {
    return 0;
  }
  return Math.max(8, Math.min(100, Math.round((amount / max) * 100)));
}

function formatUsageBarTooltip(value) {
  const credits = Number(value || 0);
  return `${formatNumber(credits)} ${credits === 1 ? "Credit" : "Credits"} used`;
}

function formatCreditUsageRangeName(value) {
  const range = normalizeCreditUsageRange(value);
  if (range === "weekly") {
    return "weekly usage";
  }
  if (range === "monthly") {
    return "monthly usage";
  }
  if (range === "yearly") {
    return "yearly usage";
  }
  return "daily usage";
}

function formatCreditUsageWindow(creditUsage) {
  const range = normalizeCreditUsageRange(creditUsage?.range);
  if (range === "weekly") {
    return "Last 7 days";
  }
  if (range === "monthly") {
    return "Last 4 weeks";
  }
  if (range === "yearly") {
    return "Last 12 months";
  }
  const firstBucket = Array.isArray(creditUsage?.buckets)
    ? creditUsage.buckets[0]
    : null;
  return `${formatDate(firstBucket?.start_at)} hourly`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateRange(start, end) {
  return `${formatDate(start)} to ${formatDate(end)}`;
}

function capacityPercent(period) {
  if (period.monthly_page_limit === null || period.pages_remaining === null) {
    return 100;
  }
  const limit = Number(period.monthly_page_limit || 0);
  if (!limit) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(100, (Number(period.pages_remaining || 0) / limit) * 100),
  );
}

function creditBalanceAvailablePercent(available, used) {
  const availableCredits = Math.max(0, Number(available || 0));
  const usedCredits = Math.max(0, Number(used || 0));
  const total = availableCredits + usedCredits;
  if (!total) {
    return 0;
  }
  return Math.max(0, Math.min(100, (availableCredits / total) * 100));
}
