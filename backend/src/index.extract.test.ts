import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const authenticateMock = vi.hoisted(() => vi.fn());
const requireSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/auth", () => ({
  authenticate: authenticateMock,
  requireSession: requireSessionMock,
}));

vi.mock("./lib/betterAuth", () => ({
  createAuth: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  WorkflowEntrypoint: class {},
}));

import worker from "./index";
import { WorkspaceBillingLedger } from "./lib/workspaceBillingLedger";

type ProductStoreStub = {
  validateTemplateForDocumentSubmission: ReturnType<typeof vi.fn>;
  summarizePlanLimitUsage: ReturnType<typeof vi.fn>;
  createQueuedExtractionJob: ReturnType<typeof vi.fn>;
  failQueuedExtractionJob: ReturnType<typeof vi.fn>;
};

type AnalyticsBindingStub = Env["WORKSPACE_PRODUCT_ANALYTICS"] & {
  writeDataPoint: ReturnType<typeof vi.fn>;
};

const ONE_PAGE_PDF_SOURCE_BYTES = Uint8Array.from(Buffer.from(
  "JVBERi0xLjcKJYGBgYEKCjUgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA0Ci9GaXJzdCAyMAovTGVuZ3RoIDI2OAo+PgpzdHJlYW0KeJzVkktLxDAQx+/5FHPUy2aSJk0qpbD2cRFhWTy5eAjbsBRks/QB+u2dNKviQTxL+JPH/Cav/whAkKAUZGAsKNCZhLJk/On94oHv3MlPjD8M/QQHiiLs4YXxOiznGQSrKvbN1m52r+HEUhKICH8SuzH0y9GPUHZt1yEaRMwVKUeUDfU1qSBJmlNMWhqTjLqK1kyGmG0p1iXlJuXE+Mrqa35LPbF5ZJrEKpvmX+fGs9q0h/zrPkXF+GPoGzd7uGnuJMocdSaEVFab51v6jtG7Ofzfx633H8L51xf+8DnaG00efayB1WW+91NYxiPZTlwV/8v3g7sPb1Q1SE0XeiMtWCU2tqAKIuQDoYqPLwplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9TaXplIDcKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCAzNAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA3IF0KPj4Kc3RyZWFtCnicFcQxDgAgCASwHsbdN/txCB2K7nLZstV24pF8BkOhArYKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjM4NgolJUVPRg==",
  "base64",
));

describe("Extraction submission route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({
      workspace: {
        id: "workspace_test",
        api_key_hash: "hash_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        created_by_user_id: "user_test",
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: null,
      },
      auth_mode: "api_key",
      user_id: null,
    });
    requireSessionMock.mockResolvedValue({
      id: "user_owner",
      email: "owner@example.com",
      name: "Workspace Owner",
      role: "user",
    });
  });

  it("rejects legacy image field submissions", async () => {
    const response = await worker.fetch(createExtractRequest("image"), createExtractEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_document",
        message: "document is required",
      },
    });
  });

  it("rejects generic file field submissions", async () => {
    const response = await worker.fetch(createExtractRequest("file"), createExtractEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_document",
        message: "document is required",
      },
    });
  });

  it("accepts supported Document submissions", async () => {
    const legacyProductRead = vi.fn(async () => {
      throw new Error("legacy global D1 product tables should not be required for Document submission");
    });
    const productStore = createQueueingProductStoreStub();
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      DB: createLegacyProductDb({ legacyProductRead }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });
    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "queued",
      source_name: "invoice.pdf",
      template_id: "template_test",
      template_version: 1,
    });
    expect(body).not.toHaveProperty("image_name");
    expect(body).not.toHaveProperty("source_file_page_count");
    expect(env.SOURCE_FILES_BUCKET.put).toHaveBeenCalledWith(
      expect.stringMatching(/^workspaces\/workspace_test\/jobs\/job_/),
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "application/pdf",
        },
      },
    );
    expect(env.EXTRACTION_JOBS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "workspace_test",
        template_id: "template_test",
        template_version: 1,
      }),
      { contentType: "json" },
    );
    expect(productStore.validateTemplateForDocumentSubmission).toHaveBeenCalledWith("template_test");
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "template_test",
        templateVersion: 1,
        sourceMimeType: "application/pdf",
        sourceName: "invoice.pdf",
        sourceFilePageCount: 1,
      }),
    );
    expect(legacyProductRead).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["workspace_test"],
        blobs: expect.arrayContaining(["document_submitted", "workspace_test", "template_test", "application/pdf"]),
        doubles: expect.arrayContaining([ONE_PAGE_PDF_SOURCE_BYTES.byteLength, 1]),
      }),
    );
    expect(JSON.stringify(analytics.writeDataPoint.mock.calls[0]?.[0])).not.toContain("invoice.pdf");
  });

  it("reserves prepaid Credits and Plan page capacity before accepting a PDF Document submission", async () => {
    requireSessionMock
      .mockResolvedValueOnce({
        id: "user_admin",
        email: "admin@example.com",
        name: "Application Admin",
        role: "admin",
      })
      .mockResolvedValueOnce({
        id: "user_owner",
        email: "owner@example.com",
        name: "Workspace Owner",
        role: "user",
      });
    const productStore = createQueueingProductStoreStub();
    const billingLedger = createWorkspaceBillingLedgerBinding("workspace_test");
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: billingLedger,
    });

    const grantResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_test/goodwill-credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credits: 2,
          reason: "Manual test grant",
          idempotency_key: "grant-request-1",
        }),
      }),
      env,
    );
    expect(grantResponse.status).toBe(201);

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(202);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_test",
      credits: {
        goodwill_available: 1,
        total_available: 1,
      },
      current_period: {
        monthly_page_limit: 500,
        pages_used: 1,
        pages_remaining: 499,
      },
      owner_billing_activity: expect.arrayContaining([
        expect.objectContaining({
          type: "goodwill_credit_grant",
          credits: 2,
        }),
      ]),
      credit_usage: expect.objectContaining({
        range: "daily",
        total_credits: 1,
        total_billable_document_pages: 1,
      }),
    });
  });

  it("records No-billing usage without spending Credits when No-billing mode is active", async () => {
    const productStore = createQueueingProductStoreStub();
    const billingLedger = createWorkspaceBillingLedgerBinding("workspace_test");
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
        billingControl: {
          no_billing_enabled: 1,
          no_billing_reason: "Internal evaluation workspace",
          no_billing_updated_by_user_id: "user_admin",
          no_billing_updated_at: "2026-05-31T12:00:00.000Z",
        },
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: billingLedger,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(202);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "no_billing",
      },
      credits: {
        total_available: 0,
      },
      current_period: {
        monthly_page_limit: null,
        pages_used: 1,
        pages_remaining: null,
      },
      owner_billing_activity: [],
    });
  });

  it("records Enterprise usage charges without spending Credits when Enterprise ramp-up is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createQueueingProductStoreStub();
    const billingLedger = createWorkspaceBillingLedgerBinding("workspace_test");
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
        billingControl: {
          enterprise_ramp_up_status: "active",
          enterprise_ramp_up_duration_months: 3,
          enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
          enterprise_ramp_up_collection_mode: "manual",
          enterprise_ramp_up_invoice_review_enabled: 0,
          enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
          enterprise_ramp_up_created_by_user_id: "user_admin",
          enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        },
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: billingLedger,
    });

    try {
      const response = await worker.fetch(createExtractRequest("document"), env);

      expect(response.status).toBe(202);

      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );

      expect(summaryResponse.status).toBe(200);
      await expect(summaryResponse.json()).resolves.toMatchObject({
        active_entitlement: {
          plan: "enterprise_ramp_up",
        },
        credits: {
          total_available: 0,
        },
        current_period: {
          monthly_page_limit: null,
          pages_used: 1,
          pages_remaining: null,
        },
        owner_billing_activity: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records Enterprise usage without spending Credits when Enterprise annual entitlement is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    const productStore = createQueueingProductStoreStub();
    const billingLedger = createWorkspaceBillingLedgerBinding("workspace_test");
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
        billingControl: {
          enterprise_annual_status: "active",
          enterprise_annual_monthly_minimum_allowance: 60000,
          enterprise_annual_per_page_price_minor: 9,
          enterprise_annual_yearly_amount_minor: 6480000,
          enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
          enterprise_annual_collection_mode: "manual",
          enterprise_annual_invoice_review_enabled: 0,
          enterprise_annual_reason: "Annual Enterprise commitment",
          enterprise_annual_created_by_user_id: "user_admin",
          enterprise_annual_created_at: "2026-06-01T12:00:00.000Z",
          enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_paid",
          enterprise_annual_upfront_invoice_status: "paid",
          enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_paid",
          enterprise_annual_upfront_invoice_paid_at: "2026-06-03T12:00:00.000Z",
        },
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: billingLedger,
    });

    try {
      const response = await worker.fetch(createExtractRequest("document"), env);

      expect(response.status).toBe(202);

      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );

      expect(summaryResponse.status).toBe(200);
      await expect(summaryResponse.json()).resolves.toMatchObject({
        active_entitlement: {
          plan: "enterprise_annual",
        },
        credits: {
          total_available: 0,
        },
        current_period: {
          monthly_page_limit: null,
          pages_used: 1,
          pages_remaining: null,
        },
        owner_billing_activity: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects Document submissions with insufficient Credits before durable side effects", async () => {
    const productStore = createQueueingProductStoreStub();
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test"),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "insufficient_credits",
        message: "Workspace has insufficient Credits for this Document",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("maps remote billing reservation Credit failures before durable side effects", async () => {
    const productStore = createQueueingProductStoreStub();
    const analytics = createAnalyticsBinding();
    const reserveCreditsForDocumentSubmission = vi.fn(async () => {
      throw new Error("Workspace has insufficient Credits for this Document");
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: {
        getByName: vi.fn((name: string) => {
          if (name !== "workspace_test") {
            throw new Error(`Unexpected billing ledger name: ${name}`);
          }
          return { reserveCreditsForDocumentSubmission };
        }),
      } as unknown as Env["WORKSPACE_BILLING_LEDGER"],
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "insufficient_credits",
        message: "Workspace has insufficient Credits for this Document",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects Document submissions that exceed remaining monthly Plan page capacity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createQueueingProductStoreStub();
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 501,
        reservedPages: 500,
      }),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    try {
      const response = await worker.fetch(createExtractRequest("document"), env);

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "plan_page_limit_exceeded",
          message: "Workspace has exceeded remaining Plan page capacity",
        },
      });
      expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
      expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
      expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
      expect(analytics.writeDataPoint).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects Document submissions when the Workspace has too many Templates", async () => {
    const productStore = createQueueingProductStoreStub();
    productStore.summarizePlanLimitUsage.mockResolvedValue({
      active_template_count: 4,
      templates: [
        {
          template_id: "template_test",
          top_level_template_fields: 1,
          table_shaped_fields: 0,
          max_table_columns_per_field: 0,
        },
      ],
    });
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 10,
      }),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_limit_exceeded",
        message: "Workspace has exceeded the Free plan limit of 3 Templates",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects Document submissions when the Workspace has too many accepted memberships", async () => {
    const productStore = createQueueingProductStoreStub();
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        acceptedMembershipCount: 4,
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 10,
      }),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "member_limit_exceeded",
        message: "Workspace has exceeded the Free plan limit of 3 members",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects Document submissions for a Template with too many top-level fields", async () => {
    const productStore = createQueueingProductStoreStub();
    productStore.summarizePlanLimitUsage.mockResolvedValue({
      active_template_count: 3,
      templates: [
        {
          template_id: "template_test",
          top_level_template_fields: 6,
          table_shaped_fields: 0,
          max_table_columns_per_field: 0,
        },
      ],
    });
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 10,
      }),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_field_limit_exceeded",
        message: "Template has exceeded the Free plan limit of 5 top-level fields",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects Document submissions for a Template with too many table-shaped fields", async () => {
    const productStore = createQueueingProductStoreStub();
    productStore.summarizePlanLimitUsage.mockResolvedValue({
      active_template_count: 3,
      templates: [
        {
          template_id: "template_test",
          top_level_template_fields: 5,
          table_shaped_fields: 2,
          max_table_columns_per_field: 4,
        },
      ],
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 10,
      }),
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_table_limit_exceeded",
        message: "Template has exceeded the Free plan limit of 1 table-shaped field",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
  });

  it("rejects Document submissions for a Template with too many table columns", async () => {
    const productStore = createQueueingProductStoreStub();
    productStore.summarizePlanLimitUsage.mockResolvedValue({
      active_template_count: 3,
      templates: [
        {
          template_id: "template_test",
          top_level_template_fields: 5,
          table_shaped_fields: 1,
          max_table_columns_per_field: 6,
        },
      ],
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 10,
      }),
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_table_column_limit_exceeded",
        message: "Template has exceeded the Free plan limit of 5 table columns",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
  });

  it("refunds Credits and page capacity when queued Extraction job creation fails after billing reservation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockResolvedValue({
      error: {
        status: 500,
        code: "queued_job_create_failed",
        message: "Could not create queued Extraction job",
      },
    });
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 1,
      }),
    });

    try {
      const response = await worker.fetch(createExtractRequest("document"), env);

      expect(response.status).toBe(500);
      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );
      expect(summaryResponse.status).toBe(200);
      await expect(summaryResponse.json()).resolves.toMatchObject({
        credits: {
          goodwill_available: 1,
          total_available: 1,
        },
        current_period: {
          pages_used: 0,
          pages_remaining: 500,
        },
        credit_usage: expect.objectContaining({
          range: "daily",
          total_credits: 1,
          total_billable_document_pages: 1,
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts PNG Document submissions without Source file page count", async () => {
    const productStore = createQueueingProductStoreStub();
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(
      createExtractRequest("document", "not pdf bytes", {
        name: "scan.png",
        type: "image/png",
      }),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      source_name: "scan.png",
      template_id: "template_test",
      template_version: 1,
    });
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMimeType: "image/png",
        sourceName: "scan.png",
        sourceFilePageCount: null,
      }),
    );
    expect(env.SOURCE_FILES_BUCKET.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/source\.png$/),
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "image/png",
        },
      },
    );
    const queueMessage = (env.EXTRACTION_JOBS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(queueMessage).not.toHaveProperty("source_file_page_count");
    expect(queueMessage).not.toHaveProperty("sourceFilePageCount");
    expect(queueMessage).not.toHaveProperty("page_count");
    const analyticsPoint = analytics.writeDataPoint.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(analyticsPoint).toMatchObject({
      indexes: ["workspace_test"],
      blobs: ["document_submitted", "workspace_test", "template_test", expect.any(String), "queued", "", "image/png", ""],
      doubles: [1, "not pdf bytes".length, 0, 0, 1],
    });
    expect(JSON.stringify(analyticsPoint)).not.toContain("source_file_page_count");
    expect(JSON.stringify(analyticsPoint)).not.toContain("sourceFilePageCount");
    expect(JSON.stringify(analyticsPoint)).not.toContain("page_count");
  });

  it("counts image Documents as one Billable Document page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createQueueingProductStoreStub();
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 2,
      }),
    });

    try {
      const response = await worker.fetch(
        createExtractRequest("document", "not pdf bytes", {
          name: "scan.png",
          type: "image/png",
        }),
        env,
      );

      expect(response.status).toBe(202);
      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );
      await expect(summaryResponse.json()).resolves.toMatchObject({
        credits: {
          goodwill_available: 1,
          total_available: 1,
        },
        current_period: {
          pages_used: 1,
          pages_remaining: 499,
        },
        credit_usage: expect.objectContaining({
          range: "daily",
          total_credits: 1,
          total_billable_document_pages: 1,
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats duplicate user submissions with different generated job IDs as separate billable submissions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createQueueingProductStoreStub();
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 2,
      }),
    });

    try {
      const firstResponse = await worker.fetch(createExtractRequest("document"), env);
      const secondResponse = await worker.fetch(createExtractRequest("document"), env);

      expect(firstResponse.status).toBe(202);
      expect(secondResponse.status).toBe(202);
      const firstBody = await firstResponse.json() as { job_id: string };
      const secondBody = await secondResponse.json() as { job_id: string };
      expect(firstBody.job_id).not.toBe(secondBody.job_id);

      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );
      await expect(summaryResponse.json()).resolves.toMatchObject({
        credits: {
          goodwill_available: 0,
          total_available: 0,
        },
        current_period: {
          pages_used: 2,
          pages_remaining: 498,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses upgraded Max page capacity when accepting Document submissions after a paid upgrade", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createQueueingProductStoreStub();
    const periodStart = "2026-05-06T12:00:00.000Z";
    const periodEnd = "2026-06-06T12:00:00.000Z";
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
        billingControl: {
          self_service_subscription_plan: "max",
          self_service_subscription_status: "active",
          stripe_subscription_current_period_start: periodStart,
          stripe_subscription_current_period_end: periodEnd,
        },
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 1600,
        reservedPages: 1500,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        monthlyPageLimit: 5000,
      }),
    });

    try {
      const response = await worker.fetch(createExtractRequest("document"), env);

      expect(response.status).toBe(202);
      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );
      await expect(summaryResponse.json()).resolves.toMatchObject({
        active_entitlement: {
          plan: "max",
        },
        current_period: {
          monthly_page_limit: 5000,
          pages_used: 1501,
          pages_remaining: 3499,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts JPEG Document submissions without Source file page count", async () => {
    const productStore = createQueueingProductStoreStub();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(
      createExtractRequest("document", "not pdf bytes", {
        name: "scan.jpg",
        type: "image/jpeg",
      }),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      source_name: "scan.jpg",
      template_id: "template_test",
      template_version: 1,
    });
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMimeType: "image/jpeg",
        sourceName: "scan.jpg",
        sourceFilePageCount: null,
      }),
    );
    expect(env.SOURCE_FILES_BUCKET.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/source\.jpg$/),
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "image/jpeg",
        },
      },
    );
  });

  it("accepts WebP Document submissions without Source file page count", async () => {
    const productStore = createQueueingProductStoreStub();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(
      createExtractRequest("document", "not pdf bytes", {
        name: "scan.webp",
        type: "image/webp",
      }),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      source_name: "scan.webp",
      template_id: "template_test",
      template_version: 1,
    });
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMimeType: "image/webp",
        sourceName: "scan.webp",
        sourceFilePageCount: null,
      }),
    );
    expect(env.SOURCE_FILES_BUCKET.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/source\.webp$/),
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "image/webp",
        },
      },
    );
  });

  it("rejects Documents that exceed the workspace Source file byte limit", async () => {
    authenticateMock.mockResolvedValueOnce({
      workspace: {
        id: "workspace_test",
        api_key_hash: "hash_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        created_by_user_id: "user_test",
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: 5,
      },
    });

    const response = await worker.fetch(createExtractRequest("document", "oversized"), createExtractEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "source_file_too_large",
        message: "Source file exceeds max size of 5 bytes",
      },
    });
  });

  it("returns Template validation errors from Workspace product data before uploading the Source file", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      error: {
        status: 400,
        code: "template_invalid",
        message: "Template has no fields",
      },
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_invalid",
        message: "Template has no fields",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
  });

  it("rejects uncountable PDF Source files before durable side effects", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(createExtractRequest("document", "not a pdf"), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_pdf_source_file",
        message: "PDF Source file could not be read",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("deletes the uploaded Source file when queued Extraction job creation fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockResolvedValue({
      error: {
        status: 500,
        code: "queued_job_create_failed",
        message: "Could not create queued Extraction job",
      },
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "queued_job_create_failed",
        message: "Could not create queued Extraction job",
      },
    });
    const objectKey = String((env.SOURCE_FILES_BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(objectKey).toMatch(/^workspaces\/workspace_test\/jobs\/job_/);
    expect(env.SOURCE_FILES_BUCKET.delete).toHaveBeenCalledWith(objectKey);
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
  });

  it("deletes uploaded non-PDF Source files when queued Extraction job creation fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockResolvedValue({
      error: {
        status: 500,
        code: "queued_job_create_failed",
        message: "Could not create queued Extraction job",
      },
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(
      createExtractRequest("document", "not pdf bytes", {
        name: "scan.png",
        type: "image/png",
      }),
      env,
    );

    expect(response.status).toBe(500);
    const objectKey = String((env.SOURCE_FILES_BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMimeType: "image/png",
        sourceFilePageCount: null,
      }),
    );
    expect(objectKey).toMatch(/^workspaces\/workspace_test\/jobs\/job_.*\/source\.png$/);
    expect(env.SOURCE_FILES_BUCKET.delete).toHaveBeenCalledWith(objectKey);
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
  });

  it("keeps accepted Document submissions successful when analytics emission fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    }));
    const analyticsError = new Error("analytics unavailable");
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_PRODUCT_ANALYTICS: {
        writeDataPoint: vi.fn(() => {
          throw analyticsError;
        }),
      } as unknown as Env["WORKSPACE_PRODUCT_ANALYTICS"],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      template_id: "template_test",
      template_version: 1,
    });
    expect(env.EXTRACTION_JOBS_QUEUE.send).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Workspace product analytics emission failed", analyticsError);
    consoleError.mockRestore();
  });

  it("marks the Extraction job failed and deletes the uploaded Source file when queue send fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    }));
    productStore.failQueuedExtractionJob.mockResolvedValue(true);
    const env = createExtractEnv({
      DB: createLegacyProductDb({
        workspace: createWorkspace(),
        membershipRole: "owner",
      }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
        goodwillCredits: 1,
      }),
      EXTRACTION_JOBS_QUEUE: {
        send: vi.fn(async () => {
          throw new Error("queue unavailable");
        }),
      } as unknown as Queue,
    });

    try {
      const response = await worker.fetch(createExtractRequest("document"), env);

      expect(response.status).toBe(500);
      const objectKey = String((env.SOURCE_FILES_BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
      const jobId = String((productStore.createQueuedExtractionJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.jobId);
      expect(productStore.failQueuedExtractionJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId,
          errorCode: "queue_send_failed",
          errorMessage: "queue unavailable",
        }),
      );
      expect(env.SOURCE_FILES_BUCKET.delete).toHaveBeenCalledWith(objectKey);

      const summaryResponse = await worker.fetch(
        new Request("https://example.com/v1/workspaces/workspace_test/billing/summary"),
        env,
      );
      await expect(summaryResponse.json()).resolves.toMatchObject({
        credits: {
          goodwill_available: 1,
          total_available: 1,
        },
        current_period: {
          pages_used: 0,
          pages_remaining: 500,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks non-PDF Extraction jobs failed and deletes the Source file when queue send fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    }));
    productStore.failQueuedExtractionJob.mockResolvedValue(true);
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      EXTRACTION_JOBS_QUEUE: {
        send: vi.fn(async () => {
          throw new Error("queue unavailable");
        }),
      } as unknown as Queue,
    });

    const response = await worker.fetch(
      createExtractRequest("document", "not pdf bytes", {
        name: "scan.webp",
        type: "image/webp",
      }),
      env,
    );

    expect(response.status).toBe(500);
    const objectKey = String((env.SOURCE_FILES_BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    const jobId = String((productStore.createQueuedExtractionJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.jobId);
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMimeType: "image/webp",
        sourceFilePageCount: null,
      }),
    );
    expect(productStore.failQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        errorCode: "queue_send_failed",
        errorMessage: "queue unavailable",
      }),
    );
    expect(env.SOURCE_FILES_BUCKET.delete).toHaveBeenCalledWith(objectKey);
  });

  it("rejects Documents that exceed the default Source file byte limit", async () => {
    const env = createExtractEnv({ MAX_SOURCE_FILE_BYTES: "5" });
    const response = await worker.fetch(createExtractRequest("document", "oversized"), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "source_file_too_large",
        message: "Source file exceeds max size of 5 bytes",
      },
    });
  });
});

function createExtractRequest(
  sourceFieldName: string,
  sourceContent: BlobPart = ONE_PAGE_PDF_SOURCE_BYTES,
  source: { name?: string; type?: string } = {},
): Request {
  const formData = new FormData();
  formData.append("template_id", "template_test");
  formData.append(sourceFieldName, new File([sourceContent], source.name ?? "invoice.pdf", { type: source.type ?? "application/pdf" }));

  return new Request("https://example.com/v1/extract", {
    method: "POST",
    headers: { authorization: "Bearer workspace-api-key" },
    body: formData,
  });
}

function createWorkspace() {
  return {
    id: "workspace_test",
    api_key_hash: "hash_test",
    name: "Research",
    created_at: "2026-05-06T12:00:00.000Z",
    created_by_user_id: "user_owner",
    rate_limit_per_minute: null,
    max_templates: null,
    max_fields_per_template: null,
    max_source_file_bytes: null,
  };
}

type ExtractTestEnv = Omit<Env, "MAX_SOURCE_FILE_BYTES"> & {
  MAX_SOURCE_FILE_BYTES?: string;
};

function createExtractEnv(overrides: Partial<ExtractTestEnv> = {}): Env {
  const db = createLegacyProductDb();

  return {
    DB: db,
    SOURCE_FILES_BUCKET: {
      put: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    } as unknown as R2Bucket,
    EXTRACTION_JOBS_QUEUE: {
      send: vi.fn(async () => null),
    } as unknown as Queue,
    WORKSPACE_BILLING_LEDGER: createWorkspaceBillingLedgerBinding("workspace_test", {
      goodwillCredits: 1000,
    }),
    ...overrides,
  } as Env;
}

function createLegacyProductDb(input: {
  legacyProductRead?: () => unknown | Promise<unknown>;
  workspace?: ReturnType<typeof createWorkspace>;
  membershipRole?: "owner" | "admin" | "member" | null;
  acceptedMembershipCount?: number;
  billingControl?: {
    self_service_subscription_plan?: "pro" | "max";
    self_service_subscription_status?: string;
    stripe_subscription_current_period_start?: string;
    stripe_subscription_current_period_end?: string;
    enterprise_ramp_up_status?: string;
    enterprise_ramp_up_duration_months?: number;
    enterprise_billing_cycle_start_date?: string;
    enterprise_ramp_up_collection_mode?: "automatic" | "manual";
    enterprise_ramp_up_invoice_review_enabled?: number;
    enterprise_ramp_up_reason?: string;
    enterprise_ramp_up_created_by_user_id?: string;
    enterprise_ramp_up_created_at?: string;
    enterprise_annual_status?: string;
    enterprise_annual_monthly_minimum_allowance?: number;
    enterprise_annual_per_page_price_minor?: number;
    enterprise_annual_yearly_amount_minor?: number;
    enterprise_annual_collection_mode?: "automatic" | "manual";
    enterprise_annual_invoice_review_enabled?: number;
    enterprise_annual_reason?: string;
    enterprise_annual_created_by_user_id?: string;
    enterprise_annual_created_at?: string;
    enterprise_annual_upfront_invoice_id?: string;
    enterprise_annual_upfront_invoice_status?: string;
    enterprise_annual_upfront_invoice_hosted_url?: string;
    enterprise_annual_upfront_invoice_paid_at?: string;
    no_billing_enabled?: number;
    no_billing_reason?: string;
    no_billing_updated_by_user_id?: string;
    no_billing_updated_at?: string;
  } | null;
} = {}): D1Database {
  const auditEntries: Array<Record<string, string>> = [];

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes("COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ?")) {
            return { count: input.acceptedMembershipCount ?? 1 };
          }
          if (sql.includes("FROM templates")) {
            await input.legacyProductRead?.();
            return {
              id: "template_test",
              current_version: 1,
              status: "active",
              deleted_at: null,
            };
          }
          if (sql.includes("FROM template_fields")) {
            await input.legacyProductRead?.();
            return { exists_flag: 1 };
          }
          if (
            sql.includes("FROM workspaces") &&
            sql.includes("JOIN workspace_memberships")
          ) {
            if (input.workspace && input.membershipRole) {
              return {
                ...input.workspace,
                role: input.membershipRole,
              };
            }
            return null;
          }
          if (sql.includes("FROM workspace_billing_controls")) {
            return input.billingControl ?? null;
          }
          return null;
        }),
        run: vi.fn(async (...params: unknown[]) => {
          if (sql.includes("INSERT INTO workspace_billing_controls")) {
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO workspace_billing_admin_audit_log")) {
            auditEntries.push({
              id: String(params[0]),
              workspace_id: String(params[1]),
              action: String(params[2]),
              actor_user_id: String(params[3]),
              reason: String(params[4]),
              before_json: String(params[5]),
              after_json: String(params[6]),
              occurred_at: String(params[7]),
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }),
        all: vi.fn(async (...params: unknown[]) => {
          if (sql.includes("FROM workspace_billing_admin_audit_log")) {
            const workspaceId = String(params[0] || "");
            return {
              results: auditEntries.filter((entry) => entry.workspace_id === workspaceId),
            };
          }
          return { results: [] };
        }),
      })),
    })),
  } as unknown as D1Database;
}

function createProductStoreStub(): ProductStoreStub {
  return {
    validateTemplateForDocumentSubmission: vi.fn(),
    summarizePlanLimitUsage: vi.fn(async () => ({
      active_template_count: 0,
      templates: [],
    })),
    createQueuedExtractionJob: vi.fn(),
    failQueuedExtractionJob: vi.fn(),
  };
}

function createQueueingProductStoreStub(): ProductStoreStub {
  const productStore = createProductStoreStub();
  productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
    template_id: "template_test",
    template_version: 1,
  });
  productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
    job_id: input.jobId,
    status: "queued",
    source_name: input.sourceName,
    template_id: input.templateId,
    template_version: input.templateVersion,
  }));
  return productStore;
}

function createProductStoreBinding(productStore: ProductStoreStub): Env["WORKSPACE_PRODUCT_STORE"] {
  return {
    getByName: vi.fn(() => productStore),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}

function createAnalyticsBinding(): AnalyticsBindingStub {
  return {
    writeDataPoint: vi.fn(),
  } as unknown as AnalyticsBindingStub;
}

function createWorkspaceBillingLedgerBinding(
  workspaceId: string,
  options: {
    goodwillCredits?: number;
    reservedPages?: number;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
    monthlyPageLimit?: number;
  } = {},
): Env["WORKSPACE_BILLING_LEDGER"] {
  const ledger = createWorkspaceBillingLedger();
  if (options.goodwillCredits) {
    void ledger.grantGoodwillCredits({
      workspaceId,
      credits: options.goodwillCredits,
      reason: "Test setup",
      actorUserId: "user_admin",
      idempotencyKey: "test-setup-grant",
      occurredAt: "2026-05-31T00:00:00.000Z",
    });
  }
  if (options.reservedPages) {
    void ledger.reserveCreditsForDocumentSubmission({
      workspaceId,
      extractionJobId: "job_test_setup_reservation",
      templateId: "template_test",
      templateVersion: 1,
      billableDocumentPages: options.reservedPages,
      billingPeriodStart: options.billingPeriodStart ?? "2026-05-06T12:00:00.000Z",
      billingPeriodEnd: options.billingPeriodEnd ?? "2026-06-06T12:00:00.000Z",
      monthlyPageLimit: options.monthlyPageLimit ?? 500,
      submittedAt: "2026-05-31T00:00:00.000Z",
      authMode: "api_key",
      actorUserId: null,
      idempotencyKey: "test-setup-reservation",
    });
  }
  return {
    getByName: vi.fn((name: string) => {
      if (name !== workspaceId) {
        throw new Error(`Unexpected billing ledger name: ${name}`);
      }
      return ledger;
    }),
  } as unknown as Env["WORKSPACE_BILLING_LEDGER"];
}

function createWorkspaceBillingLedger(): WorkspaceBillingLedger {
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
      return new DurableObjectSqlCursor(statement.all(...normalizedParams) as T[]);
    }

    statement.run(...normalizedParams);
    return new DurableObjectSqlCursor([]);
  }
}

class DurableObjectSqlCursor<T> {
  constructor(private readonly rows: T[]) {}

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
