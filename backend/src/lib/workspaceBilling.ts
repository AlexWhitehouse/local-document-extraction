import type { FieldDefinition, Workspace } from "./types";

type BillingCatalogPrice = {
  currency: "GBP";
  amount_minor: number;
  display: string;
  tax_behavior: "exclusive";
};

type MonthlyBillingPrice = {
  currency: "GBP";
  amount_minor: number;
  display: string;
};

export type BillingPlan = {
  plan: "free" | "pro" | "max";
  display_name: "Free" | "Pro" | "Max";
  monthly_price: MonthlyBillingPrice;
  included_credits: number;
  api_access: boolean;
  per_page_catalog_price: BillingCatalogPrice;
  limits: {
    templates: number;
    top_level_template_fields: number;
    table_shaped_fields: number;
    table_columns_per_field: number;
    members: number | null;
    monthly_pages: number;
    api_access: boolean;
  };
};

type NoBillingEntitlement = {
  plan: "no_billing";
  display_name: "No-billing";
  included_credits: 0;
  api_access: true;
  per_page_catalog_price: null;
  limits: {
    templates: null;
    top_level_template_fields: 25;
    table_shaped_fields: 1;
    table_columns_per_field: 20;
    members: null;
    monthly_pages: null;
    api_access: true;
  };
};

type EnterpriseRampUpEntitlement = {
  plan: "enterprise_ramp_up";
  display_name: "Enterprise ramp-up";
  included_credits: 0;
  api_access: true;
  per_page_catalog_price: null;
  limits: NoBillingEntitlement["limits"];
};

type EnterpriseAnnualEntitlement = {
  plan: "enterprise_annual";
  display_name: "Enterprise annual";
  included_credits: 0;
  api_access: true;
  per_page_catalog_price: null;
  limits: NoBillingEntitlement["limits"];
};

type ActiveEntitlement =
  | Omit<BillingPlan, "limits" | "monthly_price">
  | Omit<NoBillingEntitlement, "limits">
  | Omit<EnterpriseRampUpEntitlement, "limits">
  | Omit<EnterpriseAnnualEntitlement, "limits">;

export type WorkspaceBillingControl = {
  ledger_object_name?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_item_id?: string | null;
  self_service_subscription_plan?: "pro" | "max" | null;
  self_service_subscription_status?: string | null;
  stripe_subscription_current_period_start?: string | null;
  stripe_subscription_current_period_end?: string | null;
  self_service_subscription_invoice_id?: string | null;
  self_service_subscription_invoice_status?: string | null;
  self_service_subscription_hosted_invoice_url?: string | null;
  scheduled_entitlement_plan?: "free" | "pro" | "max" | null;
  scheduled_entitlement_effective_at?: string | null;
  enterprise_deal_status?: string | null;
  plan_override_plan?: "free" | "pro" | "max" | null;
  plan_override_start_at?: string | null;
  plan_override_end_at?: string | null;
  plan_override_reason?: string | null;
  plan_override_created_by_user_id?: string | null;
  plan_override_created_at?: string | null;
  payment_required_plan_override_plan?: "free" | "pro" | "max" | null;
  payment_required_plan_override_start_at?: string | null;
  payment_required_plan_override_end_at?: string | null;
  payment_required_plan_override_reason?: string | null;
  payment_required_plan_override_created_by_user_id?: string | null;
  payment_required_plan_override_created_at?: string | null;
  payment_required_plan_override_amount_minor?: number | null;
  payment_required_plan_override_currency?: "GBP" | null;
  payment_required_plan_override_collection_mode?: "automatic" | "manual" | null;
  payment_required_plan_override_invoice_id?: string | null;
  payment_required_plan_override_invoice_status?: string | null;
  payment_required_plan_override_hosted_invoice_url?: string | null;
  payment_required_plan_override_paid_at?: string | null;
  enterprise_ramp_up_status?: string | null;
  enterprise_ramp_up_duration_months?: number | null;
  enterprise_billing_cycle_start_date?: string | null;
  enterprise_ramp_up_collection_mode?: "automatic" | "manual" | null;
  enterprise_ramp_up_invoice_review_enabled?: number | boolean | null;
  enterprise_ramp_up_reason?: string | null;
  enterprise_ramp_up_created_by_user_id?: string | null;
  enterprise_ramp_up_created_at?: string | null;
  enterprise_ramp_up_last_invoice_period_start?: string | null;
  enterprise_ramp_up_last_invoice_period_end?: string | null;
  enterprise_ramp_up_last_invoice_id?: string | null;
  enterprise_ramp_up_last_invoice_status?: string | null;
  enterprise_ramp_up_last_invoice_hosted_url?: string | null;
  enterprise_ramp_up_last_invoiced_at?: string | null;
  enterprise_annual_status?: string | null;
  enterprise_annual_monthly_minimum_allowance?: number | null;
  enterprise_annual_per_page_price_minor?: number | null;
  enterprise_annual_yearly_amount_minor?: number | null;
  enterprise_annual_collection_mode?: "automatic" | "manual" | null;
  enterprise_annual_invoice_review_enabled?: number | boolean | null;
  enterprise_annual_reason?: string | null;
  enterprise_annual_created_by_user_id?: string | null;
  enterprise_annual_created_at?: string | null;
  enterprise_annual_upfront_invoice_id?: string | null;
  enterprise_annual_upfront_invoice_status?: string | null;
  enterprise_annual_upfront_invoice_hosted_url?: string | null;
  enterprise_annual_upfront_invoice_paid_at?: string | null;
  enterprise_annual_last_overage_invoice_period_start?: string | null;
  enterprise_annual_last_overage_invoice_period_end?: string | null;
  enterprise_annual_last_overage_invoice_id?: string | null;
  enterprise_annual_last_overage_invoice_status?: string | null;
  enterprise_annual_last_overage_invoice_hosted_url?: string | null;
  enterprise_annual_last_overage_invoiced_at?: string | null;
  no_billing_enabled?: number | boolean | null;
  no_billing_reason?: string | null;
  no_billing_updated_by_user_id?: string | null;
  no_billing_updated_at?: string | null;
};

export type WorkspaceBillingSummary = {
  workspace_id: string;
  billing_state: "active" | "unpaid";
  active_entitlement: ActiveEntitlement;
  credits: {
    included_available: number;
    purchased_available: number;
    total_available: number;
  };
  current_period: {
    anchor: string;
    start: string;
    end: string;
    monthly_page_limit: number | null;
    pages_used: number;
    pages_remaining: number | null;
  };
  plan_limits: {
    templates: number | null;
    top_level_template_fields: number;
    table_shaped_fields: number;
    table_columns_per_field: number;
    members: number | null;
    monthly_pages: number | null;
    api_access: boolean;
  };
  billing_operational_status: {
    status: "active";
    blocking_reasons: string[];
  };
  next_scheduled_entitlement: {
    plan: "free" | "pro" | "max";
    display_name: "Free" | "Pro" | "Max";
    effective_at: string;
  } | null;
  self_service_subscription: {
    plan: "pro" | "max";
    status: string;
    current_period_start: string;
    current_period_end: string;
    invoice?: {
      status: string | null;
      hosted_invoice_url: string | null;
    } | null;
  } | null;
  payment_required_plan_override?: {
    plan: "free" | "pro" | "max";
    display_name: "Free" | "Pro" | "Max";
    start_at: string | null;
    end_at: string | null;
    amount: {
      currency: "GBP";
      amount_minor: number;
      display: string;
      tax_behavior: "exclusive";
    };
    collection_mode: "automatic" | "manual";
    invoice: {
      status: string | null;
      hosted_invoice_url: string | null;
    };
  } | null;
  enterprise_ramp_up?: {
    status: string;
    duration_months: number;
    enterprise_billing_cycle_start_date: string;
    starts_at: string;
    ends_at: string;
    collection_mode: "automatic" | "manual";
    invoice_review_enabled: boolean;
    reason: string | null;
    created_by_user_id: string | null;
    created_at: string | null;
    latest_invoice?: {
      period_start: string;
      period_end: string;
      status: string | null;
      hosted_invoice_url: string | null;
    } | null;
  } | null;
  enterprise_annual_commitment?: {
    status: string;
    monthly_minimum_allowance: number;
    per_page_price: BillingCatalogPrice;
    yearly_amount: BillingCatalogPrice;
    enterprise_billing_cycle_start_date: string;
    starts_at: string;
    ends_at: string;
    collection_mode: "automatic" | "manual";
    invoice_review_enabled: boolean;
    reason: string | null;
    created_by_user_id: string | null;
    created_at: string | null;
    upfront_invoice?: {
      status: string | null;
      hosted_invoice_url: string | null;
      paid_at: string | null;
    } | null;
    latest_overage_invoice?: {
      period_start: string;
      period_end: string;
      status: string | null;
      hosted_invoice_url: string | null;
    } | null;
  } | null;
  payment_controls: [];
};

export type TemplatePlanLimitUsage = {
  template_id: string;
  top_level_template_fields: number;
  table_shaped_fields: number;
  max_table_columns_per_field: number;
};

export const NON_ENTERPRISE_BILLING_PLANS: Record<BillingPlan["plan"], BillingPlan> = {
  free: {
    plan: "free",
    display_name: "Free",
    monthly_price: {
      currency: "GBP",
      amount_minor: 0,
      display: "GBP 0",
    },
    included_credits: 0,
    api_access: false,
    per_page_catalog_price: {
      currency: "GBP",
      amount_minor: 22,
      display: "GBP 0.22",
      tax_behavior: "exclusive",
    },
    limits: {
      templates: 3,
      top_level_template_fields: 5,
      table_shaped_fields: 1,
      table_columns_per_field: 5,
      members: 3,
      monthly_pages: 500,
      api_access: false,
    },
  },
  pro: {
    plan: "pro",
    display_name: "Pro",
    monthly_price: {
      currency: "GBP",
      amount_minor: 5000,
      display: "GBP 50",
    },
    included_credits: 200,
    api_access: true,
    per_page_catalog_price: {
      currency: "GBP",
      amount_minor: 20,
      display: "GBP 0.20",
      tax_behavior: "exclusive",
    },
    limits: {
      templates: 10,
      top_level_template_fields: 15,
      table_shaped_fields: 1,
      table_columns_per_field: 10,
      members: 50,
      monthly_pages: 1500,
      api_access: true,
    },
  },
  max: {
    plan: "max",
    display_name: "Max",
    monthly_price: {
      currency: "GBP",
      amount_minor: 20000,
      display: "GBP 200",
    },
    included_credits: 1000,
    api_access: true,
    per_page_catalog_price: {
      currency: "GBP",
      amount_minor: 18,
      display: "GBP 0.18",
      tax_behavior: "exclusive",
    },
    limits: {
      templates: 50,
      top_level_template_fields: 20,
      table_shaped_fields: 1,
      table_columns_per_field: 15,
      members: null,
      monthly_pages: 5000,
      api_access: true,
    },
  },
};

export const FREE_BILLING_PLAN: BillingPlan = NON_ENTERPRISE_BILLING_PLANS.free;

export const NO_BILLING_ENTITLEMENT: NoBillingEntitlement = {
  plan: "no_billing",
  display_name: "No-billing",
  included_credits: 0,
  api_access: true,
  per_page_catalog_price: null,
  limits: {
    templates: null,
    top_level_template_fields: 25,
    table_shaped_fields: 1,
    table_columns_per_field: 20,
    members: null,
    monthly_pages: null,
    api_access: true,
  },
};

export const ENTERPRISE_RAMP_UP_ENTITLEMENT: EnterpriseRampUpEntitlement = {
  plan: "enterprise_ramp_up",
  display_name: "Enterprise ramp-up",
  included_credits: 0,
  api_access: true,
  per_page_catalog_price: null,
  limits: NO_BILLING_ENTITLEMENT.limits,
};

export const ENTERPRISE_ANNUAL_ENTITLEMENT: EnterpriseAnnualEntitlement = {
  plan: "enterprise_annual",
  display_name: "Enterprise annual",
  included_credits: 0,
  api_access: true,
  per_page_catalog_price: null,
  limits: NO_BILLING_ENTITLEMENT.limits,
};

export function summarizeFreeWorkspaceBilling(
  workspace: Workspace,
  now: Date = new Date(),
): WorkspaceBillingSummary {
  return summarizeWorkspaceBilling(workspace, null, now);
}

export function summarizeWorkspaceBilling(
  workspace: Workspace,
  control: WorkspaceBillingControl | null = null,
  now: Date = new Date(),
): WorkspaceBillingSummary {
  if (isNoBillingModeEnabled(control)) {
    const period = getCurrentBillingPeriod(getFreeBillingPeriodAnchor(workspace, control, now), now);
    return summarizeWorkspaceBillingForNoBilling(workspace, period, resolveNextScheduledEntitlement(control));
  }

  const activePlanOverride = resolveActivePlanOverride(control, now);
  if (activePlanOverride) {
    const period = getCurrentBillingPeriod(activePlanOverride.startAt, now, activePlanOverride.endAt);
    const nextScheduledEntitlement = activePlanOverride.fallbackPlan === activePlanOverride.plan
      ? null
      : {
          plan: activePlanOverride.fallbackPlan,
          display_name: NON_ENTERPRISE_BILLING_PLANS[activePlanOverride.fallbackPlan].display_name,
          effective_at: activePlanOverride.endAt,
        };
    return summarizeWorkspaceBillingForPlan(
      workspace,
      NON_ENTERPRISE_BILLING_PLANS[activePlanOverride.plan],
      period,
      resolveSelfServiceSubscription(control),
      nextScheduledEntitlement,
      "active",
      null,
      resolveEnterpriseAnnualCommitment(control, now),
    );
  }

  const enterpriseRampUp = resolveEnterpriseRampUp(control, now);
  if (enterpriseRampUp?.status === "active") {
    const period = getCurrentBillingPeriod(enterpriseRampUp.enterprise_billing_cycle_start_date, now);
    return summarizeWorkspaceBillingForEnterpriseRampUp(
      workspace,
      period,
      resolveSelfServiceSubscription(control),
      enterpriseRampUp,
    );
  }

  const enterpriseAnnual = resolveEnterpriseAnnualCommitment(control, now);
  if (enterpriseAnnual?.status === "active") {
    const period = getCurrentBillingPeriod(enterpriseAnnual.enterprise_billing_cycle_start_date, now);
    return summarizeWorkspaceBillingForEnterpriseAnnual(
      workspace,
      period,
      resolveSelfServiceSubscription(control),
      enterpriseAnnual,
    );
  }

  const unpaidPlan = resolveUnpaidSelfServicePlan(control);
  if (unpaidPlan) {
    return summarizeWorkspaceBillingForPlan(workspace, FREE_BILLING_PLAN, {
      anchor: unpaidPlan.currentPeriodStart,
      start: unpaidPlan.currentPeriodStart,
      end: unpaidPlan.currentPeriodEnd,
    }, resolveSelfServiceSubscription(control), resolveNextScheduledEntitlement(control), "unpaid", enterpriseRampUp, enterpriseAnnual);
  }

  const paidPlan = resolveActiveSelfServicePlan(control, now);
  if (paidPlan) {
    return summarizeWorkspaceBillingForPlan(workspace, NON_ENTERPRISE_BILLING_PLANS[paidPlan.plan], {
      anchor: paidPlan.currentPeriodStart,
      start: paidPlan.currentPeriodStart,
      end: paidPlan.currentPeriodEnd,
    }, resolveSelfServiceSubscription(control), resolveNextScheduledEntitlement(control), "active", enterpriseRampUp, enterpriseAnnual);
  }

  const period = getCurrentBillingPeriod(getFreeBillingPeriodAnchor(workspace, control, now), now);
  return summarizeWorkspaceBillingForPlan(workspace, FREE_BILLING_PLAN, period, null, resolveNextScheduledEntitlement(control), "active", enterpriseRampUp, enterpriseAnnual);
}

function isNoBillingModeEnabled(control: WorkspaceBillingControl | null): boolean {
  return control?.no_billing_enabled === true || Number(control?.no_billing_enabled || 0) === 1;
}

function summarizeWorkspaceBillingForNoBilling(
  workspace: Workspace,
  period: { anchor: string; start: string; end: string },
  nextScheduledEntitlement: WorkspaceBillingSummary["next_scheduled_entitlement"],
): WorkspaceBillingSummary {
  const { limits, ...activeEntitlement } = NO_BILLING_ENTITLEMENT;
  return {
    workspace_id: workspace.id,
    billing_state: "active",
    active_entitlement: activeEntitlement,
    credits: {
      included_available: 0,
      purchased_available: 0,
      total_available: 0,
    },
    current_period: {
      anchor: period.anchor,
      start: period.start,
      end: period.end,
      monthly_page_limit: null,
      pages_used: 0,
      pages_remaining: null,
    },
    plan_limits: limits,
    billing_operational_status: {
      status: "active",
      blocking_reasons: [],
    },
    next_scheduled_entitlement: nextScheduledEntitlement,
    self_service_subscription: null,
    payment_controls: [],
  };
}

function summarizeWorkspaceBillingForEnterpriseRampUp(
  workspace: Workspace,
  period: { anchor: string; start: string; end: string },
  selfServiceSubscription: WorkspaceBillingSummary["self_service_subscription"],
  enterpriseRampUp: NonNullable<WorkspaceBillingSummary["enterprise_ramp_up"]>,
): WorkspaceBillingSummary {
  const { limits, ...activeEntitlement } = ENTERPRISE_RAMP_UP_ENTITLEMENT;
  return {
    workspace_id: workspace.id,
    billing_state: "active",
    active_entitlement: activeEntitlement,
    credits: {
      included_available: 0,
      purchased_available: 0,
      total_available: 0,
    },
    current_period: {
      anchor: period.anchor,
      start: period.start,
      end: period.end,
      monthly_page_limit: null,
      pages_used: 0,
      pages_remaining: null,
    },
    plan_limits: limits,
    billing_operational_status: {
      status: "active",
      blocking_reasons: [],
    },
    next_scheduled_entitlement: null,
    self_service_subscription: selfServiceSubscription,
    enterprise_ramp_up: enterpriseRampUp,
    payment_controls: [],
  };
}

function summarizeWorkspaceBillingForEnterpriseAnnual(
  workspace: Workspace,
  period: { anchor: string; start: string; end: string },
  selfServiceSubscription: WorkspaceBillingSummary["self_service_subscription"],
  enterpriseAnnual: NonNullable<WorkspaceBillingSummary["enterprise_annual_commitment"]>,
): WorkspaceBillingSummary {
  const { limits, ...activeEntitlement } = ENTERPRISE_ANNUAL_ENTITLEMENT;
  return {
    workspace_id: workspace.id,
    billing_state: "active",
    active_entitlement: activeEntitlement,
    credits: {
      included_available: 0,
      purchased_available: 0,
      total_available: 0,
    },
    current_period: {
      anchor: period.anchor,
      start: period.start,
      end: period.end,
      monthly_page_limit: null,
      pages_used: 0,
      pages_remaining: null,
    },
    plan_limits: limits,
    billing_operational_status: {
      status: "active",
      blocking_reasons: [],
    },
    next_scheduled_entitlement: null,
    self_service_subscription: selfServiceSubscription,
    enterprise_annual_commitment: enterpriseAnnual,
    payment_controls: [],
  };
}

function resolveActivePlanOverride(
  control: WorkspaceBillingControl | null,
  now: Date,
): { plan: "free" | "pro" | "max"; startAt: string; endAt: string; fallbackPlan: "free" | "pro" | "max" } | null {
  const plan = control?.plan_override_plan;
  if (plan !== "free" && plan !== "pro" && plan !== "max") {
    return null;
  }
  const startAt = normalizeIsoDate(control?.plan_override_start_at);
  const endAt = normalizeIsoDate(control?.plan_override_end_at);
  if (!startAt || !endAt) {
    return null;
  }
  const nowTime = now.getTime();
  if (nowTime < new Date(startAt).getTime() || nowTime >= new Date(endAt).getTime()) {
    return null;
  }
  return {
    plan,
    startAt,
    endAt,
    fallbackPlan: resolveSelfServiceSubscription(control)?.plan ?? "free",
  };
}

function resolveSelfServiceSubscription(
  control: WorkspaceBillingControl | null,
): WorkspaceBillingSummary["self_service_subscription"] {
  const plan = control?.self_service_subscription_plan;
  if (plan !== "pro" && plan !== "max") {
    return null;
  }
  const status = String(control?.self_service_subscription_status || "").trim();
  const currentPeriodStart = normalizeIsoDate(control?.stripe_subscription_current_period_start);
  const currentPeriodEnd = normalizeIsoDate(control?.stripe_subscription_current_period_end);
  if (!status || !currentPeriodStart || !currentPeriodEnd) {
    return null;
  }
  return {
    plan,
    status,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    invoice: resolveSelfServiceSubscriptionInvoice(control),
  };
}

function resolveSelfServiceSubscriptionInvoice(
  control: WorkspaceBillingControl | null,
): NonNullable<WorkspaceBillingSummary["self_service_subscription"]>["invoice"] {
  const hostedInvoiceUrl = String(control?.self_service_subscription_hosted_invoice_url || "").trim();
  if (!hostedInvoiceUrl) {
    return null;
  }
  return {
    status: String(control?.self_service_subscription_invoice_status || "").trim() || null,
    hosted_invoice_url: hostedInvoiceUrl,
  };
}

function summarizeWorkspaceBillingForPlan(
  workspace: Workspace,
  plan: BillingPlan,
  period: { anchor: string; start: string; end: string },
  selfServiceSubscription: WorkspaceBillingSummary["self_service_subscription"],
  nextScheduledEntitlement: WorkspaceBillingSummary["next_scheduled_entitlement"],
  billingState: WorkspaceBillingSummary["billing_state"],
  enterpriseRampUp: WorkspaceBillingSummary["enterprise_ramp_up"] = null,
  enterpriseAnnual: WorkspaceBillingSummary["enterprise_annual_commitment"] = null,
): WorkspaceBillingSummary {
  const { limits, monthly_price: _monthlyPrice, ...activeEntitlement } = plan;

  return {
    workspace_id: workspace.id,
    billing_state: billingState,
    active_entitlement: activeEntitlement,
    credits: {
      included_available: 0,
      purchased_available: 0,
      total_available: 0,
    },
    current_period: {
      anchor: period.anchor,
      start: period.start,
      end: period.end,
      monthly_page_limit: plan.limits.monthly_pages,
      pages_used: 0,
      pages_remaining: plan.limits.monthly_pages,
    },
    plan_limits: {
      ...limits,
      members: limits.members ?? Number.POSITIVE_INFINITY,
    },
    billing_operational_status: {
      status: "active",
      blocking_reasons: [],
    },
    next_scheduled_entitlement: nextScheduledEntitlement,
    self_service_subscription: selfServiceSubscription,
    ...(enterpriseRampUp ? { enterprise_ramp_up: enterpriseRampUp } : {}),
    ...(enterpriseAnnual ? { enterprise_annual_commitment: enterpriseAnnual } : {}),
    payment_controls: [],
  };
}

function resolveEnterpriseRampUp(
  control: WorkspaceBillingControl | null,
  now: Date,
): WorkspaceBillingSummary["enterprise_ramp_up"] {
  const status = String(control?.enterprise_ramp_up_status || "").trim();
  if (!status) {
    return null;
  }
  const durationMonths = Number(control?.enterprise_ramp_up_duration_months || 0);
  const cycleStart = normalizeIsoDate(control?.enterprise_billing_cycle_start_date);
  if (!Number.isInteger(durationMonths) || durationMonths <= 0 || !cycleStart) {
    return null;
  }
  const startsAt = cycleStart;
  const endsAt = addMonths(new Date(startsAt), durationMonths).toISOString();
  const nowTime = now.getTime();
  const effectiveStatus = status === "active" &&
    (nowTime < new Date(startsAt).getTime() || nowTime >= new Date(endsAt).getTime())
    ? "expired"
    : status;
  return {
    status: effectiveStatus,
    duration_months: durationMonths,
    enterprise_billing_cycle_start_date: cycleStart,
    starts_at: startsAt,
    ends_at: endsAt,
    collection_mode: control?.enterprise_ramp_up_collection_mode === "automatic" ? "automatic" : "manual",
    invoice_review_enabled: control?.enterprise_ramp_up_invoice_review_enabled === true ||
      Number(control?.enterprise_ramp_up_invoice_review_enabled || 0) === 1,
    reason: control?.enterprise_ramp_up_reason ?? null,
    created_by_user_id: control?.enterprise_ramp_up_created_by_user_id ?? null,
    created_at: normalizeIsoDate(control?.enterprise_ramp_up_created_at),
    latest_invoice: resolveEnterpriseRampUpLatestInvoice(control),
  };
}

function resolveEnterpriseRampUpLatestInvoice(
  control: WorkspaceBillingControl | null,
): NonNullable<WorkspaceBillingSummary["enterprise_ramp_up"]>["latest_invoice"] {
  const periodStart = normalizeIsoDate(control?.enterprise_ramp_up_last_invoice_period_start);
  const periodEnd = normalizeIsoDate(control?.enterprise_ramp_up_last_invoice_period_end);
  if (!periodStart || !periodEnd) {
    return null;
  }
  return {
    period_start: periodStart,
    period_end: periodEnd,
    status: String(control?.enterprise_ramp_up_last_invoice_status || "").trim() || null,
    hosted_invoice_url: String(control?.enterprise_ramp_up_last_invoice_hosted_url || "").trim() || null,
  };
}

function resolveEnterpriseAnnualCommitment(
  control: WorkspaceBillingControl | null,
  now: Date,
): WorkspaceBillingSummary["enterprise_annual_commitment"] {
  const status = String(control?.enterprise_annual_status || "").trim();
  if (!status) {
    return null;
  }
  const monthlyMinimumAllowance = Number(control?.enterprise_annual_monthly_minimum_allowance || 0);
  const perPagePriceMinor = Number(control?.enterprise_annual_per_page_price_minor || 0);
  const yearlyAmountMinor = Number(control?.enterprise_annual_yearly_amount_minor || 0);
  const cycleStart = normalizeIsoDate(control?.enterprise_billing_cycle_start_date);
  if (
    !Number.isInteger(monthlyMinimumAllowance) ||
    monthlyMinimumAllowance <= 0 ||
    !Number.isInteger(perPagePriceMinor) ||
    perPagePriceMinor <= 0 ||
    !Number.isInteger(yearlyAmountMinor) ||
    yearlyAmountMinor <= 0 ||
    !cycleStart
  ) {
    return null;
  }

  const startsAt = cycleStart;
  const endsAt = addMonths(new Date(startsAt), 12).toISOString();
  const nowTime = now.getTime();
  const effectiveStatus = status === "active" &&
    (nowTime < new Date(startsAt).getTime() || nowTime >= new Date(endsAt).getTime())
    ? "expired"
    : status;

  return {
    status: effectiveStatus,
    monthly_minimum_allowance: monthlyMinimumAllowance,
    per_page_price: formatGbpAmount(perPagePriceMinor),
    yearly_amount: formatGbpAmount(yearlyAmountMinor),
    enterprise_billing_cycle_start_date: cycleStart,
    starts_at: startsAt,
    ends_at: endsAt,
    collection_mode: control?.enterprise_annual_collection_mode === "automatic" ? "automatic" : "manual",
    invoice_review_enabled: control?.enterprise_annual_invoice_review_enabled === true ||
      Number(control?.enterprise_annual_invoice_review_enabled || 0) === 1,
    reason: control?.enterprise_annual_reason ?? null,
    created_by_user_id: control?.enterprise_annual_created_by_user_id ?? null,
    created_at: normalizeIsoDate(control?.enterprise_annual_created_at),
    upfront_invoice: {
      status: String(control?.enterprise_annual_upfront_invoice_status || "").trim() || null,
      hosted_invoice_url: String(control?.enterprise_annual_upfront_invoice_hosted_url || "").trim() || null,
      paid_at: normalizeIsoDate(control?.enterprise_annual_upfront_invoice_paid_at),
    },
    latest_overage_invoice: resolveEnterpriseAnnualLatestOverageInvoice(control),
  };
}

function resolveEnterpriseAnnualLatestOverageInvoice(
  control: WorkspaceBillingControl | null,
): NonNullable<WorkspaceBillingSummary["enterprise_annual_commitment"]>["latest_overage_invoice"] {
  const periodStart = normalizeIsoDate(control?.enterprise_annual_last_overage_invoice_period_start);
  const periodEnd = normalizeIsoDate(control?.enterprise_annual_last_overage_invoice_period_end);
  if (!periodStart || !periodEnd) {
    return null;
  }
  return {
    period_start: periodStart,
    period_end: periodEnd,
    status: String(control?.enterprise_annual_last_overage_invoice_status || "").trim() || null,
    hosted_invoice_url: String(control?.enterprise_annual_last_overage_invoice_hosted_url || "").trim() || null,
  };
}

function resolveUnpaidSelfServicePlan(
  control: WorkspaceBillingControl | null,
): {
  plan: "pro" | "max";
  status: "unpaid";
  currentPeriodStart: string;
  currentPeriodEnd: string;
} | null {
  const plan = control?.self_service_subscription_plan;
  if (plan !== "pro" && plan !== "max") {
    return null;
  }
  const status = String(control?.self_service_subscription_status || "").trim();
  if (status !== "unpaid") {
    return null;
  }
  const currentPeriodStart = normalizeIsoDate(control?.stripe_subscription_current_period_start);
  const currentPeriodEnd = normalizeIsoDate(control?.stripe_subscription_current_period_end);
  if (!currentPeriodStart || !currentPeriodEnd) {
    return null;
  }

  return {
    plan,
    status: "unpaid",
    currentPeriodStart,
    currentPeriodEnd,
  };
}

function resolveNextScheduledEntitlement(
  control: WorkspaceBillingControl | null,
): WorkspaceBillingSummary["next_scheduled_entitlement"] {
  const plan = control?.scheduled_entitlement_plan;
  const effectiveAt = normalizeIsoDate(control?.scheduled_entitlement_effective_at);
  if (!plan || !effectiveAt) {
    return null;
  }
  const planDefinition = NON_ENTERPRISE_BILLING_PLANS[plan];
  if (!planDefinition) {
    return null;
  }
  return {
    plan,
    display_name: planDefinition.display_name,
    effective_at: effectiveAt,
  };
}

function getFreeBillingPeriodAnchor(
  workspace: Workspace,
  control: WorkspaceBillingControl | null,
  now: Date,
): string {
  const latestStripePeriodEnd = normalizeIsoDate(control?.stripe_subscription_current_period_end);
  const scheduledEffectiveAt = normalizeIsoDate(control?.scheduled_entitlement_effective_at);
  if (
    control?.scheduled_entitlement_plan === "free" &&
    latestStripePeriodEnd &&
    now.getTime() >= new Date(latestStripePeriodEnd).getTime() &&
    (!scheduledEffectiveAt || now.getTime() >= new Date(scheduledEffectiveAt).getTime())
  ) {
    return latestStripePeriodEnd;
  }
  return workspace.created_at;
}

function resolveActiveSelfServicePlan(
  control: WorkspaceBillingControl | null,
  now: Date,
): {
  plan: "pro" | "max";
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
} | null {
  const plan = control?.self_service_subscription_plan;
  if (plan !== "pro" && plan !== "max") {
    return null;
  }
  const status = String(control?.self_service_subscription_status || "").trim();
  if (status !== "active") {
    return null;
  }
  const currentPeriodStart = normalizeIsoDate(control?.stripe_subscription_current_period_start);
  const currentPeriodEnd = normalizeIsoDate(control?.stripe_subscription_current_period_end);
  if (!currentPeriodStart || !currentPeriodEnd) {
    return null;
  }
  if (now.getTime() >= new Date(currentPeriodEnd).getTime()) {
    return null;
  }

  return {
    plan,
    status,
    currentPeriodStart,
    currentPeriodEnd,
  };
}

function normalizeIsoDate(value: unknown): string | null {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function formatGbpAmount(amountMinor: number): BillingCatalogPrice {
  return {
    currency: "GBP",
    amount_minor: amountMinor,
    display: `GBP ${(amountMinor / 100).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    tax_behavior: "exclusive",
  };
}

export function summarizeTemplatePlanLimitUsage(
  templateId: string,
  fields: FieldDefinition[],
): TemplatePlanLimitUsage {
  const tableShapedFields = fields.filter((field) => isTableShapedField(field)).length;
  const maxTableColumnsPerField = fields.reduce((maxColumns, field) => {
    if (!isTableShapedField(field)) {
      return maxColumns;
    }
    return Math.max(maxColumns, extractObjectSchemaColumnCount(field.description));
  }, 0);

  return {
    template_id: templateId,
    top_level_template_fields: fields.length,
    table_shaped_fields: tableShapedFields,
    max_table_columns_per_field: maxTableColumnsPerField,
  };
}

function isTableShapedField(field: FieldDefinition): boolean {
  return field.data_type === "object" || field.data_type === "array<object>";
}

function extractObjectSchemaColumnCount(description: string): number {
  const match = String(description || "").match(
    /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/,
  );
  if (!match?.[1]) {
    return 0;
  }

  try {
    const parsed = JSON.parse(match[1]) as { columns?: unknown };
    return Array.isArray(parsed.columns) ? parsed.columns.length : 0;
  } catch {
    return 0;
  }
}

function getCurrentBillingPeriod(anchorIso: string, now: Date, capEndIso?: string): { anchor: string; start: string; end: string } {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Workspace creation time is invalid");
  }

  let start = new Date(anchor);
  while (addMonths(start, 1).getTime() <= now.getTime()) {
    start = addMonths(start, 1);
  }

  const uncappedEnd = addMonths(start, 1);
  const capEnd = normalizeIsoDate(capEndIso);
  const end = capEnd && new Date(capEnd).getTime() < uncappedEnd.getTime()
    ? new Date(capEnd)
    : uncappedEnd;

  return {
    anchor: anchor.toISOString(),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function addMonths(value: Date, months: number): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
