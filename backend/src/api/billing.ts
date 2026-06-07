import { HttpError, json } from "../lib/http";
import { getWorkspaceBillingAuthorityForSession } from "../lib/workspaceBillingAuthority";
import { getWorkspaceBillingControl } from "../lib/workspaceBillingControl";
import {
  NON_ENTERPRISE_BILLING_PLANS,
  summarizeWorkspaceBilling,
  type WorkspaceBillingControl,
} from "../lib/workspaceBilling";
import {
  reconcileActivePlanOverrideIncludedCredits,
  type IncludedCreditGrantLedger,
} from "../lib/workspaceBillingIncludedCredits";
import {
  getWorkspaceProductStore,
  type WorkspaceContextInvalidationReason,
  type WorkspaceProductStoreRpc,
} from "../lib/workspaceProductStoreClient";
import type { Workspace } from "../lib/types";

const OWNER_BILLING_ACTIVITY_PAGE_SIZE = 5;
const DEFAULT_OWNER_BILLING_USAGE_RANGE: OwnerBillingUsageRange = "daily";
const OWNER_BILLING_USAGE_RANGES = new Set(["daily", "weekly", "monthly", "yearly"]);
const STRIPE_API_VERSION = "2026-05-27.dahlia";
const STRIPE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const SUPPORTED_STRIPE_BILLING_WEBHOOK_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.finalized",
  "invoice.finalization_failed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_action_required",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

type OwnerBillingActivityCursor = {
  occurred_at: string;
  id: string;
};

type OwnerBillingActivity = {
  id: string;
  type: string;
  occurred_at: string;
  credits: number;
  description: string;
  extraction_job_id?: string;
  billable_document_pages?: number;
  amount?: {
    currency: "GBP";
    amount_minor: number;
    display: string;
    tax_behavior: "exclusive";
  };
  invoice?: {
    status: string | null;
    hosted_invoice_url: string | null;
  };
  invoice_status?: string;
};

type OwnerBillingUsageRange = "daily" | "weekly" | "monthly" | "yearly";

type PaidSubscriptionInvoiceBillingAction =
  | "subscription_start"
  | "subscription_upgrade"
  | "subscription_renewal"
  | "subscription_downgrade";

const PAID_SUBSCRIPTION_INVOICE_BILLING_ACTIONS = new Set<PaidSubscriptionInvoiceBillingAction>([
  "subscription_start",
  "subscription_upgrade",
  "subscription_renewal",
  "subscription_downgrade",
]);

type OwnerBillingUsageSeries = {
  range: OwnerBillingUsageRange;
  total_credits: number;
  total_billable_document_pages: number;
  buckets: Array<{
    label: string;
    start_at: string;
    end_at: string;
    credits: number;
    billable_document_pages: number;
  }>;
};

type ApplicationAdminSession = {
  id: string;
  email: string;
  name: string;
  role?: string;
};

type BillingSession = {
  id: string;
  email: string;
  name: string;
};

type BillingLedgerRpc = IncludedCreditGrantLedger & {
  grantGoodwillCredits(input: {
    workspaceId: string;
    credits: number;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<{
    grant_id: string;
    workspace_id: string;
    granted_credits: number;
    available_credits: number;
  }>;
  summarizeOwnerBilling(input?: {
    billingPeriodStart: string;
    billingPeriodEnd: string;
    monthlyPageLimit: number | null;
    activityLimit?: number;
    activityCursor?: OwnerBillingActivityCursor | null;
    usageRange?: OwnerBillingUsageRange;
  }): Promise<{
    credits: {
      included_available: number;
      purchased_available: number;
      goodwill_available: number;
      total_available: number;
    };
    current_period?: {
      pages_used: number;
      pages_remaining: number | null;
    };
    owner_billing_activity: OwnerBillingActivity[];
    owner_billing_activity_next_cursor?: OwnerBillingActivityCursor | null;
    credit_usage?: OwnerBillingUsageSeries;
  }>;
  listOwnerBillingActivity(input: {
    limit: number;
    cursor?: OwnerBillingActivityCursor | null;
  }): Promise<{
    owner_billing_activity: OwnerBillingActivity[];
    next_cursor: OwnerBillingActivityCursor | null;
  }>;
  summarizeCreditUsage(input: {
    range: OwnerBillingUsageRange;
  }): Promise<OwnerBillingUsageSeries>;
  revokeGoodwillCreditGrant(input: {
    workspaceId: string;
    grantId: string;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<{
    entry_id?: string;
    revocation_id: string;
    grant_id: string;
    workspace_id: string;
    revoked_credits: number;
    available_credits: number;
  }>;
  grantPurchasedCredits(input: {
    workspaceId: string;
    credits: number;
    stripeEventId: string;
    checkoutSessionId?: string | null;
    stripeInvoiceId?: string | null;
    stripeInvoiceStatus?: string | null;
    hostedInvoiceUrl?: string | null;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<{
    grant_id: string;
    workspace_id: string;
    granted_credits: number;
    available_credits: number;
  }>;
  recordCreditPackPaymentFailed(input: {
    workspaceId: string;
    stripeEventId: string;
    checkoutSessionId: string;
    stripeInvoiceId?: string | null;
    stripeInvoiceStatus?: string | null;
    hostedInvoiceUrl?: string | null;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<{
    entry_id: string;
    workspace_id: string;
  }>;
  grantIncludedCredits(input: {
    workspaceId: string;
    credits: number;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    idempotencyKey: string;
    occurredAt: string;
    stripeInvoiceId?: string | null;
    stripeInvoiceStatus?: string | null;
    hostedInvoiceUrl?: string | null;
  }): Promise<{
    grant_id: string;
    workspace_id: string;
    granted_credits: number;
    available_credits: number;
  }>;
  summarizeEnterpriseUsageCharges(input: {
    billingPeriodStart: string;
    billingPeriodEnd: string;
  }): Promise<{
    billable_document_pages: number;
    amount: {
      currency: "GBP";
      amount_minor: number;
      display: string;
      tax_behavior: "exclusive";
    };
  }>;
};

type ApplicationAdminBillingAuditEntry = {
  id: string;
  workspace_id: string;
  action:
    | "goodwill_credit_grant"
    | "goodwill_credit_revocation"
    | "plan_override_created"
    | "no_billing_mode_updated"
    | "payment_required_plan_override_created"
    | "payment_required_plan_override_payment_updated"
    | "enterprise_ramp_up_assigned"
    | "enterprise_annual_commitment_created";
  actor_user_id: string;
  actor_name?: string | null;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  occurred_at: string;
};

type PlanOverrideResponse = {
  workspace_id: string;
  plan_override: {
    plan: "free" | "pro" | "max";
    display_name: "Free" | "Pro" | "Max";
    start_at: string;
    end_at: string;
    reason: string;
    created_by_user_id: string;
  };
  included_credit_grant: {
    granted_credits: number;
    available_credits: number;
  } | null;
};

type NoBillingModeResponse = {
  workspace_id: string;
  no_billing_mode: {
    enabled: boolean;
    reason: string;
    updated_by_user_id: string;
    updated_at: string;
  };
  active_entitlement: {
    plan: string;
    display_name: string;
  };
};

type PaymentRequiredPlanOverrideResponse = {
  workspace_id: string;
  payment_required_plan_override: PaymentRequiredPlanOverrideState;
};

type EnterpriseRampUpState = {
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
};

type EnterpriseRampUpResponse = {
  workspace_id: string;
  enterprise_ramp_up: EnterpriseRampUpState;
  active_entitlement: {
    plan: string;
    display_name: string;
  };
};

type EnterpriseAnnualCommitmentState = {
  status: string;
  monthly_minimum_allowance: number;
  per_page_price: {
    currency: "GBP";
    amount_minor: number;
    display: string;
    tax_behavior: "exclusive";
  };
  yearly_amount: {
    currency: "GBP";
    amount_minor: number;
    display: string;
    tax_behavior: "exclusive";
  };
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
};

type EnterpriseAnnualCommitmentResponse = {
  workspace_id: string;
  enterprise_annual_commitment: EnterpriseAnnualCommitmentState;
  active_entitlement: {
    plan: string;
    display_name: string;
  };
};

type EnterpriseRampUpInvoicePeriod = {
  start: string;
  end: string;
};

type EnterpriseRampUpInvoiceCandidate = {
  workspaceId: string;
  workspaceName: string | null;
  stripeCustomerId: string | null;
  durationMonths: number;
  cycleStart: string;
  collectionMode: "automatic" | "manual";
  invoiceReviewEnabled: boolean;
  lastInvoicePeriodEnd: string | null;
};

type EnterpriseAnnualOverageInvoiceCandidate = {
  workspaceId: string;
  workspaceName: string | null;
  stripeCustomerId: string | null;
  monthlyMinimumAllowance: number;
  perPagePriceMinor: number;
  cycleStart: string;
  collectionMode: "automatic" | "manual";
  invoiceReviewEnabled: boolean;
  lastInvoicePeriodEnd: string | null;
};

type BillingReconciliationCandidate = {
  workspaceId: string;
  workspaceName: string | null;
  stripeCustomerId: string | null;
};

type BillingReconciliationDriftRecord = {
  id: string;
  workspace_id: string;
  drift_type: string;
  severity: "needs_review" | "warning";
  actionability: "manual_review" | "informational";
  related_stripe_object_id: string | null;
  observed: Record<string, unknown>;
  expected: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  status: "open" | "resolved";
};

type BillingReconciliationState = {
  last_checked_at: string | null;
  open_drift_count: number;
  drift_records: BillingReconciliationDriftRecord[];
};

type StripeEventDiagnostic = {
  event_id: string;
  type: string;
  outcome: "ignored" | "failed" | "payment_failed";
  workspace_id: string | null;
  related_stripe_object_id: string | null;
  failure_class: string | null;
  retry_guidance: string | null;
  manual_review_guidance: string | null;
  received_at: string;
};

type StripeEventDiagnosticsState = {
  ignored_event_count: number;
  failed_event_count: number;
  payment_failed_event_count: number;
  recent_events: StripeEventDiagnostic[];
};

type StripeCheckoutSession = {
  id: string;
  payment_status?: unknown;
  invoice?: unknown;
  metadata?: Record<string, unknown> | null;
};

type PaymentRequiredPlanOverrideState = {
  plan: "free" | "pro" | "max";
  display_name: "Free" | "Pro" | "Max";
  start_at: string | null;
  end_at: string | null;
  reason?: string | null;
  created_by_user_id?: string | null;
  created_at?: string | null;
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
};

export async function getWorkspaceBillingSummaryForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot read billing summaries");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can view billing summaries");
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const now = new Date();
  const summary = summarizeWorkspaceBilling(authority.workspace, control, now);
  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (ledger) {
    await reconcileActivePlanOverrideIncludedCredits({
      workspace: authority.workspace,
      control,
      ledger,
      now,
    });
  }
  const ledgerSummary = await ledger?.summarizeOwnerBilling({
    billingPeriodStart: summary.current_period.start,
    billingPeriodEnd: summary.current_period.end,
    monthlyPageLimit: summary.current_period.monthly_page_limit,
    activityLimit: OWNER_BILLING_ACTIVITY_PAGE_SIZE,
    usageRange: DEFAULT_OWNER_BILLING_USAGE_RANGE,
  });

  if (!ledgerSummary) {
    const paymentRequiredPlanOverride = buildPaymentRequiredPlanOverrideState(control);
    return json({
      ...summary,
      credits: {
        ...summary.credits,
        goodwill_available: 0,
      },
      ...(paymentRequiredPlanOverride ? { payment_required_plan_override: paymentRequiredPlanOverride } : {}),
      owner_billing_activity: [],
    });
  }
  const paymentRequiredPlanOverride = buildPaymentRequiredPlanOverrideState(control);

  return json({
    ...summary,
    credits: ledgerSummary.credits,
    current_period: {
      ...summary.current_period,
      pages_used: ledgerSummary.current_period?.pages_used ?? summary.current_period.pages_used,
      pages_remaining: ledgerSummary.current_period?.pages_remaining ?? summary.current_period.pages_remaining,
    },
    ...(paymentRequiredPlanOverride ? { payment_required_plan_override: paymentRequiredPlanOverride } : {}),
    owner_billing_activity: ledgerSummary.owner_billing_activity,
    owner_billing_activity_next_cursor: ledgerSummary.owner_billing_activity_next_cursor
      ? encodeOwnerBillingActivityCursor(ledgerSummary.owner_billing_activity_next_cursor)
      : null,
    credit_usage: ledgerSummary.credit_usage,
  });
}

export async function listWorkspaceBillingActivityForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot read billing activity");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can view billing activity");
  }

  const url = new URL(request.url);
  const cursor = parseOwnerBillingActivityCursor(
    url.searchParams.get("cursor") ?? url.searchParams.get("$cursor"),
  );
  const activityPage = await getWorkspaceBillingLedger(env, workspaceId)?.listOwnerBillingActivity({
    limit: OWNER_BILLING_ACTIVITY_PAGE_SIZE,
    cursor,
  });

  if (!activityPage) {
    return json({
      owner_billing_activity: [],
      owner_billing_activity_next_cursor: null,
    });
  }

  return json({
    owner_billing_activity: activityPage.owner_billing_activity,
    owner_billing_activity_next_cursor: activityPage.next_cursor
      ? encodeOwnerBillingActivityCursor(activityPage.next_cursor)
      : null,
  });
}

export async function getWorkspaceBillingUsageForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot read billing usage");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can view billing usage");
  }

  const url = new URL(request.url);
  const range = parseOwnerBillingUsageRange(url.searchParams.get("range"));
  const creditUsage = await getWorkspaceBillingLedger(env, workspaceId)?.summarizeCreditUsage({ range });

  return json({
    credit_usage: creditUsage || emptyOwnerBillingUsage(range),
  });
}

export async function startCreditPackCheckoutForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  session: BillingSession,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId: session.id });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can start billing Checkout");
  }

  const payload = await readJsonObject(request);
  const checkoutReturnOrigin = resolveStripeCheckoutReturnOrigin(request, env, payload.return_origin);
  const packSize = Number(payload.pack_size);
  if (![100, 500, 1000, 5000].includes(packSize)) {
    throw new HttpError(400, "invalid_credit_pack", "pack_size must be one of 100, 500, 1000, or 5000");
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const summary = summarizeWorkspaceBilling(authority.workspace, control);
  const plan = summary.active_entitlement.plan;
  if (plan !== "free" && plan !== "pro" && plan !== "max") {
    throw new HttpError(400, "credit_packs_unavailable", "Credit packs are unavailable for the current entitlement");
  }
  const planDefinition = NON_ENTERPRISE_BILLING_PLANS[plan];
  const creditPackAmountMinor = planDefinition.per_page_catalog_price.amount_minor * packSize;
  const stripeCustomerId = await getOrCreateStripeCustomerIdForWorkspace(env, {
    workspaceId,
    workspaceName: authority.workspace.name || "Workspace",
    ownerEmail: session.email,
  });

  const purchaseId = `credit_pack_${crypto.randomUUID()}`;
  const checkoutSession = await createStripeCheckoutSession(env, {
    workspaceId,
    stripeCustomerId,
    plan,
    packSize,
    amountMinor: creditPackAmountMinor,
    returnOrigin: checkoutReturnOrigin,
    purchaseId,
    idempotencyKey: `credit-pack-checkout:${workspaceId}:${plan}:${packSize}:${purchaseId}`,
  });

  return json({
    checkout_session_id: checkoutSession.id,
    url: checkoutSession.url,
  });
}

export async function startSubscriptionCheckoutForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  session: BillingSession,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId: session.id });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can start billing Checkout");
  }

  const payload = await readJsonObject(request);
  const checkoutReturnOrigin = resolveStripeCheckoutReturnOrigin(request, env, payload.return_origin);
  const plan = String(payload.plan || "").trim().toLowerCase();
  if (plan !== "pro" && plan !== "max") {
    throw new HttpError(400, "invalid_subscription_plan", "plan must be pro or max");
  }

  const priceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const stripeCustomerId = await getOrCreateStripeCustomerIdForWorkspace(env, {
    workspaceId,
    workspaceName: authority.workspace.name || "Workspace",
    ownerEmail: session.email,
  });

  const checkoutSession = await createStripeSubscriptionCheckoutSession(env, {
    workspaceId,
    stripeCustomerId,
    priceId,
    plan,
    returnOrigin: checkoutReturnOrigin,
    idempotencyKey: `subscription-checkout:${workspaceId}:${plan}:${crypto.randomUUID()}`,
  });

  return json({
    checkout_session_id: checkoutSession.id,
    url: checkoutSession.url,
  });
}

export async function startSubscriptionChangeForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  session: BillingSession,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId: session.id });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can start billing Checkout");
  }

  const payload = await readJsonObject(request);
  const targetPlan = normalizeSubscriptionChangePlan(String(payload.plan || "").trim().toLowerCase());
  if (!targetPlan) {
    throw new HttpError(400, "invalid_subscription_plan", "plan must be pro, max, or free");
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const summary = summarizeWorkspaceBilling(authority.workspace, control);
  const activeSubscription = summary.self_service_subscription;
  const currentPlan = activeSubscription?.plan || null;
  if (
    activeSubscription &&
    summary.active_entitlement.plan === "free" &&
    targetPlan === currentPlan
  ) {
    await clearActiveFreePlanOverrideForPaidSubscription(env.DB, {
      workspaceId,
      now: new Date().toISOString(),
    });
    await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");
    return json({
      subscription_id: String(control?.stripe_subscription_id || "").trim(),
      target_plan: targetPlan,
    });
  }

  if (targetPlan === "free") {
    if (!activeSubscription) {
      throw new HttpError(400, "subscription_not_active", "Workspace does not have an active paid subscription");
    }
    const result = await scheduleFreeSubscriptionDowngrade(env, workspaceId, control, activeSubscription.current_period_end);
    return json(result);
  }

  if (activeSubscription && currentPlan === "max" && targetPlan === "pro") {
    const stripeSubscriptionId = String(control?.stripe_subscription_id || "").trim();
    const stripeSubscriptionItemId = String(control?.stripe_subscription_item_id || "").trim();
    if (!stripeSubscriptionId || !stripeSubscriptionItemId) {
      throw new HttpError(409, "subscription_change_unavailable", "Workspace subscription cannot be changed yet");
    }

    const subscription = await updateStripeSubscriptionForScheduledDowngrade(env, {
      workspaceId,
      stripeSubscriptionId,
      stripeSubscriptionItemId,
      targetPlan,
      priceId: getConfiguredStripePriceId(env, "STRIPE_PRO_MONTHLY_PRICE_ID"),
      idempotencyKey: `subscription-change:${workspaceId}:${currentPlan}:${targetPlan}:${crypto.randomUUID()}`,
    });
    const effectiveAt = activeSubscription.current_period_end;
    await storeWorkspaceScheduledEntitlement(env.DB, {
      workspaceId,
      plan: targetPlan,
      effectiveAt,
      now: new Date().toISOString(),
    });
    await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

    return json({
      subscription_id: subscription.id,
      scheduled_plan: targetPlan,
      effective_at: effectiveAt,
    });
  }

  if (currentPlan !== "pro" || targetPlan !== "max") {
    throw new HttpError(400, "unsupported_subscription_change", "Only Pro to Max upgrades are supported");
  }

  const stripeSubscriptionId = String(control?.stripe_subscription_id || "").trim();
  const stripeSubscriptionItemId = String(control?.stripe_subscription_item_id || "").trim();
  if (!stripeSubscriptionId || !stripeSubscriptionItemId) {
    throw new HttpError(409, "subscription_change_unavailable", "Workspace subscription cannot be changed yet");
  }

  const priceId = getConfiguredStripePriceId(env, "STRIPE_MAX_MONTHLY_PRICE_ID");
  const subscription = await updateStripeSubscriptionForPlanChange(env, {
    workspaceId,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    targetPlan,
    priceId,
    idempotencyKey: `subscription-change:${workspaceId}:${currentPlan}:${targetPlan}:${crypto.randomUUID()}`,
  });

  return json({
    subscription_id: subscription.id,
    target_plan: targetPlan,
    payment_url: subscription.payment_url,
  });
}

export async function scheduleSubscriptionCancellationForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  session: BillingSession,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId: session.id });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can start billing Checkout");
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const summary = summarizeWorkspaceBilling(authority.workspace, control);
  if (!summary.self_service_subscription) {
    throw new HttpError(400, "subscription_not_active", "Workspace does not have an active paid subscription");
  }

  return json(await scheduleFreeSubscriptionDowngrade(
    env,
    workspaceId,
    control,
    summary.self_service_subscription.current_period_end,
  ));
}

export async function cancelScheduledSubscriptionChangeForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  session: BillingSession,
): Promise<Response> {
  if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
    throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot cancel scheduled billing changes");
  }

  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId: session.id });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only Workspace owners can cancel scheduled billing changes");
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const summary = summarizeWorkspaceBilling(authority.workspace, control);
  const scheduledPlan = summary.next_scheduled_entitlement?.plan || null;
  if (!scheduledPlan) {
    throw new HttpError(400, "scheduled_change_not_found", "Workspace does not have a scheduled subscription change");
  }

  const stripeSubscriptionId = String(control?.stripe_subscription_id || "").trim();
  const stripeSubscriptionItemId = String(control?.stripe_subscription_item_id || "").trim();
  if (!stripeSubscriptionId) {
    throw new HttpError(409, "subscription_change_unavailable", "Workspace subscription cannot be changed yet");
  }

  let subscription: { id: string };
  if (scheduledPlan === "free") {
    subscription = await updateStripeSubscriptionScheduledCancellationReversal(env, {
      workspaceId,
      stripeSubscriptionId,
      idempotencyKey: `subscription-scheduled-change-cancel:${workspaceId}:${scheduledPlan}:${crypto.randomUUID()}`,
    });
  } else {
    const activePlan = normalizeSubscriptionPlan(String(summary.active_entitlement.plan || "").trim().toLowerCase());
    if (!activePlan || !stripeSubscriptionItemId) {
      throw new HttpError(409, "subscription_change_unavailable", "Workspace subscription cannot be changed yet");
    }
    subscription = await updateStripeSubscriptionForScheduledChangeCancellation(env, {
      workspaceId,
      stripeSubscriptionId,
      stripeSubscriptionItemId,
      targetPlan: activePlan,
      priceId: getConfiguredStripePriceId(env, `STRIPE_${activePlan.toUpperCase()}_MONTHLY_PRICE_ID`),
      idempotencyKey: `subscription-scheduled-change-cancel:${workspaceId}:${scheduledPlan}:to:${activePlan}:${crypto.randomUUID()}`,
    });
  }

  await clearWorkspaceScheduledEntitlement(env.DB, {
    workspaceId,
    now: new Date().toISOString(),
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  return json({
    subscription_id: subscription.id,
    canceled_scheduled_plan: scheduledPlan,
    active_plan: summary.active_entitlement.plan,
  });
}

export async function handleStripeBillingWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get("stripe-signature")?.trim();
  if (!signature) {
    throw new HttpError(400, "stripe_signature_required", "Stripe webhook signature is required");
  }

  const payload = await request.text();
  await verifyStripeWebhookSignature(env, payload, signature);
  const event = parseStripeBillingEvent(payload);
  if (await hasProcessedStripeBillingEvent(env.DB, event.id)) {
    return json({ received: true });
  }

  const receivedAt = new Date().toISOString();
  let processingResult: StripeBillingEventProcessingResult;
  try {
    if (!SUPPORTED_STRIPE_BILLING_WEBHOOK_EVENT_TYPES.has(event.type)) {
      await recordProcessedStripeBillingEvent(env.DB, {
        eventId: event.id,
        type: event.type,
        workspaceId: getStripeEventWorkspaceId(event),
        relatedStripeObjectId: getStripeEventRelatedObjectId(event),
        processedStatus: "ignored",
        errorDetails: JSON.stringify({
          retry_guidance: "No retry needed; event type is not handled by Workspace billing.",
          manual_review_guidance: "No action required unless this event type becomes relevant to Workspace billing.",
        }),
        receivedAt,
      });
      return json({ received: true });
    }

    processingResult = await processSupportedStripeBillingEvent(env, event);
    if (processingResult.workspaceId) {
      await emitStripeBillingWorkspaceContextInvalidations(env, processingResult.workspaceId, processingResult);
    }
  } catch (error) {
    const failure = error instanceof HttpError
      ? error
      : new HttpError(500, "stripe_event_processing_failed", "Stripe billing event processing failed");
    await recordProcessedStripeBillingEvent(env.DB, {
      eventId: event.id,
      type: event.type,
      workspaceId: getStripeEventWorkspaceId(event),
      relatedStripeObjectId: getStripeEventRelatedObjectId(event),
      processedStatus: "failed",
      errorDetails: JSON.stringify({
        failure_class: failure.code,
        error_message: failure.message,
        retry_guidance: "Stripe can retry this event after the metadata, catalog, or Workspace billing state is repaired.",
        manual_review_guidance: "Review the Stripe object and reconcile Workspace billing manually if automatic replay cannot succeed.",
      }),
      receivedAt,
    });
    throw error;
  }
  await recordProcessedStripeBillingEvent(env.DB, {
    eventId: event.id,
    type: event.type,
    workspaceId: processingResult.workspaceId || null,
    relatedStripeObjectId: processingResult.relatedStripeObjectId || null,
    processedStatus: "processed",
    errorDetails: processingResult.diagnosticDetails
      ? JSON.stringify(processingResult.diagnosticDetails)
      : null,
    receivedAt,
  });

  return json({ received: true });
}

async function emitStripeBillingWorkspaceContextInvalidations(
  env: Env,
  workspaceId: string,
  processingResult: Pick<
    StripeBillingEventProcessingResult,
    "workspaceContextInvalidationReason" | "workspaceContextInvalidationReasons"
  >,
): Promise<void> {
  const invalidationReasons = processingResult.workspaceContextInvalidationReasons ||
    (processingResult.workspaceContextInvalidationReason ? [processingResult.workspaceContextInvalidationReason] : []);
  for (const reason of new Set(invalidationReasons)) {
    await emitBillingWorkspaceContextInvalidation(env, workspaceId, reason);
  }
}

async function processSupportedStripeBillingEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return processCreditPackCheckoutCompleted(env, event);
    case "checkout.session.async_payment_failed":
      return processCreditPackCheckoutAsyncPaymentFailed(env, event);
    case "invoice.finalized":
      return processFinalizedStripeInvoiceEvent(env, event);
    case "invoice.finalization_failed":
      return processFinalizationFailedStripeInvoiceEvent(env, event);
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return processPaidStripeInvoiceEvent(env, event);
    case "invoice.payment_action_required":
      return processPaymentActionRequiredStripeInvoiceEvent(env, event);
    case "invoice.payment_failed":
      return processFailedStripeInvoicePaymentEvent(env, event);
    case "invoice.voided":
      return processTerminalUnpaidStripeInvoiceEvent(env, event, "void");
    case "invoice.marked_uncollectible":
      return processTerminalUnpaidStripeInvoiceEvent(env, event, "uncollectible");
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return processStripeSubscriptionLifecycleEvent(env, event);
    default:
      return {};
  }
}

async function processStripeSubscriptionLifecycleEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const subscription = event.data.object;
  if (!subscription) {
    return {};
  }

  const metadata = getStripeSubscriptionMetadata(subscription);
  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizeSubscriptionPlan(String(metadata.plan || "").trim().toLowerCase());
  const subscriptionId = getStripeId(subscription.id);
  const stripeCustomerId = getStripeSubscriptionCustomerId(subscription);
  if (!workspaceId || !plan || !subscriptionId || !stripeCustomerId) {
    throw new HttpError(
      400,
      "invalid_subscription_lifecycle_event",
      "Stripe subscription lifecycle event metadata is incomplete",
    );
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const subscriptionItem = getStripeSubscriptionItemForPrice(subscription, expectedPriceId);
  if (event.type === "customer.subscription.created") {
    await recordSubscriptionLifecycleDrift(env.DB, {
      event,
      subscription,
      workspaceId,
      plan,
      stripeCustomerId,
      control,
      now: new Date(),
    });
    return { workspaceId, relatedStripeObjectId: subscriptionId };
  }

  if (
    String(control?.stripe_subscription_id || "").trim() !== subscriptionId ||
    String(control?.stripe_customer_id || "").trim() !== stripeCustomerId
  ) {
    await recordSubscriptionLifecycleDrift(env.DB, {
      event,
      subscription,
      workspaceId,
      plan,
      stripeCustomerId,
      control,
      now: new Date(),
    });
    return { workspaceId, relatedStripeObjectId: subscriptionId };
  }
  if (
    !subscriptionItem?.currentPeriodStart ||
    !subscriptionItem.currentPeriodEnd ||
    control?.self_service_subscription_plan !== plan ||
    (
      String(control?.stripe_subscription_item_id || "").trim() &&
      String(control?.stripe_subscription_item_id || "").trim() !== String(subscriptionItem.id || "").trim()
    )
  ) {
    await recordSubscriptionLifecycleDrift(env.DB, {
      event,
      subscription,
      workspaceId,
      plan,
      stripeCustomerId,
      control,
      now: new Date(),
    });
    return { workspaceId, relatedStripeObjectId: subscriptionId };
  }

  if (
    event.type === "customer.subscription.paused" ||
    event.type === "customer.subscription.resumed"
  ) {
    await recordSubscriptionLifecycleDrift(env.DB, {
      event,
      subscription,
      workspaceId,
      plan,
      stripeCustomerId,
      control,
      now: new Date(),
    });
    return { workspaceId, relatedStripeObjectId: subscriptionId };
  }

  if (event.type === "customer.subscription.deleted") {
    await storeWorkspaceSubscriptionActivation(env.DB, {
      workspaceId,
      stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionItemId: subscriptionItem.id,
      plan,
      status: "unpaid",
      currentPeriodStart: subscriptionItem.currentPeriodStart,
      currentPeriodEnd: subscriptionItem.currentPeriodEnd,
      now: new Date().toISOString(),
    });
    return {
      workspaceId,
      relatedStripeObjectId: subscriptionId,
      workspaceContextInvalidationReason: "billing_entitlement",
    };
  }

  const status = String(subscription.status || "").trim() === "active" ? "active" : null;
  if (!status) {
    return {};
  }

  await storeWorkspaceSubscriptionActivation(env.DB, {
    workspaceId,
    stripeCustomerId,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionItemId: subscriptionItem.id,
    plan,
    status,
    currentPeriodStart: subscriptionItem.currentPeriodStart,
    currentPeriodEnd: subscriptionItem.currentPeriodEnd,
    now: new Date().toISOString(),
  });

  if (
    event.type === "customer.subscription.updated" &&
    subscription.cancel_at_period_end === false &&
    control?.scheduled_entitlement_plan === "free"
  ) {
    await clearWorkspaceScheduledEntitlement(env.DB, {
      workspaceId,
      now: new Date().toISOString(),
    });
  }

  return {
    workspaceId,
    relatedStripeObjectId: subscriptionId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function recordSubscriptionLifecycleDrift(
  db: D1Database,
  input: {
    event: StripeBillingEvent;
    subscription: StripeInvoice;
    workspaceId: string;
    plan: "pro" | "max";
    stripeCustomerId: string;
    control: WorkspaceBillingControl | null;
    now: Date;
  },
): Promise<void> {
  const subscriptionId = getStripeId(input.subscription.id);
  if (!subscriptionId) {
    return;
  }
  const metadata = getStripeSubscriptionMetadata(input.subscription);
  const timestamp = input.now.toISOString();
  await recordBillingReconciliationDrift(db, {
    id: createBillingReconciliationDriftId(input.workspaceId, "subscription_lifecycle_drift", subscriptionId),
    workspace_id: input.workspaceId,
    drift_type: "subscription_lifecycle_drift",
    severity: "needs_review",
    actionability: "manual_review",
    related_stripe_object_id: subscriptionId,
    observed: {
      event_type: input.event.type,
      subscription_status: String(input.subscription.status || "").trim() || null,
      billing_action: String(metadata.billing_action || "").trim() || null,
      plan: input.plan,
      stripe_customer_id: input.stripeCustomerId,
    },
    expected: {
      workspace_id: input.workspaceId,
      app_owned_subscription_id: String(input.control?.stripe_subscription_id || "").trim() || null,
      plan: input.control?.self_service_subscription_plan ?? null,
    },
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    status: "open",
  });
}

async function processPaidStripeInvoiceEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  let processingResult = await processCreditPackInvoicePaid(env, event);
  if (!processingResult.workspaceId) {
    processingResult = await processPaymentRequiredPlanOverrideInvoicePaid(env, event);
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualUpfrontInvoicePaid(env, event);
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualOverageInvoicePaid(env, event);
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseRampUpInvoicePaid(env, event);
  }
  if (!processingResult.workspaceId) {
    processingResult = await processSubscriptionInvoicePaid(env, event);
  }
  return processingResult;
}

async function processFinalizedStripeInvoiceEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  let processingResult = await processPaymentRequiredPlanOverrideInvoiceStatusUpdated(
    env,
    event,
    String(event.data.object?.status || "").trim() || "open",
    "Payment-required Plan override invoice finalized",
  );
  if (!processingResult.workspaceId) {
    processingResult = await processSubscriptionManualCollectionInvoiceFinalized(env, event);
  }
  return processingResult;
}

async function processFinalizationFailedStripeInvoiceEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  let processingResult = await processPaymentRequiredPlanOverrideInvoiceStatusUpdated(
    env,
    event,
    "finalization_failed",
    "Payment-required Plan override invoice finalization failed",
  );
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualUpfrontInvoiceStatusUpdated(
      env,
      event,
      "finalization_failed",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualOverageInvoiceUnpaidState(
      env,
      event,
      "finalization_failed",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseRampUpInvoiceUnpaidState(
      env,
      event,
      "finalization_failed",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processSubscriptionInvoiceFinalizationFailed(env, event);
  }
  return processingResult;
}

async function processPaymentActionRequiredStripeInvoiceEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  let processingResult = await processPaymentRequiredPlanOverrideInvoiceStatusUpdated(
    env,
    event,
    "payment_action_required",
    "Payment-required Plan override invoice requires customer action",
  );
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualUpfrontInvoiceStatusUpdated(
      env,
      event,
      "payment_action_required",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualOverageInvoiceUnpaidState(
      env,
      event,
      "payment_action_required",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseRampUpInvoiceUnpaidState(
      env,
      event,
      "payment_action_required",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processSubscriptionInvoicePaymentActionRequired(env, event);
  }
  return processingResult;
}

async function processFailedStripeInvoicePaymentEvent(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  let processingResult = await processPaymentRequiredPlanOverrideInvoiceStatusUpdated(
    env,
    event,
    "payment_failed",
    "Payment-required Plan override invoice payment failed",
  );
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualUpfrontInvoiceStatusUpdated(
      env,
      event,
      "payment_failed",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualOverageInvoiceUnpaidState(
      env,
      event,
      "payment_failed",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseRampUpInvoiceUnpaidState(
      env,
      event,
      "payment_failed",
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processSubscriptionInvoicePaymentFailed(env, event);
  }
  return processingResult;
}

async function processTerminalUnpaidStripeInvoiceEvent(
  env: Env,
  event: StripeBillingEvent,
  invoiceStatus: string,
): Promise<StripeBillingEventProcessingResult> {
  let processingResult = await processPaymentRequiredPlanOverrideInvoiceStatusUpdated(
    env,
    event,
    invoiceStatus,
    "Payment-required Plan override invoice reached terminal unpaid state",
  );
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualUpfrontInvoiceStatusUpdated(
      env,
      event,
      invoiceStatus,
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseAnnualOverageInvoiceUnpaidState(
      env,
      event,
      invoiceStatus,
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processEnterpriseRampUpInvoiceUnpaidState(
      env,
      event,
      invoiceStatus,
    );
  }
  if (!processingResult.workspaceId) {
    processingResult = await processSubscriptionInvoiceTerminalUnpaidState(env, event, invoiceStatus);
  }
  return processingResult;
}

export async function generateEnterpriseRampUpInvoices(env: Env, now: Date = new Date()): Promise<void> {
  const candidates = await listEnterpriseRampUpInvoiceCandidates(env.DB);
  for (const candidate of candidates) {
    try {
      const period = getLatestClosedEnterpriseRampUpPeriod(candidate, now);
      if (!period || candidate.lastInvoicePeriodEnd === period.end) {
        continue;
      }

      const ledger = getWorkspaceBillingLedger(env, candidate.workspaceId);
      if (!ledger) {
        throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
      }
      const usage = await ledger.summarizeEnterpriseUsageCharges({
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
      });
      const billablePages = Number(usage.billable_document_pages || 0);
      if (billablePages <= 0) {
        continue;
      }

      const stripeCustomerId = candidate.stripeCustomerId || await getOrCreateStripeCustomerIdForWorkspace(env, {
        workspaceId: candidate.workspaceId,
        workspaceName: candidate.workspaceName || "Workspace",
        ownerEmail: await getWorkspaceOwnerEmail(env.DB, candidate.workspaceId) || "billing@example.invalid",
      });
      const idempotencyKey = `enterprise-ramp-up-invoice:${candidate.workspaceId}:${period.start}:${period.end}`;
      const invoice = await createStripeEnterpriseRampUpInvoice(env, {
        workspaceId: candidate.workspaceId,
        stripeCustomerId,
        periodStart: period.start,
        periodEnd: period.end,
        collectionMode: candidate.collectionMode,
        invoiceReviewEnabled: candidate.invoiceReviewEnabled,
        billableDocumentPages: billablePages,
        idempotencyKey,
      });
      await storeEnterpriseRampUpInvoiceState(env.DB, {
        workspaceId: candidate.workspaceId,
        periodStart: period.start,
        periodEnd: period.end,
        stripeInvoiceId: invoice.id,
        invoiceStatus: invoice.status,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        now: now.toISOString(),
      });
    } catch (error) {
      logScheduledBillingWorkspaceFailure({
        task: "enterprise_ramp_up_invoice_generation",
        workspaceId: candidate.workspaceId,
        scheduledAt: now,
        error,
      });
    }
  }
}

export async function generateEnterpriseAnnualOverageInvoices(env: Env, now: Date = new Date()): Promise<void> {
  const candidates = await listEnterpriseAnnualOverageInvoiceCandidates(env.DB);
  for (const candidate of candidates) {
    try {
      const period = getLatestClosedEnterpriseAnnualPeriod(candidate, now);
      if (!period || candidate.lastInvoicePeriodEnd === period.end) {
        continue;
      }

      const ledger = getWorkspaceBillingLedger(env, candidate.workspaceId);
      if (!ledger) {
        throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
      }
      const usage = await ledger.summarizeEnterpriseUsageCharges({
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
      });
      const billablePages = Number(usage.billable_document_pages || 0);
      const overagePages = Math.max(0, billablePages - candidate.monthlyMinimumAllowance);
      if (overagePages <= 0) {
        continue;
      }

      const stripeCustomerId = candidate.stripeCustomerId || await getOrCreateStripeCustomerIdForWorkspace(env, {
        workspaceId: candidate.workspaceId,
        workspaceName: candidate.workspaceName || "Workspace",
        ownerEmail: await getWorkspaceOwnerEmail(env.DB, candidate.workspaceId) || "billing@example.invalid",
      });
      const idempotencyKey = `enterprise-annual-overage-invoice:${candidate.workspaceId}:${period.start}:${period.end}`;
      const invoice = await createStripeEnterpriseAnnualOverageInvoice(env, {
        workspaceId: candidate.workspaceId,
        stripeCustomerId,
        periodStart: period.start,
        periodEnd: period.end,
        monthlyMinimumAllowance: candidate.monthlyMinimumAllowance,
        billableDocumentPages: billablePages,
        overagePages,
        perPagePriceMinor: candidate.perPagePriceMinor,
        amountMinor: overagePages * candidate.perPagePriceMinor,
        collectionMode: candidate.collectionMode,
        invoiceReviewEnabled: candidate.invoiceReviewEnabled,
        idempotencyKey,
      });
      await storeEnterpriseAnnualOverageInvoiceState(env.DB, {
        workspaceId: candidate.workspaceId,
        periodStart: period.start,
        periodEnd: period.end,
        stripeInvoiceId: invoice.id,
        invoiceStatus: invoice.status,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        now: now.toISOString(),
      });
    } catch (error) {
      logScheduledBillingWorkspaceFailure({
        task: "enterprise_annual_overage_invoice_generation",
        workspaceId: candidate.workspaceId,
        scheduledAt: now,
        error,
      });
    }
  }
}

export async function reconcileWorkspaceBilling(env: Env, now: Date = new Date()): Promise<void> {
  const candidates = await listBillingReconciliationCandidates(env.DB);
  for (const candidate of candidates) {
    try {
      if (!candidate.stripeCustomerId) {
        continue;
      }
      const controlBeforeReconciliation = await getWorkspaceBillingControl(env.DB, candidate.workspaceId);

      const checkoutSessions = await listStripeCheckoutSessionsForCustomer(env, candidate.stripeCustomerId);
      for (const checkoutSession of checkoutSessions) {
        await repairPaidCreditPackCheckoutSession(env, checkoutSession, now);
        await recordFailedCreditPackCheckoutSessionFromReconciliation(env, candidate, checkoutSession, now);
        await recordMissingProcessedStripeCheckoutSessionDrift(env.DB, candidate, checkoutSession, now);
      }

      const invoices = await listStripeInvoicesForCustomer(env, candidate.stripeCustomerId);
      for (const invoice of invoices) {
        await recordAmbiguousStripeInvoiceDrift(env.DB, candidate, invoice, now);
        await repairPaidCreditPackInvoice(env, invoice, now);
        await repairPaidPaymentRequiredPlanOverrideInvoice(env, invoice, now);
        await repairPaidEnterpriseAnnualUpfrontInvoice(env, invoice, now);
        await repairPaidEnterpriseAnnualOverageInvoice(env, invoice, now);
        await repairPaidEnterpriseRampUpInvoice(env, invoice, now);
        await repairPaidSubscriptionInvoice(env, invoice, now);
        await repairMissedUnpaidSubscriptionInvoice(env, invoice, now);
        const latestControl = await getWorkspaceBillingControl(env.DB, candidate.workspaceId);
        await recordKnownInvoiceStatusDrift(env.DB, candidate, latestControl, invoice, now);
        await recordMissingProcessedStripeInvoiceDrift(env.DB, candidate, invoice, now);
      }

      const latestControl = await getWorkspaceBillingControl(env.DB, candidate.workspaceId);
      if (
        String(controlBeforeReconciliation?.stripe_subscription_id || "").trim() ||
        controlBeforeReconciliation?.self_service_subscription_plan
      ) {
        const subscriptions = await listStripeSubscriptionsForCustomer(env, candidate.stripeCustomerId);
        for (const subscription of subscriptions) {
          await recordSubscriptionLifecycleDriftFromReconciliation(env.DB, env, candidate, latestControl, subscription, now);
        }
      }

      const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, candidate.workspaceId);
      await recordLedgerProjectionDrift(env, candidate, workspace, latestControl, now);

      await storeBillingReconciliationStatus(env.DB, {
        workspaceId: candidate.workspaceId,
        checkedAt: now.toISOString(),
      });
    } catch (error) {
      logScheduledBillingWorkspaceFailure({
        task: "billing_reconciliation",
        workspaceId: candidate.workspaceId,
        scheduledAt: now,
        error,
      });
    }
  }
}

function logScheduledBillingWorkspaceFailure(input: {
  task: string;
  workspaceId: string;
  scheduledAt: Date;
  error: unknown;
}): void {
  console.error("Scheduled billing Workspace failed", {
    event: "billing.scheduled.workspace_failed",
    task: input.task,
    workspace_id: input.workspaceId,
    scheduled_at: input.scheduledAt.toISOString(),
    error_code: input.error instanceof HttpError ? input.error.code : "unexpected_error",
    error_class: input.error instanceof Error ? input.error.name || "Error" : typeof input.error,
    actionability: "retry_or_manual_review",
  });
}

export async function grantGoodwillCreditsForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const credits = Number(payload.credits);
  const reason = String(payload.reason || "").trim();
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!Number.isInteger(credits) || credits <= 0) {
    throw new HttpError(400, "invalid_credits", "credits must be a positive integer");
  }
  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const ledgerObjectName = await ensureWorkspaceBillingControlRecord(env.DB, workspaceId, new Date().toISOString());
  const ledger = getWorkspaceBillingLedger(env, ledgerObjectName);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  const beforeSummary = await ledger.summarizeOwnerBilling();
  const occurredAt = new Date().toISOString();
  const result = await ledger.grantGoodwillCredits({
    workspaceId,
    credits,
    reason,
    actorUserId: session.id,
    idempotencyKey,
    occurredAt,
  });
  const afterSummary = await ledger.summarizeOwnerBilling();
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "goodwill_credit_grant",
    actor_user_id: session.id,
    reason,
    before: { total_available: beforeSummary.credits.total_available },
    after: { total_available: afterSummary.credits.total_available },
    occurred_at: occurredAt,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_usage");

  return json({
    grant_id: result.grant_id,
    workspace_id: result.workspace_id,
    granted_credits: result.granted_credits,
    available_credits: result.available_credits,
  }, 201);
}

async function emitBillingWorkspaceContextInvalidation(
  env: Env,
  workspaceId: string,
  reason: WorkspaceContextInvalidationReason,
): Promise<void> {
  const productStore = getWorkspaceProductStore(env, workspaceId);
  await emitBillingWorkspaceContextInvalidationToStore(productStore, reason);
}

async function emitBillingWorkspaceContextInvalidationToStore(
  productStore: Pick<WorkspaceProductStoreRpc, "broadcastWorkspaceContextInvalidation">,
  reason: WorkspaceContextInvalidationReason,
): Promise<void> {
  await productStore.broadcastWorkspaceContextInvalidation({
    reason,
    occurredAt: new Date().toISOString(),
  });
}

export async function revokeGoodwillCreditGrantForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  grantId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const reason = String(payload.reason || "").trim();
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const ledgerObjectName = await ensureWorkspaceBillingControlRecord(env.DB, workspaceId, new Date().toISOString());
  const ledger = getWorkspaceBillingLedger(env, ledgerObjectName);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  const beforeSummary = await ledger.summarizeOwnerBilling();
  const occurredAt = new Date().toISOString();
  const result = await ledger.revokeGoodwillCreditGrant({
    workspaceId,
    grantId,
    reason,
    actorUserId: session.id,
    idempotencyKey,
    occurredAt,
  });
  const afterSummary = await ledger.summarizeOwnerBilling();
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "goodwill_credit_revocation",
    actor_user_id: session.id,
    reason,
    before: { total_available: beforeSummary.credits.total_available },
    after: { total_available: afterSummary.credits.total_available },
    occurred_at: occurredAt,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_usage");

  return json({
    revocation_id: result.revocation_id,
    grant_id: result.grant_id,
    workspace_id: result.workspace_id,
    revoked_credits: result.revoked_credits,
    available_credits: result.available_credits,
  });
}

export async function searchApplicationAdminBillingWorkspaces(
  request: Request,
  env: Env,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const url = new URL(request.url);
  const workspaceId = String(url.searchParams.get("workspace_id") || "").trim();
  const ownerEmail = String(url.searchParams.get("owner_email") || "").trim().toLowerCase();

  if (!workspaceId && !ownerEmail) {
    throw new HttpError(400, "invalid_workspace_search", "workspace_id or owner_email is required");
  }

  if (ownerEmail && ownerEmail.length < 3) {
    throw new HttpError(400, "invalid_owner_email_search", "owner_email search must be at least 3 characters");
  }

  const workspaces = workspaceId
    ? await findApplicationAdminBillingWorkspaceById(env.DB, workspaceId)
    : await findApplicationAdminBillingWorkspacesByOwnerEmail(env.DB, ownerEmail);

  return json({ workspaces });
}

export async function getApplicationAdminWorkspaceBillingState(
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const summary = summarizeWorkspaceBilling(workspace, control);
  const auditEntries = await listApplicationAdminBillingAuditEntries(env.DB, workspaceId);
  const reconciliation = await getBillingReconciliationState(env.DB, workspaceId);
  const stripeEventDiagnostics = await getStripeEventDiagnosticsState(env.DB, workspaceId);

  return json({
    workspace_id: workspaceId,
    active_entitlement: summary.active_entitlement,
    current_period: summary.current_period,
    credits: summary.credits,
    plan_limits: summary.plan_limits,
    next_scheduled_entitlement: summary.next_scheduled_entitlement,
    self_service_subscription: summary.self_service_subscription,
    plan_override: buildPlanOverrideState(control),
    payment_required_plan_override: buildPaymentRequiredPlanOverrideState(control),
    enterprise_ramp_up: buildEnterpriseRampUpState(control),
    enterprise_annual_commitment: buildEnterpriseAnnualCommitmentState(control),
    no_billing_mode: buildNoBillingModeState(control),
    reconciliation,
    stripe_event_diagnostics: stripeEventDiagnostics,
    audit_entries: auditEntries,
  });
}

export async function createNoPaymentPlanOverrideForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const plan = normalizePlanOverrideTarget(payload.plan);
  const startAt = normalizeRequiredIsoDate(payload.start_at, "invalid_start_at", "start_at must be a valid ISO date");
  const endAt = normalizeRequiredIsoDate(payload.end_at, "invalid_end_at", "end_at must be a valid ISO date");
  const reason = String(payload.reason || "").trim();
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!plan) {
    throw new HttpError(400, "invalid_plan_override", "plan must be free, pro, or max");
  }
  if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    throw new HttpError(400, "invalid_plan_override_dates", "end_at must be after start_at");
  }
  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }

  const now = new Date().toISOString();
  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await storeNoPaymentPlanOverride(env.DB, {
    workspaceId,
    plan,
    startAt,
    endAt,
    reason,
    actorUserId: session.id,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const includedCreditGrant = await grantCurrentOverrideIncludedCredits(env, workspace, afterControl, new Date(now));
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "plan_override_created",
    actor_user_id: session.id,
    reason,
    before: planOverrideAuditSnapshot(beforeControl),
    after: planOverrideAuditSnapshot(afterControl),
    occurred_at: now,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  const planDefinition = NON_ENTERPRISE_BILLING_PLANS[plan];
  return json({
    workspace_id: workspaceId,
    plan_override: {
      plan,
      display_name: planDefinition.display_name,
      start_at: startAt,
      end_at: endAt,
      reason,
      created_by_user_id: session.id,
    },
    included_credit_grant: includedCreditGrant,
  } satisfies PlanOverrideResponse, 201);
}

export async function createPaymentRequiredPlanOverrideForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const plan = normalizePlanOverrideTarget(payload.plan);
  const startAt = normalizeRequiredIsoDate(payload.start_at, "invalid_start_at", "start_at must be a valid ISO date");
  const endAt = normalizeRequiredIsoDate(payload.end_at, "invalid_end_at", "end_at must be a valid ISO date");
  const reason = String(payload.reason || "").trim();
  const amountMinor = Number(payload.amount_minor);
  const collectionMode = normalizeInvoiceCollectionMode(payload.collection_mode);
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!plan) {
    throw new HttpError(400, "invalid_plan_override", "plan must be free, pro, or max");
  }
  if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    throw new HttpError(400, "invalid_plan_override_dates", "end_at must be after start_at");
  }
  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new HttpError(400, "invalid_invoice_amount", "amount_minor must be a positive integer");
  }
  if (!collectionMode) {
    throw new HttpError(400, "invalid_collection_mode", "collection_mode must be automatic or manual");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const existingPaymentRequiredOverride = buildPaymentRequiredPlanOverrideState(beforeControl);
  if (
    existingPaymentRequiredOverride &&
    !["paid", "void", "voided", "uncollectible"].includes(String(existingPaymentRequiredOverride.invoice.status || "").toLowerCase())
  ) {
    throw new HttpError(409, "payment_required_override_pending", "Workspace already has a pending payment-required Plan override");
  }

  const stripeCustomerId = await getOrCreateStripeCustomerIdForWorkspace(env, {
    workspaceId,
    workspaceName: workspace.name || "Workspace",
    ownerEmail: await getWorkspaceOwnerEmail(env.DB, workspaceId) || session.email,
  });
  const effectiveCollectionMode = collectionMode === "automatic" &&
    await stripeCustomerHasDefaultPaymentMethod(env, stripeCustomerId)
    ? "automatic"
    : "manual";
  const stripeInvoice = await createStripePaymentRequiredPlanOverrideInvoice(env, {
    workspaceId,
    stripeCustomerId,
    plan,
    startAt,
    endAt,
    reason,
    amountMinor,
    collectionMode: effectiveCollectionMode,
    idempotencyKey,
  });
  const now = new Date().toISOString();
  await storePaymentRequiredPlanOverride(env.DB, {
    workspaceId,
    plan,
    startAt,
    endAt,
    reason,
    actorUserId: session.id,
    amountMinor,
    collectionMode: effectiveCollectionMode,
    stripeInvoiceId: stripeInvoice.id,
    invoiceStatus: stripeInvoice.status,
    hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "payment_required_plan_override_created",
    actor_user_id: session.id,
    reason,
    before: paymentRequiredPlanOverrideAuditSnapshot(beforeControl),
    after: paymentRequiredPlanOverrideAuditSnapshot(afterControl),
    occurred_at: now,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  const state = buildPaymentRequiredPlanOverrideState(afterControl);
  if (!state) {
    throw new HttpError(500, "payment_required_override_unavailable", "Payment-required Plan override state could not be created");
  }

  return json({
    workspace_id: workspaceId,
    payment_required_plan_override: state,
  } satisfies PaymentRequiredPlanOverrideResponse, 201);
}

export async function createEnterpriseRampUpForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const durationMonths = payload.duration_months === undefined ? 3 : Number(payload.duration_months);
  const cycleStart = normalizeRequiredIsoDate(
    payload.enterprise_billing_cycle_start_date,
    "invalid_enterprise_billing_cycle_start_date",
    "enterprise_billing_cycle_start_date must be a valid ISO date",
  );
  const collectionMode = normalizeInvoiceCollectionMode(payload.collection_mode);
  const invoiceReviewEnabled = Boolean(payload.invoice_review_enabled);
  const reason = String(payload.reason || "").trim();
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!Number.isInteger(durationMonths) || durationMonths <= 0) {
    throw new HttpError(400, "invalid_enterprise_ramp_up_duration", "duration_months must be a positive integer");
  }
  if (!collectionMode) {
    throw new HttpError(400, "invalid_collection_mode", "collection_mode must be automatic or manual");
  }
  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const now = new Date().toISOString();
  const existingEnterpriseRampUp = buildEnterpriseRampUpState(beforeControl);
  if (
    existingEnterpriseRampUp?.status === "active" &&
    new Date(existingEnterpriseRampUp.ends_at).getTime() > new Date(now).getTime()
  ) {
    throw new HttpError(409, "enterprise_ramp_up_active", "Workspace already has active Enterprise ramp-up deal terms");
  }
  await storeEnterpriseRampUp(env.DB, {
    workspaceId,
    durationMonths,
    enterpriseBillingCycleStartDate: cycleStart,
    collectionMode,
    invoiceReviewEnabled,
    reason,
    actorUserId: session.id,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "enterprise_ramp_up_assigned",
    actor_user_id: session.id,
    reason,
    before: enterpriseRampUpAuditSnapshot(beforeControl),
    after: enterpriseRampUpAuditSnapshot(afterControl),
    occurred_at: now,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  const enterpriseRampUp = buildEnterpriseRampUpState(afterControl);
  if (!enterpriseRampUp) {
    throw new HttpError(500, "enterprise_ramp_up_unavailable", "Enterprise ramp-up state could not be created");
  }
  const summary = summarizeWorkspaceBilling(workspace, afterControl, new Date(now));
  return json({
    workspace_id: workspaceId,
    enterprise_ramp_up: enterpriseRampUp,
    active_entitlement: {
      plan: summary.active_entitlement.plan,
      display_name: summary.active_entitlement.display_name,
    },
  } satisfies EnterpriseRampUpResponse, 201);
}

export async function createEnterpriseAnnualCommitmentForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const monthlyMinimumAllowance = Number(payload.monthly_minimum_allowance);
  const perPagePriceMinor = Number(payload.per_page_price_minor);
  const cycleStart = normalizeRequiredIsoDate(
    payload.enterprise_billing_cycle_start_date,
    "invalid_enterprise_billing_cycle_start_date",
    "enterprise_billing_cycle_start_date must be a valid ISO date",
  );
  const collectionMode = normalizeInvoiceCollectionMode(payload.collection_mode);
  const invoiceReviewEnabled = Boolean(payload.invoice_review_enabled);
  const reason = String(payload.reason || "").trim();
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!Number.isInteger(monthlyMinimumAllowance) || monthlyMinimumAllowance <= 0) {
    throw new HttpError(400, "invalid_enterprise_annual_allowance", "monthly_minimum_allowance must be a positive integer");
  }
  if (!Number.isInteger(perPagePriceMinor) || perPagePriceMinor <= 0) {
    throw new HttpError(400, "invalid_enterprise_annual_price", "per_page_price_minor must be a positive integer");
  }
  if (!collectionMode) {
    throw new HttpError(400, "invalid_collection_mode", "collection_mode must be automatic or manual");
  }
  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const yearlyAmountMinor = monthlyMinimumAllowance * 12 * perPagePriceMinor;
  if (!Number.isSafeInteger(yearlyAmountMinor) || yearlyAmountMinor <= 0) {
    throw new HttpError(400, "invalid_enterprise_annual_amount", "derived yearly amount is invalid");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const existingEnterpriseAnnual = buildEnterpriseAnnualCommitmentState(beforeControl);
  if (existingEnterpriseAnnual && ["pending_payment", "active", "suspended"].includes(existingEnterpriseAnnual.status)) {
    throw new HttpError(409, "enterprise_annual_commitment_active", "Workspace already has Enterprise annual commitment terms");
  }

  const stripeCustomerId = await getOrCreateStripeCustomerIdForWorkspace(env, {
    workspaceId,
    workspaceName: workspace.name || "Workspace",
    ownerEmail: await getWorkspaceOwnerEmail(env.DB, workspaceId) || session.email,
  });
  const effectiveCollectionMode = collectionMode === "automatic" &&
    await stripeCustomerHasDefaultPaymentMethod(env, stripeCustomerId)
    ? "automatic"
    : "manual";
  const stripeInvoice = await createStripeEnterpriseAnnualUpfrontInvoice(env, {
    workspaceId,
    stripeCustomerId,
    monthlyMinimumAllowance,
    perPagePriceMinor,
    yearlyAmountMinor,
    enterpriseBillingCycleStartDate: cycleStart,
    collectionMode: effectiveCollectionMode,
    invoiceReviewEnabled,
    idempotencyKey,
  });
  const now = new Date().toISOString();
  await storeEnterpriseAnnualCommitment(env.DB, {
    workspaceId,
    monthlyMinimumAllowance,
    perPagePriceMinor,
    yearlyAmountMinor,
    enterpriseBillingCycleStartDate: cycleStart,
    collectionMode: effectiveCollectionMode,
    invoiceReviewEnabled,
    reason,
    actorUserId: session.id,
    stripeInvoiceId: stripeInvoice.id,
    invoiceStatus: stripeInvoice.status,
    hostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "enterprise_annual_commitment_created",
    actor_user_id: session.id,
    reason,
    before: enterpriseAnnualCommitmentAuditSnapshot(beforeControl),
    after: enterpriseAnnualCommitmentAuditSnapshot(afterControl),
    occurred_at: now,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  const enterpriseAnnualCommitment = buildEnterpriseAnnualCommitmentState(afterControl);
  if (!enterpriseAnnualCommitment) {
    throw new HttpError(500, "enterprise_annual_commitment_unavailable", "Enterprise annual commitment state could not be created");
  }
  const summary = summarizeWorkspaceBilling(workspace, afterControl, new Date(now));
  return json({
    workspace_id: workspaceId,
    enterprise_annual_commitment: enterpriseAnnualCommitment,
    active_entitlement: {
      plan: summary.active_entitlement.plan,
      display_name: summary.active_entitlement.display_name,
    },
  } satisfies EnterpriseAnnualCommitmentResponse, 201);
}

export async function updateNoBillingModeForApplicationAdmin(
  request: Request,
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const payload = await readJsonObject(request);
  const enabled = Boolean(payload.enabled);
  const reason = String(payload.reason || "").trim();
  const idempotencyKey = String(payload.idempotency_key || "").trim();

  if (!reason) {
    throw new HttpError(400, "invalid_reason", "reason is required");
  }
  if (!idempotencyKey) {
    throw new HttpError(400, "invalid_idempotency_key", "idempotency_key is required");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const now = new Date().toISOString();
  await storeNoBillingMode(env.DB, {
    workspaceId,
    enabled,
    reason,
    actorUserId: session.id,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "no_billing_mode_updated",
    actor_user_id: session.id,
    reason,
    before: noBillingAuditSnapshot(beforeControl),
    after: noBillingAuditSnapshot(afterControl),
    occurred_at: now,
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  const summary = summarizeWorkspaceBilling(workspace, afterControl, new Date(now));
  return json({
    workspace_id: workspaceId,
    no_billing_mode: {
      enabled,
      reason,
      updated_by_user_id: session.id,
      updated_at: now,
    },
    active_entitlement: {
      plan: summary.active_entitlement.plan,
      display_name: summary.active_entitlement.display_name,
    },
  } satisfies NoBillingModeResponse);
}

export async function listApplicationAdminBillingAuditLog(
  env: Env,
  workspaceId: string,
  session: ApplicationAdminSession,
): Promise<Response> {
  if (String(session.role || "").trim() !== "admin") {
    throw new HttpError(403, "forbidden", "Only Application admins can manage Workspace billing");
  }

  const entries = await listApplicationAdminBillingAuditEntries(env.DB, workspaceId);
  return json({ entries });
}

function getWorkspaceBillingLedger(env: Env, workspaceId: string): BillingLedgerRpc | null {
  const binding = (env as Env & { WORKSPACE_BILLING_LEDGER?: DurableObjectNamespace }).WORKSPACE_BILLING_LEDGER;
  if (!binding) {
    return null;
  }
  return binding.getByName(workspaceId) as unknown as BillingLedgerRpc;
}

function parseOwnerBillingActivityCursor(value: string | null): OwnerBillingActivityCursor | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(raw)) as Partial<OwnerBillingActivityCursor>;
    if (
      typeof decoded.occurred_at === "string" &&
      typeof decoded.id === "string" &&
      decoded.occurred_at &&
      decoded.id
    ) {
      return { occurred_at: decoded.occurred_at, id: decoded.id };
    }
  } catch {
    // fall through to typed API error
  }

  throw new HttpError(400, "invalid_cursor", "cursor is invalid");
}

function encodeOwnerBillingActivityCursor(cursor: OwnerBillingActivityCursor): string {
  return btoa(JSON.stringify(cursor));
}

function parseOwnerBillingUsageRange(value: string | null): OwnerBillingUsageRange {
  const range = String(value || DEFAULT_OWNER_BILLING_USAGE_RANGE).trim().toLowerCase();
  if (OWNER_BILLING_USAGE_RANGES.has(range)) {
    return range as OwnerBillingUsageRange;
  }
  throw new HttpError(400, "invalid_billing_usage_range", "Billing usage range must be daily, weekly, monthly, or yearly");
}

function emptyOwnerBillingUsage(range: OwnerBillingUsageRange): OwnerBillingUsageSeries {
  return {
    range,
    total_credits: 0,
    total_billable_document_pages: 0,
    buckets: [],
  };
}

function normalizePlanOverrideTarget(value: unknown): "free" | "pro" | "max" | null {
  const plan = String(value || "").trim().toLowerCase();
  if (plan === "free" || plan === "pro" || plan === "max") {
    return plan;
  }
  return null;
}

function normalizeInvoiceCollectionMode(value: unknown): "automatic" | "manual" | null {
  const mode = String(value || "automatic").trim().toLowerCase();
  if (mode === "automatic" || mode === "manual") {
    return mode;
  }
  return null;
}

function normalizeRequiredIsoDate(value: unknown, code: string, message: string): string {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, code, message);
  }
  return date.toISOString();
}

async function getWorkspaceForApplicationAdminBilling(
  db: D1Database,
  workspaceId: string,
): Promise<Workspace | null> {
  const row = await db
    .prepare(
      `SELECT id,
              api_key_hash,
              name,
              created_at,
              created_by_user_id,
              rate_limit_per_minute,
              max_templates,
              max_fields_per_template,
              max_source_file_bytes
       FROM workspaces
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<Workspace>();

  return row || null;
}

async function findApplicationAdminBillingWorkspaceById(
  db: D1Database,
  workspaceId: string,
): Promise<Array<{
  id: string;
  name: string | null;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
}>> {
  const result = await db
    .prepare(
      `SELECT w.id,
              w.name,
              w.created_at,
              u.email AS owner_email,
              u.name AS owner_name
       FROM workspaces w
       LEFT JOIN workspace_memberships m
         ON m.workspace_id = w.id
        AND m.role = 'owner'
       LEFT JOIN user u ON u.id = m.user_id
       WHERE w.id = ?
       ORDER BY w.created_at DESC
       LIMIT 8`,
    )
    .bind(workspaceId)
    .all<{
      id: string;
      name: string | null;
      created_at: string;
      owner_email: string | null;
      owner_name: string | null;
    }>();

  return (result.results || []).map(formatApplicationAdminBillingWorkspaceSearchRow);
}

async function findApplicationAdminBillingWorkspacesByOwnerEmail(
  db: D1Database,
  ownerEmail: string,
): Promise<Array<{
  id: string;
  name: string | null;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
}>> {
  const result = await db
    .prepare(
      `SELECT w.id,
              w.name,
              w.created_at,
              u.email AS owner_email,
              u.name AS owner_name
       FROM workspaces w
       JOIN workspace_memberships m
         ON m.workspace_id = w.id
        AND m.role = 'owner'
       JOIN user u ON u.id = m.user_id
       WHERE lower(u.email) LIKE '%' || ? || '%'
       ORDER BY w.created_at DESC
       LIMIT 8`,
    )
    .bind(ownerEmail)
    .all<{
      id: string;
      name: string | null;
      created_at: string;
      owner_email: string | null;
      owner_name: string | null;
    }>();

  return (result.results || []).map(formatApplicationAdminBillingWorkspaceSearchRow);
}

function formatApplicationAdminBillingWorkspaceSearchRow(row: {
  id: string;
  name: string | null;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
}): {
  id: string;
  name: string | null;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
} {
  return {
    id: row.id,
    name: row.name || null,
    created_at: row.created_at,
    owner_email: row.owner_email || null,
    owner_name: row.owner_name || null,
  };
}

async function storeNoPaymentPlanOverride(
  db: D1Database,
  input: {
    workspaceId: string;
    plan: "free" | "pro" | "max";
    startAt: string;
    endAt: string;
    reason: string;
    actorUserId: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         plan_override_plan,
         plan_override_start_at,
         plan_override_end_at,
         plan_override_reason,
         plan_override_created_by_user_id,
         plan_override_created_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         plan_override_plan = excluded.plan_override_plan,
         plan_override_start_at = excluded.plan_override_start_at,
         plan_override_end_at = excluded.plan_override_end_at,
         plan_override_reason = excluded.plan_override_reason,
         plan_override_created_by_user_id = excluded.plan_override_created_by_user_id,
         plan_override_created_at = excluded.plan_override_created_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.workspaceId,
      input.plan,
      input.startAt,
      input.endAt,
      input.reason,
      input.actorUserId,
      input.now,
      input.now,
      input.now,
    )
    .run();
}

async function storePaymentRequiredPlanOverride(
  db: D1Database,
  input: {
    workspaceId: string;
    plan: "free" | "pro" | "max";
    startAt: string;
    endAt: string;
    reason: string;
    actorUserId: string;
    amountMinor: number;
    collectionMode: "automatic" | "manual";
    stripeInvoiceId: string;
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         payment_required_plan_override_plan,
         payment_required_plan_override_start_at,
         payment_required_plan_override_end_at,
         payment_required_plan_override_reason,
         payment_required_plan_override_created_by_user_id,
         payment_required_plan_override_created_at,
         payment_required_plan_override_amount_minor,
         payment_required_plan_override_currency,
         payment_required_plan_override_collection_mode,
         payment_required_plan_override_invoice_id,
         payment_required_plan_override_invoice_status,
         payment_required_plan_override_hosted_invoice_url,
         payment_required_plan_override_paid_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         payment_required_plan_override_plan = excluded.payment_required_plan_override_plan,
         payment_required_plan_override_start_at = excluded.payment_required_plan_override_start_at,
         payment_required_plan_override_end_at = excluded.payment_required_plan_override_end_at,
         payment_required_plan_override_reason = excluded.payment_required_plan_override_reason,
         payment_required_plan_override_created_by_user_id = excluded.payment_required_plan_override_created_by_user_id,
         payment_required_plan_override_created_at = excluded.payment_required_plan_override_created_at,
         payment_required_plan_override_amount_minor = excluded.payment_required_plan_override_amount_minor,
         payment_required_plan_override_currency = excluded.payment_required_plan_override_currency,
         payment_required_plan_override_collection_mode = excluded.payment_required_plan_override_collection_mode,
         payment_required_plan_override_invoice_id = excluded.payment_required_plan_override_invoice_id,
         payment_required_plan_override_invoice_status = excluded.payment_required_plan_override_invoice_status,
         payment_required_plan_override_hosted_invoice_url = excluded.payment_required_plan_override_hosted_invoice_url,
         payment_required_plan_override_paid_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.workspaceId,
      input.plan,
      input.startAt,
      input.endAt,
      input.reason,
      input.actorUserId,
      input.now,
      input.amountMinor,
      input.collectionMode,
      input.stripeInvoiceId,
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.now,
    )
    .run();
}

async function activatePaymentRequiredPlanOverride(
  db: D1Database,
  input: {
    workspaceId: string;
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    paidAt: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET plan_override_plan = payment_required_plan_override_plan,
           plan_override_start_at = payment_required_plan_override_start_at,
           plan_override_end_at = payment_required_plan_override_end_at,
           plan_override_reason = payment_required_plan_override_reason,
           plan_override_created_by_user_id = payment_required_plan_override_created_by_user_id,
           plan_override_created_at = payment_required_plan_override_created_at,
           payment_required_plan_override_invoice_status = ?,
           payment_required_plan_override_hosted_invoice_url = COALESCE(?, payment_required_plan_override_hosted_invoice_url),
           payment_required_plan_override_paid_at = ?,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.paidAt,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function storePaymentRequiredPlanOverrideInvoiceStatus(
  db: D1Database,
  input: {
    workspaceId: string;
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET payment_required_plan_override_invoice_status = ?,
           payment_required_plan_override_hosted_invoice_url = COALESCE(?, payment_required_plan_override_hosted_invoice_url),
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function storeNoBillingMode(
  db: D1Database,
  input: {
    workspaceId: string;
    enabled: boolean;
    reason: string;
    actorUserId: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         no_billing_enabled,
         no_billing_reason,
         no_billing_updated_by_user_id,
         no_billing_updated_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         no_billing_enabled = excluded.no_billing_enabled,
         no_billing_reason = excluded.no_billing_reason,
         no_billing_updated_by_user_id = excluded.no_billing_updated_by_user_id,
         no_billing_updated_at = excluded.no_billing_updated_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.workspaceId,
      input.enabled ? 1 : 0,
      input.reason,
      input.actorUserId,
      input.now,
      input.now,
      input.now,
    )
    .run();
}

async function storeEnterpriseRampUp(
  db: D1Database,
  input: {
    workspaceId: string;
    durationMonths: number;
    enterpriseBillingCycleStartDate: string;
    collectionMode: "automatic" | "manual";
    invoiceReviewEnabled: boolean;
    reason: string;
    actorUserId: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         enterprise_ramp_up_status,
         enterprise_ramp_up_duration_months,
         enterprise_billing_cycle_start_date,
         enterprise_ramp_up_collection_mode,
         enterprise_ramp_up_invoice_review_enabled,
         enterprise_ramp_up_reason,
         enterprise_ramp_up_created_by_user_id,
         enterprise_ramp_up_created_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         enterprise_ramp_up_status = excluded.enterprise_ramp_up_status,
         enterprise_ramp_up_duration_months = excluded.enterprise_ramp_up_duration_months,
         enterprise_billing_cycle_start_date = excluded.enterprise_billing_cycle_start_date,
         enterprise_ramp_up_collection_mode = excluded.enterprise_ramp_up_collection_mode,
         enterprise_ramp_up_invoice_review_enabled = excluded.enterprise_ramp_up_invoice_review_enabled,
         enterprise_ramp_up_reason = excluded.enterprise_ramp_up_reason,
         enterprise_ramp_up_created_by_user_id = excluded.enterprise_ramp_up_created_by_user_id,
         enterprise_ramp_up_created_at = excluded.enterprise_ramp_up_created_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.workspaceId,
      input.durationMonths,
      input.enterpriseBillingCycleStartDate,
      input.collectionMode,
      input.invoiceReviewEnabled ? 1 : 0,
      input.reason,
      input.actorUserId,
      input.now,
      input.now,
      input.now,
    )
    .run();
}

async function storeEnterpriseAnnualCommitment(
  db: D1Database,
  input: {
    workspaceId: string;
    monthlyMinimumAllowance: number;
    perPagePriceMinor: number;
    yearlyAmountMinor: number;
    enterpriseBillingCycleStartDate: string;
    collectionMode: "automatic" | "manual";
    invoiceReviewEnabled: boolean;
    reason: string;
    actorUserId: string;
    stripeInvoiceId: string;
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         enterprise_annual_status,
         enterprise_annual_monthly_minimum_allowance,
         enterprise_annual_per_page_price_minor,
         enterprise_annual_yearly_amount_minor,
         enterprise_billing_cycle_start_date,
         enterprise_annual_collection_mode,
         enterprise_annual_invoice_review_enabled,
         enterprise_annual_reason,
         enterprise_annual_created_by_user_id,
         enterprise_annual_created_at,
         enterprise_annual_upfront_invoice_id,
         enterprise_annual_upfront_invoice_status,
         enterprise_annual_upfront_invoice_hosted_url,
         enterprise_annual_upfront_invoice_paid_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         enterprise_annual_status = excluded.enterprise_annual_status,
         enterprise_annual_monthly_minimum_allowance = excluded.enterprise_annual_monthly_minimum_allowance,
         enterprise_annual_per_page_price_minor = excluded.enterprise_annual_per_page_price_minor,
         enterprise_annual_yearly_amount_minor = excluded.enterprise_annual_yearly_amount_minor,
         enterprise_billing_cycle_start_date = excluded.enterprise_billing_cycle_start_date,
         enterprise_annual_collection_mode = excluded.enterprise_annual_collection_mode,
         enterprise_annual_invoice_review_enabled = excluded.enterprise_annual_invoice_review_enabled,
         enterprise_annual_reason = excluded.enterprise_annual_reason,
         enterprise_annual_created_by_user_id = excluded.enterprise_annual_created_by_user_id,
         enterprise_annual_created_at = excluded.enterprise_annual_created_at,
         enterprise_annual_upfront_invoice_id = excluded.enterprise_annual_upfront_invoice_id,
         enterprise_annual_upfront_invoice_status = excluded.enterprise_annual_upfront_invoice_status,
         enterprise_annual_upfront_invoice_hosted_url = excluded.enterprise_annual_upfront_invoice_hosted_url,
         enterprise_annual_upfront_invoice_paid_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.workspaceId,
      input.monthlyMinimumAllowance,
      input.perPagePriceMinor,
      input.yearlyAmountMinor,
      input.enterpriseBillingCycleStartDate,
      input.collectionMode,
      input.invoiceReviewEnabled ? 1 : 0,
      input.reason,
      input.actorUserId,
      input.now,
      input.stripeInvoiceId,
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.now,
    )
    .run();
}

async function grantCurrentOverrideIncludedCredits(
  env: Env,
  workspace: Workspace,
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
  now: Date,
): Promise<PlanOverrideResponse["included_credit_grant"]> {
  const ledger = getWorkspaceBillingLedger(env, workspace.id);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  return reconcileActivePlanOverrideIncludedCredits({
    workspace,
    control,
    ledger,
    now,
  });
}

function planOverrideAuditSnapshot(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): Record<string, unknown> {
  return {
    plan_override_plan: control?.plan_override_plan ?? null,
    plan_override_start_at: control?.plan_override_start_at ?? null,
    plan_override_end_at: control?.plan_override_end_at ?? null,
  };
}

function noBillingAuditSnapshot(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): Record<string, unknown> {
  return {
    no_billing_enabled: control?.no_billing_enabled === true || Number(control?.no_billing_enabled || 0) === 1,
    no_billing_reason: control?.no_billing_reason ?? null,
  };
}

function buildPlanOverrideState(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
) {
  const plan = control?.plan_override_plan;
  if (plan !== "free" && plan !== "pro" && plan !== "max") {
    return null;
  }
  return {
    plan,
    display_name: NON_ENTERPRISE_BILLING_PLANS[plan].display_name,
    start_at: control?.plan_override_start_at ?? null,
    end_at: control?.plan_override_end_at ?? null,
    reason: control?.plan_override_reason ?? null,
    created_by_user_id: control?.plan_override_created_by_user_id ?? null,
    created_at: control?.plan_override_created_at ?? null,
  };
}

function buildPaymentRequiredPlanOverrideState(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): PaymentRequiredPlanOverrideState | null {
  const plan = control?.payment_required_plan_override_plan;
  if (plan !== "free" && plan !== "pro" && plan !== "max") {
    return null;
  }
  const amountMinor = Number(control?.payment_required_plan_override_amount_minor || 0);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return null;
  }
  const collectionMode = control?.payment_required_plan_override_collection_mode === "manual"
    ? "manual"
    : "automatic";
  return {
    plan,
    display_name: NON_ENTERPRISE_BILLING_PLANS[plan].display_name,
    start_at: control?.payment_required_plan_override_start_at ?? null,
    end_at: control?.payment_required_plan_override_end_at ?? null,
    reason: control?.payment_required_plan_override_reason ?? null,
    created_by_user_id: control?.payment_required_plan_override_created_by_user_id ?? null,
    created_at: control?.payment_required_plan_override_created_at ?? null,
    amount: {
      currency: "GBP",
      amount_minor: amountMinor,
      display: formatGbpMinorAmount(amountMinor),
      tax_behavior: "exclusive",
    },
    collection_mode: collectionMode,
    invoice: {
      status: control?.payment_required_plan_override_invoice_status ?? null,
      hosted_invoice_url: control?.payment_required_plan_override_hosted_invoice_url ?? null,
    },
  };
}

function buildEnterpriseRampUpState(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): EnterpriseRampUpState | null {
  const status = String(control?.enterprise_ramp_up_status || "").trim();
  const durationMonths = Number(control?.enterprise_ramp_up_duration_months || 0);
  const cycleStart = normalizeIsoDateOrNull(control?.enterprise_billing_cycle_start_date);
  if (!status || !Number.isInteger(durationMonths) || durationMonths <= 0 || !cycleStart) {
    return null;
  }
  return {
    status,
    duration_months: durationMonths,
    enterprise_billing_cycle_start_date: cycleStart,
    starts_at: cycleStart,
    ends_at: addMonths(new Date(cycleStart), durationMonths).toISOString(),
    collection_mode: control?.enterprise_ramp_up_collection_mode === "automatic" ? "automatic" : "manual",
    invoice_review_enabled: control?.enterprise_ramp_up_invoice_review_enabled === true ||
      Number(control?.enterprise_ramp_up_invoice_review_enabled || 0) === 1,
    reason: control?.enterprise_ramp_up_reason ?? null,
    created_by_user_id: control?.enterprise_ramp_up_created_by_user_id ?? null,
    created_at: normalizeIsoDateOrNull(control?.enterprise_ramp_up_created_at),
    latest_invoice: buildEnterpriseRampUpLatestInvoice(control),
  };
}

function buildEnterpriseRampUpLatestInvoice(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): EnterpriseRampUpState["latest_invoice"] {
  const periodStart = normalizeIsoDateOrNull(control?.enterprise_ramp_up_last_invoice_period_start);
  const periodEnd = normalizeIsoDateOrNull(control?.enterprise_ramp_up_last_invoice_period_end);
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

function buildEnterpriseAnnualCommitmentState(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): EnterpriseAnnualCommitmentState | null {
  const status = String(control?.enterprise_annual_status || "").trim();
  const monthlyMinimumAllowance = Number(control?.enterprise_annual_monthly_minimum_allowance || 0);
  const perPagePriceMinor = Number(control?.enterprise_annual_per_page_price_minor || 0);
  const yearlyAmountMinor = Number(control?.enterprise_annual_yearly_amount_minor || 0);
  const cycleStart = normalizeIsoDateOrNull(control?.enterprise_billing_cycle_start_date);
  if (
    !status ||
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

  return {
    status,
    monthly_minimum_allowance: monthlyMinimumAllowance,
    per_page_price: formatGbpAmount(perPagePriceMinor),
    yearly_amount: formatGbpAmount(yearlyAmountMinor),
    enterprise_billing_cycle_start_date: cycleStart,
    starts_at: cycleStart,
    ends_at: addMonths(new Date(cycleStart), 12).toISOString(),
    collection_mode: control?.enterprise_annual_collection_mode === "automatic" ? "automatic" : "manual",
    invoice_review_enabled: control?.enterprise_annual_invoice_review_enabled === true ||
      Number(control?.enterprise_annual_invoice_review_enabled || 0) === 1,
    reason: control?.enterprise_annual_reason ?? null,
    created_by_user_id: control?.enterprise_annual_created_by_user_id ?? null,
    created_at: normalizeIsoDateOrNull(control?.enterprise_annual_created_at),
    upfront_invoice: {
      status: String(control?.enterprise_annual_upfront_invoice_status || "").trim() || null,
      hosted_invoice_url: String(control?.enterprise_annual_upfront_invoice_hosted_url || "").trim() || null,
      paid_at: normalizeIsoDateOrNull(control?.enterprise_annual_upfront_invoice_paid_at),
    },
    latest_overage_invoice: buildEnterpriseAnnualLatestOverageInvoice(control),
  };
}

function buildEnterpriseAnnualLatestOverageInvoice(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): EnterpriseAnnualCommitmentState["latest_overage_invoice"] {
  const periodStart = normalizeIsoDateOrNull(control?.enterprise_annual_last_overage_invoice_period_start);
  const periodEnd = normalizeIsoDateOrNull(control?.enterprise_annual_last_overage_invoice_period_end);
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

function buildNoBillingModeState(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
) {
  return {
    enabled: control?.no_billing_enabled === true || Number(control?.no_billing_enabled || 0) === 1,
    reason: control?.no_billing_reason ?? null,
    updated_by_user_id: control?.no_billing_updated_by_user_id ?? null,
    updated_at: control?.no_billing_updated_at ?? null,
  };
}

function paymentRequiredPlanOverrideAuditSnapshot(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): Record<string, unknown> {
  return {
    payment_required_plan_override_plan: control?.payment_required_plan_override_plan ?? null,
    payment_required_plan_override_start_at: control?.payment_required_plan_override_start_at ?? null,
    payment_required_plan_override_end_at: control?.payment_required_plan_override_end_at ?? null,
    payment_required_plan_override_amount_minor: control?.payment_required_plan_override_amount_minor ?? null,
    payment_required_plan_override_collection_mode: control?.payment_required_plan_override_collection_mode ?? null,
    payment_required_plan_override_invoice_status: control?.payment_required_plan_override_invoice_status ?? null,
  };
}

function enterpriseRampUpAuditSnapshot(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): Record<string, unknown> {
  return {
    enterprise_ramp_up_status: control?.enterprise_ramp_up_status ?? null,
    enterprise_ramp_up_duration_months: control?.enterprise_ramp_up_duration_months ?? null,
    enterprise_billing_cycle_start_date: control?.enterprise_billing_cycle_start_date ?? null,
    enterprise_ramp_up_collection_mode: control?.enterprise_ramp_up_collection_mode ?? null,
  };
}

function enterpriseAnnualCommitmentAuditSnapshot(
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): Record<string, unknown> {
  return {
    enterprise_annual_status: control?.enterprise_annual_status ?? null,
    enterprise_annual_monthly_minimum_allowance: control?.enterprise_annual_monthly_minimum_allowance ?? null,
    enterprise_annual_per_page_price_minor: control?.enterprise_annual_per_page_price_minor ?? null,
    enterprise_annual_yearly_amount_minor: control?.enterprise_annual_yearly_amount_minor ?? null,
    enterprise_billing_cycle_start_date: control?.enterprise_billing_cycle_start_date ?? null,
    enterprise_annual_collection_mode: control?.enterprise_annual_collection_mode ?? null,
    enterprise_annual_upfront_invoice_status: control?.enterprise_annual_upfront_invoice_status ?? null,
  };
}

function formatGbpMinorAmount(amountMinor: number): string {
  return `GBP ${(amountMinor / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatGbpAmount(amountMinor: number): {
  currency: "GBP";
  amount_minor: number;
  display: string;
  tax_behavior: "exclusive";
} {
  return {
    currency: "GBP",
    amount_minor: amountMinor,
    display: formatGbpMinorAmount(amountMinor),
    tax_behavior: "exclusive",
  };
}

async function ensureWorkspaceBillingControlRecord(
  db: D1Database,
  workspaceId: string,
  now: string,
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (workspace_id, ledger_object_name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .bind(workspaceId, workspaceId, now, now)
    .run();

  return workspaceId;
}

async function getOrCreateStripeCustomerIdForWorkspace(
  env: Env,
  input: { workspaceId: string; workspaceName: string; ownerEmail: string },
): Promise<string> {
  const existing = await getStripeCustomerIdForWorkspace(env.DB, input.workspaceId);
  if (existing) {
    return existing;
  }

  const customer = await createStripeCustomer(env, input);
  await storeStripeCustomerIdForWorkspace(env.DB, {
    workspaceId: input.workspaceId,
    stripeCustomerId: customer.id,
    now: new Date().toISOString(),
  });
  return customer.id;
}

async function getStripeCustomerIdForWorkspace(
  db: D1Database,
  workspaceId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT stripe_customer_id
       FROM workspace_billing_controls
       WHERE workspace_id = ?
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ stripe_customer_id?: string | null }>();

  return String(row?.stripe_customer_id || "").trim() || null;
}

async function getWorkspaceOwnerEmail(
  db: D1Database,
  workspaceId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT u.email
       FROM workspace_memberships m
       JOIN user u ON u.id = m.user_id
       WHERE m.workspace_id = ?
         AND m.role = 'owner'
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ email?: string | null }>();

  return String(row?.email || "").trim() || null;
}

async function listEnterpriseRampUpInvoiceCandidates(db: D1Database): Promise<EnterpriseRampUpInvoiceCandidate[]> {
  const result = await db
    .prepare(
      `SELECT w.id AS workspace_id,
              w.name AS workspace_name,
              c.stripe_customer_id,
              c.enterprise_ramp_up_duration_months,
              c.enterprise_billing_cycle_start_date,
              c.enterprise_ramp_up_collection_mode,
              c.enterprise_ramp_up_invoice_review_enabled,
              c.enterprise_ramp_up_last_invoice_period_end
       FROM workspace_billing_controls c
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.enterprise_ramp_up_status = 'active'
         AND c.enterprise_ramp_up_duration_months IS NOT NULL
         AND c.enterprise_billing_cycle_start_date IS NOT NULL`,
    )
    .bind()
    .all<{
      workspace_id: string;
      workspace_name?: string | null;
      stripe_customer_id?: string | null;
      enterprise_ramp_up_duration_months?: number | null;
      enterprise_billing_cycle_start_date?: string | null;
      enterprise_ramp_up_collection_mode?: "automatic" | "manual" | null;
      enterprise_ramp_up_invoice_review_enabled?: number | boolean | null;
      enterprise_ramp_up_last_invoice_period_end?: string | null;
    }>();

  return (result.results || [])
    .map((row): EnterpriseRampUpInvoiceCandidate | null => {
      const workspaceId = String(row.workspace_id || "").trim();
      const durationMonths = Number(row.enterprise_ramp_up_duration_months || 0);
      const cycleStart = normalizeIsoDateOrNull(row.enterprise_billing_cycle_start_date);
      if (!workspaceId || !Number.isInteger(durationMonths) || durationMonths <= 0 || !cycleStart) {
        return null;
      }
      return {
        workspaceId,
        workspaceName: String(row.workspace_name || "").trim() || null,
        stripeCustomerId: String(row.stripe_customer_id || "").trim() || null,
        durationMonths,
        cycleStart,
        collectionMode: row.enterprise_ramp_up_collection_mode === "automatic" ? "automatic" : "manual",
        invoiceReviewEnabled: row.enterprise_ramp_up_invoice_review_enabled === true ||
          Number(row.enterprise_ramp_up_invoice_review_enabled || 0) === 1,
        lastInvoicePeriodEnd: normalizeIsoDateOrNull(row.enterprise_ramp_up_last_invoice_period_end),
      };
    })
    .filter((candidate): candidate is EnterpriseRampUpInvoiceCandidate => Boolean(candidate));
}

async function listEnterpriseAnnualOverageInvoiceCandidates(
  db: D1Database,
): Promise<EnterpriseAnnualOverageInvoiceCandidate[]> {
  const result = await db
    .prepare(
      `SELECT w.id AS workspace_id,
              w.name AS workspace_name,
              c.stripe_customer_id,
              c.enterprise_annual_monthly_minimum_allowance,
              c.enterprise_annual_per_page_price_minor,
              c.enterprise_billing_cycle_start_date,
              c.enterprise_annual_collection_mode,
              c.enterprise_annual_invoice_review_enabled,
              c.enterprise_annual_last_overage_invoice_period_end
       FROM workspace_billing_controls c
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.enterprise_annual_status = 'active'
         AND c.enterprise_annual_monthly_minimum_allowance IS NOT NULL
         AND c.enterprise_annual_per_page_price_minor IS NOT NULL
         AND c.enterprise_billing_cycle_start_date IS NOT NULL`,
    )
    .bind()
    .all<{
      workspace_id: string;
      workspace_name?: string | null;
      stripe_customer_id?: string | null;
      enterprise_annual_monthly_minimum_allowance?: number | null;
      enterprise_annual_per_page_price_minor?: number | null;
      enterprise_billing_cycle_start_date?: string | null;
      enterprise_annual_collection_mode?: "automatic" | "manual" | null;
      enterprise_annual_invoice_review_enabled?: number | boolean | null;
      enterprise_annual_last_overage_invoice_period_end?: string | null;
    }>();

  return (result.results || [])
    .map((row): EnterpriseAnnualOverageInvoiceCandidate | null => {
      const workspaceId = String(row.workspace_id || "").trim();
      const monthlyMinimumAllowance = Number(row.enterprise_annual_monthly_minimum_allowance || 0);
      const perPagePriceMinor = Number(row.enterprise_annual_per_page_price_minor || 0);
      const cycleStart = normalizeIsoDateOrNull(row.enterprise_billing_cycle_start_date);
      if (
        !workspaceId ||
        !Number.isInteger(monthlyMinimumAllowance) ||
        monthlyMinimumAllowance <= 0 ||
        !Number.isInteger(perPagePriceMinor) ||
        perPagePriceMinor <= 0 ||
        !cycleStart
      ) {
        return null;
      }
      return {
        workspaceId,
        workspaceName: String(row.workspace_name || "").trim() || null,
        stripeCustomerId: String(row.stripe_customer_id || "").trim() || null,
        monthlyMinimumAllowance,
        perPagePriceMinor,
        cycleStart,
        collectionMode: row.enterprise_annual_collection_mode === "automatic" ? "automatic" : "manual",
        invoiceReviewEnabled: row.enterprise_annual_invoice_review_enabled === true ||
          Number(row.enterprise_annual_invoice_review_enabled || 0) === 1,
        lastInvoicePeriodEnd: normalizeIsoDateOrNull(row.enterprise_annual_last_overage_invoice_period_end),
      };
    })
    .filter((candidate): candidate is EnterpriseAnnualOverageInvoiceCandidate => Boolean(candidate));
}

async function listBillingReconciliationCandidates(db: D1Database): Promise<BillingReconciliationCandidate[]> {
  const result = await db
    .prepare(
      `SELECT w.id AS workspace_id,
              w.name AS workspace_name,
              c.stripe_customer_id
       FROM workspace_billing_controls c
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.stripe_customer_id IS NOT NULL`,
    )
    .bind()
    .all<{
      workspace_id: string;
      workspace_name?: string | null;
      stripe_customer_id?: string | null;
    }>();

  return (result.results || [])
    .map((row): BillingReconciliationCandidate | null => {
      const workspaceId = String(row.workspace_id || "").trim();
      if (!workspaceId) {
        return null;
      }
      return {
        workspaceId,
        workspaceName: String(row.workspace_name || "").trim() || null,
        stripeCustomerId: String(row.stripe_customer_id || "").trim() || null,
      };
    })
    .filter((candidate): candidate is BillingReconciliationCandidate => Boolean(candidate));
}

async function recordAmbiguousStripeInvoiceDrift(
  db: D1Database,
  candidate: BillingReconciliationCandidate,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const billingAction = String(metadata.billing_action || "").trim();
  if (!billingAction) {
    return;
  }

  const metadataWorkspaceId = String(metadata.workspace_id || "").trim() || null;
  if (metadataWorkspaceId === candidate.workspaceId) {
    return;
  }

  const invoiceId = String(invoice.id || "").trim();
  if (!invoiceId) {
    return;
  }

  await recordBillingReconciliationDrift(db, {
    id: createBillingReconciliationDriftId(candidate.workspaceId, "ambiguous_stripe_invoice", invoiceId),
    workspace_id: candidate.workspaceId,
    drift_type: "ambiguous_stripe_invoice",
    severity: "needs_review",
    actionability: "manual_review",
    related_stripe_object_id: invoiceId,
    observed: {
      billing_action: billingAction,
      invoice_status: String(invoice.status || "").trim() || null,
      metadata_workspace_id: metadataWorkspaceId,
    },
    expected: {
      workspace_id: candidate.workspaceId,
    },
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    status: "open",
  });
}

async function recordKnownInvoiceStatusDrift(
  db: D1Database,
  candidate: BillingReconciliationCandidate,
  control: WorkspaceBillingControl | null,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  const invoiceId = String(invoice.id || "").trim();
  const stripeStatus = normalizeTerminalStripeInvoiceStatus(invoice.status);
  if (!invoiceId || !stripeStatus) {
    return;
  }

  const knownReferences = [
    {
      invoiceReference: "payment_required_plan_override",
      storedInvoiceId: String(control?.payment_required_plan_override_invoice_id || "").trim(),
      storedStatus: normalizeStoredInvoiceStatus(control?.payment_required_plan_override_invoice_status),
    },
    {
      invoiceReference: "enterprise_ramp_up",
      storedInvoiceId: String(control?.enterprise_ramp_up_last_invoice_id || "").trim(),
      storedStatus: normalizeStoredInvoiceStatus(control?.enterprise_ramp_up_last_invoice_status),
    },
    {
      invoiceReference: "enterprise_annual_upfront",
      storedInvoiceId: String(control?.enterprise_annual_upfront_invoice_id || "").trim(),
      storedStatus: normalizeStoredInvoiceStatus(control?.enterprise_annual_upfront_invoice_status),
    },
    {
      invoiceReference: "enterprise_annual_overage",
      storedInvoiceId: String(control?.enterprise_annual_last_overage_invoice_id || "").trim(),
      storedStatus: normalizeStoredInvoiceStatus(control?.enterprise_annual_last_overage_invoice_status),
    },
  ].find((reference) => reference.storedInvoiceId === invoiceId);

  if (!knownReferences?.storedStatus || knownReferences.storedStatus === stripeStatus) {
    return;
  }

  await recordBillingReconciliationDrift(db, {
    id: createBillingReconciliationDriftId(candidate.workspaceId, "invoice_status_drift", invoiceId),
    workspace_id: candidate.workspaceId,
    drift_type: "invoice_status_drift",
    severity: "needs_review",
    actionability: "manual_review",
    related_stripe_object_id: invoiceId,
    observed: {
      invoice_reference: knownReferences.invoiceReference,
      stripe_status: stripeStatus,
      stored_status: knownReferences.storedStatus,
    },
    expected: {
      workspace_id: candidate.workspaceId,
      stored_invoice_id: knownReferences.storedInvoiceId,
    },
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    status: "open",
  });
}

async function recordMissingProcessedStripeCheckoutSessionDrift(
  db: D1Database,
  candidate: BillingReconciliationCandidate,
  session: StripeCheckoutSession,
  now: Date,
): Promise<void> {
  const metadata = session.metadata || {};
  if (
    String(metadata.workspace_id || "").trim() !== candidate.workspaceId ||
    String(metadata.billing_action || "").trim() !== "credit_pack_purchase" ||
    session.payment_status !== "paid"
  ) {
    return;
  }

  const checkoutSessionId = String(session.id || "").trim();
  if (!checkoutSessionId) {
    return;
  }

  await recordMissingProcessedStripeObjectDrift(db, {
    workspaceId: candidate.workspaceId,
    objectId: checkoutSessionId,
    objectType: "checkout.session",
    billingAction: "credit_pack_purchase",
    statusKey: "payment_status",
    statusValue: "paid",
    now,
  });
}

async function recordMissingProcessedStripeInvoiceDrift(
  db: D1Database,
  candidate: BillingReconciliationCandidate,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const billingAction = String(metadata.billing_action || "").trim();
  if (String(metadata.workspace_id || "").trim() !== candidate.workspaceId || !billingAction) {
    return;
  }

  const invoiceId = String(invoice.id || "").trim();
  if (!invoiceId) {
    return;
  }

  await recordMissingProcessedStripeObjectDrift(db, {
    workspaceId: candidate.workspaceId,
    objectId: invoiceId,
    objectType: "invoice",
    billingAction,
    statusKey: "invoice_status",
    statusValue: "paid",
    now,
  });
}

async function recordMissingProcessedStripeObjectDrift(
  db: D1Database,
  input: {
    workspaceId: string;
    objectId: string;
    objectType: "checkout.session" | "invoice";
    billingAction: string;
    statusKey: "payment_status" | "invoice_status";
    statusValue: string;
    now: Date;
  },
): Promise<void> {
  const processedStatus = await getProcessedStripeBillingEventStatusForObject(db, {
    workspaceId: input.workspaceId,
    relatedStripeObjectId: input.objectId,
  });
  if (processedStatus === "processed") {
    return;
  }

  await recordBillingReconciliationDrift(db, {
    id: createBillingReconciliationDriftId(input.workspaceId, "missing_processed_stripe_event", input.objectId),
    workspace_id: input.workspaceId,
    drift_type: "missing_processed_stripe_event",
    severity: processedStatus === "failed" ? "needs_review" : "warning",
    actionability: processedStatus === "failed" ? "manual_review" : "informational",
    related_stripe_object_id: input.objectId,
    observed: {
      stripe_object_type: input.objectType,
      billing_action: input.billingAction,
      [input.statusKey]: input.statusValue,
      processed_event_status: processedStatus,
    },
    expected: {
      workspace_id: input.workspaceId,
      related_stripe_object_id: input.objectId,
    },
    first_seen_at: input.now.toISOString(),
    last_seen_at: input.now.toISOString(),
    status: "open",
  });
}

async function recordSubscriptionLifecycleDriftFromReconciliation(
  db: D1Database,
  env: Env,
  candidate: BillingReconciliationCandidate,
  control: WorkspaceBillingControl | null,
  subscription: StripeSubscription,
  now: Date,
): Promise<void> {
  const subscriptionId = getStripeId(subscription.id);
  if (!subscriptionId) {
    return;
  }

  const metadata = getStripeSubscriptionMetadata(subscription);
  const metadataWorkspaceId = String(metadata.workspace_id || "").trim();
  const controlSubscriptionId = String(control?.stripe_subscription_id || "").trim();
  if (metadataWorkspaceId && metadataWorkspaceId !== candidate.workspaceId) {
    return;
  }
  if (!metadataWorkspaceId && controlSubscriptionId !== subscriptionId) {
    return;
  }

  const plan = normalizeSubscriptionPlan(String(metadata.plan || control?.self_service_subscription_plan || "").trim().toLowerCase());
  const stripeCustomerId = getStripeSubscriptionCustomerId(subscription);
  if (!plan || stripeCustomerId !== candidate.stripeCustomerId) {
    return;
  }

  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const subscriptionItem = getStripeSubscriptionItemForPrice(subscription, expectedPriceId);
  const subscriptionStatus = String(subscription.status || "").trim();
  const shouldRecordDrift =
    controlSubscriptionId !== subscriptionId ||
    control?.self_service_subscription_plan !== plan ||
    String(control?.stripe_subscription_item_id || "").trim() !== String(subscriptionItem?.id || "").trim() ||
    String(control?.stripe_subscription_current_period_start || "").trim() !== String(subscriptionItem?.currentPeriodStart || "").trim() ||
    String(control?.stripe_subscription_current_period_end || "").trim() !== String(subscriptionItem?.currentPeriodEnd || "").trim() ||
    subscriptionStatus !== "active";

  if (!shouldRecordDrift) {
    return;
  }

  await recordSubscriptionLifecycleDrift(db, {
    event: {
      id: `reconciliation:${subscriptionId}`,
      type: "billing_reconciliation",
      data: { object: subscription },
    },
    subscription,
    workspaceId: candidate.workspaceId,
    plan,
    stripeCustomerId,
    control,
    now,
  });
}

async function getProcessedStripeBillingEventStatusForObject(
  db: D1Database,
  input: { workspaceId: string; relatedStripeObjectId: string },
): Promise<"processed" | "failed" | null> {
  const row = await db
    .prepare(
      `SELECT processed_status
       FROM workspace_billing_stripe_events
       WHERE workspace_id = ?
         AND related_stripe_object_id = ?
       ORDER BY received_at DESC
       LIMIT 1`,
    )
    .bind(input.workspaceId, input.relatedStripeObjectId)
    .first<{ processed_status?: string | null }>();
  const status = String(row?.processed_status || "").trim();
  return status === "processed" || status === "failed" ? status : null;
}

async function recordLedgerProjectionDrift(
  env: Env,
  candidate: BillingReconciliationCandidate,
  workspace: Workspace | null,
  control: WorkspaceBillingControl | null,
  now: Date,
): Promise<void> {
  if (!workspace) {
    return;
  }
  const ledger = getWorkspaceBillingLedger(env, candidate.workspaceId);
  if (!ledger) {
    return;
  }

  const summary = summarizeWorkspaceBilling(workspace, control, now);
  if (summary.current_period.monthly_page_limit === null) {
    return;
  }

  const ledgerSummary = await ledger.summarizeOwnerBilling({
    billingPeriodStart: summary.current_period.start,
    billingPeriodEnd: summary.current_period.end,
    monthlyPageLimit: summary.current_period.monthly_page_limit,
  });
  const currentPeriod = ledgerSummary.current_period;
  if (!currentPeriod) {
    return;
  }

  const pagesUsed = Number(currentPeriod.pages_used || 0);
  const expectedPagesRemaining = Math.max(0, summary.current_period.monthly_page_limit - pagesUsed);
  if (currentPeriod.pages_remaining === expectedPagesRemaining) {
    return;
  }

  await recordBillingReconciliationDrift(env.DB, {
    id: createBillingReconciliationDriftId(candidate.workspaceId, "ledger_projection_drift", "current_period_pages"),
    workspace_id: candidate.workspaceId,
    drift_type: "ledger_projection_drift",
    severity: "needs_review",
    actionability: "manual_review",
    related_stripe_object_id: null,
    observed: {
      projection: "current_period_pages",
      monthly_page_limit: summary.current_period.monthly_page_limit,
      pages_used: pagesUsed,
      pages_remaining: currentPeriod.pages_remaining,
    },
    expected: {
      pages_remaining: expectedPagesRemaining,
    },
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    status: "open",
  });
}

function normalizeTerminalStripeInvoiceStatus(value: unknown): string | null {
  const status = normalizeStoredInvoiceStatus(value);
  if (status === "voided") {
    return "void";
  }
  return ["paid", "void", "uncollectible"].includes(status) ? status : null;
}

function normalizeStoredInvoiceStatus(value: unknown): string {
  const status = String(value || "").trim();
  return status === "voided" ? "void" : status;
}

function getLatestClosedEnterpriseRampUpPeriod(
  candidate: EnterpriseRampUpInvoiceCandidate,
  now: Date,
): EnterpriseRampUpInvoicePeriod | null {
  const cycleStart = new Date(candidate.cycleStart);
  if (Number.isNaN(cycleStart.getTime())) {
    return null;
  }

  let latestPeriod: EnterpriseRampUpInvoicePeriod | null = null;
  for (let monthIndex = 0; monthIndex < candidate.durationMonths; monthIndex += 1) {
    const periodStart = addMonths(cycleStart, monthIndex);
    const periodEnd = addMonths(cycleStart, monthIndex + 1);
    if (periodEnd.getTime() > now.getTime()) {
      break;
    }
    latestPeriod = {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    };
  }
  return latestPeriod;
}

function getLatestClosedEnterpriseAnnualPeriod(
  candidate: EnterpriseAnnualOverageInvoiceCandidate,
  now: Date,
): EnterpriseRampUpInvoicePeriod | null {
  const cycleStart = new Date(candidate.cycleStart);
  if (Number.isNaN(cycleStart.getTime())) {
    return null;
  }

  let latestPeriod: EnterpriseRampUpInvoicePeriod | null = null;
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const periodStart = addMonths(cycleStart, monthIndex);
    const periodEnd = addMonths(cycleStart, monthIndex + 1);
    if (periodEnd.getTime() > now.getTime()) {
      break;
    }
    latestPeriod = {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    };
  }
  return latestPeriod;
}

async function storeEnterpriseRampUpInvoiceState(
  db: D1Database,
  input: {
    workspaceId: string;
    periodStart: string;
    periodEnd: string;
    stripeInvoiceId: string;
    invoiceStatus: string | null;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET enterprise_ramp_up_last_invoice_period_start = ?,
           enterprise_ramp_up_last_invoice_period_end = ?,
           enterprise_ramp_up_last_invoice_id = ?,
           enterprise_ramp_up_last_invoice_status = ?,
           enterprise_ramp_up_last_invoice_hosted_url = ?,
           enterprise_ramp_up_last_invoiced_at = ?,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.periodStart,
      input.periodEnd,
      input.stripeInvoiceId,
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function storeEnterpriseAnnualOverageInvoiceState(
  db: D1Database,
  input: {
    workspaceId: string;
    periodStart: string;
    periodEnd: string;
    stripeInvoiceId: string;
    invoiceStatus: string | null;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET enterprise_annual_last_overage_invoice_period_start = ?,
           enterprise_annual_last_overage_invoice_period_end = ?,
           enterprise_annual_last_overage_invoice_id = ?,
           enterprise_annual_last_overage_invoice_status = ?,
           enterprise_annual_last_overage_invoice_hosted_url = ?,
           enterprise_annual_last_overage_invoiced_at = ?,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.periodStart,
      input.periodEnd,
      input.stripeInvoiceId,
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function updateEnterpriseRampUpInvoicePaymentState(
  db: D1Database,
  input: {
    workspaceId: string;
    enterpriseRampUpStatus: "active" | "suspended" | "expired";
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET enterprise_ramp_up_status = ?,
           enterprise_ramp_up_last_invoice_status = ?,
           enterprise_ramp_up_last_invoice_hosted_url = COALESCE(?, enterprise_ramp_up_last_invoice_hosted_url),
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.enterpriseRampUpStatus,
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function activateEnterpriseAnnualCommitment(
  db: D1Database,
  input: {
    workspaceId: string;
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    paidAt: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET enterprise_annual_status = 'active',
           enterprise_annual_upfront_invoice_status = ?,
           enterprise_annual_upfront_invoice_hosted_url = COALESCE(?, enterprise_annual_upfront_invoice_hosted_url),
           enterprise_annual_upfront_invoice_paid_at = ?,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.paidAt,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function storeEnterpriseAnnualUpfrontInvoiceStatus(
  db: D1Database,
  input: {
    workspaceId: string;
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET enterprise_annual_upfront_invoice_status = ?,
           enterprise_annual_upfront_invoice_hosted_url = COALESCE(?, enterprise_annual_upfront_invoice_hosted_url),
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function updateEnterpriseAnnualOverageInvoicePaymentState(
  db: D1Database,
  input: {
    workspaceId: string;
    enterpriseAnnualStatus: "active" | "suspended" | "expired";
    invoiceStatus: string;
    hostedInvoiceUrl: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET enterprise_annual_status = ?,
           enterprise_annual_last_overage_invoice_status = ?,
           enterprise_annual_last_overage_invoice_hosted_url = COALESCE(?, enterprise_annual_last_overage_invoice_hosted_url),
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(
      input.enterpriseAnnualStatus,
      input.invoiceStatus,
      input.hostedInvoiceUrl,
      input.now,
      input.workspaceId,
    )
    .run();
}

async function storeStripeCustomerIdForWorkspace(
  db: D1Database,
  input: { workspaceId: string; stripeCustomerId: string; now: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         stripe_customer_id,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         updated_at = excluded.updated_at`,
    )
    .bind(input.workspaceId, input.workspaceId, input.stripeCustomerId, input.now, input.now)
    .run();
}

async function createStripeCustomer(
  env: Env,
  input: { workspaceId: string; workspaceName: string; ownerEmail: string },
): Promise<{ id: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("name", input.workspaceName);
  body.set("email", input.ownerEmail);
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_customer_scope]", "workspace");

  const response = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `stripe-customer:${input.workspaceId}`,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_customer_failed",
      payload?.error?.message || "Stripe Customer creation failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_customer_failed", "Stripe Customer response was incomplete");
  }
  return { id: payload.id };
}

async function stripeCustomerHasDefaultPaymentMethod(env: Env, stripeCustomerId: string): Promise<boolean> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(stripeCustomerId)}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "stripe-version": STRIPE_API_VERSION,
    },
  });
  const payload = await response.json().catch(() => null) as {
    default_source?: unknown;
    invoice_settings?: {
      default_payment_method?: unknown;
    } | null;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_customer_lookup_failed",
      payload?.error?.message || "Stripe Customer lookup failed",
    );
  }

  return Boolean(
    String(payload?.invoice_settings?.default_payment_method || "").trim() ||
    String(payload?.default_source || "").trim(),
  );
}

type StripeBillingEvent = {
  id: string;
  type: string;
  data: {
    object?: {
      id?: unknown;
      status?: unknown;
      paid?: unknown;
      customer?: unknown;
      subscription?: unknown;
      billing_reason?: unknown;
      collection_method?: unknown;
      automatic_tax?: {
        status?: unknown;
        reason?: unknown;
      } | null;
      last_finalization_error?: {
        code?: unknown;
        type?: unknown;
      } | null;
      hosted_invoice_url?: unknown;
      payment_status?: unknown;
      payment_intent?: {
        status?: unknown;
      } | string | null;
      invoice?: unknown;
      metadata?: Record<string, unknown> | null;
      cancel_at_period_end?: unknown;
      current_period_start?: unknown;
      current_period_end?: unknown;
      items?: {
        data?: Array<{
          id?: unknown;
          price?: { id?: unknown } | null;
          current_period_start?: unknown;
          current_period_end?: unknown;
        }> | null;
      } | null;
      subscription_details?: {
        metadata?: Record<string, unknown> | null;
      } | null;
      parent?: {
        type?: unknown;
        subscription_details?: {
          metadata?: Record<string, unknown> | null;
          subscription?: unknown;
        } | null;
      } | null;
      lines?: {
        data?: Array<{
          subscription_item?: unknown;
          parent?: {
            subscription_item_details?: {
              subscription_item?: unknown;
            } | null;
          } | null;
          price?: { id?: unknown } | null;
          pricing?: {
            price_details?: {
              price?: unknown;
            } | null;
          } | null;
          period?: {
            start?: unknown;
            end?: unknown;
          } | null;
        }> | null;
      } | null;
    };
  };
};

type StripeInvoice = NonNullable<StripeBillingEvent["data"]["object"]>;
type StripeSubscription = StripeInvoice;

type StripeBillingEventProcessingResult = {
  workspaceId?: string;
  relatedStripeObjectId?: string;
  diagnosticDetails?: Record<string, unknown> | null;
  workspaceContextInvalidationReason?: WorkspaceContextInvalidationReason;
  workspaceContextInvalidationReasons?: WorkspaceContextInvalidationReason[];
};

type StripeInvoiceReference = {
  id: string | null;
  status: string | null;
  hostedInvoiceUrl: string | null;
};

function getStripeId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id.trim() : "";
  }
  return "";
}

function getStripeInvoiceReference(value: unknown): StripeInvoiceReference {
  if (!value) {
    return { id: null, status: null, hostedInvoiceUrl: null };
  }
  if (typeof value === "string") {
    return {
      id: value.trim() || null,
      status: null,
      hostedInvoiceUrl: null,
    };
  }
  if (typeof value !== "object") {
    return { id: null, status: null, hostedInvoiceUrl: null };
  }

  const invoice = value as {
    id?: unknown;
    status?: unknown;
    hosted_invoice_url?: unknown;
  };
  return {
    id: String(invoice.id || "").trim() || null,
    status: String(invoice.status || "").trim() || null,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
  };
}

function getCreditPackGrantIdempotencyKey(
  metadata: Record<string, unknown>,
  fallback: string,
  fallbackPrefix = "stripe_checkout_session",
): string {
  const purchaseId = String(metadata.purchase_id || "").trim();
  return purchaseId
    ? `stripe_credit_pack_purchase_${purchaseId}`
    : `${fallbackPrefix}_${fallback}`;
}

function getCreditPackPaymentFailedIdempotencyKey(
  metadata: Record<string, unknown>,
  fallback: string,
): string {
  const purchaseId = String(metadata.purchase_id || "").trim();
  return purchaseId
    ? `stripe_credit_pack_payment_failed_${purchaseId}`
    : `stripe_checkout_session_payment_failed_${fallback}`;
}

function normalizePaidSubscriptionInvoiceBillingAction(value: unknown): PaidSubscriptionInvoiceBillingAction | null {
  const action = String(value || "").trim() as PaidSubscriptionInvoiceBillingAction;
  return PAID_SUBSCRIPTION_INVOICE_BILLING_ACTIONS.has(action) ? action : null;
}

function getStripeInvoiceSubscriptionMetadata(invoice: StripeInvoice): Record<string, unknown> {
  return invoice.parent?.subscription_details?.metadata ||
    invoice.subscription_details?.metadata ||
    invoice.metadata ||
    {};
}

function getStripeInvoiceSubscriptionId(invoice: StripeInvoice): string {
  return getStripeId(invoice.subscription) || getStripeId(invoice.parent?.subscription_details?.subscription);
}

function getStripeInvoiceCustomerId(invoice: StripeInvoice): string {
  return getStripeId(invoice.customer);
}

function isPaidStripeInvoice(invoice: StripeInvoice | undefined): invoice is StripeInvoice {
  return Boolean(invoice && invoice.status === "paid" && invoice.paid !== false);
}

function getStripeSubscriptionCustomerId(subscription: StripeInvoice): string {
  return getStripeId(subscription.customer);
}

function getStripeSubscriptionMetadata(subscription: StripeInvoice): Record<string, unknown> {
  return subscription.metadata || {};
}

function getStripeSubscriptionItemForPrice(
  subscription: StripeInvoice,
  expectedPriceId: string,
): {
  id: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
} | null {
  const item = subscription.items?.data?.find((candidate) => getStripeId(candidate.price?.id) === expectedPriceId);
  if (!item) {
    return null;
  }
  const start = unixSecondsToIso(item.current_period_start) || unixSecondsToIso(subscription.current_period_start);
  const end = unixSecondsToIso(item.current_period_end) || unixSecondsToIso(subscription.current_period_end);
  return {
    id: getStripeId(item.id) || null,
    currentPeriodStart: start,
    currentPeriodEnd: end,
  };
}

function parseStripeBillingEvent(payload: string): StripeBillingEvent {
  try {
    const parsed = JSON.parse(payload) as Partial<StripeBillingEvent>;
    if (typeof parsed.id !== "string" || typeof parsed.type !== "string") {
      throw new Error("Invalid Stripe event");
    }
    return {
      id: parsed.id,
      type: parsed.type,
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
    } as StripeBillingEvent;
  } catch {
    throw new HttpError(400, "invalid_stripe_event", "Stripe webhook payload must be a valid event");
  }
}

function getStripeEventWorkspaceId(event: StripeBillingEvent): string | null {
  const invoiceMetadata = event.data.object
    ? getStripeInvoiceSubscriptionMetadata(event.data.object)
    : {};
  const workspaceId = String(
    event.data.object?.metadata?.workspace_id ||
      invoiceMetadata.workspace_id ||
      "",
  ).trim();
  return workspaceId || null;
}

function getStripeEventRelatedObjectId(event: StripeBillingEvent): string | null {
  const objectId = String(event.data.object?.id || "").trim();
  return objectId || null;
}

async function processCreditPackCheckoutCompleted(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const session = event.data.object;
  if (!session || session.payment_status !== "paid") {
    return {};
  }
  const metadata = session.metadata || {};
  if (metadata.billing_action !== "credit_pack_purchase") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const packSize = Number(metadata.credit_pack_size);
  const checkoutSessionId = String(session.id || "").trim();
  if (!workspaceId || !checkoutSessionId || ![100, 500, 1000, 5000].includes(packSize)) {
    throw new HttpError(400, "invalid_credit_pack_event", "Stripe Credit pack event metadata is incomplete");
  }
  const invoice = getStripeInvoiceReference(session.invoice);

  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await ledger.grantPurchasedCredits({
    workspaceId,
    credits: packSize,
    stripeEventId: event.id,
    checkoutSessionId,
    stripeInvoiceId: invoice.id,
    stripeInvoiceStatus: invoice.status,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    idempotencyKey: getCreditPackGrantIdempotencyKey(metadata, checkoutSessionId),
    occurredAt: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: checkoutSessionId,
    workspaceContextInvalidationReason: "billing_usage",
  };
}

async function processCreditPackCheckoutAsyncPaymentFailed(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const session = event.data.object;
  if (!session) {
    return {};
  }
  const metadata = session.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "credit_pack_purchase") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const packSize = Number(metadata.credit_pack_size);
  const checkoutSessionId = String(session.id || "").trim();
  if (!workspaceId || !checkoutSessionId || ![100, 500, 1000, 5000].includes(packSize)) {
    throw new HttpError(400, "invalid_credit_pack_event", "Stripe Credit pack event metadata is incomplete");
  }
  const invoice = getStripeInvoiceReference(session.invoice);

  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await ledger.recordCreditPackPaymentFailed({
    workspaceId,
    stripeEventId: event.id,
    checkoutSessionId,
    stripeInvoiceId: invoice.id,
    stripeInvoiceStatus: invoice.status || "payment_failed",
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    idempotencyKey: getCreditPackPaymentFailedIdempotencyKey(metadata, checkoutSessionId),
    occurredAt: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: checkoutSessionId,
    diagnosticDetails: {
      payment_outcome: "payment_failed",
      failure_class: "credit_pack_payment_failed",
      retry_guidance: "No retry needed; Stripe reported the delayed Credit pack payment failed.",
      manual_review_guidance: "Ask the Workspace owner to retry Credit pack Checkout if they still need Purchased Credits.",
    },
  };
}

async function processCreditPackInvoicePaid(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!isPaidStripeInvoice(invoice)) {
    return {};
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  if (String(metadata.billing_action || "").trim() !== "credit_pack_purchase") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const packSize = Number(metadata.credit_pack_size);
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId || ![100, 500, 1000, 5000].includes(packSize)) {
    throw new HttpError(400, "invalid_credit_pack_invoice_event", "Stripe Credit pack invoice metadata is incomplete");
  }

  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await ledger.grantPurchasedCredits({
    workspaceId,
    credits: packSize,
    stripeEventId: event.id,
    checkoutSessionId: null,
    stripeInvoiceId: invoiceId,
    stripeInvoiceStatus: String(invoice.status || "").trim() || "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    idempotencyKey: getCreditPackGrantIdempotencyKey(metadata, invoiceId, "stripe_invoice_credit_pack"),
    occurredAt: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_usage",
  };
}

async function repairPaidCreditPackCheckoutSession(
  env: Env,
  session: StripeCheckoutSession,
  now: Date,
): Promise<void> {
  if (!session || session.payment_status !== "paid") {
    return;
  }

  const metadata = session.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "credit_pack_purchase") {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const packSize = Number(metadata.credit_pack_size);
  const checkoutSessionId = String(session.id || "").trim();
  if (!workspaceId || !checkoutSessionId || ![100, 500, 1000, 5000].includes(packSize)) {
    return;
  }
  const invoice = getStripeInvoiceReference(session.invoice);

  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await ledger.grantPurchasedCredits({
    workspaceId,
    credits: packSize,
    stripeEventId: checkoutSessionId,
    checkoutSessionId,
    stripeInvoiceId: invoice.id,
    stripeInvoiceStatus: invoice.status,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    idempotencyKey: getCreditPackGrantIdempotencyKey(metadata, checkoutSessionId),
    occurredAt: now.toISOString(),
	  });
	}

async function recordFailedCreditPackCheckoutSessionFromReconciliation(
  env: Env,
  candidate: BillingReconciliationCandidate,
  session: StripeCheckoutSession,
  now: Date,
): Promise<void> {
  const metadata = session.metadata || {};
  if (
    String(metadata.workspace_id || "").trim() !== candidate.workspaceId ||
    String(metadata.billing_action || "").trim() !== "credit_pack_purchase"
  ) {
    return;
  }

  const checkoutSessionId = String(session.id || "").trim();
  const packSize = Number(metadata.credit_pack_size);
  if (!checkoutSessionId || ![100, 500, 1000, 5000].includes(packSize)) {
    return;
  }

  const invoice = getStripeInvoiceReference(session.invoice);
  const paymentStatus = String(session.payment_status || "").trim() || null;
  const invoiceStatus = String(invoice.status || "").trim() || null;
  if (!isFailedDelayedCreditPackCheckoutOutcome(paymentStatus, invoiceStatus)) {
    return;
  }

  const processedStatus = await getProcessedStripeBillingEventStatusForObject(env.DB, {
    workspaceId: candidate.workspaceId,
    relatedStripeObjectId: checkoutSessionId,
  });
  if (processedStatus === "processed") {
    return;
  }

  const ledger = getWorkspaceBillingLedger(env, candidate.workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await ledger.recordCreditPackPaymentFailed({
    workspaceId: candidate.workspaceId,
    stripeEventId: checkoutSessionId,
    checkoutSessionId,
    stripeInvoiceId: invoice.id,
    stripeInvoiceStatus: invoiceStatus || "payment_failed",
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    idempotencyKey: getCreditPackPaymentFailedIdempotencyKey(metadata, checkoutSessionId),
    occurredAt: now.toISOString(),
  });

  await recordBillingReconciliationDrift(env.DB, {
    id: createBillingReconciliationDriftId(
      candidate.workspaceId,
      "missed_failed_credit_pack_checkout",
      checkoutSessionId,
    ),
    workspace_id: candidate.workspaceId,
    drift_type: "missed_failed_credit_pack_checkout",
    severity: "warning",
    actionability: "informational",
    related_stripe_object_id: checkoutSessionId,
    observed: {
      stripe_object_type: "checkout.session",
      billing_action: "credit_pack_purchase",
      payment_status: paymentStatus,
      invoice_status: invoiceStatus,
    },
    expected: {
      workspace_id: candidate.workspaceId,
      failed_activity_recorded: true,
    },
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    status: "open",
  });
}

function isFailedDelayedCreditPackCheckoutOutcome(
  paymentStatus: string | null,
  invoiceStatus: string | null,
): boolean {
  if (paymentStatus === "paid") {
    return false;
  }
  return [
    "payment_failed",
    "failed",
    "uncollectible",
    "void",
    "voided",
  ].includes(String(invoiceStatus || "").trim());
}

async function repairPaidCreditPackInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  if (String(metadata.billing_action || "").trim() !== "credit_pack_purchase") {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const packSize = Number(metadata.credit_pack_size);
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId || ![100, 500, 1000, 5000].includes(packSize)) {
    return;
  }

  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await ledger.grantPurchasedCredits({
    workspaceId,
    credits: packSize,
    stripeEventId: invoiceId,
    checkoutSessionId: null,
    stripeInvoiceId: invoiceId,
    stripeInvoiceStatus: String(invoice.status || "").trim() || "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    idempotencyKey: getCreditPackGrantIdempotencyKey(metadata, invoiceId, "stripe_invoice_credit_pack"),
    occurredAt: now.toISOString(),
  });
}

async function repairPaidSubscriptionInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const billingAction = normalizePaidSubscriptionInvoiceBillingAction(metadata.billing_action);
  if (!billingAction) {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizeSubscriptionPlan(String(metadata.plan || "").trim().toLowerCase());
  const invoiceId = String(invoice.id || "").trim();
  const stripeSubscriptionId = getStripeInvoiceSubscriptionId(invoice);
  const stripeCustomerId = getStripeInvoiceCustomerId(invoice);
  if (!workspaceId || !plan || !invoiceId || !stripeSubscriptionId) {
    return;
  }

  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const period = getInvoiceLineBillingPeriod(invoice, expectedPriceId);
  if (!period) {
    return;
  }
  const stripeSubscriptionItemId = getInvoiceLineSubscriptionItemId(invoice, expectedPriceId);
  const planDefinition = NON_ENTERPRISE_BILLING_PLANS[plan];
  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await storeWorkspaceSubscriptionActivation(env.DB, {
    workspaceId,
    stripeCustomerId: stripeCustomerId || null,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    plan,
    status: "active",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    stripeInvoiceId: invoiceId,
    stripeInvoiceStatus: String(invoice.status || "").trim() || "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    now: now.toISOString(),
  });
  if (billingAction === "subscription_downgrade") {
    await clearWorkspaceScheduledEntitlement(env.DB, {
      workspaceId,
      now: now.toISOString(),
    });
  }

  const includedCreditsToGrant = billingAction === "subscription_upgrade"
    ? await calculateIncludedCreditUpgradeGrant(ledger, period, planDefinition.included_credits, planDefinition.limits.monthly_pages)
    : planDefinition.included_credits;
  if (includedCreditsToGrant > 0) {
    await ledger.grantIncludedCredits({
      workspaceId,
      credits: includedCreditsToGrant,
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      idempotencyKey: `stripe_invoice_${invoiceId}_included`,
      occurredAt: now.toISOString(),
      stripeInvoiceId: invoiceId,
      stripeInvoiceStatus: String(invoice.status || "").trim() || "paid",
      hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    });
  }
}

async function repairPaidPaymentRequiredPlanOverrideInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "payment_required_plan_override") {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizePlanOverrideTarget(metadata.plan);
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !plan || !invoiceId) {
    return;
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    return;
  }
  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (
    String(beforeControl?.payment_required_plan_override_invoice_id || "").trim() !== invoiceId ||
    String(beforeControl?.payment_required_plan_override_invoice_status || "").trim() === "paid"
  ) {
    return;
  }

  const checkedAt = now.toISOString();
  await activatePaymentRequiredPlanOverride(env.DB, {
    workspaceId,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.payment_required_plan_override_hosted_invoice_url || "").trim() || null,
    paidAt: checkedAt,
    now: checkedAt,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await grantCurrentOverrideIncludedCredits(env, workspace, afterControl, now);
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "payment_required_plan_override_payment_updated",
    actor_user_id: String(beforeControl?.payment_required_plan_override_created_by_user_id || "stripe"),
    reason: String(beforeControl?.payment_required_plan_override_reason || "Payment-required Plan override invoice paid"),
    before: paymentRequiredPlanOverrideAuditSnapshot(beforeControl),
    after: paymentRequiredPlanOverrideAuditSnapshot(afterControl),
    occurred_at: checkedAt,
  });
}

async function repairPaidEnterpriseAnnualUpfrontInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_annual_upfront_invoice") {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    return;
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (
    String(beforeControl?.enterprise_annual_upfront_invoice_id || "").trim() !== invoiceId ||
    String(beforeControl?.enterprise_annual_upfront_invoice_status || "").trim() === "paid"
  ) {
    return;
  }

  const checkedAt = now.toISOString();
  await activateEnterpriseAnnualCommitment(env.DB, {
    workspaceId,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_annual_upfront_invoice_hosted_url || "").trim() || null,
    paidAt: checkedAt,
    now: checkedAt,
  });
}

async function repairPaidEnterpriseAnnualOverageInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_annual_overage_invoice") {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    return;
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (
    String(beforeControl?.enterprise_annual_last_overage_invoice_id || "").trim() !== invoiceId ||
    String(beforeControl?.enterprise_annual_last_overage_invoice_status || "").trim() === "paid"
  ) {
    return;
  }

  const enterpriseAnnual = buildEnterpriseAnnualCommitmentState(beforeControl);
  const restoredStatus = enterpriseAnnual &&
      now.getTime() >= new Date(enterpriseAnnual.starts_at).getTime() &&
      now.getTime() < new Date(enterpriseAnnual.ends_at).getTime()
    ? "active"
    : "expired";
  await updateEnterpriseAnnualOverageInvoicePaymentState(env.DB, {
    workspaceId,
    enterpriseAnnualStatus: restoredStatus,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_annual_last_overage_invoice_hosted_url || "").trim() || null,
    now: now.toISOString(),
  });
}

async function repairPaidEnterpriseRampUpInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  if (!isPaidStripeInvoice(invoice)) {
    return;
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_ramp_up_invoice") {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    return;
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (
    String(beforeControl?.enterprise_ramp_up_last_invoice_id || "").trim() !== invoiceId ||
    String(beforeControl?.enterprise_ramp_up_last_invoice_status || "").trim() === "paid"
  ) {
    return;
  }

  const enterpriseRampUp = buildEnterpriseRampUpState(beforeControl);
  const restoredStatus = enterpriseRampUp &&
      now.getTime() >= new Date(enterpriseRampUp.starts_at).getTime() &&
      now.getTime() < new Date(enterpriseRampUp.ends_at).getTime()
    ? "active"
    : "expired";
  await updateEnterpriseRampUpInvoicePaymentState(env.DB, {
    workspaceId,
    enterpriseRampUpStatus: restoredStatus,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_ramp_up_last_invoice_hosted_url || "").trim() || null,
    now: now.toISOString(),
  });
}

async function repairMissedUnpaidSubscriptionInvoice(
  env: Env,
  invoice: StripeInvoice,
  now: Date,
): Promise<void> {
  const unpaidOutcome = getReconciledSubscriptionInvoiceUnpaidOutcome(invoice);
  if (!unpaidOutcome) {
    return;
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const billingAction = normalizePaidSubscriptionInvoiceBillingAction(metadata.billing_action);
  if (!billingAction) {
    return;
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizeSubscriptionPlan(String(metadata.plan || "").trim().toLowerCase());
  const stripeSubscriptionId = getStripeInvoiceSubscriptionId(invoice);
  const stripeCustomerId = getStripeInvoiceCustomerId(invoice);
  if (!workspaceId || !plan || !stripeSubscriptionId) {
    return;
  }

  const control = await getWorkspaceBillingControl(env.DB, workspaceId);
  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const period = getInvoiceLineBillingPeriod(invoice, expectedPriceId);
  if (!period) {
    return;
  }
  const existingPeriodStart = normalizeIsoDateOrNull(control?.stripe_subscription_current_period_start);
  if (existingPeriodStart && new Date(existingPeriodStart).getTime() > new Date(period.start).getTime()) {
    return;
  }
  if (
    String(control?.self_service_subscription_invoice_id || "").trim() === String(invoice.id || "").trim() &&
    String(control?.self_service_subscription_invoice_status || "").trim() === "paid"
  ) {
    return;
  }

  await storeWorkspaceSubscriptionActivation(env.DB, {
    workspaceId,
    stripeCustomerId: stripeCustomerId || null,
    stripeSubscriptionId,
    stripeSubscriptionItemId: getInvoiceLineSubscriptionItemId(invoice, expectedPriceId),
    plan,
    status: "unpaid",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    stripeInvoiceId: String(invoice.id || "").trim() || null,
    stripeInvoiceStatus: unpaidOutcome.invoiceStatus,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    invoiceDiagnostics: unpaidOutcome.invoiceDiagnostics,
    now: now.toISOString(),
  });
}

function getReconciledSubscriptionInvoiceUnpaidOutcome(
  invoice: StripeInvoice,
): { invoiceStatus: string; invoiceDiagnostics: Record<string, unknown> | null } | null {
  const invoiceStatus = normalizeStoredInvoiceStatus(invoice.status);
  if (["void", "uncollectible"].includes(invoiceStatus)) {
    return { invoiceStatus, invoiceDiagnostics: null };
  }
  if (invoiceStatus === "payment_action_required") {
    return { invoiceStatus: "payment_action_required", invoiceDiagnostics: null };
  }
  if (invoiceStatus === "payment_failed") {
    return { invoiceStatus: "payment_failed", invoiceDiagnostics: null };
  }
  if (invoiceStatus === "finalization_failed") {
    return {
      invoiceStatus: "finalization_failed",
      invoiceDiagnostics: getStripeInvoiceFinalizationFailureDiagnostics(invoice),
    };
  }

  const paymentIntentStatus = getStripeInvoicePaymentIntentStatus(invoice);
  if (paymentIntentStatus === "requires_action") {
    return { invoiceStatus: "payment_action_required", invoiceDiagnostics: null };
  }
  if (paymentIntentStatus === "requires_payment_method" || paymentIntentStatus === "canceled") {
    return { invoiceStatus: "payment_failed", invoiceDiagnostics: null };
  }

  const finalizationDiagnostics = getStripeInvoiceFinalizationFailureDiagnostics(invoice);
  if (finalizationDiagnostics && (invoiceStatus === "draft" || invoiceStatus === "open")) {
    return { invoiceStatus: "finalization_failed", invoiceDiagnostics: finalizationDiagnostics };
  }

  return null;
}

function getStripeInvoicePaymentIntentStatus(invoice: StripeInvoice): string | null {
  const paymentIntent = invoice.payment_intent;
  if (!paymentIntent || typeof paymentIntent !== "object") {
    return null;
  }
  return stringValueOrNull(paymentIntent.status);
}

async function processPaymentRequiredPlanOverrideInvoicePaid(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!isPaidStripeInvoice(invoice)) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "payment_required_plan_override") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizePlanOverrideTarget(metadata.plan);
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !plan || !invoiceId) {
    throw new HttpError(400, "invalid_payment_required_override_invoice_event", "Stripe payment-required override invoice event metadata is incomplete");
  }

  const workspace = await getWorkspaceForApplicationAdminBilling(env.DB, workspaceId);
  if (!workspace) {
    throw new HttpError(404, "not_found", "Workspace not found");
  }
  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.payment_required_plan_override_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_payment_required_override_invoice_event", "Stripe payment-required override invoice event metadata is incomplete");
  }

  const now = new Date().toISOString();
  if (String(beforeControl?.payment_required_plan_override_invoice_status || "").trim() === "paid") {
    const hostedInvoiceUrl = String(invoice.hosted_invoice_url || "").trim();
    if (
      hostedInvoiceUrl &&
      hostedInvoiceUrl !== String(beforeControl?.payment_required_plan_override_hosted_invoice_url || "").trim()
    ) {
      await storePaymentRequiredPlanOverrideInvoiceStatus(env.DB, {
        workspaceId,
        invoiceStatus: "paid",
        hostedInvoiceUrl,
        now,
      });
    }
    return { workspaceId, relatedStripeObjectId: invoiceId };
  }

  await activatePaymentRequiredPlanOverride(env.DB, {
    workspaceId,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.payment_required_plan_override_hosted_invoice_url || "").trim() || null,
    paidAt: now,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await grantCurrentOverrideIncludedCredits(env, workspace, afterControl, new Date(now));
  try {
    await recordApplicationAdminBillingAuditEntry(env.DB, {
      id: createAuditEntryId(),
      workspace_id: workspaceId,
      action: "payment_required_plan_override_payment_updated",
      actor_user_id: String(beforeControl?.payment_required_plan_override_created_by_user_id || "stripe"),
      reason: String(beforeControl?.payment_required_plan_override_reason || "Payment-required Plan override invoice paid"),
      before: paymentRequiredPlanOverrideAuditSnapshot(beforeControl),
      after: paymentRequiredPlanOverrideAuditSnapshot(afterControl),
      occurred_at: now,
    });
  } catch (error) {
    await emitStripeBillingWorkspaceContextInvalidations(env, workspaceId, {
      workspaceContextInvalidationReasons: ["billing_entitlement", "billing_usage"],
    });
    throw error;
  }

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReasons: ["billing_entitlement", "billing_usage"],
  };
}

async function processPaymentRequiredPlanOverrideInvoiceStatusUpdated(
  env: Env,
  event: StripeBillingEvent,
  invoiceStatus: string,
  auditReason: string,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!invoice) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "payment_required_plan_override") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_payment_required_override_invoice_event", "Stripe payment-required override invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.payment_required_plan_override_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_payment_required_override_invoice_event", "Stripe payment-required override invoice event metadata is incomplete");
  }

  const nextStatus = String(invoiceStatus || invoice.status || "").trim();
  if (!nextStatus) {
    throw new HttpError(400, "invalid_payment_required_override_invoice_event", "Stripe payment-required override invoice event metadata is incomplete");
  }
  const nextHostedInvoiceUrl = String(
    invoice.hosted_invoice_url || beforeControl?.payment_required_plan_override_hosted_invoice_url || "",
  ).trim() || null;
  if (
    String(beforeControl?.payment_required_plan_override_invoice_status || "").trim() === nextStatus &&
    String(beforeControl?.payment_required_plan_override_hosted_invoice_url || "").trim() === String(nextHostedInvoiceUrl || "").trim()
  ) {
    return { workspaceId, relatedStripeObjectId: invoiceId };
  }

  const now = new Date().toISOString();
  await storePaymentRequiredPlanOverrideInvoiceStatus(env.DB, {
    workspaceId,
    invoiceStatus: nextStatus,
    hostedInvoiceUrl: nextHostedInvoiceUrl,
    now,
  });
  const afterControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  await recordApplicationAdminBillingAuditEntry(env.DB, {
    id: createAuditEntryId(),
    workspace_id: workspaceId,
    action: "payment_required_plan_override_payment_updated",
    actor_user_id: String(beforeControl?.payment_required_plan_override_created_by_user_id || "stripe"),
    reason: String(beforeControl?.payment_required_plan_override_reason || auditReason),
    before: paymentRequiredPlanOverrideAuditSnapshot(beforeControl),
    after: paymentRequiredPlanOverrideAuditSnapshot(afterControl),
    occurred_at: now,
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processEnterpriseAnnualUpfrontInvoicePaid(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!isPaidStripeInvoice(invoice)) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_annual_upfront_invoice") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_invoice_event", "Stripe Enterprise annual invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.enterprise_annual_upfront_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_invoice_event", "Stripe Enterprise annual invoice event metadata is incomplete");
  }

  const now = new Date().toISOString();
  await activateEnterpriseAnnualCommitment(env.DB, {
    workspaceId,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_annual_upfront_invoice_hosted_url || "").trim() || null,
    paidAt: now,
    now,
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processEnterpriseAnnualUpfrontInvoiceStatusUpdated(
  env: Env,
  event: StripeBillingEvent,
  invoiceStatus: string,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!invoice) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_annual_upfront_invoice") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_invoice_event", "Stripe Enterprise annual invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.enterprise_annual_upfront_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_invoice_event", "Stripe Enterprise annual invoice event metadata is incomplete");
  }

  await storeEnterpriseAnnualUpfrontInvoiceStatus(env.DB, {
    workspaceId,
    invoiceStatus,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_annual_upfront_invoice_hosted_url || "").trim() || null,
    now: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processEnterpriseAnnualOverageInvoicePaid(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!isPaidStripeInvoice(invoice)) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_annual_overage_invoice") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_overage_invoice_event", "Stripe Enterprise annual overage invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.enterprise_annual_last_overage_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_overage_invoice_event", "Stripe Enterprise annual overage invoice event metadata is incomplete");
  }

  const now = new Date();
  const enterpriseAnnual = buildEnterpriseAnnualCommitmentState(beforeControl);
  const restoredStatus = enterpriseAnnual &&
      now.getTime() >= new Date(enterpriseAnnual.starts_at).getTime() &&
      now.getTime() < new Date(enterpriseAnnual.ends_at).getTime()
    ? "active"
    : "expired";
  await updateEnterpriseAnnualOverageInvoicePaymentState(env.DB, {
    workspaceId,
    enterpriseAnnualStatus: restoredStatus,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_annual_last_overage_invoice_hosted_url || "").trim() || null,
    now: now.toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processEnterpriseAnnualOverageInvoiceUnpaidState(
  env: Env,
  event: StripeBillingEvent,
  invoiceStatus: string,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!invoice) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_annual_overage_invoice") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_overage_invoice_event", "Stripe Enterprise annual overage invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.enterprise_annual_last_overage_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_enterprise_annual_overage_invoice_event", "Stripe Enterprise annual overage invoice event metadata is incomplete");
  }

  await updateEnterpriseAnnualOverageInvoicePaymentState(env.DB, {
    workspaceId,
    enterpriseAnnualStatus: "suspended",
    invoiceStatus,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_annual_last_overage_invoice_hosted_url || "").trim() || null,
    now: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processEnterpriseRampUpInvoicePaid(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!isPaidStripeInvoice(invoice)) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_ramp_up_invoice") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_enterprise_ramp_up_invoice_event", "Stripe Enterprise ramp-up invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.enterprise_ramp_up_last_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_enterprise_ramp_up_invoice_event", "Stripe Enterprise ramp-up invoice event metadata is incomplete");
  }

  const now = new Date();
  const enterpriseRampUp = buildEnterpriseRampUpState(beforeControl);
  const restoredStatus = enterpriseRampUp &&
      now.getTime() >= new Date(enterpriseRampUp.starts_at).getTime() &&
      now.getTime() < new Date(enterpriseRampUp.ends_at).getTime()
    ? "active"
    : "expired";
  await updateEnterpriseRampUpInvoicePaymentState(env.DB, {
    workspaceId,
    enterpriseRampUpStatus: restoredStatus,
    invoiceStatus: "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_ramp_up_last_invoice_hosted_url || "").trim() || null,
    now: now.toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processEnterpriseRampUpInvoiceUnpaidState(
  env: Env,
  event: StripeBillingEvent,
  invoiceStatus: string,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!invoice) {
    return {};
  }

  const metadata = invoice.metadata || {};
  if (String(metadata.billing_action || "").trim() !== "enterprise_ramp_up_invoice") {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const invoiceId = String(invoice.id || "").trim();
  if (!workspaceId || !invoiceId) {
    throw new HttpError(400, "invalid_enterprise_ramp_up_invoice_event", "Stripe Enterprise ramp-up invoice event metadata is incomplete");
  }

  const beforeControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (String(beforeControl?.enterprise_ramp_up_last_invoice_id || "").trim() !== invoiceId) {
    throw new HttpError(400, "invalid_enterprise_ramp_up_invoice_event", "Stripe Enterprise ramp-up invoice event metadata is incomplete");
  }

  await updateEnterpriseRampUpInvoicePaymentState(env.DB, {
    workspaceId,
    enterpriseRampUpStatus: "suspended",
    invoiceStatus,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || beforeControl?.enterprise_ramp_up_last_invoice_hosted_url || "").trim() || null,
    now: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function processSubscriptionInvoicePaid(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!isPaidStripeInvoice(invoice)) {
    return {};
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const billingAction = normalizePaidSubscriptionInvoiceBillingAction(metadata.billing_action);
  if (!billingAction) {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizeSubscriptionPlan(String(metadata.plan || "").trim().toLowerCase());
  const invoiceId = String(invoice.id || "").trim();
  const stripeSubscriptionId = getStripeInvoiceSubscriptionId(invoice);
  const stripeCustomerId = getStripeInvoiceCustomerId(invoice);
  if (!workspaceId || !plan || !invoiceId || !stripeSubscriptionId) {
    throw new HttpError(400, "invalid_subscription_invoice_event", "Stripe subscription invoice event metadata is incomplete");
  }

  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const period = getInvoiceLineBillingPeriod(invoice, expectedPriceId);
  if (!period) {
    throw new HttpError(400, "invalid_subscription_invoice_event", "Stripe subscription invoice event metadata is incomplete");
  }
  const stripeSubscriptionItemId = getInvoiceLineSubscriptionItemId(invoice, expectedPriceId);

  const planDefinition = NON_ENTERPRISE_BILLING_PLANS[plan];
  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  if (!ledger) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }

  await storeWorkspaceSubscriptionActivation(env.DB, {
    workspaceId,
    stripeCustomerId: stripeCustomerId || null,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    plan,
    status: "active",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    stripeInvoiceId: invoiceId,
    stripeInvoiceStatus: String(invoice.status || "").trim() || "paid",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    now: new Date().toISOString(),
  });
  if (billingAction === "subscription_downgrade") {
    await clearWorkspaceScheduledEntitlement(env.DB, {
      workspaceId,
      now: new Date().toISOString(),
    });
  }
  const includedCreditsToGrant = billingAction === "subscription_upgrade"
    ? await calculateIncludedCreditUpgradeGrant(ledger, period, planDefinition.included_credits, planDefinition.limits.monthly_pages)
    : planDefinition.included_credits;
  if (includedCreditsToGrant > 0) {
    await ledger.grantIncludedCredits({
      workspaceId,
      credits: includedCreditsToGrant,
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      idempotencyKey: `stripe_invoice_${invoiceId}_included`,
      occurredAt: new Date().toISOString(),
      stripeInvoiceId: invoiceId,
      stripeInvoiceStatus: String(invoice.status || "").trim() || "paid",
      hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    });
  }

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReasons: ["billing_entitlement", "billing_usage"],
  };
}

async function processSubscriptionManualCollectionInvoiceFinalized(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!invoice) {
    return {};
  }
  if (
    String(invoice.collection_method || "").trim() !== "send_invoice" ||
    String(invoice.status || "").trim() !== "open"
  ) {
    return {};
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const billingAction = String(metadata.billing_action || "").trim();
  if (
    billingAction !== "subscription_start" &&
    billingAction !== "subscription_upgrade" &&
    billingAction !== "subscription_renewal"
  ) {
    return {};
  }

  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizeSubscriptionPlan(String(metadata.plan || "").trim().toLowerCase());
  const invoiceId = String(invoice.id || "").trim();
  const stripeSubscriptionId = getStripeInvoiceSubscriptionId(invoice);
  const stripeCustomerId = getStripeInvoiceCustomerId(invoice);
  if (!workspaceId || !plan || !invoiceId || !stripeSubscriptionId) {
    throw new HttpError(400, "invalid_subscription_invoice_event", "Stripe subscription invoice event metadata is incomplete");
  }

  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const period = getInvoiceLineBillingPeriod(invoice, expectedPriceId);
  if (!period) {
    throw new HttpError(400, "invalid_subscription_invoice_event", "Stripe subscription invoice event metadata is incomplete");
  }

  await storeWorkspaceSubscriptionActivation(env.DB, {
    workspaceId,
    stripeCustomerId: stripeCustomerId || null,
    stripeSubscriptionId,
    stripeSubscriptionItemId: getInvoiceLineSubscriptionItemId(invoice, expectedPriceId),
    plan,
    status: "unpaid",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    stripeInvoiceId: invoiceId,
    stripeInvoiceStatus: String(invoice.status || "").trim() || "open",
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    now: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
  };
}

async function calculateIncludedCreditUpgradeGrant(
  ledger: BillingLedgerRpc,
  period: { start: string; end: string },
  targetIncludedCredits: number,
  monthlyPageLimit: number,
): Promise<number> {
  const summary = await ledger.summarizeOwnerBilling({
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
    monthlyPageLimit,
  });
  return Math.max(0, targetIncludedCredits - Number(summary.credits.included_available || 0));
}

async function processSubscriptionInvoicePaymentFailed(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  return processSubscriptionInvoiceUnpaidState(env, event, "payment_failed", null, true);
}

async function processSubscriptionInvoicePaymentActionRequired(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  return processSubscriptionInvoiceUnpaidState(env, event, "payment_action_required");
}

async function processSubscriptionInvoiceFinalizationFailed(
  env: Env,
  event: StripeBillingEvent,
): Promise<StripeBillingEventProcessingResult> {
  return processSubscriptionInvoiceUnpaidState(
    env,
    event,
    "finalization_failed",
    getStripeInvoiceFinalizationFailureDiagnostics(event.data.object),
  );
}

async function processSubscriptionInvoiceTerminalUnpaidState(
  env: Env,
  event: StripeBillingEvent,
  invoiceStatus: string,
): Promise<StripeBillingEventProcessingResult> {
  return processSubscriptionInvoiceUnpaidState(env, event, invoiceStatus);
}

async function processSubscriptionInvoiceUnpaidState(
  env: Env,
  event: StripeBillingEvent,
  fallbackInvoiceStatus: string,
  invoiceDiagnostics: Record<string, unknown> | null = null,
  preferStripeInvoiceStatus = false,
): Promise<StripeBillingEventProcessingResult> {
  const invoice = event.data.object;
  if (!invoice) {
    return {};
  }

  const metadata = getStripeInvoiceSubscriptionMetadata(invoice);
  const workspaceId = String(metadata.workspace_id || "").trim();
  const plan = normalizeSubscriptionPlan(String(metadata.plan || "").trim().toLowerCase());
  const invoiceId = String(invoice.id || "").trim();
  const stripeSubscriptionId = getStripeInvoiceSubscriptionId(invoice);
  const stripeCustomerId = getStripeInvoiceCustomerId(invoice);
  if (!workspaceId || !plan || !invoiceId || !stripeSubscriptionId) {
    throw new HttpError(400, "invalid_subscription_invoice_event", "Stripe subscription invoice event metadata is incomplete");
  }

  const expectedPriceId = getConfiguredStripePriceId(env, `STRIPE_${plan.toUpperCase()}_MONTHLY_PRICE_ID`);
  const period = getInvoiceLineBillingPeriod(invoice, expectedPriceId);
  if (!period) {
    throw new HttpError(400, "invalid_subscription_invoice_event", "Stripe subscription invoice event metadata is incomplete");
  }
  const stripeSubscriptionItemId = getInvoiceLineSubscriptionItemId(invoice, expectedPriceId);

  await storeWorkspaceSubscriptionActivation(env.DB, {
    workspaceId,
    stripeCustomerId: stripeCustomerId || null,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    plan,
    status: "unpaid",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    stripeInvoiceId: invoiceId,
    stripeInvoiceStatus: preferStripeInvoiceStatus
      ? String(invoice.status || "").trim() || fallbackInvoiceStatus
      : fallbackInvoiceStatus,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || "").trim() || null,
    invoiceDiagnostics,
    now: new Date().toISOString(),
  });

  return {
    workspaceId,
    relatedStripeObjectId: invoiceId,
    workspaceContextInvalidationReason: "billing_entitlement",
    diagnosticDetails: invoiceDiagnostics
      ? {
          payment_outcome: fallbackInvoiceStatus,
          failure_class: "subscription_invoice_finalization_failed",
          ...invoiceDiagnostics,
          retry_guidance: "Stripe can retry invoice finalization after the Workspace owner or operator repairs tax or billing-location inputs.",
          manual_review_guidance: "Review the Stripe invoice finalization failure and Workspace billing state without storing raw Stripe payloads.",
        }
      : null,
  };
}

function getStripeInvoiceFinalizationFailureDiagnostics(
  invoice: StripeInvoice | undefined,
): Record<string, unknown> | null {
  if (!invoice) {
    return null;
  }
  const diagnostics = {
    automatic_tax_status: stringValueOrNull(invoice.automatic_tax?.status),
    automatic_tax_reason: stringValueOrNull(invoice.automatic_tax?.reason),
    last_finalization_error_code: stringValueOrNull(invoice.last_finalization_error?.code),
  };
  return Object.values(diagnostics).some(Boolean) ? diagnostics : null;
}

function normalizeSubscriptionPlan(plan: string): "pro" | "max" | null {
  if (plan === "pro" || plan === "max") {
    return plan;
  }
  return null;
}

function normalizeSubscriptionChangePlan(plan: string): "free" | "pro" | "max" | null {
  if (plan === "free" || plan === "pro" || plan === "max") {
    return plan;
  }
  return null;
}

async function scheduleFreeSubscriptionDowngrade(
  env: Env,
  workspaceId: string,
  control: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
  effectiveAt: string,
): Promise<{ subscription_id: string; scheduled_plan: "free"; effective_at: string }> {
  const stripeSubscriptionId = String(control?.stripe_subscription_id || "").trim();
  if (!stripeSubscriptionId) {
    throw new HttpError(409, "subscription_change_unavailable", "Workspace subscription cannot be changed yet");
  }

  const subscription = await updateStripeSubscriptionCancellation(env, {
    workspaceId,
    stripeSubscriptionId,
    idempotencyKey: `subscription-cancel:${workspaceId}:${crypto.randomUUID()}`,
  });
  await storeWorkspaceScheduledEntitlement(env.DB, {
    workspaceId,
    plan: "free",
    effectiveAt,
    now: new Date().toISOString(),
  });
  await emitBillingWorkspaceContextInvalidation(env, workspaceId, "billing_entitlement");

  return {
    subscription_id: subscription.id,
    scheduled_plan: "free",
    effective_at: effectiveAt,
  };
}

function getInvoiceLineBillingPeriod(
  invoice: NonNullable<StripeBillingEvent["data"]["object"]>,
  expectedPriceId: string,
): {
  start: string;
  end: string;
} | null {
  const line = invoice.lines?.data?.find((item) => (
    getInvoiceLinePriceId(item) === expectedPriceId &&
    item.period?.start &&
    item.period?.end
  ));
  const start = unixSecondsToIso(line?.period?.start);
  const end = unixSecondsToIso(line?.period?.end);
  if (!start || !end) {
    return null;
  }
  return { start, end };
}

function getInvoiceLineSubscriptionItemId(
  invoice: NonNullable<StripeBillingEvent["data"]["object"]>,
  expectedPriceId: string,
): string | null {
  const line = invoice.lines?.data?.find((item) => getInvoiceLinePriceId(item) === expectedPriceId);
  const directSubscriptionItem = String(line?.subscription_item || "").trim();
  if (directSubscriptionItem) {
    return directSubscriptionItem;
  }
  const parentSubscriptionItem = String(line?.parent?.subscription_item_details?.subscription_item || "").trim();
  return parentSubscriptionItem || null;
}

function getInvoiceLinePriceId(
  line: NonNullable<NonNullable<StripeInvoice["lines"]>["data"]>[number] | null | undefined,
): string {
  return getStripeId(line?.price?.id) || getStripeId(line?.pricing?.price_details?.price);
}

function unixSecondsToIso(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function normalizeIsoDateOrNull(value: unknown): string | null {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function addMonths(value: Date, months: number): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

async function hasProcessedStripeBillingEvent(db: D1Database, eventId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT event_id
       FROM workspace_billing_stripe_events
       WHERE event_id = ?
         AND processed_status = 'processed'
       LIMIT 1`,
    )
    .bind(eventId)
    .first<{ event_id: string }>();
  return Boolean(row?.event_id);
}

async function recordProcessedStripeBillingEvent(
  db: D1Database,
  input: {
    eventId: string;
    type: string;
    workspaceId: string | null;
    relatedStripeObjectId: string | null;
    processedStatus: "processed" | "ignored" | "failed";
    errorDetails: string | null;
    receivedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_stripe_events (
         event_id,
         type,
         received_at,
         processed_status,
         workspace_id,
         related_stripe_object_id,
         error_details
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         processed_status = excluded.processed_status,
         workspace_id = COALESCE(excluded.workspace_id, workspace_billing_stripe_events.workspace_id),
         related_stripe_object_id = COALESCE(excluded.related_stripe_object_id, workspace_billing_stripe_events.related_stripe_object_id),
         error_details = excluded.error_details`,
    )
    .bind(
      input.eventId,
      input.type,
      input.receivedAt,
      input.processedStatus,
      input.workspaceId,
      input.relatedStripeObjectId,
      input.errorDetails,
    )
    .run();
}

async function getStripeEventDiagnosticsState(
  db: D1Database,
  workspaceId: string,
): Promise<StripeEventDiagnosticsState> {
  const result = await db
    .prepare(
	      `SELECT event_id,
	              type,
	              received_at,
	              processed_status,
	              workspace_id,
	              related_stripe_object_id,
	              error_details
	       FROM workspace_billing_stripe_events
	       WHERE workspace_id = ?
	         AND (
	           processed_status IN ('ignored', 'failed')
	           OR (processed_status = 'processed' AND error_details IS NOT NULL)
	         )
	       ORDER BY received_at DESC, event_id DESC
	       LIMIT 20`,
    )
    .bind(workspaceId)
    .all<{
      event_id: string;
      type: string;
      received_at: string;
	      processed_status: "processed" | "ignored" | "failed";
      workspace_id?: string | null;
	      related_stripe_object_id?: string | null;
	      error_details?: string | null;
	    }>();

	  const recentEvents = (result.results || []).map((row) => {
	    const details = parseJsonRecord(String(row.error_details || ""));
	    const outcome: StripeEventDiagnostic["outcome"] = details.payment_outcome === "payment_failed"
	      ? "payment_failed"
	      : row.processed_status === "failed"
	        ? "failed"
	        : "ignored";
	    return {
      event_id: row.event_id,
      type: row.type,
      outcome,
      workspace_id: row.workspace_id ?? null,
      related_stripe_object_id: row.related_stripe_object_id ?? null,
      failure_class: stringValueOrNull(details.failure_class),
      retry_guidance: stringValueOrNull(details.retry_guidance),
      manual_review_guidance: stringValueOrNull(details.manual_review_guidance),
      received_at: row.received_at,
    };
  });

	  return {
	    ignored_event_count: recentEvents.filter((event) => event.outcome === "ignored").length,
	    failed_event_count: recentEvents.filter((event) => event.outcome === "failed").length,
	    payment_failed_event_count: recentEvents.filter((event) => event.outcome === "payment_failed").length,
	    recent_events: recentEvents,
	  };
	}

async function storeWorkspaceSubscriptionActivation(
  db: D1Database,
  input: {
    workspaceId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string;
    stripeSubscriptionItemId: string | null;
    plan: "pro" | "max";
    status: "active" | "unpaid";
    currentPeriodStart: string;
    currentPeriodEnd: string;
    stripeInvoiceId?: string | null;
    stripeInvoiceStatus?: string | null;
    hostedInvoiceUrl?: string | null;
    invoiceDiagnostics?: Record<string, unknown> | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         stripe_customer_id,
         stripe_subscription_id,
         stripe_subscription_item_id,
         self_service_subscription_plan,
         self_service_subscription_status,
         stripe_subscription_current_period_start,
         stripe_subscription_current_period_end,
         self_service_subscription_invoice_id,
         self_service_subscription_invoice_status,
         self_service_subscription_hosted_invoice_url,
         self_service_subscription_invoice_diagnostics,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, workspace_billing_controls.stripe_customer_id),
         stripe_subscription_id = excluded.stripe_subscription_id,
         stripe_subscription_item_id = COALESCE(excluded.stripe_subscription_item_id, workspace_billing_controls.stripe_subscription_item_id),
         self_service_subscription_plan = excluded.self_service_subscription_plan,
         self_service_subscription_status = excluded.self_service_subscription_status,
         stripe_subscription_current_period_start = excluded.stripe_subscription_current_period_start,
         stripe_subscription_current_period_end = excluded.stripe_subscription_current_period_end,
         self_service_subscription_invoice_id = COALESCE(excluded.self_service_subscription_invoice_id, workspace_billing_controls.self_service_subscription_invoice_id),
         self_service_subscription_invoice_status = COALESCE(excluded.self_service_subscription_invoice_status, workspace_billing_controls.self_service_subscription_invoice_status),
         self_service_subscription_hosted_invoice_url = COALESCE(excluded.self_service_subscription_hosted_invoice_url, workspace_billing_controls.self_service_subscription_hosted_invoice_url),
         self_service_subscription_invoice_diagnostics = excluded.self_service_subscription_invoice_diagnostics,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.workspaceId,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.stripeSubscriptionItemId,
      input.plan,
      input.status,
      input.currentPeriodStart,
      input.currentPeriodEnd,
      String(input.stripeInvoiceId || "").trim() || null,
      String(input.stripeInvoiceStatus || "").trim() || null,
      String(input.hostedInvoiceUrl || "").trim() || null,
      input.invoiceDiagnostics ? JSON.stringify(input.invoiceDiagnostics) : null,
      input.now,
      input.now,
    )
    .run();

  if (input.status === "active") {
    await clearActiveFreePlanOverrideForPaidSubscription(db, {
      workspaceId: input.workspaceId,
      now: input.now,
    });
  }
}

async function clearActiveFreePlanOverrideForPaidSubscription(
  db: D1Database,
  input: {
    workspaceId: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET plan_override_plan = NULL,
           plan_override_start_at = NULL,
           plan_override_end_at = NULL,
           plan_override_reason = NULL,
           plan_override_created_by_user_id = NULL,
           plan_override_created_at = NULL,
           updated_at = ?
       WHERE workspace_id = ?
         AND plan_override_plan = 'free'
         AND plan_override_start_at <= ?
         AND plan_override_end_at > ?`,
    )
    .bind(input.now, input.workspaceId, input.now, input.now)
    .run();
}

async function storeWorkspaceScheduledEntitlement(
  db: D1Database,
  input: {
    workspaceId: string;
    plan: "free" | "pro" | "max";
    effectiveAt: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_controls (
         workspace_id,
         ledger_object_name,
         scheduled_entitlement_plan,
         scheduled_entitlement_effective_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         scheduled_entitlement_plan = excluded.scheduled_entitlement_plan,
         scheduled_entitlement_effective_at = excluded.scheduled_entitlement_effective_at,
         updated_at = excluded.updated_at`,
    )
    .bind(input.workspaceId, input.workspaceId, input.plan, input.effectiveAt, input.now, input.now)
    .run();
}

async function clearWorkspaceScheduledEntitlement(
  db: D1Database,
  input: {
    workspaceId: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET scheduled_entitlement_plan = NULL,
           scheduled_entitlement_effective_at = NULL,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(input.now, input.workspaceId)
    .run();
}

async function verifyStripeWebhookSignature(env: Env, payload: string, signatureHeader: string): Promise<void> {
  const secrets = [
    getConfiguredStripeValue(env, "STRIPE_WEBHOOK_SECRET"),
    getOptionalConfiguredStripeValue(env, "STRIPE_WEBHOOK_SECRET_NEXT"),
  ].filter((secret): secret is string => Boolean(secret));
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) {
    throw new HttpError(400, "stripe_signature_invalid", "Stripe webhook signature is invalid");
  }
  if (!/^\d+$/.test(timestamp)) {
    throw new HttpError(400, "stripe_signature_invalid", "Stripe webhook signature is invalid");
  }
  const timestampSeconds = Number(timestamp);
  const currentSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(currentSeconds - timestampSeconds) > STRIPE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    throw new HttpError(400, "stripe_signature_invalid", "Stripe webhook signature is invalid");
  }

  const expectedSignatures = await Promise.all(
    [...new Set(secrets)].map((secret) => hmacSha256Hex(secret, `${timestamp}.${payload}`)),
  );
  if (!signatures.some((signature) =>
    expectedSignatures.some((expected) => constantTimeEqualHex(signature, expected))
  )) {
    throw new HttpError(400, "stripe_signature_invalid", "Stripe webhook signature is invalid");
  }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < right.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

type StripeCheckoutSessionInput = {
  workspaceId: string;
  stripeCustomerId: string;
  plan: string;
  packSize: number;
  amountMinor: number;
  returnOrigin: string;
  purchaseId: string;
  idempotencyKey: string;
};

type StripeSubscriptionCheckoutSessionInput = {
  workspaceId: string;
  stripeCustomerId: string;
  priceId: string;
  plan: string;
  returnOrigin: string;
  idempotencyKey: string;
};

type StripeSubscriptionPlanChangeInput = {
  workspaceId: string;
  stripeSubscriptionId: string;
  stripeSubscriptionItemId: string;
  priceId: string;
  targetPlan: "pro" | "max";
  idempotencyKey: string;
};

type StripePaymentRequiredPlanOverrideInvoiceInput = {
  workspaceId: string;
  stripeCustomerId: string;
  plan: "free" | "pro" | "max";
  startAt: string;
  endAt: string;
  reason: string;
  amountMinor: number;
  collectionMode: "automatic" | "manual";
  idempotencyKey: string;
};

type StripeEnterpriseRampUpInvoiceInput = {
  workspaceId: string;
  stripeCustomerId: string;
  periodStart: string;
  periodEnd: string;
  collectionMode: "automatic" | "manual";
  invoiceReviewEnabled: boolean;
  billableDocumentPages: number;
  idempotencyKey: string;
};

type StripeEnterpriseAnnualUpfrontInvoiceInput = {
  workspaceId: string;
  stripeCustomerId: string;
  monthlyMinimumAllowance: number;
  perPagePriceMinor: number;
  yearlyAmountMinor: number;
  enterpriseBillingCycleStartDate: string;
  collectionMode: "automatic" | "manual";
  invoiceReviewEnabled: boolean;
  idempotencyKey: string;
};

type StripeEnterpriseAnnualOverageInvoiceInput = {
  workspaceId: string;
  stripeCustomerId: string;
  periodStart: string;
  periodEnd: string;
  monthlyMinimumAllowance: number;
  billableDocumentPages: number;
  overagePages: number;
  perPagePriceMinor: number;
  amountMinor: number;
  collectionMode: "automatic" | "manual";
  invoiceReviewEnabled: boolean;
  idempotencyKey: string;
};

type StripeInvoiceResponse = {
  id: string;
  status: string;
  hosted_invoice_url: string | null;
};

async function createStripePaymentRequiredPlanOverrideInvoice(
  env: Env,
  input: StripePaymentRequiredPlanOverrideInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const invoice = await createStripeInvoice(env, input);
  await createStripeInvoiceItem(env, {
    ...input,
    stripeInvoiceId: invoice.id,
  });
  return finalizeStripeInvoice(env, {
    stripeInvoiceId: invoice.id,
    idempotencyKey: `${input.idempotencyKey}:finalize`,
  });
}

async function createStripeEnterpriseRampUpInvoice(
  env: Env,
  input: StripeEnterpriseRampUpInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const invoice = await createStripeEnterpriseRampUpDraftInvoice(env, input);
  const slices = calculateEnterpriseRampUpUsageSlices(input.billableDocumentPages);
  for (const slice of slices) {
    await createStripeEnterpriseRampUpInvoiceItem(env, {
      ...input,
      stripeInvoiceId: invoice.id,
      quantity: slice.quantity,
      unitAmountMinor: slice.unitAmountMinor,
      usageBandStart: slice.usageBandStart,
      usageBandEnd: slice.usageBandEnd,
    });
  }

  if (input.invoiceReviewEnabled) {
    return invoice;
  }

  return finalizeStripeInvoice(env, {
    stripeInvoiceId: invoice.id,
    idempotencyKey: `${input.idempotencyKey}:finalize`,
  });
}

async function createStripeEnterpriseAnnualUpfrontInvoice(
  env: Env,
  input: StripeEnterpriseAnnualUpfrontInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const invoice = await createStripeEnterpriseAnnualUpfrontDraftInvoice(env, input);
  await createStripeEnterpriseAnnualUpfrontInvoiceItem(env, {
    ...input,
    stripeInvoiceId: invoice.id,
  });

  if (input.invoiceReviewEnabled) {
    return invoice;
  }

  return finalizeStripeInvoice(env, {
    stripeInvoiceId: invoice.id,
    idempotencyKey: `${input.idempotencyKey}:upfront-finalize`,
  });
}

async function createStripeEnterpriseAnnualOverageInvoice(
  env: Env,
  input: StripeEnterpriseAnnualOverageInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const invoice = await createStripeEnterpriseAnnualOverageDraftInvoice(env, input);
  await createStripeEnterpriseAnnualOverageInvoiceItem(env, {
    ...input,
    stripeInvoiceId: invoice.id,
  });

  if (input.invoiceReviewEnabled) {
    return invoice;
  }

  return finalizeStripeInvoice(env, {
    stripeInvoiceId: invoice.id,
    idempotencyKey: `${input.idempotencyKey}:finalize`,
  });
}

async function createStripeInvoice(
  env: Env,
  input: StripePaymentRequiredPlanOverrideInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("collection_method", input.collectionMode === "manual" ? "send_invoice" : "charge_automatically");
  if (input.collectionMode === "manual") {
    body.set("days_until_due", "30");
  }
  body.set("auto_advance", input.collectionMode === "automatic" ? "true" : "false");
  body.set("automatic_tax[enabled]", "true");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "payment_required_plan_override");
  body.set("metadata[plan]", input.plan);
  body.set("metadata[override_start_at]", input.startAt);
  body.set("metadata[override_end_at]", input.endAt);

  const response = await fetch("https://api.stripe.com/v1/invoices", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:invoice`,
    },
    body: body.toString(),
  });
  return parseStripeInvoiceResponse(response, "stripe_invoice_failed", "Stripe invoice creation failed");
}

async function createStripeEnterpriseAnnualUpfrontDraftInvoice(
  env: Env,
  input: StripeEnterpriseAnnualUpfrontInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("collection_method", input.collectionMode === "manual" ? "send_invoice" : "charge_automatically");
  if (input.collectionMode === "manual") {
    body.set("days_until_due", "30");
  }
  body.set("auto_advance", input.collectionMode === "automatic" && !input.invoiceReviewEnabled ? "true" : "false");
  body.set("automatic_tax[enabled]", "true");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "enterprise_annual_upfront_invoice");
  body.set("metadata[monthly_minimum_allowance]", String(input.monthlyMinimumAllowance));
  body.set("metadata[per_page_price_minor]", String(input.perPagePriceMinor));
  body.set("metadata[yearly_amount_minor]", String(input.yearlyAmountMinor));
  body.set("metadata[enterprise_billing_cycle_start_date]", input.enterpriseBillingCycleStartDate);

  const response = await fetch("https://api.stripe.com/v1/invoices", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:upfront-invoice`,
    },
    body: body.toString(),
  });
  return parseStripeInvoiceResponse(response, "stripe_invoice_failed", "Stripe invoice creation failed");
}

async function createStripeEnterpriseAnnualOverageDraftInvoice(
  env: Env,
  input: StripeEnterpriseAnnualOverageInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("collection_method", input.collectionMode === "manual" ? "send_invoice" : "charge_automatically");
  if (input.collectionMode === "manual") {
    body.set("days_until_due", "30");
  }
  body.set("auto_advance", input.collectionMode === "automatic" && !input.invoiceReviewEnabled ? "true" : "false");
  body.set("automatic_tax[enabled]", "true");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "enterprise_annual_overage_invoice");
  body.set("metadata[period_start]", input.periodStart);
  body.set("metadata[period_end]", input.periodEnd);
  body.set("metadata[monthly_minimum_allowance]", String(input.monthlyMinimumAllowance));
  body.set("metadata[billable_document_pages]", String(input.billableDocumentPages));
  body.set("metadata[overage_pages]", String(input.overagePages));
  body.set("metadata[per_page_price_minor]", String(input.perPagePriceMinor));

  const response = await fetch("https://api.stripe.com/v1/invoices", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:invoice`,
    },
    body: body.toString(),
  });
  return parseStripeInvoiceResponse(response, "stripe_invoice_failed", "Stripe invoice creation failed");
}

async function createStripeEnterpriseRampUpDraftInvoice(
  env: Env,
  input: StripeEnterpriseRampUpInvoiceInput,
): Promise<StripeInvoiceResponse> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("collection_method", input.collectionMode === "manual" ? "send_invoice" : "charge_automatically");
  if (input.collectionMode === "manual") {
    body.set("days_until_due", "30");
  }
  body.set("auto_advance", input.collectionMode === "automatic" && !input.invoiceReviewEnabled ? "true" : "false");
  body.set("automatic_tax[enabled]", "true");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "enterprise_ramp_up_invoice");
  body.set("metadata[period_start]", input.periodStart);
  body.set("metadata[period_end]", input.periodEnd);

  const response = await fetch("https://api.stripe.com/v1/invoices", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:invoice`,
    },
    body: body.toString(),
  });
  return parseStripeInvoiceResponse(response, "stripe_invoice_failed", "Stripe invoice creation failed");
}

async function createStripeInvoiceItem(
  env: Env,
  input: StripePaymentRequiredPlanOverrideInvoiceInput & { stripeInvoiceId: string },
): Promise<void> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("invoice", input.stripeInvoiceId);
  body.set("amount", String(input.amountMinor));
  body.set("currency", "gbp");
  body.set("description", `${NON_ENTERPRISE_BILLING_PLANS[input.plan].display_name} Plan override`);
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "payment_required_plan_override");
  body.set("metadata[plan]", input.plan);
  body.set("metadata[override_start_at]", input.startAt);
  body.set("metadata[override_end_at]", input.endAt);

  const response = await fetch("https://api.stripe.com/v1/invoiceitems", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:invoice-item`,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_invoice_item_failed",
      payload?.error?.message || "Stripe invoice item creation failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_invoice_item_failed", "Stripe invoice item response was incomplete");
  }
}

async function createStripeEnterpriseAnnualUpfrontInvoiceItem(
  env: Env,
  input: StripeEnterpriseAnnualUpfrontInvoiceInput & { stripeInvoiceId: string },
): Promise<void> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("invoice", input.stripeInvoiceId);
  body.set("amount", String(input.yearlyAmountMinor));
  body.set("currency", "gbp");
  body.set("description", "Enterprise annual commitment");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "enterprise_annual_upfront_invoice");
  body.set("metadata[monthly_minimum_allowance]", String(input.monthlyMinimumAllowance));
  body.set("metadata[per_page_price_minor]", String(input.perPagePriceMinor));
  body.set("metadata[yearly_amount_minor]", String(input.yearlyAmountMinor));

  const response = await fetch("https://api.stripe.com/v1/invoiceitems", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:upfront-invoice-item`,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_invoice_item_failed",
      payload?.error?.message || "Stripe invoice item creation failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_invoice_item_failed", "Stripe invoice item response was incomplete");
  }
}

async function createStripeEnterpriseAnnualOverageInvoiceItem(
  env: Env,
  input: StripeEnterpriseAnnualOverageInvoiceInput & { stripeInvoiceId: string },
): Promise<void> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("invoice", input.stripeInvoiceId);
  body.set("amount", String(input.amountMinor));
  body.set("currency", "gbp");
  body.set("description", "Enterprise annual overage usage");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "enterprise_annual_overage_invoice");
  body.set("metadata[period_start]", input.periodStart);
  body.set("metadata[period_end]", input.periodEnd);
  body.set("metadata[monthly_minimum_allowance]", String(input.monthlyMinimumAllowance));
  body.set("metadata[billable_document_pages]", String(input.billableDocumentPages));
  body.set("metadata[overage_pages]", String(input.overagePages));
  body.set("metadata[per_page_price_minor]", String(input.perPagePriceMinor));

  const response = await fetch("https://api.stripe.com/v1/invoiceitems", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:invoice-item`,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_invoice_item_failed",
      payload?.error?.message || "Stripe invoice item creation failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_invoice_item_failed", "Stripe invoice item response was incomplete");
  }
}

async function createStripeEnterpriseRampUpInvoiceItem(
  env: Env,
  input: StripeEnterpriseRampUpInvoiceInput & {
    stripeInvoiceId: string;
    quantity: number;
    unitAmountMinor: number;
    usageBandStart: number;
    usageBandEnd: number | null;
  },
): Promise<void> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("customer", input.stripeCustomerId);
  body.set("invoice", input.stripeInvoiceId);
  body.set("quantity", String(input.quantity));
  body.set("unit_amount_decimal", String(input.unitAmountMinor));
  body.set("currency", "gbp");
  body.set("tax_behavior", "exclusive");
  body.set("description", "Enterprise ramp-up Document submission usage");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "enterprise_ramp_up_invoice");
  body.set("metadata[period_start]", input.periodStart);
  body.set("metadata[period_end]", input.periodEnd);
  body.set("metadata[usage_band_start]", String(input.usageBandStart));
  body.set("metadata[usage_band_end]", input.usageBandEnd === null ? "unbounded" : String(input.usageBandEnd));

  const response = await fetch("https://api.stripe.com/v1/invoiceitems", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": `${input.idempotencyKey}:invoice-item:${input.usageBandStart}`,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_invoice_item_failed",
      payload?.error?.message || "Stripe invoice item creation failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_invoice_item_failed", "Stripe invoice item response was incomplete");
  }
}

function calculateEnterpriseRampUpUsageSlices(billableDocumentPages: number): Array<{
  quantity: number;
  unitAmountMinor: number;
  usageBandStart: number;
  usageBandEnd: number | null;
}> {
  const pages = Math.max(0, Math.floor(billableDocumentPages));
  const bands = [
    { usageBandStart: 0, usageBandEnd: 10000, unitAmountMinor: 14 },
    { usageBandStart: 10001, usageBandEnd: 20000, unitAmountMinor: 13 },
    { usageBandStart: 20001, usageBandEnd: 40000, unitAmountMinor: 12 },
    { usageBandStart: 40001, usageBandEnd: 60000, unitAmountMinor: 11 },
    { usageBandStart: 60001, usageBandEnd: null, unitAmountMinor: 10 },
  ];
  const slices: Array<{
    quantity: number;
    unitAmountMinor: number;
    usageBandStart: number;
    usageBandEnd: number | null;
  }> = [];

  for (const band of bands) {
    const firstPageInBand = band.usageBandStart === 0 ? 1 : band.usageBandStart;
    const pagesBeforeBand = firstPageInBand - 1;
    if (pages <= pagesBeforeBand) {
      continue;
    }

    const lastPageInBand = band.usageBandEnd ?? pages;
    const quantity = Math.min(pages, lastPageInBand) - pagesBeforeBand;
    if (quantity <= 0) {
      continue;
    }

    slices.push({
      quantity,
      unitAmountMinor: band.unitAmountMinor,
      usageBandStart: band.usageBandStart,
      usageBandEnd: band.usageBandEnd,
    });
  }

  return slices;
}

async function finalizeStripeInvoice(
  env: Env,
  input: { stripeInvoiceId: string; idempotencyKey: string },
): Promise<StripeInvoiceResponse> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const response = await fetch(`https://api.stripe.com/v1/invoices/${encodeURIComponent(input.stripeInvoiceId)}/finalize`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: new URLSearchParams().toString(),
  });
  return parseStripeInvoiceResponse(response, "stripe_invoice_finalize_failed", "Stripe invoice finalization failed");
}

async function parseStripeInvoiceResponse(
  response: Response,
  code: string,
  fallbackMessage: string,
): Promise<StripeInvoiceResponse> {
  const payload = await response.json().catch(() => null) as {
    id?: unknown;
    status?: unknown;
    hosted_invoice_url?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new HttpError(502, code, payload?.error?.message || fallbackMessage);
  }
  const id = String(payload?.id || "").trim();
  if (!id) {
    throw new HttpError(502, code, "Stripe invoice response was incomplete");
  }
  return {
    id,
    status: String(payload?.status || "").trim() || "unknown",
    hosted_invoice_url: String(payload?.hosted_invoice_url || "").trim() || null,
  };
}

function resolveStripeCheckoutReturnOrigin(
  request: Request,
  env: Env,
  requestedOrigin: unknown,
): string {
  const trustedOrigins = getTrustedCheckoutReturnOrigins(env);
  const candidates = [
    requestedOrigin,
    request.headers.get("origin"),
    request.headers.get("referer"),
  ];

  for (const candidate of candidates) {
    const origin = normalizeCheckoutReturnOrigin(candidate);
    if (!origin) {
      continue;
    }
    if (trustedOrigins.has(origin) || isLocalCheckoutReturnOrigin(origin)) {
      return origin;
    }
  }

  return normalizeCheckoutReturnOrigin(new URL(request.url).origin) || "http://localhost:8787";
}

function getStripeCheckoutReturnUrl(returnOrigin: string, checkoutResult: "success" | "cancel"): string {
  try {
    const url = new URL("/", returnOrigin);
    url.searchParams.set("checkout", checkoutResult);
    return url.toString();
  } catch {
    return `http://localhost:8787/?checkout=${checkoutResult}`;
  }
}

function getTrustedCheckoutReturnOrigins(env: Env): Set<string> {
  const origins = new Set<string>();
  const envRecord = env as Env & Record<string, unknown>;
  const configuredOrigins = String(envRecord.BETTER_AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const value of configuredOrigins) {
    const origin = normalizeCheckoutReturnOrigin(value);
    if (origin) {
      origins.add(origin);
    }
  }

  return origins;
}

function normalizeCheckoutReturnOrigin(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.protocol === "http:" && !isLocalCheckoutReturnHostname(url.hostname)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalCheckoutReturnOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return isLocalCheckoutReturnHostname(hostname);
  } catch {
    return false;
  }
}

function isLocalCheckoutReturnHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

async function createStripeCheckoutSession(
  env: Env,
  input: StripeCheckoutSessionInput,
): Promise<{ id: string; url: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const successUrl = getStripeCheckoutReturnUrl(input.returnOrigin, "success");
  const cancelUrl = getStripeCheckoutReturnUrl(input.returnOrigin, "cancel");
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("customer", input.stripeCustomerId);
  body.set("line_items[0][price_data][currency]", "gbp");
  body.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
  body.set("line_items[0][price_data][tax_behavior]", "exclusive");
  body.set("line_items[0][price_data][product_data][name]", `${input.packSize} Workspace Credits`);
  body.set("line_items[0][quantity]", "1");
  body.set("automatic_tax[enabled]", "true");
  body.set("billing_address_collection", "required");
  body.set("customer_update[address]", "auto");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("client_reference_id", `${input.workspaceId}:credit_pack:${input.plan}:${input.packSize}`);
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "credit_pack_purchase");
  body.set("metadata[plan]", input.plan);
  body.set("metadata[credit_pack_size]", String(input.packSize));
  body.set("metadata[purchase_id]", input.purchaseId);
  body.set("invoice_creation[enabled]", "true");
  body.set("invoice_creation[invoice_data][description]", `${input.packSize} Workspace Credits`);
  body.set("invoice_creation[invoice_data][metadata][workspace_id]", input.workspaceId);
  body.set("invoice_creation[invoice_data][metadata][billing_action]", "credit_pack_purchase");
  body.set("invoice_creation[invoice_data][metadata][plan]", input.plan);
  body.set("invoice_creation[invoice_data][metadata][credit_pack_size]", String(input.packSize));
  body.set("invoice_creation[invoice_data][metadata][purchase_id]", input.purchaseId);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; url?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_checkout_failed",
      payload?.error?.message || "Stripe Checkout Session creation failed",
    );
  }
  if (typeof payload?.id !== "string" || typeof payload.url !== "string") {
    throw new HttpError(502, "stripe_checkout_failed", "Stripe Checkout Session response was incomplete");
  }

  return { id: payload.id, url: payload.url };
}

async function listStripeCheckoutSessionsForCustomer(
  env: Env,
  stripeCustomerId: string,
): Promise<StripeCheckoutSession[]> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const url = `https://api.stripe.com/v1/checkout/sessions?customer=${encodeURIComponent(stripeCustomerId)}&limit=100&expand%5B0%5D=data.invoice`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "stripe-version": STRIPE_API_VERSION,
    },
  });
  const payload = await response.json().catch(() => null) as {
    data?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_checkout_lookup_failed",
      payload?.error?.message || "Stripe Checkout Session lookup failed",
    );
  }
  if (!Array.isArray(payload?.data)) {
    throw new HttpError(502, "stripe_checkout_lookup_failed", "Stripe Checkout Session response was incomplete");
  }

  return payload.data
    .map((item): StripeCheckoutSession | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id || "").trim();
      if (!id) {
        return null;
      }
      return {
        id,
        payment_status: record.payment_status,
        invoice: record.invoice,
        metadata: record.metadata && typeof record.metadata === "object"
          ? record.metadata as Record<string, unknown>
          : null,
      };
    })
    .filter((session): session is StripeCheckoutSession => Boolean(session));
}

async function listStripeInvoicesForCustomer(
  env: Env,
  stripeCustomerId: string,
): Promise<StripeInvoice[]> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const url = `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(stripeCustomerId)}&limit=100&expand%5B0%5D=data.lines&expand%5B1%5D=data.payment_intent`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "stripe-version": STRIPE_API_VERSION,
    },
  });
  const payload = await response.json().catch(() => null) as {
    data?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_invoice_lookup_failed",
      payload?.error?.message || "Stripe invoice lookup failed",
    );
  }
  if (!Array.isArray(payload?.data)) {
    throw new HttpError(502, "stripe_invoice_lookup_failed", "Stripe invoice response was incomplete");
  }

  return payload.data
    .map((item): StripeInvoice | null => (
      item && typeof item === "object" ? item as StripeInvoice : null
    ))
    .filter((invoice): invoice is StripeInvoice => Boolean(invoice));
}

async function listStripeSubscriptionsForCustomer(
  env: Env,
  stripeCustomerId: string,
): Promise<StripeSubscription[]> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const url = `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(stripeCustomerId)}&status=all&limit=100`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "stripe-version": STRIPE_API_VERSION,
    },
  }) as Response | undefined;
  if (!response) {
    return [];
  }
  const payload = await response.json().catch(() => null) as {
    data?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_subscription_lookup_failed",
      payload?.error?.message || "Stripe subscription lookup failed",
    );
  }
  if (!Array.isArray(payload?.data)) {
    throw new HttpError(502, "stripe_subscription_lookup_failed", "Stripe subscription response was incomplete");
  }

  return payload.data
    .map((item): StripeSubscription | null => (
      item && typeof item === "object" ? item as StripeSubscription : null
    ))
    .filter((subscription): subscription is StripeSubscription => Boolean(subscription));
}

async function createStripeSubscriptionCheckoutSession(
  env: Env,
  input: StripeSubscriptionCheckoutSessionInput,
): Promise<{ id: string; url: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const successUrl = getStripeCheckoutReturnUrl(input.returnOrigin, "success");
  const cancelUrl = getStripeCheckoutReturnUrl(input.returnOrigin, "cancel");
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("customer", input.stripeCustomerId);
  body.set("line_items[0][price]", input.priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("automatic_tax[enabled]", "true");
  body.set("billing_address_collection", "required");
  body.set("customer_update[address]", "auto");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("client_reference_id", `${input.workspaceId}:subscription:${input.plan}`);
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "subscription_start");
  body.set("metadata[plan]", input.plan);
  body.set("subscription_data[metadata][workspace_id]", input.workspaceId);
  body.set("subscription_data[metadata][billing_action]", "subscription_start");
  body.set("subscription_data[metadata][plan]", input.plan);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; url?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_checkout_failed",
      payload?.error?.message || "Stripe Checkout Session creation failed",
    );
  }
  if (typeof payload?.id !== "string" || typeof payload.url !== "string") {
    throw new HttpError(502, "stripe_checkout_failed", "Stripe Checkout Session response was incomplete");
  }

  return { id: payload.id, url: payload.url };
}

async function updateStripeSubscriptionForPlanChange(
  env: Env,
  input: StripeSubscriptionPlanChangeInput,
): Promise<{ id: string; payment_url: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("items[0][id]", input.stripeSubscriptionItemId);
  body.set("items[0][price]", input.priceId);
  body.set("payment_behavior", "pending_if_incomplete");
  body.set("proration_behavior", "always_invoice");
  body.set("expand[0]", "latest_invoice");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "subscription_upgrade");
  body.set("metadata[plan]", input.targetPlan);

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as {
    id?: unknown;
    latest_invoice?: {
      hosted_invoice_url?: unknown;
    } | string | null;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_subscription_change_failed",
      payload?.error?.message || "Stripe subscription change failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_subscription_change_failed", "Stripe subscription response was incomplete");
  }
  const paymentUrl = typeof payload.latest_invoice === "object" && payload.latest_invoice
    ? String(payload.latest_invoice.hosted_invoice_url || "").trim()
    : "";
  if (!paymentUrl) {
    throw new HttpError(502, "stripe_subscription_change_failed", "Stripe subscription invoice response was incomplete");
  }

  return { id: payload.id, payment_url: paymentUrl };
}

async function updateStripeSubscriptionForScheduledDowngrade(
  env: Env,
  input: StripeSubscriptionPlanChangeInput,
): Promise<{ id: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("items[0][id]", input.stripeSubscriptionItemId);
  body.set("items[0][price]", input.priceId);
  body.set("proration_behavior", "none");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "subscription_downgrade");
  body.set("metadata[plan]", input.targetPlan);

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_subscription_change_failed",
      payload?.error?.message || "Stripe subscription change failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_subscription_change_failed", "Stripe subscription response was incomplete");
  }

  return { id: payload.id };
}

async function updateStripeSubscriptionForScheduledChangeCancellation(
  env: Env,
  input: StripeSubscriptionPlanChangeInput,
): Promise<{ id: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("items[0][id]", input.stripeSubscriptionItemId);
  body.set("items[0][price]", input.priceId);
  body.set("cancel_at_period_end", "false");
  body.set("proration_behavior", "none");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "subscription_scheduled_change_canceled");
  body.set("metadata[plan]", input.targetPlan);

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_subscription_change_failed",
      payload?.error?.message || "Stripe subscription change failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_subscription_change_failed", "Stripe subscription response was incomplete");
  }

  return { id: payload.id };
}

async function updateStripeSubscriptionCancellation(
  env: Env,
  input: { workspaceId: string; stripeSubscriptionId: string; idempotencyKey: string },
): Promise<{ id: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("cancel_at_period_end", "true");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "subscription_cancellation");
  body.set("metadata[plan]", "free");

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_subscription_cancellation_failed",
      payload?.error?.message || "Stripe subscription cancellation failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_subscription_cancellation_failed", "Stripe subscription response was incomplete");
  }

  return { id: payload.id };
}

async function updateStripeSubscriptionScheduledCancellationReversal(
  env: Env,
  input: { workspaceId: string; stripeSubscriptionId: string; idempotencyKey: string },
): Promise<{ id: string }> {
  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("cancel_at_period_end", "false");
  body.set("metadata[workspace_id]", input.workspaceId);
  body.set("metadata[billing_action]", "subscription_scheduled_change_canceled");

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      "idempotency-key": input.idempotencyKey,
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new HttpError(
      502,
      "stripe_subscription_change_failed",
      payload?.error?.message || "Stripe subscription change failed",
    );
  }
  if (typeof payload?.id !== "string") {
    throw new HttpError(502, "stripe_subscription_change_failed", "Stripe subscription response was incomplete");
  }

  return { id: payload.id };
}

function getConfiguredStripePriceId(env: Env, key: string): string {
  return getConfiguredStripeValue(env, key);
}

function getConfiguredStripeValue(env: Env, key: string): string {
  const value = String((env as Env & Record<string, unknown>)[key] || "").trim();
  if (!value) {
    throw new HttpError(500, "stripe_configuration_missing", `${key} is not configured`);
  }
  return value;
}

function getOptionalConfiguredStripeValue(env: Env, key: string): string | null {
  const value = String((env as Env & Record<string, unknown>)[key] || "").trim();
  return value || null;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Expected object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
}

async function recordApplicationAdminBillingAuditEntry(
  db: D1Database,
  entry: ApplicationAdminBillingAuditEntry,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_admin_audit_log (
         id,
         workspace_id,
         action,
         actor_user_id,
         reason,
         before_json,
         after_json,
         occurred_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.workspace_id,
      entry.action,
      entry.actor_user_id,
      entry.reason,
      JSON.stringify(entry.before),
      JSON.stringify(entry.after),
      entry.occurred_at,
    )
    .run();
}

async function storeBillingReconciliationStatus(
  db: D1Database,
  input: { workspaceId: string; checkedAt: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_reconciliation_status (
         workspace_id,
         last_checked_at,
         updated_at
       )
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         last_checked_at = excluded.last_checked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(input.workspaceId, input.checkedAt, input.checkedAt)
    .run();
}

async function recordBillingReconciliationDrift(
  db: D1Database,
  record: BillingReconciliationDriftRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspace_billing_reconciliation_drift (
         id,
         workspace_id,
         drift_type,
         severity,
         actionability,
         related_stripe_object_id,
         observed_json,
         expected_json,
         first_seen_at,
         last_seen_at,
         status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         severity = excluded.severity,
         actionability = excluded.actionability,
         related_stripe_object_id = excluded.related_stripe_object_id,
         observed_json = excluded.observed_json,
         expected_json = excluded.expected_json,
         last_seen_at = excluded.last_seen_at,
         status = 'open'`,
    )
    .bind(
      record.id,
      record.workspace_id,
      record.drift_type,
      record.severity,
      record.actionability,
      record.related_stripe_object_id,
      JSON.stringify(record.observed),
      JSON.stringify(record.expected),
      record.first_seen_at,
      record.last_seen_at,
      record.status,
    )
    .run();
}

async function getBillingReconciliationState(
  db: D1Database,
  workspaceId: string,
): Promise<BillingReconciliationState> {
  const status = await db
    .prepare(
      `SELECT last_checked_at
       FROM workspace_billing_reconciliation_status
       WHERE workspace_id = ?
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ last_checked_at?: string | null }>();
  const driftRecords = await listOpenBillingReconciliationDriftRecords(db, workspaceId);
  return {
    last_checked_at: String(status?.last_checked_at || "").trim() || null,
    open_drift_count: driftRecords.length,
    drift_records: driftRecords,
  };
}

async function listOpenBillingReconciliationDriftRecords(
  db: D1Database,
  workspaceId: string,
): Promise<BillingReconciliationDriftRecord[]> {
  const result = await db
    .prepare(
      `SELECT id,
              workspace_id,
              drift_type,
              severity,
              actionability,
              related_stripe_object_id,
              observed_json,
              expected_json,
              first_seen_at,
              last_seen_at,
              status
       FROM workspace_billing_reconciliation_drift
       WHERE workspace_id = ?
         AND status = 'open'
       ORDER BY last_seen_at DESC, id DESC`,
    )
    .bind(workspaceId)
    .all<{
      id: string;
      workspace_id: string;
      drift_type: string;
      severity: "needs_review" | "warning";
      actionability: "manual_review" | "informational";
      related_stripe_object_id?: string | null;
      observed_json: string;
      expected_json: string;
      first_seen_at: string;
      last_seen_at: string;
      status: "open" | "resolved";
    }>();

  return (result.results || []).map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    drift_type: row.drift_type,
    severity: row.severity,
    actionability: row.actionability,
    related_stripe_object_id: row.related_stripe_object_id ?? null,
    observed: parseJsonRecord(row.observed_json),
    expected: parseJsonRecord(row.expected_json),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    status: row.status,
  }));
}

function createBillingReconciliationDriftId(
  workspaceId: string,
  driftType: string,
  relatedId: string,
): string {
  return `drift_${sanitizeBillingReconciliationIdPart(workspaceId)}_${sanitizeBillingReconciliationIdPart(driftType)}_${sanitizeBillingReconciliationIdPart(relatedId)}`;
}

function sanitizeBillingReconciliationIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_]+/g, "_");
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringValueOrNull(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

async function listApplicationAdminBillingAuditEntries(
  db: D1Database,
  workspaceId: string,
): Promise<ApplicationAdminBillingAuditEntry[]> {
  const result = await db
    .prepare(
      `SELECT id,
              workspace_id,
              action,
              actor_user_id,
              actor_name,
              reason,
              before_json,
              after_json,
              occurred_at
       FROM (
         SELECT a.id,
                a.workspace_id,
                a.action,
                a.actor_user_id,
                u.name AS actor_name,
                a.reason,
                a.before_json,
                a.after_json,
                a.occurred_at
         FROM workspace_billing_admin_audit_log a
         LEFT JOIN user u ON u.id = a.actor_user_id
         WHERE a.workspace_id = ?
       )
       ORDER BY occurred_at DESC, id DESC`,
    )
    .bind(workspaceId)
    .all<{
      id: string;
      workspace_id: string;
      action: ApplicationAdminBillingAuditEntry["action"];
      actor_user_id: string;
      actor_name: string | null;
      reason: string;
      before_json: string;
      after_json: string;
      occurred_at: string;
    }>();

  return (result.results || []).map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    action: row.action,
    actor_user_id: row.actor_user_id,
    actor_name: String(row.actor_name || "").trim() || null,
    reason: row.reason,
    before: parseAuditValue(row.before_json),
    after: parseAuditValue(row.after_json),
    occurred_at: row.occurred_at,
  }));
}

function parseAuditValue(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function createAuditEntryId(): string {
  return `audit_${crypto.randomUUID()}`;
}
