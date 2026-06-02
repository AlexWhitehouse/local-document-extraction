import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Worker configuration", () => {
  it("exposes the EMAIL binding through real Cloudflare Email Sending in local development", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.send_email).toContainEqual({
      name: "EMAIL",
      remote: true,
    });
  });

  it("configures the Workspace product store as a SQLite-backed Durable Object", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.durable_objects?.bindings).toContainEqual({
      name: "WORKSPACE_PRODUCT_STORE",
      class_name: "WorkspaceProductStore",
    });
    expect(config.migrations).toContainEqual({
      tag: "v1_workspace_product_store",
      new_sqlite_classes: ["WorkspaceProductStore"],
    });
  });

  it("configures the Workspace billing ledger as a SQLite-backed Durable Object", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.durable_objects?.bindings).toContainEqual({
      name: "WORKSPACE_BILLING_LEDGER",
      class_name: "WorkspaceBillingLedger",
    });
    expect(config.migrations).toContainEqual({
      tag: "v2_workspace_billing_ledger",
      new_sqlite_classes: ["WorkspaceBillingLedger"],
    });
  });

  it("exposes Workspace product analytics through Workers Analytics Engine", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.analytics_engine_datasets).toContainEqual({
      binding: "WORKSPACE_PRODUCT_ANALYTICS",
      dataset: "workspace_product_analytics",
    });
  });

  it("configures only required non-secret Stripe catalog IDs without storing Stripe secrets", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.vars).toMatchObject({
      STRIPE_PRO_MONTHLY_PRICE_ID: "price_1TdGWhCy6HyJVSRqt6ek5r6o",
      STRIPE_MAX_MONTHLY_PRICE_ID: "price_1TdGXjCy6HyJVSRq7n0sIFdk",
    });
    expect(Object.keys(config.vars).filter((key) => key.startsWith("STRIPE_CREDIT_PACK_"))).toEqual([]);
    expect(Object.keys(config.vars).filter((key) => key.endsWith("_PRODUCT_ID"))).toEqual([]);
    expect(config.vars).not.toHaveProperty("STRIPE_CHECKOUT_SUCCESS_URL");
    expect(config.vars).not.toHaveProperty("STRIPE_CHECKOUT_CANCEL_URL");
    expect(config.vars).not.toHaveProperty("STRIPE_API_KEY");
    expect(config.vars).not.toHaveProperty("STRIPE_WEBHOOK_SECRET");
  });

  it("documents Stripe billing secrets and webhook setup without secret values", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

    expect(readme).toContain("STRIPE_API_KEY");
    expect(readme).toContain("STRIPE_WEBHOOK_SECRET");
    expect(readme).toContain("/v1/billing/stripe/webhook");
    expect(readme).toContain("stripe listen --forward-to http://localhost:8787/v1/billing/stripe/webhook");
    expect(readme).not.toMatch(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b/);
    expect(readme).not.toMatch(/\bwhsec_[A-Za-z0-9]+\b/);
  });
});
