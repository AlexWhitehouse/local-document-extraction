import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { WorkspaceBillingLedger } = await import("./workspaceBillingLedger");

describe("WorkspaceBillingLedger Goodwill Credit grants", () => {
  it("makes duplicate Goodwill Credit grant requests idempotent", async () => {
    const ledger = createLedger();

    const firstGrant = await ledger.grantGoodwillCredits({
      workspaceId: "workspace_billing",
      credits: 25,
      reason: "Support adjustment for onboarding",
      actorUserId: "user_admin",
      idempotencyKey: "grant-request-1",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    const duplicateGrant = await ledger.grantGoodwillCredits({
      workspaceId: "workspace_billing",
      credits: 25,
      reason: "Support adjustment for onboarding",
      actorUserId: "user_admin",
      idempotencyKey: "grant-request-1",
      occurredAt: "2026-05-31T12:00:05.000Z",
    });

    expect(duplicateGrant).toEqual(firstGrant);
    await expect(ledger.summarizeOwnerBilling()).resolves.toEqual({
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 25,
        total_available: 25,
      },
      owner_billing_activity: [
        {
          id: firstGrant.entry_id,
          type: "goodwill_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 25,
          description: "Goodwill Credits granted",
        },
      ],
    });
  });

  it("keeps revoked Goodwill Credit grants out of owner-facing additions activity", async () => {
    const ledger = createLedger();
    const grant = await ledger.grantGoodwillCredits({
      workspaceId: "workspace_billing",
      credits: 25,
      reason: "Support adjustment for onboarding",
      actorUserId: "user_admin",
      idempotencyKey: "grant-request-1",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const firstRevocation = await ledger.revokeGoodwillCreditGrant({
      workspaceId: "workspace_billing",
      grantId: grant.grant_id,
      reason: "Grant entered for the wrong Workspace",
      actorUserId: "user_admin",
      idempotencyKey: "revoke-request-1",
      occurredAt: "2026-05-31T12:05:00.000Z",
    });
    const duplicateRevocation = await ledger.revokeGoodwillCreditGrant({
      workspaceId: "workspace_billing",
      grantId: grant.grant_id,
      reason: "Grant entered for the wrong Workspace",
      actorUserId: "user_admin",
      idempotencyKey: "revoke-request-1",
      occurredAt: "2026-05-31T12:06:00.000Z",
    });

    expect(duplicateRevocation).toEqual(firstRevocation);
    await expect(ledger.summarizeOwnerBilling()).resolves.toEqual({
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      owner_billing_activity: [
        {
          id: grant.entry_id,
          type: "goodwill_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 25,
          description: "Goodwill Credits granted",
        },
      ],
    });
  });

  it("pages Owner billing activity from the most recent entry with a cursor", async () => {
    const ledger = createLedger();
    const grants: Array<{ entry_id: string }> = [];
    for (let index = 1; index <= 6; index += 1) {
      grants.push(await ledger.grantGoodwillCredits({
        workspaceId: "workspace_billing",
        credits: index,
        reason: `Support adjustment ${index}`,
        actorUserId: "user_admin",
        idempotencyKey: `grant-request-${index}`,
        occurredAt: `2026-05-31T12:0${index}:00.000Z`,
      }));
    }

    const firstPage = await ledger.listOwnerBillingActivity({ limit: 5 });
    expect(firstPage.owner_billing_activity.map((activity) => activity.id)).toEqual([
      grants[5].entry_id,
      grants[4].entry_id,
      grants[3].entry_id,
      grants[2].entry_id,
      grants[1].entry_id,
    ]);
    expect(firstPage.next_cursor).toEqual({
      occurred_at: "2026-05-31T12:02:00.000Z",
      id: grants[1].entry_id,
    });

    const secondPage = await ledger.listOwnerBillingActivity({
      limit: 5,
      cursor: firstPage.next_cursor,
    });
    expect(secondPage.owner_billing_activity.map((activity) => activity.id)).toEqual([
      grants[0].entry_id,
    ]);
    expect(secondPage.next_cursor).toBeNull();
  });

  it("spends Included Credits before Goodwill Credits for prepaid reservations", async () => {
    const ledger = createLedger();
    await ledger.grantIncludedCredits({
      workspaceId: "workspace_billing",
      credits: 1,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      idempotencyKey: "included-grant-1",
      occurredAt: "2026-05-01T00:00:00.000Z",
    });
    await ledger.grantGoodwillCredits({
      workspaceId: "workspace_billing",
      credits: 2,
      reason: "Support adjustment for onboarding",
      actorUserId: "user_admin",
      idempotencyKey: "grant-request-1",
      occurredAt: "2026-05-01T00:05:00.000Z",
    });

    await ledger.reserveCreditsForDocumentSubmission({
      workspaceId: "workspace_billing",
      extractionJobId: "job_prepaid",
      templateId: "template_test",
      templateVersion: 3,
      billableDocumentPages: 2,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyPageLimit: 500,
      submittedAt: "2026-05-15T12:00:00.000Z",
      authMode: "api_key",
      actorUserId: null,
      idempotencyKey: "submission-job-prepaid",
    });

    await expect(ledger.summarizeOwnerBilling({
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyPageLimit: 500,
    })).resolves.toMatchObject({
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 1,
        total_available: 1,
      },
      current_period: {
        pages_used: 2,
        pages_remaining: 498,
      },
    });
  });

  it("revokes only unspent Included Credits from the current billing period", async () => {
    const ledger = createLedger();
    const grant = await ledger.grantIncludedCredits({
      workspaceId: "workspace_billing",
      credits: 200,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      idempotencyKey: "included-grant-1",
      occurredAt: "2026-05-01T00:00:00.000Z",
    });
    await ledger.reserveCreditsForDocumentSubmission({
      workspaceId: "workspace_billing",
      extractionJobId: "job_prepaid",
      templateId: "template_test",
      templateVersion: 3,
      billableDocumentPages: 4,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyPageLimit: 500,
      submittedAt: "2026-05-15T12:00:00.000Z",
      authMode: "api_key",
      actorUserId: null,
      idempotencyKey: "submission-job-prepaid",
    });

    const firstRevocation = await ledger.revokeIncludedCredits({
      workspaceId: "workspace_billing",
      credits: 196,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      idempotencyKey: "included-revoke-1",
      occurredAt: "2026-05-16T12:00:00.000Z",
    });
    const duplicateRevocation = await ledger.revokeIncludedCredits({
      workspaceId: "workspace_billing",
      credits: 196,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      idempotencyKey: "included-revoke-1",
      occurredAt: "2026-05-16T12:05:00.000Z",
    });

    expect(duplicateRevocation).toEqual(firstRevocation);
    await expect(ledger.summarizeOwnerBilling({
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyPageLimit: 500,
    })).resolves.toMatchObject({
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      current_period: {
        pages_used: 4,
        pages_remaining: 496,
      },
      owner_billing_activity: [
        {
          id: grant.entry_id,
          type: "included_credit_grant",
          credits: 200,
        },
      ],
    });
  });

  it("summarizes Credit deductions into usage buckets", async () => {
    const ledger = createLedger();
    await ledger.grantGoodwillCredits({
      workspaceId: "workspace_billing",
      credits: 10,
      reason: "Support adjustment for onboarding",
      actorUserId: "user_admin",
      idempotencyKey: "grant-request-usage",
      occurredAt: "2026-05-01T00:00:00.000Z",
    });

    await ledger.reserveCreditsForDocumentSubmission({
      workspaceId: "workspace_billing",
      extractionJobId: "job_usage_may",
      templateId: "template_test",
      templateVersion: 3,
      billableDocumentPages: 2,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyPageLimit: 500,
      submittedAt: "2026-05-31T12:00:00.000Z",
      authMode: "api_key",
      actorUserId: null,
      idempotencyKey: "submission-job-usage-may",
    });
    await ledger.reserveCreditsForDocumentSubmission({
      workspaceId: "workspace_billing",
      extractionJobId: "job_usage_june",
      templateId: "template_test",
      templateVersion: 3,
      billableDocumentPages: 1,
      billingPeriodStart: "2026-06-01T00:00:00.000Z",
      billingPeriodEnd: "2026-07-01T00:00:00.000Z",
      monthlyPageLimit: 500,
      submittedAt: "2026-06-01T08:00:00.000Z",
      authMode: "session",
      actorUserId: "user_owner",
      idempotencyKey: "submission-job-usage-june",
    });

    const dailyUsage = await ledger.summarizeCreditUsage({
      range: "daily",
      now: "2026-06-01T12:00:00.000Z",
    });

    expect(dailyUsage).toMatchObject({
      range: "daily",
      total_credits: 1,
      total_billable_document_pages: 1,
    });
    expect(dailyUsage.buckets).toHaveLength(24);
    expect(dailyUsage.buckets.find((bucket) => bucket.label === "08:00")).toMatchObject({
      credits: 1,
      billable_document_pages: 1,
    });
    expect(dailyUsage.buckets.find((bucket) => bucket.label === "12:00")).toMatchObject({
      credits: 0,
      billable_document_pages: 0,
    });

    const weeklyUsage = await ledger.summarizeCreditUsage({
      range: "weekly",
      now: "2026-06-01T12:00:00.000Z",
    });
    expect(weeklyUsage).toMatchObject({
      range: "weekly",
      total_credits: 3,
      total_billable_document_pages: 3,
    });
    expect(weeklyUsage.buckets).toHaveLength(7);
    expect(weeklyUsage.buckets.find((bucket) => bucket.label === "31 May")).toMatchObject({
      credits: 2,
      billable_document_pages: 2,
    });

    const monthlyUsage = await ledger.summarizeCreditUsage({
      range: "monthly",
      now: "2026-06-01T12:00:00.000Z",
    });
    expect(monthlyUsage.buckets).toHaveLength(4);
    expect(monthlyUsage.total_credits).toBe(3);

    const yearlyUsage = await ledger.summarizeCreditUsage({
      range: "yearly",
      now: "2026-06-01T12:00:00.000Z",
    });
    expect(yearlyUsage.buckets).toHaveLength(12);
    expect(yearlyUsage.buckets.find((bucket) => bucket.label === "Jun 2026")).toMatchObject({
      credits: 1,
      billable_document_pages: 1,
    });
  });

  it("makes duplicate Purchased Credit grants idempotent", async () => {
    const ledger = createLedger();

    const firstGrant = await ledger.grantPurchasedCredits({
      workspaceId: "workspace_billing",
      credits: 100,
      stripeEventId: "evt_credit_pack_paid",
      checkoutSessionId: "cs_test_credit_pack_100",
      stripeInvoiceId: "in_credit_pack_100",
      stripeInvoiceStatus: "paid",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/in_credit_pack_100",
      idempotencyKey: "stripe_evt_credit_pack_paid",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    const duplicateGrant = await ledger.grantPurchasedCredits({
      workspaceId: "workspace_billing",
      credits: 100,
      stripeEventId: "evt_credit_pack_paid",
      checkoutSessionId: "cs_test_credit_pack_100",
      idempotencyKey: "stripe_evt_credit_pack_paid",
      occurredAt: "2026-05-31T12:00:05.000Z",
    });

    expect(duplicateGrant).toEqual(firstGrant);
    await expect(ledger.summarizeOwnerBilling()).resolves.toMatchObject({
      credits: {
        included_available: 0,
        purchased_available: 100,
        goodwill_available: 0,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: firstGrant.entry_id,
          type: "purchased_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 100,
          description: "Purchased Credits granted",
          invoice: {
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_100",
          },
        },
      ],
    });
  });

  it("records failed Credit pack payments without changing available Credits", async () => {
    const ledger = createLedger();

    const firstFailure = await ledger.recordCreditPackPaymentFailed({
      workspaceId: "workspace_billing",
      stripeEventId: "evt_credit_pack_async_payment_failed",
      checkoutSessionId: "cs_test_credit_pack_async_failed",
      stripeInvoiceId: "in_credit_pack_async_failed",
      stripeInvoiceStatus: "payment_failed",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/in_credit_pack_async_failed",
      idempotencyKey: "stripe_credit_pack_payment_failed_purchase_async_failed",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    const duplicateFailure = await ledger.recordCreditPackPaymentFailed({
      workspaceId: "workspace_billing",
      stripeEventId: "evt_credit_pack_async_payment_failed_duplicate",
      checkoutSessionId: "cs_test_credit_pack_async_failed",
      idempotencyKey: "stripe_credit_pack_payment_failed_purchase_async_failed",
      occurredAt: "2026-05-31T12:05:00.000Z",
    });

    expect(duplicateFailure).toEqual(firstFailure);
    await expect(ledger.summarizeOwnerBilling()).resolves.toMatchObject({
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      owner_billing_activity: [
        {
          id: firstFailure.entry_id,
          type: "credit_pack_payment_failed",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 0,
          description: "Credit pack payment failed",
          invoice: {
            status: "payment_failed",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_async_failed",
          },
        },
      ],
    });
  });

  it("does not carry Included Credits into later Billing periods", async () => {
    const ledger = createLedger();

    await ledger.grantIncludedCredits({
      workspaceId: "workspace_billing",
      credits: 200,
      billingPeriodStart: "2026-05-31T12:00:00.000Z",
      billingPeriodEnd: "2026-06-30T12:00:00.000Z",
      idempotencyKey: "included-pro-first-period",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    await expect(ledger.summarizeOwnerBilling({
      billingPeriodStart: "2026-06-30T12:00:00.000Z",
      billingPeriodEnd: "2026-07-31T12:00:00.000Z",
      monthlyPageLimit: 1500,
    })).resolves.toMatchObject({
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      current_period: {
        pages_used: 0,
        pages_remaining: 1500,
      },
    });
  });

  it("summarizes Enterprise usage charges for a closed invoice period", async () => {
    const ledger = createLedger();
    await ledger.recordEnterpriseUsageCharge({
      workspaceId: "workspace_billing",
      extractionJobId: "job_enterprise_1",
      templateId: "template_test",
      templateVersion: 3,
      billableDocumentPages: 10000,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      submittedAt: "2026-05-15T12:00:00.000Z",
      authMode: "api_key",
      actorUserId: null,
      idempotencyKey: "enterprise-job-1",
    });
    await ledger.recordEnterpriseUsageCharge({
      workspaceId: "workspace_billing",
      extractionJobId: "job_enterprise_2",
      templateId: "template_test",
      templateVersion: 3,
      billableDocumentPages: 1,
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      submittedAt: "2026-05-16T12:00:00.000Z",
      authMode: "session",
      actorUserId: "user_owner",
      idempotencyKey: "enterprise-job-2",
    });

    await expect(ledger.summarizeEnterpriseUsageCharges({
      billingPeriodStart: "2026-05-01T00:00:00.000Z",
      billingPeriodEnd: "2026-06-01T00:00:00.000Z",
    })).resolves.toEqual({
      billable_document_pages: 10001,
      amount: {
        currency: "GBP",
        amount_minor: 140013,
        display: "GBP 1,400.13",
        tax_behavior: "exclusive",
      },
    });
  });
});

function createLedger(): InstanceType<typeof WorkspaceBillingLedger> {
  const sql = new DurableObjectSqlStorageAdapter();
  const storage = {
    sql,
    transactionSync<T>(callback: () => T): T {
      sql.database.exec("BEGIN");
      try {
        const result = callback();
        sql.database.exec("COMMIT");
        return result;
      } catch (error) {
        sql.database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const ctx = {
    storage,
    blockConcurrencyWhile(callback: () => unknown): void {
      callback();
    },
  } as unknown as DurableObjectState;

  return new WorkspaceBillingLedger(ctx, {} as Env);
}

class DurableObjectSqlStorageAdapter {
  readonly database = new DatabaseSync(":memory:");

  exec<T = unknown>(sql: string, ...params: unknown[]): DurableObjectSqlCursor<T> {
    const statement = this.database.prepare(sql);
    const normalizedParams = params.map((param) => param === undefined ? null : param) as SQLInputValue[];
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
      return new DurableObjectSqlCursor(statement.all(...normalizedParams) as T[], 0);
    }

    const result = statement.run(...normalizedParams);
    return new DurableObjectSqlCursor([], Number(result.changes || 0));
  }
}

class DurableObjectSqlCursor<T> {
  constructor(
    private readonly rows: T[],
    readonly rowsWritten: number,
  ) {}

  toArray(): T[] {
    return this.rows;
  }

  one(): T {
    if (!this.rows[0]) {
      throw new Error("Expected one SQL row");
    }
    return this.rows[0];
  }
}
