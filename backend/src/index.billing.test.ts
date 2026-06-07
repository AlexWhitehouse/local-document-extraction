import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/auth", () => ({
  authenticate: vi.fn(),
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
import type { Workspace } from "./lib/types";

describe("Workspace billing summary route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));
    requireSessionMock.mockResolvedValue({
      id: "user_owner",
      email: "owner@example.com",
      name: "Workspace Owner",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows the Free entitlement to the Workspace owner", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspace_id: "workspace_billing",
      billing_state: "active",
      active_entitlement: {
        plan: "free",
        display_name: "Free",
        included_credits: 0,
        api_access: false,
        per_page_catalog_price: {
          currency: "GBP",
          amount_minor: 22,
          display: "GBP 0.22",
          tax_behavior: "exclusive",
        },
      },
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      current_period: {
        anchor: "2026-05-04T00:00:00.000Z",
        start: "2026-05-04T00:00:00.000Z",
        end: "2026-06-04T00:00:00.000Z",
        monthly_page_limit: 500,
        pages_used: 0,
        pages_remaining: 500,
      },
      plan_limits: {
        templates: 3,
        top_level_template_fields: 5,
        table_shaped_fields: 1,
        table_columns_per_field: 5,
        members: 3,
        monthly_pages: 500,
        api_access: false,
      },
      billing_operational_status: {
        status: "active",
        blocking_reasons: [],
      },
      owner_billing_activity: [],
      next_scheduled_entitlement: null,
      self_service_subscription: null,
      payment_controls: [],
    });
  });

  it("returns the five most recent owner billing activity entries and loads older entries with a cursor", async () => {
    const ownerBillingActivity = [1, 2, 3, 4, 5, 6].map((index) => ({
      id: `activity_${index}`,
      type: "goodwill_credit_grant",
      occurred_at: `2026-05-31T12:0${index}:00.000Z`,
      credits: index,
      description: `Billing activity ${index}`,
    }));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding({ ownerBillingActivity }),
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    const summaryBody = await summaryResponse.json() as {
      owner_billing_activity: Array<{ id: string }>;
      owner_billing_activity_next_cursor: string | null;
    };
    expect(summaryBody.owner_billing_activity.map((activity) => activity.id)).toEqual([
      "activity_6",
      "activity_5",
      "activity_4",
      "activity_3",
      "activity_2",
    ]);
    expect(summaryBody.owner_billing_activity_next_cursor).toBe(
      btoa(JSON.stringify({ occurred_at: "2026-05-31T12:02:00.000Z", id: "activity_2" })),
    );

    const activityResponse = await worker.fetch(
      new Request(
        `https://example.com/v1/workspaces/workspace_billing/billing/activity?cursor=${encodeURIComponent(summaryBody.owner_billing_activity_next_cursor || "")}`,
      ),
      env,
    );
    expect(activityResponse.status).toBe(200);
    await expect(activityResponse.json()).resolves.toEqual({
      owner_billing_activity: [
        {
          id: "activity_1",
          type: "goodwill_credit_grant",
          occurred_at: "2026-05-31T12:01:00.000Z",
          credits: 1,
          description: "Billing activity 1",
        },
      ],
      owner_billing_activity_next_cursor: null,
    });
  });

  it("returns owner Credit usage for the selected range", async () => {
    const creditUsage = {
      range: "monthly" as const,
      total_credits: 42,
      total_billable_document_pages: 42,
      buckets: [
        {
          label: "May 2026",
          start_at: "2026-05-01T00:00:00.000Z",
          end_at: "2026-06-01T00:00:00.000Z",
          credits: 42,
          billable_document_pages: 42,
        },
      ],
    };
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding({ creditUsage }),
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/usage?range=monthly"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      credit_usage: creditUsage,
    });
  });

  it("lets Application admins grant Goodwill Credits that Workspace owners see on the Billing page", async () => {
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
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
    });

    const grantResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/goodwill-credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credits: 25,
          reason: "Support adjustment for onboarding",
          idempotency_key: "grant-request-1",
        }),
      }),
      env,
    );

    expect(grantResponse.status).toBe(201);
    await expect(grantResponse.json()).resolves.toEqual({
      grant_id: "grant_grant-request-1",
      workspace_id: "workspace_billing",
      granted_credits: 25,
      available_credits: 25,
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_usage",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 25,
        total_available: 25,
      },
      owner_billing_activity: [
        {
          id: "entry_grant-request-1",
          type: "goodwill_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 25,
          description: "Goodwill Credits granted",
        },
      ],
    });
  });

  it("lets Application admins find billing Workspaces by owner email or Workspace ID", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
    });

    const ownerEmailResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces?owner_email=owner@example.com"),
      env,
    );
    expect(ownerEmailResponse.status).toBe(200);
    await expect(ownerEmailResponse.json()).resolves.toEqual({
      workspaces: [
        {
          id: "workspace_billing",
          name: "Billing Workspace",
          created_at: "2026-05-04T00:00:00.000Z",
          owner_email: "owner@example.com",
          owner_name: "Workspace Owner",
        },
      ],
    });

    const workspaceIdResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces?workspace_id=workspace_billing"),
      env,
    );
    expect(workspaceIdResponse.status).toBe(200);
    const workspaceIdBody = await workspaceIdResponse.json();
    expect(workspaceIdBody).toEqual({
      workspaces: [
        {
          id: "workspace_billing",
          name: "Billing Workspace",
          created_at: "2026-05-04T00:00:00.000Z",
          owner_email: "owner@example.com",
          owner_name: "Workspace Owner",
        },
      ],
    });
    expect(JSON.stringify(workspaceIdBody)).not.toContain("hash_billing");
    expect(JSON.stringify(workspaceIdBody)).not.toContain("user_owner");
  });

  it("lets Application admins create a no-payment Pro Plan override that owners see with Included Credits", async () => {
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
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
    });

    const overrideResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Commercial onboarding grant",
          idempotency_key: "plan-override-request-1",
        }),
      }),
      env,
    );

    expect(overrideResponse.status).toBe(201);
    await expect(overrideResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      plan_override: {
        plan: "pro",
        display_name: "Pro",
        start_at: "2026-05-31T00:00:00.000Z",
        end_at: "2026-06-30T00:00:00.000Z",
        reason: "Commercial onboarding grant",
        created_by_user_id: "user_admin",
      },
      included_credit_grant: {
        granted_credits: 200,
        available_credits: 200,
      },
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        monthly_page_limit: 1500,
      },
      plan_limits: {
        templates: 10,
        top_level_template_fields: 15,
        table_columns_per_field: 10,
        members: 50,
        api_access: true,
      },
      owner_billing_activity: [
        {
          type: "included_credit_grant",
          credits: 200,
          description: "Included Credits granted",
        },
      ],
    });
  });

  it("grants Included Credits when a no-payment Plan override becomes active after creation", async () => {
    vi.setSystemTime(new Date("2026-06-01T23:54:47.888Z"));
    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const billingLedger = createBillingLedgerBinding({ failDuplicateIncludedGrant: true });
    const env = createBillingEnv({
      workspace: createWorkspace({
        created_at: "2026-06-01T23:54:20.265Z",
      }),
      membershipRole: "owner",
      billingLedger,
    });

    const overrideResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          start_at: "2026-06-02T00:00:00.000Z",
          end_at: "2026-07-02T00:00:00.000Z",
          reason: "Commercial onboarding grant",
          idempotency_key: "plan-override-request-future-start",
        }),
      }),
      env,
    );

    expect(overrideResponse.status).toBe(201);
    await expect(overrideResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      plan_override: {
        plan: "pro",
        start_at: "2026-06-02T00:00:00.000Z",
        end_at: "2026-07-02T00:00:00.000Z",
      },
      included_credit_grant: null,
    });

    vi.setSystemTime(new Date("2026-06-02T00:00:13.000Z"));
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      owner_billing_activity: [
        expect.objectContaining({
          type: "included_credit_grant",
          credits: 200,
        }),
      ],
    });

    const secondSummaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(secondSummaryResponse.status).toBe(200);
    await expect(secondSummaryResponse.json()).resolves.toMatchObject({
      credits: {
        included_available: 200,
        total_available: 200,
      },
    });
  });

  it("tops up Included Credits when a no-payment Plan override upgrades during the current period", async () => {
    requireSessionMock
      .mockResolvedValueOnce({
        id: "user_admin",
        email: "admin@example.com",
        name: "Application Admin",
        role: "admin",
      })
      .mockResolvedValueOnce({
        id: "user_admin",
        email: "admin@example.com",
        name: "Application Admin",
        role: "admin",
      });
    const billingLedger = createBillingLedgerBinding({
      failDuplicateIncludedGrant: true,
      reservedCredits: 4,
    });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
    });

    const proResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Commercial onboarding grant",
          idempotency_key: "plan-override-pro-request",
        }),
      }),
      env,
    );
    const maxResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "max",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Max onboarding grant",
          idempotency_key: "plan-override-max-request",
        }),
      }),
      env,
    );

    expect(proResponse.status).toBe(201);
    expect(maxResponse.status).toBe(201);
    await expect(maxResponse.json()).resolves.toMatchObject({
      plan_override: {
        plan: "max",
        display_name: "Max",
      },
      included_credit_grant: {
        granted_credits: 804,
        available_credits: 1000,
      },
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "max",
        display_name: "Max",
        included_credits: 1000,
      },
      credits: {
        included_available: 1000,
        total_available: 1000,
      },
      owner_billing_activity: expect.arrayContaining([
        expect.objectContaining({
          type: "included_credit_grant",
          credits: 200,
        }),
        expect.objectContaining({
          type: "included_credit_grant",
          credits: 804,
        }),
      ]),
    });
  });

  it("revokes unspent override Included Credits when a no-payment Plan override downgrades to Free", async () => {
    requireSessionMock
      .mockResolvedValueOnce({
        id: "user_admin",
        email: "admin@example.com",
        name: "Application Admin",
        role: "admin",
      })
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
      })
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
    const billingLedger = createBillingLedgerBinding({
      failDuplicateIncludedGrant: true,
      reservedCredits: 4,
    });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
    });

    const proResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Commercial onboarding grant",
          idempotency_key: "plan-override-pro-request",
        }),
      }),
      env,
    );
    vi.setSystemTime(new Date("2026-05-31T12:01:00.000Z"));
    const freeResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "free",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Return workspace to Free",
          idempotency_key: "plan-override-free-request",
        }),
      }),
      env,
    );

    expect(proResponse.status).toBe(201);
    expect(freeResponse.status).toBe(201);
    await expect(freeResponse.json()).resolves.toMatchObject({
      plan_override: {
        plan: "free",
        display_name: "Free",
      },
      included_credit_grant: null,
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
        included_credits: 0,
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      next_scheduled_entitlement: null,
    });

    vi.setSystemTime(new Date("2026-05-31T12:02:00.000Z"));
    const secondProResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Restore Pro onboarding grant",
          idempotency_key: "plan-override-pro-request-2",
        }),
      }),
      env,
    );

    expect(secondProResponse.status).toBe(201);
    await expect(secondProResponse.json()).resolves.toMatchObject({
      plan_override: {
        plan: "pro",
        display_name: "Pro",
      },
      included_credit_grant: {
        granted_credits: 200,
        available_credits: 200,
      },
    });

    const secondProSummaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(secondProSummaryResponse.status).toBe(200);
    await expect(secondProSummaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
    });
  });

  it("lets Application admins create a manual payment-required Plan override invoice without activating the entitlement", async () => {
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
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "cus_payment_required_workspace",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_payment_required_override",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_payment_required_override",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_payment_required_override",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_override",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      productStore,
    });

    const overrideResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/payment-required-plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          start_at: "2026-06-01T00:00:00.000Z",
          end_at: "2026-07-01T00:00:00.000Z",
          reason: "Paid onboarding extension",
          amount_minor: 12500,
          collection_mode: "manual",
          idempotency_key: "payment-required-override-request-1",
        }),
      }),
      env,
    );

    expect(overrideResponse.status).toBe(201);
    await expect(overrideResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      payment_required_plan_override: {
        plan: "pro",
        display_name: "Pro",
        start_at: "2026-06-01T00:00:00.000Z",
        end_at: "2026-07-01T00:00:00.000Z",
        reason: "Paid onboarding extension",
        created_by_user_id: "user_admin",
        amount: {
          currency: "GBP",
          amount_minor: 12500,
          display: "GBP 125.00",
          tax_behavior: "exclusive",
        },
        collection_mode: "manual",
        invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_override",
        },
      },
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    expect(stripeFetch).toHaveBeenCalledTimes(4);
    const [customerUrl, customerRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(customerUrl).toBe("https://api.stripe.com/v1/customers");
    expect(customerRequest.headers).toMatchObject({
      "idempotency-key": "stripe-customer:workspace_billing",
      "stripe-version": "2026-05-27.dahlia",
    });
    const customerBody = new URLSearchParams(String(customerRequest.body));
    expect(customerBody.get("email")).toBe("owner@example.com");

    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[1] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    expect(invoiceRequest.method).toBe("POST");
    expect(invoiceRequest.headers).toHaveProperty("idempotency-key", "payment-required-override-request-1:invoice");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("customer")).toBe("cus_payment_required_workspace");
    expect(invoiceBody.get("collection_method")).toBe("send_invoice");
    expect(invoiceBody.get("days_until_due")).toBe("30");
    expect(invoiceBody.get("auto_advance")).toBe("false");
    expect(invoiceBody.get("automatic_tax[enabled]")).toBe("true");
    expect(invoiceBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(invoiceBody.get("metadata[billing_action]")).toBe("payment_required_plan_override");
    expect(invoiceBody.get("metadata[plan]")).toBe("pro");
    expect(invoiceBody.get("metadata[override_start_at]")).toBe("2026-06-01T00:00:00.000Z");
    expect(invoiceBody.get("metadata[override_end_at]")).toBe("2026-07-01T00:00:00.000Z");
    expect(invoiceBody.has("payment_settings[payment_method_types][0]")).toBe(false);

    const [invoiceItemUrl, invoiceItemRequest] = stripeFetch.mock.calls[2] as [string, RequestInit];
    expect(invoiceItemUrl).toBe("https://api.stripe.com/v1/invoiceitems");
    expect(invoiceItemRequest.headers).toHaveProperty("idempotency-key", "payment-required-override-request-1:invoice-item");
    const invoiceItemBody = new URLSearchParams(String(invoiceItemRequest.body));
    expect(invoiceItemBody.get("customer")).toBe("cus_payment_required_workspace");
    expect(invoiceItemBody.get("invoice")).toBe("in_payment_required_override");
    expect(invoiceItemBody.get("amount")).toBe("12500");
    expect(invoiceItemBody.get("currency")).toBe("gbp");
    expect(invoiceItemBody.get("metadata[billing_action]")).toBe("payment_required_plan_override");

    const [finalizeUrl, finalizeRequest] = stripeFetch.mock.calls[3] as [string, RequestInit];
    expect(finalizeUrl).toBe("https://api.stripe.com/v1/invoices/in_payment_required_override/finalize");
    expect(finalizeRequest.headers).toHaveProperty("idempotency-key", "payment-required-override-request-1:finalize");

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        display_name: "Pro",
        invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_override",
        },
      },
    });
  });

  it("uses automatic collection for payment-required Plan override invoices when the Workspace has a default payment method", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "cus_workspace_billing",
          invoice_settings: {
            default_payment_method: "pm_workspace_default",
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_payment_required_auto",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_payment_required_auto",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_payment_required_auto",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_auto",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      billingLedger: createBillingLedgerBinding(),
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/payment-required-plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "max",
          start_at: "2026-06-01T00:00:00.000Z",
          end_at: "2026-07-01T00:00:00.000Z",
          reason: "Paid scale-up exception",
          amount_minor: 40000,
          collection_mode: "automatic",
          idempotency_key: "payment-required-auto-request-1",
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      payment_required_plan_override: {
        plan: "max",
        collection_mode: "automatic",
        invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_auto",
        },
      },
    });

    expect(stripeFetch).toHaveBeenCalledTimes(4);
    const [customerUrl, customerRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(customerUrl).toBe("https://api.stripe.com/v1/customers/cus_workspace_billing");
    expect(customerRequest.method).toBe("GET");

    const [, invoiceRequest] = stripeFetch.mock.calls[1] as [string, RequestInit];
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("collection_method")).toBe("charge_automatically");
    expect(invoiceBody.get("auto_advance")).toBe("true");
    expect(invoiceBody.has("days_until_due")).toBe(false);
    expect(invoiceBody.get("metadata[billing_action]")).toBe("payment_required_plan_override");
    expect(invoiceBody.get("metadata[plan]")).toBe("max");
    expect(invoiceBody.has("payment_settings[payment_method_types][0]")).toBe(false);
  });

  it("rejects a duplicate pending payment-required Plan override before creating another Stripe invoice", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch");
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-06-01T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-07-01T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_existing",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_existing",
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/payment-required-plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "max",
          start_at: "2026-06-01T00:00:00.000Z",
          end_at: "2026-07-01T00:00:00.000Z",
          reason: "Second paid exception",
          amount_minor: 40000,
          collection_mode: "manual",
          idempotency_key: "payment-required-duplicate-request-1",
        }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "payment_required_override_pending",
        message: "Workspace already has a pending payment-required Plan override",
      },
    });
    expect(stripeFetch).not.toHaveBeenCalled();
  });

  it("records Application admin billing audit entries for manual Goodwill Credit grants", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
    });

    await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/goodwill-credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credits: 25,
          reason: "Support adjustment for onboarding",
          idempotency_key: "grant-request-1",
        }),
      }),
      env,
    );

    const auditResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/audit-log"),
      env,
    );

    expect(auditResponse.status).toBe(200);
    const auditBody = await auditResponse.json();
    expect(auditBody).toEqual({
      entries: [
        {
          id: expect.stringMatching(/^audit_/),
          workspace_id: "workspace_billing",
          action: "goodwill_credit_grant",
          actor_user_id: "user_admin",
          actor_name: "Application Admin",
          reason: "Support adjustment for onboarding",
          before: { total_available: 0 },
          after: { total_available: 25 },
          occurred_at: "2026-05-31T12:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(auditBody)).not.toContain("admin@example.com");
  });

  it("records Application admin billing audit entries for no-payment Plan overrides", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
    });

    await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/plan-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "max",
          start_at: "2026-05-31T00:00:00.000Z",
          end_at: "2026-06-30T00:00:00.000Z",
          reason: "Commercial proof of concept",
          idempotency_key: "plan-override-request-1",
        }),
      }),
      env,
    );

    const auditResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/audit-log"),
      env,
    );

    expect(auditResponse.status).toBe(200);
    const auditBody = await auditResponse.json();
    expect(auditBody).toEqual({
      entries: [
        {
          id: expect.stringMatching(/^audit_/),
          workspace_id: "workspace_billing",
          action: "plan_override_created",
          actor_user_id: "user_admin",
          actor_name: "Application Admin",
          reason: "Commercial proof of concept",
          before: {
            plan_override_plan: null,
            plan_override_start_at: null,
            plan_override_end_at: null,
          },
          after: {
            plan_override_plan: "max",
            plan_override_start_at: "2026-05-31T00:00:00.000Z",
            plan_override_end_at: "2026-06-30T00:00:00.000Z",
          },
          occurred_at: "2026-05-31T12:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(auditBody)).not.toContain("admin@example.com");
  });

  it("lets Application admins enable No-billing mode with the Enterprise limit profile", async () => {
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
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      productStore,
    });

    const noBillingResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/no-billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          reason: "Internal evaluation workspace",
          idempotency_key: "no-billing-request-1",
        }),
      }),
      env,
    );

    expect(noBillingResponse.status).toBe(200);
    await expect(noBillingResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      no_billing_mode: {
        enabled: true,
        reason: "Internal evaluation workspace",
        updated_by_user_id: "user_admin",
      },
      active_entitlement: {
        plan: "no_billing",
        display_name: "No-billing",
      },
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      active_entitlement: {
        plan: "no_billing",
        display_name: "No-billing",
        included_credits: 0,
        api_access: true,
      },
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      current_period: {
        monthly_page_limit: null,
        pages_used: 0,
        pages_remaining: null,
      },
      plan_limits: {
        templates: null,
        top_level_template_fields: 25,
        table_shaped_fields: 1,
        table_columns_per_field: 20,
        members: null,
        monthly_pages: null,
        api_access: true,
      },
    });
  });

  it("lets Application admins assign Enterprise ramp-up that owners see as the Active entitlement", async () => {
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
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      productStore,
    });

    const rampUpResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/enterprise-ramp-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
          collection_mode: "manual",
          reason: "Enterprise ramp-up before annual commitment",
          idempotency_key: "enterprise-ramp-up-request-1",
        }),
      }),
      env,
    );

    expect(rampUpResponse.status).toBe(201);
    await expect(rampUpResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      enterprise_ramp_up: {
        status: "active",
        duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        collection_mode: "manual",
        invoice_review_enabled: false,
        reason: "Enterprise ramp-up before annual commitment",
        created_by_user_id: "user_admin",
      },
      active_entitlement: {
        plan: "enterprise_ramp_up",
        display_name: "Enterprise ramp-up",
      },
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      active_entitlement: {
        plan: "enterprise_ramp_up",
        display_name: "Enterprise ramp-up",
        included_credits: 0,
        api_access: true,
      },
      credits: {
        included_available: 0,
        purchased_available: 0,
        goodwill_available: 0,
        total_available: 0,
      },
      current_period: {
        anchor: "2026-05-01T00:00:00.000Z",
        start: "2026-05-01T00:00:00.000Z",
        end: "2026-06-01T00:00:00.000Z",
        monthly_page_limit: null,
        pages_used: 0,
        pages_remaining: null,
      },
      plan_limits: {
        templates: null,
        top_level_template_fields: 25,
        table_shaped_fields: 1,
        table_columns_per_field: 20,
        members: null,
        monthly_pages: null,
        api_access: true,
      },
      enterprise_ramp_up: {
        status: "active",
        duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        collection_mode: "manual",
        invoice_review_enabled: false,
      },
    });
  });

  it("lets Application admins create an Enterprise annual commitment upfront invoice without activating entitlement", async () => {
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
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "cus_enterprise_annual_workspace",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_annual_upfront",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_annual_upfront",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_annual_upfront",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      productStore,
    });

    const annualResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/enterprise-annual-commitments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          monthly_minimum_allowance: 60000,
          per_page_price_minor: 9,
          enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
          collection_mode: "manual",
          reason: "Annual Enterprise commitment",
          idempotency_key: "enterprise-annual-request-1",
        }),
      }),
      env,
    );

    expect(annualResponse.status).toBe(201);
    await expect(annualResponse.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      enterprise_annual_commitment: {
        status: "pending_payment",
        monthly_minimum_allowance: 60000,
        per_page_price: {
          currency: "GBP",
          amount_minor: 9,
          display: "GBP 0.09",
          tax_behavior: "exclusive",
        },
        yearly_amount: {
          currency: "GBP",
          amount_minor: 6480000,
          display: "GBP 64,800.00",
          tax_behavior: "exclusive",
        },
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        collection_mode: "manual",
        invoice_review_enabled: false,
        reason: "Annual Enterprise commitment",
        created_by_user_id: "user_admin",
        upfront_invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront",
        },
      },
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    expect(stripeFetch).toHaveBeenCalledTimes(4);
    const [customerUrl, customerRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(customerUrl).toBe("https://api.stripe.com/v1/customers");
    expect(customerRequest.headers).toMatchObject({
      "idempotency-key": "stripe-customer:workspace_billing",
      "stripe-version": "2026-05-27.dahlia",
    });

    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[1] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    expect(invoiceRequest.headers).toHaveProperty("idempotency-key", "enterprise-annual-request-1:upfront-invoice");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("customer")).toBe("cus_enterprise_annual_workspace");
    expect(invoiceBody.get("collection_method")).toBe("send_invoice");
    expect(invoiceBody.get("days_until_due")).toBe("30");
    expect(invoiceBody.get("auto_advance")).toBe("false");
    expect(invoiceBody.get("automatic_tax[enabled]")).toBe("true");
    expect(invoiceBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(invoiceBody.get("metadata[billing_action]")).toBe("enterprise_annual_upfront_invoice");
    expect(invoiceBody.get("metadata[monthly_minimum_allowance]")).toBe("60000");
    expect(invoiceBody.get("metadata[per_page_price_minor]")).toBe("9");
    expect(invoiceBody.has("payment_settings[payment_method_types][0]")).toBe(false);

    const [invoiceItemUrl, invoiceItemRequest] = stripeFetch.mock.calls[2] as [string, RequestInit];
    expect(invoiceItemUrl).toBe("https://api.stripe.com/v1/invoiceitems");
    expect(invoiceItemRequest.headers).toHaveProperty("idempotency-key", "enterprise-annual-request-1:upfront-invoice-item");
    const invoiceItemBody = new URLSearchParams(String(invoiceItemRequest.body));
    expect(invoiceItemBody.get("customer")).toBe("cus_enterprise_annual_workspace");
    expect(invoiceItemBody.get("invoice")).toBe("in_enterprise_annual_upfront");
    expect(invoiceItemBody.get("amount")).toBe("6480000");
    expect(invoiceItemBody.get("currency")).toBe("gbp");
    expect(invoiceItemBody.get("metadata[billing_action]")).toBe("enterprise_annual_upfront_invoice");

    const [finalizeUrl, finalizeRequest] = stripeFetch.mock.calls[3] as [string, RequestInit];
    expect(finalizeUrl).toBe("https://api.stripe.com/v1/invoices/in_enterprise_annual_upfront/finalize");
    expect(finalizeRequest.headers).toHaveProperty("idempotency-key", "enterprise-annual-request-1:upfront-finalize");

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "pending_payment",
        upfront_invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront",
        },
      },
    });
  });

  it("activates Enterprise annual entitlement only after the upfront invoice is paid", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "pending_payment",
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
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_paid",
      },
    });
    const event = {
      id: "evt_enterprise_annual_upfront_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_enterprise_annual_upfront_paid",
          status: "paid",
          paid: true,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_upfront_invoice",
            monthly_minimum_allowance: "60000",
            per_page_price_minor: "9",
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const signature = await createStripeSignature(payload, "stripe-webhook-secret");

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "enterprise_annual",
        display_name: "Enterprise annual",
        included_credits: 0,
        api_access: true,
      },
      current_period: {
        anchor: "2026-06-01T00:00:00.000Z",
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
        monthly_page_limit: null,
        pages_remaining: null,
      },
      enterprise_annual_commitment: {
        status: "active",
        monthly_minimum_allowance: 60000,
        upfront_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_paid",
          paid_at: "2026-06-03T12:00:00.000Z",
        },
      },
    });
  });

  it("keeps Enterprise annual payment-gated when the upfront invoice requires customer action", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "pending_payment",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 6480000,
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual Enterprise commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-06-01T12:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_action",
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_action",
      },
    });
    const event = {
      id: "evt_enterprise_annual_upfront_action_required",
      type: "invoice.payment_action_required",
      data: {
        object: {
          id: "in_enterprise_annual_upfront_action",
          status: "open",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_action_updated",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_upfront_invoice",
            monthly_minimum_allowance: "60000",
            per_page_price_minor: "9",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "pending_payment",
        upfront_invoice: {
          status: "payment_action_required",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_action_updated",
          paid_at: null,
        },
      },
    });
  });

  it("keeps Enterprise annual payment-gated when the upfront invoice finalization fails", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "pending_payment",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 6480000,
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual Enterprise commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-06-01T12:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_finalization",
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_finalization",
      },
    });
    const event = {
      id: "evt_enterprise_annual_upfront_finalization_failed",
      type: "invoice.finalization_failed",
      data: {
        object: {
          id: "in_enterprise_annual_upfront_finalization",
          status: "draft",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_finalization",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_upfront_invoice",
            monthly_minimum_allowance: "60000",
            per_page_price_minor: "9",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "pending_payment",
        upfront_invoice: {
          status: "finalization_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_finalization",
          paid_at: null,
        },
      },
    });
  });

  it("keeps Enterprise annual payment-gated when the upfront invoice payment fails", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "pending_payment",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 6480000,
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual Enterprise commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-06-01T12:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_failed",
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_failed",
      },
    });
    const event = {
      id: "evt_enterprise_annual_upfront_payment_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_enterprise_annual_upfront_failed",
          status: "open",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_failed",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_upfront_invoice",
            monthly_minimum_allowance: "60000",
            per_page_price_minor: "9",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "pending_payment",
        upfront_invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_failed",
          paid_at: null,
        },
      },
    });
  });

  it("keeps Enterprise annual payment-gated when the upfront invoice is voided", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "pending_payment",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 6480000,
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual Enterprise commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-06-01T12:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_voided",
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_voided",
      },
    });
    const event = {
      id: "evt_enterprise_annual_upfront_voided",
      type: "invoice.voided",
      data: {
        object: {
          id: "in_enterprise_annual_upfront_voided",
          status: "void",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_voided",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_upfront_invoice",
            monthly_minimum_allowance: "60000",
            per_page_price_minor: "9",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "pending_payment",
        upfront_invoice: {
          status: "void",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_voided",
          paid_at: null,
        },
      },
    });
  });

  it("keeps Enterprise annual payment-gated when the upfront invoice is marked uncollectible", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "pending_payment",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 6480000,
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual Enterprise commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-06-01T12:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_uncollectible",
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_uncollectible",
      },
    });
    const event = {
      id: "evt_enterprise_annual_upfront_uncollectible",
      type: "invoice.marked_uncollectible",
      data: {
        object: {
          id: "in_enterprise_annual_upfront_uncollectible",
          status: "uncollectible",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_uncollectible",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_upfront_invoice",
            monthly_minimum_allowance: "60000",
            per_page_price_minor: "9",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "pending_payment",
        upfront_invoice: {
          status: "uncollectible",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_uncollectible",
          paid_at: null,
        },
      },
    });
  });

  it("generates monthly Enterprise annual overage invoices only above the minimum allowance", async () => {
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_annual_overage_june",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_annual_overage_june",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_annual_overage_june",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_june",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingLedger: createBillingLedgerBinding({
        enterpriseUsagePages: 60005,
      }),
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
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
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledTimes(3);
    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    expect(invoiceRequest.headers).toHaveProperty("idempotency-key", "enterprise-annual-overage-invoice:workspace_billing:2026-06-01T00:00:00.000Z:2026-07-01T00:00:00.000Z:invoice");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("customer")).toBe("cus_enterprise_annual_workspace");
    expect(invoiceBody.get("collection_method")).toBe("send_invoice");
    expect(invoiceBody.get("auto_advance")).toBe("false");
    expect(invoiceBody.get("automatic_tax[enabled]")).toBe("true");
    expect(invoiceBody.get("metadata[billing_action]")).toBe("enterprise_annual_overage_invoice");
    expect(invoiceBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(invoiceBody.get("metadata[period_start]")).toBe("2026-06-01T00:00:00.000Z");
    expect(invoiceBody.get("metadata[period_end]")).toBe("2026-07-01T00:00:00.000Z");
    expect(invoiceBody.get("metadata[monthly_minimum_allowance]")).toBe("60000");
    expect(invoiceBody.get("metadata[overage_pages]")).toBe("5");
    expect(invoiceBody.has("payment_settings[payment_method_types][0]")).toBe(false);

    const [invoiceItemUrl, invoiceItemRequest] = stripeFetch.mock.calls[1] as [string, RequestInit];
    expect(invoiceItemUrl).toBe("https://api.stripe.com/v1/invoiceitems");
    expect(invoiceItemRequest.headers).toHaveProperty("idempotency-key", "enterprise-annual-overage-invoice:workspace_billing:2026-06-01T00:00:00.000Z:2026-07-01T00:00:00.000Z:invoice-item");
    const invoiceItemBody = new URLSearchParams(String(invoiceItemRequest.body));
    expect(invoiceItemBody.get("invoice")).toBe("in_enterprise_annual_overage_june");
    expect(invoiceItemBody.get("amount")).toBe("45");
    expect(invoiceItemBody.get("currency")).toBe("gbp");
    expect(invoiceItemBody.get("metadata[billing_action]")).toBe("enterprise_annual_overage_invoice");

    const [finalizeUrl, finalizeRequest] = stripeFetch.mock.calls[2] as [string, RequestInit];
    expect(finalizeUrl).toBe("https://api.stripe.com/v1/invoices/in_enterprise_annual_overage_june/finalize");
    expect(finalizeRequest.headers).toHaveProperty("idempotency-key", "enterprise-annual-overage-invoice:workspace_billing:2026-06-01T00:00:00.000Z:2026-07-01T00:00:00.000Z:finalize");

    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_annual_commitment: {
        latest_overage_invoice: {
          period_start: "2026-06-01T00:00:00.000Z",
          period_end: "2026-07-01T00:00:00.000Z",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_june",
        },
      },
    });
  });

  it("continues scheduled Enterprise annual overage invoice generation after one Workspace fails", async () => {
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_annual_overage_ok",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_annual_overage_ok",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_annual_overage_ok",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_ok",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createScheduledAnnualOverageIsolationEnv();

    await expect(worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    )).resolves.toBeUndefined();

    expect(stripeFetch).toHaveBeenCalledTimes(3);
    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("customer")).toBe("cus_enterprise_annual_ok");
    expect(invoiceBody.get("metadata[workspace_id]")).toBe("workspace_annual_ok");
    expect(invoiceBody.get("metadata[overage_pages]")).toBe("5");
    expect(invoiceRequest.headers).toHaveProperty(
      "idempotency-key",
      "enterprise-annual-overage-invoice:workspace_annual_ok:2026-06-01T00:00:00.000Z:2026-07-01T00:00:00.000Z:invoice",
    );
    expect(consoleError).toHaveBeenCalledWith("Scheduled billing Workspace failed", expect.objectContaining({
      event: "billing.scheduled.workspace_failed",
      task: "enterprise_annual_overage_invoice_generation",
      workspace_id: "workspace_annual_failed",
      scheduled_at: "2026-07-02T12:00:00.000Z",
      error_code: "unexpected_error",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b/);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\bwhsec_[A-Za-z0-9]+\b/);
    consoleError.mockRestore();
  });

  it("suspends Enterprise annual after a failed overage invoice and falls back to the active subscription", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-06-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-07-15T00:00:00.000Z",
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
        enterprise_annual_last_overage_invoice_period_start: "2026-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2026-07-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_failed",
        enterprise_annual_last_overage_invoice_status: "open",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_failed",
        enterprise_annual_last_overage_invoiced_at: "2026-07-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_annual_overage_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_enterprise_annual_overage_failed",
          status: "open",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_failed",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_overage_invoice",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_annual_commitment: {
        status: "suspended",
        latest_overage_invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_failed",
        },
      },
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_annual_commitment: {
        status: "suspended",
        latest_overage_invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_failed",
        },
      },
    });
  });

  it("suspends Enterprise annual when an overage invoice requires customer action", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-06-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-07-15T00:00:00.000Z",
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
        enterprise_annual_last_overage_invoice_period_start: "2026-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2026-07-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_action",
        enterprise_annual_last_overage_invoice_status: "open",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_action",
        enterprise_annual_last_overage_invoiced_at: "2026-07-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_annual_overage_action_required",
      type: "invoice.payment_action_required",
      data: {
        object: {
          id: "in_enterprise_annual_overage_action",
          status: "open",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_action",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_overage_invoice",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_annual_commitment: {
        status: "suspended",
        latest_overage_invoice: {
          status: "payment_action_required",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_action",
        },
      },
    });
  });

  it("suspends Enterprise annual when an overage invoice finalization fails", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-06-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-07-15T00:00:00.000Z",
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
        enterprise_annual_last_overage_invoice_period_start: "2026-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2026-07-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_finalization",
        enterprise_annual_last_overage_invoice_status: "open",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_finalization",
        enterprise_annual_last_overage_invoiced_at: "2026-07-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_annual_overage_finalization_failed",
      type: "invoice.finalization_failed",
      data: {
        object: {
          id: "in_enterprise_annual_overage_finalization",
          status: "draft",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_finalization",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_overage_invoice",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_annual_commitment: {
        status: "suspended",
        latest_overage_invoice: {
          status: "finalization_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_finalization",
        },
      },
    });
  });

  it("suspends Enterprise annual when an overage invoice is voided", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-06-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-07-15T00:00:00.000Z",
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
        enterprise_annual_last_overage_invoice_period_start: "2026-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2026-07-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_voided",
        enterprise_annual_last_overage_invoice_status: "open",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_voided",
        enterprise_annual_last_overage_invoiced_at: "2026-07-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_annual_overage_voided",
      type: "invoice.voided",
      data: {
        object: {
          id: "in_enterprise_annual_overage_voided",
          status: "void",
          paid: false,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_voided",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_overage_invoice",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_annual_commitment: {
        status: "suspended",
        latest_overage_invoice: {
          status: "void",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_voided",
        },
      },
    });
  });

  it("restores Enterprise annual after a failed overage invoice is paid while the term is active", async () => {
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-06-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-07-15T00:00:00.000Z",
        enterprise_annual_status: "suspended",
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
        enterprise_annual_last_overage_invoice_period_start: "2026-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2026-07-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_paid",
        enterprise_annual_last_overage_invoice_status: "payment_failed",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_paid",
        enterprise_annual_last_overage_invoiced_at: "2026-07-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_annual_overage_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_enterprise_annual_overage_paid",
          status: "paid",
          paid: true,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_overage_invoice",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "enterprise_annual",
        display_name: "Enterprise annual",
      },
      current_period: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-08-01T00:00:00.000Z",
        monthly_page_limit: null,
      },
      enterprise_annual_commitment: {
        status: "active",
        latest_overage_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_paid",
        },
      },
    });
  });

  it("marks Enterprise annual expired when a failed overage invoice is paid after the term ends", async () => {
    vi.setSystemTime(new Date("2027-06-02T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_annual_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_annual_workspace",
        enterprise_annual_status: "suspended",
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
        enterprise_annual_last_overage_invoice_period_start: "2027-05-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2027-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_late_paid",
        enterprise_annual_last_overage_invoice_status: "payment_failed",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_late_paid",
        enterprise_annual_last_overage_invoiced_at: "2027-06-01T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_annual_overage_late_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_enterprise_annual_overage_late_paid",
          status: "paid",
          paid: true,
          customer: "cus_enterprise_annual_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_late_paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_annual_overage_invoice",
            period_start: "2027-05-01T00:00:00.000Z",
            period_end: "2027-06-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_annual_commitment: {
        status: "expired",
        latest_overage_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_late_paid",
        },
      },
    });
  });

  it("rejects conflicting active Enterprise ramp-up terms before replacing them", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      billingControl: {
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Existing Enterprise ramp-up",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/enterprise-ramp-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enterprise_billing_cycle_start_date: "2026-05-15T00:00:00.000Z",
          collection_mode: "automatic",
          reason: "Second Enterprise ramp-up",
          idempotency_key: "enterprise-ramp-up-conflict-1",
        }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "enterprise_ramp_up_active",
        message: "Workspace already has active Enterprise ramp-up deal terms",
      },
    });

    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_ramp_up: {
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        collection_mode: "manual",
        reason: "Existing Enterprise ramp-up",
      },
      audit_entries: [],
    });
  });

  it("generates Enterprise ramp-up invoices for closed usage periods using tiered usage slices", async () => {
    vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_ramp_up_may",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_ramp_up_may_slice_1",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_ramp_up_may_slice_2",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_ramp_up_may",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_may",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_enterprise_workspace",
      billingLedger: createBillingLedgerBinding({
        enterpriseUsagePages: 10001,
      }),
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledTimes(4);
    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    expect(invoiceRequest.headers).toHaveProperty("idempotency-key", "enterprise-ramp-up-invoice:workspace_billing:2026-05-01T00:00:00.000Z:2026-06-01T00:00:00.000Z:invoice");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("customer")).toBe("cus_enterprise_workspace");
    expect(invoiceBody.get("collection_method")).toBe("send_invoice");
    expect(invoiceBody.get("auto_advance")).toBe("false");
    expect(invoiceBody.get("automatic_tax[enabled]")).toBe("true");
    expect(invoiceBody.get("metadata[billing_action]")).toBe("enterprise_ramp_up_invoice");
    expect(invoiceBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(invoiceBody.get("metadata[period_start]")).toBe("2026-05-01T00:00:00.000Z");
    expect(invoiceBody.get("metadata[period_end]")).toBe("2026-06-01T00:00:00.000Z");
    expect(invoiceBody.has("payment_settings[payment_method_types][0]")).toBe(false);

    const [, firstItemRequest] = stripeFetch.mock.calls[1] as [string, RequestInit];
    const firstItemBody = new URLSearchParams(String(firstItemRequest.body));
    expect(firstItemBody.get("invoice")).toBe("in_enterprise_ramp_up_may");
    expect(firstItemBody.get("quantity")).toBe("10000");
    expect(firstItemBody.get("unit_amount_decimal")).toBe("14");
    expect(firstItemBody.get("currency")).toBe("gbp");
    expect(firstItemBody.get("metadata[usage_band_start]")).toBe("0");
    expect(firstItemBody.get("metadata[usage_band_end]")).toBe("10000");

    const [, secondItemRequest] = stripeFetch.mock.calls[2] as [string, RequestInit];
    const secondItemBody = new URLSearchParams(String(secondItemRequest.body));
    expect(secondItemBody.get("invoice")).toBe("in_enterprise_ramp_up_may");
    expect(secondItemBody.get("quantity")).toBe("1");
    expect(secondItemBody.get("unit_amount_decimal")).toBe("13");
    expect(secondItemBody.get("metadata[usage_band_start]")).toBe("10001");
    expect(secondItemBody.get("metadata[usage_band_end]")).toBe("20000");

    const [finalizeUrl, finalizeRequest] = stripeFetch.mock.calls[3] as [string, RequestInit];
    expect(finalizeUrl).toBe("https://api.stripe.com/v1/invoices/in_enterprise_ramp_up_may/finalize");
    expect(finalizeRequest.headers).toHaveProperty("idempotency-key", "enterprise-ramp-up-invoice:workspace_billing:2026-05-01T00:00:00.000Z:2026-06-01T00:00:00.000Z:finalize");

    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_ramp_up: {
        latest_invoice: {
          period_start: "2026-05-01T00:00:00.000Z",
          period_end: "2026-06-01T00:00:00.000Z",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_may",
        },
      },
    });
  });

  it("continues scheduled Enterprise ramp-up invoice generation after one Workspace fails", async () => {
    vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_ramp_up_ok",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_ramp_up_ok_slice_1",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_ramp_up_ok",
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_ok",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createScheduledRampUpIsolationEnv();

    await expect(worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    )).resolves.toBeUndefined();

    expect(stripeFetch).toHaveBeenCalledTimes(3);
    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("customer")).toBe("cus_enterprise_ok");
    expect(invoiceBody.get("metadata[workspace_id]")).toBe("workspace_ok");
    expect(invoiceRequest.headers).toHaveProperty(
      "idempotency-key",
      "enterprise-ramp-up-invoice:workspace_ok:2026-05-01T00:00:00.000Z:2026-06-01T00:00:00.000Z:invoice",
    );
    expect(consoleError).toHaveBeenCalledWith("Scheduled billing Workspace failed", expect.objectContaining({
      event: "billing.scheduled.workspace_failed",
      task: "enterprise_ramp_up_invoice_generation",
      workspace_id: "workspace_failed",
      scheduled_at: "2026-06-02T12:00:00.000Z",
      error_code: "unexpected_error",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b/);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\bwhsec_[A-Za-z0-9]+\b/);
    consoleError.mockRestore();
  });

  it("keeps Enterprise ramp-up review-mode invoices as drafts without automatic finalization", async () => {
    vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "in_enterprise_ramp_up_review",
          status: "draft",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "ii_enterprise_ramp_up_review_slice_1",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_enterprise_workspace",
      billingLedger: createBillingLedgerBinding({
        enterpriseUsagePages: 1,
      }),
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "automatic",
        enterprise_ramp_up_invoice_review_enabled: 1,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledTimes(2);
    const [invoiceUrl, invoiceRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(invoiceUrl).toBe("https://api.stripe.com/v1/invoices");
    const invoiceBody = new URLSearchParams(String(invoiceRequest.body));
    expect(invoiceBody.get("collection_method")).toBe("charge_automatically");
    expect(invoiceBody.get("auto_advance")).toBe("false");

    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_ramp_up: {
        invoice_review_enabled: true,
        latest_invoice: {
          period_start: "2026-05-01T00:00:00.000Z",
          period_end: "2026-06-01T00:00:00.000Z",
          status: "draft",
          hosted_invoice_url: null,
        },
      },
    });
  });

  it("suspends Enterprise ramp-up after a failed invoice and falls back to the active subscription", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-15T00:00:00.000Z",
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-06-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_failed",
        enterprise_ramp_up_last_invoice_status: "open",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_failed",
        enterprise_ramp_up_last_invoiced_at: "2026-06-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_ramp_up_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_enterprise_ramp_up_failed",
          status: "open",
          paid: false,
          customer: "cus_enterprise_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_failed",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_ramp_up_invoice",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      current_period: {
        start: "2026-05-15T00:00:00.000Z",
        end: "2026-06-15T00:00:00.000Z",
        monthly_page_limit: 1500,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
      enterprise_ramp_up: {
        status: "suspended",
        latest_invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_failed",
        },
      },
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_ramp_up: {
        status: "suspended",
        latest_invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_failed",
        },
      },
    });
  });

  it("suspends Enterprise ramp-up when an invoice requires customer action", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-15T00:00:00.000Z",
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-06-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_action",
        enterprise_ramp_up_last_invoice_status: "open",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_action",
        enterprise_ramp_up_last_invoiced_at: "2026-06-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_ramp_up_action_required",
      type: "invoice.payment_action_required",
      data: {
        object: {
          id: "in_enterprise_ramp_up_action",
          status: "open",
          paid: false,
          customer: "cus_enterprise_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_action",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_ramp_up_invoice",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_ramp_up: {
        status: "suspended",
        latest_invoice: {
          status: "payment_action_required",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_action",
        },
      },
    });
  });

  it("suspends Enterprise ramp-up when an invoice finalization fails", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-15T00:00:00.000Z",
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-06-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_finalization",
        enterprise_ramp_up_last_invoice_status: "open",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_finalization",
        enterprise_ramp_up_last_invoiced_at: "2026-06-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_ramp_up_finalization_failed",
      type: "invoice.finalization_failed",
      data: {
        object: {
          id: "in_enterprise_ramp_up_finalization",
          status: "draft",
          paid: false,
          customer: "cus_enterprise_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_finalization",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_ramp_up_invoice",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_ramp_up: {
        status: "suspended",
        latest_invoice: {
          status: "finalization_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_finalization",
        },
      },
    });
  });

  it("suspends Enterprise ramp-up when an invoice is voided", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-15T00:00:00.000Z",
        enterprise_ramp_up_status: "active",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-06-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_voided",
        enterprise_ramp_up_last_invoice_status: "open",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_voided",
        enterprise_ramp_up_last_invoiced_at: "2026-06-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_ramp_up_voided",
      type: "invoice.voided",
      data: {
        object: {
          id: "in_enterprise_ramp_up_voided",
          status: "void",
          paid: false,
          customer: "cus_enterprise_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_voided",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_ramp_up_invoice",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      enterprise_ramp_up: {
        status: "suspended",
        latest_invoice: {
          status: "void",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_voided",
        },
      },
    });
  });

  it("restores Enterprise ramp-up after a failed invoice is paid while the term is active", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        stripe_subscription_id: "sub_workspace_pro",
        stripe_subscription_item_id: "si_workspace_pro",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-15T00:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-15T00:00:00.000Z",
        enterprise_ramp_up_status: "suspended",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-06-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_paid",
        enterprise_ramp_up_last_invoice_status: "payment_failed",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_paid",
        enterprise_ramp_up_last_invoiced_at: "2026-06-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_ramp_up_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_enterprise_ramp_up_paid",
          status: "paid",
          paid: true,
          customer: "cus_enterprise_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_ramp_up_invoice",
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "enterprise_ramp_up",
        display_name: "Enterprise ramp-up",
      },
      current_period: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
        monthly_page_limit: null,
      },
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      enterprise_ramp_up: {
        status: "active",
        latest_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_paid",
        },
      },
    });
  });

  it("marks Enterprise ramp-up expired when a failed invoice is paid after the term ends", async () => {
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_enterprise_workspace",
      billingControl: {
        stripe_customer_id: "cus_enterprise_workspace",
        enterprise_ramp_up_status: "suspended",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Enterprise ramp-up before annual commitment",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-07-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-08-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_late_paid",
        enterprise_ramp_up_last_invoice_status: "payment_failed",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_late_paid",
        enterprise_ramp_up_last_invoiced_at: "2026-08-02T12:00:00.000Z",
      },
    });
    const event = {
      id: "evt_enterprise_ramp_up_late_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_enterprise_ramp_up_late_paid",
          status: "paid",
          paid: true,
          customer: "cus_enterprise_workspace",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_late_paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "enterprise_ramp_up_invoice",
            period_start: "2026-07-01T00:00:00.000Z",
            period_end: "2026-08-01T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      enterprise_ramp_up: {
        status: "expired",
        latest_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_late_paid",
        },
      },
    });
  });

  it("lets Application admins inspect Workspace billing state", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      billingControl: {
        plan_override_plan: "pro",
        plan_override_start_at: "2026-05-31T00:00:00.000Z",
        plan_override_end_at: "2026-06-30T00:00:00.000Z",
        plan_override_reason: "Commercial onboarding grant",
        plan_override_created_by_user_id: "user_admin",
        plan_override_created_at: "2026-05-31T12:00:00.000Z",
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace_id: "workspace_billing",
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      plan_override: {
        plan: "pro",
        start_at: "2026-05-31T00:00:00.000Z",
        end_at: "2026-06-30T00:00:00.000Z",
        reason: "Commercial onboarding grant",
        created_by_user_id: "user_admin",
      },
      no_billing_mode: {
        enabled: false,
      },
      audit_entries: [],
    });
  });

  it("lets Application admins revoke unspent Goodwill Credit grants", async () => {
    requireSessionMock
      .mockResolvedValueOnce({
        id: "user_admin",
        email: "admin@example.com",
        name: "Application Admin",
        role: "admin",
      })
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
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
    });

    await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/goodwill-credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credits: 25,
          reason: "Support adjustment for onboarding",
          idempotency_key: "grant-request-1",
        }),
      }),
      env,
    );

    const revokeResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/goodwill-credits/grant_grant-request-1/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Grant entered for the wrong Workspace",
          idempotency_key: "revoke-request-1",
        }),
      }),
      env,
    );

    expect(revokeResponse.status).toBe(200);
    await expect(revokeResponse.json()).resolves.toEqual({
      revocation_id: "revocation_revoke-request-1",
      grant_id: "grant_grant-request-1",
      workspace_id: "workspace_billing",
      revoked_credits: 25,
      available_credits: 0,
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledTimes(2);
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenLastCalledWith({
      reason: "billing_usage",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        goodwill_available: 0,
        total_available: 0,
      },
      owner_billing_activity: [
        expect.objectContaining({
          type: "goodwill_credit_grant",
          credits: 25,
          description: "Goodwill Credits granted",
        }),
      ],
    });
  });

  it("denies manual Goodwill Credit grants to non-Application-admin sessions", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_owner",
      email: "owner@example.com",
      name: "Workspace Owner",
      role: "user",
    });
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/goodwill-credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credits: 25,
          reason: "Support adjustment for onboarding",
          idempotency_key: "grant-request-1",
        }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "Only Application admins can manage Workspace billing",
      },
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).not.toHaveBeenCalled();
  });

  it("rejects Workspace API keys from the owner billing summary route", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary", {
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unsupported_auth_mode",
        message: "Workspace API keys cannot read billing summaries",
      },
    });
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("denies the owner billing summary to non-owner Workspace members", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "admin",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "Only Workspace owners can view billing summaries",
      },
    });
  });

  it("lets a Workspace owner start Credit pack Checkout with the configured Stripe Price", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_credit_pack_100",
        url: "https://checkout.stripe.com/c/pay/cs_test_credit_pack_100",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_size: 100 }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checkout_session_id: "cs_test_credit_pack_100",
      url: "https://checkout.stripe.com/c/pay/cs_test_credit_pack_100",
    });
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    const [stripeUrl, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(stripeRequest.method).toBe("POST");
    expect(stripeRequest.headers).toMatchObject({
      authorization: "Bearer stripe-secret-test-key",
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2026-05-27.dahlia",
    });
    expect(stripeRequest.headers).toHaveProperty("idempotency-key");
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("mode")).toBe("payment");
    expect(stripeBody.get("customer")).toBe("cus_workspace_billing");
    expect(stripeBody.has("line_items[0][price]")).toBe(false);
    expect(stripeBody.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(stripeBody.get("line_items[0][price_data][unit_amount]")).toBe("2200");
    expect(stripeBody.get("line_items[0][price_data][tax_behavior]")).toBe("exclusive");
    expect(stripeBody.get("line_items[0][price_data][product_data][name]")).toBe("100 Workspace Credits");
    expect(stripeBody.get("line_items[0][quantity]")).toBe("1");
    expect(stripeBody.get("automatic_tax[enabled]")).toBe("true");
    expect(stripeBody.get("billing_address_collection")).toBe("required");
    expect(stripeBody.get("customer_update[address]")).toBe("auto");
    expect(stripeBody.get("success_url")).toBe("https://example.com/?checkout=success");
    expect(stripeBody.get("cancel_url")).toBe("https://example.com/?checkout=cancel");
    expect(stripeBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("metadata[billing_action]")).toBe("credit_pack_purchase");
    expect(stripeBody.get("metadata[plan]")).toBe("free");
    expect(stripeBody.get("metadata[credit_pack_size]")).toBe("100");
    const purchaseId = stripeBody.get("metadata[purchase_id]");
    expect(purchaseId).toMatch(/^credit_pack_/);
    expect(String((stripeRequest.headers as Record<string, string>)["idempotency-key"] || "")).toContain(
      String(purchaseId),
    );
    expect(stripeBody.get("invoice_creation[enabled]")).toBe("true");
    expect(stripeBody.get("invoice_creation[invoice_data][description]")).toBe("100 Workspace Credits");
    expect(stripeBody.get("invoice_creation[invoice_data][metadata][workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("invoice_creation[invoice_data][metadata][billing_action]")).toBe("credit_pack_purchase");
    expect(stripeBody.get("invoice_creation[invoice_data][metadata][plan]")).toBe("free");
    expect(stripeBody.get("invoice_creation[invoice_data][metadata][credit_pack_size]")).toBe("100");
    expect(stripeBody.get("invoice_creation[invoice_data][metadata][purchase_id]")).toBe(purchaseId);
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);

  });

  it("uses the current dev origin for Credit pack Checkout return URLs", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_credit_pack_100",
        url: "https://checkout.stripe.com/c/pay/cs_test_credit_pack_100",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pack_size: 100,
          return_origin: "http://localhost:5173",
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    const [, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("success_url")).toBe("http://localhost:5173/?checkout=success");
    expect(stripeBody.get("cancel_url")).toBe("http://localhost:5173/?checkout=cancel");
  });

  it("rejects Workspace API keys from Credit pack Checkout", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: {
          authorization: "Bearer workspace-api-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ pack_size: 100 }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unsupported_auth_mode",
        message: "Workspace API keys cannot start billing Checkout",
      },
    });
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("denies Credit pack Checkout to non-owner Workspace members", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "cs_should_not_be_created",
        url: "https://checkout.stripe.com/c/pay/cs_should_not_be_created",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "admin",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_size: 100 }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "Only Workspace owners can start billing Checkout",
      },
    });
    expect(stripeFetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported Credit pack sizes before Stripe writes", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "cs_should_not_be_created",
        url: "https://checkout.stripe.com/c/pay/cs_should_not_be_created",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_size: 250 }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_credit_pack",
        message: "pack_size must be one of 100, 500, 1000, or 5000",
      },
    });
    expect(stripeFetch).not.toHaveBeenCalled();
  });

  it("uses the current plan and selected Credit pack size to choose the Stripe Price", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_credit_pack_500",
        url: "https://checkout.stripe.com/c/pay/cs_test_credit_pack_500",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_size: 500 }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const [, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("metadata[plan]")).toBe("free");
    expect(stripeBody.get("metadata[credit_pack_size]")).toBe("500");
    expect(stripeBody.get("invoice_creation[invoice_data][metadata][credit_pack_size]")).toBe("500");
    expect(stripeBody.get("line_items[0][price_data][unit_amount]")).toBe("11000");
  });

  it("lets a Workspace owner start Pro subscription Checkout with the configured recurring Stripe Price", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_pro_subscription",
        url: "https://checkout.stripe.com/c/pay/cs_test_pro_subscription",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checkout_session_id: "cs_test_pro_subscription",
      url: "https://checkout.stripe.com/c/pay/cs_test_pro_subscription",
    });
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    const [stripeUrl, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(stripeRequest.method).toBe("POST");
    expect(stripeRequest.headers).toMatchObject({
      authorization: "Bearer stripe-secret-test-key",
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2026-05-27.dahlia",
    });
    expect(stripeRequest.headers).toHaveProperty("idempotency-key");
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("mode")).toBe("subscription");
    expect(stripeBody.get("customer")).toBe("cus_workspace_billing");
    expect(stripeBody.get("line_items[0][price]")).toBe("price_pro_monthly");
    expect(stripeBody.get("line_items[0][quantity]")).toBe("1");
    expect(stripeBody.get("automatic_tax[enabled]")).toBe("true");
    expect(stripeBody.get("billing_address_collection")).toBe("required");
    expect(stripeBody.get("customer_update[address]")).toBe("auto");
    expect(stripeBody.get("success_url")).toBe("https://example.com/?checkout=success");
    expect(stripeBody.get("cancel_url")).toBe("https://example.com/?checkout=cancel");
    expect(stripeBody.get("client_reference_id")).toBe("workspace_billing:subscription:pro");
    expect(stripeBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_start");
    expect(stripeBody.get("metadata[plan]")).toBe("pro");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);
  });

  it("uses the current dev origin for subscription Checkout return URLs", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_pro_subscription",
        url: "https://checkout.stripe.com/c/pay/cs_test_pro_subscription",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan: "pro",
          return_origin: "http://localhost:5173",
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    const [, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("success_url")).toBe("http://localhost:5173/?checkout=success");
    expect(stripeBody.get("cancel_url")).toBe("http://localhost:5173/?checkout=cancel");
  });

  it("lets a Workspace owner start Max subscription Checkout with the configured recurring Stripe Price", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_max_subscription",
        url: "https://checkout.stripe.com/c/pay/cs_test_max_subscription",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "max" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const [, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("mode")).toBe("subscription");
    expect(stripeBody.get("line_items[0][price]")).toBe("price_max_monthly");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_start");
    expect(stripeBody.get("metadata[plan]")).toBe("max");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);
  });

  it("lets a Pro Workspace owner start an app-owned prorated Max upgrade without activating Max before payment", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_pro_workspace_billing",
        latest_invoice: {
          id: "in_prorated_max_upgrade",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_prorated_max_upgrade",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "max" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_pro_workspace_billing",
      target_plan: "max",
      payment_url: "https://invoice.stripe.com/i/in_prorated_max_upgrade",
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).not.toHaveBeenCalled();
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    const [stripeUrl, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/subscriptions/sub_pro_workspace_billing");
    expect(stripeRequest.method).toBe("POST");
    expect(stripeRequest.headers).toMatchObject({
      authorization: "Bearer stripe-secret-test-key",
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2026-05-27.dahlia",
    });
    expect(stripeRequest.headers).toHaveProperty("idempotency-key");
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("items[0][id]")).toBe("si_pro_workspace_billing");
    expect(stripeBody.get("items[0][price]")).toBe("price_max_monthly");
    expect(stripeBody.get("payment_behavior")).toBe("pending_if_incomplete");
    expect(stripeBody.get("proration_behavior")).toBe("always_invoice");
    expect(stripeBody.get("expand[0]")).toBe("latest_invoice");
    expect(stripeBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_upgrade");
    expect(stripeBody.get("metadata[plan]")).toBe("max");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      current_period: {
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 1500,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
    });
  });

  it("lets a paid Workspace owner schedule subscription cancellation without removing current paid entitlement", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_pro_workspace_billing",
        cancel_at_period_end: true,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_pro_workspace_billing",
      scheduled_plan: "free",
      effective_at: periodEnd,
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    const [stripeUrl, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/subscriptions/sub_pro_workspace_billing");
    expect(stripeRequest.method).toBe("POST");
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("cancel_at_period_end")).toBe("true");
    expect(stripeBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_cancellation");
    expect(stripeBody.get("metadata[plan]")).toBe("free");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      next_scheduled_entitlement: {
        plan: "free",
        display_name: "Free",
        effective_at: periodEnd,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
    });
  });

  it("treats paid to Free as a scheduled next-period subscription change", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_pro_workspace_billing",
        cancel_at_period_end: true,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "free" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_pro_workspace_billing",
      scheduled_plan: "free",
      effective_at: periodEnd,
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    const [, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("cancel_at_period_end")).toBe("true");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_cancellation");
  });

  it("lets a paid Workspace owner cancel a scheduled Free subscription change", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_pro_workspace_billing",
        cancel_at_period_end: false,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
        scheduled_entitlement_plan: "free",
        scheduled_entitlement_effective_at: periodEnd,
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/scheduled-change/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_pro_workspace_billing",
      canceled_scheduled_plan: "free",
      active_plan: "pro",
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    const [stripeUrl, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/subscriptions/sub_pro_workspace_billing");
    expect(stripeRequest.method).toBe("POST");
    expect(stripeRequest.headers).toMatchObject({
      authorization: "Bearer stripe-secret-test-key",
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2026-05-27.dahlia",
    });
    expect(stripeRequest.headers).toHaveProperty("idempotency-key");
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("cancel_at_period_end")).toBe("false");
    expect(stripeBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_scheduled_change_canceled");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
    });
  });

  it("keeps a Free override on Free after the owner cancels the paid subscription fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_pro_workspace_billing",
        cancel_at_period_end: true,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
        plan_override_plan: "free",
        plan_override_start_at: "2026-05-31T00:00:00.000Z",
        plan_override_end_at: "2026-07-01T00:00:00.000Z",
        plan_override_reason: "Downgrade after trial",
        plan_override_created_by_user_id: "user_admin",
        plan_override_created_at: "2026-05-31T00:00:00.000Z",
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "free" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_pro_workspace_billing",
      scheduled_plan: "free",
      effective_at: periodEnd,
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
    });
  });

  it("clears an active Free override when the owner upgrades to the already-paid Pro subscription", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch");
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
        plan_override_plan: "free",
        plan_override_start_at: "2026-05-31T00:00:00.000Z",
        plan_override_end_at: "2026-07-01T00:00:00.000Z",
        plan_override_reason: "Downgrade after trial",
        plan_override_created_by_user_id: "user_admin",
        plan_override_created_at: "2026-05-31T00:00:00.000Z",
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_pro_workspace_billing",
      target_plan: "pro",
    });
    expect(stripeFetch).not.toHaveBeenCalled();
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
    });
  });

  it("schedules a Max to Pro downgrade for the next Billing period without removing current Max entitlement", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_max_workspace_billing",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      productStore,
      billingControl: {
        stripe_subscription_id: "sub_max_workspace_billing",
        stripe_subscription_item_id: "si_max_workspace_billing",
        self_service_subscription_plan: "max",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription_id: "sub_max_workspace_billing",
      scheduled_plan: "pro",
      effective_at: periodEnd,
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    const [stripeUrl, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/subscriptions/sub_max_workspace_billing");
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("items[0][id]")).toBe("si_max_workspace_billing");
    expect(stripeBody.get("items[0][price]")).toBe("price_pro_monthly");
    expect(stripeBody.get("proration_behavior")).toBe("none");
    expect(stripeBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(stripeBody.get("metadata[billing_action]")).toBe("subscription_downgrade");
    expect(stripeBody.get("metadata[plan]")).toBe("pro");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "max",
        display_name: "Max",
      },
      next_scheduled_entitlement: {
        plan: "pro",
        display_name: "Pro",
        effective_at: periodEnd,
      },
      self_service_subscription: {
        plan: "max",
        status: "active",
      },
    });
  });

  it("keeps the latest Stripe Billing period anchor for Free periods after a paid subscription ends", async () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    const latestPaidPeriodStart = "2026-05-31T12:00:00.000Z";
    const latestPaidPeriodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace({ created_at: "2026-05-04T00:00:00.000Z" }),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: latestPaidPeriodStart,
        stripe_subscription_current_period_end: latestPaidPeriodEnd,
        scheduled_entitlement_plan: "free",
        scheduled_entitlement_effective_at: latestPaidPeriodEnd,
      },
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
      },
      current_period: {
        anchor: latestPaidPeriodEnd,
        start: latestPaidPeriodEnd,
        end: "2026-07-30T12:00:00.000Z",
        monthly_page_limit: 500,
      },
      self_service_subscription: null,
    });
  });

  it("rejects Workspace API keys from subscription Checkout", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/checkout", {
        method: "POST",
        headers: {
          authorization: "Bearer workspace-api-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan: "pro" }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unsupported_auth_mode",
        message: "Workspace API keys cannot start billing Checkout",
      },
    });
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("keeps the Free entitlement after subscription Checkout starts but before Stripe payment events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "cs_test_pro_subscription",
        url: "https://checkout.stripe.com/c/pay/cs_test_pro_subscription",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      }),
      env,
    );
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
        included_credits: 0,
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: null,
    });
  });

  it("creates a Workspace-scoped Stripe Customer before Credit pack Checkout when needed", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "cus_new_workspace_billing",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: "cs_test_credit_pack_100",
          url: "https://checkout.stripe.com/c/pay/cs_test_credit_pack_100",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeCustomerId: null,
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/credit-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_size: 100 }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      checkout_session_id: "cs_test_credit_pack_100",
    });
    expect(stripeFetch).toHaveBeenCalledTimes(2);
    const [customerUrl, customerRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    expect(customerUrl).toBe("https://api.stripe.com/v1/customers");
    expect(customerRequest.method).toBe("POST");
    expect(customerRequest.headers).toMatchObject({
      authorization: "Bearer stripe-secret-test-key",
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2026-05-27.dahlia",
      "idempotency-key": "stripe-customer:workspace_billing",
    });
    const customerBody = new URLSearchParams(String(customerRequest.body));
    expect(customerBody.get("name")).toBe("Billing Workspace");
    expect(customerBody.get("email")).toBe("owner@example.com");
    expect(customerBody.get("metadata[workspace_id]")).toBe("workspace_billing");
    expect(customerBody.get("metadata[billing_customer_scope]")).toBe("workspace");

    const [, checkoutRequest] = stripeFetch.mock.calls[1] as [string, RequestInit];
    const checkoutBody = new URLSearchParams(String(checkoutRequest.body));
    expect(checkoutBody.get("customer")).toBe("cus_new_workspace_billing");

    stripeFetch.mockRestore();
  });

  it("rejects Stripe billing webhooks without a Stripe signature", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "evt_missing_signature" }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "stripe_signature_required",
        message: "Stripe webhook signature is required",
      },
    });
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("rejects stale signed Stripe billing webhooks before mutating Workspace billing state", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_stale_signature",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_credit_pack_stale_signature",
          payment_status: "paid",
          invoice: {
            id: "in_credit_pack_stale_signature",
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_stale_signature",
          },
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const staleTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;

    const response = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret", {
            timestamp: staleTimestamp,
          }),
        },
        body: payload,
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "stripe_signature_invalid",
        message: "Stripe webhook signature is invalid",
      },
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        total_available: 0,
      },
      owner_billing_activity: [],
    });
  });

  it("accepts Stripe billing webhooks signed by the configured rotation secret", async () => {
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      stripeWebhookSecretNext: "stripe-webhook-secret-next",
    });
    const event = {
      id: "evt_future_unknown_billing_event_next_secret",
      type: "billing.future_event",
      data: {
        object: {
          id: "obj_future_unknown_next_secret",
          object: "billing.future_object",
          metadata: {
            workspace_id: "workspace_billing",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const response = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret-next"),
        },
        body: payload,
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it.each([
    {
      name: "invalid HMAC",
      signatureHeader: async (payload: string) => createStripeSignature(payload, "wrong-webhook-secret"),
    },
    {
      name: "malformed timestamp",
      signatureHeader: async (payload: string) => createStripeSignature(payload, "stripe-webhook-secret", {
        timestamp: "not-a-timestamp",
      }),
    },
    {
      name: "unsupported signature scheme",
      signatureHeader: async (payload: string) => createStripeSignature(payload, "stripe-webhook-secret", {
        scheme: "v0",
      }),
    },
  ])("rejects Stripe billing webhooks with $name before mutating Workspace billing state", async ({ signatureHeader }) => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_invalid_signature",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_credit_pack_invalid_signature",
          payment_status: "paid",
          invoice: {
            id: "in_credit_pack_invalid_signature",
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_invalid_signature",
          },
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const response = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await signatureHeader(payload),
        },
        body: payload,
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "stripe_signature_invalid",
        message: "Stripe webhook signature is invalid",
      },
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        total_available: 0,
      },
      owner_billing_activity: [],
    });
  });

  it("records unsupported signed Stripe billing events as ignored diagnostics without mutating billing state", async () => {
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      productStore,
    });
    const event = {
      id: "evt_future_unknown_billing_event",
      type: "billing.future_event",
      data: {
        object: {
          id: "obj_future_unknown",
          object: "billing.future_object",
          metadata: {
            workspace_id: "workspace_billing",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toEqual({ received: true });
    expect(productStore.broadcastWorkspaceContextInvalidation).not.toHaveBeenCalled();

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
      },
      credits: {
        total_available: 0,
      },
      owner_billing_activity: [],
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      stripe_event_diagnostics: {
        ignored_event_count: 1,
        failed_event_count: 0,
        recent_events: [
          {
            event_id: "evt_future_unknown_billing_event",
            type: "billing.future_event",
            outcome: "ignored",
            workspace_id: "workspace_billing",
            related_stripe_object_id: "obj_future_unknown",
            failure_class: null,
            retry_guidance: "No retry needed; event type is not handled by Workspace billing.",
            manual_review_guidance: "No action required unless this event type becomes relevant to Workspace billing.",
          },
        ],
      },
    });
  });

  it("grants Purchased Credits from a signed paid Credit pack Checkout event", async () => {
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_credit_pack_100",
          payment_status: "paid",
          invoice: {
            id: "in_credit_pack_100",
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_100",
          },
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toEqual({ received: true });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_usage",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_checkout_session_cs_test_credit_pack_100",
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

  it("grants Purchased Credits from a delayed Credit pack Checkout success event", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_async_payment_succeeded",
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: "cs_test_credit_pack_async_100",
          payment_status: "paid",
          invoice: {
            id: "in_credit_pack_async_100",
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_async_100",
          },
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
            purchase_id: "purchase_credit_pack_async_100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toEqual({ received: true });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_credit_pack_purchase_purchase_credit_pack_async_100",
          type: "purchased_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 100,
          description: "Purchased Credits granted",
          invoice: {
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_async_100",
          },
        },
      ],
    });
  });

  it("records delayed Credit pack Checkout payment failures without granting Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_async_payment_failed",
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: "cs_test_credit_pack_async_failed_100",
          payment_status: "unpaid",
          invoice: {
            id: "in_credit_pack_async_failed_100",
            status: "payment_failed",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_async_failed_100",
          },
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
            purchase_id: "purchase_credit_pack_async_failed_100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toEqual({ received: true });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 0,
        total_available: 0,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_credit_pack_payment_failed_purchase_credit_pack_async_failed_100",
          type: "credit_pack_payment_failed",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 0,
          description: "Credit pack payment failed",
          invoice: {
            status: "payment_failed",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_async_failed_100",
          },
        },
      ],
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      stripe_event_diagnostics: {
        ignored_event_count: 0,
        failed_event_count: 0,
        payment_failed_event_count: 1,
        recent_events: [
          {
            event_id: "evt_credit_pack_async_payment_failed",
            type: "checkout.session.async_payment_failed",
            outcome: "payment_failed",
            workspace_id: "workspace_billing",
            related_stripe_object_id: "cs_test_credit_pack_async_failed_100",
            failure_class: "credit_pack_payment_failed",
            retry_guidance: "No retry needed; Stripe reported the delayed Credit pack payment failed.",
            manual_review_guidance: "Ask the Workspace owner to retry Credit pack Checkout if they still need Purchased Credits.",
          },
        ],
      },
    });
  });

  it("grants Purchased Credits and stores the hosted invoice URL from a paid Credit pack invoice event", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_credit_pack_100",
          status: "paid",
          paid: true,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_credit_pack_100",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
            purchase_id: "purchase_credit_pack_100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toEqual({ received: true });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_credit_pack_purchase_purchase_credit_pack_100",
          type: "purchased_credit_grant",
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

  it("repairs a missed paid Credit pack Checkout Session during scheduled Billing reconciliation", async () => {
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "cs_test_missed_credit_pack_100",
              payment_status: "paid",
              invoice: {
                id: "in_missed_credit_pack_100",
                status: "paid",
                hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_credit_pack_100",
              },
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "credit_pack_purchase",
                plan: "free",
                credit_pack_size: "100",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/checkout/sessions?customer=cus_workspace_billing&limit=100&expand%5B0%5D=data.invoice",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer stripe-secret-test-key",
          "stripe-version": "2026-05-27.dahlia",
        }),
      }),
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_checkout_session_cs_test_missed_credit_pack_100",
          type: "purchased_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 100,
          description: "Purchased Credits granted",
          invoice: {
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_credit_pack_100",
          },
        },
      ],
    });
  });

  it("records a missed failed delayed Credit pack Checkout Session during scheduled Billing reconciliation", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "cs_test_missed_failed_credit_pack_100",
              payment_status: "unpaid",
              invoice: {
                id: "in_missed_failed_credit_pack_100",
                status: "payment_failed",
                hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_failed_credit_pack_100",
              },
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "credit_pack_purchase",
                plan: "free",
                credit_pack_size: "100",
                purchase_id: "purchase_missed_failed_credit_pack_100",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 0,
        total_available: 0,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_credit_pack_payment_failed_purchase_missed_failed_credit_pack_100",
          type: "credit_pack_payment_failed",
          credits: 0,
          description: "Credit pack payment failed",
          invoice: {
            status: "payment_failed",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_failed_credit_pack_100",
          },
        },
      ],
    });

    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      reconciliation: {
        last_checked_at: "2026-05-31T12:00:00.000Z",
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_missed_failed_credit_pack_checkout_cs_test_missed_failed_credit_pack_100",
            workspace_id: "workspace_billing",
            drift_type: "missed_failed_credit_pack_checkout",
            severity: "warning",
            actionability: "informational",
            related_stripe_object_id: "cs_test_missed_failed_credit_pack_100",
            observed: {
              stripe_object_type: "checkout.session",
              billing_action: "credit_pack_purchase",
              payment_status: "unpaid",
              invoice_status: "payment_failed",
            },
            expected: {
              workspace_id: "workspace_billing",
              failed_activity_recorded: true,
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("does not duplicate a reconciled Credit pack grant when the Checkout webhook later arrives", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "cs_test_reconciled_then_webhook_credit_pack_100",
              payment_status: "paid",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "credit_pack_purchase",
                plan: "free",
                credit_pack_size: "100",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const event = {
      id: "evt_reconciled_credit_pack_delivered_late",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_reconciled_then_webhook_credit_pack_100",
          payment_status: "paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_checkout_session_cs_test_reconciled_then_webhook_credit_pack_100",
          type: "purchased_credit_grant",
          credits: 100,
        },
      ],
    });
  });

  it("does not duplicate safe repairs across repeated Billing reconciliation runs", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "cs_test_repeated_reconciliation_credit_pack_100",
              payment_status: "paid",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "credit_pack_purchase",
                plan: "free",
                credit_pack_size: "100",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "cs_test_repeated_reconciliation_credit_pack_100",
              payment_status: "paid",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "credit_pack_purchase",
                plan: "free",
                credit_pack_size: "100",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
    });
    const controller = { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController;

    await worker.scheduled?.(controller, env, { waitUntil: vi.fn() } as unknown as ExecutionContext);
    await worker.scheduled?.(controller, env, { waitUntil: vi.fn() } as unknown as ExecutionContext);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_checkout_session_cs_test_repeated_reconciliation_credit_pack_100",
          type: "purchased_credit_grant",
          credits: 100,
        },
      ],
    });
  });

  it("repairs a missed paid subscription invoice during scheduled Billing reconciliation", async () => {
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_missed_pro_subscription",
              status: "paid",
              customer: "cus_workspace_billing",
              parent: {
                type: "subscription_details",
                subscription_details: {
                  subscription: "sub_pro_workspace_billing",
                  metadata: {
                    workspace_id: "workspace_billing",
                    billing_action: "subscription_start",
                    plan: "pro",
                  },
                },
              },
              lines: {
                data: [
                  {
                    pricing: {
                      price_details: {
                        price: "price_pro_monthly",
                        product: "prod_pro",
                      },
                      type: "price_details",
                      unit_amount_decimal: "5000",
                    },
                    period: {
                      start: Math.floor(new Date(periodStart).getTime() / 1000),
                      end: Math.floor(new Date(periodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/invoices?customer=cus_workspace_billing&limit=100&expand%5B0%5D=data.lines&expand%5B1%5D=data.payment_intent",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer stripe-secret-test-key",
          "stripe-version": "2026-05-27.dahlia",
        }),
      }),
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        anchor: periodStart,
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 1500,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_invoice_in_missed_pro_subscription_included",
          type: "included_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 200,
          description: "Included Credits granted",
        },
      ],
    });
  });

  it("repairs a missed paid Plan downgrade invoice during scheduled Billing reconciliation", async () => {
    const previousPeriodStart = "2026-05-31T12:00:00.000Z";
    const downgradePeriodStart = "2026-06-30T12:00:00.000Z";
    const downgradePeriodEnd = "2026-07-30T12:00:00.000Z";
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_missed_max_to_pro_downgrade",
              status: "paid",
              paid: true,
              hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_max_to_pro_downgrade",
              customer: "cus_workspace_billing",
              parent: {
                type: "subscription_details",
                subscription_details: {
                  subscription: "sub_max_workspace_billing",
                  metadata: {
                    workspace_id: "workspace_billing",
                    billing_action: "subscription_downgrade",
                    plan: "pro",
                  },
                },
              },
              lines: {
                data: [
                  {
                    parent: {
                      subscription_item_details: {
                        subscription_item: "si_pro_workspace_billing",
                      },
                    },
                    pricing: {
                      price_details: {
                        price: "price_pro_monthly",
                        product: "prod_pro",
                      },
                      type: "price_details",
                      unit_amount_decimal: "5000",
                    },
                    period: {
                      start: Math.floor(new Date(downgradePeriodStart).getTime() / 1000),
                      end: Math.floor(new Date(downgradePeriodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_max_workspace_billing",
        stripe_subscription_item_id: "si_max_workspace_billing",
        self_service_subscription_plan: "max",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: previousPeriodStart,
        stripe_subscription_current_period_end: downgradePeriodStart,
        scheduled_entitlement_plan: "pro",
        scheduled_entitlement_effective_at: downgradePeriodStart,
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/invoices?customer=cus_workspace_billing&limit=100&expand%5B0%5D=data.lines&expand%5B1%5D=data.payment_intent",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer stripe-secret-test-key",
          "stripe-version": "2026-05-27.dahlia",
        }),
      }),
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        anchor: downgradePeriodStart,
        start: downgradePeriodStart,
        end: downgradePeriodEnd,
        monthly_page_limit: 1500,
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: downgradePeriodStart,
        current_period_end: downgradePeriodEnd,
        invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_max_to_pro_downgrade",
        },
      },
      owner_billing_activity: [
        expect.objectContaining({
          id: "entry_stripe_invoice_in_missed_max_to_pro_downgrade_included",
          type: "included_credit_grant",
          credits: 200,
        }),
      ],
    });
  });

  it("does not duplicate a reconciled subscription invoice grant when the invoice webhook later arrives", async () => {
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_reconciled_then_webhook_pro_subscription",
              status: "paid",
              paid: true,
              customer: "cus_workspace_billing",
              subscription: "sub_pro_workspace_billing",
              subscription_details: {
                metadata: {
                  workspace_id: "workspace_billing",
                  billing_action: "subscription_start",
                  plan: "pro",
                },
              },
              lines: {
                data: [
                  {
                    price: { id: "price_pro_monthly" },
                    period: {
                      start: Math.floor(new Date(periodStart).getTime() / 1000),
                      end: Math.floor(new Date(periodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const event = {
      id: "evt_reconciled_subscription_delivered_late",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_reconciled_then_webhook_pro_subscription",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        included_available: 200,
        total_available: 200,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_invoice_in_reconciled_then_webhook_pro_subscription_included",
          type: "included_credit_grant",
          credits: 200,
        },
      ],
    });
  });

  it("keeps a terminal subscription invoice unpaid during scheduled Billing reconciliation without granting Credits", async () => {
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_voided_pro_subscription",
              status: "void",
              paid: false,
              customer: "cus_workspace_billing",
              subscription: "sub_pro_workspace_billing",
              subscription_details: {
                metadata: {
                  workspace_id: "workspace_billing",
                  billing_action: "subscription_renewal",
                  plan: "pro",
                },
              },
              lines: {
                data: [
                  {
                    price: { id: "price_pro_monthly" },
                    period: {
                      start: Math.floor(new Date(periodStart).getTime() / 1000),
                      end: Math.floor(new Date(periodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "unpaid",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        invoice: {
          status: "void",
          hosted_invoice_url: null,
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records a missed subscription invoice requiring payment action during scheduled Billing reconciliation without granting Included Credits", async () => {
    const previousPeriodStart = "2026-05-31T12:00:00.000Z";
    const missedPeriodStart = "2026-06-30T12:00:00.000Z";
    const missedPeriodEnd = "2026-07-30T12:00:00.000Z";
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_missed_pro_subscription_action_required",
              status: "open",
              paid: false,
              customer: "cus_workspace_billing",
              subscription: "sub_pro_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_pro_subscription_action_required",
              payment_intent: {
                id: "pi_missed_pro_subscription_action_required",
                status: "requires_action",
              },
              subscription_details: {
                metadata: {
                  workspace_id: "workspace_billing",
                  billing_action: "subscription_renewal",
                  plan: "pro",
                },
              },
              lines: {
                data: [
                  {
                    price: { id: "price_pro_monthly" },
                    period: {
                      start: Math.floor(new Date(missedPeriodStart).getTime() / 1000),
                      end: Math.floor(new Date(missedPeriodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: previousPeriodStart,
        stripe_subscription_current_period_end: missedPeriodStart,
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/invoices?customer=cus_workspace_billing&limit=100&expand%5B0%5D=data.lines&expand%5B1%5D=data.payment_intent",
      expect.objectContaining({ method: "GET" }),
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: missedPeriodStart,
        current_period_end: missedPeriodEnd,
        invoice: {
          status: "payment_action_required",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_pro_subscription_action_required",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records a missed failed subscription invoice during scheduled Billing reconciliation without granting Included Credits", async () => {
    const previousPeriodStart = "2026-05-31T12:00:00.000Z";
    const missedPeriodStart = "2026-06-30T12:00:00.000Z";
    const missedPeriodEnd = "2026-07-30T12:00:00.000Z";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_missed_pro_subscription_payment_failed",
              status: "open",
              paid: false,
              customer: "cus_workspace_billing",
              subscription: "sub_pro_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_pro_subscription_payment_failed",
              payment_intent: {
                id: "pi_missed_pro_subscription_payment_failed",
                status: "requires_payment_method",
              },
              subscription_details: {
                metadata: {
                  workspace_id: "workspace_billing",
                  billing_action: "subscription_renewal",
                  plan: "pro",
                },
              },
              lines: {
                data: [
                  {
                    price: { id: "price_pro_monthly" },
                    period: {
                      start: Math.floor(new Date(missedPeriodStart).getTime() / 1000),
                      end: Math.floor(new Date(missedPeriodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: previousPeriodStart,
        stripe_subscription_current_period_end: missedPeriodStart,
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: missedPeriodStart,
        current_period_end: missedPeriodEnd,
        invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_missed_pro_subscription_payment_failed",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records a missed subscription invoice finalization failure during scheduled Billing reconciliation without raw Stripe error text", async () => {
    const previousPeriodStart = "2026-05-31T12:00:00.000Z";
    const missedPeriodStart = "2026-06-30T12:00:00.000Z";
    const missedPeriodEnd = "2026-07-30T12:00:00.000Z";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_missed_pro_subscription_finalization_failed",
              status: "draft",
              paid: false,
              customer: "cus_workspace_billing",
              subscription: "sub_pro_workspace_billing",
              hosted_invoice_url: null,
              automatic_tax: {
                status: "requires_location_inputs",
                reason: "customer_location_missing",
              },
              last_finalization_error: {
                code: "customer_tax_location_invalid",
                type: "invalid_request_error",
                message: "Do not store this raw Stripe error text.",
              },
              subscription_details: {
                metadata: {
                  workspace_id: "workspace_billing",
                  billing_action: "subscription_renewal",
                  plan: "pro",
                },
              },
              lines: {
                data: [
                  {
                    price: { id: "price_pro_monthly" },
                    period: {
                      start: Math.floor(new Date(missedPeriodStart).getTime() / 1000),
                      end: Math.floor(new Date(missedPeriodEnd).getTime() / 1000),
                    },
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: previousPeriodStart,
        stripe_subscription_current_period_end: missedPeriodStart,
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    const summary = await summaryResponse.json() as Record<string, unknown>;
    expect(summary).toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: missedPeriodStart,
        current_period_end: missedPeriodEnd,
        invoice: {
          status: "finalization_failed",
          hosted_invoice_url: null,
          finalization_failure: {
            automatic_tax_status: "requires_location_inputs",
            automatic_tax_reason: "customer_location_missing",
            last_finalization_error_code: "customer_tax_location_invalid",
          },
        },
      },
      owner_billing_activity: [],
    });
    expect(JSON.stringify(summary)).not.toContain("Do not store this raw Stripe error text.");
  });

  it("records ambiguous Billing reconciliation drift for Application admin follow-up", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_ambiguous_subscription",
              status: "paid",
              paid: true,
              customer: "cus_workspace_billing",
              subscription: "sub_ambiguous_workspace_billing",
              subscription_details: {
                metadata: {
                  billing_action: "subscription_start",
                  plan: "pro",
                },
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      reconciliation: {
        last_checked_at: "2026-05-31T12:00:00.000Z",
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_ambiguous_stripe_invoice_in_ambiguous_subscription",
            workspace_id: "workspace_billing",
            drift_type: "ambiguous_stripe_invoice",
            severity: "needs_review",
            actionability: "manual_review",
            related_stripe_object_id: "in_ambiguous_subscription",
            observed: {
              billing_action: "subscription_start",
              invoice_status: "paid",
              metadata_workspace_id: null,
            },
            expected: {
              workspace_id: "workspace_billing",
            },
            first_seen_at: "2026-05-31T12:00:00.000Z",
            last_seen_at: "2026-05-31T12:00:00.000Z",
            status: "open",
          },
        ],
      },
    });
  });

  it("records missed subscription lifecycle drift during scheduled Billing reconciliation", async () => {
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "sub_pro_workspace_billing",
              status: "paused",
              customer: "cus_workspace_billing",
              current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
              current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "subscription_start",
                plan: "pro",
              },
              items: {
                data: [
                  {
                    id: "si_pro_workspace_billing",
                    price: { id: "price_pro_monthly" },
                    current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                    current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
                  },
                ],
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      reconciliation: {
        last_checked_at: "2026-05-31T12:00:00.000Z",
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_subscription_lifecycle_drift_sub_pro_workspace_billing",
            workspace_id: "workspace_billing",
            drift_type: "subscription_lifecycle_drift",
            severity: "needs_review",
            actionability: "manual_review",
            related_stripe_object_id: "sub_pro_workspace_billing",
            observed: {
              event_type: "billing_reconciliation",
              subscription_status: "paused",
              billing_action: "subscription_start",
              plan: "pro",
              stripe_customer_id: "cus_workspace_billing",
            },
            expected: {
              workspace_id: "workspace_billing",
              app_owned_subscription_id: "sub_pro_workspace_billing",
              plan: "pro",
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("continues scheduled Billing reconciliation after one Workspace fails", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stripeFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: { message: "temporary Stripe failure" },
        }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createScheduledReconciliationIsolationEnv();

    await expect(worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    )).resolves.toBeUndefined();

    expect(stripeFetch).toHaveBeenCalledTimes(3);
    expect(String(stripeFetch.mock.calls[0][0])).toContain("customer=cus_reconciliation_failed");
    expect(String(stripeFetch.mock.calls[1][0])).toContain("customer=cus_reconciliation_ok");
    expect(String(stripeFetch.mock.calls[2][0])).toContain("customer=cus_reconciliation_ok");
    expect(consoleError).toHaveBeenCalledWith("Scheduled billing Workspace failed", expect.objectContaining({
      event: "billing.scheduled.workspace_failed",
      task: "billing_reconciliation",
      workspace_id: "workspace_reconciliation_failed",
      scheduled_at: "2026-06-03T12:00:00.000Z",
      error_code: "stripe_checkout_lookup_failed",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b/);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\bwhsec_[A-Za-z0-9]+\b/);
    consoleError.mockRestore();
  });

  it("records payment-required override invoice status drift for Application admin follow-up", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_payment_required_voided",
              status: "void",
              paid: false,
              customer: "cus_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_voided",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "payment_required_plan_override",
                plan: "pro",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T10:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_voided",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_voided",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      reconciliation: {
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_invoice_status_drift_in_payment_required_voided",
            workspace_id: "workspace_billing",
            drift_type: "invoice_status_drift",
            severity: "needs_review",
            actionability: "manual_review",
            related_stripe_object_id: "in_payment_required_voided",
            observed: {
              invoice_reference: "payment_required_plan_override",
              stripe_status: "void",
              stored_status: "open",
            },
            expected: {
              workspace_id: "workspace_billing",
              stored_invoice_id: "in_payment_required_voided",
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("records missing processed Stripe event drift for a safely repaired paid Checkout Session", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "cs_missing_processed_credit_pack",
              payment_status: "paid",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "credit_pack_purchase",
                plan: "free",
                credit_pack_size: "100",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      reconciliation: {
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_missing_processed_stripe_event_cs_missing_processed_credit_pack",
            workspace_id: "workspace_billing",
            drift_type: "missing_processed_stripe_event",
            severity: "warning",
            actionability: "informational",
            related_stripe_object_id: "cs_missing_processed_credit_pack",
            observed: {
              stripe_object_type: "checkout.session",
              billing_action: "credit_pack_purchase",
              payment_status: "paid",
              processed_event_status: null,
            },
            expected: {
              workspace_id: "workspace_billing",
              related_stripe_object_id: "cs_missing_processed_credit_pack",
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("records ledger current-period projection drift without mutating ledger history", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding({
        ownerBillingCurrentPeriod: {
          pages_used: 400,
          pages_remaining: 1200,
        },
      }),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    requireSessionMock.mockResolvedValue({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const stateResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      reconciliation: {
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_ledger_projection_drift_current_period_pages",
            workspace_id: "workspace_billing",
            drift_type: "ledger_projection_drift",
            severity: "needs_review",
            actionability: "manual_review",
            related_stripe_object_id: null,
            observed: {
              projection: "current_period_pages",
              monthly_page_limit: 1500,
              pages_used: 400,
              pages_remaining: 1200,
            },
            expected: {
              pages_remaining: 1100,
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("repairs a missed paid Enterprise annual upfront invoice during scheduled Billing reconciliation", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_enterprise_annual_upfront_reconciled",
              status: "paid",
              paid: true,
              customer: "cus_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_reconciled",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "enterprise_annual_upfront_invoice",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        enterprise_annual_status: "pending_payment",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 64800,
        enterprise_billing_cycle_start_date: "2026-05-31T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-05-31T10:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_reconciled",
        enterprise_annual_upfront_invoice_status: "open",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_reconciled",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "enterprise_annual",
        display_name: "Enterprise annual",
      },
      enterprise_annual_commitment: {
        status: "active",
        upfront_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_reconciled",
          paid_at: "2026-05-31T12:00:00.000Z",
        },
      },
    });
  });

  it("repairs a missed paid Enterprise annual overage invoice during scheduled Billing reconciliation", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_enterprise_annual_overage_reconciled",
              status: "paid",
              paid: true,
              customer: "cus_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_reconciled",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "enterprise_annual_overage_invoice",
                period_start: "2026-06-01T00:00:00.000Z",
                period_end: "2026-07-01T00:00:00.000Z",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        enterprise_annual_status: "suspended",
        enterprise_annual_monthly_minimum_allowance: 60000,
        enterprise_annual_per_page_price_minor: 9,
        enterprise_annual_yearly_amount_minor: 6480000,
        enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
        enterprise_annual_collection_mode: "manual",
        enterprise_annual_invoice_review_enabled: 0,
        enterprise_annual_reason: "Annual commitment",
        enterprise_annual_created_by_user_id: "user_admin",
        enterprise_annual_created_at: "2026-06-01T10:00:00.000Z",
        enterprise_annual_upfront_invoice_id: "in_enterprise_annual_upfront_paid",
        enterprise_annual_upfront_invoice_status: "paid",
        enterprise_annual_upfront_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_paid",
        enterprise_annual_upfront_invoice_paid_at: "2026-06-01T12:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_start: "2026-06-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_period_end: "2026-07-01T00:00:00.000Z",
        enterprise_annual_last_overage_invoice_id: "in_enterprise_annual_overage_reconciled",
        enterprise_annual_last_overage_invoice_status: "payment_failed",
        enterprise_annual_last_overage_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_reconciled",
        enterprise_annual_last_overage_invoiced_at: "2026-07-02T12:00:00.000Z",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "enterprise_annual",
        display_name: "Enterprise annual",
      },
      enterprise_annual_commitment: {
        status: "active",
        latest_overage_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage_reconciled",
        },
      },
    });
  });

  it("repairs a missed paid Enterprise ramp-up invoice during scheduled Billing reconciliation", async () => {
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_enterprise_ramp_up_reconciled",
              status: "paid",
              paid: true,
              customer: "cus_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_reconciled",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "enterprise_ramp_up_invoice",
                period_start: "2026-05-01T00:00:00.000Z",
                period_end: "2026-06-01T00:00:00.000Z",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        enterprise_ramp_up_status: "suspended",
        enterprise_ramp_up_duration_months: 3,
        enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_collection_mode: "manual",
        enterprise_ramp_up_invoice_review_enabled: 0,
        enterprise_ramp_up_reason: "Ramp-up",
        enterprise_ramp_up_created_by_user_id: "user_admin",
        enterprise_ramp_up_created_at: "2026-05-01T10:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_start: "2026-05-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_period_end: "2026-06-01T00:00:00.000Z",
        enterprise_ramp_up_last_invoice_id: "in_enterprise_ramp_up_reconciled",
        enterprise_ramp_up_last_invoice_status: "payment_failed",
        enterprise_ramp_up_last_invoice_hosted_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_reconciled",
        enterprise_ramp_up_last_invoiced_at: "2026-06-02T12:00:00.000Z",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "enterprise_ramp_up",
        display_name: "Enterprise ramp-up",
      },
      enterprise_ramp_up: {
        status: "active",
        latest_invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up_reconciled",
        },
      },
    });
  });

  it("repairs a missed paid payment-required Plan override invoice during scheduled Billing reconciliation", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [
            {
              id: "in_payment_required_reconciled",
              status: "paid",
              paid: true,
              customer: "cus_workspace_billing",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_reconciled",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "payment_required_plan_override",
                plan: "pro",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger: createBillingLedgerBinding(),
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T10:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_reconciled",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_reconciled",
      },
    });

    await worker.scheduled?.(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry: vi.fn() } as unknown as ScheduledController,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      payment_required_plan_override: {
        invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_reconciled",
        },
      },
    });
  });

  it("activates Pro entitlement and grants Included Credits from a signed paid subscription invoice event", async () => {
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_subscription_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_subscription_start",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_create",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_usage",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        anchor: periodStart,
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 1500,
        pages_used: 0,
        pages_remaining: 1500,
      },
      plan_limits: {
        templates: 10,
        top_level_template_fields: 15,
        table_columns_per_field: 10,
        members: 50,
        monthly_pages: 1500,
        api_access: true,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
      owner_billing_activity: [
        {
          id: "entry_stripe_invoice_in_pro_subscription_start_included",
          type: "included_credit_grant",
          occurred_at: "2026-05-31T12:00:00.000Z",
          credits: 200,
          description: "Included Credits granted",
        },
      ],
    });
  });

  it("activates a paid subscription when an active Plan override has moved the Workspace back to Free", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        plan_override_plan: "free",
        plan_override_start_at: "2026-05-31T00:00:00.000Z",
        plan_override_end_at: "2026-07-01T00:00:00.000Z",
        plan_override_reason: "Downgrade after trial",
        plan_override_created_by_user_id: "user_admin",
        plan_override_created_at: "2026-05-31T00:00:00.000Z",
      },
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_subscription_invoice_paid_after_free_override",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_subscription_start_after_free_override",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_create",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        anchor: periodStart,
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 1500,
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
  });

  it("clears a scheduled Free downgrade when Stripe reverses subscription cancellation", async () => {
    const billingLedger = createBillingLedgerBinding();
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
        scheduled_entitlement_plan: "free",
        scheduled_entitlement_effective_at: periodEnd,
      },
    });
    const event = {
      id: "evt_pro_subscription_cancellation_reversed",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_pro_workspace_billing",
          status: "active",
          customer: "cus_workspace_billing",
          cancel_at_period_end: false,
          current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
          current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "subscription_start",
            plan: "pro",
          },
          items: {
            data: [
              {
                id: "si_pro_workspace_billing",
                price: { id: "price_pro_monthly" },
                current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
  });

  it("records dashboard-created subscriptions as drift without granting paid entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_dashboard_subscription_created",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_dashboard_workspace_billing",
          status: "active",
          customer: "cus_workspace_billing",
          current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
          current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "subscription_start",
            plan: "pro",
          },
          items: {
            data: [
              {
                id: "si_dashboard_workspace_billing",
                price: { id: "price_pro_monthly" },
                current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: null,
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      reconciliation: {
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_subscription_lifecycle_drift_sub_dashboard_workspace_billing",
            workspace_id: "workspace_billing",
            drift_type: "subscription_lifecycle_drift",
            severity: "needs_review",
            actionability: "manual_review",
            related_stripe_object_id: "sub_dashboard_workspace_billing",
            observed: {
              event_type: "customer.subscription.created",
              subscription_status: "active",
              billing_action: "subscription_start",
              plan: "pro",
              stripe_customer_id: "cus_workspace_billing",
            },
            expected: {
              workspace_id: "workspace_billing",
              app_owned_subscription_id: null,
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("records Stripe-side subscription plan changes as drift without changing entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });
    const event = {
      id: "evt_dashboard_subscription_plan_changed",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_pro_workspace_billing",
          status: "active",
          customer: "cus_workspace_billing",
          current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
          current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "subscription_upgrade",
            plan: "max",
          },
          items: {
            data: [
              {
                id: "si_max_dashboard_change",
                price: { id: "price_max_monthly" },
                current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
      },
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      reconciliation: {
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_subscription_lifecycle_drift_sub_pro_workspace_billing",
            drift_type: "subscription_lifecycle_drift",
            related_stripe_object_id: "sub_pro_workspace_billing",
            observed: {
              event_type: "customer.subscription.updated",
              subscription_status: "active",
              billing_action: "subscription_upgrade",
              plan: "max",
              stripe_customer_id: "cus_workspace_billing",
            },
            expected: {
              workspace_id: "workspace_billing",
              app_owned_subscription_id: "sub_pro_workspace_billing",
              plan: "pro",
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("records failed diagnostics for subscription lifecycle events with incomplete metadata", async () => {
    const billingLedger = createBillingLedgerBinding();
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_customer_id: "cus_workspace_billing",
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });
    const event = {
      id: "evt_subscription_lifecycle_incomplete_metadata",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_pro_workspace_billing",
          status: "active",
          customer: "cus_workspace_billing",
          current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
          current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "subscription_start",
          },
          items: {
            data: [
              {
                id: "si_pro_workspace_billing",
                price: { id: "price_pro_monthly" },
                current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(400);
    await expect(webhookResponse.json()).resolves.toEqual({
      error: {
        code: "invalid_subscription_lifecycle_event",
        message: "Stripe subscription lifecycle event metadata is incomplete",
      },
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      stripe_event_diagnostics: {
        failed_event_count: 1,
        recent_events: [
          {
            event_id: "evt_subscription_lifecycle_incomplete_metadata",
            type: "customer.subscription.updated",
            outcome: "failed",
            workspace_id: "workspace_billing",
            related_stripe_object_id: "sub_pro_workspace_billing",
            failure_class: "invalid_subscription_lifecycle_event",
          },
        ],
      },
    });
  });

  it("stops paid entitlement when Stripe deletes the app-owned subscription", async () => {
    const billingLedger = createBillingLedgerBinding();
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });
    const event = {
      id: "evt_app_subscription_deleted",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_pro_workspace_billing",
          status: "canceled",
          customer: "cus_workspace_billing",
          current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
          current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "subscription_cancellation",
            plan: "pro",
          },
          items: {
            data: [
              {
                id: "si_pro_workspace_billing",
                price: { id: "price_pro_monthly" },
                current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
      owner_billing_activity: [],
    });
  });

  it("records subscription pause and resume events as manual-review drift", async () => {
    const billingLedger = createBillingLedgerBinding();
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: periodStart,
        stripe_subscription_current_period_end: periodEnd,
      },
    });

    for (const lifecycleEvent of [
      { id: "evt_app_subscription_paused", type: "customer.subscription.paused", status: "paused" },
      { id: "evt_app_subscription_resumed", type: "customer.subscription.resumed", status: "active" },
    ]) {
      const event = {
        id: lifecycleEvent.id,
        type: lifecycleEvent.type,
        data: {
          object: {
            id: "sub_pro_workspace_billing",
            status: lifecycleEvent.status,
            customer: "cus_workspace_billing",
            current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
            current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
            items: {
              data: [
                {
                  id: "si_pro_workspace_billing",
                  price: { id: "price_pro_monthly" },
                  current_period_start: Math.floor(new Date(periodStart).getTime() / 1000),
                  current_period_end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              ],
            },
          },
        },
      };
      const payload = JSON.stringify(event);

      const webhookResponse = await worker.fetch(
        new Request("https://example.com/v1/billing/stripe/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
          },
          body: payload,
        }),
        env,
      );
      expect(webhookResponse.status).toBe(200);
    }

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      reconciliation: {
        open_drift_count: 1,
        drift_records: [
          {
            id: "drift_workspace_billing_subscription_lifecycle_drift_sub_pro_workspace_billing",
            drift_type: "subscription_lifecycle_drift",
            related_stripe_object_id: "sub_pro_workspace_billing",
            observed: {
              event_type: "customer.subscription.resumed",
              subscription_status: "active",
              plan: "pro",
              stripe_customer_id: "cus_workspace_billing",
            },
            expected: {
              workspace_id: "workspace_billing",
              app_owned_subscription_id: "sub_pro_workspace_billing",
              plan: "pro",
            },
            status: "open",
          },
        ],
      },
    });
  });

  it("activates Pro entitlement and clears the scheduled change from a paid Max to Pro downgrade invoice", async () => {
    const billingLedger = createBillingLedgerBinding();
    const previousPeriodStart = "2026-05-31T12:00:00.000Z";
    const downgradePeriodStart = "2026-06-30T12:00:00.000Z";
    const downgradePeriodEnd = "2026-07-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_max_workspace_billing",
        stripe_subscription_item_id: "si_max_workspace_billing",
        self_service_subscription_plan: "max",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: previousPeriodStart,
        stripe_subscription_current_period_end: downgradePeriodStart,
        scheduled_entitlement_plan: "pro",
        scheduled_entitlement_effective_at: downgradePeriodStart,
      },
    });
    const event = {
      id: "evt_max_to_pro_downgrade_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_max_to_pro_downgrade_paid",
          status: "paid",
          paid: true,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_max_to_pro_downgrade_paid",
          customer: "cus_workspace_billing",
          subscription: "sub_max_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_downgrade",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                subscription_item: "si_pro_workspace_billing",
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(downgradePeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(downgradePeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        purchased_available: 0,
        total_available: 200,
      },
      current_period: {
        anchor: downgradePeriodStart,
        start: downgradePeriodStart,
        end: downgradePeriodEnd,
        monthly_page_limit: 1500,
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: downgradePeriodStart,
        current_period_end: downgradePeriodEnd,
        invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_max_to_pro_downgrade_paid",
        },
      },
      owner_billing_activity: [
        expect.objectContaining({
          id: "entry_stripe_invoice_in_max_to_pro_downgrade_paid_included",
          type: "included_credit_grant",
          credits: 200,
          invoice: {
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_max_to_pro_downgrade_paid",
          },
        }),
      ],
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
      },
      next_scheduled_entitlement: null,
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: downgradePeriodStart,
        current_period_end: downgradePeriodEnd,
        invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_max_to_pro_downgrade_paid",
        },
      },
    });
  });

  it("preserves Purchased Credits and avoids duplicate Included Credits for duplicate paid downgrade delivery", async () => {
    const billingLedger = createBillingLedgerBinding({ failDuplicateIncludedGrant: true });
    const previousPeriodStart = "2026-05-31T12:00:00.000Z";
    const downgradePeriodStart = "2026-06-30T12:00:00.000Z";
    const downgradePeriodEnd = "2026-07-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_max_workspace_billing",
        stripe_subscription_item_id: "si_max_workspace_billing",
        self_service_subscription_plan: "max",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: previousPeriodStart,
        stripe_subscription_current_period_end: downgradePeriodStart,
        scheduled_entitlement_plan: "pro",
        scheduled_entitlement_effective_at: downgradePeriodStart,
      },
    });
    const creditPackEvent = {
      id: "evt_credit_pack_before_downgrade",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_credit_pack_before_downgrade",
          payment_status: "paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "max",
            credit_pack_size: "100",
          },
        },
      },
    };
    const downgradeEvent = {
      id: "evt_duplicate_max_to_pro_downgrade_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_duplicate_max_to_pro_downgrade_paid",
          status: "paid",
          paid: true,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_duplicate_max_to_pro_downgrade_paid",
          customer: "cus_workspace_billing",
          subscription: "sub_max_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_downgrade",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                subscription_item: "si_pro_workspace_billing",
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(downgradePeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(downgradePeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const creditPackPayload = JSON.stringify(creditPackEvent);
    const downgradePayload = JSON.stringify(downgradeEvent);
    const downgradeSignature = await createStripeSignature(downgradePayload, "stripe-webhook-secret");

    const creditPackResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(creditPackPayload, "stripe-webhook-secret"),
        },
        body: creditPackPayload,
      }),
      env,
    );
    const firstDowngradeResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": downgradeSignature,
        },
        body: downgradePayload,
      }),
      env,
    );
    const duplicateDowngradeResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": downgradeSignature,
        },
        body: downgradePayload,
      }),
      env,
    );

    expect(creditPackResponse.status).toBe(200);
    expect(firstDowngradeResponse.status).toBe(200);
    expect(duplicateDowngradeResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
      },
      credits: {
        included_available: 200,
        purchased_available: 100,
        total_available: 300,
      },
      owner_billing_activity: expect.arrayContaining([
        expect.objectContaining({
          id: "entry_stripe_invoice_in_duplicate_max_to_pro_downgrade_paid_included",
          type: "included_credit_grant",
          credits: 200,
        }),
        expect.objectContaining({
          id: "entry_stripe_checkout_session_cs_credit_pack_before_downgrade",
          type: "purchased_credit_grant",
          credits: 100,
        }),
      ]),
    });
  });

  it("activates a payment-required Plan override and grants Included Credits from a signed paid override invoice event", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_override",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_override",
      },
    });
    const event = {
      id: "evt_payment_required_override_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_payment_required_override",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_override",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
            override_start_at: "2026-05-31T00:00:00.000Z",
            override_end_at: "2026-06-30T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        monthly_page_limit: 1500,
      },
      payment_required_plan_override: {
        plan: "pro",
        display_name: "Pro",
        invoice: {
          status: "paid",
        },
      },
      owner_billing_activity: [
        expect.objectContaining({
          type: "included_credit_grant",
          credits: 200,
        }),
      ],
    });
  });

  it("emits invalidation when Stripe event processing fails after a durable billing mutation", async () => {
    const billingLedger = createBillingLedgerBinding();
    const productStore = createProductStoreStub();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      productStore,
      stripeCustomerId: "cus_workspace_billing",
      failAdminBillingAuditInsert: true,
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_audit_failure",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_audit_failure",
      },
    });
    const event = {
      id: "evt_payment_required_audit_failure",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_payment_required_audit_failure",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_audit_failure",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(500);
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_entitlement",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });
    expect(productStore.broadcastWorkspaceContextInvalidation).toHaveBeenCalledWith({
      reason: "billing_usage",
      occurredAt: "2026-05-31T12:00:00.000Z",
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      payment_required_plan_override: {
        invoice: {
          status: "paid",
        },
      },
    });
  });

  it("acknowledges duplicate paid payment-required override invoice events without repeating activation effects", async () => {
    const billingLedger = createBillingLedgerBinding({ failDuplicateIncludedGrant: true });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_duplicate",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_duplicate",
      },
    });
    const event = {
      id: "evt_payment_required_override_duplicate",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_payment_required_duplicate",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_duplicate",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
            override_start_at: "2026-05-31T00:00:00.000Z",
            override_end_at: "2026-06-30T00:00:00.000Z",
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const signature = await createStripeSignature(payload, "stripe-webhook-secret");

    const firstResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );
    const duplicateResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const auditResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/audit-log"),
      env,
    );
    expect(auditResponse.status).toBe(200);
    await expect(auditResponse.json()).resolves.toMatchObject({
      entries: [
        {
          action: "payment_required_plan_override_payment_updated",
          after: {
            payment_required_plan_override_invoice_status: "paid",
          },
        },
      ],
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      owner_billing_activity: [
        expect.objectContaining({
          type: "included_credit_grant",
          credits: 200,
        }),
      ],
    });
  });

  it("does not duplicate audit entries for distinct paid payment-required override invoice events for the same invoice", async () => {
    const billingLedger = createBillingLedgerBinding({ failDuplicateIncludedGrant: true });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_distinct_paid",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_distinct_paid",
      },
    });
    const invoice = {
      id: "in_payment_required_distinct_paid",
      status: "paid",
      paid: true,
      customer: "cus_workspace_billing",
      hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_distinct_paid",
      metadata: {
        workspace_id: "workspace_billing",
        billing_action: "payment_required_plan_override",
        plan: "pro",
      },
    };
    const paidEventPayload = JSON.stringify({
      id: "evt_payment_required_distinct_paid",
      type: "invoice.paid",
      data: { object: invoice },
    });
    const succeededEventPayload = JSON.stringify({
      id: "evt_payment_required_distinct_succeeded",
      type: "invoice.payment_succeeded",
      data: { object: invoice },
    });

    const paidResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(paidEventPayload, "stripe-webhook-secret"),
        },
        body: paidEventPayload,
      }),
      env,
    );
    const succeededResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(succeededEventPayload, "stripe-webhook-secret"),
        },
        body: succeededEventPayload,
      }),
      env,
    );

    expect(paidResponse.status).toBe(200);
    expect(succeededResponse.status).toBe(200);

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const auditResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing/audit-log"),
      env,
    );
    expect(auditResponse.status).toBe(200);
    await expect(auditResponse.json()).resolves.toMatchObject({
      entries: [
        {
          action: "payment_required_plan_override_payment_updated",
          after: {
            payment_required_plan_override_invoice_status: "paid",
          },
        },
      ],
    });
  });

  it("records a failed payment-required override invoice without activating the entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "automatic",
        payment_required_plan_override_invoice_id: "in_payment_required_failed",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_failed",
      },
    });
    const event = {
      id: "evt_payment_required_override_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_payment_required_failed",
          status: "open",
          paid: false,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_failed",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        invoice: {
          status: "payment_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_failed",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records an action-required payment-required override invoice without activating the entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "automatic",
        payment_required_plan_override_invoice_id: "in_payment_required_action_required",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_action_required",
      },
    });
    const event = {
      id: "evt_payment_required_override_action_required",
      type: "invoice.payment_action_required",
      data: {
        object: {
          id: "in_payment_required_action_required",
          status: "open",
          paid: false,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_action_required_next",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        invoice: {
          status: "payment_action_required",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_action_required_next",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records a finalization-failed payment-required override invoice without activating the entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "automatic",
        payment_required_plan_override_invoice_id: "in_payment_required_finalization_failed",
        payment_required_plan_override_invoice_status: "draft",
        payment_required_plan_override_hosted_invoice_url: null,
      },
    });
    const event = {
      id: "evt_payment_required_override_finalization_failed",
      type: "invoice.finalization_failed",
      data: {
        object: {
          id: "in_payment_required_finalization_failed",
          status: "draft",
          paid: false,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_finalization_failed",
          automatic_tax: {
            status: "requires_location_inputs",
            reason: "customer_location_missing",
          },
          last_finalization_error: {
            code: "customer_tax_location_invalid",
          },
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        invoice: {
          status: "finalization_failed",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_finalization_failed",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records a voided payment-required override invoice without activating the entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_voided_event",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_voided_event",
      },
    });
    const event = {
      id: "evt_payment_required_override_voided",
      type: "invoice.voided",
      data: {
        object: {
          id: "in_payment_required_voided_event",
          status: "void",
          paid: false,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_voided_event",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        invoice: {
          status: "void",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_voided_event",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("records an uncollectible payment-required override invoice without activating the entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_uncollectible_event",
        payment_required_plan_override_invoice_status: "open",
        payment_required_plan_override_hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_uncollectible_event",
      },
    });
    const event = {
      id: "evt_payment_required_override_uncollectible",
      type: "invoice.marked_uncollectible",
      data: {
        object: {
          id: "in_payment_required_uncollectible_event",
          status: "uncollectible",
          paid: false,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_uncollectible_event",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        invoice: {
          status: "uncollectible",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_uncollectible_event",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("retains a finalized payment-required override invoice URL without activating the entitlement", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        payment_required_plan_override_plan: "pro",
        payment_required_plan_override_start_at: "2026-05-31T00:00:00.000Z",
        payment_required_plan_override_end_at: "2026-06-30T00:00:00.000Z",
        payment_required_plan_override_reason: "Paid onboarding extension",
        payment_required_plan_override_created_by_user_id: "user_admin",
        payment_required_plan_override_created_at: "2026-05-31T12:00:00.000Z",
        payment_required_plan_override_amount_minor: 12500,
        payment_required_plan_override_currency: "GBP",
        payment_required_plan_override_collection_mode: "manual",
        payment_required_plan_override_invoice_id: "in_payment_required_finalized",
        payment_required_plan_override_invoice_status: "draft",
        payment_required_plan_override_hosted_invoice_url: null,
      },
    });
    const event = {
      id: "evt_payment_required_override_finalized",
      type: "invoice.finalized",
      data: {
        object: {
          id: "in_payment_required_finalized",
          status: "open",
          paid: false,
          customer: "cus_workspace_billing",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_finalized",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "payment_required_plan_override",
            plan: "pro",
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
        display_name: "Free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      payment_required_plan_override: {
        plan: "pro",
        invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_finalized",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("stores the Stripe subscription item from a paid subscription invoice so the owner can later upgrade", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_subscription_item_stored",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_subscription_item_stored",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_create",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                subscription_item: "si_pro_workspace_billing",
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "sub_pro_workspace_billing",
        latest_invoice: {
          hosted_invoice_url: "https://invoice.stripe.com/i/in_prorated_max_upgrade",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const changeResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/subscriptions/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "max" }),
      }),
      env,
    );

    expect(changeResponse.status).toBe(200);
    const [, stripeRequest] = stripeFetch.mock.calls[0] as [string, RequestInit];
    const stripeBody = new URLSearchParams(String(stripeRequest.body));
    expect(stripeBody.get("items[0][id]")).toBe("si_pro_workspace_billing");
    expect(stripeBody.get("items[0][price]")).toBe("price_max_monthly");
  });

  it("rejects a paid subscription invoice when the paid line does not match the configured plan Price", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_subscription_wrong_price",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_subscription_wrong_price",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_max_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(400);
    await expect(webhookResponse.json()).resolves.toEqual({
      error: {
        code: "invalid_subscription_invoice_event",
        message: "Stripe subscription invoice event metadata is incomplete",
      },
    });

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "free",
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: null,
    });
  });

  it("records non-secret diagnostics when a relevant Stripe billing event fails processing", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_subscription_wrong_price_diagnostic",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_subscription_wrong_price_diagnostic",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_max_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(400);
    await expect(webhookResponse.json()).resolves.toEqual({
      error: {
        code: "invalid_subscription_invoice_event",
        message: "Stripe subscription invoice event metadata is incomplete",
      },
    });

    requireSessionMock.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@example.com",
      name: "Application Admin",
      role: "admin",
    });
    const adminResponse = await worker.fetch(
      new Request("https://example.com/v1/admin/billing/workspaces/workspace_billing"),
      env,
    );

    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({
      stripe_event_diagnostics: {
        ignored_event_count: 0,
        failed_event_count: 1,
        recent_events: [
          {
            event_id: "evt_subscription_wrong_price_diagnostic",
            type: "invoice.paid",
            outcome: "failed",
            workspace_id: "workspace_billing",
            related_stripe_object_id: "in_subscription_wrong_price_diagnostic",
            failure_class: "invalid_subscription_invoice_event",
            retry_guidance: "Stripe can retry this event after the metadata, catalog, or Workspace billing state is repaired.",
            manual_review_guidance: "Review the Stripe object and reconcile Workspace billing manually if automatic replay cannot succeed.",
          },
        ],
      },
    });
  });

  it("activates Max entitlement and grants Included Credits from a signed paid subscription invoice event", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_max_subscription_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_max_subscription_start",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_max_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "max",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_max_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "max",
        display_name: "Max",
        included_credits: 1000,
        api_access: true,
      },
      credits: {
        included_available: 1000,
        total_available: 1000,
      },
      current_period: {
        anchor: periodStart,
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 5000,
        pages_remaining: 5000,
      },
      self_service_subscription: {
        plan: "max",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
  });

  it("activates Pro entitlement from the current Stripe paid subscription invoice payload shape", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_subscription_invoice_payment_succeeded_parent_shape",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_pro_subscription_parent_shape",
          status: "paid",
          customer: "cus_workspace_billing",
          parent: {
            type: "subscription_details",
            subscription_details: {
              subscription: "sub_pro_workspace_billing",
              metadata: {
                workspace_id: "workspace_billing",
                billing_action: "subscription_start",
                plan: "pro",
              },
            },
          },
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_monthly",
                    product: "prod_pro",
                  },
                  type: "price_details",
                  unit_amount_decimal: "5000",
                },
                parent: {
                  subscription_item_details: {
                    subscription_item: "si_pro_workspace_billing",
                  },
                },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        anchor: periodStart,
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 1500,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
  });

  it("activates Max from a paid Pro to Max upgrade invoice and grants only additional Included Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const proEvent = {
      id: "evt_pro_subscription_before_upgrade",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_subscription_before_upgrade",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const upgradeEvent = {
      id: "evt_pro_to_max_upgrade_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_to_max_upgrade_paid",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_upgrade",
              plan: "max",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_max_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const proPayload = JSON.stringify(proEvent);
    const upgradePayload = JSON.stringify(upgradeEvent);

    const proResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(proPayload, "stripe-webhook-secret"),
        },
        body: proPayload,
      }),
      env,
    );
    const upgradeResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(upgradePayload, "stripe-webhook-secret"),
        },
        body: upgradePayload,
      }),
      env,
    );

    expect(proResponse.status).toBe(200);
    expect(upgradeResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      active_entitlement: {
        plan: "max",
        display_name: "Max",
        included_credits: 1000,
        api_access: true,
      },
      credits: {
        included_available: 1000,
        total_available: 1000,
      },
      current_period: {
        start: periodStart,
        end: periodEnd,
        monthly_page_limit: 5000,
      },
      self_service_subscription: {
        plan: "max",
        status: "active",
      },
      owner_billing_activity: [
        expect.objectContaining({
          id: "entry_stripe_invoice_in_pro_subscription_before_upgrade_included",
          type: "included_credit_grant",
          credits: 200,
        }),
        expect.objectContaining({
          id: "entry_stripe_invoice_in_pro_to_max_upgrade_paid_included",
          type: "included_credit_grant",
          credits: 800,
        }),
      ],
    });
  });

  it("moves a paid Workspace into Unpaid billing state from a failed renewal invoice without granting Included Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
      },
    });
    const failedPeriodStart = "2026-06-30T12:00:00.000Z";
    const failedPeriodEnd = "2026-07-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_renewal_payment_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_pro_renewal_payment_failed",
          status: "open",
          paid: false,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_payment_failed",
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_renewal",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(failedPeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(failedPeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
        display_name: "Free",
        included_credits: 0,
        api_access: false,
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      current_period: {
        anchor: failedPeriodStart,
        start: failedPeriodStart,
        end: failedPeriodEnd,
        monthly_page_limit: 500,
      },
      plan_limits: {
        templates: 3,
        members: 3,
        monthly_pages: 500,
        api_access: false,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: failedPeriodStart,
        current_period_end: failedPeriodEnd,
        invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_payment_failed",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("keeps a subscription invoice requiring payment action unpaid without granting Included Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
      },
    });
    const actionRequiredPeriodStart = "2026-06-30T12:00:00.000Z";
    const actionRequiredPeriodEnd = "2026-07-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_renewal_payment_action_required",
      type: "invoice.payment_action_required",
      data: {
        object: {
          id: "in_pro_renewal_payment_action_required",
          status: "open",
          paid: false,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_payment_action_required",
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_renewal",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(actionRequiredPeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(actionRequiredPeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      active_entitlement: {
        plan: "free",
        display_name: "Free",
        included_credits: 0,
        api_access: false,
      },
      credits: {
        included_available: 0,
        total_available: 0,
      },
      current_period: {
        anchor: actionRequiredPeriodStart,
        start: actionRequiredPeriodStart,
        end: actionRequiredPeriodEnd,
        monthly_page_limit: 500,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: actionRequiredPeriodStart,
        current_period_end: actionRequiredPeriodEnd,
        invoice: {
          status: "payment_action_required",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_payment_action_required",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("persists subscription invoice finalization failure diagnostics without granting Included Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
      },
    });
    const failedPeriodStart = "2026-06-30T12:00:00.000Z";
    const failedPeriodEnd = "2026-07-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_renewal_finalization_failed",
      type: "invoice.finalization_failed",
      data: {
        object: {
          id: "in_pro_renewal_finalization_failed",
          status: "draft",
          paid: false,
          hosted_invoice_url: null,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_cycle",
          automatic_tax: {
            status: "requires_location_inputs",
            reason: "customer_location_missing",
          },
          last_finalization_error: {
            code: "customer_tax_location_invalid",
            type: "invalid_request_error",
            message: "Do not store this Stripe error message in Workspace billing state.",
          },
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_renewal",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(failedPeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(failedPeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: failedPeriodStart,
        current_period_end: failedPeriodEnd,
        invoice: {
          status: "finalization_failed",
          hosted_invoice_url: null,
          finalization_failure: {
            automatic_tax_status: "requires_location_inputs",
            automatic_tax_reason: "customer_location_missing",
            last_finalization_error_code: "customer_tax_location_invalid",
          },
        },
      },
      owner_billing_activity: [],
    });
  });

  it("keeps a voided subscription invoice as terminal unpaid without granting Included Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
      },
    });
    const voidedPeriodStart = "2026-06-30T12:00:00.000Z";
    const voidedPeriodEnd = "2026-07-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_renewal_voided",
      type: "invoice.voided",
      data: {
        object: {
          id: "in_pro_renewal_voided",
          status: "void",
          paid: false,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_voided",
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_renewal",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(voidedPeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(voidedPeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: voidedPeriodStart,
        current_period_end: voidedPeriodEnd,
        invoice: {
          status: "void",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_voided",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("keeps a marked-uncollectible subscription invoice as terminal unpaid without granting Included Credits", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
        stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
      },
    });
    const uncollectiblePeriodStart = "2026-06-30T12:00:00.000Z";
    const uncollectiblePeriodEnd = "2026-07-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_renewal_marked_uncollectible",
      type: "invoice.marked_uncollectible",
      data: {
        object: {
          id: "in_pro_renewal_marked_uncollectible",
          status: "uncollectible",
          paid: false,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_marked_uncollectible",
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_renewal",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(uncollectiblePeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(uncollectiblePeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      credits: {
        included_available: 0,
        total_available: 0,
      },
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        current_period_start: uncollectiblePeriodStart,
        current_period_end: uncollectiblePeriodEnd,
        invoice: {
          status: "uncollectible",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_marked_uncollectible",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("shows a manual subscription invoice as payable when Stripe finalizes it", async () => {
    const billingLedger = createBillingLedgerBinding();
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const manualPeriodStart = "2026-06-30T12:00:00.000Z";
    const manualPeriodEnd = "2026-07-30T12:00:00.000Z";
    const event = {
      id: "evt_manual_pro_invoice_finalized",
      type: "invoice.finalized",
      data: {
        object: {
          id: "in_manual_pro_subscription",
          status: "open",
          paid: false,
          collection_method: "send_invoice",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_manual_pro_subscription",
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_create",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(manualPeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(manualPeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "unpaid",
      self_service_subscription: {
        plan: "pro",
        status: "unpaid",
        invoice: {
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_manual_pro_subscription",
        },
      },
      owner_billing_activity: [],
    });
  });

  it("restores paid entitlement and grants Included Credits when an unpaid renewal invoice is later paid", async () => {
    const billingLedger = createBillingLedgerBinding();
    const paidPeriodStart = "2026-06-30T12:00:00.000Z";
    const paidPeriodEnd = "2026-07-30T12:00:00.000Z";
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
      billingControl: {
        stripe_subscription_id: "sub_pro_workspace_billing",
        stripe_subscription_item_id: "si_pro_workspace_billing",
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "unpaid",
        stripe_subscription_current_period_start: paidPeriodStart,
        stripe_subscription_current_period_end: paidPeriodEnd,
      },
    });
    const event = {
      id: "evt_pro_renewal_recovered",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_renewal_recovered",
          status: "paid",
          paid: true,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_recovered",
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          billing_reason: "subscription_cycle",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_renewal",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(paidPeriodStart).getTime() / 1000),
                  end: Math.floor(new Date(paidPeriodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    const webhookResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": await createStripeSignature(payload, "stripe-webhook-secret"),
        },
        body: payload,
      }),
      env,
    );

    expect(webhookResponse.status).toBe(200);

    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );

    await expect(summaryResponse.json()).resolves.toMatchObject({
      billing_state: "active",
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
      },
      credits: {
        included_available: 200,
        total_available: 200,
      },
      current_period: {
        start: paidPeriodStart,
        end: paidPeriodEnd,
        monthly_page_limit: 1500,
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
        invoice: {
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_recovered",
        },
      },
      owner_billing_activity: [
        expect.objectContaining({
          id: "entry_stripe_invoice_in_pro_renewal_recovered_included",
          type: "included_credit_grant",
          credits: 200,
          invoice: {
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_pro_renewal_recovered",
          },
        }),
      ],
    });
  });

  it("acknowledges duplicate paid subscription invoice events without granting Included Credits twice", async () => {
    const billingLedger = createBillingLedgerBinding({ failDuplicateIncludedGrant: true });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const periodStart = "2026-05-31T12:00:00.000Z";
    const periodEnd = "2026-06-30T12:00:00.000Z";
    const event = {
      id: "evt_pro_subscription_duplicate",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_pro_subscription_duplicate",
          status: "paid",
          paid: true,
          customer: "cus_workspace_billing",
          subscription: "sub_pro_workspace_billing",
          subscription_details: {
            metadata: {
              workspace_id: "workspace_billing",
              billing_action: "subscription_start",
              plan: "pro",
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_monthly" },
                period: {
                  start: Math.floor(new Date(periodStart).getTime() / 1000),
                  end: Math.floor(new Date(periodEnd).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const signature = await createStripeSignature(payload, "stripe-webhook-secret");

    const firstResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );
    const duplicateResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        included_available: 200,
        total_available: 200,
      },
    });
  });

  it("acknowledges duplicate Stripe billing events without granting Credits twice", async () => {
    const billingLedger = createBillingLedgerBinding({ failDuplicatePurchasedGrant: true });
    const env = createBillingEnv({
      workspace: createWorkspace(),
      membershipRole: "owner",
      billingLedger,
      stripeCustomerId: "cus_workspace_billing",
    });
    const event = {
      id: "evt_credit_pack_duplicate",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_credit_pack_duplicate",
          payment_status: "paid",
          metadata: {
            workspace_id: "workspace_billing",
            billing_action: "credit_pack_purchase",
            plan: "free",
            credit_pack_size: "100",
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const signature = await createStripeSignature(payload, "stripe-webhook-secret");

    const firstResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );
    const duplicateResponse = await worker.fetch(
      new Request("https://example.com/v1/billing/stripe/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      }),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    const summaryResponse = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_billing/billing/summary"),
      env,
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      credits: {
        purchased_available: 100,
        total_available: 100,
      },
    });
  });
});

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace_billing",
    api_key_hash: "hash_billing",
    name: "Billing Workspace",
    created_at: "2026-05-04T00:00:00.000Z",
    created_by_user_id: "user_owner",
    rate_limit_per_minute: null,
    max_templates: null,
    max_fields_per_template: null,
    max_source_file_bytes: null,
    ...overrides,
  };
}

type BillingControlState = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  self_service_subscription_plan: "pro" | "max" | null;
  self_service_subscription_status: string | null;
  stripe_subscription_current_period_start: string | null;
  stripe_subscription_current_period_end: string | null;
  self_service_subscription_invoice_id: string | null;
  self_service_subscription_invoice_status: string | null;
  self_service_subscription_hosted_invoice_url: string | null;
  self_service_subscription_invoice_diagnostics: string | null;
  scheduled_entitlement_plan: "free" | "pro" | "max" | null;
  scheduled_entitlement_effective_at: string | null;
  plan_override_plan: "free" | "pro" | "max" | null;
  plan_override_start_at: string | null;
  plan_override_end_at: string | null;
  plan_override_reason: string | null;
  plan_override_created_by_user_id: string | null;
  plan_override_created_at: string | null;
  payment_required_plan_override_plan: "free" | "pro" | "max" | null;
  payment_required_plan_override_start_at: string | null;
  payment_required_plan_override_end_at: string | null;
  payment_required_plan_override_reason: string | null;
  payment_required_plan_override_created_by_user_id: string | null;
  payment_required_plan_override_created_at: string | null;
  payment_required_plan_override_amount_minor: number | null;
  payment_required_plan_override_currency: "GBP" | null;
  payment_required_plan_override_collection_mode: "automatic" | "manual" | null;
  payment_required_plan_override_invoice_id: string | null;
  payment_required_plan_override_invoice_status: string | null;
  payment_required_plan_override_hosted_invoice_url: string | null;
  payment_required_plan_override_paid_at: string | null;
  enterprise_ramp_up_status: string | null;
  enterprise_ramp_up_duration_months: number | null;
  enterprise_billing_cycle_start_date: string | null;
  enterprise_ramp_up_collection_mode: "automatic" | "manual" | null;
  enterprise_ramp_up_invoice_review_enabled: number;
  enterprise_ramp_up_reason: string | null;
  enterprise_ramp_up_created_by_user_id: string | null;
  enterprise_ramp_up_created_at: string | null;
  enterprise_ramp_up_last_invoice_period_start: string | null;
  enterprise_ramp_up_last_invoice_period_end: string | null;
  enterprise_ramp_up_last_invoice_id: string | null;
  enterprise_ramp_up_last_invoice_status: string | null;
  enterprise_ramp_up_last_invoice_hosted_url: string | null;
  enterprise_ramp_up_last_invoiced_at: string | null;
  enterprise_annual_status: string | null;
  enterprise_annual_monthly_minimum_allowance: number | null;
  enterprise_annual_per_page_price_minor: number | null;
  enterprise_annual_yearly_amount_minor: number | null;
  enterprise_annual_collection_mode: "automatic" | "manual" | null;
  enterprise_annual_invoice_review_enabled: number;
  enterprise_annual_reason: string | null;
  enterprise_annual_created_by_user_id: string | null;
  enterprise_annual_created_at: string | null;
  enterprise_annual_upfront_invoice_id: string | null;
  enterprise_annual_upfront_invoice_status: string | null;
  enterprise_annual_upfront_invoice_hosted_url: string | null;
  enterprise_annual_upfront_invoice_paid_at: string | null;
  enterprise_annual_last_overage_invoice_period_start: string | null;
  enterprise_annual_last_overage_invoice_period_end: string | null;
  enterprise_annual_last_overage_invoice_id: string | null;
  enterprise_annual_last_overage_invoice_status: string | null;
  enterprise_annual_last_overage_invoice_hosted_url: string | null;
  enterprise_annual_last_overage_invoiced_at: string | null;
  no_billing_enabled: number;
  no_billing_reason: string | null;
  no_billing_updated_by_user_id: string | null;
  no_billing_updated_at: string | null;
};

function createBillingEnv(input: {
  workspace: Workspace | null;
  membershipRole: "owner" | "admin" | "member" | null;
  billingLedger?: unknown;
  productStore?: ProductStoreStub;
  stripeCustomerId?: string | null;
  billingControl?: Partial<BillingControlState>;
  stripeWebhookSecretNext?: string | null;
  failAdminBillingAuditInsert?: boolean;
}): Env {
  const env = {
    DB: createBillingDb(input),
    WORKSPACE_BILLING_LEDGER: input.billingLedger,
    WORKSPACE_PRODUCT_STORE: createProductStoreBinding(input.productStore || createProductStoreStub()),
    STRIPE_API_KEY: "stripe-secret-test-key",
    STRIPE_WEBHOOK_SECRET: "stripe-webhook-secret",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro_monthly",
    STRIPE_MAX_MONTHLY_PRICE_ID: "price_max_monthly",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com,http://localhost:5173,http://127.0.0.1:5173",
  };
  if (input.stripeWebhookSecretNext) {
    return {
      ...env,
      STRIPE_WEBHOOK_SECRET_NEXT: input.stripeWebhookSecretNext,
    } as unknown as Env;
  }
  return env as unknown as Env;
}

type ProductStoreStub = {
  broadcastWorkspaceContextInvalidation: ReturnType<typeof vi.fn>;
};

function createProductStoreStub(): ProductStoreStub {
  return {
    broadcastWorkspaceContextInvalidation: vi.fn(),
  };
}

function createProductStoreBinding(productStore: ProductStoreStub): Env["WORKSPACE_PRODUCT_STORE"] {
  return {
    getByName: vi.fn(() => productStore),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}

function createScheduledRampUpIsolationEnv(): Env {
  const rampUpCandidates = [
    {
      workspace_id: "workspace_failed",
      workspace_name: "Failed Workspace",
      stripe_customer_id: "cus_enterprise_failed",
      enterprise_ramp_up_duration_months: 3,
      enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
      enterprise_ramp_up_collection_mode: "manual",
      enterprise_ramp_up_invoice_review_enabled: 0,
      enterprise_ramp_up_last_invoice_period_end: null,
    },
    {
      workspace_id: "workspace_ok",
      workspace_name: "OK Workspace",
      stripe_customer_id: "cus_enterprise_ok",
      enterprise_ramp_up_duration_months: 3,
      enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
      enterprise_ramp_up_collection_mode: "manual",
      enterprise_ramp_up_invoice_review_enabled: 0,
      enterprise_ramp_up_last_invoice_period_end: null,
    },
  ];

  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            async all() {
              if (sql.includes("enterprise_ramp_up_status = 'active'")) {
                return { success: true, results: rampUpCandidates };
              }
              if (sql.includes("enterprise_annual_status = 'active'")) {
                return { success: true, results: [] };
              }
              if (sql.includes("WHERE c.stripe_customer_id IS NOT NULL")) {
                return { success: true, results: [] };
              }
              throw new Error(`Unhandled scheduled ramp-up SQL all in billing test: ${sql}`);
            },
            async run() {
              if (sql.includes("UPDATE workspace_billing_controls")) {
                return { success: true };
              }
              throw new Error(`Unhandled scheduled ramp-up SQL run in billing test: ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const ledger = {
    getByName(workspaceId: string) {
      return {
        async summarizeEnterpriseUsageCharges() {
          if (workspaceId === "workspace_failed") {
            throw new Error("Enterprise usage summary failed");
          }
          if (workspaceId !== "workspace_ok") {
            throw new Error(`Unexpected billing ledger name: ${workspaceId}`);
          }
          return {
            billable_document_pages: 120,
            amount: {
              currency: "GBP",
              amount_minor: 1680,
              display: "GBP 16.80",
              tax_behavior: "exclusive",
            },
          };
        },
      };
    },
  };

  return {
    DB: db,
    WORKSPACE_BILLING_LEDGER: ledger,
    STRIPE_API_KEY: "stripe-secret-test-key",
    STRIPE_WEBHOOK_SECRET: "stripe-webhook-secret",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro_monthly",
    STRIPE_MAX_MONTHLY_PRICE_ID: "price_max_monthly",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com,http://localhost:5173,http://127.0.0.1:5173",
  } as unknown as Env;
}

function createScheduledAnnualOverageIsolationEnv(): Env {
  const annualCandidates = [
    {
      workspace_id: "workspace_annual_failed",
      workspace_name: "Failed Annual Workspace",
      stripe_customer_id: "cus_enterprise_annual_failed",
      enterprise_annual_monthly_minimum_allowance: 60000,
      enterprise_annual_per_page_price_minor: 9,
      enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
      enterprise_annual_collection_mode: "manual",
      enterprise_annual_invoice_review_enabled: 0,
      enterprise_annual_last_overage_invoice_period_end: null,
    },
    {
      workspace_id: "workspace_annual_ok",
      workspace_name: "OK Annual Workspace",
      stripe_customer_id: "cus_enterprise_annual_ok",
      enterprise_annual_monthly_minimum_allowance: 60000,
      enterprise_annual_per_page_price_minor: 9,
      enterprise_billing_cycle_start_date: "2026-06-01T00:00:00.000Z",
      enterprise_annual_collection_mode: "manual",
      enterprise_annual_invoice_review_enabled: 0,
      enterprise_annual_last_overage_invoice_period_end: null,
    },
  ];

  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            async all() {
              if (sql.includes("enterprise_ramp_up_status = 'active'")) {
                return { success: true, results: [] };
              }
              if (sql.includes("enterprise_annual_status = 'active'")) {
                return { success: true, results: annualCandidates };
              }
              if (sql.includes("WHERE c.stripe_customer_id IS NOT NULL")) {
                return { success: true, results: [] };
              }
              throw new Error(`Unhandled scheduled annual overage SQL all in billing test: ${sql}`);
            },
            async run() {
              if (sql.includes("UPDATE workspace_billing_controls")) {
                return { success: true };
              }
              throw new Error(`Unhandled scheduled annual overage SQL run in billing test: ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const ledger = {
    getByName(workspaceId: string) {
      return {
        async summarizeEnterpriseUsageCharges() {
          if (workspaceId === "workspace_annual_failed") {
            throw new Error("Enterprise usage summary failed");
          }
          if (workspaceId !== "workspace_annual_ok") {
            throw new Error(`Unexpected billing ledger name: ${workspaceId}`);
          }
          return {
            billable_document_pages: 60005,
            amount: {
              currency: "GBP",
              amount_minor: 840070,
              display: "GBP 8400.70",
              tax_behavior: "exclusive",
            },
          };
        },
      };
    },
  };

  return {
    DB: db,
    WORKSPACE_BILLING_LEDGER: ledger,
    STRIPE_API_KEY: "stripe-secret-test-key",
    STRIPE_WEBHOOK_SECRET: "stripe-webhook-secret",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro_monthly",
    STRIPE_MAX_MONTHLY_PRICE_ID: "price_max_monthly",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com,http://localhost:5173,http://127.0.0.1:5173",
  } as unknown as Env;
}

function createScheduledReconciliationIsolationEnv(): Env {
  const reconciliationCandidates = [
    {
      workspace_id: "workspace_reconciliation_failed",
      workspace_name: "Failed Reconciliation Workspace",
      stripe_customer_id: "cus_reconciliation_failed",
    },
    {
      workspace_id: "workspace_reconciliation_ok",
      workspace_name: "OK Reconciliation Workspace",
      stripe_customer_id: "cus_reconciliation_ok",
    },
  ];

  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM workspace_billing_controls")) {
                const [workspaceId] = params;
                const candidate = reconciliationCandidates.find((item) => item.workspace_id === workspaceId);
                return candidate
                  ? {
                    workspace_id: candidate.workspace_id,
                    ledger_object_name: candidate.workspace_id,
                    stripe_customer_id: candidate.stripe_customer_id,
                  }
                  : null;
              }
              if (sql.includes("FROM workspaces") && sql.includes("WHERE id = ?")) {
                return null;
              }
              if (sql.includes("FROM workspace_billing_reconciliation_status")) {
                return null;
              }
              throw new Error(`Unhandled scheduled reconciliation SQL first in billing test: ${sql}`);
            },
            async all() {
              if (sql.includes("enterprise_ramp_up_status = 'active'")) {
                return { success: true, results: [] };
              }
              if (sql.includes("enterprise_annual_status = 'active'")) {
                return { success: true, results: [] };
              }
              if (sql.includes("WHERE c.stripe_customer_id IS NOT NULL")) {
                return { success: true, results: reconciliationCandidates };
              }
              throw new Error(`Unhandled scheduled reconciliation SQL all in billing test: ${sql}`);
            },
            async run() {
              if (sql.includes("INSERT INTO workspace_billing_reconciliation_status")) {
                return { success: true };
              }
              throw new Error(`Unhandled scheduled reconciliation SQL run in billing test: ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    DB: db,
    WORKSPACE_BILLING_LEDGER: createBillingLedgerBinding(),
    STRIPE_API_KEY: "stripe-secret-test-key",
    STRIPE_WEBHOOK_SECRET: "stripe-webhook-secret",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro_monthly",
    STRIPE_MAX_MONTHLY_PRICE_ID: "price_max_monthly",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com,http://localhost:5173,http://127.0.0.1:5173",
  } as unknown as Env;
}

function createBillingDb(input: {
  workspace: Workspace | null;
  membershipRole: "owner" | "admin" | "member" | null;
  stripeCustomerId?: string | null;
  billingControl?: Partial<BillingControlState>;
  failAdminBillingAuditInsert?: boolean;
}): D1Database {
  const billingControl: BillingControlState = {
    stripe_customer_id: input.stripeCustomerId || null,
    stripe_subscription_id: null,
    stripe_subscription_item_id: null,
    self_service_subscription_plan: null,
    self_service_subscription_status: null,
    stripe_subscription_current_period_start: null,
    stripe_subscription_current_period_end: null,
    self_service_subscription_invoice_id: null,
    self_service_subscription_invoice_status: null,
    self_service_subscription_hosted_invoice_url: null,
    self_service_subscription_invoice_diagnostics: null,
    scheduled_entitlement_plan: null,
    scheduled_entitlement_effective_at: null,
    plan_override_plan: null,
    plan_override_start_at: null,
    plan_override_end_at: null,
    plan_override_reason: null,
    plan_override_created_by_user_id: null,
    plan_override_created_at: null,
    payment_required_plan_override_plan: null,
    payment_required_plan_override_start_at: null,
    payment_required_plan_override_end_at: null,
    payment_required_plan_override_reason: null,
    payment_required_plan_override_created_by_user_id: null,
    payment_required_plan_override_created_at: null,
    payment_required_plan_override_amount_minor: null,
    payment_required_plan_override_currency: null,
    payment_required_plan_override_collection_mode: null,
    payment_required_plan_override_invoice_id: null,
    payment_required_plan_override_invoice_status: null,
    payment_required_plan_override_hosted_invoice_url: null,
    payment_required_plan_override_paid_at: null,
    enterprise_ramp_up_status: null,
    enterprise_ramp_up_duration_months: null,
    enterprise_billing_cycle_start_date: null,
    enterprise_ramp_up_collection_mode: null,
    enterprise_ramp_up_invoice_review_enabled: 0,
    enterprise_ramp_up_reason: null,
    enterprise_ramp_up_created_by_user_id: null,
    enterprise_ramp_up_created_at: null,
    enterprise_ramp_up_last_invoice_period_start: null,
    enterprise_ramp_up_last_invoice_period_end: null,
    enterprise_ramp_up_last_invoice_id: null,
    enterprise_ramp_up_last_invoice_status: null,
    enterprise_ramp_up_last_invoice_hosted_url: null,
    enterprise_ramp_up_last_invoiced_at: null,
    enterprise_annual_status: null,
    enterprise_annual_monthly_minimum_allowance: null,
    enterprise_annual_per_page_price_minor: null,
    enterprise_annual_yearly_amount_minor: null,
    enterprise_annual_collection_mode: null,
    enterprise_annual_invoice_review_enabled: 0,
    enterprise_annual_reason: null,
    enterprise_annual_created_by_user_id: null,
    enterprise_annual_created_at: null,
    enterprise_annual_upfront_invoice_id: null,
    enterprise_annual_upfront_invoice_status: null,
    enterprise_annual_upfront_invoice_hosted_url: null,
    enterprise_annual_upfront_invoice_paid_at: null,
    enterprise_annual_last_overage_invoice_period_start: null,
    enterprise_annual_last_overage_invoice_period_end: null,
    enterprise_annual_last_overage_invoice_id: null,
    enterprise_annual_last_overage_invoice_status: null,
    enterprise_annual_last_overage_invoice_hosted_url: null,
    enterprise_annual_last_overage_invoiced_at: null,
    no_billing_enabled: 0,
    no_billing_reason: null,
    no_billing_updated_by_user_id: null,
    no_billing_updated_at: null,
    ...input.billingControl,
  };
  const auditEntries: Array<{
    id: string;
    workspace_id: string;
    action: string;
    actor_user_id: string;
    reason: string;
    before_json: string;
    after_json: string;
    occurred_at: string;
  }> = [];
  const stripeEvents: Array<{
    event_id: string;
    type: string;
    received_at: string;
    processed_status: string;
    workspace_id: string | null;
    related_stripe_object_id: string | null;
    error_details: string | null;
  }> = [];
  let reconciliationLastCheckedAt: string | null = null;
  const reconciliationDriftRecords: Array<{
    id: string;
    workspace_id: string;
    drift_type: string;
    severity: string;
    actionability: string;
    related_stripe_object_id: string | null;
    observed_json: string;
    expected_json: string;
    first_seen_at: string;
    last_seen_at: string;
    status: string;
  }> = [];

  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (
                sql.includes("FROM workspaces") &&
                sql.includes("JOIN workspace_memberships")
              ) {
                const [workspaceId, userId] = params;
                if (
                  input.workspace?.id === workspaceId &&
                  userId === "user_owner" &&
                  input.membershipRole
                ) {
                  return {
                    ...input.workspace,
                    role: input.membershipRole,
                  };
                }
                return null;
              }
              if (sql.includes("FROM workspaces") && sql.includes("WHERE id = ?")) {
                const [workspaceId] = params;
                return input.workspace?.id === workspaceId ? input.workspace : null;
              }
              if (sql.includes("FROM workspace_memberships m") && sql.includes("JOIN user u")) {
                const [workspaceId] = params;
                return input.workspace?.id === workspaceId ? { email: "owner@example.com" } : null;
              }
              if (sql.includes("FROM workspace_billing_controls")) {
                return billingControl.stripe_customer_id ||
                  billingControl.stripe_subscription_id ||
                  billingControl.self_service_subscription_plan ||
                  billingControl.self_service_subscription_invoice_id ||
                  billingControl.plan_override_plan ||
                  billingControl.payment_required_plan_override_plan ||
                  billingControl.enterprise_ramp_up_status ||
                  billingControl.enterprise_annual_status ||
                  billingControl.no_billing_enabled
                  ? {
                      workspace_id: input.workspace?.id || "workspace_billing",
                      ledger_object_name: input.workspace?.id || "workspace_billing",
                      ...billingControl,
                    }
                  : null;
              }
              if (sql.includes("FROM workspace_billing_stripe_events")) {
                if (sql.includes("related_stripe_object_id = ?")) {
                  const [workspaceId, relatedStripeObjectId] = params;
                  return stripeEvents.find((event) =>
                    event.workspace_id === workspaceId &&
                    event.related_stripe_object_id === relatedStripeObjectId
                  ) || null;
                }
                const [eventId] = params;
                return stripeEvents.find((event) =>
                  event.event_id === eventId && event.processed_status === "processed"
                ) || null;
              }
              if (sql.includes("FROM workspace_billing_reconciliation_status")) {
                return reconciliationLastCheckedAt
                  ? { last_checked_at: reconciliationLastCheckedAt }
                  : null;
              }
              throw new Error(`Unhandled SQL in billing test: ${sql}`);
            },
            async run() {
              if (sql.includes("INSERT INTO workspace_billing_reconciliation_status")) {
                reconciliationLastCheckedAt = String(params[1] || "");
                return { success: true };
              }
              if (sql.includes("INSERT INTO workspace_billing_reconciliation_drift")) {
                const [
                  id,
                  workspaceId,
                  driftType,
                  severity,
                  actionability,
                  relatedStripeObjectId,
                  observedJson,
                  expectedJson,
                  firstSeenAt,
                  lastSeenAt,
                  status,
                ] = params;
                const existing = reconciliationDriftRecords.find((record) => record.id === id);
                if (existing) {
                  existing.severity = String(severity);
                  existing.actionability = String(actionability);
                  existing.related_stripe_object_id = relatedStripeObjectId ? String(relatedStripeObjectId) : null;
                  existing.observed_json = String(observedJson);
                  existing.expected_json = String(expectedJson);
                  existing.last_seen_at = String(lastSeenAt);
                  existing.status = "open";
                } else {
                  reconciliationDriftRecords.push({
                    id: String(id),
                    workspace_id: String(workspaceId),
                    drift_type: String(driftType),
                    severity: String(severity),
                    actionability: String(actionability),
                    related_stripe_object_id: relatedStripeObjectId ? String(relatedStripeObjectId) : null,
                    observed_json: String(observedJson),
                    expected_json: String(expectedJson),
                    first_seen_at: String(firstSeenAt),
                    last_seen_at: String(lastSeenAt),
                    status: String(status),
                  });
                }
                return { success: true };
              }
              if (sql.includes("UPDATE workspace_billing_controls")) {
                if (sql.includes("scheduled_entitlement_plan = NULL")) {
                  billingControl.scheduled_entitlement_plan = null;
                  billingControl.scheduled_entitlement_effective_at = null;
                  return { success: true };
                }
                if (sql.includes("plan_override_plan = NULL") && sql.includes("plan_override_plan = 'free'")) {
                  const now = String(params[2] || "");
                  if (
                    billingControl.plan_override_plan === "free" &&
                    String(billingControl.plan_override_start_at || "") <= now &&
                    String(billingControl.plan_override_end_at || "") > now
                  ) {
                    billingControl.plan_override_plan = null;
                    billingControl.plan_override_start_at = null;
                    billingControl.plan_override_end_at = null;
                    billingControl.plan_override_reason = null;
                    billingControl.plan_override_created_by_user_id = null;
                    billingControl.plan_override_created_at = null;
                  }
                  return { success: true };
                }
                if (sql.includes("enterprise_annual_status") && sql.includes("enterprise_annual_upfront_invoice_status")) {
                  billingControl.enterprise_annual_status = "active";
                  billingControl.enterprise_annual_upfront_invoice_status = String(params[0] || "");
                  billingControl.enterprise_annual_upfront_invoice_hosted_url = params[1]
                    ? String(params[1])
                    : billingControl.enterprise_annual_upfront_invoice_hosted_url;
                  billingControl.enterprise_annual_upfront_invoice_paid_at = String(params[2] || "");
                  return { success: true };
                }
                if (sql.includes("enterprise_annual_upfront_invoice_status")) {
                  billingControl.enterprise_annual_upfront_invoice_status = String(params[0] || "");
                  billingControl.enterprise_annual_upfront_invoice_hosted_url = params[1]
                    ? String(params[1])
                    : billingControl.enterprise_annual_upfront_invoice_hosted_url;
                  return { success: true };
                }
                if (sql.includes("enterprise_annual_last_overage_invoice_period_start")) {
                  billingControl.enterprise_annual_last_overage_invoice_period_start = String(params[0] || "");
                  billingControl.enterprise_annual_last_overage_invoice_period_end = String(params[1] || "");
                  billingControl.enterprise_annual_last_overage_invoice_id = String(params[2] || "");
                  billingControl.enterprise_annual_last_overage_invoice_status = params[3] ? String(params[3]) : null;
                  billingControl.enterprise_annual_last_overage_invoice_hosted_url = params[4] ? String(params[4]) : null;
                  billingControl.enterprise_annual_last_overage_invoiced_at = String(params[5] || "");
                  return { success: true };
                }
                if (sql.includes("enterprise_annual_status") && sql.includes("enterprise_annual_last_overage_invoice_status")) {
                  billingControl.enterprise_annual_status = String(params[0] || "");
                  billingControl.enterprise_annual_last_overage_invoice_status = String(params[1] || "");
                  billingControl.enterprise_annual_last_overage_invoice_hosted_url = params[2]
                    ? String(params[2])
                    : billingControl.enterprise_annual_last_overage_invoice_hosted_url;
                  return { success: true };
                }
                if (sql.includes("enterprise_ramp_up_last_invoice_period_start")) {
                  billingControl.enterprise_ramp_up_last_invoice_period_start = String(params[0] || "");
                  billingControl.enterprise_ramp_up_last_invoice_period_end = String(params[1] || "");
                  billingControl.enterprise_ramp_up_last_invoice_id = String(params[2] || "");
                  billingControl.enterprise_ramp_up_last_invoice_status = params[3] ? String(params[3]) : null;
                  billingControl.enterprise_ramp_up_last_invoice_hosted_url = params[4] ? String(params[4]) : null;
                  billingControl.enterprise_ramp_up_last_invoiced_at = String(params[5] || "");
                  return { success: true };
                }
                if (sql.includes("enterprise_ramp_up_status") && sql.includes("enterprise_ramp_up_last_invoice_status")) {
                  billingControl.enterprise_ramp_up_status = String(params[0] || "");
                  billingControl.enterprise_ramp_up_last_invoice_status = String(params[1] || "");
                  billingControl.enterprise_ramp_up_last_invoice_hosted_url = params[2]
                    ? String(params[2])
                    : billingControl.enterprise_ramp_up_last_invoice_hosted_url;
                  return { success: true };
                }
                if (sql.includes("payment_required_plan_override_paid_at")) {
                  billingControl.plan_override_plan = billingControl.payment_required_plan_override_plan;
                  billingControl.plan_override_start_at = billingControl.payment_required_plan_override_start_at;
                  billingControl.plan_override_end_at = billingControl.payment_required_plan_override_end_at;
                  billingControl.plan_override_reason = billingControl.payment_required_plan_override_reason;
                  billingControl.plan_override_created_by_user_id = billingControl.payment_required_plan_override_created_by_user_id;
                  billingControl.plan_override_created_at = billingControl.payment_required_plan_override_created_at;
                  billingControl.payment_required_plan_override_invoice_status = String(params[0] || "");
                  billingControl.payment_required_plan_override_hosted_invoice_url = params[1]
                    ? String(params[1])
                    : billingControl.payment_required_plan_override_hosted_invoice_url;
                  billingControl.payment_required_plan_override_paid_at = String(params[2] || "");
                  return { success: true };
                }
                if (sql.includes("payment_required_plan_override_invoice_status")) {
                  billingControl.payment_required_plan_override_invoice_status = String(params[0] || "");
                  billingControl.payment_required_plan_override_hosted_invoice_url = params[1]
                    ? String(params[1])
                    : billingControl.payment_required_plan_override_hosted_invoice_url;
                  return { success: true };
                }
                throw new Error(`Unhandled SQL update in billing test: ${sql}`);
              }
              if (sql.includes("INSERT INTO workspace_billing_controls")) {
                if (sql.includes("no_billing_enabled")) {
                  billingControl.no_billing_enabled = Number(params[2] || 0);
                  billingControl.no_billing_reason = String(params[3] || "");
                  billingControl.no_billing_updated_by_user_id = String(params[4] || "");
                  billingControl.no_billing_updated_at = String(params[5] || "");
                } else if (sql.includes("enterprise_ramp_up_status")) {
                  billingControl.enterprise_ramp_up_status = "active";
                  billingControl.enterprise_ramp_up_duration_months = Number(params[2] || 0);
                  billingControl.enterprise_billing_cycle_start_date = String(params[3] || "");
                  billingControl.enterprise_ramp_up_collection_mode = String(params[4] || "") as "automatic" | "manual";
                  billingControl.enterprise_ramp_up_invoice_review_enabled = Number(params[5] || 0);
                  billingControl.enterprise_ramp_up_reason = String(params[6] || "");
                  billingControl.enterprise_ramp_up_created_by_user_id = String(params[7] || "");
                  billingControl.enterprise_ramp_up_created_at = String(params[8] || "");
                } else if (sql.includes("enterprise_annual_status")) {
                  billingControl.enterprise_annual_status = "pending_payment";
                  billingControl.enterprise_annual_monthly_minimum_allowance = Number(params[2] || 0);
                  billingControl.enterprise_annual_per_page_price_minor = Number(params[3] || 0);
                  billingControl.enterprise_annual_yearly_amount_minor = Number(params[4] || 0);
                  billingControl.enterprise_billing_cycle_start_date = String(params[5] || "");
                  billingControl.enterprise_annual_collection_mode = String(params[6] || "") as "automatic" | "manual";
                  billingControl.enterprise_annual_invoice_review_enabled = Number(params[7] || 0);
                  billingControl.enterprise_annual_reason = String(params[8] || "");
                  billingControl.enterprise_annual_created_by_user_id = String(params[9] || "");
                  billingControl.enterprise_annual_created_at = String(params[10] || "");
                  billingControl.enterprise_annual_upfront_invoice_id = String(params[11] || "");
                  billingControl.enterprise_annual_upfront_invoice_status = String(params[12] || "");
                  billingControl.enterprise_annual_upfront_invoice_hosted_url = params[13] ? String(params[13]) : null;
                  billingControl.enterprise_annual_upfront_invoice_paid_at = null;
                } else if (sql.includes("payment_required_plan_override_plan")) {
                  billingControl.payment_required_plan_override_plan = String(params[2] || "") as "free" | "pro" | "max";
                  billingControl.payment_required_plan_override_start_at = String(params[3] || "");
                  billingControl.payment_required_plan_override_end_at = String(params[4] || "");
                  billingControl.payment_required_plan_override_reason = String(params[5] || "");
                  billingControl.payment_required_plan_override_created_by_user_id = String(params[6] || "");
                  billingControl.payment_required_plan_override_created_at = String(params[7] || "");
                  billingControl.payment_required_plan_override_amount_minor = Number(params[8] || 0);
                  billingControl.payment_required_plan_override_currency = "GBP";
                  billingControl.payment_required_plan_override_collection_mode = String(params[9] || "") as "automatic" | "manual";
                  billingControl.payment_required_plan_override_invoice_id = String(params[10] || "");
                  billingControl.payment_required_plan_override_invoice_status = String(params[11] || "");
                  billingControl.payment_required_plan_override_hosted_invoice_url = params[12] ? String(params[12]) : null;
                  billingControl.payment_required_plan_override_paid_at = null;
                } else if (sql.includes("plan_override_plan")) {
                  billingControl.plan_override_plan = String(params[2] || "") as "free" | "pro" | "max";
                  billingControl.plan_override_start_at = String(params[3] || "");
                  billingControl.plan_override_end_at = String(params[4] || "");
                  billingControl.plan_override_reason = String(params[5] || "");
                  billingControl.plan_override_created_by_user_id = String(params[6] || "");
                  billingControl.plan_override_created_at = String(params[7] || "");
                } else if (sql.includes("scheduled_entitlement_plan")) {
                  billingControl.scheduled_entitlement_plan = String(params[2] || "") as "free" | "pro" | "max";
                  billingControl.scheduled_entitlement_effective_at = String(params[3] || "");
                } else if (sql.includes("self_service_subscription_plan")) {
                  billingControl.stripe_customer_id = params[2]
                    ? String(params[2])
                    : billingControl.stripe_customer_id;
                  billingControl.stripe_subscription_id = String(params[3] || "");
                  billingControl.stripe_subscription_item_id = params[4]
                    ? String(params[4])
                    : billingControl.stripe_subscription_item_id;
                  billingControl.self_service_subscription_plan = String(params[5] || "") as "pro" | "max";
                  billingControl.self_service_subscription_status = String(params[6] || "");
                  billingControl.stripe_subscription_current_period_start = String(params[7] || "");
                  billingControl.stripe_subscription_current_period_end = String(params[8] || "");
                  billingControl.self_service_subscription_invoice_id = params[9] ? String(params[9]) : null;
                  billingControl.self_service_subscription_invoice_status = params[10] ? String(params[10]) : null;
                  billingControl.self_service_subscription_hosted_invoice_url = params[11] ? String(params[11]) : null;
                  billingControl.self_service_subscription_invoice_diagnostics = params[12] ? String(params[12]) : null;
                } else if (sql.includes("stripe_customer_id")) {
                  billingControl.stripe_customer_id = String(params[2] || "");
                }
                return { success: true };
              }
              if (sql.includes("INSERT INTO workspace_billing_admin_audit_log")) {
                if (input.failAdminBillingAuditInsert) {
                  throw new Error("Simulated admin billing audit insert failure");
                }
                const [
                  id,
                  workspaceId,
                  action,
                  actorUserId,
                  reason,
                  beforeJson,
                  afterJson,
                  occurredAt,
                ] = params;
                auditEntries.push({
                  id: String(id),
                  workspace_id: String(workspaceId),
                  action: String(action),
                  actor_user_id: String(actorUserId),
                  reason: String(reason),
                  before_json: String(beforeJson),
                  after_json: String(afterJson),
                  occurred_at: String(occurredAt),
                });
                return { success: true };
              }
              if (sql.includes("INSERT INTO workspace_billing_stripe_events")) {
                const [
                  eventId,
                  type,
                  receivedAt,
                  processedStatus,
                  workspaceId,
                  relatedStripeObjectId,
                  errorDetails,
                ] = params;
                const existing = stripeEvents.find((event) => event.event_id === eventId);
                if (existing) {
                  existing.processed_status = String(processedStatus);
                  existing.workspace_id = workspaceId ? String(workspaceId) : existing.workspace_id;
                  existing.related_stripe_object_id = relatedStripeObjectId
                    ? String(relatedStripeObjectId)
                    : existing.related_stripe_object_id;
                  existing.error_details = errorDetails ? String(errorDetails) : null;
                } else {
                  stripeEvents.push({
                    event_id: String(eventId),
                    type: String(type),
                    received_at: String(receivedAt),
                    processed_status: String(processedStatus),
                    workspace_id: workspaceId ? String(workspaceId) : null,
                    related_stripe_object_id: relatedStripeObjectId ? String(relatedStripeObjectId) : null,
                    error_details: errorDetails ? String(errorDetails) : null,
                  });
                }
                return { success: true };
              }
              throw new Error(`Unhandled SQL run in billing test: ${sql}`);
            },
            async all() {
              if (sql.includes("FROM workspaces w") && sql.includes("owner_email")) {
                const ownerRow = {
                  id: input.workspace?.id || "workspace_billing",
                  name: input.workspace?.name || "Billing Workspace",
                  created_at: input.workspace?.created_at || "2026-05-04T00:00:00.000Z",
                  owner_email: "owner@example.com",
                  owner_name: "Workspace Owner",
                };
                if (sql.includes("WHERE w.id = ?")) {
                  const [workspaceId] = params;
                  return {
                    success: true,
                    results: input.workspace?.id === workspaceId ? [ownerRow] : [],
                  };
                }
                const [ownerEmail] = params;
                return {
                  success: true,
                  results: input.workspace && "owner@example.com".includes(String(ownerEmail || "").toLowerCase())
                    ? [ownerRow]
                    : [],
                };
              }
              if (sql.includes("FROM workspace_billing_controls c") && sql.includes("JOIN workspaces w")) {
                if (sql.includes("WHERE c.stripe_customer_id IS NOT NULL")) {
                  const activeEnterpriseInvoiceGeneration =
                    billingControl.enterprise_annual_status === "active" ||
                    billingControl.enterprise_ramp_up_status === "active";
                  return {
                    success: true,
                    results: input.workspace &&
                        billingControl.stripe_customer_id &&
                        !activeEnterpriseInvoiceGeneration
                      ? [{
                          workspace_id: input.workspace.id,
                          workspace_name: input.workspace.name,
                          stripe_customer_id: billingControl.stripe_customer_id,
                        }]
                      : [],
                  };
                }
                if (sql.includes("enterprise_annual_status")) {
                  return {
                    success: true,
                    results: input.workspace && billingControl.enterprise_annual_status === "active"
                      ? [{
                          workspace_id: input.workspace.id,
                          workspace_name: input.workspace.name,
                          stripe_customer_id: billingControl.stripe_customer_id,
                          enterprise_annual_monthly_minimum_allowance: billingControl.enterprise_annual_monthly_minimum_allowance,
                          enterprise_annual_per_page_price_minor: billingControl.enterprise_annual_per_page_price_minor,
                          enterprise_billing_cycle_start_date: billingControl.enterprise_billing_cycle_start_date,
                          enterprise_annual_collection_mode: billingControl.enterprise_annual_collection_mode,
                          enterprise_annual_invoice_review_enabled: billingControl.enterprise_annual_invoice_review_enabled,
                          enterprise_annual_last_overage_invoice_period_end: billingControl.enterprise_annual_last_overage_invoice_period_end,
                        }]
                      : [],
                  };
                }
                return {
                  success: true,
                  results: input.workspace && billingControl.enterprise_ramp_up_status === "active"
                    ? [{
                        workspace_id: input.workspace.id,
                        workspace_name: input.workspace.name,
                        stripe_customer_id: billingControl.stripe_customer_id,
                        enterprise_ramp_up_duration_months: billingControl.enterprise_ramp_up_duration_months,
                        enterprise_billing_cycle_start_date: billingControl.enterprise_billing_cycle_start_date,
                        enterprise_ramp_up_collection_mode: billingControl.enterprise_ramp_up_collection_mode,
                        enterprise_ramp_up_invoice_review_enabled: billingControl.enterprise_ramp_up_invoice_review_enabled,
                        enterprise_ramp_up_last_invoice_period_end: billingControl.enterprise_ramp_up_last_invoice_period_end,
                      }]
                    : [],
                };
              }
              if (sql.includes("FROM workspace_billing_admin_audit_log")) {
                const [workspaceId] = params;
                return {
                  success: true,
                  results: auditEntries
                    .filter((entry) => entry.workspace_id === workspaceId)
                    .map((entry) => ({
                      ...entry,
                      actor_name: entry.actor_user_id === "user_admin" ? "Application Admin" : null,
                    })),
                };
              }
              if (sql.includes("FROM workspace_billing_reconciliation_drift")) {
                const [workspaceId] = params;
                return {
                  success: true,
                  results: reconciliationDriftRecords.filter((record) =>
                    record.workspace_id === workspaceId && record.status === "open"
                  ),
                };
              }
              if (sql.includes("FROM workspace_billing_stripe_events")) {
                const [workspaceId] = params;
                return {
                  success: true,
	                  results: stripeEvents
	                    .filter((event) =>
	                      event.workspace_id === workspaceId &&
	                      (
	                        event.processed_status === "ignored" ||
	                        event.processed_status === "failed" ||
	                        (event.processed_status === "processed" && event.error_details)
	                      )
	                    )
                    .sort((left, right) =>
                      right.received_at.localeCompare(left.received_at) ||
                      right.event_id.localeCompare(left.event_id)
                    )
                    .slice(0, 20),
                };
              }
              throw new Error(`Unhandled SQL all in billing test: ${sql}`);
            },
          };
        },
      };
    },
} as unknown as D1Database;
}

function createBillingLedgerBinding(
  options: {
    failDuplicatePurchasedGrant?: boolean;
    failDuplicateIncludedGrant?: boolean;
    enterpriseUsagePages?: number;
    reservedCredits?: number;
    ownerBillingCurrentPeriod?: {
      pages_used: number;
      pages_remaining: number | null;
    };
    ownerBillingActivity?: Array<{
      id: string;
      type: string;
      occurred_at: string;
      credits: number;
      description: string;
    }>;
    creditUsage?: {
      range: "daily" | "weekly" | "monthly" | "yearly";
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
  } = {},
) {
  const grants: Array<{
    idempotency_key: string;
    grant_id: string;
    entry_id: string;
    credits: number;
    occurred_at: string;
  }> = [];
  const purchasedGrants: Array<{
    idempotency_key: string;
    grant_id: string;
    entry_id: string;
    credits: number;
    occurred_at: string;
    stripe_invoice_status?: string | null;
    hosted_invoice_url?: string | null;
  }> = [];
  const creditPackPaymentFailures: Array<{
    idempotency_key: string;
    entry_id: string;
    occurred_at: string;
    stripe_invoice_status?: string | null;
    hosted_invoice_url?: string | null;
  }> = [];
  const includedGrants: Array<{
    idempotency_key: string;
    grant_id: string;
    entry_id: string;
    credits: number;
    occurred_at: string;
    stripe_invoice_status?: string | null;
    hosted_invoice_url?: string | null;
  }> = [];
  const includedRevocations: Array<{
    idempotency_key: string;
    revocation_id: string;
    entry_id: string;
    credits: number;
    occurred_at: string;
  }> = [];
  const revocations: Array<{
    idempotency_key: string;
    revocation_id: string;
    entry_id: string;
    grant_id: string;
    credits: number;
    occurred_at: string;
  }> = [];

  function creditBuckets() {
    const includedGranted = includedGrants.reduce((total, grant) => total + grant.credits, 0) -
      includedRevocations.reduce((total, revocation) => total + revocation.credits, 0);
    const purchasedGranted = purchasedGrants.reduce((total, grant) => total + grant.credits, 0);
    const goodwillGranted = grants.reduce((total, grant) => total + grant.credits, 0) -
      revocations.reduce((total, revocation) => total + revocation.credits, 0);
    let remainingSpend = Math.max(0, Number(options.reservedCredits || 0));
    const includedAvailable = Math.max(0, includedGranted - remainingSpend);
    remainingSpend = Math.max(0, remainingSpend - includedGranted);
    const purchasedAvailable = Math.max(0, purchasedGranted - remainingSpend);
    remainingSpend = Math.max(0, remainingSpend - purchasedGranted);
    const goodwillAvailable = Math.max(0, goodwillGranted - remainingSpend);

    return {
      includedAvailable,
      purchasedAvailable,
      goodwillAvailable,
      totalAvailable: includedAvailable + purchasedAvailable + goodwillAvailable,
    };
  }

  function availableCredits() {
    return creditBuckets().totalAvailable;
  }

  function getOwnerBillingActivity() {
    return options.ownerBillingActivity || [
      ...includedGrants.map((grant) => ({
        id: grant.entry_id,
        type: "included_credit_grant",
        occurred_at: grant.occurred_at,
        credits: grant.credits,
        description: "Included Credits granted",
        ...invoiceForBillingActivity(grant),
      })),
      ...grants.map((grant) => ({
        id: grant.entry_id,
        type: "goodwill_credit_grant",
        occurred_at: grant.occurred_at,
        credits: grant.credits,
        description: "Goodwill Credits granted",
      })),
      ...revocations.map((revocation) => ({
        id: revocation.entry_id,
        type: "goodwill_credit_revocation",
        occurred_at: revocation.occurred_at,
        credits: -revocation.credits,
        description: "Goodwill Credits revoked",
      })),
      ...purchasedGrants.map((grant) => ({
        id: grant.entry_id,
        type: "purchased_credit_grant",
        occurred_at: grant.occurred_at,
        credits: grant.credits,
        description: "Purchased Credits granted",
        ...invoiceForBillingActivity(grant),
      })),
      ...creditPackPaymentFailures.map((failure) => ({
        id: failure.entry_id,
        type: "credit_pack_payment_failed",
        occurred_at: failure.occurred_at,
        credits: 0,
        description: "Credit pack payment failed",
        ...invoiceForBillingActivity(failure),
      })),
    ];
  }

  function invoiceForBillingActivity(grant: { stripe_invoice_status?: string | null; hosted_invoice_url?: string | null }) {
    return grant.hosted_invoice_url
      ? {
        invoice: {
          status: grant.stripe_invoice_status || null,
          hosted_invoice_url: grant.hosted_invoice_url,
        },
      }
      : {};
  }

  function listOwnerBillingActivityPage(input?: {
    limit?: number;
    cursor?: { occurred_at: string; id: string } | null;
  }) {
    const limit = Math.max(1, Number(input?.limit || getOwnerBillingActivity().length || 1));
    let activity = getOwnerBillingActivity().filter(isCreditAdditionActivity).sort((a, b) => {
      if (a.occurred_at > b.occurred_at) {
        return -1;
      }
      if (a.occurred_at < b.occurred_at) {
        return 1;
      }
      return 0;
    });
    if (input?.cursor) {
      activity = activity.filter((entry) =>
        entry.occurred_at < input.cursor!.occurred_at ||
        (entry.occurred_at === input.cursor!.occurred_at && entry.id < input.cursor!.id)
      );
    }
    const rows = activity.slice(0, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1] || null;
    return {
      owner_billing_activity: page,
      next_cursor: rows.length > limit && last
        ? { occurred_at: last.occurred_at, id: last.id }
        : null,
    };
  }

  const ledger = {
    async grantGoodwillCredits(input: { credits: number; idempotencyKey: string }) {
      const existing = grants.find((grant) => grant.idempotency_key === input.idempotencyKey);
      if (existing) {
        return {
          grant_id: existing.grant_id,
          workspace_id: "workspace_billing",
          granted_credits: existing.credits,
          available_credits: availableCredits(),
        };
      }

      const grant = {
        idempotency_key: input.idempotencyKey,
        grant_id: `grant_${input.idempotencyKey}`,
        entry_id: `entry_${input.idempotencyKey}`,
        credits: input.credits,
        occurred_at: new Date().toISOString(),
      };
      grants.push(grant);

      return {
        grant_id: grant.grant_id,
        workspace_id: "workspace_billing",
        granted_credits: grant.credits,
        available_credits: availableCredits(),
      };
    },
    async revokeGoodwillCreditGrant(input: { grantId: string; idempotencyKey: string }) {
      const existing = revocations.find((revocation) => revocation.idempotency_key === input.idempotencyKey);
      if (existing) {
        return {
          revocation_id: existing.revocation_id,
          grant_id: existing.grant_id,
          workspace_id: "workspace_billing",
          revoked_credits: existing.credits,
          available_credits: availableCredits(),
        };
      }
      const grant = grants.find((item) => item.grant_id === input.grantId);
      if (!grant) {
        throw new Error("Grant not found");
      }
      const revocation = {
        idempotency_key: input.idempotencyKey,
        revocation_id: `revocation_${input.idempotencyKey}`,
        entry_id: `entry_${input.idempotencyKey}`,
        grant_id: input.grantId,
        credits: grant.credits,
        occurred_at: new Date().toISOString(),
      };
      revocations.push(revocation);

      return {
        revocation_id: revocation.revocation_id,
        grant_id: revocation.grant_id,
        workspace_id: "workspace_billing",
        revoked_credits: revocation.credits,
        available_credits: availableCredits(),
      };
    },
    async grantPurchasedCredits(input: {
      credits: number;
      idempotencyKey: string;
      occurredAt: string;
      stripeInvoiceStatus?: string | null;
      hostedInvoiceUrl?: string | null;
    }) {
      const existing = purchasedGrants.find((grant) => grant.idempotency_key === input.idempotencyKey);
      if (existing) {
        if (options.failDuplicatePurchasedGrant) {
          throw new Error("Duplicate Purchased Credit grant should not be attempted");
        }
        existing.stripe_invoice_status = input.stripeInvoiceStatus || existing.stripe_invoice_status || null;
        existing.hosted_invoice_url = input.hostedInvoiceUrl || existing.hosted_invoice_url || null;
        return {
          grant_id: existing.grant_id,
          workspace_id: "workspace_billing",
          granted_credits: existing.credits,
          available_credits: availableCredits(),
        };
      }
      const grant = {
        idempotency_key: input.idempotencyKey,
        grant_id: `purchased_${input.idempotencyKey}`,
        entry_id: `entry_${input.idempotencyKey}`,
        credits: input.credits,
        occurred_at: input.occurredAt,
        stripe_invoice_status: input.stripeInvoiceStatus || null,
        hosted_invoice_url: input.hostedInvoiceUrl || null,
      };
      purchasedGrants.push(grant);

      return {
        grant_id: grant.grant_id,
        workspace_id: "workspace_billing",
        granted_credits: grant.credits,
        available_credits: availableCredits(),
      };
    },
    async recordCreditPackPaymentFailed(input: {
      idempotencyKey: string;
      occurredAt: string;
      stripeInvoiceStatus?: string | null;
      hostedInvoiceUrl?: string | null;
    }) {
      const existing = creditPackPaymentFailures.find((failure) => failure.idempotency_key === input.idempotencyKey);
      if (existing) {
        existing.stripe_invoice_status = input.stripeInvoiceStatus || existing.stripe_invoice_status || null;
        existing.hosted_invoice_url = input.hostedInvoiceUrl || existing.hosted_invoice_url || null;
        return {
          entry_id: existing.entry_id,
          workspace_id: "workspace_billing",
        };
      }
      const failure = {
        idempotency_key: input.idempotencyKey,
        entry_id: `entry_${input.idempotencyKey}`,
        occurred_at: input.occurredAt,
        stripe_invoice_status: input.stripeInvoiceStatus || "payment_failed",
        hosted_invoice_url: input.hostedInvoiceUrl || null,
      };
      creditPackPaymentFailures.push(failure);
      return {
        entry_id: failure.entry_id,
        workspace_id: "workspace_billing",
      };
    },
    async findIncludedCreditGrant(input: { idempotencyKey: string }) {
      const existing = includedGrants.find((grant) => grant.idempotency_key === input.idempotencyKey);
      return existing
        ? {
          exists: true,
          entry_id: existing.entry_id,
          grant_id: existing.grant_id,
          occurred_at: existing.occurred_at,
        }
        : { exists: false };
    },
    async grantIncludedCredits(input: {
      credits: number;
      idempotencyKey: string;
      occurredAt: string;
      stripeInvoiceStatus?: string | null;
      hostedInvoiceUrl?: string | null;
    }) {
      const existing = includedGrants.find((grant) => grant.idempotency_key === input.idempotencyKey);
      if (existing) {
        if (options.failDuplicateIncludedGrant) {
          throw new Error("Duplicate Included Credit grant should not be attempted");
        }
        existing.stripe_invoice_status = input.stripeInvoiceStatus || existing.stripe_invoice_status || null;
        existing.hosted_invoice_url = input.hostedInvoiceUrl || existing.hosted_invoice_url || null;
        return {
          grant_id: existing.grant_id,
          workspace_id: "workspace_billing",
          granted_credits: existing.credits,
          available_credits: availableCredits(),
        };
      }
      const grant = {
        idempotency_key: input.idempotencyKey,
        grant_id: `included_${input.idempotencyKey}`,
        entry_id: `entry_${input.idempotencyKey}`,
        credits: input.credits,
        occurred_at: input.occurredAt,
        stripe_invoice_status: input.stripeInvoiceStatus || null,
        hosted_invoice_url: input.hostedInvoiceUrl || null,
      };
      includedGrants.push(grant);

      return {
        grant_id: grant.grant_id,
        workspace_id: "workspace_billing",
        granted_credits: grant.credits,
        available_credits: availableCredits(),
      };
    },
    async revokeIncludedCredits(input: {
      credits: number;
      idempotencyKey: string;
      occurredAt: string;
    }) {
      const existing = includedRevocations.find((revocation) => revocation.idempotency_key === input.idempotencyKey);
      if (existing) {
        return {
          revocation_id: existing.revocation_id,
          workspace_id: "workspace_billing",
          revoked_credits: existing.credits,
          available_credits: availableCredits(),
        };
      }
      const revocation = {
        idempotency_key: input.idempotencyKey,
        revocation_id: `included_revocation_${input.idempotencyKey}`,
        entry_id: `entry_${input.idempotencyKey}`,
        credits: input.credits,
        occurred_at: input.occurredAt,
      };
      includedRevocations.push(revocation);

      return {
        revocation_id: revocation.revocation_id,
        workspace_id: "workspace_billing",
        revoked_credits: revocation.credits,
        available_credits: availableCredits(),
      };
    },
    async summarizeOwnerBilling(input?: {
      activityLimit?: number;
      activityCursor?: { occurred_at: string; id: string } | null;
      usageRange?: "daily" | "weekly" | "monthly" | "yearly";
    }) {
      const buckets = creditBuckets();
      const activityPage = input?.activityLimit
        ? listOwnerBillingActivityPage({ limit: input.activityLimit, cursor: input.activityCursor ?? null })
        : null;
      const creditUsage = input?.usageRange
        ? options.creditUsage || emptyCreditUsage(input.usageRange)
        : null;
      return {
        credits: {
          included_available: buckets.includedAvailable,
          purchased_available: buckets.purchasedAvailable,
          goodwill_available: buckets.goodwillAvailable,
          total_available: buckets.totalAvailable,
        },
        ...(options.ownerBillingCurrentPeriod ? { current_period: options.ownerBillingCurrentPeriod } : {}),
        owner_billing_activity: activityPage?.owner_billing_activity || getOwnerBillingActivity(),
        ...(activityPage ? { owner_billing_activity_next_cursor: activityPage.next_cursor } : {}),
        ...(creditUsage ? { credit_usage: creditUsage } : {}),
      };
    },
    async listOwnerBillingActivity(input: {
      limit: number;
      cursor?: { occurred_at: string; id: string } | null;
    }) {
      return listOwnerBillingActivityPage(input);
    },
    async summarizeCreditUsage(input: {
      range: "daily" | "weekly" | "monthly" | "yearly";
    }) {
      return options.creditUsage || emptyCreditUsage(input.range);
    },
    async summarizeEnterpriseUsageCharges() {
      const pages = options.enterpriseUsagePages ?? 0;
      return {
        billable_document_pages: pages,
        amount: {
          currency: "GBP",
          amount_minor: pages * 14,
          display: `GBP ${(pages * 0.14).toFixed(2)}`,
          tax_behavior: "exclusive",
        },
      };
    },
  };

  return {
    getByName(name: string) {
      if (name !== "workspace_billing") {
        throw new Error(`Unexpected billing ledger name: ${name}`);
      }
      return ledger;
    },
  };
}

function isCreditAdditionActivity(activity: { type: string }) {
  return [
    "goodwill_credit_grant",
    "included_credit_grant",
    "purchased_credit_grant",
    "credit_pack_payment_failed",
  ].includes(activity.type);
}

function emptyCreditUsage(range: "daily" | "weekly" | "monthly" | "yearly") {
  return {
    range,
    total_credits: 0,
    total_billable_document_pages: 0,
    buckets: [],
  };
}

async function createStripeSignature(
  payload: string,
  secret: string,
  options: { scheme?: string; timestamp?: number | string } = {},
): Promise<string> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const scheme = options.scheme || "v1";
  const signedPayload = `${timestamp}.${payload}`;
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
    new TextEncoder().encode(signedPayload),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},${scheme}=${hex}`;
}
