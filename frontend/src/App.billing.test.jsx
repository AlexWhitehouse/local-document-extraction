import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./lib/authClient", () => ({
  createRuntimeAuthClient: () => ({
    useSession: () => ({
      data: {
        user: {
          id: "user_owner",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
      },
      isPending: false,
      refetch: vi.fn(),
    }),
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  Toaster: (props) => (
    <div data-rich-colors={String(props.richColors)} data-testid="sonner-toaster" />
  ),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { App } from "./App.jsx";
import { toast } from "sonner";

describe("Workspace Billing page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage({
      workspaceId: "ws_1",
      workspaceName: "Research Workspace",
    });
    globalThis.fetch = vi.fn(mockBillingFetch({ role: "owner" }));
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens Workspace owner Billing from the Workspace dashboard with Free entitlement capacity", async () => {
    render(<App />);

    const main = within(screen.getByRole("main"));
    expect(screen.queryByRole("button", { name: /^Billing$/ })).toBeNull();
    expect(await main.findByRole("heading", { name: "Workspace Users" })).toBeTruthy();
    expect(main.queryByRole("heading", { name: "Billing" })).toBeNull();
    expect(await screen.findByRole("button", { name: "View Billing" })).toBeTruthy();
    expect(
      globalThis.fetch.mock.calls.some(([input]) =>
        String(input).includes("/billing/summary"),
      ),
    ).toBe(false);

    await waitForWorkspaceBilling();
    expect(screen.getByRole("button", { name: "View Dashboard" })).toBeTruthy();
    const metrics = within(main.getByRole("region", { name: "Operational metrics" }));
    expect(metrics.getByText("Remaining Credits")).toBeTruthy();
    expect(metrics.getByText("Available submission credits")).toBeTruthy();
    expect(metrics.getByText("Documents")).toBeTruthy();
    expect(metrics.getByText("Completion")).toBeTruthy();
    expect(metrics.getByText("Remaining Pages")).toBeTruthy();
    expect(metrics.getByText("Page quota left this period")).toBeTruthy();
    expect(metrics.getByText("500")).toBeTruthy();
    expect(main.queryByRole("heading", { name: "Workspace Users" })).toBeNull();
    expect(await main.findByText("Free")).toBeTruthy();
    expect(main.queryByText("0 Included Credits")).toBeNull();
    expect(await main.findByText("Plan Included Credits")).toBeTruthy();
    expect(main.getByText("Per Page Price")).toBeTruthy();
    expect(main.getByLabelText("0 Credits available, 0 Credits used")).toBeTruthy();
    expect(main.getAllByText("Credits used").length).toBeGreaterThan(0);
    expect(main.queryByText("Page Capacity")).toBeNull();
    expect(main.queryByText("Catalog Price")).toBeNull();
    expect(main.queryByText("500 pages remaining")).toBeNull();
    expect(main.queryByText("per Billable Document page")).toBeNull();
    expect(main.getByRole("button", { name: "View/Edit Plan" })).toBeTruthy();
    expect(main.getByRole("button", { name: "Buy Credits" })).toBeTruthy();
    expect(main.queryByText("Plan Limits")).toBeNull();
    expect(main.queryByText("Subscriptions")).toBeNull();
    expect(main.queryByText("Credit Packs")).toBeNull();
    expect(main.queryByText("Billing operational status")).toBeNull();
    expect(main.getByText("Ready for submissions")).toBeTruthy();
    expect(main.queryByText(/Checkout|Payment method|Invoice/i)).toBeNull();

    const user = userEvent.setup();
    await user.click(main.getByRole("button", { name: "View available Credits breakdown" }));
    const creditBreakdownDialog = within(await screen.findByRole("dialog", { name: "Available Credits breakdown" }));
    expect(creditBreakdownDialog.getByText("No available Credits.")).toBeTruthy();
    await user.click(creditBreakdownDialog.getByRole("button", { name: "Close" }));

    const planDialog = await openPlanModal(user);
    expect(planDialog.getByRole("heading", { name: "Free" })).toBeTruthy();
    expect(planDialog.getByRole("heading", { name: "Pro" })).toBeTruthy();
    expect(planDialog.getByRole("heading", { name: "Max" })).toBeTruthy();
    expect(planDialog.getByText("3 Templates")).toBeTruthy();
    expect(planDialog.getByText("5 top-level fields")).toBeTruthy();
    expect(planDialog.getByText("500 pages monthly")).toBeTruthy();
    expect(planDialog.getByRole("button", { name: "Start Pro" })).toBeTruthy();
    expect(planDialog.getByRole("button", { name: "Start Max" })).toBeTruthy();
    await user.click(planDialog.getByRole("button", { name: "Close" }));

    const creditDialog = await openCreditModal(user);
    expect(creditDialog.getByRole("heading", { name: "Buy Credits" })).toBeTruthy();
    expect(creditDialog.getByRole("button", { name: "Buy 100 Credits" })).toBeTruthy();
    expect(creditDialog.getByRole("button", { name: "Buy 500 Credits" })).toBeTruthy();
    expect(creditDialog.getByRole("button", { name: "Buy 1,000 Credits" })).toBeTruthy();
    expect(creditDialog.getByRole("button", { name: "Buy 5,000 Credits" })).toBeTruthy();

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/summary",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });
  });

  it("shows Workspace owners No-billing entitlement without Free pricing or page-cap fallback", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "no_billing",
          display_name: "No-billing",
          included_credits: 0,
          api_access: true,
          per_page_catalog_price: null,
        },
        current_period: {
          anchor: "2026-05-04T00:00:00.000Z",
          start: "2026-05-04T00:00:00.000Z",
          end: "2026-06-04T00:00:00.000Z",
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
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("No-billing")).toBeTruthy();
    expect(await main.findByText("Plan Included Credits")).toBeTruthy();
    expect(main.getAllByText("Unlimited").length).toBeGreaterThan(0);
    expect(main.queryByText("Unlimited pages remaining")).toBeNull();
    expect(main.getByText("No charge")).toBeTruthy();
    expect(main.queryByText("GBP 0.22")).toBeNull();
  });

  it("shows Workspace owners ledger-derived Credits and Owner billing activity", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
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
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Available Credits")).toBeTruthy();
    expect(main.queryByText("25 Goodwill Credits")).toBeNull();
    expect(main.getByText("Goodwill Credits granted")).toBeTruthy();
    expect(main.getByText("+25 Credits")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(main.getByRole("button", { name: "View available Credits breakdown" }));
    const creditBreakdownDialog = within(await screen.findByRole("dialog", { name: "Available Credits breakdown" }));
    expect(creditBreakdownDialog.getByText("Goodwill Credits")).toBeTruthy();
    expect(creditBreakdownDialog.getByText("25")).toBeTruthy();
  });

  it("shows failed delayed Credit pack payments as payment failures in Owner billing activity", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        owner_billing_activity: [
          {
            id: "entry_stripe_credit_pack_payment_failed_purchase_async_failed_100",
            type: "credit_pack_payment_failed",
            occurred_at: "2026-05-31T12:00:00.000Z",
            credits: 0,
            description: "Credit pack payment failed",
            invoice: {
              status: "payment_failed",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_async_failed_100",
            },
          },
        ],
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Credit pack payment failed")).toBeTruthy();
    expect(main.getByText("Payment failed")).toBeTruthy();
    expect(main.queryByText("+0 Credits")).toBeNull();
    await user.click(main.getByRole("button", { name: "Pay invoice" }));
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_async_failed_100");
  });

  it("loads older Billing Activity with a cursor", async () => {
    const user = userEvent.setup();
    const firstPage = [6, 5, 4, 3, 2].map((index) => ({
      id: `activity_${index}`,
      type: "purchased_credit_grant",
      occurred_at: `2026-06-01T0${index}:00:00.000Z`,
      credits: 10,
      description: `Billing activity ${index}`,
    }));
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        owner_billing_activity: firstPage,
        owner_billing_activity_next_cursor: "older-cursor",
      },
      billingActivityPage: {
        owner_billing_activity: [
          {
            id: "activity_1",
            type: "goodwill_credit_grant",
            occurred_at: "2026-06-01T01:00:00.000Z",
            credits: 5,
            description: "Billing activity 1",
          },
        ],
        owner_billing_activity_next_cursor: null,
      },
    }));

    render(<App />);

    const main = await waitForWorkspaceBilling();
    expect(await main.findByRole("heading", { name: "Billing Activity" })).toBeTruthy();
    expect(main.queryByRole("heading", { name: "Owner Billing Activity" })).toBeNull();

    await user.click(main.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/activity?cursor=older-cursor",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });
    expect(await main.findByText("Billing activity 1")).toBeTruthy();
    expect(main.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(document.querySelector(".billing-activity-list.scrollable")).toBeTruthy();
  });

  it("loads filtered Credit Usage without reloading Billing Activity", async () => {
    const user = userEvent.setup();
    const monthlyUsage = {
      range: "monthly",
      total_credits: 42,
      total_billable_document_pages: 42,
      buckets: [
        {
          label: "Apr 2026",
          start_at: "2026-04-01T00:00:00.000Z",
          end_at: "2026-05-01T00:00:00.000Z",
          credits: 0,
          billable_document_pages: 0,
        },
        {
          label: "May 2026",
          start_at: "2026-05-01T00:00:00.000Z",
          end_at: "2026-06-01T00:00:00.000Z",
          credits: 42,
          billable_document_pages: 42,
        },
      ],
    };
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        credit_usage: {
          ...defaultCreditUsage("daily"),
          total_credits: 3,
          total_billable_document_pages: 3,
          buckets: defaultCreditUsage("daily").buckets.map((bucket, index) => ({
            ...bucket,
            credits: index === 2 ? 3 : 0,
            billable_document_pages: index === 2 ? 3 : 0,
          })),
        },
      },
      billingUsage: monthlyUsage,
    }));

    render(<App />);

    const main = await waitForWorkspaceBilling();
    expect(await main.findByRole("heading", { name: "Credit Usage" })).toBeTruthy();
    expect(main.getByRole("img", { name: /3 Credits used for daily usage/i })).toBeTruthy();

    await user.click(main.getByRole("button", { name: "Month" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/usage?range=monthly",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });
    expect(await main.findByRole("img", { name: /42 Credits used for monthly usage/i })).toBeTruthy();
    expect(main.getByText("May 2026")).toBeTruthy();
  });

  it("shows active Pro subscription status and Included Credit capacity after payment", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "pro",
          display_name: "Pro",
          included_credits: 200,
          api_access: true,
          per_page_catalog_price: {
            currency: "GBP",
            amount_minor: 20,
            display: "GBP 0.20",
            tax_behavior: "exclusive",
          },
        },
        credits: {
          included_available: 200,
          purchased_available: 0,
          goodwill_available: 0,
          total_available: 200,
        },
        current_period: {
          anchor: "2026-05-31T12:00:00.000Z",
          start: "2026-05-31T12:00:00.000Z",
          end: "2026-06-30T12:00:00.000Z",
          monthly_page_limit: 1500,
          pages_used: 0,
          pages_remaining: 1500,
        },
        plan_limits: {
          templates: 10,
          top_level_template_fields: 15,
          table_shaped_fields: 1,
          table_columns_per_field: 10,
          members: 50,
          monthly_pages: 1500,
          api_access: true,
        },
        self_service_subscription: {
          plan: "pro",
          status: "active",
          current_period_start: "2026-05-31T12:00:00.000Z",
          current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Pro")).toBeTruthy();
    expect(main.queryByText("200 Included Credits")).toBeNull();
    expect(await main.findByText("Plan Included Credits")).toBeTruthy();
    expect(main.getAllByText("200").length).toBeGreaterThan(0);
    expect(main.queryByText("1,500 pages remaining")).toBeNull();
    expect(main.queryByText("Subscriptions")).toBeNull();

    const user = userEvent.setup();
    await user.click(main.getByRole("button", { name: "View available Credits breakdown" }));
    const creditBreakdownDialog = within(await screen.findByRole("dialog", { name: "Available Credits breakdown" }));
    expect(creditBreakdownDialog.getByText("Plan Included Credits")).toBeTruthy();
    expect(creditBreakdownDialog.getByText("200")).toBeTruthy();
    await user.click(creditBreakdownDialog.getByRole("button", { name: "Close" }));

    const planDialog = await openPlanModal(user);
    expect(planDialog.queryByText("Subscription active")).toBeNull();
    expect(planDialog.getByRole("button", { name: "Current plan" }).disabled).toBe(true);
    expect(planDialog.queryByRole("button", { name: "Start Pro" })).toBeNull();
  });

  it("explains owner billing renewal and blockers without leaking internals", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "pro",
          display_name: "Pro",
          included_credits: 200,
          api_access: true,
          per_page_catalog_price: {
            currency: "GBP",
            amount_minor: 20,
            display: "GBP 0.20",
            tax_behavior: "exclusive",
          },
        },
        credits: {
          included_available: 4,
          purchased_available: 8,
          goodwill_available: 0,
          total_available: 12,
        },
        current_period: {
          anchor: "2026-05-31T12:00:00.000Z",
          start: "2026-05-31T12:00:00.000Z",
          end: "2026-06-30T12:00:00.000Z",
          monthly_page_limit: 1500,
          pages_used: 1500,
          pages_remaining: 0,
        },
        plan_limits: {
          templates: 10,
          top_level_template_fields: 15,
          table_shaped_fields: 1,
          table_columns_per_field: 10,
          members: 50,
          monthly_pages: 1500,
          api_access: true,
        },
        billing_operational_status: {
          status: "blocked",
          blocking_reasons: ["Plan page capacity reached"],
        },
        next_scheduled_entitlement: {
          plan: "free",
          display_name: "Free",
          effective_at: "2026-06-30T12:00:00.000Z",
        },
        self_service_subscription: {
          plan: "pro",
          status: "active",
          current_period_start: "2026-05-31T12:00:00.000Z",
          current_period_end: "2026-06-30T12:00:00.000Z",
        },
        payment_setup: {
          status: "ready",
          default_payment_method: "card_4242",
        },
        reconciliation: {
          drift_records: [
            {
              drift_type: "ambiguous_stripe_invoice",
              related_stripe_object_id: "in_internal_drift_123",
            },
          ],
        },
        owner_billing_activity: [
          {
            id: "activity_1",
            type: "purchased_credit_grant",
            occurred_at: "2026-06-01T08:00:00.000Z",
            credits: 100,
            description: "Purchased Credit pack",
            stripe_invoice_id: "in_hidden_owner_activity",
            internal_admin_note: "Support-only note",
            invoice: {
              status: "paid",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_hidden_owner_activity",
            },
          },
        ],
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(main.queryByText("Included Credit renewal")).toBeNull();
    expect(main.queryByText("Included Credits renew 30 Jun 2026")).toBeNull();
    expect(main.getByLabelText("12 Credits available, 1,500 Credits used")).toBeTruthy();
    expect(main.getAllByText("200").length).toBeGreaterThan(0);
    expect(await main.findByText("Billing period start")).toBeTruthy();
    expect(main.getByText("Billing period renewal")).toBeTruthy();
    expect(main.getByText("30 Jun 2026")).toBeTruthy();
    expect(main.queryByText("Billing attention needed")).toBeNull();
    expect(main.queryByText("Billing operational status")).toBeNull();
    expect(main.getByText("Plan page capacity reached")).toBeTruthy();
    expect(main.queryByText("Payment setup")).toBeNull();
    expect(main.queryByText("Managed securely through Stripe-hosted billing flows.")).toBeNull();
    expect(main.getByText("Purchased Credit pack")).toBeTruthy();
    await user.click(main.getByRole("button", { name: "View invoice" }));
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_hidden_owner_activity");
    expect(main.queryByText(/card_4242|in_internal|in_hidden|Support-only|ambiguous_stripe_invoice/)).toBeNull();
  });

  it("shows Unpaid billing state and the next scheduled entitlement on the owner Billing page", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        billing_state: "unpaid",
        self_service_subscription: {
          plan: "pro",
          status: "unpaid",
          current_period_start: "2026-06-30T12:00:00.000Z",
          current_period_end: "2026-07-30T12:00:00.000Z",
          invoice: {
            status: "open",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_unpaid_subscription",
          },
        },
        next_scheduled_entitlement: {
          plan: "free",
          display_name: "Free",
          effective_at: "2026-07-30T12:00:00.000Z",
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Unpaid billing state")).toBeTruthy();
    expect(main.getByText("Pro subscription invoice open")).toBeTruthy();
    expect(main.getByText("Subscription · 30 Jun 2026 to 30 Jul 2026")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(main.getByRole("button", { name: "Pay invoice" }));
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_unpaid_subscription");

    const planDialog = await openPlanModal(user);
    expect(planDialog.queryByText("Subscription unpaid")).toBeNull();
    expect(planDialog.queryByText("Next entitlement change Free on 30 Jul 2026")).toBeNull();
    expect(planDialog.getByText("Plan change scheduled")).toBeTruthy();
    expect(planDialog.getByText("Free now, Free on 30 Jul 2026.")).toBeTruthy();
    expect(planDialog.getByRole("button", { name: "Cancel scheduled change" })).toBeTruthy();
    expect(planDialog.getAllByRole("button", { name: "Scheduled" })).toHaveLength(3);
  });

  it("shows subscription invoice finalization failure signals without leaking raw Stripe errors", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        billing_state: "unpaid",
        self_service_subscription: {
          plan: "pro",
          status: "unpaid",
          current_period_start: "2026-06-30T12:00:00.000Z",
          current_period_end: "2026-07-30T12:00:00.000Z",
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
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Unpaid billing state")).toBeTruthy();
    expect(main.getByText("Pro subscription invoice finalization failed")).toBeTruthy();
    expect(main.getByText(/Automatic tax requires location inputs/)).toBeTruthy();
    expect(main.getByText(/Tax location customer location missing/)).toBeTruthy();
    expect(main.getByText(/Finalization error customer tax location invalid/)).toBeTruthy();
    expect(main.queryByText(/Do not store this Stripe error message/)).toBeNull();
  });

  it("shows payment-required override invoice status and hosted payment action to the Workspace owner", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        payment_required_plan_override: {
          plan: "pro",
          display_name: "Pro",
          start_at: "2026-06-01T00:00:00.000Z",
          end_at: "2026-07-01T00:00:00.000Z",
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
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Payment-required Pro invoice open")).toBeTruthy();
    expect(main.queryByRole("heading", { name: "Payment-Required Override Invoice" })).toBeNull();
    expect(main.getByText("GBP 125.00")).toBeTruthy();
    expect(main.getByText(/Manual collection/)).toBeTruthy();
    expect(main.queryByText(/in_payment_required_override/)).toBeNull();

    await user.click(main.getByRole("button", { name: "Pay invoice" }));

    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_payment_required_override");
  });

  it("shows customer-action payment-required override invoices as payable to the Workspace owner", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        payment_required_plan_override: {
          plan: "pro",
          display_name: "Pro",
          start_at: "2026-06-01T00:00:00.000Z",
          end_at: "2026-07-01T00:00:00.000Z",
          amount: {
            currency: "GBP",
            amount_minor: 12500,
            display: "GBP 125.00",
            tax_behavior: "exclusive",
          },
          collection_mode: "automatic",
          invoice: {
            status: "payment_action_required",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_action_required",
          },
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Payment-required Pro invoice payment action required")).toBeTruthy();
    expect(main.getByText(/Automatic collection/)).toBeTruthy();
    expect(main.queryByText(/in_payment_required_action_required/)).toBeNull();

    await user.click(main.getByRole("button", { name: "Pay invoice" }));

    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_payment_required_action_required");
  });

  it("shows terminal payment-required override invoices as view-only to the Workspace owner", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        payment_required_plan_override: {
          plan: "pro",
          display_name: "Pro",
          start_at: "2026-06-01T00:00:00.000Z",
          end_at: "2026-07-01T00:00:00.000Z",
          amount: {
            currency: "GBP",
            amount_minor: 12500,
            display: "GBP 125.00",
            tax_behavior: "exclusive",
          },
          collection_mode: "manual",
          invoice: {
            status: "uncollectible",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_payment_required_uncollectible",
          },
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Payment-required Pro invoice uncollectible")).toBeTruthy();
    expect(main.queryByRole("button", { name: "Pay invoice" })).toBeNull();
    expect(main.queryByText(/in_payment_required_uncollectible/)).toBeNull();

    await user.click(main.getByRole("button", { name: "View invoice" }));

    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_payment_required_uncollectible");
  });

  it("shows suspended Enterprise ramp-up invoice status and hosted payment action to the Workspace owner", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "pro",
          display_name: "Pro",
          included_credits: 200,
          api_access: true,
          per_page_catalog_price: {
            currency: "GBP",
            amount_minor: 18,
            display: "GBP 0.18",
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
          anchor: "2026-05-15T00:00:00.000Z",
          start: "2026-05-15T00:00:00.000Z",
          end: "2026-06-15T00:00:00.000Z",
          monthly_page_limit: 1500,
          pages_used: 37,
          pages_remaining: 1463,
        },
        plan_limits: {
          templates: 20,
          top_level_template_fields: 15,
          table_shaped_fields: 1,
          table_columns_per_field: 10,
          members: 10,
          monthly_pages: 1500,
          api_access: true,
        },
        self_service_subscription: {
          plan: "pro",
          status: "active",
          current_period_start: "2026-05-15T00:00:00.000Z",
          current_period_end: "2026-06-15T00:00:00.000Z",
        },
        enterprise_ramp_up: {
          status: "suspended",
          duration_months: 3,
          enterprise_billing_cycle_start_date: "2026-05-01T00:00:00.000Z",
          starts_at: "2026-05-01T00:00:00.000Z",
          ends_at: "2026-08-01T00:00:00.000Z",
          collection_mode: "manual",
          invoice_review_enabled: false,
          latest_invoice: {
            period_start: "2026-05-01T00:00:00.000Z",
            period_end: "2026-06-01T00:00:00.000Z",
            status: "payment_failed",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_ramp_up",
          },
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Enterprise ramp-up invoice payment failed")).toBeTruthy();
    expect(main.getByText(/Manual collection/)).toBeTruthy();
    expect(main.queryByText(/in_enterprise_ramp_up/)).toBeNull();

    await user.click(main.getByRole("button", { name: "Pay invoice" }));

    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_enterprise_ramp_up");
  });

  it("shows Enterprise annual commitment invoices and hosted payment actions to the Workspace owner", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "enterprise_annual",
          display_name: "Enterprise annual",
          included_credits: 0,
          api_access: true,
          per_page_catalog_price: null,
        },
        credits: {
          included_available: 0,
          purchased_available: 0,
          goodwill_available: 0,
          total_available: 0,
        },
        current_period: {
          anchor: "2026-06-01T00:00:00.000Z",
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-08-01T00:00:00.000Z",
          monthly_page_limit: null,
          pages_used: 60005,
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
        enterprise_annual_commitment: {
          status: "suspended",
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
          starts_at: "2026-06-01T00:00:00.000Z",
          ends_at: "2027-06-01T00:00:00.000Z",
          collection_mode: "manual",
          invoice_review_enabled: false,
          upfront_invoice: {
            status: "paid",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront",
            paid_at: "2026-06-03T12:00:00.000Z",
          },
          latest_overage_invoice: {
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            status: "payment_failed",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_overage",
          },
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Enterprise annual overage invoice payment failed")).toBeTruthy();
    expect(main.getByText("GBP 64,800.00")).toBeTruthy();
    expect(main.getByText("Enterprise annual upfront invoice paid")).toBeTruthy();
    expect(main.getByRole("button", { name: "View invoice" })).toBeTruthy();
    expect(main.getAllByText(/Manual collection/).length).toBeGreaterThan(0);
    expect(main.queryByText(/in_enterprise_annual_overage/)).toBeNull();

    await user.click(main.getByRole("button", { name: "Pay invoice" }));

    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_enterprise_annual_overage");
  });

  it("shows payment-gated Enterprise annual upfront invoice action to the Workspace owner", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      billingSummary: {
        ...freeBillingSummary(),
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
          starts_at: "2026-06-01T00:00:00.000Z",
          ends_at: "2027-06-01T00:00:00.000Z",
          collection_mode: "manual",
          invoice_review_enabled: false,
          upfront_invoice: {
            status: "payment_action_required",
            hosted_invoice_url: "https://invoice.stripe.com/i/in_enterprise_annual_upfront_action",
            paid_at: null,
          },
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();

    const main = within(screen.getByRole("main"));
    expect(await main.findByText("Enterprise annual upfront invoice payment action required")).toBeTruthy();
    expect(main.getByText("GBP 64,800.00")).toBeTruthy();
    expect(main.queryByText(/in_enterprise_annual_upfront_action/)).toBeNull();

    await user.click(main.getByRole("button", { name: "Pay invoice" }));

    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_enterprise_annual_upfront_action");
  });

  it("starts Credit pack Checkout from the owner Billing page", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_credit_pack_100",
    }));

    render(<App />);

    await waitForWorkspaceBilling();
    const creditDialog = await openCreditModal(user);
    await user.click(creditDialog.getByRole("button", { name: "Buy 100 Credits" }));

    const returnOrigin = window.location.origin;
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/credit-packs/checkout",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({
            pack_size: 100,
            return_origin: returnOrigin,
          }),
        }),
      );
    });
    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_credit_pack_100");
  });

  it("keeps the Billing page usable when Credit pack Checkout cannot start", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/billing/credit-packs/checkout")) {
        return Promise.resolve(jsonResponse({
          error: {
            message: "Credit pack Checkout could not be started because Stripe is unavailable.",
          },
        }, { status: 503 }));
      }
      return mockBillingFetch({ role: "owner" })(input, options);
    });

    render(<App />);

    await waitForWorkspaceBilling();
    const creditDialog = await openCreditModal(user);
    await user.click(creditDialog.getByRole("button", { name: "Buy 100 Credits" }));

    expect(await creditDialog.findByText("Credit pack Checkout could not be started because Stripe is unavailable.")).toBeTruthy();
    expect(document.querySelector(".billing-action-error")).toBeNull();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { name: "Billing" })).toBeTruthy();
    expect(creditDialog.getByRole("button", { name: "Buy 100 Credits" }).disabled).toBe(false);
    expect(main.queryByRole("heading", { name: "Billing unavailable" })).toBeNull();
    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps plan selection errors inside the plan modal", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/billing/subscriptions/checkout")) {
        return Promise.resolve(jsonResponse({
          error: {
            message: "Subscription Checkout could not be started because Stripe is unavailable.",
          },
        }, { status: 503 }));
      }
      return mockBillingFetch({ role: "owner" })(input, options);
    });

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    await user.click(planDialog.getByRole("button", { name: "Start Pro" }));

    expect(await planDialog.findByText("Subscription Checkout could not be started because Stripe is unavailable.")).toBeTruthy();
    expect(document.querySelector(".billing-action-error")).toBeNull();
    expect(planDialog.getByRole("button", { name: "Start Pro" }).disabled).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("visually marks only the clicked subscription start button as pending while blocking both starts", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/billing/subscriptions/checkout")) {
        return new Promise(() => {});
      }
      return mockBillingFetch({ role: "owner" })(input, options);
    });

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    await user.click(planDialog.getByRole("button", { name: "Start Pro" }));

    await waitFor(() => {
      expect(planDialog.getByRole("button", { name: "Starting..." }).disabled).toBe(true);
    });
    const pendingProButton = planDialog.getByRole("button", { name: "Starting..." });
    const blockedMaxButton = planDialog.getByRole("button", { name: "Start Max" });
    expect(pendingProButton.className).toContain("is-pending");
    expect(pendingProButton.className).not.toContain("is-passively-disabled");
    expect(blockedMaxButton.disabled).toBe(true);
    expect(blockedMaxButton.className).toContain("is-passively-disabled");
    expect(blockedMaxButton.className).not.toContain("is-pending");
  });

  it("starts Pro subscription Checkout from the owner Billing page", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      subscriptionCheckoutUrl: "https://checkout.stripe.com/c/pay/cs_test_pro_subscription",
    }));

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    await user.click(planDialog.getByRole("button", { name: "Start Pro" }));

    const returnOrigin = window.location.origin;
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/subscriptions/checkout",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({
            plan: "pro",
            return_origin: returnOrigin,
          }),
        }),
      );
    });
    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_pro_subscription");
  });

  it("starts a Pro to Max subscription change from the owner Billing page", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      subscriptionChangeUrl: "https://invoice.stripe.com/i/in_prorated_max_upgrade",
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "pro",
          display_name: "Pro",
          included_credits: 200,
          api_access: true,
          per_page_catalog_price: {
            currency: "GBP",
            amount_minor: 20,
            display: "GBP 0.20",
            tax_behavior: "exclusive",
          },
        },
        self_service_subscription: {
          plan: "pro",
          status: "active",
          current_period_start: "2026-05-31T12:00:00.000Z",
          current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    await user.click(planDialog.getByRole("button", { name: "Upgrade to Max" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/subscriptions/change",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({ plan: "max" }),
        }),
      );
    });
    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBe("1");
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.com/i/in_prorated_max_upgrade");
  });

  it("shows Free as current and offers paid upgrades while a Free plan override is active", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
      },
    });
    let billingSummary = {
      ...freeBillingSummary(),
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
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: "2026-05-31T12:00:00.000Z",
        current_period_end: "2026-06-30T12:00:00.000Z",
      },
      next_scheduled_entitlement: {
        plan: "pro",
        display_name: "Pro",
        effective_at: "2026-06-30T12:00:00.000Z",
      },
    };
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/billing/subscriptions/change")) {
        billingSummary = {
          ...billingSummary,
          active_entitlement: {
            plan: "pro",
            display_name: "Pro",
            included_credits: 200,
            api_access: true,
            per_page_catalog_price: {
              currency: "GBP",
              amount_minor: 20,
              display: "GBP 0.20",
              tax_behavior: "exclusive",
            },
          },
          next_scheduled_entitlement: null,
        };
        return Promise.resolve(jsonResponse({
          subscription_id: "sub_pro_workspace",
          target_plan: "pro",
        }));
      }
      return mockBillingFetch({
        role: "owner",
        billingSummary,
      })(input, options);
    });

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    expect(planDialog.queryByRole("button", { name: "Change scheduled" })).toBeNull();
    expect(planDialog.queryByRole("button", { name: "Switch to Free" })).toBeNull();
    expect(planDialog.getByRole("button", { name: "Current plan" }).disabled).toBe(true);
    expect(planDialog.getByRole("button", { name: "Upgrade to Pro" })).toBeTruthy();
    expect(planDialog.getByRole("button", { name: "Upgrade to Max" })).toBeTruthy();
    await user.click(planDialog.getByRole("button", { name: "Upgrade to Pro" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/subscriptions/change",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({ plan: "pro" }),
        }),
      );
    });
    await waitFor(() => {
      expect(planDialog.getByRole("button", { name: "Current plan" }).disabled).toBe(true);
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("schedules a paid to Free subscription change from the owner Billing page", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      subscriptionChangeResponse: {
        subscription_id: "sub_pro_workspace",
        scheduled_plan: "free",
        effective_at: "2026-06-30T12:00:00.000Z",
      },
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "pro",
          display_name: "Pro",
          included_credits: 200,
          api_access: true,
          per_page_catalog_price: {
            currency: "GBP",
            amount_minor: 20,
            display: "GBP 0.20",
            tax_behavior: "exclusive",
          },
        },
        self_service_subscription: {
          plan: "pro",
          status: "active",
          current_period_start: "2026-05-31T12:00:00.000Z",
          current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    await user.click(planDialog.getByRole("button", { name: "Switch to Free" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/subscriptions/change",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({ plan: "free" }),
        }),
      );
    });
  });

  it("explains and cancels a scheduled paid to Free subscription change from the plan modal", async () => {
    const user = userEvent.setup();
    let billingSummary = {
      ...freeBillingSummary(),
      active_entitlement: {
        plan: "pro",
        display_name: "Pro",
        included_credits: 200,
        api_access: true,
        per_page_catalog_price: {
          currency: "GBP",
          amount_minor: 20,
          display: "GBP 0.20",
          tax_behavior: "exclusive",
        },
      },
      self_service_subscription: {
        plan: "pro",
        status: "active",
        current_period_start: "2026-05-31T12:00:00.000Z",
        current_period_end: "2026-06-30T12:00:00.000Z",
      },
      next_scheduled_entitlement: {
        plan: "free",
        display_name: "Free",
        effective_at: "2026-06-30T12:00:00.000Z",
      },
    };
    globalThis.fetch = vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/billing/subscriptions/scheduled-change/cancel")) {
        billingSummary = {
          ...billingSummary,
          next_scheduled_entitlement: null,
        };
        return Promise.resolve(jsonResponse({
          subscription_id: "sub_pro_workspace",
          canceled_scheduled_plan: "free",
          active_plan: "pro",
        }));
      }
      return mockBillingFetch({
        role: "owner",
        billingSummary,
      })(input, options);
    });

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    expect(planDialog.getByText("Plan change scheduled")).toBeTruthy();
    expect(planDialog.getByText("Pro now, Free on 30 Jun 2026.")).toBeTruthy();
    expect(planDialog.getAllByRole("button", { name: "Scheduled" })).toHaveLength(3);
    await user.click(planDialog.getByRole("button", { name: "Cancel scheduled change" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/subscriptions/scheduled-change/cancel",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
    });
    await waitFor(() => {
      expect(planDialog.queryByText("Plan change scheduled")).toBeNull();
    });
    expect(planDialog.queryByRole("button", { name: "Scheduled" })).toBeNull();
    expect(planDialog.getByRole("button", { name: "Current plan" })).toBeTruthy();
  });

  it("schedules a Max to Pro subscription change from the owner Billing page", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      subscriptionChangeResponse: {
        subscription_id: "sub_max_workspace",
        scheduled_plan: "pro",
        effective_at: "2026-06-30T12:00:00.000Z",
      },
      billingSummary: {
        ...freeBillingSummary(),
        active_entitlement: {
          plan: "max",
          display_name: "Max",
          included_credits: 1000,
          api_access: true,
          per_page_catalog_price: {
            currency: "GBP",
            amount_minor: 18,
            display: "GBP 0.18",
            tax_behavior: "exclusive",
          },
        },
        self_service_subscription: {
          plan: "max",
          status: "active",
          current_period_start: "2026-05-31T12:00:00.000Z",
          current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    }));

    render(<App />);

    await waitForWorkspaceBilling();
    const planDialog = await openPlanModal(user);
    await user.click(planDialog.getByRole("button", { name: "Downgrade to Pro" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/subscriptions/change",
        expect.objectContaining({
          credentials: "include",
          method: "POST",
          body: JSON.stringify({ plan: "pro" }),
        }),
      );
    });
  });

  it("defaults to the Workspace dashboard after Stripe returns and reloads Billing when opened", async () => {
    window.sessionStorage.setItem("documentextraction.billing.return", "1");

    render(<App />);

    const main = within(screen.getByRole("main"));
    expect(await main.findByRole("heading", { name: "Workspace Users" })).toBeTruthy();
    expect(main.queryByRole("heading", { name: "Billing" })).toBeNull();
    expect(await screen.findByRole("button", { name: "View Billing" })).toBeTruthy();
    expect(
      globalThis.fetch.mock.calls.some(([input]) =>
        String(input).includes("/billing/summary"),
      ),
    ).toBe(false);

    await waitForWorkspaceBilling();
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/v1/workspaces/ws_1/billing/summary",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });
    expect(window.sessionStorage.getItem("documentextraction.billing.return")).toBeNull();
  });

  it("does not show owner Billing navigation or fetch billing details for Workspace admins", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({ role: "admin" }));

    render(<App />);

    await screen.findByRole("button", { name: /Research Workspace/ });

    expect(screen.queryByRole("button", { name: /^Billing$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "View Billing" })).toBeNull();
    expect(
      globalThis.fetch.mock.calls.some(([input]) =>
        String(input).includes("/billing/summary"),
      ),
    ).toBe(false);
  });

  it("keeps Document upload clickable and toasts Billing blockers without opening the modal", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "owner",
      workspaceOverrides: {
        billing_operational_status: {
          status: "blocked",
          blocking_reasons: [
            "Insufficient Credits",
            "Template schema limit overage",
          ],
        },
      },
    }));
    const user = userEvent.setup();

    render(<App />);

    const uploadButton = await screen.findByRole("button", { name: "Upload Document" });
    expect(uploadButton.disabled).toBe(false);

    await user.click(uploadButton);

    expect(toast.error).toHaveBeenCalledWith(
      "Document uploads are blocked: Insufficient Credits, Template schema limit overage.",
    );
    expect(screen.queryByRole("dialog", { name: "Upload document" })).toBeNull();
  });

  it("shows limited blocked-action status without owner-only billing detail leakage", async () => {
    globalThis.fetch = vi.fn(mockBillingFetch({
      role: "admin",
      workspaceOverrides: {
        billing_operational_status: {
          status: "blocked",
          blocking_reasons: ["Template limit overage", "Member limit overage"],
        },
      },
    }));

    render(<App />);

    expect(await screen.findByText("Template limit overage")).toBeTruthy();
    expect(screen.getByText("Member limit overage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload Document" }).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: /^Billing$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "View Billing" })).toBeNull();
    expect(screen.queryByText(/Checkout|Payment method|Invoice/i)).toBeNull();
    expect(
      globalThis.fetch.mock.calls.some(([input]) =>
        String(input).includes("/billing/summary"),
      ),
    ).toBe(false);
  });

  it("updates Template overage badges from selected Workspace context refresh after live invalidation", async () => {
    const WebSocketStub = installWebSocketStub();
    const baseFetch = mockBillingFetch({ role: "admin" });
    globalThis.fetch = vi.fn((input, options) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/context")) {
        return Promise.resolve(
          jsonResponse({
            workspace: {
              id: "ws_1",
              name: "Research Workspace",
              role: "admin",
              created_at: "2026-05-04T00:00:00.000Z",
              has_api_key: false,
              billing_plan_limits: freeBillingSummary().plan_limits,
              billing_usage_summary: {
                remaining_credits: 0,
                remaining_pages: 500,
              },
              billing_operational_status: {
                status: "blocked",
                blocking_reasons: ["Template schema limit overage"],
              },
            },
          }),
        );
      }
      return baseFetch(input, options);
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Research Workspace/ })).toBeTruthy();
    expect(screen.queryByText("Template schema limit overage")).toBeNull();
    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "workspace_context_invalidated",
              reason: "template_limits",
              occurred_at: "2026-05-06T12:02:00.000Z",
            },
          ],
        }),
      });
    });

    expect(await screen.findByText("Template schema limit overage")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/v1/workspaces/ws_1/context",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("updates billing usage metrics from selected Workspace context refresh after live invalidation", async () => {
    const WebSocketStub = installWebSocketStub();
    const baseFetch = mockBillingFetch({ role: "admin" });
    globalThis.fetch = vi.fn((input, options) => {
      const url = String(input);
      if (url.endsWith("/workspaces/ws_1/context")) {
        return Promise.resolve(
          jsonResponse({
            workspace: {
              id: "ws_1",
              name: "Research Workspace",
              role: "admin",
              created_at: "2026-05-04T00:00:00.000Z",
              has_api_key: false,
              billing_plan_limits: freeBillingSummary().plan_limits,
              billing_usage_summary: {
                remaining_credits: 12,
                remaining_pages: 488,
              },
              billing_operational_status: {
                status: "blocked",
                blocking_reasons: ["Payment required"],
              },
            },
          }),
        );
      }
      return baseFetch(input, options);
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Research Workspace/ })).toBeTruthy();
    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });
    const fullWorkspaceCallsBefore = globalThis.fetch.mock.calls.filter(
      ([input]) => String(input) === "/v1/workspaces",
    ).length;
    const invitationCallsBefore = globalThis.fetch.mock.calls.filter(
      ([input]) => String(input) === "/v1/invitations",
    ).length;

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "workspace_context_invalidated",
              reason: "billing_usage",
              occurred_at: "2026-05-06T12:02:00.000Z",
            },
          ],
        }),
      });
    });

    expect(await screen.findByText("Payment required")).toBeTruthy();
    const metrics = within(screen.getByRole("region", { name: "Operational metrics" }));
    expect(metrics.getByText("12")).toBeTruthy();
    expect(metrics.getByText("488")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/v1/workspaces/ws_1/context",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
    expect(
      globalThis.fetch.mock.calls.filter(([input]) => String(input) === "/v1/workspaces"),
    ).toHaveLength(fullWorkspaceCallsBefore);
    expect(
      globalThis.fetch.mock.calls.filter(([input]) => String(input) === "/v1/invitations"),
    ).toHaveLength(invitationCallsBefore);
  });
});

async function waitForWorkspaceBilling() {
  const main = within(screen.getByRole("main"));
  if (!main.queryByRole("heading", { name: "Billing" })) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "View Billing" }));
  }
  await main.findByRole("heading", { name: "Billing" });
  return main;
}

async function openPlanModal(user) {
  const main = within(screen.getByRole("main"));
  await user.click(main.getByRole("button", { name: "View/Edit Plan" }));
  return within(await screen.findByRole("dialog", { name: /View\/edit plan/i }));
}

async function openCreditModal(user) {
  const main = within(screen.getByRole("main"));
  await user.click(main.getByRole("button", { name: "Buy Credits" }));
  return within(await screen.findByRole("dialog", { name: /Buy credits/i }));
}

function mockBillingFetch({
  role,
  billingSummary = freeBillingSummary(),
  workspaceOverrides = {},
  checkoutUrl = null,
  subscriptionCheckoutUrl = null,
  subscriptionChangeUrl = null,
  subscriptionChangeResponse = null,
  billingUsage = null,
  billingActivityPage = {
    owner_billing_activity: [],
    owner_billing_activity_next_cursor: null,
  },
}) {
  return (input) => {
    const url = String(input);
    if (url.endsWith("/workspaces")) {
      const entitlementPlan = String(
        billingSummary?.active_entitlement?.plan || "",
      );
      const isCreditLimited = ["free", "pro", "max"].includes(entitlementPlan);
      return Promise.resolve(
        jsonResponse({
          workspaces: [
            {
              id: "ws_1",
              name: "Research Workspace",
              role,
              created_at: "2026-05-04T00:00:00.000Z",
              has_api_key: false,
              billing_usage_summary: {
                remaining_credits: isCreditLimited
                  ? Number(billingSummary?.credits?.total_available || 0)
                  : null,
                remaining_pages:
                  billingSummary?.current_period?.pages_remaining ?? null,
              },
              ...workspaceOverrides,
            },
          ],
        }),
      );
    }
    if (url.endsWith("/invitations")) {
      return Promise.resolve(jsonResponse({ invitations: [] }));
    }
    if (url.endsWith("/templates")) {
      return Promise.resolve(jsonResponse({ templates: [] }));
    }
    if (url.endsWith("/jobs")) {
      return Promise.resolve(jsonResponse({ jobs: [], next_cursor: null }));
    }
    if (url.endsWith("/users")) {
      return Promise.resolve(jsonResponse({ users: [] }));
    }
    if (url.endsWith("/workspaces/ws_1/invitations")) {
      return Promise.resolve(jsonResponse({ invitations: [] }));
    }
    if (url.endsWith("/workspaces/ws_1/billing/summary")) {
      return Promise.resolve(jsonResponse(billingSummary));
    }
    if (url.includes("/workspaces/ws_1/billing/usage")) {
      const usageUrl = new URL(url, "https://example.test");
      const range = usageUrl.searchParams.get("range") || "daily";
      return Promise.resolve(jsonResponse({
        credit_usage: billingUsage || defaultCreditUsage(range),
      }));
    }
    if (url.includes("/workspaces/ws_1/billing/activity")) {
      return Promise.resolve(jsonResponse(billingActivityPage));
    }
    if (url.endsWith("/workspaces/ws_1/billing/credit-packs/checkout")) {
      return Promise.resolve(jsonResponse({
        checkout_session_id: "cs_test_credit_pack_100",
        url: checkoutUrl || "https://checkout.stripe.com/c/pay/cs_test_credit_pack_100",
      }));
    }
    if (url.endsWith("/workspaces/ws_1/billing/subscriptions/checkout")) {
      return Promise.resolve(jsonResponse({
        checkout_session_id: "cs_test_pro_subscription",
        url: subscriptionCheckoutUrl || "https://checkout.stripe.com/c/pay/cs_test_pro_subscription",
      }));
    }
    if (url.endsWith("/workspaces/ws_1/billing/subscriptions/change")) {
      return Promise.resolve(jsonResponse(subscriptionChangeResponse || {
        subscription_id: "sub_pro_workspace",
        target_plan: "max",
        payment_url: subscriptionChangeUrl || "https://invoice.stripe.com/i/in_prorated_max_upgrade",
      }));
    }
    if (url.endsWith("/workspaces/ws_1/billing/subscriptions/scheduled-change/cancel")) {
      return Promise.resolve(jsonResponse({
        subscription_id: "sub_pro_workspace",
        canceled_scheduled_plan: "free",
        active_plan: "pro",
      }));
    }
    return Promise.resolve(jsonResponse({}));
  };
}

function freeBillingSummary() {
  return {
    workspace_id: "ws_1",
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
    next_scheduled_entitlement: null,
    self_service_subscription: null,
    owner_billing_activity: [],
    owner_billing_activity_next_cursor: null,
    credit_usage: defaultCreditUsage("daily"),
    payment_controls: [],
  };
}

function defaultCreditUsage(range = "daily") {
  const normalizedRange = ["daily", "weekly", "monthly", "yearly"].includes(range)
    ? range
    : "daily";
  const labels = {
    daily: Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, "0")}:00`),
    weekly: ["26 May", "27 May", "28 May", "29 May", "30 May", "31 May", "01 Jun"],
    monthly: ["w/c 11 May", "w/c 18 May", "w/c 25 May", "w/c 01 Jun"],
    yearly: [
      "Jul 2025",
      "Aug 2025",
      "Sep 2025",
      "Oct 2025",
      "Nov 2025",
      "Dec 2025",
      "Jan 2026",
      "Feb 2026",
      "Mar 2026",
      "Apr 2026",
      "May 2026",
      "Jun 2026",
    ],
  }[normalizedRange];

  return {
    range: normalizedRange,
    total_credits: 0,
    total_billable_document_pages: 0,
    buckets: labels.map((label, index) => ({
      label,
      start_at: `2026-06-0${index + 1}T00:00:00.000Z`,
      end_at: `2026-06-0${index + 2}T00:00:00.000Z`,
      credits: 0,
      billable_document_pages: 0,
    })),
  };
}

function installLocalStorage(initialValue) {
  const storage = new Map([
    ["documentextraction.workspace.v1", JSON.stringify(initialValue)],
  ]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key) => storage.get(key) ?? null),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
      removeItem: vi.fn((key) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    },
  });
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function installWebSocketStub() {
  class WebSocketStub {
    static instances = [];
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.close = vi.fn();
      WebSocketStub.instances.push(this);
    }
  }

  vi.stubGlobal("WebSocket", WebSocketStub);
  return WebSocketStub;
}
