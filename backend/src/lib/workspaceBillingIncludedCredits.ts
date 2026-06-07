import {
  NON_ENTERPRISE_BILLING_PLANS,
  summarizeWorkspaceBilling,
  type WorkspaceBillingControl,
} from "./workspaceBilling";
import { disposeRpcResult } from "./rpcDisposal";
import type { Workspace } from "./types";

type IncludedCreditGrantLookup = {
  exists: boolean;
  occurred_at?: string | null;
};

export type IncludedCreditGrantLedger = {
  findIncludedCreditGrant?(input: { idempotencyKey: string }): Promise<IncludedCreditGrantLookup>;
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
  revokeIncludedCredits(input: {
    workspaceId: string;
    credits: number;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<{
    revoked_credits: number;
    available_credits: number;
  }>;
};

type IncludedCreditSummaryLedger = IncludedCreditGrantLedger & {
  summarizeOwnerBilling(input: {
    billingPeriodStart: string;
    billingPeriodEnd: string;
    monthlyPageLimit: number | null;
  }): Promise<{
    credits: {
      included_available: number;
    };
  }>;
};

export type IncludedCreditGrantResult = {
  granted_credits: number;
  available_credits: number;
} | null;

export async function reconcileActivePlanOverrideIncludedCredits(
  input: {
    workspace: Workspace;
    control: WorkspaceBillingControl | null;
    ledger: IncludedCreditSummaryLedger;
    now: Date;
  },
): Promise<IncludedCreditGrantResult> {
  const plan = input.control?.plan_override_plan;
  if (plan !== "free" && plan !== "pro" && plan !== "max") {
    return null;
  }
  if (!isActivePlanOverride(input.control, input.now)) {
    return null;
  }

  const summary = summarizeWorkspaceBilling(input.workspace, input.control, input.now);
  if (summary.active_entitlement.plan !== plan) {
    return null;
  }

  const planDefinition = NON_ENTERPRISE_BILLING_PLANS[plan];
  const ledgerSummary = await input.ledger.summarizeOwnerBilling({
    billingPeriodStart: summary.current_period.start,
    billingPeriodEnd: summary.current_period.end,
    monthlyPageLimit: summary.current_period.monthly_page_limit,
  });
  const includedAvailable = Number(ledgerSummary.credits.included_available || 0);
  disposeRpcResult(ledgerSummary);
  const targetIncludedCredits = Number(planDefinition?.included_credits || 0);
  if (includedAvailable === targetIncludedCredits) {
    return null;
  }
  const overrideCreatedAt = normalizeIsoDate(input.control?.plan_override_created_at);
  const overrideIdentity = overrideCreatedAt ||
    `${normalizeIsoDate(input.control?.plan_override_start_at) || summary.current_period.start}:${normalizeIsoDate(input.control?.plan_override_end_at) || summary.current_period.end}`;
  if (includedAvailable > targetIncludedCredits) {
    const creditsToRevoke = includedAvailable - targetIncludedCredits;
    const result = await input.ledger.revokeIncludedCredits({
      workspaceId: input.workspace.id,
      credits: creditsToRevoke,
      billingPeriodStart: summary.current_period.start,
      billingPeriodEnd: summary.current_period.end,
      idempotencyKey: `plan-override-included-revoke:${input.workspace.id}:${plan}:${summary.current_period.start}:${summary.current_period.end}:${overrideIdentity}:${includedAvailable}:to:${targetIncludedCredits}`,
      occurredAt: input.now.toISOString(),
    });
    disposeRpcResult(result);
    return null;
  }

  const idempotencyKey = `plan-override-included:${input.workspace.id}:${plan}:${summary.current_period.start}:${summary.current_period.end}:${overrideIdentity}`;
  const existing = await input.ledger.findIncludedCreditGrant?.({ idempotencyKey });
  try {
    if (existing?.exists) {
      return null;
    }
  } finally {
    disposeRpcResult(existing);
  }
  const legacyExisting = await input.ledger.findIncludedCreditGrant?.({
    idempotencyKey: `plan-override-included:${input.workspace.id}:${plan}:${summary.current_period.start}:${summary.current_period.end}`,
  });
  try {
    if (isGrantForCurrentOverride(legacyExisting, overrideCreatedAt)) {
      return null;
    }
  } finally {
    disposeRpcResult(legacyExisting);
  }
  const creditsToGrant = Math.max(
    0,
    targetIncludedCredits - includedAvailable,
  );
  if (creditsToGrant <= 0) {
    return null;
  }

  const result = await input.ledger.grantIncludedCredits({
    workspaceId: input.workspace.id,
    credits: creditsToGrant,
    billingPeriodStart: summary.current_period.start,
    billingPeriodEnd: summary.current_period.end,
    idempotencyKey,
    occurredAt: input.now.toISOString(),
  });
  const grantResult = {
    granted_credits: result.granted_credits,
    available_credits: result.available_credits,
  };
  disposeRpcResult(result);
  return grantResult;
}

function isGrantForCurrentOverride(
  existing: IncludedCreditGrantLookup | undefined,
  overrideCreatedAt: string | null,
): boolean {
  if (!existing?.exists) {
    return false;
  }
  if (!overrideCreatedAt || !existing.occurred_at) {
    return true;
  }

  const grantOccurredAt = normalizeIsoDate(existing.occurred_at);
  return !grantOccurredAt || new Date(grantOccurredAt).getTime() >= new Date(overrideCreatedAt).getTime();
}

function isActivePlanOverride(control: WorkspaceBillingControl | null, now: Date): boolean {
  const startAt = normalizeIsoDate(control?.plan_override_start_at);
  const endAt = normalizeIsoDate(control?.plan_override_end_at);
  if (!startAt || !endAt) {
    return false;
  }

  const nowTime = now.getTime();
  return nowTime >= new Date(startAt).getTime() && nowTime < new Date(endAt).getTime();
}

function normalizeIsoDate(value: unknown): string | null {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
