import { describe, expect, it } from "vitest";

import { NON_ENTERPRISE_BILLING_PLANS } from "./workspaceBilling";

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
});
