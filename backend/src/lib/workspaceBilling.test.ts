import { describe, expect, it } from "vitest";

import { NON_ENTERPRISE_BILLING_PLANS, summarizeWorkspaceBilling } from "./workspaceBilling";
import type { Workspace } from "./types";

describe("Workspace billing plan catalog", () => {
  it("defines the code-owned Free, Pro, and Max non-enterprise plans", () => {
    expect(NON_ENTERPRISE_BILLING_PLANS).toEqual({
      free: expect.objectContaining({
        plan: "free",
        display_name: "Free",
        monthly_price: { currency: "GBP", amount_minor: 0, display: "GBP 0" },
        included_credits: 0,
        api_access: false,
        per_page_catalog_price: expect.objectContaining({
          currency: "GBP",
          amount_minor: 22,
          display: "GBP 0.22",
          tax_behavior: "exclusive",
        }),
        limits: expect.objectContaining({
          templates: 3,
          top_level_template_fields: 5,
          table_shaped_fields: 1,
          table_columns_per_field: 5,
          members: 3,
          monthly_pages: 500,
          api_access: false,
        }),
      }),
      pro: expect.objectContaining({
        plan: "pro",
        display_name: "Pro",
        monthly_price: { currency: "GBP", amount_minor: 5000, display: "GBP 50" },
        included_credits: 200,
        api_access: true,
        per_page_catalog_price: expect.objectContaining({ amount_minor: 20 }),
        limits: expect.objectContaining({
          templates: 10,
          top_level_template_fields: 15,
          table_shaped_fields: 1,
          table_columns_per_field: 10,
          members: 50,
          monthly_pages: 1500,
          api_access: true,
        }),
      }),
      max: expect.objectContaining({
        plan: "max",
        display_name: "Max",
        monthly_price: { currency: "GBP", amount_minor: 20000, display: "GBP 200" },
        included_credits: 1000,
        api_access: true,
        per_page_catalog_price: expect.objectContaining({ amount_minor: 18 }),
        limits: expect.objectContaining({
          templates: 50,
          top_level_template_fields: 20,
          table_shaped_fields: 1,
          table_columns_per_field: 15,
          members: null,
          monthly_pages: 5000,
          api_access: true,
        }),
      }),
    });
  });

  it("anchors active Plan override monthly page periods to the override cycle", () => {
    const workspace: Workspace = {
      id: "workspace_billing",
      api_key_hash: null,
      name: "Billing Workspace",
      created_at: "2026-05-06T17:54:36.645Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null,
    };

    const summary = summarizeWorkspaceBilling(
      workspace,
      {
        self_service_subscription_plan: "pro",
        self_service_subscription_status: "active",
        stripe_subscription_current_period_start: "2026-06-01T16:30:51.000Z",
        stripe_subscription_current_period_end: "2026-07-01T16:30:51.000Z",
        plan_override_plan: "max",
        plan_override_start_at: "2026-06-01T00:00:00.000Z",
        plan_override_end_at: "2026-07-01T00:00:00.000Z",
      },
      new Date("2026-06-06T12:00:00.000Z"),
    );

    expect(summary.active_entitlement.plan).toBe("max");
    expect(summary.current_period).toMatchObject({
      anchor: "2026-06-01T00:00:00.000Z",
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-07-01T00:00:00.000Z",
      monthly_page_limit: 5000,
    });
    expect(summary.next_scheduled_entitlement).toEqual({
      plan: "pro",
      display_name: "Pro",
      effective_at: "2026-07-01T00:00:00.000Z",
    });
  });
});
