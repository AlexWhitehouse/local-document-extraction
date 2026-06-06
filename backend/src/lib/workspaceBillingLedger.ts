import { DurableObject } from "cloudflare:workers";

const WORKSPACE_BILLING_LEDGER_SCHEMA_VERSION = 4;

type SchemaVersionRow = {
  version: number;
};

type LedgerEntryRow = {
  id: string;
  type: LedgerEntryType;
  grant_id: string;
  related_grant_id: string | null;
  credits: number;
  occurred_at: string;
  extraction_job_id: string | null;
  template_id: string | null;
  template_version: number | null;
  billable_document_pages: number | null;
  amount_minor: number | null;
  currency: string | null;
  tax_behavior: string | null;
  stripe_checkout_session_id: string | null;
  stripe_invoice_id: string | null;
  stripe_invoice_status: string | null;
  stripe_hosted_invoice_url: string | null;
};

type CreditUsageEntryRow = {
  credits: number | null;
  occurred_at: string;
  billable_document_pages: number | null;
};

type LedgerColumnRow = {
  name: string;
};

type LedgerEntryType =
  | "goodwill_credit_grant"
  | "goodwill_credit_revocation"
  | "included_credit_grant"
  | "included_credit_revocation"
  | "purchased_credit_grant"
  | "credit_pack_payment_failed"
  | "credit_reservation"
  | "credit_refund"
  | "no_billing_usage"
  | "enterprise_usage_charge";

export type GrantGoodwillCreditsInput = {
  workspaceId: string;
  credits: number;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
  occurredAt: string;
};

export type GrantGoodwillCreditsResult = {
  entry_id: string;
  grant_id: string;
  workspace_id: string;
  granted_credits: number;
  available_credits: number;
};

export type RevokeGoodwillCreditGrantInput = {
  workspaceId: string;
  grantId: string;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
  occurredAt: string;
};

export type RevokeGoodwillCreditGrantResult = {
  entry_id: string;
  revocation_id: string;
  grant_id: string;
  workspace_id: string;
  revoked_credits: number;
  available_credits: number;
};

export type GrantIncludedCreditsInput = {
  workspaceId: string;
  credits: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  idempotencyKey: string;
  occurredAt: string;
  stripeInvoiceId?: string | null;
  stripeInvoiceStatus?: string | null;
  hostedInvoiceUrl?: string | null;
};

export type GrantIncludedCreditsResult = {
  entry_id: string;
  grant_id: string;
  workspace_id: string;
  granted_credits: number;
  available_credits: number;
};

export type RevokeIncludedCreditsInput = {
  workspaceId: string;
  credits: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  idempotencyKey: string;
  occurredAt: string;
};

export type RevokeIncludedCreditsResult = {
  entry_id: string;
  revocation_id: string;
  workspace_id: string;
  revoked_credits: number;
  available_credits: number;
};

export type FindIncludedCreditGrantInput = {
  idempotencyKey: string;
};

export type FindIncludedCreditGrantResult = {
  exists: boolean;
  entry_id?: string;
  grant_id?: string | null;
  occurred_at?: string | null;
};

export type GrantPurchasedCreditsInput = {
  workspaceId: string;
  credits: number;
  stripeEventId: string;
  checkoutSessionId?: string | null;
  stripeInvoiceId?: string | null;
  stripeInvoiceStatus?: string | null;
  hostedInvoiceUrl?: string | null;
  idempotencyKey: string;
  occurredAt: string;
};

export type GrantPurchasedCreditsResult = {
  entry_id: string;
  grant_id: string;
  workspace_id: string;
  granted_credits: number;
  available_credits: number;
};

export type RecordCreditPackPaymentFailedInput = {
  workspaceId: string;
  stripeEventId: string;
  checkoutSessionId: string;
  stripeInvoiceId?: string | null;
  stripeInvoiceStatus?: string | null;
  hostedInvoiceUrl?: string | null;
  idempotencyKey: string;
  occurredAt: string;
};

export type RecordCreditPackPaymentFailedResult = {
  entry_id: string;
  workspace_id: string;
};

export type OwnerBillingSummary = {
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
};

export type OwnerBillingActivity = {
  id: string;
  type: LedgerEntryType;
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
};

export type OwnerBillingActivityCursor = {
  occurred_at: string;
  id: string;
};

export type OwnerBillingActivityPageInput = {
  limit: number;
  cursor?: OwnerBillingActivityCursor | null;
};

export type OwnerBillingActivityPage = {
  owner_billing_activity: OwnerBillingActivity[];
  next_cursor: OwnerBillingActivityCursor | null;
};

export type OwnerBillingUsageRange = "daily" | "weekly" | "monthly" | "yearly";

export type OwnerBillingUsageBucket = {
  label: string;
  start_at: string;
  end_at: string;
  credits: number;
  billable_document_pages: number;
};

export type OwnerBillingUsageSeries = {
  range: OwnerBillingUsageRange;
  total_credits: number;
  total_billable_document_pages: number;
  buckets: OwnerBillingUsageBucket[];
};

export type OwnerBillingUsageSummaryInput = {
  range: OwnerBillingUsageRange;
  now?: string;
};

export type ReserveCreditsForDocumentSubmissionInput = {
  workspaceId: string;
  extractionJobId: string;
  templateId: string;
  templateVersion: number;
  billableDocumentPages: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  monthlyPageLimit: number;
  submittedAt: string;
  authMode: "api_key" | "session";
  actorUserId: string | null;
  idempotencyKey: string;
};

export type ReserveCreditsForDocumentSubmissionResult = {
  entry_id: string;
  reservation_id: string;
  workspace_id: string;
  extraction_job_id: string;
  reserved_credits: number;
  billable_document_pages: number;
  available_credits: number;
};

export type RefundCreditReservationInput = {
  workspaceId: string;
  extractionJobId: string;
  reason: string;
  idempotencyKey: string;
  occurredAt: string;
};

export type RefundCreditReservationResult = {
  entry_id: string;
  refund_id: string;
  workspace_id: string;
  extraction_job_id: string;
  refunded_credits: number;
  billable_document_pages: number;
  available_credits: number;
};

export type RecordNoBillingUsageInput = {
  workspaceId: string;
  extractionJobId: string;
  templateId: string;
  templateVersion: number;
  billableDocumentPages: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  submittedAt: string;
  authMode: "api_key" | "session";
  actorUserId: string | null;
  idempotencyKey: string;
};

export type RecordNoBillingUsageResult = {
  entry_id: string;
  usage_id: string;
  workspace_id: string;
  extraction_job_id: string;
  billable_document_pages: number;
};

export type RecordEnterpriseUsageChargeInput = {
  workspaceId: string;
  extractionJobId: string;
  templateId: string;
  templateVersion: number;
  billableDocumentPages: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  submittedAt: string;
  authMode: "api_key" | "session";
  actorUserId: string | null;
  idempotencyKey: string;
  amountMinor?: number;
};

export type RecordEnterpriseUsageChargeResult = {
  entry_id: string;
  charge_id: string;
  workspace_id: string;
  extraction_job_id: string;
  billable_document_pages: number;
  amount: {
    currency: "GBP";
    amount_minor: number;
    display: string;
    tax_behavior: "exclusive";
  };
};

export type OwnerBillingSummaryInput = {
  billingPeriodStart: string;
  billingPeriodEnd: string;
  monthlyPageLimit: number | null;
  activityLimit?: number;
  activityCursor?: OwnerBillingActivityCursor | null;
  usageRange?: OwnerBillingUsageRange;
  usageNow?: string;
};

export type EnterpriseUsageChargeSummaryInput = {
  billingPeriodStart: string;
  billingPeriodEnd: string;
};

export type EnterpriseUsageChargeSummary = {
  billable_document_pages: number;
  amount: {
    currency: "GBP";
    amount_minor: number;
    display: string;
    tax_behavior: "exclusive";
  };
};

export class BillingReservationError extends Error {
  constructor(
    readonly code: "insufficient_credits" | "plan_page_limit_exceeded",
    message: string,
  ) {
    super(message);
  }
}

export class WorkspaceBillingLedger extends DurableObject<Env> {
  private schemaReady = false;

  async grantGoodwillCredits(input: GrantGoodwillCreditsInput): Promise<GrantGoodwillCreditsResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        entry_id: existing.id,
        grant_id: existing.grant_id,
        workspace_id: input.workspaceId,
        granted_credits: Number(existing.credits),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const grantId = `grant_${input.idempotencyKey}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at
       )
       VALUES (?, ?, 'goodwill_credit_grant', ?, NULL, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      grantId,
      input.credits,
      input.actorUserId,
      input.reason,
      input.idempotencyKey,
      input.occurredAt,
    );

    return {
      entry_id: entryId,
      grant_id: grantId,
      workspace_id: input.workspaceId,
      granted_credits: input.credits,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async revokeGoodwillCreditGrant(input: RevokeGoodwillCreditGrantInput): Promise<RevokeGoodwillCreditGrantResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "goodwill_credit_revocation") {
      return {
        entry_id: existing.id,
        revocation_id: existing.grant_id,
        grant_id: existing.related_grant_id || input.grantId,
        workspace_id: input.workspaceId,
        revoked_credits: Math.abs(Number(existing.credits)),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const unspentCredits = this.calculateGrantUnspentCredits(input.grantId);
    if (unspentCredits <= 0) {
      throw new Error("Goodwill Credit grant is not revokable");
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const revocationId = `revocation_${input.idempotencyKey}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at
       )
       VALUES (?, ?, 'goodwill_credit_revocation', ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      revocationId,
      input.grantId,
      -unspentCredits,
      input.actorUserId,
      input.reason,
      input.idempotencyKey,
      input.occurredAt,
    );

    return {
      entry_id: entryId,
      revocation_id: revocationId,
      grant_id: input.grantId,
      workspace_id: input.workspaceId,
      revoked_credits: unspentCredits,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async findIncludedCreditGrant(input: FindIncludedCreditGrantInput): Promise<FindIncludedCreditGrantResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (!existing || existing.type !== "included_credit_grant") {
      return { exists: false };
    }
    return {
      exists: true,
      entry_id: existing.id,
      grant_id: existing.grant_id,
      occurred_at: existing.occurred_at,
    };
  }

  async grantIncludedCredits(input: GrantIncludedCreditsInput): Promise<GrantIncludedCreditsResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "included_credit_grant") {
      this.updateLedgerEntryInvoiceReference(existing.id, input);
      return {
        entry_id: existing.id,
        grant_id: existing.grant_id,
        workspace_id: input.workspaceId,
        granted_credits: Number(existing.credits),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const grantId = `included_${input.idempotencyKey}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         billing_period_start,
         billing_period_end,
         stripe_invoice_id,
         stripe_invoice_status,
         stripe_hosted_invoice_url
       )
       VALUES (?, ?, 'included_credit_grant', ?, NULL, ?, '', 'Included Credits granted', ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      grantId,
      input.credits,
      input.idempotencyKey,
      input.occurredAt,
      input.billingPeriodStart,
      input.billingPeriodEnd,
      normalizeNullableLedgerString(input.stripeInvoiceId),
      normalizeNullableLedgerString(input.stripeInvoiceStatus),
      normalizeNullableLedgerString(input.hostedInvoiceUrl),
    );

    return {
      entry_id: entryId,
      grant_id: grantId,
      workspace_id: input.workspaceId,
      granted_credits: input.credits,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async revokeIncludedCredits(input: RevokeIncludedCreditsInput): Promise<RevokeIncludedCreditsResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "included_credit_revocation") {
      return {
        entry_id: existing.id,
        revocation_id: existing.grant_id,
        workspace_id: input.workspaceId,
        revoked_credits: Math.abs(Number(existing.credits)),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const unspentIncludedCredits = this.calculateCreditBucketsAvailable({
      billingPeriodStart: input.billingPeriodStart,
      billingPeriodEnd: input.billingPeriodEnd,
      monthlyPageLimit: null,
    }).included_available;
    const creditsToRevoke = Math.min(input.credits, unspentIncludedCredits);
    if (!Number.isInteger(creditsToRevoke) || creditsToRevoke <= 0) {
      throw new Error("Included Credits are not revokable");
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const revocationId = `included_revocation_${input.idempotencyKey}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         billing_period_start,
         billing_period_end
       )
       VALUES (?, ?, 'included_credit_revocation', ?, NULL, ?, '', 'Included Credits revoked', ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      revocationId,
      -creditsToRevoke,
      input.idempotencyKey,
      input.occurredAt,
      input.billingPeriodStart,
      input.billingPeriodEnd,
    );

    return {
      entry_id: entryId,
      revocation_id: revocationId,
      workspace_id: input.workspaceId,
      revoked_credits: creditsToRevoke,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async grantPurchasedCredits(input: GrantPurchasedCreditsInput): Promise<GrantPurchasedCreditsResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "purchased_credit_grant") {
      this.updateLedgerEntryInvoiceReference(existing.id, input);
      return {
        entry_id: existing.id,
        grant_id: existing.grant_id,
        workspace_id: input.workspaceId,
        granted_credits: Number(existing.credits),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const grantId = `purchased_${input.idempotencyKey}`;
    const checkoutSessionId = normalizeNullableLedgerString(input.checkoutSessionId);
    const stripeInvoiceId = normalizeNullableLedgerString(input.stripeInvoiceId);
    const sourceReason = checkoutSessionId
      ? `Stripe Checkout ${checkoutSessionId}`
      : stripeInvoiceId
        ? `Stripe invoice ${stripeInvoiceId}`
        : "Stripe Checkout";
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         stripe_checkout_session_id,
         stripe_invoice_id,
         stripe_invoice_status,
         stripe_hosted_invoice_url
       )
       VALUES (?, ?, 'purchased_credit_grant', ?, NULL, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      grantId,
      input.credits,
      sourceReason,
      input.idempotencyKey,
      input.occurredAt,
      checkoutSessionId,
      stripeInvoiceId,
      normalizeNullableLedgerString(input.stripeInvoiceStatus),
      normalizeNullableLedgerString(input.hostedInvoiceUrl),
    );

    return {
      entry_id: entryId,
      grant_id: grantId,
      workspace_id: input.workspaceId,
      granted_credits: input.credits,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async recordCreditPackPaymentFailed(
    input: RecordCreditPackPaymentFailedInput,
  ): Promise<RecordCreditPackPaymentFailedResult> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "credit_pack_payment_failed") {
      this.updateLedgerEntryInvoiceReference(existing.id, input);
      return {
        entry_id: existing.id,
        workspace_id: input.workspaceId,
      };
    }

    const entryId = `entry_${input.idempotencyKey}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         stripe_checkout_session_id,
         stripe_invoice_id,
         stripe_invoice_status,
         stripe_hosted_invoice_url
       )
       VALUES (?, ?, 'credit_pack_payment_failed', NULL, NULL, 0, '', 'Credit pack payment failed', ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      input.idempotencyKey,
      input.occurredAt,
      normalizeNullableLedgerString(input.checkoutSessionId),
      normalizeNullableLedgerString(input.stripeInvoiceId),
      normalizeNullableLedgerString(input.stripeInvoiceStatus) || "payment_failed",
      normalizeNullableLedgerString(input.hostedInvoiceUrl),
    );

    return {
      entry_id: entryId,
      workspace_id: input.workspaceId,
    };
  }

  async reserveCreditsForDocumentSubmission(
    input: ReserveCreditsForDocumentSubmissionInput,
  ): Promise<ReserveCreditsForDocumentSubmissionResult> {
    this.ensureSchema();

    if (!Number.isInteger(input.billableDocumentPages) || input.billableDocumentPages <= 0) {
      throw new BillingReservationError("insufficient_credits", "Billable Document page count must be positive");
    }

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "credit_reservation") {
      return {
        entry_id: existing.id,
        reservation_id: existing.grant_id,
        workspace_id: input.workspaceId,
        extraction_job_id: existing.extraction_job_id || input.extractionJobId,
        reserved_credits: Math.abs(Number(existing.credits)),
        billable_document_pages: Number(existing.billable_document_pages || input.billableDocumentPages),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const pagesUsed = this.calculateBillablePagesUsed(input.billingPeriodStart, input.billingPeriodEnd);
    if (pagesUsed + input.billableDocumentPages > input.monthlyPageLimit) {
      throw new BillingReservationError(
        "plan_page_limit_exceeded",
        "Workspace has exceeded remaining Plan page capacity",
      );
    }

    if (this.calculateCreditBucketsAvailable({
      billingPeriodStart: input.billingPeriodStart,
      billingPeriodEnd: input.billingPeriodEnd,
      monthlyPageLimit: input.monthlyPageLimit,
    }).total_available < input.billableDocumentPages) {
      throw new BillingReservationError(
        "insufficient_credits",
        "Workspace has insufficient Credits for this Document",
      );
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const reservationId = `reservation_${input.extractionJobId}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         extraction_job_id,
         template_id,
         template_version,
         billable_document_pages,
         billing_period_start,
         billing_period_end,
         auth_mode
       )
       VALUES (?, ?, 'credit_reservation', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      reservationId,
      -input.billableDocumentPages,
      input.actorUserId || "",
      "Document submission",
      input.idempotencyKey,
      input.submittedAt,
      input.extractionJobId,
      input.templateId,
      input.templateVersion,
      input.billableDocumentPages,
      input.billingPeriodStart,
      input.billingPeriodEnd,
      input.authMode,
    );

    return {
      entry_id: entryId,
      reservation_id: reservationId,
      workspace_id: input.workspaceId,
      extraction_job_id: input.extractionJobId,
      reserved_credits: input.billableDocumentPages,
      billable_document_pages: input.billableDocumentPages,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async refundCreditReservation(input: RefundCreditReservationInput): Promise<RefundCreditReservationResult | null> {
    this.ensureSchema();

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "credit_refund") {
      return {
        entry_id: existing.id,
        refund_id: existing.grant_id,
        workspace_id: input.workspaceId,
        extraction_job_id: existing.extraction_job_id || input.extractionJobId,
        refunded_credits: Number(existing.credits),
        billable_document_pages: Math.abs(Number(existing.billable_document_pages || 0)),
        available_credits: this.calculateCreditsAvailable(),
      };
    }

    const reservation = this.findReservationByExtractionJobId(input.extractionJobId);
    if (!reservation) {
      return null;
    }

    const refundablePages = this.calculateReservationUnrefundedPages(input.extractionJobId);
    if (refundablePages <= 0) {
      return null;
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const refundId = `refund_${input.idempotencyKey}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         extraction_job_id,
         template_id,
         template_version,
         billable_document_pages,
         billing_period_start,
         billing_period_end,
         auth_mode
       )
       VALUES (?, ?, 'credit_refund', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      refundId,
      reservation.grant_id,
      refundablePages,
      "",
      input.reason,
      input.idempotencyKey,
      input.occurredAt,
      input.extractionJobId,
      reservation.template_id,
      reservation.template_version,
      -refundablePages,
      reservation.billing_period_start,
      reservation.billing_period_end,
      reservation.auth_mode,
    );

    return {
      entry_id: entryId,
      refund_id: refundId,
      workspace_id: input.workspaceId,
      extraction_job_id: input.extractionJobId,
      refunded_credits: refundablePages,
      billable_document_pages: refundablePages,
      available_credits: this.calculateCreditsAvailable(),
    };
  }

  async recordNoBillingUsage(input: RecordNoBillingUsageInput): Promise<RecordNoBillingUsageResult> {
    this.ensureSchema();

    if (!Number.isInteger(input.billableDocumentPages) || input.billableDocumentPages <= 0) {
      throw new BillingReservationError("insufficient_credits", "Billable Document page count must be positive");
    }

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "no_billing_usage") {
      return {
        entry_id: existing.id,
        usage_id: existing.grant_id,
        workspace_id: input.workspaceId,
        extraction_job_id: existing.extraction_job_id || input.extractionJobId,
        billable_document_pages: Number(existing.billable_document_pages || input.billableDocumentPages),
      };
    }

    const entryId = `entry_${input.idempotencyKey}`;
    const usageId = `no_billing_usage_${input.extractionJobId}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         extraction_job_id,
         template_id,
         template_version,
         billable_document_pages,
         billing_period_start,
         billing_period_end,
         auth_mode
       )
       VALUES (?, ?, 'no_billing_usage', ?, NULL, 0, ?, 'No-billing Document submission', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      input.workspaceId,
      usageId,
      input.actorUserId || "",
      input.idempotencyKey,
      input.submittedAt,
      input.extractionJobId,
      input.templateId,
      input.templateVersion,
      input.billableDocumentPages,
      input.billingPeriodStart,
      input.billingPeriodEnd,
      input.authMode,
    );

    return {
      entry_id: entryId,
      usage_id: usageId,
      workspace_id: input.workspaceId,
      extraction_job_id: input.extractionJobId,
      billable_document_pages: input.billableDocumentPages,
    };
  }

  async recordEnterpriseUsageCharge(input: RecordEnterpriseUsageChargeInput): Promise<RecordEnterpriseUsageChargeResult> {
    this.ensureSchema();

    if (!Number.isInteger(input.billableDocumentPages) || input.billableDocumentPages <= 0) {
      throw new BillingReservationError("insufficient_credits", "Billable Document page count must be positive");
    }

    const existing = this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (existing && existing.type === "enterprise_usage_charge") {
      return {
        entry_id: existing.id,
        charge_id: existing.grant_id,
        workspace_id: input.workspaceId,
        extraction_job_id: existing.extraction_job_id || input.extractionJobId,
        billable_document_pages: Number(existing.billable_document_pages || input.billableDocumentPages),
        amount: formatGbpAmount(Number(existing.amount_minor || 0)),
      };
    }

    const existingPages = this.calculateEnterpriseBillablePagesUsed(
      input.billingPeriodStart,
      input.billingPeriodEnd,
    );
    const amountMinor = Number.isInteger(input.amountMinor)
      ? Number(input.amountMinor)
      : calculateEnterpriseRampUpAmountMinor(existingPages, input.billableDocumentPages);
    const entryId = `entry_${input.idempotencyKey}`;
    const chargeId = `enterprise_usage_${input.extractionJobId}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_entries (
         id,
         workspace_id,
         type,
         grant_id,
         related_grant_id,
         credits,
         actor_user_id,
         reason,
         idempotency_key,
         occurred_at,
         extraction_job_id,
         template_id,
         template_version,
         billable_document_pages,
         billing_period_start,
         billing_period_end,
         auth_mode,
         amount_minor,
         currency,
         tax_behavior
       )
       VALUES (?, ?, 'enterprise_usage_charge', ?, NULL, 0, ?, 'Enterprise ramp-up Document submission', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP', 'exclusive')`,
      entryId,
      input.workspaceId,
      chargeId,
      input.actorUserId || "",
      input.idempotencyKey,
      input.submittedAt,
      input.extractionJobId,
      input.templateId,
      input.templateVersion,
      input.billableDocumentPages,
      input.billingPeriodStart,
      input.billingPeriodEnd,
      input.authMode,
      amountMinor,
    );

    return {
      entry_id: entryId,
      charge_id: chargeId,
      workspace_id: input.workspaceId,
      extraction_job_id: input.extractionJobId,
      billable_document_pages: input.billableDocumentPages,
      amount: formatGbpAmount(amountMinor),
    };
  }

  async summarizeOwnerBilling(input?: OwnerBillingSummaryInput): Promise<OwnerBillingSummary> {
    this.ensureSchema();

    const creditBuckets = this.calculateCreditBucketsAvailable(input);
    const activityPage = input?.activityLimit
      ? this.listOwnerBillingActivityRows({
          limit: input.activityLimit,
          cursor: input.activityCursor ?? null,
        })
      : null;
    const entries = activityPage
      ? []
      : this.listOwnerBillingActivityRows({ limit: 50 }).owner_billing_activity;
    const pagesUsed = input
      ? this.calculateBillablePagesUsed(input.billingPeriodStart, input.billingPeriodEnd)
      : 0;
    const creditUsage = input?.usageRange
      ? this.summarizeCreditUsageRows({
          range: input.usageRange,
          now: input.usageNow,
        })
      : undefined;

    return {
      credits: {
        included_available: creditBuckets.included_available,
        purchased_available: creditBuckets.purchased_available,
        goodwill_available: creditBuckets.goodwill_available,
        total_available: creditBuckets.total_available,
      },
      current_period: input
        ? {
            pages_used: pagesUsed,
            pages_remaining: input.monthlyPageLimit === null ? null : Math.max(0, input.monthlyPageLimit - pagesUsed),
          }
        : undefined,
      owner_billing_activity: activityPage
        ? activityPage.owner_billing_activity
        : entries,
      ...(activityPage ? { owner_billing_activity_next_cursor: activityPage.next_cursor } : {}),
      ...(creditUsage ? { credit_usage: creditUsage } : {}),
    };
  }

  async listOwnerBillingActivity(input: OwnerBillingActivityPageInput): Promise<OwnerBillingActivityPage> {
    this.ensureSchema();
    return this.listOwnerBillingActivityRows(input);
  }

  async summarizeCreditUsage(input: OwnerBillingUsageSummaryInput): Promise<OwnerBillingUsageSeries> {
    this.ensureSchema();
    return this.summarizeCreditUsageRows(input);
  }

  async summarizeEnterpriseUsageCharges(
    input: EnterpriseUsageChargeSummaryInput,
  ): Promise<EnterpriseUsageChargeSummary> {
    this.ensureSchema();

    const row = this.ctx.storage.sql
      .exec<{ pages: number | null; amount_minor: number | null }>(
        `SELECT COALESCE(SUM(billable_document_pages), 0) AS pages,
                COALESCE(SUM(amount_minor), 0) AS amount_minor
         FROM ledger_entries
         WHERE type = 'enterprise_usage_charge'
           AND billing_period_start = ?
           AND billing_period_end = ?`,
        input.billingPeriodStart,
        input.billingPeriodEnd,
      )
      .one();
    const amountMinor = Number(row.amount_minor || 0);
    return {
      billable_document_pages: Number(row.pages || 0),
      amount: formatGbpAmount(amountMinor),
    };
  }

  private listOwnerBillingActivityRows(input: OwnerBillingActivityPageInput): OwnerBillingActivityPage {
    const limit = Math.max(1, Math.min(Math.floor(Number(input.limit || 1)), 50));
    const filters = [
      "type IN ('goodwill_credit_grant', 'included_credit_grant', 'purchased_credit_grant', 'credit_pack_payment_failed')",
    ];
    const params: Array<string | number> = [];

    if (input.cursor) {
      filters.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
      params.push(input.cursor.occurred_at, input.cursor.occurred_at, input.cursor.id);
    }

    const rows = this.ctx.storage.sql
      .exec<LedgerEntryRow>(
        `SELECT id,
                type,
                grant_id,
                related_grant_id,
                credits,
                occurred_at,
                extraction_job_id,
                template_id,
                template_version,
                billable_document_pages,
                amount_minor,
                currency,
                tax_behavior,
                stripe_checkout_session_id,
                stripe_invoice_id,
                stripe_invoice_status,
                stripe_hosted_invoice_url
         FROM ledger_entries
         WHERE ${filters.join(" AND ")}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`,
        ...params,
        limit + 1,
      )
      .toArray();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1] || null;

    return {
      owner_billing_activity: page.map((entry) => ownerBillingActivityFromEntry(entry)),
      next_cursor: rows.length > limit && last ? { occurred_at: last.occurred_at, id: last.id } : null,
    };
  }

  private summarizeCreditUsageRows(input: OwnerBillingUsageSummaryInput): OwnerBillingUsageSeries {
    const buckets = buildCreditUsageBuckets(input.range, input.now);
    const windowStart = buckets[0]?.start_at;
    const windowEnd = buckets[buckets.length - 1]?.end_at;
    if (!windowStart || !windowEnd) {
      return {
        range: input.range,
        total_credits: 0,
        total_billable_document_pages: 0,
        buckets,
      };
    }

    const rows = this.ctx.storage.sql
      .exec<CreditUsageEntryRow>(
        `SELECT credits,
                occurred_at,
                billable_document_pages
         FROM ledger_entries
         WHERE type = 'credit_reservation'
           AND occurred_at >= ?
           AND occurred_at < ?
         ORDER BY occurred_at ASC`,
        windowStart,
        windowEnd,
      )
      .toArray();

    for (const row of rows) {
      const bucket = findCreditUsageBucket(buckets, row.occurred_at, input.range);
      if (!bucket) {
        continue;
      }
      bucket.credits += Math.abs(Number(row.credits || 0));
      bucket.billable_document_pages += Math.abs(Number(row.billable_document_pages || 0));
    }

    return {
      range: input.range,
      total_credits: buckets.reduce((total, bucket) => total + bucket.credits, 0),
      total_billable_document_pages: buckets.reduce(
        (total, bucket) => total + bucket.billable_document_pages,
        0,
      ),
      buckets,
    };
  }

  private findEntryByIdempotencyKey(idempotencyKey: string): LedgerEntryRow | null {
    return this.ctx.storage.sql
      .exec<LedgerEntryRow>(
        `SELECT id,
                type,
                grant_id,
                related_grant_id,
                credits,
                occurred_at,
                extraction_job_id,
                template_id,
                template_version,
                billable_document_pages,
                amount_minor,
                currency,
                tax_behavior,
                billing_period_start,
                billing_period_end,
                auth_mode,
                stripe_checkout_session_id,
                stripe_invoice_id,
                stripe_invoice_status,
                stripe_hosted_invoice_url
         FROM ledger_entries
         WHERE idempotency_key = ?
         LIMIT 1`,
        idempotencyKey,
      )
      .toArray()[0] ?? null;
  }

  private findReservationByExtractionJobId(extractionJobId: string): (LedgerEntryRow & {
    billing_period_start: string;
    billing_period_end: string;
    auth_mode: string;
  }) | null {
    return this.ctx.storage.sql
      .exec<LedgerEntryRow & { billing_period_start: string; billing_period_end: string; auth_mode: string }>(
        `SELECT id,
                type,
                grant_id,
                related_grant_id,
                credits,
                occurred_at,
                extraction_job_id,
                template_id,
                template_version,
                billable_document_pages,
                amount_minor,
                currency,
                tax_behavior,
                billing_period_start,
                billing_period_end,
                auth_mode,
                stripe_checkout_session_id,
                stripe_invoice_id,
                stripe_invoice_status,
                stripe_hosted_invoice_url
         FROM ledger_entries
         WHERE type = 'credit_reservation'
           AND extraction_job_id = ?
         ORDER BY occurred_at ASC
         LIMIT 1`,
        extractionJobId,
      )
      .toArray()[0] ?? null;
  }

  private calculateCreditsAvailable(): number {
    const row = this.ctx.storage.sql
      .exec<{ credits: number | null }>(
        `SELECT COALESCE(SUM(credits), 0) AS credits
         FROM ledger_entries
         WHERE type IN ('goodwill_credit_grant', 'goodwill_credit_revocation', 'included_credit_grant', 'included_credit_revocation', 'purchased_credit_grant', 'credit_reservation', 'credit_refund')`,
      )
      .one();
    return Number(row.credits || 0);
  }

  private calculateCreditBucketsAvailable(input?: OwnerBillingSummaryInput): OwnerBillingSummary["credits"] {
    const rows = input
      ? this.ctx.storage.sql
        .exec<{ type: LedgerEntryType; credits: number | null }>(
          `SELECT type, COALESCE(SUM(credits), 0) AS credits
           FROM ledger_entries
           WHERE type IN ('goodwill_credit_grant', 'goodwill_credit_revocation', 'purchased_credit_grant', 'credit_reservation', 'credit_refund')
              OR (
                type IN ('included_credit_grant', 'included_credit_revocation')
                AND billing_period_start = ?
                AND billing_period_end = ?
              )
           GROUP BY type`,
          input.billingPeriodStart,
          input.billingPeriodEnd,
        )
        .toArray()
      : this.ctx.storage.sql
        .exec<{ type: LedgerEntryType; credits: number | null }>(
          `SELECT type, COALESCE(SUM(credits), 0) AS credits
           FROM ledger_entries
           WHERE type IN ('goodwill_credit_grant', 'goodwill_credit_revocation', 'included_credit_grant', 'included_credit_revocation', 'purchased_credit_grant', 'credit_reservation', 'credit_refund')
           GROUP BY type`,
        )
        .toArray();
    const creditsByType = new Map(rows.map((row) => [row.type, Number(row.credits || 0)]));
    const includedGranted = (creditsByType.get("included_credit_grant") || 0) +
      (creditsByType.get("included_credit_revocation") || 0);
    const purchasedGranted = creditsByType.get("purchased_credit_grant") || 0;
    const goodwillGranted = (creditsByType.get("goodwill_credit_grant") || 0) +
      (creditsByType.get("goodwill_credit_revocation") || 0);
    const reservationNet = (creditsByType.get("credit_reservation") || 0) +
      (creditsByType.get("credit_refund") || 0);
    let remainingSpend = Math.max(0, -reservationNet);

    const includedAvailable = Math.max(0, includedGranted - remainingSpend);
    remainingSpend = Math.max(0, remainingSpend - includedGranted);
    const purchasedAvailable = Math.max(0, purchasedGranted - remainingSpend);
    remainingSpend = Math.max(0, remainingSpend - purchasedGranted);
    const goodwillAvailable = Math.max(0, goodwillGranted - remainingSpend);

    return {
      included_available: includedAvailable,
      purchased_available: purchasedAvailable,
      goodwill_available: goodwillAvailable,
      total_available: includedAvailable + purchasedAvailable + goodwillAvailable,
    };
  }

  private calculateGrantUnspentCredits(grantId: string): number {
    const row = this.ctx.storage.sql
      .exec<{ credits: number | null }>(
        `SELECT COALESCE(SUM(credits), 0) AS credits
         FROM ledger_entries
         WHERE grant_id = ? OR related_grant_id = ?`,
        grantId,
        grantId,
      )
      .one();
    return Math.min(Number(row.credits || 0), this.calculateCreditsAvailable());
  }

  private calculateBillablePagesUsed(billingPeriodStart: string, billingPeriodEnd: string): number {
    const row = this.ctx.storage.sql
      .exec<{ pages: number | null }>(
        `SELECT COALESCE(SUM(billable_document_pages), 0) AS pages
         FROM ledger_entries
         WHERE type IN ('credit_reservation', 'credit_refund', 'no_billing_usage', 'enterprise_usage_charge')
           AND billing_period_start = ?
           AND billing_period_end = ?`,
        billingPeriodStart,
        billingPeriodEnd,
      )
      .one();
    return Number(row.pages || 0);
  }

  private calculateEnterpriseBillablePagesUsed(billingPeriodStart: string, billingPeriodEnd: string): number {
    const row = this.ctx.storage.sql
      .exec<{ pages: number | null }>(
        `SELECT COALESCE(SUM(billable_document_pages), 0) AS pages
         FROM ledger_entries
         WHERE type = 'enterprise_usage_charge'
           AND billing_period_start = ?
           AND billing_period_end = ?`,
        billingPeriodStart,
        billingPeriodEnd,
      )
      .one();
    return Number(row.pages || 0);
  }

  private calculateReservationUnrefundedPages(extractionJobId: string): number {
    const row = this.ctx.storage.sql
      .exec<{ pages: number | null }>(
        `SELECT COALESCE(SUM(billable_document_pages), 0) AS pages
         FROM ledger_entries
         WHERE type IN ('credit_reservation', 'credit_refund')
           AND extraction_job_id = ?`,
        extractionJobId,
      )
      .one();
    return Number(row.pages || 0);
  }

  private ensureSchema(): void {
    if (this.schemaReady) {
      return;
    }

    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS billing_schema_version (
         version INTEGER NOT NULL
       )`,
    );

    const current = this.ctx.storage.sql
      .exec<SchemaVersionRow>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM billing_schema_version",
      )
      .one();

    if (Number(current?.version || 0) >= WORKSPACE_BILLING_LEDGER_SCHEMA_VERSION) {
      this.schemaReady = true;
      return;
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS ledger_entries (
           id TEXT PRIMARY KEY,
           workspace_id TEXT NOT NULL,
           type TEXT NOT NULL,
           grant_id TEXT,
           related_grant_id TEXT,
           credits INTEGER NOT NULL,
           actor_user_id TEXT NOT NULL,
           reason TEXT NOT NULL,
           idempotency_key TEXT NOT NULL UNIQUE,
           occurred_at TEXT NOT NULL,
           extraction_job_id TEXT,
           template_id TEXT,
           template_version INTEGER,
           billable_document_pages INTEGER,
           billing_period_start TEXT,
           billing_period_end TEXT,
           auth_mode TEXT,
           amount_minor INTEGER,
           currency TEXT,
           tax_behavior TEXT,
           stripe_checkout_session_id TEXT,
           stripe_invoice_id TEXT,
           stripe_invoice_status TEXT,
           stripe_hosted_invoice_url TEXT
         )`,
      );
      this.ensureLedgerColumn("extraction_job_id", "TEXT");
      this.ensureLedgerColumn("template_id", "TEXT");
      this.ensureLedgerColumn("template_version", "INTEGER");
      this.ensureLedgerColumn("billable_document_pages", "INTEGER");
      this.ensureLedgerColumn("billing_period_start", "TEXT");
      this.ensureLedgerColumn("billing_period_end", "TEXT");
      this.ensureLedgerColumn("auth_mode", "TEXT");
      this.ensureLedgerColumn("amount_minor", "INTEGER");
      this.ensureLedgerColumn("currency", "TEXT");
      this.ensureLedgerColumn("tax_behavior", "TEXT");
      this.ensureLedgerColumn("stripe_checkout_session_id", "TEXT");
      this.ensureLedgerColumn("stripe_invoice_id", "TEXT");
      this.ensureLedgerColumn("stripe_invoice_status", "TEXT");
      this.ensureLedgerColumn("stripe_hosted_invoice_url", "TEXT");
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_ledger_entries_grant_id ON ledger_entries(grant_id)",
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_ledger_entries_occurred_at ON ledger_entries(occurred_at)",
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_ledger_entries_extraction_job ON ledger_entries(extraction_job_id)",
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM billing_schema_version",
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO billing_schema_version (version) VALUES (?)",
        WORKSPACE_BILLING_LEDGER_SCHEMA_VERSION,
      );
    });

    this.schemaReady = true;
  }

  private ensureLedgerColumn(name: string, definition: string): void {
    const columns = this.ctx.storage.sql
      .exec<LedgerColumnRow>("PRAGMA table_info(ledger_entries)")
      .toArray();
    if (columns.some((column) => column.name === name)) {
      return;
    }
    this.ctx.storage.sql.exec(`ALTER TABLE ledger_entries ADD COLUMN ${name} ${definition}`);
  }

  private updateLedgerEntryInvoiceReference(
    entryId: string,
    input: {
      stripeInvoiceId?: string | null;
      stripeInvoiceStatus?: string | null;
      hostedInvoiceUrl?: string | null;
    },
  ): void {
    const invoiceId = normalizeNullableLedgerString(input.stripeInvoiceId);
    const invoiceStatus = normalizeNullableLedgerString(input.stripeInvoiceStatus);
    const hostedInvoiceUrl = normalizeNullableLedgerString(input.hostedInvoiceUrl);
    if (!invoiceId && !invoiceStatus && !hostedInvoiceUrl) {
      return;
    }

    this.ctx.storage.sql.exec(
      `UPDATE ledger_entries
       SET stripe_invoice_id = COALESCE(?, stripe_invoice_id),
           stripe_invoice_status = COALESCE(?, stripe_invoice_status),
           stripe_hosted_invoice_url = COALESCE(?, stripe_hosted_invoice_url)
       WHERE id = ?`,
      invoiceId,
      invoiceStatus,
      hostedInvoiceUrl,
      entryId,
    );
  }
}

function ownerBillingActivityFromEntry(entry: LedgerEntryRow): OwnerBillingSummary["owner_billing_activity"][number] {
  const base = {
    id: entry.id,
    type: entry.type,
    occurred_at: entry.occurred_at,
    credits: Number(entry.credits),
    description: ownerBillingActivityDescription(entry.type),
  };
  const invoice = ownerBillingInvoiceFromEntry(entry);
  const baseWithInvoice = invoice ? { ...base, invoice } : base;

  if (
    entry.type === "credit_reservation" ||
    entry.type === "credit_refund" ||
    entry.type === "no_billing_usage" ||
    entry.type === "enterprise_usage_charge"
  ) {
    const activity = {
      ...base,
      extraction_job_id: entry.extraction_job_id || "",
      billable_document_pages: Math.abs(Number(entry.billable_document_pages || 0)),
    };
    if (entry.type === "enterprise_usage_charge") {
      return {
        ...activity,
        amount: formatGbpAmount(Number(entry.amount_minor || 0)),
      };
    }
    return activity;
  }

  return baseWithInvoice;
}

function ownerBillingInvoiceFromEntry(entry: LedgerEntryRow): OwnerBillingActivity["invoice"] | null {
  const hostedInvoiceUrl = normalizeNullableLedgerString(entry.stripe_hosted_invoice_url);
  if (!hostedInvoiceUrl) {
    return null;
  }
  return {
    status: normalizeNullableLedgerString(entry.stripe_invoice_status),
    hosted_invoice_url: hostedInvoiceUrl,
  };
}

function normalizeNullableLedgerString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildCreditUsageBuckets(
  range: OwnerBillingUsageRange,
  nowValue?: string,
): OwnerBillingUsageBucket[] {
  const now = validDateOrNow(nowValue);
  if (range === "yearly") {
    const currentStart = startOfUtcMonth(now);
    return Array.from({ length: 12 }, (_, index) => {
      const start = addUtcMonths(currentStart, index - 11);
      const end = addUtcMonths(start, 1);
      return createCreditUsageBucket(formatUtcMonthLabel(start), start, end);
    });
  }

  if (range === "monthly") {
    const currentStart = startOfUtcWeek(now);
    return Array.from({ length: 4 }, (_, index) => {
      const start = addUtcDays(currentStart, (index - 3) * 7);
      const end = addUtcDays(start, 7);
      return createCreditUsageBucket(`w/c ${formatUtcDayMonthLabel(start)}`, start, end);
    });
  }

  if (range === "weekly") {
    const currentStart = startOfUtcDay(now);
    return Array.from({ length: 7 }, (_, index) => {
      const start = addUtcDays(currentStart, index - 6);
      const end = addUtcDays(start, 1);
      return createCreditUsageBucket(formatUtcDayMonthLabel(start), start, end);
    });
  }

  const currentStart = startOfUtcDay(now);
  return Array.from({ length: 24 }, (_, index) => {
    const start = addUtcHours(currentStart, index);
    const end = addUtcHours(start, 1);
    return createCreditUsageBucket(formatUtcHourLabel(start), start, end);
  });
}

function findCreditUsageBucket(
  buckets: OwnerBillingUsageBucket[],
  occurredAt: string,
  range: OwnerBillingUsageRange,
): OwnerBillingUsageBucket | null {
  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime()) || !buckets.length) {
    return null;
  }

  const firstStart = new Date(buckets[0].start_at);
  const index = range === "yearly"
    ? (occurred.getUTCFullYear() - firstStart.getUTCFullYear()) * 12 +
      occurred.getUTCMonth() - firstStart.getUTCMonth()
    : range === "monthly"
      ? Math.floor((startOfUtcDay(occurred).getTime() - firstStart.getTime()) / (7 * 86_400_000))
      : range === "weekly"
        ? Math.floor((startOfUtcDay(occurred).getTime() - firstStart.getTime()) / 86_400_000)
        : Math.floor((startOfUtcHour(occurred).getTime() - firstStart.getTime()) / 3_600_000);

  return buckets[index] ?? null;
}

function createCreditUsageBucket(label: string, start: Date, end: Date): OwnerBillingUsageBucket {
  return {
    label,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    credits: 0,
    billable_document_pages: 0,
  };
}

function validDateOrNow(value?: string): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcHour(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours(),
  ));
}

function startOfUtcWeek(value: Date): Date {
  const dayStart = startOfUtcDay(value);
  const daysSinceMonday = (dayStart.getUTCDay() + 6) % 7;
  return addUtcDays(dayStart, -daysSinceMonday);
}

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function addUtcHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 3_600_000);
}

function addUtcMonths(value: Date, months: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function formatUtcDayMonthLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(value);
}

function formatUtcHourLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(value);
}

function formatUtcMonthLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function ownerBillingActivityDescription(type: LedgerEntryType): string {
  if (type === "goodwill_credit_revocation") {
    return "Goodwill Credits revoked";
  }
  if (type === "included_credit_grant") {
    return "Included Credits granted";
  }
  if (type === "included_credit_revocation") {
    return "Included Credits revoked";
  }
  if (type === "purchased_credit_grant") {
    return "Purchased Credits granted";
  }
  if (type === "credit_pack_payment_failed") {
    return "Credit pack payment failed";
  }
  if (type === "credit_reservation") {
    return "Credits reserved for Document submission";
  }
  if (type === "credit_refund") {
    return "Credits refunded";
  }
  if (type === "no_billing_usage") {
    return "No-billing usage recorded";
  }
  if (type === "enterprise_usage_charge") {
    return "Enterprise usage charge recorded";
  }
  return "Goodwill Credits granted";
}

function calculateEnterpriseRampUpAmountMinor(existingPages: number, newPages: number): number {
  const bands = [
    { upTo: 10000, amountMinor: 14 },
    { upTo: 20000, amountMinor: 13 },
    { upTo: 40000, amountMinor: 12 },
    { upTo: 60000, amountMinor: 11 },
    { upTo: Number.POSITIVE_INFINITY, amountMinor: 10 },
  ];
  let remainingPages = newPages;
  let currentPage = existingPages;
  let total = 0;
  for (const band of bands) {
    if (remainingPages <= 0) {
      break;
    }
    const availableInBand = Math.max(0, band.upTo - currentPage);
    if (availableInBand <= 0) {
      continue;
    }
    const pagesInBand = Math.min(remainingPages, availableInBand);
    total += pagesInBand * band.amountMinor;
    remainingPages -= pagesInBand;
    currentPage += pagesInBand;
  }
  return total;
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
    display: `GBP ${(amountMinor / 100).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    tax_behavior: "exclusive",
  };
}
